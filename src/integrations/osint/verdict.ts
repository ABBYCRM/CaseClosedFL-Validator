import type {Lead} from "../../validation/schema.js";
import {leadEmail,leadPhone} from "./targets.js";
import {redactEmail,redactPhone} from "./redact.js";
import type {OsintAdapterResult,OsintLookupReport} from "./types.js";

export type StaffVerdictLevel="GOOD"|"CAUTION"|"RED_FLAG"|"INCOMPLETE";

export interface StaffContact{
  name?:string;
  email_redacted?:string;
  phone_redacted?:string;
}

export interface StaffVerdict{
  level:StaffVerdictLevel;
  icon:string;
  headline:string;
  rule_of_thumb:string;
  reasons:string[];
  observational_flags:string[];
  staff_note:string;
}

export interface StaffVerdictInput{
  osint?:OsintLookupReport|null;
  contact?:StaffContact;
  dimensions?:Record<string,unknown>;
}

export function staffContactFromFields(input:{
  first_name?:string;
  last_name?:string;
  email?:string;
  phone?:string;
}={}):StaffContact{
  const name=[input.first_name,input.last_name].map(v=>String(v??"").trim()).filter(Boolean).join(" ");
  return{
    name:name||undefined,
    email_redacted:input.email?redactEmail(input.email):undefined,
    phone_redacted:input.phone?redactPhone(input.phone):undefined
  };
}

export function staffContactFromLead(lead:Lead):StaffContact{
  return staffContactFromFields({
    first_name:lead.client.first_name,
    last_name:lead.client.last_name,
    email:leadEmail(lead),
    phone:leadPhone(lead)
  });
}

function adapterOf(report:OsintLookupReport|undefined|null,provider:OsintAdapterResult["provider"]){
  return report?.adapters.find(a=>a.provider===provider);
}

function findingText(adapter:OsintAdapterResult|undefined){
  return (adapter?.findings??[]).map(f=>`${f.signal??""} ${f.observation}`.toLowerCase()).join("\n");
}

function metaValue(adapter:OsintAdapterResult|undefined,keys:string[]){
  for(const finding of adapter?.findings??[]){
    const signal=String(finding.signal??"").toLowerCase().replace(/\s+/g,"_");
    if(keys.includes(signal)){
      const fromObs=finding.observation.match(/=(.+?)\.?$/)?.[1];
      return String(fromObs??finding.observation).trim();
    }
    const labeled=finding.observation.match(/observed\s+([a-z0-9_]+)=(.+?)\.?$/i);
    if(labeled&&keys.includes(labeled[1]!.toLowerCase())) return labeled[2]!.trim();
  }
  return undefined;
}

function isTrue(value?:string){
  return /^(true|yes|1)$/i.test(String(value??"").trim());
}

function isFalse(value?:string){
  return /^(false|no|0)$/i.test(String(value??"").trim());
}

export function osintSignals(report?:OsintLookupReport|null){
  const holehe=adapterOf(report??undefined,"holehe");
  const phone=adapterOf(report??undefined,"phoneinfoga");
  const mosint=adapterOf(report??undefined,"mosint");
  const h8mail=adapterOf(report??undefined,"h8mail");
  const registrations=holehe?.status==="OBSERVED"
    ?holehe.findings.filter(f=>f.kind==="EMAIL_SITE_REGISTRATION").length
    :undefined;
  const recon=mosint?.status==="OBSERVED"
    ?mosint.findings.filter(f=>f.kind==="EMAIL_RECON_SIGNAL").length
    :undefined;
  const breach=h8mail?.status==="OBSERVED"
    ?h8mail.findings.some(f=>f.kind==="LOCAL_BREACH_HIT")
    :undefined;
  const lineType=metaValue(phone,["line_type","linetype","line"]);
  const country=metaValue(phone,["country","country_code","countrycode"]);
  const validRaw=metaValue(phone,["valid"]);
  const phoneText=findingText(phone);
  const mosintText=findingText(mosint);
  const mobile=/mobile|cell|wireless/i.test(`${lineType??""} ${phoneText}`);
  const voip=/voip|virtual|toll[-\s]?free|premium|not[-\s]?mobile/i.test(`${lineType??""} ${phoneText}`);
  const landline=/landline|fixed|wireline/i.test(`${lineType??""} ${phoneText}`);
  const us=/united states|^us$|usa|\+?1\b/i.test(String(country??""));
  const invalid=isFalse(validRaw)||/\binvalid\b/i.test(phoneText);
  const highRiskPhone=invalid||voip||(!mobile&&!!lineType&&!/unknown/i.test(lineType));
  const burnerLexicon=/disposable|temp(?:orary)?\s*mail|burner|guerrilla/i.test(mosintText);
  return{
    holehe,phone,mosint,h8mail,
    registrations,recon,breach,
    lineType,country,mobile,voip,landline,us,invalid,highRiskPhone,burnerLexicon,
    holeheObserved:holehe?.status==="OBSERVED",
    phoneObserved:phone?.status==="OBSERVED",
    mosintObserved:mosint?.status==="OBSERVED",
    h8mailObserved:h8mail?.status==="OBSERVED",
    weakEmailFootprint:holehe?.status==="OBSERVED"&&(registrations??0)===0,
    sparseRecon:mosint?.status==="OBSERVED"&&(recon??0)===0,
    noCredibleFootprint:
      holehe?.status==="OBSERVED"&&mosint?.status==="OBSERVED"
      &&(registrations??0)===0&&(recon??0)===0
  };
}

function adapterDidNotFullyRun(adapter:OsintAdapterResult){
  if(adapter.status==="UNAVAILABLE"||adapter.status==="ERROR"||adapter.status==="DISABLED") return true;
  if(adapter.status==="SKIPPED") return true;
  const blob=`${adapter.unavailable_reason??""} ${adapter.errors.join(" ")}`;
  return /timeout|unavailable|not_found|bin_not_found/i.test(blob);
}

export function osintChecksIncomplete(report?:OsintLookupReport|null){
  if(!report||!report.enabled||!report.ran) return true;
  if(!report.adapters.length) return true;
  const incomplete=report.adapters.filter(adapterDidNotFullyRun).length;
  return incomplete>report.adapters.length/2;
}

function materialFraudSignals(dimensions?:Record<string,unknown>){
  const overall=typeof dimensions?.fraud_overall==="string"?dimensions.fraud_overall:"";
  const engines=isPlain(dimensions?.fraud_parallel_engines)?dimensions!.fraud_parallel_engines as Record<string,unknown>:[];
  const rows=Array.isArray(engines)?[]:Object.entries(engines);
  const high=rows.filter(([,v])=>isPlain(v)&&String(v.verdict)==="HIGH_RISK").map(([name])=>name);
  const review=rows.filter(([,v])=>isPlain(v)&&String(v.verdict)==="MANUAL_REVIEW").map(([name])=>name);
  return{
    overall,
    high,
    review,
    highRisk:overall==="HIGH_RISK"||high.length>0,
    stackedFraud:high.length>=2||(high.length>=1&&review.length>=1)||review.length>=2
  };
}

function isPlain(v:unknown):v is Record<string,unknown>{
  return !!v&&typeof v==="object"&&!Array.isArray(v);
}

export function observationalFlags(report?:OsintLookupReport|null){
  const s=osintSignals(report);
  const flags:string[]=[];
  if(!report||!report.enabled) {
    flags.push("OSINT did not run — missing checks do NOT count as risk");
    return flags;
  }
  if(s.holeheObserved){
    if((s.registrations??0)>0) flags.push("Public registrations observed (expected)");
    else flags.push("Weak email footprint (no public registrations)");
  }
  if(s.phoneObserved){
    if(s.mobile&&s.us) flags.push("US mobile");
    else if(s.mobile) flags.push("Mobile line");
    else if(s.voip) flags.push("VOIP / non-mobile line");
    else if(s.landline) flags.push("Landline / non-mobile");
    else if(s.invalid) flags.push("Invalid or high-risk phone signal");
    else flags.push("Phone metadata observed");
  }
  if(s.mosintObserved){
    if((s.recon??0)>0) flags.push("Email recon signals observed");
    else flags.push("Sparse email recon");
  }
  if(s.h8mailObserved){
    flags.push(s.breach?"Local breach hit (secrets redacted)":"No local breach hit");
  }
  if(!flags.length) flags.push("No observational flags. Missing hits are UNKNOWN, not risk.");
  return flags;
}

function copyFor(level:StaffVerdictLevel){
  if(level==="GOOD") return{
    icon:"🟢",
    headline:"🟢 GOOD — looks fine to proceed",
    rule_of_thumb:"proceed with normal intake",
    staff_note:"Signals look consistent and normal. Public registrations are expected. Proceed with normal intake."
  };
  if(level==="CAUTION") return{
    icon:"🟡",
    headline:"🟡 CAUTION — review before sending out",
    rule_of_thumb:"dig first before attorney send / billable",
    staff_note:"Dig first before attorney send / billable. Observational OSINT is not a fraud accusation."
  };
  if(level==="RED_FLAG") return{
    icon:"🔴",
    headline:"🔴 RED FLAG — hold / do not treat as clean",
    rule_of_thumb:"hold until human clears",
    staff_note:"Hold until a human clears this. Stacked patterns or existing fraud-rule signals — observational OSINT alone is not a fraud accusation."
  };
  return{
    icon:"⚪",
    headline:"⚪ INCOMPLETE — checks didn’t fully run",
    rule_of_thumb:"missing checks do NOT count as risk",
    staff_note:"Checks didn’t fully run. Missing, disabled, or timed-out tools do NOT count as risk."
  };
}

export function scoreStaffVerdict(input:StaffVerdictInput={}):StaffVerdict{
  const report=input.osint;
  const fraud=materialFraudSignals(input.dimensions);
  const s=osintSignals(report);
  const incomplete=osintChecksIncomplete(report);
  const flags=observationalFlags(report);
  const reasons:string[]=[];

  if(fraud.highRisk){
    if(fraud.overall==="HIGH_RISK") reasons.push("Existing fraud dimension is HIGH_RISK — hold until human clears");
    for(const engine of fraud.high) reasons.push(`Fraud engine ${prettyEngine(engine)} is HIGH_RISK`);
  }
  if(fraud.stackedFraud){
    reasons.push("Multiple fraud-rule signals require a human hold");
  }

  if(s.noCredibleFootprint&&(s.invalid||s.highRiskPhone||s.voip||s.burnerLexicon)){
    reasons.push("Burner-style / no credible footprint plus invalid or high-risk phone");
  }
  if(s.noCredibleFootprint&&s.breach&&(s.voip||s.invalid||s.highRiskPhone)){
    reasons.push("No credible footprint, local breach hit, and high-risk phone stacked");
  }

  const stackedOsint=reasons.some(r=>/burner-style|no credible footprint, local breach/i.test(r));
  if(fraud.highRisk||fraud.stackedFraud||stackedOsint){
    const copy=copyFor("RED_FLAG");
    return {...copy,level:"RED_FLAG",reasons,observational_flags:flags,staff_note:copy.staff_note};
  }

  if(incomplete){
    if(!report) reasons.push("OSINT report was not attached");
    else if(!report.enabled) reasons.push("OSINT identity lookups were disabled");
    else reasons.push("Majority of OSINT adapters were unavailable, skipped, or timed out");
    const copy=copyFor("INCOMPLETE");
    return {...copy,level:"INCOMPLETE",reasons,observational_flags:flags,staff_note:copy.staff_note};
  }

  if(s.breach) reasons.push("Local breach hit — dig first");
  if(s.weakEmailFootprint&&(s.voip||!s.mobile&&s.phoneObserved)){
    reasons.push("Weak email footprint plus VOIP / non-mobile line");
  }
  if(s.weakEmailFootprint&&s.sparseRecon){
    reasons.push("Weak email footprint and sparse recon");
  }
  if(s.voip&&!s.weakEmailFootprint) reasons.push("VOIP / non-mobile line");
  if(s.sparseRecon&&s.weakEmailFootprint===false&&(s.registrations??0)===0){
    reasons.push("Sparse recon");
  }
  if(fraud.review.length===1&&!fraud.highRisk){
    reasons.push(`Fraud engine ${prettyEngine(fraud.review[0]!)} asked for manual review — dig first`);
  }

  if(reasons.length){
    const copy=copyFor("CAUTION");
    return {...copy,level:"CAUTION",reasons,observational_flags:flags,staff_note:copy.staff_note};
  }

  if((s.registrations??0)>0||s.mobile||s.us) {
    /* consistent/normal path */
  }
  const copy=copyFor("GOOD");
  return {...copy,level:"GOOD",reasons:[],observational_flags:flags,staff_note:copy.staff_note};
}

function prettyEngine(name:string){
  return name.replaceAll("_"," ").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
}

export function formatStaffVerdictLines(verdict:StaffVerdict):string[]{
  return[
    `🚦 *VERDICT: ${verdict.headline}*`,
    `• Rule of thumb: ${verdict.rule_of_thumb}`
  ];
}

export function formatContactLines(contact?:StaffContact,osint?:OsintLookupReport|null):string[]{
  const email=contact?.email_redacted??osint?.email_redacted??"not supplied";
  const phone=contact?.phone_redacted??osint?.phone_redacted??"not supplied";
  const name=contact?.name?.trim()||"not supplied";
  return[
    "👤 *Contact*",
    `• Name: ${name}`,
    `• Email: ${email}`,
    `• Phone: ${phone}`
  ];
}
