-- Less typing for the doctor: note templates per specialty, quick phrases, and the follow-up booked by the doctor.
-- Templates and phrases are interface text of the clinic, not patient data: no clinical note is ever copied into them
-- by the system (a doctor may save their own note as a template — that is their choice, shown to colleagues of the clinic).

-- ---------- note templates: pre-written note fields + ICD-10 codes + the orders the template usually comes with.
-- specialty NULL = for every doctor of the clinic. starter_key marks the starter templates shipped with the product
-- (database/seed/templates.ts), so a restart never adds a second copy and a clinic that hid one keeps it hidden.
CREATE TABLE note_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  specialty text CHECK (specialty IS NULL OR length(specialty) BETWEEN 2 AND 80),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,            -- {complaints, anamnesis, examination, diagnosis, recommendations}
  icd_codes text[] NOT NULL DEFAULT '{}',               -- every code checked against icd10_codes when saved and when applied
  order_service_ids uuid[] NOT NULL DEFAULT '{}',       -- proposed orders; the doctor confirms each one, nothing is ordered automatically
  created_by uuid,                                       -- membership; NULL = starter template
  starter_key text,
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  updated_at timestamptz NOT NULL DEFAULT demo_now(),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, id)
);
CREATE UNIQUE INDEX note_templates_starter ON note_templates (tenant_id, starter_key) WHERE starter_key IS NOT NULL;
CREATE INDEX note_templates_list ON note_templates (tenant_id, sort, name) WHERE active;

-- ---------- quick phrases: one line of text a doctor puts into a note field with one tap.
-- doctor_id NULL = shared by the clinic (the manager adds those); uses = how often it was tapped (most used first).
CREATE TABLE quick_phrases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  doctor_id uuid,
  field text NOT NULL CHECK (field IN ('complaints', 'anamnesis', 'examination', 'diagnosis', 'recommendations')),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id)
);
-- the same phrase is one row per owner (NULL owner = the clinic)
CREATE UNIQUE INDEX quick_phrases_unique ON quick_phrases (tenant_id, coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'::uuid), field, text);
CREATE INDEX quick_phrases_list ON quick_phrases (tenant_id, field, uses DESC);

-- ---------- follow-up booked by the treating doctor from the signed note: the schedule shows who made the booking
ALTER TABLE appointments DROP CONSTRAINT appointments_source_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_source_check CHECK (source IN ('staff', 'telegram', 'doctor'));
-- «is the recommended follow-up booked?» on the patient card: the latest signed note with a follow-up date
CREATE INDEX clinical_notes_follow_up ON clinical_notes (encounter_id) WHERE status = 'signed' AND follow_up_date IS NOT NULL;
