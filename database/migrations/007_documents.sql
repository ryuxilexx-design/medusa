-- Visit documents the doctor issues from the encounter: referral (yo‘llanma), certificate of visit
-- (tibbiy ma’lumotnoma) and prescription (retsept / dori tavsiyasi). Issued documents are numbered and
-- immutable; a mistake is corrected by voiding (with a reason) and issuing a new one.

ALTER TABLE tenants ADD COLUMN document_seq integer NOT NULL DEFAULT 0;

CREATE TABLE medical_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  encounter_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('referral', 'certificate', 'prescription')),
  number integer NOT NULL,
  body jsonb NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  issued_at timestamptz NOT NULL DEFAULT demo_now(),
  issued_by uuid,
  issued_by_name text NOT NULL,
  void_reason text,
  voided_at timestamptz,
  voided_by_name text,
  CHECK (status = 'issued' OR (void_reason IS NOT NULL AND voided_at IS NOT NULL)),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id)
);
CREATE INDEX medical_documents_encounter ON medical_documents (encounter_id, issued_at);
CREATE INDEX medical_documents_patient ON medical_documents (patient_id, issued_at DESC);

-- The only change allowed after issue: issued → void (with reason, time and who). No deletes.
CREATE FUNCTION medical_document_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'medical document cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'void'
     OR NEW.status <> 'void'
     OR NEW.body IS DISTINCT FROM OLD.body OR NEW.kind <> OLD.kind OR NEW.number <> OLD.number
     OR NEW.patient_id <> OLD.patient_id OR NEW.encounter_id <> OLD.encounter_id OR NEW.issued_at <> OLD.issued_at THEN
    RAISE EXCEPTION 'issued medical document is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER medical_documents_immutable BEFORE UPDATE OR DELETE ON medical_documents
  FOR EACH ROW EXECUTE FUNCTION medical_document_guard();
