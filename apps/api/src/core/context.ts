import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Locale, Role, TextSize } from '@meduza/contracts';

export interface Ctx {
  membershipId: string;
  userId: string;
  tenantId: string;
  tenantName: string;
  role: Role;
  name: string;
  title: string | null;
  branchIds: string[];
  doctorId: string | null;
  doctorSpecialty: string | null;
  requestId: string;
  sessionHash: string;
  /** 'demo' = role card login, 'password' = real staff login, 'system' = server-side actor (Telegram bot), no session. */
  authKind: 'demo' | 'password' | 'system';
  /** Temporary password still in use: only /me, /auth/password and /logout are reachable. */
  mustChangePassword: boolean;
  /** Interface language and text size: the session's choice, else the staff account's, else Uzbek Latin / normal. */
  locale: Locale;
  textSize: TextSize;
}

export const PUBLIC_KEY = 'meduza:public';
export const PASSWORD_CHANGE_OK_KEY = 'meduza:password-change-ok';
export const ROLES_KEY = 'meduza:roles';
export const SESSION_FREE_KEY = 'meduza:session-free';
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Public route that never touches the session or the database in the guard (health check: must answer even when the database is down). */
export const SessionFree = () => SetMetadata(SESSION_FREE_KEY, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
/** Route stays reachable while the user must still replace a temporary password. */
export const AllowDuringPasswordChange = () => SetMetadata(PASSWORD_CHANGE_OK_KEY, true);
export const CurrentCtx = createParamDecorator((_: unknown, ec: ExecutionContext): Ctx => ec.switchToHttp().getRequest().ctx);
export const SESSION_COOKIE = 'meduza_session';
/** Language picked before signing in (login page); a UI preference only, copied into the new session. */
export const LANG_COOKIE = 'meduza_lang';
