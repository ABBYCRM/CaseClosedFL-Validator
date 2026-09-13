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

Maigret, Sherlock, and GHunt are also not wired in this change. Prefer the four free CLIs below. CourtListener REST v4 is an optional fifth **HTTP** adapter (not a CLI) for public RECAP/docket hits.

## Enable flag

```bash
OSINT_IDENTITY_ENABLED=true
```

Default is `false`. When `true`, `IDENTITY_OSINT_LOOKUP` runs automatically inside the existing validation / fraud path (no separate manual job). Each adapter soft-fails if its CLI is missing so `npm run build` / `npm test` and lead validation still complete.

Independent court-records flag (also default `false`):

```bash
COURTLISTENER_ENABLED=true
COURTLISTENER_API_TOKEN=
COURTLISTENER_BASE_URL=https://www.courtlistener.com/api/rest/v4
```

CourtListener can run even when the four CLIs are off. Auth is `Authorization: Token <token>` (the word **Token**, not Bearer). One RECAP `type=r` search per validation, by person name plus optional state. Timeouts, missing token, HTTP 429, and any other error are `UNAVAILABLE` and **do not raise risk**. The adapter never calls RECAP Fetch / PACER purchase APIs.

## Free tools

| Tool | Target | Install (host) | Docker-friendly |
| --- | --- | --- | --- |
| **Holehe** | Email → public site registration signals | `pipx install holehe` | `HOLEHE_DOCKER_IMAGE` or `OSINT_DOCKER_IMAGE` |
| **PhoneInfoga** | Phone → local metadata scan | [PhoneInfoga releases](https://github.com/sundowndev/phoneinfoga/releases) | `docker run --rm sundowndev/phoneinfoga scan -n +1…` |
| **Mosint** | Email recon | [Mosint releases](https://github.com/alpkeskin/mosint/releases) | `MOSINT_DOCKER_IMAGE` |
| **h8mail** | Email / local breach file | `pipx install h8mail` | `H8MAIL_DOCKER_IMAGE`; set `H8MAIL_LOCAL_BREACH_PATH` for a local file |

Cost: **free OSS**. No subscription.

## DigitalOcean App Platform

Production on App Platform builds the **main** `Dockerfile` (the Node API image). That image now bakes the four FREE CLIs onto `PATH` for the `node` user:

| Tool | How it is installed in the image |
| --- | --- |
| Holehe `1.61` | `pip` into `/opt/osint` venv; symlink `/usr/local/bin/holehe` |
| h8mail `2.5.6` | `pip` into `/opt/osint` venv; symlink `/usr/local/bin/h8mail` |
| PhoneInfoga `v2.11.0` | Official GitHub release tarball (`Linux_x86_64` / `Linux_arm64`) |
| Mosint `v3.0.0` | Official `go install github.com/alpkeskin/mosint/v3/cmd/mosint@v3.0.0` (no release binary) |

App Platform does **not** need `OSINT_DOCKER_IMAGE` / docker-in-docker. After this image deploys:

1. Set `OSINT_IDENTITY_ENABLED=true` on the App Platform component (same env as `.env.example`).
2. Leave `HOLEHE_BIN=holehe`, `PHONEINFOGA_BIN=phoneinfoga`, `MOSINT_BIN=mosint`, `H8MAIL_BIN=h8mail` (defaults).
3. Leave the `*_DOCKER_IMAGE` values empty.
4. Redeploy so App Platform rebuilds from the updated `Dockerfile`.

Adapters still soft-fail (`UNAVAILABLE` / `ERROR`) if a CLI times out or exits without output. `npm run build` / `npm test` on CI and laptops still do **not** require these binaries.

Mosint is configured with an empty `/home/node/.mosint.yaml` (no Hunter / HIBP / IntelX / EmailRep / BreachDirectory keys). Paid APIs stay out of scope; Mosint then uses only its free/public checks.

Optional compose profile (does not start with the default stack; not used on App Platform):

```bash
docker compose --profile osint build osint-cli
# Then point HOLEHE_BIN / H8MAIL_BIN at the image via OSINT_DOCKER_IMAGE=caseclosedfl-osint:local
```

Official PhoneInfoga image (optional host-side fallback only):

```bash
export PHONEINFOGA_DOCKER_IMAGE=sundowndev/phoneinfoga
```

The main Node `Dockerfile` vendors the four FREE CLIs so App Platform can run them. Missing binaries on a **host** `npm` path never fail `npm run build` or `npm test`.

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
COURTLISTENER_ENABLED=false
COURTLISTENER_API_TOKEN=
COURTLISTENER_BASE_URL=https://www.courtlistener.com/api/rest/v4
COURTLISTENER_TIMEOUT_MS=12000
```

Per-tool `*_TIMEOUT_MS` overrides `OSINT_TIMEOUT_MS`. Empty timeout values use the shared default.

Docker resolution: if the local binary is not on `PATH` and a docker image is set **and** `docker` exists, the adapter runs `docker run --rm --init --entrypoint <bin> <image> …`. If neither binary nor docker image works → `UNAVAILABLE`. On DigitalOcean App Platform the binaries are already on `PATH`, so this docker fallback is unused.

## What runs during validation

When enabled, `validateLead` → `evaluateFraudRisk` → `IDENTITY_OSINT_LOOKUP` executes Holehe, PhoneInfoga, Mosint, and h8mail in parallel (each on its own timeout). If `COURTLISTENER_ENABLED=true`, that same lookup adds **one** CourtListener RECAP search. Results:

1. Attach to the IDENTITY fraud dimension as `UNKNOWN` observations (they do not raise `HIGH_RISK` by themselves).
2. EXTERNAL_VERIFICATION records that OSINT is **not** authoritative issuer verification.
3. Appear in result `dimensions.identity_osint`.
4. Render on `human_note` / `hubspot_note` as a **verdict-first** staff note in plain English. The system **translates** findings. Capability IDs, Mosint DNS/MX/NS/TXT/IP dumps, and enum soup stay in machine JSON (`dimensions`) for API consumers and are not written onto the HubSpot NOTE.

## Staff verdict (evidence-only)

The note always leads with one of:

| Verdict | When |
| --- | --- |
| 🟢 GOOD — looks fine to proceed | OSINT ran and signals are consistent/normal (public-site hits expected for a real Gmail, US mobile, no old-breach-dataset hit, no stacked risk). Rule of thumb: proceed with normal intake. |
| 🟡 CAUTION — dig a little, not a fraud accusation | Thin email footprint + VOIP/non-mobile, and/or an old-breach-dataset hit / sparse recon, and/or an explicit criminal-docket **label** on a public CourtListener hit. Rule of thumb: human glance before attorney send. Yellow is curiosity, not “you’re a fraud.” |
| 🔴 RED FLAG — hold / do not treat as clean | Stacked thin footprint + invalid or high-risk phone, or multiple existing document/identity concerns, optionally combined with a clear criminal-docket label. Court hits never invent a red flag by themselves. Rule of thumb: hold until a human clears. |
| ⚪ INCOMPLETE — checks didn’t fully run | OSINT disabled, or a majority of CLI adapters UNAVAILABLE/timeout, or CourtListener-only mode with token/rate-limit/error. **Missing checks do not count as risk.** |

Observational OSINT does not invent fraud. Breach secrets stay redacted.

## HubSpot NOTE example

Staff should see this shape (WhatsApp-style text; HubSpot stores the same lines as HTML `<p>`). Full live-style notes are checked in as `docs/sample_staff_notes_good.txt`, `docs/sample_staff_notes_caution.txt`, and `docs/sample_staff_notes_incomplete.txt`.

```text
🚦 *VERDICT: 🟢 GOOD — looks fine to proceed*
• Rule of thumb: proceed with normal intake

👤 *Contact*
• Name: Jane Doe
• Email: j***@gmail.com
• Phone: +***0100

🔎 *OSINT identity*
• What we noticed:
  • Email shows up on public sites — normal for a real Gmail
  • Phone looks like a US mobile
  • Email recon looks ordinary (no DNS dump in this note)
  • No old-breach-dataset hit
  • No public federal court hits — not a criminal check; absence is not clearance
• Public sites (Holehe): email shows up on public sites (instagram, twitter) — normal for a real Gmail.
• Phone: looks like a US mobile.
• Email recon (Mosint): looks like a normal Google/Gmail-looking address. We do not dump DNS, MX, NS, TXT, SOA, ASN, or IP lines into this note.
• Old breach dataset (h8mail): email did not show up in the old breach files we checked. Passwords were NOT saved or written to HubSpot. No hit is not proof the person is “clean.”
• Court records (CourtListener): No public federal court hits. This is NOT a full criminal check. Absence does not mean clearance.
• CourtListener disclaimer: This is a public court-records signal only — NOT a full criminal background check. Absence of hits is not clearance.
• Staff note: Looks consistent and ordinary. Public-site hits are normal for a real Gmail. Proceed with normal intake curiosity.
• Tools used: Holehe, PhoneInfoga, Mosint, h8mail (free public-record checks); CourtListener (free public federal/RECAP dockets only — not a criminal background check; we never buy PACER). Paid Hunter / HIBP / DeHashed / IntelX / Epieos are not used.

⚠️ *CaseClosedFL Validation*
Status: *INCOMPLETE* — still missing intake details. Expected at this stage, not a fail on the person.

📋 *Checks*
• Incident: not confirmed yet
• Overall fraud check: looks clean
• Fraud checks:
  • Document authenticity: looks clean
  • Identity documents: looks clean

❓ *Still needed*
• Police report #, agency, or location — expected at intake, not a fail on the person

👀 *Staff actions*
• Normal intake curiosity
• Ask for the missing fields listed above
• Missing police report # / agency / location is expected at intake, not a fail on the person
```

🟡 CAUTION uses “dig a little, not a fraud accusation” and explains an old-breach-dataset hit as yellow, not red: passwords are never written to HubSpot. 🔴 RED FLAG is a hold. ⚪ INCOMPLETE is used when public-record checks did not finish — that is not treated as risk, and a missing police report is not a fail on the person.

When `OSINT_IDENTITY_ENABLED=false`, the OSINT section says the checks did not run and the staff verdict is ⚪ INCOMPLETE instead of inventing hits.

## Operator notes

- Do not pass claimant email or phone to any tool that sends mail or places calls.
- Prefer `H8MAIL_LOCAL_BREACH_PATH` pointing at a file you already lawfully hold. Do not commit breach dumps.
- Holehe/Mosint/PhoneInfoga need outbound HTTPS to third-party sites. That is optional operator network policy, not a Validator paid integration.
- CourtListener is free REST only. Respect ~5 requests/minute, 50/hour, 125/day. Do not enable extra pagination, RECAP Fetch, or PACER purchase. Notes must keep the background-check disclaimer.
