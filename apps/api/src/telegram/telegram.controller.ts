import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { Db } from '../core/db';
import { config } from '../core/config';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, forbidden, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { encryptSecret, secretsConfigured } from '../core/secrets';
import { BotEngine, TgUpdate } from './engine';
import { BotRegistry, Notifier } from './notifier';
import { HttpTransport, TelegramError } from './transport';

const connectSchema = z.object({ token: z.string().trim().regex(/^\d{5,15}:[A-Za-z0-9_-]{30,64}$/, 'Token formati noto‘g‘ri (BotFather bergan «123456:ABC…» ko‘rinishida)') });
const simSendSchema = z.object({
  chat_id: z.number().int().max(-1),            // simulated chats always use negative ids
  text: z.string().max(2000).optional(),
  callback_data: z.string().max(64).optional(),
  label: z.string().max(200).optional(),        // the pressed button's caption, kept in the transcript
  contact_phone: z.string().max(32).optional(),
}).refine((d) => [d.text, d.callback_data, d.contact_phone].filter((x) => x !== undefined).length === 1, { message: 'Bitta amal yuboring' });

const demoOnly = () => { if (!config.demoEnabled) throw new AppError(404, 'NOT_FOUND', 'Manzil topilmadi'); };
let simUpdateSeq = Date.now() * 10;

@Controller()
export class TelegramController {
  constructor(private db: Db, private bots: BotRegistry, private engine: BotEngine, private notifier: Notifier) {}

  /** Bot settings and delivery stats for the manager. The token is never returned. */
  @Roles('manager') @Get('telegram')
  async status(@CurrentCtx() ctx: Ctx) {
    const bot = await this.db.one(
      `SELECT username, status, last_error, last_error_at, created_at, updated_at FROM telegram_bots WHERE tenant_id = $1 AND kind = 'telegram'`, [ctx.tenantId]);
    const stats = await this.db.one(
      `SELECT (SELECT count(*)::int FROM telegram_chats tc JOIN telegram_bots b ON b.id = tc.bot_id WHERE tc.tenant_id = $1 AND b.kind = 'telegram' AND tc.phone IS NOT NULL AND NOT tc.blocked) AS linked_chats,
              (SELECT count(*)::int FROM notifications WHERE tenant_id = $1 AND status = 'sent' AND sent_at >= demo_now() - interval '7 days') AS sent_7d,
              (SELECT count(*)::int FROM notifications WHERE tenant_id = $1 AND status = 'failed' AND created_at >= demo_now() - interval '7 days') AS failed_7d,
              (SELECT count(*)::int FROM appointments WHERE tenant_id = $1 AND source = 'telegram' AND created_at >= demo_now() - interval '7 days') AS bookings_7d,
              (SELECT count(*)::int FROM appointments WHERE tenant_id = $1 AND patient_confirmed_at >= demo_now() - interval '7 days') AS confirmed_7d`, [ctx.tenantId]);
    return { data: { bot: bot ?? null, stats, secrets_configured: secretsConfigured(), simulator_available: config.demoEnabled, workers: config.telegram.workers } };
  }

  /** Connects the clinic's own bot: the token is checked with Telegram (getMe), then stored encrypted. */
  @Roles('manager') @Post('telegram/bot') @HttpCode(200)
  async connect(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const { token } = parse(connectSchema, body);
    if (!secretsConfigured()) throw new AppError(409, 'SECRETS_NOT_CONFIGURED', 'Serverda APP_SECRET_KEY sozlanmagan — token xavfsiz saqlanmaydi. Administratorga murojaat qiling.');
    const t = new HttpTransport(token);
    let me: { username: string };
    try {
      me = await t.call('getMe');
      await t.call('deleteWebhook', { drop_pending_updates: false }); // the server reads updates by long polling
    } catch (e) {
      if (e instanceof TelegramError && (e.code === 401 || e.code === 404)) throw new AppError(422, 'VALIDATION', 'Telegram bu tokenni qabul qilmadi', { token: 'Token noto‘g‘ri yoki bekor qilingan' });
      throw new AppError(502, 'TELEGRAM_UNAVAILABLE', 'Telegram bilan bog‘lanib bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.');
    }
    const enc = encryptSecret(token);
    await this.db.tx(async (c) => {
      const prev = (await c.query(`SELECT id, username FROM telegram_bots WHERE tenant_id = $1 AND kind = 'telegram' FOR UPDATE`, [ctx.tenantId])).rows[0];
      if (prev) {
        // a different bot means different chats: start from scratch; the same bot keeps its chats and offset
        const sameBot = prev.username === me.username;
        await c.query(`UPDATE telegram_bots SET token_enc = $2, username = $3, status = 'active', last_error = NULL, updated_at = demo_now()${sameBot ? '' : ', last_update_id = 0'} WHERE id = $1`, [prev.id, enc, me.username]);
        if (!sameBot) await c.query(`DELETE FROM telegram_chats WHERE bot_id = $1`, [prev.id]);
      } else {
        await c.query(`INSERT INTO telegram_bots (tenant_id, kind, username, token_enc) VALUES ($1, 'telegram', $2, $3)`, [ctx.tenantId, me.username, enc]);
      }
      await audit(c, ctx, 'telegram.connect', 'telegram_bot', null, `Telegram bot ulandi: @${me.username}`);
    });
    return { data: { username: me.username } };
  }

  @Roles('manager') @Delete('telegram/bot')
  async disconnect(@CurrentCtx() ctx: Ctx) {
    await this.db.tx(async (c) => {
      const r = await c.query(`UPDATE telegram_bots SET status = 'disabled', updated_at = demo_now() WHERE tenant_id = $1 AND kind = 'telegram' AND status = 'active' RETURNING username`, [ctx.tenantId]);
      if (r.rowCount) await audit(c, ctx, 'telegram.disconnect', 'telegram_bot', null, `Telegram bot o‘chirildi: @${r.rows[0].username}`);
    });
    return { data: { ok: true } };
  }

  // ---------- simulator (demo mode only): the real engine, a recorded transport ----------

  @Roles('manager') @Post('telegram/sim/chats') @HttpCode(201)
  async simNewChat() {
    demoOnly();
    return { data: { chat_id: -randomInt(1_000_000, 2_000_000_000) } };
  }

  @Roles('manager') @Get('telegram/sim/messages')
  async simMessages(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    demoOnly();
    const chatId = Number(q.chat_id);
    if (!Number.isInteger(chatId) || chatId >= 0) return { data: [] };
    const bot = await this.bots.simulator(ctx.tenantId);
    const after = Number(q.after) || 0;
    const rows = await this.db.rows(`SELECT id, direction, text, markup, created_at FROM telegram_sim_messages WHERE bot_id = $1 AND chat_id = $2 AND id > $3 ORDER BY id LIMIT 500`,
      [bot.id, chatId, after]);
    return { data: rows.map((r) => ({ ...r, id: Number(r.id) })) };
  }

  @Roles('manager') @Post('telegram/sim/send') @HttpCode(200)
  async simSend(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    demoOnly();
    const input = parse(simSendSchema, body);
    const bot = await this.bots.simulator(ctx.tenantId);
    const chat = { id: input.chat_id, type: 'private' };
    const from = { id: input.chat_id, language_code: 'uz' };
    const update: TgUpdate = { update_id: ++simUpdateSeq };
    let shown: string;
    if (input.callback_data !== undefined) {
      update.callback_query = { id: String(update.update_id), from, data: input.callback_data, message: { chat } };
      shown = input.label ?? input.callback_data;
    } else if (input.contact_phone !== undefined) {
      update.message = { message_id: update.update_id, chat, from, contact: { phone_number: input.contact_phone, user_id: from.id } };
      shown = `📱 ${input.contact_phone}`;
    } else {
      update.message = { message_id: update.update_id, chat, from, text: input.text };
      shown = input.text!;
    }
    await this.db.rows(`INSERT INTO telegram_sim_messages (bot_id, chat_id, direction, text) VALUES ($1,$2,'in',$3)`, [bot.id, input.chat_id, shown]);
    await this.engine.handleUpdate(bot, update, this.bots.transportFor(bot));
    return { data: { ok: true } };
  }

  /** Demo: run the reminder planner and the outbox now instead of waiting for the background timers. */
  @Roles('manager') @Post('telegram/sim/run-workers') @HttpCode(200)
  async simRunWorkers() {
    demoOnly();
    const planned = await this.notifier.planReminders();
    const delivered = await this.notifier.deliverDue();
    return { data: { planned, ...delivered } };
  }

  // ---------- pre-visit questionnaire for the doctor ----------

  /** Patient's own answers before the visit. Clinical content: the appointment's doctor only. */
  @Roles('doctor') @Get('appointments/:id/intake')
  async intake(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Qabul');
    const a = await this.db.one(`SELECT doctor_id FROM appointments WHERE id = $1 AND tenant_id = $2 AND branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!a) throw notFound('Qabul');
    if (a.doctor_id !== ctx.doctorId) throw forbidden('Bu qabul sizga tegishli emas');
    const f = await this.db.one(`SELECT complaints, allergies, medications, submitted_at FROM intake_forms WHERE appointment_id = $1`, [id]);
    return { data: f ?? null };
  }
}
