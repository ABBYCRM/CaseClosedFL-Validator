import {describe,expect,it} from "vitest";
import {lookupIdentityOsint} from "../src/integrations/osint/lookup.js";
import {osintConfigFrom} from "../src/integrations/osint/config.js";
import {Lead} from "../src/validation/schema.js";
import {runParallelFraudEngines} from "../src/validation/fraud/engines.js";
import {fraudDimensions} from "../src/validation/fraud/index.js";
import {emptyOsintReport,type OsintLookupReport} from "../src/integrations/osint/types.js";

function lead(extra:Partial<Lead>={}){
  return Lead.parse({
    lead_id:"osint-1",
    state:"FL",
    case_type:"AUTO_ACCIDENT",
    client:{first_name:"Jane",last_name:"Doe",email:"jane@example.com",phone:"+13055550100"},
    incident:{date:"2026-08-20"},
    qualification:{injured:"YES",primary_fault:"OTHER_PARTY",already_represented:false},
    documents:[],
    ...extra
  });
}

describe("IDENTITY_OSINT_LOOKUP",()=>{
  it("no-ops when disabled and never invents findings",async()=>{
    const report=await lookupIdentityOsint(lead(),{config:osintConfigFrom({OSINT_IDENTITY_ENABLED:"false"})});
    expect(report.enabled).toBe(false);
    expect(report.ran).toBe(false);
    expect(report.adapters).toEqual([]);
    expect(report.unavailable).toContain("OSINT_IDENTITY_DISABLED");
    expect(report.contract.paid_apis_out_of_scope).toBe(true);
  });
  it("runs automatically when enabled and degrades if CLIs are missing",async()=>{
    const report=await lookupIdentityOsint(lead(),{
      config:osintConfigFrom({OSINT_IDENTITY_ENABLED:"true"}),
      resolve:()=>undefined,
      run:async()=>{throw new Error("should-not-spawn");}
    });
    expect(report.enabled).toBe(true);
    expect(report.ran).toBe(true);
    expect(report.capability).toBe("IDENTITY_OSINT_LOOKUP");
    expect(report.adapters).toHaveLength(4);
    expect(report.adapters.map(a=>a.provider).sort()).toEqual(["h8mail","holehe","mosint","phoneinfoga"]);
    expect(report.adapters.every(a=>a.status==="UNAVAILABLE")).toBe(true);
    expect(report.adapters.every(a=>a.findings.length===0)).toBe(true);
    expect(report.email_redacted).toBe("j***@example.com");
    expect(report.phone_redacted).toBe("+***0100");
  });
  it("records mocked adapter observations without raising fraud risk",async()=>{
    const report=await lookupIdentityOsint(lead(),{
      config:osintConfigFrom({OSINT_IDENTITY_ENABLED:"true"}),
      resolve:()=>({command:"mock",prefixArgs:[],via:"bin"}),
      run:async(_c,args)=>{
        if(args.includes("jane@example.com")&&args.includes("--only-used")){
          return{command:"holehe",args,code:0,stdout:"[+] instagram\n",stderr:"",timedOut:false};
        }
        if(args.includes("scan")){
          return{command:"phoneinfoga",args,code:0,stdout:"Country: United States\n",stderr:"",timedOut:false};
        }
        if(args.includes("-t")){
          return{command:"h8mail",args,code:0,stdout:"Found 1 results\n",stderr:"",timedOut:false};
        }
        return{command:"mosint",args,code:0,stdout:"[+] related domain example.com\n",stderr:"",timedOut:false};
      }
    });
    expect(report.risk_flags).toEqual(expect.arrayContaining([
      "HOLEHE_PUBLIC_REGISTRATIONS_OBSERVED",
      "PHONEINFOGA_METADATA_OBSERVED",
      "MOSINT_RECON_SIGNALS_OBSERVED",
      "H8MAIL_LOCAL_BREACH_HIT_OBSERVED"
    ]));
    const fraud=await runParallelFraudEngines(lead(),report);
    const identity=fraud.verdicts.find(v=>v.engine==="IDENTITY");
    const external=fraud.verdicts.find(v=>v.engine==="EXTERNAL_VERIFICATION");
    expect(identity?.checks_performed).toContain("IDENTITY_OSINT_LOOKUP");
    expect(identity?.findings.some(f=>f.result==="UNKNOWN"&&f.finding_type.includes("HOLEHE"))).toBe(true);
    expect(identity?.verdict).toBe("PASS");
    expect(fraud.aggregate.verdict).toBe("PASS");
    expect(external?.checks_not_performed).toContain("IDENTITY_OSINT_NOT_AUTHORITATIVE_ISSUER_VERIFICATION");
    expect(fraudDimensions(fraud).identity_osint).toBe(report);
  });
  it("attaches a disabled OSINT report on the default fraud path",async()=>{
    const fraud=await runParallelFraudEngines(lead(),emptyOsintReport());
    expect((fraud.identity_osint as OsintLookupReport).enabled).toBe(false);
    const identity=fraud.verdicts.find(v=>v.engine==="IDENTITY");
    expect(identity?.checks_not_performed).toContain("IDENTITY_OSINT_LOOKUP");
  });
});
