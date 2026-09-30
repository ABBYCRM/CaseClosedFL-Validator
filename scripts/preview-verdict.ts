/**
 * Offline preview (dry run): no DB, no network, no HubSpot writes.
 * Usage: npx tsx scripts/preview-verdict.ts '<json>'
 * json = { lead:{name,phone,email,state,zip,narrative,emailBounceReason?}, status, reason?, fraud_overall?, missing?[] }
 */
import { assessLeadQuality } from "../src/validation/lead-quality.js";
import { buildOutcome } from "../src/validation/outcome.js";

const input = JSON.parse(process.argv[2] ?? "{}");
const quality = assessLeadQuality(input.lead ?? {});
const x: any = buildOutcome({
  status: input.status ?? "INCOMPLETE",
  reason: input.reason ?? undefined,
  missing: input.missing ?? [],
  evidence: [],
  dimensions: { fraud_overall: input.fraud_overall ?? "PASS" },
  quality
});
console.log(JSON.stringify({
  verdict: x.verdict, reasons: x.verdict_reasons, status: x.status, reason: x.reason,
  fraud_overall: x.dimensions.fraud_overall, headline: x.human_note.split("\n")[0]
}, null, 2));
