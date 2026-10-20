// Shared test setup. Tests ALWAYS run against a separate *_test database and never touch the demo database.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TEST_URL = process.env.TEST_DATABASE_URL || 'postgres://meduza:meduza_local@127.0.0.1:5433/meduza_test';
const demoUrl = process.env.DATABASE_URL;
if (!/\/[a-z0-9_]+_test(\?|$)/.test(TEST_URL)) throw new Error(`Xavfsizlik to‘xtatdi: TEST_DATABASE_URL «*_test» bazaga ishora qilishi shart: ${TEST_URL}`);
if (demoUrl && demoUrl === TEST_URL) throw new Error('Xavfsizlik to‘xtatdi: test va demo bazasi bir xil');
process.env.DATABASE_URL = TEST_URL;
process.env.MEDUZA_TEST = '1';
process.env.DEMO_TIME = process.env.TEST_DEMO_TIME || '07:30';
process.env.AI_MODE = 'sample';
process.env.APP_MODE = 'demo';
process.env.PGAPPNAME = `meduza-test-${process.pid}`; // lets a test find (and kill) only its own connections
process.env.TRUST_PROXY_HOPS = '0'; // tests call the API directly: no proxy in front
export const { createApp } = require('../dist/app.js');
export const db = require('@meduza/db');

/** Boots the API in-process and verifies (again, from inside the DB connection) that it is the test database. */
export async function bootTestApp() {
  const app = await createApp();
  const { Db } = require('../dist/core/db.js');
  const pool = app.get(Db).pool;
  await db.assertDatabaseName(pool, '_test');
  // A brand-new test database has no accounts yet: seed it once (only ever on *_test).
  if (!(await pool.query('SELECT count(*)::int AS n FROM tenants')).rows[0].n) await db.resetDemo(pool, '2026-10-18', process.env.DEMO_TIME);
  await app.listen(0, '127.0.0.1');
  return { app, base: `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1` };
}
