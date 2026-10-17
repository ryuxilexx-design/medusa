-- Meduza core schema. All money values are integer tiyin (1 so'm = 100 tiyin).
-- Every tenant-owned table carries tenant_id; cross-table links use composite
-- (tenant_id, id) foreign keys so a row can never point into another tenant.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  patient_seq integer NOT NULL DEFAULT 0,
  invoice_seq integer NOT NULL DEFAULT 0,
  receipt_seq integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  code text NOT NULL,
  address text,
  timezone text NOT NULL DEFAULT 'Asia/Tashkent',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('manager', 'registrar', 'doctor', 'cashier', 'lab')),
  branch_ids uuid[] NOT NULL,
  title text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  demo_card boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id, role)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE doctors (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  membership_id uuid,
  display_name text NOT NULL,
  specialty text NOT NULL,
  phone text,
  default_share_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (default_share_percent BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships(tenant_id, id)
);

CREATE TABLE rooms (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  name text NOT NULL,
  purpose text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE schedules (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  doctor_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  room_id uuid,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_start time,
  break_end time,
  CHECK (end_time > start_time),
  CHECK ((break_start IS NULL) = (break_end IS NULL)),
  CHECK (break_start IS NULL OR (break_start >= start_time AND break_end <= end_time AND break_end > break_start)),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms(tenant_id, id),
  UNIQUE (doctor_id, weekday)  -- a doctor works in a single branch per weekday
);

CREATE TABLE services (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('consultation', 'lab', 'ultrasound', 'procedure')),
  duration_min integer NOT NULL CHECK (duration_min BETWEEN 5 AND 240),
  share_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (share_percent BETWEEN 0 AND 100),
  lab_template jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE service_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_id uuid NOT NULL,
  branch_id uuid, -- NULL = all branches
  amount bigint NOT NULL CHECK (amount >= 0),
  valid_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
CREATE INDEX service_prices_lookup ON service_prices (service_id, valid_from DESC);

CREATE TABLE doctor_services (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  doctor_id uuid NOT NULL,
  service_id uuid NOT NULL,
  PRIMARY KEY (doctor_id, service_id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id)
);

CREATE TABLE patients (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  patient_number integer NOT NULL,
  last_name text NOT NULL,
  first_name text NOT NULL,
  middle_name text,
  birth_date date NOT NULL,
  sex text NOT NULL DEFAULT 'unspecified' CHECK (sex IN ('male', 'female', 'unspecified')),
  phone text,
  contact_name text,
  contact_phone text,
  address text,
  note text,
  allergy_state text NOT NULL DEFAULT 'unknown' CHECK (allergy_state IN ('known', 'denied', 'unknown')),
  allergy_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, patient_number)
);
CREATE INDEX patients_phone ON patients (tenant_id, phone);
CREATE INDEX patients_name ON patients (tenant_id, lower(last_name), lower(first_name));

CREATE TABLE appointments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  service_id uuid NOT NULL,
  room_id uuid,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show')),
  note text,
  cancel_reason text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms(tenant_id, id),
  -- A doctor cannot hold two live appointments that overlap (in any branch).
  CONSTRAINT appointments_doctor_no_overlap EXCLUDE USING gist (
    doctor_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show')),
  CONSTRAINT appointments_room_no_overlap EXCLUDE USING gist (
    room_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (room_id IS NOT NULL AND status NOT IN ('cancelled', 'no_show'))
);
CREATE INDEX appointments_day ON appointments (tenant_id, starts_at);
CREATE INDEX appointments_patient ON appointments (patient_id, starts_at DESC);

CREATE TABLE queue_counters (
  branch_id uuid NOT NULL REFERENCES branches(id),
  local_date date NOT NULL,
  last_number integer NOT NULL,
  PRIMARY KEY (branch_id, local_date)
);

CREATE TABLE queue_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  appointment_id uuid NOT NULL UNIQUE,
  local_date date NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  arrived_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  wait_seconds integer,
  UNIQUE (branch_id, local_date, number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id)
);

CREATE TABLE encounters (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  appointment_id uuid NOT NULL UNIQUE,
  patient_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  started_at timestamptz NOT NULL,
  closed_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id)
);

CREATE TABLE clinical_notes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  encounter_id uuid NOT NULL UNIQUE,
  complaints text,
  anamnesis text,
  examination text,
  diagnosis text,
  recommendations text,
  follow_up_date date,
  vitals jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('draft', 'signed')),
  version integer NOT NULL DEFAULT 1,
  saved_at timestamptz NOT NULL DEFAULT now(),
  signed_by uuid,
  signed_by_name text,
  signed_at timestamptz,
  CHECK (status = 'draft' OR (signed_at IS NOT NULL AND signed_by_name IS NOT NULL)),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id)
);

-- Signed clinical notes are immutable at the database level.
CREATE FUNCTION forbid_signed_note_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'signed clinical note is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER clinical_notes_immutable BEFORE UPDATE OR DELETE ON clinical_notes
  FOR EACH ROW EXECUTE FUNCTION forbid_signed_note_change();

CREATE TABLE service_orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  appointment_id uuid,
  encounter_id uuid,
  service_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('consultation', 'lab', 'ultrasound', 'procedure')),
  service_name text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false, -- the booked service of an appointment
  price_snapshot bigint NOT NULL CHECK (price_snapshot >= 0),
  share_percent_snapshot numeric(5,2) NOT NULL DEFAULT 0,
  doctor_id uuid,           -- ordering doctor
  performer_doctor_id uuid, -- who performs (for share)
  status text NOT NULL CHECK (status IN ('ordered', 'sample_collected', 'draft_result', 'verified', 'completed', 'cancelled')),
  ordered_at timestamptz NOT NULL,
  performed_at timestamptz,
  created_by uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id)
);
CREATE INDEX service_orders_patient ON service_orders (patient_id, ordered_at DESC);
CREATE INDEX service_orders_cat ON service_orders (tenant_id, category, ordered_at DESC);
-- The booked service of an appointment is ordered exactly once.
CREATE UNIQUE INDEX service_orders_one_primary ON service_orders (appointment_id) WHERE is_primary;

CREATE TABLE lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL UNIQUE,
  values jsonb NOT NULL DEFAULT '[]'::jsonb,
  comment text,
  status text NOT NULL CHECK (status IN ('draft', 'verified')),
  collected_at timestamptz,
  collected_by_name text,
  entered_by_name text,
  entered_at timestamptz,
  verified_by uuid,
  verified_by_name text,
  verified_at timestamptz,
  CHECK (status = 'draft' OR (verified_at IS NOT NULL AND verified_by_name IS NOT NULL)),
  FOREIGN KEY (tenant_id, order_id) REFERENCES service_orders(tenant_id, id)
);

CREATE FUNCTION forbid_verified_result_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'verified' THEN
    RAISE EXCEPTION 'verified lab result is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER lab_results_immutable BEFORE UPDATE OR DELETE ON lab_results
  FOR EACH ROW EXECUTE FUNCTION forbid_verified_result_change();

CREATE TABLE diagnostic_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL UNIQUE,
  template_version text NOT NULL DEFAULT 'uzi-v1',
  exam_type text NOT NULL,
  description text,
  conclusion text,
  specialist_name text,
  status text NOT NULL CHECK (status IN ('draft', 'signed')),
  signed_by uuid,
  signed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, order_id) REFERENCES service_orders(tenant_id, id)
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  appointment_id uuid,
  invoice_number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'void')),
  subtotal bigint NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_type text CHECK (discount_type IN ('percent', 'amount')),
  discount_value numeric(18,2),
  discount_amount bigint NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  discount_reason text,
  discount_approved_by_name text,
  total bigint NOT NULL DEFAULT 0 CHECK (total >= 0),
  paid_amount bigint NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  void_reason text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total = subtotal - discount_amount),
  CHECK (paid_amount <= total),
  CHECK (status <> 'void' OR paid_amount = 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, invoice_number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id)
);
CREATE INDEX invoices_patient ON invoices (patient_id);
CREATE INDEX invoices_created ON invoices (tenant_id, created_at DESC);

CREATE TABLE invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_id uuid NOT NULL,
  order_id uuid NOT NULL UNIQUE, -- an order is billed exactly once
  service_id uuid NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price bigint NOT NULL CHECK (unit_price >= 0),
  line_subtotal bigint NOT NULL CHECK (line_subtotal >= 0),
  discount_share bigint NOT NULL DEFAULT 0 CHECK (discount_share >= 0),
  line_total bigint NOT NULL CHECK (line_total >= 0),
  position integer NOT NULL DEFAULT 0,
  CHECK (line_subtotal = quantity * unit_price),
  CHECK (line_total = line_subtotal - discount_share),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES service_orders(tenant_id, id)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  receipt_number integer NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash', 'card', 'transfer')),
  cashier_membership_id uuid,
  cashier_name text NOT NULL,
  paid_at timestamptz NOT NULL,
  note text,
  idempotency_key text NOT NULL,
  request_hash text,
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, receipt_number),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id)
);
CREATE INDEX payments_paid_at ON payments (tenant_id, paid_at);

-- Payments are append-only.
CREATE FUNCTION forbid_payment_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payments are append-only' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION forbid_payment_change();

CREATE TABLE expenses (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  category text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  occurred_at timestamptz NOT NULL,
  note text,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  opening_qty numeric(12,2) NOT NULL CHECK (opening_qty >= 0),
  minimum_qty numeric(12,2) NOT NULL CHECK (minimum_qty >= 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('in', 'out')),
  quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL,
  actor_name text NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory_items(tenant_id, id)
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid,
  actor_membership_id uuid,
  actor_name text NOT NULL,
  actor_role text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  summary text,
  request_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tenant ON audit_logs (tenant_id, occurred_at DESC);
