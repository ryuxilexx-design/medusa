// Corporate payers (employers, insurers): the company split of a bill, company payments and their void, the
// receivable and the statement (docs/DISCOUNTS_COMPANIES.md, migration 043).
import { translate } from '@meduza/contracts';
import { Q } from '../core/db';
import { Ctx } from '../core/context';
import { coded, forbidden, invalid, notFound } from '../core/errors';
import { isUuid } from '../core/validate';
import { audit } from '../core/audit';
import { now } from '../core/clock';
import { COMPANY_DUE, invoiceStatus, recalcInvoice } from './billing';
import { lockDraftInvoice } from './discounts';
import { recordFiscal } from '../fiscal/provider';

const som = (t: number) => (t / 100).toLocaleString('ru-RU').replace(/ /g, ' ');
const msg = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate('uz', k, p);

/** Payer fields of the patient card: money matters, removed for the doctor. */
export const PAYER_FIELDS = ['benefit_category_id', 'benefit_category_name', 'benefit_note', 'company_id', 'company_name', 'company_member_no'];

/** Validates the payer fields of a card: an active category / company of this clinic, the document note when the category asks for it. */
export async function checkPatientPayer(q: Q, tenantId: string, v: { benefit_category_id?: string | null; benefit_note?: string | null; company_id?: string | null }) {
  if (v.benefit_category_id) {
    const b = (await q.query(`SELECT requires_document, document_label, active FROM benefit_categories WHERE id = $1 AND tenant_id = $2`, [v.benefit_category_id, tenantId])).rows[0];
    if (!b || !b.active) throw invalid({ benefit_category_id: msg('api.disc.badCategory') });
    if (b.requires_document && !v.benefit_note) throw invalid({ benefit_note: msg('api.disc.noteRequired', { label: b.document_label || 'Hujjat raqami' }) });
  }
  if (v.company_id) {
    const c = (await q.query(`SELECT active FROM companies WHERE id = $1 AND tenant_id = $2`, [v.company_id, tenantId])).rows[0];
    if (!c || !c.active) throw invalid({ company_id: msg('api.comp.badCompany') });
  }
}

/** What a company owes now over all its bills (every branch: the limit is the company's, not a branch's). */
export async function companyOutstanding(q: Q, tenantId: string, companyId: string, exceptInvoice: string | null = null): Promise<number> {
  return Number((await q.query(
    `SELECT coalesce(sum(${COMPANY_DUE()}),0)::bigint AS s FROM invoices i WHERE i.tenant_id = $1 AND i.company_id = $2 AND i.status <> 'void' AND ($3::uuid IS NULL OR i.id <> $3)`,
    [tenantId, companyId, exceptInvoice])).rows[0].s);
}

/**
 * Sets (or removes) the company split of an open bill. The company covers `percent` (default: its coverage percent) of
 * the lines in its coverage categories; the patient pays the rest. Above the company's credit limit only the manager
 * may do it (403 for others); the company row is locked so two splits cannot both pass the check.
 */
export async function setCompanySplit(c: Q, ctx: Ctx, invoiceId: string, input: { company_id: string | null; percent?: number; member_no?: string | null }) {
  const inv = await lockDraftInvoice(c, ctx, invoiceId, 'COMPANY_SPLIT_LOCKED');
  if (!input.company_id) {
    if (!inv.company_id) return { company_share_amount: 0, changed: false };
    await c.query(`UPDATE invoices SET company_id = NULL, company_percent = NULL, company_member_no = NULL, company_set_by_name = NULL, company_share_amount = 0 WHERE id = $1`, [invoiceId]);
    await recalcInvoice(c, invoiceId);
    await audit(c, ctx, 'invoice.company_remove', 'invoice', invoiceId, `Hisob №${inv.invoice_number}: kompaniya ulushi olib tashlandi`, inv.branch_id);
    return { company_share_amount: 0, changed: true };
  }
  if (!isUuid(input.company_id)) throw invalid({ company_id: msg('api.comp.badCompany') });
  const co = (await c.query(`SELECT * FROM companies WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [input.company_id, ctx.tenantId])).rows[0];
  if (!co || !co.active) throw invalid({ company_id: msg('api.comp.badCompany') });
  const percent = input.percent ?? Number(co.coverage_percent);
  if (percent > Number(co.coverage_percent) && ctx.role !== 'manager') throw coded(403, 'COMPANY_PERCENT_OVER', 'api.comp.percentOver', { max: Number(co.coverage_percent) });
  const p = (await c.query(`SELECT company_id, company_member_no FROM patients WHERE id = $1`, [inv.patient_id])).rows[0];
  const memberNo = input.member_no ?? (p?.company_id === co.id ? p.company_member_no : null);
  await c.query(`UPDATE invoices SET company_id = $2, company_percent = $3, company_member_no = $4, company_set_by_name = $5 WHERE id = $1`, [invoiceId, co.id, percent, memberNo, ctx.name]);
  await recalcInvoice(c, invoiceId, { allowOverLimit: true }); // the limit is checked just below (manager may go over)
  const share = Number((await c.query(`SELECT company_share_amount FROM invoices WHERE id = $1`, [invoiceId])).rows[0].company_share_amount);
  if (!share) throw coded(422, 'COMPANY_NO_LINES', 'api.comp.noLines');
  const limit = Number(co.credit_limit);
  const outstanding = await companyOutstanding(c, ctx.tenantId, co.id, invoiceId);
  const overLimit = limit > 0 && outstanding + share > limit;
  if (overLimit && ctx.role !== 'manager') throw coded(403, 'COMPANY_CREDIT_LIMIT', 'api.comp.creditLimit', { limit: som(limit), outstanding: som(outstanding) });
  await audit(c, ctx, 'invoice.company_split', 'invoice', invoiceId,
    `Hisob №${inv.invoice_number}: «${co.name}» ${percent}% — ${som(share)} so‘m${overLimit ? ' (kredit limitidan yuqori, rahbar)' : ''}`, inv.branch_id);
  return { company_share_amount: share, changed: true, over_limit: overLimit, outstanding: outstanding + share, credit_limit: limit };
}

/**
 * Records a company's bank transfer and allocates it to its bills. Each allocation becomes one ordinary payment row on
 * the bill (method 'transfer', no drawer, linked to the company payment), so revenue stays Σ payments − refunds and the
 * fiscal rules of every payment apply. Bills are locked in id order (no deadlock with a concurrent payment).
 */
export async function createCompanyPayment(c: Q, ctx: Ctx, input: { company_id: string; amount: number; document_number: string | null; document_date: string | null; note: string | null;
  allocations: { invoice_id: string; amount: number }[] }, key: string) {
  const co = (await c.query(`SELECT id, name FROM companies WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [input.company_id, ctx.tenantId])).rows[0];
  if (!co) throw notFound('Kompaniya');
  const ids = input.allocations.map((a) => a.invoice_id);
  if (new Set(ids).size !== ids.length) throw invalid({ allocations: msg('api.comp.invoiceTwice') });
  const sum = input.allocations.reduce((a, b) => a + b.amount, 0);
  if (sum !== input.amount) throw invalid({ amount: msg('api.comp.allocationSum', { amount: som(sum) }) });
  const invs = (await c.query(`SELECT * FROM invoices WHERE id = ANY($1::uuid[]) AND tenant_id = $2 ORDER BY id FOR UPDATE`, [ids, ctx.tenantId])).rows;
  const byId = new Map(invs.map((i: any) => [i.id, i]));
  input.allocations.forEach((a, n) => {
    const inv = byId.get(a.invoice_id);
    if (!inv || !ctx.branchIds.includes(inv.branch_id)) throw notFound('Hisob');
    if (inv.company_id !== co.id || inv.status === 'void') throw invalid({ [`allocations.${n}.invoice_id`]: msg('api.comp.notCompanyInvoice', { n: inv.invoice_number }) });
    const due = Number(inv.company_share_amount) - Number(inv.company_paid_amount);
    if (a.amount > due) throw invalid({ [`allocations.${n}.amount`]: msg('api.comp.overDue', { n: inv.invoice_number, amount: som(due) }) });
  });
  const number = (await c.query(`UPDATE tenants SET company_payment_seq = company_payment_seq + 1 WHERE id = $1 RETURNING company_payment_seq`, [ctx.tenantId])).rows[0].company_payment_seq;
  const at = now();
  const cp = (await c.query(
    `INSERT INTO company_payments (tenant_id, company_id, number, amount, method, document_number, document_date, note, received_at, created_by, created_by_name, idempotency_key)
     VALUES ($1,$2,$3,$4,'transfer',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [ctx.tenantId, co.id, number, input.amount, input.document_number, input.document_date, input.note, at, ctx.membershipId || null, ctx.name, key])).rows[0];
  const fiscal: unknown[] = [];
  for (const a of input.allocations) {
    const inv = byId.get(a.invoice_id);
    const receipt = (await c.query(`UPDATE tenants SET receipt_seq = receipt_seq + 1 WHERE id = $1 RETURNING receipt_seq`, [ctx.tenantId])).rows[0].receipt_seq;
    const pay = (await c.query(
      `INSERT INTO payments (id, tenant_id, branch_id, invoice_id, receipt_number, amount, method, cashier_membership_id, cashier_name, paid_at, note, idempotency_key, request_hash, shift_id, company_payment_id)
       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,'transfer',$6,$7,$8,$9,$10,NULL,NULL,$11) RETURNING id`,
      [ctx.tenantId, inv.branch_id, inv.id, receipt, a.amount, ctx.membershipId || null, ctx.name, at, `Kompaniya to‘lovi №${number}`, `${key}:${inv.id}`, cp.id])).rows[0];
    await c.query(`INSERT INTO company_payment_allocations (tenant_id, company_payment_id, invoice_id, payment_id, amount) VALUES ($1,$2,$3,$4,$5)`, [ctx.tenantId, cp.id, inv.id, pay.id, a.amount]);
    const paid = Number(inv.paid_amount) + a.amount;
    await c.query(`UPDATE invoices SET paid_amount = $2, company_paid_amount = company_paid_amount + $3, status = $4, version = version + 1, updated_at = demo_now() WHERE id = $1`,
      [inv.id, paid, a.amount, invoiceStatus({ status: inv.status, total: Number(inv.total), paid, credit: Number(inv.credit_amount), hasItems: true })]);
    // the same fiscal rule as every payment (a bank transfer: method 'transfer'); a provider error never undoes it
    fiscal.push(await recordFiscal(c, { tenantId: ctx.tenantId, branchId: inv.branch_id, kind: 'sale', paymentId: pay.id, invoiceId: inv.id, amount: a.amount, method: 'transfer' }));
  }
  await audit(c, ctx, 'company_payment.create', 'company_payment', cp.id, `«${co.name}» to‘lovi №${number}: ${som(input.amount)} so‘m, ${input.allocations.length} ta hisob`);
  return { payment: cp, fiscal };
}

/**
 * Voids a company payment once, with a reason (manager). Its payment rows are append-only, so each is reversed by a
 * refund row (reason 'company_payment_void', no drawer) on the void day: revenue goes down then (cash basis), the bill's
 * paid amount goes down and the company owes that part again. The bill's total is not reduced (credit_amount stays).
 */
export async function voidCompanyPayment(c: Q, ctx: Ctx, id: string, reason: string) {
  if (!isUuid(id)) throw notFound('Kompaniya to‘lovi');
  const cp = (await c.query(`SELECT cp.*, co.name AS company_name FROM company_payments cp JOIN companies co ON co.id = cp.company_id WHERE cp.id = $1 AND cp.tenant_id = $2 FOR UPDATE OF cp`, [id, ctx.tenantId])).rows[0];
  if (!cp) throw notFound('Kompaniya to‘lovi');
  if (cp.status === 'void') throw coded(409, 'ALREADY_VOID', 'api.comp.alreadyVoid');
  const allocs = (await c.query(`SELECT a.* FROM company_payment_allocations a WHERE a.company_payment_id = $1 ORDER BY a.invoice_id`, [id])).rows;
  const invs = (await c.query(`SELECT * FROM invoices WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [allocs.map((a: any) => a.invoice_id)])).rows;
  const byId = new Map(invs.map((i: any) => [i.id, i]));
  if (invs.some((i: any) => !ctx.branchIds.includes(i.branch_id))) throw forbidden('Bu filial ma’lumotlariga ruxsat yo‘q');
  const at = now();
  for (const a of allocs) {
    const inv = byId.get(a.invoice_id);
    const number = (await c.query(`UPDATE tenants SET refund_seq = refund_seq + 1 WHERE id = $1 RETURNING refund_seq`, [ctx.tenantId])).rows[0].refund_seq;
    const refund = (await c.query(
      `INSERT INTO refunds (tenant_id, branch_id, invoice_id, payment_id, refund_number, amount, method, reason_code, reason, shift_id, approved_by, approved_by_name, refunded_at, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,'transfer','company_payment_void',$7,NULL,$8,$9,$10,$11) RETURNING id`,
      [ctx.tenantId, inv.branch_id, inv.id, a.payment_id, number, Number(a.amount), reason, ctx.membershipId || null, ctx.name, at, `cpv:${a.id}`])).rows[0];
    const paid = Number(inv.paid_amount) - Number(a.amount);
    inv.paid_amount = paid; inv.company_paid_amount = Number(inv.company_paid_amount) - Number(a.amount);
    await c.query(`UPDATE invoices SET paid_amount = $2, company_paid_amount = $3, status = $4, version = version + 1, updated_at = demo_now() WHERE id = $1`,
      [inv.id, paid, inv.company_paid_amount, invoiceStatus({ status: inv.status, total: Number(inv.total), paid, credit: Number(inv.credit_amount), hasItems: true })]);
    await recordFiscal(c, { tenantId: ctx.tenantId, branchId: inv.branch_id, kind: 'refund', refundId: refund.id, invoiceId: inv.id, amount: Number(a.amount), method: 'transfer' });
  }
  await c.query(`UPDATE company_payments SET status = 'void', void_reason = $2, voided_at = $3, voided_by_name = $4 WHERE id = $1`, [id, reason, at, ctx.name]);
  // the reason stays on the record; the audit names the payment and the amount only
  await audit(c, ctx, 'company_payment.void', 'company_payment', id, `«${cp.company_name}» to‘lovi №${cp.number} bekor qilindi: ${som(Number(cp.amount))} so‘m`);
  return { ok: true };
}
