// Manager's SMS settings (Eskiz.uz): credentials (password write-only, stored encrypted), sender name, on/off switch,
// a test message to the manager's own phone, and delivery statistics. Patient-facing sending lives in the notifier.
import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { normalizePhone } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, invalid } from '../core/errors';
import { parse } from '../core/validate';
import { audit } from '../core/audit';
import { decryptSecret, encryptSecret, secretsConfigured } from '../core/secrets';
import { EskizError } from './eskiz';
import { SETTINGS_COLS, SmsSender, SmsSettingsRow } from './transport';
import { ESKIZ_TEST_TEXT, smsParts } from './texts';

const settingsSchema = z.object({
  eskiz_email: z.string().trim().email('E-mail formati noto‘g‘ri').max(120).optional(),
  password: z.string().min(1).max(200).optional(),          // write-only; absent = keep the stored one
  sender: z.string().trim().regex(/^[A-Za-z0-9 ._-]{1,20}$/, 'Jo‘natuvchi nomi: 1–20 ta lotin harf yoki raqam').optional(),
  enabled: z.boolean().optional(),
});
const testSchema = z.object({ phone: z.string().trim().max(32).optional() });

/** One test message per clinic per minute (the gateway bills every one). */
const TEST_EVERY_MS = 60_000;
const lastTest = new Map<string, number>();

const publicView = (s: SmsSettingsRow | undefined) => ({
  eskiz_email: s?.eskiz_email ?? null,
  has_password: !!s?.password_enc,
  sender: s?.sender ?? '4546',
  enabled: s?.enabled ?? false,
  last_error: s?.last_error ?? null,
  last_error_at: s?.last_error_at ?? null,
  updated_at: s?.updated_at ?? null,
});

@Controller('sms')
export class SmsController {
  constructor(private db: Db, private sms: SmsSender) {}

  /** Settings without the password (only whether one is stored). */
  @Roles('manager') @Get('settings')
  async settings(@CurrentCtx() ctx: Ctx) {
    const s = await this.sms.settings(this.db.pool, ctx.tenantId);
    return { data: { ...publicView(s), secrets_configured: secretsConfigured() } };
  }

  /**
   * Saves the settings. New credentials are checked with Eskiz before they are stored; switching on requires stored
   * credentials. The password is encrypted with APP_SECRET_KEY and never returned.
   */
  @Roles('manager') @Put('settings')
  async save(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(settingsSchema, body);
    if (input.password !== undefined && !secretsConfigured()) throw new AppError(409, 'SECRETS_NOT_CONFIGURED', 'Serverda APP_SECRET_KEY sozlanmagan — parol xavfsiz saqlanmaydi. Administratorga murojaat qiling.');
    const out = await this.db.tx(async (c) => {
      await c.query(`INSERT INTO sms_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [ctx.tenantId]);
      const prev = (await c.query<SmsSettingsRow>(`SELECT ${SETTINGS_COLS} FROM sms_settings WHERE tenant_id = $1 FOR UPDATE`, [ctx.tenantId])).rows[0];
      const email = input.eskiz_email ?? prev.eskiz_email;
      const sender = input.sender ?? prev.sender;
      const enabled = input.enabled ?? prev.enabled;
      const passwordEnc = input.password !== undefined ? encryptSecret(input.password) : prev.password_enc;
      if (enabled && (!email || !passwordEnc)) throw invalid({ [email ? 'password' : 'eskiz_email']: 'SMS yoqish uchun Eskiz login va parolini kiriting' });
      // changed credentials are tried against the gateway right away, so a typo shows up here and not in a failed reminder at night
      const credsChanged = input.password !== undefined || (input.eskiz_email !== undefined && input.eskiz_email !== prev.eskiz_email);
      if (credsChanged && email && passwordEnc) {
        try {
          await this.sms.verify({ email, password: input.password ?? decryptSecret(passwordEnc) });
        } catch (e) {
          const err = e as EskizError;
          if (err instanceof EskizError && !err.retryable) throw new AppError(422, 'VALIDATION', 'Eskiz bu login va parolni qabul qilmadi', { password: 'Login yoki parol noto‘g‘ri' });
          throw new AppError(502, 'SMS_UNAVAILABLE', 'Eskiz bilan bog‘lanib bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.');
        }
      }
      const row = (await c.query<SmsSettingsRow>(
        `UPDATE sms_settings SET eskiz_email = $2, password_enc = $3, sender = $4, enabled = $5,
                last_error = CASE WHEN $6 THEN NULL ELSE last_error END, last_error_at = CASE WHEN $6 THEN NULL ELSE last_error_at END, updated_at = demo_now()
          WHERE tenant_id = $1 RETURNING ${SETTINGS_COLS}`, [ctx.tenantId, email, passwordEnc, sender, enabled, credsChanged])).rows[0];
      const changes = [credsChanged ? 'hisob' : null, input.sender !== undefined && input.sender !== prev.sender ? `jo‘natuvchi ${sender}` : null, input.enabled !== undefined && input.enabled !== prev.enabled ? (enabled ? 'yoqildi' : 'o‘chirildi') : null].filter(Boolean);
      if (changes.length) await audit(c, ctx, 'sms.settings', 'sms_settings', null, `SMS sozlamalari: ${changes.join(', ')}`);
      return row;
    });
    return { data: { ...publicView(out), secrets_configured: secretsConfigured() } };
  }

  /** Sends Eskiz's test text to the manager's own phone (the body's number, else the account's phone login). */
  @Roles('manager') @Post('test') @HttpCode(200)
  async test(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(testSchema, body);
    const login = (await this.db.one<{ login: string | null }>(`SELECT login FROM users WHERE id = $1`, [ctx.userId]))?.login ?? null;
    const phone = normalizePhone(input.phone || login || '');
    if (!phone) throw invalid({ phone: 'O‘zbekiston raqamini kiriting (+998 …)' });
    const s = await this.sms.settings(this.db.pool, ctx.tenantId);
    if (!s?.enabled) throw new AppError(409, 'SMS_DISABLED', 'Avval SMS kanalini yoqib, sozlamalarni saqlang.');
    const last = lastTest.get(ctx.tenantId) ?? 0;
    if (Date.now() - last < TEST_EVERY_MS) throw new AppError(429, 'TOO_SOON', 'Sinov SMS yaqinda yuborildi. Bir daqiqadan keyin qayta urinib ko‘ring.');
    lastTest.set(ctx.tenantId, Date.now());
    try {
      const r = await this.db.tx((c) => this.sms.send(c, { tenantId: ctx.tenantId, kind: 'test', phone, text: ESKIZ_TEST_TEXT, parts: smsParts(ESKIZ_TEST_TEXT) }));
      await audit(this.db.pool, ctx, 'sms.test', 'sms_settings', null, `Sinov SMS yuborildi: ${phone}`);
      return { data: { phone, provider_id: r.providerId } };
    } catch (e) {
      const err = e as EskizError;
      if (!(err instanceof EskizError)) throw e;
      if (err.status === 401 || err.status === 403) throw new AppError(422, 'VALIDATION', this.sms.describe(err), { password: 'Login yoki parol noto‘g‘ri' });
      throw new AppError(err.retryable ? 502 : 409, err.retryable ? 'SMS_UNAVAILABLE' : 'SMS_REJECTED', this.sms.describe(err));
    }
  }

  /** Sent / delivered / failed per day for the last 14 days, totals and the latest gateway error. */
  @Roles('manager') @Get('stats')
  async stats(@CurrentCtx() ctx: Ctx) {
    await this.sms.refreshStatuses(20).catch(() => undefined);
    const days = await this.db.rows(
      `SELECT to_char(created_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS day,
              count(*) FILTER (WHERE status IN ('sent', 'delivered'))::int AS sent,
              count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
              count(*) FILTER (WHERE status IN ('failed', 'undelivered'))::int AS failed,
              coalesce(sum(parts) FILTER (WHERE status <> 'failed'), 0)::int AS parts
         FROM sms_messages WHERE tenant_id = $1 AND created_at >= (demo_now() AT TIME ZONE 'Asia/Tashkent')::date - 13
        GROUP BY 1 ORDER BY 1 DESC`, [ctx.tenantId]);
    const totals = await this.db.one(
      `SELECT count(*) FILTER (WHERE status IN ('sent', 'delivered'))::int AS sent_30d, count(*) FILTER (WHERE status IN ('failed', 'undelivered'))::int AS failed_30d,
              (SELECT count(*)::int FROM notifications WHERE tenant_id = $1 AND channel = 'sms' AND status = 'pending') AS pending
         FROM sms_messages WHERE tenant_id = $1 AND created_at >= demo_now() - interval '30 days'`, [ctx.tenantId]);
    const s = await this.sms.settings(this.db.pool, ctx.tenantId);
    return { data: { days, totals, last_error: s?.last_error ?? null, last_error_at: s?.last_error_at ?? null } };
  }
}
