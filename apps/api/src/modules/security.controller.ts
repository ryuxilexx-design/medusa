// The security guard «Qorovul» and the manager's «Xavfsizlik» section (migration 038, docs/SECURITY_GUARD.md).
// Privacy boundary: nothing here returns a patient's name, number, phone, appointment or anything clinical or
// financial. A patient recognised by a camera is «Bemor» (no code); patient flow is counts only.
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { PoolClient } from 'pg';
import {
  ALERT_OUTCOMES, alertResolveSchema, alertTakeSchema, checkpointCreateSchema, checkpointPatchSchema, guardShiftCloseSchema, guardShiftOpenSchema,
  INCIDENT_CATEGORIES, incidentCreateSchema, incidentEntrySchema, keyInSchema, keyOutSchema, PATROL_INTERVAL_HOURS, presenceMarkSchema, roundMarkSchema,
  roundStartSchema, SOS_CATEGORY, sosSchema, translate, VISITOR_RETENTION_DAYS, visitorCreateSchema, type MessageKey,
} from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, conflict, forbidden, invalid, notFound } from '../core/errors';
import { isDate, isUuid, pageParams, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, now, today } from '../core/clock';
import { assertBranch, branchScope } from '../core/scope';
import { csvPeriod, csvTime, sendCsv } from '../core/csv';
import { redact } from '../ai/redact';
import { SECURITY_KINDS, SNAPSHOT_DAYS } from '../cameras/ingest';
import { ALERT_JOINS_SQL, ALERT_KINDS_SQL, ALERT_STATE_SQL, GUARD_ROLES, keyOverdue, nextNumber, staffPresence, writeBranch } from './security';

const G = GUARD_ROLES;
/** Free text written by the guard: phone numbers are removed (the same helper as before any AI call); names are a UI hint. */
const clean = (s: string | null | undefined) => (s == null ? null : redact(s));
const stale = (msg = 'Holat boshqa foydalanuvchi tomonidan o‘zgartirilgan. Sahifani yangilang.') => conflict('STALE_STATE', msg);

/** Inclusive local date range (default: the last 7 days), at most `maxDays`. */
function period(q: Record<string, unknown>, defaultDays = 7, maxDays = 366) {
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) ? q.from : addDays(to, -(defaultDays - 1));
  if (from > to) throw new AppError(422, 'VALIDATION', 'Davr noto‘g‘ri', { from: 'Boshlanish sanasi tugashdan keyin' });
  if (addDays(from, maxDays) < to) throw invalid({ from: 'Eksport davri 1 yildan oshmasin' });
  return { from, to, fromTs: dayStart(from), toTs: dayStart(addDays(to, 1)) };
}

/** An active staff member of this clinic who works in one of the session's branches (key holder, host, presence). */
async function staffMember(q: Q, ctx: Ctx, membershipId: string) {
  const m = (await q.query(
    `SELECT m.id, u.full_name FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.id = $1 AND m.tenant_id = $2 AND m.status = 'active' AND m.branch_ids && $3`, [membershipId, ctx.tenantId, ctx.branchIds])).rows[0];
  if (!m) throw invalid({ holder_membership_id: 'Xodimni tanlang', membership_id: 'Xodimni tanlang', host_membership_id: 'Xodimni tanlang' });
  return m as { id: string; full_name: string };
}

async function insertIncident(c: Q, ctx: Ctx, v: {
  branchId: string; category: string; severity: string; description: string; roomId?: string | null; place?: string | null;
  source: 'manual' | 'alert' | 'sos' | 'patrol'; sosReason?: string | null; alertEventId?: string | null;
}) {
  if (v.roomId) {
    const r = (await c.query(`SELECT branch_id FROM rooms WHERE id = $1 AND tenant_id = $2`, [v.roomId, ctx.tenantId])).rows[0];
    if (!r || r.branch_id !== v.branchId) throw invalid({ room_id: 'Xona topilmadi' });
  }
  const shift = (await c.query(`SELECT id FROM guard_shifts WHERE tenant_id = $1 AND guard_membership_id = $2 AND branch_id = $3 AND closed_at IS NULL`,
    [ctx.tenantId, ctx.membershipId, v.branchId])).rows[0];
  const number = await nextNumber(c, ctx.tenantId, 'incident');
  const row = (await c.query(
    `INSERT INTO security_incidents (tenant_id, branch_id, number, category, severity, room_id, place, description, source, sos_reason, alert_event_id, shift_id,
                                     reported_by, reported_by_name, reported_by_role, reported_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id, number`,
    [ctx.tenantId, v.branchId, number, v.category, v.severity, v.roomId ?? null, clean(v.place ?? null), clean(v.description), v.source, v.sosReason ?? null,
      v.alertEventId ?? null, shift?.id ?? null, ctx.membershipId, ctx.name, ctx.role, now()])).rows[0];
  await audit(c, ctx, v.source === 'sos' ? 'security.sos' : 'security.incident_create', 'security_incident', row.id,
    `Hodisa №${row.number}: ${v.category}, ${v.severity}${v.source !== 'manual' ? ` (${v.source})` : ''}`, v.branchId);
  return row as { id: string; number: number };
}

@Controller('security')
export class SecurityController {
  constructor(private db: Db) {}

  // ================================================================ panel

  /** The guard's panel: today's counters, expected patient arrivals by hour (counts only), camera health, recent recognitions. */
  @Roles(...G) @Get('overview')
  async overview(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const branches = branchScope(ctx, q.branch_id);
    const day = today(), from = dayStart(day), to = dayStart(addDays(day, 1));
    const counts = (await this.db.one(
      `SELECT
         (SELECT count(*)::int FROM camera_events e ${ALERT_JOINS_SQL}
           WHERE e.tenant_id = $1 AND e.alert AND ${ALERT_KINDS_SQL} AND e.branch_id = ANY($2) AND ${ALERT_STATE_SQL} <> 'resolved') AS open_alerts,
         (SELECT count(DISTINCT a.event_id)::int FROM security_alert_actions a
           WHERE a.tenant_id = $1 AND a.branch_id = ANY($2) AND a.action = 'resolve' AND a.acted_at >= $3 AND a.acted_at < $4) AS handled_today,
         (SELECT coalesce(sum(e.enter_count), 0)::int FROM camera_events e
           WHERE e.tenant_id = $1 AND e.kind = 'people_count' AND e.branch_id = ANY($2) AND e.occurred_at >= $3 AND e.occurred_at < $4) AS people_today,
         (SELECT count(*)::int FROM security_visitors v WHERE v.tenant_id = $1 AND v.branch_id = ANY($2) AND v.out_at IS NULL) AS visitors_inside,
         (SELECT count(*)::int FROM rooms r JOIN LATERAL (SELECT action FROM key_events k WHERE k.tenant_id = r.tenant_id AND k.room_id = r.id ORDER BY k.at DESC LIMIT 1) lk ON true
           WHERE r.tenant_id = $1 AND r.branch_id = ANY($2) AND lk.action = 'out') AS keys_out,
         (SELECT count(*)::int FROM security_incidents i WHERE i.tenant_id = $1 AND i.branch_id = ANY($2)
             AND i.reported_at >= (SELECT demo_now()) - interval '30 days'
             AND NOT EXISTS (SELECT 1 FROM security_incident_entries x WHERE x.incident_id = i.id AND x.kind = 'close')) AS open_incidents`,
      [ctx.tenantId, branches, from, to]))!;
    // expected patient arrivals per hour today: counts only, never a name or a time slot of a person
    const arrivals = await this.db.rows(
      `SELECT extract(hour FROM a.starts_at AT TIME ZONE 'Asia/Tashkent')::int AS hour, count(*)::int AS n,
              count(*) FILTER (WHERE a.status IN ('arrived', 'in_progress', 'completed'))::int AS came
         FROM appointments a WHERE a.tenant_id = $1 AND a.branch_id = ANY($2) AND a.starts_at >= $3 AND a.starts_at < $4 AND a.status NOT IN ('cancelled', 'no_show')
        GROUP BY 1 ORDER BY 1`, [ctx.tenantId, branches, from, to]);
    const cameras = await this.db.rows(
      `SELECT c.id, c.name, c.location, b.name AS branch_name, c.status, c.purposes, greatest(c.last_seen_at, c.last_event_at) AS last_seen_at,
              EXISTS (SELECT 1 FROM camera_events e ${ALERT_JOINS_SQL}
                       WHERE e.tenant_id = c.tenant_id AND e.camera_id = c.id AND e.alert AND e.kind = 'tamper' AND e.occurred_at >= (SELECT demo_now()) - interval '7 days'
                         AND ${ALERT_STATE_SQL} <> 'resolved') AS tamper
         FROM cameras c JOIN branches b ON b.id = c.branch_id
        WHERE c.tenant_id = $1 AND c.branch_id = ANY($2) ORDER BY b.name, c.name LIMIT 100`, [ctx.tenantId, branches]);
    const t = now().getTime();
    const cams = cameras.map((c) => ({
      id: c.id, name: c.name, location: c.location, branch_name: c.branch_name, last_seen_at: c.last_seen_at, tamper: c.tamper,
      // silent = nothing heard for a day (as the dashboard's attention block); never connected = «never»
      health: c.status !== 'active' ? 'off' : !c.last_seen_at ? 'never' : t - new Date(c.last_seen_at).getTime() > 24 * 3600_000 ? 'silent' : 'online',
    }));
    // the entrance cameras' recognitions: a staff member by name and position (written consent on file), a patient only as «Bemor»
    const faces = await this.db.rows(
      `SELECT e.occurred_at AS at, c.name AS camera_name, fc.subject_type,
              CASE WHEN fc.subject_type = 'staff' THEN u.full_name END AS name,
              CASE WHEN fc.subject_type = 'staff' THEN coalesce(d.specialty, m.title) END AS title,
              CASE WHEN fc.subject_type = 'staff' THEN m.role END AS role
         FROM camera_events e JOIN cameras c ON c.id = e.camera_id JOIN face_codes fc ON fc.id = e.face_code_id
         LEFT JOIN memberships m ON fc.subject_type = 'staff' AND m.id = fc.membership_id LEFT JOIN users u ON u.id = m.user_id
         LEFT JOIN doctors d ON d.membership_id = m.id AND d.tenant_id = m.tenant_id
        WHERE e.tenant_id = $1 AND e.kind = 'face_match' AND e.branch_id = ANY($2) AND e.occurred_at >= $3 AND e.occurred_at < $4
        ORDER BY e.occurred_at DESC LIMIT 8`, [ctx.tenantId, branches, from, to]);
    const presence = await staffPresence(this.db.pool, ctx.tenantId, branches);
    return {
      data: {
        counters: { ...counts, staff_on_site: presence.filter((p) => p.status === 'in').length, expected_today: arrivals.reduce((s, r) => s + r.n, 0) },
        arrivals_by_hour: arrivals,
        cameras: cams,
        recent_faces: faces.map((f) => (f.subject_type === 'staff'
          ? { at: f.at, camera_name: f.camera_name, subject: 'staff', name: f.name, title: f.title, role: f.role }
          : { at: f.at, camera_name: f.camera_name, subject: 'patient' })),
      },
    };
  }

  /** Staff of the session's branches for pickers (key holder, host, manual mark): name and position only. */
  @Roles(...G) @Get('staff')
  async staff(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const branches = branchScope(ctx, q.branch_id);
    return { data: await this.db.rows(
      `SELECT m.id AS membership_id, u.full_name, m.role, coalesce(d.specialty, m.title) AS title
         FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN doctors d ON d.membership_id = m.id AND d.tenant_id = m.tenant_id
        WHERE m.tenant_id = $1 AND m.status = 'active' AND m.branch_ids && $2 ORDER BY u.full_name LIMIT 500`, [ctx.tenantId, branches]) };
  }

  // ================================================================ alerts

  /** Security alerts: every open one (whatever its date) first, then the period's handled ones. */
  @Roles(...G) @Get('alerts')
  async alerts(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const branches = branchScope(ctx, q.branch_id);
    const { from, to, fromTs, toTs } = period(q, 1, 92);
    const { page, pageSize, offset } = pageParams(q);
    const base = `FROM camera_events e JOIN cameras c ON c.id = e.camera_id JOIN branches b ON b.id = e.branch_id ${ALERT_JOINS_SQL}
      LEFT JOIN camera_snapshots s ON s.event_id = e.id LEFT JOIN memberships km ON km.id = k.acked_by LEFT JOIN users ku ON ku.id = km.user_id
      WHERE e.tenant_id = $1 AND e.alert AND ${ALERT_KINDS_SQL} AND e.branch_id = ANY($2)`;
    const scope = `((e.occurred_at >= $3 AND e.occurred_at < $4) OR ${ALERT_STATE_SQL} <> 'resolved')`;
    const filter = q.state === 'open' ? `${ALERT_STATE_SQL} <> 'resolved'` : q.state === 'resolved' ? `${ALERT_STATE_SQL} = 'resolved'` : 'true';
    const rows = await this.db.rows(
      `SELECT e.id, e.kind, e.occurred_at, e.target, e.branch_id, b.name AS branch_name, c.id AS camera_id, c.name AS camera_name, c.location, c.security_mode,
              (s.event_id IS NOT NULL AND s.created_at >= (SELECT demo_now()) - make_interval(days => ${SNAPSHOT_DAYS})) AS has_snapshot,
              coalesce(la.seq, 0) AS seq, la.action AS last_action, la.outcome, la.note, la.actor_name, la.actor_role, la.acted_at, la.incident_id,
              ${ALERT_STATE_SQL} AS state,
              extract(epoch FROM coalesce(fa.acted_at, k.acked_at) - e.occurred_at)::int AS response_sec,
              k.acked_at, ku.full_name AS acked_by_name
       ${base} AND ${scope} AND ${filter}
       ORDER BY (${ALERT_STATE_SQL} <> 'resolved') DESC, e.occurred_at DESC LIMIT $5 OFFSET $6`,
      [ctx.tenantId, branches, fromTs, toTs, pageSize, offset]);
    const total = (await this.db.one(`SELECT count(*)::int AS n ${base} AND ${scope} AND ${filter}`, [ctx.tenantId, branches, fromTs, toTs]))!.n;
    return { data: rows, meta: { from, to, page, page_size: pageSize, total, snapshot_days: SNAPSHOT_DAYS } };
  }

  /**
   * The camera's picture of an alert, for the guard and the manager of the branch: only for a security alert (never a
   * face match or a count), only within SNAPSHOT_DAYS. Every view is audited.
   */
  @Roles(...G) @Get('alerts/:id/snapshot')
  async snapshot(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Res() res: Response) {
    if (!isUuid(id)) throw notFound('Surat');
    const s = await this.db.one(
      `SELECT s.content_type, s.bytes, e.branch_id FROM camera_snapshots s JOIN camera_events e ON e.id = s.event_id
        WHERE s.event_id = $1 AND s.tenant_id = $2 AND e.alert AND e.kind = ANY($3) AND s.created_at >= (SELECT demo_now()) - make_interval(days => $4)`,
      [id, ctx.tenantId, SECURITY_KINDS, SNAPSHOT_DAYS]);
    if (!s) throw notFound('Surat');
    assertBranch(ctx, s.branch_id);
    await audit(this.db.pool, ctx, 'security.snapshot_view', 'camera_event', id, 'Ogohlantirish surati ko‘rildi', s.branch_id);
    res.setHeader('Content-Type', s.content_type);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.end(s.bytes);
  }

  /** Locks the alert and returns its state; `seq` must be the step count the person saw (else 409 «refresh»). */
  private async lockAlert(c: PoolClient, ctx: Ctx, id: string, seq: number) {
    if (!isUuid(id)) throw notFound('Ogohlantirish');
    const e = (await c.query(
      `SELECT e.id, e.branch_id, e.kind FROM camera_events e WHERE e.id = $1 AND e.tenant_id = $2 AND e.alert AND ${ALERT_KINDS_SQL} FOR UPDATE`, [id, ctx.tenantId])).rows[0];
    if (!e) throw notFound('Ogohlantirish');
    assertBranch(ctx, e.branch_id);
    const st = (await c.query(
      `SELECT coalesce(la.seq, 0) AS seq, ${ALERT_STATE_SQL} AS state FROM camera_events e ${ALERT_JOINS_SQL} WHERE e.id = $1`, [id])).rows[0];
    if (st.seq !== seq) throw stale();
    return { event: e, state: st.state as 'new' | 'taken' | 'escalated' | 'resolved', seq: st.seq as number };
  }

  /** «Ko‘ryapman»: the guard (or the manager) takes the alert; the first step also starts the response-time clock. */
  @Roles(...G) @Post('alerts/:id/take') @HttpCode(200)
  async take(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(alertTakeSchema, body);
    return this.db.tx(async (c) => {
      const a = await this.lockAlert(c, ctx, id, input.seq);
      if (a.state !== 'new') throw stale('Bu ogohlantirishni kimdir allaqachon ko‘ryapti. Sahifani yangilang.');
      await c.query(
        `INSERT INTO security_alert_actions (tenant_id, event_id, branch_id, seq, action, actor_membership_id, actor_name, actor_role, acted_at)
         VALUES ($1,$2,$3,$4,'take',$5,$6,$7,$8)`, [ctx.tenantId, id, a.event.branch_id, a.seq + 1, ctx.membershipId, ctx.name, ctx.role, now()]);
      await audit(c, ctx, 'security.alert_take', 'camera_event', id, 'Ogohlantirish ko‘rib chiqilmoqda', a.event.branch_id);
      return { data: { id, state: 'taken', seq: a.seq + 1 } };
    });
  }

  /** Resolves an alert with an outcome: false alarm / checked / incident (filed and linked) / escalated (manager closes). */
  @Roles(...G) @Post('alerts/:id/resolve') @HttpCode(200)
  async resolve(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(alertResolveSchema, body);
    if (input.outcome === 'escalated' && ctx.role === 'manager') throw invalid({ outcome: 'Rahbar ogohlantirishni o‘zi yopadi' });
    return this.db.tx(async (c) => {
      const a = await this.lockAlert(c, ctx, id, input.seq);
      if (a.state === 'resolved') throw stale('Bu ogohlantirish allaqachon yopilgan. Sahifani yangilang.');
      if (a.state === 'escalated' && ctx.role !== 'manager') throw forbidden('Rahbarga yuborilgan ogohlantirishni rahbar yopadi');
      let incident: { id: string; number: number } | null = null;
      if (input.outcome === 'incident') {
        incident = await insertIncident(c, ctx, { branchId: a.event.branch_id, ...input.incident!, source: 'alert', alertEventId: id });
      }
      await c.query(
        `INSERT INTO security_alert_actions (tenant_id, event_id, branch_id, seq, action, outcome, note, incident_id, actor_membership_id, actor_name, actor_role, acted_at)
         VALUES ($1,$2,$3,$4,'resolve',$5,$6,$7,$8,$9,$10,$11)`,
        [ctx.tenantId, id, a.event.branch_id, a.seq + 1, input.outcome, clean(input.note), incident?.id ?? null, ctx.membershipId, ctx.name, ctx.role, now()]);
      // a closed alert leaves the dashboard's «open alerts» (the cameras page shows who handled it)
      if (input.outcome !== 'escalated')
        await c.query(`INSERT INTO camera_event_acks (event_id, tenant_id, acked_by, acked_at) VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING`, [id, ctx.tenantId, ctx.membershipId, now()]);
      await audit(c, ctx, input.outcome === 'escalated' ? 'security.alert_escalate' : 'security.alert_resolve', 'camera_event', id,
        `Ogohlantirish: ${input.outcome}${incident ? `, hodisa №${incident.number}` : ''}`, a.event.branch_id);
      return { data: { id, state: input.outcome === 'escalated' ? 'escalated' : 'resolved', seq: a.seq + 1, incident } };
    });
  }

  // ================================================================ incidents

  @Roles(...G) @Get('incidents')
  async incidents(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const branches = branchScope(ctx, q.branch_id);
    const { from, to, fromTs, toTs } = period(q, 30);
    const { page, pageSize, offset } = pageParams(q);
    const closed = `EXISTS (SELECT 1 FROM security_incident_entries x WHERE x.incident_id = i.id AND x.kind = 'close')`;
    // an open incident stays on the list whatever its date
    const where = `i.tenant_id = $1 AND i.branch_id = ANY($2) AND ((i.reported_at >= $3 AND i.reported_at < $4) OR NOT ${closed})
      AND ($5::text IS NULL OR ($5 = 'open' AND NOT ${closed}) OR ($5 = 'closed' AND ${closed}))
      AND ($6::text IS NULL OR i.category = $6) AND ($7::text IS NULL OR i.source = $7)`;
    const params = [ctx.tenantId, branches, fromTs, toTs, ['open', 'closed'].includes(q.status) ? q.status : null,
      (INCIDENT_CATEGORIES as readonly string[]).includes(q.category) ? q.category : null, ['manual', 'alert', 'sos', 'patrol'].includes(q.source) ? q.source : null];
    const rows = await this.db.rows(
      `SELECT i.id, i.number, i.category, i.severity, i.source, i.sos_reason, i.place, i.description, i.reported_at, i.reported_by_name, i.reported_by_role,
              i.alert_event_id, b.name AS branch_name, r.name AS room_name, ${closed} AS closed,
              EXISTS (SELECT 1 FROM security_incident_entries x WHERE x.incident_id = i.id AND x.kind = 'seen') AS seen,
              (SELECT count(*)::int FROM security_incident_entries x WHERE x.incident_id = i.id AND x.kind IN ('note', 'correction')) AS entries
         FROM security_incidents i JOIN branches b ON b.id = i.branch_id LEFT JOIN rooms r ON r.id = i.room_id
        WHERE ${where}
        ORDER BY (NOT ${closed}) DESC, CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, i.reported_at DESC
        LIMIT $8 OFFSET $9`, [...params, pageSize, offset]);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM security_incidents i WHERE ${where}`, params))!.n;
    return { data: rows, meta: { from, to, page, page_size: pageSize, total } };
  }

  private async incident(q: Q, ctx: Ctx, id: string, lock = false) {
    if (!isUuid(id)) throw notFound('Hodisa yozuvi');
    const i = (await q.query(`SELECT * FROM security_incidents WHERE id = $1 AND tenant_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [id, ctx.tenantId])).rows[0];
    if (!i) throw notFound('Hodisa yozuvi');
    assertBranch(ctx, i.branch_id);
    return i;
  }

  @Roles(...G) @Get('incidents/:id')
  async incidentOne(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const i = await this.incident(this.db.pool, ctx, id);
    const extra = await this.db.one(
      `SELECT b.name AS branch_name, r.name AS room_name, c.name AS camera_name, e.kind AS alert_kind, e.occurred_at AS alert_at
         FROM branches b LEFT JOIN rooms r ON r.id = $2 LEFT JOIN camera_events e ON e.id = $3 LEFT JOIN cameras c ON c.id = e.camera_id WHERE b.id = $1`,
      [i.branch_id, i.room_id, i.alert_event_id]);
    const entries = await this.db.rows(
      `SELECT id, kind, text, author_name, author_role, created_at FROM security_incident_entries WHERE incident_id = $1 ORDER BY created_at, id LIMIT 200`, [id]);
    const { tenant_id: _t, ...rest } = i;
    return { data: { ...rest, ...extra, closed: entries.some((e) => e.kind === 'close'), seen: entries.some((e) => e.kind === 'seen'), entries } };
  }

  @Roles(...G) @Post('incidents') @HttpCode(201)
  async createIncident(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(incidentCreateSchema, body);
    const branchId = writeBranch(ctx, input.branch_id);
    return this.db.tx(async (c) => ({ data: await insertIncident(c, ctx, { branchId, ...input, roomId: input.room_id, source: 'manual' }) }));
  }

  /** An addition or a correction (a new row — the first text is never edited); closing with a resolution is the manager's. */
  @Roles(...G) @Post('incidents/:id/entries') @HttpCode(201)
  async incidentEntry(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(incidentEntrySchema, body);
    if (input.kind === 'close' && ctx.role !== 'manager') throw forbidden('Hodisani rahbar yopadi');
    return this.db.tx(async (c) => {
      const i = await this.incident(c, ctx, id, true);
      if ((await c.query(`SELECT 1 FROM security_incident_entries WHERE incident_id = $1 AND kind = 'close'`, [id])).rowCount)
        throw conflict('INCIDENT_CLOSED', 'Hodisa yopilgan. Sahifani yangilang.');
      const r = (await c.query(
        `INSERT INTO security_incident_entries (tenant_id, incident_id, kind, text, author_membership_id, author_name, author_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [ctx.tenantId, id, input.kind, clean(input.text), ctx.membershipId, ctx.name, ctx.role, now()])).rows[0];
      await audit(c, ctx, input.kind === 'close' ? 'security.incident_close' : 'security.incident_entry', 'security_incident', id,
        `Hodisa №${i.number}: ${input.kind}`, i.branch_id);
      return { data: { id: r.id } };
    });
  }

  /** The manager has seen it (the alarm banner goes away). Idempotent. */
  @Roles('manager') @Post('incidents/:id/seen') @HttpCode(200)
  async seen(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(async (c) => {
      const i = await this.incident(c, ctx, id, true);
      const r = await c.query(
        `INSERT INTO security_incident_entries (tenant_id, incident_id, kind, author_membership_id, author_name, author_role, created_at)
         VALUES ($1,$2,'seen',$3,$4,$5,$6) ON CONFLICT (incident_id) WHERE kind = 'seen' DO NOTHING`, [ctx.tenantId, id, ctx.membershipId, ctx.name, ctx.role, now()]);
      if (r.rowCount) await audit(c, ctx, 'security.incident_seen', 'security_incident', id, `Hodisa №${i.number}: rahbar ko‘rdi`, i.branch_id);
      return { data: { id } };
    });
  }

  /** «Rahbarga xabar»: a critical incident with a preset reason; the manager's shell shows a banner until it is seen. */
  @Roles('guard') @Post('sos') @HttpCode(201)
  async sos(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(sosSchema, body);
    const branchId = writeBranch(ctx, input.branch_id);
    const label = translate('uz', `guard.sos.reason.${input.reason}` as MessageKey);
    return this.db.tx(async (c) => ({ data: await insertIncident(c, ctx, {
      branchId, category: SOS_CATEGORY[input.reason], severity: 'critical', description: input.note ? `${label}. ${input.note}` : label, source: 'sos', sosReason: input.reason,
    }) }));
  }

  /** The manager's alarm banner: unseen SOS calls of the last day and alerts the guard escalated. Polled by the shell. */
  @Roles('manager') @Get('alarms')
  async alarms(@CurrentCtx() ctx: Ctx) {
    const sos = await this.db.rows(
      `SELECT i.id, i.number, i.sos_reason, i.reported_at, i.reported_by_name, b.name AS branch_name
         FROM security_incidents i JOIN branches b ON b.id = i.branch_id
        WHERE i.tenant_id = $1 AND i.source = 'sos' AND i.branch_id = ANY($2) AND i.reported_at >= (SELECT demo_now()) - interval '24 hours'
          AND NOT EXISTS (SELECT 1 FROM security_incident_entries x WHERE x.incident_id = i.id AND x.kind IN ('seen', 'close'))
        ORDER BY i.reported_at DESC LIMIT 10`, [ctx.tenantId, ctx.branchIds]);
    const escalated = await this.db.rows(
      `SELECT e.id, e.kind, e.occurred_at, c.name AS camera_name, b.name AS branch_name, la.actor_name, la.acted_at, la.seq
         FROM camera_events e JOIN cameras c ON c.id = e.camera_id JOIN branches b ON b.id = e.branch_id ${ALERT_JOINS_SQL}
        WHERE e.tenant_id = $1 AND e.alert AND ${ALERT_KINDS_SQL} AND e.branch_id = ANY($2) AND ${ALERT_STATE_SQL} = 'escalated'
        ORDER BY la.acted_at DESC LIMIT 10`, [ctx.tenantId, ctx.branchIds]);
    return { data: { sos, escalated } };
  }

  // ================================================================ visitors

  @Roles(...G) @Get('visitors')
  async visitors(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const branches = branchScope(ctx, q.branch_id);
    const cols = `v.id, v.branch_id, b.name AS branch_name, v.full_name, v.organisation, v.purpose, v.purpose_note, v.host_name, v.pass_no, v.in_at, v.out_at, v.recorded_by_name, v.purged_at`;
    if (q.inside === '1') {
      return { data: await this.db.rows(
        `SELECT ${cols} FROM security_visitors v JOIN branches b ON b.id = v.branch_id
          WHERE v.tenant_id = $1 AND v.branch_id = ANY($2) AND v.out_at IS NULL ORDER BY v.in_at LIMIT 200`, [ctx.tenantId, branches]) };
    }
    const { from, to, fromTs, toTs } = period(q, 1);
    const { page, pageSize, offset } = pageParams(q);
    const where = `v.tenant_id = $1 AND v.branch_id = ANY($2) AND v.in_at >= $3 AND v.in_at < $4`;
    const rows = await this.db.rows(`SELECT ${cols} FROM security_visitors v JOIN branches b ON b.id = v.branch_id WHERE ${where} ORDER BY v.in_at DESC LIMIT $5 OFFSET $6`,
      [ctx.tenantId, branches, fromTs, toTs, pageSize, offset]);
    const m = (await this.db.one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE v.out_at IS NULL)::int AS inside FROM security_visitors v WHERE ${where}`, [ctx.tenantId, branches, fromTs, toTs]))!;
    return { data: rows, meta: { from, to, page, page_size: pageSize, total: m.total, inside: m.inside, retention_days: VISITOR_RETENTION_DAYS } };
  }

  @Roles(...G) @Post('visitors') @HttpCode(201)
  async addVisitor(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(visitorCreateSchema, body);
    const branchId = writeBranch(ctx, input.branch_id);
    return this.db.tx(async (c) => {
      const host = input.host_membership_id ? await staffMember(c, ctx, input.host_membership_id) : null;
      const r = (await c.query(
        `INSERT INTO security_visitors (tenant_id, branch_id, full_name, organisation, purpose, purpose_note, host_membership_id, host_name, pass_no, in_at, recorded_by, recorded_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [ctx.tenantId, branchId, input.full_name, clean(input.organisation), input.purpose, clean(input.purpose_note), host?.id ?? null, host?.full_name ?? null,
          input.pass_no, now(), ctx.membershipId, ctx.name])).rows[0];
      // the visitor's name stays out of the audit trail (it is purged from the log after the retention period)
      await audit(c, ctx, 'security.visitor_in', 'security_visitor', r.id, `Tashrif buyuruvchi kirdi (${input.purpose})`, branchId);
      return { data: { id: r.id } };
    });
  }

  @Roles(...G) @Post('visitors/:id/out') @HttpCode(200)
  async visitorOut(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Tashrif buyuruvchi');
    return this.db.tx(async (c) => {
      const v = (await c.query(`SELECT id, branch_id, out_at FROM security_visitors WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (!v) throw notFound('Tashrif buyuruvchi');
      assertBranch(ctx, v.branch_id);
      if (v.out_at) throw stale('Bu tashrif buyuruvchi allaqachon chiqqan. Sahifani yangilang.');
      await c.query(`UPDATE security_visitors SET out_at = $2, out_by = $3 WHERE id = $1`, [id, now(), ctx.membershipId]);
      await audit(c, ctx, 'security.visitor_out', 'security_visitor', id, 'Tashrif buyuruvchi chiqdi', v.branch_id);
      return { data: { id } };
    });
  }

  // ================================================================ keys

  /** Every room of the branch with its key: in place, or out (who, since when, overdue after KEY_DUE_HOUR). */
  @Roles(...G) @Get('keys')
  async keys(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const branches = branchScope(ctx, q.branch_id);
    const rows = await this.db.rows(
      `SELECT r.id AS room_id, r.name AS room_name, r.purpose, r.branch_id, b.name AS branch_name, lk.action, lk.holder_membership_id, lk.holder_name, lk.at, lk.by_name
         FROM rooms r JOIN branches b ON b.id = r.branch_id
         LEFT JOIN LATERAL (SELECT k.action, k.holder_membership_id, k.holder_name, k.at, k.by_name FROM key_events k
                             WHERE k.tenant_id = r.tenant_id AND k.room_id = r.id ORDER BY k.at DESC, k.id DESC LIMIT 1) lk ON true
        WHERE r.tenant_id = $1 AND r.branch_id = ANY($2) AND (r.active OR lk.action = 'out') ORDER BY b.name, r.name LIMIT 300`, [ctx.tenantId, branches]);
    return { data: rows.map((r) => ({ ...r, out: r.action === 'out', overdue: r.action === 'out' && keyOverdue(new Date(r.at)) })) };
  }

  @Roles(...G) @Get('keys/log')
  async keyLog(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const branches = branchScope(ctx, q.branch_id);
    const { from, to, fromTs, toTs } = period(q, 1);
    const { page, pageSize, offset } = pageParams(q);
    const where = `k.tenant_id = $1 AND k.branch_id = ANY($2) AND k.at >= $3 AND k.at < $4`;
    const rows = await this.db.rows(
      `SELECT k.id, k.action, k.room_id, r.name AS room_name, k.holder_name, k.note, k.by_name, k.at FROM key_events k JOIN rooms r ON r.id = k.room_id
        WHERE ${where} ORDER BY k.at DESC LIMIT $5 OFFSET $6`, [ctx.tenantId, branches, fromTs, toTs, pageSize, offset]);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM key_events k WHERE ${where}`, [ctx.tenantId, branches, fromTs, toTs]))!.n;
    return { data: rows, meta: { from, to, page, page_size: pageSize, total } };
  }

  /** Locks the room row: two guards handing the same key collide here, the second gets 409. */
  private async lockRoom(c: Q, ctx: Ctx, roomId: string) {
    if (!isUuid(roomId)) throw notFound('Xona');
    const r = (await c.query(`SELECT id, branch_id, name FROM rooms WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [roomId, ctx.tenantId])).rows[0];
    if (!r) throw notFound('Xona');
    assertBranch(ctx, r.branch_id);
    const last = (await c.query(`SELECT action, holder_membership_id FROM key_events WHERE tenant_id = $1 AND room_id = $2 ORDER BY at DESC, id DESC LIMIT 1`, [ctx.tenantId, roomId])).rows[0];
    return { room: r, last };
  }

  @Roles(...G) @Post('keys/:roomId/out') @HttpCode(201)
  async keyOut(@CurrentCtx() ctx: Ctx, @Param('roomId') roomId: string, @Body() body: unknown) {
    const input = parse(keyOutSchema, body);
    return this.db.tx(async (c) => {
      const { room, last } = await this.lockRoom(c, ctx, roomId);
      if (last?.action === 'out') throw stale('Bu kalit allaqachon berilgan. Sahifani yangilang.');
      const holder = await staffMember(c, ctx, input.holder_membership_id);
      await c.query(
        `INSERT INTO key_events (tenant_id, branch_id, room_id, action, holder_membership_id, holder_name, note, by_membership_id, by_name, at)
         VALUES ($1,$2,$3,'out',$4,$5,$6,$7,$8,$9)`, [ctx.tenantId, room.branch_id, room.id, holder.id, holder.full_name, clean(input.note), ctx.membershipId, ctx.name, now()]);
      await audit(c, ctx, 'security.key_out', 'room', room.id, `Kalit berildi: ${room.name} → ${holder.full_name}`, room.branch_id);
      return { data: { room_id: room.id } };
    });
  }

  @Roles(...G) @Post('keys/:roomId/in') @HttpCode(201)
  async keyIn(@CurrentCtx() ctx: Ctx, @Param('roomId') roomId: string, @Body() body: unknown) {
    const input = parse(keyInSchema, body);
    return this.db.tx(async (c) => {
      const { room, last } = await this.lockRoom(c, ctx, roomId);
      if (last?.action !== 'out') throw stale('Bu kalit allaqachon joyida. Sahifani yangilang.');
      const holder = await staffMember(c, ctx, input.holder_membership_id ?? last.holder_membership_id);
      await c.query(
        `INSERT INTO key_events (tenant_id, branch_id, room_id, action, holder_membership_id, holder_name, note, by_membership_id, by_name, at)
         VALUES ($1,$2,$3,'in',$4,$5,$6,$7,$8,$9)`, [ctx.tenantId, room.branch_id, room.id, holder.id, holder.full_name, clean(input.note), ctx.membershipId, ctx.name, now()]);
      await audit(c, ctx, 'security.key_in', 'room', room.id, `Kalit qaytarildi: ${room.name}`, room.branch_id);
      return { data: { room_id: room.id } };
    });
  }

  // ================================================================ patrol

  @Roles(...G) @Get('checkpoints')
  async checkpoints(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const branches = branchScope(ctx, q.branch_id);
    const all = q.all === '1' && ctx.role === 'manager';
    return { data: await this.db.rows(
      `SELECT p.id, p.branch_id, b.name AS branch_name, p.name, p.position, p.active FROM patrol_checkpoints p JOIN branches b ON b.id = p.branch_id
        WHERE p.tenant_id = $1 AND p.branch_id = ANY($2) ${all ? '' : 'AND p.active'} ORDER BY b.name, p.active DESC, p.position, p.name LIMIT 300`, [ctx.tenantId, branches]) };
  }

  @Roles('manager') @Post('checkpoints') @HttpCode(201)
  async addCheckpoint(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(checkpointCreateSchema, body);
    assertBranch(ctx, input.branch_id);
    return this.db.tx(async (c) => {
      const pos = input.position ?? (await c.query(`SELECT coalesce(max(position), 0) + 1 AS n FROM patrol_checkpoints WHERE tenant_id = $1 AND branch_id = $2`, [ctx.tenantId, input.branch_id])).rows[0].n;
      const r = (await c.query(`INSERT INTO patrol_checkpoints (tenant_id, branch_id, name, position, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [ctx.tenantId, input.branch_id, input.name, Math.min(999, pos), now()])).rows[0];
      await audit(c, ctx, 'security.checkpoint_create', 'patrol_checkpoint', r.id, `Nazorat nuqtasi: «${input.name}»`, input.branch_id);
      return { data: { id: r.id } };
    });
  }

  @Roles('manager') @Patch('checkpoints/:id')
  async patchCheckpoint(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(checkpointPatchSchema, body);
    if (!isUuid(id)) throw notFound('Nazorat nuqtasi');
    return this.db.tx(async (c) => {
      const p = (await c.query(`SELECT * FROM patrol_checkpoints WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (!p) throw notFound('Nazorat nuqtasi');
      assertBranch(ctx, p.branch_id);
      await c.query(`UPDATE patrol_checkpoints SET name = $2, position = $3, active = $4 WHERE id = $1`, [id, input.name ?? p.name, input.position ?? p.position, input.active ?? p.active]);
      await audit(c, ctx, 'security.checkpoint_update', 'patrol_checkpoint', id, `Nazorat nuqtasi o‘zgardi: «${input.name ?? p.name}»`, p.branch_id);
      return { data: { id } };
    });
  }

  /** The guard's own open round (with the checkpoints and their marks), or the active checkpoints to start one. */
  @Roles(...G) @Get('rounds/current')
  async currentRound(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const round = await this.db.one(
      `SELECT r.id, r.branch_id, b.name AS branch_name, r.started_at, r.checkpoints_total FROM patrol_rounds r JOIN branches b ON b.id = r.branch_id
        WHERE r.tenant_id = $1 AND r.guard_membership_id = $2 AND r.finished_at IS NULL`, [ctx.tenantId, ctx.membershipId]);
    const branches = round ? [round.branch_id] : branchScope(ctx, q.branch_id);
    const points = await this.db.rows(
      `SELECT p.id, p.name, p.position, p.branch_id, m.result, m.note, m.marked_at, m.incident_id
         FROM patrol_checkpoints p LEFT JOIN patrol_marks m ON m.checkpoint_id = p.id AND m.round_id = $3
        WHERE p.tenant_id = $1 AND p.branch_id = ANY($2) AND (p.active OR m.id IS NOT NULL) ORDER BY p.position, p.name LIMIT 200`,
      [ctx.tenantId, branches, round?.id ?? null]);
    const last = await this.db.one(
      `SELECT r.finished_at, r.guard_name FROM patrol_rounds r WHERE r.tenant_id = $1 AND r.branch_id = ANY($2) AND r.finished_at IS NOT NULL ORDER BY r.finished_at DESC LIMIT 1`,
      [ctx.tenantId, branches]);
    return { data: { round: round ?? null, checkpoints: points, last_finished_at: last?.finished_at ?? null, interval_hours: PATROL_INTERVAL_HOURS } };
  }

  @Roles(...G) @Get('rounds')
  async rounds(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const branches = branchScope(ctx, q.branch_id);
    const { from, to, fromTs, toTs } = period(q, 7);
    const { page, pageSize, offset } = pageParams(q);
    const where = `r.tenant_id = $1 AND r.branch_id = ANY($2) AND r.started_at >= $3 AND r.started_at < $4`;
    const rows = await this.db.rows(
      `SELECT r.id, r.branch_id, b.name AS branch_name, r.guard_name, r.started_at, r.finished_at, r.checkpoints_total,
              (SELECT count(*)::int FROM patrol_marks m WHERE m.round_id = r.id) AS marked,
              (SELECT count(*)::int FROM patrol_marks m WHERE m.round_id = r.id AND m.result = 'problem') AS problems,
              (SELECT json_agg(json_build_object('name', p.name, 'note', m.note) ORDER BY p.position) FROM patrol_marks m JOIN patrol_checkpoints p ON p.id = m.checkpoint_id
                WHERE m.round_id = r.id AND m.result = 'problem') AS problem_list
         FROM patrol_rounds r JOIN branches b ON b.id = r.branch_id WHERE ${where} ORDER BY r.started_at DESC LIMIT $5 OFFSET $6`,
      [ctx.tenantId, branches, fromTs, toTs, pageSize, offset]);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM patrol_rounds r WHERE ${where}`, [ctx.tenantId, branches, fromTs, toTs]))!.n;
    return { data: rows, meta: { from, to, page, page_size: pageSize, total } };
  }

  @Roles('guard') @Post('rounds') @HttpCode(201)
  async startRound(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(roundStartSchema, body);
    const branchId = writeBranch(ctx, input.branch_id);
    return this.db.tx(async (c) => {
      await c.query(`SELECT id FROM memberships WHERE id = $1 FOR UPDATE`, [ctx.membershipId]); // one start at a time per guard
      if ((await c.query(`SELECT 1 FROM patrol_rounds WHERE tenant_id = $1 AND guard_membership_id = $2 AND finished_at IS NULL`, [ctx.tenantId, ctx.membershipId])).rowCount)
        throw conflict('ROUND_OPEN', 'Tugallanmagan obxodingiz bor. Sahifani yangilang.');
      const n = (await c.query(`SELECT count(*)::int AS n FROM patrol_checkpoints WHERE tenant_id = $1 AND branch_id = $2 AND active`, [ctx.tenantId, branchId])).rows[0].n;
      if (!n) throw new AppError(422, 'NO_CHECKPOINTS', 'Bu filialda nazorat nuqtalari yo‘q — ularni rahbar qo‘shadi');
      const shift = (await c.query(`SELECT id FROM guard_shifts WHERE tenant_id = $1 AND guard_membership_id = $2 AND branch_id = $3 AND closed_at IS NULL`, [ctx.tenantId, ctx.membershipId, branchId])).rows[0];
      const r = (await c.query(
        `INSERT INTO patrol_rounds (tenant_id, branch_id, shift_id, guard_membership_id, guard_name, checkpoints_total, started_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [ctx.tenantId, branchId, shift?.id ?? null, ctx.membershipId, ctx.name, n, now()])).rows[0];
      await audit(c, ctx, 'security.round_start', 'patrol_round', r.id, `Obxod boshlandi (${n} ta nuqta)`, branchId);
      return { data: { id: r.id } };
    });
  }

  private async lockOwnRound(c: Q, ctx: Ctx, id: string) {
    if (!isUuid(id)) throw notFound('Obxod');
    const r = (await c.query(`SELECT * FROM patrol_rounds WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
    if (!r) throw notFound('Obxod');
    assertBranch(ctx, r.branch_id);
    if (r.guard_membership_id !== ctx.membershipId) throw forbidden('Bu obxod sizniki emas');
    if (r.finished_at) throw stale('Obxod allaqachon tugagan. Sahifani yangilang.');
    return r;
  }

  @Roles('guard') @Post('rounds/:id/marks') @HttpCode(201)
  async mark(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(roundMarkSchema, body);
    return this.db.tx(async (c) => {
      const r = await this.lockOwnRound(c, ctx, id);
      const p = (await c.query(`SELECT id, name FROM patrol_checkpoints WHERE id = $1 AND tenant_id = $2 AND branch_id = $3`, [input.checkpoint_id, ctx.tenantId, r.branch_id])).rows[0];
      if (!p) throw invalid({ checkpoint_id: 'Nazorat nuqtasi topilmadi' });
      if ((await c.query(`SELECT 1 FROM patrol_marks WHERE round_id = $1 AND checkpoint_id = $2`, [id, p.id])).rowCount)
        throw stale('Bu nuqta allaqachon belgilangan. Sahifani yangilang.');
      let incident: { id: string; number: number } | null = null;
      if (input.result === 'problem' && input.incident)
        incident = await insertIncident(c, ctx, { branchId: r.branch_id, ...input.incident, description: input.note!, place: p.name, source: 'patrol' });
      await c.query(`INSERT INTO patrol_marks (tenant_id, round_id, checkpoint_id, result, note, incident_id, marked_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ctx.tenantId, id, p.id, input.result, clean(input.note), incident?.id ?? null, now()]);
      if (input.result === 'problem') await audit(c, ctx, 'security.round_problem', 'patrol_round', id, `Obxod: muammo — «${p.name}»`, r.branch_id);
      return { data: { id, incident } };
    });
  }

  @Roles('guard') @Post('rounds/:id/finish') @HttpCode(200)
  async finishRound(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(async (c) => {
      const r = await this.lockOwnRound(c, ctx, id);
      const marked = (await c.query(`SELECT count(*)::int AS n FROM patrol_marks WHERE round_id = $1`, [id])).rows[0].n;
      await c.query(`UPDATE patrol_rounds SET finished_at = $2 WHERE id = $1`, [id, now()]);
      await audit(c, ctx, 'security.round_finish', 'patrol_round', id, `Obxod tugadi: ${marked}/${r.checkpoints_total}`, r.branch_id);
      return { data: { id, marked, total: r.checkpoints_total } };
    });
  }

  // ================================================================ post shift and handover

  /** What is still open at the post: alerts, incidents, keys out, visitors inside (the handover checklist). */
  private async openItems(branches: string[], tenantId: string) {
    const alerts = (await this.db.one(
      `SELECT count(*)::int AS n FROM camera_events e ${ALERT_JOINS_SQL} WHERE e.tenant_id = $1 AND e.alert AND ${ALERT_KINDS_SQL} AND e.branch_id = ANY($2) AND ${ALERT_STATE_SQL} <> 'resolved'`,
      [tenantId, branches]))!.n;
    const incidents = await this.db.rows(
      `SELECT i.id, i.number, i.category, i.severity, i.reported_at FROM security_incidents i
        WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.reported_at >= (SELECT demo_now()) - interval '30 days'
          AND NOT EXISTS (SELECT 1 FROM security_incident_entries x WHERE x.incident_id = i.id AND x.kind = 'close') ORDER BY i.reported_at DESC LIMIT 20`, [tenantId, branches]);
    const keys = (await this.db.rows(
      `SELECT r.id AS room_id, r.name AS room_name, lk.holder_name, lk.at FROM rooms r
         JOIN LATERAL (SELECT action, holder_name, at FROM key_events k WHERE k.tenant_id = r.tenant_id AND k.room_id = r.id ORDER BY k.at DESC, k.id DESC LIMIT 1) lk ON true
        WHERE r.tenant_id = $1 AND r.branch_id = ANY($2) AND lk.action = 'out' ORDER BY lk.at LIMIT 50`, [tenantId, branches])).map((k) => ({ ...k, overdue: keyOverdue(new Date(k.at)) }));
    const visitors = await this.db.rows(
      `SELECT v.id, v.full_name, v.organisation, v.purpose, v.host_name, v.in_at FROM security_visitors v
        WHERE v.tenant_id = $1 AND v.branch_id = ANY($2) AND v.out_at IS NULL ORDER BY v.in_at LIMIT 50`, [tenantId, branches]);
    return { alerts_open: alerts, incidents, keys_out: keys, visitors_inside: visitors };
  }

  @Roles(...G) @Get('shifts/current')
  async currentShift(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const shift = await this.db.one(
      `SELECT s.id, s.number, s.branch_id, b.name AS branch_name, s.opened_at FROM guard_shifts s JOIN branches b ON b.id = s.branch_id
        WHERE s.tenant_id = $1 AND s.guard_membership_id = $2 AND s.closed_at IS NULL`, [ctx.tenantId, ctx.membershipId]);
    const branches = shift ? [shift.branch_id] : branchScope(ctx, q.branch_id);
    const previous = await this.db.one(
      `SELECT s.id, s.number, s.guard_name, s.opened_at, s.closed_at, s.handover_note, b.name AS branch_name FROM guard_shifts s JOIN branches b ON b.id = s.branch_id
        WHERE s.tenant_id = $1 AND s.branch_id = ANY($2) AND s.closed_at IS NOT NULL ORDER BY s.closed_at DESC LIMIT 1`, [ctx.tenantId, branches]);
    return { data: { shift: shift ?? null, previous: previous ?? null, open_items: await this.openItems(branches, ctx.tenantId) } };
  }

  @Roles(...G) @Get('shifts')
  async shifts(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const branches = branchScope(ctx, q.branch_id);
    const { from, to, fromTs, toTs } = period(q, 7);
    const { page, pageSize, offset } = pageParams(q);
    const where = `s.tenant_id = $1 AND s.branch_id = ANY($2) AND s.opened_at < $4 AND coalesce(s.closed_at, (SELECT demo_now())) >= $3`;
    const rows = await this.db.rows(
      `SELECT s.id, s.number, s.branch_id, b.name AS branch_name, s.guard_name, s.opened_at, s.closed_at, (s.handover_note IS NOT NULL) AS has_handover,
              (SELECT count(*)::int FROM patrol_rounds r WHERE r.shift_id = s.id AND r.finished_at IS NOT NULL) AS rounds
         FROM guard_shifts s JOIN branches b ON b.id = s.branch_id WHERE ${where} ORDER BY s.opened_at DESC LIMIT $5 OFFSET $6`,
      [ctx.tenantId, branches, fromTs, toTs, pageSize, offset]);
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM guard_shifts s WHERE ${where}`, [ctx.tenantId, branches, fromTs, toTs]))!.n;
    return { data: rows, meta: { from, to, page, page_size: pageSize, total } };
  }

  @Roles('guard') @Post('shifts') @HttpCode(201)
  async openShift(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(guardShiftOpenSchema, body);
    const branchId = writeBranch(ctx, input.branch_id);
    return this.db.tx(async (c) => {
      await c.query(`SELECT id FROM memberships WHERE id = $1 FOR UPDATE`, [ctx.membershipId]);
      if ((await c.query(`SELECT 1 FROM guard_shifts WHERE tenant_id = $1 AND guard_membership_id = $2 AND closed_at IS NULL`, [ctx.tenantId, ctx.membershipId])).rowCount)
        throw conflict('SHIFT_OPEN', 'Smenangiz allaqachon ochiq. Sahifani yangilang.');
      const number = await nextNumber(c, ctx.tenantId, 'shift');
      const r = (await c.query(`INSERT INTO guard_shifts (tenant_id, branch_id, number, guard_membership_id, guard_name, opened_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [ctx.tenantId, branchId, number, ctx.membershipId, ctx.name, now()])).rows[0];
      await audit(c, ctx, 'security.shift_open', 'guard_shift', r.id, `Qorovul smenasi №${number} ochildi`, branchId);
      return { data: { id: r.id, number } };
    });
  }

  @Roles('guard') @Post('shifts/:id/close') @HttpCode(200)
  async closeShift(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(guardShiftCloseSchema, body);
    if (!isUuid(id)) throw notFound('Qorovul smenasi');
    return this.db.tx(async (c) => {
      const s = (await c.query(`SELECT * FROM guard_shifts WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (!s) throw notFound('Qorovul smenasi');
      assertBranch(ctx, s.branch_id);
      if (s.guard_membership_id !== ctx.membershipId) throw forbidden('Bu smena sizniki emas');
      if (s.closed_at) throw stale('Smena allaqachon yopilgan. Sahifani yangilang.');
      // an open patrol round of this guard ends with the shift (its missing points stay missing)
      await c.query(`UPDATE patrol_rounds SET finished_at = $3 WHERE tenant_id = $1 AND guard_membership_id = $2 AND finished_at IS NULL`, [ctx.tenantId, ctx.membershipId, now()]);
      await c.query(`UPDATE guard_shifts SET closed_at = $2, closed_by = $3, handover_note = $4 WHERE id = $1`, [id, now(), ctx.membershipId, clean(input.handover_note)]);
      await audit(c, ctx, 'security.shift_close', 'guard_shift', id, `Qorovul smenasi №${s.number} yopildi`, s.branch_id);
      return { data: { id } };
    });
  }

  /** The A4 shift report: the post's open items at hand-over time plus everything recorded during the shift. */
  @Roles(...G) @Get('shifts/:id')
  async shiftReport(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Qorovul smenasi');
    const s = await this.db.one(
      `SELECT s.id, s.number, s.branch_id, b.name AS branch_name, s.guard_name, s.opened_at, s.closed_at, s.handover_note
         FROM guard_shifts s JOIN branches b ON b.id = s.branch_id WHERE s.id = $1 AND s.tenant_id = $2`, [id, ctx.tenantId]);
    if (!s) throw notFound('Qorovul smenasi');
    assertBranch(ctx, s.branch_id);
    const p = [ctx.tenantId, s.branch_id, s.opened_at, s.closed_at ?? now()];
    const alerts = await this.db.rows(
      `SELECT e.id, e.kind, e.occurred_at, c.name AS camera_name, la.outcome, la.actor_name, la.acted_at, ${ALERT_STATE_SQL} AS state,
              extract(epoch FROM coalesce(fa.acted_at, k.acked_at) - e.occurred_at)::int AS response_sec
         FROM camera_events e JOIN cameras c ON c.id = e.camera_id ${ALERT_JOINS_SQL}
        WHERE e.tenant_id = $1 AND e.branch_id = $2 AND e.alert AND ${ALERT_KINDS_SQL} AND e.occurred_at >= $3 AND e.occurred_at < $4 ORDER BY e.occurred_at LIMIT 200`, p);
    const incidents = await this.db.rows(
      `SELECT i.id, i.number, i.category, i.severity, i.source, i.description, i.reported_at, i.reported_by_name, r.name AS room_name, i.place
         FROM security_incidents i LEFT JOIN rooms r ON r.id = i.room_id
        WHERE i.tenant_id = $1 AND i.branch_id = $2 AND i.reported_at >= $3 AND i.reported_at < $4 ORDER BY i.reported_at LIMIT 200`, p);
    const visitors = await this.db.rows(
      `SELECT v.full_name, v.organisation, v.purpose, v.host_name, v.pass_no, v.in_at, v.out_at FROM security_visitors v
        WHERE v.tenant_id = $1 AND v.branch_id = $2 AND v.in_at < $4 AND (v.out_at IS NULL OR v.out_at >= $3) ORDER BY v.in_at LIMIT 300`, p);
    const keys = await this.db.rows(
      `SELECT k.action, r.name AS room_name, k.holder_name, k.by_name, k.at FROM key_events k JOIN rooms r ON r.id = k.room_id
        WHERE k.tenant_id = $1 AND k.branch_id = $2 AND k.at >= $3 AND k.at < $4 ORDER BY k.at LIMIT 300`, p);
    const rounds = await this.db.rows(
      `SELECT r.started_at, r.finished_at, r.checkpoints_total, r.guard_name,
              (SELECT count(*)::int FROM patrol_marks m WHERE m.round_id = r.id) AS marked,
              (SELECT count(*)::int FROM patrol_marks m WHERE m.round_id = r.id AND m.result = 'problem') AS problems
         FROM patrol_rounds r WHERE r.tenant_id = $1 AND r.branch_id = $2 AND r.started_at >= $3 AND r.started_at < $4 ORDER BY r.started_at LIMIT 100`, p);
    return { data: { ...s, alerts, incidents, visitors, keys, rounds, open_items: await this.openItems([s.branch_id], ctx.tenantId) } };
  }

  // ================================================================ staff on site

  @Roles(...G) @Get('presence')
  async presence(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const rows = await staffPresence(this.db.pool, ctx.tenantId, branchScope(ctx, q.branch_id));
    return { data: rows, meta: { in: rows.filter((r) => r.status === 'in').length, late: rows.filter((r) => (r.late_min ?? 0) > 0).length, absent: rows.filter((r) => r.status === 'absent').length } };
  }

  /** A manual «Keldi» / «Ketdi» for a staff member the camera did not see (no camera code, a side door). */
  @Roles(...G) @Post('presence') @HttpCode(201)
  async markPresence(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(presenceMarkSchema, body);
    const branchId = writeBranch(ctx, input.branch_id);
    return this.db.tx(async (c) => {
      const m = await staffMember(c, ctx, input.membership_id);
      await c.query(`INSERT INTO staff_presence_marks (tenant_id, branch_id, membership_id, kind, by_membership_id, by_name, at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ctx.tenantId, branchId, m.id, input.kind, ctx.membershipId, ctx.name, now()]);
      await audit(c, ctx, 'security.presence_mark', 'membership', m.id, `${m.full_name}: ${input.kind === 'in' ? 'keldi' : 'ketdi'} (qo‘lda)`, branchId);
      return { data: { ok: true } };
    });
  }

  // ================================================================ manager: statistics and exports

  /** The manager's period figures: alert response times, outcomes, incidents, visitors, keys and patrol compliance. */
  @Roles('manager') @Get('stats')
  async stats(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const branches = branchScope(ctx, q.branch_id);
    const { from, to, fromTs, toTs } = period(q, 7);
    const p = [ctx.tenantId, branches, fromTs, toTs];
    const alerts = (await this.db.one(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE st = 'resolved')::int AS handled,
              count(*) FILTER (WHERE st <> 'resolved')::int AS open,
              round(avg(resp))::int AS avg_response_sec,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY resp))::int AS median_response_sec,
              max(resp)::int AS max_response_sec,
              count(*) FILTER (WHERE outcome = 'false_alarm')::int AS false_alarm,
              count(*) FILTER (WHERE outcome = 'checked_ok')::int AS checked_ok,
              count(*) FILTER (WHERE outcome = 'incident')::int AS incident,
              count(*) FILTER (WHERE escalated)::int AS escalated
         FROM (SELECT ${ALERT_STATE_SQL} AS st, la.outcome,
                      EXISTS (SELECT 1 FROM security_alert_actions x WHERE x.event_id = e.id AND x.outcome = 'escalated') AS escalated,
                      extract(epoch FROM coalesce(fa.acted_at, k.acked_at) - e.occurred_at) AS resp
                 FROM camera_events e ${ALERT_JOINS_SQL}
                WHERE e.tenant_id = $1 AND e.alert AND ${ALERT_KINDS_SQL} AND e.branch_id = ANY($2) AND e.occurred_at >= $3 AND e.occurred_at < $4) x`, p))!;
    const incidents = await this.db.rows(
      `SELECT i.category, i.severity, i.source, count(*)::int AS n,
              count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM security_incident_entries x WHERE x.incident_id = i.id AND x.kind = 'close'))::int AS open
         FROM security_incidents i WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.reported_at >= $3 AND i.reported_at < $4 GROUP BY 1, 2, 3`, p);
    const visitors = (await this.db.one(
      `SELECT count(*)::int AS total, round(avg(extract(epoch FROM v.out_at - v.in_at)) / 60)::int AS avg_minutes
         FROM security_visitors v WHERE v.tenant_id = $1 AND v.branch_id = ANY($2) AND v.in_at >= $3 AND v.in_at < $4`, p))!;
    const keyRows = await this.db.rows(
      `SELECT o.at AS out_at, (SELECT min(i.at) FROM key_events i WHERE i.room_id = o.room_id AND i.action = 'in' AND i.at > o.at) AS in_at
         FROM key_events o WHERE o.tenant_id = $1 AND o.branch_id = ANY($2) AND o.action = 'out' AND o.at >= $3 AND o.at < $4 LIMIT 5000`, p);
    const keys = {
      issued: keyRows.length,
      late: keyRows.filter((k) => (k.in_at ? keyOverdue(new Date(k.out_at), new Date(k.in_at)) : keyOverdue(new Date(k.out_at)))).length,
      out_now: keyRows.filter((k) => !k.in_at).length,
    };
    // patrol compliance: one finished round expected per PATROL_INTERVAL_HOURS of every post shift
    const shifts = await this.db.rows(
      `SELECT s.id, s.number, s.guard_name, s.opened_at, s.closed_at, b.name AS branch_name,
              (SELECT count(*)::int FROM patrol_rounds r WHERE r.shift_id = s.id AND r.finished_at IS NOT NULL) AS done,
              (SELECT count(*)::int FROM patrol_rounds r WHERE r.shift_id = s.id AND r.finished_at IS NOT NULL
                  AND (SELECT count(*) FROM patrol_marks m WHERE m.round_id = r.id) < r.checkpoints_total) AS incomplete,
              (SELECT count(*)::int FROM patrol_rounds r JOIN patrol_marks m ON m.round_id = r.id WHERE r.shift_id = s.id AND m.result = 'problem') AS problems
         FROM guard_shifts s JOIN branches b ON b.id = s.branch_id
        WHERE s.tenant_id = $1 AND s.branch_id = ANY($2) AND s.opened_at >= $3 AND s.opened_at < $4 ORDER BY s.opened_at DESC LIMIT 400`, p);
    const t = now().getTime();
    const patrol = shifts.map((s) => {
      const hours = ((s.closed_at ? new Date(s.closed_at).getTime() : t) - new Date(s.opened_at).getTime()) / 3600_000;
      const expected = Math.max(s.closed_at ? 1 : 0, Math.floor(hours / PATROL_INTERVAL_HOURS));
      return { ...s, hours: Math.round(hours * 10) / 10, expected, missed: Math.max(0, expected - s.done) };
    });
    const sum = (k: 'expected' | 'done' | 'missed' | 'incomplete' | 'problems') => patrol.reduce((a, s) => a + Number(s[k]), 0);
    return { data: {
      alerts, incidents, visitors, keys,
      patrol: { shifts: patrol, expected: sum('expected'), done: sum('done'), missed: sum('missed'), incomplete: sum('incomplete'), problems: sum('problems') },
    }, meta: { from, to, interval_hours: PATROL_INTERVAL_HOURS } };
  }

  private async exportAudit(ctx: Ctx, what: string, from: string, to: string) {
    await audit(this.db.pool, ctx, 'security.export', 'security', null, `Eksport: ${what}, ${from} — ${to}`);
  }

  @Roles('manager') @Get('incidents.csv')
  async incidentsCsv(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>, @Res() res: Response) {
    const { from, to } = csvPeriod(q);
    const branches = branchScope(ctx, q.branch_id);
    const rows = await this.db.rows(
      `SELECT i.number, i.reported_at, b.name AS branch_name, i.category, i.severity, i.source, coalesce(r.name, '') || CASE WHEN i.place IS NOT NULL THEN ' ' || i.place ELSE '' END AS place,
              i.description, i.reported_by_name, cl.created_at AS closed_at, cl.text AS resolution
         FROM security_incidents i JOIN branches b ON b.id = i.branch_id LEFT JOIN rooms r ON r.id = i.room_id
         LEFT JOIN security_incident_entries cl ON cl.incident_id = i.id AND cl.kind = 'close'
        WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.reported_at >= $3 AND i.reported_at < $4 ORDER BY i.reported_at LIMIT 20000`,
      [ctx.tenantId, branches, dayStart(from), dayStart(addDays(to, 1))]);
    const L = ctx.locale, h = (k: string) => translate(L, `guard.csv.${k}` as MessageKey);
    const lbl = (k: string) => translate(L, k as MessageKey);
    await this.exportAudit(ctx, 'hodisalar', from, to);
    sendCsv(res, `hodisalar-${from}-${to}.csv`, [h('number'), h('time'), h('branch'), h('category'), h('severity'), h('source'), h('place'), h('description'), h('reportedBy'), h('closedAt'), h('resolution')], [
      ...rows.map((r) => [r.number, csvTime(r.reported_at), r.branch_name, lbl(`guard.cat.${r.category}`), lbl(`guard.sev.${r.severity}`), lbl(`guard.src.${r.source}`), r.place.trim(), r.description, r.reported_by_name, csvTime(r.closed_at), r.resolution ?? '']),
      [h('total'), '', '', '', '', '', '', '', '', `${h('open')}: ${rows.filter((r) => !r.closed_at).length}`, `${h('count')}: ${rows.length}`],
    ]);
  }

  @Roles('manager') @Get('visitors.csv')
  async visitorsCsv(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>, @Res() res: Response) {
    const { from, to } = csvPeriod(q);
    const branches = branchScope(ctx, q.branch_id);
    const rows = await this.db.rows(
      `SELECT v.in_at, v.out_at, b.name AS branch_name, v.full_name, v.organisation, v.purpose, v.purpose_note, v.host_name, v.pass_no, v.recorded_by_name, v.purged_at
         FROM security_visitors v JOIN branches b ON b.id = v.branch_id
        WHERE v.tenant_id = $1 AND v.branch_id = ANY($2) AND v.in_at >= $3 AND v.in_at < $4 ORDER BY v.in_at LIMIT 20000`,
      [ctx.tenantId, branches, dayStart(from), dayStart(addDays(to, 1))]);
    const L = ctx.locale, h = (k: string) => translate(L, `guard.csv.${k}` as MessageKey);
    const purged = translate(L, 'guard.vis.purged');
    await this.exportAudit(ctx, 'tashriflar', from, to);
    sendCsv(res, `tashriflar-${from}-${to}.csv`, [h('in'), h('out'), h('branch'), h('visitor'), h('organisation'), h('purpose'), h('note'), h('host'), h('pass'), h('recordedBy')], [
      ...rows.map((r) => [csvTime(r.in_at), csvTime(r.out_at), r.branch_name, r.full_name ?? purged, r.organisation ?? '', translate(L, `guard.purpose.${r.purpose}` as MessageKey), r.purpose_note ?? '', r.host_name ?? '', r.pass_no ?? '', r.recorded_by_name]),
      [h('total'), `${h('inside')}: ${rows.filter((r) => !r.out_at).length}`, '', `${h('count')}: ${rows.length}`, '', '', '', '', '', ''],
    ]);
  }

  @Roles('manager') @Get('alerts.csv')
  async alertsCsv(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>, @Res() res: Response) {
    const { from, to } = csvPeriod(q);
    const branches = branchScope(ctx, q.branch_id);
    const rows = await this.db.rows(
      `SELECT e.occurred_at, b.name AS branch_name, c.name AS camera_name, e.kind, ${ALERT_STATE_SQL} AS state, la.outcome, la.actor_name, coalesce(fa.acted_at, k.acked_at) AS first_at,
              extract(epoch FROM coalesce(fa.acted_at, k.acked_at) - e.occurred_at)::int AS response_sec
         FROM camera_events e JOIN cameras c ON c.id = e.camera_id JOIN branches b ON b.id = e.branch_id ${ALERT_JOINS_SQL}
        WHERE e.tenant_id = $1 AND e.alert AND ${ALERT_KINDS_SQL} AND e.branch_id = ANY($2) AND e.occurred_at >= $3 AND e.occurred_at < $4 ORDER BY e.occurred_at LIMIT 20000`,
      [ctx.tenantId, branches, dayStart(from), dayStart(addDays(to, 1))]);
    const L = ctx.locale, h = (k: string) => translate(L, `guard.csv.${k}` as MessageKey);
    const resp = rows.map((r) => r.response_sec).filter((x): x is number => x != null);
    await this.exportAudit(ctx, 'ogohlantirishlar', from, to);
    sendCsv(res, `ogohlantirishlar-${from}-${to}.csv`, [h('time'), h('branch'), h('camera'), h('event'), h('state'), h('outcome'), h('handledBy'), h('firstAction'), h('responseMin')], [
      ...rows.map((r) => [csvTime(r.occurred_at), r.branch_name, r.camera_name, translate(L, `cam.kind.${r.kind}` as MessageKey), translate(L, `guard.state.${r.state}` as MessageKey),
        r.outcome && (ALERT_OUTCOMES as readonly string[]).includes(r.outcome) ? translate(L, `guard.outcome.${r.outcome}` as MessageKey) : '', r.actor_name ?? '', csvTime(r.first_at),
        r.response_sec == null ? '' : (r.response_sec / 60).toFixed(1)]),
      [h('total'), '', '', `${h('count')}: ${rows.length}`, `${h('open')}: ${rows.filter((r) => r.state !== 'resolved').length}`, '', '', '',
        resp.length ? (resp.reduce((a, b) => a + b, 0) / resp.length / 60).toFixed(1) : ''],
    ]);
  }
}

