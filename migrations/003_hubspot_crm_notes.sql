CREATE TABLE IF NOT EXISTS hubspot_crm_intakes(
  fingerprint text PRIMARY KEY,
  contact_id text NOT NULL,
  contact_email text,
  intake_note_id text NOT NULL,
  supplemental_note_id text,
  intake_timestamp timestamptz,
  supplemental_timestamp timestamptz,
  processed_at timestamptz,
  validation_id uuid REFERENCES validation_runs(id) ON DELETE SET NULL,
  outcome_note_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hubspot_crm_intakes_contact_idx
  ON hubspot_crm_intakes(contact_id, intake_timestamp DESC);
CREATE INDEX IF NOT EXISTS hubspot_crm_intakes_intake_note_idx
  ON hubspot_crm_intakes(intake_note_id);
