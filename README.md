# CaseClosedFL-Validator

Backend-only, code-first lead validation service for CaseClosedFL. It validates intake facts against configured evidence sources and returns a machine-readable result. It is intentionally isolated from HubSpot and other CRM write surfaces.

## Non-negotiable contract

- Observed evidence outranks model output.
- Model output is never evidence by itself.
- Missing information is `UNKNOWN`, never negative evidence.
- A failed search is reported as a failed search.
- A record not found is **not** labeled false or fraudulent.
- A URL is not considered visited unless a tool/runtime retrieval actually succeeded.
- A file is not considered present unless the request/runtime actually contains it.
- The validator never writes to CRM and never contacts claimants, attorneys, insurers, providers, defendants, witnesses, or agencies.
- Scope is lead validation only. No settlement valuation, legal advice, or final legal-liability determination.

## Supported CaseClosedFL scope

States: **FL, CA, AZ, TX, NY**.

Case types: **car, truck, motorcycle, rideshare, bicycle/pedestrian, slip/fall**.

The code implements the public intake hard-stops currently exposed by CaseClosedFL: an existing attorney ends intake, and a motor-vehicle claimant who states they were primarily at fault does not proceed. Injury, treatment, incident date and fault fields are captured, but the engine does not invent unpublished eligibility thresholds.

## Architecture

```text
Main Agent / CaseClosedFL
        |
        | scoped API token
        v
CaseClosedFL-Validator
  Auth
    -> Lead schema
    -> deterministic intake rules
    -> jurisdiction + case skill
    -> source registry / RAG
    -> bounded Composio discovery + execution
    -> evidence ledger
    -> optional NVIDIA semantic extraction
    -> deterministic qualification
    -> VALIDATED / INCOMPLETE / CONTRADICTED
        |
        v
DigitalOcean Managed PostgreSQL + pgvector
```

**The TypeScript runtime is the agent.** NVIDIA/Nemotron is a constrained semantic helper used for document interpretation and ambiguity. It does not control state, execute tools, mark tool calls successful, or create evidence.

## Result states

- `VALIDATED`: configured verification threshold was met with evidence.
- `INCOMPLETE`: missing fields, pending record, unavailable source, insufficient evidence, authorization requirement, or unresolved fault evidence.
- `CONTRADICTED`: an explicit CaseClosedFL hard-stop or observed evidence conflicts with a required qualification condition. This is not automatically a fraud label.

Typical `INCOMPLETE` reasons include `MISSING_INFORMATION`, `RECORD_PENDING`, `SOURCE_UNAVAILABLE`, `AUTHORIZATION_REQUIRED`, `FAULT_NOT_ESTABLISHED`, `INSUFFICIENT_EVIDENCE`, and `NOT_CORROBORATED`.

## Tool corridor

Composio is used through its v3.1 session/tool-router API. The validator searches for a narrow capability and may select read-only tools from toolkits such as Tavily, Exa, SerpAPI/DuckDuckGo, ScrapingBee and Steel.

Allowed capabilities:

```text
WEB_SEARCH
WEB_EXTRACT
JS_BROWSER
PUBLIC_RECORD_LOOKUP
BUSINESS_SEARCH
COURT_SEARCH
PROVIDER_SEARCH
```

Denied by policy include messaging, email, CRM writes, purchases, payments, deletion, shell/workbench execution and unrelated write actions. The router adapts generic validation inputs only to parameters exposed by the selected tool schema, and tries at most three materially different safe tools for one capability.

## OpenClaw integration

OpenClaw is integrated in two bounded ways:

1. `src/tools/openclaw.ts` can deliver the already-completed validation note to a dedicated OpenClaw Gateway when enabled.
2. `openclaw/skills/caseclosed-validator/SKILL.md` is a workspace skill that teaches OpenClaw to preserve the validator result and write concise notes without changing evidence or qualification.

OpenClaw **does not own validation state or permissions**. Do not connect this validator to a general-purpose OpenClaw instance; Gateway HTTP auth is an operator-level trust boundary. Use a dedicated isolated instance if you enable note delivery.

## RAG / vector knowledge

Version-controlled jurisdiction packs live in `knowledge/jurisdictions/`; case skills live in `knowledge/case-types/`. `npm run rag:ingest` writes source metadata and chunks to PostgreSQL. When NVIDIA embeddings are configured, chunks are embedded into pgvector. If embedding is unavailable, knowledge ingestion still works and retrieval falls back to metadata/lexical filtering rather than claiming vector retrieval succeeded.

The default embedding profile is `nvidia/nemotron-3-embed-1b` at 2048 dimensions. If you change dimensions, update the pgvector column migration accordingly.

## Database

DigitalOcean Managed PostgreSQL is the intended production database. Core tables:

```text
api_tokens
validation_runs
validation_results
tool_executions
evidence
knowledge_sources
knowledge_chunks
audit_events
```

No MongoDB, no CRM datastore, no separate vector service in v1.

## API

Public:

```text
POST /v1/validations                 scope: validate
GET  /v1/validations/:id             scope: read-result
GET  /v1/validations/:id/evidence    scope: read-result
GET  /v1/validations/:id/state       scope: read-result
GET  /health
GET  /ready
```

Admin/token-only:

```text
GET    /admin/tokens
POST   /admin/tokens
DELETE /admin/tokens/:id
```

The tiny admin UI is served at `/admin/` and does only token mint/list/revoke. Plaintext tokens are shown once; PostgreSQL stores only an HMAC fingerprint, prefix, scopes and timestamps.

### Example validation request

```json
{
  "lead_id": "lead_123",
  "state": "FL",
  "case_type": "AUTO_ACCIDENT",
  "client": {"first_name":"Jane","last_name":"Doe"},
  "incident": {
    "date": "2026-08-20",
    "county": "Broward",
    "agency": "Fort Lauderdale Police Department",
    "case_number": "REDACTED"
  },
  "qualification": {
    "injured": "YES",
    "medical_treatment": true,
    "primary_fault": "OTHER_PARTY",
    "already_represented": false
  },
  "documents": []
}
```

### Example incomplete result

```json
{
  "status": "INCOMPLETE",
  "reason": "FAULT_NOT_ESTABLISHED",
  "dimensions": {
    "incident": "DOCUMENT_CORROBORATED",
    "fault": "UNDETERMINED"
  },
  "missing": [
    "Evidence supporting the intake requirement that the client was not primarily at fault"
  ],
  "next_action": "REQUEST_FAULT_SUPPORTING_POLICE_REPORT"
}
```

## Setup

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run rag:ingest
npm run dev
```

Local PostgreSQL + pgvector:

```bash
docker compose up -d db
```

Build/test:

```bash
npm run build
npm test
```

Check configured source landing pages:

```bash
npm run sources:check
```

## Secrets

Never paste production credentials into source or commit them. Required production secrets are provided via environment/runtime secret management:

```text
DATABASE_URL
ADMIN_SECRET
TOKEN_PEPPER
COMPOSIO_API_KEY
NVIDIA_API_KEY
```

Optional:

```text
STEEL_API_KEY
OPENCLAW_TOKEN
```

Any credential previously exposed in a chat or log should be rotated before use.

## Government-source limitations

Many crash-report systems restrict recent reports, require identity/authorization, use local-agency systems, or do not expose an API suitable for automated existence checks. The source packs describe these limitations. The service does not bypass them. When authoritative verification cannot be obtained, the correct output is `INCOMPLETE` with the exact missing evidence or authorization requirement.

## What this service deliberately does not do

- HubSpot writes
- claimant communications
- attorney communications
- report purchases
- form submissions that create/modify records
- bypassing authentication/CAPTCHA/access restrictions
- final legal-fault percentages
- settlement estimates
- generalized autonomous tasks

See `docs/ARCHITECTURE.md`, `SECURITY.md`, `OPENCLAW_INTEGRATION.md`, `config/tool-policy.json`, and `docs/openapi.yaml`.
