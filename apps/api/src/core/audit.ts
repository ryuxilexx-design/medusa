import { Q } from './db';
import { Ctx } from './context';

/** Writes an audit event. Never pass full clinical text or AI prompts here. */
export async function audit(q: Q, ctx: Ctx, action: string, resourceType: string, resourceId: string | null, summary: string, branchId: string | null = null) {
  await q.query(
    `INSERT INTO audit_logs (tenant_id, branch_id, actor_membership_id, actor_name, actor_role, action, resource_type, resource_id, summary, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [ctx.tenantId, branchId, ctx.membershipId, ctx.name, ctx.role, action, resourceType, resourceId, summary, ctx.requestId],
  );
}
