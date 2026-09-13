---
name: caseclosed-validator
description: Consume CaseClosedFL-Validator results and write concise validation notes without changing evidence or qualification.
version: 1.1.0
user-invocable: false
---
# CaseClosedFL Validator Note Skill

Use this skill only when a trusted upstream system supplies a completed `CaseClosedFL-Validator` JSON result.

## Boundary
- Never independently qualify a lead.
- Never change `status`, `reason`, `dimensions`, `evidence`, `result_hash`, `engine_version`, or `knowledge_version`.
- Never claim a source was checked unless it appears in `evidence` or `tools_used` supplied by the validator.
- Never contact a claimant, attorney, insurer, witness, provider, defendant, or government agency.
- Never write directly to HubSpot from this skill unless a separate upstream CRM agent explicitly owns that action and passes the note as data.
- Treat `UNKNOWN` and `INCOMPLETE` as legitimate terminal states.

## HubSpot / human note format

The validator emits `hubspot_note`, `human_note`, and `agent_note.text`. Prefer those fields verbatim when sending a note downstream.

`human_note` and `agent_note.text` stay WhatsApp-style plain text. `hubspot_note` is the same content as HubSpot-safe HTML for `NOTE.hs_note_body` (`*bold*` → `<strong>`, one field per `<p>` line, blank `<p>` between sections, user text escaped). Do not stringify nested objects. Prefer the validator’s staff-English lines verbatim: fraud engines that passed say “looks clean”; OSINT is translated (public-site hits, ordinary Gmail, old-breach-dataset yellow flag, no court-records dump). Preserve the verdict-first layout: `🚦 VERDICT`, `👤 Contact`, `🔎 OSINT identity`, qualification / fraud sections, then `👀 Staff actions`. Never dump capability IDs, Mosint DNS/MX/NS/TXT/IP, or lines like “Identity — Osint Mosint Email Recon Signal: Unknown.”

Style must be easy to read on a phone, like a WhatsApp message:
- short lines;
- blank lines between sections;
- simple bullets;
- light emoji section markers;
- no JSON dump;
- no `[object Object]`;
- no internal chain-of-thought;
- no long evidence payloads;
- preserve exact validation status and uncertainty.

Expected shape:

```text
🚦 *VERDICT: 🟢 GOOD — looks fine to proceed*
• Rule of thumb: proceed with normal intake

👤 *Contact*
• Name: Jane Doe
• Email: j***@example.com
• Phone: +***0100

🔎 *OSINT identity*
• Public sites (Holehe): email shows up on public sites — normal for a real Gmail.

✅ *CaseClosedFL Validation*
Status: *VALIDATED* — intake rules and observed evidence support proceeding.

📋 *Checks*
• Incident: confirmed from observed evidence
• Fault: documents support the client was not primarily at fault
• Overall fraud check: looks clean

✅ *Verified / supported*
• Police report number matches intake
• Documents support the client was not primarily at fault

👀 *Staff actions*
• Normal intake curiosity

_Only observed evidence is treated as verified. Missing or not-found information is not treated as proof of falsity._
```

For incomplete results:

```text
⚠️ *CaseClosedFL Validation*
Status: *INCOMPLETE* — we do not yet have evidence of who was at fault. Expected until a police report is in, not a fail on the person.

📋 *Checks*
• Incident: supported by a document we have — not yet an official-record pull
• Fault: not established yet
• Overall fraud check: looks clean

❓ *Still needed*
• Police report #, agency, or location — expected at intake, not a fail on the person

➡️ *Next step:* Ask for a police report that speaks to who was at fault

👀 *Staff actions*
• Normal intake curiosity
• Ask for the missing fields listed above
• Missing police report # / agency / location is expected at intake, not a fail on the person

_Only observed evidence is treated as verified. Missing or not-found information is not treated as proof of falsity._
```

For contradicted results, use `⛔` and show the conflict under `🚩 *Conflict / review*`.

## HubSpot mapping

HubSpot's standard NOTE object uses `hs_note_body` for the note body. A separate CRM/orchestration agent may map the validator's `hubspot_note` directly into `NOTE.hs_note_body` and associate the note with the correct CRM record.

Do not add legal conclusions, liability percentages, case value, settlement estimates, unsupported facts, IP addresses, browser fingerprints, or raw tool transcripts to the human note unless an authorized downstream workflow specifically requires them.
