CREATE TABLE IF NOT EXISTS validation_screenshots(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_id uuid NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  source_id text,
  file_name text NOT NULL,
  content_type text NOT NULL DEFAULT 'image/jpeg',
  bytes bytea NOT NULL,
  observed_text text,
  vision_model text,
  tool_execution_id uuid REFERENCES tool_executions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS validation_screenshots_url_idx
  ON validation_screenshots(validation_id, source_url);
CREATE INDEX IF NOT EXISTS validation_screenshots_validation_idx
  ON validation_screenshots(validation_id, created_at);
