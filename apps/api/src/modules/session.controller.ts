import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { loginSchema } from '@meduza/contracts';
import { assertDatabaseName, resetDemo, ResetInProgressError, SEED_IDS } from '@meduza/db';
import { Db } from '../core/db';
import { config } from '../core/config';
import { Ctx, CurrentCtx, Public, Roles, SESSION_COOKIE } from '../core/context';
import { AppError, conflict, forbidden } from '../core/errors';
import { hashToken } from '../core/guard';
import { parse } from '../core/validate';
import { audit } from '../core/audit';
import { now, syncClock, today } from '../core/clock';

/** Failed access-code attempts per client IP (in-memory; resets on restart). */
const failures = new Map<string, { n: number; until: number }>();

const demoOnly = () => { if (!config.demoEnabled) throw new AppError(404, 'NOT_FOUND', 'Manzil topilmadi'); };

@Controller()
export class SessionController {
  constructor(private db: Db) {}

  @Public() @Get('demo/accounts')
  async accounts() {
    demoOnly();
    const rows = await this.db.rows(
      `SELECT m.id AS membership_id, m.role, m.title, u.full_name, d.specialty
         FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN doctors d ON d.membership_id = m.id
        WHERE m.demo_card AND m.status = 'active' AND m.tenant_id = $1
        ORDER BY array_position(ARRAY['manager','registrar','doctor','cashier','lab'], m.role), u.full_name`, [SEED_IDS.tenant]);
    return { data: rows, meta: { access_code_required: !!config.demoAccessCode } };
  }

  @Public() @Post('demo/login') @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    demoOnly();
    const { membership_id, access_code } = parse(loginSchema, body);
    if (config.demoAccessCode) {
      const ip = String(req.ip ?? '');
      const now = Date.now();
      const rec = failures.get(ip);
      if (rec && rec.until > now && rec.n >= 10) throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Juda ko‘p noto‘g‘ri urinish. 10 daqiqadan keyin qayta urinib ko‘ring.');
      const a = Buffer.from(createHash('sha256').update(access_code ?? '').digest('hex'));
      const b = Buffer.from(createHash('sha256').update(config.demoAccessCode).digest('hex'));
      if (!timingSafeEqual(a, b)) {
        failures.set(ip, { n: (rec && rec.until > now ? rec.n : 0) + 1, until: now + 10 * 60_000 });
        throw new AppError(401, 'ACCESS_CODE', 'Kirish kodi noto‘g‘ri');
      }
      failures.delete(ip);
    }
    const m = await this.db.one(`SELECT id, tenant_id FROM memberships WHERE id = $1 AND status = 'active'`, [membership_id]);
    if (!m) throw forbidden('Bu demo akkaunt mavjud emas');
    const token = randomBytes(32).toString('base64url');
    await this.db.rows(`INSERT INTO sessions (token_hash, membership_id, tenant_id, expires_at) VALUES ($1,$2,$3, now() + make_interval(hours => $4))`,
      [hashToken(token), m.id, m.tenant_id, config.sessionTtlHours]);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: config.sessionTtlHours * 3600_000 });
    return { data: { ok: true } };
  }

  @Get('me')
  async me(@CurrentCtx() ctx: Ctx) {
    const branches = await this.db.rows(`SELECT id, name, code FROM branches WHERE tenant_id = $1 AND id = ANY($2) ORDER BY code`, [ctx.tenantId, ctx.branchIds]);
    return {
      data: {
        membership_id: ctx.membershipId, name: ctx.name, title: ctx.title, role: ctx.role, tenant_id: ctx.tenantId, clinic_name: ctx.tenantName,
        doctor_id: ctx.doctorId, doctor_specialty: ctx.doctorSpecialty, branches,
        today: today(), now: now().toISOString(), demo: config.demoEnabled, clock_reason: (await this.db.one(`SELECT set_reason FROM demo_clock WHERE id = 1`))?.set_reason ?? null, ai_mode: config.ai.mode === 'live' && !config.ai.apiKey ? 'off' : config.ai.mode,
      },
    };
  }

  @Public() @Post('logout') @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await this.db.rows(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { data: { ok: true } };
  }

  @Roles('manager') @Post('demo/reset') @HttpCode(200)
  async reset(@CurrentCtx() ctx: Ctx) {
    demoOnly();
    if (ctx.tenantId !== SEED_IDS.tenant) throw forbidden();
    // Defence in depth: a test process may only ever reset a *_test database.
    if (process.env.MEDUZA_TEST === '1') await assertDatabaseName(this.db.pool, '_test');
    try {
      const { counts, clock } = await resetDemo(this.db.pool, config.demoDate, config.demoTime);
      syncClock(clock.demo_anchor);
      await audit(this.db.pool, ctx, 'demo.reset', 'tenant', ctx.tenantId, 'Demo ma’lumotlari boshlang‘ich holatga tiklandi');
      return { data: { ok: true, counts } };
    } catch (e) {
      if (e instanceof ResetInProgressError) throw conflict('RESET_IN_PROGRESS', 'Tiklash allaqachon bajarilmoqda. Biroz kuting.');
      throw e;
    }
  }
}
