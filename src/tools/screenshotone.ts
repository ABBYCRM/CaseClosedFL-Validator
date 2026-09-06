import crypto from "node:crypto";
import { assertSafePublicUrl } from "./http.js";

export const SCREENSHOTONE_TAKE_URL="https://api.screenshotone.com/take";

export interface ScreenshotOneKeys {
  SCREENSHOTONE_ACCESS_KEY?:string;
  SCREENSHOTONE_SECRET_KEY?:string;
}

export interface ScreenshotOneCaptureOptions {
  fetch?:typeof fetch;
  timeoutMs?:number;
  params?:Record<string,string>;
}

export interface ScreenshotOneCapture {
  provider:"screenshotone";
  slug:"direct:screenshotone.capture";
  url:string;
  contentType:string;
  bytes:Buffer;
  byteLength:number;
  sha256:string;
  urls:string[];
}

function keyed(value?:string){
  return typeof value==="string"&&value.trim().length>0;
}

export function screenshotOneConfigured(keys:ScreenshotOneKeys){
  return keyed(keys.SCREENSHOTONE_ACCESS_KEY)&&keyed(keys.SCREENSHOTONE_SECRET_KEY);
}

/** Keep URL punctuation readable so the signed string matches ScreenshotOne's documented `url=https://apple.com` form. Encode query separators. */
export function encodeScreenshotOneValue(value:string){
  return encodeURIComponent(value)
    .replace(/%3A/gi,":")
    .replace(/%2F/gi,"/")
    .replace(/%3F/gi,"?")
    .replace(/%3D/gi,"=")
    .replace(/%40/gi,"@");
}

export function canonicalScreenshotOneQuery(params:Record<string,string>){
  return Object.entries(params)
    .filter(([key,value])=>key!=="signature"&&key!=="secret_key"&&value!==undefined&&value!=="")
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([key,value])=>`${encodeScreenshotOneValue(key)}=${encodeScreenshotOneValue(value)}`)
    .join("&");
}

export function signScreenshotOneQuery(queryString:string,secretKey:string){
  if(!keyed(secretKey)) throw new Error("SCREENSHOTONE_SECRET_KEY_REQUIRED");
  return crypto.createHmac("sha256",secretKey).update(queryString).digest("hex");
}

export function buildSignedScreenshotOneTakeUrl(pageUrl:string,keys:ScreenshotOneKeys,extra:Record<string,string>={}){
  if(!screenshotOneConfigured(keys)) throw new Error("SCREENSHOTONE_NOT_CONFIGURED");
  const params:Record<string,string>={
    access_key:keys.SCREENSHOTONE_ACCESS_KEY!.trim(),
    format:"jpg",
    url:pageUrl,
    ...extra
  };
  delete params.secret_key;
  delete params.signature;
  const query=canonicalScreenshotOneQuery(params);
  const signature=signScreenshotOneQuery(query,keys.SCREENSHOTONE_SECRET_KEY!.trim());
  return `${SCREENSHOTONE_TAKE_URL}?${query}&signature=${signature}`;
}

export function signedQueryContainsSecret(queryOrUrl:string){
  return /(?:^|[?&])secret_key=/.test(queryOrUrl);
}

export async function captureScreenshotOne(pageUrl:string,keys:ScreenshotOneKeys,opts:ScreenshotOneCaptureOptions={}):Promise<ScreenshotOneCapture>{
  const url=assertSafePublicUrl(pageUrl).toString();
  const takeUrl=buildSignedScreenshotOneTakeUrl(url,keys,opts.params);
  if(signedQueryContainsSecret(takeUrl)) throw new Error("SCREENSHOTONE_SECRET_LEAKED");
  const fetchImpl=opts.fetch??fetch;
  const timeoutMs=opts.timeoutMs??20_000;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetchImpl(takeUrl,{method:"GET",signal:controller.signal});
    const buf=Buffer.from(await r.arrayBuffer());
    if(!r.ok){
      const hint=buf.toString("utf8").slice(0,400);
      throw new Error(`SCREENSHOTONE_${r.status}:${hint}`);
    }
    const contentType=r.headers.get("content-type")??"image/jpeg";
    if(!contentType.startsWith("image/")&&!looksLikeImage(buf)){
      throw new Error(`SCREENSHOTONE_NOT_IMAGE:${contentType}:${buf.toString("utf8").slice(0,200)}`);
    }
    return {
      provider:"screenshotone",
      slug:"direct:screenshotone.capture",
      url,
      contentType:contentType.split(";")[0]||"image/jpeg",
      bytes:buf,
      byteLength:buf.length,
      sha256:crypto.createHash("sha256").update(buf).digest("hex"),
      urls:[url]
    };
  }finally{
    clearTimeout(timer);
  }
}

function looksLikeImage(buf:Buffer){
  return buf.length>8&&(
    buf[0]===0xff&&buf[1]===0xd8||
    buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4e&&buf[3]===0x47
  );
}

export function screenshotToolResult(capture:ScreenshotOneCapture){
  return {
    provider:capture.provider,
    slug:capture.slug,
    url:capture.url,
    contentType:capture.contentType,
    byteLength:capture.byteLength,
    sha256:capture.sha256,
    urls:capture.urls
  };
}
