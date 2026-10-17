import { Pool, PoolClient, types } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { buildSeed, SeedData, DEMO_TIMEZONE_OFFSET_HOURS } from '../seed/build';

// bigint (int8) money values fit safely into JS numbers (< 2^53 tiyin).
types.setTypeParser(20, (v) => Number(v));
// numeric -> number (percents, quantities)
types.setTypeParser(1700, (v) => Number(v));
// date -> keep as 'YYYY-MM-DD' string
types.setTypeParser(1082, (v) => v);

export { buildSeed };
export type { SeedData };
export { SEED_IDS, DEMO_TIMEZONE_OFFSET_HOURS } from '../seed/build';

export function createPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new Pool({ connectionString, max: 10 });
}

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

export async function migrate(pool: Pool, log = console.log): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(74001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        log(`migratsiya qo'llandi: ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(74001)').catch(() => undefined);
    client.release();
  }
}

const TABLES_IN_INSERT_ORDER: (keyof SeedData)[] = [
  'tenants', 'branches', 'users', 'memberships', 'doctors', 'rooms', 'schedules', 'services', 'service_prices',
  'doctor_services', 'patients', 'appointments', 'queue_counters', 'queue_tickets', 'encounters', 'clinical_notes',
  'service_orders', 'lab_results', 'diagnostic_reports', 'invoices', 'invoice_items', 'payments', 'expenses',
  'inventory_items', 'inventory_movements', 'audit_logs',
];

export class ResetInProgressError extends Error {
  constructor() { super('Demo reset is already running'); }
}

const JSON_COLUMNS = new Set(['values', 'lab_template', 'vitals']);

async function insertRows(client: PoolClient, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const chunk = Math.max(1, Math.floor(30000 / cols.length));
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    const values = part.map((r) => '(' + cols.map((c) => {
      let v = r[c];
      if (JSON_COLUMNS.has(c) && v != null) v = JSON.stringify(v);
      params.push(v === undefined ? null : v);
      return `$${params.length}`;
    }).join(',') + ')');
    await client.query(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES ${values.join(',')}`, params);
  }
}

/**
 * Wipes all demo data and restores the deterministic seed in a single transaction.
 * Active sessions are kept (membership ids are stable), so the user stays logged in.
 * A concurrent reset is rejected instead of queued.
 */
/** Demo start instant: DEMO_DATE + DEMO_TIME (Tashkent), or DEMO_DATE + the current Tashkent time of day if DEMO_TIME is empty. */
export function demoStartInstant(demoDate: string, demoTime?: string): Date {
  const [y, m, d] = demoDate.split('-').map(Number);
  let minutes: number;
  if (demoTime && /^\d{2}:\d{2}$/.test(demoTime)) { const [h, mi] = demoTime.split(':').map(Number); minutes = h * 60 + mi; }
  else { const local = new Date(Date.now() + DEMO_TIMEZONE_OFFSET_HOURS * 3600_000); minutes = local.getUTCHours() * 60 + local.getUTCMinutes(); }
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - DEMO_TIMEZONE_OFFSET_HOURS * 3600_000);
}

export interface DemoClock { demo_anchor: Date; real_anchor: Date; set_reason: string; set_at: Date }

export async function readDemoClock(q: Pick<PoolClient, 'query'>): Promise<DemoClock | undefined> {
  return (await q.query('SELECT demo_anchor, real_anchor, set_reason, set_at FROM demo_clock WHERE id = 1')).rows[0];
}

/** Creates the clock anchor if it does not exist yet. Never moves an existing anchor. */
export async function ensureDemoClock(q: Pick<PoolClient, 'query'>, demoDate: string, demoTime?: string): Promise<DemoClock> {
  await q.query(`INSERT INTO demo_clock (id, demo_anchor, real_anchor, set_reason) VALUES (1, $1, clock_timestamp(), 'initial') ON CONFLICT (id) DO NOTHING`,
    [demoStartInstant(demoDate, demoTime)]);
  return (await readDemoClock(q))!;
}

/** Guard for destructive resets: refuses to run against a database whose name does not match `expectSuffix`. */
export async function assertDatabaseName(q: Pick<PoolClient, 'query'>, expectSuffix: string): Promise<string> {
  const name = (await q.query('SELECT current_database() AS n')).rows[0].n as string;
  if (!name.endsWith(expectSuffix)) throw new Error(`Xavfsizlik to‘xtatdi: «${name}» bazasi «*${expectSuffix}» emas. Test reseti demo bazaga yo‘naltirilmaydi.`);
  return name;
}

export async function resetDemo(pool: Pool, demoDate: string, demoTime?: string): Promise<{ counts: Record<string, number>; clock: DemoClock }> {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(74002) AS ok')).rows[0].ok;
    if (!locked) throw new ResetInProgressError();
    const seed = buildSeed(demoDate);
    await client.query('BEGIN');
    const sessions = (await client.query('SELECT * FROM sessions')).rows;
    const all = ['sessions', ...TABLES_IN_INSERT_ORDER].reverse();
    await client.query(`TRUNCATE ${all.join(', ')} RESTART IDENTITY CASCADE`);
    const counts: Record<string, number> = {};
    for (const t of TABLES_IN_INSERT_ORDER) {
      await insertRows(client, t, seed[t] as Record<string, unknown>[]);
      counts[t] = seed[t].length;
    }
    const membershipIds = new Set(seed.memberships.map((m) => m.id));
    await insertRows(client, 'sessions', sessions.filter((s) => membershipIds.has(s.membership_id)));
    // Data and clock are reset together: the demo starts again at DEMO_DATE + DEMO_TIME.
    await client.query(`INSERT INTO demo_clock (id, demo_anchor, real_anchor, set_reason) VALUES (1, $1, clock_timestamp(), 'reset')
      ON CONFLICT (id) DO UPDATE SET demo_anchor = EXCLUDED.demo_anchor, real_anchor = EXCLUDED.real_anchor, set_reason = 'reset', set_at = clock_timestamp()`,
      [demoStartInstant(demoDate, demoTime)]);
    const clock = (await readDemoClock(client))!;
    await client.query('COMMIT');
    return { counts, clock };
  } catch (e) {
    if (locked) await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(74002)').catch(() => undefined);
    client.release();
  }
}
