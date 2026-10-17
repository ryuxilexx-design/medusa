-- Persistent demo clock. The demo "now" = demo_anchor + (real time elapsed since real_anchor).
-- Only an explicit demo reset moves the anchor; restarting the API never rewinds time.
CREATE TABLE demo_clock (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  demo_anchor timestamptz NOT NULL,
  real_anchor timestamptz NOT NULL,
  set_reason text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION demo_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$
  SELECT coalesce((SELECT demo_anchor + (clock_timestamp() - real_anchor) FROM demo_clock WHERE id = 1), clock_timestamp())
$$;

-- Every server-generated timestamp uses the same demo clock (sessions keep real time for expiry).
ALTER TABLE tenants ALTER COLUMN updated_at SET DEFAULT demo_now();
ALTER TABLE patients ALTER COLUMN created_at SET DEFAULT demo_now();
ALTER TABLE patients ALTER COLUMN updated_at SET DEFAULT demo_now();
ALTER TABLE appointments ALTER COLUMN created_at SET DEFAULT demo_now();
ALTER TABLE appointments ALTER COLUMN updated_at SET DEFAULT demo_now();
ALTER TABLE services ALTER COLUMN updated_at SET DEFAULT demo_now();
ALTER TABLE service_prices ALTER COLUMN created_at SET DEFAULT demo_now();
ALTER TABLE invoices ALTER COLUMN updated_at SET DEFAULT demo_now();
ALTER TABLE diagnostic_reports ALTER COLUMN updated_at SET DEFAULT demo_now();
ALTER TABLE clinical_notes ALTER COLUMN saved_at SET DEFAULT demo_now();
ALTER TABLE audit_logs ALTER COLUMN occurred_at SET DEFAULT demo_now();
