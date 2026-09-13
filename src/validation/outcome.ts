import crypto from "node:crypto";
import { env } from "../config/env.js";
import { toHubSpotNoteHtml } from "../integrations/hubspot/notes.js";
import { formatStaffNotePreamble, isOsintDimensionKey } from "../integrations/osint/note.js";
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

function humanNote(i:OutcomeInput, verified:string[]){
  const osint=osintFromDimensions(i.dimensions);
  const preamble=formatStaffNotePreamble(osint,i.contact,i.dimensions);
  const lines:string[]=[...preamble.lines,""];

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

  lines.push(...staffActionLines({verdict:preamble.verdict,status:i.status,missing:i.missing}));
  lines.push("");

  lines.push("_Only observed evidence is treated as verified. Missing or not-found information is not treated as proof of falsity._");
  return lines.join("\n").trim();
}

export function buildOutcome(i:OutcomeInput){
  const verified=[...new Set(i.evidence.filter(e=>e.epistemic_state==="KNOWN"||e.epistemic_state==="INFERRED").map(e=>e.claim))] as string[];
  const osint=osintFromDimensions(i.dimensions);
  const staff_verdict=formatStaffNotePreamble(osint,i.contact,i.dimensions).verdict;
  const note=humanNote(i,verified);
  const body={
    status:i.status, reason:i.reason??null, dimensions:i.dimensions, missing:i.missing,
    contradictions:i.contradictions??[], next_action:i.nextAction??null,
    evidence:i.evidence,
    staff_verdict:{
      level:staff_verdict.level,
      headline:staff_verdict.headline,
      rule_of_thumb:staff_verdict.rule_of_thumb,
      reasons:staff_verdict.reasons
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
