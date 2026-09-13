import type {OsintLookupReport} from "./types.js";
import {
  formatStaffOsintAdapterLines,
  staffWhyHeading,
  STAFF_TOOLS_LINE
} from "./plain-english.js";
import {
  formatContactLines,
  formatStaffVerdictLines,
  observationalFlags,
  scoreStaffVerdict,
  type StaffContact,
  type StaffVerdict
} from "./verdict.js";

const LINE_CAP=400;

function whyLines(verdict:StaffVerdict):string[]{
  if(!verdict.reasons.length) return [];
  const heading=staffWhyHeading(verdict);
  if(!heading) return [];
  return [heading,...verdict.reasons.map(r=>`  • ${r}`)];
}

/** Scannable OSINT block for human_note / HubSpot NOTE. Staff English only. */
export function formatOsintNoteLines(
  report:OsintLookupReport|undefined|null,
  verdict?:StaffVerdict
):string[]{
  const scored=verdict??scoreStaffVerdict({osint:report});
  const lines:string[]=["🔎 *OSINT identity*"];
  if(!report||!report.enabled){
    lines.push(...formatStaffOsintAdapterLines(report));
    lines.push(...whyLines(scored));
    lines.push(`• Staff note: ${scored.staff_note}`);
    lines.push(STAFF_TOOLS_LINE);
    return lines.slice(0,LINE_CAP);
  }
  const flags=scored.observational_flags.length?scored.observational_flags:observationalFlags(report);
  lines.push("• What we noticed:");
  for(const flag of flags) lines.push(`  • ${flag}`);
  lines.push(...formatStaffOsintAdapterLines(report));
  lines.push(...whyLines(scored));
  lines.push(`• Staff note: ${scored.staff_note}`);
  lines.push(STAFF_TOOLS_LINE);
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
