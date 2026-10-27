import { GUARDIAN_CARD_SQL, NOTICE_CHANNEL_SQL } from '../telegram/outbox';
import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { translate, BIOMETRIC_CONSENT_VERSION, CONSENT_TEXT_VERSION, consentRecordSchema, patientAnonymiseSchema, patientCreateSchema, patientUpdateSchema, searchTranslit } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, coded, forbidden, notFound } from '../core/errors';
import { isUuid, pageParams, parse } from '../core/validate';
import { audit } from '../core/audit';
import { today } from '../core/clock';
import { config } from '../core/config';
import { consentHistory, latestConsents, recordConsent } from './consent';
import { anonymisePatient, patientCard, patientExport, takeExportSlot } from './erasure';
import { assertLeadSource } from './referrals';

const FULL_COLS = `p.id, p.patient_number, p.last_name, p.first_name, p.middle_name, p.birth_date, p.sex, p.phone, p.contact_name, p.contact_phone, p.address, p.note, p.pinfl, p.id_document, p.created_at, p.updated_at, p.source, p.anonymised_at,
  p.lead_source_id, (SELECT ls.name FROM lead_sources ls WHERE ls.id = p.lead_source_id) AS lead_source_name,
  EXISTS (SELECT 1 FROM telegram_chats tc JOIN telegram_bots b ON b.id = tc.bot_id
           WHERE tc.tenant_id = p.tenant_id AND tc.phone IS NOT NULL AND (tc.phone = p.phone OR (tc.phone = p.contact_phone AND ${GUARDIAN_CARD_SQL})) AND NOT tc.blocked AND b.status = 'active') AS telegram_linked,
  ${NOTICE_CHANNEL_SQL} AS notice_channel`;
const MIN_COLS = `p.id, p.patient_number, p.last_name, p.first_name, p.middle_name, p.birth_date, p.sex, p.anonymised_at`;

/** Doctors only see patients that have (had) an appointment with them. */
export async function assertPatientAccess(q: Q, ctx: Ctx, patientId: string) {
  if (!isUuid(patientId)) throw notFound('Bemor');
  const p = (await q.query(`SELECT id FROM patients WHERE id = $1 AND tenant_id = $2`, [patientId, ctx.tenantId])).rows[0];
  if (!p) throw notFound('Bemor');
  if (ctx.role === 'doctor') {
    const ok = (await q.query(`SELECT 1 FROM appointments WHERE patient_id = $1 AND doctor_id = $2 LIMIT 1`, [patientId, ctx.doctorId])).rows[0];
    if (!ok) throw forbidden('Bu bemor sizga biriktirilmagan');
  }
}

/**
 * The follow-up the treating doctor recommended in the latest signed note (a date, no clinical text) and whether it is
 * booked: any later booking of the patient with that doctor that is not cancelled. Reception sees the marker and books it.
 */
export async function followUp(q: Q, tenantId: string, patientId: string, onlyDoctorId: string | null = null) {
  // an anonymised card (migration 026, patients.anonymised_at) never offers a follow-up; read through to_jsonb so the
  // check works on a database with or without that column
  const gone = (await q.query(`SELECT (to_jsonb(p) ->> 'anonymised_at') IS NOT NULL AS gone FROM patients p WHERE p.id = $1 AND p.tenant_id = $2`, [patientId, tenantId])).rows[0];
  if (!gone || gone.gone) return null;
  const n = (await q.query(
    `SELECT n.follow_up_date AS date, n.signed_at, e.doctor_id, d.display_name AS doctor_name, e.id AS encounter_id, e.appointment_id
       FROM encounters e JOIN clinical_notes n ON n.encounter_id = e.id JOIN doctors d ON d.id = e.doctor_id
      WHERE e.patient_id = $1 AND e.tenant_id = $2 AND n.status = 'signed' AND n.follow_up_date IS NOT NULL
        AND ($3::uuid IS NULL OR e.doctor_id = $3)
      ORDER BY n.signed_at DESC LIMIT 1`, [patientId, tenantId, onlyDoctorId])).rows[0];
  if (!n) return null;
  const booked = (await q.query(
    `SELECT a.id, a.starts_at FROM appointments a WHERE a.patient_id = $1 AND a.doctor_id = $2 AND a.starts_at > $3 AND a.id <> $4 AND a.status NOT IN ('cancelled', 'no_show')
      ORDER BY a.starts_at LIMIT 1`, [patientId, n.doctor_id, n.signed_at, n.appointment_id])).rows[0]; // the visit itself may still be running when the note is signed
  return { date: n.date, doctor_id: n.doctor_id, doctor_name: n.doctor_name, encounter_id: n.encounter_id, booked: !!booked, appointment_id: booked?.id ?? null, starts_at: booked?.starts_at ?? null };
}

/** PINFL is unique per clinic (partial unique index, migration 029): a friendly 409 naming the other card. */
async function assertPinflFree(q: Q, tenantId: string, pinfl: string | null | undefined, selfId: string | null) {
  if (!pinfl) return;
  const other = (await q.query(`SELECT patient_number FROM patients WHERE tenant_id = $1 AND pinfl = $2 AND ($3::uuid IS NULL OR id <> $3)`, [tenantId, pinfl, selfId])).rows[0];
  if (other) {
    const msg = translate('uz', 'api.dhp.pinflTaken', { n: other.patient_number });
    throw new AppError(409, 'PINFL_TAKEN', msg, { pinfl: msg });
  }
}

@Controller('patients')
export class PatientsController {
  constructor(private db: Db) {}

  // the patient directory is for reception, cashiers, doctors (own patients) and the manager — not the lab
  @Roles('manager', 'registrar', 'doctor', 'cashier') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { page, pageSize, offset } = pageParams(q);
    const params: unknown[] = [ctx.tenantId];
    const where: string[] = ['p.tenant_id = $1'];
    const search = String(q.search ?? '').trim();
    if (search) {
      const digits = search.replace(/[\s+\-()]/g, '');
      const like = (v: string) => `%${v.replace(/[\\%_]/g, '\\$&')}%`; // % and _ typed by a person are literal
      const anyApostrophe = (pattern: string) => pattern.replace(/[‘’'`ʻʼ]/g, '_'); // o‘ / o' / oʻ are one name
      params.push(anyApostrophe(like(search.toLowerCase())));
      const i = params.length;
      // the same two indexed expressions (migration 015) for every pattern: OR of indexed conditions keeps the trigram index
      const nameConds = (n: number) => [`lower(p.last_name || ' ' || p.first_name || ' ' || coalesce(p.middle_name,'')) LIKE $${n}`, `lower(p.first_name || ' ' || p.last_name) LIKE $${n}`];
      const conds = nameConds(i);
      // a name typed in the other script finds the card too (Каримов ↔ Karimov); any apostrophe form is accepted (o‘/o')
      const other = searchTranslit(search);
      if (other) { params.push(anyApostrophe(like(other.toLowerCase()))); conds.push(...nameConds(params.length)); }
      if (/^\d+$/.test(digits)) params.push(like(digits)), conds.push(`replace(coalesce(p.phone,''),'+','') LIKE $${params.length}`);
      // an anonymised card (ZRU-547 erasure) is never found by name or phone — only by its number, the one handle the record keeps
      let byNumber = '';
      // a full phone number is longer than any patient number (integer): only short digit strings are IDs
      if (/^\d+$/.test(digits) && digits.length <= 9) { params.push(Number(digits)); byNumber = ` OR p.patient_number = $${params.length}`; }
      where.push(`((p.anonymised_at IS NULL AND (${conds.join(' OR ')}))${byNumber})`);
    }
    if (ctx.role === 'doctor') { params.push(ctx.doctorId); where.push(`EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.doctor_id = $${params.length})`); }
    const minimal = ctx.role === 'cashier' || ctx.role === 'lab';
    const total = (await this.db.one(`SELECT count(*)::int AS n FROM patients p WHERE ${where.join(' AND ')}`, params))!.n;
    params.push(pageSize, offset);
    const rows = await this.db.rows(
      `SELECT ${minimal ? MIN_COLS : FULL_COLS},
              (SELECT max(a.starts_at) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'completed') AS last_visit,
              (SELECT min(a.starts_at) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'scheduled' AND a.starts_at > demo_now() - interval '12 hours') AS next_appointment
         FROM patients p WHERE ${where.join(' AND ')}
         ORDER BY ${search ? 'p.last_name, p.first_name' : 'p.created_at DESC, p.patient_number DESC'}
         LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    if (ctx.role === 'doctor') rows.forEach((r) => { delete r.lead_source_id; delete r.lead_source_name; });
    return { data: rows, meta: { page, page_size: pageSize, total } };
  }

  @Roles('manager', 'registrar') @Post('duplicates')
  async duplicates(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(patientCreateSchema.partial().extend({ last_name: z.string().optional(), first_name: z.string().optional() }), body);
    return { data: await this.findDuplicates(this.db.pool, ctx, input as any) };
  }

  private async findDuplicates(q: Q, ctx: Ctx, input: { phone?: string | null; last_name?: string; first_name?: string; birth_date?: string }, excludeId?: string) {
    const conds: string[] = []; const params: unknown[] = [ctx.tenantId, excludeId ?? null];
    if (input.phone) { params.push(input.phone); conds.push(`(p.phone = $${params.length} OR p.contact_phone = $${params.length})`); }
    if (input.last_name && input.first_name && input.birth_date) {
      params.push(input.last_name.trim().toLowerCase(), input.first_name.trim().toLowerCase(), input.birth_date);
      conds.push(`(lower(p.last_name) = $${params.length - 2} AND lower(p.first_name) = $${params.length - 1} AND p.birth_date = $${params.length})`);
    }
    if (!conds.length) return [];
    const rows = (await q.query(
      `SELECT p.id, p.patient_number, p.last_name, p.first_name, p.middle_name, p.birth_date, p.phone,
              CASE WHEN ${input.last_name && input.first_name && input.birth_date ? `lower(p.last_name) = $${params.length - 2} AND lower(p.first_name) = $${params.length - 1} AND p.birth_date = $${params.length}` : 'false'} THEN 'name_birth' ELSE 'phone' END AS match
         FROM patients p WHERE p.tenant_id = $1 AND p.anonymised_at IS NULL AND ($2::uuid IS NULL OR p.id <> $2) AND (${conds.join(' OR ')}) ORDER BY p.patient_number LIMIT 10`, params)).rows;
    return rows;
  }

  @Roles('manager', 'registrar') @Post()
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(patientCreateSchema, body);
    if (input.birth_date > today()) throw new AppError(422, 'VALIDATION', 'Maydonlarni tekshiring', { birth_date: 'Tug‘ilgan sana kelajakda bo‘lishi mumkin emas' });
    if (input.birth_date < '1900-01-01') throw new AppError(422, 'VALIDATION', 'Maydonlarni tekshiring', { birth_date: 'Tug‘ilgan sana noto‘g‘ri' });
    // A real clinic (production) records the patient's consent to data processing before the card exists (ZRU-547).
    if (config.mode === 'production' && input.consent?.data_processing !== true) {
      throw new AppError(422, 'CONSENT_REQUIRED', 'Roziliksiz bemor kartasi ochilmaydi', { consent: 'Bemor shaxsiy ma’lumotlarni qayta ishlashga rozilik berganini belgilang' });
    }
    return this.db.tx(async (c) => {
      // serialise registrations of the same birth date in this clinic, so parallel saves of one person see each other
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`patient:${ctx.tenantId}:${input.birth_date}`]);
      const dups = await this.findDuplicates(c, ctx, input);
      if (dups.length && !input.confirm_duplicate) {
        throw new AppError(409, 'DUPLICATE_WARNING', 'O‘xshash bemor topildi. Mavjud profilni oching yoki yangi bemor yaratishni tasdiqlang.', undefined, { candidates: dups });
      }
      await assertPinflFree(c, ctx.tenantId, input.pinfl, null);
      if (input.lead_source_id) await assertLeadSource(c, ctx.tenantId, input.lead_source_id);
      const seq = (await c.query(`UPDATE tenants SET patient_seq = patient_seq + 1 WHERE id = $1 RETURNING patient_seq`, [ctx.tenantId])).rows[0].patient_seq;
      const row = (await c.query(
        `INSERT INTO patients (id, tenant_id, patient_number, last_name, first_name, middle_name, birth_date, sex, phone, contact_name, contact_phone, address, note, allergy_state, allergy_note, pinfl, id_document, lead_source_id)
         VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id, patient_number`,
        [ctx.tenantId, seq, input.last_name, input.first_name, input.middle_name, input.birth_date, input.sex, input.phone, input.contact_name, input.contact_phone,
          input.address, input.note, input.allergy_state, input.allergy_note, input.pinfl ?? null, input.id_document ?? null, input.lead_source_id ?? null])).rows[0];
      await audit(c, ctx, 'patient.create', 'patient', row.id, `Bemor #${row.patient_number} yaratildi${dups.length ? ' (dublikat ogohlantirishi tasdiqlangan)' : ''}`);
      const consent = input.consent;
      if (consent?.data_processing) await recordConsent(c, ctx, row.id, { kind: 'data_processing', granted: true, method: consent.method, textVersion: CONSENT_TEXT_VERSION });
      if (consent?.notifications) await recordConsent(c, ctx, row.id, { kind: 'notifications', granted: true, method: consent.method, textVersion: CONSENT_TEXT_VERSION });
      return { data: row };
    });
  }

  // every role that meets patients; the storekeeper never opens a patient card (it sees only name and number on a request)
  @Roles('manager', 'registrar', 'doctor', 'cashier', 'lab') @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await assertPatientAccess(this.db.pool, ctx, id);
    const minimal = ctx.role === 'cashier' || ctx.role === 'lab';
    const p = await this.db.one(
      `SELECT ${minimal ? MIN_COLS : FULL_COLS}${ctx.role === 'doctor' ? ', p.allergy_state, p.allergy_note' : ''},
              (SELECT coalesce(sum(i.total - i.paid_amount),0) FROM invoices i WHERE i.patient_id = p.id AND i.status <> 'void' AND i.branch_id = ANY($3))::bigint AS balance_due,
              (SELECT coalesce(sum(CASE WHEN d.kind = 'in' THEN d.amount ELSE -d.amount END),0) FROM patient_deposits d WHERE d.patient_id = p.id)::bigint AS deposit_balance
         FROM patients p WHERE p.id = $1 AND p.tenant_id = $2`, [id, ctx.tenantId, ctx.branchIds]);
    if (ctx.role === 'doctor' || ctx.role === 'lab') { delete (p as any).balance_due; delete (p as any).deposit_balance; }
    if (ctx.role === 'doctor') { delete (p as any).lead_source_id; delete (p as any).lead_source_name; } // reception's marketing field (docs/REFERRALS.md)
    // consent status: for the roles that collect it (not cashier/lab, who see only the minimal card)
    if (!minimal) (p as any).consents = await latestConsents(this.db.pool, ctx.tenantId, id);
    if (!minimal) (p as any).follow_up = await followUp(this.db.pool, ctx.tenantId, id, ctx.role === 'doctor' ? ctx.doctorId : null); // a doctor sees only their own recommendation
    return { data: p };
  }

  /** Consent history (append-only, newest first). */
  @Roles('manager', 'registrar', 'doctor') @Get(':id/consents')
  async consents(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await assertPatientAccess(this.db.pool, ctx, id);
    return { data: await consentHistory(this.db.pool, ctx.tenantId, id) };
  }

  /** Records a consent, a refusal or a withdrawal as a new row (rows are never changed or deleted). */
  @Roles('manager', 'registrar', 'doctor') @Post(':id/consents')
  async addConsent(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    await assertPatientAccess(this.db.pool, ctx, id);
    const input = parse(consentRecordSchema, body);
    // face recognition needs a signed paper form (written consent); a verbal «yes» is not enough
    if (input.kind === 'biometric' && input.granted && input.method !== 'signed_paper')
      throw new AppError(422, 'VALIDATION', 'Maydonlarni tekshiring', { method: 'Yuzni tanish uchun faqat imzolangan varaqa' });
    const row = await this.db.tx(async (c) => {
      // the patient row is locked so the consent and any concurrent card change are ordered
      const p = (await c.query(`SELECT anonymised_at FROM patients WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (p?.anonymised_at) throw coded(409, 'PATIENT_ANONYMISED', 'api.erasure.anonymised');
      return recordConsent(c, ctx, id, { kind: input.kind, granted: input.granted, method: input.method, textVersion: input.kind === 'biometric' ? BIOMETRIC_CONSENT_VERSION : CONSENT_TEXT_VERSION, note: input.note });
    });
    return { data: row };
  }

  @Roles('manager', 'registrar', 'doctor') @Patch(':id')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    await assertPatientAccess(this.db.pool, ctx, id);
    const input = parse(patientUpdateSchema, body) as Record<string, any>;
    // doctors may only update the allergy status; registrars/managers only demographic data
    const allowed = ctx.role === 'doctor' ? ['allergy_state', 'allergy_note'] : ['last_name', 'first_name', 'middle_name', 'birth_date', 'sex', 'phone', 'contact_name', 'contact_phone', 'address', 'note', 'pinfl', 'id_document', 'lead_source_id'];
    const keys = Object.keys(input).filter((k) => allowed.includes(k) && (body as any)?.[k] !== undefined);
    if (!keys.length) return { data: { ok: true } };
    if (input.birth_date && input.birth_date > today()) throw new AppError(422, 'VALIDATION', 'Maydonlarni tekshiring', { birth_date: 'Tug‘ilgan sana kelajakda bo‘lishi mumkin emas' });
    await this.db.tx(async (c) => {
      // an anonymised card has no identity to edit (the DB trigger refuses too); the doctor's allergy note is medical record and stays editable
      const cur = (await c.query(`SELECT anonymised_at FROM patients WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (cur?.anonymised_at && ctx.role !== 'doctor') throw coded(409, 'PATIENT_ANONYMISED', 'api.erasure.anonymised');
      if (keys.includes('pinfl')) await assertPinflFree(c, ctx.tenantId, input.pinfl, id);
      if (input.lead_source_id) await assertLeadSource(c, ctx.tenantId, input.lead_source_id);
      const sets = keys.map((k, i) => `${k} = $${i + 3}`);
      await c.query(`UPDATE patients SET ${sets.join(', ')}, updated_at = demo_now() WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId, ...keys.map((k) => input[k])]);
      await audit(c, ctx, ctx.role === 'doctor' ? 'patient.allergy_update' : 'patient.update', 'patient', id, `O‘zgargan maydonlar: ${keys.join(', ')}`);
    });
    return { data: { ok: true } };
  }

  /** Printable patient card (ZRU-547 access right): role-filtered — diagnosis for the doctor only, invoices for the finance roles only. */
  @Roles('manager', 'registrar', 'doctor') @Get(':id/card')
  async card(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await assertPatientAccess(this.db.pool, ctx, id);
    return { data: await patientCard(this.db.pool, ctx, id) };
  }

  /**
   * Subject-access export (ZRU-547): the whole record as a sealed JSON download for the patient. Manager only, audited,
   * 5 per minute per clinic. The web client offers only «Yuklab olish» and never renders the content (see erasure.ts).
   */
  @Roles('manager') @Get(':id/export.json')
  async exportJson(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    await assertPatientAccess(this.db.pool, ctx, id);
    if (!takeExportSlot(ctx.tenantId)) throw coded(429, 'EXPORT_RATE_LIMIT', 'api.erasure.rateLimit');
    const data = await this.db.tx(async (c) => {
      const out = await patientExport(c, ctx, id);
      await audit(c, ctx, 'patient.export', 'patient', id, `Bemor #${out.patient.patient_number} ma’lumotlari eksport qilindi (O‘RQ-547 so‘rovi)`);
      return out;
    });
    res.setHeader('Content-Disposition', `attachment; filename="med-uz-ai-patient-${data.patient.patient_number}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    return data;
  }

  /** Erasure request (ZRU-547): irreversible anonymisation of the card; the medical record stays under the anonymous number. */
  @Roles('manager') @Post(':id/anonymise')
  async anonymise(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    await assertPatientAccess(this.db.pool, ctx, id);
    const input = parse(patientAnonymiseSchema, body);
    return { data: await this.db.tx((c) => anonymisePatient(c, ctx, id, input)) };
  }

  /** Role-filtered timeline: visits, clinical notes (doctor), lab results, diagnostics (doctor), invoices (finance roles). */
  @Roles('manager', 'registrar', 'doctor', 'cashier', 'lab') @Get(':id/history')
  async history(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await assertPatientAccess(this.db.pool, ctx, id);
    const r = ctx.role;
    const visits = r === 'lab' ? [] : await this.db.rows(
      `SELECT a.id, a.starts_at, a.ends_at, a.status, a.branch_id, b.name AS branch_name, d.display_name AS doctor_name, d.specialty, s.name AS service_name,
              e.id AS encounter_id, n.status AS note_status, n.signed_at,
              a.referral_partner_id, rp.full_name AS referral_partner_name, rp.code AS referral_partner_code, a.lead_source_id, ls.name AS lead_source_name
         FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN services s ON s.id = a.service_id JOIN branches b ON b.id = a.branch_id
         LEFT JOIN encounters e ON e.appointment_id = a.id LEFT JOIN clinical_notes n ON n.encounter_id = e.id
         LEFT JOIN referral_partners rp ON rp.id = a.referral_partner_id LEFT JOIN lead_sources ls ON ls.id = a.lead_source_id
        WHERE a.patient_id = $1 AND a.tenant_id = $2 ORDER BY a.starts_at DESC`, [id, ctx.tenantId]);
    if (r !== 'doctor') visits.forEach((v) => { delete v.note_status; delete v.signed_at; delete v.encounter_id; });
    // who referred the patient is reception's and the manager's business (docs/REFERRALS.md), never the doctor's
    else visits.forEach((v) => { for (const k of ['referral_partner_id', 'referral_partner_name', 'referral_partner_code', 'lead_source_id', 'lead_source_name']) delete v[k]; });
    const notes = r !== 'doctor' ? [] : await this.db.rows(
      `SELECT n.id, n.encounter_id, e.appointment_id, n.status, n.complaints, n.diagnosis, n.recommendations, n.signed_at, n.signed_by_name, n.saved_at,
              d.display_name AS doctor_name, d.specialty, a.starts_at
         FROM clinical_notes n JOIN encounters e ON e.id = n.encounter_id JOIN doctors d ON d.id = e.doctor_id JOIN appointments a ON a.id = e.appointment_id
        WHERE e.patient_id = $1 AND n.tenant_id = $2 ORDER BY a.starts_at DESC`, [id, ctx.tenantId]);
    const labs = await this.db.rows(
      `SELECT o.id, o.service_name, o.status, o.ordered_at, d.display_name AS ordered_by, lr.verified_at, lr.verified_by_name,
              ${r === 'doctor' || r === 'lab' ? `CASE WHEN o.status = 'verified' OR $3 = 'lab' THEN lr.values END AS values,` : ''} o.encounter_id
         FROM service_orders o LEFT JOIN lab_results lr ON lr.order_id = o.id LEFT JOIN doctors d ON d.id = o.doctor_id
        WHERE o.patient_id = $1 AND o.tenant_id = $2 AND o.category = 'lab' AND ($3 <> 'cashier') ORDER BY o.ordered_at DESC`, [id, ctx.tenantId, r]);
    const diagnostics = r !== 'doctor' ? [] : await this.db.rows(
      `SELECT o.id, o.service_name, o.status, o.ordered_at, dr.status AS report_status, dr.conclusion, dr.signed_at, dr.specialist_name
         FROM service_orders o LEFT JOIN diagnostic_reports dr ON dr.order_id = o.id
        WHERE o.patient_id = $1 AND o.tenant_id = $2 AND o.category = 'ultrasound' ORDER BY o.ordered_at DESC`, [id, ctx.tenantId]);
    const invoices = r === 'doctor' || r === 'lab' ? [] : await this.db.rows(
      `SELECT i.id, i.invoice_number, i.status, i.total, i.paid_amount, i.created_at, b.name AS branch_name,
              (SELECT string_agg(it.description || CASE WHEN it.quantity > 1 THEN ' × ' || it.quantity ELSE '' END, ', ' ORDER BY it.position) FROM invoice_items it WHERE it.invoice_id = i.id) AS services
         FROM invoices i JOIN branches b ON b.id = i.branch_id WHERE i.patient_id = $1 AND i.tenant_id = $2 AND i.branch_id = ANY($3) ORDER BY i.created_at DESC`, [id, ctx.tenantId, ctx.branchIds]);
    return { data: { visits, notes, labs, diagnostics, invoices } };
  }
}
