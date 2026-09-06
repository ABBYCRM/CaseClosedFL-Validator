import { assertSafePublicUrl } from "./http.js";
import type { Capability } from "./composio.js";
import { captureScreenshotOne, screenshotOneConfigured, screenshotToolResult } from "./screenshotone.js";

export type DirectSlug =
  |"direct:exa.search"
  |"direct:tavily.search"
  |"direct:firecrawl.scrape"
  |"direct:scrapingbee.scrape"
  |"direct:scrapfly.scrape"
  |"direct:steel.scrape"
  |"direct:screenshotone.capture";

export interface DirectKeys {
  EXA_API_KEY?:string;
  TAVILY_API_KEY?:string;
  FIRECRAWL_API_KEY?:string;
  SCRAPINGBEE_API_KEY?:string;
  SCRAPFLY_API_KEY?:string;
  STEEL_API_KEY?:string;
  STEEL_BASE_URL?:string;
  SCREENSHOTONE_ACCESS_KEY?:string;
  SCREENSHOTONE_SECRET_KEY?:string;
}

export interface DirectExecuteOptions {
  fetch?:typeof fetch;
  timeoutMs?:number;
  maxChars?:number;
}

const SEARCH_SLUGS:DirectSlug[]=["direct:exa.search","direct:tavily.search"];
const EXTRACT_SLUGS:DirectSlug[]=["direct:firecrawl.scrape","direct:scrapingbee.scrape","direct:scrapfly.scrape","direct:screenshotone.capture"];
const BROWSER_SLUGS:DirectSlug[]=["direct:steel.scrape","direct:firecrawl.scrape","direct:scrapingbee.scrape","direct:screenshotone.capture"];

function keyed(value?:string){return typeof value==="string"&&value.trim().length>0;}

export function hostOf(raw:string){try{return new URL(raw).hostname.toLowerCase();}catch{return "";}}

export function officialSearchQuery(sourceUrl:string,terms:string[]=[]){
  const host=hostOf(sourceUrl);
  return [host?`site:${host}`:"",sourceUrl,...terms.filter(Boolean).map(t=>`"${t}"`)].filter(Boolean).join(" ").trim();
}

export function biasSearchQuery(query:unknown,officialUrl:unknown){
  const q=typeof query==="string"?query.trim():"";
  const url=typeof officialUrl==="string"?officialUrl.trim():"";
  if(!url) return q;
  const host=hostOf(url);
  const parts=[q];
  if(host&&!q.includes(`site:${host}`)) parts.unshift(`site:${host}`);
  if(!parts.join(" ").includes(url)) parts.push(url);
  return parts.filter(Boolean).join(" ").trim();
}

export function slugNeedsUrl(slug:DirectSlug){
  return slug.endsWith(".scrape")||slug.endsWith(".capture");
}

export function selectDirectFallbacks(cap:Capability,keys:DirectKeys):DirectSlug[]{
  const available=new Set<DirectSlug>();
  if(keyed(keys.EXA_API_KEY)) available.add("direct:exa.search");
  if(keyed(keys.TAVILY_API_KEY)) available.add("direct:tavily.search");
  if(keyed(keys.FIRECRAWL_API_KEY)) available.add("direct:firecrawl.scrape");
  if(keyed(keys.SCRAPINGBEE_API_KEY)) available.add("direct:scrapingbee.scrape");
  if(keyed(keys.SCRAPFLY_API_KEY)) available.add("direct:scrapfly.scrape");
  if(keyed(keys.STEEL_API_KEY)) available.add("direct:steel.scrape");
  if(screenshotOneConfigured(keys)) available.add("direct:screenshotone.capture");
  const order=
    cap==="WEB_SEARCH"?SEARCH_SLUGS
    :cap==="WEB_EXTRACT"?EXTRACT_SLUGS
    :cap==="JS_BROWSER"||cap==="PUBLIC_RECORD_LOOKUP"?BROWSER_SLUGS
    :[...SEARCH_SLUGS,...EXTRACT_SLUGS];
  return order.filter(slug=>available.has(slug));
}

export function selectRunnableFallbacks(cap:Capability,keys:DirectKeys,args:Record<string,unknown>){
  const hasUrl=typeof args.url==="string"&&args.url.length>0;
  return selectDirectFallbacks(cap,keys).filter(slug=>hasUrl||!slugNeedsUrl(slug));
}

async function timedFetch(url:string,init:RequestInit,opts:DirectExecuteOptions){
  const fetchImpl=opts.fetch??fetch;
  const timeoutMs=opts.timeoutMs??20_000;
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),timeoutMs);
  try{
    return await fetchImpl(url,{...init,signal:c.signal});
  }finally{
    clearTimeout(timer);
  }
}

async function readResponse(r:Response,label:string){
  const text=await r.text();
  if(!r.ok) throw new Error(`${label}_${r.status}:${text.slice(0,400)}`);
  const type=r.headers.get("content-type")??"";
  if(type.includes("application/json")||text.startsWith("{")||text.startsWith("[")){
    try{return text?JSON.parse(text):{};}catch{return {text};}
  }
  return {text};
}

function clip(value:unknown,maxChars:number){
  if(typeof value!=="string") return value;
  return value.length>maxChars?value.slice(0,maxChars):value;
}

function asString(value:unknown){return typeof value==="string"?value:"";}

function resultUrls(value:unknown,out:string[]=[]):string[]{
  if(typeof value==="string"){
    for(const m of value.matchAll(/https?:\/\/[^\s"'<>]+/g)) out.push(m[0]);
  }else if(Array.isArray(value)) value.forEach(v=>resultUrls(v,out));
  else if(value&&typeof value==="object") Object.values(value as Record<string,unknown>).forEach(v=>resultUrls(v,out));
  return [...new Set(out)];
}

async function searchExa(args:Record<string,unknown>,keys:DirectKeys,opts:DirectExecuteOptions){
  if(!keyed(keys.EXA_API_KEY)) throw new Error("EXA_NOT_CONFIGURED");
  const query=biasSearchQuery(args.query,args.url);
  if(!query) throw new Error("DIRECT_QUERY_REQUIRED");
  const maxResults=Number(args.max_results??8)||8;
  const r=await timedFetch("https://api.exa.ai/search",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-api-key":keys.EXA_API_KEY!,
      Authorization:`Bearer ${keys.EXA_API_KEY}`
    },
    body:JSON.stringify({query,numResults:maxResults,type:"auto",contents:{highlights:true,text:true}})
  },opts);
  const body=await readResponse(r,"DIRECT_EXA");
  const results=Array.isArray((body as any).results)?(body as any).results:[];
  return {provider:"exa",slug:"direct:exa.search",query,url:args.url,results,urls:resultUrls(body)};
}

async function searchTavily(args:Record<string,unknown>,keys:DirectKeys,opts:DirectExecuteOptions){
  if(!keyed(keys.TAVILY_API_KEY)) throw new Error("TAVILY_NOT_CONFIGURED");
  const query=biasSearchQuery(args.query,args.url);
  if(!query) throw new Error("DIRECT_QUERY_REQUIRED");
  const maxResults=Number(args.max_results??8)||8;
  const searchDepth=asString(args.search_depth)||"advanced";
  const r=await timedFetch("https://api.tavily.com/search",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      Authorization:`Bearer ${keys.TAVILY_API_KEY}`
    },
    body:JSON.stringify({query,max_results:maxResults,search_depth:searchDepth})
  },opts);
  const body=await readResponse(r,"DIRECT_TAVILY");
  return {provider:"tavily",slug:"direct:tavily.search",query,url:args.url,result:body,urls:resultUrls(body)};
}

async function scrapeFirecrawl(url:string,keys:DirectKeys,opts:DirectExecuteOptions){
  if(!keyed(keys.FIRECRAWL_API_KEY)) throw new Error("FIRECRAWL_NOT_CONFIGURED");
  const r=await timedFetch("https://api.firecrawl.dev/v2/scrape",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      Authorization:`Bearer ${keys.FIRECRAWL_API_KEY}`
    },
    body:JSON.stringify({url,formats:["markdown","links"]})
  },opts);
  const body=await readResponse(r,"DIRECT_FIRECRAWL");
  const data=(body as any).data??body;
  return {
    provider:"firecrawl",
    slug:"direct:firecrawl.scrape",
    url,
    markdown:clip(data?.markdown??data?.text,opts.maxChars??60_000),
    links:data?.links??[],
    urls:resultUrls({url,...data})
  };
}

async function scrapeScrapingBee(url:string,keys:DirectKeys,opts:DirectExecuteOptions){
  if(!keyed(keys.SCRAPINGBEE_API_KEY)) throw new Error("SCRAPINGBEE_NOT_CONFIGURED");
  const target=new URL("https://app.scrapingbee.com/api/v1");
  target.searchParams.set("url",url);
  target.searchParams.set("render_js","true");
  const r=await timedFetch(target.toString(),{
    method:"GET",
    headers:{Authorization:`Bearer ${keys.SCRAPINGBEE_API_KEY}`}
  },opts);
  const body=await readResponse(r,"DIRECT_SCRAPINGBEE");
  const text=typeof body==="object"&&body&&"text" in body?asString((body as any).text):JSON.stringify(body);
  return {provider:"scrapingbee",slug:"direct:scrapingbee.scrape",url,text:clip(text,opts.maxChars??60_000),urls:[url,...resultUrls(text)]};
}

async function scrapeScrapfly(url:string,keys:DirectKeys,opts:DirectExecuteOptions){
  if(!keyed(keys.SCRAPFLY_API_KEY)) throw new Error("SCRAPFLY_NOT_CONFIGURED");
  const target=new URL("https://api.scrapfly.io/scrape");
  target.searchParams.set("key",keys.SCRAPFLY_API_KEY!);
  target.searchParams.set("url",url);
  target.searchParams.set("asp","true");
  const r=await timedFetch(target.toString(),{method:"GET"},opts);
  const body=await readResponse(r,"DIRECT_SCRAPFLY");
  return {provider:"scrapfly",slug:"direct:scrapfly.scrape",url,result:body,urls:resultUrls({url,...(body as object)})};
}

async function scrapeSteel(url:string,keys:DirectKeys,opts:DirectExecuteOptions){
  if(!keyed(keys.STEEL_API_KEY)) throw new Error("STEEL_NOT_CONFIGURED");
  const base=(keys.STEEL_BASE_URL||"https://api.steel.dev/v1").replace(/\/$/,"");
  const headers={"steel-api-key":keys.STEEL_API_KEY!,"Content-Type":"application/json"};
  const sessionRes=await timedFetch(`${base}/sessions`,{method:"POST",headers,body:"{}"},opts);
  const session=await readResponse(sessionRes,"DIRECT_STEEL_SESSION");
  const scrapeRes=await timedFetch(`${base}/scrape`,{
    method:"POST",
    headers,
    body:JSON.stringify({url,format:["markdown","html"]})
  },opts);
  const scrape=await readResponse(scrapeRes,"DIRECT_STEEL");
  return {
    provider:"steel",
    slug:"direct:steel.scrape",
    url,
    session,
    result:scrape,
    urls:resultUrls({url,...(scrape as object)})
  };
}

export async function executeDirectTool(slug:DirectSlug,args:Record<string,unknown>,keys:DirectKeys,opts:DirectExecuteOptions={}){
  if(slug==="direct:exa.search") return searchExa(args,keys,opts);
  if(slug==="direct:tavily.search") return searchTavily(args,keys,opts);
  const rawUrl=asString(args.url);
  if(!rawUrl) throw new Error("DIRECT_URL_REQUIRED");
  const url=assertSafePublicUrl(rawUrl).toString();
  if(slug==="direct:firecrawl.scrape") return scrapeFirecrawl(url,keys,opts);
  if(slug==="direct:scrapingbee.scrape") return scrapeScrapingBee(url,keys,opts);
  if(slug==="direct:scrapfly.scrape") return scrapeScrapfly(url,keys,opts);
  if(slug==="direct:steel.scrape") return scrapeSteel(url,keys,opts);
  if(slug==="direct:screenshotone.capture"){
    const capture=await captureScreenshotOne(url,keys,{fetch:opts.fetch,timeoutMs:opts.timeoutMs});
    return {...screenshotToolResult(capture),bytes:capture.bytes};
  }
  throw new Error(`DIRECT_TOOL_UNKNOWN:${slug}`);
}
