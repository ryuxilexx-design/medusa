import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { noteDraftSchema, noteSignSchema, ordersCreateSchema, REQUIRED_FOR_SIGN } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, conflict, forbidden, invalid, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { now } from '../core/clock';
import { completeInTx } from './appointments.controller';
import { createBilledOrder } from './billing';
import { Icd10Service } from '../ai/icd10';

const FIELD_LABEL: Record<string, string> = { complaints: 'Shikoyatlar', examination: 'Ko‘rik', diagnosis: 'Tashxis / xulosa', recommendations: 'Tavsiyalar' };

async function loadEncounter(q: Q, ctx: Ctx, id: string, lock = false) {
  if (!isUuid(id)) throw notFound('Qabul yozuvi');
  const e = (await q.query(
    `SELECT e.*, n.id AS note_id, n.status AS note_status, n.version AS note_version FROM encounters e JOIN clinical_notes n ON n.encounter_id = e.id
      WHERE e.id = $1 AND e.tenant_id = $2 ${lock ? 'FOR UPDATE OF n' : ''}`, [id, ctx.tenantId])).rows[0];
  if (!e) throw notFound('Qabul yozuvi');
  // Clinical notes: only the treating doctor. Managers, cashiers, registrars and lab have no access.
  if (ctx.role !== 'doctor' || e.doctor_id !== ctx.doctorId) throw forbidden('Klinik yozuvni faqat davolovchi shifokor ko‘radi');
  return e;
}

@Controller('encounters')
export class EncountersController {
  constructor(private db: Db, private icd: Icd10Service) {}

  /** undefined = keep the stored codes; otherwise every code must exist in the ICD-10 table. */
  private async icdSnapshot(c: Q, codes: string[] | undefined) {
    if (codes === undefined) return null;
    const snap = await this.icd.snapshot(c, codes);
    if (!snap) throw invalid({ icd10: 'MKB-10 kodi ro‘yxatda topilmadi' });
    return JSON.stringify(snap);
  }

  @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const e = await loadEncounter(this.db.pool, ctx, id);
    const note = await this.db.one(`SELECT * FROM clinical_notes WHERE encounter_id = $1`, [id]);
    const appt = await this.db.one(
      `SELECT a.id, a.status, a.version, a.starts_at, a.ends_at, s.name AS service_name, b.name AS branch_name, d.display_name AS doctor_name, d.specialty, r.name AS room_name
         FROM appointments a JOIN services s ON s.id = a.service_id JOIN branches b ON b.id = a.branch_id JOIN doctors d ON d.id = a.doctor_id LEFT JOIN rooms r ON r.id = a.room_id
        WHERE a.id = $1`, [e.appointment_id]);
    const patient = await this.db.one(
      `SELECT id, patient_number, last_name, first_name, middle_name, birth_date, sex, phone, allergy_state, allergy_note FROM patients WHERE id = $1`, [e.patient_id]);
    const orders = await this.db.rows(
      `SELECT o.id, o.service_name, o.category, o.status, o.ordered_at, o.price_snapshot, lr.values, lr.verified_at, lr.verified_by_name, dr.status AS report_status, dr.conclusion
         FROM service_orders o LEFT JOIN lab_results lr ON lr.order_id = o.id LEFT JOIN diagnostic_reports dr ON dr.order_id = o.id
        WHERE o.encounter_id = $1 AND NOT o.is_primary ORDER BY o.ordered_at`, [id]);
    orders.forEach((o) => { if (o.status !== 'verified') o.values = null; });
    return { data: { encounter: { id: e.id, status: e.status, started_at: e.started_at, closed_at: e.closed_at, appointment_id: e.appointment_id }, appointment: appt, patient, note, orders } };
  }

  @Put(':id/draft')
  async saveDraft(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(noteDraftSchema, body);
    return this.db.tx(async (c) => {
      const e = await loadEncounter(c, ctx, id, true);
      if (e.note_status === 'signed') throw conflict('IMMUTABLE', 'Tasdiqlangan qaydni o‘zgartirib bo‘lmaydi');
      if (e.note_version !== input.version) throw conflict('STALE_STATE', 'Qayd boshqa oynada o‘zgartirilgan. Sahifani yangilang (matningiz nusxasini saqlab qo‘ying).');
      const savedAt = now();
      const icd = await this.icdSnapshot(c, input.icd10);
      const r = (await c.query(
        `UPDATE clinical_notes SET complaints = $2, anamnesis = $3, examination = $4, diagnosis = $5, recommendations = $6, follow_up_date = $7, vitals = $8,
                icd10 = COALESCE($10::jsonb, icd10), version = version + 1, saved_at = $9 WHERE encounter_id = $1 RETURNING version, saved_at`,
        [id, input.complaints, input.anamnesis, input.examination, input.diagnosis, input.recommendations, input.follow_up_date ?? null, JSON.stringify(input.vitals ?? {}), savedAt, icd])).rows[0];
      return { data: { version: r.version, saved_at: r.saved_at } };
    });
  }

  /** Saves the final text, signs the note and completes the appointment in one transaction. */
  @Post(':id/sign') @HttpCode(200)
  async sign(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(noteSignSchema, body);
    const missing: Record<string, string> = {};
    for (const f of REQUIRED_FOR_SIGN) if (!input[f]) missing[f] = `${FIELD_LABEL[f]} to‘ldirilishi shart`;
    if (Object.keys(missing).length) throw invalid(missing, 'Tasdiqlash uchun majburiy maydonlarni to‘ldiring');
    return this.db.tx(async (c) => {
      const e = await loadEncounter(c, ctx, id, true);
      if (e.note_status === 'signed') throw conflict('IMMUTABLE', 'Qayd allaqachon tasdiqlangan');
      if (e.note_version !== input.version) throw conflict('STALE_STATE', 'Qayd boshqa oynada o‘zgartirilgan. Sahifani yangilang.');
      const t = now();
      const icd = await this.icdSnapshot(c, input.icd10);
      const signed = (await c.query(
        `UPDATE clinical_notes SET complaints = $2, anamnesis = $3, examination = $4, diagnosis = $5, recommendations = $6, follow_up_date = $7, vitals = $8,
                icd10 = COALESCE($12::jsonb, icd10), version = version + 1, saved_at = $9, status = 'signed', signed_by = $10, signed_by_name = $11, signed_at = $9
          WHERE encounter_id = $1 RETURNING icd10`,
        [id, input.complaints, input.anamnesis, input.examination, input.diagnosis, input.recommendations, input.follow_up_date ?? null, JSON.stringify(input.vitals ?? {}), t, ctx.membershipId, ctx.name, icd])).rows[0];
      const codes = (signed.icd10 as { code: string }[]).map((x) => x.code);
      await audit(c, ctx, 'clinical_note.sign', 'encounter', id, `Klinik qayd tasdiqlandi${codes.length ? ` (MKB-10: ${codes.join(', ')})` : ''}`, e.branch_id);
      const appt = (await c.query(`SELECT status FROM appointments WHERE id = $1`, [e.appointment_id])).rows[0];
      if (appt.status === 'in_progress') await completeInTx(c, ctx, e.appointment_id);
      return { data: { ok: true, signed_at: t } };
    });
  }

  /** Doctor orders lab / ultrasound / procedure services. Each order is billed exactly once on the visit invoice. */
  @Post(':id/orders')
  async createOrders(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(ordersCreateSchema, body);
    return this.db.tx(async (c) => {
      const e = await loadEncounter(c, ctx, id, true);
      const services = (await c.query(`SELECT id, name, category, active FROM services WHERE id = ANY($1) AND tenant_id = $2`, [input.service_ids, ctx.tenantId])).rows;
      if (services.length !== new Set(input.service_ids).size || services.some((s: any) => !s.active || s.category === 'consultation'))
        throw invalid({ service_ids: 'Tanlangan tekshiruvlardan biri mavjud emas yoki buyurtma qilinmaydi' });
      const performers = (await c.query(`SELECT ds.service_id, min(ds.doctor_id::text) AS doctor_id FROM doctor_services ds WHERE ds.service_id = ANY($1) GROUP BY 1`, [input.service_ids])).rows;
      const created: string[] = [];
      for (const s of services) {
        const dup = (await c.query(`SELECT 1 FROM service_orders WHERE encounter_id = $1 AND service_id = $2 AND status <> 'cancelled'`, [id, s.id])).rows[0];
        if (dup) throw conflict('DUPLICATE_ORDER', `«${s.name}» bu qabulda allaqachon buyurtma qilingan`);
        const performer = performers.find((p: any) => p.service_id === s.id)?.doctor_id ?? null;
        const { orderId } = await createBilledOrder(c, ctx, { branchId: e.branch_id, patientId: e.patient_id, appointmentId: e.appointment_id, encounterId: id,
          serviceId: s.id, isPrimary: false, doctorId: ctx.doctorId, performerDoctorId: performer });
        created.push(orderId);
        await audit(c, ctx, 'order.create', 'order', orderId, `Buyurtma: ${s.name}`, e.branch_id);
      }
      return { data: { order_ids: created } };
    });
  }
}

/** Doctor's lightweight view of the patient's previous visits (signed notes only, no hidden copy into the new note). */
@Controller('doctor')
export class DoctorController {
  constructor(private db: Db) {}
  @Roles('doctor') @Get('patient-history')
  async history(@CurrentCtx() ctx: Ctx, @Query('patient_id') patientId: string) {
    if (!isUuid(patientId)) throw notFound('Bemor');
    const ok = await this.db.one(`SELECT 1 FROM appointments WHERE patient_id = $1 AND doctor_id = $2 AND tenant_id = $3 LIMIT 1`, [patientId, ctx.doctorId, ctx.tenantId]);
    if (!ok) throw forbidden('Bu bemor sizga biriktirilmagan');
    const notes = await this.db.rows(
      `SELECT e.id AS encounter_id, a.starts_at, d.display_name AS doctor_name, d.specialty, n.status, n.complaints, n.diagnosis, n.recommendations, n.signed_at
         FROM encounters e JOIN clinical_notes n ON n.encounter_id = e.id JOIN appointments a ON a.id = e.appointment_id JOIN doctors d ON d.id = e.doctor_id
        WHERE e.patient_id = $1 AND e.tenant_id = $2 AND n.status = 'signed' ORDER BY a.starts_at DESC LIMIT 20`, [patientId, ctx.tenantId]);
    const labs = await this.db.rows(
      `SELECT o.id, o.service_name, o.status, o.ordered_at, lr.values, lr.verified_at, lr.verified_by_name
         FROM service_orders o LEFT JOIN lab_results lr ON lr.order_id = o.id
        WHERE o.patient_id = $1 AND o.tenant_id = $2 AND o.category = 'lab' ORDER BY o.ordered_at DESC LIMIT 20`, [patientId, ctx.tenantId]);
    labs.forEach((l) => { if (l.status !== 'verified') l.values = null; });
    const diagnostics = await this.db.rows(
      `SELECT o.id, o.service_name, o.status, o.ordered_at, dr.status AS report_status, dr.conclusion, dr.signed_at
         FROM service_orders o LEFT JOIN diagnostic_reports dr ON dr.order_id = o.id
        WHERE o.patient_id = $1 AND o.tenant_id = $2 AND o.category = 'ultrasound' ORDER BY o.ordered_at DESC LIMIT 20`, [patientId, ctx.tenantId]);
    diagnostics.forEach((d) => { if (d.report_status !== 'signed') d.conclusion = null; });
    return { data: { notes, labs, diagnostics } };
  }
}
void AppError;
