// «Buyurtma taklifi» — the reorder suggestion of the warehouse (docs/WAREHOUSE.md). Pure arithmetic over the ledger,
// no AI: per item and branch the average daily consumption (net issues of the last 30 and 90 days), days of stock
// left, the quantity that expires within 30 days before FEFO can use it, and the quantity to order so the stock
// covers the horizon plus the item's minimum. Quantities are integer hundredths (numeric(12,2)) — never summed in
// floating point; only the daily rate is a fraction.
import type { Db } from '../core/db';
import { addDays, dayStart, today } from '../core/clock';
import { toC } from './warehouse';

export const HORIZON_MIN = 7;
export const HORIZON_MAX = 180;
export const HORIZON_DEFAULT = 30;
/** The FEFO projection looks this many days ahead for lots that will expire unused. */
export const EXPIRY_WINDOW = 30;
/** «Runs out soon»: fewer days of stock than this. */
export const URGENT_DAYS = 14;

export type ReorderStatus = 'out' | 'urgent' | 'order' | 'ok' | 'idle';
export type ReorderRow = {
  item_id: string; name: string; unit: string; category: string; controlled: boolean; branch_id: string; branch_name: string;
  pack_size: string | null; minimum_qty: string; purchase_price: number;
  stock: string; usable: string;
  consumed_30: string; consumed_90: string;
  /** units per day (2 decimals), from 30 days when there was consumption, else from 90 days */
  daily_rate: string; rate_basis: 30 | 90 | null;
  /** whole days the usable stock lasts at that rate (after lots that expire unused); null = no consumption */
  days_left: number | null;
  expiring_30: string; expiring_unusable: string;
  suggested: string; packs: number | null; est_cost: number;
  status: ReorderStatus;
};

/** hundredths → «12.50» */
const q = (c: number) => (c / 100).toFixed(2);

type Batch = { qtyC: number; expiry: string | null };
/**
 * FEFO projection: batches are used earliest expiry first at `rateC` hundredths per day, starting today. A batch that
 * expires on day d (0 = today, usable through its expiry day) can only absorb what is consumed by the end of day d
 * minus what earlier batches already took. What is left of a batch expiring within `window` days is unusable.
 */
export function fefoWaste(batches: Batch[], todayStr: string, rateC: number, window = EXPIRY_WINDOW) {
  const sorted = [...batches].filter((b) => b.qtyC > 0 && (b.expiry === null || b.expiry >= todayStr))
    .sort((a, b) => (a.expiry ?? '9999-12-31').localeCompare(b.expiry ?? '9999-12-31'));
  let consumed = 0, expiringC = 0, wasteC = 0;
  for (const b of sorted) {
    const days = b.expiry === null ? null : daysBetween(todayStr, b.expiry);
    const capacity = days === null ? Infinity : Math.max(0, Math.floor(rateC * (days + 1)) - consumed);
    const used = Math.min(b.qtyC, capacity);
    consumed += used;
    if (days !== null && days <= window) { expiringC += b.qtyC; wasteC += b.qtyC - used; }
  }
  return { expiringC, wasteC };
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Rounds a need (hundredths) up to whole packs, or to whole units when the pack size is unknown. */
export function roundUp(needC: number, packC: number | null): { qtyC: number; packs: number | null } {
  if (needC <= 0) return { qtyC: 0, packs: packC ? 0 : null };
  if (packC && packC > 0) { const packs = Math.ceil(needC / packC); return { qtyC: packs * packC, packs }; }
  return { qtyC: Math.ceil(needC / 100) * 100, packs: null };
}

/** One item's numbers from its batches and its net consumption over 30/90 days (hundredths). */
export function computeRow(it: any, batches: Batch[], net30C: number, net90C: number, horizon: number, todayStr: string): ReorderRow {
  const stockC = batches.reduce((s, b) => s + b.qtyC, 0);
  const usableC = batches.filter((b) => b.expiry === null || b.expiry >= todayStr).reduce((s, b) => s + b.qtyC, 0);
  const c30 = Math.max(0, net30C), c90 = Math.max(0, net90C);
  const basis: 30 | 90 | null = c30 > 0 ? 30 : c90 > 0 ? 90 : null;
  const rateC = basis === 30 ? c30 / 30 : basis === 90 ? c90 / 90 : 0; // hundredths per day
  const { expiringC, wasteC } = fefoWaste(batches, todayStr, rateC);
  const effectiveC = usableC - wasteC;
  const daysLeft = rateC > 0 ? Math.floor(effectiveC / rateC) : null;
  const minC = toC(it.minimum_qty);
  const packC = it.pack_size == null ? null : toC(it.pack_size);
  const need = Math.ceil(rateC * horizon) + minC - effectiveC; // − in transit: none (receipts arrive at once)
  const { qtyC, packs } = roundUp(need, packC);
  const status: ReorderStatus = usableC <= 0 && (rateC > 0 || minC > 0) ? 'out'
    : daysLeft !== null && daysLeft < URGENT_DAYS ? 'urgent'
    : qtyC > 0 ? 'order' : rateC > 0 ? 'ok' : 'idle';
  return {
    item_id: it.id, name: it.name, unit: it.unit, category: it.category, controlled: it.controlled, branch_id: it.branch_id, branch_name: it.branch_name,
    pack_size: it.pack_size == null ? null : q(packC!), minimum_qty: q(minC), purchase_price: Number(it.purchase_price),
    stock: q(stockC), usable: q(usableC), consumed_30: q(c30), consumed_90: q(c90),
    daily_rate: (Math.round(rateC) / 100).toFixed(2), rate_basis: basis, days_left: daysLeft,
    expiring_30: q(expiringC), expiring_unusable: q(wasteC),
    suggested: q(qtyC), packs, est_cost: Number((BigInt(qtyC) * BigInt(it.purchase_price ?? 0) + 50n) / 100n),
    status,
  };
}

const ORDER: Record<ReorderStatus, number> = { out: 0, urgent: 1, order: 2, ok: 3, idle: 4 };

/**
 * The suggestion for the branches in scope. Consumption = issues (and pre-030 «legacy» outgoing rows, which were
 * issues to departments) minus returns; voided rows, write-offs and count adjustments are not consumption.
 */
export async function reorderRows(db: Db, tenantId: string, branches: string[], horizon: number): Promise<{ today: string; horizon: number; rows: ReorderRow[] }> {
  const t = today();
  const end = dayStart(addDays(t, 1));
  const items = await db.rows(
    `SELECT i.id, i.name, i.unit, i.category, i.controlled, i.branch_id, b.name AS branch_name, i.minimum_qty, i.pack_size, i.purchase_price
       FROM inventory_items i JOIN branches b ON b.id = i.branch_id
      WHERE i.tenant_id = $1 AND i.branch_id = ANY($2) AND i.active ORDER BY i.name LIMIT 1000`, [tenantId, branches]);
  if (!items.length) return { today: t, horizon, rows: [] };
  const ids = items.map((i) => i.id);
  const [batches, used] = await Promise.all([
    db.rows(`SELECT item_id, qty, to_char(expiry_date, 'YYYY-MM-DD') AS expiry FROM inventory_batches WHERE item_id = ANY($1::uuid[]) AND qty > 0`, [ids]),
    db.rows(
      `SELECT m.item_id,
              coalesce(sum(CASE WHEN m.occurred_at >= $4 THEN (CASE WHEN m.kind = 'return' THEN -m.quantity ELSE m.quantity END) END), 0) AS c30,
              coalesce(sum(CASE WHEN m.kind = 'return' THEN -m.quantity ELSE m.quantity END), 0) AS c90
         FROM inventory_movements m
        WHERE m.tenant_id = $1 AND m.branch_id = ANY($2) AND m.occurred_at >= $3 AND m.occurred_at < $5 AND m.voided_at IS NULL
          AND (m.kind IN ('issue', 'return') OR (m.kind = 'legacy' AND m.type = 'out'))
        GROUP BY m.item_id`,
      [tenantId, branches, dayStart(addDays(t, -89)), dayStart(addDays(t, -29)), end]),
  ]);
  const byItem = new Map<string, Batch[]>();
  for (const b of batches) {
    const list = byItem.get(b.item_id) ?? [];
    list.push({ qtyC: toC(b.qty), expiry: b.expiry });
    byItem.set(b.item_id, list);
  }
  const use = new Map(used.map((u) => [u.item_id as string, u]));
  const rows = items.map((it) => {
    const u = use.get(it.id);
    return computeRow(it, byItem.get(it.id) ?? [], toC(u?.c30 ?? 0), toC(u?.c90 ?? 0), horizon, t);
  });
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.days_left ?? 1e9) - (b.days_left ?? 1e9) || a.name.localeCompare(b.name));
  return { today: t, horizon, rows };
}
