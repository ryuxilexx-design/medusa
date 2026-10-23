import { Pool, PoolClient, types } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { buildSeed, SeedData, DEMO_TIMEZONE_OFFSET_HOURS, SEED_IDS } from '../seed/build';
import { STARTER_TEMPLATES } from '../seed/templates';
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
  'doctor_services', 'patients', 'patient_consents', 'appointments', 'queue_counters', 'queue_tickets', 'encounters', 'clinical_notes',
  'service_orders', 'lab_results', 'diagnostic_reports', 'invoices', 'invoice_items', 'cash_shifts', 'payments', 'expenses',
  'inventory_items', 'inventory_movements', 'audit_logs', 'cameras', 'face_codes', 'camera_events', 'camera_event_acks', 'arrival_suggestions', 'camera_snapshots',
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
    const all = ['sessions', ...TABLES_IN_INSERT_ORDER].reverse();
    await client.query(`TRUNCATE ${all.join(', ')} RESTART IDENTITY CASCADE`);
    const counts: Record<string, number> = {};
    for (const t of TABLES_IN_INSERT_ORDER) {
      await insertRows(client, t, seed[t] as Record<string, unknown>[]);
      counts[t] = seed[t].length;
    }
    await client.query(`SELECT setval('face_code_staff_seq', GREATEST((SELECT max(substring(code from 3)::int) FROM face_codes WHERE subject_type = 'staff'), 1))`);
    const membershipIds = new Set(seed.memberships.map((m) => m.id));
    await insertRows(client, 'sessions', sessions.filter((s) => membershipIds.has(s.membership_id)));
    const tenantIds = new Set(seed.tenants.map((t) => t.id));
    const keptBots = bots.filter((b) => tenantIds.has(b.tenant_id));
    await insertRows(client, 'telegram_bots', keptBots);
    const keptBotIds = new Set(keptBots.map((b) => b.id));
    await insertRows(client, 'telegram_chats', chats.filter((c) => keptBotIds.has(c.bot_id)));
    await insertRows(client, 'sms_settings', smsSettings.filter((s) => tenantIds.has(s.tenant_id)));
    await insertRows(client, 'dhp_settings', dhpSettings.filter((s) => tenantIds.has(s.tenant_id)));
    // templates and phrases are not part of the seed tables (a static list, no PRNG): the starter set comes back after the wipe
    for (const t of seed.tenants) await ensureStarterTemplates(client, t.id as string);
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
