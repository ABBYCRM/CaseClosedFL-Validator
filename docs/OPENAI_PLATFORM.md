# OpenAI Platform provider

CaseClosedFL-Validator can run its bounded semantic layer on OpenAI without changing the validation state machine, evidence rules, Composio corridor, PostgreSQL schema, or API contract.

## Configure

```env
MODEL_PROVIDER=openai
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=<runtime secret>
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.4-mini
OPENAI_EMBED_MODEL=text-embedding-3-large
OPENAI_EMBED_DIMENSIONS=2048
```

The database migration uses `vector(2048)`, so the OpenAI embedding adapter explicitly requests 2048 dimensions. `text-embedding-3` models support a `dimensions` parameter.

## Runtime behavior

- Reasoning uses `POST /v1/responses`.
- Output is requested as JSON and then validated again with the local Zod schema before the runtime accepts it.
- Embeddings use `POST /v1/embeddings`.
- The model cannot execute Composio tools directly.
- Model output never becomes evidence by itself.
- The TypeScript runtime remains the state owner and final qualification engine.
- The existing `MAX_MODEL_CALLS` hard budget applies equally to NVIDIA and OpenAI.

To switch back to NVIDIA, set `MODEL_PROVIDER=nvidia` and `EMBEDDING_PROVIDER=nvidia`.

Never commit `OPENAI_API_KEY`; provide it with the deployment secret manager/runtime environment.
