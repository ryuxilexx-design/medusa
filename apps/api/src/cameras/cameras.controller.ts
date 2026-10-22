// Hikvision cameras for the manager (devices, staff face codes, attendance, people flow, security) and the camera's
// patient-arrival suggestions for the registrar. Biometrics never pass through here: only our codes and event times.
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { CAMERA_SECURITY_KINDS, cameraSchema, cameraUpdateSchema, staffFaceCodeSchema } from '@meduza/contracts';
import { readSeedSnapshot } from '@meduza/db';
import { Db } from '../core/db';
import { config } from '../core/config';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, conflict, notFound } from '../core/errors';
import { isDate, isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, localDate, localTime, now, today, toMinutes, weekday } from '../core/clock';
import { assertBranch, branchScope } from '../core/scope';
import { hashToken } from '../core/guard';
import { checkInAppointment } from '../modules/appointments.controller';
import { Camera, EventKind, ingestEvent, SECURITY_KINDS, SNAPSHOT_DAYS } from './ingest';

const CAM_COLS = `c.id, c.branch_id, b.name AS branch_name, c.name, c.location, c.model, c.purposes, c.security_mode, c.alert_snapshots, c.token_hint, c.status, c.last_event_at, c.last_seen_at, c.created_at,
  (c.isapi_host IS NOT NULL) AS isapi_connected, c.isapi_host, c.delivery, c.isapi_model, c.isapi_error, c.listening_configured_at, c.fdlib_id`;
/** Late if the first arrival is more than this after the doctor's scheduled start. */
const LATE_GRACE_MIN = 5;

const newToken = () => randomBytes(24).toString('base64url');
const pushPath = (token: string) => `/api/v1/hik/${token}`;

/** Inclusive local date range from the query (default: the last 7 days up to today), at most 92 days. */
function range(q: Record<string, unknown>, defaultDays = 7) {
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) ? q.from : addDays(to, -(defaultDays - 1));
  if (from > to) throw new AppError(422, 'VALIDATION', 'Davr noto‘g‘ri', { from: 'Boshlanish sanasi tugashdan keyin' });
  if (addDays(from, 92) < to) throw new AppError(422, 'VALIDATION', 'Davr 3 oydan oshmasin', { from: 'Davr juda uzun' });
  return { from, to, fromTs: dayStart(from), toTs: dayStart(addDays(to, 1)) };
}

const simulateSchema = z.object({
  kind: z.enum(['face_match', 'people_count', ...CAMERA_SECURITY_KINDS]),
  code: z.string().trim().max(12).optional(),
  enter: z.number().int().min(0).max(500).optional(),
  exit: z.number().int().min(0).max(500).optional(),
});

@Controller('cameras')
export class CamerasController {
  constructor(private db: Db) {}

  private async camera(ctx: Ctx, id: string) {
    if (!isUuid(id)) throw notFound('Kamera');
    const c = await this.db.one(`SELECT * FROM cameras WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
    if (!c) throw notFound('Kamera');
    assertBranch(ctx, c.branch_id);
    return c;
  }

  @Roles('manager') @Get()
  async list(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.rows(
      `SELECT ${CAM_COLS},
              (SELECT count(*)::int FROM camera_events e WHERE e.camera_id = c.id AND e.received_at >= (SELECT demo_now()) - interval '24 hours') AS events_24h
         FROM cameras c JOIN branches b ON b.id = c.branch_id
        WHERE c.tenant_id = $1 AND c.branch_id = ANY($2) ORDER BY b.name, c.name`, [ctx.tenantId, ctx.branchIds]);
    return { data: rows, meta: { simulator_available: config.demoEnabled } };
  }

  /** Adds a camera. The push address (with its secret token) is returned once and only its hash is stored. */
  @Roles('manager') @Post() @HttpCode(201)
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(cameraSchema, body);
    assertBranch(ctx, input.branch_id);
    const token = newToken();
    const row = await this.db.tx(async (c) => {
      const r = (await c.query(
        `INSERT INTO cameras (tenant_id, branch_id, name, location, model, purposes, security_mode, token_hash, token_hint, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [ctx.tenantId, input.branch_id, input.name, input.location, input.model, [...new Set(input.purposes)], input.security_mode, hashToken(token), token.slice(-4), ctx.membershipId])).rows[0];
      if (input.alert_snapshots) await c.query(`UPDATE cameras SET alert_snapshots = true WHERE id = $1`, [r.id]);
      await audit(c, ctx, 'camera.create', 'camera', r.id, `Kamera qo‘shildi: ${input.name}`, input.branch_id);
      return r;
    });
    return { data: { id: row.id, push_path: pushPath(token) } };
  }

  @Roles('manager') @Patch(':id')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    await this.camera(ctx, id);
    const input = parse(cameraUpdateSchema, body);
    if (input.branch_id) assertBranch(ctx, input.branch_id);
    const sets: string[] = [], vals: unknown[] = [id, ctx.tenantId];
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      vals.push(k === 'purposes' ? [...new Set(v as string[])] : v);
      sets.push(`${k} = $${vals.length}`);
    }
    if (!sets.length) return { data: { id } };
    await this.db.tx(async (c) => {
      await c.query(`UPDATE cameras SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2`, vals);
      await audit(c, ctx, input.status === 'disabled' ? 'camera.disable' : 'camera.update', 'camera', id, 'Kamera sozlamalari o‘zgardi');
    });
    return { data: { id } };
  }

  /** New secret push address (the old one stops working at once). */
  @Roles('manager') @Post(':id/token') @HttpCode(200)
  async rotate(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await this.camera(ctx, id);
    const token = newToken();
    await this.db.tx(async (c) => {
      await c.query(`UPDATE cameras SET token_hash = $3, token_hint = $4 WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId, hashToken(token), token.slice(-4)]);
      await audit(c, ctx, 'camera.token', 'camera', id, 'Kamera ulanish manzili yangilandi');
    });
    return { data: { id, push_path: pushPath(token) } };
  }

  // ---------- staff face codes ----------

  /** Active staff with their camera code (if any). The photo is enrolled on the camera itself, under this code. */
  @Roles('manager') @Get('face-codes')
  async faceCodes(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.rows(
      `SELECT m.id AS membership_id, u.full_name, m.role, d.specialty, fc.id AS face_code_id, fc.code, fc.created_at,
              (SELECT max(e.occurred_at) FROM camera_events e WHERE e.face_code_id = fc.id) AS last_seen_at,
              (SELECT count(*)::int FROM face_code_cameras fcc WHERE fcc.face_code_id = fc.id) AS cameras_enrolled
         FROM memberships m JOIN users u ON u.id = m.user_id
         LEFT JOIN doctors d ON d.membership_id = m.id AND d.tenant_id = m.tenant_id
         LEFT JOIN face_codes fc ON fc.membership_id = m.id AND fc.tenant_id = m.tenant_id AND fc.revoked_at IS NULL
        WHERE m.tenant_id = $1 AND m.status = 'active' AND m.branch_ids && $2
        ORDER BY CASE m.role WHEN 'manager' THEN 0 WHEN 'doctor' THEN 1 ELSE 2 END, u.full_name`, [ctx.tenantId, ctx.branchIds]);
    const patients = (await this.db.one(
      `SELECT count(*)::int AS n FROM face_codes WHERE tenant_id = $1 AND subject_type = 'patient' AND revoked_at IS NULL`, [ctx.tenantId]))!.n;
    // cameras a face can be sent to: connected over ISAPI, in the manager's branches
    const enrolTargets = await this.db.rows(
      `SELECT id, name, branch_id FROM cameras WHERE tenant_id = $1 AND status = 'active' AND isapi_host IS NOT NULL AND isapi_password_enc IS NOT NULL AND branch_id = ANY($2) ORDER BY name`,
      [ctx.tenantId, ctx.branchIds]);
    return { data: rows, meta: { patient_codes: patients, enrol_cameras: enrolTargets } };
  }

  @Roles('manager') @Post('face-codes') @HttpCode(201)
  async addFaceCode(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(staffFaceCodeSchema, body);
    return this.db.tx(async (c) => {
      const m = (await c.query(`SELECT id FROM memberships WHERE id = $1 AND tenant_id = $2 AND status = 'active' AND branch_ids && $3 FOR UPDATE`, [input.membership_id, ctx.tenantId, ctx.branchIds])).rows[0];
      if (!m) throw notFound('Xodim');
      const live = (await c.query(`SELECT code FROM face_codes WHERE tenant_id = $1 AND membership_id = $2 AND revoked_at IS NULL`, [ctx.tenantId, m.id])).rows[0];
      if (live) return { data: { code: live.code, already: true } };
      const code = 'S-' + (await c.query(`SELECT nextval('face_code_staff_seq') AS n`)).rows[0].n;
      await c.query(`INSERT INTO face_codes (tenant_id, code, subject_type, membership_id, consent_confirmed_by) VALUES ($1,$2,'staff',$3,$4)`,
        [ctx.tenantId, code, m.id, ctx.membershipId]);
      await audit(c, ctx, 'camera.face_code', 'membership', m.id, `Kamera kodi berildi: ${code} (xodimning yozma roziligi tasdiqlandi)`);
      return { data: { code } };
    });
  }

  /** Stops recognising the person (the clinic also deletes the face from the camera library). */
  @Roles('manager') @Delete('face-codes/:id') @HttpCode(200)
  async revokeFaceCode(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Kod');
    return this.db.tx(async (c) => {
      const r = (await c.query(
        `UPDATE face_codes fc SET revoked_at = demo_now() FROM memberships m
          WHERE fc.id = $1 AND fc.tenant_id = $2 AND fc.subject_type = 'staff' AND fc.revoked_at IS NULL AND m.id = fc.membership_id AND m.branch_ids && $3
          RETURNING fc.code, fc.membership_id`, [id, ctx.tenantId, ctx.branchIds])).rows[0];
      if (!r) throw notFound('Kod');
      await audit(c, ctx, 'camera.face_code_revoke', 'membership', r.membership_id, `Kamera kodi bekor qilindi: ${r.code}`);
      return { data: { id } };
    });
  }

  // ---------- reports ----------

  /** Staff attendance per local day: first and last time seen by an attendance camera; doctors compared with their schedule. */
  @Roles('manager') @Get('attendance')
  async attendance(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const { from, to, fromTs, toTs } = range(q);
    const branches = branchScope(ctx, q.branch_id);
    const seen = await this.db.rows(
      `SELECT fc.membership_id, to_char(e.occurred_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS day,
              min(e.occurred_at) AS first_at, max(e.occurred_at) AS last_at, count(*)::int AS events
         FROM camera_events e JOIN face_codes fc ON fc.id = e.face_code_id AND fc.subject_type = 'staff'
        WHERE e.tenant_id = $1 AND e.kind = 'face_match' AND e.branch_id = ANY($2) AND e.occurred_at >= $3 AND e.occurred_at < $4
        GROUP BY 1, 2`, [ctx.tenantId, branches, fromTs, toTs]);
    const staff = await this.db.rows(
      `SELECT m.id AS membership_id, u.full_name, m.role, d.id AS doctor_id, d.specialty, fc.code,
              (SELECT min(x.created_at) FROM face_codes x WHERE x.tenant_id = m.tenant_id AND x.membership_id = m.id) AS code_since,
              (SELECT min(c.created_at) FROM cameras c WHERE c.tenant_id = m.tenant_id AND c.branch_id = ANY($2) AND 'attendance' = ANY(c.purposes)) AS camera_since
         FROM memberships m JOIN users u ON u.id = m.user_id
         JOIN face_codes fc ON fc.membership_id = m.id AND fc.tenant_id = m.tenant_id AND fc.revoked_at IS NULL
         LEFT JOIN doctors d ON d.membership_id = m.id AND d.tenant_id = m.tenant_id
        WHERE m.tenant_id = $1 AND m.status = 'active' AND m.branch_ids && $2 ORDER BY u.full_name`, [ctx.tenantId, branches]);
    const sched = await this.db.rows(
      `SELECT doctor_id, weekday, to_char(min(start_time), 'HH24:MI') AS start_time, to_char(max(end_time), 'HH24:MI') AS end_time
         FROM schedules WHERE tenant_id = $1 AND branch_id = ANY($2) GROUP BY doctor_id, weekday`, [ctx.tenantId, branches]);
    const byKey = new Map(seen.map((r) => [`${r.membership_id}|${r.day}`, r]));
    const days: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    const rows: any[] = [];
    for (const s of staff) for (const day of days) {
      // before the person had a code (or before an attendance camera existed) nobody could have seen them
      const since = [s.code_since, s.camera_since].filter(Boolean).map((x) => localDate(new Date(x))).sort().at(-1);
      if (since && day < since) continue;
      const wd = weekday(day);
      const plan = s.doctor_id ? sched.find((x) => x.doctor_id === s.doctor_id && x.weekday === wd) : undefined;
      const r = byKey.get(`${s.membership_id}|${day}`);
      if (!r && !plan) continue; // a day off with nobody seen says nothing
      let late_min: number | null = null;
      if (r && plan) {
        const first = new Date(r.first_at), start = dayStart(day).getTime() + toMinutes(plan.start_time) * 60_000;
        const diff = Math.round((first.getTime() - start) / 60_000);
        late_min = diff > LATE_GRACE_MIN ? diff : 0;
      }
      const future = day > today() || (day === today() && plan && !r && now() < new Date(dayStart(day).getTime() + (toMinutes(plan.start_time) + LATE_GRACE_MIN) * 60_000));
      rows.push({
        day, membership_id: s.membership_id, full_name: s.full_name, role: s.role, specialty: s.specialty, code: s.code,
        planned_start: plan?.start_time ?? null, planned_end: plan?.end_time ?? null,
        first_at: r?.first_at ?? null, last_at: r?.last_at ?? null,
        worked_min: r ? Math.round((new Date(r.last_at).getTime() - new Date(r.first_at).getTime()) / 60_000) : null,
        late_min,
        status: r ? (late_min ? 'late' : 'present') : future ? 'expected' : 'absent',
      });
    }
    rows.sort((a, b) => (a.day === b.day ? a.full_name.localeCompare(b.full_name) : a.day < b.day ? 1 : -1));
    const sum = (st: string) => rows.filter((r) => r.status === st).length;
    return { data: rows, meta: { from, to, present: sum('present'), late: sum('late'), absent: sum('absent'), staff_with_codes: staff.length } };
  }

  /** People flow from counting cameras: entries/exits per hour and per day. */
  @Roles('manager') @Get('traffic')
  async traffic(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const { from, to, fromTs, toTs } = range(q);
    const branches = branchScope(ctx, q.branch_id);
    const base = `FROM camera_events e WHERE e.tenant_id = $1 AND e.kind = 'people_count' AND e.branch_id = ANY($2) AND e.occurred_at >= $3 AND e.occurred_at < $4`;
    const params = [ctx.tenantId, branches, fromTs, toTs];
    const hourly = await this.db.rows(
      `SELECT extract(hour FROM e.occurred_at AT TIME ZONE 'Asia/Tashkent')::int AS hour, sum(coalesce(e.enter_count, 0))::int AS enter, sum(coalesce(e.exit_count, 0))::int AS exit
       ${base} GROUP BY 1 ORDER BY 1`, params);
    const daily = await this.db.rows(
      `SELECT to_char(e.occurred_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS day, sum(coalesce(e.enter_count, 0))::int AS enter, sum(coalesce(e.exit_count, 0))::int AS exit
       ${base} GROUP BY 1 ORDER BY 1`, params);
    const total = daily.reduce((s, d) => s + d.enter, 0);
    const busiest = hourly.reduce<{ hour: number; enter: number } | null>((b, h) => (!b || h.enter > b.enter ? h : b), null);
    const days = daily.length || 1;
    return { data: { hourly, daily }, meta: { from, to, total_enter: total, avg_per_day: Math.round(total / days), busiest_hour: busiest?.enter ? busiest.hour : null } };
  }

  /** Security events (intrusion, line crossing, region entry/exit, tamper); alerts first when asked. */
  @Roles('manager') @Get('security')
  async security(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const { from, to, fromTs, toTs } = range(q);
    const branches = branchScope(ctx, q.branch_id);
    const rows = await this.db.rows(
      `SELECT e.id, e.kind, e.occurred_at, e.target, e.alert, e.camera_id, c.security_mode, c.name AS camera_name, c.location, b.name AS branch_name,
              k.acked_at, u.full_name AS acked_by_name, (s.event_id IS NOT NULL) AS has_snapshot
         FROM camera_events e JOIN cameras c ON c.id = e.camera_id JOIN branches b ON b.id = e.branch_id
         LEFT JOIN camera_event_acks k ON k.event_id = e.id LEFT JOIN memberships m ON m.id = k.acked_by LEFT JOIN users u ON u.id = m.user_id
         LEFT JOIN camera_snapshots s ON s.event_id = e.id
        WHERE e.tenant_id = $1 AND e.kind NOT IN ('face_match', 'people_count') AND e.branch_id = ANY($2)
          -- an alert nobody has acknowledged stays on the list whatever the period (the dashboard counts it)
          AND ((e.occurred_at >= $3 AND e.occurred_at < $4) OR (e.alert AND k.event_id IS NULL))
          AND ($5::boolean IS NOT TRUE OR e.alert)
        ORDER BY e.occurred_at DESC LIMIT 300`, [ctx.tenantId, branches, fromTs, toTs, q.alerts_only === '1']);
    const open = (await this.db.one(
      `SELECT count(*)::int AS n FROM camera_events e LEFT JOIN camera_event_acks k ON k.event_id = e.id
        WHERE e.tenant_id = $1 AND e.alert AND k.event_id IS NULL AND e.branch_id = ANY($2)`, [ctx.tenantId, branches]))!.n;
    return { data: rows, meta: { from, to, open_alerts: open, snapshot_days: SNAPSHOT_DAYS } };
  }

  /** The camera's picture of an alert (manager, own branches). Served as the image itself; never cached by proxies. */
  @Roles('manager') @Get('security/:id/snapshot')
  async snapshot(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Res() res: Response) {
    if (!isUuid(id)) throw notFound('Surat');
    const s = await this.db.one(
      `SELECT s.content_type, s.bytes, e.branch_id FROM camera_snapshots s JOIN camera_events e ON e.id = s.event_id
        WHERE s.event_id = $1 AND s.tenant_id = $2`, [id, ctx.tenantId]);
    if (!s) throw notFound('Surat');
    assertBranch(ctx, s.branch_id);
    res.setHeader('Content-Type', s.content_type);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.end(s.bytes);
  }

  @Roles('manager') @Post('security/:id/ack') @HttpCode(200)
  async ack(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Hodisa');
    const e = await this.db.one(`SELECT id, branch_id, kind FROM camera_events WHERE id = $1 AND tenant_id = $2 AND kind NOT IN ('face_match', 'people_count')`, [id, ctx.tenantId]);
    if (!e) throw notFound('Hodisa');
    assertBranch(ctx, e.branch_id);
    await this.db.tx(async (c) => {
      const r = await c.query(`INSERT INTO camera_event_acks (event_id, tenant_id, acked_by) VALUES ($1,$2,$3) ON CONFLICT (event_id) DO NOTHING`, [id, ctx.tenantId, ctx.membershipId]);
      if (r.rowCount) await audit(c, ctx, 'camera.security_ack', 'camera_event', id, 'Xavfsizlik hodisasi ko‘rib chiqildi', e.branch_id);
    });
    return { data: { id } };
  }

  // ---------- patient arrival suggestions (registrar) ----------

  /** Today's «the camera saw this patient» suggestions that still wait for the registrar. */
  @Roles('manager', 'registrar') @Get('arrivals')
  async arrivals(@CurrentCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    const branches = branchScope(ctx, q.branch_id);
    // a suggestion whose appointment changed meanwhile (arrived by hand, cancelled, rescheduled) is not shown
    const rows = await this.db.rows(
      `SELECT s.id, s.created_at, e.occurred_at AS seen_at, e.similarity, c.name AS camera_name,
              a.id AS appointment_id, a.starts_at, a.version, p.id AS patient_id, p.patient_number, p.last_name, p.first_name, p.middle_name,
              dr.display_name AS doctor_name, sv.name AS service_name
         FROM arrival_suggestions s JOIN appointments a ON a.id = s.appointment_id JOIN camera_events e ON e.id = s.event_id
         JOIN cameras c ON c.id = e.camera_id JOIN patients p ON p.id = a.patient_id JOIN doctors dr ON dr.id = a.doctor_id JOIN services sv ON sv.id = a.service_id
        WHERE s.tenant_id = $1 AND s.status = 'pending' AND a.status = 'scheduled' AND a.branch_id = ANY($2)
          AND a.starts_at >= $3 AND a.starts_at < $4
        ORDER BY e.occurred_at`, [ctx.tenantId, branches, dayStart(today()), dayStart(addDays(today(), 1))]);
    return { data: rows };
  }

  /** «Keldi» from the suggestion: the same check-in as the registrar's button. */
  @Roles('manager', 'registrar') @Post('arrivals/:id/accept') @HttpCode(200)
  async accept(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Taklif');
    return this.db.tx(async (c) => {
      const s = (await c.query(`SELECT s.id, s.status, s.appointment_id, a.branch_id FROM arrival_suggestions s JOIN appointments a ON a.id = s.appointment_id
                                  WHERE s.id = $1 AND s.tenant_id = $2 FOR UPDATE OF s`, [id, ctx.tenantId])).rows[0];
      if (!s) throw notFound('Taklif');
      assertBranch(ctx, s.branch_id);
      if (s.status !== 'pending') throw conflict('STALE_STATE', 'Bu taklif allaqachon ko‘rib chiqilgan. Sahifani yangilang.');
      const r = await checkInAppointment(c, ctx, s.appointment_id);
      await c.query(`UPDATE arrival_suggestions SET status = 'accepted', decided_by = $2, decided_at = demo_now() WHERE id = $1`, [id, ctx.membershipId]);
      return { data: r };
    });
  }

  @Roles('manager', 'registrar') @Post('arrivals/:id/dismiss') @HttpCode(200)
  async dismiss(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Taklif');
    return this.db.tx(async (c) => {
      const s = (await c.query(`SELECT s.id, s.status, a.branch_id FROM arrival_suggestions s JOIN appointments a ON a.id = s.appointment_id
                                  WHERE s.id = $1 AND s.tenant_id = $2 FOR UPDATE OF s`, [id, ctx.tenantId])).rows[0];
      if (!s) throw notFound('Taklif');
      assertBranch(ctx, s.branch_id);
      if (s.status === 'pending') await c.query(`UPDATE arrival_suggestions SET status = 'dismissed', decided_by = $2, decided_at = demo_now() WHERE id = $1`, [id, ctx.membershipId]);
      return { data: { id } };
    });
  }

  // ---------- demo simulator ----------

  /** Demo only: a synthetic event for this camera, through the same rules as a real one. */
  @Roles('manager') @Post(':id/simulate') @HttpCode(200)
  async simulate(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    if (!config.demoEnabled) throw new AppError(404, 'NOT_FOUND', 'Manzil topilmadi');
    const cam = await this.camera(ctx, id) as Camera & { status: string };
    const input = parse(simulateSchema, body);
    // a switched-off camera stores nothing, as on the real push address
    if (cam.status !== 'active') return { data: { stored: false, ignored: 'disabled' } };
    const at = now();
    const kind = input.kind as EventKind;
    const r = await this.db.tx((c) => ingestEvent(c, cam, {
      kind, occurredAt: at, code: input.code ?? null, similarity: kind === 'face_match' ? 96 : null,
      enter: kind === 'people_count' ? input.enter ?? 1 : null, exit: kind === 'people_count' ? input.exit ?? 0 : null,
      target: kind === 'face_match' || kind === 'people_count' ? null : 'human', sourceKey: `sim:${at.getTime()}:${randomBytes(4).toString('hex')}`,
      // a drawn demo frame stands in for the camera's picture (stored only if the event becomes an alert)
      snapshot: SECURITY_KINDS.includes(kind) ? demoSnapshot(kind, at, cam.id) : null,
    }));
    return { data: r };
  }
}

/** One of the seed's sample frames for a simulated security event: by kind and by night/day (never a picture from a real camera). */
function demoSnapshot(kind: EventKind, at: Date, camId: string) {
  const hour = Math.floor(toMinutes(localTime(at)) / 60);
  const night = hour < 8 || hour >= 20;
  const pick = (names: string[]) => names[parseInt(camId.slice(0, 2), 16) % names.length];
  const name = kind === 'tamper' ? 'cash-tamper'
    : kind === 'loitering' ? pick(['or-day-loitering', 'store-day-loitering', 'cash-day-post'])
    : night ? pick(['store-night-1', 'cash-night-intrusion', 'reception-night', 'yun-cash-night-region', 'store-night-2', 'entry-night-door', 'entry-night-glass', 'cash-night-lift', 'or-night-ward-door', 'yun-cash-night-hall', 'entry-night-street'])
    : pick(['or-day-stranger', 'entry-day-stroller', 'or-day-lifts', 'store-day-window']);
  const bytes = readSeedSnapshot(name);
  return bytes ? { contentType: 'image/jpeg' as const, bytes } : null;
}

/** For the dashboard's attention block. A camera that once pushed and then fell silent for a day counts as silent;
 *  one never connected yet is shown on the devices tab instead. */
export async function cameraAttention(db: Db, tenantId: string, branches: string[]) {
  return db.one(
    `SELECT (SELECT count(*)::int FROM camera_events e LEFT JOIN camera_event_acks k ON k.event_id = e.id
              WHERE e.tenant_id = $1 AND e.alert AND k.event_id IS NULL AND e.branch_id = ANY($2)) AS open_alerts,
            (SELECT count(*)::int FROM cameras WHERE tenant_id = $1 AND status = 'active' AND branch_id = ANY($2)
              AND last_seen_at IS NOT NULL AND last_seen_at < demo_now() - interval '24 hours') AS silent_cameras`, [tenantId, branches]);
}
