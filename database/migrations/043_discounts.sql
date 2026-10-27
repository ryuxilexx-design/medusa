-- Discount rules, benefit categories («Категория льгот»), corporate payers («Компания», «Страхование») and their
-- payments. docs/DISCOUNTS_COMPANIES.md. Money stays integer tiyin; percents are numeric(5,2) 0–100.
--
-- Money model (unchanged formulas, new inputs):
--   invoice_items.line_subtotal = qty × unit price (gross); discount_share = this line's discount (the snapshot);
--   line_total = line_subtotal − discount_share (net of discount); NET_LINE subtracts refunds on top of it.
--   invoices.total = subtotal − discount_amount − credit_amount, as before.
--   A company split: company_share_amount of the total is the company's receivable, the rest is the patient's.
--   paid_amount = every payment on the bill (patient and company) net of refunds, company_paid_amount = the company part.
--   Patient debt = total − company_share − (paid − company_paid); company receivable = company_share − company_paid.

-- ---------- discount rules ----------
CREATE TABLE discount_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  kind text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  -- percent: 0.01–100 of each line in scope; fixed: tiyin off each line in scope (never more than the line)
  percent numeric(5,2),
  amount bigint,
  -- the most a registrar or cashier may give with this rule (same unit as the rule); above it only the manager, with a reason
  staff_max_percent numeric(5,2),
  staff_max_amount bigint,
  scope text NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'categories', 'services')),
  categories text[] NOT NULL DEFAULT '{}',
  service_ids uuid[] NOT NULL DEFAULT '{}',
  valid_from date,
  valid_to date,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR (percent > 0 AND percent <= 100 AND amount IS NULL AND staff_max_percent BETWEEN 0 AND 100 AND staff_max_amount IS NULL)),
  CHECK (kind <> 'fixed' OR (amount > 0 AND percent IS NULL AND staff_max_amount >= 0 AND staff_max_percent IS NULL)),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from),
  CHECK (scope <> 'categories' OR cardinality(categories) > 0),
  CHECK (scope <> 'services' OR cardinality(service_ids) > 0),
  CHECK (categories <@ ARRAY['consultation', 'lab', 'ultrasound', 'procedure']::text[]),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX discount_rules_name ON discount_rules (tenant_id, lower(name));

-- ---------- benefit categories (nogironlar, pensionerlar, ko‘p bolali …) ----------
CREATE TABLE benefit_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  discount_rule_id uuid,
  -- the card must name the paper that proves it (e.g. «guvohnoma raqami»): text only, never a passport or PINFL
  requires_document boolean NOT NULL DEFAULT false,
  document_label text CHECK (document_label IS NULL OR length(document_label) <= 60),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, discount_rule_id) REFERENCES discount_rules(tenant_id, id)
);
CREATE UNIQUE INDEX benefit_categories_name ON benefit_categories (tenant_id, lower(name));

-- ---------- companies: employers, insurers ----------
ALTER TABLE tenants ADD COLUMN company_payment_seq integer NOT NULL DEFAULT 0;
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  kind text NOT NULL CHECK (kind IN ('employer', 'insurance', 'other')),
  inn text CHECK (inn IS NULL OR inn ~ '^[0-9]{9}$'),
  contract_number text CHECK (contract_number IS NULL OR length(contract_number) <= 60),
  contract_date date,
  contact_name text CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  contact_phone text,
  note text CHECK (note IS NULL OR length(note) <= 500),
  discount_rule_id uuid,
  -- what the company pays of the lines it covers (100 = all), and which service categories it covers ('{}' = all)
  coverage_percent numeric(5,2) NOT NULL DEFAULT 100 CHECK (coverage_percent > 0 AND coverage_percent <= 100),
  coverage_categories text[] NOT NULL DEFAULT '{}' CHECK (coverage_categories <@ ARRAY['consultation', 'lab', 'ultrasound', 'procedure']::text[]),
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
  -- the most the company may owe at once (tiyin); 0 = no limit
  credit_limit bigint NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, discount_rule_id) REFERENCES discount_rules(tenant_id, id)
);
CREATE UNIQUE INDEX companies_name ON companies (tenant_id, lower(name));
CREATE UNIQUE INDEX companies_inn ON companies (tenant_id, inn) WHERE inn IS NOT NULL;

-- ---------- the patient card ----------
ALTER TABLE patients ADD COLUMN benefit_category_id uuid,
  ADD COLUMN benefit_note text CHECK (benefit_note IS NULL OR length(benefit_note) <= 120),
  ADD COLUMN company_id uuid,
  ADD COLUMN company_member_no text CHECK (company_member_no IS NULL OR length(company_member_no) <= 60);
ALTER TABLE patients ADD CONSTRAINT patients_benefit_fk FOREIGN KEY (tenant_id, benefit_category_id) REFERENCES benefit_categories(tenant_id, id);
ALTER TABLE patients ADD CONSTRAINT patients_company_fk FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id);
CREATE INDEX patients_company ON patients (company_id) WHERE company_id IS NOT NULL;

-- ---------- the invoice: the discount that was applied, and the company split ----------
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_discount_within_line CHECK (discount_share <= line_subtotal);
ALTER TABLE invoices
  -- a rule applied per line (NULL = none, or the manager's older invoice-level discount in discount_type/discount_value)
  ADD COLUMN discount_rule_id uuid,
  ADD COLUMN discount_rule_name text,
  ADD COLUMN discount_kind text CHECK (discount_kind IN ('percent', 'fixed')),
  ADD COLUMN discount_rule_value numeric(14,2),
  -- which lines: {"scope":"all"|"categories"|"services","categories":[…],"service_ids":[…],"order_ids":[…]|null}
  ADD COLUMN discount_scope jsonb,
  ADD COLUMN discount_source text CHECK (discount_source IN ('manual', 'rule', 'benefit', 'company')),
  ADD COLUMN discount_benefit_category_id uuid,
  ADD COLUMN discount_granted_by uuid,
  ADD COLUMN discount_granted_by_name text,
  ADD COLUMN discount_granted_at timestamptz,
  ADD COLUMN discount_over_limit boolean NOT NULL DEFAULT false,
  ADD COLUMN company_id uuid,
  ADD COLUMN company_percent numeric(5,2) CHECK (company_percent IS NULL OR (company_percent > 0 AND company_percent <= 100)),
  ADD COLUMN company_member_no text,
  ADD COLUMN company_share_amount bigint NOT NULL DEFAULT 0 CHECK (company_share_amount >= 0),
  ADD COLUMN company_paid_amount bigint NOT NULL DEFAULT 0 CHECK (company_paid_amount >= 0),
  ADD COLUMN company_set_by_name text;
ALTER TABLE invoices ADD CONSTRAINT invoices_discount_rule_fk FOREIGN KEY (tenant_id, discount_rule_id) REFERENCES discount_rules(tenant_id, id);
ALTER TABLE invoices ADD CONSTRAINT invoices_benefit_fk FOREIGN KEY (tenant_id, discount_benefit_category_id) REFERENCES benefit_categories(tenant_id, id);
ALTER TABLE invoices ADD CONSTRAINT invoices_company_fk FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id);
ALTER TABLE invoices ADD CONSTRAINT invoices_company_split CHECK (
  (company_id IS NOT NULL OR (company_share_amount = 0 AND company_paid_amount = 0))
  AND company_share_amount <= total AND company_paid_amount <= company_share_amount AND company_paid_amount <= paid_amount);
CREATE INDEX invoices_company ON invoices (company_id, created_at) WHERE company_id IS NOT NULL;
CREATE INDEX invoices_discounted ON invoices (tenant_id, created_at) WHERE discount_amount > 0;

-- the line discount is a snapshot: once money moved on the bill it never changes (a refund is the way back)
CREATE FUNCTION invoice_item_discount_frozen() RETURNS trigger AS $$
BEGIN
  IF (NEW.discount_share IS DISTINCT FROM OLD.discount_share OR NEW.line_total IS DISTINCT FROM OLD.line_total OR NEW.line_subtotal IS DISTINCT FROM OLD.line_subtotal)
     AND (EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = OLD.invoice_id)
          OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = OLD.invoice_id AND (i.paid_amount > 0 OR i.credit_amount > 0))) THEN
    RAISE EXCEPTION 'invoice line amounts are frozen after a payment' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER invoice_items_discount_frozen BEFORE UPDATE ON invoice_items FOR EACH ROW EXECUTE FUNCTION invoice_item_discount_frozen();

-- ---------- company payments (bank transfers) and their allocation to bills ----------
CREATE TABLE company_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  company_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  amount bigint NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'transfer' CHECK (method IN ('transfer')),
  document_number text CHECK (document_number IS NULL OR length(document_number) <= 60),
  document_date date,
  note text CHECK (note IS NULL OR length(note) <= 300),
  received_at timestamptz NOT NULL DEFAULT demo_now(),
  created_by uuid,
  created_by_name text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  void_reason text,
  voided_at timestamptz,
  voided_by_name text,
  CHECK (status = 'active' OR (void_reason IS NOT NULL AND voided_at IS NOT NULL)),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id)
);
CREATE INDEX company_payments_company ON company_payments (company_id, received_at);
CREATE INDEX company_payments_time ON company_payments (tenant_id, received_at);

CREATE FUNCTION company_payment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'company payments cannot be deleted' USING ERRCODE = 'P0001'; END IF;
  IF OLD.status = 'void' OR NEW.status <> 'void' OR NEW.amount <> OLD.amount OR NEW.company_id <> OLD.company_id OR NEW.received_at <> OLD.received_at OR NEW.number <> OLD.number THEN
    RAISE EXCEPTION 'company payment is immutable (void it with a reason)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER company_payments_immutable BEFORE UPDATE OR DELETE ON company_payments FOR EACH ROW EXECUTE FUNCTION company_payment_guard();

-- each allocation is one ordinary payment row on the bill (method 'transfer', no drawer): revenue stays Σ payments − refunds
ALTER TABLE payments ADD COLUMN company_payment_id uuid;
ALTER TABLE payments ADD CONSTRAINT payments_company_payment_fk FOREIGN KEY (tenant_id, company_payment_id) REFERENCES company_payments(tenant_id, id);
CREATE INDEX payments_company_payment ON payments (company_payment_id) WHERE company_payment_id IS NOT NULL;

CREATE TABLE company_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  company_payment_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  amount bigint NOT NULL CHECK (amount > 0),
  FOREIGN KEY (tenant_id, company_payment_id) REFERENCES company_payments(tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id)
);
CREATE INDEX company_payment_allocations_payment ON company_payment_allocations (company_payment_id);
CREATE INDEX company_payment_allocations_invoice ON company_payment_allocations (invoice_id);
CREATE TRIGGER company_payment_allocations_append_only BEFORE UPDATE OR DELETE ON company_payment_allocations FOR EACH ROW EXECUTE FUNCTION forbid_payment_change();

-- voiding a company payment reverses each of its payment rows with a refund row of this reason (cash basis, no drawer):
-- the bill's paid amount goes down again and the company owes that part once more (credit_amount is not touched)
ALTER TABLE refunds DROP CONSTRAINT refunds_reason_code_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_reason_code_check CHECK (reason_code IN ('service_not_provided', 'appointment_cancelled', 'patient_complaint', 'other', 'company_payment_void'));
