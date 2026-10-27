-- Referral partners («yo‘llovchi shifokorlar / hamkorlar»), their commission, payouts, and lead sources («reklama kanali»).
-- docs/REFERRALS.md. Money stays integer tiyin; percents are numeric(5,2) 0–100.

-- ---------- lead sources: a per-clinic directory; two built-in rows the code relies on (system_key) ----------
CREATE TABLE lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- 'telegram_bot' = bookings made by the patient in the clinic's bot; 'referral' = a referral partner sent the patient
  system_key text CHECK (system_key IN ('telegram_bot', 'referral')),
  -- the starter row this came from (idempotent ensureLeadSources); NULL for rows the manager added
  starter_key text,
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 100 CHECK (sort BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (system_key IS NULL OR active),          -- a built-in source is never switched off
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, starter_key),
  UNIQUE (tenant_id, system_key)
);
CREATE UNIQUE INDEX lead_sources_name ON lead_sources (tenant_id, lower(name));

-- ---------- referral partners: tenant-wide (every branch), a short numeric code people can type ----------
ALTER TABLE tenants ADD COLUMN partner_seq integer NOT NULL DEFAULT 100;
CREATE TABLE referral_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code integer NOT NULL CHECK (code > 0),
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 120),
  phone text,
  kind text NOT NULL CHECK (kind IN ('doctor', 'med_rep', 'clinic', 'other')),
  workplace text CHECK (workplace IS NULL OR length(workplace) <= 160),
  specialty text CHECK (specialty IS NULL OR length(specialty) <= 80),
  region text CHECK (region IS NULL OR length(region) <= 120),
  note text CHECK (note IS NULL OR length(note) <= 500),
  -- the partner's percent of a referred service; 0 = none. Service and partner-service overrides: partnerPercentFor()
  default_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (default_percent BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE INDEX referral_partners_phone ON referral_partners (tenant_id, phone);
CREATE INDEX referral_partners_name_trgm ON referral_partners USING gin (lower(full_name) gin_trgm_ops);
CREATE INDEX referral_partners_phone_trgm ON referral_partners USING gin ((replace(coalesce(phone, ''), '+', '')) gin_trgm_ops);

-- per-service percent for every partner (NULL = the partner's own default) …
ALTER TABLE services ADD COLUMN partner_percent numeric(5,2) CHECK (partner_percent IS NULL OR partner_percent BETWEEN 0 AND 100);
-- … and for one partner on one service (wins over both)
CREATE TABLE referral_partner_services (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  partner_id uuid NOT NULL,
  service_id uuid NOT NULL,
  percent numeric(5,2) NOT NULL CHECK (percent BETWEEN 0 AND 100),
  PRIMARY KEY (partner_id, service_id),
  FOREIGN KEY (tenant_id, partner_id) REFERENCES referral_partners(tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id)
);

-- ---------- who sent the patient, and where they heard of the clinic ----------
ALTER TABLE patients ADD COLUMN lead_source_id uuid;
ALTER TABLE patients ADD CONSTRAINT patients_lead_source_fk FOREIGN KEY (tenant_id, lead_source_id) REFERENCES lead_sources(tenant_id, id);

ALTER TABLE appointments ADD COLUMN referral_partner_id uuid, ADD COLUMN lead_source_id uuid;
ALTER TABLE appointments ADD CONSTRAINT appointments_partner_fk FOREIGN KEY (tenant_id, referral_partner_id) REFERENCES referral_partners(tenant_id, id);
ALTER TABLE appointments ADD CONSTRAINT appointments_lead_source_fk FOREIGN KEY (tenant_id, lead_source_id) REFERENCES lead_sources(tenant_id, id);

-- the order snapshots the partner and the percent once, at creation (like share_percent_snapshot): later percent edits
-- never rewrite past lines. Partner amount of a line = NET_LINE × partner_percent_snapshot / 100 (billing.ts PARTNER_LINE).
ALTER TABLE service_orders ADD COLUMN referral_partner_id uuid,
  ADD COLUMN partner_percent_snapshot numeric(5,2) NOT NULL DEFAULT 0 CHECK (partner_percent_snapshot BETWEEN 0 AND 100);
ALTER TABLE service_orders ADD CONSTRAINT service_orders_partner_fk FOREIGN KEY (tenant_id, referral_partner_id) REFERENCES referral_partners(tenant_id, id);
ALTER TABLE service_orders ADD CONSTRAINT service_orders_partner_pct CHECK (referral_partner_id IS NOT NULL OR partner_percent_snapshot = 0);
CREATE INDEX service_orders_partner ON service_orders (referral_partner_id, performed_at) WHERE referral_partner_id IS NOT NULL;

-- ---------- payouts to partners: append-only, a correction is a void with a reason (like expenses) ----------
-- Not a reduction of revenue («tushum» stays payments − refunds): an outflow shown next to expenses in finance.
-- Cash comes out of an open drawer (shift_id) and counts in that shift's cash_out.
CREATE TABLE partner_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  partner_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash', 'transfer')),
  shift_id uuid,
  note text CHECK (note IS NULL OR length(note) <= 300),
  paid_at timestamptz NOT NULL DEFAULT demo_now(),
  created_by uuid,
  created_by_name text NOT NULL,
  idempotency_key text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  void_reason text,
  voided_at timestamptz,
  voided_by_name text,
  CHECK (method <> 'cash' OR shift_id IS NOT NULL),
  CHECK (status = 'active' OR (void_reason IS NOT NULL AND voided_at IS NOT NULL)),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, partner_id) REFERENCES referral_partners(tenant_id, id),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES cash_shifts(tenant_id, id)
);
CREATE INDEX partner_payouts_partner ON partner_payouts (partner_id, paid_at);
CREATE INDEX partner_payouts_time ON partner_payouts (tenant_id, paid_at);
CREATE INDEX partner_payouts_shift ON partner_payouts (shift_id) WHERE shift_id IS NOT NULL;

CREATE FUNCTION partner_payout_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'partner payouts cannot be deleted' USING ERRCODE = 'P0001'; END IF;
  IF OLD.status = 'void' OR NEW.status <> 'void' OR NEW.amount <> OLD.amount OR NEW.partner_id <> OLD.partner_id OR NEW.method <> OLD.method
     OR NEW.paid_at <> OLD.paid_at OR NEW.branch_id <> OLD.branch_id OR NEW.shift_id IS DISTINCT FROM OLD.shift_id THEN
    RAISE EXCEPTION 'partner payout is immutable (void it with a reason)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER partner_payouts_immutable BEFORE UPDATE OR DELETE ON partner_payouts FOR EACH ROW EXECUTE FUNCTION partner_payout_guard();
