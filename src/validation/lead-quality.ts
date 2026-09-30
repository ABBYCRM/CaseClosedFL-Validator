/**
 * Deterministic lead-quality rules (no network, no model).
 * Produces the single staff verdict used everywhere: GOOD / NEEDS_REVIEW / JUNK.
 * Hard junk signals => JUNK. Soft signals => NEEDS_REVIEW (two or more soft signals => JUNK).
 */
export type LeadVerdict = "GOOD" | "NEEDS_REVIEW" | "JUNK";

export interface LeadQualityInput {
  name?: string;
  phone?: string;
  email?: string;
  state?: string;
  zip?: string;
  narrative?: string;
  /** true when HubSpot/Resend report a hard bounce for this email. */
  emailBounced?: boolean;
  /** Raw bounce reason (e.g. HubSpot hs_email_hard_bounce_reason_enum or a Resend event type). */
  emailBounceReason?: string;
  documentCount?: number;
}

export interface QualitySignal { code: string; detail: string }

export interface LeadQuality {
  junk: QualitySignal[];
  review: QualitySignal[];
  documentCount: number;
  contactComplete: boolean;
}

const STATE_NAMES: Record<string, string> = {
  ALABAMA:"AL",ALASKA:"AK",ARIZONA:"AZ",ARKANSAS:"AR",CALIFORNIA:"CA",COLORADO:"CO",CONNECTICUT:"CT",DELAWARE:"DE",
  "DISTRICT OF COLUMBIA":"DC",FLORIDA:"FL",GEORGIA:"GA",HAWAII:"HI",IDAHO:"ID",ILLINOIS:"IL",INDIANA:"IN",IOWA:"IA",
  KANSAS:"KS",KENTUCKY:"KY",LOUISIANA:"LA",MAINE:"ME",MARYLAND:"MD",MASSACHUSETTS:"MA",MICHIGAN:"MI",MINNESOTA:"MN",
  MISSISSIPPI:"MS",MISSOURI:"MO",MONTANA:"MT",NEBRASKA:"NE",NEVADA:"NV","NEW HAMPSHIRE":"NH","NEW JERSEY":"NJ",
  "NEW MEXICO":"NM","NEW YORK":"NY","NORTH CAROLINA":"NC","NORTH DAKOTA":"ND",OHIO:"OH",OKLAHOMA:"OK",OREGON:"OR",
  PENNSYLVANIA:"PA","RHODE ISLAND":"RI","SOUTH CAROLINA":"SC","SOUTH DAKOTA":"SD",TENNESSEE:"TN",TEXAS:"TX",UTAH:"UT",
  VERMONT:"VT",VIRGINIA:"VA",WASHINGTON:"WA","WEST VIRGINIA":"WV",WISCONSIN:"WI",WYOMING:"WY","PUERTO RICO":"PR"
};

export function normalizeState(raw?: string): string | undefined {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return undefined;
  if (/^[A-Z]{2}$/.test(s)) return s;
  return STATE_NAMES[s];
}

/** USPS ZIP3 prefix ranges -> state. Unlisted prefixes (military, unassigned) return undefined. */
const ZIP3: Array<[number, number, string]> = [
  [5,5,"NY"],[6,7,"PR"],[8,8,"VI"],[9,9,"PR"],[10,27,"MA"],[28,29,"RI"],[30,38,"NH"],[39,49,"ME"],[50,54,"VT"],[55,55,"MA"],
  [56,59,"VT"],[60,69,"CT"],[70,89,"NJ"],[100,149,"NY"],[150,196,"PA"],[197,199,"DE"],[200,200,"DC"],[201,201,"VA"],
  [202,205,"DC"],[206,219,"MD"],[220,246,"VA"],[247,268,"WV"],[270,289,"NC"],[290,299,"SC"],[300,319,"GA"],[320,339,"FL"],
  [341,342,"FL"],[344,344,"FL"],[346,347,"FL"],[349,349,"FL"],[350,369,"AL"],[370,385,"TN"],[386,397,"MS"],[398,399,"GA"],
  [400,427,"KY"],[430,459,"OH"],[460,479,"IN"],[480,499,"MI"],[500,528,"IA"],[530,549,"WI"],[550,567,"MN"],[569,569,"DC"],
  [570,577,"SD"],[580,588,"ND"],[590,599,"MT"],[600,629,"IL"],[630,658,"MO"],[660,679,"KS"],[680,693,"NE"],[700,714,"LA"],
  [716,729,"AR"],[730,732,"OK"],[733,733,"TX"],[734,749,"OK"],[750,799,"TX"],[800,816,"CO"],[820,831,"WY"],[832,838,"ID"],
  [840,847,"UT"],[850,865,"AZ"],[870,884,"NM"],[885,885,"TX"],[889,898,"NV"],[900,961,"CA"],[967,968,"HI"],[969,969,"GU"],
  [970,979,"OR"],[980,994,"WA"],[995,999,"AK"]
];

export function stateForZip(zip?: string): string | undefined {
  const m = String(zip ?? "").trim().match(/^(\d{5})(?:-\d{4})?$/);
  if (!m) return undefined;
  const p = Number(m[1]!.slice(0, 3));
  for (const [lo, hi, st] of ZIP3) if (p >= lo && p <= hi) return st;
  return undefined;
}

export function phoneDigits(raw?: string): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

/** Returns a reason string when the number is a known fake / test / impossible NANP number. */
export function fakePhoneReason(raw?: string): string | undefined {
  const d = phoneDigits(raw);
  if (!d) return undefined;
  if (d.length !== 10) return `phone has ${d.length} digits (a US number needs 10)`;
  const area = d.slice(0, 3), exch = d.slice(3, 6), line = d.slice(6);
  if (exch + line === "8675309") return "phone 867-5309 is the well-known fake “Jenny” number";
  if (exch === "555" && /^01\d\d$/.test(line)) return "phone 555-01xx is reserved for fiction/testing";
  if (/^(\d)\1{9}$/.test(d)) return "phone is one repeated digit";
  if (/^(\d)\1{6}$/.test(exch + line)) return "phone number part is one repeated digit";
  if ("01234567890123456789".includes(d) || "98765432109876543210".includes(d)) return "phone is a sequential run of digits";
  if (/^[01]/.test(area)) return `area code ${area} is invalid (cannot start with 0 or 1)`;
  if (area[1] === "9") return `area code ${area} is not assigned (N9X codes are reserved)`;
  if (/^\d11$/.test(area)) return `area code ${area} is a service code, not an area code`;
  if (area === "555") return "area code 555 is not a real area code";
  if (/^[01]/.test(exch)) return `exchange ${exch} is invalid (cannot start with 0 or 1)`;
  if (/^\d11$/.test(exch)) return `exchange ${exch} is a service code`;
  return undefined;
}

const RESERVED_EMAIL_DOMAINS = new Set(["example.com", "example.net", "example.org", "test.com", "test.test"]);
const RESERVED_TLDS = [".test", ".example", ".invalid", ".localhost", ".local"];
const DISPOSABLE = new Set(["mailinator.com","guerrillamail.com","yopmail.com","10minutemail.com","tempmail.com","temp-mail.org","trashmail.com","sharklasers.com","dispostable.com","getnada.com"]);

export function reservedEmailReason(email?: string): string | undefined {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return undefined;
  const domain = e.slice(at + 1);
  if (RESERVED_EMAIL_DOMAINS.has(domain) || RESERVED_TLDS.some(t => domain.endsWith(t)) || domain === "localhost") {
    return `email domain ${domain} is a reserved/test domain that cannot receive mail`;
  }
  return undefined;
}

function disposableEmail(email?: string): string | undefined {
  const e = String(email ?? "").trim().toLowerCase();
  const domain = e.slice(e.lastIndexOf("@") + 1);
  return e.includes("@") && DISPOSABLE.has(domain) ? domain : undefined;
}

const SPAM_PATTERNS: Array<[string, RegExp]> = [
  ["SEO", /\bseo\b/i],
  ["search engine optimization", /search[- ]engine optimi[sz]ation/i],
  ["search ranking pitch", /\b(google|bing)\b[^.]{0,60}\b(rank|ranking|visibility|first page|index|search results)\b|\b(rank|ranking)\b[^.]{0,40}\b(google|bing)\b/i],
  ["crawling/indexing", /\b(crawl(ing|ed)?|index(ing|ed))\b/i],
  ["backlinks/guest posts", /\b(back ?links?|guest posts?|link building)\b/i],
  ["web design/dev pitch", /\b(web(site)? (design|redesign|development|developer|traffic|audit)|your website)\b/i],
  ["marketing services pitch", /\b(digital marketing|marketing (services|agency|campaign)|lead generation services|social media management)\b/i],
  ["asks for a reply", /\breply with your (phone|number|contact)|\bconvenient time\b|\bbook a (call|demo)\b/i],
  ["crypto/loan/casino offer", /\b(crypto(currency)?|bitcoin|forex|casino|business loan|merchant cash advance)\b/i],
  ["unsubscribe footer", /\bunsubscribe\b|\bopt[- ]out\b/i],
  ["link in narrative", /https?:\/\/|www\./i]
];

export function spamNarrativeHits(text?: string): string[] {
  const t = String(text ?? "");
  if (!t.trim()) return [];
  return SPAM_PATTERNS.filter(([, re]) => re.test(t)).map(([label]) => label);
}

const BOUNCE_WORDS = /hard|bounce|invalid|unknown_user|mailbox|does_not_exist|rejected|blocked/i;

export function assessLeadQuality(input: LeadQualityInput): LeadQuality {
  const junk: QualitySignal[] = [];
  const review: QualitySignal[] = [];

  const fake = fakePhoneReason(input.phone);
  if (fake) junk.push({ code: "FAKE_PHONE_NUMBER", detail: fake });

  const reserved = reservedEmailReason(input.email);
  if (reserved) junk.push({ code: "TEST_EMAIL_DOMAIN", detail: reserved });
  const disposable = disposableEmail(input.email);
  if (disposable) review.push({ code: "DISPOSABLE_EMAIL", detail: `email uses a disposable mail provider (${disposable})` });

  const bounceReason = String(input.emailBounceReason ?? "").trim();
  if (input.emailBounced === true || (bounceReason && BOUNCE_WORDS.test(bounceReason))) {
    junk.push({ code: "EMAIL_HARD_BOUNCED", detail: `email hard-bounced${bounceReason ? ` (${bounceReason})` : ""}` });
  }

  const hits = spamNarrativeHits(input.narrative);
  if (hits.length >= 2) junk.push({ code: "SPAM_NARRATIVE", detail: `narrative is a sales/spam pitch, not a claim (${hits.slice(0, 4).join(", ")})` });
  else if (hits.length === 1) review.push({ code: "POSSIBLE_SPAM_NARRATIVE", detail: `narrative mentions ${hits[0]}` });

  const state = normalizeState(input.state);
  const zipState = stateForZip(input.zip);
  if (state && zipState && state !== zipState) {
    review.push({ code: "ZIP_STATE_MISMATCH", detail: `ZIP ${String(input.zip).trim()} is in ${zipState}, but the lead says ${state}` });
  }

  const contactComplete = !!String(input.name ?? "").trim() && phoneDigits(input.phone).length >= 10 && !!String(input.email ?? "").trim() && !!state;
  if (!contactComplete) {
    const gaps = [
      !String(input.name ?? "").trim() && "name",
      phoneDigits(input.phone).length < 10 && "phone",
      !String(input.email ?? "").trim() && "email",
      !state && "state"
    ].filter(Boolean);
    review.push({ code: "CONTACT_INCOMPLETE", detail: `missing contact field(s): ${gaps.join(", ")}` });
  }

  // Two or more independent soft signals stacked together are treated as junk.
  const soft = review.filter(r => r.code !== "CONTACT_INCOMPLETE");
  if (!junk.length && soft.length >= 2) {
    junk.push({ code: "STACKED_SIGNALS", detail: soft.map(s => s.detail).join("; ") });
  }

  return { junk, review, documentCount: input.documentCount ?? 0, contactComplete };
}

/** Intake-level reasons that mean the lead is not yet complete or conflicts with a rule. */
const BLOCKING_REASONS = new Set([
  "MISSING_INFORMATION", "TCPA_CONSENT_MISSING", "DURATION_NOT_ESTABLISHED", "DURATION_NOT_MET",
  "SGA_EXCEEDED", "MANUAL_REVIEW_REQUIRED"
]);

export interface FinalVerdict {
  verdict: LeadVerdict;
  reasons: string[];
  codes: string[];
}

export function finalVerdict(q: LeadQuality | undefined, status: string, reason: string | null | undefined, fraudOverall: unknown): FinalVerdict {
  const quality = q ?? { junk: [], review: [], documentCount: 0, contactComplete: false };
  if (quality.junk.length) {
    return { verdict: "JUNK", reasons: quality.junk.map(s => s.detail), codes: quality.junk.map(s => s.code) };
  }
  const reasons = quality.review.map(s => s.detail);
  const codes = quality.review.map(s => s.code);
  const fraud = String(fraudOverall ?? "");
  if (status === "CONTRADICTED") { reasons.push(`conflicts with a screening rule${reason ? ` (${reason})` : ""}`); codes.push(reason ? String(reason) : "CONTRADICTED"); }
  else if (reason && BLOCKING_REASONS.has(String(reason))) { reasons.push(`intake not complete (${reason})`); codes.push(String(reason)); }
  if (fraud === "HIGH_RISK" || fraud === "MANUAL_REVIEW") { reasons.push(`fraud engines flagged ${fraud}`); codes.push(`FRAUD_${fraud}`); }
  if (reasons.length) return { verdict: "NEEDS_REVIEW", reasons, codes };
  return { verdict: "GOOD", reasons: ["no junk signals; contact complete; intake answers present"], codes: [] };
}

export const VERDICT_HEADLINE: Record<LeadVerdict, string> = {
  GOOD: "🟢 GOOD",
  NEEDS_REVIEW: "🟡 NEEDS REVIEW",
  JUNK: "🔴 JUNK"
};

/** Fraud aggregate value the portals/HubSpot already understand, so every surface shows the same verdict. */
export function fraudValueForVerdict(v: LeadVerdict, current: unknown): string {
  if (v === "JUNK") return "HIGH_RISK";
  if (v === "NEEDS_REVIEW") return current === "HIGH_RISK" ? "HIGH_RISK" : "MANUAL_REVIEW";
  return current === "PASS_WITH_WARNINGS" ? "PASS_WITH_WARNINGS" : "PASS";
}

const DOC_ENGINES = new Set(["DOCUMENT_AUTHENTICITY", "DOCUMENT_TAMPERING", "SYNTHETIC_MEDIA", "CLAIM_CONSISTENCY", "CROSS_DOCUMENT", "EXTERNAL_VERIFICATION"]);

/** With no documents, document-based engines did not run: say NOT_RUN instead of PASS. */
export function markEnginesNotRun(engines: unknown, documentCount: number): unknown {
  if (documentCount > 0 || !engines || typeof engines !== "object" || Array.isArray(engines)) return engines;
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(engines as Record<string, unknown>)) {
    out[name] = DOC_ENGINES.has(name) && v && typeof v === "object" ? { ...(v as object), verdict: "NOT_RUN" } : v;
  }
  return out;
}

/** Pull hard-bounce data from lead metadata when a caller/bridge supplied it (HubSpot email status or Resend events). */
export function bounceFromMetadata(meta: unknown): { emailBounced?: boolean; emailBounceReason?: string } {
  const m = (meta && typeof meta === "object" ? meta : {}) as Record<string, any>;
  const hs = (m.hubspot && typeof m.hubspot === "object" ? m.hubspot : {}) as Record<string, any>;
  const pick = (...vals: unknown[]) => vals.map(v => (v == null ? "" : String(v).trim())).find(Boolean) ?? "";
  const reason = pick(m.hs_email_hard_bounce_reason_enum, hs.hs_email_hard_bounce_reason_enum, hs.email_hard_bounce_reason, m.email_bounce_reason);
  const event = pick(m.resend_last_event, m.email_status, hs.email_status).toLowerCase();
  const flag = m.email_bounced === true || hs.email_bounced === true || /bounced/.test(event);
  return { emailBounced: flag || undefined, emailBounceReason: reason || (flag ? event || "bounced" : undefined) };
}
