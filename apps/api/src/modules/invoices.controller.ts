import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { createHash } from 'crypto';
import { discountSchema, paymentSchema, voidSchema, PAYMENT_METHOD_LABEL } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, conflict, invalid, notFound } from '../core/errors';
import { isDate, isUuid, pageParams, parse } from '../core/validate';
import { audit } from '../core/audit';
import { addDays, dayStart, localDate, now, today, TZ_OFFSET_MS } from '../core/clock';
import { branchScope } from '../core/scope';
import { invoiceStatus, recalcInvoice } from './billing';

/** A shift opened before today's local day start (left open overnight) must be closed before it takes money. */
export const shiftIsStale = (openedAt: Date | string) => new Date(openedAt) < dayStart(today());

const som = (t: number) => (t / 100).toLocaleString('ru-RU').replace(/ /g, ' ');

async function lockInvoice(q: Q, ctx: Ctx, id: string) {
  if (!isUuid(id)) throw notFound('Hisob');
  const inv = (await q.query(`SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
  if (!inv || !ctx.branchIds.includes(inv.branch_id)) throw notFound('Hisob');
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
    if (q.debt === '1') where.push(`i.status IN ('unpaid','partially_paid') AND i.total > i.paid_amount`);
    if (isUuid(q.patient_id)) { params.push(q.patient_id); where.push(`i.patient_id = $${params.length}`); }
    if (q.search) {
      const s = String(q.search).trim().toLowerCase();
      params.push(`%${s}%`);
      where.push(`(lower(p.last_name || ' ' || p.first_name) LIKE $${params.length} OR i.invoice_number::text LIKE $${params.length} OR p.patient_number::text LIKE $${params.length})`);
    }
    const base = `FROM invoices i JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = i.branch_id WHERE ${where.join(' AND ')}`;
    const agg = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(i.total) FILTER (WHERE i.status <> 'void'),0)::bigint AS total,
        coalesce(sum(i.paid_amount),0)::bigint AS paid, coalesce(sum(i.total - i.paid_amount) FILTER (WHERE i.status <> 'void'),0)::bigint AS due ${base}`, params))!;
    params.push(pageSize, offset);
    const rows = await this.db.rows(
      `SELECT i.id, i.invoice_number, i.status, i.subtotal, i.discount_amount, i.total, i.paid_amount, (i.total - i.paid_amount) AS due, i.created_at, i.branch_id, b.name AS branch_name,
              p.id AS patient_id, p.patient_number, p.last_name, p.first_name,
              (SELECT string_agg(it.description, ', ' ORDER BY it.position) FROM invoice_items it WHERE it.invoice_id = i.id) AS services
         ${base} ORDER BY CASE WHEN i.status IN ('unpaid','partially_paid') THEN 0 ELSE 1 END, i.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { data: rows, meta: { page, page_size: pageSize, total: agg.n, sums: { total: Number(agg.total), paid: Number(agg.paid), due: Number(agg.due) } } };
  }

  @Roles('manager', 'cashier', 'registrar') @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('Hisob');
    const inv = await this.db.one(
      `SELECT i.*, (i.total - i.paid_amount) AS due, b.name AS branch_name, p.patient_number, p.last_name, p.first_name, p.middle_name, p.birth_date, p.phone,
              a.starts_at AS appointment_at, a.status AS appointment_status, d.display_name AS doctor_name
         FROM invoices i JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = i.branch_id
         LEFT JOIN appointments a ON a.id = i.appointment_id LEFT JOIN doctors d ON d.id = a.doctor_id
        WHERE i.id = $1 AND i.tenant_id = $2 AND i.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!inv) throw notFound('Hisob');
    const items = await this.db.rows(
      `SELECT it.id, it.description, it.quantity, it.unit_price, it.line_subtotal, it.discount_share, it.line_total, o.category, o.status AS order_status, o.ordered_at
         FROM invoice_items it JOIN service_orders o ON o.id = it.order_id WHERE it.invoice_id = $1 ORDER BY it.position`, [id]);
    const payments = await this.db.rows(
      `SELECT pm.id, pm.receipt_number, pm.amount, pm.method, pm.cashier_name, pm.paid_at, pm.note,
              (pm.amount - coalesce((SELECT sum(r.amount) FROM refunds r WHERE r.payment_id = pm.id), 0))::bigint AS refundable
         FROM payments pm WHERE pm.invoice_id = $1 ORDER BY pm.paid_at`, [id]);
    const refunds = await this.db.rows(
      `SELECT r.id, r.refund_number, r.payment_id, r.amount, r.method, r.reason_code, r.reason, r.approved_by_name, r.refunded_at FROM refunds r WHERE r.invoice_id = $1 ORDER BY r.refunded_at`, [id]);
    return { data: { ...inv, items, payments: payments.map((p) => ({ ...p, refundable: Math.min(Number(p.refundable), Number(inv.paid_amount)) })), refunds } };
  }

  /** Discount: manager only, mandatory reason, percent or fixed amount, only before any payment. */
  @Roles('manager') @Post(':id/discount') @HttpCode(200)
  async discount(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(discountSchema, body);
    return this.db.tx(async (c) => {
      const inv = await lockInvoice(c, ctx, id);
      if (inv.status !== 'unpaid' || Number(inv.paid_amount) > 0 || Number(inv.credit_amount) > 0) throw conflict('INVOICE_LOCKED', 'To‘lov yoki qaytarish bo‘lgan, yoxud bekor qilingan hisobga chegirma qo‘llanmaydi');
      const value = input.type === 'amount' ? Math.round(input.value) : input.value; // amount in tiyin
      if (input.type === 'amount' && value > Number(inv.subtotal)) throw invalid({ value: 'Chegirma hisob summasidan oshmasligi kerak' });
      await c.query(`UPDATE invoices SET discount_type = $2, discount_value = $3, discount_reason = $4, discount_approved_by_name = $5 WHERE id = $1`, [id, input.type, value, input.reason, ctx.name]);
      await recalcInvoice(c, id);
      const after = (await c.query(`SELECT discount_amount, total FROM invoices WHERE id = $1`, [id])).rows[0];
      await audit(c, ctx, 'invoice.discount', 'invoice', id, `Chegirma ${input.type === 'percent' ? input.value + '%' : som(value) + ' so‘m'} (${som(Number(after.discount_amount))} so‘m): ${input.reason}`, inv.branch_id);
      return { data: { ok: true, ...after } };
    });
  }

  /**
   * Records a payment. Idempotency-Key is mandatory: a retry with the same key returns the original payment.
   * The invoice row is locked, so concurrent payments can never exceed the remaining balance.
   * A cashier or the manager: whoever takes the money needs their own open shift in the invoice's branch.
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
        return { data: { payment: prev, invoice: await this.invoiceState(c, id), replayed: true } };
      }
      if (inv.status === 'void') throw conflict('INVOICE_VOID', 'Bekor qilingan hisobga to‘lov qabul qilinmaydi');
      const due = Number(inv.total) - Number(inv.paid_amount);
      if (due <= 0) throw conflict('INVOICE_PAID', 'Hisob to‘liq to‘langan');
      if (input.amount > due) throw invalid({ amount: `Summa qoldiqdan (${som(due)} so‘m) oshmasligi kerak` });
      // money is taken only in an open shift of this branch (FOR SHARE: a concurrent close waits for this payment)
      const shift = (await c.query(`SELECT id, branch_id, opened_at FROM cash_shifts WHERE tenant_id = $1 AND cashier_membership_id = $2 AND status = 'open' FOR SHARE`, [ctx.tenantId, ctx.membershipId])).rows[0];
      if (!shift) throw conflict('SHIFT_REQUIRED', 'To‘lov qabul qilish uchun avval kassa smenasini oching');
      if (shift.branch_id !== inv.branch_id) throw conflict('SHIFT_OTHER_BRANCH', 'Smenangiz boshqa filialda ochilgan. Shu filial hisobiga to‘lov olish uchun smenani yopib, shu filialda oching.');
      // a shift left open overnight: money of a new day never lands in yesterday's Z-report — close it first
      if (shiftIsStale(shift.opened_at)) throw conflict('SHIFT_STALE', `Smena ${localDate(shift.opened_at)} kuni ochilgan. Avval uni yoping, keyin bugungi smenani oching.`, { opened_at: shift.opened_at });
      const receipt = (await c.query(`UPDATE tenants SET receipt_seq = receipt_seq + 1 WHERE id = $1 RETURNING receipt_seq`, [ctx.tenantId])).rows[0].receipt_seq;
      const payment = (await c.query(
        `INSERT INTO payments (id, tenant_id, branch_id, invoice_id, receipt_number, amount, method, cashier_membership_id, cashier_name, paid_at, note, idempotency_key, request_hash, shift_id)
         VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [ctx.tenantId, inv.branch_id, id, receipt, input.amount, input.method, ctx.membershipId, ctx.name, now(), input.note, key, hash, shift.id])).rows[0];
      const paid = Number(inv.paid_amount) + input.amount;
      await c.query(`UPDATE invoices SET paid_amount = $2, status = $3, version = version + 1, updated_at = demo_now() WHERE id = $1`,
        [id, paid, invoiceStatus({ status: inv.status, total: Number(inv.total), paid, credit: Number(inv.credit_amount), hasItems: true })]);
      await audit(c, ctx, 'payment.create', 'invoice', id, `To‘lov: ${som(input.amount)} so‘m (${PAYMENT_METHOD_LABEL[input.method]}), qayd №${receipt}`, inv.branch_id);
      res.status(201);
      return { data: { payment, invoice: await this.invoiceState(c, id), replayed: false } };
    });
  }

  private async invoiceState(c: Q, id: string) {
    return (await c.query(`SELECT id, status, total, paid_amount, (total - paid_amount) AS due FROM invoices WHERE id = $1`, [id])).rows[0];
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
      `SELECT pm.id, pm.receipt_number, pm.amount, pm.method, pm.cashier_name, pm.paid_at, pm.note, pm.invoice_id, i.invoice_number, b.name AS branch_name,
              p.id AS patient_id, p.patient_number, p.last_name, p.first_name
         FROM payments pm JOIN invoices i ON i.id = pm.invoice_id JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = pm.branch_id
        WHERE ${where} ORDER BY pm.paid_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { data: rows, meta: { page, page_size: pageSize, total: agg.n, sum: Number(agg.sum), by_method: byMethod } };
  }

  /** CSV export of the filtered register. Cells starting with = + - @ are neutralised against formula injection. */
  @Roles('manager', 'cashier') @Get('export.csv')
  async csv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    // a bounded period: one export is built in memory, so «all time» would stall the server for everyone
    if (!isDate(q.from) || !isDate(q.to)) throw invalid({ from: 'Davrni tanlang' });
    if (q.from > q.to || addDays(q.from, 366) < q.to) throw invalid({ from: 'Eksport davri 1 yildan oshmasin' });
    const { params, where } = this.filters(ctx, q);
    const rows = await this.db.rows(
      `SELECT pm.receipt_number, pm.paid_at, b.name AS branch, p.patient_number, p.last_name || ' ' || p.first_name AS patient, i.invoice_number, pm.method, pm.amount, pm.cashier_name, pm.note
         FROM payments pm JOIN invoices i ON i.id = pm.invoice_id JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = pm.branch_id
        WHERE ${where} ORDER BY pm.paid_at`, params);
    const cell = (v: unknown) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const fmt = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
    const lines = [['Qayd №', 'Sana (Toshkent)', 'Filial', 'Bemor ID', 'Bemor', 'Hisob №', 'Usul', 'Summa (so‘m)', 'Kassir', 'Izoh'].map(cell).join(';')];
    for (const r of rows) lines.push([r.receipt_number, fmt(r.paid_at), r.branch, r.patient_number, r.patient, r.invoice_number, PAYMENT_METHOD_LABEL[r.method], (Number(r.amount) / 100).toFixed(2), r.cashier_name, r.note].map(cell).join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="meduzai-tolovlar-${q.from || 'all'}-${q.to || ''}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  }

  @Roles('manager', 'cashier') @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound('To‘lov');
    const p = await this.db.one(
      `SELECT pm.*, i.invoice_number, i.total, i.paid_amount, (i.total - i.paid_amount) AS due, i.status AS invoice_status, b.name AS branch_name, t.name AS clinic_name,
              p.patient_number, p.last_name, p.first_name, p.middle_name, p.birth_date,
              (SELECT json_agg(json_build_object('description', it.description, 'quantity', it.quantity, 'line_total', it.line_total) ORDER BY it.position) FROM invoice_items it WHERE it.invoice_id = i.id) AS items
         FROM payments pm JOIN invoices i ON i.id = pm.invoice_id JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = pm.branch_id JOIN tenants t ON t.id = pm.tenant_id
        WHERE pm.id = $1 AND pm.tenant_id = $2 AND pm.branch_id = ANY($3)`, [id, ctx.tenantId, ctx.branchIds]);
    if (!p) throw notFound('To‘lov');
    return { data: p };
  }
}
