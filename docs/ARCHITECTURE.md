# Architecture

`CaseClosedFL-Validator` is a bounded verification microservice. The TypeScript runtime is the agent. NVIDIA is a constrained semantic component, never the authority for evidence or execution state.

## Flow

`API -> schema -> deterministic intake hard-stops -> jurisdiction/case skill -> source registry -> Composio read-only tools -> evidence ledger -> optional NVIDIA document extraction -> deterministic decision -> signed/hashable JSON result`

## Evidence hierarchy
1. Direct authoritative government observation.
2. Official government registry/search result tied to the authoritative domain.
3. Client-provided official document, treated as document evidence rather than external proof.
4. Official license/business/court registries.
5. Search-engine discovery, which cannot override an authoritative source.

## OpenClaw
OpenClaw is an optional note-consumer/gateway adapter. The bundled `openclaw/skills/caseclosed-validator/SKILL.md` teaches an OpenClaw agent how to preserve the validator result when producing notes. OpenClaw never receives authority to modify validation state, tools, evidence, or qualification.

The OpenAI-compatible Gateway endpoint is an operator-level credential surface. Deploy a dedicated isolated OpenClaw instance if enabled; do not point the validator at a general personal/operator Gateway.
