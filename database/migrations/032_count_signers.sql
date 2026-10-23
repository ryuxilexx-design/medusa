-- Who entered the counted quantities and who submitted the count: the manager who decides the differences must be
-- none of them (security review 2026-10-23). Checked in the API and by the trigger below.
ALTER TABLE inventory_count_lines ADD COLUMN IF NOT EXISTS counted_by uuid;
ALTER TABLE inventory_counts ADD COLUMN IF NOT EXISTS submitted_by uuid;

CREATE OR REPLACE FUNCTION inventory_count_decider_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.decided_by IS NOT NULL AND OLD.decided_by IS NULL AND (
       NEW.decided_by = NEW.started_by OR NEW.decided_by = NEW.submitted_by
       OR EXISTS (SELECT 1 FROM inventory_count_lines l WHERE l.count_id = NEW.id AND l.counted_by = NEW.decided_by)) THEN
    RAISE EXCEPTION 'inventarizatsiyani sanagan yoki topshirgan xodim uni tasdiqlay olmaydi' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inventory_count_decider_guard ON inventory_counts;
CREATE TRIGGER inventory_count_decider_guard BEFORE UPDATE ON inventory_counts FOR EACH ROW EXECUTE FUNCTION inventory_count_decider_guard();
