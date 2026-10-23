-- 037: reorder suggestion for the warehouse (docs/WAREHOUSE.md, «Buyurtma taklifi»).
-- The suggested quantity is rounded up to a whole pack when the item's pack size is known (e.g. 100 syringes a box).
-- NULL = unknown: the suggestion is rounded up to a whole unit.
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pack_size numeric(12,2) CHECK (pack_size IS NULL OR pack_size > 0);

-- consumption per item over the last 30/90 days reads issues/returns of a branch by time
CREATE INDEX IF NOT EXISTS inventory_movements_consumption ON inventory_movements (tenant_id, branch_id, occurred_at)
  WHERE kind IN ('issue', 'return', 'legacy') AND voided_at IS NULL;
