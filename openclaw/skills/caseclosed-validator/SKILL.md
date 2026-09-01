---
name: caseclosed-validator
description: Consume CaseClosedFL-Validator results and write concise validation notes without changing evidence or qualification.
version: 1.0.0
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

## Note format
Write a short operational note with:
1. validation status;
2. what was corroborated;
3. what remains unverified;
4. contradictions, if any;
5. exact next evidence requested by the validator.

Do not add legal conclusions, liability percentages, case value, or settlement estimates.
