import type { z } from "zod";
import { env } from "../config/env.js";
import { reasonJson as bitdeerReasonJson, rerank as bitdeerRerank } from "./bitdeer.js";
import { openaiReasonJson, openaiEmbed } from "./openai.js";

export type ModelProvider="bitdeer"|"openai";
export type EmbeddingProvider="openai"|"none";

export function activeModelProvider():ModelProvider{return env.MODEL_PROVIDER;}
export function activeEmbeddingProvider():EmbeddingProvider{return env.EMBEDDING_PROVIDER;}

export async function reasonJson<T>(input:unknown,schema:z.ZodType<T>,task:string):Promise<T>{
  if(env.MODEL_PROVIDER==="openai") return openaiReasonJson(input,schema,task);
  return bitdeerReasonJson(input,schema,task);
}

export async function embed(inputs:string[],inputType:"query"|"passage"="passage"):Promise<number[][]>{
  if(env.EMBEDDING_PROVIDER==="openai") return openaiEmbed(inputs,inputType);
  throw new Error("EMBEDDING_PROVIDER_DISABLED");
}

export async function rerank(query:string,documents:string[],topN?:number){
  if(env.MODEL_PROVIDER==="bitdeer") return bitdeerRerank(query,documents,topN);
  return documents.slice(0,topN??documents.length).map((document,index)=>({index,score:0,document}));
}
