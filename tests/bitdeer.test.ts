import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {z} from "zod";
import {env} from "../src/config/env.js";
import {embed,observeImageText,reasonJson,rerank} from "../src/model/bitdeer.js";

const originalFetch=globalThis.fetch;
const originalKey=env.BITDEER_API_KEY;
const originalBase=env.BITDEER_BASE_URL;
const originalEmbedDimensions=env.BITDEER_EMBED_DIMENSIONS;

beforeEach(()=>{
  env.BITDEER_API_KEY="test-key";
  env.BITDEER_BASE_URL="https://api-inference.bitdeer.ai/v1";
  env.BITDEER_EMBED_DIMENSIONS=3;
});
afterEach(()=>{
  globalThis.fetch=originalFetch;
  env.BITDEER_API_KEY=originalKey;
  env.BITDEER_BASE_URL=originalBase;
  env.BITDEER_EMBED_DIMENSIONS=originalEmbedDimensions;
  vi.restoreAllMocks();
});

describe("Bitdeer reasoning provider",()=>{
  it("routes routine structured extraction to GLM-5",async()=>{
    const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body??"{}"));
      expect(body.model).toBe("zai-org/GLM-5");
      expect(body.temperature).toBeLessThanOrEqual(0.1);
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer test-key");
      return new Response(JSON.stringify({choices:[{message:{content:'{"value":"ok"}'}}]}),{status:200,headers:{"content-type":"application/json"}});
    });
    globalThis.fetch=fetchMock as unknown as typeof fetch;
    const result=await reasonJson({input:"small"},z.object({value:z.string()}),"Extract explicit fault fields");
    expect(result).toEqual({value:"ok"});
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("routes document-integrity and forensic synthesis to Mistral Large 3",async()=>{
    const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body??"{}"));
      expect(body.model).toBe("mistralai/Mistral-Large-3-675B-Instruct-2512");
      expect(body.temperature).toBeLessThanOrEqual(0.05);
      return new Response(JSON.stringify({choices:[{message:{content:'```json\n{"verdict":"MANUAL_REVIEW"}\n```'}}]}),{status:200,headers:{"content-type":"application/json"}});
    });
    globalThis.fetch=fetchMock as unknown as typeof fetch;
    const result=await reasonJson({findings:["x"]},z.object({verdict:z.string()}),"Forensic document integrity synthesis");
    expect(result.verdict).toBe("MANUAL_REVIEW");
  });
});

describe("Bitdeer embeddings",()=>{
  it("uses Nemotron 3 Embed and distinct query/passage prefixes",async()=>{
    const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
      expect(String(url)).toBe("https://api-inference.bitdeer.ai/v1/embeddings");
      const body=JSON.parse(String(init?.body??"{}"));
      expect(body.model).toBe("nvidia/Nemotron-3-Embed-8B-BF16");
      expect(body.input).toEqual(["query: crash report number"]);
      return new Response(JSON.stringify({data:[{index:0,embedding:[0.1,0.2,0.3]}]}),{status:200,headers:{"content-type":"application/json"}});
    });
    globalThis.fetch=fetchMock as unknown as typeof fetch;
    await expect(embed(["crash report number"],"query")).resolves.toEqual([[0.1,0.2,0.3]]);
  });

  it("rejects embeddings with the wrong vector dimension",async()=>{
    globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify({data:[{index:0,embedding:[0.1,0.2]}]}),{status:200,headers:{"content-type":"application/json"}})) as unknown as typeof fetch;
    await expect(embed(["document"],"passage")).rejects.toThrow(/BITDEER_INVALID_EMBEDDING_RESPONSE/);
  });
});

describe("Bitdeer reranker",()=>{
  it("uses BAAI/bge-reranker-v2-m3 and returns relevance order",async()=>{
    const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
      expect(String(url)).toBe("https://api-inference.bitdeer.ai/v1/rerank");
      const body=JSON.parse(String(init?.body??"{}"));
      expect(body.model).toBe("BAAI/bge-reranker-v2-m3");
      expect(body.top_n).toBe(2);
      return new Response(JSON.stringify({results:[{index:1,relevance_score:0.97},{index:0,relevance_score:0.23}]}),{status:200,headers:{"content-type":"application/json"}});
    });
    globalThis.fetch=fetchMock as unknown as typeof fetch;
    const result=await rerank("capital of France",["Brasilia","Paris","cow"],2);
    expect(result.map(x=>x.index)).toEqual([1,0]);
    expect(result[0]?.document).toBe("Paris");
  });
});

describe("vision boundary",()=>{
  it("fails soft instead of pretending text-only Bitdeer models performed vision",async()=>{
    await expect(observeImageText()).resolves.toEqual({ok:false,reason:"BITDEER_VISION_MODEL_NOT_CONFIGURED"});
  });
});
