import type { z } from "zod";
import { env } from "../config/env.js";
import { reasonJson as nvidiaReasonJson, embed as nvidiaEmbed } from "./nvidia.js";
import { openaiReasonJson, openaiEmbed } from "./openai.js";

export type ModelProvider="nvidia"|"openai";

export function activeModelProvider():ModelProvider{return env.MODEL_PROVIDER;}
export function activeEmbeddingProvider():ModelProvider{return env.EMBEDDING_PROVIDER;}

export async function reasonJson<T>(input:unknown,schema:z.ZodType<T>,task:string):Promise<T>{
  if(env.MODEL_PROVIDER==="openai") return openaiReasonJson(input,schema,task);
  return nvidiaReasonJson(input,schema,task);
}

export async function embed(inputs:string[],inputType:"query"|"passage"="passage"):Promise<number[][]>{
  if(env.EMBEDDING_PROVIDER==="openai") return openaiEmbed(inputs,inputType);
  return nvidiaEmbed(inputs,inputType);
}
