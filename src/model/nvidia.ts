import { z } from "zod";import { env } from "../config/env.js";
export const MODEL_CONTRACT=`You are the bounded semantic reasoning component inside CaseClosedFL-Validator.
The runtime owns state, tools, evidence, budgets, source authority, and final qualification.
Never claim that a URL, file, government record, tool result, treatment, lawsuit, or fact exists unless it is explicitly present in the supplied observations/evidence.
Missing evidence is UNKNOWN. A not-found search is not proof of falsity or fraud. Preserve contradictions.
Do not make final legal liability findings, assign legal fault percentages, estimate damages, settlement value, or give legal advice.
Do not request or execute tools yourself. Return only JSON matching the requested schema.`;
async function jsonFetch(path:string,body:unknown){if(!env.NVIDIA_API_KEY)throw new Error("NVIDIA_NOT_CONFIGURED");const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),env.TOOL_TIMEOUT_MS);try{const r=await fetch(`${env.NVIDIA_BASE_URL.replace(/\/$/,"")}${path}`,{method:"POST",signal:controller.signal,headers:{Authorization:`Bearer ${env.NVIDIA_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw new Error(`NVIDIA_${r.status}:${(await r.text()).slice(0,300)}`);return await r.json() as any;}finally{clearTimeout(timer);}}
export async function reasonJson<T>(input:unknown,schema:z.ZodType<T>,task:string):Promise<T>{const j=await jsonFetch("/chat/completions",{model:env.NVIDIA_MODEL,temperature:0,max_tokens:1000,messages:[{role:"system",content:MODEL_CONTRACT},{role:"user",content:JSON.stringify({task,input})}],response_format:{type:"json_object"}});const text=j.choices?.[0]?.message?.content;if(typeof text!=="string"||!text.trim())throw new Error("NVIDIA_EMPTY");let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw new Error("NVIDIA_NON_JSON");}return schema.parse(parsed);}
export async function embed(inputs:string[],inputType:"query"|"passage"="passage"):Promise<number[][]>{if(!inputs.length)return[];const j=await jsonFetch("/embeddings",{model:env.NVIDIA_EMBED_MODEL,input:inputs,input_type:inputType,dimensions:env.NVIDIA_EMBED_DIMENSIONS,encoding_format:"float",truncate:"END"});const data=Array.isArray(j.data)?j.data:[];const vectors=data.sort((a:any,b:any)=>a.index-b.index).map((x:any)=>x.embedding);if(vectors.length!==inputs.length||vectors.some((v:any)=>!Array.isArray(v)))throw new Error("NVIDIA_EMBED_INVALID");return vectors;}

export const DEFAULT_NVIDIA_VISION_MODEL="meta/llama-3.2-11b-vision-instruct";
export const VISION_OCR_CONTRACT=`Extract only readable text that is visibly present in the screenshot.
Do not invent names, dates, case numbers, agencies, addresses, or conclusions that are not visible.
If text is unreadable or the image has no text, say so. Return plain text only.
The supplied source URL is context for the page being viewed; it is not evidence by itself.`;

export interface NvidiaVisionConfig {
  NVIDIA_API_KEY?:string;
  NVIDIA_BASE_URL?:string;
  NVIDIA_VISION_MODEL?:string;
  TOOL_TIMEOUT_MS?:number;
}

export type VisionObservation=
  |{ok:true;text:string;model:string}
  |{ok:false;reason:string};

export interface VisionCallOptions { fetch?:typeof fetch; }

function visionConfigured(cfg:NvidiaVisionConfig){
  return Boolean(cfg.NVIDIA_API_KEY?.trim())&&Boolean((cfg.NVIDIA_VISION_MODEL??DEFAULT_NVIDIA_VISION_MODEL).trim());
}

export async function observeImageText(
  input:{bytes:Buffer;contentType:string;sourceUrl:string},
  cfg:NvidiaVisionConfig=env,
  opts:VisionCallOptions={}
):Promise<VisionObservation>{
  if(!visionConfigured(cfg)) return {ok:false,reason:"NVIDIA_VISION_UNAVAILABLE"};
  const model=(cfg.NVIDIA_VISION_MODEL||DEFAULT_NVIDIA_VISION_MODEL).trim();
  const mime=(input.contentType||"image/jpeg").split(";")[0]||"image/jpeg";
  const dataUrl=`data:${mime};base64,${input.bytes.toString("base64")}`;
  const fetchImpl=opts.fetch??fetch;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),cfg.TOOL_TIMEOUT_MS??env.TOOL_TIMEOUT_MS);
  try{
    const r=await fetchImpl(`${(cfg.NVIDIA_BASE_URL||env.NVIDIA_BASE_URL).replace(/\/$/,"")}/chat/completions`,{
      method:"POST",
      signal:controller.signal,
      headers:{Authorization:`Bearer ${cfg.NVIDIA_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        model,
        temperature:0,
        max_tokens:1200,
        messages:[
          {role:"system",content:VISION_OCR_CONTRACT},
          {role:"user",content:[
            {type:"text",text:`Source URL (context only): ${input.sourceUrl}\nExtract only text visible in this screenshot.`},
            {type:"image_url",image_url:{url:dataUrl}}
          ]}
        ]
      })
    });
    if(!r.ok) return {ok:false,reason:`NVIDIA_VISION_${r.status}:${(await r.text()).slice(0,300)}`};
    const j=await r.json() as any;
    const text=j.choices?.[0]?.message?.content;
    if(typeof text!=="string"||!text.trim()) return {ok:false,reason:"NVIDIA_VISION_EMPTY"};
    return {ok:true,text:text.trim(),model};
  }catch(e:any){
    return {ok:false,reason:e?.message??"NVIDIA_VISION_FAILED"};
  }finally{
    clearTimeout(timer);
  }
}
