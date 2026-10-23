import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { DOCUMENT_KIND_LABEL, documentCreateSchema, documentVoidSchema, prescriptionCheckSchema } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { coded, conflict, forbidden, invalid, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, localDate, localTime, now } from '../core/clock';
import { Icd10Service } from '../ai/icd10';
import { enqueueDhp } from '../dhp/outbox';
import { AllergyWarning, checkPrescription } from './allergy-check';

const DOC_COLS = `d.id, d.kind, d.number, d.body, d.status, d.issued_at, d.issued_by_name, d.void_reason, d.voided_at, d.voided_by_name, d.encounter_id, d.patient_id`;

/**
 * Visit documents issued by the treating doctor: referral, certificate of visit, prescription.
 * The body is a snapshot (doctor, branch, visit time, diagnosis/ICD-10 as they were) so a reprint never changes.
 */
@Roles('doctor')
@Controller()
export class DocumentsController {
  constructor(private db: Db, private icd: Icd10Service) {}

  private async encounter(q: Q, ctx: Ctx, id: string) {
    if (!isUuid(id)) throw notFound('Qabul yozuvi');
    const e = (await q.query(
      `SELECT e.id, e.patient_id, e.doctor_id, e.branch_id, a.starts_at, s.name AS service_name, b.name AS branch_name, dr.display_name AS doctor_name, dr.specialty,
              n.status AS note_status, n.diagnosis, n.icd10
         FROM encounters e JOIN appointments a ON a.id = e.appointment_id JOIN services s ON s.id = a.service_id JOIN branches b ON b.id = e.branch_id
         JOIN doctors dr ON dr.id = e.doctor_id JOIN clinical_notes n ON n.encounter_id = e.id
        WHERE e.id = $1 AND e.tenant_id = $2`, [id, ctx.tenantId])).rows[0];
    if (!e) throw notFound('Qabul yozuvi');
    if (e.doctor_id !== ctx.doctorId) throw forbidden('Hujjatni faqat davolovchi shifokor beradi');
    return e;
  }

  @Post('encounters/:id/documents') @HttpCode(201)
  async issue(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(documentCreateSchema, body);
    return this.db.tx(async (c) => {
      const e = await this.encounter(c, ctx, id);
      const meta = { doctor_name: e.doctor_name, specialty: e.specialty, branch_name: e.branch_name, service_name: e.service_name,
        visit_date: localDate(e.starts_at), visit_time: localTime(e.starts_at) };
      let doc: Record<string, unknown>;
      let warnings: AllergyWarning[] = [];
      let overridden = false;
      if (input.kind === 'referral') {
        const icd = await this.icd.snapshot(c, input.body.icd10 ?? []);
        if (!icd) throw invalid({ 'body.icd10': 'MKB-10 kodi ro‘yxatda topilmadi' });
        doc = { ...input.body, icd10: icd };
      } else if (input.kind === 'certificate') {
        // the diagnosis leaves the clinic only from a signed note, and only when the patient asked for it
        if (input.body.include_diagnosis && e.note_status !== 'signed') throw conflict('NOTE_NOT_SIGNED', 'Tashxisni ma’lumotnomaga yozish uchun avval qaydni tasdiqlang');
        doc = { ...input.body,
          diagnosis: input.body.include_diagnosis ? e.diagnosis : null,
          icd10: input.body.include_diagnosis ? e.icd10 : [],
          rest_from: input.body.rest_days ? meta.visit_date : null,
          rest_until: input.body.rest_days ? addDays(meta.visit_date, input.body.rest_days - 1) : null };
      } else {
        // allergy and duplicate check (docs/DRUGS.md); the patient card is read under FOR SHARE so an allergy recorded
        // at the same moment is either seen here or recorded after the prescription
        await c.query(`SELECT 1 FROM patients WHERE id = $1 AND tenant_id = $2 FOR SHARE`, [e.patient_id, ctx.tenantId]);
        const check = await checkPrescription(c, ctx.tenantId, e.patient_id, input.body.items);
        if (Object.keys(check.duplicates).length) throw invalid(check.duplicates);
        const blocking = check.warnings.filter((w) => w.blocking);
        const reason = input.body.override_reason;
        if (blocking.length && !reason) {
          const err = coded(409, 'ALLERGY_CONFLICT', 'api.allergy.conflict', { drug: blocking[0].drug });
          err.extra = { warnings: check.warnings };
          throw err;
        }
        if (blocking.length && reason!.length < 5) throw invalid({ 'body.override_reason': 'Sababni aniqroq yozing (kamida 5 belgi)' });
        // each item keeps a snapshot of the reference entry it was picked from: a reprint never changes
        const items = input.body.items.map((it, i) => {
          const d = check.drugs[i];
          return { ...it, drug_id: d?.id ?? null, inn: d?.inn ?? null, atc: d?.atc ?? null, prescription_only: d?.prescription_only ?? false };
        });
        doc = { items, notes: input.body.notes,
          allergy_check: { warnings: check.warnings, override_reason: blocking.length ? reason : null, checked_at: now().toISOString() } };
        warnings = check.warnings;
        overridden = blocking.length > 0;
      }
      const number = (await c.query(`UPDATE tenants SET document_seq = document_seq + 1 WHERE id = $1 RETURNING document_seq`, [ctx.tenantId])).rows[0].document_seq;
      const row = (await c.query(
        `INSERT INTO medical_documents (tenant_id, branch_id, encounter_id, patient_id, doctor_id, kind, number, body, issued_by, issued_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, number, issued_at`,
        [ctx.tenantId, e.branch_id, e.id, e.patient_id, e.doctor_id, input.kind, number, JSON.stringify({ ...doc, meta }), ctx.membershipId || null, ctx.name])).rows[0];
      await audit(c, ctx, 'document.issue', 'document', row.id, `${DOCUMENT_KIND_LABEL[input.kind]} №${number} berildi`, e.branch_id);
      // the reason itself stays in the document (clinical text never goes to the audit log)
      if (overridden) await audit(c, ctx, 'document.allergy_override', 'document', row.id, `${DOCUMENT_KIND_LABEL[input.kind]} №${number}: og‘ir allergiya ogohlantirishiga qaramay berildi (sabab hujjatda)`, e.branch_id);
      // e-prescription to the Digital Health Platform (MedicationRequest per drug); nothing when the mode is off
      if (input.kind === 'prescription') await enqueueDhp(c, ctx.tenantId, 'prescription', row.id);
      return { data: { ...row, warnings } };
    });
  }

  /** The same allergy/duplicate check as on issue, without issuing: the form shows the red banner while the doctor picks drugs. */
  @Post('encounters/:id/prescription-check') @HttpCode(200)
  async check(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { items } = parse(prescriptionCheckSchema, body);
    const e = await this.encounter(this.db.pool, ctx, id);
    const r = await checkPrescription(this.db.pool, ctx.tenantId, e.patient_id, items);
    return { data: { warnings: r.warnings, duplicates: r.duplicates,
      drugs: r.drugs.map((d) => d && { id: d.id, inn: d.inn, atc: d.atc, prescription_only: d.prescription_only }) } };
  }

  @Get('encounters/:id/documents')
  async list(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const e = await this.encounter(this.db.pool, ctx, id);
    return { data: await this.db.rows(`SELECT ${DOC_COLS} FROM medical_documents d WHERE d.encounter_id = $1 ORDER BY d.issued_at, d.number`, [e.id]) };
  }

  /** One document with the patient header, for printing. */
  @Get('documents/:id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Hujjat');
    const d = await this.db.one(`SELECT ${DOC_COLS}, d.doctor_id FROM medical_documents d WHERE d.id = $1 AND d.tenant_id = $2`, [id, ctx.tenantId]);
    if (!d) throw notFound('Hujjat');
    if (d.doctor_id !== ctx.doctorId) throw forbidden('Bu hujjat sizga tegishli emas');
    const patient = await this.db.one(`SELECT id, patient_number, last_name, first_name, middle_name, birth_date, sex FROM patients WHERE id = $1`, [d.patient_id]);
    delete d.doctor_id;
    return { data: { ...d, patient } };
  }

  @Post('documents/:id/void') @HttpCode(200)
  async void(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    if (!isUuid(id)) throw notFound('Hujjat');
    const { reason } = parse(documentVoidSchema, body);
    return this.db.tx(async (c) => {
      const d = (await c.query(`SELECT id, kind, number, status, doctor_id, branch_id FROM medical_documents WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (!d) throw notFound('Hujjat');
      if (d.doctor_id !== ctx.doctorId) throw forbidden('Bu hujjat sizga tegishli emas');
      if (d.status === 'void') throw conflict('ALREADY_VOID', 'Hujjat allaqachon bekor qilingan');
      await c.query(`UPDATE medical_documents SET status = 'void', void_reason = $2, voided_at = demo_now(), voided_by_name = $3 WHERE id = $1`, [id, reason, ctx.name]);
      // a voided prescription goes to the platform again as version 2 with status «cancelled»
      if (d.kind === 'prescription') await enqueueDhp(c, ctx.tenantId, 'prescription', id, 2);
      await audit(c, ctx, 'document.void', 'document', id, `${DOCUMENT_KIND_LABEL[d.kind as 'referral']} №${d.number} bekor qilindi`, d.branch_id);
      return { data: { ok: true } };
    });
  }
}
