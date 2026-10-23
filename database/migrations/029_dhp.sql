-- Digital Health Platform (DHP / DMED) of the Ministry of Health — integration-ready layer.
-- PP-170 (05.05.2026) makes data exchange with the platform a licensing condition from 2027-04-01. The platform's
-- implementation guide and the clinic's token are not available yet (docs/DMED_INTEGRATION.md), so Med.uz.ai builds
-- FHIR R4 bundles NOW into an outbox: mode «export» keeps them downloadable (NDJSON), mode «live» POSTs them to the
-- endpoint with the clinic's token. Switching to live later needs no schema change.

-- PINFL (JShShIR, 14 digits) is the national patient identifier the platform matches on; passport / ID card optional.
ALTER TABLE patients
  ADD COLUMN pinfl text CHECK (pinfl IS NULL OR pinfl ~ '^[0-9]{14}$'),
  ADD COLUMN id_document text CHECK (id_document IS NULL OR id_document ~ '^[A-Z]{2}[0-9]{7}$');
CREATE UNIQUE INDEX patients_pinfl ON patients (tenant_id, pinfl) WHERE pinfl IS NOT NULL;

-- An anonymised card (026) never gets an identifier back.
CREATE OR REPLACE FUNCTION forbid_deanonymise() RETURNS trigger AS $$
BEGIN
  IF OLD.anonymised_at IS NOT NULL THEN
    IF NEW.anonymised_at IS NULL OR NEW.anonymised_at <> OLD.anonymised_at OR NEW.erasure_reason <> OLD.erasure_reason THEN
      RAISE EXCEPTION 'anonymised patient cannot be restored' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.last_name <> OLD.last_name OR NEW.first_name <> OLD.first_name OR NEW.middle_name IS DISTINCT FROM OLD.middle_name
       OR NEW.birth_date <> OLD.birth_date OR NEW.sex <> OLD.sex OR NEW.phone IS DISTINCT FROM OLD.phone
       OR NEW.contact_name IS DISTINCT FROM OLD.contact_name OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
       OR NEW.address IS DISTINCT FROM OLD.address OR NEW.note IS DISTINCT FROM OLD.note
       OR NEW.pinfl IS DISTINCT FROM OLD.pinfl OR NEW.id_document IS DISTINCT FROM OLD.id_document THEN
      RAISE EXCEPTION 'anonymised patient has no identifying data' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- One platform connection per clinic. The token is AES-256-GCM encrypted with APP_SECRET_KEY and never returned.
CREATE TABLE dhp_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'export', 'live')),
  endpoint text CHECK (endpoint IS NULL OR (length(endpoint) BETWEEN 10 AND 500 AND endpoint ~ '^https?://')),
  token_enc text,
  last_error text,
  last_error_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  updated_at timestamptz NOT NULL DEFAULT demo_now(),
  CHECK (mode <> 'live' OR (endpoint IS NOT NULL AND token_enc IS NOT NULL))
);

-- Outbox: one FHIR transaction Bundle per clinical event (signed note → Encounter + Condition, verified lab result →
-- Observation, issued / voided prescription → MedicationRequest, addendum → DocumentReference).
--   pending → ready  (export mode: in the download)        pending/ready → sent    (live: endpoint answered 2xx)
--   pending/ready → failed (4xx, missing PINFL, attempts used up; the manager's «retry» rebuilds and re-queues it)
--   skipped = never sent (patient anonymised: the FHIR payload is cleared)
CREATE TABLE dhp_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  patient_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('encounter', 'lab_result', 'prescription', 'addendum')),
  resource_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  fhir jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT demo_now(),
  http_status integer,
  error text CHECK (error IS NULL OR length(error) <= 500),
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  sent_at timestamptz,
  UNIQUE (tenant_id, resource_type, resource_id, version),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);
-- the manager's list and the bounded export
CREATE INDEX dhp_outbox_tenant_created ON dhp_outbox (tenant_id, created_at DESC);
-- the status counts
CREATE INDEX dhp_outbox_tenant_status ON dhp_outbox (tenant_id, status);
-- the worker reads only open rows that are due
CREATE INDEX dhp_outbox_due ON dhp_outbox (next_attempt_at) WHERE status IN ('pending', 'ready');
-- erasure strips the payload of one patient's rows
CREATE INDEX dhp_outbox_patient ON dhp_outbox (patient_id);
