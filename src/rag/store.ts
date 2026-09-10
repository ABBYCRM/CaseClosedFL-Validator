import crypto from "node:crypto";
import {q} from "../db/index.js";
import {embed,rerank} from "../model/provider.js";
import {env} from "../config/env.js";

function vectorLiteral(v:number[]){return `[${v.join(",")}]`;}

export async function upsertChunk(input:{sourceId:string;jurisdiction?:string;caseType?:string;dimension?:string;url?:string;authorityLevel?:string;content:string;metadata?:Record<string,unknown>},withEmbedding=true){
  const hash=crypto.createHash("sha256").update(input.content).digest("hex");
  let vector:number[]|null=null;
  if(withEmbedding&&env.EMBEDDING_PROVIDER!=="none"){
    try{vector=(await embed([input.content],"passage"))[0]??null;}catch{vector=null;}
  }
  await q(`DELETE FROM knowledge_chunks WHERE source_id=$1 AND content_hash=$2`,[input.sourceId,hash]);
  await q(`INSERT INTO knowledge_chunks(source_id,jurisdiction,case_type,dimension,url,authority_level,content,embedding,content_hash,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::vector,$9,$10)`,[input.sourceId,input.jurisdiction??null,input.caseType??null,input.dimension??null,input.url??null,input.authorityLevel??null,input.content,vector?vectorLiteral(vector):null,hash,input.metadata??{}]);
}

export async function retrieve(query:string,filters:{jurisdiction?:string;caseType?:string;dimension?:string},limit=6){
  let vector:number[]|null=null;
  if(env.EMBEDDING_PROVIDER!=="none"){
    try{vector=(await embed([query],"query"))[0]??null;}catch{vector=null;}
  }
  if(vector){
    const rows=await q<any>(`SELECT source_id,jurisdiction,case_type,dimension,url,authority_level,content,metadata,1-(embedding <=> $1::vector) AS score FROM knowledge_chunks WHERE embedding IS NOT NULL AND ($2::text IS NULL OR jurisdiction=$2) AND ($3::text IS NULL OR case_type=$3) AND ($4::text IS NULL OR dimension=$4) ORDER BY embedding <=> $1::vector LIMIT $5`,[vectorLiteral(vector),filters.jurisdiction??null,filters.caseType??null,filters.dimension??null,limit]);
    if(rows.length) return rows;
  }
  const candidates=await q<any>(`SELECT source_id,jurisdiction,case_type,dimension,url,authority_level,content,metadata,0.0 AS score FROM knowledge_chunks WHERE ($1::text IS NULL OR jurisdiction=$1) AND ($2::text IS NULL OR case_type=$2) AND ($3::text IS NULL OR dimension=$3) ORDER BY id DESC LIMIT $4`,[filters.jurisdiction??null,filters.caseType??null,filters.dimension??null,Math.max(limit*8,32)]);
  if(env.MODEL_PROVIDER!=="bitdeer"||!env.BITDEER_API_KEY||candidates.length<2)return candidates.slice(0,limit);
  try{
    const ranked=await rerank(query,candidates.map((row:any)=>String(row.content??"")),limit);
    return ranked.map(item=>({...candidates[item.index],score:item.score}));
  }catch{
    return candidates.slice(0,limit);
  }
}
