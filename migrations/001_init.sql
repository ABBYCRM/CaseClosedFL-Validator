CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS api_tokens(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, prefix text NOT NULL,
  token_hash text UNIQUE NOT NULL, scopes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS validation_runs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id text NOT NULL, request jsonb NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED', self_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS validation_runs_lead_idx ON validation_runs(lead_id,created_at DESC);
CREATE TABLE IF NOT EXISTS tool_executions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), validation_id uuid REFERENCES validation_runs(id) ON DELETE CASCADE,
  tool text NOT NULL, action text NOT NULL, fingerprint text NOT NULL, args jsonb NOT NULL,
  status text NOT NULL, result jsonb, error text,
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS tool_exec_validation_idx ON tool_executions(validation_id,started_at);
CREATE TABLE IF NOT EXISTS evidence(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), validation_id uuid REFERENCES validation_runs(id) ON DELETE CASCADE,
  claim text NOT NULL, epistemic_state text NOT NULL,
  source_id text, source_url text, source_type text NOT NULL,
  tool_execution_id uuid REFERENCES tool_executions(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, content_hash text,
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_validation_idx ON evidence(validation_id,claim,observed_at);
CREATE TABLE IF NOT EXISTS validation_results(
  validation_id uuid PRIMARY KEY REFERENCES validation_runs(id) ON DELETE CASCADE,
  result jsonb NOT NULL, result_hash text NOT NULL, engine_version text NOT NULL,
  knowledge_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS knowledge_sources(
  source_id text PRIMARY KEY, jurisdiction text, case_types text[] NOT NULL DEFAULT '{}', dimension text NOT NULL,
  authority text NOT NULL, authority_level text NOT NULL, url text NOT NULL, domain text NOT NULL,
  access_mode text NOT NULL DEFAULT 'PUBLIC', identifiers text[] NOT NULL DEFAULT '{}',
  notes text, enabled boolean NOT NULL DEFAULT true, last_verified_at timestamptz, last_health_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS knowledge_chunks(
  id bigserial PRIMARY KEY, source_id text REFERENCES knowledge_sources(source_id) ON DELETE CASCADE,
  jurisdiction text, case_type text, dimension text, url text, authority_level text,
  content text NOT NULL, embedding vector(2048), content_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_meta_idx ON knowledge_chunks(jurisdiction,case_type,dimension);
CREATE INDEX IF NOT EXISTS knowledge_source_idx ON knowledge_chunks(source_id);
CREATE TABLE IF NOT EXISTS audit_events(
  id bigserial PRIMARY KEY, event_type text NOT NULL, validation_id uuid REFERENCES validation_runs(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
