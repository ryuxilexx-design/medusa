// Patient deposits (prepayments): balance and the one rule for taking money out of it.
import { Q } from '../core/db';
import { Ctx } from '../core/context';
import { conflict, notFound } from '../core/errors';

const som = (t: number) => (t / 100).toLocaleString('ru-RU').replace(/\s/g, ' ');

/** Σ in − Σ apply − Σ out for one patient (tiyin). */
export async function depositBalance(q: Q, tenantId: string, patientId: string): Promise<number> {
  const r = (await q.query(`SELECT coalesce(sum(CASE WHEN kind = 'in' THEN amount ELSE -amount END),0)::bigint AS balance FROM patient_deposits WHERE patient_id = $1 AND tenant_id = $2`, [patientId, tenantId])).rows[0];
  return Number(r.balance);
}

/**
 * Locks the patient row (the ledger's serialization point: two concurrent uses of the same balance wait for each
 * other), then checks that `amount` is available. The caller inserts the 'apply' / 'out' row in the same transaction;
 * the DB trigger `patient_deposits_balance` refuses a negative balance even if a caller forgets this lock.
 */
export async function applyDeposit(q: Q, ctx: Ctx, patientId: string, amount: number): Promise<number> {
  const p = (await q.query(`SELECT id FROM patients WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [patientId, ctx.tenantId])).rows[0];
  if (!p) throw notFound('Bemor');
  const balance = await depositBalance(q, ctx.tenantId, patientId);
  if (balance < amount) throw conflict('INSUFFICIENT_DEPOSIT', `Bemor depozitida yetarli mablag‘ yo‘q (bor: ${som(balance)} so‘m)`, { balance });
  return balance - amount;
}
