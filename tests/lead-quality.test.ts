import {describe,it,expect} from "vitest";
import {assessLeadQuality,finalVerdict,fakePhoneReason,stateForZip} from "../src/validation/lead-quality.js";
import {buildOutcome} from "../src/validation/outcome.js";

// Real failure cases seen in HubSpot (PII trimmed to what the rule needs).
const DANIEL_SPAM="Hi\nI wanted to quickly flag something we found while checking your website.\nYour SEO (Search Engine Optimization) setup appears to have some incomplete technical elements affecting search-engine crawling, indexing, and overall visibility on Google and Bing.\nIf you have a few minutes, reply with your phone number and a convenient time.\nThanks,\nDaniel";

const BOB={name:"Bob S",phone:"+17818675309",email:"bob.fixture@gmail.com",state:"MA",zip:"02451",narrative:""};
const DANIEL={name:"Daniel E",phone:"+16035559454",email:"daniel.fixture@gmail.com",state:"NH",zip:"10001",narrative:DANIEL_SPAM};
const EXAMPLE={name:"Good Contact",phone:"+13055550177",email:"good@example.com",state:"FL",zip:"33401",narrative:"Rear-ended at a light, neck pain, went to urgent care."};
const CLEAN={name:"Jane Rivera",phone:"+14078392217",email:"jane.rivera.fixture@gmail.com",state:"FL",zip:"33401",narrative:"I hurt my back and was treated at the ER the same day; still in physical therapy."};

describe("deterministic junk rules",()=>{
  it("Bob Stein 781-867-5309 -> JUNK (fake phone)",()=>{
    const q=assessLeadQuality(BOB);
    expect(q.junk.map(s=>s.code)).toContain("FAKE_PHONE_NUMBER");
    expect(finalVerdict(q,"INCOMPLETE","DURATION_NOT_ESTABLISHED","PASS").verdict).toBe("JUNK");
  });
  it("Daniel Edwards spam narrative + NH/10001 mismatch -> JUNK",()=>{
    const q=assessLeadQuality(DANIEL);
    expect(q.junk.map(s=>s.code)).toContain("SPAM_NARRATIVE");
    expect(q.review.map(s=>s.code)).toContain("ZIP_STATE_MISMATCH");
    expect(finalVerdict(q,"CONTRADICTED","MANUAL_REVIEW_REQUIRED","MANUAL_REVIEW").verdict).toBe("JUNK");
  });
  it("example.com email -> JUNK",()=>{
    const q=assessLeadQuality(EXAMPLE);
    expect(q.junk.map(s=>s.code)).toContain("TEST_EMAIL_DOMAIN");
    expect(finalVerdict(q,"INCOMPLETE","RECORD_PENDING","PASS").verdict).toBe("JUNK");
  });
  it("clean complete lead -> GOOD",()=>{
    const q=assessLeadQuality(CLEAN);
    expect(q.junk).toEqual([]);
    expect(q.review).toEqual([]);
    expect(finalVerdict(q,"VALIDATED",null,"PASS").verdict).toBe("GOOD");
    expect(finalVerdict(q,"INCOMPLETE","INSUFFICIENT_EVIDENCE","PASS").verdict).toBe("GOOD");
  });
  it("hard bounce -> JUNK; ZIP/state mismatch alone -> NEEDS_REVIEW; missing intake answer -> NEEDS_REVIEW",()=>{
    expect(finalVerdict(assessLeadQuality({...CLEAN,emailBounceReason:"HARD_BOUNCE_UNKNOWN_USER"}),"VALIDATED",null,"PASS").verdict).toBe("JUNK");
    expect(finalVerdict(assessLeadQuality({...CLEAN,zip:"10001"}),"VALIDATED",null,"PASS").verdict).toBe("NEEDS_REVIEW");
    expect(finalVerdict(assessLeadQuality(CLEAN),"INCOMPLETE","DURATION_NOT_ESTABLISHED","PASS").verdict).toBe("NEEDS_REVIEW");
  });
  it("phone and ZIP rules",()=>{
    for(const p of ["305-555-0123","(111) 234-5678","999-999-9999","123-456-7890","212-012-3456","890-234-5678","911-234-5678"]) expect(fakePhoneReason(p)).toBeTruthy();
    for(const p of ["+1 407 839 2217","561-409-0180"]) expect(fakePhoneReason(p)).toBeUndefined();
    expect(stateForZip("02451")).toBe("MA");
    expect(stateForZip("10001")).toBe("NY");
    expect(stateForZip("33401")).toBe("FL");
  });
});

describe("one verdict everywhere + NOT RUN",()=>{
  const docsEngines={DOCUMENT_AUTHENTICITY:{verdict:"PASS"},IDENTITY:{verdict:"PASS"},CLAIM_CONSISTENCY:{verdict:"PASS"}};
  it("JUNK sets status/reason/fraud_overall and note headline consistently; no boilerplate",()=>{
    const x:any=buildOutcome({status:"INCOMPLETE",reason:"DURATION_NOT_ESTABLISHED",missing:["duration"],evidence:[],
      dimensions:{fraud_overall:"PASS",fraud_parallel_engines:docsEngines},quality:assessLeadQuality(BOB)});
    expect(x.verdict).toBe("JUNK");
    expect(x.status).toBe("CONTRADICTED");
    expect(x.reason).toMatch(/^JUNK_LEAD: FAKE_PHONE_NUMBER/);
    expect(x.dimensions.fraud_overall).toBe("HIGH_RISK");
    expect(x.human_note).toMatch(/VERDICT: 🔴 JUNK/);
    expect(x.human_note).toMatch(/867-5309/);
    expect(x.human_note).not.toMatch(/looks clean|old breach dataset|normal for a real|looks ordinary|shows up on public sites/i);
    expect(x.human_note).toMatch(/NOT RUN/);
  });
  it("GOOD keeps missing-field asks and marks document engines NOT RUN when no documents",()=>{
    const x:any=buildOutcome({status:"INCOMPLETE",reason:"INSUFFICIENT_EVIDENCE",missing:["Official record"],evidence:[],
      dimensions:{fraud_overall:"PASS",fraud_parallel_engines:docsEngines},quality:assessLeadQuality(CLEAN)});
    expect(x.verdict).toBe("GOOD");
    expect(x.dimensions.fraud_overall).toBe("PASS");
    expect(x.dimensions.fraud_parallel_engines.DOCUMENT_AUTHENTICITY.verdict).toBe("NOT_RUN");
    expect(x.dimensions.fraud_parallel_engines.IDENTITY.verdict).toBe("PASS");
    expect(x.human_note).toMatch(/VERDICT: 🟢 GOOD/);
    expect(x.human_note).toMatch(/Still needed/);
  });
  it("NEEDS_REVIEW maps to MANUAL_REVIEW fraud value",()=>{
    const x:any=buildOutcome({status:"INCOMPLETE",reason:"DURATION_NOT_ESTABLISHED",missing:["duration"],evidence:[],
      dimensions:{fraud_overall:"PASS"},quality:assessLeadQuality(CLEAN)});
    expect(x.verdict).toBe("NEEDS_REVIEW");
    expect(x.status).toBe("INCOMPLETE");
    expect(x.reason).toBe("DURATION_NOT_ESTABLISHED");
    expect(x.dimensions.fraud_overall).toBe("MANUAL_REVIEW");
    expect(x.human_note).toMatch(/VERDICT: 🟡 NEEDS REVIEW/);
  });
});
