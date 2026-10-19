// Reminder planning and outbox delivery. Both are idempotent and safe to run from several instances
// (dedupe keys + FOR UPDATE SKIP LOCKED); a notice is re-validated right before it is sent.
import { Injectable, Logger } from '@nestjs/common';
import { Db } from '../core/db';
import { decryptSecret } from '../core/secrets';
import { syncClock } from '../core/clock';
import { BotEngine, cardFor } from './engine';
import { LINKED_CHATS_SQL } from './outbox';
import { Lang, T } from './texts';
import { HttpTransport, OutMessage, SimTransport, TelegramError, Transport } from './transport';

export type BotRow = { id: string; tenant_id: string; kind: 'telegram' | 'simulator'; token_enc: string | null };
const MAX_ATTEMPTS = 5;

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
  constructor(private db: Db, private bots: BotRegistry, private engine: BotEngine) {}

  /** Queues the day-before (3–24 h ahead) and soon (20 min–2 h ahead) reminders for patients with a linked chat. */
  async planReminders(): Promise<number> {
    let n = 0;
    for (const [kind, from, to, age] of [['reminder_day', '3 hours', '24 hours', '1 hour'], ['reminder_soon', '20 minutes', '2 hours', '20 minutes']] as const) {
      const r = await this.db.pool.query(
        `INSERT INTO notifications (tenant_id, kind, patient_id, appointment_id, dedupe_key)
         SELECT a.tenant_id, $1, a.patient_id, a.id, $1 || ':' || a.id || ':' || extract(epoch FROM a.starts_at)::bigint
           FROM appointments a JOIN patients p ON p.id = a.patient_id
          WHERE a.status = 'scheduled' AND a.starts_at > demo_now() + $2::interval AND a.starts_at <= demo_now() + $3::interval
            AND a.created_at <= demo_now() - $4::interval AND EXISTS (${LINKED_CHATS_SQL})
         ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`, [kind, from, to, age]);
      n += r.rowCount ?? 0;
    }
    return n;
  }

  /** Delivers due notices one by one; failures back off exponentially and give up after MAX_ATTEMPTS. */
  async deliverDue(limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
    const stats = { sent: 0, skipped: 0, failed: 0 };
    syncClock((await this.db.one('SELECT demo_now() AS n'))!.n);
    for (let i = 0; i < limit; i++) {
      const done = await this.db.tx(async (c) => {
        const n = (await c.query(`SELECT * FROM notifications WHERE status = 'pending' AND next_attempt_at <= demo_now() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
        if (!n) return false;
        const finish = async (status: string, error: string | null = null) => {
          await c.query(`UPDATE notifications SET status = $2, error = $3, sent_at = CASE WHEN $2 = 'sent' THEN demo_now() END WHERE id = $1`, [n.id, status, error]);
          stats[status === 'sent' ? 'sent' : 'skipped']++;
        };
        if (!(await this.stillValid(c, n))) { await finish('skipped', 'endi dolzarb emas'); return true; }
        const chats = (await c.query(`SELECT x.*, b.token_enc FROM patients p, LATERAL (${LINKED_CHATS_SQL}) x JOIN telegram_bots b ON b.id = x.bot_id WHERE p.id = $1`, [n.patient_id])).rows;
        if (!chats.length) { await finish('skipped', 'bog‘langan chat yo‘q'); return true; }
        let retryError: string | null = null;
        for (const ch of chats) {
          const msg = await this.message(c, n, Number(ch.chat_id), ch.lang as Lang);
          try {
            await this.bots.transportFor({ id: ch.bot_id, tenant_id: n.tenant_id, kind: ch.bot_kind, token_enc: ch.token_enc }).call('sendMessage', msg as any);
          } catch (e) {
            if (e instanceof TelegramError && e.code === 403) { await c.query(`UPDATE telegram_chats SET blocked = true WHERE id = $1`, [ch.id]); continue; }
            retryError = (e as Error).message.slice(0, 300);
          }
        }
        if (!retryError) { await finish('sent'); return true; }
        const attempts = n.attempts + 1;
        await c.query(`UPDATE notifications SET attempts = $2, error = $3, status = CASE WHEN $2 >= $4 THEN 'failed' ELSE 'pending' END,
                              next_attempt_at = demo_now() + make_interval(mins => power(2, $2)::int) WHERE id = $1`, [n.id, attempts, retryError, MAX_ATTEMPTS]);
        stats.failed++;
        if (attempts >= MAX_ATTEMPTS) this.log.warn(`notification ${n.id} failed after ${attempts} attempts: ${retryError}`);
        return true;
      });
      if (!done) break;
    }
    return stats;
  }

  private async stillValid(c: { query: Db['pool']['query'] }, n: any): Promise<boolean> {
    if (n.kind === 'result_ready') return !!(await c.query(`SELECT 1 FROM service_orders WHERE id = $1 AND status = 'verified'`, [n.order_id])).rowCount;
    const a = (await c.query(`SELECT status, starts_at > demo_now() AS future FROM appointments WHERE id = $1`, [n.appointment_id])).rows[0];
    if (!a) return false;
    if (n.kind === 'cancelled_by_clinic') return a.status === 'cancelled';
    return a.status === 'scheduled' && a.future;
  }

  private async message(c: { query: Db['pool']['query'] }, n: any, chatId: number, lang: Lang): Promise<OutMessage> {
    const t = T[lang];
    if (n.kind === 'result_ready') {
      const r = (await c.query(`SELECT p.last_name || ' ' || p.first_name AS patient, o.service_name FROM service_orders o JOIN patients p ON p.id = o.patient_id WHERE o.id = $1`, [n.order_id])).rows[0];
      return { chat_id: chatId, text: t.resultReady(r.patient, r.service_name) };
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
    return { chat_id: chatId, text: t.rescheduledByClinic(card) };
  }
}
