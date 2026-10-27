// Cash desk: cashier shifts, refunds (manager), expense entry, finance summary.
// Every shift reconciles: expected cash = opening + cash payments − cash refunds − cash expenses taken from the drawer.
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { createHash } from 'crypto';
import { expenseCreateSchema, expenseVoidSchema, PAYMENT_METHOD_LABEL, REFUND_REASON_LABEL, refundCreateSchema, shiftCloseSchema, shiftOpenSchema } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, coded, conflict, forbidden, invalid, notFound } from '../core/errors';
import { isUuid, pageParams, parse } from '../core/validate';
import { audit } from '../core/audit';
import { localToUtc, now, today } from '../core/clock';
import { branchScope } from '../core/scope';
import { csvPeriod, csvSom, csvTime, sendCsv } from '../core/csv';
import { invoiceStatus } from './billing';
import { COMPANY_DEBT_SQL, range } from './dashboard.controller';
import { FISCAL_JSON, FISCAL_JSON_REFUND, FISCAL_MISSING, shiftIsStale } from './invoices.controller';
import { recordFiscal } from '../fiscal/provider';

const som = (t: number) => (t / 100).toLocaleString('ru-RU').replace(/ /g, ' ');
type MethodSum = { n: number; sum: number };
type ByMethod = Record<'cash' | 'card' | 'transfer', MethodSum>;
export type ShiftTotals = {
  payments: ByMethod; refunds: ByMethod;
  /** patient prepayments taken in this shift / unused prepayments paid back from it (cash ones move the drawer) */
  deposit_in: ByMethod; deposit_out: ByMethod;
  cash_expenses: MethodSum;
  /** cash paid to referral partners from this drawer (docs/REFERRALS.md; voided payouts excluded) */
  partner_payouts: MethodSum;
  cash_in: number; cash_out: number;
};
const zeroByMethod = (): ByMethod => ({ cash: { n: 0, sum: 0 }, card: { n: 0, sum: 0 }, transfer: { n: 0, sum: 0 } });
/** A closed shift's snapshot from before deposits existed lacks the deposit keys: fill them with zeros. */
export const normalizeTotals = (t: Partial<ShiftTotals>): ShiftTotals => ({ payments: zeroByMethod(), refunds: zeroByMethod(), deposit_in: zeroByMethod(), deposit_out: zeroByMethod(), cash_expenses: { n: 0, sum: 0 }, partner_payouts: { n: 0, sum: 0 }, cash_in: 0, cash_out: 0, ...t });

/** Live totals for many shifts in five grouped queries (no N+1). */
export async function shiftTotalsMany(q: Q, ids: string[]): Promise<Map<string, ShiftTotals>> {
  const out = new Map<string, ShiftTotals>(ids.map((id) => [id, normalizeTotals({})]));
  if (!ids.length) return out;
  for (const r of (await q.query(`SELECT shift_id, method, count(*)::int AS n, coalesce(sum(amount),0)::bigint AS sum FROM payments WHERE shift_id = ANY($1::uuid[]) GROUP BY 1,2`, [ids])).rows)
    out.get(r.shift_id)!.payments[r.method as 'cash'] = { n: r.n, sum: Number(r.sum) };
  for (const r of (await q.query(`SELECT shift_id, method, count(*)::int AS n, coalesce(sum(amount),0)::bigint AS sum FROM refunds WHERE shift_id = ANY($1::uuid[]) GROUP BY 1,2`, [ids])).rows)
    out.get(r.shift_id)!.refunds[r.method as 'cash'] = { n: r.n, sum: Number(r.sum) };
  for (const r of (await q.query(`SELECT shift_id, kind, method, count(*)::int AS n, coalesce(sum(amount),0)::bigint AS sum FROM patient_deposits WHERE shift_id = ANY($1::uuid[]) AND kind IN ('in','out') GROUP BY 1,2,3`, [ids])).rows)
    out.get(r.shift_id)![r.kind === 'in' ? 'deposit_in' : 'deposit_out'][r.method as 'cash'] = { n: r.n, sum: Number(r.sum) };
  for (const r of (await q.query(`SELECT shift_id, count(*)::int AS n, coalesce(sum(amount),0)::bigint AS sum FROM expenses WHERE shift_id = ANY($1::uuid[]) AND status = 'active' AND paid_from = 'cash_drawer' GROUP BY 1`, [ids])).rows)
    out.get(r.shift_id)!.cash_expenses = { n: r.n, sum: Number(r.sum) };
  for (const r of (await q.query(`SELECT shift_id, count(*)::int AS n, coalesce(sum(amount),0)::bigint AS sum FROM partner_payouts WHERE shift_id = ANY($1::uuid[]) AND status = 'active' AND method = 'cash' GROUP BY 1`, [ids])).rows)
    out.get(r.shift_id)!.partner_payouts = { n: r.n, sum: Number(r.sum) };
  for (const t of out.values()) { t.cash_in = t.payments.cash.sum + t.deposit_in.cash.sum; t.cash_out = t.refunds.cash.sum + t.cash_expenses.sum + t.deposit_out.cash.sum + t.partner_payouts.sum; }
  return out;
}
/** Live totals of one shift (all methods for the report; cash movements for the drawer). */
export async function shiftTotals(q: Q, shiftId: string): Promise<ShiftTotals> {
  return (await shiftTotalsMany(q, [shiftId])).get(shiftId)!;
}
const expectedCash = (opening: number, t: ShiftTotals) => opening + t.cash_in - t.cash_out;

/** Cash can leave a drawer only if it is there: refunds, deposit refunds and drawer expenses never push the expected cash below zero. */
export async function assertCashAvailable(q: Q, shiftId: string, amount: number) {
  const s = (await q.query(`SELECT opening_cash FROM cash_shifts WHERE id = $1`, [shiftId])).rows[0];
  const available = expectedCash(Number(s.opening_cash), await shiftTotals(q, shiftId));
  if (amount > available) throw conflict('INSUFFICIENT_CASH', `Kassada yetarli naqd pul yo‘q (bor: ${som(Math.max(available, 0))} so‘m)`);
}

const SHIFT_COLS = `s.id, s.number, s.status, s.branch_id, b.name AS branch_name, s.cashier_membership_id, s.cashier_name, s.opened_at, s.opening_cash,
  s.closed_at, s.expected_cash, s.counted_cash, s.difference, s.totals, s.close_note, s.closed_by_name`;

@Controller()
export class CashController {
  constructor(private db: Db) {}

  private async withTotals(q: Q, s: any, live?: ShiftTotals) {
    if (!s) return null;
    const totals = s.status === 'closed' && s.totals ? normalizeTotals(s.totals) : live ?? await shiftTotals(q, s.id);
    const expected = s.status === 'closed' ? Number(s.expected_cash) : expectedCash(Number(s.opening_cash), totals);
    return { ...s, opening_cash: Number(s.opening_cash), totals, expected_cash: expected,
      counted_cash: s.counted_cash == null ? null : Number(s.counted_cash), difference: s.difference == null ? null : Number(s.difference) };
  }

  /** A shift the user may see: cashiers their own, managers within their branches. */
  private async loadShift(q: Q, ctx: Ctx, id: string, lock = false) {
    if (!isUuid(id)) throw notFound('Smena');
    const s = (await q.query(`SELECT ${SHIFT_COLS} FROM cash_shifts s JOIN branches b ON b.id = s.branch_id WHERE s.id = $1 AND s.tenant_id = $2 ${lock ? 'FOR UPDATE OF s' : ''}`, [id, ctx.tenantId])).rows[0];
    if (!s || !ctx.branchIds.includes(s.branch_id)) throw notFound('Smena');
    if (ctx.role === 'cashier' && s.cashier_membership_id !== ctx.membershipId) throw forbidden('Bu smena sizniki emas');
    return s;
  }

  // ---------------------------------------------------------------- shifts

  /** The signed-in person's own open shift (a cashier or the manager taking money). `stale` = opened before today: close it before paying. */
  @Roles('cashier', 'manager') @Get('cash-shifts/current')
  async current(@CurrentCtx() ctx: Ctx) {
    const s = await this.db.one(`SELECT ${SHIFT_COLS} FROM cash_shifts s JOIN branches b ON b.id = s.branch_id
      WHERE s.tenant_id = $1 AND s.cashier_membership_id = $2 AND s.status = 'open' AND s.branch_id = ANY($3)`, [ctx.tenantId, ctx.membershipId, ctx.branchIds]);
    const data = await this.withTotals(this.db.pool, s);
    return { data: data ? { ...data, stale: shiftIsStale(data.opened_at) } : null };
  }

  /** Shifts of a period as CSV (a cashier: their own), one row per shift and a totals row. */
  @Roles('cashier', 'manager') @Get('cash-shifts/export.csv')
  async shiftsCsv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    const period = csvPeriod(q);
    const r = range(q);
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end];
    let own = '';
    if (ctx.role === 'cashier') { params.push(ctx.membershipId); own = `AND s.cashier_membership_id = $${params.length}`; }
    const rows = await this.db.rows(`SELECT ${SHIFT_COLS} FROM cash_shifts s JOIN branches b ON b.id = s.branch_id
      WHERE s.tenant_id = $1 AND s.branch_id = ANY($2) AND s.opened_at < $4 AND coalesce(s.closed_at, 'infinity') >= $3 ${own} ORDER BY s.opened_at LIMIT 5000`, params);
    const live = await shiftTotalsMany(this.db.pool, rows.filter((s) => s.status === 'open').map((s) => s.id));
    const full = await Promise.all(rows.map((s) => this.withTotals(this.db.pool, s, live.get(s.id))));
    const sum = { opening: 0n, cash: 0n, card: 0n, transfer: 0n, refunds: 0n, depIn: 0n, depOut: 0n, expenses: 0n, partners: 0n, expected: 0n, counted: 0n, diff: 0n };
    const out: unknown[][] = [];
    for (const s of full) {
      const t: ShiftTotals = s!.totals;
      const refunds = t.refunds.cash.sum + t.refunds.card.sum + t.refunds.transfer.sum;
      const depIn = t.deposit_in.cash.sum + t.deposit_in.card.sum + t.deposit_in.transfer.sum, depOut = t.deposit_out.cash.sum + t.deposit_out.card.sum + t.deposit_out.transfer.sum;
      out.push([s!.number, s!.branch_name, s!.cashier_name, csvTime(s!.opened_at), s!.closed_at ? csvTime(s!.closed_at) : '', s!.status === 'open' ? 'Ochiq' : 'Yopilgan',
        csvSom(s!.opening_cash), csvSom(t.payments.cash.sum), csvSom(t.payments.card.sum), csvSom(t.payments.transfer.sum), csvSom(refunds), csvSom(depIn), csvSom(depOut), csvSom(t.cash_expenses.sum), csvSom(t.partner_payouts.sum),
        csvSom(s!.expected_cash), s!.counted_cash == null ? '' : csvSom(s!.counted_cash), s!.difference == null ? '' : csvSom(s!.difference), s!.close_note]);
      sum.opening += BigInt(s!.opening_cash); sum.cash += BigInt(t.payments.cash.sum); sum.card += BigInt(t.payments.card.sum); sum.transfer += BigInt(t.payments.transfer.sum);
      sum.refunds += BigInt(refunds); sum.depIn += BigInt(depIn); sum.depOut += BigInt(depOut); sum.expenses += BigInt(t.cash_expenses.sum); sum.partners += BigInt(t.partner_payouts.sum); sum.expected += BigInt(s!.expected_cash);
      sum.counted += BigInt(s!.counted_cash ?? 0); sum.diff += BigInt(s!.difference ?? 0);
    }
    out.push(['Jami', '', `${rows.length} ta smena`, '', '', '', csvSom(sum.opening), csvSom(sum.cash), csvSom(sum.card), csvSom(sum.transfer), csvSom(sum.refunds), csvSom(sum.depIn), csvSom(sum.depOut), csvSom(sum.expenses), csvSom(sum.partners), csvSom(sum.expected), csvSom(sum.counted), csvSom(sum.diff), '']);
    sendCsv(res, `meduzai-smenalar-${period.from}-${period.to}.csv`,
      ['№', 'Filial', 'Kassir', 'Ochilgan (Toshkent)', 'Yopilgan (Toshkent)', 'Holat', 'Boshlang‘ich (so‘m)', 'Naqd to‘lov (so‘m)', 'Karta (so‘m)', 'O‘tkazma (so‘m)', 'Qaytarish (so‘m)',
        'Depozit kirim (so‘m)', 'Depozit qaytarish (so‘m)', 'Kassadan xarajat (so‘m)', 'Hamkorlarga naqd (so‘m)', 'Kutilgan naqd (so‘m)', 'Sanalgan (so‘m)', 'Farq (so‘m)', 'Izoh'], out);
  }

  @Roles('cashier', 'manager') @Post('cash-shifts') @HttpCode(201)
  async open(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(shiftOpenSchema, body);
    if (!ctx.branchIds.includes(input.branch_id)) throw invalid({ branch_id: 'Bu filialda ishlamaysiz' });
    try {
      return await this.db.tx(async (c) => {
        const open = (await c.query(`SELECT number FROM cash_shifts WHERE tenant_id = $1 AND cashier_membership_id = $2 AND status = 'open'`, [ctx.tenantId, ctx.membershipId])).rows[0];
        if (open) throw conflict('SHIFT_ALREADY_OPEN', `Sizda ochiq smena bor (№${open.number}). Avval uni yoping.`);
        const number = (await c.query(`UPDATE tenants SET shift_seq = shift_seq + 1 WHERE id = $1 RETURNING shift_seq`, [ctx.tenantId])).rows[0].shift_seq;
        const s = (await c.query(
          `INSERT INTO cash_shifts (tenant_id, branch_id, cashier_membership_id, cashier_name, number, opening_cash, opened_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, number`,
          [ctx.tenantId, input.branch_id, ctx.membershipId, ctx.name, number, input.opening_cash, now()])).rows[0];
        await audit(c, ctx, 'cash_shift.open', 'cash_shift', s.id, `Smena №${number} ochildi, kassada ${som(input.opening_cash)} so‘m`, input.branch_id);
        return { data: s };
      });
    } catch (e: any) {
      if (e?.code === '23505' && String(e.constraint).includes('one_open')) throw conflict('SHIFT_ALREADY_OPEN', 'Sizda ochiq smena bor. Avval uni yoping.');
      throw e;
    }
  }

  /** Close: counted cash vs expected; any difference needs an explanation. Cashier closes their own, manager any in scope. */
  @Roles('cashier', 'manager') @Post('cash-shifts/:id/close') @HttpCode(200)
  async close(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(shiftCloseSchema, body);
    return this.db.tx(async (c) => {
      const s = await this.loadShift(c, ctx, id, true);
      if (s.status !== 'open') throw conflict('SHIFT_CLOSED', 'Smena allaqachon yopilgan');
      const totals = await shiftTotals(c, s.id);
      const expected = expectedCash(Number(s.opening_cash), totals);
      const difference = input.counted_cash - expected;
      if (difference !== 0 && !input.note) throw invalid({ note: `Farq ${difference > 0 ? '+' : ''}${som(difference)} so‘m — sababini yozing` });
      await c.query(
        `UPDATE cash_shifts SET status = 'closed', closed_at = $2, expected_cash = $3, counted_cash = $4, difference = $5, totals = $6, close_note = $7, closed_by_name = $8 WHERE id = $1`,
        [s.id, now(), expected, input.counted_cash, difference, JSON.stringify(totals), input.note ?? null, ctx.name]);
      await audit(c, ctx, 'cash_shift.close', 'cash_shift', s.id,
        `Smena №${s.number} yopildi: kutilgan ${som(expected)}, sanalgan ${som(input.counted_cash)}, farq ${som(difference)} so‘m`, s.branch_id);
      return { data: { id: s.id, expected_cash: expected, counted_cash: input.counted_cash, difference } };
    });
  }

  @Roles('cashier', 'manager') @Get('cash-shifts')
  async list(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const params: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id)];
    const where = ['s.tenant_id = $1', 's.branch_id = ANY($2)'];
    if (ctx.role === 'cashier') { params.push(ctx.membershipId); where.push(`s.cashier_membership_id = $${params.length}`); }
    if (q.status === 'open' || q.status === 'closed') { params.push(q.status); where.push(`s.status = $${params.length}`); }
    if (q.from || q.to) { const r = range(q); params.push(r.start, r.end); where.push(`s.opened_at < $${params.length} AND coalesce(s.closed_at, 'infinity') >= $${params.length - 1}`); }
    const rows = await this.db.rows(`SELECT ${SHIFT_COLS} FROM cash_shifts s JOIN branches b ON b.id = s.branch_id WHERE ${where.join(' AND ')} ORDER BY s.opened_at DESC LIMIT 60`, params);
    const live = await shiftTotalsMany(this.db.pool, rows.filter((s) => s.status === 'open').map((s) => s.id));
    return { data: await Promise.all(rows.map((s) => this.withTotals(this.db.pool, s, live.get(s.id)))) };
  }

  /** One shift with every movement in it (for the screen and the printed shift report). */
  @Roles('cashier', 'manager') @Get('cash-shifts/:id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const s = await this.withTotals(this.db.pool, await this.loadShift(this.db.pool, ctx, id));
    const payments = await this.db.rows(
      `SELECT pm.id, pm.receipt_number, pm.amount, pm.method, pm.paid_at, i.invoice_number, p.last_name, p.first_name, p.patient_number, ${FISCAL_JSON} AS fiscal
         FROM payments pm JOIN invoices i ON i.id = pm.invoice_id JOIN patients p ON p.id = i.patient_id WHERE pm.shift_id = $1 ORDER BY pm.paid_at`, [id]);
    const refunds = await this.db.rows(
      `SELECT r.id, r.refund_number, r.amount, r.method, r.refunded_at, r.reason_code, r.approved_by_name, i.invoice_number, p.last_name, p.first_name, p.patient_number, ${FISCAL_JSON_REFUND} AS fiscal
         FROM refunds r JOIN invoices i ON i.id = r.invoice_id JOIN patients p ON p.id = i.patient_id WHERE r.shift_id = $1 ORDER BY r.refunded_at`, [id]);
    const expenses = await this.db.rows(`SELECT id, category, amount, occurred_at, note, status, created_by_name FROM expenses WHERE shift_id = $1 ORDER BY occurred_at`, [id]);
    // cash paid to referral partners from this drawer: the cashier sees the outflow and the partner's name, never a percent
    const partnerPayouts = await this.db.rows(
      `SELECT pp.id, pp.amount, pp.paid_at, pp.status, pp.created_by_name, rp.full_name AS partner_name, rp.code AS partner_code
         FROM partner_payouts pp JOIN referral_partners rp ON rp.id = pp.partner_id WHERE pp.shift_id = $1 ORDER BY pp.paid_at`, [id]);
    const deposits = await this.db.rows(
      `SELECT d.id, d.kind, d.amount, d.method, d.occurred_at, d.note, d.actor_name, p.last_name, p.first_name, p.patient_number
         FROM patient_deposits d JOIN patients p ON p.id = d.patient_id WHERE d.shift_id = $1 ORDER BY d.occurred_at`, [id]);
    // payments of this shift whose fiscal receipt is still owed (parallel mode: KKM number not typed in yet)
    const fiscalPending = payments.filter((p) => p.fiscal && (p.fiscal.status === 'pending' || p.fiscal.status === 'failed')).length;
    return { data: { ...s, payments, refunds, expenses, deposits, partner_payouts: partnerPayouts, fiscal_pending: fiscalPending } };
  }

  // ---------------------------------------------------------------- refunds

  /**
   * Money back for a service not (fully) provided. Manager only (a cashier cannot refund to themselves).
   * The invoice is reduced by the same amount, so no debt appears. Cash comes out of an open drawer in that branch.
   * Idempotency-Key: a retried request returns the original refund.
   */
  @Roles('manager') @Post('invoices/:id/refunds')
  async refund(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    if (!key || key.length < 8 || key.length > 100) throw new AppError(422, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key sarlavhasi majburiy');
    if (!isUuid(id)) throw notFound('Hisob');
    const input = parse(refundCreateSchema, body);
    const fp = (invoiceId: string, paymentId: string, amount: unknown, method: string, orderId: string | null) =>
      createHash('sha256').update(`${invoiceId}|${paymentId}|${amount}|${method}|${orderId ?? ''}`).digest('hex').slice(0, 16);
    const fingerprint = fp(id, input.payment_id, input.amount, input.method, input.order_id ?? null);
    return this.db.tx(async (c) => {
      const inv = (await c.query(`SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (!inv || !ctx.branchIds.includes(inv.branch_id)) throw notFound('Hisob');
      const prev = (await c.query(`SELECT * FROM refunds WHERE tenant_id = $1 AND idempotency_key = $2`, [ctx.tenantId, key])).rows[0];
      if (prev) {
        const same = fp(prev.invoice_id, prev.payment_id, prev.amount, prev.method, prev.order_id) === fingerprint;
        if (!same) throw new AppError(422, 'IDEMPOTENCY_MISMATCH', 'Bu kalit boshqa qaytarish uchun ishlatilgan');
        res.status(200);
        return { data: { refund: prev, replayed: true } };
      }
      if (inv.status === 'void') throw conflict('INVOICE_VOID', 'Bekor qilingan hisob bo‘yicha qaytarish yo‘q');
      const pay = (await c.query(`SELECT id, amount, method, company_payment_id FROM payments WHERE id = $1 AND invoice_id = $2`, [input.payment_id, id])).rows[0];
      if (!pay) throw invalid({ payment_id: 'To‘lov shu hisobga tegishli emas' });
      // a company's bank transfer is corrected by voiding the company payment (Kompaniyalar), never refunded to the patient
      if (pay.company_payment_id) throw coded(409, 'COMPANY_PAYMENT', 'api.comp.noRefund');
      const already = Number((await c.query(`SELECT coalesce(sum(amount),0)::bigint AS s FROM refunds WHERE payment_id = $1`, [pay.id])).rows[0].s);
      const refundable = Math.min(Number(pay.amount) - already, Number(inv.paid_amount));
      if (refundable <= 0) throw conflict('NOTHING_TO_REFUND', 'Bu to‘lov to‘liq qaytarilgan');
      if (input.amount > refundable) throw invalid({ amount: `Ko‘pi bilan ${som(refundable)} so‘m qaytarish mumkin` });
      // one line of the invoice: the refund is charged to exactly that service (doctor share, service revenue)
      let line: { id: string; service_name: string } | null = null;
      if (input.order_id) {
        const it = (await c.query(
          `SELECT it.id, it.line_total, it.refunded_amount, o.service_name FROM invoice_items it JOIN service_orders o ON o.id = it.order_id
            WHERE it.order_id = $1 AND it.invoice_id = $2 FOR UPDATE OF it`, [input.order_id, id])).rows[0];
        if (!it) throw invalid({ order_id: 'Xizmat shu hisobga tegishli emas' });
        const left = Number(it.line_total) - Number(it.refunded_amount);
        if (input.amount > left) throw invalid({ amount: `«${it.service_name}» bo‘yicha ko‘pi bilan ${som(left)} so‘m qaytarish mumkin` });
        line = { id: it.id, service_name: it.service_name };
      }
      let shiftId: string | null = null;
      if (input.method === 'cash') {
        if (!input.shift_id) throw invalid({ shift_id: 'Naqd pul qaysi kassadan berilishini tanlang (ochiq smena)' });
        // cash leaving the drawer: an exclusive lock, so two outflows cannot both pass the «enough cash» check
        const sh = (await c.query(`SELECT id, branch_id FROM cash_shifts WHERE id = $1 AND tenant_id = $2 AND status = 'open' FOR UPDATE`, [input.shift_id, ctx.tenantId])).rows[0];
        if (!sh) throw conflict('SHIFT_NOT_OPEN', 'Tanlangan smena yopilgan yoki topilmadi');
        if (sh.branch_id !== inv.branch_id) throw invalid({ shift_id: 'Smena boshqa filialda' });
        await assertCashAvailable(c, sh.id, input.amount);
        shiftId = sh.id;
      }
      const number = (await c.query(`UPDATE tenants SET refund_seq = refund_seq + 1 WHERE id = $1 RETURNING refund_seq`, [ctx.tenantId])).rows[0].refund_seq;
      const refund = (await c.query(
        `INSERT INTO refunds (tenant_id, branch_id, invoice_id, payment_id, refund_number, amount, method, reason_code, reason, shift_id, approved_by, approved_by_name, refunded_at, idempotency_key, order_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [ctx.tenantId, inv.branch_id, id, pay.id, number, input.amount, input.method, input.reason_code, input.reason, shiftId, ctx.membershipId || null, ctx.name, now(), key, input.order_id ?? null])).rows[0];
      if (line) await c.query(`UPDATE invoice_items SET refunded_amount = refunded_amount + $2 WHERE id = $1`, [line.id, input.amount]);
      const paid = Number(inv.paid_amount) - input.amount, credit = Number(inv.credit_amount) + input.amount, total = Number(inv.total) - input.amount;
      const hasItems = !!(await c.query(`SELECT 1 FROM invoice_items WHERE invoice_id = $1 LIMIT 1`, [id])).rowCount;
      await c.query(
        `UPDATE invoices SET paid_amount = $2, credit_amount = $3, total = $4, refunded_amount = refunded_amount + $5, line_refunded_amount = line_refunded_amount + $7,
                status = $6, version = version + 1, updated_at = demo_now() WHERE id = $1`,
        [id, paid, credit, total, input.amount, invoiceStatus({ status: inv.status, total, paid, credit, hasItems }), line ? input.amount : 0]);
      await audit(c, ctx, 'refund.create', 'invoice', id,
        `Qaytarildi: ${som(input.amount)} so‘m (${PAYMENT_METHOD_LABEL[input.method]}), №${number}${line ? `, xizmat: ${line.service_name}` : ''}, sabab: ${REFUND_REASON_LABEL[input.reason_code]}`, inv.branch_id);
      const fiscal = await recordFiscal(c, { tenantId: ctx.tenantId, branchId: inv.branch_id, kind: 'refund', refundId: refund.id, invoiceId: id, amount: input.amount, method: input.method });
      res.status(201);
      return { data: { refund, fiscal, replayed: false } };
    });
  }

  private static REFUND_ROWS = `SELECT rf.id, rf.refund_number, rf.amount, rf.method, rf.reason_code, rf.reason, rf.refunded_at, rf.approved_by_name, rf.invoice_id, i.invoice_number,
              b.name AS branch_name, p.last_name, p.first_name, p.patient_number, s.number AS shift_number, s.cashier_name AS shift_cashier, rf.order_id, o.service_name
         FROM refunds rf JOIN invoices i ON i.id = rf.invoice_id JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = rf.branch_id
         LEFT JOIN cash_shifts s ON s.id = rf.shift_id LEFT JOIN service_orders o ON o.id = rf.order_id
        WHERE rf.tenant_id = $1 AND rf.branch_id = ANY($2) AND rf.refunded_at >= $3 AND rf.refunded_at < $4`;

  /** Refunds of a period as CSV (bounded ≤ 1 year), with a totals row. */
  @Roles('manager') @Get('refunds/export.csv')
  async refundsCsv(@CurrentCtx() ctx: Ctx, @Query() q: any, @Res() res: Response) {
    const period = csvPeriod(q);
    const r = range(q);
    const rows = await this.db.rows(`${CashController.REFUND_ROWS} ORDER BY rf.refunded_at`, [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end]);
    const total = rows.reduce((a, x) => a + BigInt(x.amount), 0n);
    sendCsv(res, `meduzai-qaytarishlar-${period.from}-${period.to}.csv`,
      ['№', 'Sana (Toshkent)', 'Filial', 'Bemor ID', 'Bemor', 'Hisob №', 'Xizmat', 'Usul', 'Smena', 'Sabab', 'Izoh', 'Tasdiqlagan', 'Summa (so‘m)'],
      [...rows.map((x) => [x.refund_number, csvTime(x.refunded_at), x.branch_name, x.patient_number, `${x.last_name} ${x.first_name}`, x.invoice_number, x.service_name ?? 'Butun hisob',
          PAYMENT_METHOD_LABEL[x.method], x.shift_number ? `№${x.shift_number} ${x.shift_cashier}` : '', REFUND_REASON_LABEL[x.reason_code], x.reason, x.approved_by_name, csvSom(x.amount)]),
        ['Jami', '', '', '', `${rows.length} ta qaytarish`, '', '', '', '', '', '', '', csvSom(total)]]);
  }

  @Roles('manager') @Get('refunds')
  async refunds(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const r = range(q);
    const { page, pageSize, offset } = pageParams(q);
    const P: unknown[] = [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end];
    const agg = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(rf.amount),0)::bigint AS sum FROM refunds rf WHERE rf.tenant_id = $1 AND rf.branch_id = ANY($2) AND rf.refunded_at >= $3 AND rf.refunded_at < $4`, P))!;
    const rows = await this.db.rows(`${CashController.REFUND_ROWS} ORDER BY rf.refunded_at DESC LIMIT $5 OFFSET $6`, [...P, pageSize, offset]);
    return { data: rows, meta: { from: r.from, to: r.to, page, page_size: pageSize, count: agg.n, total: Number(agg.sum) } };
  }

  // ---------------------------------------------------------------- expenses

  /** Manager: any expense; cashier: only cash taken from their own open drawer. */
  @Roles('manager', 'cashier') @Post('expenses') @HttpCode(201)
  async createExpense(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const input = parse(expenseCreateSchema, body);
    if (input.occurred_on && input.occurred_on > today()) throw invalid({ occurred_on: 'Kelajak sanasi bo‘lishi mumkin emas' });
    return this.db.tx(async (c) => {
      let branchId = input.branch_id, shiftId: string | null = null, paidFrom = input.paid_from, occurredAt = input.occurred_on ? localToUtc(input.occurred_on, '12:00') : now();
      if (ctx.role === 'cashier') {
        const sh = (await c.query(`SELECT id, branch_id FROM cash_shifts WHERE tenant_id = $1 AND cashier_membership_id = $2 AND status = 'open' AND branch_id = ANY($3) FOR UPDATE`, [ctx.tenantId, ctx.membershipId, ctx.branchIds])).rows[0];
        if (!sh) throw conflict('SHIFT_REQUIRED', 'Kassadan xarajat uchun avval smenani oching');
        await assertCashAvailable(c, sh.id, input.amount);
        branchId = sh.branch_id; shiftId = sh.id; paidFrom = 'cash_drawer'; occurredAt = now();
      } else {
        if (!branchId || !ctx.branchIds.includes(branchId)) throw invalid({ branch_id: 'Filialni tanlang' });
        if (paidFrom === 'cash_drawer') {
          if (!input.shift_id) throw invalid({ shift_id: 'Qaysi kassadan berilganini tanlang (ochiq smena)' });
          // cash leaving the drawer: an exclusive lock, so two outflows cannot both pass the «enough cash» check
        const sh = (await c.query(`SELECT id, branch_id FROM cash_shifts WHERE id = $1 AND tenant_id = $2 AND status = 'open' FOR UPDATE`, [input.shift_id, ctx.tenantId])).rows[0];
          if (!sh) throw conflict('SHIFT_NOT_OPEN', 'Tanlangan smena yopilgan yoki topilmadi');
          if (sh.branch_id !== branchId) throw invalid({ shift_id: 'Smena boshqa filialda' });
          await assertCashAvailable(c, sh.id, input.amount);
          shiftId = sh.id; occurredAt = now();
        }
      }
      const row = (await c.query(
        `INSERT INTO expenses (tenant_id, branch_id, category, amount, occurred_at, note, paid_from, shift_id, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ctx.tenantId, branchId, input.category, input.amount, occurredAt, input.note ?? null, paidFrom, shiftId, ctx.name])).rows[0];
      await audit(c, ctx, 'expense.create', 'expense', row.id, `Xarajat: ${input.category}, ${som(input.amount)} so‘m${shiftId ? ' (kassadan)' : ''}`, branchId);
      return { data: row };
    });
  }

  /** Void with a reason. An expense in a closed shift stays: the shift report is final. */
  @Roles('manager') @Post('expenses/:id/void') @HttpCode(200)
  async voidExpense(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    if (!isUuid(id)) throw notFound('Xarajat');
    const { reason } = parse(expenseVoidSchema, body);
    return this.db.tx(async (c) => {
      const e = (await c.query(`SELECT * FROM expenses WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, ctx.tenantId])).rows[0];
      if (!e || !ctx.branchIds.includes(e.branch_id)) throw notFound('Xarajat');
      if (e.status === 'void') throw conflict('ALREADY_VOID', 'Xarajat allaqachon bekor qilingan');
      if (e.shift_id) {
        // lock the shift like payments do: a concurrent close waits, and a closed shift's totals stay final
        const sh = (await c.query(`SELECT status FROM cash_shifts WHERE id = $1 FOR SHARE`, [e.shift_id])).rows[0];
        if (sh?.status !== 'open') throw conflict('SHIFT_CLOSED', 'Yopilgan smenadagi xarajatni bekor qilib bo‘lmaydi');
      }
      await c.query(`UPDATE expenses SET status = 'void', void_reason = $2, voided_at = demo_now(), voided_by_name = $3 WHERE id = $1`, [id, reason, ctx.name]);
      await audit(c, ctx, 'expense.void', 'expense', id, `Xarajat bekor qilindi: ${e.category}, ${som(Number(e.amount))} so‘m`, e.branch_id);
      return { data: { ok: true } };
    });
  }

  // ---------------------------------------------------------------- summary

  /** Cash basis for a period: payments − refunds = net revenue; − expenses = net result. */
  @Roles('manager') @Get('finance/summary')
  async summary(@CurrentCtx() ctx: Ctx, @Query() q: any) {
    const r = range(q);
    const P = [ctx.tenantId, branchScope(ctx, q.branch_id), r.start, r.end];
    const pay = await this.db.rows(`SELECT method, count(*)::int AS n, coalesce(sum(amount),0)::bigint AS sum FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4 GROUP BY 1`, P);
    const ref = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(amount),0)::bigint AS sum FROM refunds WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4`, P))!;
    const exp = await this.db.rows(`SELECT category, count(*)::int AS n, coalesce(sum(amount),0)::bigint AS sum FROM expenses WHERE tenant_id = $1 AND branch_id = ANY($2) AND occurred_at >= $3 AND occurred_at < $4 AND status = 'active' GROUP BY 1 ORDER BY 3 DESC`, P);
    // deposits: a liability, not revenue — money in / paid back in the period, and the outstanding balance of all patients
    const dep = (await this.db.one(`SELECT coalesce(sum(amount) FILTER (WHERE kind = 'in'),0)::bigint AS inflow, coalesce(sum(amount) FILTER (WHERE kind = 'out'),0)::bigint AS outflow,
        coalesce(sum(amount) FILTER (WHERE kind = 'apply'),0)::bigint AS applied FROM patient_deposits WHERE tenant_id = $1 AND branch_id = ANY($2) AND occurred_at >= $3 AND occurred_at < $4`, P))!;
    // the outstanding balance counts where the money was taken / applied / paid back (every ledger row has its branch), within the manager's scope
    const liability = (await this.db.one(`SELECT coalesce(sum(CASE WHEN kind = 'in' THEN amount ELSE -amount END),0)::bigint AS balance FROM patient_deposits WHERE tenant_id = $1 AND branch_id = ANY($2)`, [P[0], P[1]]))!;
    // referral partner payouts: an outflow next to expenses, never a reduction of revenue (docs/REFERRALS.md)
    const ppo = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(amount),0)::bigint AS sum, coalesce(sum(amount) FILTER (WHERE method = 'cash'),0)::bigint AS cash
        FROM partner_payouts WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4 AND status = 'active'`, P))!;
    // discounts given on bills of the period: not an expense and not part of the cash basis — shown next to revenue
    const disc = (await this.db.one(`SELECT count(*)::int AS n, coalesce(sum(discount_amount),0)::bigint AS sum FROM invoices
        WHERE tenant_id = $1 AND branch_id = ANY($2) AND created_at >= $3 AND created_at < $4 AND status <> 'void' AND discount_amount > 0`, P))!;
    // companies: their payments received in the period (already inside «payments») and what they owe now
    const comp = (await this.db.one(`SELECT coalesce(sum(amount),0)::bigint AS received FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4 AND company_payment_id IS NOT NULL`, P))!;
    const compDue = (await this.db.one(COMPANY_DEBT_SQL, [P[0], P[1]]))!;
    const gross = pay.reduce((a, b) => a + Number(b.sum), 0), refunds = Number(ref.sum), expenses = exp.reduce((a, b) => a + Number(b.sum), 0), partnerOut = Number(ppo.sum);
    const fiscal = (await this.db.one(`SELECT count(*)::int AS n FROM payments pm WHERE pm.tenant_id = $1 AND pm.branch_id = ANY($2) AND pm.paid_at >= $3 AND pm.paid_at < $4 AND ${FISCAL_MISSING}`, P))!;
    return { data: {
      from: r.from, to: r.to,
      fiscal: { missing: fiscal.n },
      payments: { total: gross, count: pay.reduce((a, b) => a + b.n, 0), by_method: Object.fromEntries(pay.map((x) => [x.method, Number(x.sum)])) },
      refunds: { total: refunds, count: ref.n },
      net_revenue: gross - refunds,
      expenses: { total: expenses, by_category: exp.map((x) => ({ category: x.category, count: x.n, sum: Number(x.sum) })) },
      partner_payouts: { total: partnerOut, count: ppo.n, cash: Number(ppo.cash) },
      net_result: gross - refunds - expenses - partnerOut,
      discounts: { total: Number(disc.sum), invoices: disc.n },
      companies: { received: Number(comp.received), receivable: Number(compDue.debt), receivable_invoices: compDue.invoices },
      deposits: { in: Number(dep.inflow), out: Number(dep.outflow), applied: Number(dep.applied), balance: Number(liability.balance) },
    } };
  }
}
