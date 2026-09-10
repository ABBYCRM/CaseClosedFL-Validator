import type {z} from "zod";
import {env} from "../config/env.js";

export const MODEL_CONTRACT=`You are the bounded semantic reasoning component inside CaseClosedFL-Validator.
The TypeScript runtime owns state, tools, evidence, budgets, source authority, fraud scoring, and final qualification.
Observed evidence outranks model output. Model output is never evidence by itself.
Never claim that a URL, file, government record, credential, barcode, signature, forensic detector result, treatment, lawsuit, or fact exists unless it is explicitly supplied in the observations/evidence.
Missing evidence is UNKNOWN. A not-found search is not proof of falsity or fraud. Preserve contradictions and benign explanations.
For fraud/document tasks distinguish STRUCTURALLY_CONSISTENT, DIGITALLY_CONSISTENT, MACHINE_READABLE_CONSISTENT, CRYPTOGRAPHICALLY_VERIFIED, and AUTHORITATIVELY_VERIFIED.
Never infer that a document is fraudulent from writing style, metadata absence, image quality, or one weak classifier signal.
Do not make final legal liability findings, assign legal fault percentages, estimate damages or settlement value, accuse a claimant of fraud, or give legal advice.
Do not request or execute tools yourself. Return only JSON matching the requested schema.`;

type ReasoningProfile="fast"|"forensic";

function profileForTask(task:string,input:unknown):ReasoningProfile{
  const t=task.toLowerCase();
  if(/fraud|forensic|authentic|tamper|synthetic|identity|cross-document|contradiction|credential|police report|crash report|evidence synth|document integrity/.test(t)) return "forensic";
  const size=(()=>{try{return JSON.stringify(input).length;}catch{return 0;}})();
  return size>18000?"forensic":"fast";
}

async function jsonFetch(path:string,body:unknown){
  if(!env.BITDEER_API_KEY) throw new Error("BITDEER_NOT_CONFIGURED");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),env.TOOL_TIMEOUT_MS);
  try{
    const r=await fetch(`${env.BITDEER_BASE_URL.replace(/\/$/,"")}${path}`,{
      method:"POST",signal:controller.signal,
      headers:{Authorization:`Bearer ${env.BITDEER_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    if(!r.ok) throw new Error(`BITDEER_${r.status}:${(await r.text()).slice(0,300)}`);
    return await r.json() as any;
  }finally{clearTimeout(timer);}
}

function extractJson(text:string){
  const trimmed=text.trim();
  try{return JSON.parse(trimmed);}catch{/* try fenced/object extraction */}
  const fenced=trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if(fenced){try{return JSON.parse(fenced);}catch{/* continue */}}
  const start=trimmed.indexOf("{");const end=trimmed.lastIndexOf("}");
  if(start>=0&&end>start){try{return JSON.parse(trimmed.slice(start,end+1));}catch{/* continue */}}
  throw new Error("BITDEER_NON_JSON");
}

export async function reasonJson<T>(input:unknown,schema:z.ZodType<T>,task:string):Promise<T>{
  const profile=profileForTask(task,input);
  const model=profile==="forensic"?env.BITDEER_FORENSIC_MODEL:env.BITDEER_REASONING_MODEL;
  const j=await jsonFetch("/chat/completions",{
    model,
    temperature:profile==="forensic"?0.05:0.1,
    top_p:0.9,
    frequency_penalty:0,
    presence_penalty:0,
    seed:42,
    max_tokens:profile==="forensic"?1800:1000,
    stream:false,
    messages:[
      {role:"system",content:MODEL_CONTRACT},
      {role:"user",content:JSON.stringify({task,required_output:"Return one valid JSON object only. No markdown.",input})}
    ]
  });
  const text=j.choices?.[0]?.message?.content;
  if(typeof text!=="string"||!text.trim()) throw new Error("BITDEER_EMPTY");
  return schema.parse(extractJson(text));
}

export interface RerankResult{index:number;score:number;document:string;}
export async function rerank(query:string,documents:string[],topN=Math.min(8,documents.length)):Promise<RerankResult[]>{
  if(!documents.length)return[];
  const j=await jsonFetch("/rerank",{model:env.BITDEER_RERANK_MODEL,query,documents,top_n:Math.max(1,Math.min(topN,documents.length))});
  const rows=Array.isArray(j.results)?j.results:Array.isArray(j.data)?j.data:[];
  return rows.map((r:any)=>({
    index:Number(r.index),
    score:Number(r.relevance_score??r.score??0),
    document:String(r.document?.text??r.document??documents[Number(r.index)]??"")
  })).filter((r:RerankResult)=>Number.isInteger(r.index)&&r.index>=0&&r.index<documents.length).sort((a:RerankResult,b:RerankResult)=>b.score-a.score);
}

export type VisionObservation={ok:true;text:string;model:string}|{ok:false;reason:string};
export async function observeImageText():Promise<VisionObservation>{
  return {ok:false,reason:"BITDEER_VISION_MODEL_NOT_CONFIGURED"};
}
