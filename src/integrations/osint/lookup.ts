import type {Lead} from "../../validation/schema.js";
import {env} from "../../config/env.js";
import {runCourtListener,type CourtListenerHttp} from "./adapters/courtlistener.js";
import {runH8mail} from "./adapters/h8mail.js";
import {runHolehe} from "./adapters/holehe.js";
import {runMosint} from "./adapters/mosint.js";
import {runPhoneInfoga} from "./adapters/phoneinfoga.js";
import {resolveTool,runCli,type ResolveTool,type RunCli} from "./cli.js";
import {osintConfigFrom,type OsintConfig} from "./config.js";
import {redactEmail,redactPhone} from "./redact.js";
import {leadEmail,leadPersonName,leadPhone} from "./targets.js";
import {emptyOsintReport,OSINT_CONTRACT,type OsintAdapterResult,type OsintLookupReport} from "./types.js";

export interface OsintLookupDeps{
  run?:RunCli;
  resolve?:ResolveTool;
  config?:OsintConfig;
  courtHttp?:CourtListenerHttp;
}

function riskFlags(adapters:OsintAdapterResult[]):string[]{
  const flags:string[]=[];
  const holehe=adapters.find(a=>a.provider==="holehe");
  if(holehe?.status==="OBSERVED"&&holehe.findings.some(f=>f.kind==="EMAIL_SITE_REGISTRATION")){
    flags.push("HOLEHE_PUBLIC_REGISTRATIONS_OBSERVED");
  }
  const phone=adapters.find(a=>a.provider==="phoneinfoga");
  if(phone?.status==="OBSERVED"&&phone.findings.length){
    flags.push("PHONEINFOGA_METADATA_OBSERVED");
  }
  const mosint=adapters.find(a=>a.provider==="mosint");
  if(mosint?.status==="OBSERVED"&&mosint.findings.length){
    flags.push("MOSINT_RECON_SIGNALS_OBSERVED");
  }
  const h8=adapters.find(a=>a.provider==="h8mail");
  if(h8?.status==="OBSERVED"&&h8.findings.some(f=>f.kind==="LOCAL_BREACH_HIT")){
    flags.push("H8MAIL_LOCAL_BREACH_HIT_OBSERVED");
  }
  const court=adapters.find(a=>a.provider==="courtlistener");
  if(court?.status==="OBSERVED"&&court.findings.some(f=>f.kind==="COURT_DOCKET_HIT")){
    flags.push("COURTLISTENER_PUBLIC_DOCKET_HIT_OBSERVED");
  }
  if(court?.status==="OBSERVED"&&court.findings.some(f=>f.kind==="COURT_CRIMINAL_DOCKET_SIGNAL")){
    flags.push("COURTLISTENER_CRIMINAL_DOCKET_LABEL_OBSERVED");
  }
  return flags;
}

export async function lookupIdentityOsint(lead:Lead,deps:OsintLookupDeps={}):Promise<OsintLookupReport>{
  const cfg=deps.config??osintConfigFrom(env);
  if(!cfg.OSINT_IDENTITY_ENABLED&&!cfg.COURTLISTENER_ENABLED){
    return emptyOsintReport({enabled:false,ran:false,unavailable:["OSINT_IDENTITY_DISABLED"]});
  }
  const email=leadEmail(lead);
  const phone=leadPhone(lead);
  const name=leadPersonName(lead);
  const run=deps.run??runCli;
  const resolve=deps.resolve??resolveTool;
  const jobs:Promise<OsintAdapterResult>[]=[];
  if(cfg.OSINT_IDENTITY_ENABLED){
    jobs.push(
      runHolehe(email,cfg,run,resolve),
      runPhoneInfoga(phone,cfg,run,resolve),
      runMosint(email,cfg,run,resolve),
      runH8mail(email,cfg,run,resolve)
    );
  }
  if(cfg.COURTLISTENER_ENABLED){
    jobs.push(runCourtListener(name,lead.state,cfg,deps.courtHttp));
  }
  const adapters=await Promise.all(jobs);
  const unavailable=adapters.filter(a=>a.status==="UNAVAILABLE"||a.status==="SKIPPED").map(a=>`${a.provider.toUpperCase()}:${a.unavailable_reason??a.status}`);
  const errors=adapters.flatMap(a=>a.errors.map(err=>`${a.provider}:${err}`));
  return{
    capability:"IDENTITY_OSINT_LOOKUP",
    enabled:true,
    ran:true,
    email_redacted:email?redactEmail(email):undefined,
    phone_redacted:phone?redactPhone(phone):undefined,
    adapters,
    risk_flags:riskFlags(adapters),
    unavailable,
    errors,
    contract:OSINT_CONTRACT
  };
}
