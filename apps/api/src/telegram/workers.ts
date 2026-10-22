// Background work inside the API process: Telegram long polling (one poller per connected bot, guarded by a
// PostgreSQL advisory lock so only one instance polls a bot), reminder planning and outbox delivery.
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Db } from '../core/db';
import { config } from '../core/config';
import { BotEngine, TgUpdate } from './engine';
import { BotRegistry, BotRow, Notifier } from './notifier';
import { TelegramError } from './transport';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Poller {
  stopped = false;
  constructor(public bot: BotRow, private db: Db, private bots: BotRegistry, private engine: BotEngine, private log: Logger) {}

  async run() {
    let backoff = 5_000;
    while (!this.stopped) {
      const client = await this.db.pool.connect();
      let locked = false;
      try {
        locked = (await client.query(`SELECT pg_try_advisory_lock(hashtext('tg-poll:' || $1)) AS ok`, [this.bot.id])).rows[0].ok;
        if (!locked) { client.release(); await sleep(30_000); continue; } // another instance polls this bot
        const t = this.bots.transportFor(this.bot);
        let offset = Number((await client.query(`SELECT last_update_id FROM telegram_bots WHERE id = $1`, [this.bot.id])).rows[0]?.last_update_id ?? 0);
        while (!this.stopped) {
          const updates = await t.call<TgUpdate[]>('getUpdates', { offset: offset + 1, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35_000);
          for (const u of updates) {
            await this.engine.handleUpdate(this.bot, u, t);
            offset = u.update_id;
            await this.db.rows(`UPDATE telegram_bots SET last_update_id = GREATEST(last_update_id, $2), last_error = NULL WHERE id = $1`, [this.bot.id, offset]);
          }
          backoff = 5_000;
        }
      } catch (e) {
        const te = e instanceof TelegramError ? e : null;
        const msg = te?.code === 401 || te?.code === 404 ? 'Telegram tokeni bekor qilingan yoki noto‘g‘ri. Botni qayta ulang.'
          : te?.code === 409 ? 'Bu bot boshqa joyda ishlatilmoqda (webhook yoki boshqa server). Uni o‘chirib, qayta ulang.'
          : `Telegram bilan aloqa xatosi: ${(e as Error).message}`;
        await this.db.rows(`UPDATE telegram_bots SET last_error = $2, last_error_at = demo_now() WHERE id = $1`, [this.bot.id, msg]).catch(() => undefined);
        if (te?.code === 401 || te?.code === 404) {
          await this.db.rows(`UPDATE telegram_bots SET status = 'disabled' WHERE id = $1`, [this.bot.id]).catch(() => undefined);
          this.stopped = true;
        }
        this.log.warn(`bot ${this.bot.id}: ${msg}`);
        await sleep(te?.retryAfter ? te.retryAfter * 1000 : backoff);
        backoff = Math.min(backoff * 2, 120_000);
      } finally {
        if (locked) { await client.query(`SELECT pg_advisory_unlock(hashtext('tg-poll:' || $1))`, [this.bot.id]).catch(() => undefined); client.release(); }
      }
    }
  }
}

@Injectable()
export class TelegramWorkers implements OnApplicationBootstrap, OnModuleDestroy {
  private log = new Logger('TelegramWorkers');
  private timers: NodeJS.Timeout[] = [];
  private pollers = new Map<string, Poller>();
  private busy = { plan: false, deliver: false, sync: false, purge: false };
  constructor(private db: Db, private bots: BotRegistry, private engine: BotEngine, private notifier: Notifier) {}

  onApplicationBootstrap() {
    if (!config.telegram.workers) return;
    const every = (ms: number, key: keyof typeof this.busy, fn: () => Promise<unknown>) => {
      const run = async () => {
        if (this.busy[key]) return;
        this.busy[key] = true;
        try { await fn(); } catch (e) { this.log.error(`${key}: ${(e as Error).stack || e}`); } finally { this.busy[key] = false; }
      };
      this.timers.push(setInterval(run, ms));
      setTimeout(run, 2_000);
    };
    every(60_000, 'plan', () => this.notifier.planReminders());
    every(5_000, 'deliver', () => this.notifier.deliverDue());
    every(30_000, 'sync', () => this.syncPollers());
    every(24 * 3600_000, 'purge', () => this.purgeUpdates());
  }

  /** Processed update ids only guard against Telegram re-delivery (minutes): rows older than a week are dropped daily. */
  async purgeUpdates(): Promise<number> {
    const r = await this.db.pool.query(`DELETE FROM telegram_updates WHERE received_at < clock_timestamp() - interval '7 days'`);
    return r.rowCount ?? 0;
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
    for (const p of this.pollers.values()) p.stopped = true;
  }

  /** Starts pollers for connected bots, stops them for disconnected or re-tokened ones. */
  async syncPollers() {
    const rows = await this.db.rows<BotRow>(`SELECT id, tenant_id, kind, token_enc FROM telegram_bots WHERE kind = 'telegram' AND status = 'active'`);
    const want = new Map(rows.map((r) => [r.id, r]));
    for (const [id, p] of this.pollers) {
      if (!want.has(id) || want.get(id)!.token_enc !== p.bot.token_enc || p.stopped) { p.stopped = true; this.pollers.delete(id); }
    }
    for (const r of rows) {
      if (this.pollers.has(r.id)) continue;
      const p = new Poller(r, this.db, this.bots, this.engine, this.log);
      this.pollers.set(r.id, p);
      void p.run();
    }
  }
}
