# Security

- Never commit API keys. `.env` is ignored.
- Rotate any key that has appeared in chat, logs, screenshots, tickets, or source control.
- The public API uses HMAC-fingerprinted scoped bearer tokens; plaintext tokens are returned only at mint time.
- Admin routes require a separate admin secret and are intended for private/admin ingress.
- Composio is restricted in code to search/extract/browser/public-record capabilities. Messaging, CRM writes, purchases, payment, shell/workbench, deletion, and unrelated write tools are denied.
- Government/public portals are accessed read-only. Do not bypass authentication, confidentiality periods, CAPTCHA, statutory restrictions, or paywalls.
- Raw external responses are not copied wholesale into evidence; the ledger stores digests and bounded observations to minimize PII retention.
- `UNKNOWN`, `NOT_CORROBORATED`, tool failure, and `INCOMPLETE` are valid states. They must never be converted to fraud or falsity automatically.
- OpenClaw Gateway credentials are effectively operator credentials. Use a dedicated isolated Gateway if enabling the adapter.
- HubSpot is intentionally out of scope. A separate trusted orchestrator may consume `agent_note` and decide whether to write it to CRM.
