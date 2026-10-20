-- Hikvision DeepinView cameras: staff attendance, patient arrival, people counting, security events.
--
-- Biometrics never enter this database. Face pictures and templates live only in the camera's own face library
-- (in the clinic, in Uzbekistan). A person is enrolled on the camera under OUR code (face_codes.code, e.g. S-3 or
-- P-1001); the camera recognises the face itself and sends us only «code, time, similarity». No images, no raw
-- payloads (they can carry names) are stored here.

-- A patient's separate consent to face recognition at the reception camera.
ALTER TABLE patient_consents DROP CONSTRAINT patient_consents_kind_check;
ALTER TABLE patient_consents ADD CONSTRAINT patient_consents_kind_check CHECK (kind IN ('data_processing', 'notifications', 'biometric'));

CREATE TABLE cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  location text CHECK (location IS NULL OR length(location) <= 120),
  model text CHECK (model IS NULL OR length(model) <= 60),
  -- what the camera's events are used for
  purposes text[] NOT NULL CHECK (purposes <@ ARRAY['attendance', 'patient_arrival', 'counting', 'security']::text[] AND cardinality(purposes) > 0),
  -- security alerts: always, or only outside the branch's working hours
  security_mode text NOT NULL DEFAULT 'after_hours' CHECK (security_mode IN ('always', 'after_hours')),
  -- the camera pushes events to /api/v1/hik/<token>; only the SHA-256 of the token is kept (shown once on creation)
  token_hash text NOT NULL UNIQUE,
  token_hint text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_event_at timestamptz,
  -- any notification or heartbeat (a silent camera is shown to the manager)
  last_seen_at timestamptz,
  -- real-time people counting sends running totals since the camera's daily reset; the last totals give the difference
  pc_last_enter integer,
  pc_last_exit integer,
  pc_last_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, id)
);

-- Our code for a person in the camera face library. Staff codes need the manager to confirm the employee's written
-- consent; patient codes need an active «biometric» patient consent (checked when an event arrives).
CREATE TABLE face_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL CHECK (code ~ '^[SP]-[0-9]{1,9}$'),
  subject_type text NOT NULL CHECK (subject_type IN ('staff', 'patient')),
  membership_id uuid,
  patient_id uuid,
  consent_confirmed_by uuid,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  revoked_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK ((subject_type = 'staff') = (membership_id IS NOT NULL) AND (subject_type = 'patient') = (patient_id IS NOT NULL)),
  CHECK (subject_type = 'patient' OR consent_confirmed_by IS NOT NULL),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, consent_confirmed_by) REFERENCES memberships(tenant_id, id)
);
-- one live code per person
CREATE UNIQUE INDEX face_codes_staff_live ON face_codes (tenant_id, membership_id) WHERE revoked_at IS NULL AND membership_id IS NOT NULL;
CREATE UNIQUE INDEX face_codes_patient_live ON face_codes (tenant_id, patient_id) WHERE revoked_at IS NULL AND patient_id IS NOT NULL;
CREATE SEQUENCE face_code_staff_seq;

-- Normalised camera events. Append-only (security events get acknowledged via camera_event_acks).
CREATE TABLE camera_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  camera_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('face_match', 'people_count', 'intrusion', 'line_crossing', 'region_entrance', 'region_exit', 'tamper')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT demo_now(),
  face_code_id uuid,
  similarity numeric(5,2) CHECK (similarity IS NULL OR similarity BETWEEN 0 AND 100),
  enter_count integer CHECK (enter_count IS NULL OR enter_count >= 0),
  exit_count integer CHECK (exit_count IS NULL OR exit_count >= 0),
  target text CHECK (target IS NULL OR target IN ('human', 'vehicle', 'other')),
  -- true when the event happened outside the branch's working hours (security_mode = after_hours raises an alert then)
  alert boolean NOT NULL DEFAULT false,
  dedupe_key text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (camera_id, dedupe_key),
  FOREIGN KEY (tenant_id, camera_id) REFERENCES cameras(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, face_code_id) REFERENCES face_codes(tenant_id, id)
);
CREATE INDEX camera_events_by_time ON camera_events (tenant_id, kind, occurred_at DESC);
CREATE INDEX camera_events_by_code ON camera_events (tenant_id, face_code_id, occurred_at) WHERE face_code_id IS NOT NULL;

CREATE TABLE camera_event_acks (
  event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  acked_by uuid NOT NULL,
  acked_at timestamptz NOT NULL DEFAULT demo_now(),
  FOREIGN KEY (tenant_id, event_id) REFERENCES camera_events(tenant_id, id),
  FOREIGN KEY (tenant_id, acked_by) REFERENCES memberships(tenant_id, id)
);

-- «The camera saw this patient»: a suggestion for the registrar to mark the appointment as arrived (one click).
-- Nothing changes on the appointment without a person.
CREATE TABLE arrival_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_id uuid NOT NULL,
  event_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed', 'expired')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (tenant_id, appointment_id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id),
  FOREIGN KEY (tenant_id, event_id) REFERENCES camera_events(tenant_id, id),
  FOREIGN KEY (tenant_id, decided_by) REFERENCES memberships(tenant_id, id)
);

CREATE FUNCTION forbid_camera_event_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'camera events are append-only' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER camera_events_append_only BEFORE UPDATE OR DELETE ON camera_events
  FOR EACH ROW EXECUTE FUNCTION forbid_camera_event_change();
