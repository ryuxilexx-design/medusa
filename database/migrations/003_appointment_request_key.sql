-- Idempotent booking: a retried "Qabulga yozish" request with the same key returns the original appointment.
ALTER TABLE appointments ADD COLUMN request_key text;
CREATE UNIQUE INDEX appointments_request_key ON appointments (tenant_id, request_key) WHERE request_key IS NOT NULL;
