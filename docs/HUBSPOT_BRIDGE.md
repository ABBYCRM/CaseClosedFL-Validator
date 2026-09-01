# HubSpot standalone bridge

Purpose: keep `CaseClosedFL-Validator` independently deployable while allowing it to consume the two CaseClosedFL intake forms and return a human-readable validation outcome to HubSpot.

## Access boundary

The bridge is intentionally narrow:

- READ: exactly two allowlisted HubSpot form GUIDs (initial lead capture + supplemental/email form)
- READ: contact lookup by submitted email, only to find the record that should receive the note
- WRITE: create a NOTE associated to that contact
- DENY BY DESIGN: contact updates, deal updates, ticket updates, marketing email changes, form edits, lifecycle-stage changes, owner changes, messaging, and arbitrary CRM writes

`HUBSPOT_INITIAL_FORM_GUID` and `HUBSPOT_EMAIL_FORM_GUID` are preferred. The older `*_FORM_ID` names remain supported as aliases. Exact form names can also be used, but resolution fails unless each name matches exactly one active form.

## Data flow

```text
HubSpot initial form (read-only) ─┐
                                  ├─> merge latest submission by email
HubSpot email/supplemental form ──┘
        -> CaseClosedFL Lead schema
        -> validator runtime
        -> evidence + deterministic outcome
        -> WhatsApp-style `hubspot_note`
        -> contact lookup by email (read-only)
        -> HubSpot NOTE create (only write)
```

If the supplemental form arrives after the initial form, a later sync reruns validation with the newest pair and creates a new outcome note. Submission conversion IDs are persisted for idempotency.

## Required configuration

```text
HUBSPOT_SYNC_ENABLED=true
HUBSPOT_ACCESS_TOKEN=<runtime secret>
HUBSPOT_INITIAL_FORM_GUID=<guid>
HUBSPOT_EMAIL_FORM_GUID=<guid>
```

The HubSpot credential should be provisioned with the minimum scopes needed to read forms/submissions, read contacts for email resolution, and create notes. Do not grant broad CRM write scopes if avoidable.

Discover forms from the standalone runtime:

```bash
npm run hubspot:forms
```

Run one sync manually:

```bash
npm run hubspot:sync
```

Or invoke the admin-only service endpoint:

```text
POST /admin/hubspot/sync
x-admin-secret: ...
```

## Failure behavior

The bridge fails closed. It does not guess form identity, create contacts, update contacts, or attach a note when email correlation is unavailable. Validation can still run through the normal `/v1/validations` API independently of HubSpot.
