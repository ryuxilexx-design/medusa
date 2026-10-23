-- Cash audit 2026-10-22: quantity on orders, per-line refunds, patient deposits (prepayments), debtor promises.

-- ---------- quantity > 1 (e.g. a course of 10 injections): the order keeps the unit price, the line carries qty × price
ALTER TABLE service_orders ADD COLUMN quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 50);

-- ---------- per-line refunds: a refund may name one line; that line's net drops by exactly that amount.
-- invoices.line_refunded_amount = Σ invoice_items.refunded_amount (the part of credit_amount attributed to lines);
-- the rest of credit_amount is still spread proportionally over the lines (see NET_LINE in billing.ts).
ALTER TABLE invoice_items ADD COLUMN refunded_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0);
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_refund_within_line CHECK (refunded_amount <= line_total);
ALTER TABLE invoices ADD COLUMN line_refunded_amount bigint NOT NULL DEFAULT 0 CHECK (line_refunded_amount >= 0);
ALTER TABLE invoices ADD CONSTRAINT invoices_line_refund_within_credit CHECK (line_refunded_amount <= credit_amount);
ALTER TABLE refunds ADD COLUMN order_id uuid;
ALTER TABLE refunds ADD CONSTRAINT refunds_order_fk FOREIGN KEY (tenant_id, order_id) REFERENCES service_orders(tenant_id, id);

-- ---------- debtors: a promised payment date and a note on an open invoice (the only mutable fields of a debt)
ALTER TABLE invoices ADD COLUMN promise_date date, ADD COLUMN promise_note text CHECK (promise_note IS NULL OR length(promise_note) <= 300);
CREATE INDEX invoices_debt ON invoices (tenant_id, branch_id, created_at) WHERE status IN ('unpaid', 'partially_paid');

-- ---------- patient deposits (prepayments): an append-only ledger.
--   in    — money taken by a cashier in an open shift (cash goes into that drawer; card/transfer only recorded)
--   apply — part of the balance used as a payment on an invoice (payment method 'deposit'; no cash moves)
--   out   — unused balance returned by the manager (cash leaves an open drawer)
-- Balance = Σ in − Σ apply − Σ out, never negative. Deposits are a liability until applied: revenue stays cash basis
-- of payments (which include the applied amounts), so money counts once — when it is applied, not when it comes in.
CREATE TABLE patient_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('in', 'apply', 'out')),
  amount bigint NOT NULL CHECK (amount > 0),
  method text CHECK (method IN ('cash', 'card', 'transfer')),
  shift_id uuid,
  invoice_id uuid,
  payment_id uuid REFERENCES payments(id),
  note text CHECK (note IS NULL OR length(note) <= 300),
  actor_membership_id uuid,
  actor_name text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT demo_now(),
  idempotency_key text,
  CHECK (kind <> 'apply' OR (invoice_id IS NOT NULL AND payment_id IS NOT NULL AND method IS NULL)),
  CHECK (kind = 'apply' OR method IS NOT NULL),
  CHECK (kind = 'apply' OR method <> 'cash' OR shift_id IS NOT NULL), -- cash comes from / goes into a real drawer
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES cash_shifts(tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id)
);
CREATE INDEX patient_deposits_patient ON patient_deposits (patient_id, occurred_at DESC);
CREATE INDEX patient_deposits_time ON patient_deposits (tenant_id, branch_id, occurred_at);
CREATE INDEX patient_deposits_shift ON patient_deposits (shift_id) WHERE shift_id IS NOT NULL;
CREATE TRIGGER patient_deposits_append_only BEFORE UPDATE OR DELETE ON patient_deposits FOR EACH ROW EXECUTE FUNCTION forbid_payment_change();

-- The balance never goes below zero even if an application forgets the patient lock (the API locks the patient row
-- FOR UPDATE before it reads the balance, so two concurrent applications of the same money serialize).
CREATE FUNCTION patient_deposit_guard() RETURNS trigger AS $$
DECLARE bal bigint;
BEGIN
  IF NEW.kind = 'in' THEN RETURN NEW; END IF;
  SELECT coalesce(sum(CASE WHEN kind = 'in' THEN amount ELSE -amount END), 0) INTO bal FROM patient_deposits WHERE patient_id = NEW.patient_id;
  IF bal < NEW.amount THEN RAISE EXCEPTION 'deposit balance would go negative' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER patient_deposits_balance BEFORE INSERT ON patient_deposits FOR EACH ROW EXECUTE FUNCTION patient_deposit_guard();

CREATE VIEW patient_deposit_balances AS
  SELECT tenant_id, patient_id, sum(CASE WHEN kind = 'in' THEN amount ELSE -amount END)::bigint AS balance
    FROM patient_deposits GROUP BY tenant_id, patient_id;

-- a payment may now be covered from the patient's deposit (no cash moves, no shift)
ALTER TABLE payments DROP CONSTRAINT payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('cash', 'card', 'transfer', 'deposit'));
