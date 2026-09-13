import type {Lead} from "../../validation/schema.js";
import {leadEmail,leadPhone} from "./targets.js";
import {redactEmail,redactPhone} from "./redact.js";
import {OSINT_CLI_PROVIDERS,type OsintAdapterResult,type OsintLookupReport} from "./types.js";

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
  const court=adapterOf(report??undefined,"courtlistener");
  const registrations=holehe?.status==="OBSERVED"
    ?holehe.findings.filter(f=>f.kind==="EMAIL_SITE_REGISTRATION").length
    :undefined;
  const recon=mosint?.status==="OBSERVED"
    ?mosint.findings.filter(f=>f.kind==="EMAIL_RECON_SIGNAL").length
    :undefined;
  const breach=h8mail?.status==="OBSERVED"
    ?h8mail.findings.some(f=>f.kind==="LOCAL_BREACH_HIT")
    :undefined;
  const courtHits=court?.status==="OBSERVED"
    ?court.findings.filter(f=>f.kind==="COURT_DOCKET_HIT").length
    :undefined;
  const criminalDocket=court?.status==="OBSERVED"
    ?court.findings.some(f=>f.kind==="COURT_CRIMINAL_DOCKET_SIGNAL")
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
    holehe,phone,mosint,h8mail,court,
    registrations,recon,breach,courtHits,criminalDocket,
    lineType,country,mobile,voip,landline,us,invalid,highRiskPhone,burnerLexicon,
    holeheObserved:holehe?.status==="OBSERVED",
    phoneObserved:phone?.status==="OBSERVED",
    mosintObserved:mosint?.status==="OBSERVED",
    h8mailObserved:h8mail?.status==="OBSERVED",
    courtObserved:court?.status==="OBSERVED",
    courtUnavailable:!!court&&adapterDidNotFullyRun(court),
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

function identityCliAdapters(report?:OsintLookupReport|null){
  return (report?.adapters??[]).filter(a=>(OSINT_CLI_PROVIDERS as readonly string[]).includes(a.provider));
}

export function osintChecksIncomplete(report?:OsintLookupReport|null){
  if(!report||!report.enabled||!report.ran) return true;
  if(!report.adapters.length) return true;
  const cli=identityCliAdapters(report);
  const court=report.adapters.find(a=>a.provider==="courtlistener");
  if(cli.length){
    const incomplete=cli.filter(adapterDidNotFullyRun).length;
    return incomplete>cli.length/2;
  }
  if(court) return adapterDidNotFullyRun(court);
  return true;
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
    if((s.registrations??0)>0) flags.push("Email shows up on public sites — normal for a real Gmail");
    else flags.push("Email did not show up on public sites we checked");
  }
  if(s.phoneObserved){
    if(s.mobile&&s.us) flags.push("Phone looks like a US mobile");
    else if(s.mobile) flags.push("Phone looks like a mobile");
    else if(s.voip) flags.push("Phone looks like a VOIP / internet number");
    else if(s.landline) flags.push("Phone looks like a landline");
    else if(s.invalid) flags.push("Phone did not look valid — glance, not an accusation");
    else flags.push("Phone details look ordinary");
  }
  if(s.mosintObserved){
    if((s.recon??0)>0) flags.push("Email recon looks ordinary (no DNS dump in this note)");
    else flags.push("Email recon was sparse — glance, not an accusation");
  }
  if(s.h8mailObserved){
    flags.push(s.breach?"Email showed up in an old breach dataset (passwords not saved)":"No old-breach-dataset hit");
  }
  if(s.courtObserved){
    if(s.criminalDocket) flags.push("A public docket uses criminal-case wording — not a background check");
    else if((s.courtHits??0)>0) flags.push("Public court-docket hit(s) — not a background check");
    else flags.push("No public federal court hits — not a criminal check; absence is not clearance");
  }else if(s.courtUnavailable){
    flags.push("Court records check did not finish — missing check, not risk");
  }
  if(!flags.length) flags.push("Nothing extra to flag. Missing hits are not risk.");
  return flags;
}

function copyFor(level:StaffVerdictLevel){
  if(level==="GOOD") return{
    icon:"🟢",
    headline:"🟢 GOOD — looks fine to proceed",
    rule_of_thumb:"proceed with normal intake",
    staff_note:"Looks consistent and ordinary. Public-site hits are normal for a real Gmail. Proceed with normal intake curiosity."
  };
  if(level==="CAUTION") return{
    icon:"🟡",
    headline:"🟡 CAUTION — dig a little, not a fraud accusation",
    rule_of_thumb:"human glance before attorney send",
    staff_note:"Yellow means curiosity, not “you are a fraud.” Ask for missing fields. Human glance before attorney send."
  };
  if(level==="RED_FLAG") return{
    icon:"🔴",
    headline:"🔴 RED FLAG — hold / do not treat as clean",
    rule_of_thumb:"hold until a human clears this",
    staff_note:"Hold until a human clears this. Stacked patterns or an existing document/identity concern — public-record checks alone are not a fraud accusation."
  };
  return{
    icon:"⚪",
    headline:"⚪ INCOMPLETE — checks didn’t fully run",
    rule_of_thumb:"missing checks do not count as risk",
    staff_note:"Checks didn’t fully run. Missing, turned-off, or timed-out tools do not count as risk and are not a fail on the person."
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
    if(fraud.overall==="HIGH_RISK") reasons.push("A document/identity check already says hold — not a clean pass");
    for(const engine of fraud.high) reasons.push(`${prettyEngine(engine)} raised a real concern — hold until a human clears`);
  }
  if(fraud.stackedFraud){
    reasons.push("More than one document/identity check needs a human hold");
  }

  if(s.noCredibleFootprint&&(s.invalid||s.highRiskPhone||s.voip||s.burnerLexicon)){
    reasons.push("Thin public footprint plus a phone that does not look like a normal mobile");
  }
  if(s.noCredibleFootprint&&s.breach&&(s.voip||s.invalid||s.highRiskPhone)){
    reasons.push("Thin public footprint, old-breach-dataset hit, and a high-risk phone stacked together");
  }

  const stackedOsint=reasons.some(r=>/thin public footprint/i.test(r));
  if(s.criminalDocket&&(stackedOsint||fraud.highRisk||fraud.stackedFraud)){
    reasons.push("A public docket uses criminal-case wording plus other concerns — hold. This is not a background check.");
  }
  if(fraud.highRisk||fraud.stackedFraud||stackedOsint){
    const copy=copyFor("RED_FLAG");
    return {...copy,level:"RED_FLAG",reasons,observational_flags:flags,staff_note:copy.staff_note};
  }

  if(incomplete){
    if(!report) reasons.push("Public-record checks were not attached. Missing checks do not count as risk.");
    else if(!report.enabled) reasons.push("Public-record checks were turned off. Missing checks do not count as risk.");
    else if(!identityCliAdapters(report).length&&s.courtUnavailable){
      reasons.push("Court records check did not finish (token, rate limit, or outage). Missing check, not risk.");
    }else reasons.push("Most public-record checks did not finish. Missing checks do not count as risk.");
    const copy=copyFor("INCOMPLETE");
    return {...copy,level:"INCOMPLETE",reasons,observational_flags:flags,staff_note:copy.staff_note};
  }

  if(s.criminalDocket){
    reasons.push("A public docket uses criminal-case wording — dig a little. This is not a criminal background check.");
  }
  if((s.courtHits??0)>0&&!s.criminalDocket&&(s.breach||s.weakEmailFootprint||s.voip||fraud.review.length>0)){
    reasons.push("A public court-docket hit plus other ordinary signals — dig a little. Not a background check.");
  }
  if(s.breach) reasons.push("Email showed up in an old breach dataset — dig a little, not a fraud accusation. Passwords were not saved to HubSpot. Yellow, not red by itself.");
  if(s.weakEmailFootprint&&(s.voip||!s.mobile&&s.phoneObserved)){
    reasons.push("Thin email footprint plus a VOIP / non-mobile phone — dig a little, not a fraud accusation.");
  }
  if(s.weakEmailFootprint&&s.sparseRecon){
    reasons.push("Thin email footprint and sparse email recon — dig a little, not a fraud accusation.");
  }
  if(s.voip&&!s.weakEmailFootprint) reasons.push("Phone looks like a VOIP / internet number — dig a little, not a fraud accusation.");
  if(s.sparseRecon&&s.weakEmailFootprint===false&&(s.registrations??0)===0){
    reasons.push("Email recon was sparse — dig a little, not a fraud accusation.");
  }
  if(fraud.review.length===1&&!fraud.highRisk){
    reasons.push(`${prettyEngine(fraud.review[0]!)} needs a human look — dig a little, not a fraud accusation.`);
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
  const labels:Record<string,string>={
    DOCUMENT_AUTHENTICITY:"Document authenticity",
    DOCUMENT_TAMPERING:"Document tampering",
    IDENTITY:"Identity documents",
    SYNTHETIC_MEDIA:"Photo/video authenticity",
    CLAIM_CONSISTENCY:"Story vs documents",
    CROSS_DOCUMENT:"Documents match each other",
    EXTERNAL_VERIFICATION:"Outside confirmation"
  };
  return labels[name]??name.replaceAll("_"," ").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
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
