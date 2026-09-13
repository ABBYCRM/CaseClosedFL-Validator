import {describe,expect,it} from "vitest";
import {
  assertCourtListenerUrl,
  buildCourtListenerQuery,
  COURTLISTENER_DISCLAIMER,
  courtListenerSearchUrl,
  looksLikeCriminalDocket,
  parseCourtListenerSearch,
  runCourtListener
} from "../src/integrations/osint/adapters/courtlistener.js";
import {osintConfigFrom} from "../src/integrations/osint/config.js";
import {lookupIdentityOsint} from "../src/integrations/osint/lookup.js";
import {formatOsintNoteLines} from "../src/integrations/osint/note.js";
import {OSINT_CONTRACT,type OsintAdapterResult,type OsintLookupReport} from "../src/integrations/osint/types.js";
import {osintChecksIncomplete,scoreStaffVerdict} from "../src/integrations/osint/verdict.js";
import {runParallelFraudEngines} from "../src/validation/fraud/engines.js";
import {buildOutcome} from "../src/validation/outcome.js";
import {Lead} from "../src/validation/schema.js";

const cfg=osintConfigFrom({
  COURTLISTENER_ENABLED:"true",
  COURTLISTENER_API_TOKEN:"test-token",
  COURTLISTENER_BASE_URL:"https://www.courtlistener.com/api/rest/v4"
});

function lead(){
  return Lead.parse({
    lead_id:"cl-1",
    state:"FL",
    case_type:"AUTO_ACCIDENT",
    client:{first_name:"Jane",last_name:"Doe",email:"jane@example.com"},
    incident:{date:"2026-08-20"},
    qualification:{injured:"YES",primary_fault:"OTHER_PARTY",already_represented:false},
    documents:[]
  });
}

function adapter(partial:Partial<OsintAdapterResult>&Pick<OsintAdapterResult,"provider"|"capability"|"target_type">):OsintAdapterResult{
  return{status:"OBSERVED",findings:[],errors:[],checks_performed:[],...partial};
}

function report(partial:Partial<OsintLookupReport>={}):OsintLookupReport{
  return{
    capability:"IDENTITY_OSINT_LOOKUP",
    enabled:true,
    ran:true,
    adapters:[],
    risk_flags:[],
    unavailable:[],
    errors:[],
    contract:OSINT_CONTRACT,
    ...partial
  };
}

const goodCli:OsintAdapterResult[]=[
  adapter({
    provider:"holehe",capability:"EMAIL_REGISTRATION",target_type:"email",
    findings:[{kind:"EMAIL_SITE_REGISTRATION",site:"instagram",observation:"Holehe observed a public registration signal for instagram."}]
  }),
  adapter({
    provider:"phoneinfoga",capability:"PHONE_LOOKUP",target_type:"phone",
    findings:[
      {kind:"PHONE_METADATA",observation:"PhoneInfoga observed country=United States.",signal:"country"},
      {kind:"PHONE_METADATA",observation:"PhoneInfoga observed line_type=mobile.",signal:"line_type"}
    ]
  }),
  adapter({
    provider:"mosint",capability:"EMAIL_RECON",target_type:"email",
    findings:[{kind:"EMAIL_RECON_SIGNAL",observation:"Mosint observed: related domain example.com."}]
  }),
  adapter({
    provider:"h8mail",capability:"LOCAL_BREACH",target_type:"email",
    findings:[{kind:"LOCAL_BREACH_NONE",observation:"h8mail reported no local/public-source hits."}]
  })
];

const civilHit={
  caseName:"Doe v. Acme Logistics",
  court:"District Court, S.D. Florida",
  docketNumber:"1:24-cv-00123",
  dateFiled:"2024-03-01",
  docket_absolute_url:"/docket/99/doe-v-acme/",
  jurisdictionType:"Diversity",
  suitNature:"Motor Vehicle",
  cause:"28:1332 Diversity-Auto Negligence"
};

const criminalHit={
  caseName:"United States v. Doe",
  court:"District Court, S.D. Florida",
  docketNumber:"1:23-cr-00456",
  dateFiled:"2023-11-02",
  docket_absolute_url:"/docket/100/united-states-v-doe/",
  jurisdictionType:"Criminal",
  suitNature:"Criminal",
  cause:"18 USC 1343"
};

describe("CourtListener search helpers",()=>{
  it("builds a party-name RECAP query and keeps search HTTPS-only",()=>{
    expect(buildCourtListenerQuery("Jane Doe")).toBe('party:"Jane Doe"');
    expect(buildCourtListenerQuery("Jane Doe","FL")).toBe('party:"Jane Doe" FL Florida');
    const url=courtListenerSearchUrl("https://www.courtlistener.com/api/rest/v4/","Jane Doe","FL");
    expect(url).toContain("/search/?");
    expect(url).toContain("type=r");
    expect(url).toContain("q=party%3A%22Jane+Doe%22");
    expect(()=>assertCourtListenerUrl(url,"https://www.courtlistener.com/api/rest/v4")).not.toThrow();
    expect(()=>assertCourtListenerUrl("https://pacer.uscourts.gov/recap-fetch","https://www.courtlistener.com/api/rest/v4")).toThrow(/HOST_MISMATCH|SEARCH_ONLY/);
  });

  it("flags criminal dockets only from explicit API labels",()=>{
    expect(looksLikeCriminalDocket(criminalHit)).toBe(true);
    expect(looksLikeCriminalDocket(civilHit)).toBe(false);
    expect(looksLikeCriminalDocket({caseName:"Doe v. Smith",docketNumber:"1:24-cv-9"})).toBe(false);
  });

  it("parses RECAP hits without inventing criminal labels",()=>{
    const none=parseCourtListenerSearch(JSON.stringify({count:0,results:[]}));
    expect(none.findings.some(f=>f.kind==="COURT_DOCKET_NONE")).toBe(true);
    expect(none.findings.map(f=>f.observation).join(" ")).toMatch(/NOT a full criminal background check/i);

    const civil=parseCourtListenerSearch(JSON.stringify({count:1,next:"https://www.courtlistener.com/api/rest/v4/search/?cursor=nope",results:[civilHit]}));
    expect(civil.findings.some(f=>f.kind==="COURT_DOCKET_HIT"&&f.observation.includes("Doe v. Acme Logistics"))).toBe(true);
    expect(civil.findings.some(f=>f.kind==="COURT_CRIMINAL_DOCKET_SIGNAL")).toBe(false);
    expect(civil.findings.some(f=>f.kind==="COURT_NO_CRIMINAL_LABEL")).toBe(true);
    expect(JSON.stringify(civil.findings)).not.toMatch(/recap-fetch|pacer\.uscourts/i);

    const crim=parseCourtListenerSearch(JSON.stringify({count:1,results:[criminalHit]}));
    expect(crim.findings.some(f=>f.kind==="COURT_CRIMINAL_DOCKET_SIGNAL")).toBe(true);
  });
});

describe("CourtListener adapter soft-fail",()=>{
  it("skips without a full name and never invents hits",async()=>{
    const skipped=await runCourtListener(undefined,"FL",cfg,async()=>{throw new Error("should-not-fetch");});
    expect(skipped.status).toBe("SKIPPED");
    expect(skipped.unavailable_reason).toBe("NO_FULL_NAME_SUPPLIED");
    expect(skipped.findings).toEqual([]);
  });

  it("returns UNAVAILABLE when the token is missing, rate-limited, or the request errors",async()=>{
    const noToken=await runCourtListener("Jane Doe","FL",osintConfigFrom({COURTLISTENER_ENABLED:"true"}),async()=>{throw new Error("should-not-fetch");});
    expect(noToken.status).toBe("UNAVAILABLE");
    expect(noToken.unavailable_reason).toBe("COURTLISTENER_API_TOKEN_MISSING");

    const limited=await runCourtListener("Jane Doe","FL",cfg,async()=>({status:429,body:"slow down"}));
    expect(limited.status).toBe("UNAVAILABLE");
    expect(limited.unavailable_reason).toBe("COURTLISTENER_RATE_LIMITED");

    const timed=await runCourtListener("Jane Doe","FL",cfg,async()=>{throw Object.assign(new Error("COURTLISTENER_TIMEOUT"),{code:"TIMEOUT"});});
    expect(timed.status).toBe("UNAVAILABLE");
    expect(timed.unavailable_reason).toBe("COURTLISTENER_TIMEOUT");

    const boom=await runCourtListener("Jane Doe","FL",cfg,async()=>{throw new Error("socket hang up");});
    expect(boom.status).toBe("UNAVAILABLE");
    expect(boom.unavailable_reason).toMatch(/NETWORK_ERROR/);
    expect([noToken,limited,timed,boom].every(a=>a.findings.length===0)).toBe(true);
  });

  it("records mocked RECAP observations from one search only",async()=>{
    const urls:string[]=[];
    const headers:string[]=[];
    const observed=await runCourtListener("Jane Doe","FL",cfg,async(input)=>{
      urls.push(input.url);
      headers.push(input.headers.Authorization??"");
      return{status:200,body:JSON.stringify({count:1,next:"https://www.courtlistener.com/api/rest/v4/search/?cursor=ignored",results:[civilHit]})};
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("type=r");
    expect(headers[0]).toBe("Token test-token");
    expect(headers[0]).not.toMatch(/Bearer/i);
    expect(observed.status).toBe("OBSERVED");
    expect(observed.checks_performed).toEqual(["COURTLISTENER_RECAP_SEARCH"]);
    expect(observed.findings.some(f=>f.kind==="COURT_DOCKET_HIT")).toBe(true);
  });
});

describe("CourtListener in IDENTITY_OSINT_LOOKUP",()=>{
  it("can run when identity CLIs are off",async()=>{
    const result=await lookupIdentityOsint(lead(),{
      config:osintConfigFrom({OSINT_IDENTITY_ENABLED:"false",COURTLISTENER_ENABLED:"true",COURTLISTENER_API_TOKEN:"test-token"}),
      courtHttp:async()=>({status:200,body:JSON.stringify({count:0,results:[]})})
    });
    expect(result.enabled).toBe(true);
    expect(result.ran).toBe(true);
    expect(result.adapters).toHaveLength(1);
    expect(result.adapters[0]?.provider).toBe("courtlistener");
    expect(result.adapters[0]?.status).toBe("OBSERVED");
  });

  it("does not add CourtListener when the flag is off",async()=>{
    const result=await lookupIdentityOsint(lead(),{
      config:osintConfigFrom({OSINT_IDENTITY_ENABLED:"true"}),
      resolve:()=>undefined,
      run:async()=>{throw new Error("should-not-spawn");}
    });
    expect(result.adapters.map(a=>a.provider)).toEqual(["holehe","phoneinfoga","mosint","h8mail"]);
    expect(result.adapters.some(a=>a.provider==="courtlistener")).toBe(false);
  });

  it("attaches UNKNOWN court observations without raising fraud risk",async()=>{
    const osint=await lookupIdentityOsint(lead(),{
      config:osintConfigFrom({OSINT_IDENTITY_ENABLED:"false",COURTLISTENER_ENABLED:"true",COURTLISTENER_API_TOKEN:"test-token"}),
      courtHttp:async()=>({status:200,body:JSON.stringify({count:1,results:[criminalHit]})})
    });
    const fraud=await runParallelFraudEngines(lead(),osint);
    const identity=fraud.verdicts.find(v=>v.engine==="IDENTITY");
    expect(identity?.findings.some(f=>f.result==="UNKNOWN"&&/COURT/i.test(f.finding_type))).toBe(true);
    expect(identity?.verdict).toBe("PASS");
    expect(fraud.aggregate.verdict).toBe("PASS");
    expect(identity?.checks_performed).toContain("COURTLISTENER_RECAP_SEARCH");
  });
});

describe("CourtListener staff verdict + notes",()=>{
  it("does not treat UNAVAILABLE CourtListener as risk when other adapters ran",()=>{
    const osint=report({
      adapters:[
        ...goodCli,
        adapter({
          provider:"courtlistener",capability:"COURT_RECORDS",target_type:"name",
          status:"UNAVAILABLE",unavailable_reason:"COURTLISTENER_RATE_LIMITED"
        })
      ]
    });
    expect(osintChecksIncomplete(osint)).toBe(false);
    const v=scoreStaffVerdict({osint});
    expect(v.level).toBe("GOOD");
    expect(v.observational_flags).toEqual(expect.arrayContaining(["CourtListener unavailable — missing check, not risk"]));
  });

  it("keeps civil docket hits observational — not CAUTION by themselves",()=>{
    const osint=report({
      adapters:[
        ...goodCli,
        adapter({
          provider:"courtlistener",capability:"COURT_RECORDS",target_type:"name",
          findings:[
            {kind:"COURT_DOCKET_COUNT",observation:"1 hit",signal:"1"},
            {kind:"COURT_DOCKET_HIT",observation:"Public RECAP docket observed: case Doe v. Acme Logistics.",signal:"1:24-cv-00123"}
          ]
        })
      ]
    });
    const v=scoreStaffVerdict({osint});
    expect(v.level).toBe("GOOD");
    expect(v.observational_flags.join(" ")).toMatch(/Public court-docket hit/i);
  });

  it("uses CAUTION for an explicit criminal-docket label, and RED FLAG only when stacked",()=>{
    const court=adapter({
      provider:"courtlistener",capability:"COURT_RECORDS",target_type:"name",
      findings:[
        {kind:"COURT_DOCKET_HIT",observation:"Public RECAP docket observed: case United States v. Doe.",signal:"1:23-cr-00456"},
        {kind:"COURT_CRIMINAL_DOCKET_SIGNAL",observation:"explicit criminal-docket wording",signal:"CRIMINAL_LABEL"}
      ]
    });
    const caution=scoreStaffVerdict({osint:report({adapters:[...goodCli,court]})});
    expect(caution.level).toBe("CAUTION");
    expect(caution.reasons.join(" ")).toMatch(/criminal label/i);

    const stacked=[
      adapter({provider:"holehe",capability:"EMAIL_REGISTRATION",target_type:"email",findings:[]}),
      adapter({
        provider:"phoneinfoga",capability:"PHONE_LOOKUP",target_type:"phone",
        findings:[
          {kind:"PHONE_METADATA",observation:"PhoneInfoga observed valid=false.",signal:"valid"},
          {kind:"PHONE_METADATA",observation:"PhoneInfoga observed line_type=voip.",signal:"line_type"}
        ]
      }),
      adapter({provider:"mosint",capability:"EMAIL_RECON",target_type:"email",findings:[]}),
      adapter({provider:"h8mail",capability:"LOCAL_BREACH",target_type:"email",findings:[{kind:"LOCAL_BREACH_NONE",observation:"none"}]}),
      court
    ];
    const red=scoreStaffVerdict({osint:report({adapters:stacked})});
    expect(red.level).toBe("RED_FLAG");
    expect(red.reasons.join(" ")).toMatch(/criminal-looking public docket/i);
  });

  it("puts the background-check disclaimer on HubSpot / human notes",()=>{
    const osint=report({
      adapters:[
        adapter({
          provider:"courtlistener",capability:"COURT_RECORDS",target_type:"name",target_redacted:"Jane Doe",
          findings:[{kind:"COURT_DOCKET_NONE",observation:`CourtListener RECAP search returned no public docket hits. ${COURTLISTENER_DISCLAIMER}`,signal:"NONE"}]
        })
      ]
    });
    const lines=formatOsintNoteLines(osint).join("\n");
    expect(lines).toContain("CourtListener (public court records)");
    expect(lines).toContain(COURTLISTENER_DISCLAIMER);
    expect(lines).toContain("NOT a full criminal background check");
    expect(lines).toContain("no PACER purchase");
    const note=buildOutcome({
      status:"INCOMPLETE",
      reason:"FAULT_NOT_ESTABLISHED",
      missing:["Police report"],
      evidence:[],
      dimensions:{identity_osint:osint},
      contact:{name:"Jane Doe"}
    });
    expect(note.human_note).toContain(COURTLISTENER_DISCLAIMER);
    expect(note.hubspot_note).toContain("NOT a full criminal background check");
    expect(note.hubspot_note).not.toMatch(/Bearer /);
  });
});
