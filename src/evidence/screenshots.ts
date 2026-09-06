import { q } from "../db/index.js";

export interface ValidationScreenshot {
  id:string;
  validation_id:string;
  source_url:string;
  source_id?:string|null;
  file_name:string;
  content_type:string;
  bytes:Buffer;
  observed_text?:string|null;
  vision_model?:string|null;
  tool_execution_id?:string|null;
  created_at?:Date;
}

export interface ScreenshotRef {
  id:string;
  source_url:string;
  source_id?:string|null;
  file_name:string;
  content_type:string;
  byte_length:number;
  observed_text?:string|null;
  vision_model?:string|null;
}

export function screenshotFileName(sourceUrl:string,contentType="image/jpeg"){
  let host="source";
  try{host=new URL(sourceUrl).hostname.replace(/[^a-z0-9.-]/gi,"")||"source";}catch{/* keep default */}
  const ext=contentType.includes("png")?"png":contentType.includes("webp")?"webp":"jpg";
  return `official-source-${host}.${ext}`;
}

function asBuffer(value:unknown){
  if(Buffer.isBuffer(value)) return value;
  if(value instanceof Uint8Array) return Buffer.from(value);
  if(typeof value==="string") return Buffer.from(value,"base64");
  return Buffer.alloc(0);
}

function asRow(row:any):ValidationScreenshot{
  return {
    id:String(row.id),
    validation_id:String(row.validation_id),
    source_url:String(row.source_url),
    source_id:row.source_id??null,
    file_name:String(row.file_name),
    content_type:String(row.content_type??"image/jpeg"),
    bytes:asBuffer(row.bytes),
    observed_text:row.observed_text??null,
    vision_model:row.vision_model??null,
    tool_execution_id:row.tool_execution_id??null,
    created_at:row.created_at
  };
}

export function toScreenshotRef(row:Pick<ValidationScreenshot,"id"|"source_url"|"source_id"|"file_name"|"content_type"|"bytes"|"observed_text"|"vision_model">):ScreenshotRef{
  return {
    id:row.id,
    source_url:row.source_url,
    source_id:row.source_id,
    file_name:row.file_name,
    content_type:row.content_type,
    byte_length:row.bytes?.length??0,
    observed_text:row.observed_text,
    vision_model:row.vision_model
  };
}

export async function saveValidationScreenshot(input:{
  validationId:string;
  sourceUrl:string;
  sourceId?:string;
  fileName:string;
  contentType:string;
  bytes:Buffer;
  observedText?:string;
  visionModel?:string;
  toolExecutionId?:string;
}):Promise<ValidationScreenshot>{
  const rows=await q<any>(`INSERT INTO validation_screenshots(
      validation_id,source_url,source_id,file_name,content_type,bytes,observed_text,vision_model,tool_execution_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[
    input.validationId,input.sourceUrl,input.sourceId??null,input.fileName,input.contentType,
    input.bytes,input.observedText??null,input.visionModel??null,input.toolExecutionId??null
  ]);
  if(!rows[0]) throw new Error("VALIDATION_SCREENSHOT_INSERT_FAILED");
  return asRow(rows[0]);
}

export async function hasScreenshotForUrl(validationId:string,sourceUrl:string){
  const rows=await q<any>(`SELECT 1 FROM validation_screenshots WHERE validation_id=$1 AND source_url=$2 LIMIT 1`,[validationId,sourceUrl]);
  return Boolean(rows[0]);
}

export async function listValidationScreenshots(validationId:string,limit=3):Promise<ValidationScreenshot[]>{
  const rows=await q<any>(`SELECT * FROM validation_screenshots WHERE validation_id=$1 ORDER BY created_at ASC,id ASC LIMIT $2`,[validationId,limit]);
  return rows.map(asRow);
}

export async function listScreenshotRefs(validationId:string,limit=20):Promise<ScreenshotRef[]>{
  try{
    const rows=await listValidationScreenshots(validationId,limit);
    return rows.map(toScreenshotRef);
  }catch{
    return [];
  }
}
