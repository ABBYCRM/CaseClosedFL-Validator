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

export function extractSearchTools(payload:any):ComposioTool[]{
  const root=payload?.data&&typeof payload.data==="object"&&!Array.isArray(payload.data)?{...payload,...payload.data}:payload??{};
  const schemas=root.tool_schemas&&typeof root.tool_schemas==="object"&&!Array.isArray(root.tool_schemas)?root.tool_schemas:undefined;
  const rows=Array.isArray(root.results)?root.results:[];
  if(rows.length||schemas){
    const slugs:string[]=[];
    const seen=new Set<string>();
    const push=(slug:unknown)=>{
      if(typeof slug!=="string"||!slug||seen.has(slug)) return;
      seen.add(slug);
      slugs.push(slug);
    };
    for(const row of rows){
      for(const slug of row?.primary_tool_slugs??[]) push(slug);
      for(const slug of row?.related_tool_slugs??[]) push(slug);
    }
    if(!slugs.length&&schemas) for(const slug of Object.keys(schemas)) push(slug);
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
  return Array.isArray(candidates)?candidates.map((x:any)=>({
    slug:x.slug??x.tool_slug??x.name,
    name:x.name,
    description:x.description,
    input_schema:x.input_schema??x.inputSchema,
    toolkit:x.toolkit??x.toolkit_slug
  })).filter((x:ComposioTool)=>x.slug):[];
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
  const j=await call(
    `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}/search`,
    {method:"POST",body:JSON.stringify({queries:[{use_case:query}]})},
    cfg,
    opts
  );
  return extractSearchTools(j);
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
