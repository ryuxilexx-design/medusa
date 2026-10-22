-- Direct ISAPI connection to a Hikvision camera, so the clinic never opens the camera's own menus:
-- Med.uz.ai configures the camera's «HTTP listening» host itself (push), enrols faces into the camera's library under
-- our codes, and can pull events over /ISAPI/Event/notification/alertStream when the camera cannot reach the server.
-- The camera password is stored encrypted (APP_SECRET_KEY, core/secrets.ts); the face picture is forwarded to the
-- camera and never stored (no column for it).

ALTER TABLE cameras
  ADD COLUMN isapi_host text CHECK (isapi_host IS NULL OR length(isapi_host) BETWEEN 1 AND 120),
  ADD COLUMN isapi_port integer NOT NULL DEFAULT 80 CHECK (isapi_port BETWEEN 1 AND 65535),
  ADD COLUMN isapi_https boolean NOT NULL DEFAULT false,
  ADD COLUMN isapi_user text CHECK (isapi_user IS NULL OR length(isapi_user) BETWEEN 1 AND 64),
  ADD COLUMN isapi_password_enc text,
  -- how events reach us: the camera pushes to /api/v1/hik/<token> (push) or we hold an alertStream open (pull)
  ADD COLUMN delivery text NOT NULL DEFAULT 'push' CHECK (delivery IN ('push', 'pull')),
  -- what the last connection check found
  ADD COLUMN isapi_model text,
  ADD COLUMN isapi_firmware text,
  ADD COLUMN isapi_serial text,
  ADD COLUMN isapi_checked_at timestamptz,
  ADD COLUMN isapi_error text,
  -- the camera's face library that holds our codes (FDID), created by the setup
  ADD COLUMN fdlib_id text,
  ADD COLUMN listening_configured_at timestamptz;

-- which cameras a face was pushed to (so revoking a code can delete it from every camera that has it)
CREATE TABLE face_code_cameras (
  face_code_id uuid NOT NULL,
  camera_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  -- the camera's own record id (FPID / PID), needed to delete the picture again
  remote_id text,
  enrolled_at timestamptz NOT NULL DEFAULT demo_now(),
  enrolled_by uuid,
  PRIMARY KEY (face_code_id, camera_id),
  FOREIGN KEY (tenant_id, face_code_id) REFERENCES face_codes(tenant_id, id),
  FOREIGN KEY (tenant_id, camera_id) REFERENCES cameras(tenant_id, id),
  FOREIGN KEY (tenant_id, enrolled_by) REFERENCES memberships(tenant_id, id)
);
