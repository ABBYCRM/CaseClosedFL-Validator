import crypto from "node:crypto";
import { q } from "../db/index.js";
import type { EvidenceInput } from "./types.js";
export async function addEvidence(validationId:string,e:EvidenceInput){const contentHash=e.contentHash??crypto.createHash("sha256").update(JSON.stringify(e.payload??{})).digest("hex");const rows=await q<any>(`INSERT INTO evidence(validation_id,claim,epistemic_state,source_id,source_url,source_type,tool_execution_id,payload,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[validationId,e.claim,e.epistemicState,e.sourceId??null,e.sourceUrl??null,e.sourceType,e.toolExecutionId??null,e.payload??{},contentHash]);return rows[0];}
export const listEvidence=(id:string)=>q<any>("SELECT * FROM evidence WHERE validation_id=$1 ORDER BY observed_at,id",[id]);
export const evidenceForClaim=(id:string,claim:string)=>q<any>("SELECT * FROM evidence WHERE validation_id=$1 AND claim=$2 ORDER BY observed_at",[id,claim]);
