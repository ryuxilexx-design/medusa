-- 040: security guard fixes after the audit of migration 038 (docs/SECURITY_GUARD.md).
--   * the post shift keeps a snapshot of what was open at hand-over (open_items): the A4 report prints it instead of
--     computing «now»; old shifts get it from the append-only history (the state at closed_at is reconstructible);
--   * an abandoned shift (open > GUARD_SHIFT_STALE_HOURS) can be force-closed by the manager with a reason;
--   * a patrol round freezes its checkpoint list when it starts (marks outside it are refused);
--   * a visitor nobody marked «Chiqdi» is closed automatically after 24 h (auto_closed);
--   * SOS / incident writes may carry an Idempotency-Key (a retry returns the first row).

-- ---------------------------------------------------------------- post shift: snapshot and forced close
ALTER TABLE guard_shifts
  ADD COLUMN open_items jsonb,
  ADD COLUMN forced boolean NOT NULL DEFAULT false,
  ADD COLUMN force_reason text CHECK (force_reason IS NULL OR length(force_reason) BETWEEN 3 AND 500);

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'guard_shifts'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%(closed_at IS NULL) = (handover_note IS NULL)%' LOOP
    EXECUTE format('ALTER TABLE guard_shifts DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
-- open: no note; closed: the guard's handover note, or the manager's forced close (its reason instead of a note)
ALTER TABLE guard_shifts ADD CONSTRAINT guard_shifts_close_note CHECK (
  (closed_at IS NULL AND handover_note IS NULL AND NOT forced) OR (closed_at IS NOT NULL AND (handover_note IS NOT NULL OR forced)));
ALTER TABLE guard_shifts ADD CONSTRAINT guard_shifts_force_reason CHECK (forced = (force_reason IS NOT NULL));

CREATE OR REPLACE FUNCTION guard_shift_close_once() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'guard shifts are append-only' USING ERRCODE = 'P0001'; END IF;
  IF OLD.closed_at IS NOT NULL THEN
    -- the one later change: the open-items snapshot of a shift closed before migration 040 is filled in once
    IF OLD.open_items IS NULL AND NEW.open_items IS NOT NULL AND (to_jsonb(NEW) - 'open_items') = (to_jsonb(OLD) - 'open_items') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'a guard shift is closed once and never edited' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.closed_at IS NULL
     OR (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.number, NEW.guard_membership_id, NEW.guard_name, NEW.opened_at)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.number, OLD.guard_membership_id, OLD.guard_name, OLD.opened_at) THEN
    RAISE EXCEPTION 'a guard shift is closed once and never edited' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- what is open at the post at an instant
-- One definition for the panel's counters, the handover checklist and the shift's snapshot. Everything it reads is
-- append-only with its own time, so the state at any past instant is exact: an alert of a security kind within
-- SECURITY_OPEN_DAYS (30) not closed by then, an incident not closed by then, a key whose last move by then was «out»,
-- a visitor in for less than 24 h and not out by then. `with_names` adds the visitor's name and organisation (the live
-- screen); a stored snapshot never keeps them (they are purged after the retention period).
CREATE OR REPLACE FUNCTION guard_open_items(p_tenant uuid, p_branches uuid[], p_at timestamptz, with_names boolean) RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'at', p_at,
    'alerts_open', (SELECT count(*)::int FROM camera_events e
       WHERE e.tenant_id = p_tenant AND e.alert AND e.kind NOT IN ('face_match', 'people_count') AND e.branch_id = ANY(p_branches)
         AND e.occurred_at <= p_at AND e.occurred_at >= p_at - interval '30 days'
         AND NOT EXISTS (SELECT 1 FROM security_alert_actions a WHERE a.event_id = e.id AND a.action = 'resolve' AND a.outcome <> 'escalated' AND a.acted_at <= p_at)
         AND NOT EXISTS (SELECT 1 FROM camera_event_acks k WHERE k.event_id = e.id AND k.acked_at <= p_at)),
    'incidents_open', (SELECT count(*)::int FROM security_incidents i
       WHERE i.tenant_id = p_tenant AND i.branch_id = ANY(p_branches) AND i.reported_at <= p_at AND i.reported_at >= p_at - interval '30 days'
         AND NOT EXISTS (SELECT 1 FROM security_incident_entries x WHERE x.incident_id = i.id AND x.kind = 'close' AND x.created_at <= p_at)),
    'incidents', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'category', i.category, 'severity', i.severity, 'reported_at', i.reported_at) ORDER BY i.reported_at DESC)
       FROM (SELECT i.* FROM security_incidents i
              WHERE i.tenant_id = p_tenant AND i.branch_id = ANY(p_branches) AND i.reported_at <= p_at AND i.reported_at >= p_at - interval '30 days'
                AND NOT EXISTS (SELECT 1 FROM security_incident_entries x WHERE x.incident_id = i.id AND x.kind = 'close' AND x.created_at <= p_at)
              ORDER BY i.reported_at DESC LIMIT 20) i), '[]'::jsonb),
    'keys_out', coalesce((SELECT jsonb_agg(jsonb_build_object('room_id', k.room_id, 'room_name', k.room_name, 'holder_name', k.holder_name, 'at', k.at) ORDER BY k.at)
       FROM (SELECT r.id AS room_id, r.name AS room_name, lk.holder_name, lk.at FROM rooms r
               JOIN LATERAL (SELECT ke.action, ke.holder_name, ke.at FROM key_events ke WHERE ke.tenant_id = r.tenant_id AND ke.room_id = r.id AND ke.at <= p_at
                              ORDER BY ke.at DESC, ke.id DESC LIMIT 1) lk ON true
              WHERE r.tenant_id = p_tenant AND r.branch_id = ANY(p_branches) AND lk.action = 'out' ORDER BY lk.at LIMIT 50) k), '[]'::jsonb),
    'visitors_inside_count', (SELECT count(*)::int FROM security_visitors v
       WHERE v.tenant_id = p_tenant AND v.branch_id = ANY(p_branches) AND v.in_at <= p_at AND v.in_at > p_at - interval '24 hours' AND (v.out_at IS NULL OR v.out_at > p_at)),
    'visitors_inside', coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', v.id, 'purpose', v.purpose, 'host_name', v.host_name, 'in_at', v.in_at,
         'full_name', CASE WHEN with_names THEN v.full_name END, 'organisation', CASE WHEN with_names THEN v.organisation END)) ORDER BY v.in_at)
       FROM (SELECT * FROM security_visitors v
              WHERE v.tenant_id = p_tenant AND v.branch_id = ANY(p_branches) AND v.in_at <= p_at AND v.in_at > p_at - interval '24 hours' AND (v.out_at IS NULL OR v.out_at > p_at)
              ORDER BY v.in_at LIMIT 50) v), '[]'::jsonb)
  );
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------- patrol: the round's checkpoints are frozen at its start
ALTER TABLE patrol_rounds ADD COLUMN checkpoint_ids uuid[];
ALTER TABLE patrol_rounds ADD CONSTRAINT patrol_rounds_frozen_points CHECK (checkpoint_ids IS NULL OR cardinality(checkpoint_ids) = checkpoints_total);
CREATE OR REPLACE FUNCTION patrol_round_finish_once() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'patrol rounds are append-only' USING ERRCODE = 'P0001'; END IF;
  IF OLD.finished_at IS NOT NULL OR NEW.finished_at IS NULL
     OR (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.shift_id, NEW.guard_membership_id, NEW.guard_name, NEW.checkpoints_total, NEW.started_at, NEW.checkpoint_ids)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.shift_id, OLD.guard_membership_id, OLD.guard_name, OLD.checkpoints_total, OLD.started_at, OLD.checkpoint_ids) THEN
    RAISE EXCEPTION 'a patrol round is finished once and never edited' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- visitors: the forgotten «Chiqdi» is closed automatically
ALTER TABLE security_visitors ADD COLUMN auto_closed boolean NOT NULL DEFAULT false;
ALTER TABLE security_visitors ADD CONSTRAINT security_visitors_auto_closed CHECK (NOT auto_closed OR (out_at IS NOT NULL AND out_by IS NULL));
CREATE OR REPLACE FUNCTION security_visitor_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'the visitor log is append-only' USING ERRCODE = 'P0001'; END IF;
  -- the fields that never move
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.purpose, NEW.host_membership_id, NEW.host_name, NEW.in_at, NEW.recorded_by, NEW.recorded_by_name)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.purpose, OLD.host_membership_id, OLD.host_name, OLD.in_at, OLD.recorded_by, OLD.recorded_by_name) THEN
    RAISE EXCEPTION 'a visitor record is never edited' USING ERRCODE = 'P0001';
  END IF;
  -- «Chiqdi» (by a guard, or automatically by the purge): once, from empty
  IF (NEW.out_at, NEW.out_by, NEW.auto_closed) IS DISTINCT FROM (OLD.out_at, OLD.out_by, OLD.auto_closed)
     AND (OLD.out_at IS NOT NULL OR NEW.out_at IS NULL OR OLD.auto_closed) THEN
    RAISE EXCEPTION 'the exit time is set once' USING ERRCODE = 'P0001';
  END IF;
  -- the retention purge: personal fields only go to empty, and only together with purged_at
  IF (NEW.full_name, NEW.organisation, NEW.purpose_note, NEW.pass_no, NEW.purged_at) IS DISTINCT FROM (OLD.full_name, OLD.organisation, OLD.purpose_note, OLD.pass_no, OLD.purged_at)
     AND (OLD.purged_at IS NOT NULL OR NEW.purged_at IS NULL OR NEW.full_name IS NOT NULL OR NEW.organisation IS NOT NULL OR NEW.purpose_note IS NOT NULL OR NEW.pass_no IS NOT NULL) THEN
    RAISE EXCEPTION 'visitor personal data is only cleared by the retention purge' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- the hourly auto-close looks for visitors still inside by entry time
CREATE INDEX security_visitors_open_by_time ON security_visitors (in_at) WHERE out_at IS NULL;

-- ---------------------------------------------------------------- incidents / SOS: Idempotency-Key
ALTER TABLE security_incidents ADD COLUMN idempotency_key text CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 8 AND 100);
CREATE UNIQUE INDEX security_incidents_idempotency ON security_incidents (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- the SOS dedupe looks up the guard's own recent calls
CREATE INDEX security_incidents_sos_by_guard ON security_incidents (tenant_id, reported_by, reported_at DESC) WHERE source = 'sos';

-- ---------------------------------------------------------------- shifts closed before this migration get their snapshot
UPDATE guard_shifts SET open_items = guard_open_items(tenant_id, ARRAY[branch_id], closed_at, false)
 WHERE closed_at IS NOT NULL AND open_items IS NULL;
