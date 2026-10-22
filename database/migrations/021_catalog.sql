-- The clinic manages its own catalogue from Settings (no SQL): services, rooms, branches and stock items can be
-- created and switched off. Nothing is ever deleted — an inactive row keeps old appointments, orders and
-- movements intact and simply stops appearing in new choices.

-- branches.phone already comes from 020_front_desk.sql
ALTER TABLE branches ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- a service name is unique within a clinic (case-insensitive); the API answers 409 before the index is hit
CREATE UNIQUE INDEX IF NOT EXISTS services_tenant_name ON services (tenant_id, lower(name));
