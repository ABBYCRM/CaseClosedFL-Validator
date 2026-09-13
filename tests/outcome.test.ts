import {describe,it,expect} from "vitest";
import {htmlToText} from "../src/integrations/hubspot/notes.js";
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

  it("emits WhatsApp text for humans and HubSpot-safe HTML for hs_note_body",()=>{
    const x=buildOutcome({
      status:"INCOMPLETE",
      reason:"FAULT_NOT_ESTABLISHED",
      missing:["Police report or fault evidence"],
      evidence:[{claim:"INCIDENT_IDENTIFIER_MATCH",epistemic_state:"KNOWN"}],
      dimensions:{incident:"DOCUMENT_CORROBORATED",fault:"UNDETERMINED"},
      nextAction:"REQUEST_FAULT_SUPPORTING_POLICE_REPORT"
    });
    expect(x.human_note).toContain("🚦 *VERDICT:");
    expect(x.human_note).toContain("👤 *Contact*");
    expect(x.human_note).toContain("🔎 *OSINT identity*");
    expect(x.human_note).toContain("⚠️ *CaseClosedFL Validation*");
    expect(x.human_note).toContain("📋 *Checks*");
    expect(x.human_note).toContain("❓ *Still needed*");
    expect(x.human_note).not.toContain("{\"");
    expect(x.hubspot_note).toContain("<strong>VERDICT:");
    expect(x.hubspot_note).toContain("<strong>Contact</strong>");
    expect(x.hubspot_note).toContain("<strong>OSINT identity</strong>");
    expect(x.hubspot_note).toContain("<strong>CaseClosedFL Validation</strong>");
    expect(x.hubspot_note).toContain("<strong>Checks</strong>");
    expect(x.hubspot_note).toContain("<strong>Still needed</strong>");
    expect(x.hubspot_note).toContain("<p>");
    expect(x.hubspot_note).not.toContain("*CaseClosedFL Validation*");
    expect(htmlToText(x.hubspot_note)).toContain("CaseClosedFL Validation");
    expect(htmlToText(x.hubspot_note)).toContain("Police report or fault evidence");
    expect(x.agent_note.format).toBe("WHATSAPP_STYLE_TEXT");
    expect(x.agent_note.text).toBe(x.human_note);
  });

  it("formats nested fraud engines as name: result lines instead of [object Object]",()=>{
    const x=buildOutcome({
      status:"INCOMPLETE",
      reason:"NOT_CORROBORATED",
      missing:["report"],
      evidence:[],
      dimensions:{
        incident:"UNKNOWN",
        fraud_parallel_engines:{
          DOCUMENT_AUTHENTICITY:{verdict:"PASS",risk_score:0,assurance_level:"LEVEL_1_VISUAL_CONSISTENCY_ONLY",summary:"ok"},
          IDENTITY:{verdict:"HIGH_RISK",risk_score:45,assurance_level:"LEVEL_3_MACHINE_READABLE_CONSISTENCY",summary:"mismatch"}
        },
        fraud_findings:[
          {engine:"IDENTITY",finding_type:"BARCODE_VISIBLE_DATA_MISMATCH",result:"FAIL",observation:"visible data conflicts"}
        ]
      }
    });
    expect(x.human_note).toMatch(/Fraud checks:[\s\S]*Document authenticity: looks clean/);
    expect(x.human_note).toContain("Identity documents: hold — a real concern came up");
    expect(x.human_note).toContain("printed ID and barcode data do not match");
    expect(x.human_note).not.toContain("Identity — Barcode Visible Data Mismatch");
    expect(x.human_note).not.toMatch(/\[object Object\]/i);
    expect(x.hubspot_note).not.toMatch(/\[object Object\]/i);
    expect(x.hubspot_note).toContain("Document authenticity: looks clean");
    expect(x.hubspot_note).toContain("<p>");
    expect(htmlToText(x.hubspot_note)).toContain("Document authenticity: looks clean");
  });
});
