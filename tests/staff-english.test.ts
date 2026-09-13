import {describe,expect,it} from "vitest";
import {isRawInfrastructureDump} from "../src/integrations/osint/plain-english.js";
import {isOsintFinding,staffEngineName,staffMissingItem,staffVerdictWord} from "../src/validation/staff-english.js";

describe("staff-English translators",()=>{
  it("keeps Mosint DNS/MX/NS/TXT/IP out of staff notes",()=>{
    expect(isRawInfrastructureDump("Mosint observed mx=aspmx.l.google.com.")).toBe(true);
    expect(isRawInfrastructureDump("ns=ns1.google.com")).toBe(true);
    expect(isRawInfrastructureDump("txt=v=spf1")).toBe(true);
    expect(isRawInfrastructureDump("soa=ns1.google.com")).toBe(true);
    expect(isRawInfrastructureDump("asn=15169")).toBe(true);
    expect(isRawInfrastructureDump("ip=142.250.72.100")).toBe(true);
    expect(isRawInfrastructureDump("email shows up on public sites")).toBe(false);
  });

  it("translates fraud PASS and missing police-report fields",()=>{
    expect(staffVerdictWord("PASS")).toBe("looks clean");
    expect(staffEngineName("DOCUMENT_AUTHENTICITY")).toBe("Document authenticity");
    expect(staffMissingItem("one of incident.report_number, incident.case_number, incident.agency, or incident.location"))
      .toMatch(/expected at intake, not a fail on the person/i);
    expect(isOsintFinding({
      engine:"IDENTITY",
      finding_type:"OSINT_MOSINT_EMAIL_RECON_SIGNAL",
      result:"UNKNOWN",
      observation:"Mosint observed mx=aspmx.l.google.com."
    })).toBe(true);
  });
});
