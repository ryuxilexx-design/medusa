-- Fiscalisation (online cash register / ОФД) foundation.
-- Uzbekistan: every patient payment goes through a certified cash register with an IKPU code per item, a VAT
-- flag and a QR code on the receipt. Med.uz.ai has no provider integration yet: the first clinic runs in
-- PARALLEL mode — the certified KKM prints the fiscal receipt and the cashier records its number here
-- (provider «manual»). The demo clinics skip fiscalisation (provider «none»). A real provider plugs in later
-- as another provider name without schema changes: one fiscal_receipts row per payment / refund.

-- Catalogue: fiscal attributes of a service. NULL vat_percent = the clinic default (12 %); vat_exempt = «без НДС».
ALTER TABLE services
  ADD COLUMN ikpu_code text CHECK (ikpu_code IS NULL OR ikpu_code ~ '^[0-9]{17}$'),
  ADD COLUMN vat_percent integer CHECK (vat_percent IS NULL OR vat_percent BETWEEN 0 AND 100),
  ADD COLUMN vat_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN package_code text CHECK (package_code IS NULL OR length(package_code) BETWEEN 1 AND 40);

-- Per-clinic provider override; NULL = the deployment default (FISCAL_PROVIDER: manual in production, none in demo).
ALTER TABLE tenants ADD COLUMN fiscal_provider text CHECK (fiscal_provider IS NULL OR length(fiscal_provider) BETWEEN 1 AND 40);

CREATE TABLE fiscal_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('sale', 'refund')),
  payment_id uuid REFERENCES payments(id),
  refund_id uuid REFERENCES refunds(id),
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
  status text NOT NULL CHECK (status IN ('pending', 'issued', 'failed', 'skipped')),
  receipt_number text CHECK (receipt_number IS NULL OR length(receipt_number) BETWEEN 1 AND 60),
  fiscal_sign text CHECK (fiscal_sign IS NULL OR length(fiscal_sign) BETWEEN 1 AND 80),
  qr_url text CHECK (qr_url IS NULL OR length(qr_url) BETWEEN 1 AND 500),
  terminal_id text CHECK (terminal_id IS NULL OR length(terminal_id) BETWEEN 1 AND 60),
  issued_at timestamptz,
  entered_by_name text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  CHECK ((kind = 'sale' AND payment_id IS NOT NULL AND refund_id IS NULL) OR (kind = 'refund' AND refund_id IS NOT NULL AND payment_id IS NULL)),
  CHECK (status <> 'issued' OR (receipt_number IS NOT NULL AND issued_at IS NOT NULL))
);
-- exactly one fiscal row per payment and per refund
CREATE UNIQUE INDEX fiscal_receipts_payment ON fiscal_receipts (payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX fiscal_receipts_refund ON fiscal_receipts (refund_id) WHERE refund_id IS NOT NULL;
-- the worker and the «receipt missing» lists read only open rows
CREATE INDEX fiscal_receipts_open ON fiscal_receipts (tenant_id, created_at) WHERE status IN ('pending', 'failed');

-- Append-only: a row is never deleted; an issued or skipped receipt never changes. A pending/failed row may
-- only move to issued/failed/pending (retry) and only its receipt fields may be written.
CREATE FUNCTION fiscal_receipt_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'fiscal receipts are append-only' USING ERRCODE = 'P0001'; END IF;
  IF OLD.status IN ('issued', 'skipped') THEN RAISE EXCEPTION 'issued fiscal receipt is immutable' USING ERRCODE = 'P0001'; END IF;
  IF NEW.status NOT IN ('issued', 'failed', 'pending') THEN RAISE EXCEPTION 'fiscal receipt: invalid status change' USING ERRCODE = 'P0001'; END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.refund_id IS DISTINCT FROM OLD.refund_id OR NEW.provider <> OLD.provider OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'fiscal receipt identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fiscal_receipts_guard BEFORE UPDATE OR DELETE ON fiscal_receipts FOR EACH ROW EXECUTE FUNCTION fiscal_receipt_guard();
