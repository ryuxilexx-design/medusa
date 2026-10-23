// Patient deposits (prepayments): an append-only ledger. Money in — by a cashier in an open shift; applied to an
// invoice — through the payment route with method 'deposit' (invoices.controller); unused balance out — by the manager.
// Deposits are a liability until applied: they are not revenue (revenue = payments − refunds, cash basis).
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { depositCreateSchema, depositRefundSchema, PAYMENT_METHOD_LABEL } from '@meduza/contracts';
import { Db } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { AppError, conflict, invalid, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { localDate, now } from '../core/clock';
import { assertCashAvailable } from './cash.controller';
import { shiftIsStale } from './invoices.controller';
import { assertPatientAccess } from './patients.controller';
import { applyDeposit, depositBalance } from './deposits';

const som = (t: number) => (t / 100).toLocaleString('ru-RU').replace(/\s/g, ' ');
const needKey = (key: string | undefined) => { if (!key || key.length < 8 || key.length > 100) throw new AppError(422, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key sarlavhasi majburiy'); };

@Controller('patients/:id/deposits')
export class DepositsController {
  constructor(private db: Db) {}

  /** The ledger (newest first, at most 100 rows) and the balance. Finance roles only — never the doctor or the lab. */
  @Roles('manager', 'cashier', 'registrar') @Get()
  async list(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await assertPatientAccess(this.db.pool, ctx, id);
    const rows = await this.db.rows(
      `SELECT d.id, d.kind, d.amount, d.method, d.note, d.actor_name, d.occurred_at, d.branch_id, b.name AS branch_name, d.invoice_id, i.invoice_number, s.number AS shift_number
         FROM patient_deposits d JOIN branches b ON b.id = d.branch_id LEFT JOIN invoices i ON i.id = d.invoice_id LEFT JOIN cash_shifts s ON s.id = d.shift_id
        WHERE d.patient_id = $1 AND d.tenant_id = $2 AND d.branch_id = ANY($3) ORDER BY d.occurred_at DESC, d.id DESC LIMIT 100`, [id, ctx.tenantId, ctx.branchIds]);
    return { data: rows, meta: { balance: await depositBalance(this.db.pool, ctx.tenantId, id) } };
  }

  /**
   * Money in. Like a payment: the cashier's (or manager's) own open shift takes it — cash lands in that drawer,
   * card/transfer are only recorded. Idempotency-Key: a retried request returns the original row.
   */
  @Roles('manager', 'cashier') @Post()
  async create(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    needKey(key);
    const input = parse(depositCreateSchema, body);
    return this.db.tx(async (c) => {
      await assertPatientAccess(c, ctx, id);
      const prev = (await c.query(`SELECT * FROM patient_deposits WHERE tenant_id = $1 AND idempotency_key = $2`, [ctx.tenantId, key])).rows[0];
      if (prev) {
        if (prev.kind !== 'in' || prev.patient_id !== id || Number(prev.amount) !== input.amount || prev.method !== input.method) throw new AppError(422, 'IDEMPOTENCY_MISMATCH', 'Bu kalit boshqa amal uchun ishlatilgan');
        res.status(200);
        return { data: { deposit: prev, balance: await depositBalance(c, ctx.tenantId, id), replayed: true } };
      }
      const shift = (await c.query(`SELECT id, branch_id, opened_at FROM cash_shifts WHERE tenant_id = $1 AND cashier_membership_id = $2 AND status = 'open' FOR SHARE`, [ctx.tenantId, ctx.membershipId])).rows[0];
      if (!shift) throw conflict('SHIFT_REQUIRED', 'To‘lov qabul qilish uchun avval kassa smenasini oching');
      if (shiftIsStale(shift.opened_at)) throw conflict('SHIFT_STALE', `Smena ${localDate(shift.opened_at)} kuni ochilgan. Avval uni yoping, keyin bugungi smenani oching.`, { opened_at: shift.opened_at });
      if (!ctx.branchIds.includes(shift.branch_id)) throw conflict('SHIFT_OTHER_BRANCH', 'Smenangiz boshqa filialda ochilgan.');
      const row = (await c.query(
        `INSERT INTO patient_deposits (tenant_id, branch_id, patient_id, kind, amount, method, shift_id, note, actor_membership_id, actor_name, occurred_at, idempotency_key)
         VALUES ($1,$2,$3,'in',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [ctx.tenantId, shift.branch_id, id, input.amount, input.method, shift.id, input.note ?? null, ctx.membershipId || null, ctx.name, now(), key])).rows[0];
      await audit(c, ctx, 'deposit.create', 'patient', id, `Oldindan to‘lov: ${som(input.amount)} so‘m (${PAYMENT_METHOD_LABEL[input.method]})`, shift.branch_id);
      res.status(201);
      return { data: { deposit: row, balance: await depositBalance(c, ctx.tenantId, id), replayed: false } };
    });
  }

  /** Unused balance back to the patient. Manager only; cash leaves an open drawer (locked, «enough cash» checked). */
  @Roles('manager') @Post('refund') @HttpCode(201)
  async refund(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    needKey(key);
    if (!isUuid(id)) throw notFound('Bemor');
    const input = parse(depositRefundSchema, body);
    return this.db.tx(async (c) => {
      const prev = (await c.query(`SELECT * FROM patient_deposits WHERE tenant_id = $1 AND idempotency_key = $2`, [ctx.tenantId, key])).rows[0];
      if (prev) {
        if (prev.kind !== 'out' || prev.patient_id !== id || Number(prev.amount) !== input.amount || prev.method !== input.method) throw new AppError(422, 'IDEMPOTENCY_MISMATCH', 'Bu kalit boshqa amal uchun ishlatilgan');
        res.status(200);
        return { data: { deposit: prev, balance: await depositBalance(c, ctx.tenantId, id), replayed: true } };
      }
      await applyDeposit(c, ctx, id, input.amount); // locks the patient, checks the balance
      let shiftId: string | null = null, branchId = ctx.branchIds[0];
      if (input.method === 'cash') {
        if (!input.shift_id) throw invalid({ shift_id: 'Naqd pul qaysi kassadan berilishini tanlang (ochiq smena)' });
        // cash leaving the drawer: an exclusive lock, so two outflows cannot both pass the «enough cash» check
        const sh = (await c.query(`SELECT id, branch_id FROM cash_shifts WHERE id = $1 AND tenant_id = $2 AND status = 'open' FOR UPDATE`, [input.shift_id, ctx.tenantId])).rows[0];
        if (!sh || !ctx.branchIds.includes(sh.branch_id)) throw conflict('SHIFT_NOT_OPEN', 'Tanlangan smena yopilgan yoki topilmadi');
        await assertCashAvailable(c, sh.id, input.amount);
        shiftId = sh.id; branchId = sh.branch_id;
      }
      const row = (await c.query(
        `INSERT INTO patient_deposits (tenant_id, branch_id, patient_id, kind, amount, method, shift_id, note, actor_membership_id, actor_name, occurred_at, idempotency_key)
         VALUES ($1,$2,$3,'out',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [ctx.tenantId, branchId, id, input.amount, input.method, shiftId, input.note, ctx.membershipId || null, ctx.name, now(), key])).rows[0];
      await audit(c, ctx, 'deposit.refund', 'patient', id, `Depozit qaytarildi: ${som(input.amount)} so‘m (${PAYMENT_METHOD_LABEL[input.method]}): ${input.note}`, branchId);
      return { data: { deposit: row, balance: await depositBalance(c, ctx.tenantId, id), replayed: false } };
    });
  }
}
