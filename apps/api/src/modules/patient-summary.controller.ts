import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { DOCUMENT_AUTOFILL_KINDS, isLocale, patientSummaryApproveSchema, patientSummaryDraftSchema, type SummaryLanguage } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { coded, forbidden, invalid, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { localDate } from '../core/clock';
import { AiClient } from '../ai/ai-client';
import { draftReason, draftSummary, drugStems, NoteSource, prescriptionFromNote, restDaysFromNote, RxItem, stripCodes } from '../ai/patient-summary';
import { enqueueNoticeChannel, LINKED_CHATS_SQL, noticeChannel } from '../telegram/outbox';
import { reasonText } from './ai.controller';

const LANG_UZ: Record<SummaryLanguage, string> = { uz: 'o‘zbek (lotin)', 'uz-Cyrl': 'o‘zbek (kirill)', ru: 'rus' };
const reasonDraftSchema = z.object({ to_specialty: z.string().max(120).optional().nullable() });

/**
 * The encounter with its note and the patient's identity (for de-identification), for the treating doctor only:
 * another doctor, a manager, a registrar — 403; another clinic's id — 404.
 */
async function visit(q: Q, ctx: Ctx, id: string, lock = false) {
  if (!isUuid(id)) throw notFound('Qabul yozuvi');
  const e = (await q.query(
    `SELECT e.id, e.patient_id, e.doctor_id, e.branch_id, a.starts_at, n.id AS note_id, n.status AS note_status,
            n.complaints, n.anamnesis, n.examination, n.diagnosis, n.recommendations, n.follow_up_date::text AS follow_up_date, n.icd10,
            p.last_name, p.first_name, p.middle_name, p.birth_date::text AS birth_date, p.patient_number, p.phone
       FROM encounters e JOIN clinical_notes n ON n.encounter_id = e.id JOIN appointments a ON a.id = e.appointment_id JOIN patients p ON p.id = e.patient_id
      WHERE e.id = $1 AND e.tenant_id = $2 ${lock ? 'FOR UPDATE OF e' : ''}`, [id, ctx.tenantId])).rows[0];
  if (!e) throw notFound('Qabul yozuvi');
  if (ctx.role !== 'doctor' || e.doctor_id !== ctx.doctorId) throw forbidden('Klinik yozuvni faqat davolovchi shifokor ko‘radi');
  return e;
}
const noteOf = (e: any): NoteSource => ({ complaints: e.complaints, anamnesis: e.anamnesis, examination: e.examination, diagnosis: e.diagnosis,
  recommendations: e.recommendations, follow_up_date: e.follow_up_date, icd10: e.icd10 ?? [] });
const identityOf = (e: any) => ({ last_name: e.last_name, first_name: e.first_name, middle_name: e.middle_name, birth_date: e.birth_date, patient_number: e.patient_number, phone: e.phone });
async function rxItems(q: Q, ctx: Ctx, encounterId: string): Promise<RxItem[]> {
  const docs = (await q.query(`SELECT body FROM medical_documents WHERE encounter_id = $1 AND tenant_id = $2 AND kind = 'prescription' AND status = 'issued'`, [encounterId, ctx.tenantId])).rows;
  return docs.flatMap((d: any) => (d.body?.items ?? []) as RxItem[]);
}

/**
 * Patient-friendly visit summary (AI route `patient_summary`, clinical) and «fill from the note» for documents
 * (deterministic; AI route `document_draft` only for the referral reason). Doctor-only; nothing is sent, issued or
 * signed without the doctor's explicit approval.
 */
@Roles('doctor')
@Controller()
export class PatientSummaryController {
  constructor(private db: Db, private ai: AiClient) {}

  /** The draft in the language the doctor picked for the patient. The note must be signed. Nothing is stored. */
  @Post('encounters/:id/patient-summary/draft') @HttpCode(200)
  async draft(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { language } = parse(patientSummaryDraftSchema, body);
    const e = await visit(this.db.pool, ctx, id);
    if (e.note_status !== 'signed') throw coded(409, 'NOTE_NOT_SIGNED', 'api.ps.notSigned');
    const rx = await rxItems(this.db.pool, ctx, id);
    const d = await draftSummary(this.db, this.ai, ctx, { note: noteOf(e), rx, patient: identityOf(e), lang: language, offReason: reasonText(ctx, this.ai.clinicalOffReason(ctx.tenantId)) });
    await audit(this.db.pool, ctx, 'ai.patient_summary', 'encounter', id,
      d.mode === 'live' ? `Bemor uchun xulosa loyihasi (AI), olib tashlangan gaplar: ${d.dropped}` : d.mode === 'sample' ? 'Bemor uchun xulosa: Namunaviy AI natijasi (shablon)' : 'Bemor uchun xulosa: shablon (AI o‘chiq)', e.branch_id);
    return { data: { ...d, language, follow_up_date: e.follow_up_date } };
  }

  /**
   * The doctor's approval: a new immutable version. With `send` (and the doctor's explicit confirmation) it is queued
   * in the outbox in the same transaction — Telegram (the text, own linked chat) or SMS (only «ready»). When the
   * patient cannot be reached nothing is saved (409) so the doctor can print instead.
   */
  @Post('encounters/:id/patient-summaries') @HttpCode(201)
  async approve(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(patientSummaryApproveSchema, body);
    return this.db.tx(async (c) => {
      const e = await visit(c, ctx, id, true);
      if (e.note_status !== 'signed') throw coded(409, 'NOTE_NOT_SIGNED', 'api.ps.notSigned');
      const version = (await c.query(`SELECT coalesce(max(version), 0) + 1 AS v FROM patient_summaries WHERE encounter_id = $1`, [id])).rows[0].v;
      if (input.send && !(await noticeChannel(c, ctx.tenantId, e.patient_id))) throw coded(409, 'NO_CHANNEL', 'api.ps.noChannel');
      const row = (await c.query(
        `INSERT INTO patient_summaries (tenant_id, encounter_id, note_id, patient_id, doctor_id, branch_id, version, language, text, draft_source, approved_by, approved_by_name, send_requested)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, version, language, text, approved_by_name, approved_at, send_requested`,
        [ctx.tenantId, id, e.note_id, e.patient_id, e.doctor_id, e.branch_id, version, input.language, input.text, input.draft_source, ctx.membershipId || null, ctx.name, input.send])).rows[0];
      const channel = input.send
        ? await enqueueNoticeChannel(c, { tenantId: ctx.tenantId, kind: 'patient_summary', patientId: e.patient_id, summaryId: row.id, dedupeKey: `patient_summary:${row.id}` })
        : null;
      // no text in the audit trail: version, language and where it was queued
      await audit(c, ctx, 'patient_summary.approve', 'encounter', id,
        `Bemor uchun xulosa v${version} tasdiqlandi (til: ${LANG_UZ[input.language]})${channel ? `; yuborishga qo‘yildi: ${channel === 'sms' ? 'SMS («tayyor» xabari)' : 'Telegram'}` : ''}`, e.branch_id);
      return { data: { ...row, channel } };
    });
  }

  /** Approved versions with their delivery state, the channel a new one would go through, and the patient's language. */
  @Get('encounters/:id/patient-summaries')
  async list(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const e = await visit(this.db.pool, ctx, id);
    const rows = await this.db.rows(
      `SELECT s.id, s.version, s.language, s.text, s.draft_source, s.approved_by_name, s.approved_at, s.send_requested, n.channel, n.status AS delivery_status, n.sent_at
         FROM patient_summaries s
         LEFT JOIN LATERAL (SELECT channel, status, sent_at FROM notifications x WHERE x.summary_id = s.id ORDER BY x.created_at DESC LIMIT 1) n ON true
        WHERE s.encounter_id = $1 AND s.tenant_id = $2 ORDER BY s.version DESC LIMIT 50`, [id, ctx.tenantId]);
    const chatLang = (await this.db.one(`SELECT x.lang FROM patients p, LATERAL (${LINKED_CHATS_SQL}) x WHERE p.id = $1 LIMIT 1`, [e.patient_id]))?.lang;
    return { data: rows, meta: { channel: await noticeChannel(this.db.pool, ctx.tenantId, e.patient_id), note_signed: e.note_status === 'signed',
      default_language: isLocale(chatLang) ? chatLang : ctx.locale } };
  }

  /** One approved summary for printing (A5), with the patient header. */
  @Get('patient-summaries/:id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Xulosa');
    const s = await this.db.one(
      `SELECT s.id, s.encounter_id, s.version, s.language, s.text, s.approved_by_name, s.approved_at, s.doctor_id, s.patient_id,
              b.name AS branch_name, d.display_name AS doctor_name, d.specialty, a.starts_at
         FROM patient_summaries s JOIN branches b ON b.id = s.branch_id JOIN doctors d ON d.id = s.doctor_id
         JOIN encounters e ON e.id = s.encounter_id JOIN appointments a ON a.id = e.appointment_id
        WHERE s.id = $1 AND s.tenant_id = $2`, [id, ctx.tenantId]);
    if (!s) throw notFound('Xulosa');
    if (s.doctor_id !== ctx.doctorId) throw coded(403, 'FORBIDDEN', 'api.ps.notYours');
    const patient = await this.db.one(`SELECT id, patient_number, last_name, first_name, middle_name, birth_date, sex FROM patients WHERE id = $1`, [s.patient_id]);
    delete s.doctor_id;
    return { data: { ...s, patient } };
  }

  // ---------------------------------------------------------------- documents: fill from the note

  /** Fields for a referral, certificate or prescription read from the note (signed or draft). Deterministic; issues nothing. */
  @Get('encounters/:id/documents/autofill')
  async autofill(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('kind') kind?: string) {
    if (!DOCUMENT_AUTOFILL_KINDS.includes(kind as never)) throw invalid({ kind: 'Hujjat turini tanlang' });
    const e = await visit(this.db.pool, ctx, id);
    const n = noteOf(e);
    const recs = (n.recommendations ?? '').trim();
    const meta = { note_status: e.note_status as string, visit_date: localDate(e.starts_at), follow_up_date: n.follow_up_date };
    let body: Record<string, unknown>;
    if (kind === 'referral') {
      body = { reason: stripCodes(n.diagnosis ?? '').trim(), icd10: n.icd10.map((x) => ({ code: x.code, title: x.title })), urgency: 'routine', notes: recs || null };
    } else if (kind === 'certificate') {
      // the diagnosis goes on a certificate only from a signed note and only when the patient asks — never pre-ticked
      body = { include_diagnosis: false, rest_days: restDaysFromNote(recs), notes: null };
    } else {
      const rx = prescriptionFromNote(recs, await drugStems(this.db.pool));
      body = { items: rx.items, notes: rx.rest || null };
    }
    return { data: { kind, body, meta } };
  }

  /** «Yo‘llanma sababi» drafted by the model from the note (doctor reviews it in the form); template without a model. */
  @Post('encounters/:id/documents/reason-draft') @HttpCode(200)
  async reasonDraft(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { to_specialty } = parse(reasonDraftSchema, body);
    const e = await visit(this.db.pool, ctx, id);
    const r = await draftReason(this.db, this.ai, ctx, { note: noteOf(e), patient: identityOf(e), toSpecialty: to_specialty ?? null });
    if (!r.reason) throw coded(422, 'NOTE_EMPTY', 'api.ps.noteEmpty');
    await audit(this.db.pool, ctx, 'ai.document_draft', 'encounter', id,
      r.mode === 'live' ? `Yo‘llanma sababi loyihasi (AI), olib tashlangan gaplar: ${r.dropped}` : r.mode === 'sample' ? 'Yo‘llanma sababi: Namunaviy AI natijasi (shablon)' : 'Yo‘llanma sababi: shablon (AI o‘chiq)', e.branch_id);
    return { data: { ...r, reason_off: r.mode === 'off' ? reasonText(ctx, this.ai.clinicalOffReason(ctx.tenantId)) : null } };
  }
}
