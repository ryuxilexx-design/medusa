// Patient consent (ZRU-547): append-only evidence rows in patient_consents. Shared by the staff API and the Telegram bot.
import type { ConsentKind, ConsentMethod } from '@meduza/contracts';
import { Q } from '../core/db';
import { Ctx } from '../core/context';
import { audit } from '../core/audit';

export const CONSENT_COLS = `c.id, c.kind, c.granted, c.text_version, c.method, c.recorded_by_name, c.recorded_at, c.note`;

/** The current state of each kind = its latest row (or null when nothing was ever recorded). */
export async function latestConsents(q: Q, tenantId: string, patientId: string) {
  const rows = (await q.query(
    `SELECT DISTINCT ON (c.kind) ${CONSENT_COLS} FROM patient_consents c
      WHERE c.patient_id = $1 AND c.tenant_id = $2 ORDER BY c.kind, c.recorded_at DESC, c.seq DESC`, [patientId, tenantId])).rows;
  const by = (k: ConsentKind) => rows.find((r) => r.kind === k) ?? null;
  return { data_processing: by('data_processing'), notifications: by('notifications') };
}

export async function consentHistory(q: Q, tenantId: string, patientId: string) {
  return (await q.query(
    `SELECT ${CONSENT_COLS} FROM patient_consents c WHERE c.patient_id = $1 AND c.tenant_id = $2 ORDER BY c.recorded_at DESC, c.seq DESC`,
    [patientId, tenantId])).rows;
}

const KIND_UZ: Record<ConsentKind, string> = { data_processing: 'ma’lumotlarni qayta ishlash', notifications: 'Telegram eslatmalari' };

/**
 * Appends one consent row and audits it. The caller has already checked tenant/role access to the patient.
 * `ctx.authKind === 'system'` (the Telegram bot) leaves recorded_by/recorded_by_name empty.
 * The free-text note never goes to the audit log.
 */
export async function recordConsent(q: Q, ctx: Ctx, patientId: string, c: { kind: ConsentKind; granted: boolean; method: ConsentMethod; textVersion: string; note?: string | null }) {
  const staff = ctx.authKind !== 'system' && !!ctx.membershipId;
  const row = (await q.query(
    `INSERT INTO patient_consents (tenant_id, patient_id, kind, granted, text_version, method, recorded_by, recorded_by_name, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, kind, granted, text_version, method, recorded_by_name, recorded_at, note`,
    [ctx.tenantId, patientId, c.kind, c.granted, c.textVersion, c.method, staff ? ctx.membershipId : null, staff ? ctx.name : null, c.note ?? null])).rows[0];
  await audit(q, ctx, c.granted ? 'patient.consent_grant' : 'patient.consent_withdraw', 'patient', patientId,
    `Rozilik (${KIND_UZ[c.kind]}): ${c.granted ? 'berildi' : 'yo‘q / qaytarib olindi'}, usul: ${c.method}, matn versiyasi ${c.textVersion}`);
  return row;
}
