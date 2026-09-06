import crypto from "node:crypto";
import { q } from "../db/index.js";
import { actionFingerprint,mayExecute } from "../agent/guards.js";
import type { SelfState } from "../agent/state.js";
import { beginExecutionCycle,finishExecutionCycle } from "../agent/control.js";
import { env } from "../config/env.js";
import { createSession,executeTool,searchTools,type Capability,type ComposioTool } from "./composio.js";
import { executeDirectTool,selectRunnableFallbacks,type DirectSlug } from "./direct.js";

const allowedCapabilities=new Set<Capability>(["WEB_SEARCH","WEB_EXTRACT","JS_BROWSER","PUBLIC_RECORD_LOOKUP","BUSINESS_SEARCH","COURT_SEARCH","PROVIDER_SEARCH"]);
const denyWords=/(send|email|message|delete|remove|purchase|buy|create_contact|update_contact|hubspot|stripe|payment|post_social|write_file|shell|bash|execute_code|remote_workbench)/i;
const preference:Record<Capability,RegExp[]>={
  WEB_SEARCH:[/tavily/i,/exa/i,/serpapi|duckduckgo/i],
  WEB_EXTRACT:[/tavily/i,/exa/i,/firecrawl/i,/scrapingbee/i,/scrapfly/i],
  JS_BROWSER:[/browser_tool/i,/steel/i,/browser/i,/firecrawl/i],
  PUBLIC_RECORD_LOOKUP:[/browser_tool/i,/steel/i,/browser/i,/firecrawl/i,/tavily/i,/exa/i],
  BUSINESS_SEARCH:[/tavily/i,/exa/i,/serpapi/i,/firecrawl/i,/browser/i],
  COURT_SEARCH:[/tavily/i,/exa/i,/firecrawl/i,/browser/i],
  PROVIDER_SEARCH:[/tavily/i,/exa/i,/firecrawl/i,/browser/i]
};
const queries:Record<Capability,string>={
  WEB_SEARCH:"search the public web and return source URLs and snippets",
  WEB_EXTRACT:"extract readable text from a public URL without modifying anything",
  JS_BROWSER:"navigate and read a public website in a browser; read-only; do not purchase, submit, message, or bypass access controls",
  PUBLIC_RECORD_LOOKUP:"look up a public government record in read-only mode without bypassing authorization",
  BUSINESS_SEARCH:"search an official government business entity registry read-only",
  COURT_SEARCH:"search public court case records read-only",
  PROVIDER_SEARCH:"search an official professional or medical license registry read-only"
};

function safeTools(tools:ComposioTool[]){return tools.filter(t=>!denyWords.test(`${t.slug} ${t.name??""} ${t.description??""}`));}
function ordered(cap:Capability,tools:ComposioTool[]){
  const safe=safeTools(tools),prefs=preference[cap];
  return[...safe].sort((a,b)=>rank(a)-rank(b));
  function rank(t:ComposioTool){const s=`${t.slug} ${t.name??""} ${t.description??""}`;const i=prefs.findIndex(r=>r.test(s));return i<0?99:i;}
}
function schemaProps(tool:ComposioTool):Record<string,any>{
  const s:any=tool.input_schema??{};
  return s.properties??s.parameters?.properties??s.schema?.properties??{};
}
function adaptArgs(tool:ComposioTool,input:Record<string,unknown>){
  const props=schemaProps(tool);
  if(!Object.keys(props).length) return input;
  const out:Record<string,unknown>={};
  const query=input.query;
  for(const key of["query","search_query","q","text","search_term"]){
    if(key in props&&query!==undefined){out[key]=query;break;}
  }
  if("url" in props&&input.url!==undefined) out.url=input.url;
  if("urls" in props&&input.url!==undefined) out.urls=[input.url];
  if("max_results" in props&&input.max_results!==undefined) out.max_results=input.max_results;
  if("num_results" in props&&input.max_results!==undefined) out.num_results=input.max_results;
  if("search_depth" in props&&input.search_depth!==undefined) out.search_depth=input.search_depth;
  for(const[k,v] of Object.entries(input)) if(k in props&&!(k in out)) out[k]=v;
  return Object.keys(out).length?out:input;
}

function composioUsable(){return Boolean(env.COMPOSIO_API_KEY.trim());}

async function persistExecution(validationId:string,tool:string,cap:Capability,fp:string,args:Record<string,unknown>){
  const run=await q<any>(`INSERT INTO tool_executions(validation_id,tool,action,fingerprint,args,status) VALUES($1,$2,$3,$4,$5,'RUNNING') RETURNING id`,[validationId,tool,cap,fp,args]);
  const id=run[0]?.id;
  if(!id) throw new Error("TOOL_EXECUTION_ID_MISSING");
  return id as string;
}

async function runComposioCapability(validationId:string,state:SelfState,cap:Capability,args:Record<string,unknown>,fp:string){
  const session=await createSession();
  const tools=ordered(cap,await searchTools(session.id,queries[cap]));
  state.availableTools=[...new Set([...state.availableTools,...tools.map(t=>t.slug)])].slice(-60);
  if(!tools.length) throw new Error(`NO_SAFE_TOOL_FOR_${cap}`);
  const errors:string[]=[];
  for(const selected of tools.slice(0,3)){
    state.toolCalls++;
    const adapted=adaptArgs(selected,args);
    const id=await persistExecution(validationId,selected.slug,cap,fp,adapted);
    try{
      const result=await executeTool(session.id,selected.slug,adapted);
      await q(`UPDATE tool_executions SET status='SUCCESS',result=$2,completed_at=now() WHERE id=$1`,[id,result]);
      state.previousToolResults.push(`${selected.slug}:SUCCESS`);
      state.actionHistory.push({fingerprint:fp,action:`${cap}:${selected.slug}`,status:"SUCCESS",at:new Date().toISOString()});
      finishExecutionCycle(state,`${cap}:${selected.slug}`,"Tool returned a successful observed result",true);
      return {toolExecutionId:id,tool:selected.slug,result,sessionId:session.id};
    }catch(e:any){
      const msg=e?.message??"TOOL_FAILURE";
      errors.push(`${selected.slug}:${msg}`);
      await q(`UPDATE tool_executions SET status='FAILURE',error=$2,completed_at=now() WHERE id=$1`,[id,msg]);
      state.actionHistory.push({fingerprint:fp,action:`${cap}:${selected.slug}`,status:"FAILURE",at:new Date().toISOString()});
    }
  }
  throw new Error(`CAPABILITY_FAILED:${cap}:${errors.join("|").slice(0,900)}`);
}

async function runDirectCapability(validationId:string,state:SelfState,cap:Capability,args:Record<string,unknown>,fp:string,slugs:DirectSlug[]){
  const errors:string[]=[];
  for(const slug of slugs){
    state.toolCalls++;
    const id=await persistExecution(validationId,slug,cap,fp,args);
    try{
      const result=await executeDirectTool(slug,args,env,{timeoutMs:env.TOOL_TIMEOUT_MS,maxChars:env.MAX_DOCUMENT_CHARS});
      await q(`UPDATE tool_executions SET status='SUCCESS',result=$2,completed_at=now() WHERE id=$1`,[id,result]);
      state.previousToolResults.push(`${slug}:SUCCESS`);
      state.availableTools=[...new Set([...state.availableTools,slug])].slice(-60);
      state.actionHistory.push({fingerprint:fp,action:`${cap}:${slug}`,status:"SUCCESS",at:new Date().toISOString()});
      finishExecutionCycle(state,`${cap}:${slug}`,"Direct fallback returned a successful observed result",true);
      return {toolExecutionId:id,tool:slug,result,sessionId:"direct"};
    }catch(e:any){
      const msg=e?.message??"TOOL_FAILURE";
      errors.push(`${slug}:${msg}`);
      await q(`UPDATE tool_executions SET status='FAILURE',error=$2,completed_at=now() WHERE id=$1`,[id,msg]);
      state.actionHistory.push({fingerprint:fp,action:`${cap}:${slug}`,status:"FAILURE",at:new Date().toISOString()});
    }
  }
  throw new Error(`CAPABILITY_FAILED:${cap}:${errors.join("|").slice(0,900)}`);
}

export async function runCapability(validationId:string,state:SelfState,cap:Capability,args:Record<string,unknown>){
  if(!allowedCapabilities.has(cap)) throw new Error("TOOL_SCOPE_DENIED");
  const composioFp=actionFingerprint("COMPOSIO",cap,args);
  const directFp=actionFingerprint("DIRECT",cap,args);
  const directSlugs=selectRunnableFallbacks(cap,env,args);
  const tryComposio=composioUsable()&&mayExecute(state,composioFp);
  const tryDirect=directSlugs.length>0&&mayExecute(state,directFp);
  if(!tryComposio&&!tryDirect){
    if(composioUsable()||directSlugs.length) throw new Error("IDENTICAL_FAILED_ACTION_PROHIBITED");
    throw new Error(`NO_SAFE_TOOL_FOR_${cap}`);
  }
  beginExecutionCycle(state,tryComposio?`COMPOSIO:${cap}`:`DIRECT:${cap}`,`Obtain new read-only evidence or a precise tool failure for ${cap}`);
  const errors:string[]=[];
  if(tryComposio){
    try{
      return await runComposioCapability(validationId,state,cap,args,composioFp);
    }catch(e:any){
      errors.push(e?.message??"COMPOSIO_FAILURE");
    }
  }
  if(tryDirect){
    try{
      return await runDirectCapability(validationId,state,cap,args,directFp,directSlugs);
    }catch(e:any){
      errors.push(e?.message??"DIRECT_FAILURE");
    }
  }
  if(tryComposio) state.failedActions.push(composioFp);
  if(tryDirect) state.failedActions.push(directFp);
  state.errors.push(...errors);
  finishExecutionCycle(state,tryDirect?`DIRECT:${cap}`:`COMPOSIO:${cap}`,`All safe candidate tools failed: ${errors.join("|").slice(0,500)}`,false);
  if(state.toolCalls>=env.MAX_TOOL_CALLS) state.blockers.push("TOOL_BUDGET_EXHAUSTED");
  throw new Error(`CAPABILITY_FAILED:${cap}:${errors.join("|").slice(0,900)}`);
}

export function observationContains(result:unknown,needles:string[]){
  const hay=JSON.stringify(result).toLowerCase();
  return needles.filter(Boolean).every(n=>hay.includes(n.toLowerCase()));
}
export const resultDigest=(x:unknown)=>crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
