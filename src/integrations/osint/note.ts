import type {OsintAdapterResult,OsintLookupReport} from "./types.js";
import {COURTLISTENER_DISCLAIMER} from "./adapters/courtlistener.js";
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

const FACT_LABEL:Record<string,string>={
  holehe:"Public sites (Holehe)",
  phoneinfoga:"Phone lookup (PhoneInfoga)",
  mosint:"Email recon (Mosint)",
  h8mail:"Breach lookup (h8mail)",
  courtlistener:"Court dockets (CourtListener)"
};

function factItems(adapter:OsintAdapterResult):string[]{
  const out:string[]=[];
  for(const f of adapter.findings??[]){
    if(adapter.provider==="holehe"){ if(f.site?.trim()) out.push(f.site.trim()); continue; }
    if(adapter.provider==="phoneinfoga"){
      const t=`${f.signal??""} ${f.observation??""}`.toLowerCase();
      const kind=/\binvalid\b|valid\s*=\s*(false|no|0)/.test(t)?"reported invalid":/voip|virtual/.test(t)?"VOIP":/toll[-\s]?free/.test(t)?"toll-free":/mobile|cell|wireless/.test(t)?"mobile":/landline|fixed|wireline/.test(t)?"landline":"";
      if(kind) out.push(kind);
      continue;
    }
    if(adapter.provider==="h8mail"){ if(f.kind==="LOCAL_BREACH_HIT"&&(f.site??f.signal)) out.push(String(f.site??f.signal)); continue; }
    if(adapter.provider==="courtlistener"){ if(f.kind==="COURT_DOCKET_HIT") out.push(String(f.site??f.signal??"docket").slice(0,60)); continue; }
  }
  return [...new Set(out.map(s=>s.slice(0,60)))];
}

/**
 * Public-record check lines: only facts the tools actually returned.
 * A check that did not run says NOT RUN. No interpretation ("normal", "ordinary", "clean").
 */
export function formatOsintFactLines(report:OsintLookupReport|undefined|null):string[]{
  const lines:string[]=["🔎 *Public-record checks*"];
  if(!report||!report.enabled||!(report.adapters??[]).length){
    lines.push("• NOT RUN — public-record checks were off or unavailable for this lead.");
    return lines;
  }
  for(const a of report.adapters){
    const label=FACT_LABEL[a.provider]??a.provider;
    if(a.status!=="OBSERVED"){
      lines.push(`• ${label}: NOT RUN${a.unavailable_reason?` (${String(a.unavailable_reason).replaceAll("_"," ").toLowerCase().slice(0,60)})`:""}`);
      continue;
    }
    const items=factItems(a);
    if(a.provider==="mosint"){ lines.push(`• ${label}: ran (raw DNS/infrastructure output is not copied here)`); continue; }
    if(a.provider==="courtlistener"){
      lines.push(items.length?`• ${label}: ${items.length} public docket match(es): ${items.slice(0,5).join(", ")}`:`• ${label}: ran, no public docket hits`);
      continue;
    }
    lines.push(items.length?`• ${label}: ${items.slice(0,8).join(", ")}${items.length>8?` (+${items.length-8} more)`:""}`:`• ${label}: ran, nothing specific returned`);
  }
  if(report.adapters.some(a=>a.provider==="courtlistener")) lines.push(`• CourtListener disclaimer: ${COURTLISTENER_DISCLAIMER}`);
  return lines;
}
