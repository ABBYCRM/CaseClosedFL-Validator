import {describe,it,expect} from "vitest";
import {Lead} from "../src/validation/schema.js";
import {runParallelFraudEngines} from "../src/validation/fraud/engines.js";

function baseLead(){
  return Lead.parse({
    lead_id:"fraud-test",
    state:"FL",
    case_type:"AUTO_ACCIDENT",
    client:{first_name:"Jane",last_name:"Doe"},
    incident:{date:"2026-08-20",report_number:"FL123"},
    qualification:{injured:"YES",primary_fault:"OTHER_PARTY",already_represented:false},
    documents:[]
  });
}

describe("parallel fraud engines",()=>{
  it("returns seven independent verdicts before aggregation",async()=>{
    const result=await runParallelFraudEngines(baseLead());
    expect(result.mode).toBe("PARALLEL_INDEPENDENT_ENGINES");
    expect(result.verdicts).toHaveLength(7);
    expect(new Set(result.verdicts.map(v=>v.engine))).toEqual(new Set([
      "DOCUMENT_AUTHENTICITY","DOCUMENT_TAMPERING","IDENTITY","SYNTHETIC_MEDIA",
      "CLAIM_CONSISTENCY","CROSS_DOCUMENT","EXTERNAL_VERIFICATION"
    ]));
    expect(result.verdicts.every(v=>Array.isArray(v.findings))).toBe(true);
  });

  it("keeps one engine's critical identity verdict independent from other engines",async()=>{
    const lead=Lead.parse({
      ...baseLead(),
      documents:[{
        id:"id-1",
        name:"license.jpg",
        type:"DRIVER_LICENSE",
        source:"CLIENT",
        forensics:{pdf417_decoded:true,barcode_visible_mismatch:true}
      }]
    });
    const result=await runParallelFraudEngines(lead);
    const identity=result.verdicts.find(v=>v.engine==="IDENTITY");
    const tamper=result.verdicts.find(v=>v.engine==="DOCUMENT_TAMPERING");
    expect(identity?.verdict).toBe("HIGH_RISK");
    expect(identity?.findings.some(f=>f.finding_type==="BARCODE_VISIBLE_DATA_MISMATCH")).toBe(true);
    expect(tamper?.verdict).toBe("PASS");
    expect(result.aggregate.high_risk_engines).toContain("IDENTITY");
  });

  it("does not turn unavailable authoritative verification into fraud",async()=>{
    const lead=Lead.parse({
      ...baseLead(),
      documents:[{id:"r1",name:"report.pdf",type:"POLICE_REPORT",source:"CLIENT",text:"Jane Doe FL123 2026-08-20"}]
    });
    const result=await runParallelFraudEngines(lead);
    const external=result.verdicts.find(v=>v.engine==="EXTERNAL_VERIFICATION");
    expect(external?.verdict).toBe("PASS");
    expect(external?.checks_unavailable).toContain("AUTHORITATIVE_ISSUER_VERIFICATION_NOT_ESTABLISHED");
  });

  it("treats synthetic classifier output as its own risk dimension",async()=>{
    const lead=Lead.parse({
      ...baseLead(),
      documents:[{
        id:"p1",name:"damage.jpg",type:"VEHICLE_DAMAGE_PHOTOGRAPH",source:"CLIENT",
        forensics:{synthetic_media_result:"HIGH_SYNTHETIC_RISK"}
      }]
    });
    const result=await runParallelFraudEngines(lead);
    const synthetic=result.verdicts.find(v=>v.engine==="SYNTHETIC_MEDIA");
    expect(synthetic?.risk_score).toBeGreaterThanOrEqual(30);
    expect(synthetic?.verdict).toBe("MANUAL_REVIEW");
    expect(result.aggregate.verdict).toBe("MANUAL_REVIEW");
  });
});
