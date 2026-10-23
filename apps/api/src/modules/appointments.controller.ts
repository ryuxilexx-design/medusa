import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { appointmentActionSchema, appointmentCreateSchema, appointmentUpdateSchema, walkInSchema } from '@meduza/contracts';
import { PoolClient } from 'pg';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, conflict, forbidden, invalid, notFound, staleState } from '../core/errors';
import { isDate, isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, localDate, localTime, localToUtc, now, toMinutes, today, weekday } from '../core/clock';
import { assertBranch, branchScope } from '../core/scope';
import { createBilledOrder } from './billing';
import { cancelAppointment, createAppointment, lockAppointment, rescheduleAppointment, walkInSlot } from './booking';

export const APPT_SELECT = `
  SELECT a.id, a.branch_id, b.name AS branch_name, b.address AS branch_address, b.phone AS branch_phone, a.patient_id, p.patient_number, p.last_name, p.first_name, p.middle_name, p.birth_date, p.phone,
         a.doctor_id, d.display_name AS doctor_name, d.specialty, a.service_id, s.name AS service_name, s.category AS service_category,
         a.room_id, r.name AS room_name, a.starts_at, a.ends_at, a.status, a.note, a.cancel_reason, a.version, a.source, a.patient_confirmed_at,
         qt.number AS queue_number, qt.arrived_at, qt.started_at, qt.finished_at, qt.wait_seconds, e.id AS encounter_id,
         (SELECT json_build_object('id', i.id, 'status', i.status, 'total', i.total, 'paid_amount', i.paid_amount, 'invoice_number', i.invoice_number)
            FROM invoices i WHERE i.appointment_id = a.id AND i.status <> 'void' ORDER BY i.created_at LIMIT 1) AS invoice
    FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id JOIN services s ON s.id = a.service_id
    JOIN branches b ON b.id = a.branch_id LEFT JOIN rooms r ON r.id = a.room_id
    LEFT JOIN queue_tickets qt ON qt.appointment_id = a.id LEFT JOIN encounters e ON e.appointment_id = a.id`;

export { lockAppointment } from './booking';

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
    // a busy multi-branch day has 1–3k visits: never cut the afternoon off silently
    const LIMIT = 4000;
    const rows = await this.db.rows(`${APPT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.starts_at, d.display_name LIMIT ${LIMIT + 1}`, params);
    const truncated = rows.length > LIMIT;
    return { data: truncated ? rows.slice(0, LIMIT) : rows, meta: { from, to, total: Math.min(rows.length, LIMIT), truncated } };
  }

  @Roles('manager', 'registrar', 'doctor', 'cashier') @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Qabul');
    const a = await this.db.one(`${APPT_SELECT} WHERE a.id = $1 AND a.tenant_id = $2 AND a.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!a) throw notFound('Qabul');
    if (ctx.role === 'doctor' && a.doctor_id !== ctx.doctorId) throw forbidden('Bu qabul sizga tegishli emas');
    return { data: a };
  }

  /** Reception books anyone; a doctor books only their own follow-up (the schedule shows it as the doctor's booking). */
  @Roles('manager', 'registrar', 'doctor') @Post()
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    const input = parse(appointmentCreateSchema, body);
    if (ctx.role === 'doctor' && input.doctor_id !== ctx.doctorId) throw forbidden('Shifokor faqat o‘z qabuliga yozadi');
    const requestKey = key && key.length >= 8 && key.length <= 100 ? key : null;
    return this.db.tx(async (c) => {
      const r = await createAppointment(c, ctx, input, requestKey, { source: ctx.role === 'doctor' ? 'doctor' : 'staff' });
      return { data: r.replayed ? { id: r.id, replayed: true } : { id: r.id } };
    });
  }

  /**
   * «Hozir qabul qilish»: the patient is at the desk — book the nearest slot (booking.ts rules) and check them in
   * (queue number, invoice) in one transaction. 409 NO_SLOT when the doctor has nothing free within the hour.
   */
  @Roles('manager', 'registrar') @Post('walk-in')
  async walkIn(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(walkInSchema, body);
    return this.db.tx(async (c) => {
      // one walk-in per doctor at a time: two desks must not be handed the same slot
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`walk-in:${input.doctor_id}`]);
      const service = input.service_id
        ? (await c.query(`SELECT s.id, s.duration_min FROM services s WHERE s.id = $1 AND s.tenant_id = $2 AND s.active`, [input.service_id, ctx.tenantId])).rows[0]
        : (await c.query(
          `SELECT s.id, s.duration_min FROM services s JOIN doctor_services ds ON ds.service_id = s.id
            WHERE ds.doctor_id = $1 AND s.tenant_id = $2 AND s.active ORDER BY (s.category = 'consultation') DESC, s.name LIMIT 1`, [input.doctor_id, ctx.tenantId])).rows[0];
      if (!service) throw invalid({ service_id: 'Xizmat topilmadi yoki nofaol' });
      const slot = await walkInSlot(c, ctx.tenantId, input.doctor_id, service.duration_min);
      if (!slot) throw conflict('NO_SLOT', 'Shifokorda yaqin bir soatda bo‘sh vaqt yo‘q. Boshqa shifokorni tanlang yoki qabulga yozing.');
      assertBranch(ctx, slot.branch_id);
      const r = await createAppointment(c, ctx, { patient_id: input.patient_id, service_id: service.id, doctor_id: input.doctor_id, note: input.note ?? null, ...slot }, null, { walkIn: true });
      const q = await checkInAppointment(c, ctx, r.id);
      return { data: { id: r.id, queue_number: q.queue_number, invoice_id: q.invoice_id, start_time: slot.start_time } };
    });
  }

  /** Reschedule: updates the same row (never creates a duplicate). Only scheduled appointments. */
  @Roles('manager', 'registrar') @Patch(':id')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(appointmentUpdateSchema, body);
    return this.db.tx(async (c) => ({ data: await rescheduleAppointment(c, ctx, id, input) }));
  }

  /** Check-in: creates one queue ticket per appointment (numbered per branch and local day) and bills the booked service. Idempotent. */
  @Roles('manager', 'registrar') @Post(':id/check-in') @HttpCode(200)
  async checkIn(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(appointmentActionSchema, body);
    return this.db.tx(async (c) => ({ data: await checkInAppointment(c, ctx, id, input.version) }));
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
    return this.db.tx(async (c) => ({ data: await cancelAppointment(c, ctx, id, input) }));
  }

  @Roles('manager', 'registrar') @Post(':id/no-show') @HttpCode(200)
  async noShow(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(appointmentActionSchema, body);
    return this.db.tx(async (c) => {
      const a = await lockAppointment(c, ctx, id);
      if (input.version !== undefined && input.version !== a.version) throw staleState();
      if (a.status !== 'scheduled') throw conflict('INVALID_STATE', 'Faqat rejalashtirilgan qabul «Kelmadi» deb belgilanadi');
      if (localDate(a.starts_at) > today()) throw conflict('INVALID_STATE', 'Kelajakdagi qabulni «Kelmadi» deb belgilab bo‘lmaydi');
      // the patient is late, not absent, until 15 minutes after the booked time
      if (now().getTime() < new Date(a.starts_at).getTime() + 15 * 60_000) throw conflict('TOO_EARLY', 'Qabul vaqtidan 15 daqiqa o‘tmaguncha «Kelmadi» deb belgilab bo‘lmaydi');
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

/** «Keldi»: one queue ticket per appointment (numbered per branch and local day) and the booked service billed. Idempotent.
 *  Shared by the registrar's button and the camera's arrival suggestion. */
export async function checkInAppointment(c: Q, ctx: Ctx, id: string, version?: number) {
  const a = await lockAppointment(c, ctx, id);
  const existing = (await c.query(`SELECT number FROM queue_tickets WHERE appointment_id = $1`, [id])).rows[0];
  if (existing) return { id, queue_number: existing.number, already: true };
  if (a.status !== 'scheduled') throw staleState();
  if (version !== undefined && version !== a.version) throw staleState();
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
  return { id, queue_number: num, invoice_id: invoiceId };
}
