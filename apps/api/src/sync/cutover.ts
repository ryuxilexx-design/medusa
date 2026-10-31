// «O‘tishni yakunlash» — the clinic leaves MedPlus for good (migration 044, docs/MEDPLUS_SYNC.md «Full switch»).
// Once, by a manager covering every branch: mirrored cards, visits, service lines and invoices become ordinary
// Med.uz.ai rows; MedPlus's payments and refunds stay mirrored history (no shift, no second fiscal receipt); the source
// is closed (inactive, no token) and takes no more batches or files. Runs under the source's sync lock, so no batch
// or import is half-applied around it.
import { Db } from '../core/db';
import { Ctx } from '../core/context';
import { coded } from '../core/errors';
import { audit } from '../core/audit';
import { now } from '../core/clock';
import { PATIENT_DUE } from '../modules/billing';
import { Source, syncBusy } from './ingest';

export const sourceClosed = () => coded(409, 'SOURCE_CLOSED', 'api.sync.closed', { mp: 'MedPlus' });

/** What the switch turns into ordinary rows, and what still needs the manager first. */
export async function cutoverPreview(db: Db, src: Source) {
  const r = (await db.one(
    `SELECT (SELECT count(*)::int FROM patients WHERE external_source_id = $1) AS patients,
            (SELECT count(*)::int FROM appointments WHERE external_source_id = $1) AS visits,
            (SELECT count(*)::int FROM appointments WHERE external_source_id = $1 AND status = 'scheduled' AND starts_at >= $2) AS future_visits,
            (SELECT count(*)::int FROM service_orders WHERE external_source_id = $1) AS orders,
            (SELECT count(*)::int FROM invoices WHERE external_source_id = $1) AS invoices,
            (SELECT count(*)::int FROM invoices i WHERE i.external_source_id = $1 AND i.status <> 'void' AND ${PATIENT_DUE()} > 0) AS debt_invoices,
            (SELECT coalesce(sum(${PATIENT_DUE()}), 0)::bigint FROM invoices i WHERE i.external_source_id = $1 AND i.status <> 'void' AND ${PATIENT_DUE()} > 0) AS debt_sum,
            (SELECT count(*)::int FROM payments WHERE external_source_id = $1) AS payments,
            (SELECT count(*)::int FROM refunds WHERE external_source_id = $1) AS refunds,
            (SELECT count(*)::int FROM external_pending WHERE source_id = $1) AS pending,
            (SELECT count(*)::int FROM external_duplicates WHERE source_id = $1 AND status = 'open') AS duplicates,
            (SELECT count(*)::int FROM external_mappings WHERE source_id = $1 AND kind = 'service' AND placeholder AND status = 'auto') AS placeholder_services,
            (SELECT count(*)::int FROM external_mappings WHERE source_id = $1 AND kind = 'doctor' AND placeholder AND status = 'auto') AS placeholder_doctors`,
    [src.id, now()]))!;
  return { ...r, debt_sum: Number(r.debt_sum) };
}

/**
 * The switch itself. `discardPending`: records still waiting (an unmapped branch, a payment without its services) are
 * dropped instead of blocking — the manager decides after seeing the count.
 */
export async function cutover(db: Db, src: Source, ctx: Ctx, opts: { discardPending: boolean }) {
  const lock = await db.pool.connect();
  let locked = false;
  try {
    locked = (await lock.query(`SELECT pg_try_advisory_lock(74042, hashtext($1)) AS ok`, [src.id])).rows[0].ok;
    if (!locked) throw syncBusy();
    return await db.tx(async (c) => {
      const s = (await c.query(`SELECT cutover_at FROM external_sources WHERE id = $1 FOR UPDATE`, [src.id])).rows[0];
      if (s.cutover_at) throw sourceClosed();
      const counts = await cutoverPreview(db, src);
      if (counts.pending > 0 && !opts.discardPending) throw coded(409, 'PENDING_RECORDS', 'api.sync.pendingLeft', { n: counts.pending });
      await c.query(`SELECT set_config('meduza.sync', 'on', true)`);
      // the order matters only for readability: every table's guard lets the marked transaction through
      for (const t of ['patients', 'appointments', 'service_orders', 'invoices']) {
        await c.query(`UPDATE ${t} SET external_source_id = NULL, imported_source_id = $2 WHERE tenant_id = $1 AND external_source_id = $2`, [src.tenant_id, src.id]);
      }
      const dropped = (await c.query(`DELETE FROM external_pending WHERE source_id = $1`, [src.id])).rowCount ?? 0;
      const at = now();
      const stored = { ...counts, pending_dropped: dropped };
      await c.query(`UPDATE external_sources SET active = false, token_hash = NULL, cutover_at = $2, cutover_by_name = $3, cutover_counts = $4 WHERE id = $1`,
        [src.id, at, ctx.name, JSON.stringify(stored)]);
      await audit(c, ctx, 'sync.cutover', 'external_source', src.id,
        `MedPlus’dan o‘tish yakunlandi: ${counts.patients} bemor, ${counts.visits} tashrif, ${counts.invoices} hisob Med.uz.ai’ga o‘tdi; ${counts.payments} to‘lov tarix sifatida qoldi; tashlab yuborildi ${dropped}`);
      return { cutover_at: at, counts: stored };
    });
  } finally {
    if (locked) await lock.query(`SELECT pg_advisory_unlock(74042, hashtext($1))`, [src.id]).catch(() => undefined);
    lock.release();
  }
}
