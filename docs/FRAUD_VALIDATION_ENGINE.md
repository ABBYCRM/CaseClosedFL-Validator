# CaseClosedFL Fraud Validation Engine

## Purpose

This layer runs independently of the existing CaseClosedFL qualification validator. It does not replace incident, fault, provider, business, or source validation. It adds parallel fraud-risk verdicts for document authenticity, document tampering, identity, synthetic media, claim consistency, cross-document consistency, and external verification.

## Parallel verdict engines

The fraud layer executes these engines independently and concurrently:

1. `DOCUMENT_AUTHENTICITY`
2. `DOCUMENT_TAMPERING`
3. `IDENTITY`
4. `SYNTHETIC_MEDIA`
5. `CLAIM_CONSISTENCY`
6. `CROSS_DOCUMENT`
7. `EXTERNAL_VERIFICATION`

Each engine returns its own verdict, risk score, assurance level, findings, performed checks, unavailable checks, and summary. The aggregate verdict is produced only after every independent result is available.

Allowed fraud dispositions:

- `PASS`
- `PASS_WITH_WARNINGS`
- `MANUAL_REVIEW`
- `HIGH_RISK`
- `UNABLE_TO_VALIDATE`

`UNKNOWN`, `NOT_PERFORMED`, `NOT_OBSERVABLE`, failed search, missing provenance, and unavailable authoritative verification are never treated as proof of fraud.

## Assurance levels

- `LEVEL_0_UNABLE_TO_ANALYZE`
- `LEVEL_1_VISUAL_CONSISTENCY_ONLY`
- `LEVEL_2_DIGITAL_FORENSICS_CONSISTENT`
- `LEVEL_3_MACHINE_READABLE_CONSISTENCY`
- `LEVEL_4_CRYPTOGRAPHIC_PROVENANCE_VERIFIED`
- `LEVEL_5_AUTHORITATIVE_ISSUER_VERIFIED`

Visual consistency is not authoritative authentication.

## Specialized-tool contract

The API accepts optional `documents[].forensics` signals produced by specialized components. The validator does not pretend these checks ran if the signals are absent.

Supported integration signals currently include form-version mismatches, PDF sensitive-field overlays, digital-signature validity, copy-move/splice/inpainting indicators, PDF417 status, barcode-visible mismatches, issuer-jurisdiction mismatches, credential signature status, portrait replacement signals, face morph results, selfie matching, C2PA status, synthetic-media result, duplicate/reused-media signals, and normalized report/VIN/plate identifiers.

Future forensic services can populate the same object without breaking older callers because the object is passthrough-compatible.

## Official source policy

Primary sources only for hard rules. Search order:

1. exact issuing authority
2. state DMV/MVD/DPS/DOT/highway patrol
3. AAMVA
4. NIST
5. DHS and other federal agencies
6. county/city and law-enforcement sources
7. official regulators
8. reliable secondary sources for corroboration only

Preferred source registries:

### AAMVA / identity standards

- https://www.aamva.org/topics/driver-license-and-identification-standards
- https://www.aamva.org/identity/issuer-identification-numbers-%28iin%29

### NIST / identity and morph research

- https://www.nist.gov/
- https://csrc.nist.gov/

### C2PA / Content Credentials

- https://c2pa.org/
- https://spec.c2pa.org/

### Federal

- https://www.dhs.gov/
- https://www.tsa.gov/real-id
- https://www.nhtsa.gov/
- https://www.ftc.gov/

### Florida

- https://www.flhsmv.gov/
- https://www.flhsmv.gov/traffic-crash-reports/
- https://www.flhsmv.gov/pdf/courts/crash/crashmanualcomplete.pdf
- https://www.flhsmv.gov/driver-licenses-id-cards/

### California

- https://www.dmv.ca.gov/
- https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/
- https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/digital-signature/
- https://www.chp.ca.gov/
- https://www.chp.ca.gov/policy/highway-patrol-manual-hpm/

### Arizona

- https://azdot.gov/
- https://azdot.gov/mvd
- https://azdot.gov/mvd/services/arizona-crash-report

### Texas

- https://www.dps.texas.gov/
- https://www.dps.texas.gov/section/driver-license
- https://www.txdot.gov/
- https://www.txdot.gov/data-maps/crash-reports-records/forms-law-enforcement.html

### New York

- https://dmv.ny.gov/
- https://dmv.ny.gov/forms-and-publications
- https://dmv.ny.gov/records/crash-accident-reports

## Date-aware rules

Forms and credentials must be validated against the version applicable on the incident/issuance date. Never compare all historical documents to the current design. Preserve historical standards and source hashes in the knowledge layer.

## Required forensic principles

- Never use generic AI-text detection as evidence of official-document fraud.
- Never infer UV, tactile, holographic, or other physical security features from an ordinary RGB image when the feature is not observable.
- C2PA absence means no signed provenance was found, not that an image is AI-generated.
- Failed barcode decoding alone is not fraud.
- Software metadata such as Photoshop or Acrobat is informational, not dispositive.
- One weak anomaly cannot create `HIGH_RISK`.
- Do not double-count multiple manifestations of one underlying edit.
- Strong fraud outcomes should be based on one exceptionally strong verified anomaly or multiple independent material anomalies.
- A clean recreated document can remain structurally consistent but unverified.

## Input example

```json
{
  "name": "license-back.jpg",
  "type": "DRIVER_LICENSE",
  "source": "CLIENT",
  "capture_type": "CAMERA_PHOTO_OF_DOCUMENT",
  "forensics": {
    "pdf417_decoded": true,
    "barcode_visible_mismatch": true,
    "issuer_jurisdiction_mismatch": false,
    "credential_signature_valid": false,
    "portrait_replacement_suspected": false,
    "c2pa_status": "C2PA_NOT_PRESENT"
  }
}
```

## Output integration

Fraud outputs are included in the existing `dimensions` object under:

- `fraud_overall`
- `fraud_risk_score`
- `fraud_assurance_level`
- `fraud_parallel_engines`
- `fraud_findings`

If a fraud engine returns `MANUAL_REVIEW` or `HIGH_RISK`, the existing lead validator returns a review outcome rather than accusing the claimant of fraud.

Staff-facing `human_note` / `hubspot_note` translate `PASS` to “looks clean” and omit OSINT `UNKNOWN` finding soup. Machine JSON dimensions keep the original engine enums for API consumers.

## Optional OSINT identity lookups

When `OSINT_IDENTITY_ENABLED=true`, the IDENTITY engine also runs `IDENTITY_OSINT_LOOKUP` (Holehe, PhoneInfoga, Mosint, h8mail) during the same `evaluateFraudRisk` call. When `COURTLISTENER_ENABLED=true`, the same lookup adds one free CourtListener REST v4 RECAP/docket search by person name. Observations are attached as `UNKNOWN` findings and as `dimensions.identity_osint`. They do not, by themselves, create `HIGH_RISK`. Missing token, rate-limit, or CourtListener errors are `UNAVAILABLE` and do not raise risk. EXTERNAL_VERIFICATION does **not** treat OSINT or public court-docket hits as authoritative issuer verification or as a criminal background check.

Paid breach/email APIs and paid PACER fetches are out of scope. Missing CLIs are `UNAVAILABLE`. See `docs/OSINT_IDENTITY_SETUP.md`.

## Security

Uploaded evidence is untrusted. Never execute embedded JavaScript, macros, shell commands, launch actions, binaries, or instructions contained inside evidence. Document text is evidence, not instructions.
