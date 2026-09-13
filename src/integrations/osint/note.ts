import type {OsintAdapterResult,OsintLookupReport} from "./types.js";
import {
  formatContactLines,
  formatStaffVerdictLines,
  observationalFlags,
  scoreStaffVerdict,
  type StaffContact,
  type StaffVerdict
} from "./verdict.js";

const FINDING_CAP=80;
const LINE_CAP=400;
const TOOLS_LINE="• Tools: Holehe, PhoneInfoga, Mosint, h8mail (free OSS only; paid Hunter / HIBP / DeHashed / IntelX / Epieos are out of scope)";

function adapterTitle(provider:string){
  if(provider==="holehe") return "Holehe (email site registrations)";
  if(provider==="phoneinfoga") return "PhoneInfoga (phone signals)";
  if(provider==="mosint") return "Mosint (email recon)";
  if(provider==="h8mail") return "h8mail (local/free breach)";
  return provider;
}

function statusLabel(adapter:OsintAdapterResult){
  if(adapter.status==="UNAVAILABLE") return "UNAVAILABLE — missing check, not risk";
  if(adapter.status==="ERROR") {
    const timeout=/timeout/i.test(`${adapter.unavailable_reason??""} ${adapter.errors.join(" ")}`);
    return timeout?"TIMEOUT — missing check, not risk":"ERROR — missing check, not risk";
  }
  if(adapter.status==="SKIPPED") return "SKIPPED — no target supplied (not risk)";
  if(adapter.status==="DISABLED") return "DISABLED — missing check, not risk";
  return adapter.status;
}

function adapterLines(adapter:OsintAdapterResult):string[]{
  const lines:string[]=[];
  const target=adapter.target_redacted?` for ${adapter.target_redacted}`:"";
  lines.push(`• ${adapterTitle(adapter.provider)}: ${statusLabel(adapter)}${target}`);
  if(adapter.unavailable_reason) lines.push(`  • Unavailable: ${adapter.unavailable_reason}`);
  const findings=adapter.findings.slice(0,FINDING_CAP);
  if(!findings.length&&adapter.status==="OBSERVED"){
    lines.push("  • No structured findings were parsed. That is UNKNOWN, not a risk signal.");
  }
  for(const finding of findings){
    const site=finding.site?`${finding.site}: `:"";
    lines.push(`  • ${site}${finding.observation}`);
  }
  if(adapter.findings.length>FINDING_CAP){
    lines.push(`  • … ${adapter.findings.length-FINDING_CAP} additional finding(s) omitted for note size`);
  }
  for(const err of adapter.errors) lines.push(`  • Error: ${err}`);
  return lines;
}

function whyLines(verdict:StaffVerdict):string[]{
  if(!verdict.reasons.length) return [];
  if(verdict.level==="CAUTION") return ["• Why caution:",...verdict.reasons.map(r=>`  • ${r}`)];
  if(verdict.level==="RED_FLAG") return ["• Why red flag:",...verdict.reasons.map(r=>`  • ${r}`)];
  if(verdict.level==="INCOMPLETE") return ["• Why incomplete:",...verdict.reasons.map(r=>`  • ${r}`)];
  return [];
}

/** Scannable OSINT block for human_note / HubSpot NOTE. No internal capability IDs. */
export function formatOsintNoteLines(
  report:OsintLookupReport|undefined|null,
  verdict?:StaffVerdict
):string[]{
  const scored=verdict??scoreStaffVerdict({osint:report});
  if(!report){
    return[
      "🔎 *OSINT identity*",
      "• Status: UNKNOWN — OSINT report was not attached",
      "• Observational flags:",
      "  • OSINT did not run — missing checks do NOT count as risk",
      ...whyLines(scored),
      `• Staff note: ${scored.staff_note}`,
      TOOLS_LINE
    ];
  }
  const lines:string[]=["🔎 *OSINT identity*"];
  if(!report.enabled){
    lines.push("• Status: DISABLED — checks didn’t fully run");
    lines.push("• Observational flags:");
    for(const flag of observationalFlags(report)) lines.push(`  • ${flag}`);
    lines.push(...whyLines(scored));
    lines.push(`• Staff note: ${scored.staff_note}`);
    lines.push(TOOLS_LINE);
    return lines;
  }
  lines.push(`• Status: ${report.ran?"RAN":"NOT_RUN"}`);
  const flags=scored.observational_flags.length?scored.observational_flags:observationalFlags(report);
  lines.push("• Observational flags:");
  for(const flag of flags) lines.push(`  • ${flag}`);
  const seen=new Set<string>();
  for(const adapter of report.adapters){
    seen.add(adapter.provider);
    lines.push(...adapterLines(adapter));
  }
  for(const provider of ["holehe","phoneinfoga","mosint","h8mail"] as const){
    if(seen.has(provider)) continue;
    lines.push(`• ${adapterTitle(provider)}: NOT RUN — missing check, not risk`);
  }
  if(report.unavailable.length){
    lines.push("• Unavailable / skipped checks (not risk):");
    for(const item of report.unavailable) lines.push(`  • ${item}`);
  }
  if(report.errors.length){
    lines.push("• Adapter errors (soft-fail; missing checks are not risk):");
    for(const err of report.errors) lines.push(`  • ${err}`);
  }
  lines.push(...whyLines(scored));
  lines.push(`• Staff note: ${scored.staff_note}`);
  lines.push(TOOLS_LINE);
  return lines.slice(0,LINE_CAP);
}

export function formatStaffNotePreamble(
  report:OsintLookupReport|undefined|null,
  contact?:StaffContact,
  dimensions?:Record<string,unknown>
){
  const verdict=scoreStaffVerdict({osint:report,contact,dimensions});
  return{
    verdict,
    lines:[
      ...formatStaffVerdictLines(verdict),
      "",
      ...formatContactLines(contact,report),
      "",
      ...formatOsintNoteLines(report,verdict)
    ]
  };
}

export function isOsintDimensionKey(key:string){
  return key==="identity_osint"||key==="osint_identity"||key==="IDENTITY_OSINT_LOOKUP";
}
