import {describe,expect,it} from "vitest";
import {OSINT_CONTRACT,type OsintAdapterResult,type OsintLookupReport} from "../src/integrations/osint/types.js";
import {osintChecksIncomplete,scoreStaffVerdict} from "../src/integrations/osint/verdict.js";

function adapter(partial:Partial<OsintAdapterResult>&Pick<OsintAdapterResult,"provider"|"capability"|"target_type">):OsintAdapterResult{
  return{
    status:"OBSERVED",
    findings:[],
    errors:[],
    checks_performed:[],
    ...partial
  };
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

const goodAdapters:OsintAdapterResult[]=[
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
    findings:[{kind:"LOCAL_BREACH_NONE",observation:"h8mail reported no local/public-source hits. Absence of hits is not proof of authenticity."}]
  })
];

describe("staff OSINT verdict scoring",()=>{
  it("is INCOMPLETE when OSINT is disabled — missing checks are not risk",()=>{
    const v=scoreStaffVerdict({osint:report({enabled:false,ran:false,unavailable:["OSINT_IDENTITY_DISABLED"]})});
    expect(v.level).toBe("INCOMPLETE");
    expect(v.headline).toContain("INCOMPLETE");
    expect(v.rule_of_thumb).toMatch(/missing checks do NOT count as risk/i);
    expect(v.reasons.some(r=>/turned off/i.test(r))).toBe(true);
  });

  it("is INCOMPLETE when a majority of adapters are unavailable or timed out",()=>{
    const adapters=["holehe","phoneinfoga","mosint","h8mail"].map((provider,i)=>adapter({
      provider:provider as OsintAdapterResult["provider"],
      capability:provider==="phoneinfoga"?"PHONE_LOOKUP":provider==="h8mail"?"LOCAL_BREACH":provider==="mosint"?"EMAIL_RECON":"EMAIL_REGISTRATION",
      target_type:provider==="phoneinfoga"?"phone":"email",
      status:i===0?"OBSERVED":"UNAVAILABLE",
      unavailable_reason:i===0?undefined:"BIN_NOT_FOUND",
      findings:i===0?[{kind:"EMAIL_SITE_REGISTRATION",site:"instagram",observation:"x"}]:[]
    }));
    const osint=report({adapters});
    expect(osintChecksIncomplete(osint)).toBe(true);
    const v=scoreStaffVerdict({osint});
    expect(v.level).toBe("INCOMPLETE");
    expect(v.reasons.join(" ")).toMatch(/did not finish/i);
  });

  it("is GOOD when OSINT ran and signals are consistent/normal",()=>{
    const v=scoreStaffVerdict({osint:report({adapters:goodAdapters})});
    expect(v.level).toBe("GOOD");
    expect(v.headline).toBe("🟢 GOOD — looks fine to proceed");
    expect(v.rule_of_thumb).toBe("proceed with normal intake");
    expect(v.observational_flags).toEqual(expect.arrayContaining([
      "Email shows up on public sites — normal for a real Gmail",
      "Phone looks like a US mobile",
      "No old-breach-dataset hit"
    ]));
  });

  it("is CAUTION on local breach hit or weak footprint + VOIP",()=>{
    const breach=goodAdapters.map(a=>a.provider==="h8mail"?{
      ...a,
      findings:[{kind:"LOCAL_BREACH_HIT" as const,observation:"h8mail reported 2 local/public-source hit(s). Secrets were redacted."}]
    }:a);
    expect(scoreStaffVerdict({osint:report({adapters:breach})}).level).toBe("CAUTION");

    const weakVoip=[
      adapter({provider:"holehe",capability:"EMAIL_REGISTRATION",target_type:"email",findings:[]}),
      adapter({
        provider:"phoneinfoga",capability:"PHONE_LOOKUP",target_type:"phone",
        findings:[{kind:"PHONE_METADATA",observation:"PhoneInfoga observed line_type=voip.",signal:"line_type"}]
      }),
      adapter({
        provider:"mosint",capability:"EMAIL_RECON",target_type:"email",
        findings:[{kind:"EMAIL_RECON_SIGNAL",observation:"Mosint observed: related domain example.com."}]
      }),
      adapter({
        provider:"h8mail",capability:"LOCAL_BREACH",target_type:"email",
        findings:[{kind:"LOCAL_BREACH_NONE",observation:"none"}]
      })
    ];
    const caution=scoreStaffVerdict({osint:report({adapters:weakVoip})});
    expect(caution.level).toBe("CAUTION");
    expect(caution.rule_of_thumb).toMatch(/human glance before attorney send/i);
  });

  it("is RED FLAG only for stacked burner-style patterns or existing fraud HIGH_RISK",()=>{
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
      adapter({
        provider:"h8mail",capability:"LOCAL_BREACH",target_type:"email",
        findings:[{kind:"LOCAL_BREACH_NONE",observation:"none"}]
      })
    ];
    const red=scoreStaffVerdict({osint:report({adapters:stacked})});
    expect(red.level).toBe("RED_FLAG");
    expect(red.headline).toContain("hold / do not treat as clean");
    expect(red.reasons.join(" ")).toMatch(/thin public footprint/i);

    const mapped=scoreStaffVerdict({
      osint:report({adapters:goodAdapters}),
      dimensions:{fraud_overall:"HIGH_RISK",fraud_parallel_engines:{IDENTITY:{verdict:"HIGH_RISK"}}}
    });
    expect(mapped.level).toBe("RED_FLAG");
    expect(mapped.reasons.join(" ")).toMatch(/hold until a human clears|real concern/i);
  });

  it("does not treat unavailable adapters as a red flag",()=>{
    const v=scoreStaffVerdict({
      osint:report({
        adapters:["holehe","phoneinfoga","mosint","h8mail"].map(provider=>adapter({
          provider:provider as OsintAdapterResult["provider"],
          capability:"EMAIL_REGISTRATION",
          target_type:"email",
          status:"UNAVAILABLE",
          unavailable_reason:"TIMEOUT"
        }))
      })
    });
    expect(v.level).toBe("INCOMPLETE");
    expect(v.level).not.toBe("RED_FLAG");
    expect(v.level).not.toBe("CAUTION");
  });
});
