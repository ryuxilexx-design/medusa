-- Every person who ever edited a count line is remembered (a later edit by someone else does not erase them), and none
-- of them may decide the count (security review 2026-10-23).
ALTER TABLE inventory_counts ADD COLUMN IF NOT EXISTS counters uuid[] NOT NULL DEFAULT '{}';
UPDATE inventory_counts c SET counters = coalesce((SELECT array_agg(DISTINCT l.counted_by) FROM inventory_count_lines l WHERE l.count_id = c.id AND l.counted_by IS NOT NULL), '{}');

CREATE OR REPLACE FUNCTION inventory_count_decider_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.decided_by IS NOT NULL AND OLD.decided_by IS NULL AND (
       NEW.decided_by = NEW.started_by OR NEW.decided_by = NEW.submitted_by OR NEW.decided_by = ANY(NEW.counters)
       OR EXISTS (SELECT 1 FROM inventory_count_lines l WHERE l.count_id = NEW.id AND l.counted_by = NEW.decided_by)) THEN
    RAISE EXCEPTION 'inventarizatsiyani sanagan yoki topshirgan xodim uni tasdiqlay olmaydi' USING ERRCODE = 'check_violation';
  END IF;
  -- the list of counters only grows
  IF NOT (OLD.counters <@ NEW.counters) THEN
    RAISE EXCEPTION 'sanaganlar ro‘yxatidan o‘chirib bo‘lmaydi' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
