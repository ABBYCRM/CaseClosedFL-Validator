import crypto from "node:crypto";
import { env } from "../config/env.js";
import { toHubSpotNoteHtml } from "../integrations/hubspot/notes.js";
import { formatOsintFactLines, isOsintDimensionKey } from "../integrations/osint/note.js";
import { formatContactLines, type StaffVerdict } from "../integrations/osint/verdict.js";
import { finalVerdict, fraudValueForVerdict, markEnginesNotRun, VERDICT_HEADLINE, type FinalVerdict, type LeadQuality } from "./lead-quality.js";
import type { OsintLookupReport } from "../integrations/osint/types.js";
import type { StaffContact } from "../integrations/osint/verdict.js";
import type { FinalStatus, IncompleteReason } from "./schema.js";
import {
  staffActionLines,
  staffClaim,
  staffEngineLine,
  staffFindingLine,
  staffFraudOverall,
  staffMissingItem,
  staffNextAction,
  staffQualificationStatus,
  staffVerdictWord,
  skipStaffDimensionKey,
  isOsintFinding
} from "./staff-english.js";

export interface OutcomeInput{
  status:FinalStatus; reason?:IncompleteReason|string; missing:string[]; evidence:any[];
  dimensions:Record<string,unknown>; contradictions?:string[]; nextAction?:string;
  contact?:StaffContact;
  quality?:LeadQuality;
}

function statusIcon(status:FinalStatus){
  if(status==="VALIDATED") return "✅";
  if(status==="CONTRADICTED") return "⛔";
  return "⚠️";
}
function isPlainObject(v:unknown):v is Record<string,unknown>{
  return !!v && typeof v==="object" && !Array.isArray(v);
}

function dimensionLabel(key:string){
  const labels:Record<string,string>={
    incident:"Incident",
    identity:"Client name on documents",
    fault:"Fault",
    business:"Business / premises",
    provider:"Medical provider",
    intake_rule:"Intake rule",
    fraud_overall:"Overall fraud check",
    fraud_parallel_engines:"Fraud checks",
    fraud_findings:"Document / identity concerns",
    fraud:"Fraud checks"
  };
  return labels[key]??key.replaceAll("_"," ").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
}

export function formatDimensionLines(key:string,value:unknown):string[]{
  if(value===undefined||isOsintDimensionKey(key)||skipStaffDimensionKey(key)) return [];
  const label=dimensionLabel(key);
  if(key==="fraud_overall") return [staffFraudOverall(value)];
  if(Array.isArray(value)){
    const children=value.map(staffFindingLine).filter(Boolean).slice(0,12);
    if(!children.length) return [];
    return [`• ${label}:`,...children.map(line=>`  • ${line}`)];
  }
  if(isPlainObject(value)){
    if(Array.isArray(value.verdicts)){
      const header=`• ${label}: ${staffVerdictWord(isPlainObject(value.aggregate)?value.aggregate.verdict:value.aggregate)}`;
      const engines=value.verdicts.flatMap((row:unknown)=>isPlainObject(row)&&typeof row.engine==="string"?[staffEngineLine(row.engine,row.verdict)]:[]);
      return [header,...engines];
    }
    const entries=Object.entries(value).filter(([k,v])=>v!==undefined&&k!=="assurance_level"&&k!=="risk_score"&&k!=="summary");
    if(!entries.length) return [];
    const engineLike=entries.every(([,v])=>isPlainObject(v)&&(v.verdict!==undefined||v.result!==undefined));
    if(engineLike){
      return [`• ${label}:`,...entries.map(([name,v])=>staffEngineLine(name,isPlainObject(v)?v.verdict??v.result:v))];
    }
    const nested:string[]=[`• ${label}:`];
    for(const [name,v] of entries){
      if(Array.isArray(v)){
        const children=v.map(staffFindingLine).filter(Boolean).slice(0,8);
        if(children.length) nested.push(...children.map(line=>`  • ${line}`));
        continue;
      }
      if(isPlainObject(v)){
        if(isOsintFinding(v)) continue;
        const line=staffFindingLine(v);
        if(line) nested.push(`  • ${line}`);
        continue;
      }
      if(typeof v==="string"&&/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(v)) {
        nested.push(`  • ${dimensionLabel(name)}: ${staffVerdictWord(v)}`);
        continue;
      }
      nested.push(`  • ${dimensionLabel(name)}: ${staffVerdictWord(v)}`);
    }
    return nested.length>1?nested:[];
  }
  return [`• ${label}: ${staffVerdictWord(value)}`];
}
function osintFromDimensions(dimensions:Record<string,unknown>){
  return (dimensions.identity_osint??dimensions.osint_identity??dimensions.IDENTITY_OSINT_LOOKUP) as OsintLookupReport|undefined;
}

function legacyStaffVerdict(v:FinalVerdict):StaffVerdict{
  const level=v.verdict==="GOOD"?"GOOD":v.verdict==="JUNK"?"RED_FLAG":"CAUTION";
  return {level,icon:VERDICT_HEADLINE[v.verdict].slice(0,2),headline:VERDICT_HEADLINE[v.verdict],rule_of_thumb:RULE_OF_THUMB[v.verdict],reasons:v.reasons,observational_flags:[],staff_note:""};
}
const RULE_OF_THUMB:Record<FinalVerdict["verdict"],string>={
  GOOD:"clean and complete — proceed with normal intake",
  NEEDS_REVIEW:"a human looks before follow-up",
  JUNK:"do not work or bill this lead"
};

function humanNote(i:OutcomeInput, verified:string[], fv:FinalVerdict){
  const osint=osintFromDimensions(i.dimensions);
  const lines:string[]=[
    `🚦 *VERDICT: ${VERDICT_HEADLINE[fv.verdict]}* — ${RULE_OF_THUMB[fv.verdict]}`,
    ...fv.reasons.slice(0,8).map(r=>`• ${r}`),
    "",
    ...formatContactLines(i.contact,osint),
    "",
    ...formatOsintFactLines(osint),
    ""
  ];

  lines.push(`${statusIcon(i.status)} *CaseClosedFL Validation*`);
  lines.push(staffQualificationStatus(i.status,i.reason));
  lines.push("");

  const dimensionEntries=Object.entries(i.dimensions).filter(([k,v])=>v!==undefined&&!isOsintDimensionKey(k)&&!skipStaffDimensionKey(k));
  if(dimensionEntries.length){
    lines.push("📋 *Checks*");
    for(const [k,v] of dimensionEntries) lines.push(...formatDimensionLines(k,v));
    lines.push("");
  }

  if(verified.length){
    lines.push("✅ *Verified / supported*");
    for(const item of verified.slice(0,8)) lines.push(`• ${staffClaim(item)}`);
    lines.push("");
  }

  if(i.missing.length){
    lines.push("❓ *Still needed*");
    for(const item of i.missing.slice(0,8)) lines.push(`• ${staffMissingItem(item)}`);
    lines.push("");
  }

  if(i.contradictions?.length){
    lines.push("🚩 *Conflict / review*");
    for(const item of i.contradictions.slice(0,6)) lines.push(`• ${item}`);
    lines.push("");
  }

  if(i.nextAction){
    lines.push(`➡️ *Next step:* ${staffNextAction(i.nextAction)}`);
    lines.push("");
  }

  if(fv.verdict==="JUNK") lines.push("👀 *Staff actions*","• Junk — do not work, route, or bill this lead");
  else lines.push(...staffActionLines({verdict:legacyStaffVerdict(fv),status:i.status,missing:i.missing}));
  lines.push("");

  lines.push("_Only observed evidence is treated as verified. Missing or not-found information is not treated as proof of falsity._");
  return lines.join("\n").trim();
}

export function buildOutcome(input:OutcomeInput){
  const i=applyVerdict(input);
  const fv=i.fv;
  const verified=[...new Set(i.evidence.filter(e=>e.epistemic_state==="KNOWN"||e.epistemic_state==="INFERRED").map(e=>e.claim))] as string[];
  const note=humanNote(i,verified,fv);
  const body={
    status:i.status, reason:i.reason??null, dimensions:i.dimensions, missing:i.missing,
    contradictions:i.contradictions??[], next_action:i.nextAction??null,
    evidence:i.evidence,
    verdict:fv.verdict,
    verdict_reasons:fv.reasons,
    verdict_codes:fv.codes,
    staff_verdict:{
      verdict:fv.verdict,
      level:legacyStaffVerdict(fv).level,
      headline:VERDICT_HEADLINE[fv.verdict],
      rule_of_thumb:RULE_OF_THUMB[fv.verdict],
      reasons:fv.reasons
    },
    human_note:note,
    hubspot_note:toHubSpotNoteHtml(note),
    agent_note:{
      type:"VALIDATION_NOTE",
      format:"WHATSAPP_STYLE_TEXT",
      summary:summary(i.status,i.reason),
      text:note,
      verified,
      unverified:i.missing,
      recommended_next_evidence:i.missing
    },
    engine_version:env.ENGINE_VERSION,knowledge_version:env.KNOWLEDGE_VERSION
  };
  const result_hash=crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return {...body,result_hash};
}
function summary(status:FinalStatus,reason?:string){
  if(status==="VALIDATED") return "Lead met the configured CaseClosedFL validation threshold using observed evidence and deterministic intake rules.";
  if(status==="CONTRADICTED") return `Lead conflicts with a configured intake rule or observed evidence${reason?`: ${reason}`:""}.`;
  return `Validation is incomplete${reason?`: ${reason}`:""}. Missing or unavailable evidence is not treated as negative proof.`;
}

/** One verdict drives status/reason/fraud_overall so HubSpot props, the note headline and the portal agree. */
function applyVerdict(input:OutcomeInput):OutcomeInput&{fv:FinalVerdict}{
  const fraudIn=input.dimensions.fraud_overall;
  const fv=finalVerdict(input.quality,input.status,input.reason,fraudIn);
  if(!input.quality) return {...input,fv};
  const dimensions:Record<string,unknown>={...input.dimensions,fraud_overall:fraudValueForVerdict(fv.verdict,fraudIn)};
  if(dimensions.fraud_parallel_engines!==undefined) dimensions.fraud_parallel_engines=markEnginesNotRun(dimensions.fraud_parallel_engines,input.quality.documentCount);
  if(fv.verdict!=="JUNK") return {...input,dimensions,fv};
  return {
    ...input,
    dimensions,
    status:"CONTRADICTED",
    reason:`JUNK_LEAD: ${fv.codes.join(", ")}`,
    contradictions:[...fv.reasons.map(r=>`Junk signal: ${r}`),...(input.contradictions??[])],
    nextAction:"DO_NOT_WORK_JUNK_LEAD",
    fv
  };
}
