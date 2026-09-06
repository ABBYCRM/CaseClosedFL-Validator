import { env } from "../config/env.js";

export type Capability="WEB_SEARCH"|"WEB_EXTRACT"|"JS_BROWSER"|"PUBLIC_RECORD_LOOKUP"|"BUSINESS_SEARCH"|"COURT_SEARCH"|"PROVIDER_SEARCH";
export interface ComposioTool{slug:string;name?:string;description?:string;input_schema?:unknown;toolkit?:string;}
export interface ComposioSession{id:string;}
export interface ComposioConfig{
  COMPOSIO_API_KEY:string;
  COMPOSIO_BASE_URL:string;
  COMPOSIO_USER_ID?:string;
  COMPOSIO_TOOLKITS?:string[];
  TOOL_TIMEOUT_MS?:number;
}
export interface ComposioCallOptions{fetch?:typeof fetch;}

export function sessionCreateBody(userId:string,toolkits:string[]){
  const payload:{user_id:string;toolkits?:{enable:string[]}}={user_id:userId};
  if(toolkits.length) payload.toolkits={enable:toolkits};
  return payload;
}

function unwrapPayload(payload:any){
  const data=payload?.data;
  if(data&&typeof data==="object"&&!Array.isArray(data)) return {...payload,...data};
  return payload??{};
}

function collectSlugs(value:unknown,into:string[],seen:Set<string>){
  if(typeof value==="string"&&value&&!seen.has(value)){
    seen.add(value);
    into.push(value);
    return;
  }
  if(!Array.isArray(value)) return;
  for(const item of value){
    if(typeof item==="string") collectSlugs(item,into,seen);
    else if(item&&typeof item==="object") collectSlugs(item.slug??item.tool_slug??item.name,into,seen);
  }
}

export function extractSearchTools(payload:any):ComposioTool[]{
  const root=unwrapPayload(payload);
  const schemas=root.tool_schemas&&typeof root.tool_schemas==="object"&&!Array.isArray(root.tool_schemas)?root.tool_schemas:undefined;
  const slugs:string[]=[];
  const seen=new Set<string>();
  const rows=Array.isArray(root.results)?root.results:[];
  for(const row of rows){
    collectSlugs(row?.primary_tool_slugs,slugs,seen);
    collectSlugs(row?.related_tool_slugs,slugs,seen);
  }
  collectSlugs(root.primary_tool_slugs,slugs,seen);
  collectSlugs(root.related_tool_slugs,slugs,seen);
  collectSlugs(root.tool_slugs,slugs,seen);
  if(!slugs.length&&schemas) collectSlugs(Object.keys(schemas),slugs,seen);
  if(slugs.length){
    return slugs.map(slug=>{
      const schema=schemas?.[slug]??{};
      return{
        slug:schema.tool_slug??schema.slug??slug,
        name:schema.name,
        description:schema.description,
        input_schema:schema.input_schema??schema.inputSchema,
        toolkit:schema.toolkit??schema.toolkit_slug
      };
    }).filter(tool=>tool.slug);
  }
  const candidates=root.tools??root.items??(Array.isArray(root.data)?root.data:[]);
  return Array.isArray(candidates)?candidates.map((x:any)=>typeof x==="string"?{slug:x}:{
    slug:x.slug??x.tool_slug??x.name,
    name:x.name,
    description:x.description,
    input_schema:x.input_schema??x.inputSchema,
    toolkit:x.toolkit??x.toolkit_slug
  }).filter((x:ComposioTool)=>x.slug):[];
}

function headers(apiKey:string){return {"x-api-key":apiKey,"Content-Type":"application/json"};}

async function call(path:string,init:RequestInit={},cfg:ComposioConfig=env,opts:ComposioCallOptions={}){
  if(!cfg.COMPOSIO_API_KEY) throw new Error("COMPOSIO_NOT_CONFIGURED");
  const fetchImpl=opts.fetch??fetch;
  const timeoutMs=cfg.TOOL_TIMEOUT_MS??env.TOOL_TIMEOUT_MS;
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),timeoutMs);
  try{
    const r=await fetchImpl(`${cfg.COMPOSIO_BASE_URL.replace(/\/$/,"")}${path}`,{
      ...init,
      signal:c.signal,
      headers:{...headers(cfg.COMPOSIO_API_KEY),...(init.headers??{})}
    });
    const text=await r.text();
    if(!r.ok) throw new Error(`COMPOSIO_${r.status}:${text.slice(0,400)}`);
    return text?JSON.parse(text):{};
  }finally{
    clearTimeout(timer);
  }
}

export async function createSession(cfg:ComposioConfig=env,opts:ComposioCallOptions={}):Promise<ComposioSession>{
  const payload=sessionCreateBody(cfg.COMPOSIO_USER_ID??env.COMPOSIO_USER_ID,cfg.COMPOSIO_TOOLKITS??env.COMPOSIO_TOOLKITS);
  const j:any=await call("/api/v3.1/tool_router/session",{method:"POST",body:JSON.stringify(payload)},cfg,opts);
  const id=j.id??j.session_id??j.data?.id??j.data?.session_id;
  if(!id) throw new Error("COMPOSIO_SESSION_ID_MISSING");
  return{id};
}

export async function searchTools(sessionId:string,query:string,cfg:ComposioConfig=env,opts:ComposioCallOptions={}):Promise<ComposioTool[]>{
  // Live v3.1: `{query}` on /search is 400 `payload.queries: Required`.
  try{
    const tools=extractSearchTools(await call(
      `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}/search`,
      {method:"POST",body:JSON.stringify({queries:[{use_case:query}]})},
      cfg,
      opts
    ));
    if(tools.length) return tools;
  }catch{
    // Fall through to the live-verified execute_meta discovery path.
  }
  return extractSearchTools(await executeMeta(
    sessionId,
    "COMPOSIO_SEARCH_TOOLS",
    {query,queries:[{use_case:query}]},
    cfg,
    opts
  ));
}

export async function executeTool(sessionId:string,slug:string,args:Record<string,unknown>,cfg:ComposioConfig=env,opts:ComposioCallOptions={}){
  return call(
    `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}/execute`,
    {method:"POST",body:JSON.stringify({tool_slug:slug,arguments:args})},
    cfg,
    opts
  );
}

export async function executeMeta(sessionId:string,slug:"COMPOSIO_SEARCH_TOOLS"|"COMPOSIO_GET_TOOL_SCHEMAS",args:Record<string,unknown>,cfg:ComposioConfig=env,opts:ComposioCallOptions={}){
  return call(
    `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}/execute_meta`,
    {method:"POST",body:JSON.stringify({slug,arguments:args})},
    cfg,
    opts
  );
}
