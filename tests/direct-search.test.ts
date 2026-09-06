import {describe,it,expect,vi} from "vitest";
import {Lead} from "../src/validation/schema.js";
import {sourcesFor} from "../src/knowledge/registry.js";
import {requiresAuthorization} from "../src/validation/source-check.js";
import {
  biasSearchQuery,
  executeDirectTool,
  officialSearchQuery,
  selectDirectFallbacks,
  selectRunnableFallbacks
} from "../src/tools/direct.js";

const flCrash=()=>sourcesFor("FL","AUTO_ACCIDENT","INCIDENT_EXISTENCE")[0]!;
const caCrash=()=>sourcesFor("CA","AUTO_ACCIDENT","INCIDENT_EXISTENCE")[0]!;

function jsonResponse(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}

describe("direct fallback selection",()=>{
  it("uses Exa and Tavily for WEB_SEARCH when keyed",()=>{
    expect(selectDirectFallbacks("WEB_SEARCH",{EXA_API_KEY:"x",TAVILY_API_KEY:"y"}))
      .toEqual(["direct:exa.search","direct:tavily.search"]);
  });
  it("uses Firecrawl, ScrapingBee, and Scrapfly for WEB_EXTRACT",()=>{
    expect(selectDirectFallbacks("WEB_EXTRACT",{
      FIRECRAWL_API_KEY:"f",SCRAPINGBEE_API_KEY:"b",SCRAPFLY_API_KEY:"s"
    })).toEqual(["direct:firecrawl.scrape","direct:scrapingbee.scrape","direct:scrapfly.scrape"]);
  });
  it("prefers Steel then Firecrawl/ScrapingBee for public-record lookup",()=>{
    expect(selectDirectFallbacks("PUBLIC_RECORD_LOOKUP",{
      STEEL_API_KEY:"st",FIRECRAWL_API_KEY:"f",SCRAPINGBEE_API_KEY:"b",SCRAPFLY_API_KEY:"ignored"
    })).toEqual(["direct:steel.scrape","direct:firecrawl.scrape","direct:scrapingbee.scrape"]);
  });
  it("maps registry capabilities to search then official-URL extract",()=>{
    expect(selectDirectFallbacks("BUSINESS_SEARCH",{EXA_API_KEY:"x",FIRECRAWL_API_KEY:"f"}))
      .toEqual(["direct:exa.search","direct:firecrawl.scrape"]);
  });
  it("skips scrape tools when no official URL is present",()=>{
    expect(selectRunnableFallbacks("WEB_EXTRACT",{FIRECRAWL_API_KEY:"f"},{query:"x"})).toEqual([]);
    expect(selectRunnableFallbacks("WEB_SEARCH",{EXA_API_KEY:"x"},{query:"x"})).toEqual(["direct:exa.search"]);
  });
  it("returns no fallbacks when no direct keys are present",()=>{
    expect(selectDirectFallbacks("WEB_SEARCH",{})).toEqual([]);
  });
});

describe("jurisdiction source query bias",()=>{
  it("includes site:host and the official FL crash URL",()=>{
    const source=flCrash();
    const query=officialSearchQuery(source.url,["FL-123","2026-08-01"]);
    expect(source.url).toBe("https://www.flhsmv.gov/traffic-crash-reports/");
    expect(query).toContain("site:www.flhsmv.gov");
    expect(query).toContain(source.url);
    expect(query).toContain("\"FL-123\"");
    expect(query).not.toMatch(/crashdocs|buycrash|lexis/i);
  });
  it("does not invent a portal when biasing an existing query",()=>{
    const source=flCrash();
    const biased=biasSearchQuery("FL-123",source.url);
    expect(biased).toContain("site:www.flhsmv.gov");
    expect(biased).toContain(source.url);
    expect(biased.startsWith("site:www.flhsmv.gov")).toBe(true);
  });
  it("fails closed on AUTHORIZED sources without authorization",()=>{
    const lead=Lead.parse({
      lead_id:"1",
      state:"CA",
      case_type:"AUTO_ACCIDENT",
      incident:{date:"2026-08-01",case_number:"x"},
      qualification:{injured:"YES",primary_fault:"OTHER_PARTY",already_represented:false}
    });
    expect(caCrash().access).toBe("AUTHORIZED");
    expect(requiresAuthorization(caCrash(),lead)).toBe(true);
    expect(requiresAuthorization(caCrash(),Lead.parse({
      ...lead,
      authorization:{external_record_access:true,record_purchase:false}
    }))).toBe(false);
  });
});

describe("mocked direct online search",()=>{
  it("sends the official jurisdiction URL in the Exa query",async()=>{
    const source=flCrash();
    const query=officialSearchQuery(source.url,["FL-123"]);
    const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body??"{}"));
      expect(body.query).toContain("site:www.flhsmv.gov");
      expect(body.query).toContain(source.url);
      expect(body.query).toContain("FL-123");
      return jsonResponse({
        results:[{url:source.url,title:"Florida crash reports",text:"FL-123 public index"}]
      });
    });
    const result=await executeDirectTool(
      "direct:exa.search",
      {query,url:source.url,max_results:8},
      {EXA_API_KEY:"test-exa"},
      {fetch:fetchMock as unknown as typeof fetch}
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.exa.ai/search");
    expect(result.slug).toBe("direct:exa.search");
    expect(result.urls).toContain(source.url);
  });
  it("scrapes the official source URL with Firecrawl",async()=>{
    const source=flCrash();
    const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body??"{}"));
      expect(body.url).toBe(source.url);
      return jsonResponse({data:{markdown:`# Crash reports\n${source.url}`,links:[source.url]}});
    });
    const result=await executeDirectTool(
      "direct:firecrawl.scrape",
      {url:source.url},
      {FIRECRAWL_API_KEY:"test-firecrawl"},
      {fetch:fetchMock as unknown as typeof fetch}
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(result.url).toBe(source.url);
    expect(result.urls).toContain(source.url);
  });
});
