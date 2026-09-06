import {describe,it,expect} from "vitest";
import {applyDotEnv,hubspotAllowlistConfigured} from "../src/config/env.js";

describe("local .env loader",()=>{
  it("fills missing keys without overriding the process environment",()=>{
    const parsed=applyDotEnv("COMPOSIO_API_KEY=from-file\nHUBSPOT_ACCESS_TOKEN=file-token\n",{
      COMPOSIO_API_KEY:"already-set"
    });
    expect(parsed.COMPOSIO_API_KEY).toBe("already-set");
    expect(parsed.HUBSPOT_ACCESS_TOKEN).toBe("file-token");
  });
  it("ignores comments and blank lines",()=>{
    const parsed=applyDotEnv("# comment\n\nNVIDIA_API_KEY=abc\n");
    expect(parsed.NVIDIA_API_KEY).toBe("abc");
  });
});

describe("HubSpot production allowlist",()=>{
  it("accepts mixed GUID and name configuration",()=>{
    expect(hubspotAllowlistConfigured({
      HUBSPOT_INITIAL_FORM_ID:"guid-initial",
      HUBSPOT_EMAIL_FORM_NAME:"Email Followup"
    })).toBe(true);
  });
  it("rejects a missing side of the two-form allowlist",()=>{
    expect(hubspotAllowlistConfigured({
      HUBSPOT_INITIAL_FORM_ID:"guid-initial"
    })).toBe(false);
  });
});
