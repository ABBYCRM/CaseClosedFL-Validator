# Security

- Never commit API keys. `.env` is ignored.
- Rotate any key that has appeared in chat, logs, screenshots, tickets, or source control.
- The public API uses HMAC-fingerprinted scoped bearer tokens; plaintext tokens are returned only at mint time.
- Admin routes require a separate admin secret and are intended for private/admin ingress.
- Composio is restricted in code to search/extract/browser/public-record capabilities. Direct provider fallbacks (Exa, Tavily, Firecrawl, ScrapingBee, Scrapfly, Steel) are the same read-only corridor and are optional at boot. Messaging, CRM writes, purchases, payment, shell/workbench, deletion, and unrelated write tools are denied.
- Government/public portals are accessed read-only. Do not bypass authentication, confidentiality periods, CAPTCHA, statutory restrictions, or paywalls.
- Raw external responses are not copied wholesale into evidence; the ledger stores digests and bounded observations to minimize PII retention.
- `UNKNOWN`, `NOT_CORROBORATED`, tool failure, and `INCOMPLETE` are valid states. They must never be converted to fraud or falsity automatically.
- OpenClaw Gateway credentials are effectively operator credentials. Use a dedicated isolated Gateway if enabling the adapter.
- HubSpot is out of scope except the optional standalone bridge: read two allowlisted forms, look up a contact by email, and create one NOTE. Contact/deal/ticket updates and other CRM writes stay denied. See `docs/HUBSPOT_BRIDGE.md`.
