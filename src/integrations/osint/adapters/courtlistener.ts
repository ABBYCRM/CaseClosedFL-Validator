import {keyed,type OsintConfig} from "../config.js";
import {skippedResult,unavailableResult} from "../cli.js";
import type {OsintAdapterResult,OsintFinding} from "../types.js";

export const COURTLISTENER_DEFAULT_BASE="https://www.courtlistener.com/api/rest/v4";
export const COURTLISTENER_DISCLAIMER="This is a public court-records signal only — NOT a full criminal background check. Absence of hits is not clearance.";
const HIT_CAP=8;
const STATE_LABEL:Record<string,string>={FL:"Florida",CA:"California",AZ:"Arizona",TX:"Texas",NY:"New York"};

export interface CourtListenerHttpResult{status:number;body:string;}
export type CourtListenerHttp=(input:{url:string;headers:Record<string,string>;timeoutMs:number})=>Promise<CourtListenerHttpResult>;

function cleanName(name:string){
  return name.replace(/["\\]/g," ").replace(/\s+/g," ").trim();
}

export function buildCourtListenerQuery(name:string,state?:string){
  const quoted=`"${cleanName(name)}"`;
  if(!state) return `party:${quoted}`;
  const label=STATE_LABEL[state]??state;
  return `party:${quoted} ${state} ${label}`;
}

export function courtListenerSearchUrl(baseUrl:string,name:string,state?:string){
  const base=(baseUrl||COURTLISTENER_DEFAULT_BASE).replace(/\/+$/,"");
  const params=new URLSearchParams({
    type:"r",
    q:buildCourtListenerQuery(name,state),
    order_by:"score desc"
  });
  return `${base}/search/?${params.toString()}`;
}

export function assertCourtListenerUrl(raw:string,allowedBase:string){
  const url=new URL(raw);
  const base=new URL(allowedBase.endsWith("/")?allowedBase:`${allowedBase}/`);
  if(url.protocol!=="https:") throw new Error("HTTPS_REQUIRED");
  if(url.hostname!==base.hostname) throw new Error("COURTLISTENER_HOST_MISMATCH");
  if(!url.pathname.includes("/search")) throw new Error("COURTLISTENER_SEARCH_ONLY");
  return url;
}

function textOf(row:Record<string,unknown>,keys:string[]){
  for(const key of keys){
    const value=row[key];
    if(typeof value==="string"&&value.trim()) return value.trim();
  }
  return "";
}

function publicCourtListenerHref(pathOrUrl:string){
  const raw=pathOrUrl.trim();
  if(!raw) return "";
  if(/^https:\/\//i.test(raw)) return raw;
  if(raw.startsWith("/")) return `https://www.courtlistener.com${raw}`;
  return "";
}

/** Only flag criminal when the API text itself is explicit. Never invent. */
export function looksLikeCriminalDocket(row:Record<string,unknown>){
  const blob=[
    textOf(row,["jurisdictionType","jurisdiction_type"]),
    textOf(row,["suitNature","natureOfSuit","nature_of_suit"]),
    textOf(row,["cause"]),
    textOf(row,["caseName","case_name","caseNameFull","case_name_full"]),
    textOf(row,["docketNumber","docket_number"])
  ].join("\n");
  if(/criminal/i.test(blob)) return true;
  if(/\b\d{1,2}:\d{2}-cr-\d+/i.test(blob)) return true;
  if(/\b18\s*u\.?s\.?c/i.test(blob)&&/\b(?:united states|u\.s\.)\s+v\.?\s/i.test(blob)) return true;
  return false;
}

export function parseCourtListenerSearch(body:string):{count:number;findings:OsintFinding[]}{
  let parsed:unknown;
  try{parsed=JSON.parse(body);}catch{return{count:0,findings:[]};}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)) return{count:0,findings:[]};
  const root=parsed as Record<string,unknown>;
  const rows=Array.isArray(root.results)?root.results.filter(v=>v&&typeof v==="object"&&!Array.isArray(v)) as Record<string,unknown>[]:[];
  const count=typeof root.count==="number"&&Number.isFinite(root.count)?Math.max(0,Math.round(root.count)):rows.length;
  const findings:OsintFinding[]=[];
  if(!rows.length){
    findings.push({
      kind:"COURT_DOCKET_NONE",
      observation:`CourtListener RECAP search returned no public docket hits. ${COURTLISTENER_DISCLAIMER}`,
      signal:"NONE"
    });
    return{count,findings};
  }
  findings.push({
    kind:"COURT_DOCKET_COUNT",
    observation:`CourtListener RECAP search observed ${count} public docket hit(s). ${COURTLISTENER_DISCLAIMER}`,
    signal:String(count)
  });
  let criminal=0;
  for(const row of rows.slice(0,HIT_CAP)){
    const caseName=textOf(row,["caseName","case_name","caseNameFull","case_name_full"])||"unnamed docket";
    const court=textOf(row,["court","court_citation_string"]);
    const docket=textOf(row,["docketNumber","docket_number"]);
    const filed=textOf(row,["dateFiled","date_filed"]);
    const href=publicCourtListenerHref(textOf(row,["docket_absolute_url","absolute_url"]));
    const parts=[`case ${caseName}`];
    if(court) parts.push(`court ${court}`);
    if(docket) parts.push(`docket ${docket}`);
    if(filed) parts.push(`filed ${filed}`);
    if(href) parts.push(`CourtListener ${href}`);
    findings.push({
      kind:"COURT_DOCKET_HIT",
      observation:`Public RECAP docket observed: ${parts.join("; ")}.`,
      site:court||undefined,
      signal:docket||"HIT"
    });
    if(looksLikeCriminalDocket(row)){
      criminal++;
      findings.push({
        kind:"COURT_CRIMINAL_DOCKET_SIGNAL",
        observation:`CourtListener fields on ${caseName}${docket?` (${docket})`:""} include explicit criminal-docket wording. This is still only a public docket label — not a conviction and not a background check.`,
        site:court||undefined,
        signal:"CRIMINAL_LABEL"
      });
    }
  }
  if(rows.length>HIT_CAP){
    findings.push({
      kind:"COURT_DOCKET_TRUNCATED",
      observation:`${rows.length-HIT_CAP} additional first-page hit(s) omitted for note size. No further CourtListener pages or PACER documents were fetched.`,
      signal:"TRUNCATED"
    });
  }
  if(!criminal){
    findings.push({
      kind:"COURT_NO_CRIMINAL_LABEL",
      observation:"No first-page hit carried an explicit criminal-docket label. Civil or unlabeled public dockets are not treated as criminal history.",
      signal:"NO_CRIMINAL_LABEL"
    });
  }
  return{count,findings};
}

export async function defaultCourtListenerHttp(input:{url:string;headers:Record<string,string>;timeoutMs:number}):Promise<CourtListenerHttpResult>{
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),input.timeoutMs);
  try{
    const r=await fetch(input.url,{
      method:"GET",
      redirect:"follow",
      signal:c.signal,
      headers:{
        ...input.headers,
        Accept:"application/json",
        "User-Agent":"CaseClosedFL-Validator/1.4.1 (+validation-bot; courtlistener-search-only)"
      }
    });
    const body=(await r.text()).slice(0,400_000);
    return{status:r.status,body};
  }catch(e:any){
    const message=String(e?.name==="AbortError"?"COURTLISTENER_TIMEOUT":e?.message??"COURTLISTENER_NETWORK_ERROR");
    throw Object.assign(new Error(message),{code:e?.name==="AbortError"?"TIMEOUT":"NETWORK"});
  }finally{
    clearTimeout(timer);
  }
}

function unavailable(reason:string,redacted?:string):OsintAdapterResult{
  return unavailableResult("courtlistener","COURT_RECORDS","name",reason,redacted);
}

export async function runCourtListener(
  name:string|undefined,
  state:string|undefined,
  cfg:OsintConfig,
  http:CourtListenerHttp=defaultCourtListenerHttp
):Promise<OsintAdapterResult>{
  if(!cfg.COURTLISTENER_ENABLED) return unavailable("COURTLISTENER_DISABLED");
  if(!name) return skippedResult("courtlistener","COURT_RECORDS","name","NO_FULL_NAME_SUPPLIED");
  if(!keyed(cfg.COURTLISTENER_API_TOKEN)) return unavailable("COURTLISTENER_API_TOKEN_MISSING",name);
  const base=cfg.COURTLISTENER_BASE_URL||COURTLISTENER_DEFAULT_BASE;
  let url:string;
  try{
    url=courtListenerSearchUrl(base,name,state);
    assertCourtListenerUrl(url,base);
  }catch(e:any){
    return unavailable(`COURTLISTENER_URL_INVALID:${e?.message??"INVALID"}`,name);
  }
  try{
    const result=await http({
      url,
      timeoutMs:cfg.COURTLISTENER_TIMEOUT_MS,
      headers:{Authorization:`Token ${cfg.COURTLISTENER_API_TOKEN}`}
    });
    if(result.status===429) return unavailable("COURTLISTENER_RATE_LIMITED",name);
    if(result.status===401||result.status===403) return unavailable("COURTLISTENER_AUTH_REJECTED",name);
    if(result.status>=500) return unavailable(`COURTLISTENER_HTTP_${result.status}`,name);
    if(result.status<200||result.status>=300) return unavailable(`COURTLISTENER_HTTP_${result.status}`,name);
    const parsed=parseCourtListenerSearch(result.body);
    if(!parsed.findings.length&&!result.body.trim()) return unavailable("COURTLISTENER_EMPTY_BODY",name);
    return{
      provider:"courtlistener",
      capability:"COURT_RECORDS",
      status:"OBSERVED",
      target_type:"name",
      target_redacted:name,
      findings:parsed.findings,
      errors:[],
      checks_performed:["COURTLISTENER_RECAP_SEARCH"]
    };
  }catch(e:any){
    const message=String(e?.message??"COURTLISTENER_NETWORK_ERROR");
    if(/timeout/i.test(message)) return unavailable("COURTLISTENER_TIMEOUT",name);
    return unavailable(`COURTLISTENER_NETWORK_ERROR:${message.slice(0,180)}`,name);
  }
}
