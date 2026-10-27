-- External sync (docs/MEDPLUS_SYNC.md): a pilot clinic keeps MedPlus as its main system and Med.uz.ai mirrors it one
-- way. A bridge on the clinic PC reads MedPlus READ-ONLY and posts batches; a manager can also import MedPlus Excel
-- exports. Both go through the same upsert path (apps/api/src/sync/ingest.ts), keyed by external_refs, so nothing is
-- ever created twice.
--
-- Mirrored rows carry external_source_id. They are read-only for everyone except the sync path, which marks its
-- transaction with `SET LOCAL meduza.sync = 'on'` (set_config(..., true)); every other write is refused with
-- SQLSTATE MR409 (→ 409 MIRRORED_RECORD). Mirrored payments/refunds never belong to a Med.uz.ai cash shift and never
-- get a fiscal receipt (the clinic's own KKM fiscalised them in MedPlus); they count in cash-basis revenue.

CREATE TABLE external_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('medplus')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_hash text UNIQUE,                         -- SHA-256 of the bridge token; the token itself is shown once
  active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,                       -- last authenticated batch
  last_batch_at timestamptz,
  last_cursor jsonb NOT NULL DEFAULT '{}'::jsonb, -- the bridge's own cursor after its last accepted batch (ids/timestamps only)
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, kind)                        -- one MedPlus connection per clinic
);

-- One row per mirrored record: the external id ↔ our row. payload_hash lets an unchanged record be skipped cheaply.
-- kind 'invoice' holds our grouping key (visit:<id> or day:<patient>:<branch>:<date>); 'payment'/'refund' parts of a
-- split payment are «<id>#2», «<id>#3».
CREATE TABLE external_refs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('patient', 'visit', 'order', 'invoice', 'payment', 'refund')),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  our_id uuid NOT NULL,
  payload_hash text,
  ext_updated_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT demo_now(),
  updated_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (source_id, kind, external_id),
  UNIQUE (source_id, kind, our_id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES external_sources(tenant_id, id)
);
CREATE INDEX external_refs_our ON external_refs (our_id);

-- Reference data the manager confirms: MedPlus branch/service/doctor/payment form/user → ours. A record with an
-- unknown service or doctor gets a placeholder (inactive service «MedPlus: …», inactive doctor stub) right away;
-- an unknown branch or payment form waits in external_pending until the manager maps it. Remapping changes future
-- records only — mirrored rows keep their snapshot.
CREATE TABLE external_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('branch', 'service', 'doctor', 'method', 'staff')),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  external_name text CHECK (external_name IS NULL OR length(external_name) <= 200),
  target_id uuid,                                  -- our branch / service / doctor / membership
  target_code text CHECK (target_code IS NULL OR target_code IN ('cash', 'card', 'transfer')), -- payment method
  placeholder boolean NOT NULL DEFAULT false,      -- target_id is a stub created by the sync
  status text NOT NULL DEFAULT 'auto' CHECK (status IN ('auto', 'confirmed')),
  confirmed_by_name text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (source_id, kind, external_id),
  CHECK (kind <> 'method' OR target_id IS NULL),
  FOREIGN KEY (tenant_id, source_id) REFERENCES external_sources(tenant_id, id)
);

-- Records that cannot apply yet (a visit before its patient, a payment before its services, an unmapped branch).
-- Retried after every batch and after a mapping change; dropped once applied. Kept at most PENDING_DAYS.
CREATE TABLE external_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_id uuid NOT NULL,
  kind text NOT NULL,
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  record jsonb NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 60),
  attempts integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT demo_now(),
  last_tried_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (source_id, kind, external_id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES external_sources(tenant_id, id)
);
CREATE INDEX external_pending_age ON external_pending (source_id, first_seen_at);

-- «Possible duplicate»: a mirrored card that may be the same person as an existing card. Never merged automatically.
CREATE TABLE external_duplicates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  candidate_ids uuid[] NOT NULL,
  reason text NOT NULL CHECK (reason IN ('pinfl_taken', 'phone_birth_many', 'phone_birth_linked', 'phone_birth_name')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed')),
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (source_id, patient_id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES external_sources(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id)
);

-- One row per batch (bridge) or file import: counts and error samples ({kind, external_id, code}) — never names,
-- phones or other personal data. Append-only.
CREATE TABLE external_sync_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('bridge', 'file')),
  actor_name text,
  received integer NOT NULL DEFAULT 0,
  created integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0,
  parked integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  applied_pending integer NOT NULL DEFAULT 0,
  error_samples jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, source_id) REFERENCES external_sources(tenant_id, id)
);
CREATE INDEX external_sync_log_recent ON external_sync_log (source_id, id DESC);
CREATE FUNCTION forbid_sync_log_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sync log is append-only' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER external_sync_log_append_only BEFORE UPDATE OR DELETE ON external_sync_log FOR EACH ROW EXECUTE FUNCTION forbid_sync_log_change();

-- Daily control totals the bridge reads from MedPlus (per day and MedPlus branch) for the reconciliation report.
CREATE TABLE external_daily_totals (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_id uuid NOT NULL,
  day date NOT NULL,
  branch_external_id text NOT NULL DEFAULT '' CHECK (length(branch_external_id) <= 200),
  payments_sum bigint NOT NULL DEFAULT 0,
  payments_count integer NOT NULL DEFAULT 0 CHECK (payments_count >= 0),
  patients_total integer CHECK (patients_total IS NULL OR patients_total >= 0),
  received_at timestamptz NOT NULL DEFAULT demo_now(),
  PRIMARY KEY (source_id, day, branch_external_id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES external_sources(tenant_id, id)
);

-- ---------- the mirrored rows
ALTER TABLE patients ADD COLUMN external_source_id uuid;
ALTER TABLE appointments ADD COLUMN external_source_id uuid;
ALTER TABLE service_orders ADD COLUMN external_source_id uuid;
ALTER TABLE invoices ADD COLUMN external_source_id uuid;
ALTER TABLE payments ADD COLUMN external_source_id uuid;
ALTER TABLE refunds ADD COLUMN external_source_id uuid;
ALTER TABLE patients ADD CONSTRAINT patients_external_fk FOREIGN KEY (tenant_id, external_source_id) REFERENCES external_sources(tenant_id, id);
ALTER TABLE appointments ADD CONSTRAINT appointments_external_fk FOREIGN KEY (tenant_id, external_source_id) REFERENCES external_sources(tenant_id, id);
ALTER TABLE service_orders ADD CONSTRAINT service_orders_external_fk FOREIGN KEY (tenant_id, external_source_id) REFERENCES external_sources(tenant_id, id);
ALTER TABLE invoices ADD CONSTRAINT invoices_external_fk FOREIGN KEY (tenant_id, external_source_id) REFERENCES external_sources(tenant_id, id);
ALTER TABLE payments ADD CONSTRAINT payments_external_fk FOREIGN KEY (tenant_id, external_source_id) REFERENCES external_sources(tenant_id, id);
ALTER TABLE refunds ADD CONSTRAINT refunds_external_fk FOREIGN KEY (tenant_id, external_source_id) REFERENCES external_sources(tenant_id, id);

-- a mirrored payment/refund never sits in a Med.uz.ai drawer and is never a deposit movement
ALTER TABLE payments ADD CONSTRAINT payments_external_no_shift CHECK (external_source_id IS NULL OR (shift_id IS NULL AND method IN ('cash', 'card', 'transfer')));
ALTER TABLE refunds ADD CONSTRAINT refunds_external_no_shift CHECK (external_source_id IS NULL OR shift_id IS NULL);
-- «cash leaves a real drawer» stays the rule for our own refunds; a mirrored cash refund left MedPlus's drawer
ALTER TABLE refunds DROP CONSTRAINT refunds_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_cash_needs_shift CHECK (method <> 'cash' OR shift_id IS NOT NULL OR external_source_id IS NOT NULL);

-- reconciliation (per source and day) and the badge lookups read only mirrored rows
CREATE INDEX payments_external ON payments (external_source_id, paid_at) WHERE external_source_id IS NOT NULL;
CREATE INDEX refunds_external ON refunds (external_source_id, refunded_at) WHERE external_source_id IS NOT NULL;
CREATE INDEX invoices_external ON invoices (external_source_id, patient_id) WHERE external_source_id IS NOT NULL;
CREATE INDEX patients_external ON patients (external_source_id) WHERE external_source_id IS NOT NULL;

-- MedPlus does not stop a doctor's visits from overlapping: the double-booking guard applies to our own bookings only
-- (booking.ts still sees a mirrored visit as busy time when it offers slots)
ALTER TABLE appointments DROP CONSTRAINT appointments_doctor_no_overlap;
ALTER TABLE appointments ADD CONSTRAINT appointments_doctor_no_overlap EXCLUDE USING gist (
  doctor_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status NOT IN ('cancelled', 'no_show') AND external_source_id IS NULL);

-- ---------- read-only enforcement
CREATE FUNCTION sync_writing() RETURNS boolean AS $$
  SELECT coalesce(current_setting('meduza.sync', true), '') = 'on';
$$ LANGUAGE sql STABLE;

CREATE FUNCTION mirror_guard() RETURNS trigger AS $$
DECLARE
  mirrored boolean;
BEGIN
  IF sync_writing() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.external_source_id IS NOT NULL THEN
      RAISE EXCEPTION 'mirrored rows are written only by the sync' USING ERRCODE = 'MR409';
    END IF;
    -- our own payment, refund or order on a mirrored invoice / visit
    IF TG_TABLE_NAME IN ('payments', 'refunds') THEN
      SELECT i.external_source_id IS NOT NULL INTO mirrored FROM invoices i WHERE i.id = NEW.invoice_id;
    ELSIF TG_TABLE_NAME = 'service_orders' THEN
      IF NEW.appointment_id IS NOT NULL THEN
        SELECT a.external_source_id IS NOT NULL INTO mirrored FROM appointments a WHERE a.id = NEW.appointment_id;
      END IF;
    END IF;
    IF mirrored THEN RAISE EXCEPTION 'mirrored invoice or visit is read-only' USING ERRCODE = 'MR409'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.external_source_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NEW.external_source_id IS NOT NULL THEN
      RAISE EXCEPTION 'only the sync links a row to an external source' USING ERRCODE = 'MR409';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'mirrored row is read-only' USING ERRCODE = 'MR409'; END IF;
  IF NEW.external_source_id IS DISTINCT FROM OLD.external_source_id THEN
    RAISE EXCEPTION 'mirrored row is read-only' USING ERRCODE = 'MR409';
  END IF;
  IF TG_TABLE_NAME = 'patients' THEN
    -- MedPlus owns the identity of a mirrored card; clinical fields (allergy) stay ours, and an erasure request
    -- (anonymisation) is never blocked
    IF NEW.anonymised_at IS NOT NULL THEN RETURN NEW; END IF;
    IF NEW.last_name <> OLD.last_name OR NEW.first_name <> OLD.first_name OR NEW.middle_name IS DISTINCT FROM OLD.middle_name
       OR NEW.birth_date <> OLD.birth_date OR NEW.sex <> OLD.sex OR NEW.phone IS DISTINCT FROM OLD.phone
       OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone OR NEW.address IS DISTINCT FROM OLD.address
       OR NEW.pinfl IS DISTINCT FROM OLD.pinfl THEN
      RAISE EXCEPTION 'mirrored patient identity is read-only' USING ERRCODE = 'MR409';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'appointments' THEN
    -- a patient's «I will come» on a reminder is not a change of the visit
    IF NEW.status = OLD.status AND NEW.starts_at = OLD.starts_at AND NEW.ends_at = OLD.ends_at AND NEW.doctor_id = OLD.doctor_id
       AND NEW.service_id = OLD.service_id AND NEW.branch_id = OLD.branch_id AND NEW.patient_id = OLD.patient_id
       AND NEW.room_id IS NOT DISTINCT FROM OLD.room_id THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'mirrored row is read-only' USING ERRCODE = 'MR409';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER patients_mirror_guard BEFORE INSERT OR UPDATE OR DELETE ON patients FOR EACH ROW EXECUTE FUNCTION mirror_guard();
CREATE TRIGGER appointments_mirror_guard BEFORE INSERT OR UPDATE OR DELETE ON appointments FOR EACH ROW EXECUTE FUNCTION mirror_guard();
CREATE TRIGGER service_orders_mirror_guard BEFORE INSERT OR UPDATE OR DELETE ON service_orders FOR EACH ROW EXECUTE FUNCTION mirror_guard();
CREATE TRIGGER invoices_mirror_guard BEFORE INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION mirror_guard();
CREATE TRIGGER payments_mirror_guard BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION mirror_guard();
CREATE TRIGGER refunds_mirror_guard BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION mirror_guard();

-- invoice lines and per-line refunds of a mirrored invoice belong to the sync too
CREATE FUNCTION mirror_item_guard() RETURNS trigger AS $$
DECLARE
  inv uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN inv := OLD.invoice_id; ELSE inv := NEW.invoice_id; END IF;
  IF NOT sync_writing() AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = inv AND i.external_source_id IS NOT NULL) THEN
    RAISE EXCEPTION 'mirrored invoice is read-only' USING ERRCODE = 'MR409';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER invoice_items_mirror_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_items FOR EACH ROW EXECUTE FUNCTION mirror_item_guard();

-- MedPlus's own KKM fiscalised a mirrored payment: Med.uz.ai never issues a second receipt for it
CREATE FUNCTION fiscal_not_mirrored() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM payments p WHERE p.id = NEW.payment_id AND p.external_source_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM refunds r WHERE r.id = NEW.refund_id AND r.external_source_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a mirrored payment has no Med.uz.ai fiscal receipt' USING ERRCODE = 'MR409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fiscal_receipts_not_mirrored BEFORE INSERT ON fiscal_receipts FOR EACH ROW EXECUTE FUNCTION fiscal_not_mirrored();
