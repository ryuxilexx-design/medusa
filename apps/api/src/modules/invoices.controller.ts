import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { createHash } from 'crypto';
import { discountSchema, paymentSchema, promiseSchema, voidSchema, PAYMENT_METHOD_LABEL } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, conflict, invalid, mirroredRecord, notFound } from '../core/errors';
import { isDate, isUuid, pageParams, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, localDate, now, today } from '../core/clock';
import { branchScope } from '../core/scope';
import { csvDate, csvPeriod, csvSom, csvTime, sendCsv } from '../core/csv';
import { COMPANY_DUE, invoiceStatus, PATIENT_DUE, recalcInvoice } from './billing';
import { applyDeposit } from './deposits';
import { effectiveVat, FISCAL_COLS, recordFiscal } from '../fiscal/provider';

/** Fiscal receipt of a payment (alias `pm`) as JSON, NULL when none (legacy rows, before fiscalisation). */
export const FISCAL_JSON = `(SELECT json_build_object('id', f.id, 'status', f.status, 'provider', f.provider, 'receipt_number', f.receipt_number, 'fiscal_sign', f.fiscal_sign, 'qr_url', f.qr_url, 'terminal_id', f.terminal_id, 'issued_at', f.issued_at, 'entered_by_name', f.entered_by_name, 'error', f.error) FROM fiscal_receipts f WHERE f.payment_id = pm.id)`;
/** The same for a refund (alias `r`). */
export const FISCAL_JSON_REFUND = FISCAL_JSON.replace('f.payment_id = pm.id', 'f.refund_id = r.id');
/** SQL: a payment whose fiscal receipt is still owed (manual or automatic provider, not yet issued). */
export const FISCAL_MISSING = `EXISTS (SELECT 1 FROM fiscal_receipts f WHERE f.payment_id = pm.id AND f.status IN ('pending','failed'))`;

/** A shift opened before today's local day start (left open overnight) must be closed before it takes money. */
export const shiftIsStale = (openedAt: Date | string) => new Date(openedAt) < dayStart(today());

const som = (t: number) => (t / 100).toLocaleString('ru-RU').replace(/ /g, ' ');

/** Services of an invoice in one line: «Umumiy qon tahlili, Fizioterapiya × 10». */
export const SERVICES_SQL = `(SELECT string_agg(it.description || CASE WHEN it.quantity > 1 THEN ' × ' || it.quantity ELSE '' END, ', ' ORDER BY it.position) FROM invoice_items it WHERE it.invoice_id = i.id)`;
/** Debt age in whole days since the invoice was created (demo clock). */
const AGE_DAYS = `floor(EXTRACT(EPOCH FROM ((SELECT demo_now()) - i.created_at)) / 86400)`;
export const AGE_BUCKETS: Record<string, string> = { '0-7': `${AGE_DAYS} <= 7`, '8-30': `${AGE_DAYS} BETWEEN 8 AND 30`, '31+': `${AGE_DAYS} >= 31` };

async function lockInvoice(q: Q, ctx: Ctx, id: string) {
  if (!isUuid(id)) throw notFound('Hisob');
  const inv = (await q.query(`SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
  if (!inv || !ctx.branchIds.includes(inv.branch_id)) throw notFound('Hisob');
  // a MedPlus invoice is a mirror: its payments, discounts and refunds happen in MedPlus (docs/MEDPLUS_SYNC.md)
  if (inv.external_source_id) throw mirroredRecord();
  return inv;
}

@Controller('invoices')
export class InvoicesController {
  constructor(private db: Db) {}

  @Roles('manager', 'cashier', 'registrar') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { page, pageSize, offset } = pageParams(q);
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id)];
    const where = ['i.tenant_id = $1', 'i.branch_id = ANY($2)'];
    if (isDate(q.from)) { params.push(dayStart(q.from)); where.push(`i.created_at >= $${params.length}`); }
    if (isDate(q.to)) { params.push(dayStart(addDays(q.to, 1))); where.push(`i.created_at < $${params.length}`); }
    if (q.status) { params.push(String(q.status).split(',')); where.push(`i.status = ANY($${params.length})`); }
    const debt = q.debt === '1';
    // debtors: the patient's own debt; `payer=company` lists the companies' receivables instead (never mixed)
    const company = debt && q.payer === 'company';
    const DUE = company ? COMPANY_DUE() : PATIENT_DUE();
    if (debt) where.push(company ? `i.status <> 'void' AND ${DUE} > 0` : `i.status IN ('unpaid','partially_paid') AND ${DUE} > 0`);
    if (isUuid(q.company_id)) { params.push(q.company_id); where.push(`i.company_id = $${params.length}`); }
    if (debt && AGE_BUCKETS[q.age]) where.push(AGE_BUCKETS[q.age]);
    if (isUuid(q.patient_id)) { params.push(q.patient_id); where.push(`i.patient_id = $${params.length}`); }
    if (q.search) {
      const s = String(q.search).trim().toLowerCase();
      params.push(`%${s}%`);
      where.push(`(lower(p.last_name || ' ' || p.first_name) LIKE $${params.length} OR i.invoice_number::text LIKE $${params.length} OR p.patient_number::text LIKE $${params.length})`);
    }
    const base = `FROM invoices i JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = i.branch_id WHERE ${where.join(' AND ')}`;
    const agg = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(i.total) FILTER (WHERE i.status <> 'void'),0)::bigint AS total,
        coalesce(sum(i.paid_amount),0)::bigint AS paid, coalesce(sum(${DUE}) FILTER (WHERE i.status <> 'void'),0)::bigint AS due ${base}`, params))!;
    // debtors: how old the debts are (days since the invoice), for the collections card
    const ageing = debt ? await this.ageing(base, params, DUE) : undefined;
    params.push(pageSize, offset);
    const rows = await this.db.rows(
      `SELECT i.id, i.invoice_number, i.status, i.subtotal, i.discount_amount, i.total, i.paid_amount, ${DUE} AS due, ${COMPANY_DUE()} AS company_due, i.company_share_amount, i.created_at, i.branch_id, b.name AS branch_name,
              p.id AS patient_id, p.patient_number, p.last_name, p.first_name, p.phone, i.promise_date, i.promise_note, ${AGE_DAYS}::int AS age_days,
              ${SERVICES_SQL} AS services, (SELECT c.name FROM companies c WHERE c.id = i.company_id) AS company_name
         ${base} ORDER BY CASE WHEN i.status IN ('unpaid','partially_paid') THEN 0 ELSE 1 END, i.created_at ${debt ? 'ASC' : 'DESC'} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { data: rows, meta: { page, page_size: pageSize, total: agg.n, sums: { total: Number(agg.total), paid: Number(agg.paid), due: Number(agg.due) }, ...(ageing ? { ageing } : {}) } };
  }

  private async ageing(base: string, params: unknown[], due: string) {
    const a = (await this.db.one(
      `SELECT count(*) FILTER (WHERE ${AGE_BUCKETS['0-7']})::int AS n1, coalesce(sum(${due}) FILTER (WHERE ${AGE_BUCKETS['0-7']}),0)::bigint AS s1,
              count(*) FILTER (WHERE ${AGE_BUCKETS['8-30']})::int AS n2, coalesce(sum(${due}) FILTER (WHERE ${AGE_BUCKETS['8-30']}),0)::bigint AS s2,
              count(*) FILTER (WHERE ${AGE_BUCKETS['31+']})::int AS n3, coalesce(sum(${due}) FILTER (WHERE ${AGE_BUCKETS['31+']}),0)::bigint AS s3 ${base}`, params))!;
    return { '0-7': { n: a.n1, sum: Number(a.s1) }, '8-30': { n: a.n2, sum: Number(a.s2) }, '31+': { n: a.n3, sum: Number(a.s3) } };
  }

  /** Debtors list as CSV (a snapshot, so no period; at most 10 000 rows, oldest debt first; a totals row at the end). */
  @Roles('manager', 'cashier') @Get(['debtors.csv', 'debtors.xlsx'])
  async debtorsCsv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id)];
    const where = [`i.tenant_id = $1`, `i.branch_id = ANY($2)`, `i.status IN ('unpaid','partially_paid')`, `${PATIENT_DUE()} > 0`]; // the patient's own debt (a company's part is its receivable)
    if (AGE_BUCKETS[q.age]) where.push(AGE_BUCKETS[q.age]);
    const rows = await this.db.rows(
      `SELECT i.invoice_number, i.created_at, ${AGE_DAYS}::int AS age_days, b.name AS branch, p.patient_number, p.last_name || ' ' || p.first_name AS patient, p.phone,
              ${SERVICES_SQL} AS services, i.total, i.paid_amount, ${PATIENT_DUE()} AS due, i.promise_date, i.promise_note
         FROM invoices i JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = i.branch_id WHERE ${where.join(' AND ')} ORDER BY i.created_at LIMIT 10000`, params);
    const total = rows.reduce((a, r) => a + BigInt(r.due), 0n);
    sendCsv(res, `meduzai-qarzdorlar-${today()}.csv`,
      ['Hisob №', 'Sana (Toshkent)', 'Kun', 'Filial', 'Bemor ID', 'Bemor', 'Telefon', 'Xizmatlar', 'Jami (so‘m)', 'To‘langan (so‘m)', 'Qarz (so‘m)', 'Va’da sanasi', 'Izoh'],
      [...rows.map((r) => [r.invoice_number, csvTime(r.created_at), r.age_days, r.branch, r.patient_number, r.patient, r.phone, r.services, csvSom(r.total), csvSom(r.paid_amount), csvSom(r.due), csvDate(r.promise_date), r.promise_note]),
        ['Jami', '', '', '', '', `${rows.length} ta hisob`, '', '', '', '', csvSom(total), '', '']]);
  }

  @Roles('manager', 'cashier', 'registrar') @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Hisob');
    const inv = await this.db.one(
      `SELECT i.*, ${PATIENT_DUE()} AS due, ${COMPANY_DUE()} AS company_due, (i.total - i.paid_amount) AS total_due, b.name AS branch_name, p.patient_number, p.last_name, p.first_name, p.middle_name, p.birth_date, p.phone,
              a.starts_at AS appointment_at, a.status AS appointment_status, d.display_name AS doctor_name,
              rp.full_name AS referral_partner_name, -- the name only: percents and amounts are the manager's (docs/REFERRALS.md)
              co.name AS company_name, co.kind AS company_kind, bcd.name AS discount_benefit_category_name,
              -- the patient's payer data, for the defaults of the discount picker and the company split
              p.benefit_category_id AS patient_benefit_category_id, bc.name AS patient_benefit_category_name, bc.discount_rule_id AS patient_benefit_rule_id, p.benefit_note AS patient_benefit_note,
              p.company_id AS patient_company_id, pc.name AS patient_company_name, pc.discount_rule_id AS patient_company_rule_id, p.company_member_no AS patient_company_member_no
         FROM invoices i JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = i.branch_id
         LEFT JOIN companies co ON co.id = i.company_id LEFT JOIN benefit_categories bcd ON bcd.id = i.discount_benefit_category_id
         LEFT JOIN benefit_categories bc ON bc.id = p.benefit_category_id LEFT JOIN companies pc ON pc.id = p.company_id
         LEFT JOIN appointments a ON a.id = i.appointment_id LEFT JOIN doctors d ON d.id = a.doctor_id
         LEFT JOIN referral_partners rp ON rp.id = a.referral_partner_id
        WHERE i.id = $1 AND i.tenant_id = $2 AND i.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!inv) throw notFound('Hisob');
    const items = await this.db.rows(
      `SELECT it.id, it.order_id, it.description, it.quantity, it.unit_price, it.line_subtotal, it.discount_share, it.line_total, it.refunded_amount,
              (it.line_total - it.refunded_amount) AS refundable, o.category, o.status AS order_status, o.ordered_at
         FROM invoice_items it JOIN service_orders o ON o.id = it.order_id WHERE it.invoice_id = $1 ORDER BY it.position`, [id]);
    // the patient's prepayment that could cover this invoice (a cashier offers «Depozitdan» only when it is above 0)
    const dep = await this.db.one(`SELECT coalesce(sum(CASE WHEN kind = 'in' THEN amount ELSE -amount END),0)::bigint AS balance FROM patient_deposits WHERE patient_id = $1 AND tenant_id = $2`, [inv.patient_id, ctx.tenantId]);
    (inv as any).deposit_balance = Number(dep?.balance ?? 0);
    const payments = await this.db.rows(
      `SELECT pm.id, pm.receipt_number, pm.amount, pm.method, pm.cashier_name, pm.cashier_membership_id, pm.paid_at, pm.note, ${FISCAL_JSON} AS fiscal, pm.external_source_id IS NOT NULL AS mirrored,
              (pm.amount - coalesce((SELECT sum(r.amount) FROM refunds r WHERE r.payment_id = pm.id), 0))::bigint AS refundable,
              pm.company_payment_id, (SELECT cp.number FROM company_payments cp WHERE cp.id = pm.company_payment_id) AS company_payment_number
         FROM payments pm WHERE pm.invoice_id = $1 ORDER BY pm.paid_at`, [id]);
    const refunds = await this.db.rows(
      `SELECT r.id, r.refund_number, r.payment_id, r.amount, r.method, r.reason_code, r.reason, r.approved_by_name, r.refunded_at, r.order_id, o.service_name, ${FISCAL_JSON_REFUND} AS fiscal
         FROM refunds r LEFT JOIN service_orders o ON o.id = r.order_id WHERE r.invoice_id = $1 ORDER BY r.refunded_at`, [id]);
    // a company's payment is corrected by voiding it (Kompaniyalar), never by a refund to the patient
    return { data: { ...inv, items, payments: payments.map((p) => ({ ...p, refundable: p.company_payment_id ? 0 : Math.min(Number(p.refundable), Number(inv.paid_amount)) })), refunds } };
  }

  /** Discount: manager only, mandatory reason, percent or fixed amount, only before any payment. */
  @Roles('manager') @Post(':id/discount') @HttpCode(200)
  async discount(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(discountSchema, body);
    return this.db.tx(async (c) => {
      const inv = await lockInvoice(c, ctx, id);
      if (inv.status !== 'unpaid' || Number(inv.paid_amount) > 0 || Number(inv.credit_amount) > 0 || (await c.query(`SELECT 1 FROM payments WHERE invoice_id = $1 LIMIT 1`, [id])).rowCount) throw conflict('INVOICE_LOCKED', 'To‘lov yoki qaytarish bo‘lgan, yoxud bekor qilingan hisobga chegirma qo‘llanmaydi');
      const value = input.type === 'amount' ? Math.round(input.value) : input.value; // amount in tiyin
      if (input.type === 'amount' && value > Number(inv.subtotal)) throw invalid({ value: 'Chegirma hisob summasidan oshmasligi kerak' });
      // the manager's invoice-level discount replaces a rule applied before (one discount per bill)
      await c.query(`UPDATE invoices SET discount_type = $2, discount_value = $3, discount_reason = $4, discount_approved_by_name = $5, discount_rule_id = NULL, discount_rule_name = NULL,
          discount_kind = NULL, discount_rule_value = NULL, discount_scope = NULL, discount_source = 'manual', discount_benefit_category_id = NULL, discount_granted_by = $6,
          discount_granted_by_name = $5, discount_granted_at = demo_now(), discount_over_limit = false WHERE id = $1`, [id, input.type, value, input.reason, ctx.name, ctx.membershipId || null]);
      await recalcInvoice(c, id);
      const after = (await c.query(`SELECT discount_amount, total FROM invoices WHERE id = $1`, [id])).rows[0];
      // the reason stays on the bill; the audit keeps the amount only (no free text)
      await audit(c, ctx, 'invoice.discount', 'invoice', id, `Chegirma ${input.type === 'percent' ? input.value + '%' : som(value) + ' so‘m'} (${som(Number(after.discount_amount))} so‘m)`, inv.branch_id);
      return { data: { ok: true, ...after } };
    });
  }

  /** Debtor's promise: the date the patient said they will pay and a note. Only on an invoice that still has a balance due. */
  @Roles('manager', 'cashier') @Post(':id/promise') @HttpCode(200)
  async promise(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(promiseSchema, body);
    if (input.promise_date && input.promise_date < today()) throw invalid({ promise_date: 'Va’da sanasi o‘tgan kun bo‘lmasin' });
    return this.db.tx(async (c) => {
      const inv = await lockInvoice(c, ctx, id);
      if (!['unpaid', 'partially_paid'].includes(inv.status) || Number(inv.total) <= Number(inv.paid_amount)) throw conflict('NOT_A_DEBT', 'Bu hisobda qarz yo‘q');
      await c.query(`UPDATE invoices SET promise_date = $2, promise_note = $3, updated_at = demo_now() WHERE id = $1`, [id, input.promise_date, input.note ?? null]);
      await audit(c, ctx, 'invoice.promise', 'invoice', id, input.promise_date ? `Va’da: ${input.promise_date}${input.note ? ` — ${input.note}` : ''}` : 'Va’da olib tashlandi', inv.branch_id);
      return { data: { ok: true, promise_date: input.promise_date, promise_note: input.note ?? null } };
    });
  }

  /**
   * Records a payment. Idempotency-Key is mandatory: a retry with the same key returns the original payment.
   * The invoice row is locked, so concurrent payments can never exceed the remaining balance.
   * A cashier or the manager: whoever takes the money needs their own open shift in the invoice's branch.
   * Method 'deposit' uses the patient's prepayment instead: no cash moves, no shift; the balance is locked and reduced.
   */
  @Roles('cashier', 'manager') @Post(':id/payments')
  async pay(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    if (!key || key.length < 8 || key.length > 100) throw new AppError(422, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key sarlavhasi majburiy');
    const input = parse(paymentSchema, body);
    const hash = createHash('sha256').update(`${id}|${input.amount}|${input.method}`).digest('hex');
    return this.db.tx(async (c) => {
      const inv = await lockInvoice(c, ctx, id);
      const prev = (await c.query(`SELECT * FROM payments WHERE tenant_id = $1 AND idempotency_key = $2`, [ctx.tenantId, key])).rows[0];
      if (prev) {
        if (prev.request_hash !== hash) throw new AppError(422, 'IDEMPOTENCY_MISMATCH', 'Bu kalit boshqa to‘lov uchun ishlatilgan');
        res.status(200);
        return { data: { payment: prev, invoice: await this.invoiceState(c, id), fiscal: await this.fiscalOf(c, prev.id), replayed: true } };
      }
      if (inv.status === 'void') throw conflict('INVOICE_VOID', 'Bekor qilingan hisobga to‘lov qabul qilinmaydi');
      // the patient pays only their part: a company's share is collected from the company (company payments)
      const due = Number(inv.total) - Number(inv.company_share_amount) - (Number(inv.paid_amount) - Number(inv.company_paid_amount));
      if (due <= 0) throw conflict('INVOICE_PAID', 'Hisob to‘liq to‘langan');
      if (input.amount > due) throw invalid({ amount: `Summa qoldiqdan (${som(due)} so‘m) oshmasligi kerak` });
      let shiftId: string | null = null;
      if (input.method === 'deposit') {
        // the prepayment covers it: lock the patient (the ledger's serialization point) and check the balance
        await applyDeposit(c, ctx, inv.patient_id, input.amount);
      } else {
        // money is taken only in an open shift of this branch (FOR SHARE: a concurrent close waits for this payment)
        const shift = (await c.query(`SELECT id, branch_id, opened_at FROM cash_shifts WHERE tenant_id = $1 AND cashier_membership_id = $2 AND status = 'open' FOR SHARE`, [ctx.tenantId, ctx.membershipId])).rows[0];
        if (!shift) throw conflict('SHIFT_REQUIRED', 'To‘lov qabul qilish uchun avval kassa smenasini oching');
        if (shift.branch_id !== inv.branch_id) throw conflict('SHIFT_OTHER_BRANCH', 'Smenangiz boshqa filialda ochilgan. Shu filial hisobiga to‘lov olish uchun smenani yopib, shu filialda oching.');
        // a shift left open overnight: money of a new day never lands in yesterday's Z-report — close it first
        if (shiftIsStale(shift.opened_at)) throw conflict('SHIFT_STALE', `Smena ${localDate(shift.opened_at)} kuni ochilgan. Avval uni yoping, keyin bugungi smenani oching.`, { opened_at: shift.opened_at });
        shiftId = shift.id;
      }
      const receipt = (await c.query(`UPDATE tenants SET receipt_seq = receipt_seq + 1 WHERE id = $1 RETURNING receipt_seq`, [ctx.tenantId])).rows[0].receipt_seq;
      const payment = (await c.query(
        `INSERT INTO payments (id, tenant_id, branch_id, invoice_id, receipt_number, amount, method, cashier_membership_id, cashier_name, paid_at, note, idempotency_key, request_hash, shift_id)
         VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [ctx.tenantId, inv.branch_id, id, receipt, input.amount, input.method, ctx.membershipId, ctx.name, now(), input.note, key, hash, shiftId])).rows[0];
      if (input.method === 'deposit')
        await c.query(`INSERT INTO patient_deposits (tenant_id, branch_id, patient_id, kind, amount, invoice_id, payment_id, actor_membership_id, actor_name, occurred_at)
                       VALUES ($1,$2,$3,'apply',$4,$5,$6,$7,$8,$9)`, [ctx.tenantId, inv.branch_id, inv.patient_id, input.amount, id, payment.id, ctx.membershipId || null, ctx.name, now()]);
      const paid = Number(inv.paid_amount) + input.amount;
      await c.query(`UPDATE invoices SET paid_amount = $2, status = $3, version = version + 1, updated_at = demo_now() WHERE id = $1`,
        [id, paid, invoiceStatus({ status: inv.status, total: Number(inv.total), paid, credit: Number(inv.credit_amount), hasItems: true })]);
      await audit(c, ctx, 'payment.create', 'invoice', id, `To‘lov: ${som(input.amount)} so‘m (${PAYMENT_METHOD_LABEL[input.method]}), qayd №${receipt}`, inv.branch_id);
      // fiscal receipt (ОФД): manual = the cashier enters the KKM number next; none = skipped; a provider error never undoes the sale
      // a sale covered from the patient's deposit still gets its sale receipt; the money itself arrived earlier (non-cash for the KKM: 'transfer')
      const fiscal = await recordFiscal(c, { tenantId: ctx.tenantId, branchId: inv.branch_id, kind: 'sale', paymentId: payment.id, invoiceId: id, amount: input.amount, method: input.method === 'deposit' ? 'transfer' : input.method });
      res.status(201);
      return { data: { payment, invoice: await this.invoiceState(c, id), fiscal, replayed: false } };
    });
  }

  private async fiscalOf(c: Q, paymentId: string) {
    return (await c.query(`SELECT ${FISCAL_COLS} FROM fiscal_receipts f WHERE f.payment_id = $1`, [paymentId])).rows[0] ?? null;
  }

  private async invoiceState(c: Q, id: string) {
    return (await c.query(`SELECT i.id, i.status, i.total, i.paid_amount, ${PATIENT_DUE()} AS due, ${COMPANY_DUE()} AS company_due FROM invoices i WHERE i.id = $1`, [id])).rows[0];
  }

  @Roles('manager', 'cashier') @Post(':id/void') @HttpCode(200)
  async void(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(voidSchema, body);
    return this.db.tx(async (c) => {
      const inv = await lockInvoice(c, ctx, id);
      if (inv.status === 'void') return { data: { ok: true, already: true } };
      if (Number(inv.paid_amount) > 0 || (await c.query(`SELECT 1 FROM payments WHERE invoice_id = $1 LIMIT 1`, [id])).rowCount)
        throw conflict('INVOICE_HAS_PAYMENTS', 'To‘lov qayd etilgan hisobni bekor qilib bo‘lmaydi');
      await c.query(`UPDATE invoices SET status = 'void', void_reason = $2, version = version + 1, updated_at = demo_now() WHERE id = $1`, [id, reason]);
      await audit(c, ctx, 'invoice.void', 'invoice', id, `Hisob bekor qilindi: ${reason}`, inv.branch_id);
      return { data: { ok: true } };
    });
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private db: Db) {}

  private filters(ctx: Ctx, q: any) {
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id)];
    const where = ['pm.tenant_id = $1', 'pm.branch_id = ANY($2)'];
    if (isDate(q.from)) { params.push(dayStart(q.from)); where.push(`pm.paid_at >= $${params.length}`); }
    if (isDate(q.to)) { params.push(dayStart(addDays(q.to, 1))); where.push(`pm.paid_at < $${params.length}`); }
    if (q.method) { params.push(String(q.method)); where.push(`pm.method = $${params.length}`); }
    if (ctx.role === 'cashier') { params.push(ctx.membershipId); where.push(`pm.cashier_membership_id = $${params.length}`); }
    if (q.fiscal === 'missing') where.push(FISCAL_MISSING); // «chek kiritilmagan to‘lovlar»
    return { params, where: where.join(' AND ') };
  }

  @Roles('manager', 'cashier') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const { page, pageSize, offset } = pageParams(q);
    const { params, where } = this.filters(ctx, q);
    const agg = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(pm.amount),0)::bigint AS sum FROM payments pm WHERE ${where}`, params))!;
    const byMethod = await this.db.rows(`SELECT pm.method, count(*)::int AS n, sum(pm.amount)::bigint AS sum FROM payments pm WHERE ${where} GROUP BY 1 ORDER BY 1`, params);
    params.push(pageSize, offset);
    const rows = await this.db.rows(
      `SELECT pm.id, pm.receipt_number, pm.amount, pm.method, pm.cashier_name, pm.cashier_membership_id, pm.paid_at, pm.note, pm.invoice_id, i.invoice_number, b.name AS branch_name, pm.external_source_id IS NOT NULL AS mirrored,
              p.id AS patient_id, p.patient_number, p.last_name, p.first_name, ${FISCAL_JSON} AS fiscal
         FROM payments pm JOIN invoices i ON i.id = pm.invoice_id JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = pm.branch_id
        WHERE ${where} ORDER BY pm.paid_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    const missing = q.fiscal === 'missing' ? agg.n : (await this.db.one(`SELECT count(*)::int AS n FROM payments pm WHERE ${where} AND ${FISCAL_MISSING}`, params.slice(0, params.length - 2)))!.n;
    return { data: rows, meta: { page, page_size: pageSize, total: agg.n, sum: Number(agg.sum), by_method: byMethod, fiscal_missing: missing } };
  }

  /** CSV export of the filtered register. Cells starting with = + - @ are neutralised against formula injection. */
  @Roles('manager', 'cashier') @Get(['export.csv', 'export.xlsx'])
  async csv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    // a bounded period: one export is built in memory, so «all time» would stall the server for everyone
    const period = csvPeriod(q);
    const { params, where } = this.filters(ctx, q);
    const rows = await this.db.rows(
      `SELECT pm.receipt_number, pm.paid_at, b.name AS branch, p.patient_number, p.last_name || ' ' || p.first_name AS patient, i.invoice_number, pm.method, pm.amount, pm.cashier_name, pm.note, pm.external_source_id,
              (SELECT json_agg(json_build_object('ikpu', s.ikpu_code, 'vat_percent', s.vat_percent, 'vat_exempt', s.vat_exempt) ORDER BY it.position)
                 FROM invoice_items it LEFT JOIN services s ON s.id = it.service_id WHERE it.invoice_id = i.id) AS lines,
              ${FISCAL_JSON} AS fiscal
         FROM payments pm JOIN invoices i ON i.id = pm.invoice_id JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = pm.branch_id
        WHERE ${where} ORDER BY pm.paid_at`, params);
    // one cell per invoice: distinct IKPU codes and VAT rates of its lines («—» = not set, «QQSsiz» = exempt)
    const uniq = (xs: string[]) => [...new Set(xs)].join(', ');
    const ikpu = (ls: any[] | null) => uniq((ls ?? []).map((l) => l.ikpu || '—'));
    const vat = (ls: any[] | null) => uniq((ls ?? []).map((l) => { const v = effectiveVat({ vat_percent: l.vat_percent, vat_exempt: !!l.vat_exempt }); return v == null ? 'QQSsiz' : `${v}%`; }));
    const FISCAL_LABEL: Record<string, string> = { pending: 'kiritilmagan', issued: 'kiritilgan', failed: 'xato', skipped: 'talab qilinmaydi' };
    sendCsv(res, `meduzai-tolovlar-${period.from}-${period.to}.csv`,
      ['Qayd №', 'Sana (Toshkent)', 'Filial', 'Bemor ID', 'Bemor', 'Hisob №', 'Usul', 'Summa (so‘m)', 'Kassir', 'Izoh', 'IKPU', 'QQS', 'Fiskal chek №', 'Fiskal holati', 'Fiskal belgi', 'Terminal'],
      [...rows.map((r) => [r.receipt_number, csvTime(r.paid_at), r.branch, r.patient_number, r.patient, r.invoice_number, PAYMENT_METHOD_LABEL[r.method], csvSom(r.amount), r.cashier_name, r.note,
        ikpu(r.lines), vat(r.lines), r.fiscal?.receipt_number, r.fiscal ? FISCAL_LABEL[r.fiscal.status] ?? r.fiscal.status : r.external_source_id ? 'MedPlus' : '', r.fiscal?.fiscal_sign, r.fiscal?.terminal_id]),
        ['Jami', '', '', '', `${rows.length} ta to‘lov`, '', '', csvSom(rows.reduce((a, r) => a + BigInt(r.amount), 0n)), '', '', '', '', '', '', '', '']]);
  }

  @Roles('manager', 'cashier') @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('To‘lov');
    const p = await this.db.one(
      `SELECT pm.*, i.invoice_number, i.total, i.paid_amount, ${PATIENT_DUE()} AS due, i.company_share_amount, i.status AS invoice_status, b.name AS branch_name, t.name AS clinic_name,
              p.patient_number, p.last_name, p.first_name, p.middle_name, p.birth_date,
              (SELECT json_agg(json_build_object('description', it.description, 'quantity', it.quantity, 'line_total', it.line_total, 'ikpu_code', s.ikpu_code, 'vat_percent', s.vat_percent, 'vat_exempt', s.vat_exempt) ORDER BY it.position)
                 FROM invoice_items it LEFT JOIN services s ON s.id = it.service_id WHERE it.invoice_id = i.id) AS items,
              ${FISCAL_JSON} AS fiscal
         FROM payments pm JOIN invoices i ON i.id = pm.invoice_id JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = pm.branch_id JOIN tenants t ON t.id = pm.tenant_id
        WHERE pm.id = $1 AND pm.tenant_id = $2 AND pm.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!p) throw notFound('To‘lov');
    return { data: p };
  }
}
