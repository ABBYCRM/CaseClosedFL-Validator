import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { startValidation } from "../agent/controller.js";
import { verify,mint,adminAuthorized } from "../auth/tokens.js";
import { q } from "../db/index.js";
import { syncHubSpotOnce } from "../integrations/hubspot/worker.js";

async function bearer(req:any,reply:any,scope:string){const raw=String(req.headers.authorization??"").replace(/^Bearer\s+/i,"");if(!raw||!await verify(raw,scope)){reply.code(401).send({error:"UNAUTHORIZED"});return false;}return true;}
function admin(req:any,reply:any){if(!adminAuthorized(req.headers["x-admin-secret"])){reply.code(401).send({error:"UNAUTHORIZED"});return false;}return true;}

export function serviceIndex(){
  return {
    service:"CaseClosedFL-Validator",
    kind:"api",
    message:"This host is the CaseClosedFL-Validator API, not the public CaseClosedFL website.",
    frontend:"https://caseclosedfl.com",
    paths:{health:"/health",ready:"/ready",admin:"/admin/"}
  };
}

export function serviceIndexHtml(info=serviceIndex()){
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CaseClosedFL-Validator API</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;line-height:1.5;color:#122}
    a{color:#0b5} .muted{color:#556} code{background:#f3f4f6;padding:2px 6px;border-radius:4px}
    ul{padding-left:1.2rem}
  </style>
</head>
<body>
  <h1>CaseClosedFL-Validator</h1>
  <p>${info.message}</p>
  <p>Public website: <a href="${info.frontend}">${info.frontend}</a></p>
  <p class="muted">Read-only service index. No secrets are exposed here.</p>
  <ul>
    <li><a href="${info.paths.health}"><code>${info.paths.health}</code></a> liveness</li>
    <li><a href="${info.paths.ready}"><code>${info.paths.ready}</code></a> readiness</li>
    <li><a href="${info.paths.admin}"><code>${info.paths.admin}</code></a> token admin UI</li>
  </ul>
</body>
</html>`;
}

function wantsJson(req:any){
  const format=String(req.query?.format??"");
  const accept=String(req.headers?.accept??"");
  return format==="json"||accept.includes("application/json");
}

export async function routes(app:FastifyInstance){
  app.get("/",async(req:any,rep:any)=>{
    const info=serviceIndex();
    if(wantsJson(req)) return info;
    return rep.type("text/html").send(serviceIndexHtml(info));
  });
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
