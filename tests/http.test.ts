import {describe,it,expect} from "vitest";
import {assertSafePublicUrl} from "../src/tools/http.js";
import {serviceIndex,serviceIndexHtml} from "../src/api/routes.js";
describe("SSRF guard",()=>{it("allows https public URL",()=>expect(assertSafePublicUrl("https://www.flhsmv.gov/").hostname).toBe("www.flhsmv.gov"));it("denies localhost",()=>expect(()=>assertSafePublicUrl("https://127.0.0.1/test")).toThrow());it("denies plaintext http",()=>expect(()=>assertSafePublicUrl("http://example.com")).toThrow());});
describe("service index",()=>{
  it("describes the API without exposing secrets",()=>{
    const info=serviceIndex();
    expect(info.service).toBe("CaseClosedFL-Validator");
    expect(info.frontend).toBe("https://caseclosedfl.com");
    expect(info.paths).toEqual({health:"/health",ready:"/ready",admin:"/admin/"});
    expect(JSON.stringify(info)).not.toMatch(/secret|token|password|api_key/i);
  });
  it("renders a tiny HTML landing page with health and frontend links",()=>{
    const html=serviceIndexHtml();
    expect(html).toContain("CaseClosedFL-Validator");
    expect(html).toContain("/health");
    expect(html).toContain("/ready");
    expect(html).toContain("/admin/");
    expect(html).toContain("https://caseclosedfl.com");
    expect(html).not.toMatch(/HUBSPOT_ACCESS_TOKEN|NVIDIA_API_KEY|SCREENSHOTONE_SECRET_KEY/);
  });
});
