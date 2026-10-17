import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@meduza/contracts';

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
}

export const PUBLIC_KEY = 'meduza:public';
export const ROLES_KEY = 'meduza:roles';
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const CurrentCtx = createParamDecorator((_: unknown, ec: ExecutionContext): Ctx => ec.switchToHttp().getRequest().ctx);
export const SESSION_COOKIE = 'meduza_session';
