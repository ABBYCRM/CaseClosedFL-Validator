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

Style must be easy to read on a phone, like a WhatsApp message:
- short lines;
- blank lines between sections;
- simple bullets;
- light emoji section markers;
- no JSON dump;
- no HTML required;
- no internal chain-of-thought;
- no long evidence payloads;
- preserve exact validation status and uncertainty.

Expected shape:

```text
✅ *CaseClosedFL Validation*
Status: *VALIDATED*

📋 *Checks*
• Incident: Validated
• Fault: Supports Not At Fault

✅ *Verified / supported*
• Incident Identifier Match
• Supports Not At Fault

➡️ *Next step:* None

_Only observed evidence is treated as verified. Missing or not-found information is not treated as proof of falsity._
```

For incomplete results:

```text
⚠️ *CaseClosedFL Validation*
Status: *INCOMPLETE* — Fault Not Established

📋 *Checks*
• Incident: Document Corroborated
• Fault: Undetermined

❓ *Still needed*
• Police report or other evidence supporting the client's non-primary-fault position

➡️ *Next step:* Request Fault Supporting Police Report

_Only observed evidence is treated as verified. Missing or not-found information is not treated as proof of falsity._
```

For contradicted results, use `⛔` and show the conflict under `🚩 *Conflict / review*`.

## HubSpot mapping

HubSpot's standard NOTE object uses `hs_note_body` for the note body. A separate CRM/orchestration agent may map the validator's `hubspot_note` directly into `NOTE.hs_note_body` and associate the note with the correct CRM record.

Do not add legal conclusions, liability percentages, case value, settlement estimates, unsupported facts, IP addresses, browser fingerprints, or raw tool transcripts to the human note unless an authorized downstream workflow specifically requires them.
