# OSINT identity setup (free OSS only)

Optional email + phone identity lookups for CaseClosedFL-Validator. This path is **additional**. It does not replace the qualification validator or the seven parallel fraud engines.

## Contract

- Evidence-only. Adapters record what a CLI actually printed.
- Missing tool, missing target, timeout, or parse-empty → `UNAVAILABLE` / `UNKNOWN`. That is **not** a fraud accusation.
- The validator never contacts claimants, attorneys, insurers, providers, or agencies.
- Never invent registrations, breach hits, or phone metadata.
- Breach CLIs may print passwords. Those secrets are redacted and must not be stored or pasted into HubSpot.

## Paid services are out of scope

This PR does **not** implement or require:

| Service | Status |
| --- | --- |
| Hunter email verifier | Out of scope — do not add `HUNTER_API_KEY` |
| Have I Been Pwned paid breach API | Out of scope — do not add `HIBP_API_KEY` |
| DeHashed | Out of scope — do not add `DEHASHED_*` |
| IntelX | Out of scope — do not add `INTELX_API_KEY` |
| Epieos | Out of scope — do not add `EPIEOS_API_KEY` |

Approximate market pricing (do not purchase for this validator): Hunter ~$34–$209/mo; HIBP Core ~$4.39/mo / Pro ~$379/mo; DeHashed UI ~$6.49–$29.99/mo, API ~$180+/mo; IntelX free limited / ~€7–€199/mo; Epieos free tiny / €19–€149. Paid keys are not a supported path.

Maigret, Sherlock, and GHunt are also not wired in this change. Prefer the four free CLIs below.

## Enable flag

```bash
OSINT_IDENTITY_ENABLED=true
```

Default is `false`. When `true`, `IDENTITY_OSINT_LOOKUP` runs automatically inside the existing validation / fraud path (no separate manual job). Each adapter soft-fails if its CLI is missing so `npm run build` / `npm test` and lead validation still complete.

## Free tools

| Tool | Target | Install (host) | Docker-friendly |
| --- | --- | --- | --- |
| **Holehe** | Email → public site registration signals | `pipx install holehe` | `HOLEHE_DOCKER_IMAGE` or `OSINT_DOCKER_IMAGE` |
| **PhoneInfoga** | Phone → local metadata scan | [PhoneInfoga releases](https://github.com/sundowndev/phoneinfoga/releases) | `docker run --rm sundowndev/phoneinfoga scan -n +1…` |
| **Mosint** | Email recon | [Mosint releases](https://github.com/alpkeskin/mosint/releases) | `MOSINT_DOCKER_IMAGE` |
| **h8mail** | Email / local breach file | `pipx install h8mail` | `H8MAIL_DOCKER_IMAGE`; set `H8MAIL_LOCAL_BREACH_PATH` for a local file |

Cost: **free OSS**. No subscription.

Optional compose profile (does not start with the default stack):

```bash
docker compose --profile osint build osint-cli
# Then point HOLEHE_BIN / H8MAIL_BIN at the image via OSINT_DOCKER_IMAGE=caseclosedfl-osint:local
```

Official PhoneInfoga image (optional, not required at boot):

```bash
export PHONEINFOGA_DOCKER_IMAGE=sundowndev/phoneinfoga
```

The main Node `Dockerfile` does **not** vendor these CLIs. Missing binaries never fail `npm run build` or `npm test`.

## Environment (placeholders only)

See `.env.example`. Common flags:

```bash
OSINT_IDENTITY_ENABLED=false
OSINT_TIMEOUT_MS=25000
OSINT_DOCKER_IMAGE=
HOLEHE_BIN=holehe
HOLEHE_DOCKER_IMAGE=
HOLEHE_ONLY_USED=true
PHONEINFOGA_BIN=phoneinfoga
PHONEINFOGA_DOCKER_IMAGE=
MOSINT_BIN=mosint
MOSINT_DOCKER_IMAGE=
H8MAIL_BIN=h8mail
H8MAIL_DOCKER_IMAGE=
H8MAIL_LOCAL_BREACH_PATH=
```

Per-tool `*_TIMEOUT_MS` overrides `OSINT_TIMEOUT_MS`. Empty timeout values use the shared default.

Docker resolution: if the local binary is not on `PATH` and a docker image is set **and** `docker` exists, the adapter runs `docker run --rm --init --entrypoint <bin> <image> …`. If neither binary nor docker image works → `UNAVAILABLE`.

## What runs during validation

When enabled, `validateLead` → `evaluateFraudRisk` → `IDENTITY_OSINT_LOOKUP` executes Holehe, PhoneInfoga, Mosint, and h8mail in parallel (each on its own timeout). Results:

1. Attach to the IDENTITY fraud dimension as `UNKNOWN` observations (they do not raise `HIGH_RISK` by themselves).
2. EXTERNAL_VERIFICATION records that OSINT is **not** authoritative issuer verification.
3. Appear in result `dimensions.identity_osint`.
4. Render in full on `human_note` / `hubspot_note` so HubSpot staff see the same detail.

## HubSpot NOTE example

Staff should see a dedicated OSINT block like this (WhatsApp-style text; HubSpot stores the same lines as HTML `<p>`):

```text
🔎 *OSINT identity*
• Status: RAN — capability IDENTITY_OSINT_LOOKUP
• Email: j***@example.com
• Phone: +***0100
• Observational risk flags (not a fraud verdict):
  • HOLEHE_PUBLIC_REGISTRATIONS_OBSERVED
  • PHONEINFOGA_METADATA_OBSERVED
  • MOSINT_RECON_SIGNALS_OBSERVED
  • H8MAIL_LOCAL_BREACH_HIT_OBSERVED
• Holehe (email site registrations): OBSERVED for j***@example.com
  • Checks performed: HOLEHE_EMAIL_SITE_REGISTRATION
  • EMAIL_SITE_REGISTRATION [instagram]: Holehe observed a public registration signal for instagram.
  • EMAIL_SITE_REGISTRATION [twitter]: Holehe observed a public registration signal for twitter.
• PhoneInfoga (phone signals): OBSERVED for +***0100
  • Checks performed: PHONEINFOGA_LOCAL_SCAN
  • PHONE_METADATA: PhoneInfoga observed country=United States.
  • PHONE_METADATA: PhoneInfoga observed line_type=mobile.
• Mosint (email recon): OBSERVED for j***@example.com
  • Checks performed: MOSINT_EMAIL_RECON
  • EMAIL_RECON_SIGNAL: Mosint observed: related domain example.com.
• h8mail (local/free breach): OBSERVED for j***@example.com
  • Checks performed: H8MAIL_LOCAL_BREACH_FILE
  • LOCAL_BREACH_HIT: h8mail reported 2 local/public-source hit(s). Secrets were redacted.
• Unavailable / skipped checks:
  • (none in this example)
• Adapter errors (soft-fail; validation continues):
  • (none in this example)
• Contract: evidence-only. UNKNOWN/UNAVAILABLE is not fraud. The validator never contacts claimants.
• Paid APIs (Hunter, HIBP, DeHashed, IntelX, Epieos) are out of scope for this path.
```

When `OSINT_IDENTITY_ENABLED=false`, the same section says `DISABLED` / UNKNOWN instead of inventing hits.

## Operator notes

- Do not pass claimant email or phone to any tool that sends mail or places calls.
- Prefer `H8MAIL_LOCAL_BREACH_PATH` pointing at a file you already lawfully hold. Do not commit breach dumps.
- Holehe/Mosint/PhoneInfoga need outbound HTTPS to third-party sites. That is optional operator network policy, not a Validator paid integration.
