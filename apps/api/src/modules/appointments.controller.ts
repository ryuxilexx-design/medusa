import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { appointmentActionSchema, appointmentCreateSchema, appointmentUpdateSchema } from '@meduza/contracts';
import { PoolClient } from 'pg';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, conflict, forbidden, invalid, notFound, staleState } from '../core/errors';
import { isDate, isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, localDate, localTime, localToUtc, now, toMinutes, today, weekday } from '../core/clock';
import { assertBranch, branchScope } from '../core/scope';
import { createBilledOrder } from './billing';

export const APPT_SELECT = `
  SELECT a.id, a.branch_id, b.name AS branch_name, a.patient_id, p.patient_number, p.last_name, p.first_name, p.middle_name, p.birth_date, p.phone,
         a.doctor_id, d.display_name AS doctor_name, d.specialty, a.service_id, s.name AS service_name, s.category AS service_category,
         a.room_id, r.name AS room_name, a.starts_at, a.ends_at, a.status, a.note, a.cancel_reason, a.version,
         qt.number AS queue_number, qt.arrived_at, qt.started_at, qt.finished_at, qt.wait_seconds, e.id AS encounter_id,
         (SELECT json_build_object('id', i.id, 'status', i.status, 'total', i.total, 'paid_amount', i.paid_amount, 'invoice_number', i.invoice_number)
            FROM invoices i WHERE i.appointment_id = a.id AND i.status <> 'void' ORDER BY i.created_at LIMIT 1) AS invoice
    FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id JOIN services s ON s.id = a.service_id
    JOIN branches b ON b.id = a.branch_id LEFT JOIN rooms r ON r.id = a.room_id
    LEFT JOIN queue_tickets qt ON qt.appointment_id = a.id LEFT JOIN encounters e ON e.appointment_id = a.id`;

export async function lockAppointment(c: Q, ctx: Ctx, id: string) {
  if (!isUuid(id)) throw notFound('Qabul');
  const a = (await c.query(`SELECT * FROM appointments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
  if (!a) throw notFound('Qabul');
  if (!ctx.branchIds.includes(a.branch_id)) throw notFound('Qabul');
  if (ctx.role === 'doctor' && a.doctor_id !== ctx.doctorId) throw forbidden('Bu qabul sizga tegishli emas');
  return a;
}

@Controller('appointments')
export class AppointmentsController {
  constructor(private db: Db) {}

  @Roles('manager', 'registrar', 'doctor', 'cashier') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id)];
    const where = ['a.tenant_id = $1', 'a.branch_id = ANY($2)'];
    const from = isDate(q.from) ? q.from : isDate(q.date) ? q.date : today();
    const to = isDate(q.to) ? q.to : isDate(q.date) ? q.date : from;
    if (!q.patient_id) { params.push(dayStart(from), dayStart(addDays(to, 1))); where.push(`a.starts_at >= $${params.length - 1} AND a.starts_at < $${params.length}`); }
    if (ctx.role === 'doctor') { params.push(ctx.doctorId); where.push(`a.doctor_id = $${params.length}`); }
    else if (isUuid(q.doctor_id)) { params.push(q.doctor_id); where.push(`a.doctor_id = $${params.length}`); }
    if (isUuid(q.patient_id)) { params.push(q.patient_id); where.push(`a.patient_id = $${params.length}`); }
    if (q.status) { params.push(String(q.status).split(',')); where.push(`a.status = ANY($${params.length})`); }
    const rows = await this.db.rows(`${APPT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.starts_at, d.display_name LIMIT 500`, params);
    return { data: rows, meta: { from, to, total: rows.length } };
  }

  @Roles('manager', 'registrar', 'doctor', 'cashier') @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Qabul');
    const a = await this.db.one(`${APPT_SELECT} WHERE a.id = $1 AND a.tenant_id = $2 AND a.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!a) throw notFound('Qabul');
    if (ctx.role === 'doctor' && a.doctor_id !== ctx.doctorId) throw forbidden('Bu qabul sizga tegishli emas');
    return { data: a };
  }

  /** Validates doctor/service/branch/schedule and returns the time window + room. Overlaps are enforced by the DB exclusion constraint. */
  private async validateSlot(c: Q, ctx: Ctx, input: { branch_id: string; doctor_id: string; service_id: string; date: string; start_time: string; duration_min?: number }) {
    assertBranch(ctx, input.branch_id);
    const doctor = (await c.query(`SELECT id, display_name FROM doctors WHERE id = $1 AND tenant_id = $2 AND active`, [input.doctor_id, ctx.tenantId])).rows[0];
    if (!doctor) throw invalid({ doctor_id: 'Shifokor topilmadi yoki faol emas' });
    const service = (await c.query(`SELECT id, name, duration_min, active FROM services WHERE id = $1 AND tenant_id = $2`, [input.service_id, ctx.tenantId])).rows[0];
    if (!service || !service.active) throw invalid({ service_id: 'Xizmat topilmadi yoki nofaol' });
    const link = (await c.query(`SELECT 1 FROM doctor_services WHERE doctor_id = $1 AND service_id = $2`, [doctor.id, service.id])).rows[0];
    if (!link) throw invalid({ service_id: 'Bu shifokor tanlangan xizmatni ko‘rsatmaydi' });
    const sch = (await c.query(
      `SELECT s.*, b.name AS branch_name FROM schedules s JOIN branches b ON b.id = s.branch_id WHERE s.doctor_id = $1 AND s.weekday = $2`, [doctor.id, weekday(input.date)])).rows[0];
    if (!sch) throw invalid({ date: 'Shifokor bu kuni ishlamaydi' });
    if (sch.branch_id !== input.branch_id) throw invalid({ branch_id: `Shifokor bu kuni ${sch.branch_name}da qabul qiladi` });
    const duration = input.duration_min ?? service.duration_min;
    const start = toMinutes(input.start_time), end = start + duration;
    if (start < toMinutes(sch.start_time) || end > toMinutes(sch.end_time)) throw invalid({ start_time: `Ish vaqti: ${sch.start_time.slice(0, 5)}–${sch.end_time.slice(0, 5)}` });
    if (sch.break_start && start < toMinutes(sch.break_end) && toMinutes(sch.break_start) < end) throw invalid({ start_time: `Tanaffus vaqti: ${sch.break_start.slice(0, 5)}–${sch.break_end.slice(0, 5)}` });
    const startsAt = localToUtc(input.date, input.start_time);
    if (startsAt.getTime() < now().getTime() - 5 * 60_000) throw invalid({ start_time: 'O‘tgan vaqtga yozib bo‘lmaydi' });
    return { startsAt, endsAt: new Date(startsAt.getTime() + duration * 60_000), roomId: sch.room_id as string | null, service, doctor };
  }

  @Roles('manager', 'registrar') @Post()
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    const input = parse(appointmentCreateSchema, body);
    const requestKey = key && key.length >= 8 && key.length <= 100 ? key : null;
    return this.db.tx(async (c) => {
      if (requestKey) {
        // serialise retries of the same request, then return the original booking if it already exists
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`appt:${ctx.tenantId}:${requestKey}`]);
        const prev = (await c.query(`SELECT id FROM appointments WHERE tenant_id = $1 AND request_key = $2`, [ctx.tenantId, requestKey])).rows[0];
        if (prev) return { data: { id: prev.id, replayed: true } };
      }
      const patient = (await c.query(`SELECT id, patient_number FROM patients WHERE id = $1 AND tenant_id = $2`, [input.patient_id, ctx.tenantId])).rows[0];
      if (!patient) throw invalid({ patient_id: 'Bemor topilmadi' });
      const slot = await this.validateSlot(c, ctx, input);
      const row = (await c.query(
        `INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, service_id, room_id, starts_at, ends_at, status, note, created_by, created_at, updated_at, request_key)
         VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9,$10, demo_now(), demo_now(), $11) RETURNING id`,
        [ctx.tenantId, input.branch_id, input.patient_id, input.doctor_id, input.service_id, slot.roomId, slot.startsAt, slot.endsAt, input.note, ctx.membershipId, requestKey])).rows[0];
      await audit(c, ctx, 'appointment.create', 'appointment', row.id, `#${patient.patient_number}: ${slot.service.name}, ${input.date} ${input.start_time}, ${slot.doctor.display_name}`, input.branch_id);
      return { data: { id: row.id } };
    });
  }

  /** Reschedule: updates the same row (never creates a duplicate). Only scheduled appointments. */
  @Roles('manager', 'registrar') @Patch(':id')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(appointmentUpdateSchema, body);
    return this.db.tx(async (c) => {
      const a = await lockAppointment(c, ctx, id);
      if (a.version !== input.version) throw staleState();
      if (a.status !== 'scheduled') throw conflict('INVALID_STATE', 'Faqat rejalashtirilgan qabulni ko‘chirish mumkin');
      const merged = {
        branch_id: a.branch_id, doctor_id: input.doctor_id ?? a.doctor_id, service_id: input.service_id ?? a.service_id,
        date: input.date ?? localDate(a.starts_at), start_time: input.start_time ?? localTime(a.starts_at),
        duration_min: input.duration_min ?? Math.round((a.ends_at - a.starts_at) / 60000),
      };
      // the doctor may work in another branch on the new day
      const sch = (await c.query(`SELECT branch_id FROM schedules WHERE doctor_id = $1 AND weekday = $2`, [merged.doctor_id, weekday(merged.date)])).rows[0];
      if (sch) merged.branch_id = sch.branch_id;
      if (input.service_id && !input.duration_min) delete (merged as any).duration_min;
      const slot = await this.validateSlot(c, ctx, merged);
      await c.query(
        `UPDATE appointments SET branch_id = $2, doctor_id = $3, service_id = $4, room_id = $5, starts_at = $6, ends_at = $7, note = COALESCE($8, note),
                version = version + 1, updated_at = demo_now() WHERE id = $1`,
        [id, merged.branch_id, merged.doctor_id, merged.service_id, slot.roomId, slot.startsAt, slot.endsAt, input.note]);
      await audit(c, ctx, 'appointment.reschedule', 'appointment', id, `Ko‘chirildi: ${localDate(a.starts_at)} ${localTime(a.starts_at)} → ${merged.date} ${merged.start_time}`, merged.branch_id);
      return { data: { id } };
    });
  }

  /** Check-in: creates one queue ticket per appointment (numbered per branch and local day) and bills the booked service. Idempotent. */
  @Roles('manager', 'registrar') @Post(':id/check-in') @HttpCode(200)
  async checkIn(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(appointmentActionSchema, body);
    return this.db.tx(async (c) => {
      const a = await lockAppointment(c, ctx, id);
      const existing = (await c.query(`SELECT number FROM queue_tickets WHERE appointment_id = $1`, [id])).rows[0];
      if (existing) return { data: { id, queue_number: existing.number, already: true } };
      if (a.status !== 'scheduled') throw staleState();
      if (input.version !== undefined && input.version !== a.version) throw staleState();
      const day = localDate(a.starts_at);
      if (day !== today()) throw conflict('NOT_TODAY', 'Faqat bugungi qabul uchun «Keldi» belgilanadi');
      const arrivedAt = now();
      const num = (await c.query(
        `INSERT INTO queue_counters (branch_id, local_date, last_number) VALUES ($1,$2,1)
         ON CONFLICT (branch_id, local_date) DO UPDATE SET last_number = queue_counters.last_number + 1 RETURNING last_number`, [a.branch_id, day])).rows[0].last_number;
      await c.query(`INSERT INTO queue_tickets (tenant_id, branch_id, appointment_id, local_date, number, arrived_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [ctx.tenantId, a.branch_id, id, day, num, arrivedAt]);
      await c.query(`UPDATE appointments SET status = 'arrived', version = version + 1, updated_at = demo_now() WHERE id = $1`, [id]);
      const { invoiceId } = await createBilledOrder(c, ctx, { branchId: a.branch_id, patientId: a.patient_id, appointmentId: id, encounterId: null,
        serviceId: a.service_id, isPrimary: true, doctorId: a.doctor_id, performerDoctorId: a.doctor_id });
      await audit(c, ctx, 'appointment.check_in', 'appointment', id, `Keldi, navbat №${num}`, a.branch_id);
      return { data: { id, queue_number: num, invoice_id: invoiceId } };
    });
  }

  @Roles('doctor') @Post(':id/start') @HttpCode(200)
  async start(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(async (c) => this.startInTx(c, ctx, id));
  }

  async startInTx(c: PoolClient, ctx: Ctx, id: string) {
    const a = await lockAppointment(c, ctx, id);
    const enc = (await c.query(`SELECT id FROM encounters WHERE appointment_id = $1`, [id])).rows[0];
    if (a.status === 'in_progress' && enc) return { data: { id, encounter_id: enc.id, already: true } };
    if (a.status !== 'arrived') throw conflict('INVALID_STATE', a.status === 'scheduled' ? 'Bemor hali kelmagan. Avval registratura «Keldi» belgilashi kerak.' : 'Holat o‘zgargan. Sahifani yangilang.');
    const startedAt = now();
    const encId = (await c.query(
      `INSERT INTO encounters (id, tenant_id, branch_id, appointment_id, patient_id, doctor_id, status, started_at) VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,'open',$6) RETURNING id`,
      [ctx.tenantId, a.branch_id, id, a.patient_id, a.doctor_id, startedAt])).rows[0].id;
    await c.query(`INSERT INTO clinical_notes (id, tenant_id, encounter_id, status, version, saved_at) VALUES (gen_random_uuid(), $1, $2, 'draft', 1, $3)`, [ctx.tenantId, encId, startedAt]);
    await c.query(`UPDATE service_orders SET encounter_id = $2 WHERE appointment_id = $1 AND is_primary`, [id, encId]);
    await c.query(`UPDATE queue_tickets SET started_at = $2, wait_seconds = GREATEST(0, EXTRACT(EPOCH FROM ($2 - arrived_at)))::int WHERE appointment_id = $1`, [id, startedAt]);
    await c.query(`UPDATE appointments SET status = 'in_progress', version = version + 1, updated_at = demo_now() WHERE id = $1`, [id]);
    await audit(c, ctx, 'appointment.start', 'appointment', id, 'Qabul boshlandi', a.branch_id);
    return { data: { id, encounter_id: encId } };
  }

  @Roles('doctor') @Post(':id/complete') @HttpCode(200)
  async complete(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(async (c) => completeInTx(c, ctx, id));
  }

  @Roles('manager', 'registrar') @Post(':id/cancel') @HttpCode(200)
  async cancel(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(appointmentActionSchema, body);
    return this.db.tx(async (c) => {
      const a = await lockAppointment(c, ctx, id);
      if (input.version !== undefined && input.version !== a.version) throw staleState();
      if (!['scheduled', 'arrived'].includes(a.status)) throw conflict('INVALID_STATE', 'Bu holatdagi qabulni bekor qilib bo‘lmaydi');
      if (a.status === 'arrived' && !input.reason) throw invalid({ reason: 'Kelgan bemor qabulini bekor qilish uchun sabab kiriting' });
      await c.query(`UPDATE appointments SET status = 'cancelled', cancel_reason = $2, version = version + 1, updated_at = demo_now() WHERE id = $1`, [id, input.reason]);
      await c.query(`UPDATE service_orders SET status = 'cancelled' WHERE appointment_id = $1 AND is_primary AND status = 'ordered'`, [id]);
      const paid = (await c.query(`SELECT coalesce(sum(paid_amount),0)::bigint AS s FROM invoices WHERE appointment_id = $1 AND status <> 'void'`, [id])).rows[0].s;
      await audit(c, ctx, 'appointment.cancel', 'appointment', id, `Bekor qilindi${input.reason ? ': ' + input.reason : ''}`, a.branch_id);
      return { data: { id, needs_billing_review: Number(paid) > 0 } };
    });
  }

  @Roles('manager', 'registrar') @Post(':id/no-show') @HttpCode(200)
  async noShow(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(appointmentActionSchema, body);
    return this.db.tx(async (c) => {
      const a = await lockAppointment(c, ctx, id);
      if (input.version !== undefined && input.version !== a.version) throw staleState();
      if (a.status !== 'scheduled') throw conflict('INVALID_STATE', 'Faqat rejalashtirilgan qabul «Kelmadi» deb belgilanadi');
      if (localDate(a.starts_at) > today()) throw conflict('INVALID_STATE', 'Kelajakdagi qabulni «Kelmadi» deb belgilab bo‘lmaydi');
      await c.query(`UPDATE appointments SET status = 'no_show', version = version + 1, updated_at = demo_now() WHERE id = $1`, [id]);
      await audit(c, ctx, 'appointment.no_show', 'appointment', id, 'Kelmadi', a.branch_id);
      return { data: { id } };
    });
  }
}

/** Completes an in-progress appointment. Requires a signed clinical note. */
export async function completeInTx(c: Q, ctx: Ctx, id: string) {
  const a = await lockAppointment(c, ctx, id);
  if (a.status === 'completed') return { data: { id, already: true } };
  if (a.status !== 'in_progress') throw conflict('INVALID_STATE', 'Qabul boshlanmagan yoki holati o‘zgargan');
  const n = (await c.query(`SELECT n.status FROM encounters e JOIN clinical_notes n ON n.encounter_id = e.id WHERE e.appointment_id = $1`, [id])).rows[0];
  if (!n || n.status !== 'signed') throw new AppError(409, 'NOTE_NOT_SIGNED', 'Qabulni yakunlash uchun klinik qayd tasdiqlanishi kerak');
  const t = now();
  await c.query(`UPDATE appointments SET status = 'completed', version = version + 1, updated_at = demo_now() WHERE id = $1`, [id]);
  await c.query(`UPDATE encounters SET status = 'closed', closed_at = $2 WHERE appointment_id = $1`, [id, t]);
  await c.query(`UPDATE service_orders SET status = 'completed', performed_at = $2 WHERE appointment_id = $1 AND is_primary AND status = 'ordered'`, [id, t]);
  await c.query(`UPDATE queue_tickets SET finished_at = $2 WHERE appointment_id = $1`, [id, t]);
  await audit(c, ctx, 'appointment.complete', 'appointment', id, 'Qabul yakunlandi', a.branch_id);
  return { data: { id } };
}
