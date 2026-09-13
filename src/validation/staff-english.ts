import type {StaffVerdict,StaffVerdictLevel} from "../integrations/osint/verdict.js";
import type {FinalStatus} from "./schema.js";

const OSINT_FINDING=/^(OSINT_|HOLEHE_|PHONEINFOGA_|MOSINT_|H8MAIL_|COURTLISTENER_|IDENTITY_OSINT)/i;
const OSINT_KIND=/EMAIL_RECON_SIGNAL|EMAIL_SITE_REGISTRATION|PHONE_METADATA|LOCAL_BREACH|COURT_DOCKET|COURT_CRIMINAL|COURT_NO_CRIMINAL/i;

const ENGINE_LABEL:Record<string,string>={
  DOCUMENT_AUTHENTICITY:"Document authenticity",
  DOCUMENT_TAMPERING:"Document tampering",
  IDENTITY:"Identity documents",
  SYNTHETIC_MEDIA:"Photo/video authenticity",
  CLAIM_CONSISTENCY:"Story vs documents",
  CROSS_DOCUMENT:"Documents match each other",
  EXTERNAL_VERIFICATION:"Outside confirmation"
};

const VERDICT_LABEL:Record<string,string>={
  PASS:"looks clean",
  PASS_WITH_WARNINGS:"looks mostly clean — glance at the notes",
  MANUAL_REVIEW:"needs a human look",
  HIGH_RISK:"hold — a real concern came up",
  UNABLE_TO_VALIDATE:"could not finish this check (not a fail on the person)",
  VALIDATED:"confirmed from observed evidence",
  DOCUMENT_CORROBORATED:"supported by a document we have — not yet an official-record pull",
  UNKNOWN:"not confirmed yet",
  UNDETERMINED:"not established yet",
  MATCHED:"matched what we have",
  NOT_APPLICABLE:"not applicable",
  NOT_REQUESTED:"not requested",
  SUPPORTS_NOT_AT_FAULT:"documents support the client was not primarily at fault",
  SUPPORTS_CLIENT_FAULT:"documents look like the client was primarily at fault",
  COMPARATIVE_FAULT_INDICATORS:"documents show shared-fault hints"
};

const REASON_LABEL:Record<string,string>={
  MISSING_INFORMATION:"still missing intake details. Expected at this stage, not a fail on the person",
  FAULT_NOT_ESTABLISHED:"we do not yet have evidence of who was at fault. Expected until a police report is in, not a fail on the person",
  NOT_CORROBORATED:"we have not confirmed the crash in an official record yet. Not a fail on the person",
  RECORD_PENDING:"the official record may still be pending. Not a fail on the person",
  AUTHORIZATION_REQUIRED:"we need authorization to pull a restricted record. Not a fail on the person",
  INSUFFICIENT_EVIDENCE:"we do not have enough observed evidence yet. Not a fail on the person",
  MANUAL_REVIEW_REQUIRED:"a human should look before this is treated as clean",
  FAULT_EVIDENCE_CONFLICT:"documents conflict with the intake fault story — human review",
  EXISTING_REPRESENTATION:"intake says they already have an attorney",
  CLIENT_STATES_PRIMARY_FAULT:"intake says the client was primarily at fault",
  SOURCE_UNAVAILABLE:"a source check could not finish. Missing check, not a fail on the person"
};

const ACTION_LABEL:Record<string,string>={
  REQUEST_MISSING_INTAKE_FIELDS:"Ask for the missing intake fields",
  REQUEST_FAULT_SUPPORTING_POLICE_REPORT:"Ask for a police report that speaks to who was at fault",
  REQUEST_POLICE_REPORT_OR_AUTHORIZED_RECORD:"Ask for a police report or authorization to pull the official record",
  REQUEST_CLIENT_REPORT_OR_AUTHORIZATION:"Ask the client for a report copy or authorization",
  RETRY_AFTER_INDEXING_WINDOW:"Wait for the official record to be indexed, then retry",
  REQUEST_INCIDENT_REPORT_OR_OTHER_OCCURRENCE_EVIDENCE:"Ask for an incident report or other proof the event happened",
  VERIFY_PREMISES_ENTITY:"Confirm the business / premises exists",
  MANUAL_REVIEW:"Human review before proceeding",
  RETRY_OR_MANUAL_REVIEW:"Retry the check, or have a human look",
  NONE:"None"
};

const CLAIM_LABEL:Record<string,string>={
  INCIDENT_EXISTS:"Incident exists in an observed source",
  INCIDENT_IDENTIFIER_MATCH:"Police report number matches intake",
  IDENTITY_MATCH:"Client name matches a submitted document",
  SUPPORTS_NOT_AT_FAULT:"Documents support the client was not primarily at fault",
  SUPPORTS_CLIENT_FAULT:"Documents support client-primary-fault indicators",
  COMPARATIVE_FAULT_INDICATORS:"Documents show shared-fault hints",
  BUSINESS_EXISTS:"Business / premises was matched",
  PROVIDER_EXISTS:"Medical provider was matched",
  PROVIDER_LICENSE_ACTIVE:"Provider license looks active",
  LITIGATION_MATCH:"Litigation match observed",
  DOCUMENT_PRESENT:"A client document was submitted",
  OFFICIAL_SOURCE_SCREENSHOT_OBSERVED:"An official-source screenshot was captured"
};

const FINDING_LABEL:Record<string,string>={
  BARCODE_VISIBLE_DATA_MISMATCH:"printed ID and barcode data do not match",
  ISSUER_JURISDICTION_CONTRADICTION:"ID issuer state does not match the printed state",
  INVALID_CREDENTIAL_SIGNATURE:"ID digital signature did not check out",
  FORM_VERSION_TEMPORAL_ANOMALY:"form version does not match the date on the document",
  STATE_FORM_MISMATCH:"form looks like it belongs to a different state",
  SENSITIVE_FIELD_OVERLAY:"a sensitive field looks pasted / overlaid",
  INVALID_DIGITAL_SIGNATURE:"a digital signature is reported invalid",
  MATERIAL_IMAGE_MANIPULATION_SIGNAL:"photo-edit signals showed up on a document image",
  HIGH_SYNTHETIC_MEDIA_RISK:"a photo/video tool reported high synthetic-media risk",
  SYNTHETIC_MEDIA_SUSPECTED:"a photo/video tool reported suspicious indicators",
  INVALID_C2PA_PROVENANCE:"content credentials are present but invalid",
  CLIENT_NAME_NOT_OBSERVED:"client name was not seen in the document text (OCR or nicknames can explain this)",
  INCIDENT_DATE_NOT_OBSERVED:"incident date was not seen verbatim in the document text",
  REPORT_NUMBER_CONTRADICTION:"different police report numbers appear across documents",
  VIN_CONTRADICTION:"different VINs appear across documents",
  LICENSE_PLATE_CONTRADICTION:"different plates appear across documents",
  UNRELATED_CASE_REUSE:"a document fingerprint looks reused from an unrelated case",
  AUTHORITATIVE_CONTRADICTION:"an official source contradicts a submitted fact"
};

const SKIP_DIMENSION=new Set([
  "identity_osint","osint_identity","IDENTITY_OSINT_LOOKUP",
  "fraud_assurance_level","fraud_risk_score"
]);

function isPlain(v:unknown):v is Record<string,unknown>{
  return !!v&&typeof v==="object"&&!Array.isArray(v);
}

export function staffEngineName(name:string){
  return ENGINE_LABEL[name]??name.replaceAll("_"," ").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
}

export function staffVerdictWord(value:unknown){
  const raw=String(value??"").trim();
  if(!raw) return "not confirmed yet";
  return VERDICT_LABEL[raw]??raw.replaceAll("_"," ").toLowerCase();
}

export function staffReason(reason?:string){
  if(!reason) return "";
  return REASON_LABEL[reason]??reason.replaceAll("_"," ").toLowerCase();
}

export function staffNextAction(action?:string){
  if(!action) return "";
  return ACTION_LABEL[action]??action.replaceAll("_"," ").toLowerCase();
}

export function staffClaim(claim:string){
  return CLAIM_LABEL[claim]??claim.replaceAll("_"," ").toLowerCase();
}

export function staffMissingItem(item:string){
  const t=item.trim();
  if(/incident\.date/i.test(t)) return "Incident date";
  if(/report_number|case_number|incident\.agency|incident\.location/i.test(t)){
    return "Police report #, agency, or location — expected at intake, not a fail on the person";
  }
  if(/primary_fault|not_at_fault/i.test(t)) return "Whether the client says they were at fault";
  if(/already_represented/i.test(t)) return "Whether they already have an attorney";
  if(/qualification\.injured/i.test(t)) return "Whether they were injured";
  if(/business_name|business_address|premises/i.test(t)) return "Business / premises name or address";
  if(/police report|fault evidence|official report/i.test(t)){
    return `${t.replace(/\.$/,"")} — expected at intake, not a fail on the person`;
  }
  if(/^[a-z]+\.[a-z_]+/i.test(t)&&!/\s/.test(t)) return t.replaceAll("."," / ").replaceAll("_"," ");
  return t;
}

export function isOsintFinding(v:unknown){
  if(!isPlain(v)) return false;
  const kind=String(v.finding_type??v.kind??"");
  const obs=String(v.observation??"");
  const engine=String(v.engine??"");
  if(OSINT_FINDING.test(kind)) return true;
  if(OSINT_KIND.test(kind)||OSINT_KIND.test(obs)) return true;
  if(engine==="IDENTITY"&&/osint|holehe|mosint|h8mail|phoneinfoga|courtlistener/i.test(`${kind} ${obs}`)) return true;
  return false;
}

export function skipStaffDimensionKey(key:string){
  return SKIP_DIMENSION.has(key);
}

export function staffFindingLine(v:unknown){
  if(!isPlain(v)) return "";
  if(isOsintFinding(v)) return "";
  const result=String(v.result??v.verdict??"").toUpperCase();
  if(result==="UNKNOWN"||result==="NOT_APPLICABLE"||result==="PASS") return "";
  const kind=String(v.finding_type??"");
  const observation=typeof v.observation==="string"?v.observation.trim():"";
  const engine=typeof v.engine==="string"?staffEngineName(v.engine):"";
  const label=FINDING_LABEL[kind]??(observation||"");
  if(!label) return "";
  const tone=result==="FAIL"||result==="HIGH_RISK"?"hold":"glance";
  if(engine) return `${engine}: ${label} (${tone})`;
  return `${label} (${tone})`;
}

export function staffEngineLine(name:string,verdict:unknown){
  return `  • ${staffEngineName(name)}: ${staffVerdictWord(verdict)}`;
}

export function staffFraudOverall(value:unknown){
  return `• Overall fraud check: ${staffVerdictWord(value)}`;
}

export function staffQualificationStatus(status:FinalStatus,reason?:string){
  const extra=staffReason(reason);
  if(status==="VALIDATED") return `Status: *VALIDATED*${extra?` — ${extra}`:" — intake rules and observed evidence support proceeding."}`;
  if(status==="CONTRADICTED") return `Status: *CONTRADICTED*${extra?` — ${extra}`:" — something conflicts with intake rules or documents. Human review."}`;
  return `Status: *INCOMPLETE*${extra?` — ${extra}`:" — still missing details. Expected at intake, not a fail on the person."}`;
}

export function staffActionLines(input:{
  verdict:StaffVerdict;
  status:FinalStatus;
  missing:string[];
}):string[]{
  const actions:string[]=["Normal intake curiosity"];
  if(input.missing.length) actions.push("Ask for the missing fields listed above");
  if(input.missing.some(m=>/report|agency|location|fault/i.test(m))){
    actions.push("Missing police report # / agency / location is expected at intake, not a fail on the person");
  }
  if(input.verdict.level==="CAUTION"){
    actions.push("Human glance before attorney send (yellow — dig a little, not a fraud accusation)");
  }else if(input.verdict.level==="RED_FLAG"){
    actions.push("Hold. Do not treat as clean. Human review before attorney send.");
  }else if(input.verdict.level==="INCOMPLETE"){
    actions.push("Missing public-record checks do not count as risk");
  }else if(input.verdict.level==="GOOD"&&input.status==="INCOMPLETE"){
    actions.push("Public-record checks look ordinary. Still ask for missing intake fields before attorney send.");
  }
  return["👀 *Staff actions*",...[...new Set(actions)].map(a=>`• ${a}`)];
}

export function staffObservationalFlag(flag:string){
  const map:Record<string,string>={
    "Public registrations observed (expected)":"Email shows up on public sites — normal for a real Gmail",
    "Weak email footprint (no public registrations)":"Email did not show up on public sites we checked",
    "US mobile":"Phone looks like a US mobile",
    "Mobile line":"Phone looks like a mobile",
    "VOIP / non-mobile line":"Phone looks like a VOIP / internet number",
    "Landline / non-mobile":"Phone looks like a landline",
    "Invalid or high-risk phone signal":"Phone did not look valid — glance, not an accusation",
    "Phone metadata observed":"Phone details look ordinary",
    "Email recon signals observed":"Email recon looks ordinary (no DNS dump in this note)",
    "Sparse email recon":"Email recon was sparse — glance, not an accusation",
    "Local breach hit (secrets redacted)":"Email showed up in an old breach dataset (passwords not saved)",
    "No local breach hit":"No old-breach-dataset hit",
    "Public court docket with an explicit criminal label (not a background check)":"A public docket uses criminal-case wording — not a background check",
    "Public court-docket hit(s) observed (not a background check)":"Public court-docket hit(s) — not a background check",
    "No public CourtListener docket hits — absence is not clearance":"No public federal court hits — not a criminal check; absence is not clearance",
    "CourtListener unavailable — missing check, not risk":"Court records check did not finish — missing check, not risk",
    "OSINT did not run — missing checks do NOT count as risk":"Public-record checks did not run — missing checks do not count as risk",
    "No observational flags. Missing hits are UNKNOWN, not risk.":"Nothing extra to flag. Missing hits are not risk."
  };
  return map[flag]??flag;
}

export function cautionReason(level:StaffVerdictLevel,reason:string){
  if(/local breach hit/i.test(reason)){
    return "Email showed up in an old breach dataset — dig a little, not a fraud accusation. Passwords were not saved to HubSpot. Yellow, not red by itself.";
  }
  if(/HIGH_RISK/i.test(reason)){
    return reason
      .replace(/Existing fraud dimension is HIGH_RISK[^.]*\.?/i,"A document/identity check already says hold — not a clean pass.")
      .replace(/Fraud engine\s+(.+?)\s+is HIGH_RISK/i,(_,name)=>`${name} raised a real concern — hold until a human clears.`);
  }
  if(/manual review/i.test(reason)){
    return reason.replace(/Fraud engine\s+(.+?)\s+asked for manual review[^.]*\.?/i,(_,name)=>`${name} needs a human look — dig a little, not a fraud accusation.`);
  }
  if(/voip/i.test(reason)) return "Phone looks like a VOIP / internet number — dig a little, not a fraud accusation.";
  if(/weak email footprint/i.test(reason)) return "Email has a thin public footprint — dig a little, not a fraud accusation.";
  if(/disabled/i.test(reason)) return "Public-record checks were turned off. Missing checks do not count as risk.";
  if(/unavailable|timed out/i.test(reason)) return "Most public-record checks did not finish. Missing checks do not count as risk.";
  if(/not attached/i.test(reason)) return "Public-record checks were not attached. Missing checks do not count as risk.";
  return reason;
}
