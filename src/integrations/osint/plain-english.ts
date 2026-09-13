import {COURTLISTENER_DISCLAIMER} from "./adapters/courtlistener.js";
import type {OsintAdapterResult,OsintFinding,OsintLookupReport} from "./types.js";
import type {StaffVerdict} from "./verdict.js";

const INFRA_TOKEN=/\b(?:mx|ns|txt|soa|asn|aaaa?|cname|ptr|spf|dmarc|dkim|nameserver|name[-\s]?server|resolver|ipv[46]|cidr|bgp|whois)\b/i;
const INFRA_ASSIGN=/\b(?:mx|ns|txt|soa|asn|aaaa?|cname|ptr|ip|dns)[_\s]*=/i;
const IPV4=/\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const INTERNAL_ID=/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

export const STAFF_COURT_DISCLAIMER="No public federal court hits. This is NOT a full criminal check. Absence does not mean clearance.";
export const STAFF_BREACH_SECRETS="Passwords were NOT saved or written to HubSpot.";
export const STAFF_MOSINT_NO_DNS="We do not dump DNS, MX, NS, TXT, SOA, ASN, or IP lines into this note.";
export const STAFF_TOOLS_LINE="• Tools used: Holehe, PhoneInfoga, Mosint, h8mail (free public-record checks); CourtListener (free public federal/RECAP dockets only — not a criminal background check; we never buy PACER). Paid Hunter / HIBP / DeHashed / IntelX / Epieos are not used.";

export function isRawInfrastructureDump(text:string){
  const t=String(text??"");
  return INFRA_TOKEN.test(t)||INFRA_ASSIGN.test(t)||IPV4.test(t);
}

export function isInternalToken(text:string){
  return INTERNAL_ID.test(String(text??""));
}

export function looksLikeGoogleGmail(emailRedacted?:string,adapter?:OsintAdapterResult){
  const blob=[emailRedacted??"",...(adapter?.findings??[]).map(f=>`${f.signal??""} ${f.observation}`)].join(" ").toLowerCase();
  return /gmail|googlemail|google\.com|aspmx|google mail/.test(blob);
}

function sitesOf(adapter?:OsintAdapterResult){
  return [...new Set((adapter?.findings??[]).map(f=>f.site).filter((s):s is string=>!!s?.trim()))];
}

function staffUnavailable(reason?:string){
  const r=String(reason??"");
  if(/timeout/i.test(r)) return "the check timed out";
  if(/bin_not_found|not_found/i.test(r)) return "the tool was not available";
  if(/disabled/i.test(r)) return "the check was turned off";
  if(/token|auth/i.test(r)) return "the court-records login was missing or rejected";
  if(/rate.?limit/i.test(r)) return "the court-records service asked us to slow down";
  if(/no_email/i.test(r)) return "no email was supplied";
  if(/no_phone/i.test(r)) return "no phone was supplied";
  if(/no_full_name/i.test(r)) return "no full name was supplied";
  if(/empty/i.test(r)) return "the check returned nothing we could read";
  return "the check did not finish";
}

function adapterDidNotRun(adapter?:OsintAdapterResult){
  if(!adapter) return true;
  return adapter.status==="UNAVAILABLE"||adapter.status==="ERROR"||adapter.status==="SKIPPED"||adapter.status==="DISABLED";
}

function missingLine(label:string,adapter?:OsintAdapterResult){
  if(!adapter) return `• ${label}: did not run — missing check, not a risk flag.`;
  return `• ${label}: did not finish (${staffUnavailable(adapter.unavailable_reason)}) — missing check, not a risk flag.`;
}

function holeheLine(adapter:OsintAdapterResult|undefined,emailRedacted?:string):string{
  const label="Public sites (Holehe)";
  if(adapterDidNotRun(adapter)) return missingLine(label,adapter);
  const sites=sitesOf(adapter);
  const gmailish=looksLikeGoogleGmail(emailRedacted,adapter);
  const normal=gmailish?" — normal for a real Gmail":" — normal for a real everyday email";
  if(sites.length){
    const shown=sites.slice(0,8).join(", ");
    const extra=sites.length>8?` and ${sites.length-8} more`:"";
    return `• ${label}: email shows up on public sites (${shown}${extra})${normal}.`;
  }
  return `• ${label}: email did not show up on the public sites we checked. That can happen and is not proof of a fake email.`;
}

function phoneBlob(adapter?:OsintAdapterResult){
  return (adapter?.findings??[]).map(f=>`${f.signal??""} ${f.observation}`).join("\n").toLowerCase();
}

function phoneLine(adapter:OsintAdapterResult|undefined):string{
  const label="Phone";
  if(adapterDidNotRun(adapter)) return missingLine(label,adapter);
  const blob=phoneBlob(adapter);
  const invalid=/\binvalid\b/.test(blob)||/\bvalid\s*=\s*(false|no|0)\b/.test(blob);
  const voip=/voip|virtual|toll[-\s]?free|premium/.test(blob);
  const mobile=/mobile|cell|wireless/.test(blob);
  const landline=/landline|fixed|wireline/.test(blob);
  const us=/united states|\busa\b|\bcountry\s*=\s*us\b/.test(blob);
  if(invalid) return `• ${label}: the number did not look valid. Worth a glance — not a fraud accusation by itself.`;
  if(voip) return `• ${label}: looks like a VOIP / internet number. Worth a glance — not a fraud accusation by itself.`;
  if(mobile&&us) return `• ${label}: looks like a US mobile.`;
  if(mobile) return `• ${label}: looks like a mobile number.`;
  if(landline) return `• ${label}: looks like a landline.`;
  return `• ${label}: we saw ordinary phone details. Nothing here is a fraud accusation.`;
}

function mosintLine(adapter:OsintAdapterResult|undefined,emailRedacted?:string):string{
  const label="Email recon (Mosint)";
  if(adapterDidNotRun(adapter)) return missingLine(label,adapter);
  const gmailish=looksLikeGoogleGmail(emailRedacted,adapter);
  if(gmailish) return `• ${label}: looks like a normal Google/Gmail-looking address. ${STAFF_MOSINT_NO_DNS}`;
  const useful=(adapter?.findings??[]).filter(f=>!isRawInfrastructureDump(`${f.signal??""} ${f.observation}`));
  if(useful.length) return `• ${label}: email recon looks ordinary for this address. ${STAFF_MOSINT_NO_DNS}`;
  return `• ${label}: nothing unusual turned up. ${STAFF_MOSINT_NO_DNS}`;
}

function h8mailLine(adapter:OsintAdapterResult|undefined):string{
  const label="Old breach dataset (h8mail)";
  if(adapterDidNotRun(adapter)) return missingLine(label,adapter);
  const hit=(adapter?.findings??[]).some(f=>f.kind==="LOCAL_BREACH_HIT");
  if(hit){
    return `• ${label}: email showed up in an old breach dataset. ${STAFF_BREACH_SECRETS} This is a yellow flag by itself, not a red flag.`;
  }
  return `• ${label}: email did not show up in the old breach files we checked. ${STAFF_BREACH_SECRETS} No hit is not proof the person is “clean.”`;
}

function courtLines(adapter:OsintAdapterResult|undefined):string[]{
  const label="Court records (CourtListener)";
  if(!adapter) return [];
  if(adapterDidNotRun(adapter)) return [missingLine(label,adapter),`• CourtListener disclaimer: ${COURTLISTENER_DISCLAIMER}`];
  const hits=(adapter.findings??[]).filter(f=>f.kind==="COURT_DOCKET_HIT");
  const criminal=(adapter.findings??[]).some(f=>f.kind==="COURT_CRIMINAL_DOCKET_SIGNAL");
  const lines:string[]=[];
  if(criminal){
    lines.push(`• ${label}: a public docket uses criminal-case wording. That is a label on a public record — not a conviction and NOT a full criminal check.`);
  }else if(hits.length){
    lines.push(`• ${label}: public docket hit(s) showed up. This is NOT a full criminal check. Absence or presence here is not clearance.`);
  }else{
    lines.push(`• ${label}: ${STAFF_COURT_DISCLAIMER}`);
  }
  const named=hits.slice(0,3).map(staffCourtHit).filter(Boolean);
  for(const line of named) lines.push(`  • ${line}`);
  if(hits.length>3) lines.push(`  • ${hits.length-3} more public docket hit(s) omitted for note size. No PACER documents were purchased.`);
  lines.push(`• CourtListener disclaimer: ${COURTLISTENER_DISCLAIMER}`);
  return lines;
}

function staffCourtHit(finding:OsintFinding){
  const obs=finding.observation.replace(/^Public RECAP docket observed:\s*/i,"").replace(/\.$/,"");
  const caseName=obs.match(/case\s+([^;]+)/i)?.[1]?.trim();
  const court=obs.match(/court\s+([^;]+)/i)?.[1]?.trim();
  const docket=obs.match(/docket\s+([^;]+)/i)?.[1]?.trim();
  const parts=[caseName,court,docket].filter(Boolean);
  if(!parts.length) return "";
  return `Public docket: ${parts.join(" · ")}`;
}

export function formatStaffOsintAdapterLines(report?:OsintLookupReport|null):string[]{
  if(!report||!report.enabled){
    return["• These public-record checks did not run. Missing checks do not count as risk."];
  }
  const by=(p:OsintAdapterResult["provider"])=>report.adapters.find(a=>a.provider===p);
  const holehe=by("holehe");
  const phone=by("phoneinfoga");
  const mosint=by("mosint");
  const h8=by("h8mail");
  const court=by("courtlistener");
  const lines:string[]=[];
  if(holehe||!court||report.adapters.some(a=>a.provider!=="courtlistener")){
    lines.push(holeheLine(holehe,report.email_redacted));
    lines.push(phoneLine(phone));
    lines.push(mosintLine(mosint,report.email_redacted));
    lines.push(h8mailLine(h8));
  }
  if(court) lines.push(...courtLines(court));
  return lines;
}

export function staffWhyHeading(verdict:StaffVerdict){
  if(verdict.level==="CAUTION") return "• Why this is yellow (not a fraud accusation):";
  if(verdict.level==="RED_FLAG") return "• Why this is a hold:";
  if(verdict.level==="INCOMPLETE") return "• Why this is incomplete (not a fail on the person):";
  return "";
}

export function stripInternalIdsFromStaffLine(line:string){
  return line.replace(INTERNAL_ID,"[internal-id-omitted]");
}
