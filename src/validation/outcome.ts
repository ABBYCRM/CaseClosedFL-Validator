import crypto from "node:crypto";
import { env } from "../config/env.js";
import type { FinalStatus, IncompleteReason } from "./schema.js";

export interface OutcomeInput{
  status:FinalStatus; reason?:IncompleteReason|string; missing:string[]; evidence:any[];
  dimensions:Record<string,unknown>; contradictions?:string[]; nextAction?:string;
}
export function buildOutcome(i:OutcomeInput){
  const verified=[...new Set(i.evidence.filter(e=>e.epistemic_state==="KNOWN"||e.epistemic_state==="INFERRED").map(e=>e.claim))];
  const body={
    status:i.status, reason:i.reason??null, dimensions:i.dimensions, missing:i.missing,
    contradictions:i.contradictions??[], next_action:i.nextAction??null,
    evidence:i.evidence,
    agent_note:{type:"VALIDATION_NOTE",summary:summary(i.status,i.reason),verified,unverified:i.missing,recommended_next_evidence:i.missing},
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
