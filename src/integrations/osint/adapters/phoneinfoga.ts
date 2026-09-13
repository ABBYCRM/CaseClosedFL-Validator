import type {OsintConfig} from "../config.js";
import {errorResult,skippedResult,unavailableResult,type ResolveTool,type RunCli} from "../cli.js";
import {redactPhone} from "../redact.js";
import type {OsintAdapterResult,OsintFinding} from "../types.js";

const LABEL_RE=/^\s*(valid|number|e164|country|country code|carrier|line type|location|local format|international format)\s*[:\-]\s*(.+)$/i;

function pushFinding(findings:OsintFinding[],kind:string,observation:string,signal?:string){
  findings.push({kind,observation,signal});
}

export function parsePhoneInfogaOutput(stdout:string):OsintFinding[]{
  const findings:OsintFinding[]=[];
  const trimmed=stdout.trim();
  if(trimmed.startsWith("{")||trimmed.startsWith("[")){
    try{
      const json=JSON.parse(trimmed);
      const rows=Array.isArray(json)?json:[json];
      for(const row of rows){
        if(!row||typeof row!=="object") continue;
        const rec=row as Record<string,unknown>;
        for(const key of["valid","number","e164","country","countryCode","carrier","lineType","location"]){
          if(rec[key]===undefined||rec[key]===null||rec[key]==="") continue;
          pushFinding(findings,"PHONE_METADATA",`PhoneInfoga observed ${key}=${String(rec[key])}.`,key);
        }
      }
      return findings;
    }catch{/* fall through to text parse */}
  }
  for(const raw of stdout.split("\n")){
    const line=raw.trim();
    const m=line.match(LABEL_RE);
    if(!m) continue;
    const label=m[1]!.toLowerCase().replace(/\s+/g,"_");
    const value=m[2]!.trim();
    if(!value) continue;
    pushFinding(findings,"PHONE_METADATA",`PhoneInfoga observed ${label}=${value}.`,label);
  }
  if(!findings.length&&/\b(valid|carrier|country|line type)\b/i.test(stdout)){
    pushFinding(findings,"PHONE_METADATA","PhoneInfoga returned scan text without structured fields.", "UNSTRUCTURED");
  }
  return findings;
}

export async function runPhoneInfoga(phone:string|undefined,cfg:OsintConfig,run:RunCli,resolve:ResolveTool):Promise<OsintAdapterResult>{
  if(!phone) return skippedResult("phoneinfoga","PHONE_LOOKUP","phone","NO_PHONE_SUPPLIED");
  const redacted=redactPhone(phone);
  const resolved=resolve("phoneinfoga",cfg);
  if(!resolved) return unavailableResult("phoneinfoga","PHONE_LOOKUP","phone","PHONEINFOGA_BIN_NOT_FOUND",redacted);
  const args=[...resolved.prefixArgs,"scan","-n",phone];
  const result=await run(resolved.command,args,{timeoutMs:cfg.PHONEINFOGA_TIMEOUT_MS});
  if(result.timedOut) return errorResult("phoneinfoga","PHONE_LOOKUP","phone","PHONEINFOGA_TIMEOUT",redacted);
  if(result.error&&result.code===null) return errorResult("phoneinfoga","PHONE_LOOKUP","phone",result.error,redacted);
  if(result.code!==0&&!result.stdout.trim()){
    return errorResult("phoneinfoga","PHONE_LOOKUP","phone",`PHONEINFOGA_EXIT_${result.code}:${(result.stderr||result.error||"").slice(0,240)}`,redacted);
  }
  return{
    provider:"phoneinfoga",
    capability:"PHONE_LOOKUP",
    status:"OBSERVED",
    target_type:"phone",
    target_redacted:redacted,
    findings:parsePhoneInfogaOutput(result.stdout),
    errors:result.code===0?[]:[`PHONEINFOGA_NONZERO_EXIT_${result.code}`],
    checks_performed:["PHONEINFOGA_LOCAL_SCAN"]
  };
}
