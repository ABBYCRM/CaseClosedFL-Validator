import type {OsintConfig} from "../config.js";
import {errorResult,skippedResult,unavailableResult,type ResolveTool,type RunCli} from "../cli.js";
import {redactEmail,stripSecretPairs} from "../redact.js";
import type {OsintAdapterResult,OsintFinding} from "../types.js";

const SKIP_KEYS=new Set(["email","query","status","success","error"]);

function collectJsonFindings(value:unknown,into:OsintFinding[],depth=0){
  if(depth>6||value==null) return;
  if(Array.isArray(value)){
    for(const item of value) collectJsonFindings(item,into,depth+1);
    return;
  }
  if(typeof value!=="object") return;
  const rec=value as Record<string,unknown>;
  for(const [key,val] of Object.entries(rec)){
    if(SKIP_KEYS.has(key.toLowerCase())) continue;
    if(typeof val==="string"||typeof val==="number"||typeof val==="boolean"){
      const text=stripSecretPairs(String(val)).trim();
      if(!text||text==="null"||text==="[]") continue;
      into.push({
        kind:"EMAIL_RECON_SIGNAL",
        signal:key,
        observation:`Mosint observed ${key}=${text.slice(0,240)}.`
      });
    }else{
      collectJsonFindings(val,into,depth+1);
    }
  }
}

export function parseMosintOutput(stdout:string):OsintFinding[]{
  const findings:OsintFinding[]=[];
  const trimmed=stdout.trim();
  if(trimmed.startsWith("{")||trimmed.startsWith("[")){
    try{
      collectJsonFindings(JSON.parse(trimmed),findings);
      return findings;
    }catch{/* text parse */}
  }
  for(const raw of stdout.split("\n")){
    const line=stripSecretPairs(raw).trim();
    if(!line) continue;
    if(/^\[\+\]/.test(line)){
      findings.push({
        kind:"EMAIL_RECON_SIGNAL",
        observation:`Mosint observed: ${line.replace(/^\[\+\]\s*/,"").slice(0,240)}.`,
        signal:"PLUS"
      });
    }else if(/^[A-Za-z][\w /-]{1,40}:\s+\S+/.test(line)&&!/^email:/i.test(line)){
      findings.push({
        kind:"EMAIL_RECON_SIGNAL",
        observation:`Mosint observed: ${line.slice(0,240)}.`,
        signal:"FIELD"
      });
    }
  }
  return findings;
}

export async function runMosint(email:string|undefined,cfg:OsintConfig,run:RunCli,resolve:ResolveTool):Promise<OsintAdapterResult>{
  if(!email) return skippedResult("mosint","EMAIL_RECON","email","NO_EMAIL_SUPPLIED");
  const redacted=redactEmail(email);
  const resolved=resolve("mosint",cfg);
  if(!resolved) return unavailableResult("mosint","EMAIL_RECON","email","MOSINT_BIN_NOT_FOUND",redacted);
  const args=[...resolved.prefixArgs,email];
  const result=await run(resolved.command,args,{timeoutMs:cfg.MOSINT_TIMEOUT_MS});
  if(result.timedOut) return errorResult("mosint","EMAIL_RECON","email","MOSINT_TIMEOUT",redacted);
  if(result.error&&result.code===null) return errorResult("mosint","EMAIL_RECON","email",result.error,redacted);
  if(result.code!==0&&!result.stdout.trim()){
    return errorResult("mosint","EMAIL_RECON","email",`MOSINT_EXIT_${result.code}:${(result.stderr||result.error||"").slice(0,240)}`,redacted);
  }
  return{
    provider:"mosint",
    capability:"EMAIL_RECON",
    status:"OBSERVED",
    target_type:"email",
    target_redacted:redacted,
    findings:parseMosintOutput(result.stdout),
    errors:result.code===0?[]:[`MOSINT_NONZERO_EXIT_${result.code}`],
    checks_performed:["MOSINT_EMAIL_RECON"]
  };
}
