import {describe,it,expect} from "vitest";
import {assertSafePublicUrl} from "../src/tools/http.js";
describe("SSRF guard",()=>{it("allows https public URL",()=>expect(assertSafePublicUrl("https://www.flhsmv.gov/").hostname).toBe("www.flhsmv.gov"));it("denies localhost",()=>expect(()=>assertSafePublicUrl("https://127.0.0.1/test")).toThrow());it("denies plaintext http",()=>expect(()=>assertSafePublicUrl("http://example.com")).toThrow());});
