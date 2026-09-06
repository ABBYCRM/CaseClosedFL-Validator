import {describe,it,expect,vi} from "vitest";
import {createSession,extractSearchTools,searchTools,sessionCreateBody} from "../src/tools/composio.js";

const cfg={
  COMPOSIO_API_KEY:"ak_test",
  COMPOSIO_BASE_URL:"https://backend.composio.dev",
  COMPOSIO_USER_ID:"caseclosedfl-validator",
  COMPOSIO_TOOLKITS:["tavily","exa","firecrawl","serpapi","browser_tool"],
  TOOL_TIMEOUT_MS:5000
};

function jsonResponse(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}

describe("Composio session create payload",()=>{
  it("uses toolkits.enable and omits enabled",()=>{
    const body=sessionCreateBody("caseclosedfl-validator",cfg.COMPOSIO_TOOLKITS);
    expect(body).toEqual({
      user_id:"caseclosedfl-validator",
      toolkits:{enable:["tavily","exa","firecrawl","serpapi","browser_tool"]}
    });
    expect(body.toolkits).not.toHaveProperty("enabled");
  });
  it("omits toolkits when the allowlist is empty",()=>{
    expect(sessionCreateBody("caseclosedfl-validator",[])).toEqual({user_id:"caseclosedfl-validator"});
  });
  it("POSTs enable (not enabled) through createSession",async()=>{
    const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body??"{}"));
      expect(body.user_id).toBe("caseclosedfl-validator");
      expect(body.toolkits).toEqual({enable:cfg.COMPOSIO_TOOLKITS});
      expect(body.toolkits.enabled).toBeUndefined();
      return jsonResponse({session_id:"trs_test"},201);
    });
    const session=await createSession(cfg,{fetch:fetchMock as unknown as typeof fetch});
    expect(session).toEqual({id:"trs_test"});
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://backend.composio.dev/api/v3.1/tool_router/session");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string,string>)["x-api-key"]).toBe("ak_test");
  });
  it("omits the toolkits field when COMPOSIO_TOOLKITS is empty",async()=>{
    const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body??"{}"));
      expect(body).toEqual({user_id:"caseclosedfl-validator"});
      expect(body).not.toHaveProperty("toolkits");
      return jsonResponse({session_id:"trs_open"},201);
    });
    await createSession({...cfg,COMPOSIO_TOOLKITS:[]},{fetch:fetchMock as unknown as typeof fetch});
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("Composio v3.1 search parsing",()=>{
  it("sends queries[].use_case and reads results + tool_schemas",async()=>{
    const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body??"{}"));
      expect(body).toEqual({queries:[{use_case:"search the public web and return source URLs and snippets"}]});
      return jsonResponse({
        success:true,
        results:[{
          index:1,
          use_case:"search the public web and return source URLs and snippets",
          primary_tool_slugs:["TAVILY_SEARCH","EXA_SEARCH"],
          related_tool_slugs:["SERPAPI_SEARCH"],
          toolkits:["tavily","exa","serpapi"]
        }],
        tool_schemas:{
          TAVILY_SEARCH:{toolkit:"tavily",tool_slug:"TAVILY_SEARCH",description:"Search the web",input_schema:{type:"object",properties:{query:{type:"string"}}}},
          EXA_SEARCH:{toolkit:"exa",tool_slug:"EXA_SEARCH",description:"Neural search",input_schema:{type:"object",properties:{query:{type:"string"}}}},
          SERPAPI_SEARCH:{toolkit:"serpapi",tool_slug:"SERPAPI_SEARCH",description:"SERP search"}
        }
      });
    });
    const tools=await searchTools("trs_test","search the public web and return source URLs and snippets",cfg,{
      fetch:fetchMock as unknown as typeof fetch
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://backend.composio.dev/api/v3.1/tool_router/session/trs_test/search");
    expect(tools.map(t=>t.slug)).toEqual(["TAVILY_SEARCH","EXA_SEARCH","SERPAPI_SEARCH"]);
    expect(tools[0]?.toolkit).toBe("tavily");
    expect(tools[0]?.input_schema).toEqual({type:"object",properties:{query:{type:"string"}}});
  });
  it("still extracts the legacy tools array",()=>{
    expect(extractSearchTools({
      tools:[{slug:"TAVILY_SEARCH",toolkit:"tavily",description:"legacy"}]
    })).toEqual([{slug:"TAVILY_SEARCH",name:undefined,description:"legacy",input_schema:undefined,toolkit:"tavily"}]);
  });
  it("extracts slugs from execute_meta data wrappers",()=>{
    expect(extractSearchTools({
      data:{
        results:[{primary_tool_slugs:["FIRECRAWL_SEARCH","SERPAPI_SEARCH"],related_tool_slugs:[]}],
        tool_schemas:{
          FIRECRAWL_SEARCH:{toolkit:"firecrawl",tool_slug:"FIRECRAWL_SEARCH",description:"Search and scrape"},
          SERPAPI_SEARCH:{toolkit:"serpapi",tool_slug:"SERPAPI_SEARCH"}
        },
        toolkit_connection_statuses:[{toolkit:"firecrawl",has_active_connection:false}]
      },
      error:null
    }).map(t=>t.slug)).toEqual(["FIRECRAWL_SEARCH","SERPAPI_SEARCH"]);
  });
  it("falls back to execute_meta COMPOSIO_SEARCH_TOOLS when /search rejects query",async()=>{
    const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
      const path=String(url);
      const body=JSON.parse(String(init?.body??"{}"));
      if(path.endsWith("/search")){
        expect(body.query).toBeUndefined();
        expect(body.queries).toEqual([{use_case:"web search tavily"}]);
        return jsonResponse({error:{message:"payload.queries: Required"}},400);
      }
      expect(path.endsWith("/execute_meta")).toBe(true);
      expect(body.slug).toBe("COMPOSIO_SEARCH_TOOLS");
      expect(body.arguments.query).toBe("web search tavily");
      expect(body.arguments.queries).toEqual([{use_case:"web search tavily"}]);
      return jsonResponse({
        data:{
          results:[{primary_tool_slugs:["FIRECRAWL_SEARCH","SERPAPI_GOOGLE_SEARCH"],related_tool_slugs:[]}],
          tool_schemas:{
            FIRECRAWL_SEARCH:{toolkit:"firecrawl",tool_slug:"FIRECRAWL_SEARCH"},
            SERPAPI_GOOGLE_SEARCH:{toolkit:"serpapi",tool_slug:"SERPAPI_GOOGLE_SEARCH"}
          }
        },
        error:null
      });
    });
    const tools=await searchTools("trs_test","web search tavily",cfg,{fetch:fetchMock as unknown as typeof fetch});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tools.map(t=>t.slug)).toEqual(["FIRECRAWL_SEARCH","SERPAPI_GOOGLE_SEARCH"]);
  });
});
