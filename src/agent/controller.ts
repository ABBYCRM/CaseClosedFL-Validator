import { Lead } from "../validation/schema.js";
import { q } from "../db/index.js";
import { validateLead } from "../validation/engine.js";
import { initialState, advance } from "./state.js";
import { audit } from "../audit/log.js";
import { env } from "../config/env.js";
import { openClawWriteNote } from "../tools/openclaw.js";
import { buildOutcome } from "../validation/outcome.js";
import { listEvidence } from "../evidence/ledger.js";

export async function startValidation(input:unknown){
  const lead=Lead.parse(input); const state=initialState();
  const rows=await q<any>("INSERT INTO validation_runs(lead_id,request,self_state) VALUES($1,$2,$3) RETURNING id",[lead.lead_id,lead,state]);const id=rows[0].id;
  await audit("VALIDATION_STARTED",id,{lead_id:lead.lead_id,state:lead.state,case_type:lead.case_type});
  try{
    const result=await validateLead(id,lead,state); advance(state,"COMPLETE");
    await q("UPDATE validation_runs SET status=$2,self_state=$3,completed_at=now() WHERE id=$1",[id,result.status,state]);
    await q(`INSERT INTO validation_results(validation_id,result,result_hash,engine_version,knowledge_version) VALUES($1,$2,$3,$4,$5)`,[id,result,result.result_hash,env.ENGINE_VERSION,env.KNOWLEDGE_VERSION]);
    await audit("VALIDATION_COMPLETED",id,{status:result.status,result_hash:result.result_hash});
    if(env.OPENCLAW_ENABLED){
      const delivery=await openClawWriteNote(result.agent_note.summary,{validation_id:id,lead_id:lead.lead_id,status:result.status,agent_note:result.agent_note,result_hash:result.result_hash});
      await audit("OPENCLAW_NOTE_DELIVERY",id,delivery as Record<string,unknown>);
    }
    return {validation_id:id,lead_id:lead.lead_id,...result};
  }catch(e:any){
    const message=(e?.message??"EXECUTION_FAILURE").slice(0,1000);state.errors.push(message);state.blockers.push(message);
    const evidence=await listEvidence(id);
    const body=buildOutcome({status:"INCOMPLETE",reason:"SOURCE_UNAVAILABLE",missing:[`Validation execution could not complete: ${message}`],dimensions:{},evidence,nextAction:"RETRY_OR_MANUAL_REVIEW"});
    await q("UPDATE validation_runs SET status='INCOMPLETE',self_state=$2,completed_at=now() WHERE id=$1",[id,state]);
    await q(`INSERT INTO validation_results(validation_id,result,result_hash,engine_version,knowledge_version) VALUES($1,$2,$3,$4,$5)`,[id,body,body.result_hash,env.ENGINE_VERSION,env.KNOWLEDGE_VERSION]);
    await audit("VALIDATION_FAILED",id,{error:message,result_hash:body.result_hash});
    return {validation_id:id,lead_id:lead.lead_id,...body};
  }
}
