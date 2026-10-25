-- 038: the security guard («Qorovul», role `guard`) — docs/SECURITY_GUARD.md.
--   * the guard works at the entrance: camera security alerts (taken / resolved with an outcome), an incident log,
--     a visitor log for non-patients, the key log, patrol rounds over the manager's checkpoints, the post shift with
--     its handover note, and who of the staff is on site;
--   * the guard never reads a patient card, a visit, a note, a result, an invoice or the warehouse (API 403);
--     a patient seen by a camera is only «Bemor» (no code, no name), patient flow only as counts;
--   * everything that is evidence is append-only (triggers); a state that has to change (a visitor leaving, a round
--     or a shift ending) changes once, from empty, and nothing else in the row moves.

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('manager', 'registrar', 'doctor', 'cashier', 'lab', 'storekeeper', 'guard'));

CREATE FUNCTION forbid_security_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

-- per-tenant document numbers (incident №, post shift №): an UPSERT … RETURNING is race-free
CREATE TABLE security_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('incident', 'shift')),
  last integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, kind)
);

-- ---------------------------------------------------------------- post shifts (smena) and handover
CREATE TABLE guard_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  number integer NOT NULL,
  guard_membership_id uuid NOT NULL,
  guard_name text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT demo_now(),
  closed_at timestamptz,
  closed_by uuid,
  -- what the next guard must know (keys out, a broken lock …); required to close
  handover_note text CHECK (handover_note IS NULL OR length(handover_note) BETWEEN 3 AND 2000),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  CHECK ((closed_at IS NULL) = (handover_note IS NULL)),
  CHECK (closed_at IS NULL OR closed_at >= opened_at),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, guard_membership_id) REFERENCES memberships(tenant_id, id),
  FOREIGN KEY (tenant_id, closed_by) REFERENCES memberships(tenant_id, id)
);
-- one open post shift per guard
CREATE UNIQUE INDEX guard_shifts_one_open ON guard_shifts (tenant_id, guard_membership_id) WHERE closed_at IS NULL;
CREATE INDEX guard_shifts_list ON guard_shifts (tenant_id, branch_id, opened_at DESC);

CREATE FUNCTION guard_shift_close_once() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'guard shifts are append-only' USING ERRCODE = 'P0001'; END IF;
  IF OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL
     OR (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.number, NEW.guard_membership_id, NEW.guard_name, NEW.opened_at)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.number, OLD.guard_membership_id, OLD.guard_name, OLD.opened_at) THEN
    RAISE EXCEPTION 'a guard shift is closed once and never edited' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER guard_shifts_close_once BEFORE UPDATE OR DELETE ON guard_shifts FOR EACH ROW EXECUTE FUNCTION guard_shift_close_once();

-- ---------------------------------------------------------------- incidents (hodisalar jurnali)
CREATE TABLE security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  number integer NOT NULL,
  category text NOT NULL CHECK (category IN ('conflict', 'theft', 'damage', 'fire', 'medical', 'suspicious', 'other')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  -- where: one of the branch's rooms and/or a short place («2-qavat zinasi»)
  room_id uuid,
  place text CHECK (place IS NULL OR length(place) BETWEEN 1 AND 120),
  -- free text, phone numbers removed by the API; never a patient's name by design (UI hint)
  description text NOT NULL CHECK (length(description) BETWEEN 3 AND 2000),
  source text NOT NULL CHECK (source IN ('manual', 'alert', 'sos', 'patrol')),
  sos_reason text CHECK (sos_reason IS NULL OR sos_reason IN ('aggression', 'medical', 'fire', 'theft', 'suspicious', 'other')),
  alert_event_id uuid,
  shift_id uuid,
  reported_by uuid NOT NULL,
  reported_by_name text NOT NULL,
  reported_by_role text NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  CHECK ((source = 'sos') = (sos_reason IS NOT NULL)),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms(tenant_id, id),
  FOREIGN KEY (tenant_id, alert_event_id) REFERENCES camera_events(tenant_id, id),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES guard_shifts(tenant_id, id),
  FOREIGN KEY (tenant_id, reported_by) REFERENCES memberships(tenant_id, id)
);
CREATE INDEX security_incidents_list ON security_incidents (tenant_id, branch_id, reported_at DESC);
CREATE INDEX security_incidents_sos ON security_incidents (tenant_id, reported_at DESC) WHERE source = 'sos';
CREATE TRIGGER security_incidents_append_only BEFORE UPDATE OR DELETE ON security_incidents FOR EACH ROW EXECUTE FUNCTION forbid_security_change();

-- additions, corrections (like a note addendum), the manager's «seen» and the closing resolution
CREATE TABLE security_incident_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  incident_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('note', 'correction', 'seen', 'close')),
  text text CHECK (text IS NULL OR length(text) BETWEEN 3 AND 2000),
  author_membership_id uuid NOT NULL,
  author_name text NOT NULL,
  author_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  CHECK (kind = 'seen' OR text IS NOT NULL),
  FOREIGN KEY (tenant_id, incident_id) REFERENCES security_incidents(tenant_id, id),
  FOREIGN KEY (tenant_id, author_membership_id) REFERENCES memberships(tenant_id, id)
);
CREATE INDEX security_incident_entries_by_incident ON security_incident_entries (incident_id, created_at);
CREATE UNIQUE INDEX security_incident_one_close ON security_incident_entries (incident_id) WHERE kind = 'close';
CREATE UNIQUE INDEX security_incident_one_seen ON security_incident_entries (incident_id) WHERE kind = 'seen';
CREATE TRIGGER security_incident_entries_append_only BEFORE UPDATE OR DELETE ON security_incident_entries FOR EACH ROW EXECUTE FUNCTION forbid_security_change();

-- ---------------------------------------------------------------- handling of camera alerts
-- The camera event stays untouched (append-only); every step is a new row. The current state is the latest row:
-- take → «taken»; resolve with an outcome → «resolved» (or «escalated», which only the manager closes).
-- seq is the event's step number: two people acting on the same picture of the same state collide on UNIQUE.
CREATE TABLE security_alert_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq BETWEEN 1 AND 20),
  action text NOT NULL CHECK (action IN ('take', 'resolve')),
  outcome text CHECK (outcome IS NULL OR outcome IN ('false_alarm', 'checked_ok', 'incident', 'escalated')),
  note text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  incident_id uuid,
  actor_membership_id uuid NOT NULL,
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  acted_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (event_id, seq),
  CHECK ((action = 'resolve') = (outcome IS NOT NULL)),
  CHECK (outcome IS DISTINCT FROM 'incident' OR incident_id IS NOT NULL),
  FOREIGN KEY (tenant_id, event_id) REFERENCES camera_events(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, incident_id) REFERENCES security_incidents(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_membership_id) REFERENCES memberships(tenant_id, id)
);
CREATE INDEX security_alert_actions_by_time ON security_alert_actions (tenant_id, acted_at DESC);
CREATE TRIGGER security_alert_actions_append_only BEFORE UPDATE OR DELETE ON security_alert_actions FOR EACH ROW EXECUTE FUNCTION forbid_security_change();
-- the guard's feed: alerts of a branch by time
CREATE INDEX camera_events_alerts ON camera_events (tenant_id, branch_id, occurred_at DESC) WHERE alert;

-- ---------------------------------------------------------------- visitor log (non-patients only)
-- Couriers, suppliers, repair workers, inspectors … never patients or their companions, never a passport/ID number.
-- The personal fields (name, organisation, pass, note) are cleared by the hourly purge after VISITOR_RETENTION_DAYS.
CREATE TABLE security_visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  full_name text CHECK (full_name IS NULL OR length(full_name) BETWEEN 2 AND 120),
  organisation text CHECK (organisation IS NULL OR length(organisation) BETWEEN 1 AND 120),
  purpose text NOT NULL CHECK (purpose IN ('delivery', 'supplier', 'repair', 'inspection', 'meeting', 'interview', 'other')),
  purpose_note text CHECK (purpose_note IS NULL OR length(purpose_note) BETWEEN 1 AND 200),
  host_membership_id uuid,
  host_name text,
  pass_no text CHECK (pass_no IS NULL OR length(pass_no) BETWEEN 1 AND 20),
  in_at timestamptz NOT NULL DEFAULT demo_now(),
  out_at timestamptz,
  recorded_by uuid NOT NULL,
  recorded_by_name text NOT NULL,
  out_by uuid,
  purged_at timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (purged_at IS NOT NULL OR full_name IS NOT NULL),
  CHECK (out_at IS NULL OR out_at >= in_at),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, host_membership_id) REFERENCES memberships(tenant_id, id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES memberships(tenant_id, id),
  FOREIGN KEY (tenant_id, out_by) REFERENCES memberships(tenant_id, id)
);
CREATE INDEX security_visitors_list ON security_visitors (tenant_id, branch_id, in_at DESC);
CREATE INDEX security_visitors_inside ON security_visitors (tenant_id, branch_id) WHERE out_at IS NULL;
CREATE INDEX security_visitors_purge ON security_visitors (in_at) WHERE purged_at IS NULL;

CREATE FUNCTION security_visitor_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'the visitor log is append-only' USING ERRCODE = 'P0001'; END IF;
  -- the fields that never move
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.purpose, NEW.host_membership_id, NEW.host_name, NEW.in_at, NEW.recorded_by, NEW.recorded_by_name)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.purpose, OLD.host_membership_id, OLD.host_name, OLD.in_at, OLD.recorded_by, OLD.recorded_by_name) THEN
    RAISE EXCEPTION 'a visitor record is never edited' USING ERRCODE = 'P0001';
  END IF;
  -- «Chiqdi»: once, from empty
  IF (NEW.out_at, NEW.out_by) IS DISTINCT FROM (OLD.out_at, OLD.out_by) AND (OLD.out_at IS NOT NULL OR NEW.out_at IS NULL) THEN
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
CREATE TRIGGER security_visitors_change BEFORE UPDATE OR DELETE ON security_visitors FOR EACH ROW EXECUTE FUNCTION security_visitor_change();

-- ---------------------------------------------------------------- key log (rooms of the branch)
CREATE TABLE key_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  room_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('out', 'in')),
  -- who took the key (out) / who brought it back (in): a staff member
  holder_membership_id uuid NOT NULL,
  holder_name text NOT NULL,
  note text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 200),
  by_membership_id uuid NOT NULL,
  by_name text NOT NULL,
  at timestamptz NOT NULL DEFAULT demo_now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms(tenant_id, id),
  FOREIGN KEY (tenant_id, holder_membership_id) REFERENCES memberships(tenant_id, id),
  FOREIGN KEY (tenant_id, by_membership_id) REFERENCES memberships(tenant_id, id)
);
CREATE INDEX key_events_by_room ON key_events (tenant_id, room_id, at DESC);
CREATE INDEX key_events_by_time ON key_events (tenant_id, branch_id, at DESC);
CREATE TRIGGER key_events_append_only BEFORE UPDATE OR DELETE ON key_events FOR EACH ROW EXECUTE FUNCTION forbid_security_change();

-- ---------------------------------------------------------------- patrol (obxod)
-- checkpoints are the manager's set-up (edited, switched off — never deleted); rounds and marks are evidence
CREATE TABLE patrol_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 999),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
CREATE INDEX patrol_checkpoints_branch ON patrol_checkpoints (tenant_id, branch_id, position);
CREATE TRIGGER patrol_checkpoints_no_delete BEFORE DELETE ON patrol_checkpoints FOR EACH ROW EXECUTE FUNCTION forbid_security_change();

CREATE TABLE patrol_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  shift_id uuid,
  guard_membership_id uuid NOT NULL,
  guard_name text NOT NULL,
  -- the checkpoints active when the round started (a round is complete when every one is marked)
  checkpoints_total integer NOT NULL CHECK (checkpoints_total BETWEEN 1 AND 200),
  started_at timestamptz NOT NULL DEFAULT demo_now(),
  finished_at timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES guard_shifts(tenant_id, id),
  FOREIGN KEY (tenant_id, guard_membership_id) REFERENCES memberships(tenant_id, id)
);
CREATE UNIQUE INDEX patrol_rounds_one_open ON patrol_rounds (tenant_id, guard_membership_id) WHERE finished_at IS NULL;
CREATE INDEX patrol_rounds_list ON patrol_rounds (tenant_id, branch_id, started_at DESC);

CREATE FUNCTION patrol_round_finish_once() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'patrol rounds are append-only' USING ERRCODE = 'P0001'; END IF;
  IF OLD.finished_at IS NOT NULL OR NEW.finished_at IS NULL
     OR (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.shift_id, NEW.guard_membership_id, NEW.guard_name, NEW.checkpoints_total, NEW.started_at)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.shift_id, OLD.guard_membership_id, OLD.guard_name, OLD.checkpoints_total, OLD.started_at) THEN
    RAISE EXCEPTION 'a patrol round is finished once and never edited' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER patrol_rounds_finish_once BEFORE UPDATE OR DELETE ON patrol_rounds FOR EACH ROW EXECUTE FUNCTION patrol_round_finish_once();

CREATE TABLE patrol_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  round_id uuid NOT NULL,
  checkpoint_id uuid NOT NULL,
  result text NOT NULL CHECK (result IN ('ok', 'problem')),
  note text CHECK (note IS NULL OR length(note) BETWEEN 3 AND 500),
  incident_id uuid,
  marked_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (round_id, checkpoint_id),
  CHECK (result = 'ok' OR note IS NOT NULL),
  FOREIGN KEY (tenant_id, round_id) REFERENCES patrol_rounds(tenant_id, id),
  FOREIGN KEY (tenant_id, checkpoint_id) REFERENCES patrol_checkpoints(tenant_id, id),
  FOREIGN KEY (tenant_id, incident_id) REFERENCES security_incidents(tenant_id, id)
);
CREATE TRIGGER patrol_marks_append_only BEFORE UPDATE OR DELETE ON patrol_marks FOR EACH ROW EXECUTE FUNCTION forbid_security_change();

-- ---------------------------------------------------------------- staff on site: the guard's manual marks
-- (the camera's face matches of staff codes are the other source; no picture, no biometric data here)
CREATE TABLE staff_presence_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('in', 'out')),
  by_membership_id uuid NOT NULL,
  by_name text NOT NULL,
  at timestamptz NOT NULL DEFAULT demo_now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships(tenant_id, id),
  FOREIGN KEY (tenant_id, by_membership_id) REFERENCES memberships(tenant_id, id)
);
CREATE INDEX staff_presence_marks_by_time ON staff_presence_marks (tenant_id, branch_id, at DESC);
CREATE TRIGGER staff_presence_marks_append_only BEFORE UPDATE OR DELETE ON staff_presence_marks FOR EACH ROW EXECUTE FUNCTION forbid_security_change();
