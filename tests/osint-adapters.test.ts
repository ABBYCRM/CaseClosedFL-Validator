import {describe,expect,it} from "vitest";
import {runH8mail,parseH8mailOutput} from "../src/integrations/osint/adapters/h8mail.js";
import {runHolehe,parseHoleheOutput} from "../src/integrations/osint/adapters/holehe.js";
import {runMosint,parseMosintOutput} from "../src/integrations/osint/adapters/mosint.js";
import {runPhoneInfoga,parsePhoneInfogaOutput} from "../src/integrations/osint/adapters/phoneinfoga.js";
import {commandExists,resolveTool} from "../src/integrations/osint/cli.js";
import {osintConfigFrom} from "../src/integrations/osint/config.js";
import {redactEmail,redactPhone,stripSecretPairs} from "../src/integrations/osint/redact.js";
import type {OsintConfig} from "../src/integrations/osint/config.js";
import type {CliResult,ResolvedCommand} from "../src/integrations/osint/cli.js";

const cfg=osintConfigFrom({OSINT_IDENTITY_ENABLED:"true"});

function cli(stdout:string,code=0):CliResult{
  return{command:"mock",args:[],code,stdout,stderr:"",timedOut:false};
}

function resolveNone(){return undefined;}
function resolveBin(bin="mock"):()=>ResolvedCommand{
  return()=>({command:bin,prefixArgs:[],via:"bin"});
}

describe("OSINT parsers",()=>{
  it("parses Holehe used-site lines and ignores unused markers",()=>{
    const findings=parseHoleheOutput("[+] instagram\n[-] facebook\n[+] twitter : used\n");
    expect(findings.map(f=>f.site).sort()).toEqual(["instagram","twitter"]);
    expect(findings.every(f=>f.kind==="EMAIL_SITE_REGISTRATION")).toBe(true);
  });
  it("parses PhoneInfoga labeled metadata without inventing extra fields",()=>{
    const findings=parsePhoneInfogaOutput("Valid: true\nCountry: United States\nLine type: mobile\n");
    expect(findings.some(f=>f.observation.includes("country=United States"))).toBe(true);
    expect(findings.some(f=>f.observation.includes("line_type=mobile"))).toBe(true);
    expect(findings).toHaveLength(3);
  });
  it("parses Mosint plus-lines and redacts secret-looking pairs",()=>{
    const findings=parseMosintOutput("[+] related domain example.com\nuser@example.com:SuperSecretHash999\n");
    expect(findings.some(f=>f.observation.includes("related domain example.com"))).toBe(true);
    expect(JSON.stringify(findings)).not.toMatch(/SuperSecretHash999/);
  });
  it("parses h8mail hit counts and redacts credential pairs",()=>{
    const findings=parseH8mailOutput("Found 2 results\nlead@example.com:hunter2\n");
    expect(findings.some(f=>f.kind==="LOCAL_BREACH_HIT")).toBe(true);
    expect(findings.some(f=>/2/.test(f.observation))).toBe(true);
    expect(JSON.stringify(findings)).not.toMatch(/hunter2/);
  });
  it("records h8mail no-hit as UNKNOWN-style none, not fraud",()=>{
    expect(parseH8mailOutput("No results found for target").some(f=>f.kind==="LOCAL_BREACH_NONE")).toBe(true);
  });
});

describe("OSINT adapters fail soft",()=>{
  it("skips when email or phone is missing instead of inventing evidence",async()=>{
    const holehe=await runHolehe(undefined,cfg,async()=>cli(""),resolveBin());
    const phone=await runPhoneInfoga(undefined,cfg,async()=>cli(""),resolveBin());
    expect(holehe.status).toBe("SKIPPED");
    expect(holehe.unavailable_reason).toBe("NO_EMAIL_SUPPLIED");
    expect(holehe.findings).toEqual([]);
    expect(phone.status).toBe("SKIPPED");
    expect(phone.unavailable_reason).toBe("NO_PHONE_SUPPLIED");
  });
  it("returns UNAVAILABLE when OSS binaries are missing",async()=>{
    const holehe=await runHolehe("jane@example.com",cfg,async()=>{throw new Error("should-not-run");},resolveNone);
    const phone=await runPhoneInfoga("+13055550100",cfg,async()=>{throw new Error("should-not-run");},resolveNone);
    const mosint=await runMosint("jane@example.com",cfg,async()=>{throw new Error("should-not-run");},resolveNone);
    const h8=await runH8mail("jane@example.com",cfg,async()=>{throw new Error("should-not-run");},resolveNone);
    expect([holehe,phone,mosint,h8].map(a=>a.status)).toEqual(["UNAVAILABLE","UNAVAILABLE","UNAVAILABLE","UNAVAILABLE"]);
    expect(holehe.unavailable_reason).toBe("HOLEHE_BIN_NOT_FOUND");
    expect(phone.unavailable_reason).toBe("PHONEINFOGA_BIN_NOT_FOUND");
    expect(mosint.unavailable_reason).toBe("MOSINT_BIN_NOT_FOUND");
    expect(h8.unavailable_reason).toBe("H8MAIL_BIN_NOT_FOUND");
    expect([holehe,phone,mosint,h8].every(a=>a.findings.length===0)).toBe(true);
  });
  it("returns OBSERVED findings from mocked CLI stdout only",async()=>{
    const holehe=await runHolehe("jane@example.com",cfg,async()=>cli("[+] instagram\n"),resolveBin());
    expect(holehe.status).toBe("OBSERVED");
    expect(holehe.target_redacted).toBe("j***@example.com");
    expect(holehe.findings[0]?.site).toBe("instagram");
  });
  it("does not treat a missing paid API key as a code path — paid adapters are not implemented",()=>{
    const parsed=osintConfigFrom({});
    expect(parsed).not.toHaveProperty("HUNTER_API_KEY");
    expect(parsed).not.toHaveProperty("HIBP_API_KEY");
    expect(parsed).not.toHaveProperty("DEHASHED_API_KEY");
    expect(parsed).not.toHaveProperty("INTELX_API_KEY");
    expect(parsed).not.toHaveProperty("EPIEOS_API_KEY");
    expect(Object.keys(parsed).join(" ")).not.toMatch(/HUNTER|HIBP|DEHASHED|INTELX|EPIEOS/i);
  });
});

describe("OSINT helpers",()=>{
  it("redacts email and phone for notes",()=>{
    expect(redactEmail("paisabrazilfl@gmail.com")).toBe("p***@gmail.com");
    expect(redactPhone("+13055550100")).toBe("+***0100");
  });
  it("strips credential pairs before persistence",()=>{
    expect(stripSecretPairs("a@b.com:hunter2")).toBe("[credential-pair-redacted]");
  });
  it("resolveTool is unavailable when bin and docker image are absent",()=>{
    const empty:OsintConfig=osintConfigFrom({HOLEHE_BIN:"holehe-not-installed-xyz",HOLEHE_DOCKER_IMAGE:"",OSINT_DOCKER_IMAGE:""});
    expect(resolveTool("holehe",empty)).toBeUndefined();
    expect(commandExists("this-binary-should-not-exist-osint-9f3")).toBe(false);
  });
});
