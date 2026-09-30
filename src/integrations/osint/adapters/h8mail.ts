import {existsSync} from "node:fs";
import type {OsintConfig} from "../config.js";
import {keyed} from "../config.js";
import {errorResult,skippedResult,unavailableResult,type ResolveTool,type RunCli} from "../cli.js";
import {redactEmail,stripSecretPairs} from "../redact.js";
import type {OsintAdapterResult,OsintFinding} from "../types.js";

export function parseH8mailOutput(stdout:string):OsintFinding[]{
  const findings:OsintFinding[]=[];
  const text=stripSecretPairs(stdout);
  // Only h8mail's Session Recap line "Breach Found (N elements)" is a real hit.
  let total=0;
  for(const m of stdout.matchAll(/Breach Found \((\d+) elements?\)/gi)) total+=Number(m[1])||0;
  if(total>0){
    findings.push({
      kind:"LOCAL_BREACH_HIT",
      signal:"BREACH_FOUND",
      site:`breach found (${total} element${total===1?"":"s"})`,
      observation:`h8mail reported Breach Found (${total} elements). Secrets were redacted.`
    });
  }else if(/Not Compromised|No results founds?/i.test(text)){
    findings.push({
      kind:"LOCAL_BREACH_NONE",
      signal:"NONE",
      observation:"h8mail reported no local/public-source hits. Absence of hits is not proof of authenticity."
    });
  }
  return findings;
}

export async function runH8mail(email:string|undefined,cfg:OsintConfig,run:RunCli,resolve:ResolveTool):Promise<OsintAdapterResult>{
  if(!email) return skippedResult("h8mail","LOCAL_BREACH","email","NO_EMAIL_SUPPLIED");
  const redacted=redactEmail(email);
  const resolved=resolve("h8mail",cfg);
  if(!resolved) return unavailableResult("h8mail","LOCAL_BREACH","email","H8MAIL_BIN_NOT_FOUND",redacted);
  // No breach source configured => NOT RUN (free sources return nothing usable).
  if(!keyed(cfg.H8MAIL_LOCAL_BREACH_PATH)) return unavailableResult("h8mail","LOCAL_BREACH","email","NO_BREACH_SOURCE_CONFIGURED",redacted);
  if(!existsSync(cfg.H8MAIL_LOCAL_BREACH_PATH)){
    return unavailableResult("h8mail","LOCAL_BREACH","email","H8MAIL_LOCAL_BREACH_PATH_MISSING",redacted);
  }
  const args=[...resolved.prefixArgs,"-t",email,"-lb",cfg.H8MAIL_LOCAL_BREACH_PATH];
  const result=await run(resolved.command,args,{timeoutMs:cfg.H8MAIL_TIMEOUT_MS});
  if(result.timedOut) return errorResult("h8mail","LOCAL_BREACH","email","H8MAIL_TIMEOUT",redacted);
  if(result.error&&result.code===null) return errorResult("h8mail","LOCAL_BREACH","email",result.error,redacted);
  if(result.code!==0&&!result.stdout.trim()){
    return errorResult("h8mail","LOCAL_BREACH","email",`H8MAIL_EXIT_${result.code}:${(result.stderr||result.error||"").slice(0,240)}`,redacted);
  }
  return{
    provider:"h8mail",
    capability:"LOCAL_BREACH",
    status:"OBSERVED",
    target_type:"email",
    target_redacted:redacted,
    findings:parseH8mailOutput(result.stdout),
    errors:result.code===0?[]:[`H8MAIL_NONZERO_EXIT_${result.code}`],
    checks_performed:["H8MAIL_LOCAL_BREACH_FILE"]
  };
}
