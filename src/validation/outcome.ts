import crypto from "node:crypto";
import { env } from "../config/env.js";
import { toHubSpotNoteHtml } from "../integrations/hubspot/notes.js";
import { formatOsintNoteLines, isOsintDimensionKey } from "../integrations/osint/note.js";
import type { OsintLookupReport } from "../integrations/osint/types.js";
import type { FinalStatus, IncompleteReason } from "./schema.js";

export interface OutcomeInput{
  status:FinalStatus; reason?:IncompleteReason|string; missing:string[]; evidence:any[];
  dimensions:Record<string,unknown>; contradictions?:string[]; nextAction?:string;
}

function statusIcon(status:FinalStatus){
  if(status==="VALIDATED") return "✅";
  if(status==="CONTRADICTED") return "⛔";
  return "⚠️";
}
function isPlainObject(v:unknown):v is Record<string,unknown>{
  return !!v && typeof v==="object" && !Array.isArray(v);
}
function pretty(v:unknown){
  if(v===null||v===undefined||v==="") return "Unknown";
  if(typeof v==="number"||typeof v==="boolean"||typeof v==="bigint") return String(v);
  if(typeof v!=="string") return "";
  return v.replaceAll("_"," ").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
}
function objectResult(v:unknown){
  if(!isPlainObject(v)) return pretty(v);
  if(v.verdict!==undefined) return pretty(v.verdict);
  if(v.result!==undefined) return pretty(v.result);
  return "";
}
function findingLine(v:unknown){
  if(!isPlainObject(v)) return pretty(v);
  const name=typeof v.engine==="string"?pretty(v.engine):typeof v.name==="string"?pretty(v.name):"";
  const kind=typeof v.finding_type==="string"?pretty(v.finding_type):"";
  const result=v.result!==undefined?pretty(v.result):v.verdict!==undefined?pretty(v.verdict):"";
  if(name&&kind&&result) return `${name} — ${kind}: ${result}`;
  if(name&&result) return `${name}: ${result}`;
  if(kind&&result) return `${kind}: ${result}`;
  if(typeof v.observation==="string"&&v.observation.trim()) return v.observation.trim();
  const scalars=Object.entries(v).filter(([,val])=>val!==undefined&&val!==null&&typeof val!=="object");
  if(scalars.length) return scalars.map(([k,val])=>`${pretty(k)}: ${pretty(val)}`).join("; ");
  return "";
}
export function formatDimensionLines(key:string,value:unknown):string[]{
  if(value===undefined) return [];
  const label=pretty(key);
  if(Array.isArray(value)){
    if(!value.length) return [];
    const children=value.map(findingLine).filter(Boolean).slice(0,12);
    if(!children.length) return [];
    return [`• ${label}:`,...children.map(line=>`  • ${line}`)];
  }
  if(isPlainObject(value)){
    if(Array.isArray(value.verdicts)){
      const header=`• ${label}: ${objectResult(value.aggregate) || pretty(value.aggregate) || "Unknown"}`;
      const engines=value.verdicts.flatMap((row:unknown)=>isPlainObject(row)&&row.engine!==undefined?[`  • ${pretty(row.engine)}: ${objectResult(row)}`]:[]);
      return [header,...engines];
    }
    const entries=Object.entries(value).filter(([,v])=>v!==undefined);
    if(!entries.length) return [];
    const engineLike=entries.every(([,v])=>isPlainObject(v)&&(v.verdict!==undefined||v.result!==undefined));
    if(engineLike){
      return [`• ${label}:`,...entries.map(([name,v])=>`  • ${pretty(name)}: ${objectResult(v)}`)];
    }
    const nested:string[]=[`• ${label}:`];
    for(const [name,v] of entries){
      if(Array.isArray(v)){
        const children=v.map(findingLine).filter(Boolean).slice(0,8);
        if(children.length) nested.push(...children.map(line=>`  • ${pretty(name)} — ${line}`));
        continue;
      }
      if(isPlainObject(v)){
        const line=findingLine(v)||objectResult(v);
        if(line) nested.push(`  • ${pretty(name)}: ${line}`);
        continue;
      }
      nested.push(`  • ${pretty(name)}: ${pretty(v)}`);
    }
    return nested.length>1?nested:[];
  }
  return [`• ${label}: ${pretty(value)}`];
}
function humanNote(i:OutcomeInput, verified:string[]){
  const lines:string[]=[];
  lines.push(`${statusIcon(i.status)} *CaseClosedFL Validation*`);
  lines.push(`Status: *${i.status}*${i.reason?` — ${pretty(i.reason)}`:""}`);
  lines.push("");

  const dimensionEntries=Object.entries(i.dimensions).filter(([k,v])=>v!==undefined&&!isOsintDimensionKey(k));
  if(dimensionEntries.length){
    lines.push("📋 *Checks*");
    for(const [k,v] of dimensionEntries) lines.push(...formatDimensionLines(k,v));
    lines.push("");
  }

  const osint=i.dimensions.identity_osint??i.dimensions.osint_identity??i.dimensions.IDENTITY_OSINT_LOOKUP;
  if(osint!==undefined||env.OSINT_IDENTITY_ENABLED){
    lines.push(...formatOsintNoteLines(osint as OsintLookupReport|undefined));
    lines.push("");
  }

  if(verified.length){
    lines.push("✅ *Verified / supported*");
    for(const item of verified.slice(0,8)) lines.push(`• ${pretty(item)}`);
    lines.push("");
  }

  if(i.missing.length){
    lines.push("❓ *Still needed*");
    for(const item of i.missing.slice(0,8)) lines.push(`• ${item}`);
    lines.push("");
  }

  if(i.contradictions?.length){
    lines.push("🚩 *Conflict / review*");
    for(const item of i.contradictions.slice(0,6)) lines.push(`• ${item}`);
    lines.push("");
  }

  if(i.nextAction){
    lines.push(`➡️ *Next step:* ${pretty(i.nextAction)}`);
    lines.push("");
  }

  lines.push("_Only observed evidence is treated as verified. Missing or not-found information is not treated as proof of falsity._");
  return lines.join("\n").trim();
}

export function buildOutcome(i:OutcomeInput){
  const verified=[...new Set(i.evidence.filter(e=>e.epistemic_state==="KNOWN"||e.epistemic_state==="INFERRED").map(e=>e.claim))] as string[];
  const note=humanNote(i,verified);
  const body={
    status:i.status, reason:i.reason??null, dimensions:i.dimensions, missing:i.missing,
    contradictions:i.contradictions??[], next_action:i.nextAction??null,
    evidence:i.evidence,
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
