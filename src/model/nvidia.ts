// Deprecated compatibility shim. Production model execution has moved to Bitdeer.
// Keep this module temporarily so older imports fail soft instead of breaking deploys.
export {MODEL_CONTRACT,reasonJson,observeImageText} from "./bitdeer.js";
export type {BitdeerVisionConfig as NvidiaVisionConfig,VisionObservation} from "./bitdeer.js";

export const DEFAULT_NVIDIA_VISION_MODEL="UNAVAILABLE_BITDEER_VISION_NOT_CONFIGURED";
export const VISION_OCR_CONTRACT="Vision OCR is unavailable until a supported Bitdeer multimodal model is configured.";

export async function embed(_inputs:string[],_inputType:"query"|"passage"="passage"):Promise<number[][]>{
  throw new Error("NVIDIA_PROVIDER_REMOVED");
}
