import { Q } from '../core/db';

export type NoticeKind = 'reminder_day' | 'reminder_soon' | 'result_ready' | 'cancelled_by_clinic' | 'rescheduled_by_clinic' | 'booked';

/**
 * SQL fragment: active, unblocked chats linked to patient `p` by the phone Telegram verified. A family card (a child's
 * card with the parent's number in contact_phone) belongs to the parent's chat too; a chat never sees a card whose
 * phones are not its own verified number.
 */
/** The contact person may act for a card only when it is a child's card (under 18) or the patient has no phone of their own
 *  (an adult's emergency contact must not see that adult's visits). */
export const GUARDIAN_CARD_SQL = `(p.phone IS NULL OR p.birth_date > ((demo_now() AT TIME ZONE 'Asia/Tashkent')::date - interval '18 years'))`;
export const LINKED_CHATS_SQL = `
  SELECT tc.id, tc.bot_id, tc.chat_id, tc.lang, b.kind AS bot_kind
    FROM telegram_chats tc JOIN telegram_bots b ON b.id = tc.bot_id
   WHERE tc.tenant_id = p.tenant_id AND p.anonymised_at IS NULL AND tc.phone IS NOT NULL AND (tc.phone = p.phone OR (tc.phone = p.contact_phone AND ${GUARDIAN_CARD_SQL})) AND NOT tc.blocked AND b.status = 'active'`;

/** The number patient `p` gets SMS on: their own phone, else the contact's (a child's card or a card without its own number). */
export const SMS_PHONE_SQL = `(CASE WHEN p.phone IS NOT NULL THEN p.phone WHEN ${GUARDIAN_CARD_SQL} THEN p.contact_phone END)`;
/** SQL condition: the clinic's SMS channel (Eskiz) is on and patient `p` has an Uzbek mobile number to send to. */
export const SMS_ELIGIBLE_SQL = `(${SMS_PHONE_SQL} LIKE '+998%' AND EXISTS (SELECT 1 FROM sms_settings ss WHERE ss.tenant_id = p.tenant_id AND ss.enabled))`;

/** SQL condition: chat phone `$n` owns patient `p` (own card or a family card with that contact number). */
export const OWN_CARD_SQL = (param: string) => `(p.anonymised_at IS NULL AND (p.phone = ${param} OR (p.contact_phone = ${param} AND ${GUARDIAN_CARD_SQL})))`;

/**
 * SQL condition: patient `p` has not refused / withdrawn the Telegram notifications consent. Linking the bot with
 * one's own phone is the patient's own opt-in, so "nothing recorded" still allows notices; an explicit «no»
 * (latest notifications row with granted = false) stops them.
 */
export const NOTICES_ALLOWED_SQL = `
  coalesce((SELECT pc.granted FROM patient_consents pc WHERE pc.patient_id = p.id AND pc.tenant_id = p.tenant_id AND pc.kind = 'notifications'
             ORDER BY pc.recorded_at DESC, pc.seq DESC LIMIT 1), true)`;

export type NoticeChannel = 'telegram' | 'sms';

/**
 * SQL expression: the channel patient `p`'s notices go through — Telegram when a chat is linked, SMS when the clinic's
 * SMS channel is on and the card has an Uzbek mobile number, NULL when the patient cannot be reached (or said «no»).
 */
export const NOTICE_CHANNEL_SQL = `(CASE WHEN NOT ${NOTICES_ALLOWED_SQL} THEN NULL
  WHEN EXISTS (${LINKED_CHATS_SQL}) THEN 'telegram'
  WHEN ${SMS_ELIGIBLE_SQL} THEN 'sms' END)`;

/**
 * Queues a patient notice in the caller's transaction (outbox pattern): it is delivered only if the
 * event commits, and (channel, dedupe_key) makes it at-most-once. A patient with a linked chat gets it in Telegram,
 * one without — by SMS when the clinic has switched SMS on; a patient who said «no» to notices, or who cannot be
 * reached either way, gets nothing queued.
 */
export async function enqueueNotice(c: Q, n: { tenantId: string; kind: NoticeKind; patientId: string; appointmentId?: string | null; orderId?: string | null; dedupeKey: string }) {
  const channel: NoticeChannel | null = (await c.query(`SELECT ${NOTICE_CHANNEL_SQL} AS channel FROM patients p WHERE p.id = $1 AND p.tenant_id = $2`, [n.patientId, n.tenantId])).rows[0]?.channel ?? null;
  if (!channel) return false;
  const r = await c.query(
    `INSERT INTO notifications (tenant_id, kind, patient_id, appointment_id, order_id, dedupe_key, channel) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, channel, dedupe_key) DO NOTHING`,
    [n.tenantId, n.kind, n.patientId, n.appointmentId ?? null, n.orderId ?? null, n.dedupeKey, channel]);
  return (r.rowCount ?? 0) > 0;
}
