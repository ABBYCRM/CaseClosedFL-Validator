import { z } from "zod";
import { env } from "../config/env.js";
import { MODEL_CONTRACT } from "./nvidia.js";

async function openaiFetch(path:string, body:unknown){
  if(!env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),env.TOOL_TIMEOUT_MS);
  try{
    const response=await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/,"")}${path}`,{
      method:"POST",
      signal:controller.signal,
      headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    const text=await response.text();
    if(!response.ok) throw new Error(`OPENAI_${response.status}:${text.slice(0,500)}`);
    return text?JSON.parse(text):{};
  } finally { clearTimeout(timer); }
}

function responseText(response:any):string{
  if(typeof response?.output_text==="string"&&response.output_text.trim()) return response.output_text;
  const parts:string[]=[];
  for(const item of Array.isArray(response?.output)?response.output:[]){
    if(item?.type!=="message") continue;
    for(const content of Array.isArray(item?.content)?item.content:[]){
      if(content?.type==="output_text"&&typeof content.text==="string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

export async function openaiReasonJson<T>(input:unknown,schema:z.ZodType<T>,task:string):Promise<T>{
  const response:any=await openaiFetch("/responses",{
    model:env.OPENAI_MODEL,
    instructions:MODEL_CONTRACT,
    input:JSON.stringify({task,input}),
    max_output_tokens:1000,
    text:{format:{type:"json_object"}}
  });
  const text=responseText(response);
  if(!text) throw new Error("OPENAI_EMPTY");
  let parsed:unknown;
  try { parsed=JSON.parse(text); } catch { throw new Error("OPENAI_NON_JSON"); }
  return schema.parse(parsed);
}

export async function openaiEmbed(inputs:string[],_inputType:"query"|"passage"="passage"):Promise<number[][]>{
  if(!inputs.length) return [];
  const response:any=await openaiFetch("/embeddings",{
    model:env.OPENAI_EMBED_MODEL,
    input:inputs,
    dimensions:env.OPENAI_EMBED_DIMENSIONS,
    encoding_format:"float"
  });
  const data=Array.isArray(response?.data)?response.data:[];
  const vectors=data.sort((a:any,b:any)=>a.index-b.index).map((x:any)=>x.embedding);
  if(vectors.length!==inputs.length||vectors.some((v:any)=>!Array.isArray(v))) throw new Error("OPENAI_EMBED_INVALID");
  return vectors;
}
