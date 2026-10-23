import { Q } from '../core/db';

export type NoticeKind = 'reminder_day' | 'reminder_soon' | 'result_ready' | 'cancelled_by_clinic' | 'rescheduled_by_clinic' | 'booked' | 'patient_summary';

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

/** Clinical text (the doctor's approved patient summary) is stricter: the patient's own verified phone, or the
 *  contact's only for a child's card (known birth date, under 18). An adult without a phone of their own is not
 *  reached by a relative's chat — that adult falls back to the generic SMS or the printout. */
export const MINOR_CARD_SQL = `(p.birth_date IS NOT NULL AND p.birth_date > ((demo_now() AT TIME ZONE 'Asia/Tashkent')::date - interval '18 years'))`;
export const CLINICAL_CHATS_SQL = LINKED_CHATS_SQL.replace(GUARDIAN_CARD_SQL, MINOR_CARD_SQL);
export const chatsSqlFor = (kind: NoticeKind | string) => (kind === 'patient_summary' ? CLINICAL_CHATS_SQL : LINKED_CHATS_SQL);

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
const channelSql = (chats: string) => `(CASE WHEN NOT ${NOTICES_ALLOWED_SQL} THEN NULL
  WHEN EXISTS (${chats}) THEN 'telegram'
  WHEN ${SMS_ELIGIBLE_SQL} THEN 'sms' END)`;
export const NOTICE_CHANNEL_SQL = channelSql(LINKED_CHATS_SQL);
const CLINICAL_CHANNEL_SQL = channelSql(CLINICAL_CHATS_SQL);

/**
 * Queues a patient notice in the caller's transaction (outbox pattern): it is delivered only if the
 * event commits, and (channel, dedupe_key) makes it at-most-once. A patient with a linked chat gets it in Telegram,
 * one without — by SMS when the clinic has switched SMS on; a patient who said «no» to notices, or who cannot be
 * reached either way, gets nothing queued.
 */
export async function enqueueNotice(c: Q, n: { tenantId: string; kind: NoticeKind; patientId: string; appointmentId?: string | null; orderId?: string | null; summaryId?: string | null; dedupeKey: string }) {
  return (await enqueueNoticeChannel(c, n)) !== null;
}

/** enqueueNotice that also says which channel the notice was queued on (null: nothing queued). */
export async function enqueueNoticeChannel(c: Q, n: { tenantId: string; kind: NoticeKind; patientId: string; appointmentId?: string | null; orderId?: string | null; summaryId?: string | null; dedupeKey: string }): Promise<NoticeChannel | null> {
  const channel = await noticeChannel(c, n.tenantId, n.patientId, n.kind);
  if (!channel) return null;
  const r = await c.query(
    `INSERT INTO notifications (tenant_id, kind, patient_id, appointment_id, order_id, summary_id, dedupe_key, channel) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, channel, dedupe_key) DO NOTHING`,
    [n.tenantId, n.kind, n.patientId, n.appointmentId ?? null, n.orderId ?? null, n.summaryId ?? null, n.dedupeKey, channel]);
  return (r.rowCount ?? 0) > 0 ? channel : null;
}

/** The channel a notice to this patient would go through now (null: cannot be reached, or said «no»). */
export async function noticeChannel(c: Q, tenantId: string, patientId: string, kind?: NoticeKind): Promise<NoticeChannel | null> {
  return (await c.query(`SELECT ${kind === 'patient_summary' ? CLINICAL_CHANNEL_SQL : NOTICE_CHANNEL_SQL} AS channel FROM patients p WHERE p.id = $1 AND p.tenant_id = $2`, [patientId, tenantId])).rows[0]?.channel ?? null;
}
