import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { Db } from './db';
import { AppError, forbidden } from './errors';
import { syncClock } from './clock';
import { Ctx, PUBLIC_KEY, ROLES_KEY, SESSION_COOKIE } from './context';
import type { Role } from '@meduza/contracts';

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** Resolves the session from the HttpOnly cookie. Tenant, role and branch scope come only from the server-side session. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private db: Db) {}
  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const req = ec.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ec.getHandler(), ec.getClass()]);
    const token: string | undefined = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const h = hashToken(token);
      const row = await this.db.one(
        `SELECT m.id AS membership_id, m.user_id, m.tenant_id, t.name AS tenant_name, m.role, m.branch_ids, m.title, u.full_name,
                d.id AS doctor_id, d.specialty, demo_now() AS demo_now
           FROM sessions s JOIN memberships m ON m.id = s.membership_id JOIN users u ON u.id = m.user_id
           JOIN tenants t ON t.id = m.tenant_id LEFT JOIN doctors d ON d.membership_id = m.id AND d.tenant_id = m.tenant_id
          WHERE s.token_hash = $1 AND s.expires_at > now() AND m.status = 'active' AND t.status = 'active'`, [h]);
      if (row) syncClock(row.demo_now);
      if (row) {
        req.ctx = {
          membershipId: row.membership_id, userId: row.user_id, tenantId: row.tenant_id, tenantName: row.tenant_name, role: row.role,
          name: row.full_name, title: row.title, branchIds: row.branch_ids, doctorId: row.doctor_id, doctorSpecialty: row.specialty,
          requestId: req.requestId, sessionHash: h,
        } satisfies Ctx;
      }
    }
    if (!req.ctx) syncClock((await this.db.one('SELECT demo_now() AS n'))!.n);
    if (isPublic) return true;
    if (!req.ctx) throw new AppError(401, 'UNAUTHENTICATED', 'Sessiya tugagan. Qayta kiring.');
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ec.getHandler(), ec.getClass()]);
    if (roles && !roles.includes(req.ctx.role)) throw forbidden();
    return true;
  }
}
