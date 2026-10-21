-- Alert snapshots: the camera's own picture of a security alert (a stranger at a restricted door at night, a
-- covered lens), kept as evidence for the manager.
--
-- This is the one place a picture from a camera is stored, and only under these limits:
--   * only for an *alert* (intrusion / line crossing / region entrance or exit / loitering / tamper that raised an
--     alert) — never for a face match (the person is known: that would be biometric data) or people counting;
--   * only when the manager switched it on for that camera (cameras.alert_snapshots);
--   * one picture per event, at most 1 MB, deleted after 30 days (purged hourly by the API);
--   * read only by the clinic's manager, inside their branches.
-- The camera decides what it sends; Med.uz.ai never crops faces or runs recognition on these pictures.

ALTER TABLE cameras ADD COLUMN alert_snapshots boolean NOT NULL DEFAULT false;

-- a person lingering in a zone (Hikvision «loitering») is a security event like the others
ALTER TABLE camera_events DROP CONSTRAINT camera_events_kind_check;
ALTER TABLE camera_events ADD CONSTRAINT camera_events_kind_check
  CHECK (kind IN ('face_match', 'people_count', 'intrusion', 'line_crossing', 'region_entrance', 'region_exit', 'loitering', 'tamper'));

CREATE TABLE camera_snapshots (
  event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes bytea NOT NULL CHECK (length(bytes) BETWEEN 64 AND 1048576),
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  FOREIGN KEY (tenant_id, event_id) REFERENCES camera_events(tenant_id, id)
);
CREATE INDEX camera_snapshots_by_age ON camera_snapshots (created_at);

-- a snapshot is never edited; it is deleted by the retention purge (or with the event's tenant)
CREATE TRIGGER camera_snapshots_no_update BEFORE UPDATE ON camera_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_camera_event_change();
