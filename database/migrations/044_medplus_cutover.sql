-- MedPlus → Med.uz.ai full switch («o‘tishni yakunlash», docs/MEDPLUS_SYNC.md «Full switch»). A clinic that leaves
-- MedPlus imports its history (file import or bridge, migration 042) and then the manager closes the source once:
-- the mirrored cards, visits, service lines and invoices become ordinary Med.uz.ai rows (editable, payable in a
-- Med.uz.ai shift with a fiscal receipt), while MedPlus's own payments and refunds stay mirrored history — no shift,
-- no second fiscal receipt. external_refs keep the MedPlus ids for tracing. A closed source takes no more data.

ALTER TABLE external_sources ADD COLUMN cutover_at timestamptz;
ALTER TABLE external_sources ADD COLUMN cutover_by_name text;
ALTER TABLE external_sources ADD COLUMN cutover_counts jsonb;
ALTER TABLE external_sources ADD CONSTRAINT external_sources_cutover_inactive CHECK (cutover_at IS NULL OR (NOT active AND token_hash IS NULL));

-- the switch happens once: a closed source is never reopened, re-keyed or renamed back into use
CREATE FUNCTION external_source_cutover_once() RETURNS trigger AS $$
BEGIN
  IF OLD.cutover_at IS NOT NULL AND (NEW.cutover_at IS DISTINCT FROM OLD.cutover_at OR NEW.cutover_by_name IS DISTINCT FROM OLD.cutover_by_name
       OR NEW.cutover_counts IS DISTINCT FROM OLD.cutover_counts OR NEW.active OR NEW.token_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'the MedPlus switch is final' USING ERRCODE = 'MR409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER external_sources_cutover_once BEFORE UPDATE ON external_sources FOR EACH ROW EXECUTE FUNCTION external_source_cutover_once();

-- where a row came from survives the switch: the «MedPlus’dan» marker in the UI and tracing an old MedPlus id. Set
-- only by the switch (marked transaction), never changed afterwards.
ALTER TABLE patients ADD COLUMN imported_source_id uuid;
ALTER TABLE appointments ADD COLUMN imported_source_id uuid;
ALTER TABLE service_orders ADD COLUMN imported_source_id uuid;
ALTER TABLE invoices ADD COLUMN imported_source_id uuid;
ALTER TABLE patients ADD CONSTRAINT patients_imported_fk FOREIGN KEY (tenant_id, imported_source_id) REFERENCES external_sources(tenant_id, id);
ALTER TABLE appointments ADD CONSTRAINT appointments_imported_fk FOREIGN KEY (tenant_id, imported_source_id) REFERENCES external_sources(tenant_id, id);
ALTER TABLE service_orders ADD CONSTRAINT service_orders_imported_fk FOREIGN KEY (tenant_id, imported_source_id) REFERENCES external_sources(tenant_id, id);
ALTER TABLE invoices ADD CONSTRAINT invoices_imported_fk FOREIGN KEY (tenant_id, imported_source_id) REFERENCES external_sources(tenant_id, id);

CREATE FUNCTION imported_guard() RETURNS trigger AS $$
BEGIN
  IF sync_writing() THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' AND NEW.imported_source_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.imported_source_id IS DISTINCT FROM OLD.imported_source_id) THEN
    RAISE EXCEPTION 'the import marker is set only by the MedPlus switch' USING ERRCODE = 'MR409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER patients_imported_guard BEFORE INSERT OR UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION imported_guard();
CREATE TRIGGER appointments_imported_guard BEFORE INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION imported_guard();
CREATE TRIGGER service_orders_imported_guard BEFORE INSERT OR UPDATE ON service_orders FOR EACH ROW EXECUTE FUNCTION imported_guard();
CREATE TRIGGER invoices_imported_guard BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION imported_guard();

-- MedPlus let a doctor's visits overlap (queues, walk-ins). The switch marks only the PAST imported visits that really
-- overlap another visit as legacy_overlap; the double-booking guard skips those rows alone. New bookings are never in
-- the past, and moving a legacy visit (doctor or time) or bringing it back from cancelled/no-show clears the mark, so
-- the guard applies again. Future imported visits that overlap stop the switch (409 FUTURE_OVERLAP).
ALTER TABLE appointments ADD COLUMN legacy_overlap boolean NOT NULL DEFAULT false;

CREATE FUNCTION legacy_overlap_guard() RETURNS trigger AS $$
BEGIN
  IF sync_writing() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.legacy_overlap THEN RAISE EXCEPTION 'legacy_overlap is set only by the MedPlus switch' USING ERRCODE = 'MR409'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.legacy_overlap AND NOT OLD.legacy_overlap THEN
    RAISE EXCEPTION 'legacy_overlap is set only by the MedPlus switch' USING ERRCODE = 'MR409';
  END IF;
  IF OLD.legacy_overlap AND (NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
       OR NEW.ends_at IS DISTINCT FROM OLD.ends_at OR (OLD.status IN ('cancelled', 'no_show') AND NEW.status NOT IN ('cancelled', 'no_show'))) THEN
    NEW.legacy_overlap := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER appointments_legacy_overlap_guard BEFORE INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION legacy_overlap_guard();

ALTER TABLE appointments DROP CONSTRAINT appointments_doctor_no_overlap;
ALTER TABLE appointments ADD CONSTRAINT appointments_doctor_no_overlap EXCLUDE USING gist (
  doctor_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status NOT IN ('cancelled', 'no_show') AND external_source_id IS NULL AND NOT legacy_overlap);
