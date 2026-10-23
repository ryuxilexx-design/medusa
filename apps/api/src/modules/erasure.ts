// Data-subject rights under ZRU-547 («Shaxsga doir ma’lumotlar to‘g‘risida»): the printable patient card (access),
// the sealed JSON export (access / portability, handed to the patient) and anonymisation (erasure).
// Shared rules: tenant and role come from ctx; a doctor reaches only own patients (assertPatientAccess); clinical
// text is read by doctors only — the card for a manager/registrar lists visits without any clinical content.
import { CONSENT_COLS, latestConsents, recordConsent } from './consent';
import { BIOMETRIC_CONSENT_VERSION, CONSENT_TEXT_VERSION, type ConsentKind, type ConsentMethod } from '@meduza/contracts';
import { Q } from '../core/db';
import { Ctx } from '../core/context';
import { audit } from '../core/audit';
import { AppError, coded } from '../core/errors';
import { now } from '../core/clock';

/** Display name of an anonymised card: «Anonim bemor #1001» (last_name + first_name as everywhere else). */
export const ANON_LAST_NAME = 'Anonim bemor';
export const ANON_BIRTH_DATE = '1900-01-01';

// ---------------------------------------------------------------- printable card (access right)

/**
 * Everything a printable card shows, filtered by role: demographics and contacts for every reader, allergy and the
 * diagnosis of each signed visit for the doctor only, invoices for the finance roles (manager, registrar) only.
 */
export async function patientCard(q: Q, ctx: Ctx, patientId: string) {
  const doctor = ctx.role === 'doctor';
  const finance = ctx.role === 'manager' || ctx.role === 'registrar';
  const patient = (await q.query(
    `SELECT p.id, p.patient_number, p.last_name, p.first_name, p.middle_name, p.birth_date, p.sex, p.phone, p.contact_name, p.contact_phone, p.address, p.note,
            p.created_at, p.source, p.anonymised_at${ctx.role === 'manager' ? ', p.erasure_reason' : ''}${doctor ? ', p.allergy_state, p.allergy_note' : ''}
       FROM patients p WHERE p.id = $1 AND p.tenant_id = $2`, [patientId, ctx.tenantId])).rows[0];
  const consents = (await q.query(
    `SELECT ${CONSENT_COLS} FROM patient_consents c WHERE c.patient_id = $1 AND c.tenant_id = $2 ORDER BY c.recorded_at, c.seq`, [patientId, ctx.tenantId])).rows
    .map((c) => { delete c.note; return c; }); // the free-text note of a consent row is not for the printed card
  const visits = (await q.query(
    `SELECT a.id, a.starts_at, a.status, d.display_name AS doctor_name, d.specialty, s.name AS service_name, b.name AS branch_name
            ${doctor ? `, CASE WHEN n.status = 'signed' THEN n.diagnosis END AS diagnosis, CASE WHEN n.status = 'signed' THEN n.icd10 ELSE '[]'::jsonb END AS icd10` : ''}
       FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN services s ON s.id = a.service_id JOIN branches b ON b.id = a.branch_id
       ${doctor ? 'LEFT JOIN encounters e ON e.appointment_id = a.id LEFT JOIN clinical_notes n ON n.encounter_id = e.id' : ''}
      WHERE a.patient_id = $1 AND a.tenant_id = $2 ORDER BY a.starts_at DESC LIMIT 500`, [patientId, ctx.tenantId])).rows;
  const invoices = !finance ? null : {
    list: (await q.query(
      `SELECT i.invoice_number, i.status, i.total, i.paid_amount, i.credit_amount, i.created_at, b.name AS branch_name
         FROM invoices i JOIN branches b ON b.id = i.branch_id WHERE i.patient_id = $1 AND i.tenant_id = $2 AND i.branch_id = ANY($3) ORDER BY i.created_at DESC LIMIT 500`,
      [patientId, ctx.tenantId, ctx.branchIds])).rows,
    summary: (await q.query(
      `SELECT count(*)::int AS count, coalesce(sum(total),0)::bigint AS total, coalesce(sum(paid_amount),0)::bigint AS paid,
              coalesce(sum(total - paid_amount) FILTER (WHERE status IN ('unpaid','partially_paid')),0)::bigint AS due
         FROM invoices WHERE patient_id = $1 AND tenant_id = $2 AND status <> 'void' AND branch_id = ANY($3)`, [patientId, ctx.tenantId, ctx.branchIds])).rows[0],
  };
  return { patient, consents, visits, invoices, generated_at: now() };
}

// ---------------------------------------------------------------- sealed export (access / portability)

/**
 * Rate limit for exports: 5 per minute per clinic (one process; a second instance has its own counter, which is still
 * ≤ 10/min). The export is a bulk read of one person's whole record, so a leaked manager session must not drain the base.
 */
const exportTimes = new Map<string, number[]>();
export const EXPORTS_PER_MINUTE = 5;
export function takeExportSlot(tenantId: string, at = Date.now()) {
  const recent = (exportTimes.get(tenantId) ?? []).filter((t) => at - t < 60_000);
  if (recent.length >= EXPORTS_PER_MINUTE) { exportTimes.set(tenantId, recent); return false; }
  recent.push(at); exportTimes.set(tenantId, recent);
  return true;
}
/** Tests only: forget the counters. */
export function resetExportSlots() { exportTimes.clear(); }

/**
 * The patient's complete record as one JSON document (ZRU-547, art. 30: the subject's right to receive their data).
 *
 * Legal position (discussed 2026-10-23): the manager is the clinic's operator representative who ANSWERS the request,
 * not a reader of the record — CLAUDE.md keeps clinical text away from managers in the UI. The export therefore
 * contains the clinical sections (notes with addenda, verified lab values, signed ultrasound reports, issued
 * documents' metadata) because the PATIENT is entitled to them, but the API serves it as a sealed download
 * («Yuklab olish»): the web client never renders it, the audit row records who produced it and for which patient,
 * and the file itself states its purpose («bemorning so‘rovi bo‘yicha»). Lab values are included only once verified,
 * exactly as the doctor sees them; draft results and draft notes are not part of the record yet and are left out.
 * No face pictures or snapshots exist for a patient (camera events carry only times), no message texts are stored
 * for notices (kinds, channels and times only) — so nothing further needs redacting.
 */
export async function patientExport(q: Q, ctx: Ctx, patientId: string) {
  const T = ctx.tenantId;
  const rows = async (sql: string, params: unknown[] = [patientId, T]) => (await q.query(sql, params)).rows;
  const patient = (await rows(
    `SELECT id, patient_number, last_name, first_name, middle_name, birth_date, sex, phone, contact_name, contact_phone, address, note,
            allergy_state, allergy_note, source, created_at, updated_at, anonymised_at, erasure_reason FROM patients WHERE id = $1 AND tenant_id = $2`))[0];
  const clinic = (await rows(`SELECT name FROM tenants WHERE id = $1`, [T]))[0];
  const consents = await rows(`SELECT ${CONSENT_COLS} FROM patient_consents c WHERE c.patient_id = $1 AND c.tenant_id = $2 ORDER BY c.recorded_at, c.seq`);
  const appointments = await rows(
    `SELECT a.id, a.starts_at, a.ends_at, a.status, a.source, a.note, a.patient_confirmed_at, b.name AS branch_name, d.display_name AS doctor_name, d.specialty, s.name AS service_name
       FROM appointments a JOIN branches b ON b.id = a.branch_id JOIN doctors d ON d.id = a.doctor_id JOIN services s ON s.id = a.service_id
      WHERE a.patient_id = $1 AND a.tenant_id = $2 ORDER BY a.starts_at`);
  const notes = await rows(
    `SELECT n.id, e.appointment_id, a.starts_at AS visit_at, d.display_name AS doctor_name, d.specialty, n.complaints, n.anamnesis, n.examination, n.diagnosis, n.icd10,
            n.recommendations, n.follow_up_date, n.vitals, n.signed_at, n.signed_by_name,
            coalesce((SELECT jsonb_agg(jsonb_build_object('text', x.text, 'reason', x.reason, 'author_name', x.author_name, 'signed_at', x.signed_at) ORDER BY x.created_at)
                        FROM note_addenda x WHERE x.note_id = n.id), '[]'::jsonb) AS addenda
       FROM clinical_notes n JOIN encounters e ON e.id = n.encounter_id JOIN appointments a ON a.id = e.appointment_id JOIN doctors d ON d.id = e.doctor_id
      WHERE e.patient_id = $1 AND n.tenant_id = $2 AND n.status = 'signed' ORDER BY a.starts_at`);
  const intake = await rows(
    `SELECT f.appointment_id, f.complaints, f.allergies, f.medications, f.submitted_at FROM intake_forms f WHERE f.patient_id = $1 AND f.tenant_id = $2 ORDER BY f.submitted_at`);
  const documents = await rows(
    `SELECT m.id, m.kind, m.number, m.status, m.issued_at, m.issued_by_name, m.voided_at, m.void_reason, m.encounter_id
       FROM medical_documents m WHERE m.patient_id = $1 AND m.tenant_id = $2 ORDER BY m.issued_at`);
  const labResults = await rows(
    `SELECT o.id AS order_id, o.service_name, o.ordered_at, d.display_name AS ordered_by, r.values, r.comment, r.collected_at, r.verified_at, r.verified_by_name
       FROM service_orders o JOIN lab_results r ON r.order_id = o.id AND r.status = 'verified' LEFT JOIN doctors d ON d.id = o.doctor_id
      WHERE o.patient_id = $1 AND o.tenant_id = $2 AND o.category = 'lab' ORDER BY o.ordered_at`);
  const diagnostics = await rows(
    `SELECT o.id AS order_id, o.service_name, o.ordered_at, r.exam_type, r.description, r.conclusion, r.specialist_name, r.signed_at
       FROM service_orders o JOIN diagnostic_reports r ON r.order_id = o.id AND r.status = 'signed'
      WHERE o.patient_id = $1 AND o.tenant_id = $2 AND o.category = 'ultrasound' ORDER BY o.ordered_at`);
  const invoices = await rows(
    `SELECT i.id, i.invoice_number, i.status, i.subtotal, i.discount_amount, i.total, i.paid_amount, i.credit_amount, i.created_at, i.void_reason, b.name AS branch_name,
            coalesce((SELECT jsonb_agg(jsonb_build_object('description', it.description, 'quantity', it.quantity, 'unit_price', it.unit_price, 'line_total', it.line_total, 'refunded_amount', it.refunded_amount) ORDER BY it.position)
                        FROM invoice_items it WHERE it.invoice_id = i.id), '[]'::jsonb) AS items,
            coalesce((SELECT jsonb_agg(jsonb_build_object('receipt_number', p.receipt_number, 'amount', p.amount, 'method', p.method, 'paid_at', p.paid_at, 'cashier_name', p.cashier_name) ORDER BY p.paid_at)
                        FROM payments p WHERE p.invoice_id = i.id), '[]'::jsonb) AS payments,
            coalesce((SELECT jsonb_agg(jsonb_build_object('refund_number', r.refund_number, 'amount', r.amount, 'method', r.method, 'reason_code', r.reason_code, 'refunded_at', r.refunded_at) ORDER BY r.refunded_at)
                        FROM refunds r WHERE r.invoice_id = i.id), '[]'::jsonb) AS refunds
       FROM invoices i JOIN branches b ON b.id = i.branch_id WHERE i.patient_id = $1 AND i.tenant_id = $2 ORDER BY i.created_at`);
  const deposits = await rows(
    `SELECT d.kind, d.amount, d.method, d.occurred_at, d.actor_name, b.name AS branch_name FROM patient_deposits d JOIN branches b ON b.id = d.branch_id
      WHERE d.patient_id = $1 AND d.tenant_id = $2 ORDER BY d.occurred_at`);
  // camera: only when the patient had a face code; times and the camera's name — never pictures, never similarity of others
  const cameraEvents = await rows(
    `SELECT e.kind, e.occurred_at, c.name AS camera_name, b.name AS branch_name
       FROM camera_events e JOIN face_codes f ON f.id = e.face_code_id JOIN cameras c ON c.id = e.camera_id JOIN branches b ON b.id = e.branch_id
      WHERE f.patient_id = $1 AND e.tenant_id = $2 ORDER BY e.occurred_at`);
  const notices = await rows(
    `SELECT n.kind, n.channel, n.status, n.created_at, n.sent_at FROM notifications n WHERE n.patient_id = $1 AND n.tenant_id = $2 ORDER BY n.created_at`);
  // structured allergy list (migration 028), withdrawn rows included: what was recorded, by whom and when
  const allergies = await rows(
    `SELECT a.class_code, c.name_uz AS class_name, d.inn AS drug_inn, a.free_text, a.reaction, a.severity, a.source, a.recorded_by_name, a.recorded_at,
            a.confirmed_at, a.withdrawn_at, a.withdraw_reason
       FROM patient_allergies a LEFT JOIN allergy_classes c ON c.code = a.class_code LEFT JOIN drugs d ON d.id = a.drug_id
      WHERE a.patient_id = $1 AND a.tenant_id = $2 ORDER BY a.recorded_at`);
  return {
    format: 'med.uz.ai/patient-export', version: 1,
    purpose: 'Bemorning so‘rovi bo‘yicha (O‘RQ-547, shaxsga doir ma’lumotlar subyektining o‘z ma’lumotlarini olish huquqi)',
    generated_at: now(), clinic: clinic?.name ?? null, exported_by: { name: ctx.name, role: ctx.role },
    patient, consents, allergies, appointments, clinical_notes: notes, intake_forms: intake, documents, lab_results: labResults, diagnostic_reports: diagnostics,
    invoices, deposits, camera_events: cameraEvents, notices,
  };
}

// ---------------------------------------------------------------- anonymisation (erasure right)

export const ERASURE_ACTIVE_APPOINTMENT = `a.status IN ('scheduled', 'arrived', 'in_progress') AND a.ends_at > $3`;

/**
 * Anonymises one card in the caller's transaction. Refuses (409 ERASURE_BLOCKED, with the details) while the clinic
 * still has an open relationship with the person: unpaid invoices, an unreturned deposit or an appointment still to come.
 *
 * What changes: names → «Anonim bemor #n», contacts/address/note → NULL, birth date → 1900-01-01, sex → unspecified;
 * the patient's own Telegram chat link is deleted (a guardian's chat is someone else's number and stays), pending
 * notices are skipped, every granted consent gets a withdrawal row (face code revoked with it), the card is flagged.
 * What stays: past appointments, signed notes, verified results, documents, invoices, payments — the medical and
 * accounting record the law requires the clinic to keep — all under the anonymous card.
 */
export async function anonymisePatient(c: Q, ctx: Ctx, patientId: string, input: { reason: string; method: ConsentMethod }) {
  const p = (await c.query(`SELECT id, patient_number, phone, anonymised_at FROM patients WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [patientId, ctx.tenantId])).rows[0];
  if (!p) throw new AppError(404, 'NOT_FOUND', 'Bemor topilmadi');
  if (p.anonymised_at) throw coded(409, 'ALREADY_ANONYMISED', 'api.erasure.already');
  const at = now();
  const debt = Number((await c.query(`SELECT coalesce(sum(total - paid_amount),0)::bigint AS n FROM invoices WHERE patient_id = $1 AND tenant_id = $2 AND status IN ('unpaid','partially_paid')`, [patientId, ctx.tenantId])).rows[0].n);
  const deposit = Number((await c.query(`SELECT coalesce(sum(CASE WHEN kind = 'in' THEN amount ELSE -amount END),0)::bigint AS n FROM patient_deposits WHERE patient_id = $1 AND tenant_id = $2`, [patientId, ctx.tenantId])).rows[0].n);
  const future = (await c.query(
    `SELECT a.id, a.starts_at, d.display_name AS doctor_name FROM appointments a JOIN doctors d ON d.id = a.doctor_id
      WHERE a.patient_id = $1 AND a.tenant_id = $2 AND ${ERASURE_ACTIVE_APPOINTMENT} ORDER BY a.starts_at LIMIT 20`, [patientId, ctx.tenantId, at])).rows;
  if (debt > 0 || deposit > 0 || future.length) {
    const e = coded(409, 'ERASURE_BLOCKED', 'api.erasure.blocked');
    e.extra = { debt, deposit_balance: deposit, future_appointments: future };
    throw e;
  }
  // consents: evidence stays, the withdrawal is a new row (face code revoked by recordConsent for 'biometric')
  const current = await latestConsents(c, ctx.tenantId, patientId);
  for (const kind of Object.keys(current) as ConsentKind[]) {
    if (current[kind]?.granted) await recordConsent(c, ctx, patientId, { kind, granted: false, method: input.method, textVersion: kind === 'biometric' ? BIOMETRIC_CONSENT_VERSION : CONSENT_TEXT_VERSION, note: `Anonimlashtirish: ${input.reason}`.slice(0, 500) });
  }
  // the person's own bot chat (verified with this very number) is unlinked; a parent's chat on a child's card is the parent's
  if (p.phone) await c.query(`DELETE FROM telegram_chats WHERE tenant_id = $1 AND phone = $2`, [ctx.tenantId, p.phone]);
  await c.query(`UPDATE notifications SET status = 'skipped', error = 'bemor anonimlashtirildi' WHERE tenant_id = $1 AND patient_id = $2 AND status = 'pending'`, [ctx.tenantId, patientId]);
  await c.query(
    `UPDATE patients SET last_name = $3, first_name = '#' || patient_number, middle_name = NULL, birth_date = $4, sex = 'unspecified',
            phone = NULL, contact_name = NULL, contact_phone = NULL, address = NULL, note = NULL,
            anonymised_at = $5, erasure_reason = $6, updated_at = $5
      WHERE id = $1 AND tenant_id = $2`, [patientId, ctx.tenantId, ANON_LAST_NAME, ANON_BIRTH_DATE, at, input.reason]);
  await audit(c, ctx, 'patient.anonymise', 'patient', patientId, `Bemor #${p.patient_number} anonimlashtirildi (O‘RQ-547 so‘rovi); sabab: ${input.reason.slice(0, 120)}`);
  return { id: patientId, patient_number: p.patient_number, anonymised_at: at };
}
