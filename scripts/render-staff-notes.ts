import {writeFileSync} from "node:fs";
import {OSINT_CONTRACT,type OsintLookupReport} from "../src/integrations/osint/types.js";
import {buildOutcome} from "../src/validation/outcome.js";

function holehe(){
  return{
    provider:"holehe" as const,capability:"EMAIL_REGISTRATION" as const,status:"OBSERVED" as const,
    target_type:"email" as const,target_redacted:"j***@gmail.com",
    findings:[
      {kind:"EMAIL_SITE_REGISTRATION",site:"instagram",observation:"Holehe observed a public registration signal for instagram."},
      {kind:"EMAIL_SITE_REGISTRATION",site:"twitter",observation:"Holehe observed a public registration signal for twitter."}
    ],
    errors:[],checks_performed:["HOLEHE_EMAIL_SITE_REGISTRATION"]
  };
}
function phone(){
  return{
    provider:"phoneinfoga" as const,capability:"PHONE_LOOKUP" as const,status:"OBSERVED" as const,
    target_type:"phone" as const,target_redacted:"+***0100",
    findings:[
      {kind:"PHONE_METADATA",observation:"PhoneInfoga observed country=United States.",signal:"country"},
      {kind:"PHONE_METADATA",observation:"PhoneInfoga observed line_type=mobile.",signal:"line_type"}
    ],
    errors:[],checks_performed:["PHONEINFOGA_LOCAL_SCAN"]
  };
}
function mosint(){
  return{
    provider:"mosint" as const,capability:"EMAIL_RECON" as const,status:"OBSERVED" as const,
    target_type:"email" as const,target_redacted:"j***@gmail.com",
    findings:[
      {kind:"EMAIL_RECON_SIGNAL",observation:"Mosint observed mx=aspmx.l.google.com.",signal:"mx"},
      {kind:"EMAIL_RECON_SIGNAL",observation:"Mosint observed ns=ns1.google.com.",signal:"ns"},
      {kind:"EMAIL_RECON_SIGNAL",observation:"Mosint observed txt=v=spf1 include:_spf.google.com.",signal:"txt"}
    ],
    errors:[],checks_performed:["MOSINT_EMAIL_RECON"]
  };
}
function h8(hit:boolean){
  return{
    provider:"h8mail" as const,capability:"LOCAL_BREACH" as const,status:"OBSERVED" as const,
    target_type:"email" as const,target_redacted:"j***@gmail.com",
    findings:hit
      ?[{kind:"LOCAL_BREACH_HIT",observation:"h8mail reported 2 local/public-source hit(s). Secrets were redacted."}]
      :[{kind:"LOCAL_BREACH_NONE",observation:"h8mail reported no local/public-source hits."}],
    errors:[],checks_performed:["H8MAIL_LOCAL_BREACH_FILE"]
  };
}
function court(){
  return{
    provider:"courtlistener" as const,capability:"COURT_RECORDS" as const,status:"OBSERVED" as const,
    target_type:"name" as const,target_redacted:"Jane Doe",
    findings:[{kind:"COURT_DOCKET_NONE",observation:"CourtListener RECAP search returned no public docket hits.",signal:"NONE"}],
    errors:[],checks_performed:["COURTLISTENER_RECAP_SEARCH"]
  };
}

function report(adapters:OsintLookupReport["adapters"]):OsintLookupReport{
  return{
    capability:"IDENTITY_OSINT_LOOKUP",enabled:true,ran:true,
    email_redacted:"j***@gmail.com",phone_redacted:"+***0100",
    adapters,risk_flags:[],unavailable:[],errors:[],contract:OSINT_CONTRACT
  };
}

const engines=Object.fromEntries(
  ["DOCUMENT_AUTHENTICITY","DOCUMENT_TAMPERING","IDENTITY","SYNTHETIC_MEDIA","CLAIM_CONSISTENCY","CROSS_DOCUMENT","EXTERNAL_VERIFICATION"]
    .map(name=>[name,{verdict:"PASS"}])
);

const contact={name:"Jane Doe",email_redacted:"j***@gmail.com",phone_redacted:"+***0100"};
const missing=["one of incident.report_number, incident.case_number, incident.agency, or incident.location"];

const good=buildOutcome({
  status:"INCOMPLETE",reason:"MISSING_INFORMATION",missing,evidence:[],
  dimensions:{incident:"UNKNOWN",fault:"UNKNOWN",identity_osint:report([holehe(),phone(),mosint(),h8(false),court()]),fraud_overall:"PASS",fraud_parallel_engines:engines},
  contact,nextAction:"REQUEST_MISSING_INTAKE_FIELDS"
});
const caution=buildOutcome({
  status:"INCOMPLETE",reason:"MISSING_INFORMATION",missing,evidence:[],
  dimensions:{incident:"UNKNOWN",fault:"UNKNOWN",identity_osint:report([holehe(),phone(),mosint(),h8(true),court()]),fraud_overall:"PASS",fraud_parallel_engines:engines},
  contact,nextAction:"REQUEST_MISSING_INTAKE_FIELDS"
});
const incomplete=buildOutcome({
  status:"INCOMPLETE",reason:"MISSING_INFORMATION",missing,evidence:[],
  dimensions:{incident:"UNKNOWN",fault:"UNKNOWN",identity_osint:{capability:"IDENTITY_OSINT_LOOKUP",enabled:false,ran:false,adapters:[],risk_flags:[],unavailable:["OSINT_IDENTITY_DISABLED"],errors:[],contract:OSINT_CONTRACT},fraud_overall:"PASS",fraud_parallel_engines:engines},
  contact,nextAction:"REQUEST_MISSING_INTAKE_FIELDS"
});

writeFileSync("docs/sample_staff_notes_good.txt",`${good.human_note}\n`);
writeFileSync("docs/sample_staff_notes_caution.txt",`${caution.human_note}\n`);
writeFileSync("docs/sample_staff_notes_incomplete.txt",`${incomplete.human_note}\n`);
console.log("wrote docs/sample_staff_notes_{good,caution,incomplete}.txt");
