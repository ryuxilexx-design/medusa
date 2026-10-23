-- Patient-friendly visit summary («Bemor uchun xulosa»): plain-language text the treating doctor approved from a signed
-- note. Append-only evidence (a correction is a new version), like signed notes and addenda. The text is clinical:
-- doctor-only, never in the audit log or ai_usage. Delivery goes through the notifications outbox (kind
-- 'patient_summary', summary_id): Telegram gets the text only in the patient's own linked chat; SMS gets a generic line.
CREATE TABLE patient_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  encounter_id uuid NOT NULL,
  note_id uuid NOT NULL REFERENCES clinical_notes(id),
  patient_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  language text NOT NULL CHECK (language IN ('uz', 'uz-Cyrl', 'ru')),
  text text NOT NULL CHECK (length(text) BETWEEN 20 AND 4000),
  -- how the draft the doctor started from was made: the model (live), the labelled sample, or the template (AI off)
  draft_source text NOT NULL CHECK (draft_source IN ('live', 'sample', 'template')),
  approved_by uuid,
  approved_by_name text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT demo_now(),
  -- the doctor confirmed sending it to the patient (Telegram text / SMS «ready» line)
  send_requested boolean NOT NULL DEFAULT false,
  UNIQUE (encounter_id, version),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id)
);
CREATE INDEX patient_summaries_patient ON patient_summaries (patient_id, approved_at DESC);

CREATE FUNCTION forbid_patient_summary_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'approved patient summary is immutable' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER patient_summaries_immutable BEFORE UPDATE OR DELETE ON patient_summaries
  FOR EACH ROW EXECUTE FUNCTION forbid_patient_summary_change();

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS summary_id uuid REFERENCES patient_summaries(id);
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder_day', 'reminder_soon', 'result_ready', 'cancelled_by_clinic', 'rescheduled_by_clinic', 'booked', 'patient_summary'));
CREATE INDEX IF NOT EXISTS notifications_summary ON notifications (summary_id) WHERE summary_id IS NOT NULL;
