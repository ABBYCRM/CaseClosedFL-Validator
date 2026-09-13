import type {OsintAdapterResult,OsintLookupReport} from "./types.js";

const FINDING_CAP=80;
const LINE_CAP=400;

function adapterTitle(provider:string){
  if(provider==="holehe") return "Holehe (email site registrations)";
  if(provider==="phoneinfoga") return "PhoneInfoga (phone signals)";
  if(provider==="mosint") return "Mosint (email recon)";
  if(provider==="h8mail") return "h8mail (local/free breach)";
  return provider;
}

function adapterLines(adapter:OsintAdapterResult):string[]{
  const lines:string[]=[];
  const target=adapter.target_redacted?` for ${adapter.target_redacted}`:"";
  lines.push(`• ${adapterTitle(adapter.provider)}: ${adapter.status}${target}`);
  if(adapter.unavailable_reason) lines.push(`  • Unavailable: ${adapter.unavailable_reason}`);
  if(adapter.checks_performed.length) lines.push(`  • Checks performed: ${adapter.checks_performed.join(", ")}`);
  const findings=adapter.findings.slice(0,FINDING_CAP);
  if(!findings.length&&adapter.status==="OBSERVED"){
    lines.push("  • No structured findings were parsed. That is UNKNOWN, not a fraud signal.");
  }
  for(const finding of findings){
    const site=finding.site?` [${finding.site}]`:"";
    lines.push(`  • ${finding.kind}${site}: ${finding.observation}`);
  }
  if(adapter.findings.length>FINDING_CAP){
    lines.push(`  • … ${adapter.findings.length-FINDING_CAP} additional finding(s) omitted for note size`);
  }
  for(const err of adapter.errors) lines.push(`  • Error: ${err}`);
  return lines;
}

/** Full OSINT block for human_note / HubSpot NOTE. Do not truncate typical adapter output. */
export function formatOsintNoteLines(report:OsintLookupReport|undefined|null):string[]{
  if(!report){
    return[
      "🔎 *OSINT identity*",
      "• Status: UNKNOWN — OSINT report was not attached. Absence is not fraud.",
      "• Paid APIs (Hunter, HIBP, DeHashed, IntelX, Epieos) are out of scope."
    ];
  }
  const lines:string[]=["🔎 *OSINT identity*"];
  if(!report.enabled){
    lines.push("• Status: DISABLED — set OSINT_IDENTITY_ENABLED=true to run Holehe, PhoneInfoga, Mosint, and h8mail during validation.");
    lines.push("• No OSINT evidence was collected. UNKNOWN is not a fraud accusation.");
    lines.push("• Paid APIs (Hunter, HIBP, DeHashed, IntelX, Epieos) are out of scope.");
    return lines;
  }
  lines.push(`• Status: ${report.ran?"RAN":"NOT_RUN"} — capability ${report.capability}`);
  lines.push(`• Email: ${report.email_redacted??"not supplied"}`);
  lines.push(`• Phone: ${report.phone_redacted??"not supplied"}`);
  if(report.risk_flags.length){
    lines.push("• Observational risk flags (not a fraud verdict):");
    for(const flag of report.risk_flags) lines.push(`  • ${flag}`);
  }else{
    lines.push("• Observational risk flags: none. Missing hits are UNKNOWN, not clearance and not fraud.");
  }
  for(const adapter of report.adapters) lines.push(...adapterLines(adapter));
  if(report.unavailable.length){
    lines.push("• Unavailable / skipped checks:");
    for(const item of report.unavailable) lines.push(`  • ${item}`);
  }
  if(report.errors.length){
    lines.push("• Adapter errors (soft-fail; validation continues):");
    for(const err of report.errors) lines.push(`  • ${err}`);
  }
  lines.push("• Contract: evidence-only. UNKNOWN/UNAVAILABLE is not fraud. The validator never contacts claimants.");
  lines.push("• Paid APIs (Hunter, HIBP, DeHashed, IntelX, Epieos) are out of scope for this path.");
  return lines.slice(0,LINE_CAP);
}

export function isOsintDimensionKey(key:string){
  return key==="identity_osint"||key==="osint_identity"||key==="IDENTITY_OSINT_LOOKUP";
}
