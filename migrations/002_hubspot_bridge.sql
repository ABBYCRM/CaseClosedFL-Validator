CREATE TABLE IF NOT EXISTS hubspot_form_submissions(
  conversion_id text PRIMARY KEY,
  form_guid text NOT NULL,
  submitted_at timestamptz NOT NULL,
  contact_email text,
  page_url text,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  validation_id uuid REFERENCES validation_runs(id) ON DELETE SET NULL,
  note_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hubspot_form_submissions_email_idx
  ON hubspot_form_submissions(contact_email, submitted_at DESC);

CREATE TABLE IF NOT EXISTS hubspot_bridge_state(
  form_guid text PRIMARY KEY,
  after_cursor text,
  last_polled_at timestamptz,
  last_success_at timestamptz,
  last_error text
);
