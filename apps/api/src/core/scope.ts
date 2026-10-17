import { Ctx } from './context';
import { forbidden } from './errors';
import { isUuid } from './validate';

/** Returns the branch ids a query may cover. A requested branch outside the session scope is rejected. */
export function branchScope(ctx: Ctx, requested?: unknown): string[] {
  if (requested && requested !== 'all') {
    if (!isUuid(requested) || !ctx.branchIds.includes(requested)) throw forbidden('Bu filial ma’lumotlariga ruxsat yo‘q');
    return [requested];
  }
  return ctx.branchIds;
}
export function assertBranch(ctx: Ctx, branchId: string) {
  if (!ctx.branchIds.includes(branchId)) throw forbidden('Bu filial ma’lumotlariga ruxsat yo‘q');
}
