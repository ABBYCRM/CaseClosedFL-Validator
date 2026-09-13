import type {OsintConfig} from "../config.js";
import {errorResult,skippedResult,unavailableResult,type ResolveTool,type RunCli} from "../cli.js";
import {redactEmail} from "../redact.js";
import type {OsintAdapterResult,OsintFinding} from "../types.js";

const SITE_RE=/^\[\+\]\s*(?:email used(?: on)?[:\s]+)?([A-Za-z0-9._-]+)/i;
const USED_RE=/\[\+\].*(used|found|exists|registered)/i;

export function parseHoleheOutput(stdout:string):OsintFinding[]{
  const findings:OsintFinding[]=[];
  const seen=new Set<string>();
  for(const raw of stdout.split("\n")){
    const line=raw.trim();
    if(!line.startsWith("[+]")) continue;
    const siteMatch=line.match(SITE_RE);
    const site=(siteMatch?.[1]??line.replace(/^\[\+\]\s*/,"")).replace(/[:.].*$/,"").trim();
    const key=site.toLowerCase();
    if(!key||seen.has(key)) continue;
    if(!USED_RE.test(line)&&!siteMatch) continue;
    seen.add(key);
    findings.push({
      kind:"EMAIL_SITE_REGISTRATION",
      site:key,
      observation:`Holehe observed a public registration signal for ${key}.`,
      signal:"USED"
    });
  }
  return findings;
}

export async function runHolehe(email:string|undefined,cfg:OsintConfig,run:RunCli,resolve:ResolveTool):Promise<OsintAdapterResult>{
  if(!email) return skippedResult("holehe","EMAIL_REGISTRATION","email","NO_EMAIL_SUPPLIED");
  const redacted=redactEmail(email);
  const resolved=resolve("holehe",cfg);
  if(!resolved) return unavailableResult("holehe","EMAIL_REGISTRATION","email","HOLEHE_BIN_NOT_FOUND",redacted);
  const args=[...resolved.prefixArgs,email];
  if(cfg.HOLEHE_ONLY_USED) args.push("--only-used");
  args.push("--no-color","--no-clear");
  const result=await run(resolved.command,args,{timeoutMs:cfg.HOLEHE_TIMEOUT_MS});
  if(result.timedOut) return errorResult("holehe","EMAIL_REGISTRATION","email","HOLEHE_TIMEOUT",redacted);
  if(result.error&&result.code===null) return errorResult("holehe","EMAIL_REGISTRATION","email",result.error,redacted);
  if(result.code!==0&&!result.stdout.trim()){
    return errorResult("holehe","EMAIL_REGISTRATION","email",`HOLEHE_EXIT_${result.code}:${(result.stderr||result.error||"").slice(0,240)}`,redacted);
  }
  const findings=parseHoleheOutput(result.stdout);
  return{
    provider:"holehe",
    capability:"EMAIL_REGISTRATION",
    status:"OBSERVED",
    target_type:"email",
    target_redacted:redacted,
    findings,
    errors:result.code===0?[]:[`HOLEHE_NONZERO_EXIT_${result.code}`],
    checks_performed:["HOLEHE_EMAIL_SITE_REGISTRATION"]
  };
}
