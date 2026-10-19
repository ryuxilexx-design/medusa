import { Q } from '../core/db';

export type NoticeKind = 'reminder_day' | 'reminder_soon' | 'result_ready' | 'cancelled_by_clinic' | 'rescheduled_by_clinic';

/** SQL fragment: active, unblocked chats linked to patient `p` (by the phone Telegram verified). */
export const LINKED_CHATS_SQL = `
  SELECT tc.id, tc.bot_id, tc.chat_id, tc.lang, b.kind AS bot_kind
    FROM telegram_chats tc JOIN telegram_bots b ON b.id = tc.bot_id
   WHERE tc.tenant_id = p.tenant_id AND tc.phone = p.phone AND tc.phone IS NOT NULL AND NOT tc.blocked AND b.status = 'active'`;

/**
 * Queues a patient notice in the caller's transaction (outbox pattern): it is delivered only if the
 * event commits, and dedupe_key makes it at-most-once. Patients without a linked chat get nothing queued.
 */
export async function enqueueNotice(c: Q, n: { tenantId: string; kind: NoticeKind; patientId: string; appointmentId?: string | null; orderId?: string | null; dedupeKey: string }) {
  const linked = (await c.query(`SELECT 1 FROM patients p WHERE p.id = $1 AND p.tenant_id = $2 AND EXISTS (${LINKED_CHATS_SQL})`, [n.patientId, n.tenantId])).rowCount;
  if (!linked) return false;
  const r = await c.query(
    `INSERT INTO notifications (tenant_id, kind, patient_id, appointment_id, order_id, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    [n.tenantId, n.kind, n.patientId, n.appointmentId ?? null, n.orderId ?? null, n.dedupeKey]);
  return (r.rowCount ?? 0) > 0;
}
