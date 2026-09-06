# HubSpot standalone bridge

Purpose: keep `CaseClosedFL-Validator` independently deployable while allowing it to consume CaseClosedFL intake and return a human-readable validation outcome to HubSpot.

Production CaseClosedFL (Abby-HubSpot) upserts CRM contacts and writes structured intake NOTES. It does not use HubSpot marketing forms. The bridge therefore has two read paths and one write:

- `crm_notes` (default when the two-form allowlist is not configured): read recent CaseClosedFL intake notes + optional supplemental notes, map to Lead, validate, write a WhatsApp-style outcome NOTE on the same contact.
- `forms` (kept for deployments that still have form GUIDs): read the two allowlisted marketing forms, merge by email, validate, write a NOTE.

## Access boundary

The bridge is intentionally narrow:

- READ (`crm_notes`): recent CRM notes and the associated contact properties (email, name, phone, state, ZIP)
- READ (`forms`): exactly two allowlisted HubSpot form GUIDs (initial lead capture + supplemental/email form) and contact lookup by submitted email
- WRITE: create a NOTE associated to that contact
- DENY BY DESIGN: contact updates, deal updates, ticket updates, marketing email changes, form edits, lifecycle-stage changes, owner changes, messaging, and arbitrary CRM writes

`HUBSPOT_SYNC_MODE=auto` (default) selects `forms` when the two-form allowlist is configured and `crm_notes` otherwise. Set `HUBSPOT_SYNC_MODE=forms` or `HUBSPOT_SYNC_MODE=crm_notes` to force a path.

`HUBSPOT_INITIAL_FORM_GUID` and `HUBSPOT_EMAIL_FORM_GUID` are preferred for forms mode. The older `*_FORM_ID` names remain supported as aliases. Exact form names can also be used, but resolution fails unless each name matches exactly one active form.

## Data flow

### CRM notes (production)

```text
HubSpot CRM notes (read-only)
        -> keep CaseClosedFL Qualified Personal Injury Intake
        -> merge newest CaseClosedFL supplemental note if present
        -> contact properties (email / name / phone / state / ZIP)
        -> CaseClosedFL Lead schema (fail closed; never invent fields)
        -> validator runtime (skipped when this intake fingerprint already has validation_id)
        -> evidence + deterministic outcome
        -> WhatsApp-style `hubspot_note`
        -> HubSpot NOTE create (only write; official-source screenshots attached when present)
```

Intake note ids (plus the newest supplemental id) are persisted as a fingerprint for idempotency. A later supplemental CaseClosedFL note creates a new fingerprint, reruns validation, and writes a new outcome note. If a validation NOTE already exists for the same `validation_id` or intake fingerprint, the bridge does not write a duplicate.

Missing required Lead fields (`state`, `case_type`) produce `INCOMPLETE` / `MISSING_INFORMATION` instead of guessed values. State is taken from the contact, an explicit note field, or a supported-state ZIP prefix. Narrative is stored in metadata only and is not treated as incident location or official evidence.

### Forms (optional)

```text
HubSpot initial form (read-only) ─┐
                                  ├─> merge latest submission by email
HubSpot email/supplemental form ──┘
        -> CaseClosedFL Lead schema
        -> contact lookup by email (read-only; fail closed if not exactly one match)
        -> validator runtime (skipped when a prior attempt already stored validation_id for this pair)
        -> evidence + deterministic outcome
        -> WhatsApp-style `hubspot_note`
        -> HubSpot NOTE create (only write; official-source screenshots attached when present)
```

If the supplemental form arrives after the initial form, a later sync reruns validation with the newest pair and creates a new outcome note. Submission conversion IDs are persisted for idempotency. Emails that only have the supplemental form wait without occupying the sync batch. Contact lookup and note write failures do not re-run validation for the same submission pair.

## Required configuration

Production (CRM notes; no marketing forms):

```text
HUBSPOT_SYNC_ENABLED=true
HUBSPOT_ACCESS_TOKEN=<runtime secret>
# HUBSPOT_SYNC_MODE=auto   # default; crm_notes when form GUIDs are empty
```

The HubSpot private app token needs contacts read, notes read, and notes write. Forms scopes are not required for CRM-note mode. Attaching official-source screenshots also needs HubSpot Files upload. If upload fails (including a missing files scope), the WhatsApp-style text NOTE is still written and the upload error is recorded on the sync result.

Optional forms mode:

```text
HUBSPOT_SYNC_ENABLED=true
HUBSPOT_ACCESS_TOKEN=<runtime secret>
HUBSPOT_SYNC_MODE=forms
HUBSPOT_INITIAL_FORM_GUID=<guid>
HUBSPOT_EMAIL_FORM_GUID=<guid>
```

Discover forms from the standalone runtime:

```bash
npm run hubspot:forms
```

Run one sync manually:

```bash
npm run hubspot:sync
```

Or invoke the admin-only service endpoint (both modes):

```text
POST /admin/hubspot/sync
x-admin-secret: ...
```

## Failure behavior

The bridge fails closed. It does not invent case type or state, create contacts, update contacts, pick a contact when more than one association exists, or attach a note when the intake contact cannot be resolved. Validation can still run through the normal `/v1/validations` API independently of HubSpot.

Official-source screenshots captured during the validation run (ScreenshotOne + NVIDIA OCR) are persisted against `validation_id` and attached on the outcome NOTE (`hs_attachment_ids`, max `HUBSPOT_NOTE_MAX_SCREENSHOTS`). File-upload failures do not block the text note.
