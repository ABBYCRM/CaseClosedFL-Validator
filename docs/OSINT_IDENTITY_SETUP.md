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
```

Per-tool `*_TIMEOUT_MS` overrides `OSINT_TIMEOUT_MS`. Empty timeout values use the shared default.

Docker resolution: if the local binary is not on `PATH` and a docker image is set **and** `docker` exists, the adapter runs `docker run --rm --init --entrypoint <bin> <image> …`. If neither binary nor docker image works → `UNAVAILABLE`. On DigitalOcean App Platform the binaries are already on `PATH`, so this docker fallback is unused.

## What runs during validation

When enabled, `validateLead` → `evaluateFraudRisk` → `IDENTITY_OSINT_LOOKUP` executes Holehe, PhoneInfoga, Mosint, and h8mail in parallel (each on its own timeout). Results:

1. Attach to the IDENTITY fraud dimension as `UNKNOWN` observations (they do not raise `HIGH_RISK` by themselves).
2. EXTERNAL_VERIFICATION records that OSINT is **not** authoritative issuer verification.
3. Appear in result `dimensions.identity_osint`.
4. Render on `human_note` / `hubspot_note` as a **verdict-first** staff note: traffic-light verdict, contact, then OSINT identity. Internal capability IDs are not dumped onto the NOTE.

## Staff verdict (evidence-only)

The note always leads with one of:

| Verdict | When |
| --- | --- |
| 🟢 GOOD — looks fine to proceed | OSINT ran and signals are consistent/normal (public registrations expected, US mobile, no local breach hit, no stacked risk). Rule of thumb: proceed with normal intake. |
| 🟡 CAUTION — review before sending out | Weak email footprint + VOIP/non-mobile, and/or a local breach hit / sparse recon. Rule of thumb: dig first before attorney send / billable. |
| 🔴 RED FLAG — hold / do not treat as clean | Stacked burner-style / no credible footprint + invalid or high-risk phone, or multiple existing fraud-rule signals. Rule of thumb: hold until human clears. |
| ⚪ INCOMPLETE — checks didn’t fully run | OSINT disabled, or a majority of adapters UNAVAILABLE/timeout. **Missing checks do NOT count as risk.** |

Observational OSINT does not invent fraud. Breach secrets stay redacted.

## HubSpot NOTE example

Staff should see this shape (WhatsApp-style text; HubSpot stores the same lines as HTML `<p>`):

```text
🚦 *VERDICT: 🟢 GOOD — looks fine to proceed*
• Rule of thumb: proceed with normal intake

👤 *Contact*
• Name: Jane Doe
• Email: j***@example.com
• Phone: +***0100

🔎 *OSINT identity*
• Status: RAN
• Observational flags:
  • Public registrations observed (expected)
  • US mobile
  • Email recon signals observed
  • No local breach hit
• Holehe (email site registrations): OBSERVED for j***@example.com
  • instagram: Holehe observed a public registration signal for instagram.
  • twitter: Holehe observed a public registration signal for twitter.
• PhoneInfoga (phone signals): OBSERVED for +***0100
  • PhoneInfoga observed country=United States.
  • PhoneInfoga observed line_type=mobile.
• Mosint (email recon): OBSERVED for j***@example.com
  • Mosint observed: related domain example.com.
• h8mail (local/free breach): OBSERVED for j***@example.com
  • h8mail reported no local/public-source hits. Absence of hits is not proof of authenticity.
• Staff note: Signals look consistent and normal. Public registrations are expected. Proceed with normal intake.
• Tools: Holehe, PhoneInfoga, Mosint, h8mail (free OSS only; paid Hunter / HIBP / DeHashed / IntelX / Epieos are out of scope)
```

🟡 CAUTION adds `Why caution:` (and uses “dig first before attorney send / billable”). 🔴 RED FLAG adds `Why red flag:` (hold until human clears). ⚪ INCOMPLETE is used when OSINT is disabled or most adapters did not finish — that is not treated as risk.

When `OSINT_IDENTITY_ENABLED=false`, the OSINT section says `DISABLED` and the staff verdict is ⚪ INCOMPLETE instead of inventing hits.

## Operator notes

- Do not pass claimant email or phone to any tool that sends mail or places calls.
- Prefer `H8MAIL_LOCAL_BREACH_PATH` pointing at a file you already lawfully hold. Do not commit breach dumps.
- Holehe/Mosint/PhoneInfoga need outbound HTTPS to third-party sites. That is optional operator network policy, not a Validator paid integration.
