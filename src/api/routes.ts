import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { startValidation } from "../agent/controller.js";
import { verify,mint,adminAuthorized } from "../auth/tokens.js";
import { q } from "../db/index.js";
import { syncHubSpotOnce } from "../integrations/hubspot/worker.js";

async function bearer(req:any,reply:any,scope:string){const raw=String(req.headers.authorization??"").replace(/^Bearer\s+/i,"");if(!raw||!await verify(raw,scope)){reply.code(401).send({error:"UNAUTHORIZED"});return false;}return true;}
function admin(req:any,reply:any){if(!adminAuthorized(req.headers["x-admin-secret"])){reply.code(401).send({error:"UNAUTHORIZED"});return false;}return true;}
export async function routes(app:FastifyInstance){
  app.get("/health",async()=>({ok:true,service:"CaseClosedFL-Validator"}));
  app.get("/ready",async(_req:any,rep:any)=>{try{await q("SELECT 1");return {ok:true};}catch{return rep.code(503).send({ok:false});}});
  app.post("/v1/validations",async(req:any,rep:any)=>{if(!await bearer(req,rep,"validate"))return;try{return await startValidation(req.body);}catch(e){if(e instanceof ZodError)return rep.code(400).send({error:"INVALID_LEAD",issues:e.issues});throw e;}});
  app.get("/v1/validations/:id",async(req:any,rep:any)=>{if(!await bearer(req,rep,"read-result"))return;const r=await q<any>("SELECT result FROM validation_results WHERE validation_id=$1",[req.params.id]);if(!r[0])return rep.code(404).send({error:"NOT_FOUND"});return r[0].result;});
  app.get("/v1/validations/:id/evidence",async(req:any,rep:any)=>{if(!await bearer(req,rep,"read-result"))return;return q("SELECT id,claim,epistemic_state,source_id,source_url,source_type,tool_execution_id,payload,content_hash,observed_at FROM evidence WHERE validation_id=$1 ORDER BY observed_at,id",[req.params.id]);});
  app.get("/v1/validations/:id/state",async(req:any,rep:any)=>{if(!await bearer(req,rep,"read-result"))return;const r=await q<any>("SELECT status,self_state,created_at,completed_at FROM validation_runs WHERE id=$1",[req.params.id]);if(!r[0])return rep.code(404).send({error:"NOT_FOUND"});return r[0];});
  app.get("/admin/tokens",async(req:any,rep:any)=>{if(!admin(req,rep))return;return q("SELECT id,name,prefix,scopes,created_at,last_used_at,revoked_at FROM api_tokens ORDER BY created_at DESC");});
  app.post("/admin/tokens",async(req:any,rep:any)=>{if(!admin(req,rep))return;try{return await mint(req.body?.name??"token",req.body?.scopes??["validate","read-result"]);}catch(e:any){return rep.code(400).send({error:e?.message??"TOKEN_CREATE_FAILED"});}});
  app.delete("/admin/tokens/:id",async(req:any,rep:any)=>{if(!admin(req,rep))return;const rows=await q<any>("UPDATE api_tokens SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id",[req.params.id]);return {revoked:!!rows[0]};});
  app.post("/admin/hubspot/sync",async(req:any,rep:any)=>{if(!admin(req,rep))return;try{return await syncHubSpotOnce();}catch(e:any){return rep.code(502).send({error:e?.message??"HUBSPOT_SYNC_FAILED"});}});
}
