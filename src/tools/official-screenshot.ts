import { env } from "../config/env.js";
import { addEvidence } from "../evidence/ledger.js";
import { CLAIMS } from "../evidence/claims.js";
import {
  hasScreenshotForUrl, saveValidationScreenshot, screenshotFileName, type ValidationScreenshot
} from "../evidence/screenshots.js";
import { observeImageText, type NvidiaVisionConfig, type VisionObservation } from "../model/nvidia.js";
import type { SelfState } from "../agent/state.js";
import { q } from "../db/index.js";
import { executeDirectTool, type DirectKeys } from "./direct.js";
import { screenshotOneConfigured, type ScreenshotOneCapture } from "./screenshotone.js";

export interface OfficialScreenshotKeys extends DirectKeys, NvidiaVisionConfig {
  SCREENSHOTONE_ACCESS_KEY?:string;
  SCREENSHOTONE_SECRET_KEY?:string;
  NVIDIA_API_KEY?:string;
  NVIDIA_BASE_URL?:string;
  NVIDIA_VISION_MODEL?:string;
  TOOL_TIMEOUT_MS?:number;
}

export interface OfficialScreenshotDeps {
  keys?:OfficialScreenshotKeys;
  fetch?:typeof fetch;
  alreadyCaptured?:(validationId:string,sourceUrl:string)=>Promise<boolean>;
  saveScreenshot?:(row:{
    validationId:string;sourceUrl:string;sourceId?:string;fileName:string;contentType:string;
    bytes:Buffer;observedText?:string;visionModel?:string;toolExecutionId?:string;
  })=>Promise<Pick<ValidationScreenshot,"id">>;
  addEvidence?:typeof addEvidence;
  persistTool?:(row:{validationId:string;tool:string;action:string;args:Record<string,unknown>;result:unknown})=>Promise<string|undefined>;
  observeText?:typeof observeImageText;
}

export interface OfficialScreenshotResult {
  captured:boolean;
  skipped?:string;
  screenshotId?:string;
  toolExecutionId?:string;
  observedText?:string;
  vision?:VisionObservation;
}

const SCREENSHOT_CLAIM_NOTE="Text observed in screenshot. This is not independently verified government-record truth.";

export function screenshotObservationPayload(input:{
  sourceUrl:string;
  screenshotId?:string;
  observedText?:string;
  vision?:VisionObservation;
  sha256?:string;
  contentType?:string;
}){
  return {
    observation:"text observed in screenshot",
    disclaimer:SCREENSHOT_CLAIM_NOTE,
    source_url:input.sourceUrl,
    screenshot_id:input.screenshotId,
    observed_text:input.observedText??"",
    vision_model:input.vision&&input.vision.ok?input.vision.model:input.vision&&!input.vision.ok?null:undefined,
    vision_unavailable:input.vision?!input.vision.ok:true,
    vision_reason:input.vision&&!input.vision.ok?input.vision.reason:undefined,
    content_type:input.contentType,
    sha256:input.sha256
  };
}

async function defaultPersistTool(row:{validationId:string;tool:string;action:string;args:Record<string,unknown>;result:unknown}){
  try{
    const run=await q<any>(`INSERT INTO tool_executions(validation_id,tool,action,fingerprint,args,status,result,completed_at)
      VALUES($1,$2,$3,$4,$5,'SUCCESS',$6,now()) RETURNING id`,
      [row.validationId,row.tool,row.action,`screenshotone:${row.args.url??""}`,row.args,row.result]);
    return run[0]?.id as string|undefined;
  }catch{
    return undefined;
  }
}

export async function captureAndObserveOfficialSource(input:{
  validationId:string;
  state:SelfState;
  sourceUrl:string;
  sourceId?:string;
},deps:OfficialScreenshotDeps={}):Promise<OfficialScreenshotResult>{
  const keys=deps.keys??env;
  if(!screenshotOneConfigured(keys)) return {captured:false,skipped:"SCREENSHOTONE_NOT_CONFIGURED"};
  const already=deps.alreadyCaptured??hasScreenshotForUrl;
  try{
    if(await already(input.validationId,input.sourceUrl)) return {captured:false,skipped:"ALREADY_CAPTURED"};
  }catch{
    // Dedup is best-effort; continue if the table is missing in unit tests.
  }

  let capture:ScreenshotOneCapture;
  try{
    const result=await executeDirectTool("direct:screenshotone.capture",{url:input.sourceUrl},keys,{
      fetch:deps.fetch,
      timeoutMs:keys.TOOL_TIMEOUT_MS??env.TOOL_TIMEOUT_MS
    });
    capture=result as ScreenshotOneCapture;
    if(!capture?.bytes?.length) throw new Error("SCREENSHOTONE_EMPTY");
    input.state.toolCalls++;
    input.state.previousToolResults.push("direct:screenshotone.capture:SUCCESS");
    input.state.availableTools=[...new Set([...input.state.availableTools,"direct:screenshotone.capture"])].slice(-60);
  }catch(e:any){
    const msg=e?.message??"SCREENSHOTONE_FAILED";
    input.state.warnings.push(`${input.sourceId??"source"}:SCREENSHOT:${msg}`);
    return {captured:false,skipped:msg};
  }

  const observe=deps.observeText??observeImageText;
  let vision:VisionObservation={ok:false,reason:"NVIDIA_VISION_UNAVAILABLE"};
  try{
    if(!keys.NVIDIA_API_KEY?.trim()){
      vision={ok:false,reason:"NVIDIA_VISION_UNAVAILABLE"};
    }else if(input.state.modelCalls>=env.MAX_MODEL_CALLS){
      vision={ok:false,reason:"MODEL_BUDGET_EXHAUSTED"};
    }else{
      input.state.modelCalls++;
      vision=await observe({
        bytes:capture.bytes,
        contentType:capture.contentType,
        sourceUrl:input.sourceUrl
      },keys,{fetch:deps.fetch});
    }
  }catch(e:any){
    vision={ok:false,reason:e?.message??"NVIDIA_VISION_FAILED"};
  }

  const observedText=vision.ok?vision.text:undefined;
  const persistTool=deps.persistTool??defaultPersistTool;
  const toolExecutionId=await persistTool({
    validationId:input.validationId,
    tool:"direct:screenshotone.capture",
    action:"PUBLIC_RECORD_LOOKUP",
    args:{url:input.sourceUrl},
    result:{
      provider:capture.provider,
      slug:capture.slug,
      url:capture.url,
      contentType:capture.contentType,
      byteLength:capture.byteLength,
      sha256:capture.sha256,
      urls:capture.urls,
      vision_ok:vision.ok,
      vision_reason:vision.ok?undefined:vision.reason
    }
  });

  let screenshotId:string|undefined;
  const save=deps.saveScreenshot??saveValidationScreenshot;
  try{
    const saved=await save({
      validationId:input.validationId,
      sourceUrl:input.sourceUrl,
      sourceId:input.sourceId,
      fileName:screenshotFileName(input.sourceUrl,capture.contentType),
      contentType:capture.contentType,
      bytes:capture.bytes,
      observedText,
      visionModel:vision.ok?vision.model:undefined,
      toolExecutionId
    });
    screenshotId=saved.id;
  }catch(e:any){
    input.state.warnings.push(`${input.sourceId??"source"}:SCREENSHOT_STORE:${e?.message??"FAILED"}`);
  }

  const recordEvidence=deps.addEvidence??addEvidence;
  try{
    await recordEvidence(input.validationId,{
      claim:CLAIMS.OFFICIAL_SOURCE_SCREENSHOT_OBSERVED,
      epistemicState:"KNOWN",
      sourceId:input.sourceId,
      sourceUrl:input.sourceUrl,
      sourceType:"SEARCH_DISCOVERY",
      toolExecutionId,
      payload:screenshotObservationPayload({
        sourceUrl:input.sourceUrl,
        screenshotId,
        observedText,
        vision,
        sha256:capture.sha256,
        contentType:capture.contentType
      })
    });
  }catch(e:any){
    input.state.warnings.push(`${input.sourceId??"source"}:SCREENSHOT_EVIDENCE:${e?.message??"FAILED"}`);
  }

  return {captured:true,screenshotId,toolExecutionId,observedText,vision};
}

export async function observeOfficialSourceScreenshot(
  validationId:string,
  state:SelfState,
  source:{id?:string;url:string},
  deps:OfficialScreenshotDeps={}
){
  try{
    return await captureAndObserveOfficialSource({
      validationId,
      state,
      sourceUrl:source.url,
      sourceId:source.id
    },deps);
  }catch(e:any){
    state.warnings.push(`${source.id??"source"}:SCREENSHOT:${e?.message??"FAILED"}`);
    return {captured:false,skipped:e?.message??"SCREENSHOT_FAILED"} satisfies OfficialScreenshotResult;
  }
}
