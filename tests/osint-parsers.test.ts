import {describe,it,expect} from "vitest";
import {parseHoleheOutput} from "../src/integrations/osint/adapters/holehe.js";
import {parseH8mailOutput,runH8mail} from "../src/integrations/osint/adapters/h8mail.js";

// Real Holehe 1.61 output shape (core.py): banner, [+] hits (with --only-used), then the legend line.
const HOLEHE_NO_HITS="*************************\n   good@example.com\n*************************\n\n\n[+] Email used, [-] Email not used, [x] Rate limit\n121 websites checked in 6.41 seconds\nTwitter : @palenath\nGithub : https://github.com/megadose/holehe\n";
const HOLEHE_HITS="*************************\n   jane@gmail.com\n*************************\n[+] instagram.com\n[+] spotify.com\n\n[+] Email used, [-] Email not used, [x] Rate limit\n121 websites checked in 7.02 seconds\n";
// Real h8mail 2.5.6 Session Recap rows (summary.py).
const H8_NOT="__________\n\n                                 Session Recap: \n\n                 Target                  |                   Status                  \n__________\n\n            good@example.com             |               Not Compromised              \n";
const H8_HIT="            jane@gmail.com               |        Breach Found (3 elements)          \n";

describe("OSINT parsers use real output formats",()=>{
  it("Holehe legend line is never a site; example.com -> 0 sites",()=>{
    expect(parseHoleheOutput(HOLEHE_NO_HITS)).toEqual([]);
  });
  it("Holehe real [+] hits still count",()=>{
    expect(parseHoleheOutput(HOLEHE_HITS).map(f=>f.site)).toEqual(["instagram","spotify"]);
  });
  it("h8mail 'target | Not Compromised' is not a hit",()=>{
    const f=parseH8mailOutput(H8_NOT);
    expect(f.some(x=>x.kind==="LOCAL_BREACH_HIT")).toBe(false);
  });
  it("h8mail only counts 'Breach Found (N elements)'",()=>{
    const f=parseH8mailOutput(H8_HIT);
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("LOCAL_BREACH_HIT");
    expect(f[0]!.site).toBe("breach found (3 elements)");
  });
  it("h8mail with no breach source configured -> NOT RUN (never executes)",async()=>{
    let ran=false;
    const r=await runH8mail("good@example.com",{H8MAIL_LOCAL_BREACH_PATH:""} as any,async()=>{ran=true;return{command:"h8mail",args:[],code:0,stdout:H8_NOT,stderr:"",timedOut:false} as any},()=>({command:"h8mail",prefixArgs:[]}) as any);
    expect(ran).toBe(false);
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.unavailable_reason).toBe("NO_BREACH_SOURCE_CONFIGURED");
  });
});
