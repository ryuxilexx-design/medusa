-- Performance at scale (load audit 2026-10-20: 100k patients, ~1M appointments, 2M camera events).
-- Plain CREATE INDEX (migrations run in one transaction at API start); on a large live database create them
-- CONCURRENTLY by hand first — IF NOT EXISTS then skips them here.

-- demo_now() is the same within one statement: STABLE lets the planner use it as an index bound and evaluate it once
-- (VOLATILE ran it per row). The value still follows the clock between statements.
CREATE OR REPLACE FUNCTION demo_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT demo_anchor + (clock_timestamp() - real_anchor) FROM demo_clock WHERE id = 1), clock_timestamp())
$$;

-- schedule, doctor's day list, check-in, billing: invoices and lines of one visit / one invoice
CREATE INDEX IF NOT EXISTS invoices_appointment ON invoices (appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoice_items_invoice ON invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS invoices_patient ON invoices (patient_id);
CREATE INDEX IF NOT EXISTS invoices_open ON invoices (tenant_id, branch_id) WHERE status IN ('unpaid', 'partially_paid');

-- patient search: substring matches on names and phone
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS patients_fullname_trgm ON patients USING gin ((lower(last_name || ' ' || first_name || ' ' || coalesce(middle_name, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS patients_firstlast_trgm ON patients USING gin ((lower(first_name || ' ' || last_name)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS patients_phone_trgm ON patients USING gin ((replace(coalesce(phone, ''), '+', '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS patients_created ON patients (tenant_id, created_at DESC, patient_number DESC);

-- doctor-scoped lists and history
CREATE INDEX IF NOT EXISTS appointments_doctor_patient ON appointments (doctor_id, patient_id);
CREATE INDEX IF NOT EXISTS appointments_doctor_start ON appointments (doctor_id, starts_at);
CREATE INDEX IF NOT EXISTS encounters_patient ON encounters (patient_id);

-- dashboard and lab work lists
CREATE INDEX IF NOT EXISTS service_orders_lab_open ON service_orders (tenant_id, branch_id, status) WHERE category = 'lab' AND status IN ('ordered', 'sample_collected', 'draft_result');
CREATE INDEX IF NOT EXISTS service_orders_performed ON service_orders (tenant_id, performed_at) WHERE status IN ('completed', 'verified');
CREATE INDEX IF NOT EXISTS service_orders_performer ON service_orders (performer_doctor_id, performed_at) WHERE status IN ('completed', 'verified');

-- cameras: per-camera recent events and open alerts
CREATE INDEX IF NOT EXISTS camera_events_camera_received ON camera_events (camera_id, received_at);
CREATE INDEX IF NOT EXISTS camera_events_open_alerts ON camera_events (tenant_id, branch_id) WHERE alert;

-- sessions are purged by expiry
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);
