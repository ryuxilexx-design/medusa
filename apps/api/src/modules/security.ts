// The security guard's domain (migration 038, docs/SECURITY_GUARD.md): shared helpers of security.controller.ts —
// alert state from the append-only handling rows, staff on site, document numbers and the visitor retention purge.
import { KEY_DUE_HOUR, VISITOR_RETENTION_DAYS } from '@meduza/contracts';
import { Q } from '../core/db';
import { Ctx } from '../core/context';
import { invalid } from '../core/errors';
import { addDays, dayStart, localDate, localTime, now, today, toMinutes, weekday } from '../core/clock';
import { assertBranch } from '../core/scope';
import { dayException } from './booking';

export const GUARD_ROLES = ['guard', 'manager'] as const;
/** Late if the first arrival is more than this after the doctor's scheduled start (as the cameras' attendance report). */
export const LATE_GRACE_MIN = 5;
/** Kinds the guard handles: the security events, never a face match or a count. */
export const ALERT_KINDS_SQL = `e.kind NOT IN ('face_match', 'people_count')`;

/**
 * Current handling state of a camera alert. The latest action row decides; an alert the manager acknowledged on the
 * cameras page (camera_event_acks) without any guard action counts as resolved.
 */
export const ALERT_STATE_SQL = `CASE
    WHEN la.action = 'resolve' AND la.outcome <> 'escalated' THEN 'resolved'
    WHEN k.event_id IS NOT NULL THEN 'resolved'
    WHEN la.outcome = 'escalated' THEN 'escalated'
    WHEN la.action = 'take' THEN 'taken'
    ELSE 'new' END`;
/** FROM-clause joins for ALERT_STATE_SQL: the latest action (la), the first action (fa, response time) and the ack (k). */
export const ALERT_JOINS_SQL = `
  LEFT JOIN LATERAL (SELECT a.seq, a.action, a.outcome, a.note, a.actor_name, a.actor_role, a.acted_at, a.incident_id
                       FROM security_alert_actions a WHERE a.event_id = e.id ORDER BY a.seq DESC LIMIT 1) la ON true
  LEFT JOIN LATERAL (SELECT a.acted_at FROM security_alert_actions a WHERE a.event_id = e.id ORDER BY a.seq LIMIT 1) fa ON true
  LEFT JOIN camera_event_acks k ON k.event_id = e.id`;

/** The branch a write lands in: the one asked for (inside the session scope), or the person's only branch. */
export function writeBranch(ctx: Ctx, requested: string | null | undefined): string {
  if (requested) { assertBranch(ctx, requested); return requested; }
  if (ctx.branchIds.length === 1) return ctx.branchIds[0];
  throw invalid({ branch_id: 'Filialni tanlang' });
}

/** Next document number of the clinic (incident №, post shift №); race-free. */
export async function nextNumber(q: Q, tenantId: string, kind: 'incident' | 'shift'): Promise<number> {
  return (await q.query(
    `INSERT INTO security_counters (tenant_id, kind, last) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, kind) DO UPDATE SET last = security_counters.last + 1 RETURNING last`, [tenantId, kind])).rows[0].last;
}

/** A key taken on `day` (local) is overdue once that day reaches KEY_DUE_HOUR, or any later day. */
export function keyOverdue(outAt: Date, at: Date = now()): boolean {
  const day = localDate(outAt);
  if (localDate(at) > day) return true;
  return toMinutes(localTime(at)) >= KEY_DUE_HOUR * 60;
}

export type Presence = {
  membership_id: string; full_name: string; title: string | null; role: string; specialty: string | null;
  status: 'in' | 'left' | 'expected' | 'absent' | 'off';
  first_at: string | null; last_at: string | null; source: 'camera' | 'manual' | null;
  planned_start: string | null; late_min: number | null;
};

/**
 * Who of the staff is on site today: the camera's face matches of staff codes (only codes with the manager's
 * confirmation of written consent exist) plus the guard's manual marks. Doctors are compared with today's schedule
 * (day off / vacation / holiday respected). Never lists a patient.
 */
export async function staffPresence(q: Q, tenantId: string, branches: string[]): Promise<Presence[]> {
  const day = today(), from = dayStart(day), to = dayStart(addDays(day, 1));
  const seen = (await q.query(
    `SELECT fc.membership_id, min(e.occurred_at) AS first_at, max(e.occurred_at) AS last_at
       FROM camera_events e JOIN face_codes fc ON fc.id = e.face_code_id AND fc.subject_type = 'staff'
      WHERE e.tenant_id = $1 AND e.kind = 'face_match' AND e.branch_id = ANY($2) AND e.occurred_at >= $3 AND e.occurred_at < $4
      GROUP BY fc.membership_id`, [tenantId, branches, from, to])).rows;
  const marks = (await q.query(
    `SELECT membership_id, kind, at FROM staff_presence_marks
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND at >= $3 AND at < $4 ORDER BY at LIMIT 2000`, [tenantId, branches, from, to])).rows;
  const staff = (await q.query(
    `SELECT m.id AS membership_id, u.full_name, m.title, m.role, d.id AS doctor_id, d.specialty
       FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN doctors d ON d.membership_id = m.id AND d.tenant_id = m.tenant_id
      WHERE m.tenant_id = $1 AND m.status = 'active' AND m.branch_ids && $2 ORDER BY u.full_name LIMIT 500`, [tenantId, branches])).rows;
  const plans = (await q.query(
    `SELECT doctor_id, branch_id, to_char(min(start_time), 'HH24:MI') AS start_time FROM schedules
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND weekday = $3 GROUP BY doctor_id, branch_id`, [tenantId, branches, weekday(day)])).rows;
  const seenBy = new Map(seen.map((r) => [r.membership_id, r]));
  const t = now();
  const out: Presence[] = [];
  for (const s of staff) {
    const cam = seenBy.get(s.membership_id);
    const mine = marks.filter((m) => m.membership_id === s.membership_id);
    const plan = s.doctor_id ? plans.find((p) => p.doctor_id === s.doctor_id) : undefined;
    if (!cam && !mine.length && !plan) continue;
    const ins = [cam?.first_at, ...mine.filter((m) => m.kind === 'in').map((m) => m.at)].filter(Boolean).map((x) => new Date(x));
    const lastSeen = [cam?.last_at, ...mine.filter((m) => m.kind === 'in').map((m) => m.at)].filter(Boolean).map((x) => new Date(x).getTime());
    const lastOut = mine.filter((m) => m.kind === 'out').map((m) => new Date(m.at).getTime());
    const first = ins.length ? new Date(Math.min(...ins.map((d) => d.getTime()))) : null;
    const lastIn = lastSeen.length ? Math.max(...lastSeen) : null;
    const outAt = lastOut.length ? Math.max(...lastOut) : null;
    let status: Presence['status'];
    if (first) status = outAt && (!lastIn || outAt >= lastIn) ? 'left' : 'in';
    else {
      const exc = plan ? await dayException(q, tenantId, s.doctor_id, day, plan.branch_id) : null;
      if (exc && exc.kind !== 'custom_hours') status = 'off';
      else {
        const start = exc?.kind === 'custom_hours' && exc.start ? exc.start : plan!.start_time;
        status = t.getTime() > dayStart(day).getTime() + (toMinutes(start) + LATE_GRACE_MIN) * 60_000 ? 'absent' : 'expected';
      }
    }
    let late: number | null = null;
    if (first && plan) {
      const diff = Math.round((first.getTime() - (dayStart(day).getTime() + toMinutes(plan.start_time) * 60_000)) / 60_000);
      late = diff > LATE_GRACE_MIN ? diff : 0;
    }
    out.push({
      membership_id: s.membership_id, full_name: s.full_name, title: s.title, role: s.role, specialty: s.specialty, status,
      first_at: first?.toISOString() ?? null,
      last_at: [lastIn, outAt].filter((x): x is number => x != null).length ? new Date(Math.max(...[lastIn, outAt].filter((x): x is number => x != null))).toISOString() : null,
      source: cam ? 'camera' : mine.some((m) => m.kind === 'in') ? 'manual' : null,
      planned_start: plan?.start_time ?? null, late_min: late,
    });
  }
  const order = { in: 0, absent: 1, expected: 2, left: 3, off: 4 } as const;
  return out.sort((a, b) => order[a.status] - order[b.status] || a.full_name.localeCompare(b.full_name));
}

/** Clears the personal fields of visitor records older than VISITOR_RETENTION_DAYS (called hourly by the API). */
export async function purgeVisitors(q: Q): Promise<number> {
  const r = await q.query(
    `UPDATE security_visitors SET full_name = NULL, organisation = NULL, purpose_note = NULL, pass_no = NULL, purged_at = (SELECT demo_now())
      WHERE purged_at IS NULL AND in_at < (SELECT demo_now()) - make_interval(days => $1)`, [VISITOR_RETENTION_DAYS]);
  return r.rowCount ?? 0;
}
