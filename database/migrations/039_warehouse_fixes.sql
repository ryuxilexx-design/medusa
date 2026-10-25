-- 039: warehouse audit fixes (docs/WAREHOUSE.md, «Audit 2026-10-25»).
--   * cold-chain devices: each fridge / freezer / room thermometer has its own allowed range; the log names a device
--     (existing free-text names become devices of the «fridge» kind, +2…+8 °C) and keeps the range it was checked against;
--     an out-of-range reading needs the action taken (CHECK, new rows only);
--   * receipts: Idempotency-Key (a retried «save» returns the first document);
--   * the warehouse AI brief is cached per day and rate-limited like the manager digest (ai_digest_runs.kind).

-- ---------------------------------------------------------------- cold-chain devices
CREATE TABLE cold_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('fridge', 'freezer', 'room')),
  min_temp numeric(4,1) NOT NULL,
  max_temp numeric(4,1) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CHECK (min_temp < max_temp AND min_temp >= -40 AND max_temp <= 40)
);
CREATE UNIQUE INDEX cold_devices_name ON cold_devices (tenant_id, branch_id, lower(name));

INSERT INTO cold_devices (tenant_id, branch_id, name, kind, min_temp, max_temp, created_at)
SELECT tenant_id, branch_id, min(fridge), 'fridge', 2, 8, min(recorded_at)
  FROM fridge_temperature_log GROUP BY tenant_id, branch_id, lower(fridge);

ALTER TABLE fridge_temperature_log ADD COLUMN device_id uuid;
-- the log is append-only: the one-time backfill of the device link runs with its guard switched off
ALTER TABLE fridge_temperature_log DISABLE TRIGGER fridge_temperature_log_append_only;
UPDATE fridge_temperature_log f SET device_id = d.id
  FROM cold_devices d WHERE d.tenant_id = f.tenant_id AND d.branch_id = f.branch_id AND lower(d.name) = lower(f.fridge);
ALTER TABLE fridge_temperature_log ENABLE TRIGGER fridge_temperature_log_append_only;
ALTER TABLE fridge_temperature_log ALTER COLUMN device_id SET NOT NULL,
  ADD CONSTRAINT fridge_temperature_log_device_fk FOREIGN KEY (tenant_id, device_id) REFERENCES cold_devices(tenant_id, id),
  -- a reading outside the device's range says what was done (older rows are kept as they are)
  ADD CONSTRAINT fridge_temperature_log_action CHECK (
    NOT (temperature < min_allowed OR temperature > max_allowed) OR coalesce(length(btrim(note)), 0) >= 3) NOT VALID;
CREATE INDEX fridge_temperature_log_device ON fridge_temperature_log (device_id, recorded_at DESC);

-- ---------------------------------------------------------------- receipts: a retried save is one document
ALTER TABLE inventory_receipts ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX inventory_receipts_idem ON inventory_receipts (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- duplicate supplier invoices are looked up by the normalised supplier + invoice number + date
CREATE INDEX inventory_receipts_invoice ON inventory_receipts (tenant_id, lower(btrim(supplier)), lower(btrim(invoice_no)), invoice_date);

-- ---------------------------------------------------------------- AI runs of the warehouse brief (5 a day per clinic)
ALTER TABLE ai_digest_runs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'digest' CHECK (kind IN ('digest', 'warehouse_brief'));
DROP INDEX IF EXISTS ai_digest_runs_day;
CREATE INDEX ai_digest_runs_day ON ai_digest_runs (tenant_id, kind, created_at);

-- open requests per item (reorder suggestion: quantities already promised to requesters)
CREATE INDEX IF NOT EXISTS inventory_request_lines_item ON inventory_request_lines (item_id) WHERE issued_qty < qty;
