# OpenClaw integration

OpenClaw is integrated as a bounded optional gateway plus a workspace skill. It is not vendored and does not own the validator loop.

1. Install/run OpenClaw independently.
2. Copy `openclaw/skills/caseclosed-validator` into the OpenClaw workspace skills root if you want note formatting behavior.
3. Enable the Gateway OpenAI-compatible Chat Completions endpoint.
4. Use a dedicated isolated Gateway and set `OPENCLAW_ENABLED=true`, `OPENCLAW_GATEWAY_URL`, and `OPENCLAW_TOKEN`.
5. The validator may send only completed validation notes/context. It does not grant OpenClaw Composio, database, or qualification authority.

This separation is deliberate: the Gateway token is an operator-level credential, so a general-purpose OpenClaw instance is a larger trust boundary than this validator requires.
