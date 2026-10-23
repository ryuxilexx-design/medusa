// Reminder planning and outbox delivery. Both are idempotent and safe to run from several instances
// (dedupe keys + FOR UPDATE SKIP LOCKED); a notice is re-validated right before it is sent.
import { Injectable, Logger } from '@nestjs/common';
import { Db } from '../core/db';
import { decryptSecret } from '../core/secrets';
import { addDays, localDate, localTime, localToUtc, now, syncClock } from '../core/clock';
import { BotEngine, cardFor } from './engine';
import { LINKED_CHATS_SQL, NOTICE_CHANNEL_SQL, NOTICES_ALLOWED_SQL, SMS_PHONE_SQL } from './outbox';
import { humanDate, Lang, T } from './texts';
import { HttpTransport, OutMessage, SimTransport, TelegramError, Transport } from './transport';
import { SmsSender } from '../sms/transport';
import { EskizError } from '../sms/eskiz';
import { smsParts, smsText } from '../sms/texts';

export type BotRow = { id: string; tenant_id: string; kind: 'telegram' | 'simulator'; token_enc: string | null };
const MAX_ATTEMPTS = 5;
/** Quiet hours (Tashkent): nothing is sent before 08:00 or from 21:00 — except a cancellation or move by the clinic, which must not wait. */
export const SEND_FROM_HOUR = 8, SEND_UNTIL_HOUR = 21;
const URGENT_KINDS = ['cancelled_by_clinic', 'rescheduled_by_clinic'];
/** The day-before reminder is pointless for a booking made less than this long before the visit (the 2-hour one still goes). */
const DAY_REMINDER_MIN_LEAD = '20 hours';

/** When the next sending window opens after instant `t` (null while it is open). */
export function quietUntil(t: Date): Date | null {
  const h = Number(localTime(t).slice(0, 2));
  if (h >= SEND_FROM_HOUR && h < SEND_UNTIL_HOUR) return null;
  const date = h >= SEND_UNTIL_HOUR ? addDays(localDate(t), 1) : localDate(t);
  return localToUtc(date, `${String(SEND_FROM_HOUR).padStart(2, '0')}:00`);
}

@Injectable()
export class BotRegistry {
  private http = new Map<string, { enc: string; t: HttpTransport }>();
  constructor(private db: Db) {}
  transportFor(bot: BotRow): Transport {
    if (bot.kind === 'simulator') return new SimTransport(this.db.pool, bot.id);
    const cached = this.http.get(bot.id);
    if (cached && cached.enc === bot.token_enc) return cached.t;
    const t = new HttpTransport(decryptSecret(bot.token_enc!));
    this.http.set(bot.id, { enc: bot.token_enc!, t });
    return t;
  }
  /** The clinic's simulator bot (created on first use). */
  async simulator(tenantId: string): Promise<BotRow> {
    await this.db.rows(`INSERT INTO telegram_bots (tenant_id, kind, username) VALUES ($1, 'simulator', 'MedUzDemoBot') ON CONFLICT (tenant_id, kind) DO NOTHING`, [tenantId]);
    return (await this.db.one(`SELECT id, tenant_id, kind, token_enc FROM telegram_bots WHERE tenant_id = $1 AND kind = 'simulator'`, [tenantId]))!;
  }
}

@Injectable()
export class Notifier {
  private log = new Logger('TelegramNotifier');
  constructor(private db: Db, private bots: BotRegistry, private engine: BotEngine, private sms: SmsSender) {}

  /** Queues the day-before (3–24 h ahead) and soon (20 min–2 h ahead) reminders — in Telegram for patients with a linked chat, by SMS for the others when the clinic has SMS on. */
  async planReminders(): Promise<number> {
    let n = 0;
    for (const [kind, from, to, age, minLead] of [['reminder_day', '3 hours', '24 hours', '1 hour', DAY_REMINDER_MIN_LEAD], ['reminder_soon', '20 minutes', '2 hours', '20 minutes', '0']] as const) {
      const r = await this.db.pool.query(
        `INSERT INTO notifications (tenant_id, kind, patient_id, appointment_id, dedupe_key, channel)
         SELECT tenant_id, $1, patient_id, id, $1 || ':' || id || ':' || extract(epoch FROM starts_at)::bigint, channel FROM (
           SELECT a.tenant_id, a.patient_id, a.id, a.starts_at, ${NOTICE_CHANNEL_SQL} AS channel
             FROM appointments a JOIN patients p ON p.id = a.patient_id
            WHERE a.status = 'scheduled' AND a.starts_at > demo_now() + $2::interval AND a.starts_at <= demo_now() + $3::interval
              AND a.created_at <= demo_now() - $4::interval AND a.created_at <= a.starts_at - $5::interval) x
          WHERE channel IS NOT NULL
         ON CONFLICT (tenant_id, channel, dedupe_key) DO NOTHING`, [kind, from, to, age, minLead]);
      n += r.rowCount ?? 0;
    }
    return n;
  }

  /** Delivers due notices one by one; failures back off exponentially and give up after MAX_ATTEMPTS. */
  async deliverDue(limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
    const stats = { sent: 0, skipped: 0, failed: 0 };
    syncClock((await this.db.one('SELECT demo_now() AS n'))!.n);
    // quiet hours: due notices wait for 08:00 (a clinic's cancellation or move still goes out)
    const until = quietUntil(now());
    if (until) await this.db.rows(`UPDATE notifications SET next_attempt_at = $1 WHERE status = 'pending' AND next_attempt_at < $1 AND NOT (kind = ANY($2))`, [until, URGENT_KINDS]);
    for (let i = 0; i < limit; i++) {
      const done = await this.db.tx(async (c) => {
        const n = (await c.query(`SELECT * FROM notifications WHERE status = 'pending' AND next_attempt_at <= demo_now() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
        if (!n) return false;
        const finish = async (status: string, error: string | null = null) => {
          await c.query(`UPDATE notifications SET status = $2, error = $3, sent_at = CASE WHEN $2 = 'sent' THEN demo_now() END WHERE id = $1`, [n.id, status, error]);
          stats[status === 'sent' ? 'sent' : 'skipped']++;
        };
        if (!(await this.stillValid(c, n))) { await finish('skipped', 'endi dolzarb emas'); return true; }
        // the patient may have said «no» to Telegram notices after this one was queued
        if (!(await c.query(`SELECT 1 FROM patients p WHERE p.id = $1 AND ${NOTICES_ALLOWED_SQL}`, [n.patient_id])).rowCount) { await finish('skipped', n.channel === 'sms' ? 'bemor xabarnomalarga rozi emas' : 'bemor Telegram xabarnomalariga rozi emas'); return true; }
        /** Retryable failure: exponential backoff, «failed» after MAX_ATTEMPTS. */
        const backoff = async (error: string) => {
          const attempts = n.attempts + 1;
          await c.query(`UPDATE notifications SET attempts = $2::int, error = $3, status = CASE WHEN $2::int >= $4::int THEN 'failed' ELSE 'pending' END,
                                next_attempt_at = demo_now() + make_interval(mins => power(2, $2::int)::int) WHERE id = $1`, [n.id, attempts, error, MAX_ATTEMPTS]);
          stats.failed++;
          if (attempts >= MAX_ATTEMPTS) this.log.warn(`notification ${n.id} failed after ${attempts} attempts: ${error}`);
        };
        if (n.channel === 'sms') {
          const phone: string | null = (await c.query(`SELECT ${SMS_PHONE_SQL} AS phone FROM patients p WHERE p.id = $1`, [n.patient_id])).rows[0]?.phone ?? null;
          if (!phone?.startsWith('+998')) { await finish('skipped', 'telefon raqami yo‘q'); return true; }
          if (!(await this.sms.settings(c, n.tenant_id))?.enabled) { await finish('skipped', 'SMS kanali o‘chirilgan'); return true; }
          const text = await this.smsMessage(c, n);
          try {
            await this.sms.send(c, { tenantId: n.tenant_id, notificationId: n.id, kind: n.kind, phone, text, parts: smsParts(text) });
            await finish('sent');
          } catch (e) {
            const err = e as EskizError | Error;
            const msg = (err instanceof EskizError ? this.sms.describe(err) : err.message).slice(0, 300);
            if (err instanceof EskizError && !err.retryable) {
              // the gateway rejected it (bad credentials, bad number, no balance): retrying would not help
              await c.query(`UPDATE notifications SET status = 'failed', attempts = attempts + 1, error = $2 WHERE id = $1`, [n.id, msg]);
              stats.failed++;
            } else await backoff(msg);
          }
          return true;
        }
        const chats = (await c.query(`SELECT x.*, b.token_enc FROM patients p, LATERAL (${LINKED_CHATS_SQL}) x JOIN telegram_bots b ON b.id = x.bot_id WHERE p.id = $1`, [n.patient_id])).rows;
        if (!chats.length) { await finish('skipped', 'bog‘langan chat yo‘q'); return true; }
        let retryError: string | null = null, delivered = 0;
        for (const ch of chats) {
          const msg = await this.message(c, n, Number(ch.chat_id), ch.lang as Lang);
          try {
            await this.bots.transportFor({ id: ch.bot_id, tenant_id: n.tenant_id, kind: ch.bot_kind, token_enc: ch.token_enc }).call('sendMessage', msg as any);
            delivered++;
          } catch (e) {
            if (e instanceof TelegramError && e.code === 403) { await c.query(`UPDATE telegram_chats SET blocked = true WHERE id = $1`, [ch.id]); continue; }
            retryError = (e as Error).message.slice(0, 300);
          }
        }
        // nobody reached (every chat has blocked the bot) is not «sent»
        if (!retryError) { await (delivered ? finish('sent') : finish('skipped', 'bemor botni bloklagan')); return true; }
        await backoff(retryError);
        return true;
      });
      if (!done) break;
    }
    return stats;
  }

  private async stillValid(c: { query: Db['pool']['query'] }, n: any): Promise<boolean> {
    if (n.kind === 'result_ready') return !!(await c.query(`SELECT 1 FROM service_orders WHERE id = $1 AND status = 'verified'`, [n.order_id])).rowCount;
    // an approved summary never changes; it is still «current» as long as it belongs to this patient
    if (n.kind === 'patient_summary') return !!(await c.query(`SELECT 1 FROM patient_summaries WHERE id = $1 AND patient_id = $2 AND send_requested`, [n.summary_id, n.patient_id])).rowCount;
    const a = (await c.query(`SELECT status, starts_at > demo_now() AS future FROM appointments WHERE id = $1`, [n.appointment_id])).rows[0];
    if (!a) return false;
    if (n.kind === 'cancelled_by_clinic') return a.status === 'cancelled';
    return a.status === 'scheduled' && a.future;
  }

  /** The SMS text of a notice. A patient without Telegram has no language choice on record: Uzbek (Latin). */
  private async smsMessage(c: { query: Db['pool']['query'] }, n: any): Promise<string> {
    if (n.kind === 'result_ready') {
      // first name only and no service name: an SMS can be read by anyone holding the phone
      const r = (await c.query(`SELECT p.first_name AS patient FROM service_orders o JOIN patients p ON p.id = o.patient_id WHERE o.id = $1`, [n.order_id])).rows[0];
      return smsText('result_ready', 'uz', { patient: r.patient, service: '' });
    }
    // the summary's text never goes by SMS (unencrypted, any holder of the phone reads it): only «it is ready»
    if (n.kind === 'patient_summary') {
      const s = (await c.query(`SELECT language FROM patient_summaries WHERE id = $1`, [n.summary_id])).rows[0];
      return smsText('patient_summary', s?.language === 'ru' ? 'ru' : 'uz', {});
    }
    return smsText(n.kind, 'uz', { card: await cardFor(c as any, n.tenant_id, n.appointment_id, 'uz') });
  }

  private async message(c: { query: Db['pool']['query'] }, n: any, chatId: number, lang: Lang): Promise<OutMessage> {
    const t = T[lang];
    if (n.kind === 'result_ready') {
      const r = (await c.query(`SELECT p.last_name || ' ' || p.first_name AS patient, o.service_name FROM service_orders o JOIN patients p ON p.id = o.patient_id WHERE o.id = $1`, [n.order_id])).rows[0];
      return { chat_id: chatId, text: t.resultReady(r.patient, r.service_name) };
    }
    if (n.kind === 'patient_summary') {
      // the text the doctor approved, as approved (in the language the doctor picked for the patient); header in the chat's language
      const s = (await c.query(`SELECT s.text, s.approved_at, d.display_name AS doctor FROM patient_summaries s JOIN doctors d ON d.id = s.doctor_id WHERE s.id = $1`, [n.summary_id])).rows[0];
      return { chat_id: chatId, text: `${t.patientSummary(s.doctor, humanDate(localDate(s.approved_at), lang, false))}\n\n${s.text}\n\n${t.patientSummaryFoot}` };
    }
    const card = await cardFor(c as any, n.tenant_id, n.appointment_id, lang);
    if (n.kind === 'reminder_day') {
      const hasIntake = !!(await c.query(`SELECT 1 FROM intake_forms WHERE appointment_id = $1`, [n.appointment_id])).rowCount;
      const id = n.appointment_id;
      return { chat_id: chatId, text: t.reminderDay(card), reply_markup: { inline_keyboard: [
        [{ text: t.btnWillCome, callback_data: `a:ok:${id}` }],
        [{ text: t.btnReschedule, callback_data: `a:rs:${id}` }, { text: t.btnCancelAppt, callback_data: `a:cx:${id}` }],
        ...(hasIntake ? [] : [[{ text: t.btnIntake, callback_data: `a:in:${id}` }]]),
      ] } };
    }
    if (n.kind === 'reminder_soon') return { chat_id: chatId, text: t.reminderSoon(card) };
    if (n.kind === 'cancelled_by_clinic') return { chat_id: chatId, text: t.cancelledByClinic(card), reply_markup: this.engine.menuKb(lang) };
    if (n.kind === 'booked') return { chat_id: chatId, text: t.bookedByClinic(card) };
    return { chat_id: chatId, text: t.rescheduledByClinic(card) };
  }
}
