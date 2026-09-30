import {beforeEach,describe,expect,it} from "vitest";
import {enrichmentSignals,formatEnrichmentLines,parseSdnCsv,resetEnrichmentCacheForTests,runLeadEnrichment,withEnrichment} from "../src/validation/enrichment.js";
import {assessLeadQuality,finalVerdict} from "../src/validation/lead-quality.js";

const SDN=['1,"DOE, John",individual,"SDGT",-0-'].concat(Array.from({length:1200},(_,i)=>`${i+2},"PERSON${i}, Name",individual,"X",-0-`)).join("\n");
const lead=(extra:Record<string,unknown>={})=>({client:{first_name:"Jane",last_name:"Rivera",email:"jane.rivera.fixture@gmail.com",phone:"+14078392217"},state:"FL",medical:{},metadata:{},documents:[],...extra}) as any;

function mockFetch(ipqs:{email?:any;phone?:any;ip?:any},calls:string[]=[]){
  return async(url:string)=>{
    calls.push(url);
    const body=url.includes("/json/email/")?ipqs.email:url.includes("/json/phone/")?ipqs.phone:url.includes("/json/ip/")?ipqs.ip:url.includes("npiregistry")?{result_count:0,results:[]}:undefined;
    if(url.includes("ofac")) return {ok:true,status:200,json:async()=>({}),text:async()=>SDN};
    if(body===undefined) throw new Error("fetch failed");
    return {ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)};
  };
}
const OK_EMAIL={success:true,valid:true,disposable:false,fraud_score:0};
const OK_PHONE={success:true,valid:true,VOIP:false,risky:false,line_type:"Wireless",fraud_score:0};
const base=assessLeadQuality({name:"Jane Rivera",phone:"+14078392217",email:"jane.rivera.fixture@gmail.com",state:"FL",zip:"33401"});
const grade=async(ipqs:{email?:any;phone?:any;ip?:any},l=lead())=>{
  const r=await runLeadEnrichment(l,{enabled:true,apiKey:"k",fetch:mockFetch(ipqs) as any});
  return {r,v:finalVerdict(withEnrichment(base,r),"VALIDATED",undefined,"PASS").verdict};
};

describe("IPQS / NPPES / OFAC enrichment",()=>{
  beforeEach(()=>resetEnrichmentCacheForTests());
  it("clean IPQS results keep GOOD",async()=>{expect((await grade({email:OK_EMAIL,phone:OK_PHONE})).v).toBe("GOOD");});
  it("disposable email -> JUNK",async()=>{expect((await grade({email:{...OK_EMAIL,disposable:true},phone:OK_PHONE})).v).toBe("JUNK");});
  it("invalid phone -> JUNK",async()=>{expect((await grade({email:OK_EMAIL,phone:{...OK_PHONE,valid:false}})).v).toBe("JUNK");});
  it("risky VOIP phone -> JUNK",async()=>{expect((await grade({email:OK_EMAIL,phone:{...OK_PHONE,VOIP:true,risky:true}})).v).toBe("JUNK");});
  it("fraud score 92 -> JUNK; 80 -> NEEDS_REVIEW",async()=>{
    expect((await grade({email:{...OK_EMAIL,fraud_score:92},phone:OK_PHONE})).v).toBe("JUNK");
    resetEnrichmentCacheForTests();
    expect((await grade({email:{...OK_EMAIL,fraud_score:80},phone:OK_PHONE})).v).toBe("NEEDS_REVIEW");
  });
  it("proxy/VPN IP -> NEEDS_REVIEW (not stacked to JUNK with a 75-89 score)",async()=>{
    const {v}=await grade({email:{...OK_EMAIL,fraud_score:78},phone:OK_PHONE,ip:{success:true,proxy:true,vpn:true,fraud_score:10}},lead({metadata:{ip:"8.8.8.8"}}));
    expect(v).toBe("NEEDS_REVIEW");
  });
  it("IPQS failure/timeout -> NOT RUN, grade unchanged, key never echoed",async()=>{
    const {r,v}=await grade({email:{success:false,message:"Invalid key: k"}});
    expect(v).toBe("GOOD");
    const lines=formatEnrichmentLines(r).join("\n");
    expect(lines).toMatch(/IPQS email: NOT RUN \(IPQS: /);
    expect(lines).toMatch(/IPQS phone: NOT RUN \(IPQS fetch failed\)/);
    expect(lines).toContain("IPQS IP: NOT RUN (no lead IP on file)");
    expect(lines).toContain("NPI registry (NPPES): NOT RUN (no provider/doctor name on lead)");
    expect(lines).not.toMatch(/key: k\b/);
  });
  it("no API key -> NOT RUN, no IPQS calls",async()=>{
    const calls:string[]=[];
    const r=await runLeadEnrichment(lead(),{enabled:true,apiKey:"",fetch:mockFetch({},calls) as any});
    expect(calls.some(u=>u.includes("ipqualityscore"))).toBe(false);
    expect(enrichmentSignals(r)).toEqual({junk:[],review:[]});
  });
  it("caches IPQS by email/phone: second lead with same contact makes no new IPQS calls",async()=>{
    const calls:string[]=[];
    const f=mockFetch({email:OK_EMAIL,phone:OK_PHONE},calls) as any;
    await runLeadEnrichment(lead(),{enabled:true,apiKey:"k",fetch:f});
    await runLeadEnrichment(lead(),{enabled:true,apiKey:"k",fetch:f});
    expect(calls.filter(u=>u.includes("ipqualityscore")).length).toBe(2);
  });
  it("OFAC name match -> NEEDS_REVIEW; NPPES runs only with a provider name",async()=>{
    expect(parseSdnCsv(SDN).get("DOE")?.[0]?.first.has("JOHN")).toBe(true);
    const {r,v}=await grade({email:OK_EMAIL,phone:OK_PHONE},lead({client:{first_name:"John",last_name:"Doe",email:"jd.fixture@gmail.com",phone:"+14078392217"},medical:{provider_name:"Dr. Ann Lee"}}));
    expect(v).toBe("NEEDS_REVIEW");
    const lines=formatEnrichmentLines(r).join("\n");
    expect(lines).toContain("OFAC SDN name check: POSSIBLE MATCH");
    expect(lines).toContain("NPI registry (NPPES): ran, no NPI match");
  });
});
