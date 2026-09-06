import {describe,it,expect} from "vitest";
import {stateFromZip} from "../src/integrations/hubspot/fields.js";
import {
  classifyNote, findExistingOutcomeNote, htmlToText, intakeFingerprint, notesToLead,
  outcomeNoteBody, parseLabeledFields
} from "../src/integrations/hubspot/notes.js";

const LIVE_INTAKE=`CaseClosedFL Qualified Personal Injury Intake
Lead score: 100/100 (High)
Case type: Car accident
Accident date: 2026-08-10
ZIP: 33130
Injured: Yes
Fault: Other party
Treatment: Emergency room
Commercial vehicle: N/A
Already represented: No

Incident narrative
The other driver ran the red light on SW 8th St.`;

const SUPPLEMENTAL=`CaseClosedFL Supplemental Intake
Police agency: Florida Highway Patrol
Police report number: FHP-99
County: Miami-Dade`;

const contact={id:"451",email:"paisabrazilfl@gmail.com",firstName:"Paisa",lastName:"Brazil",phone:"+13055550100"};

describe("CRM note classification",()=>{
  it("recognizes the live CaseClosedFL intake header",()=>{
    expect(classifyNote(LIVE_INTAKE)).toBe("intake");
  });
  it("recognizes a supplemental CaseClosedFL note",()=>{
    expect(classifyNote(SUPPLEMENTAL)).toBe("supplemental");
  });
  it("does not treat WhatsApp-style validation notes as intake",()=>{
    expect(classifyNote("⚠️ *CaseClosedFL Validation*\nStatus: *INCOMPLETE*\n\nValidation ID: abc")).toBe("validation");
  });
  it("strips HubSpot HTML before classifying",()=>{
    expect(classifyNote("<p>CaseClosedFL Qualified Personal Injury Intake</p><p>Case type: Car accident</p>")).toBe("intake");
  });
});

describe("CRM note field parser",()=>{
  it("reads labeled intake fields without inventing values",()=>{
    const fields=parseLabeledFields(LIVE_INTAKE);
    expect(fields.get("case_type")).toBe("Car accident");
    expect(fields.get("accident_date")).toBe("2026-08-10");
    expect(fields.get("zip")).toBe("33130");
    expect(fields.get("injured")).toBe("Yes");
    expect(fields.get("fault")).toBe("Other party");
    expect(fields.get("treatment")).toBe("Emergency room");
    expect(fields.get("already_represented")).toBe("No");
    expect(fields.get("commercial_vehicle")).toBeUndefined();
    expect(fields.get("incident_narrative")).toContain("red light");
  });
  it("reads a narrative section that uses a trailing colon",()=>{
    const fields=parseLabeledFields("CaseClosedFL Qualified Personal Injury Intake\nIncident narrative:\nHit from behind on I-95.");
    expect(fields.get("incident_narrative")).toBe("Hit from behind on I-95.");
  });
});

describe("ZIP to supported state",()=>{
  it("maps Miami 33130 to FL",()=>expect(stateFromZip("33130")).toBe("FL"));
  it("maps a ZIP+4 without inventing another state",()=>expect(stateFromZip("33130-1234")).toBe("FL"));
  it("returns undefined for unsupported prefixes",()=>expect(stateFromZip("02115")).toBeUndefined());
});

describe("notesToLead",()=>{
  it("maps the live intake sample onto Lead using contact + ZIP",()=>{
    const parsed=notesToLead({
      intake:{id:"note_intake",body:LIVE_INTAKE,timestampMs:1},
      contact
    });
    expect(parsed.ok).toBe(true);
    if(!parsed.ok)return;
    expect(parsed.lead.state).toBe("FL");
    expect(parsed.lead.case_type).toBe("AUTO_ACCIDENT");
    expect(parsed.lead.client.email).toBe("paisabrazilfl@gmail.com");
    expect(parsed.lead.client.first_name).toBe("Paisa");
    expect(parsed.lead.incident.date).toBe("2026-08-10");
    expect(parsed.lead.qualification.injured).toBe("YES");
    expect(parsed.lead.qualification.primary_fault).toBe("OTHER_PARTY");
    expect(parsed.lead.qualification.already_represented).toBe(false);
    expect(parsed.lead.qualification.medical_treatment).toBe(true);
    expect(parsed.lead.incident.location).toBeUndefined();
    expect((parsed.lead.metadata as any).hubspot.narrative).toContain("red light");
    expect((parsed.lead.metadata as any).hubspot.source).toBe("crm_notes");
    expect((parsed.lead.metadata as any).hubspot.phone).toBe("+13055550100");
  });
  it("merges a newer supplemental note and changes the fingerprint",()=>{
    const initial=notesToLead({intake:{id:"note_intake",body:LIVE_INTAKE,timestampMs:1},contact});
    const withSupp=notesToLead({
      intake:{id:"note_intake",body:LIVE_INTAKE,timestampMs:1},
      supplementals:[{id:"note_supp",body:SUPPLEMENTAL,timestampMs:2}],
      contact
    });
    expect(initial.ok&&withSupp.ok).toBe(true);
    if(!initial.ok||!withSupp.ok)return;
    expect(withSupp.fingerprint).not.toBe(initial.fingerprint);
    expect(withSupp.fingerprint).toBe(intakeFingerprint("note_intake","note_supp"));
    expect(withSupp.lead.incident.agency).toBe("Florida Highway Patrol");
    expect(withSupp.lead.incident.report_number).toBe("FHP-99");
    expect(withSupp.lead.incident.county).toBe("Miami-Dade");
  });
  it("fails closed when case type is missing instead of inventing one",()=>{
    const parsed=notesToLead({
      intake:{id:"n1",body:"CaseClosedFL Qualified Personal Injury Intake\nZIP: 33130\nInjured: Yes",timestampMs:1},
      contact
    });
    expect(parsed.ok).toBe(false);
    if(parsed.ok)return;
    expect(parsed.missing).toContain("case_type");
  });
  it("fails closed when state cannot be taken from contact, note, or ZIP",()=>{
    const parsed=notesToLead({
      intake:{id:"n1",body:"CaseClosedFL Qualified Personal Injury Intake\nCase type: Car accident\nInjured: Yes",timestampMs:1},
      contact:{id:"9"}
    });
    expect(parsed.ok).toBe(false);
    if(parsed.ok)return;
    expect(parsed.missing).toContain("state");
  });
  it("uses an explicit contact state when ZIP is absent",()=>{
    const parsed=notesToLead({
      intake:{id:"n1",body:"CaseClosedFL Qualified Personal Injury Intake\nCase type: Slip and fall\nInjured: Yes",timestampMs:1},
      contact:{id:"9",state:"California"}
    });
    expect(parsed.ok).toBe(true);
    if(!parsed.ok)return;
    expect(parsed.lead.state).toBe("CA");
    expect(parsed.lead.case_type).toBe("SLIP_FALL");
  });
  it("does not treat N/A treatment as medical treatment evidence",()=>{
    const parsed=notesToLead({
      intake:{id:"n1",body:"CaseClosedFL Qualified Personal Injury Intake\nCase type: Car accident\nState: FL\nTreatment: N/A",timestampMs:1},
      contact:{id:"9"}
    });
    expect(parsed.ok).toBe(true);
    if(!parsed.ok)return;
    expect(parsed.lead.qualification.medical_treatment).toBeUndefined();
  });
});

describe("outcome note idempotency",()=>{
  it("finds an existing validation note by fingerprint or validation id",()=>{
    const fingerprint=intakeFingerprint("note_intake");
    const body=outcomeNoteBody("⚠️ *CaseClosedFL Validation*\nStatus: *INCOMPLETE*", "val-1", fingerprint);
    expect(findExistingOutcomeNote([{id:"out",body,timestampMs:3}],fingerprint,"val-1")).toBe("out");
    expect(findExistingOutcomeNote([{id:"out",body,timestampMs:3}],"other")).toBeUndefined();
  });
  it("keeps HTML note bodies searchable after unescape",()=>{
    expect(htmlToText("<p>Case type: Car accident</p>")).toContain("Case type: Car accident");
  });
});
