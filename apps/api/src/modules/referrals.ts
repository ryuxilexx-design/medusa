// Referral partners and lead sources on a visit (docs/REFERRALS.md): one place that validates them, applies the
// defaults (bot → «Telegram bot», partner → «Yo‘llovchi shifokor», else the patient's own source) and corrects them.
import { Q } from '../core/db';
import { Ctx } from '../core/context';
import { coded, invalid } from '../core/errors';
import { audit } from '../core/audit';
import { lockAppointment } from './booking';
import { partnerPercentFor } from './billing';

/**
 * New patients of [$3, $4) in tenant $1 / branches $2, by the card's first known source: a patient whose first visit
 * ever (arrived or later) is in the period. Index range on the period + the patient's earlier visits (no full scan).
 * Shared by «Manbalar bo‘yicha» and the dashboard card.
 */
export const NEW_PATIENTS_SQL = `SELECT p.lead_source_id AS id, count(DISTINCT a.patient_id)::int AS n
  FROM appointments a JOIN patients p ON p.id = a.patient_id
 WHERE a.tenant_id = $1 AND a.branch_id = ANY($2) AND a.starts_at >= $3 AND a.starts_at < $4 AND a.status IN ('arrived','in_progress','completed')
   AND NOT EXISTS (SELECT 1 FROM appointments b WHERE b.patient_id = a.patient_id AND b.starts_at < $3 AND b.status IN ('arrived','in_progress','completed'))
 GROUP BY 1`;

/** A built-in lead source of the clinic (NULL when a clinic has none: an old clinic before ensureLeadSources ran). */
export async function systemLeadSource(q: Q, tenantId: string, key: 'telegram_bot' | 'referral'): Promise<string | null> {
  return (await q.query(`SELECT id FROM lead_sources WHERE tenant_id = $1 AND system_key = $2`, [tenantId, key])).rows[0]?.id ?? null;
}

/** An active partner of this clinic, or 422 on the field. */
export async function assertPartner(q: Q, tenantId: string, id: string, field = 'referral_partner_id') {
  const p = (await q.query(`SELECT id, code, full_name, active FROM referral_partners WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows[0];
  if (!p || !p.active) throw invalid({ [field]: 'Hamkor topilmadi yoki faol emas' });
  return p as { id: string; code: number; full_name: string };
}
/** An active lead source of this clinic, or 422 on the field. */
export async function assertLeadSource(q: Q, tenantId: string, id: string, field = 'lead_source_id') {
  const s = (await q.query(`SELECT id, name, active FROM lead_sources WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows[0];
  if (!s || !s.active) throw invalid({ [field]: 'Manba topilmadi yoki faol emas' });
  return s as { id: string; name: string };
}

/**
 * Partner and lead source of a new visit. A bot booking never carries a partner and always counts as «Telegram bot».
 * Otherwise the given source wins; without one a referred visit is «Yo‘llovchi shifokor» and any other the patient's own.
 */
export async function visitReferral(q: Q, tenantId: string, input: { patientId: string; partnerId?: string | null; leadSourceId?: string | null; telegram?: boolean }) {
  if (input.telegram) return { partnerId: null, leadSourceId: await systemLeadSource(q, tenantId, 'telegram_bot') };
  const partner = input.partnerId ? await assertPartner(q, tenantId, input.partnerId) : null;
  let leadSourceId: string | null = null;
  if (input.leadSourceId) leadSourceId = (await assertLeadSource(q, tenantId, input.leadSourceId)).id;
  else if (partner) leadSourceId = await systemLeadSource(q, tenantId, 'referral');
  else leadSourceId = (await q.query(`SELECT lead_source_id FROM patients WHERE id = $1 AND tenant_id = $2`, [input.patientId, tenantId])).rows[0]?.lead_source_id ?? null;
  return { partnerId: partner?.id ?? null, partnerCode: partner?.code ?? null, leadSourceId };
}

/** The card's first known source: filled once from a visit when the card had none (later visits never overwrite it). */
export async function fillPatientSource(q: Q, tenantId: string, patientId: string, leadSourceId: string | null) {
  if (!leadSourceId) return;
  await q.query(`UPDATE patients SET lead_source_id = $3 WHERE id = $1 AND tenant_id = $2 AND lead_source_id IS NULL`, [patientId, tenantId, leadSourceId]);
}

/**
 * Corrects the partner and/or the lead source of a visit. The partner can change only while no money was taken for the
 * visit (an open bill is still a draft): its orders are then re-snapshotted with the new partner's percent. After a
 * payment the lines are final — 409 REFERRAL_LOCKED (the manager settles it with the partner).
 */
export async function setVisitReferral(c: Q, ctx: Ctx, id: string, input: { referral_partner_id?: string | null; lead_source_id?: string | null }) {
  const a = await lockAppointment(c, ctx, id);
  const changes: string[] = [];
  let partnerId: string | null = a.referral_partner_id;
  let leadSourceId: string | null = a.lead_source_id;
  if (input.referral_partner_id !== undefined && input.referral_partner_id !== a.referral_partner_id) {
    const money = (await c.query(
      `SELECT 1 FROM invoices i WHERE i.appointment_id = $1 AND i.status <> 'void' AND (i.paid_amount > 0 OR i.credit_amount > 0 OR EXISTS (SELECT 1 FROM payments pm WHERE pm.invoice_id = i.id)) LIMIT 1`, [id])).rowCount;
    if (money) throw coded(409, 'REFERRAL_LOCKED', 'api.ref.locked');
    const partner = input.referral_partner_id ? await assertPartner(c, ctx.tenantId, input.referral_partner_id) : null;
    partnerId = partner?.id ?? null;
    const old = a.referral_partner_id ? (await c.query(`SELECT code FROM referral_partners WHERE id = $1`, [a.referral_partner_id])).rows[0]?.code : null;
    changes.push(`yo‘llanma: ${old ? '#' + old : '—'} → ${partner ? '#' + partner.code : '—'}`);
    // the visit's orders follow the new partner (the bill has no money yet)
    const orders = (await c.query(`SELECT id, service_id FROM service_orders WHERE appointment_id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows;
    for (const o of orders)
      await c.query(`UPDATE service_orders SET referral_partner_id = $2, partner_percent_snapshot = $3 WHERE id = $1`, [o.id, partnerId, await partnerPercentFor(c, ctx.tenantId, partnerId, o.service_id)]);
    // a newly referred visit counts as «Yo‘llovchi shifokor» unless reception names another source
    if (partner && input.lead_source_id === undefined) leadSourceId = (await systemLeadSource(c, ctx.tenantId, 'referral')) ?? leadSourceId;
  }
  if (input.lead_source_id !== undefined) leadSourceId = input.lead_source_id ? (await assertLeadSource(c, ctx.tenantId, input.lead_source_id)).id : null;
  if (leadSourceId !== a.lead_source_id) changes.push('manba o‘zgardi');
  if (!changes.length) return { id, changed: false };
  await c.query(`UPDATE appointments SET referral_partner_id = $2, lead_source_id = $3, version = version + 1, updated_at = demo_now() WHERE id = $1`, [id, partnerId, leadSourceId]);
  await fillPatientSource(c, ctx.tenantId, a.patient_id, leadSourceId);
  await audit(c, ctx, 'appointment.referral', 'appointment', id, changes.join(', '), a.branch_id);
  return { id, changed: true };
}
