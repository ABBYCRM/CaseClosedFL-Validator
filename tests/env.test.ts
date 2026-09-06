import {describe,it,expect} from "vitest";
import {applyDotEnv,assertHubSpotProductionConfig,hubspotAllowlistConfigured,parseEnv,resolveHubSpotSyncMode} from "../src/config/env.js";

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

describe("optional direct-search env",()=>{
  it("does not require provider keys at boot",()=>{
    const parsed=parseEnv({
      ADMIN_SECRET:"development-admin-secret-change-me",
      TOKEN_PEPPER:"development-token-pepper-change-me"
    });
    expect(parsed.TAVILY_API_KEY).toBe("");
    expect(parsed.EXA_API_KEY).toBe("");
    expect(parsed.FIRECRAWL_API_KEY).toBe("");
    expect(parsed.SCRAPINGBEE_API_KEY).toBe("");
    expect(parsed.SCRAPFLY_API_KEY).toBe("");
    expect(parsed.SCREENSHOTONE_ACCESS_KEY).toBe("");
    expect(parsed.SCREENSHOTONE_SECRET_KEY).toBe("");
    expect(parsed.NVIDIA_VISION_MODEL).toBe("meta/llama-3.2-11b-vision-instruct");
    expect(parsed.HUBSPOT_NOTE_MAX_SCREENSHOTS).toBe(3);
    expect(parsed.COMPOSIO_API_KEY).toBe("");
    expect(parsed.STEEL_API_KEY).toBe("");
  });
  it("keeps existing COMPOSIO_TOOLKITS CSV parsing",()=>{
    expect(parseEnv({COMPOSIO_TOOLKITS:"tavily,exa,serpapi,scrapingbee,steel"}).COMPOSIO_TOOLKITS)
      .toEqual(["tavily","exa","serpapi","scrapingbee","steel"]);
  });
  it("accepts firecrawl and scrapfly in the toolkit CSV",()=>{
    expect(parseEnv({COMPOSIO_TOOLKITS:"tavily,exa,serpapi,scrapingbee,steel,firecrawl,scrapfly"}).COMPOSIO_TOOLKITS)
      .toEqual(["tavily","exa","serpapi","scrapingbee","steel","firecrawl","scrapfly"]);
  });
  it("parses the recommended Composio toolkit allowlist",()=>{
    expect(parseEnv({COMPOSIO_TOOLKITS:"tavily,exa,firecrawl,serpapi,browser_tool"}).COMPOSIO_TOOLKITS)
      .toEqual(["tavily","exa","firecrawl","serpapi","browser_tool"]);
  });
  it("trims blanks in the toolkit CSV",()=>{
    expect(parseEnv({COMPOSIO_TOOLKITS:"tavily, ,exa,,steel"}).COMPOSIO_TOOLKITS)
      .toEqual(["tavily","exa","steel"]);
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

describe("HubSpot sync mode selection",()=>{
  it("defaults auto to crm_notes when the form allowlist is not configured",()=>{
    expect(resolveHubSpotSyncMode({HUBSPOT_SYNC_MODE:"auto"})).toBe("crm_notes");
    expect(parseEnv({}).HUBSPOT_SYNC_MODE).toBe("auto");
  });
  it("defaults auto to forms when both allowlist sides are present",()=>{
    expect(resolveHubSpotSyncMode({
      HUBSPOT_SYNC_MODE:"auto",
      HUBSPOT_INITIAL_FORM_ID:"guid-initial",
      HUBSPOT_EMAIL_FORM_ID:"guid-email"
    })).toBe("forms");
  });
  it("honors an explicit crm_notes mode even if form GUIDs are set",()=>{
    expect(resolveHubSpotSyncMode({
      HUBSPOT_SYNC_MODE:"crm_notes",
      HUBSPOT_INITIAL_FORM_ID:"guid-initial",
      HUBSPOT_EMAIL_FORM_ID:"guid-email"
    })).toBe("crm_notes");
  });
  it("honors an explicit forms mode",()=>{
    expect(resolveHubSpotSyncMode({HUBSPOT_SYNC_MODE:"forms"})).toBe("forms");
  });
  it("does not require the two-form allowlist for CRM-note production",()=>{
    expect(()=>assertHubSpotProductionConfig({
      HUBSPOT_ACCESS_TOKEN:"pat-token",
      HUBSPOT_SYNC_MODE:"auto"
    })).not.toThrow();
    expect(()=>assertHubSpotProductionConfig({
      HUBSPOT_ACCESS_TOKEN:"pat-token",
      HUBSPOT_SYNC_MODE:"crm_notes"
    })).not.toThrow();
  });
  it("still requires the two-form allowlist when forms mode is selected",()=>{
    expect(()=>assertHubSpotProductionConfig({
      HUBSPOT_ACCESS_TOKEN:"pat-token",
      HUBSPOT_SYNC_MODE:"forms"
    })).toThrow(/HUBSPOT_TWO_FORM_ALLOWLIST_REQUIRED/);
  });
  it("still requires the access token in either mode",()=>{
    expect(()=>assertHubSpotProductionConfig({HUBSPOT_SYNC_MODE:"crm_notes"})).toThrow(/HUBSPOT_ACCESS_TOKEN_REQUIRED/);
  });
});
