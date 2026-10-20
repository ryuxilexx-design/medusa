-- Index experiment for the load audit: the suggested indexes, applied ONLY to meduza_load_test to measure their effect.
-- (Not a migration. A real migration would use CREATE INDEX CONCURRENTLY outside a transaction.)
\timing on
DO $$ BEGIN IF current_database() <> 'meduza_load_test' THEN RAISE EXCEPTION 'wrong database'; END IF; END $$;
SET maintenance_work_mem = '512MB';
SET max_parallel_maintenance_workers = 0;
-- F1: visit -> invoice (schedule, doctor day list, check-in, cancel, dashboard)
CREATE INDEX IF NOT EXISTS invoices_appointment ON invoices (appointment_id) WHERE appointment_id IS NOT NULL;
-- F2: invoice -> items (invoice lists, patient history, receipts, recalcInvoice, check-in)
CREATE INDEX IF NOT EXISTS invoice_items_invoice ON invoice_items (invoice_id, position);
-- F5: cameras list (events in the last 24 h per camera)
CREATE INDEX IF NOT EXISTS camera_events_camera_received ON camera_events (camera_id, received_at);
-- F6: open security alerts (dashboard + security page)
CREATE INDEX IF NOT EXISTS camera_events_open_alerts ON camera_events (tenant_id, branch_id) WHERE alert;
-- F8: patient history notes / doctor access
CREATE INDEX IF NOT EXISTS encounters_patient ON encounters (patient_id);
-- F9: performed services by period / by performer (dashboard by_service, reports, doctor page)
CREATE INDEX IF NOT EXISTS service_orders_performed ON service_orders (tenant_id, performed_at) WHERE status IN ('completed', 'verified');
CREATE INDEX IF NOT EXISTS service_orders_performer ON service_orders (performer_doctor_id, performed_at) WHERE status IN ('completed', 'verified');
-- F10: doctor's own patients (EXISTS appointment with this doctor), availability by doctor/day
CREATE INDEX IF NOT EXISTS appointments_doctor_patient ON appointments (doctor_id, patient_id);
CREATE INDEX IF NOT EXISTS appointments_doctor_time ON appointments (doctor_id, starts_at);
-- F11: open debts / pending lab work (dashboard attention block)
CREATE INDEX IF NOT EXISTS invoices_open ON invoices (tenant_id, branch_id) WHERE status IN ('unpaid', 'partially_paid');
CREATE INDEX IF NOT EXISTS service_orders_lab_open ON service_orders (tenant_id, branch_id, status) WHERE category = 'lab' AND status IN ('ordered', 'sample_collected', 'draft_result');
CREATE INDEX IF NOT EXISTS appointments_cancelled ON appointments (tenant_id, branch_id) WHERE status = 'cancelled';
-- F4: substring patient search (name / phone) — trigram GIN on the exact expressions the query uses
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS patients_fullname_trgm ON patients USING gin ((lower(last_name || ' ' || first_name || ' ' || coalesce(middle_name, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS patients_firstlast_trgm ON patients USING gin ((lower(first_name || ' ' || last_name)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS patients_phone_trgm ON patients USING gin ((replace(coalesce(phone, ''), '+', '')) gin_trgm_ops);
-- default patient list order
CREATE INDEX IF NOT EXISTS patients_created ON patients (tenant_id, created_at DESC, patient_number DESC);
ANALYZE;
