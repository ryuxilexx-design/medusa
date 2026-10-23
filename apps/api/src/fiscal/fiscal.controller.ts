// Parallel mode: the cashier records the certified KKM receipt for a payment (or the manager for a refund).
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { fiscalEnterSchema } from '@meduza/contracts';
import { Db, Q } from '../core/db';
import { Ctx, CurrentCtx, Roles } from '../core/context';
import { conflict, forbidden, notFound } from '../core/errors';
import { isUuid, parse } from '../core/validate';
import { audit } from '../core/audit';
import { FISCAL_COLS } from './provider';

@Controller()
export class FiscalController {
  constructor(private db: Db) {}

  /** The cashier enters the KKM receipt of their own payment; the manager of any payment in their branches. */
  @Roles('cashier', 'manager') @Post('payments/:id/fiscal') @HttpCode(200)
  async enterPayment(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(fiscalEnterSchema, body);
    if (!isUuid(id)) throw notFound('To‘lov');
    return this.db.tx(async (c) => {
      const p = (await c.query(`SELECT id, branch_id, cashier_membership_id, receipt_number FROM payments WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])).rows[0];
      if (!p || !ctx.branchIds.includes(p.branch_id)) throw notFound('To‘lov');
      if (ctx.role === 'cashier' && p.cashier_membership_id !== ctx.membershipId) throw forbidden('Boshqa kassirning to‘loviga chek kiritib bo‘lmaydi');
      const row = await this.issue(c, ctx, { payment_id: id }, input);
      await audit(c, ctx, 'payment.fiscal', 'payment', id, `Fiskal chek kiritildi: № ${input.receipt_number} (qayd №${p.receipt_number})`, p.branch_id);
      return { data: row };
    });
  }

  @Roles('manager') @Post('refunds/:id/fiscal') @HttpCode(200)
  async enterRefund(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(fiscalEnterSchema, body);
    if (!isUuid(id)) throw notFound('Qaytarish');
    return this.db.tx(async (c) => {
      const r = (await c.query(`SELECT id, branch_id, refund_number FROM refunds WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])).rows[0];
      if (!r || !ctx.branchIds.includes(r.branch_id)) throw notFound('Qaytarish');
      const row = await this.issue(c, ctx, { refund_id: id }, input);
      await audit(c, ctx, 'refund.fiscal', 'refund', id, `Qaytarish fiskal cheki kiritildi: № ${input.receipt_number} (№${r.refund_number})`, r.branch_id);
      return { data: row };
    });
  }

  /** pending/failed → issued. Issued and skipped rows are final (409). The row is locked so two entries cannot race. */
  private async issue(c: Q, ctx: Ctx, ref: { payment_id?: string; refund_id?: string }, input: ReturnType<typeof fiscalEnterSchema.parse>) {
    const col = ref.payment_id ? 'payment_id' : 'refund_id';
    const f = (await c.query(`SELECT * FROM fiscal_receipts WHERE ${col} = $1 AND tenant_id = $2 FOR UPDATE`, [ref.payment_id ?? ref.refund_id, ctx.tenantId])).rows[0];
    if (!f) throw conflict('FISCAL_NOT_REQUIRED', 'Bu to‘lov uchun fiskal chek talab qilinmaydi');
    if (f.status === 'issued') throw conflict('FISCAL_ALREADY_ISSUED', `Fiskal chek allaqachon kiritilgan: № ${f.receipt_number}`);
    if (f.status === 'skipped') throw conflict('FISCAL_NOT_REQUIRED', 'Bu klinikada fiskalizatsiya sozlanmagan');
    return (await c.query(
      `UPDATE fiscal_receipts f SET status = 'issued', receipt_number = $2, fiscal_sign = $3, qr_url = $4, terminal_id = $5, issued_at = demo_now(), entered_by_name = $6, error = NULL, attempts = attempts + 1
        WHERE f.id = $1 RETURNING ${FISCAL_COLS}`,
      [f.id, input.receipt_number, input.fiscal_sign || null, input.qr_url || null, input.terminal_id || null, ctx.name])).rows[0];
  }
}
