import {describe,expect,it} from "vitest";
import {modernizeTrustedFormRetainSentence} from "../src/integrations/hubspot/trustedform.js";

const NEW_WITH_DATE="TrustedForm cert retained (stored 5 years). Lookup/claim window ends October 6, 2026.";
const NEW_BARE="TrustedForm cert retained (stored 5 years).";

describe("modernizeTrustedFormRetainSentence",()=>{
  it("rewrites the legacy dated sentence to the lookup/claim window wording",()=>{
    expect(modernizeTrustedFormRetainSentence("TrustedForm cert retained, expires October 6, 2026.")).toBe(NEW_WITH_DATE);
  });
  it("rewrites a bare legacy sentence",()=>{
    expect(modernizeTrustedFormRetainSentence("TrustedForm cert retained.")).toBe(NEW_BARE);
  });
  it("keeps whatever follows the sentence",()=>{
    expect(modernizeTrustedFormRetainSentence("TrustedForm cert retained, expires October 6, 2026. Email did not match the certificate. Do not contact."))
      .toBe(`${NEW_WITH_DATE} Email did not match the certificate. Do not contact.`);
  });
  it("is idempotent and leaves new sentences untouched",()=>{
    expect(modernizeTrustedFormRetainSentence(NEW_WITH_DATE)).toBe(NEW_WITH_DATE);
    expect(modernizeTrustedFormRetainSentence(NEW_BARE)).toBe(NEW_BARE);
    const once=modernizeTrustedFormRetainSentence("TrustedForm cert retained, expires October 6, 2026.");
    expect(modernizeTrustedFormRetainSentence(once)).toBe(once);
  });
  it("leaves failure and skipped sentences untouched",()=>{
    for(const s of ["TrustedForm retain failed: HTTP 404.","TrustedForm retain skipped: no certificate.","TrustedForm retain skipped: phone lead."]){
      expect(modernizeTrustedFormRetainSentence(s)).toBe(s);
    }
  });
  it("returns an empty string for null or undefined",()=>{
    expect(modernizeTrustedFormRetainSentence(null)).toBe("");
    expect(modernizeTrustedFormRetainSentence(undefined)).toBe("");
  });
});
