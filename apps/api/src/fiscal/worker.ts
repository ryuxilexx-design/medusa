// Outbox worker for automatic fiscal providers: pending / failed rows are retried until issued or given up.
// Manual and none rows are never touched (a person finishes manual ones). No automatic provider exists yet;
// the loop is here so a real ОФД client only has to implement FiscalProvider and register under its name.
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { Db } from '../core/db';
import { config } from '../core/config';
import { DEFAULT_PROVIDERS, FiscalRequest, FiscalResult, loadInvoiceItems, ProviderRegistry } from './provider';

export const FISCAL_MAX_ATTEMPTS = 10;

/**
 * One pass: up to `limit` open rows of automatic providers, each in its own short transaction (SKIP LOCKED, so two
 * API instances never fiscalise the same payment twice). Returns what happened, for logs and tests.
 */
export async function runFiscalWorker(pool: Pool, providers: ProviderRegistry = DEFAULT_PROVIDERS, limit = 50) {
  const out = { issued: 0, failed: 0, pending: 0 };
  const manual = Object.values(providers).filter((p) => !p.automatic).map((p) => p.name);
  const ids = (await pool.query(
    `SELECT id FROM fiscal_receipts WHERE status IN ('pending','failed') AND provider <> ALL($1::text[]) AND attempts < $2 ORDER BY created_at LIMIT $3`,
    [manual.length ? manual : ['manual', 'none'], FISCAL_MAX_ATTEMPTS, limit])).rows;
  for (const { id } of ids) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const f = (await c.query(`SELECT * FROM fiscal_receipts WHERE id = $1 AND status IN ('pending','failed') FOR UPDATE SKIP LOCKED`, [id])).rows[0];
      if (!f) { await c.query('ROLLBACK'); continue; }
      const provider = providers[f.provider];
      let result: FiscalResult;
      if (!provider) result = { status: 'failed', error: `Fiskal provayder «${f.provider}» bu serverda sozlanmagan` };
      else {
        try {
          const req = await loadRequest(c, f);
          result = f.kind === 'sale' ? await provider.issueSale(req) : await provider.issueRefund(req);
        } catch (e) { result = { status: 'failed', error: String((e as Error)?.message || e).slice(0, 500) }; }
      }
      if (result.status === 'issued') {
        await c.query(`UPDATE fiscal_receipts SET status = 'issued', receipt_number = $2, fiscal_sign = $3, qr_url = $4, terminal_id = $5, issued_at = demo_now(), error = NULL, attempts = attempts + 1 WHERE id = $1`,
          [id, result.receipt_number, result.fiscal_sign ?? null, result.qr_url ?? null, result.terminal_id ?? null]);
        out.issued++;
      } else if (result.status === 'failed') {
        await c.query(`UPDATE fiscal_receipts SET status = 'failed', error = $2, attempts = attempts + 1 WHERE id = $1`, [id, result.error]);
        out.failed++;
      } else {
        // the provider accepted the job but has no number yet (asynchronous ОФД): try again next pass
        await c.query(`UPDATE fiscal_receipts SET status = 'pending', attempts = attempts + 1 WHERE id = $1`, [id]);
        out.pending++;
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally { c.release(); }
  }
  return out;
}

/** Rebuilds the provider request from the stored payment / refund and the invoice lines. */
async function loadRequest(q: { query: Pool['query'] }, f: any): Promise<FiscalRequest> {
  const src = f.kind === 'sale'
    ? (await q.query(`SELECT tenant_id, branch_id, invoice_id, amount, method FROM payments WHERE id = $1`, [f.payment_id])).rows[0]
    : (await q.query(`SELECT tenant_id, branch_id, invoice_id, amount, method FROM refunds WHERE id = $1`, [f.refund_id])).rows[0];
  const items = await loadInvoiceItems(q, src.invoice_id);
  return { tenantId: src.tenant_id, branchId: src.branch_id, kind: f.kind, paymentId: f.payment_id ?? undefined, refundId: f.refund_id ?? undefined, amount: Number(src.amount), method: src.method, items };
}

@Injectable()
export class FiscalWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private log = new Logger('FiscalWorker');
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  constructor(private db: Db) {}

  onApplicationBootstrap() {
    if (!config.workers) return;
    const run = async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        const r = await runFiscalWorker(this.db.pool);
        if (r.issued || r.failed) this.log.log(`fiskal cheklar: berildi ${r.issued}, xato ${r.failed}`);
      } catch (e) { this.log.warn(`fiscal: ${(e as Error).message}`); } finally { this.busy = false; }
    };
    this.timer = setInterval(run, Math.max(10, config.fiscal.retrySeconds) * 1000);
    setTimeout(run, 15_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
