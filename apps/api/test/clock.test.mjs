// Demo clock: a restart keeps time moving forward; only an explicit reset moves it back to DEMO_DATE + DEMO_TIME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, db } from './_helpers.mjs';

async function session(base, mid) {
  const r = await fetch(base + '/demo/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ membership_id: mid }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return (p, method = 'GET') => fetch(base + p, { method, headers: { cookie } }).then((x) => x.json());
}

test('API qayta ishga tushsa demo vaqti orqaga qaytmaydi; reset vaqt va ma’lumotni birga tiklaydi', async () => {
  let { app, base } = await bootTestApp();
  try {
  let get = await session(base, db.SEED_IDS.membership.manager);
  await get('/demo/reset', 'POST');
  const t0 = new Date((await get('/me')).data.now);
  assert.equal(t0.toISOString().slice(0, 10), '2026-10-18');
  // something happens at demo time t0 + ε, then the API restarts
  const audit1 = (await get('/audit?action=demo.reset&page_size=1')).data[0];
  assert.ok(Math.abs(new Date(audit1.occurred_at) - t0) < 5000, 'reset auditi demo vaqti bilan yozilgan');
  await new Promise((r) => setTimeout(r, 1200));
  await app.close();
  ({ app, base } = await bootTestApp());
  get = await session(base, db.SEED_IDS.membership.manager);
  const t1 = new Date((await get('/me')).data.now);
  assert.ok(t1.getTime() >= t0.getTime() + 1000, `restartdan keyin vaqt oldinga yurdi: ${t0.toISOString()} → ${t1.toISOString()}`);
  assert.ok(new Date(audit1.occurred_at).getTime() <= t1.getTime(), 'reset auditi kelajakda emas');
  // payment/audit timestamps come from the same clock
  const dash = (await get('/dashboard')).data;
  assert.equal(dash.range.from, '2026-10-18');
  await get('/demo/reset', 'POST');
  const t2 = new Date((await get('/me')).data.now);
  assert.ok(t2.getTime() < t1.getTime(), 'reset vaqtni boshlang‘ich nuqtaga qaytardi');
  } finally { await app.close(); }
});

test('xavfsizlik: test helperi demo bazaga ulanishni rad etadi', async () => {
  const { Pool } = await import('pg').then((m) => m.default ?? m);
  // the same server as the test database, but a database whose name does not end in _test (CI has no «meduza» demo DB)
  const u = new URL(process.env.DATABASE_URL); u.pathname = '/postgres';
  const demo = new Pool({ connectionString: u.toString(), max: 1 });
  await assert.rejects(() => db.assertDatabaseName(demo, '_test'), /Xavfsizlik to‘xtatdi/);
  await demo.end();
});
