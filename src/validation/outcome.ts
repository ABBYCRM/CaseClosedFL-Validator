import crypto from "node:crypto";
import { env } from "../config/env.js";
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
function pretty(v:unknown){
  if(v===null||v===undefined||v==="") return "Unknown";
  return String(v).replaceAll("_"," ").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
}
function humanNote(i:OutcomeInput, verified:string[]){
  const lines:string[]=[];
  lines.push(`${statusIcon(i.status)} *CaseClosedFL Validation*`);
  lines.push(`Status: *${i.status}*${i.reason?` — ${pretty(i.reason)}`:""}`);
  lines.push("");

  const dimensionEntries=Object.entries(i.dimensions).filter(([,v])=>v!==undefined);
  if(dimensionEntries.length){
    lines.push("📋 *Checks*");
    for(const [k,v] of dimensionEntries) lines.push(`• ${pretty(k)}: ${pretty(v)}`);
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
    hubspot_note:note,
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
