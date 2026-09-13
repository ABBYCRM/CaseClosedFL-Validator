import {describe,expect,it} from "vitest";
import {htmlToText} from "../src/integrations/hubspot/notes.js";
import {formatOsintNoteLines} from "../src/integrations/osint/note.js";
import {OSINT_CONTRACT,type OsintLookupReport} from "../src/integrations/osint/types.js";
import {buildOutcome} from "../src/validation/outcome.js";

const observed:OsintLookupReport={
  capability:"IDENTITY_OSINT_LOOKUP",
  enabled:true,
  ran:true,
  email_redacted:"j***@example.com",
  phone_redacted:"+***0100",
  adapters:[
    {
      provider:"holehe",
      capability:"EMAIL_REGISTRATION",
      status:"OBSERVED",
      target_type:"email",
      target_redacted:"j***@example.com",
      findings:[
        {kind:"EMAIL_SITE_REGISTRATION",site:"instagram",observation:"Holehe observed a public registration signal for instagram.",signal:"USED"},
        {kind:"EMAIL_SITE_REGISTRATION",site:"twitter",observation:"Holehe observed a public registration signal for twitter.",signal:"USED"}
      ],
      errors:[],
      checks_performed:["HOLEHE_EMAIL_SITE_REGISTRATION"]
    },
    {
      provider:"phoneinfoga",
      capability:"PHONE_LOOKUP",
      status:"OBSERVED",
      target_type:"phone",
      target_redacted:"+***0100",
      findings:[
        {kind:"PHONE_METADATA",observation:"PhoneInfoga observed country=United States.",signal:"country"},
        {kind:"PHONE_METADATA",observation:"PhoneInfoga observed line_type=mobile.",signal:"line_type"}
      ],
      errors:[],
      checks_performed:["PHONEINFOGA_LOCAL_SCAN"]
    },
    {
      provider:"mosint",
      capability:"EMAIL_RECON",
      status:"OBSERVED",
      target_type:"email",
      target_redacted:"j***@example.com",
      findings:[{kind:"EMAIL_RECON_SIGNAL",observation:"Mosint observed: related domain example.com.",signal:"PLUS"}],
      errors:[],
      checks_performed:["MOSINT_EMAIL_RECON"]
    },
    {
      provider:"h8mail",
      capability:"LOCAL_BREACH",
      status:"OBSERVED",
      target_type:"email",
      target_redacted:"j***@example.com",
      findings:[{kind:"LOCAL_BREACH_HIT",observation:"h8mail reported 2 local/public-source hit(s). Secrets were redacted.",signal:"HIT_COUNT"}],
      errors:["H8MAIL_NONZERO_EXIT_1"],
      checks_performed:["H8MAIL_LOCAL_BREACH_FILE"]
    }
  ],
  risk_flags:[
    "HOLEHE_PUBLIC_REGISTRATIONS_OBSERVED",
    "PHONEINFOGA_METADATA_OBSERVED",
    "MOSINT_RECON_SIGNALS_OBSERVED",
    "H8MAIL_LOCAL_BREACH_HIT_OBSERVED"
  ],
  unavailable:["PHONEINFOGA:example-only-when-missing"],
  errors:["h8mail:H8MAIL_NONZERO_EXIT_1"],
  contract:OSINT_CONTRACT
};

const good:OsintLookupReport={
  ...observed,
  adapters:observed.adapters.map(a=>a.provider==="h8mail"?{
    ...a,
    errors:[],
    findings:[{kind:"LOCAL_BREACH_NONE",observation:"h8mail reported no local/public-source hits. Absence of hits is not proof of authenticity.",signal:"NONE"}]
  }:a),
  risk_flags:observed.risk_flags.filter(f=>f!=="H8MAIL_LOCAL_BREACH_HIT_OBSERVED"),
  unavailable:[],
  errors:[]
};

describe("HubSpot / human notes use verdict-first staff format",()=>{
  it("renders a scannable OSINT block without internal capability IDs",()=>{
    const lines=formatOsintNoteLines(observed).join("\n");
    expect(lines).toContain("🔎 *OSINT identity*");
    expect(lines).toContain("• Status: RAN");
    expect(lines).not.toContain("IDENTITY_OSINT_LOOKUP");
    expect(lines).not.toContain("HOLEHE_PUBLIC_REGISTRATIONS_OBSERVED");
    expect(lines).toContain("Public registrations observed (expected)");
    expect(lines).toContain("US mobile");
    expect(lines).toContain("Local breach hit (secrets redacted)");
    expect(lines).toContain("Holehe (email site registrations)");
    expect(lines).toContain("instagram");
    expect(lines).toContain("twitter");
    expect(lines).toContain("PhoneInfoga (phone signals)");
    expect(lines).toContain("United States");
    expect(lines).toContain("line_type=mobile");
    expect(lines).toContain("Mosint (email recon)");
    expect(lines).toContain("related domain example.com");
    expect(lines).toContain("h8mail (local/free breach)");
    expect(lines).toContain("2 local/public-source hit(s)");
    expect(lines).toContain("Why caution:");
    expect(lines).toContain("Staff note:");
    expect(lines).toContain("Tools: Holehe, PhoneInfoga, Mosint, h8mail");
    expect(lines).toContain("PHONEINFOGA:example-only-when-missing");
    expect(lines).toContain("h8mail:H8MAIL_NONZERO_EXIT_1");
    expect(lines).toContain("paid Hunter / HIBP / DeHashed / IntelX / Epieos are out of scope");
    expect(lines).not.toMatch(/hunter2|password/i);
  });

  it("leads human_note and hubspot_note with the approved verdict + contact + OSINT blocks",()=>{
    const x=buildOutcome({
      status:"INCOMPLETE",
      reason:"FAULT_NOT_ESTABLISHED",
      missing:["Police report or fault evidence"],
      evidence:[],
      dimensions:{incident:"UNKNOWN",identity_osint:good},
      contact:{name:"Jane Doe",email_redacted:"j***@example.com",phone_redacted:"+***0100"}
    });
    expect(x.staff_verdict.level).toBe("GOOD");
    expect(x.human_note.startsWith("🚦 *VERDICT: 🟢 GOOD — looks fine to proceed*")).toBe(true);
    expect(x.human_note).toContain("• Rule of thumb: proceed with normal intake");
    expect(x.human_note).toContain("👤 *Contact*");
    expect(x.human_note).toContain("• Name: Jane Doe");
    expect(x.human_note).toContain("• Email: j***@example.com");
    expect(x.human_note).toContain("• Phone: +***0100");
    expect(x.human_note).toContain("🔎 *OSINT identity*");
    expect(x.human_note).toContain("Holehe observed a public registration signal for instagram.");
    expect(x.human_note).toContain("PhoneInfoga observed country=United States.");
    expect(x.human_note).toContain("Mosint observed: related domain example.com.");
    expect(x.human_note).toContain("h8mail reported no local/public-source hits");
    expect(x.human_note).toContain("⚠️ *CaseClosedFL Validation*");
    expect(x.human_note).toContain("📋 *Checks*");
    expect(x.human_note).not.toContain("IDENTITY_OSINT_LOOKUP");
    expect(x.hubspot_note).toContain("<strong>VERDICT: 🟢 GOOD — looks fine to proceed</strong>");
    expect(x.hubspot_note).toContain("<strong>Contact</strong>");
    expect(x.hubspot_note).toContain("<strong>OSINT identity</strong>");
    expect(x.hubspot_note).toContain("instagram");
    expect(htmlToText(x.hubspot_note)).toContain("VERDICT: 🟢 GOOD — looks fine to proceed");
    expect(htmlToText(x.hubspot_note)).toContain("paid Hunter / HIBP / DeHashed / IntelX / Epieos are out of scope");
    expect(x.agent_note.text).toBe(x.human_note);
  });

  it("uses CAUTION copy when a local breach hit is observed",()=>{
    const x=buildOutcome({
      status:"INCOMPLETE",
      reason:"FAULT_NOT_ESTABLISHED",
      missing:["Police report or fault evidence"],
      evidence:[],
      dimensions:{identity_osint:observed}
    });
    expect(x.staff_verdict.level).toBe("CAUTION");
    expect(x.human_note).toContain("🚦 *VERDICT: 🟡 CAUTION — review before sending out*");
    expect(x.human_note).toContain("• Rule of thumb: dig first before attorney send / billable");
    expect(x.human_note).toContain("• Why caution:");
    expect(x.human_note).toContain("Local breach hit");
    expect(x.human_note).toContain("2 local/public-source hit(s)");
    expect(x.human_note).toContain("H8MAIL_NONZERO_EXIT_1");
  });

  it("states DISABLED / INCOMPLETE when OSINT did not run",()=>{
    const lines=formatOsintNoteLines({
      capability:"IDENTITY_OSINT_LOOKUP",
      enabled:false,
      ran:false,
      adapters:[],
      risk_flags:[],
      unavailable:["OSINT_IDENTITY_DISABLED"],
      errors:[],
      contract:OSINT_CONTRACT
    }).join("\n");
    expect(lines).toContain("DISABLED");
    expect(lines).toContain("missing checks do NOT count as risk");
    expect(lines).not.toContain("IDENTITY_OSINT_LOOKUP");
  });
});
