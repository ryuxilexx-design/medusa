import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { scheduleExceptionSchema } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { forbidden, invalid, notFound } from '../core/errors';
import { isDate, isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, localDate, localTime, now, today, toMinutes, weekday } from '../core/clock';
import { BLOCKING_KINDS, EXCEPTION_REASON } from './booking';

const MAX_RANGE_DAYS = 366;
const MS_DAY = 86400_000;

/**
 * Days off, vacations, clinic holidays and one-day custom hours. The booking rules that read them live in
 * booking.ts (shared with the Telegram bot); here only the manager's maintenance and the read for the grid.
 */
@Controller('schedule-exceptions')
export class ScheduleExceptionsController {
  constructor(private db: Db) {}

  /** Upcoming exceptions of the clinic; a doctor sees only their own and the clinic-wide ones. */
  @Roles('manager', 'registrar', 'doctor') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const from = isDate(q.from) ? q.from : today();
    let to = isDate(q.to) ? q.to : addDays(from, 90);
    if (to < from) to = from;
    if ((Date.parse(to) - Date.parse(from)) / MS_DAY > MAX_RANGE_DAYS) throw invalid({ to: `Davr ${MAX_RANGE_DAYS} kundan oshmasin` });
    let doctorId: string | null = isUuid(q.doctor_id) ? q.doctor_id : null;
    if (ctx.role === 'doctor') doctorId = ctx.doctorId; // never another doctor's days
    const rows = (await this.db.pool.query(
      `SELECT e.id, e.doctor_id, d.display_name AS doctor_name, e.branch_id, b.name AS branch_name, e.date::text AS date, e.kind,
              to_char(e.start_time,'HH24:MI') AS start_time, to_char(e.end_time,'HH24:MI') AS end_time, e.note, e.created_at
         FROM schedule_exceptions e LEFT JOIN doctors d ON d.id = e.doctor_id LEFT JOIN branches b ON b.id = e.branch_id
        WHERE e.tenant_id = $1 AND e.date >= $2 AND e.date <= $3
          AND ($4::uuid IS NULL OR e.doctor_id = $4 OR e.doctor_id IS NULL)
          AND (e.branch_id IS NULL OR e.branch_id = ANY($5::uuid[]))
        ORDER BY e.date, d.display_name NULLS FIRST LIMIT 1000`,
      [ctx.tenantId, from, to, doctorId, ctx.branchIds])).rows;
    return { data: rows };
  }

  /**
   * Creates one row per day of [from, to]. Bookings inside the period are never cancelled: they come back as
   * `affected` (count, ids, patient names) so the registrar reschedules them.
   */
  @Roles('manager') @Post() @HttpCode(201)
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(scheduleExceptionSchema, body);
    const from = input.from, to = input.to ?? from;
    if (to < today()) throw invalid({ to: 'O‘tgan kunga dam olish qo‘yib bo‘lmaydi' });
    if (input.branch_id && !ctx.branchIds.includes(input.branch_id)) throw invalid({ branch_id: 'Filial topilmadi yoki sizga biriktirilmagan' });
    return this.db.tx(async (c) => {
      let doctor: { id: string; display_name: string } | null = null;
      if (input.doctor_id) {
        doctor = (await c.query(`SELECT id, display_name FROM doctors WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [input.doctor_id, ctx.tenantId])).rows[0] ?? null;
        if (!doctor) throw notFound('Shifokor');
      }
      const dates: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
      if (input.kind === 'custom_hours') {
        // custom hours replace the weekly row: the doctor must have one on that weekday
        const wds = new Set((await c.query(`SELECT weekday FROM schedules WHERE doctor_id = $1 AND tenant_id = $2`, [doctor!.id, ctx.tenantId])).rows.map((r) => r.weekday));
        const missing = dates.find((d) => !wds.has(weekday(d)));
        if (missing) throw invalid({ from: `${missing}: shifokorning bu hafta kunida jadvali yo‘q` });
      }
      const ids: string[] = [];
      for (const date of dates) {
        const r = (await c.query(
          `INSERT INTO schedule_exceptions (tenant_id, doctor_id, branch_id, date, kind, start_time, end_time, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'), coalesce(branch_id, '00000000-0000-0000-0000-000000000000'), date)
           DO UPDATE SET kind = EXCLUDED.kind, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, note = EXCLUDED.note, created_by = EXCLUDED.created_by, created_at = demo_now()
           RETURNING id`,
          [ctx.tenantId, doctor?.id ?? null, input.branch_id ?? null, date, input.kind, input.start_time ?? null, input.end_time ?? null, input.note ?? null, ctx.membershipId || null])).rows[0];
        ids.push(r.id);
      }
      // future bookings that fall inside the period (a whole day, or outside the custom window)
      const future = (await c.query(
        `SELECT a.id, a.starts_at, a.ends_at, a.branch_id, a.doctor_id, d.display_name AS doctor_name, p.patient_number, p.last_name, p.first_name, s.name AS service_name
           FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN services s ON s.id = a.service_id JOIN doctors d ON d.id = a.doctor_id
          WHERE a.tenant_id = $1 AND a.status = 'scheduled' AND a.starts_at >= $2 AND a.starts_at < $3 AND a.starts_at >= $4
            AND ($5::uuid IS NULL OR a.doctor_id = $5) AND ($6::uuid IS NULL OR a.branch_id = $6)
          ORDER BY a.starts_at LIMIT 500`,
        [ctx.tenantId, dayStart(from), dayStart(addDays(to, 1)), now(), doctor?.id ?? null, input.branch_id ?? null])).rows;
      const affected = future.flatMap((a) => {
        const st = toMinutes(localTime(a.starts_at)), en = toMinutes(localTime(a.ends_at));
        const inside = BLOCKING_KINDS.includes(input.kind) || st < toMinutes(input.start_time!) || en > toMinutes(input.end_time!);
        return inside ? [{ appointment_id: a.id, date: localDate(a.starts_at), time: localTime(a.starts_at), doctor_id: a.doctor_id, doctor_name: a.doctor_name,
          patient_number: a.patient_number, patient: `${a.last_name} ${a.first_name}`, service_name: a.service_name }] : [];
      });
      const who = doctor ? doctor.display_name : 'butun klinika';
      const what = input.kind === 'custom_hours' ? `maxsus ish vaqti ${input.start_time}–${input.end_time}` : EXCEPTION_REASON[input.kind];
      await audit(c, ctx, 'schedule.exception.create', 'schedule_exception', ids[0],
        `${who}: ${what}, ${from}${to !== from ? `–${to}` : ''} (${dates.length} kun)${affected.length ? `; ${affected.length} ta qabul ko‘chirilishi kerak` : ''}`, input.branch_id ?? null);
      return { data: { ids, days: dates.length, affected } };
    });
  }

  @Roles('manager') @Delete(':id') @HttpCode(200)
  async remove(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Dam olish kuni');
    return this.db.tx(async (c) => {
      const e = (await c.query(
        `SELECT e.id, e.date::text AS date, e.kind, e.branch_id, d.display_name FROM schedule_exceptions e LEFT JOIN doctors d ON d.id = e.doctor_id
          WHERE e.id = $1 AND e.tenant_id = $2 FOR UPDATE OF e`, [id, ctx.tenantId])).rows[0];
      if (!e) throw notFound('Dam olish kuni');
      if (e.branch_id && !ctx.branchIds.includes(e.branch_id)) throw forbidden();
      await c.query(`DELETE FROM schedule_exceptions WHERE id = $1`, [id]);
      await audit(c, ctx, 'schedule.exception.delete', 'schedule_exception', id, `${e.display_name ?? 'butun klinika'}: ${e.date} (${EXCEPTION_REASON[e.kind] ?? 'maxsus ish vaqti'}) o‘chirildi`, e.branch_id);
      return { data: { ok: true } };
    });
  }
}
