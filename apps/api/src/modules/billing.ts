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
}): Promise<{ orderId: string; invoiceId: string }> {
  const s = (await q.query(`SELECT id, name, category, share_percent FROM services WHERE id = $1 AND tenant_id = $2`, [o.serviceId, ctx.tenantId])).rows[0];
  const price = await currentPrice(q, o.serviceId, o.branchId);
  const at = now();
  const orderId = (await q.query(
    `INSERT INTO service_orders (id, tenant_id, branch_id, patient_id, appointment_id, encounter_id, service_id, category, service_name, is_primary, price_snapshot,
                                 share_percent_snapshot, doctor_id, performer_doctor_id, status, ordered_at, created_by)
     VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ordered',$14,$15) RETURNING id`,
    [ctx.tenantId, o.branchId, o.patientId, o.appointmentId, o.encounterId, s.id, s.category, s.name, o.isPrimary, price, s.share_percent,
      o.doctorId, o.performerDoctorId, at, ctx.membershipId])).rows[0].id;

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
     VALUES ($1,$2,$3,$4,$5,1,$6,$6,0,$6,$7)`, [ctx.tenantId, invoice.id, orderId, s.id, s.name, price, pos]);
  await recalcInvoice(q, invoice.id);
  return { orderId, invoiceId: invoice.id };
}

/** Recomputes subtotal, discount allocation (proportional, remainder on the last line) and total. Only valid before any payment. */
/**
 * Line value after refunds (SQL, needs aliases `it` = invoice_items and `i` = invoices). A refund reduces the whole
 * invoice (credit), so each line keeps its share: line_total × total / (subtotal − discount). Without refunds the
 * value is exactly line_total. Used for service revenue, doctor share and service rankings.
 */
export const NET_LINE = `(CASE WHEN i.credit_amount = 0 THEN it.line_total ELSE coalesce(round(it.line_total * i.total::numeric / NULLIF(i.subtotal - i.discount_amount, 0)), 0) END)`;

/** One rule for invoice status everywhere (payments, refunds, recalculation). paid is net of refunds. */
export function invoiceStatus(inv: { status?: string; total: number; paid: number; credit: number; hasItems: boolean }) {
  if (inv.status === 'void') return 'void';
  if (inv.credit > 0 && inv.total === 0) return 'refunded';
  if (inv.paid === 0) return inv.total === 0 && inv.hasItems ? 'paid' : 'unpaid';
  return inv.paid >= inv.total ? 'paid' : 'partially_paid';
}

export async function recalcInvoice(q: Q, invoiceId: string) {
  const inv = (await q.query(`SELECT * FROM invoices WHERE id = $1`, [invoiceId])).rows[0];
  const items = (await q.query(`SELECT id, line_subtotal FROM invoice_items WHERE invoice_id = $1 ORDER BY position, id`, [invoiceId])).rows;
  const subtotal = items.reduce((a: number, b: any) => a + Number(b.line_subtotal), 0);
  let discount = 0;
  if (inv.discount_type === 'percent') discount = Math.round((subtotal * Number(inv.discount_value)) / 100);
  else if (inv.discount_type === 'amount') discount = Math.min(Math.round(Number(inv.discount_value)), subtotal);
  let allocated = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const share = i === items.length - 1 ? discount - allocated : subtotal ? Math.floor((Number(it.line_subtotal) * discount) / subtotal) : 0;
    allocated += share;
    await q.query(`UPDATE invoice_items SET discount_share = $2, line_total = line_subtotal - $2 WHERE id = $1`, [it.id, share]);
  }
  const credit = Number(inv.credit_amount ?? 0);
  const total = subtotal - discount - credit; // refunds (credit) keep reducing the invoice when services are added later
  const paid = Number(inv.paid_amount);
  const status = invoiceStatus({ status: inv.status, total, paid, credit, hasItems: items.length > 0 });
  await q.query(`UPDATE invoices SET subtotal = $2, discount_amount = $3, total = $4, status = $5, version = version + 1, updated_at = demo_now() WHERE id = $1`,
    [invoiceId, subtotal, discount, total, status]);
}
