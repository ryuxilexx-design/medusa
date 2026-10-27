// Discounts on a bill: applying a rule (benefit category, company or picked by hand) within the staff limit, and the
// shared «money has moved» lock (docs/DISCOUNTS_COMPANIES.md, migration 043).
import { translate, type ApplyDiscountInput } from '@meduza/contracts';
import { Q } from '../core/db';
import { Ctx } from '../core/context';
import { coded, invalid, notFound } from '../core/errors';
import { isUuid } from '../core/validate';
import { audit } from '../core/audit';
import { today } from '../core/clock';
import { recalcInvoice, type DiscountScopeSnap } from './billing';

const som = (t: number) => (t / 100).toLocaleString('ru-RU').replace(/ /g, ' ');
const msg = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate('uz', k, p);

/** Rule columns every reader gets (the picker shows the value and the staff limit as a hint). */
export const RULE_COLS = `r.id, r.name, r.kind, r.percent, r.amount, r.staff_max_percent, r.staff_max_amount, r.scope, r.categories, r.service_ids, r.valid_from, r.valid_to, r.active`;
/** A rule can be used today: active and inside its dates (SQL on alias `r`, $n = today). */
export const RULE_USABLE = (n: number) => `r.active AND (r.valid_from IS NULL OR r.valid_from <= $${n}::date) AND (r.valid_to IS NULL OR r.valid_to >= $${n}::date)`;

/**
 * The bill row, locked, in the person's branches — and refused (409 `code`) once money moved on it: a payment, a refund
 * or a company payment. Discounts and the company split are drafts until the first money; after it a refund is the way.
 */
export async function lockDraftInvoice(c: Q, ctx: Ctx, id: string, code: 'DISCOUNT_LOCKED' | 'COMPANY_SPLIT_LOCKED') {
  if (!isUuid(id)) throw notFound('Hisob');
  const inv = (await c.query(`SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
  if (!inv || !ctx.branchIds.includes(inv.branch_id)) throw notFound('Hisob');
  const moved = inv.status === 'void' || Number(inv.paid_amount) > 0 || Number(inv.credit_amount) > 0
    || !!(await c.query(`SELECT 1 FROM payments WHERE invoice_id = $1 LIMIT 1`, [id])).rowCount;
  if (moved) throw coded(409, code, code === 'DISCOUNT_LOCKED' ? 'api.disc.locked' : 'api.comp.splitLocked');
  return inv;
}

/**
 * Applies a discount rule to an open bill (or removes it with rule_id null). Within the rule's staff maximum a
 * registrar or cashier may give it; above it only the manager, with a reason (kept on the bill, audited without the text).
 */
export async function applyDiscount(c: Q, ctx: Ctx, invoiceId: string, input: ApplyDiscountInput) {
  const inv = await lockDraftInvoice(c, ctx, invoiceId, 'DISCOUNT_LOCKED');
  if (!input.rule_id) {
    if (!inv.discount_rule_id && !inv.discount_type) return { discount_amount: 0, total: Number(inv.total), changed: false };
    await c.query(`UPDATE invoices SET discount_rule_id = NULL, discount_rule_name = NULL, discount_kind = NULL, discount_rule_value = NULL, discount_scope = NULL, discount_source = NULL,
        discount_benefit_category_id = NULL, discount_granted_by = NULL, discount_granted_by_name = NULL, discount_granted_at = NULL, discount_over_limit = false,
        discount_type = NULL, discount_value = NULL, discount_reason = NULL, discount_approved_by_name = NULL WHERE id = $1`, [invoiceId]);
    await recalcInvoice(c, invoiceId);
    await audit(c, ctx, 'invoice.discount_remove', 'invoice', invoiceId, `Hisob №${inv.invoice_number}: chegirma olib tashlandi`, inv.branch_id);
    const after = (await c.query(`SELECT discount_amount, total FROM invoices WHERE id = $1`, [invoiceId])).rows[0];
    return { discount_amount: Number(after.discount_amount), total: Number(after.total), changed: true };
  }
  if (!isUuid(input.rule_id)) throw invalid({ rule_id: msg('api.disc.ruleNotFound') });
  const r = (await c.query(`SELECT * FROM discount_rules r WHERE r.id = $1 AND r.tenant_id = $2`, [input.rule_id, ctx.tenantId])).rows[0];
  if (!r) throw invalid({ rule_id: msg('api.disc.ruleNotFound') });
  const t = today();
  if (!r.active || (r.valid_from && String(r.valid_from).slice(0, 10) > t) || (r.valid_to && String(r.valid_to).slice(0, 10) < t)) throw coded(409, 'RULE_INACTIVE', 'api.disc.ruleInactive');
  const percentRule = r.kind === 'percent';
  if (percentRule && input.amount !== undefined) throw invalid({ amount: msg('api.disc.percentOnly') });
  if (!percentRule && input.percent !== undefined) throw invalid({ percent: msg('api.disc.amountOnly') });
  const value = percentRule ? input.percent ?? Number(r.percent) : input.amount ?? Number(r.amount);
  const staffMax = percentRule ? Number(r.staff_max_percent) : Number(r.staff_max_amount);
  const overLimit = value > staffMax;
  if (overLimit && ctx.role !== 'manager')
    throw coded(403, 'DISCOUNT_OVER_LIMIT', 'api.disc.overLimit', { max: percentRule ? `${staffMax}%` : `${som(staffMax)} so‘m` });
  if (overLimit && !input.reason) throw invalid({ reason: msg('api.disc.reasonRequired') });
  // only lines of this bill
  let orderIds: string[] | null = null;
  if (input.order_ids?.length) {
    const ids = [...new Set(input.order_ids)];
    const n = (await c.query(`SELECT count(*)::int AS n FROM invoice_items WHERE invoice_id = $1 AND order_id = ANY($2::uuid[])`, [invoiceId, ids])).rows[0].n;
    if (n !== ids.length) throw invalid({ order_ids: msg('api.lineNotOnInvoice') });
    orderIds = ids;
  }
  // the patient's benefit category at this moment (for the report «by category»)
  const p = (await c.query(`SELECT benefit_category_id, company_id FROM patients WHERE id = $1`, [inv.patient_id])).rows[0];
  const benefitId = input.source === 'benefit' ? p?.benefit_category_id ?? null : null;
  const scope: DiscountScopeSnap = { scope: r.scope, categories: r.categories ?? [], service_ids: r.service_ids ?? [], order_ids: orderIds };
  await c.query(
    `UPDATE invoices SET discount_rule_id = $2, discount_rule_name = $3, discount_kind = $4, discount_rule_value = $5, discount_scope = $6, discount_source = $7,
        discount_benefit_category_id = $8, discount_granted_by = $9, discount_granted_by_name = $10, discount_granted_at = demo_now(), discount_over_limit = $11,
        discount_type = NULL, discount_value = NULL, discount_reason = $12, discount_approved_by_name = $13 WHERE id = $1`,
    [invoiceId, r.id, r.name, r.kind, value, JSON.stringify(scope), input.source, benefitId, ctx.membershipId || null, ctx.name, overLimit,
      input.reason ?? null, overLimit ? ctx.name : null]);
  await recalcInvoice(c, invoiceId);
  const after = (await c.query(`SELECT discount_amount, total FROM invoices WHERE id = $1`, [invoiceId])).rows[0];
  if (!Number(after.discount_amount)) throw coded(422, 'DISCOUNT_NO_LINES', 'api.disc.noLines');
  // audit: the rule, the value and the amount — never the reason text
  await audit(c, ctx, 'invoice.discount_rule', 'invoice', invoiceId,
    `Hisob №${inv.invoice_number}: «${r.name}» ${percentRule ? value + '%' : som(value) + ' so‘m'} — ${som(Number(after.discount_amount))} so‘m${overLimit ? ' (limitdan yuqori, rahbar)' : ''}`, inv.branch_id);
  return { discount_amount: Number(after.discount_amount), total: Number(after.total), changed: true, over_limit: overLimit };
}
