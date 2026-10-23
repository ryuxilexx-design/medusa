-- Data-subject rights (ZRU-547 «Shaxsga doir ma’lumotlar to‘g‘risida»): the erasure request is answered by
-- ANONYMISATION, not deletion — the medical record (notes, results, documents, invoices, payments) must be kept for
-- the retention period of health and accounting law, so the card loses its identifying data and keeps its number.
-- Both columns are set together, once, inside one transaction (modules/erasure.ts); the change is irreversible.

ALTER TABLE patients
  ADD COLUMN anonymised_at timestamptz,
  ADD COLUMN erasure_reason text CHECK (erasure_reason IS NULL OR length(erasure_reason) BETWEEN 3 AND 500),
  ADD CONSTRAINT patients_erasure_pair CHECK ((anonymised_at IS NULL) = (erasure_reason IS NULL));

-- Rare rows, read by the manager's lists and by the search exclusion.
CREATE INDEX patients_anonymised ON patients (tenant_id, anonymised_at) WHERE anonymised_at IS NOT NULL;

-- Irreversible: once anonymised, the card cannot be de-anonymised and no identifying field can be written again.
-- Clinical fields (allergy) stay editable by the treating doctor — they belong to the medical record, not the identity.
CREATE FUNCTION forbid_deanonymise() RETURNS trigger AS $$
BEGIN
  IF OLD.anonymised_at IS NOT NULL THEN
    IF NEW.anonymised_at IS NULL OR NEW.anonymised_at <> OLD.anonymised_at OR NEW.erasure_reason <> OLD.erasure_reason THEN
      RAISE EXCEPTION 'anonymised patient cannot be restored' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.last_name <> OLD.last_name OR NEW.first_name <> OLD.first_name OR NEW.middle_name IS DISTINCT FROM OLD.middle_name
       OR NEW.birth_date <> OLD.birth_date OR NEW.sex <> OLD.sex OR NEW.phone IS DISTINCT FROM OLD.phone
       OR NEW.contact_name IS DISTINCT FROM OLD.contact_name OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
       OR NEW.address IS DISTINCT FROM OLD.address OR NEW.note IS DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'anonymised patient has no identifying data' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER patients_anonymised_immutable BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION forbid_deanonymise();
