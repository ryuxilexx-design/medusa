import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { normalizeLogin, passwordChangeSchema, passwordLoginSchema } from '@meduza/contracts';
import { hashPassword, verifyPassword } from '@meduza/db';
import { Db } from '../core/db';
import { AllowDuringPasswordChange, Ctx, CurrentCtx, Public } from '../core/context';
import { AppError, conflict, forbidden, invalid } from '../core/errors';
import { parse } from '../core/validate';
import { audit } from '../core/audit';
import { startSession } from './session.controller';

/** Per-account lockout: after this many wrong passwords the account is locked for LOCK_MINUTES. */
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
/**
 * Failed-login throttles (in-memory; reset on restart), on top of the per-account lockout:
 * per IP + login (stops guessing one account) and per IP overall with a high ceiling (stops spraying many accounts,
 * while a whole clinic behind one NAT address is not locked out by one person's typos). Entries expire and are pruned.
 */
const PAIR_MAX = 10;
const IP_MAX = 100;
const IP_WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { n: number; until: number }>();

const BAD_CREDENTIALS = () => new AppError(401, 'INVALID_CREDENTIALS', 'Login yoki parol noto‘g‘ri');
const TOO_MANY = () => new AppError(429, 'TOO_MANY_ATTEMPTS', 'Juda ko‘p noto‘g‘ri urinish. 15 daqiqadan keyin qayta urinib ko‘ring.');
const keysOf = (req: Request, login?: string) => [`ip:${req.ip ?? ''}`, ...(login ? [`pair:${req.ip ?? ''}:${login.trim().toLowerCase()}`] : [])];

function ipCheck(req: Request, login?: string) {
  const now = Date.now();
  for (const k of keysOf(req, login)) {
    const rec = failures.get(k);
    if (rec && rec.until > now && rec.n >= (k.startsWith('pair:') ? PAIR_MAX : IP_MAX)) throw TOO_MANY();
  }
}
function ipFail(req: Request, login?: string) {
  const now = Date.now();
  if (failures.size > 10_000) for (const [k, v] of failures) if (v.until <= now) failures.delete(k);
  for (const k of keysOf(req, login)) {
    const rec = failures.get(k);
    failures.set(k, { n: (rec && rec.until > now ? rec.n : 0) + 1, until: now + IP_WINDOW_MS });
  }
}

/** Audit context for events that happen before a session exists. */
const actor = (m: { membership_id: string; user_id: string; tenant_id: string; tenant_name: string; role: any; full_name: string }, req: any): Ctx => ({
  membershipId: m.membership_id, userId: m.user_id, tenantId: m.tenant_id, tenantName: m.tenant_name, role: m.role, name: m.full_name, title: null,
  branchIds: [], doctorId: null, doctorSpecialty: null, requestId: req.requestId, sessionHash: '', authKind: 'password', mustChangePassword: false, locale: 'uz', textSize: 'normal',
});

@Controller('auth')
export class AuthController {
  constructor(private db: Db) {}

  /** Staff sign-in with phone or username + password. The error never reveals whether the login exists. */
  @Public() @Post('login') @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    ipCheck(req);
    const input = parse(passwordLoginSchema, body);
    const login = normalizeLogin(input.login);
    ipCheck(req, login ?? input.login);
    const user = login ? await this.db.one(
      `SELECT id, password_hash, locked_until > now() AS locked, ceil(extract(epoch FROM locked_until - now()) / 60)::int AS lock_min FROM users WHERE login = $1`, [login]) : undefined;
    if (user?.locked) throw new AppError(429, 'ACCOUNT_LOCKED', `Ko‘p marta noto‘g‘ri parol kiritildi. ${user.lock_min} daqiqadan keyin qayta urinib ko‘ring yoki rahbardan parolni tiklashni so‘rang.`);
    const ok = await verifyPassword(input.password, user?.password_hash); // runs a dummy hash for unknown logins too
    const memberships = user ? await this.db.rows(
      `SELECT m.id AS membership_id, m.user_id, m.tenant_id, t.name AS tenant_name, m.role, m.title, u.full_name
         FROM memberships m JOIN tenants t ON t.id = m.tenant_id JOIN users u ON u.id = m.user_id
        WHERE m.user_id = $1 AND m.status = 'active' AND t.status = 'active'
        ORDER BY t.name, array_position(ARRAY['manager','doctor','registrar','cashier','lab','storekeeper'], m.role)`, [user.id]) : [];

    if (!user || !ok) {
      ipFail(req, login ?? input.login);
      if (user) {
        const r = (await this.db.one(
          `UPDATE users SET failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
                            locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
            WHERE id = $1 RETURNING locked_until > now() AS locked`, [user.id, MAX_FAILED, LOCK_MINUTES]))!;
        if (r.locked) for (const m of memberships) await audit(this.db.pool, actor(m, req), 'auth.locked', 'user', m.user_id, `${MAX_FAILED} marta noto‘g‘ri parol — akkaunt ${LOCK_MINUTES} daqiqaga bloklandi`);
      }
      throw BAD_CREDENTIALS();
    }
    if (!memberships.length) throw forbidden('Akkaunt faol emas. Klinika rahbariga murojaat qiling.');
    let m = memberships[0];
    if (memberships.length > 1) {
      const chosen = memberships.find((x) => x.membership_id === input.membership_id);
      if (!chosen) throw conflict('CHOOSE_MEMBERSHIP', 'Qaysi klinika va rol bilan kirishni tanlang',
        { options: memberships.map((x) => ({ membership_id: x.membership_id, clinic_name: x.tenant_name, role: x.role, title: x.title })) });
      m = chosen;
    }
    await this.db.rows(`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [user.id]);
    await startSession(this.db, req, res, m.membership_id, m.tenant_id, 'password');
    await audit(this.db.pool, actor(m, req), 'auth.login', 'membership', m.membership_id, 'Parol bilan tizimga kirdi');
    return { data: { ok: true } };
  }

  /** Changes the signed-in user's password. Other sessions of the same person are closed. */
  @AllowDuringPasswordChange() @Post('password') @HttpCode(200)
  async change(@CurrentCtx() ctx: Ctx, @Body() body: unknown, @Req() req: Request) {
    if (ctx.authKind !== 'password') throw forbidden('Demo akkauntda parol yo‘q');
    ipCheck(req, ctx.userId);
    const input = parse(passwordChangeSchema, body);
    const u = await this.db.one(`SELECT password_hash FROM users WHERE id = $1`, [ctx.userId]);
    if (!(await verifyPassword(input.current_password, u?.password_hash))) {
      ipFail(req, ctx.userId);
      throw invalid({ current_password: 'Joriy parol noto‘g‘ri' });
    }
    const hash = await hashPassword(input.new_password);
    await this.db.tx(async (c) => {
      await c.query(`UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1`, [ctx.userId, hash]);
      await c.query(`DELETE FROM sessions WHERE membership_id IN (SELECT id FROM memberships WHERE user_id = $1) AND token_hash <> $2`, [ctx.userId, ctx.sessionHash]);
      await audit(c, ctx, 'auth.password_changed', 'user', ctx.userId, 'Parol o‘zgartirildi');
    });
    return { data: { ok: true } };
  }
}
