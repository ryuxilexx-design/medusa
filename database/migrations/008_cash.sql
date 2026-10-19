-- Cash desk: cashier shifts, refunds, expense entry.
-- Money stays integer tiyin; every movement is append-only and reconciles per shift:
--   expected cash = opening cash + cash payments − cash refunds − cash expenses (all within the shift).

ALTER TABLE tenants ADD COLUMN shift_seq integer NOT NULL DEFAULT 0, ADD COLUMN refund_seq integer NOT NULL DEFAULT 0;

CREATE TABLE cash_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  cashier_membership_id uuid NOT NULL,
  cashier_name text NOT NULL,
  number integer NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at timestamptz NOT NULL DEFAULT demo_now(),
  opening_cash bigint NOT NULL CHECK (opening_cash >= 0),
  closed_at timestamptz,
  expected_cash bigint,
  counted_cash bigint CHECK (counted_cash >= 0),
  difference bigint,
  totals jsonb,                       -- snapshot at close (by method, refunds, expenses, counts)
  close_note text,
  closed_by_name text,
  CHECK (status = 'open' OR (closed_at IS NOT NULL AND expected_cash IS NOT NULL AND counted_cash IS NOT NULL AND difference = counted_cash - expected_cash)),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
-- one drawer at a time per cashier
CREATE UNIQUE INDEX cash_shifts_one_open ON cash_shifts (cashier_membership_id) WHERE status = 'open';
CREATE INDEX cash_shifts_branch ON cash_shifts (tenant_id, branch_id, opened_at DESC);

CREATE FUNCTION cash_shift_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'closed' THEN
    RAISE EXCEPTION 'closed cash shift is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.opening_cash <> OLD.opening_cash OR NEW.opened_at <> OLD.opened_at OR NEW.cashier_membership_id <> OLD.cashier_membership_id OR NEW.branch_id <> OLD.branch_id THEN
    RAISE EXCEPTION 'cash shift opening data is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER cash_shifts_immutable BEFORE UPDATE OR DELETE ON cash_shifts FOR EACH ROW EXECUTE FUNCTION cash_shift_guard();

-- payments now belong to the shift they were taken in (older seed payments have none)
ALTER TABLE payments ADD COLUMN shift_id uuid;
ALTER TABLE payments ADD CONSTRAINT payments_shift_fk FOREIGN KEY (tenant_id, shift_id) REFERENCES cash_shifts(tenant_id, id);
CREATE INDEX payments_shift ON payments (shift_id) WHERE shift_id IS NOT NULL;

-- Refund = money back to the patient for a service not (fully) provided. The invoice is reduced by the same
-- amount (credit) and the net paid amount goes down, so no debt appears. paid_amount is net of refunds.
ALTER TABLE invoices
  ADD COLUMN credit_amount bigint NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  ADD COLUMN refunded_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0);
ALTER TABLE invoices DROP CONSTRAINT invoices_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_total_formula CHECK (total = subtotal - discount_amount - credit_amount);
ALTER TABLE invoices DROP CONSTRAINT invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'refunded', 'void'));

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  payment_id uuid NOT NULL REFERENCES payments(id),
  refund_number integer NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash', 'card', 'transfer')),
  reason_code text NOT NULL CHECK (reason_code IN ('service_not_provided', 'appointment_cancelled', 'patient_complaint', 'other')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  shift_id uuid,
  approved_by uuid,
  approved_by_name text NOT NULL,
  refunded_at timestamptz NOT NULL DEFAULT demo_now(),
  idempotency_key text NOT NULL,
  CHECK (method <> 'cash' OR shift_id IS NOT NULL),   -- cash leaves a real drawer
  UNIQUE (tenant_id, refund_number),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES cash_shifts(tenant_id, id)
);
CREATE INDEX refunds_time ON refunds (tenant_id, refunded_at);
CREATE INDEX refunds_payment ON refunds (payment_id);
CREATE TRIGGER refunds_append_only BEFORE UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION forbid_payment_change();

-- Expenses: entered in the app; cash taken from a drawer belongs to that shift. Correction = void with a reason.
ALTER TABLE expenses ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE expenses
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  ADD COLUMN paid_from text NOT NULL DEFAULT 'bank' CHECK (paid_from IN ('cash_drawer', 'bank', 'card', 'other')),
  ADD COLUMN shift_id uuid,
  ADD COLUMN created_by_name text,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT demo_now(),
  ADD COLUMN void_reason text,
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_by_name text;
ALTER TABLE expenses ADD CONSTRAINT expenses_drawer_shift CHECK (paid_from <> 'cash_drawer' OR shift_id IS NOT NULL);
ALTER TABLE expenses ADD CONSTRAINT expenses_void_reason CHECK (status = 'active' OR (void_reason IS NOT NULL AND voided_at IS NOT NULL));
ALTER TABLE expenses ADD CONSTRAINT expenses_shift_fk FOREIGN KEY (tenant_id, shift_id) REFERENCES cash_shifts(tenant_id, id);

CREATE FUNCTION expense_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'expenses cannot be deleted' USING ERRCODE = 'P0001'; END IF;
  IF OLD.status = 'void' OR NEW.status <> 'void' OR NEW.amount <> OLD.amount OR NEW.category <> OLD.category
     OR NEW.occurred_at <> OLD.occurred_at OR NEW.paid_from <> OLD.paid_from OR NEW.shift_id IS DISTINCT FROM OLD.shift_id THEN
    RAISE EXCEPTION 'expense is immutable (void it with a reason)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER expenses_immutable BEFORE UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION expense_guard();
