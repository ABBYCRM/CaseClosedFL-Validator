import {describe,it,expect,vi} from "vitest";
import {
  buildSignedScreenshotOneTakeUrl,
  canonicalScreenshotOneQuery,
  captureScreenshotOne,
  encodeScreenshotOneValue,
  SCREENSHOTONE_TAKE_URL,
  signScreenshotOneQuery,
  signedQueryContainsSecret
} from "../src/tools/screenshotone.js";
import {executeDirectTool} from "../src/tools/direct.js";
import {captureAndObserveOfficialSource,screenshotObservationPayload} from "../src/tools/official-screenshot.js";
import {CLAIMS} from "../src/evidence/claims.js";
import {initialState} from "../src/agent/state.js";

const DOCS_QUERY="access_key=0Ij4LFMtFnGUrA&url=https://apple.com";
const DOCS_SECRET="m9ajW9br9hTw2A";
const DOCS_SIGNATURE="70bea3e52efc43834129ecbea236f38bf9bb4a7cd7c2e1951017435defd4dbaf";
function jpegBytes(){return Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0xff,0xd9]);}

describe("ScreenshotOne HMAC signing",()=>{
  it("matches the documented apple.com HMAC-SHA256 example",()=>{expect(signScreenshotOneQuery(DOCS_QUERY,DOCS_SECRET)).toBe(DOCS_SIGNATURE);});
  it("canonicalizes params in sorted order without sending secret_key",()=>{const query=canonicalScreenshotOneQuery({url:"https://apple.com",secret_key:"must-not-appear",access_key:"0Ij4LFMtFnGUrA",signature:"stale"});expect(query).toBe(DOCS_QUERY);expect(query).not.toContain("secret_key");expect(query).not.toContain("signature=");expect(signedQueryContainsSecret(query)).toBe(false);});
  it("keeps URL punctuation unencoded so the signed string matches the docs pattern",()=>{expect(encodeScreenshotOneValue("https://apple.com")).toBe("https://apple.com");expect(canonicalScreenshotOneQuery({access_key:"ak",url:"https://example.com/path?x=1&y=2"})).toBe("access_key=ak&url=https://example.com/path?x=1%26y=2");});
  it("appends signature hex and never adds secret_key to the take URL",()=>{const take=buildSignedScreenshotOneTakeUrl("https://example.com",{SCREENSHOTONE_ACCESS_KEY:"ak_live",SCREENSHOTONE_SECRET_KEY:"sk_live"});const signed=take.slice(`${SCREENSHOTONE_TAKE_URL}?`.length);const query=signed.replace(/&signature=[0-9a-f]+$/,"");expect(take.startsWith(`${SCREENSHOTONE_TAKE_URL}?`)).toBe(true);expect(signedQueryContainsSecret(take)).toBe(false);expect(take).toContain("&signature=");expect(take).toContain("access_key=ak_live");expect(take).toContain("url=https://example.com");expect(signScreenshotOneQuery(query,"sk_live")).toBe(signed.split("&signature=")[1]);});
});

describe("mocked ScreenshotOne capture",()=>{
  it("GETs a signed take URL and returns image bytes",async()=>{const image=jpegBytes();const fetchMock=vi.fn(async(url:string)=>{expect(String(url).startsWith(SCREENSHOTONE_TAKE_URL)).toBe(true);expect(signedQueryContainsSecret(String(url))).toBe(false);expect(String(url)).toContain("signature=");expect(String(url)).not.toContain("secret_key=");return new Response(image,{status:200,headers:{"content-type":"image/jpeg"}});});const result=await executeDirectTool("direct:screenshotone.capture",{url:"https://example.com"},{SCREENSHOTONE_ACCESS_KEY:"ak",SCREENSHOTONE_SECRET_KEY:"sk"},{fetch:fetchMock as unknown as typeof fetch}) as {slug:string;url:string;bytes:Buffer;byteLength:number};expect(fetchMock).toHaveBeenCalledOnce();expect(result.slug).toBe("direct:screenshotone.capture");expect(result.url).toBe("https://example.com/");expect(result.bytes.equals(image)).toBe(true);expect(result.byteLength).toBe(image.length);});
  it("rejects private URLs before signing",async()=>{await expect(captureScreenshotOne("https://127.0.0.1/",{SCREENSHOTONE_ACCESS_KEY:"ak",SCREENSHOTONE_SECRET_KEY:"sk"})).rejects.toThrow(/PRIVATE_NETWORK_DENIED/);});
});

describe("official screenshot observation",()=>{
  it("records injected OCR text as screenshot-observed evidence, not government truth",async()=>{
    const image=jpegBytes();
    const fetchMock=vi.fn(async(url:string)=>new Response(image,{status:200,headers:{"content-type":"image/jpeg"}}));
    const saved:any[]=[];const evidence:any[]=[];
    const result=await captureAndObserveOfficialSource({validationId:"val-1",state:initialState(),sourceUrl:"https://www.flhsmv.gov/traffic-crash-reports/",sourceId:"FL_CRASH"},{
      keys:{SCREENSHOTONE_ACCESS_KEY:"ak",SCREENSHOTONE_SECRET_KEY:"sk",BITDEER_API_KEY:"configured",TOOL_TIMEOUT_MS:5000},
      fetch:fetchMock as unknown as typeof fetch,
      observeText:async()=>({ok:true,text:"Crash reports\nFlorida Highway Safety",model:"test-vision-model"}),
      alreadyCaptured:async()=>false,
      saveScreenshot:async(row)=>{saved.push(row);return{id:"shot-1"};},
      addEvidence:async(_id,e)=>{evidence.push(e);return{id:"ev-1"};},persistTool:async()=>"tool-1"
    });
    expect(result.captured).toBe(true);expect(result.observedText).toContain("Florida Highway Safety");expect(saved[0]?.bytes.equals(image)).toBe(true);expect(evidence[0]?.claim).toBe(CLAIMS.OFFICIAL_SOURCE_SCREENSHOT_OBSERVED);expect(evidence[0]?.sourceType).toBe("SEARCH_DISCOVERY");expect(evidence[0]?.payload.disclaimer).toMatch(/not independently verified government-record truth/i);expect(evidence[0]?.payload.observed_text).toContain("Florida Highway Safety");
  });
  it("fails soft to capture-only when Bitdeer vision is unavailable",async()=>{
    const image=jpegBytes();const fetchMock=vi.fn(async()=>new Response(image,{status:200,headers:{"content-type":"image/jpeg"}}));const evidence:any[]=[];
    const result=await captureAndObserveOfficialSource({validationId:"val-2",state:initialState(),sourceUrl:"https://example.com/",sourceId:"EX"},{keys:{SCREENSHOTONE_ACCESS_KEY:"ak",SCREENSHOTONE_SECRET_KEY:"sk",TOOL_TIMEOUT_MS:5000},fetch:fetchMock as unknown as typeof fetch,alreadyCaptured:async()=>false,saveScreenshot:async()=>({id:"shot-2"}),addEvidence:async(_id,e)=>{evidence.push(e);return{id:"ev-2"};},persistTool:async()=>"tool-2"});
    expect(result.captured).toBe(true);expect(result.vision?.ok).toBe(false);expect(evidence[0]?.payload.vision_unavailable).toBe(true);expect(screenshotObservationPayload({sourceUrl:"https://example.com/",vision:{ok:false,reason:"BITDEER_VISION_MODEL_NOT_CONFIGURED"}}).observation).toBe("text observed in screenshot");
  });
});

const live=Boolean(process.env.SCREENSHOTONE_ACCESS_KEY&&process.env.SCREENSHOTONE_SECRET_KEY);
(live?describe:describe.skip)("live ScreenshotOne signed take",()=>{it("takes https://example.com with a signed request",async()=>{const result=await captureScreenshotOne("https://example.com",{SCREENSHOTONE_ACCESS_KEY:process.env.SCREENSHOTONE_ACCESS_KEY,SCREENSHOTONE_SECRET_KEY:process.env.SCREENSHOTONE_SECRET_KEY},{timeoutMs:30_000});expect(result.byteLength).toBeGreaterThan(100);expect(result.contentType).toMatch(/image\//);expect(result.url).toContain("example.com");},35_000);});
