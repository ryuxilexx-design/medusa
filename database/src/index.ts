import { Pool, PoolClient, types } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { buildSeed, SeedData, DEMO_TIMEZONE_OFFSET_HOURS, SEED_IDS } from '../seed/build';
import { seedDrugLinks } from '../seed/warehouse';
import { STARTER_TEMPLATES } from '../seed/templates';
import { buildGuard, GUARD_TABLES } from '../seed/guard';
import { STARTER_LEAD_SOURCES } from '../seed/referrals';
import { ensureStarterDrugs } from './drugs';

// bigint (int8) money values fit safely into JS numbers (< 2^53 tiyin).
types.setTypeParser(20, (v) => Number(v));
// numeric -> number (percents, quantities)
types.setTypeParser(1700, (v) => Number(v));
// date -> keep as 'YYYY-MM-DD' string
types.setTypeParser(1082, (v) => v);

export { buildSeed };
export type { SeedData };
export { SEED_IDS, DEMO_TIMEZONE_OFFSET_HOURS, readSeedSnapshot, SNAPSHOT_DIR } from '../seed/build';
export { STARTER_TEMPLATES } from '../seed/templates';
export { GUARD_IDS, buildGuard } from '../seed/guard';
export { STARTER_LEAD_SOURCES, partnerSeedId, leadSourceSeedId } from '../seed/referrals';
export { ensureStarterDrugs, parseDrugsCsv, upsertDrugs, STARTER_DRUGS_CSV } from './drugs';

/**
 * The app's connection pool. A dropped connection (database restart, admin kill) must never crash the process:
 * the pool reports it and opens a new one. Waiting for a connection and running one statement are time-limited,
 * so a flood of slow requests degrades into clear errors instead of freezing every user.
 * Migrations and the demo reset lift the statement limit for their own session.
 */
export function createPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX) || 20,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10_000,
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 30_000,
    idle_in_transaction_session_timeout: 60_000,
  });
  pool.on('error', (e) => console.warn(`[db] idle connection lost: ${e.message}`));
  return pool;
}

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

export async function migrate(pool: Pool, log = console.log): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SET statement_timeout = 0'); // index builds on a big database may take minutes
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
    // the starter drug list (migration 028) is data, not schema: loaded once while the table is empty
    await client.query('BEGIN');
    try {
      const n = await ensureStarterDrugs(client);
      await client.query('COMMIT');
      if (n) log(`dori ro‘yxati yuklandi: ${n} ta (boshlang‘ich, klinik tekshiruv talab etiladi)`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(74001)').catch(() => undefined);
    await client.query('RESET statement_timeout').catch(() => undefined); // the connection goes back to the pool
    client.release();
  }
}

const TABLES_IN_INSERT_ORDER: (keyof SeedData)[] = [
  'tenants', 'branches', 'users', 'memberships', 'doctors', 'rooms', 'schedules', 'services', 'service_prices',
  'doctor_services', 'schedule_exceptions', 'lead_sources', 'referral_partners', 'referral_partner_services', 'discount_rules', 'benefit_categories', 'companies', 'patients', 'patient_consents', 'patient_allergies', 'appointments', 'queue_counters', 'queue_tickets', 'encounters', 'clinical_notes',
  'note_addenda', 'medical_documents', 'patient_summaries',
  'service_orders', 'lab_results', 'diagnostic_reports', 'invoices', 'invoice_items', 'cash_shifts', 'company_payments', 'payments', 'company_payment_allocations', 'refunds', 'patient_deposits', 'expenses', 'partner_payouts',
  'inventory_items', 'inventory_receipts', 'inventory_batches', 'inventory_requests', 'inventory_request_lines', 'inventory_movements',
  'inventory_writeoffs', 'inventory_writeoff_lines', 'inventory_doc_counters', 'cold_devices', 'fridge_temperature_log', 'audit_logs', 'cameras', 'face_codes', 'camera_events', 'camera_event_acks', 'arrival_suggestions', 'camera_snapshots',
];

export class ResetInProgressError extends Error {
  constructor() { super('Demo reset is already running'); }
}

const JSON_COLUMNS = new Set(['values', 'lab_template', 'vitals', 'icd10', 'body', 'discount_scope']);

/**
 * Seed prescriptions name their drugs by INN; the reference ids (and ATC, prescription-only) live in the `drugs` table,
 * whose ids the database generates. Filled in before insert, so the issued document is stored in its final form.
 */
async function linkSeedPrescriptions(q: Pick<PoolClient, 'query'>, docs: Record<string, any>[]): Promise<void> {
  const inns = [...new Set(docs.filter((d) => d.kind === 'prescription').flatMap((d) => (d.body.items as any[]).map((it) => String(it.inn).toLowerCase())))];
  if (!inns.length) return;
  const rows = (await q.query(`SELECT id, inn, atc, prescription_only FROM drugs WHERE lower(inn) = ANY($1) AND active`, [inns])).rows;
  const byInn = new Map(rows.map((r) => [String(r.inn).toLowerCase(), r]));
  for (const d of docs) if (d.kind === 'prescription') for (const it of d.body.items as any[]) {
    const r = byInn.get(String(it.inn).toLowerCase());
    Object.assign(it, { drug_id: r?.id ?? null, inn: r?.inn ?? null, atc: r?.atc ?? null, prescription_only: r?.prescription_only ?? false });
  }
}

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

/**
 * Demo databases seeded before migration 011 have no consent rows, so every seed card would show «Rozilik yo‘q».
 * Adds the seed's consent rows once (only while the main seed clinic has none), without a destructive reset.
 * Rows the seed would create are kept as they are; recorded_at is the patient's real card date in this database.
 */
export async function backfillSeedConsents(q: Pick<PoolClient, 'query'>, demoDate: string): Promise<number> {
  const has = (await q.query('SELECT 1 FROM patient_consents WHERE tenant_id = $1 LIMIT 1', [SEED_IDS.tenant])).rowCount;
  if (has) return 0;
  // only the data-processing forms: biometric consents come with their camera codes (backfillSeedCameras)
  const rows = buildSeed(demoDate).patient_consents.filter((c) => c.kind === 'data_processing');
  const r = await q.query(
    `INSERT INTO patient_consents (id, tenant_id, patient_id, kind, granted, text_version, method, recorded_by, recorded_by_name, recorded_at)
     SELECT r.id, r.tenant_id, r.patient_id, r.kind, r.granted, r.text_version, r.method, r.recorded_by, r.recorded_by_name, p.created_at
       FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, tenant_id uuid, patient_id uuid, kind text, granted boolean, text_version text,
                                               method text, recorded_by uuid, recorded_by_name text)
       JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
       JOIN memberships m ON m.id = r.recorded_by AND m.tenant_id = r.tenant_id
     ON CONFLICT (id) DO NOTHING`, [JSON.stringify(rows)]);
  return r.rowCount ?? 0;
}

/**
 * Demo databases seeded before migration 012 have no cameras: adds the seed's cameras, staff/patient codes, biometric
 * consents and camera events once (only while the main seed clinic has no camera). Arrival suggestions are skipped:
 * they belong to the seed's own «today».
 */
export async function backfillSeedCameras(q: Pick<PoolClient, 'query'>, demoDate: string): Promise<number> {
  // events are seeded up to the demo clock's «now» on the seed day (never the server's wall clock)
  const clock = (await q.query(`SELECT to_char(demo_now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS d, to_char(demo_now() AT TIME ZONE 'Asia/Tashkent', 'HH24:MI') AS t`)).rows[0];
  const demoTime = clock.d === demoDate ? clock.t : clock.d < demoDate ? '00:00' : '23:59';
  const seeded = (await q.query('SELECT 1 FROM tenants WHERE id = $1', [SEED_IDS.tenant])).rowCount;
  const has = (await q.query('SELECT 1 FROM cameras WHERE tenant_id = $1 LIMIT 1', [SEED_IDS.tenant])).rowCount;
  if (!seeded || has) return 0;
  const seed = buildSeed(demoDate, demoTime);
  const patientIds = new Set((await q.query('SELECT id FROM patients WHERE tenant_id = $1', [SEED_IDS.tenant])).rows.map((r) => r.id));
  const existing = new Set((await q.query('SELECT id FROM patient_consents WHERE tenant_id = $1', [SEED_IDS.tenant])).rows.map((r) => r.id));
  const bio = seed.patient_consents.filter((c) => c.kind === 'biometric' && patientIds.has(c.patient_id) && !existing.has(c.id));
  const codes = seed.face_codes.filter((f) => f.subject_type === 'staff' || patientIds.has(f.patient_id));
  const codeIds = new Set(codes.map((f) => f.id));
  const events = seed.camera_events.filter((e) => !e.face_code_id || codeIds.has(e.face_code_id));
  const eventIds = new Set(events.map((e) => e.id));
  await insertRows(q as PoolClient, 'cameras', seed.cameras);
  await insertRows(q as PoolClient, 'patient_consents', bio);
  await insertRows(q as PoolClient, 'face_codes', codes);
  await insertRows(q as PoolClient, 'camera_events', events);
  await insertRows(q as PoolClient, 'camera_event_acks', seed.camera_event_acks.filter((a) => eventIds.has(a.event_id)));
  await q.query(`SELECT setval('face_code_staff_seq', GREATEST((SELECT max(substring(code from 3)::int) FROM face_codes WHERE subject_type = 'staff'), 1))`);
  return seed.cameras.length;
}

/**
 * Demo databases seeded before migration 016 have no alert snapshots and no «Operatsiya bloki» camera: adds the seed's
 * new camera, its alerts and the drawn snapshots of the existing seed alerts once (only while the seed clinic has no
 * snapshot). Cameras people added themselves are untouched.
 */
/** Adds the seed's alert pictures to a demo database seeded before they existed, and refreshes the ones whose file changed. */
export async function backfillSeedSnapshots(q: Pick<PoolClient, 'query'>, demoDate: string): Promise<number> {
  const seeded = (await q.query('SELECT 1 FROM cameras WHERE tenant_id = $1 LIMIT 1', [SEED_IDS.tenant])).rowCount;
  if (!seeded) return 0;
  const clock = (await q.query(`SELECT to_char(demo_now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS d, to_char(demo_now() AT TIME ZONE 'Asia/Tashkent', 'HH24:MI') AS t`)).rows[0];
  const seed = buildSeed(demoDate, clock.d === demoDate ? clock.t : clock.d < demoDate ? '00:00' : '23:59');
  const camIds = new Set((await q.query('SELECT id FROM cameras WHERE tenant_id = $1', [SEED_IDS.tenant])).rows.map((r) => r.id));
  const secCams = seed.cameras.filter((c) => (c.purposes as string[]).includes('security'));
  await insertRows(q as PoolClient, 'cameras', secCams.filter((c) => !camIds.has(c.id)));
  // the seed's security cameras now keep alert pictures; the entrance camera also guards the lobby at night
  for (const c of secCams) await q.query('UPDATE cameras SET alert_snapshots = true, purposes = $2 WHERE id = $1 AND tenant_id = $3', [c.id, c.purposes, SEED_IDS.tenant]);
  // an alert the older seed already created (same camera, kind and time, whatever its id) is reused, not duplicated
  const idOf = new Map<string, string>();
  for (const e of seed.camera_events.filter((e) => e.alert)) {
    const existing = (await q.query(`SELECT id FROM camera_events WHERE tenant_id = $1 AND camera_id = $2 AND kind = $3 AND occurred_at = $4 LIMIT 1`,
      [e.tenant_id, e.camera_id, e.kind, e.occurred_at])).rows[0];
    if (existing) { idOf.set(e.id, existing.id); continue; }
    await q.query(
      `INSERT INTO camera_events (id, tenant_id, camera_id, branch_id, kind, occurred_at, received_at, face_code_id, similarity, enter_count, exit_count, target, alert, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
      [e.id, e.tenant_id, e.camera_id, e.branch_id, e.kind, e.occurred_at, e.received_at, e.face_code_id, e.similarity, e.enter_count, e.exit_count, e.target, e.alert, e.dedupe_key]);
    idOf.set(e.id, e.id);
  }
  for (const a of seed.camera_event_acks) {
    const id = idOf.get(a.event_id);
    if (id) await q.query(`INSERT INTO camera_event_acks (event_id, tenant_id, acked_by, acked_at) VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING`, [id, a.tenant_id, a.acked_by, a.acked_at]);
  }
  let n = 0;
  for (const s of seed.camera_snapshots) {
    const id = idOf.get(s.event_id);
    if (!id) continue;
    // a seed alert whose picture file changed (tools/make-snapshots.py) gets the new picture on the next start;
    // the table forbids UPDATE (append-only evidence), so the old picture is removed the way the retention purge does
    await q.query(`DELETE FROM camera_snapshots WHERE event_id = $1 AND tenant_id = $2 AND md5(bytes) <> md5($3::bytea)`, [id, s.tenant_id, s.bytes]);
    const r = await q.query(`INSERT INTO camera_snapshots (event_id, tenant_id, content_type, bytes, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (event_id) DO NOTHING`,
      [id, s.tenant_id, s.content_type, s.bytes, s.created_at]);
    n += r.rowCount ?? 0;
  }
  return n;
}

/**
 * Inserts the starter note templates (database/seed/templates.ts) for one clinic. Idempotent: a template the clinic
 * already has (by starter key) is left as it is — edited or hidden. Proposed orders are matched by the catalogue's
 * service code; a clinic without that service gets the template without that order. Not part of the seed PRNG.
 */
export async function ensureStarterTemplates(q: Pick<PoolClient, 'query'>, tenantId: string): Promise<number> {
  const codes = [...new Set(STARTER_TEMPLATES.flatMap((t) => t.order_service_codes))];
  const services = new Map<string, string>((await q.query(`SELECT code, id FROM services WHERE tenant_id = $1 AND code = ANY($2) AND active`, [tenantId, codes])).rows.map((r) => [r.code, r.id]));
  // only codes present in this database's MKB-10 list: an unknown code could never be signed
  const known = new Set((await q.query(`SELECT code FROM icd10_codes WHERE code = ANY($1)`, [[...new Set(STARTER_TEMPLATES.flatMap((t) => t.icd_codes))]])).rows.map((r) => r.code));
  let n = 0;
  for (const t of STARTER_TEMPLATES) {
    const r = await q.query(
      `INSERT INTO note_templates (tenant_id, specialty, name, fields, icd_codes, order_service_ids, created_by, starter_key, sort)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::uuid[], NULL, $7, $8) ON CONFLICT (tenant_id, starter_key) WHERE starter_key IS NOT NULL DO NOTHING`,
      [tenantId, t.specialty, t.name, JSON.stringify(t.fields), t.icd_codes.filter((c) => known.has(c)),
        t.order_service_codes.map((c) => services.get(c)).filter(Boolean), t.key, t.sort]);
    n += r.rowCount ?? 0;
  }
  return n;
}

/**
 * Demo databases seeded before migration 030 have no storekeeper and no warehouse demo data. Adds, without a reset:
 * the storekeeper account, the seed's new medicine items with their receipts, batches and movements, the requests
 * that only use those items, and the fridge log. Existing items keep their opening batch from migration 030 (their
 * ledger stays balanced); the pending write-off of an old item is left out. Idempotent: nothing happens once the
 * storekeeper exists.
 */
export async function backfillSeedWarehouse(q: Pick<PoolClient, 'query'>, demoDate: string): Promise<number> {
  const seeded = (await q.query('SELECT 1 FROM tenants WHERE id = $1', [SEED_IDS.tenant])).rowCount;
  const has = (await q.query(`SELECT 1 FROM memberships WHERE tenant_id = $1 AND role = 'storekeeper' LIMIT 1`, [SEED_IDS.tenant])).rowCount;
  if (!seeded || has) return 0;
  const clock = (await q.query(`SELECT to_char(demo_now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS d, to_char(demo_now() AT TIME ZONE 'Asia/Tashkent', 'HH24:MI') AS t`)).rows[0];
  const seed = buildSeed(demoDate, clock.d === demoDate ? clock.t : clock.d < demoDate ? '00:00' : '23:59');
  const keepers = seed.memberships.filter((m) => m.role === 'storekeeper');
  const keeperUsers = new Set(keepers.map((m) => m.user_id));
  const existingUsers = new Set((await q.query('SELECT id FROM users').then((r) => r.rows.map((x) => x.id))));
  await insertRows(q as PoolClient, 'users', seed.users.filter((u) => keeperUsers.has(u.id) && !existingUsers.has(u.id)));
  await insertRows(q as PoolClient, 'memberships', keepers);
  const existingItems = new Set((await q.query('SELECT id FROM inventory_items WHERE tenant_id = $1', [SEED_IDS.tenant])).rows.map((r) => r.id));
  const newItems = seed.inventory_items.filter((i) => !existingItems.has(i.id));
  const newItemIds = new Set(newItems.map((i) => i.id));
  const batches = seed.inventory_batches.filter((b) => newItemIds.has(b.item_id as string));
  const receiptIds = new Set(batches.map((b) => b.receipt_id).filter(Boolean));
  const requests = seed.inventory_requests.filter((r) => {
    const lines = seed.inventory_request_lines.filter((l) => l.request_id === r.id);
    return lines.length > 0 && lines.every((l) => newItemIds.has(l.item_id as string));
  });
  const requestIds = new Set(requests.map((r) => r.id));
  const allNew = seed.inventory_movements.filter((m) => newItemIds.has(m.item_id as string));
  const moves = allNew.filter((m) => !m.writeoff_id && (!m.request_id || requestIds.has(m.request_id)));
  // a movement left out (its request also used an older item) is undone on its batch, so Σ batches = the ledger
  const kept = new Set(moves.map((m) => m.id));
  const back = new Map<string, number>();
  for (const m of allNew) if (!kept.has(m.id) && m.batch_id) back.set(m.batch_id as string, (back.get(m.batch_id as string) ?? 0) + Math.round(Number(m.quantity) * 100) * (m.type === 'out' ? 1 : -1));
  for (const b of batches) if (back.has(b.id as string)) b.qty = ((Math.round(Number(b.qty) * 100) + back.get(b.id as string)!) / 100).toFixed(2);
  await insertRows(q as PoolClient, 'inventory_items', newItems);
  await insertRows(q as PoolClient, 'inventory_receipts', seed.inventory_receipts.filter((r) => receiptIds.has(r.id)));
  await insertRows(q as PoolClient, 'inventory_batches', batches);
  await insertRows(q as PoolClient, 'inventory_requests', requests);
  await insertRows(q as PoolClient, 'inventory_request_lines', seed.inventory_request_lines.filter((l) => requestIds.has(l.request_id)));
  await insertRows(q as PoolClient, 'inventory_movements', moves);
  const fridgeHas = (await q.query('SELECT 1 FROM fridge_temperature_log WHERE tenant_id = $1 LIMIT 1', [SEED_IDS.tenant])).rowCount;
  if (!fridgeHas) {
    // the seed's cold-chain devices (migration 039) unless a device of that name exists; the log only for devices that are there
    for (const dv of seed.cold_devices)
      await q.query(`INSERT INTO cold_devices (id, tenant_id, branch_id, name, kind, min_temp, max_temp, active, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [dv.id, dv.tenant_id, dv.branch_id, dv.name, dv.kind, dv.min_temp, dv.max_temp, dv.active, dv.created_at]);
    const have = new Set((await q.query('SELECT id FROM cold_devices WHERE tenant_id = $1', [SEED_IDS.tenant])).rows.map((r) => r.id));
    await insertRows(q as PoolClient, 'fridge_temperature_log', seed.fridge_temperature_log.filter((f) => have.has(f.device_id)));
  }
  for (const c of seed.inventory_doc_counters)
    await q.query(`INSERT INTO inventory_doc_counters (tenant_id, kind, last) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, kind) DO UPDATE SET last = GREATEST(inventory_doc_counters.last, EXCLUDED.last)`, [c.tenant_id, c.kind, c.last]);
  return keepers.length;
}

/**
 * The open-items snapshot of every closed post shift that has none (migration 040): the state at its hand-over time,
 * reconstructed from the append-only history (`guard_open_items`). Seeded shifts are inserted closed, so the seed calls it.
 */
export async function snapshotGuardShifts(q: Pick<PoolClient, 'query'>): Promise<number> {
  const r = await q.query(`UPDATE guard_shifts SET open_items = guard_open_items(tenant_id, ARRAY[branch_id], closed_at, false) WHERE closed_at IS NOT NULL AND open_items IS NULL`);
  return r.rowCount ?? 0;
}

/**
 * Demo databases seeded before migration 038 have no security guard: adds the guards (the «Qorovul» demo card), their
 * shifts, patrol checkpoints and rounds, the handling of the seed's camera alerts, incidents, visitors and keys —
 * without a reset. Rows that point at a camera event this database does not have are left out (an alert created by an
 * older seed under another id keeps its manager acknowledgement only). Idempotent: nothing happens once a guard exists.
 */
export async function backfillSeedGuard(q: Pick<PoolClient, 'query'>, demoDate: string): Promise<number> {
  const seeded = (await q.query('SELECT 1 FROM tenants WHERE id = $1', [SEED_IDS.tenant])).rowCount;
  const has = (await q.query(`SELECT 1 FROM memberships WHERE tenant_id = $1 AND role = 'guard' LIMIT 1`, [SEED_IDS.tenant])).rowCount;
  if (!seeded || has) return 0;
  const clock = (await q.query(`SELECT to_char(demo_now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS d, to_char(demo_now() AT TIME ZONE 'Asia/Tashkent', 'HH24:MI') AS t`)).rows[0];
  const demoTime = clock.d === demoDate ? clock.t : clock.d < demoDate ? '00:00' : '23:59';
  const g = buildGuard(buildSeed(demoDate, demoTime), demoDate, demoTime);
  const events = new Set((await q.query(`SELECT id FROM camera_events WHERE tenant_id = $1 AND alert`, [SEED_IDS.tenant])).rows.map((r) => r.id));
  const rooms = new Set((await q.query(`SELECT id FROM rooms WHERE tenant_id = $1`, [SEED_IDS.tenant])).rows.map((r) => r.id));
  const members = new Set((await q.query(`SELECT id FROM memberships WHERE tenant_id = $1`, [SEED_IDS.tenant])).rows.map((r) => r.id));
  const users = new Set((await q.query('SELECT id FROM users')).rows.map((r) => r.id));
  for (const m of g.memberships) members.add(m.id);
  g.users = g.users.filter((u) => !users.has(u.id));
  for (const i of g.security_incidents) {
    if (i.alert_event_id && !events.has(i.alert_event_id)) i.alert_event_id = null;
    if (i.room_id && !rooms.has(i.room_id)) i.room_id = null;
  }
  g.security_alert_actions = g.security_alert_actions.filter((a) => events.has(a.event_id) && members.has(a.actor_membership_id));
  g.key_events = g.key_events.filter((k) => rooms.has(k.room_id) && members.has(k.holder_membership_id));
  g.security_visitors = g.security_visitors.filter((v) => !v.host_membership_id || members.has(v.host_membership_id));
  g.staff_presence_marks = g.staff_presence_marks.filter((m) => members.has(m.membership_id));
  const counters = g.security_counters; g.security_counters = [];
  for (const t of GUARD_TABLES) await insertRows(q as PoolClient, t, g[t]);
  await snapshotGuardShifts(q);
  for (const c of counters)
    await q.query(`INSERT INTO security_counters (tenant_id, kind, last) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, kind) DO UPDATE SET last = GREATEST(security_counters.last, EXCLUDED.last)`, [c.tenant_id, c.kind, c.last]);
  return g.memberships.length;
}

/**
 * The starter lead sources (seed/referrals.ts) of a clinic, idempotent by key: a renamed or switched-off source stays as
 * the manager left it; a name the manager already uses is skipped. Run on create-clinic, demo reset and API start.
 */
export async function ensureLeadSources(q: Pick<PoolClient, 'query'>, tenantId: string): Promise<number> {
  let n = 0;
  for (const [i, s] of STARTER_LEAD_SOURCES.entries()) {
    const r = await q.query(
      `INSERT INTO lead_sources (tenant_id, name, system_key, starter_key, sort) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [tenantId, s.name, s.system ?? null, s.key, (i + 1) * 10]);
    n += r.rowCount ?? 0;
  }
  return n;
}

/**
 * Demo databases seeded before migration 041 have no referral partners: adds the seed's partners, their overrides and
 * payouts, and the lead source / partner / percent snapshot of the seed's cards, visits and orders — without a reset.
 * Only empty fields are filled (a card or visit the demo user already marked keeps its value). Idempotent: nothing
 * happens once the seed clinic has a partner.
 */
export async function backfillSeedReferrals(q: Pick<PoolClient, 'query'>, demoDate: string): Promise<number> {
  const T = SEED_IDS.tenant;
  const seeded = (await q.query('SELECT 1 FROM tenants WHERE id = $1', [T])).rowCount;
  const has = (await q.query('SELECT 1 FROM referral_partners WHERE tenant_id = $1 LIMIT 1', [T])).rowCount;
  if (!seeded || has) return 0;
  const seed = buildSeed(demoDate);
  const tenants = new Set((await q.query('SELECT id FROM tenants WHERE id = ANY($1::uuid[])', [[T, SEED_IDS.tenant2]])).rows.map((r) => r.id));
  for (const t of tenants) await ensureLeadSources(q, t);
  // the database's own ids of the starter sources (ensureLeadSources may have run before with generated ids)
  const dbSource = new Map<string, string>();
  for (const r of (await q.query('SELECT tenant_id, starter_key, id FROM lead_sources WHERE tenant_id = ANY($1::uuid[]) AND starter_key IS NOT NULL', [[...tenants]])).rows)
    dbSource.set(`${r.tenant_id}:${r.starter_key}`, r.id);
  const seedSource = new Map(seed.lead_sources.map((s) => [s.id, dbSource.get(`${s.tenant_id}:${s.starter_key}`) ?? null]));
  const json = (rows: unknown[]) => JSON.stringify(rows);
  await insertRows(q as PoolClient, 'referral_partners', seed.referral_partners);
  await q.query('UPDATE tenants SET partner_seq = GREATEST(partner_seq, $2) WHERE id = $1', [T, Math.max(...seed.referral_partners.map((p) => Number(p.code)))]);
  const services = new Set((await q.query('SELECT id FROM services WHERE tenant_id = $1', [T])).rows.map((r) => r.id));
  await insertRows(q as PoolClient, 'referral_partner_services', seed.referral_partner_services.filter((x) => services.has(x.service_id)));
  await q.query(`UPDATE services s SET partner_percent = r.pct FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, pct numeric)
    WHERE s.id = r.id AND s.tenant_id = $2 AND s.partner_percent IS NULL`, [json(seed.services.filter((s) => s.tenant_id === T && s.partner_percent != null).map((s) => ({ id: s.id, pct: s.partner_percent }))), T]);
  await q.query(`UPDATE patients p SET lead_source_id = r.src FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, src uuid)
    WHERE p.id = r.id AND p.tenant_id = $2 AND p.lead_source_id IS NULL AND r.src IS NOT NULL`,
    [json(seed.patients.filter((p) => p.tenant_id === T).map((p) => ({ id: p.id, src: p.lead_source_id ? seedSource.get(p.lead_source_id) : null }))), T]);
  await q.query(`UPDATE appointments a SET referral_partner_id = r.partner, lead_source_id = coalesce(a.lead_source_id, r.src) FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, partner uuid, src uuid)
    WHERE a.id = r.id AND a.tenant_id = $2 AND a.referral_partner_id IS NULL`,
    [json(seed.appointments.filter((a) => a.tenant_id === T).map((a) => ({ id: a.id, partner: a.referral_partner_id, src: a.lead_source_id ? seedSource.get(a.lead_source_id) : null }))), T]);
  // only orders of visits that now carry that same partner (the snapshot follows the visit)
  await q.query(`UPDATE service_orders o SET referral_partner_id = r.partner, partner_percent_snapshot = r.pct FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, partner uuid, pct numeric)
    WHERE o.id = r.id AND o.tenant_id = $2 AND o.referral_partner_id IS NULL
      AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = o.appointment_id AND a.referral_partner_id = r.partner)`,
    [json(seed.service_orders.filter((o) => o.referral_partner_id).map((o) => ({ id: o.id, partner: o.referral_partner_id, pct: o.partner_percent_snapshot }))), T]);
  const branches = new Set((await q.query('SELECT id FROM branches WHERE tenant_id = $1', [T])).rows.map((r) => r.id));
  await insertRows(q as PoolClient, 'partner_payouts', seed.partner_payouts.filter((p) => branches.has(p.branch_id)));
  return seed.referral_partners.length;
}

/**
 * Demo databases seeded before migration 043 have no discount rules: adds the seed's rules, benefit categories and
 * companies, the payer fields of the seed's cards (only where empty), and the seed's extra past bills with their
 * payments, company payments and the voided transfer's reversals — without a reset (all the bills or none, when a
 * visit changed since); refund numbers continue the clinic's own counter. Idempotent: nothing happens once the seed
 * clinic has a discount rule.
 */
export async function backfillSeedDiscounts(q: Pick<PoolClient, 'query'>, demoDate: string): Promise<number> {
  const T = SEED_IDS.tenant;
  const seeded = (await q.query('SELECT 1 FROM tenants WHERE id = $1', [T])).rowCount;
  const has = (await q.query('SELECT 1 FROM discount_rules WHERE tenant_id = $1 LIMIT 1', [T])).rowCount;
  if (!seeded || has) return 0;
  const seed = buildSeed(demoDate);
  const c = q as PoolClient;
  await insertRows(c, 'discount_rules', seed.discount_rules);
  await insertRows(c, 'benefit_categories', seed.benefit_categories);
  await insertRows(c, 'companies', seed.companies);
  await q.query(`UPDATE patients p SET benefit_category_id = r.b, benefit_note = r.bn, company_id = r.c, company_member_no = r.cn
      FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, b uuid, bn text, c uuid, cn text)
     WHERE p.id = r.id AND p.tenant_id = $2 AND p.benefit_category_id IS NULL AND p.company_id IS NULL AND p.anonymised_at IS NULL`,
    [JSON.stringify(seed.patients.filter((p) => p.tenant_id === T && (p.benefit_category_id || p.company_id))
      .map((p) => ({ id: p.id, b: p.benefit_category_id, bn: p.benefit_note, c: p.company_id, cn: p.company_member_no }))), T]);
  // the post-pass's bills: invoice numbers 8001–8999 (never used by the clinic's own counter)
  const bills = seed.invoices.filter((i) => i.tenant_id === T && i.invoice_number > 8000 && i.invoice_number < 9000);
  const appts = (await q.query(`SELECT count(*)::int AS n FROM appointments WHERE id = ANY($1::uuid[]) AND status = 'completed' AND referral_partner_id IS NULL`, [bills.map((b) => b.appointment_id)])).rows[0].n;
  // the bills, their payments and the company transfers belong together: all of them or none (a visit changed since)
  if (appts !== bills.length) return seed.discount_rules.length;
  const ids = new Set(bills.map((b) => b.id));
  const items = seed.invoice_items.filter((it) => ids.has(it.invoice_id));
  const orderIds = new Set(items.map((it) => it.order_id));
  let refundSeq = Number((await q.query('SELECT refund_seq FROM tenants WHERE id = $1', [T])).rows[0].refund_seq);
  const refunds = seed.refunds.filter((r) => r.reason_code === 'company_payment_void').map((r) => ({ ...r, refund_number: ++refundSeq }));
  await insertRows(c, 'service_orders', seed.service_orders.filter((o) => orderIds.has(o.id)));
  await insertRows(c, 'invoices', bills);
  await insertRows(c, 'invoice_items', items);
  await insertRows(c, 'company_payments', seed.company_payments);
  await insertRows(c, 'payments', seed.payments.filter((p) => ids.has(p.invoice_id)));
  await insertRows(c, 'company_payment_allocations', seed.company_payment_allocations);
  await insertRows(c, 'refunds', refunds);
  await q.query('UPDATE tenants SET refund_seq = $2, company_payment_seq = GREATEST(company_payment_seq, $3) WHERE id = $1', [T, refundSeq, seed.company_payments.length]);
  return seed.discount_rules.length;
}

/** Guard for destructive resets: refuses to run against a database whose name does not match `expectSuffix`. */
export async function assertDatabaseName(q: Pick<PoolClient, 'query'>, expectSuffix: string): Promise<string> {
  const name = (await q.query('SELECT current_database() AS n')).rows[0].n as string;
  if (!name.endsWith(expectSuffix)) throw new Error(`Xavfsizlik to‘xtatdi: «${name}» bazasi «*${expectSuffix}» emas. Test reseti demo bazaga yo‘naltirilmaydi.`);
  return name;
}

export class RealTenantsPresentError extends Error {
  constructor(public count: number) { super(`Bazada ${count} ta demo bo‘lmagan klinika bor — demo reseti barcha jadvallarni tozalaydi, shuning uchun to‘xtatildi.`); }
}

export async function resetDemo(pool: Pool, demoDate: string, demoTime?: string): Promise<{ counts: Record<string, number>; clock: DemoClock }> {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(74002) AS ok')).rows[0].ok;
    if (!locked) throw new ResetInProgressError();
    // A reset truncates every table. Never let it run on a database that also holds a real clinic.
    const foreign = (await client.query(`SELECT count(*)::int AS n FROM tenants WHERE id <> ALL($1::uuid[])`, [[SEED_IDS.tenant, SEED_IDS.tenant2]])).rows[0].n;
    if (foreign > 0) throw new RealTenantsPresentError(foreign);
    const seed = buildSeed(demoDate, demoTime);
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 0');
    const sessions = (await client.query('SELECT * FROM sessions')).rows;
    // A connected Telegram bot and its chats survive a demo reset (only the conversation state starts over).
    const hasTelegram = (await client.query(`SELECT to_regclass('telegram_bots') IS NOT NULL AS ok`)).rows[0].ok;
    const bots = hasTelegram ? (await client.query('SELECT * FROM telegram_bots')).rows : [];
    const chats = hasTelegram ? (await client.query(`SELECT * FROM telegram_chats`)).rows.map((r) => ({ ...r, state: '{}' })) : [];
    // the clinic's SMS gateway account (migration 022) survives too; the delivery log starts over
    const hasSms = (await client.query(`SELECT to_regclass('sms_settings') IS NOT NULL AS ok`)).rows[0].ok;
    const smsSettings = hasSms ? (await client.query('SELECT * FROM sms_settings')).rows : [];
    // and the DMED connection settings (migration 029); the outbox starts over
    const hasDhp = (await client.query(`SELECT to_regclass('dhp_settings') IS NOT NULL AS ok`)).rows[0].ok;
    const dhpSettings = hasDhp ? (await client.query('SELECT * FROM dhp_settings')).rows : [];
    // and the bot's question-answering switch and the manager's extra text (migration 035); the daily counters start over
    const hasFaq = (await client.query(`SELECT to_regclass('telegram_faq_settings') IS NOT NULL AS ok`)).rows[0].ok;
    const faqSettings = hasFaq ? (await client.query('SELECT * FROM telegram_faq_settings')).rows.map((r) => ({ ...r, updated_by: null })) : [];
    const all = ['sessions', ...TABLES_IN_INSERT_ORDER, ...GUARD_TABLES.filter((t) => t !== 'users' && t !== 'memberships')].reverse();
    await client.query(`TRUNCATE ${all.join(', ')} RESTART IDENTITY CASCADE`);
    const counts: Record<string, number> = {};
    await linkSeedPrescriptions(client, seed.medical_documents);
    for (const t of TABLES_IN_INSERT_ORDER) {
      await insertRows(client, t, seed[t] as Record<string, unknown>[]);
      counts[t] = seed[t].length;
    }
    // the security guard's demo data (migration 038): built from the rows above with its own PRNG (KPIs unchanged)
    const guard = buildGuard(seed, demoDate, demoTime);
    for (const t of GUARD_TABLES) { await insertRows(client, t, guard[t]); counts['guard_' + t] = guard[t].length; }
    await snapshotGuardShifts(client);
    // seed medicines point at the drug reference (its ids are generated by the database)
    for (const [itemId, inn] of seedDrugLinks()) await client.query(`UPDATE inventory_items SET drug_id = (SELECT id FROM drugs WHERE inn = $2) WHERE id = $1`, [itemId, inn]);
    await client.query(`SELECT setval('face_code_staff_seq', GREATEST((SELECT max(substring(code from 3)::int) FROM face_codes WHERE subject_type = 'staff'), 1))`);
    const membershipIds = new Set([...seed.memberships, ...guard.memberships].map((m) => m.id));
    await insertRows(client, 'sessions', sessions.filter((s) => membershipIds.has(s.membership_id)));
    const tenantIds = new Set(seed.tenants.map((t) => t.id));
    const keptBots = bots.filter((b) => tenantIds.has(b.tenant_id));
    await insertRows(client, 'telegram_bots', keptBots);
    const keptBotIds = new Set(keptBots.map((b) => b.id));
    await insertRows(client, 'telegram_chats', chats.filter((c) => keptBotIds.has(c.bot_id)));
    await insertRows(client, 'sms_settings', smsSettings.filter((s) => tenantIds.has(s.tenant_id)));
    await insertRows(client, 'dhp_settings', dhpSettings.filter((s) => tenantIds.has(s.tenant_id)));
    await insertRows(client, 'telegram_faq_settings', faqSettings.filter((s) => tenantIds.has(s.tenant_id)));
    // templates and phrases are not part of the seed tables (a static list, no PRNG): the starter set comes back after the wipe
    for (const t of seed.tenants) { await ensureStarterTemplates(client, t.id as string); await ensureLeadSources(client, t.id as string); }
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

export { hashPassword, verifyPassword, generateTempPassword } from './password';
