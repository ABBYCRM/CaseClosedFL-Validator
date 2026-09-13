import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {OSINT_CONTRACT} from "../src/integrations/osint/types.js";
import {buildOutcome} from "../src/validation/outcome.js";

const JARGON=/IDENTITY_OSINT_LOOKUP|HOLEHE_EMAIL_SITE_REGISTRATION|MOSINT_EMAIL_RECON|H8MAIL_NONZERO_EXIT|line_type=|Identity — Osint/i;
const DNS=/\bmx=|\bns=|\btxt=|\bsoa=|\basn=|\bip=\d/i;

describe("checked-in sample staff notes",()=>{
  it("good / caution / incomplete samples stay staff English",()=>{
    const good=readFileSync("docs/sample_staff_notes_good.txt","utf8");
    const caution=readFileSync("docs/sample_staff_notes_caution.txt","utf8");
    const incomplete=readFileSync("docs/sample_staff_notes_incomplete.txt","utf8");
    expect(good).toContain("🟢 GOOD — looks fine to proceed");
    expect(good).toContain("normal for a real Gmail");
    expect(good).toContain("normal Google/Gmail-looking address");
    expect(good).toContain("No public federal court hits");
    expect(good).toContain("looks clean");
    expect(good).toContain("expected at intake, not a fail on the person");
    expect(good).toContain("Normal intake curiosity");
    expect(caution).toContain("🟡 CAUTION — dig a little, not a fraud accusation");
    expect(caution).toContain("old breach dataset");
    expect(caution).toContain("Passwords were NOT saved or written to HubSpot");
    expect(caution).toContain("Human glance before attorney send");
    expect(incomplete).toContain("⚪ INCOMPLETE — checks didn’t fully run");
    expect(incomplete).toContain("Missing checks do not count as risk");
    for(const note of [good,caution,incomplete]){
      expect(note).not.toMatch(JARGON);
      expect(note).not.toMatch(DNS);
      expect(note).toContain("👀 *Staff actions*");
    }
  });

  it("renderer still matches the good sample shape",()=>{
    const x=buildOutcome({
      status:"INCOMPLETE",
      reason:"MISSING_INFORMATION",
      missing:["one of incident.report_number, incident.case_number, incident.agency, or incident.location"],
      evidence:[],
      dimensions:{
        incident:"UNKNOWN",
        identity_osint:{
          capability:"IDENTITY_OSINT_LOOKUP",enabled:true,ran:true,
          email_redacted:"j***@gmail.com",phone_redacted:"+***0100",
          adapters:[],risk_flags:[],unavailable:[],errors:[],contract:OSINT_CONTRACT
        }
      }
    });
    expect(x.human_note).toContain("Staff actions");
    expect(x.human_note).not.toMatch(JARGON);
  });
});
