import { Q } from '../core/db';
import { Ctx } from '../core/context';
import { now } from '../core/clock';

/** Current catalog price (tiyin). Branch-specific price wins over the general one. */
export async function currentPrice(q: Q, serviceId: string, branchId: string): Promise<number> {
  const r = (await q.query(
    `SELECT amount FROM service_prices WHERE service_id = $1 AND (branch_id IS NULL OR branch_id = $2) AND valid_from <= demo_now()
      ORDER BY (branch_id IS NULL), valid_from DESC LIMIT 1`, [serviceId, branchId])).rows[0];
  return r ? Number(r.amount) : 0;
}

/**
 * Share % snapshotted on an order: the performing doctor's own percent (`doctors.default_share_percent`, set by the
 * manager in Staff) when it is above 0, otherwise the service's `share_percent`. 0 on the doctor means «not set».
 * Snapshotted at order time, so later changes to either never rewrite past reports.
 */
export async function sharePercentFor(q: Q, tenantId: string, doctorId: string | null, servicePercent: number): Promise<number> {
  if (!doctorId) return servicePercent;
  const d = (await q.query(`SELECT default_share_percent FROM doctors WHERE id = $1 AND tenant_id = $2`, [doctorId, tenantId])).rows[0];
  const own = d ? Number(d.default_share_percent) : 0;
  return own > 0 ? own : servicePercent;
}

/**
 * Partner percent snapshotted on an order of a referred visit (docs/REFERRALS.md), the one place it is resolved:
 *   1. this partner's own percent for this service (referral_partner_services), else
 *   2. the service's `partner_percent` (NULL = not set), else
 *   3. the partner's `default_percent` (0 = none).
 * Snapshotted at order time like the doctor share: later edits of any of them never rewrite past lines.
 */
export async function partnerPercentFor(q: Q, tenantId: string, partnerId: string | null, serviceId: string): Promise<number> {
  if (!partnerId) return 0;
  const r = (await q.query(
    `SELECT p.default_percent, s.partner_percent, ps.percent AS pair
       FROM referral_partners p JOIN services s ON s.id = $3 AND s.tenant_id = p.tenant_id
       LEFT JOIN referral_partner_services ps ON ps.partner_id = p.id AND ps.service_id = s.id
      WHERE p.id = $2 AND p.tenant_id = $1`, [tenantId, partnerId, serviceId])).rows[0];
  if (!r) return 0;
  if (r.pair != null) return Number(r.pair);
  if (r.partner_percent != null) return Number(r.partner_percent);
  return Number(r.default_percent);
}

export async function nextInvoiceNumber(q: Q, tenantId: string): Promise<number> {
  return (await q.query(`UPDATE tenants SET invoice_seq = invoice_seq + 1 WHERE id = $1 RETURNING invoice_seq`, [tenantId])).rows[0].invoice_seq;
}

/**
 * Creates a service order with a price snapshot and bills it exactly once:
 * it is added to the visit's open invoice (no payments yet), otherwise a new invoice is opened.
 */
export async function createBilledOrder(q: Q, ctx: Ctx, o: {
  branchId: string; patientId: string; appointmentId: string | null; encounterId: string | null; serviceId: string; isPrimary: boolean;
  doctorId: string | null; performerDoctorId: string | null;
  /** 1–50; more than one only for a procedure (a course of injections): a lab test or a scan has one result */
  quantity?: number;
}): Promise<{ orderId: string; invoiceId: string }> {
  const s = (await q.query(`SELECT id, name, category, share_percent FROM services WHERE id = $1 AND tenant_id = $2`, [o.serviceId, ctx.tenantId])).rows[0];
  const qty = Math.max(1, Math.min(50, Math.round(o.quantity ?? 1)));
  const price = await currentPrice(q, o.serviceId, o.branchId); // unit price; the line carries qty × price
  const share = await sharePercentFor(q, ctx.tenantId, o.performerDoctorId ?? o.doctorId, Number(s.share_percent));
  // a referred visit: every service ordered on it carries the partner and the partner percent of that moment
  const partnerId: string | null = o.appointmentId
    ? (await q.query(`SELECT referral_partner_id FROM appointments WHERE id = $1 AND tenant_id = $2`, [o.appointmentId, ctx.tenantId])).rows[0]?.referral_partner_id ?? null : null;
  const partnerPct = await partnerPercentFor(q, ctx.tenantId, partnerId, s.id);
  const at = now();
  const orderId = (await q.query(
    `INSERT INTO service_orders (id, tenant_id, branch_id, patient_id, appointment_id, encounter_id, service_id, category, service_name, is_primary, price_snapshot,
                                 share_percent_snapshot, doctor_id, performer_doctor_id, status, ordered_at, created_by, quantity, referral_partner_id, partner_percent_snapshot)
     VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ordered',$14,$15,$16,$17,$18) RETURNING id`,
    [ctx.tenantId, o.branchId, o.patientId, o.appointmentId, o.encounterId, s.id, s.category, s.name, o.isPrimary, price, share,
      o.doctorId, o.performerDoctorId, at, ctx.membershipId, qty, partnerId, partnerPct])).rows[0].id;

  let invoice = o.appointmentId ? (await q.query(
    `SELECT id FROM invoices WHERE appointment_id = $1 AND tenant_id = $2 AND status = 'unpaid' AND paid_amount = 0 AND credit_amount = 0 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [o.appointmentId, ctx.tenantId])).rows[0] : undefined;
  if (!invoice) {
    const num = await nextInvoiceNumber(q, ctx.tenantId);
    invoice = (await q.query(
      `INSERT INTO invoices (id, tenant_id, branch_id, patient_id, appointment_id, invoice_number, status, created_at) VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,'unpaid',$6) RETURNING id`,
      [ctx.tenantId, o.branchId, o.patientId, o.appointmentId, num, at])).rows[0];
  }
  const pos = (await q.query(`SELECT coalesce(max(position), -1) + 1 AS p FROM invoice_items WHERE invoice_id = $1`, [invoice.id])).rows[0].p;
  await q.query(
    `INSERT INTO invoice_items (tenant_id, invoice_id, order_id, service_id, description, quantity, unit_price, line_subtotal, discount_share, line_total, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$8,$9)`, [ctx.tenantId, invoice.id, orderId, s.id, s.name, qty, price, price * qty, pos]);
  await recalcInvoice(q, invoice.id);
  return { orderId, invoiceId: invoice.id };
}

/**
 * Line value after refunds (SQL, needs aliases `it` = invoice_items and `i` = invoices). Two kinds of refund:
 *  - a line refund (refunds.order_id) is subtracted from exactly that line (`it.refunded_amount`, summed on the invoice
 *    as `i.line_refunded_amount`);
 *  - an invoice-level refund (the rest of `i.credit_amount`) is spread over the lines in proportion to what is left of
 *    them: (line_total − refunded) × total / (subtotal − discount − line_refunded).
 * Without refunds the value is exactly line_total = line_subtotal − discount_share (gross − the line's discount), so
 * NET_LINE = gross − discount − refunds. Used for service revenue, doctor share, partner share and service rankings.
 */
export const NET_LINE = `(CASE WHEN i.credit_amount = 0 THEN it.line_total
  WHEN i.credit_amount = i.line_refunded_amount THEN it.line_total - it.refunded_amount
  ELSE coalesce(round((it.line_total - it.refunded_amount) * i.total::numeric / NULLIF(i.subtotal - i.discount_amount - i.line_refunded_amount, 0)), 0) END)`;
/**
 * A referral partner's amount of one line (aliases `o` = service_orders, `it`, `i`): the line's net value (NET_LINE:
 * after discounts and refunds) × the percent snapshotted on the order.
 */
export const PARTNER_LINE = `round(${NET_LINE} * o.partner_percent_snapshot / 100)`;
/** Service count for reports: a course of 10 procedures counts as 10 (alias `it`). */
export const LINE_QTY = `it.quantity`;

/** One rule for invoice status everywhere (payments, refunds, recalculation). paid is net of refunds. */
export function invoiceStatus(inv: { status?: string; total: number; paid: number; credit: number; hasItems: boolean }) {
  if (inv.status === 'void') return 'void';
  if (inv.credit > 0 && inv.total === 0) return 'refunded';
  if (inv.paid === 0) return inv.total === 0 && inv.hasItems ? 'paid' : 'unpaid';
  return inv.paid >= inv.total ? 'paid' : 'partially_paid';
}

/** Patient debt of an invoice (alias `a`): what the patient still owes — the company's part is the company's receivable. */
export const PATIENT_DUE = (a = 'i') => `(${a}.total - ${a}.company_share_amount - (${a}.paid_amount - ${a}.company_paid_amount))`;
/** Company receivable of an invoice (alias `a`): the company's part not yet paid. */
export const COMPANY_DUE = (a = 'i') => `(${a}.company_share_amount - ${a}.company_paid_amount)`;

/** Which lines a discount rule covers (snapshotted on the invoice as `discount_scope`). */
export type DiscountScopeSnap = { scope: 'all' | 'categories' | 'services'; categories: string[]; service_ids: string[]; order_ids: string[] | null };
export const inScope = (s: DiscountScopeSnap, line: { category: string; service_id: string; order_id: string }) =>
  (!s.order_ids || s.order_ids.includes(line.order_id))
  && (s.scope === 'all' || (s.scope === 'categories' ? s.categories.includes(line.category) : s.service_ids.includes(line.service_id)));
/** One line's discount: a percent of the line (rounded to the tiyin) or a fixed sum, never more than the line. */
export const lineDiscount = (kind: 'percent' | 'fixed', value: number, lineSubtotal: number) =>
  Math.min(lineSubtotal, kind === 'percent' ? Math.round((lineSubtotal * Math.round(value * 100)) / 10000) : Math.round(value));
/** The company's part of a bill: percent of the lines in its coverage categories (none listed = all), rounded to the tiyin. */
export const companyShareOf = (lines: { category: string; line_total: number }[], categories: string[], percent: number) =>
  Math.round((lines.filter((l) => !categories.length || categories.includes(l.category)).reduce((a, l) => a + l.line_total, 0) * Math.round(percent * 100)) / 10000);

/**
 * Recomputes subtotal, the line discounts, total and the company's part. Only valid before any payment (line amounts
 * are frozen by a DB trigger once money moved). Two kinds of discount:
 *  - a rule (`discount_kind` + `discount_scope`, docs/DISCOUNTS_COMPANIES.md): each line in scope gets its own
 *    discount, a percent of the line or a fixed sum per line;
 *  - the manager's invoice-level discount (`discount_type` percent/amount): spread over the lines in proportion,
 *    the rounding remainder on the last line.
 * line_total = line_subtotal − discount_share, so NET_LINE (and the doctor / partner shares) are net of discounts.
 */
export async function recalcInvoice(q: Q, invoiceId: string) {
  const inv = (await q.query(`SELECT * FROM invoices WHERE id = $1`, [invoiceId])).rows[0];
  const items = (await q.query(
    `SELECT it.id, it.line_subtotal, it.order_id, it.service_id, o.category FROM invoice_items it JOIN service_orders o ON o.id = it.order_id
      WHERE it.invoice_id = $1 ORDER BY it.position, it.id`, [invoiceId])).rows.map((r: any) => ({ ...r, line_subtotal: Number(r.line_subtotal) }));
  const subtotal = items.reduce((a: number, b: any) => a + b.line_subtotal, 0);
  const shares: number[] = [];
  if (inv.discount_kind && inv.discount_scope) {
    const scope = inv.discount_scope as DiscountScopeSnap;
    for (const it of items) shares.push(inScope(scope, it) ? lineDiscount(inv.discount_kind, Number(inv.discount_rule_value), it.line_subtotal) : 0);
  } else {
    let discount = 0;
    if (inv.discount_type === 'percent') discount = Math.round((subtotal * Number(inv.discount_value)) / 100);
    else if (inv.discount_type === 'amount') discount = Math.min(Math.round(Number(inv.discount_value)), subtotal);
    let allocated = 0;
    items.forEach((it: any, i: number) => {
      const share = i === items.length - 1 ? discount - allocated : subtotal ? Math.floor((it.line_subtotal * discount) / subtotal) : 0;
      allocated += share; shares.push(share);
    });
  }
  for (const [i, it] of items.entries())
    await q.query(`UPDATE invoice_items SET discount_share = $2, line_total = line_subtotal - $2 WHERE id = $1 AND discount_share <> $2`, [it.id, shares[i]]);
  const discount = shares.reduce((a, b) => a + b, 0);
  const credit = Number(inv.credit_amount ?? 0);
  const total = subtotal - discount - credit;
  // the company's part follows the lines (a service added to the open bill is covered like the others)
  let companyShare = 0;
  if (inv.company_id) {
    const c = (await q.query(`SELECT coverage_categories FROM companies WHERE id = $1`, [inv.company_id])).rows[0];
    const lines = items.map((it: any, i: number) => ({ category: it.category, line_total: it.line_subtotal - shares[i] }));
    companyShare = Math.min(total, companyShareOf(lines, c?.coverage_categories ?? [], Number(inv.company_percent ?? 100)));
  }
  const paid = Number(inv.paid_amount);
  const status = invoiceStatus({ status: inv.status, total, paid, credit, hasItems: items.length > 0 });
  await q.query(`UPDATE invoices SET subtotal = $2, discount_amount = $3, total = $4, status = $5, company_share_amount = $6, version = version + 1, updated_at = demo_now() WHERE id = $1`,
    [invoiceId, subtotal, discount, total, status, companyShare]);
}
