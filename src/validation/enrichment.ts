/**
 * Time-boxed lead enrichment: IPQS email / phone / IP, NPPES NPI registry, OFAC SDN name check.
 * Every step is ~5s max. A step that fails or times out reports NOT RUN (reason) and never affects the grade.
 * IPQS free tier is small (1,000/mo): one call per target, no retries, cached in-process, daily cap.
 */
import type {Lead} from "./schema.js";
import type {LeadQuality,QualitySignal} from "./lead-quality.js";
import {leadEmail,leadPersonName,leadPhone} from "../integrations/osint/targets.js";

export type StepName="ipqs_email"|"ipqs_phone"|"ipqs_ip"|"nppes"|"ofac";
export interface EnrichmentStep{step:StepName;ran:boolean;reason?:string;data?:Record<string,unknown>}
export interface EnrichmentReport{steps:EnrichmentStep[]}

type FetchLike=(url:string,init?:{signal?:AbortSignal;headers?:Record<string,string>})=>Promise<{ok:boolean;status:number;json():Promise<any>;text():Promise<string>}>;
export interface EnrichmentDeps{fetch?:FetchLike;apiKey?:string;timeoutMs?:number;enabled?:boolean;dailyCap?:number}

const IPQS="https://www.ipqualityscore.com/api/json";
const NPPES="https://npiregistry.cms.hhs.gov/api/";
const OFAC_SDN="https://www.treasury.gov/ofac/downloads/sdn.csv";
const DAY=86_400_000;

const cache=new Map<string,{at:number;step:Promise<EnrichmentStep>}>();
let usage={day:"",calls:0};

const notRun=(step:StepName,reason:string):EnrichmentStep=>({step,ran:false,reason});
const bool=(v:unknown)=>v===true||v==="true";
const num=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:undefined;

function errText(e:unknown,key?:string){
  const name=(e as any)?.name;
  let msg=name==="TimeoutError"||name==="AbortError"?"timed out":String((e as any)?.message??e??"error");
  if(key) msg=msg.split(key).join("[key]");
  return msg.replace(/\s+/g," ").slice(0,80);
}

async function getJson(f:FetchLike,url:string,ms:number,key?:string):Promise<{ok:true;body:any}|{ok:false;reason:string}>{
  try{
    const res=await f(url,{signal:AbortSignal.timeout(ms),headers:{accept:"application/json"}});
    if(!res.ok) return {ok:false,reason:`HTTP ${res.status}`};
    return {ok:true,body:await res.json()};
  }catch(e){ return {ok:false,reason:errText(e,key)}; }
}

function ipqsBudget(cap:number){
  const day=new Date().toISOString().slice(0,10);
  if(usage.day!==day) usage={day,calls:0};
  if(usage.calls>=cap) return false;
  usage.calls++;
  return true;
}

function ipqs(step:"ipqs_email"|"ipqs_phone"|"ipqs_ip",target:string|undefined,missing:string,d:Required<Pick<EnrichmentDeps,"fetch"|"timeoutMs"|"dailyCap">>&{apiKey?:string}):Promise<EnrichmentStep>{
  if(!target) return Promise.resolve(notRun(step,missing));
  if(!d.apiKey) return Promise.resolve(notRun(step,"IPQS_API_KEY not set"));
  const ck=`${step}:${target.toLowerCase()}`;
  const hit=cache.get(ck);
  if(hit&&Date.now()-hit.at<DAY) return hit.step;
  if(!ipqsBudget(d.dailyCap)) return Promise.resolve(notRun(step,"IPQS daily lookup cap reached"));
  const kind=step==="ipqs_email"?"email":step==="ipqs_phone"?"phone":"ip";
  const extra=kind==="phone"?"?country[]=US":kind==="email"?"?timeout=4":"?strictness=0";
  const run=(async():Promise<EnrichmentStep>=>{
    const r=await getJson(d.fetch,`${IPQS}/${kind}/${encodeURIComponent(d.apiKey!)}/${encodeURIComponent(target)}${extra}`,d.timeoutMs,d.apiKey);
    if(!r.ok) return notRun(step,`IPQS ${r.reason}`);
    const b=r.body??{};
    if(b.success===false) return notRun(step,`IPQS: ${errText(b.message??"request failed",d.apiKey)}`);
    const fraud_score=num(b.fraud_score);
    if(kind==="email") return {step,ran:true,data:{valid:bool(b.valid),disposable:bool(b.disposable),timed_out:bool(b.timed_out),recent_abuse:bool(b.recent_abuse),fraud_score}};
    if(kind==="phone") return {step,ran:true,data:{valid:bool(b.valid),voip:bool(b.VOIP),risky:bool(b.risky),recent_abuse:bool(b.recent_abuse),line_type:typeof b.line_type==="string"?b.line_type.slice(0,30):undefined,active:b.active===undefined?undefined:bool(b.active),fraud_score}};
    return {step,ran:true,data:{proxy:bool(b.proxy),vpn:bool(b.vpn),tor:bool(b.tor),recent_abuse:bool(b.recent_abuse),fraud_score}};
  })();
  cache.set(ck,{at:Date.now(),step:run});
  run.then(s=>{ if(!s.ran) cache.delete(ck); });
  return run;
}

export function leadIp(lead:Lead):string|undefined{
  const m=(lead.metadata??{}) as Record<string,any>;
  const hs=(m.hubspot&&typeof m.hubspot==="object"?m.hubspot:{}) as Record<string,any>;
  for(const v of [m.ip,m.ip_address,m.client_ip,m.lead_ip,hs.ip_address,hs.hs_ip_address,hs.ip]){
    const s=typeof v==="string"?v.trim():"";
    if(/^(\d{1,3}\.){3}\d{1,3}$/.test(s)||/^[0-9a-f:]{3,39}$/i.test(s)&&s.includes(":")) return s;
  }
  return undefined;
}

const ORG=/\b(clinic|hospital|center|centre|medical|health|group|llc|inc|pa|pllc|associates|therapy|chiropractic|orthopedic|urgent|care|rehab|imaging|practice)\b/i;

async function nppes(lead:Lead,f:FetchLike,ms:number):Promise<EnrichmentStep>{
  const med=((lead as any).medical??{}) as {provider_name?:string;npi?:string};
  const name=String(med.provider_name??"").trim();
  const npi=String(med.npi??"").replace(/\D/g,"");
  if(!name&&npi.length!==10) return notRun("nppes","no provider/doctor name on lead");
  const p=new URLSearchParams({version:"2.1",limit:"5"});
  if(npi.length===10) p.set("number",npi);
  else{
    const clean=name.replace(/\b(dr|md|do|dc|np|pa-c|dpm|phd)\b\.?/gi," ").replace(/[^A-Za-z' -]/g," ").replace(/\s+/g," ").trim();
    const tokens=clean.split(" ").filter(t=>t.length>1);
    if(!tokens.length) return notRun("nppes","provider name not searchable");
    if(!ORG.test(name)&&tokens.length>=2){ p.set("first_name",tokens[0]!); p.set("last_name",tokens[tokens.length-1]!); p.set("enumeration_type","NPI-1"); }
    else p.set("organization_name",`${clean.slice(0,40)}*`);
    if(/^[A-Z]{2}$/.test(String(lead.state??""))) p.set("state",String(lead.state));
  }
  const r=await getJson(f,`${NPPES}?${p}`,ms);
  if(!r.ok) return notRun("nppes",`NPPES ${r.reason}`);
  if(Array.isArray(r.body?.Errors)&&r.body.Errors.length) return notRun("nppes",`NPPES: ${errText(r.body.Errors[0]?.description??"error")}`);
  const results=Array.isArray(r.body?.results)?r.body.results:[];
  const matches=results.slice(0,3).map((x:any)=>{
    const b=x.basic??{};
    const nm=b.organization_name??[b.first_name,b.last_name].filter(Boolean).join(" ");
    const loc=(x.addresses??[]).find((a:any)=>a.address_purpose==="LOCATION")??{};
    const tax=(x.taxonomies??[]).find((t:any)=>t.primary)?.desc;
    return `${nm} (NPI ${x.number}${loc.state?`, ${loc.city??""} ${loc.state}`.replace(/\s+/g," "):""}${tax?`, ${tax}`:""})`;
  });
  return {step:"nppes",ran:true,data:{result_count:num(r.body?.result_count)??results.length,matches}};
}

type SdnPerson={name:string;first:Set<string>;program:string};
let sdn:{at:number;loading?:Promise<Map<string,SdnPerson[]>>;list?:Map<string,SdnPerson[]>;error?:string;failedAt?:number}={at:0};
const norm=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z ]/g,"").replace(/\s+/g," ").trim();

function csvRow(line:string){
  const out:string[]=[];let cur="",q=false;
  for(let i=0;i<line.length;i++){
    const c=line[i]!;
    if(q){ if(c==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else if(c==='"') q=true; else if(c===","){out.push(cur);cur="";} else cur+=c;
  }
  out.push(cur);
  return out.map(s=>s.trim());
}

export function parseSdnCsv(text:string){
  const idx=new Map<string,SdnPerson[]>();
  for(const line of text.split(/\r?\n/)){
    const [, name, type, program]=csvRow(line);
    if(!name||type!=="individual") continue;
    const [last,rest=""]=name.split(",");
    const key=norm(last??"");
    if(!key) continue;
    const person={name,first:new Set(norm(rest).split(" ").filter(Boolean)),program:program??""};
    idx.set(key,[...(idx.get(key)??[]),person]);
  }
  return idx;
}

export function prefetchOfacList(f:FetchLike=fetch as unknown as FetchLike){
  if(sdn.list&&Date.now()-sdn.at<DAY) return Promise.resolve(sdn.list);
  if(sdn.loading) return sdn.loading;
  if(sdn.failedAt&&Date.now()-sdn.failedAt<10*60_000) return Promise.reject(new Error(sdn.error??"load failed"));
  sdn.loading=(async()=>{
    const res=await f(OFAC_SDN,{signal:AbortSignal.timeout(60_000)});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const list=parseSdnCsv(await res.text());
    if([...list.values()].reduce((n,v)=>n+v.length,0)<1000) throw new Error("SDN list looked incomplete");
    sdn={at:Date.now(),list};
    return list;
  })().catch(e=>{ sdn={...sdn,loading:undefined,error:errText(e),failedAt:Date.now()}; throw e; });
  sdn.loading.catch(()=>{});
  return sdn.loading;
}

async function ofac(lead:Lead,f:FetchLike,ms:number):Promise<EnrichmentStep>{
  const full=leadPersonName(lead);
  if(!full) return notRun("ofac","no first + last name on lead");
  let list:Map<string,SdnPerson[]>;
  try{
    list=await Promise.race([prefetchOfacList(f),new Promise<never>((_,rej)=>setTimeout(()=>rej(new Error("SDN list still downloading")),ms).unref?.())]);
  }catch(e){ return notRun("ofac",`OFAC ${errText(e)}`); }
  const tokens=norm(full).split(" ");
  const first=tokens[0]!,last=tokens[tokens.length-1]!;
  const hits=(list.get(last)??[]).filter(p=>p.first.has(first)).slice(0,3).map(p=>`${p.name}${p.program?` [${p.program}]`:""}`);
  return {step:"ofac",ran:true,data:{matches:hits}};
}

export async function runLeadEnrichment(lead:Lead,deps:EnrichmentDeps={}):Promise<EnrichmentReport>{
  const enabled=deps.enabled??(process.env.ENRICHMENT_ENABLED?process.env.ENRICHMENT_ENABLED!=="false":process.env.NODE_ENV!=="test");
  const steps:StepName[]=["ipqs_email","ipqs_phone","ipqs_ip","nppes","ofac"];
  if(!enabled) return {steps:steps.map(s=>notRun(s,"enrichment disabled"))};
  const d={fetch:deps.fetch??(fetch as unknown as FetchLike),timeoutMs:deps.timeoutMs??5000,dailyCap:deps.dailyCap??Number(process.env.IPQS_DAILY_CAP??30),apiKey:deps.apiKey??process.env.IPQS_API_KEY?.trim()};
  const phone=leadPhone(lead)?.replace(/\D/g,"");
  const settled=await Promise.all([
    ipqs("ipqs_email",leadEmail(lead),"no email on lead",d),
    ipqs("ipqs_phone",phone,"no phone on lead",d),
    ipqs("ipqs_ip",leadIp(lead),"no lead IP on file",d),
    nppes(lead,d.fetch,d.timeoutMs),
    ofac(lead,d.fetch,d.timeoutMs)
  ].map((p,i)=>p.catch(e=>notRun(steps[i]!,errText(e,d.apiKey)))));
  return {steps:settled};
}

/** Grade signals. NOT RUN steps contribute nothing. */
export function enrichmentSignals(report?:EnrichmentReport):{junk:QualitySignal[];review:QualitySignal[]}{
  const junk:QualitySignal[]=[],review:QualitySignal[]=[];
  const get=(s:StepName)=>report?.steps.find(x=>x.step===s&&x.ran)?.data as Record<string,any>|undefined;
  const email=get("ipqs_email"),phone=get("ipqs_phone"),ip=get("ipqs_ip"),sanctions=get("ofac");
  if(email&&!email.valid&&!email.timed_out) junk.push({code:"IPQS_EMAIL_INVALID",detail:"IPQS says the email is invalid"});
  if(email?.disposable) junk.push({code:"IPQS_EMAIL_DISPOSABLE",detail:"IPQS says the email is a disposable address"});
  if(phone&&!phone.valid) junk.push({code:"IPQS_PHONE_INVALID",detail:"IPQS says the phone number is invalid"});
  if(phone?.voip&&(phone.risky||phone.recent_abuse||(phone.fraud_score??0)>=75)) junk.push({code:"IPQS_PHONE_VOIP_HIGH_RISK",detail:"IPQS says the phone is a high-risk VOIP number"});
  const scores=[email,phone,ip].map(x=>x?.fraud_score).filter((n):n is number=>typeof n==="number");
  const top=scores.length?Math.max(...scores):undefined;
  if(top!==undefined&&top>=90) junk.push({code:"IPQS_FRAUD_SCORE_HIGH",detail:`IPQS fraud score ${top} (90+)`});
  else if(top!==undefined&&top>=75) review.push({code:"IPQS_FRAUD_SCORE_ELEVATED",detail:`IPQS fraud score ${top} (75–89)`});
  if(ip&&(ip.proxy||ip.vpn||ip.tor)) review.push({code:"IPQS_IP_PROXY_VPN",detail:`lead IP is a ${ip.tor?"Tor exit":ip.vpn?"VPN":"proxy"} per IPQS`});
  if(sanctions?.matches?.length) review.push({code:"OFAC_POSSIBLE_NAME_MATCH",detail:`name matches an OFAC SDN entry (name only, verify): ${sanctions.matches[0]}`});
  return {junk,review};
}

/** Adds enrichment signals without re-running the stacked-soft-signal rule (so 75–89 / proxy stay NEEDS REVIEW). */
export function withEnrichment(q:LeadQuality,report?:EnrichmentReport):LeadQuality{
  const s=enrichmentSignals(report);
  return {...q,junk:[...q.junk,...s.junk],review:[...q.review,...s.review]};
}

const yn=(v:unknown)=>v?"yes":"no";
export function formatEnrichmentLines(report?:EnrichmentReport):string[]{
  if(!report) return [];
  const label:Record<StepName,string>={ipqs_email:"IPQS email",ipqs_phone:"IPQS phone",ipqs_ip:"IPQS IP",nppes:"NPI registry (NPPES)",ofac:"OFAC SDN name check"};
  const lines=["🧪 *Enrichment checks*"];
  for(const s of report.steps){
    const d=(s.data??{}) as Record<string,any>;
    const fs=d.fraud_score!==undefined?`, fraud score ${d.fraud_score}`:"";
    let text:string;
    if(!s.ran) text=`NOT RUN (${s.reason})`;
    else if(s.step==="ipqs_email") text=`${d.timed_out&&!d.valid?"mail server timed out (validity unknown)":d.valid?"valid":"invalid"}, disposable ${yn(d.disposable)}, recent abuse ${yn(d.recent_abuse)}${fs}`;
    else if(s.step==="ipqs_phone") text=`${d.valid?"valid":"invalid"}${d.line_type?`, ${d.line_type}`:""}, VOIP ${yn(d.voip)}, risky ${yn(d.risky)}${d.active===undefined?"":`, active ${yn(d.active)}`}${fs}`;
    else if(s.step==="ipqs_ip") text=`proxy ${yn(d.proxy)}, VPN ${yn(d.vpn)}, Tor ${yn(d.tor)}${fs}`;
    else if(s.step==="nppes") text=d.result_count?`${d.result_count} match(es): ${d.matches.join("; ")}`:"ran, no NPI match for the provider named";
    else text=d.matches?.length?`POSSIBLE MATCH (name only, verify): ${d.matches.join("; ")}`:"ran, no match on OFAC SDN primary names";
    lines.push(`• ${label[s.step]}: ${text}`);
  }
  return lines;
}

export function resetEnrichmentCacheForTests(){ cache.clear(); usage={day:"",calls:0}; sdn={at:0}; }
