import {describe,expect,it} from "vitest";
import {htmlToText} from "../src/integrations/hubspot/notes.js";
import {formatOsintNoteLines} from "../src/integrations/osint/note.js";
import {OSINT_CONTRACT,type OsintLookupReport} from "../src/integrations/osint/types.js";
import {buildOutcome} from "../src/validation/outcome.js";

const observed:OsintLookupReport={
  capability:"IDENTITY_OSINT_LOOKUP",
  enabled:true,
  ran:true,
  email_redacted:"j***@gmail.com",
  phone_redacted:"+***0100",
  adapters:[
    {
      provider:"holehe",
      capability:"EMAIL_REGISTRATION",
      status:"OBSERVED",
      target_type:"email",
      target_redacted:"j***@gmail.com",
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
      target_redacted:"j***@gmail.com",
      findings:[
        {kind:"EMAIL_RECON_SIGNAL",observation:"Mosint observed mx=aspmx.l.google.com.",signal:"mx"},
        {kind:"EMAIL_RECON_SIGNAL",observation:"Mosint observed ns=ns1.google.com.",signal:"ns"},
        {kind:"EMAIL_RECON_SIGNAL",observation:"Mosint observed txt=v=spf1 include:_spf.google.com.",signal:"txt"},
        {kind:"EMAIL_RECON_SIGNAL",observation:"Mosint observed soa=ns1.google.com.",signal:"soa"},
        {kind:"EMAIL_RECON_SIGNAL",observation:"Mosint observed asn=15169.",signal:"asn"},
        {kind:"EMAIL_RECON_SIGNAL",observation:"Mosint observed ip=142.250.72.100.",signal:"ip"}
      ],
      errors:[],
      checks_performed:["MOSINT_EMAIL_RECON"]
    },
    {
      provider:"h8mail",
      capability:"LOCAL_BREACH",
      status:"OBSERVED",
      target_type:"email",
      target_redacted:"j***@gmail.com",
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

const JARGON=/IDENTITY_OSINT_LOOKUP|HOLEHE_EMAIL_SITE_REGISTRATION|HOLEHE_PUBLIC_REGISTRATIONS|MOSINT_EMAIL_RECON|H8MAIL_LOCAL_BREACH|H8MAIL_NONZERO_EXIT|PHONEINFOGA_LOCAL_SCAN|line_type=|Osint Mosint Email Recon Signal/i;
const DNS_DUMP=/\bmx=|\bns=|\btxt=|\bsoa=|\basn=|\bip=aspmx|aspmx\.l\.google|142\.250\.72\.100/i;

describe("HubSpot / human notes use plain-English staff language",()=>{
  it("translates OSINT findings instead of dumping capability IDs or Mosint DNS",()=>{
    const lines=formatOsintNoteLines(observed).join("\n");
    expect(lines).toContain("🔎 *OSINT identity*");
    expect(lines).toContain("email shows up on public sites (instagram, twitter)");
    expect(lines).toContain("normal for a real Gmail");
    expect(lines).toContain("looks like a US mobile");
    expect(lines).toContain("normal Google/Gmail-looking address");
    expect(lines).toContain("We do not dump DNS, MX, NS, TXT, SOA, ASN, or IP lines into this note.");
    expect(lines).toContain("email showed up in an old breach dataset");
    expect(lines).toContain("Passwords were NOT saved or written to HubSpot");
    expect(lines).toContain("yellow flag by itself, not a red flag");
    expect(lines).toContain("Why this is yellow (not a fraud accusation)");
    expect(lines).toContain("Staff note:");
    expect(lines).toContain("Tools used: Holehe, PhoneInfoga, Mosint, h8mail");
    expect(lines).not.toMatch(JARGON);
    expect(lines).not.toMatch(DNS_DUMP);
    expect(lines).not.toMatch(/hunter2|password\s*[:=]/i);
  });

  it("leads human_note and hubspot_note with verdict + contact + staff-English OSINT",()=>{
    const x=buildOutcome({
      status:"INCOMPLETE",
      reason:"MISSING_INFORMATION",
      missing:["one of incident.report_number, incident.case_number, incident.agency, or incident.location"],
      evidence:[],
      dimensions:{
        incident:"UNKNOWN",
        identity_osint:good,
        fraud_overall:"PASS",
        fraud_parallel_engines:{
          DOCUMENT_AUTHENTICITY:{verdict:"PASS"},
          DOCUMENT_TAMPERING:{verdict:"PASS"},
          IDENTITY:{verdict:"PASS"},
          SYNTHETIC_MEDIA:{verdict:"PASS"},
          CLAIM_CONSISTENCY:{verdict:"PASS"},
          CROSS_DOCUMENT:{verdict:"PASS"},
          EXTERNAL_VERIFICATION:{verdict:"PASS"}
        },
        fraud_findings:[
          {engine:"IDENTITY",finding_type:"OSINT_MOSINT_EMAIL_RECON_SIGNAL",result:"UNKNOWN",observation:"Mosint observed mx=aspmx.l.google.com."}
        ]
      },
      contact:{name:"Jane Doe",email_redacted:"j***@gmail.com",phone_redacted:"+***0100"}
    });
    expect(x.staff_verdict.level).toBe("GOOD");
    expect(x.human_note.startsWith("🚦 *VERDICT: 🟢 GOOD — looks fine to proceed*")).toBe(true);
    expect(x.human_note).toContain("• Rule of thumb: proceed with normal intake");
    expect(x.human_note).toContain("👤 *Contact*");
    expect(x.human_note).toContain("• Name: Jane Doe");
    expect(x.human_note).toContain("• Email: j***@gmail.com");
    expect(x.human_note).toContain("• Phone: +***0100");
    expect(x.human_note).toContain("🔎 *OSINT identity*");
    expect(x.human_note).toContain("email shows up on public sites");
    expect(x.human_note).toContain("normal Google/Gmail-looking address");
    expect(x.human_note).toContain("Police report #, agency, or location — expected at intake, not a fail on the person");
    expect(x.human_note).toContain("Document authenticity: looks clean");
    expect(x.human_note).toContain("Overall fraud check: looks clean");
    expect(x.human_note).toContain("👀 *Staff actions*");
    expect(x.human_note).toContain("Normal intake curiosity");
    expect(x.human_note).toContain("⚠️ *CaseClosedFL Validation*");
    expect(x.human_note).toContain("📋 *Checks*");
    expect(x.human_note).not.toMatch(JARGON);
    expect(x.human_note).not.toMatch(DNS_DUMP);
    expect(x.human_note).not.toContain("Identity — Osint Mosint Email Recon Signal: Unknown");
    expect(x.hubspot_note).toContain("<strong>VERDICT: 🟢 GOOD — looks fine to proceed</strong>");
    expect(x.hubspot_note).toContain("<strong>Contact</strong>");
    expect(x.hubspot_note).toContain("<strong>OSINT identity</strong>");
    expect(x.hubspot_note).toContain("instagram");
    expect(htmlToText(x.hubspot_note)).toContain("VERDICT: 🟢 GOOD — looks fine to proceed");
    expect(htmlToText(x.hubspot_note)).toContain("expected at intake, not a fail on the person");
    expect(x.agent_note.text).toBe(x.human_note);
    expect(x.dimensions.identity_osint).toEqual(good);
    expect((x.dimensions.identity_osint as OsintLookupReport).capability).toBe("IDENTITY_OSINT_LOOKUP");
  });

  it("uses CAUTION copy when an old-breach-dataset hit is observed",()=>{
    const x=buildOutcome({
      status:"INCOMPLETE",
      reason:"MISSING_INFORMATION",
      missing:["Police report or fault evidence"],
      evidence:[],
      dimensions:{identity_osint:observed}
    });
    expect(x.staff_verdict.level).toBe("CAUTION");
    expect(x.human_note).toContain("🚦 *VERDICT: 🟡 CAUTION — dig a little, not a fraud accusation*");
    expect(x.human_note).toContain("• Rule of thumb: human glance before attorney send");
    expect(x.human_note).toContain("• Why this is yellow (not a fraud accusation):");
    expect(x.human_note).toContain("old breach dataset");
    expect(x.human_note).toContain("Passwords were NOT saved or written to HubSpot");
    expect(x.human_note).toContain("Human glance before attorney send (yellow — dig a little, not a fraud accusation)");
    expect(x.human_note).not.toMatch(JARGON);
    expect(x.human_note).not.toMatch(DNS_DUMP);
    expect(x.human_note).toMatch(/not a fraud accusation|not “you are a fraud/i);
    expect(x.human_note).not.toMatch(/\b(?:this (?:person|lead|client) is a fraud|accuse(?:d)? of fraud)\b/i);
  });

  it("states incomplete in staff English when OSINT did not run",()=>{
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
    expect(lines).toContain("did not run");
    expect(lines).toContain("Missing checks do not count as risk");
    expect(lines).not.toContain("IDENTITY_OSINT_LOOKUP");
    expect(lines).not.toContain("OSINT_IDENTITY_DISABLED");
  });
});
