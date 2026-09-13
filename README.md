# CaseClosedFL-Validator

Backend-only, code-first lead validation service for CaseClosedFL. It validates intake facts against configured evidence sources and returns a machine-readable result. CRM writes are limited to the optional standalone HubSpot NOTE bridge; all other HubSpot/CRM mutation stays out of scope.

## Non-negotiable contract

- Observed evidence outranks model output.
- Model output is never evidence by itself.
- Missing information is `UNKNOWN`, never negative evidence.
- A failed search is reported as a failed search.
- A record not found is **not** labeled false or fraudulent.
- A URL is not considered visited unless a tool/runtime retrieval actually succeeded.
- A file is not considered present unless the request/runtime actually contains it.
- Fraud engines produce independent risk verdicts; they do not independently accuse a claimant of fraud.
- Synthetic-media, barcode, C2PA, morph, liveness, PDF, signature and image-forensic checks are only treated as performed when the corresponding specialized component supplied an observed result.
- The validator never contacts claimants, attorneys, insurers, providers, defendants, witnesses, or agencies. The only optional CRM write is the standalone HubSpot validation NOTE defined in `docs/HUBSPOT_BRIDGE.md`.
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
    -> Bitdeer BGE reranking for filtered knowledge candidates
    -> bounded Composio discovery + execution
    -> direct read-only provider fallbacks when Composio is down
    -> ScreenshotOne signed capture of official source URLs
    -> evidence ledger
    -> bounded Bitdeer semantic extraction
         -> GLM-5 for routine structured extraction
         -> Mistral Large 3 for heavier forensic/document reasoning
    -> deterministic qualification
    -> parallel independent fraud verdict engines
         -> DOCUMENT_AUTHENTICITY
         -> DOCUMENT_TAMPERING
         -> IDENTITY
         -> SYNTHETIC_MEDIA
         -> CLAIM_CONSISTENCY
         -> CROSS_DOCUMENT
         -> EXTERNAL_VERIFICATION
    -> aggregate fraud review signal
    -> VALIDATED / INCOMPLETE / CONTRADICTED
        |
        v
DigitalOcean Managed PostgreSQL + pgvector
```

**The TypeScript runtime is the agent.** Bitdeer models are constrained semantic helpers used for extraction, document interpretation, ambiguity resolution and retrieval ranking. They do not own state, execute tools, mark tool calls successful, create observed evidence, or make the final qualification decision.

The fraud layer is implemented in `src/validation/fraud/` and documented in `docs/FRAUD_VALIDATION_ENGINE.md`. Its seven engines execute independently in parallel and each returns its own verdict, risk score, assurance level, findings, performed checks and unavailable checks before aggregation.

## Model routing

Production defaults:

```text
MODEL_PROVIDER=bitdeer
EMBEDDING_PROVIDER=bitdeer
BITDEER_REASONING_MODEL=zai-org/GLM-5
BITDEER_FORENSIC_MODEL=mistralai/Mistral-Large-3-675B-Instruct-2512
BITDEER_EMBED_MODEL=nvidia/Nemotron-3-Embed-8B-BF16
BITDEER_EMBED_DIMENSIONS=4096
BITDEER_RERANK_MODEL=BAAI/bge-reranker-v2-m3
```

`GLM-5` handles lower-cost bounded JSON extraction and routine semantic checks. `Mistral-Large-3-675B-Instruct-2512` is selected for forensic/document-integrity tasks and larger evidence payloads. `nvidia/Nemotron-3-Embed-8B-BF16` writes 4096-dimensional pgvector embeddings. `BAAI/bge-reranker-v2-m3` reranks filtered RAG candidates when embeddings are missing or disabled.

The Bitdeer endpoints configured for this release are text chat and rerank endpoints. They are **not treated as a vision service**. Screenshot capture continues, but OCR/vision fails soft with `BITDEER_VISION_MODEL_NOT_CONFIGURED` until a supported multimodal Bitdeer model is explicitly wired. The system never pretends a text-only model performed image forensics.

## Result states

- `VALIDATED`: configured verification threshold was met with evidence.
- `INCOMPLETE`: missing fields, pending record, unavailable source, insufficient evidence, authorization requirement, unresolved fault evidence, or other missing validation input.
- `CONTRADICTED`: an explicit CaseClosedFL hard-stop, observed qualification conflict, or fraud-engine manual-review requirement conflicts with automatic validation. This is not automatically a fraud label.

Fraud-engine dispositions are separate and available inside result `dimensions`: `PASS`, `PASS_WITH_WARNINGS`, `MANUAL_REVIEW`, `HIGH_RISK`, or `UNABLE_TO_VALIDATE`.

Typical `INCOMPLETE` reasons include `MISSING_INFORMATION`, `RECORD_PENDING`, `SOURCE_UNAVAILABLE`, `AUTHORIZATION_REQUIRED`, `FAULT_NOT_ESTABLISHED`, `INSUFFICIENT_EVIDENCE`, and `NOT_CORROBORATED`.

## Tool corridor

Composio is used through its v3.1 session/tool-router API with a project key (`ak_…`, never a Connect `ck_…` consumer key). Session create allowlists toolkits as `{ enable: [...] }`. The default corridor is Tavily, Exa, Firecrawl, SerpAPI, and Browser Tool (`browser_tool`). `steel` is not a Composio toolkit.

Tool discovery uses `/search` with `{ queries: [{ use_case }] }` (a lone `{ query }` is rejected). If that path is empty or errors, the router falls back to `execute_meta` `COMPOSIO_SEARCH_TOOLS`. Toolkit execution still requires an active Composio connection for that toolkit (`has_active_connection`); session create succeeding with an `ak_` key does not by itself link Firecrawl/Tavily/etc.

When the Composio key is missing, invalid, or the session/search/execute path fails, `runCapability` falls back to the same read-only capabilities through direct provider APIs that are present in the environment: Exa/Tavily for search, Firecrawl/ScrapingBee/Scrapfly for extract, Steel then Firecrawl/ScrapingBee for browser/public-record lookup, and `direct:screenshotone.capture` last for WEB_EXTRACT / JS_BROWSER / PUBLIC_RECORD_LOOKUP when ScreenshotOne keys are present. Direct executions are persisted as `direct:<provider>.<action>` rows. Incident/business/court/provider queries are biased to `site:<officialHost>` plus the `source.url` from `knowledge/jurisdictions`. AUTHORIZED sources still fail closed without lead authorization.

When an official source URL is checked, the runtime captures that page with a **signed** ScreenshotOne request (HMAC-SHA256 of the canonical query string; `secret_key` is never sent as a parameter). Screenshot content remains observed evidence only. Until a supported Bitdeer multimodal model is configured, OCR is explicitly unavailable rather than being fabricated. Up to `HUBSPOT_NOTE_MAX_SCREENSHOTS` images can be uploaded to HubSpot Files and attached on the validation NOTE (`hs_attachment_ids`). A files-scope error still writes the HubSpot-safe HTML note.

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

Optional free OSINT identity lookups (`IDENTITY_OSINT_LOOKUP`) run **inside** the existing validation/fraud path when `OSINT_IDENTITY_ENABLED=true`: Holehe (email registrations), PhoneInfoga (phone), Mosint (email recon), and h8mail (local/free breach). Missing CLIs soft-fail as `UNAVAILABLE`. Paid APIs (Hunter, HIBP, DeHashed, IntelX, Epieos) are out of scope. Full adapter output is copied onto the HubSpot validation NOTE. See `docs/OSINT_IDENTITY_SETUP.md`.

Denied by policy include messaging, email, CRM writes, purchases, payments, deletion, shell/workbench execution and unrelated write actions. The router adapts generic validation inputs only to parameters exposed by the selected tool schema, and tries at most three materially different safe tools for one capability.

## OpenClaw integration

OpenClaw is integrated in two bounded ways:

1. `src/tools/openclaw.ts` can deliver the already-completed validation note to a dedicated OpenClaw Gateway when enabled.
2. `openclaw/skills/caseclosed-validator/SKILL.md` is a workspace skill that teaches OpenClaw to preserve the validator result and write concise notes without changing evidence or qualification.

OpenClaw **does not own validation state or permissions**. Do not connect this validator to a general-purpose OpenClaw instance; Gateway HTTP auth is an operator-level trust boundary. Use a dedicated isolated instance if you enable note delivery.

## RAG / knowledge retrieval

Version-controlled jurisdiction packs live in `knowledge/jurisdictions/`; case skills live in `knowledge/case-types/`. `npm run rag:ingest` writes source metadata and chunks to PostgreSQL.

The default release sets `EMBEDDING_PROVIDER=bitdeer`. In that mode the runtime embeds knowledge chunks and queries with Nemotron-3-Embed via Bitdeer (`vector(4096)`). If embedding calls fail or the index is empty, retrieval falls back to jurisdiction/case/dimension-filtered PostgreSQL candidates and, when Bitdeer is configured, reranks them with `BAAI/bge-reranker-v2-m3`. If reranking is also unavailable, retrieval uses deterministic filtered recency order rather than pretending semantic ranking succeeded.

OpenAI embeddings remain an optional provider for installations that want pgvector retrieval. If embedding dimensions are changed, update the pgvector column migration accordingly.

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
GET  /                               service index (HTML or ?format=json)
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
POST   /admin/hubspot/sync
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

For richer document fraud analysis, each document can additionally include `capture_type` and a `forensics` object produced by specialized parsers/detectors. See `docs/FRAUD_VALIDATION_ENGINE.md`.

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

`docker compose up --build` also starts the API container after Postgres is healthy. That service uses hostname `db`; keep `localhost` in `.env` for host-side `npm` scripts. The container applies migrations before listening.

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

Never paste production credentials into source or commit them. Required production secrets are provided via environment/runtime secret management.
