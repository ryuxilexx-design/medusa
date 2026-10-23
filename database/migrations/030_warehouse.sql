-- 030: the clinic warehouse (docs/WAREHOUSE.md).
--   * role «storekeeper» (omborchi / provizor): sees only the warehouse;
--   * items get a category, storage regime, optional drug link, «controlled» flag (narcotic / psychotropic / potent) and price;
--   * stock lives in batches (series, expiry, unit cost) — issue is FEFO, an expired batch is never issued;
--   * every movement is an append-only ledger row (void-only by trigger) that says WHO took the item and FOR WHAT
--     (patient + visit + ICD-10 codes, a procedure order, or a department);
--   * receipts, requests (talabnoma), write-off acts with a commission, inventory counts and a fridge temperature log.
-- Invariant kept by the API: opening_qty + Σ(in) − Σ(out) of an item = Σ batch qty (checked in tests).

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('manager', 'registrar', 'doctor', 'cashier', 'lab', 'storekeeper'));

-- ---------------------------------------------------------------- items
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'consumable' CHECK (category IN ('medicine', 'consumable', 'reagent', 'instrument', 'other')),
  ADD COLUMN IF NOT EXISTS drug_id uuid REFERENCES drugs(id),
  ADD COLUMN IF NOT EXISTS storage text NOT NULL DEFAULT 'room' CHECK (storage IN ('room', 'fridge', 'freezer')),
  ADD COLUMN IF NOT EXISTS controlled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purchase_price bigint NOT NULL DEFAULT 0 CHECK (purchase_price >= 0);

-- per-tenant document numbers (receipt, request, write-off act, count): an UPSERT … RETURNING is race-free
CREATE TABLE inventory_doc_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('receipt', 'request', 'writeoff', 'count', 'issue')),
  last integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, kind)
);

-- ---------------------------------------------------------------- receipts (kirim)
CREATE TABLE inventory_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  number integer NOT NULL,
  supplier text NOT NULL,
  invoice_no text NOT NULL,
  invoice_date date NOT NULL,
  note text,
  total bigint NOT NULL CHECK (total >= 0),
  received_by uuid,
  received_by_name text NOT NULL,
  received_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
CREATE INDEX inventory_receipts_list ON inventory_receipts (tenant_id, received_at DESC);

-- ---------------------------------------------------------------- batches (partiya)
CREATE TABLE inventory_batches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL,
  batch_no text,                    -- series printed on the pack; NULL = opening balance / consumable without a series
  expiry_date date,                 -- NULL = no shelf life (instruments, some consumables)
  qty numeric(12,2) NOT NULL CHECK (qty >= 0),
  received_qty numeric(12,2) NOT NULL CHECK (received_qty >= 0),
  unit_cost bigint NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  supplier text,
  invoice_no text,
  receipt_id uuid,
  received_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES inventory_receipts(tenant_id, id)
);
CREATE INDEX inventory_batches_fefo ON inventory_batches (item_id, expiry_date NULLS LAST, received_at) WHERE qty > 0;
CREATE INDEX inventory_batches_expiry ON inventory_batches (tenant_id, expiry_date) WHERE qty > 0 AND expiry_date IS NOT NULL;

-- only the balance of a batch ever changes; a batch is never deleted
CREATE FUNCTION inventory_batch_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'inventory batches are never deleted' USING ERRCODE = 'P0001'; END IF;
  IF (NEW.tenant_id, NEW.item_id, NEW.batch_no, NEW.expiry_date, NEW.received_qty, NEW.unit_cost, NEW.supplier, NEW.invoice_no, NEW.receipt_id, NEW.received_at)
     IS DISTINCT FROM (OLD.tenant_id, OLD.item_id, OLD.batch_no, OLD.expiry_date, OLD.received_qty, OLD.unit_cost, OLD.supplier, OLD.invoice_no, OLD.receipt_id, OLD.received_at) THEN
    RAISE EXCEPTION 'only the balance of a batch may change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_batches_guard BEFORE UPDATE OR DELETE ON inventory_batches FOR EACH ROW EXECUTE FUNCTION inventory_batch_guard();

-- ---------------------------------------------------------------- requests (talabnoma)
CREATE TABLE inventory_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  number integer NOT NULL,
  requester_membership_id uuid NOT NULL,
  requester_name text NOT NULL,
  requester_role text NOT NULL,
  department text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('patient', 'procedure', 'department')),
  patient_id uuid,
  encounter_id uuid,
  order_id uuid,
  icd_codes text[] NOT NULL DEFAULT '{}',
  note text,
  direct boolean NOT NULL DEFAULT false,          -- issued straight away by the storekeeper (emergency), same mandatory fields
  status text NOT NULL CHECK (status IN ('draft', 'submitted', 'partially_issued', 'issued', 'rejected', 'cancelled')),
  needs_approval boolean NOT NULL DEFAULT false, -- has a controlled item: the manager signs before it is issued
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL,
  submitted_at timestamptz,
  closed_at timestamptz,
  closed_by_name text,
  reject_reason text,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, requester_membership_id) REFERENCES memberships(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES service_orders(tenant_id, id),
  CHECK (purpose <> 'patient' OR (patient_id IS NOT NULL AND encounter_id IS NOT NULL AND cardinality(icd_codes) > 0)),
  CHECK (purpose <> 'procedure' OR (patient_id IS NOT NULL AND order_id IS NOT NULL AND cardinality(icd_codes) > 0)),
  CHECK (purpose <> 'department' OR (patient_id IS NULL AND encounter_id IS NULL AND order_id IS NULL))
);
CREATE INDEX inventory_requests_queue ON inventory_requests (tenant_id, branch_id, status, created_at DESC);
CREATE INDEX inventory_requests_mine ON inventory_requests (requester_membership_id, created_at DESC);
CREATE INDEX inventory_requests_encounter ON inventory_requests (encounter_id) WHERE encounter_id IS NOT NULL;

CREATE TABLE inventory_request_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL,
  item_id uuid NOT NULL,
  qty numeric(12,2) NOT NULL CHECK (qty > 0),
  issued_qty numeric(12,2) NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  UNIQUE (request_id, item_id),
  FOREIGN KEY (tenant_id, request_id) REFERENCES inventory_requests(tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory_items(tenant_id, id)
);

-- ---------------------------------------------------------------- write-off acts (spisaniye)
CREATE TABLE inventory_writeoffs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  number integer NOT NULL,
  reason text NOT NULL CHECK (reason IN ('expired', 'damaged', 'lost', 'other')),
  note text NOT NULL,
  commission text[] NOT NULL CHECK (cardinality(commission) BETWEEN 3 AND 5),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  controlled boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  total bigint NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  -- two signatures: whoever drew up the act never approves it
  CHECK (decided_by IS NULL OR decided_by <> created_by)
);
CREATE INDEX inventory_writeoffs_list ON inventory_writeoffs (tenant_id, created_at DESC);

CREATE TABLE inventory_writeoff_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  writeoff_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  qty numeric(12,2) NOT NULL CHECK (qty > 0),
  UNIQUE (writeoff_id, batch_id),
  FOREIGN KEY (tenant_id, writeoff_id) REFERENCES inventory_writeoffs(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory_batches(tenant_id, id)
);

-- ---------------------------------------------------------------- inventory counts (inventarizatsiya)
CREATE TABLE inventory_counts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  number integer NOT NULL,
  scope text NOT NULL CHECK (scope IN ('all', 'controlled')),
  status text NOT NULL CHECK (status IN ('open', 'submitted', 'approved', 'cancelled')),
  commission text[] NOT NULL DEFAULT '{}',
  started_by uuid NOT NULL,
  started_by_name text NOT NULL,
  started_at timestamptz NOT NULL,
  submitted_at timestamptz,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
-- one open count per branch at a time
CREATE UNIQUE INDEX inventory_counts_one_open ON inventory_counts (tenant_id, branch_id) WHERE status IN ('open', 'submitted');

CREATE TABLE inventory_count_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  count_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  expected_qty numeric(12,2) NOT NULL CHECK (expected_qty >= 0),
  counted_qty numeric(12,2) CHECK (counted_qty >= 0),
  reason text,
  UNIQUE (count_id, batch_id),
  FOREIGN KEY (tenant_id, count_id) REFERENCES inventory_counts(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory_batches(tenant_id, id)
);

-- ---------------------------------------------------------------- the ledger
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS seq bigserial,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'legacy' CHECK (kind IN ('legacy', 'receipt', 'issue', 'return', 'writeoff', 'adjust', 'void')),
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS branch_id uuid,
  ADD COLUMN IF NOT EXISTS actor_membership_id uuid,
  ADD COLUMN IF NOT EXISTS receiver_membership_id uuid,
  ADD COLUMN IF NOT EXISTS receiver_name text,
  ADD COLUMN IF NOT EXISTS purpose text CHECK (purpose IS NULL OR purpose IN ('patient', 'procedure', 'department')),
  ADD COLUMN IF NOT EXISTS patient_id uuid,
  ADD COLUMN IF NOT EXISTS encounter_id uuid,
  ADD COLUMN IF NOT EXISTS order_id uuid,
  ADD COLUMN IF NOT EXISTS icd_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS request_id uuid,
  ADD COLUMN IF NOT EXISTS receipt_id uuid,
  ADD COLUMN IF NOT EXISTS writeoff_id uuid,
  ADD COLUMN IF NOT EXISTS count_id uuid,
  ADD COLUMN IF NOT EXISTS return_of uuid,
  ADD COLUMN IF NOT EXISTS void_of uuid,
  ADD COLUMN IF NOT EXISTS unit_cost bigint NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  ADD COLUMN IF NOT EXISTS value bigint NOT NULL DEFAULT 0 CHECK (value >= 0),   -- round(quantity × unit_cost), integer tiyin
  ADD COLUMN IF NOT EXISTS doc_no text,
  ADD COLUMN IF NOT EXISTS second_signer_membership_id uuid,
  ADD COLUMN IF NOT EXISTS second_signer_name text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by_name text,
  ADD COLUMN IF NOT EXISTS void_reason text;

-- the branch of old rows comes from their item
UPDATE inventory_movements m SET branch_id = i.branch_id FROM inventory_items i WHERE i.id = m.item_id AND m.branch_id IS NULL;

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_batch_fk FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory_batches(tenant_id, id),
  ADD CONSTRAINT inventory_movements_patient_fk FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  ADD CONSTRAINT inventory_movements_encounter_fk FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id),
  ADD CONSTRAINT inventory_movements_order_fk FOREIGN KEY (tenant_id, order_id) REFERENCES service_orders(tenant_id, id),
  ADD CONSTRAINT inventory_movements_request_fk FOREIGN KEY (tenant_id, request_id) REFERENCES inventory_requests(tenant_id, id),
  -- every new movement names its batch; an issue says who took it and for what; a patient issue carries the visit's ICD-10 codes
  ADD CONSTRAINT inventory_movements_batch_required CHECK (kind = 'legacy' OR batch_id IS NOT NULL),
  ADD CONSTRAINT inventory_movements_issue_who CHECK (kind NOT IN ('issue', 'return') OR (receiver_membership_id IS NOT NULL AND purpose IS NOT NULL)),
  ADD CONSTRAINT inventory_movements_issue_patient CHECK (purpose IS DISTINCT FROM 'patient' OR (patient_id IS NOT NULL AND encounter_id IS NOT NULL AND cardinality(icd_codes) > 0)),
  ADD CONSTRAINT inventory_movements_issue_procedure CHECK (purpose IS DISTINCT FROM 'procedure' OR (patient_id IS NOT NULL AND order_id IS NOT NULL)),
  ADD CONSTRAINT inventory_movements_issue_department CHECK (purpose IS DISTINCT FROM 'department' OR department IS NOT NULL),
  ADD CONSTRAINT inventory_movements_type_kind CHECK (
    (kind IN ('receipt', 'return') AND type = 'in') OR (kind IN ('issue', 'writeoff') AND type = 'out') OR kind IN ('legacy', 'adjust', 'void'));

CREATE INDEX IF NOT EXISTS inventory_movements_item ON inventory_movements (item_id, seq DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_period ON inventory_movements (tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS inventory_movements_patient ON inventory_movements (patient_id, occurred_at) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_movements_encounter ON inventory_movements (encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_movements_request ON inventory_movements (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_movements_return ON inventory_movements (return_of) WHERE return_of IS NOT NULL;

-- the ledger is append-only: a mistake is voided once (with a reason) and corrected by a new row
CREATE FUNCTION inventory_movement_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'inventory movements are append-only' USING ERRCODE = 'P0001'; END IF;
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR NEW.void_reason IS NULL OR NEW.voided_by_name IS NULL
     OR (to_jsonb(NEW) - ARRAY['voided_at', 'voided_by_name', 'void_reason']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['voided_at', 'voided_by_name', 'void_reason']) THEN
    RAISE EXCEPTION 'inventory movements are append-only (void only)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION inventory_movement_guard();

-- existing stock becomes one opening batch per item (no series, no expiry), so Σ batches = the old balance
INSERT INTO inventory_batches (id, tenant_id, item_id, batch_no, expiry_date, qty, received_qty, unit_cost, received_at)
SELECT gen_random_uuid(), i.tenant_id, i.id, NULL, NULL, q.qty, q.qty, 0, now()
  FROM inventory_items i
  CROSS JOIN LATERAL (SELECT GREATEST(i.opening_qty + coalesce((SELECT sum(CASE WHEN m.type = 'in' THEN m.quantity ELSE -m.quantity END) FROM inventory_movements m WHERE m.item_id = i.id), 0), 0) AS qty) q
 WHERE NOT EXISTS (SELECT 1 FROM inventory_batches b WHERE b.item_id = i.id);

-- ---------------------------------------------------------------- fridge temperature log (cold chain)
CREATE TABLE fridge_temperature_log (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  fridge text NOT NULL,
  recorded_at timestamptz NOT NULL,
  temperature numeric(4,1) NOT NULL CHECK (temperature BETWEEN -40 AND 40),
  min_allowed numeric(4,1) NOT NULL DEFAULT 2,
  max_allowed numeric(4,1) NOT NULL DEFAULT 8,
  out_of_range boolean GENERATED ALWAYS AS (temperature < min_allowed OR temperature > max_allowed) STORED,
  recorded_by uuid,
  recorded_by_name text NOT NULL,
  note text,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
CREATE INDEX fridge_temperature_log_list ON fridge_temperature_log (tenant_id, branch_id, recorded_at DESC);
CREATE FUNCTION forbid_change_fridge_log() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'fridge temperature log is append-only' USING ERRCODE = 'P0001'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fridge_temperature_log_append_only BEFORE UPDATE OR DELETE ON fridge_temperature_log FOR EACH ROW EXECUTE FUNCTION forbid_change_fridge_log();
