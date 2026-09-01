import {describe,it,expect} from "vitest";
import {buildOutcome} from "../src/validation/outcome.js";

describe("outcome",()=>{
  it("does not convert missing evidence into fraud",()=>{
    const x=buildOutcome({status:"INCOMPLETE",reason:"NOT_CORROBORATED",missing:["report"],evidence:[],dimensions:{incident:"UNKNOWN"}});
    expect(x.status).toBe("INCOMPLETE");
    expect(JSON.stringify(x)).not.toMatch(/fraud/i);
  });

  it("hash is stable for identical body",()=>{
    const i={status:"VALIDATED" as const,missing:[],evidence:[],dimensions:{incident:"VALIDATED"}};
    expect(buildOutcome(i).result_hash).toBe(buildOutcome(i).result_hash);
  });

  it("always emits a phone-readable HubSpot note",()=>{
    const x=buildOutcome({
      status:"INCOMPLETE",
      reason:"FAULT_NOT_ESTABLISHED",
      missing:["Police report or fault evidence"],
      evidence:[{claim:"INCIDENT_IDENTIFIER_MATCH",epistemic_state:"KNOWN"}],
      dimensions:{incident:"DOCUMENT_CORROBORATED",fault:"UNDETERMINED"},
      nextAction:"REQUEST_FAULT_SUPPORTING_POLICE_REPORT"
    });
    expect(x.hubspot_note).toContain("⚠️ *CaseClosedFL Validation*");
    expect(x.hubspot_note).toContain("📋 *Checks*");
    expect(x.hubspot_note).toContain("❓ *Still needed*");
    expect(x.hubspot_note).not.toContain("{\"");
    expect(x.agent_note.format).toBe("WHATSAPP_STYLE_TEXT");
    expect(x.human_note).toBe(x.hubspot_note);
  });
});
