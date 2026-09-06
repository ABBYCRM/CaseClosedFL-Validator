import {describe,it,expect,vi} from "vitest";
import {DEFAULT_NVIDIA_VISION_MODEL,observeImageText,VISION_OCR_CONTRACT} from "../src/model/nvidia.js";

function jpegBytes(){
  return Buffer.from([0xff,0xd8,0xff,0xd9]);
}

describe("NVIDIA vision OCR",()=>{
  it("defaults to a vision-capable integrate.api.nvidia.com model",()=>{
    expect(DEFAULT_NVIDIA_VISION_MODEL).toBe("meta/llama-3.2-11b-vision-instruct");
    expect(VISION_OCR_CONTRACT).toMatch(/Do not invent/);
    expect(VISION_OCR_CONTRACT).toMatch(/visibly present/);
  });
  it("sends a multimodal chat completion and returns only model text",async()=>{
    const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
      expect(String(url)).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
      const body=JSON.parse(String(init?.body??"{}"));
      expect(body.model).toBe("nvidia/llama-3.1-nemotron-nano-vl-8b-v1");
      expect(body.messages[1].content[1].type).toBe("image_url");
      expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer nv-test");
      return new Response(JSON.stringify({choices:[{message:{content:"  Visible heading  "}}]}),{
        status:200,headers:{"content-type":"application/json"}
      });
    });
    const result=await observeImageText(
      {bytes:jpegBytes(),contentType:"image/jpeg",sourceUrl:"https://example.com"},
      {
        NVIDIA_API_KEY:"nv-test",
        NVIDIA_BASE_URL:"https://integrate.api.nvidia.com/v1",
        NVIDIA_VISION_MODEL:"nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
        TOOL_TIMEOUT_MS:5000
      },
      {fetch:fetchMock as unknown as typeof fetch}
    );
    expect(result).toEqual({ok:true,text:"Visible heading",model:"nvidia/llama-3.1-nemotron-nano-vl-8b-v1"});
  });
  it("fails soft when the API key or vision model is missing",async()=>{
    const fetchMock=vi.fn();
    const missingKey=await observeImageText(
      {bytes:jpegBytes(),contentType:"image/jpeg",sourceUrl:"https://example.com"},
      {NVIDIA_API_KEY:"",NVIDIA_VISION_MODEL:"meta/llama-3.2-11b-vision-instruct"},
      {fetch:fetchMock as unknown as typeof fetch}
    );
    expect(missingKey).toEqual({ok:false,reason:"NVIDIA_VISION_UNAVAILABLE"});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fails soft on an HTTP error from the vision endpoint",async()=>{
    const fetchMock=vi.fn(async()=>new Response("no vision",{status:404}));
    const result=await observeImageText(
      {bytes:jpegBytes(),contentType:"image/jpeg",sourceUrl:"https://example.com"},
      {
        NVIDIA_API_KEY:"nv-test",
        NVIDIA_BASE_URL:"https://integrate.api.nvidia.com/v1",
        NVIDIA_VISION_MODEL:"meta/llama-3.2-11b-vision-instruct",
        TOOL_TIMEOUT_MS:5000
      },
      {fetch:fetchMock as unknown as typeof fetch}
    );
    expect(result.ok).toBe(false);
    if(!result.ok) expect(result.reason).toMatch(/NVIDIA_VISION_404/);
  });
});
