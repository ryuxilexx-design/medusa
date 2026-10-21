// Stores normalised camera events and derives what the clinic acts on: patient arrival suggestions and
// after-hours security alerts. Shared by the camera push endpoint and the demo simulator.
import { Q } from '../core/db';
import { localDate, localTime, now, toMinutes, weekday } from '../core/clock';

export type EventKind = 'face_match' | 'people_count' | 'intrusion' | 'line_crossing' | 'region_entrance' | 'region_exit' | 'loitering' | 'tamper';
export const SECURITY_KINDS: EventKind[] = ['intrusion', 'line_crossing', 'region_entrance', 'region_exit', 'loitering', 'tamper'];

/** The camera's picture of a security event. Kept only for an alert, only when the camera's «alert snapshots» are on. */
export interface Snapshot { contentType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: Buffer }
/** Largest snapshot stored (the camera sends one frame, usually 50–300 KB). */
export const SNAPSHOT_MAX = 1024 * 1024;
/** Days an alert snapshot is kept before the hourly purge deletes it. */
export const SNAPSHOT_DAYS = 30;

/** What a parser makes of one camera notification. Never carries a person's name; a picture only for a security event. */
export interface NormalizedEvent {
  kind: EventKind;
  occurredAt: Date;
  /** our code from the camera's face library (S-3 / P-1001), face_match only */
  code?: string | null;
  similarity?: number | null;
  enter?: number | null;
  exit?: number | null;
  target?: 'human' | 'vehicle' | 'other' | null;
  /** people counting in real-time mode: enter/exit are running totals since the camera's daily reset */
  cumulative?: boolean;
  /** stable id of the notification on the camera side, so a re-sent event is stored once */
  sourceKey: string;
  /** the camera's picture of a security event (never of a face match or a count) */
  snapshot?: Snapshot | null;
}

export interface Camera { id: string; tenant_id: string; branch_id: string; purposes: string[]; security_mode: 'always' | 'after_hours'; alert_snapshots?: boolean }

/** Recognised faces below this similarity are ignored (a doubtful match must not mark anyone as present). */
export const MIN_SIMILARITY = 80;
/** A patient seen up to this long before / after the booked time is matched to that appointment. */
const ARRIVAL_WINDOW_MIN = { before: 120, after: 60 };

/** True when nobody is scheduled to work in the branch at that local time (no doctor's working hours cover it). */
async function afterHours(q: Q, tenantId: string, branchId: string, at: Date) {
  const day = localDate(at), mins = toMinutes(localTime(at));
  const r = await q.query(
    `SELECT 1 FROM schedules s JOIN doctors d ON d.id = s.doctor_id AND d.active
      WHERE s.tenant_id = $1 AND s.branch_id = $2 AND s.weekday = $3
        AND (extract(hour FROM s.start_time) * 60 + extract(minute FROM s.start_time)) <= $4
        AND (extract(hour FROM s.end_time) * 60 + extract(minute FROM s.end_time)) > $4 LIMIT 1`,
    [tenantId, branchId, weekday(day), mins]);
  return !r.rowCount;
}

export type IngestResult = { stored: boolean; ignored?: string; event_id?: string; suggestion?: boolean; snapshot?: boolean };

/**
 * Stores one event for a camera (idempotent by sourceKey) and runs the follow-ups. Runs inside the caller's transaction.
 * Events that the camera's purposes do not cover, unknown/revoked codes, patients without an active biometric
 * consent and doubtful matches are dropped and not stored.
 */
export async function ingestEvent(q: Q, cam: Camera, e: NormalizedEvent): Promise<IngestResult> {
  const has = (p: string) => cam.purposes.includes(p);
  // a camera clock a day ahead or more than a year behind is wrong: such an event would land on the wrong day forever.
  // A sanity bound, not a business time: checked against both the demo clock and the real clock (a demo's clock lags).
  const t = e.occurredAt.getTime(), demo = now().getTime(), real = Date.now();
  if (Number.isNaN(t) || t > Math.max(demo, real) + 24 * 3600_000 || t < Math.min(demo, real) - 366 * 24 * 3600_000) return { stored: false, ignored: 'bad_time' };
  let faceCodeId: string | null = null, subject: 'staff' | 'patient' | null = null, patientId: string | null = null;
  if (e.kind === 'face_match') {
    if (!has('attendance') && !has('patient_arrival')) return { stored: false, ignored: 'purpose' };
    if (!e.code || !/^[SP]-\d{1,9}$/.test(e.code)) return { stored: false, ignored: 'no_code' };
    // no similarity (or an impossible one, dropped by the parser) is as doubtful as a low one
    if (e.similarity == null || e.similarity < MIN_SIMILARITY) return { stored: false, ignored: 'low_similarity' };
    const fc = (await q.query(
      `SELECT fc.id, fc.subject_type, fc.patient_id FROM face_codes fc WHERE fc.tenant_id = $1 AND fc.code = $2 AND fc.revoked_at IS NULL`,
      [cam.tenant_id, e.code])).rows[0];
    if (!fc) return { stored: false, ignored: 'unknown_code' };
    subject = fc.subject_type; patientId = fc.patient_id;
    if (subject === 'staff' && !has('attendance')) return { stored: false, ignored: 'purpose' };
    if (subject === 'patient') {
      if (!has('patient_arrival')) return { stored: false, ignored: 'purpose' };
      // the patient's latest biometric consent must be a «yes»
      const ok = (await q.query(
        `SELECT granted FROM patient_consents WHERE tenant_id = $1 AND patient_id = $2 AND kind = 'biometric' ORDER BY recorded_at DESC, seq DESC LIMIT 1`,
        [cam.tenant_id, patientId])).rows[0]?.granted === true;
      if (!ok) return { stored: false, ignored: 'no_consent' };
    }
    faceCodeId = fc.id;
  } else if (e.kind === 'people_count') {
    if (!has('counting')) return { stored: false, ignored: 'purpose' };
    if (e.cumulative) {
      // difference to the previous totals; a smaller total (or a new local day) means the camera reset its counter
      const prev = (await q.query(`SELECT pc_last_enter, pc_last_exit, pc_last_at FROM cameras WHERE id = $1 FOR UPDATE`, [cam.id])).rows[0];
      if (prev?.pc_last_at && new Date(prev.pc_last_at) >= e.occurredAt) return { stored: false, ignored: 'duplicate' };
      const sameDay = prev?.pc_last_at && localDate(new Date(prev.pc_last_at)) === localDate(e.occurredAt);
      const enter = e.enter ?? 0, exit = e.exit ?? 0;
      const reset = !sameDay || enter < (prev.pc_last_enter ?? 0) || exit < (prev.pc_last_exit ?? 0);
      await q.query(`UPDATE cameras SET pc_last_enter = $2, pc_last_exit = $3, pc_last_at = $4 WHERE id = $1`, [cam.id, enter, exit, e.occurredAt]);
      e = { ...e, cumulative: false, enter: reset ? enter : enter - prev.pc_last_enter, exit: reset ? exit : exit - prev.pc_last_exit };
      if (!e.enter && !e.exit) return { stored: false, ignored: 'no_change' };
    }
  } else if (!has('security')) return { stored: false, ignored: 'purpose' };

  const alert = SECURITY_KINDS.includes(e.kind) && (cam.security_mode === 'always' || await afterHours(q, cam.tenant_id, cam.branch_id, e.occurredAt));
  const row = (await q.query(
    `INSERT INTO camera_events (tenant_id, camera_id, branch_id, kind, occurred_at, face_code_id, similarity, enter_count, exit_count, target, alert, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (camera_id, dedupe_key) DO NOTHING RETURNING id`,
    [cam.tenant_id, cam.id, cam.branch_id, e.kind, e.occurredAt, faceCodeId, e.similarity ?? null, e.enter ?? null, e.exit ?? null, e.target ?? null, alert, e.sourceKey.slice(0, 200)])).rows[0];
  await q.query(`UPDATE cameras SET last_event_at = GREATEST(coalesce(last_event_at, $2), $2) WHERE id = $1`, [cam.id, e.occurredAt]);
  if (!row) return { stored: false, ignored: 'duplicate' };

  // evidence of an alert: the camera's picture, only when the manager switched it on for this camera
  let snapshot = false;
  if (alert && cam.alert_snapshots && e.snapshot && SECURITY_KINDS.includes(e.kind) && e.snapshot.bytes.length >= 64 && e.snapshot.bytes.length <= SNAPSHOT_MAX) {
    await q.query(`INSERT INTO camera_snapshots (event_id, tenant_id, content_type, bytes, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [row.id, cam.tenant_id, e.snapshot.contentType, e.snapshot.bytes, now()]);
    snapshot = true;
  }

  let suggestion = false;
  if (subject === 'patient' && patientId) {
    // today's booked, not yet arrived appointment of this patient in this branch, near the booked time
    const a = (await q.query(
      `SELECT a.id FROM appointments a
        WHERE a.tenant_id = $1 AND a.branch_id = $2 AND a.patient_id = $3 AND a.status = 'scheduled'
          AND a.starts_at BETWEEN $4::timestamptz - make_interval(mins => $6) AND $4::timestamptz + make_interval(mins => $5)
        ORDER BY abs(extract(epoch FROM a.starts_at - $4::timestamptz)) LIMIT 1`,
      [cam.tenant_id, cam.branch_id, patientId, e.occurredAt, ARRIVAL_WINDOW_MIN.before, ARRIVAL_WINDOW_MIN.after])).rows[0];
    if (a) {
      const s = await q.query(
        `INSERT INTO arrival_suggestions (tenant_id, appointment_id, event_id) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, appointment_id) DO NOTHING RETURNING id`,
        [cam.tenant_id, a.id, row.id]);
      suggestion = !!s.rowCount;
    }
  }
  return { stored: true, event_id: row.id, suggestion, snapshot };
}

/** Deletes alert snapshots older than the retention (called hourly by the API). */
export async function purgeSnapshots(q: Q) {
  const r = await q.query(`DELETE FROM camera_snapshots WHERE created_at < (SELECT demo_now()) - make_interval(days => $1)`, [SNAPSHOT_DAYS]);
  return r.rowCount ?? 0;
}
