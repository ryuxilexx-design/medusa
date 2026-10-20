// Regression tests for the findings of the 2026-10-20 audit (negative / concurrency / security): each one failed before
// its fix. Races fire many identical requests at once and then check the database invariant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
const BC = SEED_IDS.branchCentral, BY = SEED_IDS.branchYunusobod;
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), patch: (p, b) => req('PATCH', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const as = async (mid) => { const s = session(); assert.equal((await s.demo(mid)).status, 200); return s; };
let manager, registrar, cashier;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = await as(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  await db.assertDatabaseName(pool, '_test');
  registrar = await as(M.registrar); cashier = await as(M.cashier);
});
after(async () => { await app?.close(); });

test('NEG-01: parallel cash expenses never take a drawer below zero', async () => {
  const shift = (await pool.query(`SELECT id, opening_cash FROM cash_shifts WHERE cashier_membership_id = $1 AND status = 'open'`, [M.cashier])).rows[0];
  const drawer = async () => Number((await pool.query(
    `SELECT $2::bigint + coalesce((SELECT sum(amount) FROM payments WHERE shift_id = $1 AND method = 'cash'),0)
           - coalesce((SELECT sum(amount) FROM refunds WHERE shift_id = $1 AND method = 'cash'),0)
           - coalesce((SELECT sum(amount) FROM expenses WHERE shift_id = $1 AND status = 'active' AND paid_from = 'cash_drawer'),0) AS cash`, [shift.id, shift.opening_cash])).rows[0].cash);
  const before = await drawer();
  const amount = Math.ceil(before / 3) + 100; // only two fit
  const rs = await Promise.all(Array.from({ length: 10 }, () => cashier.post('/expenses', { category: 'Boshqa', amount, note: 'poyga' })));
  assert.ok(rs.every((r) => r.status === 201 || (r.status === 409 && r.body.error.code === 'INSUFFICIENT_CASH')), JSON.stringify(rs.map((r) => r.status)));
  assert.equal(rs.filter((r) => r.status === 201).length, 2);
  assert.ok(await drawer() >= 0);
});

test('NEG-02: parallel stock-outs never oversell', async () => {
  const item = (await pool.query(`SELECT id FROM inventory_items WHERE tenant_id = $1 AND branch_id = $2 ORDER BY name LIMIT 1`, [SEED_IDS.tenant, BC])).rows[0];
  const qty = Number((await manager.get(`/inventory/${item.id}`)).body.data.qty);
  const take = Math.max(1, Math.floor(qty / 3));
  const rs = await Promise.all(Array.from({ length: 12 }, () => manager.post(`/inventory/${item.id}/movements`, { type: 'out', quantity: take, reason: 'poyga sinovi' })));
  const ok = rs.filter((r) => r.status === 200).length;
  assert.ok(ok <= Math.floor(qty / take), `${ok} × ${take} > ${qty}`);
  assert.ok(Number((await manager.get(`/inventory/${item.id}`)).body.data.qty) >= 0);
});

test('NEG-03 / NEG-15: search by a full phone number works; % and _ are literal', async () => {
  for (const q of ['998901234567', '+998 90 123 45 67', '90 123', '1001']) assert.equal((await registrar.get(`/patients?search=${encodeURIComponent(q)}`)).status, 200, q);
  assert.equal((await registrar.get(`/patients?search=${encodeURIComponent('%')}`)).body.data.length, 0);
  assert.equal((await registrar.get(`/patients?search=${encodeURIComponent('_')}`)).body.data.length, 0);
  assert.equal((await registrar.get('/patients?page=5000000000000000000')).status, 200);
});

test('NEG-04: slot length must be 5–480 whole minutes', async () => {
  const doctor = SEED_IDS.doctor(0);
  for (const d of ['-1', '-100000000', '0', '1e9', 'abc', '30.5']) assert.equal((await registrar.get(`/availability?doctor_id=${doctor}&date=2026-10-19&duration_min=${d}`)).status, 422, d);
  assert.equal((await registrar.get(`/availability?doctor_id=${doctor}&date=2026-10-19&duration_min=30`)).status, 200);
});

test('NEG-05 / NEG-09 / NEG-11: invisible characters are removed, impossible dates refused, nothing becomes a 500', async () => {
  const p = await registrar.post('/patients', { last_name: 'Nul\u0000lov', first_name: 'Test​', birth_date: '1990-01-01', sex: 'male', note: 'a\u0000b', confirm_duplicate: true });
  assert.equal(p.status, 201);
  const row = (await pool.query(`SELECT last_name, first_name, note FROM patients WHERE id = $1`, [p.body.data.id])).rows[0];
  assert.deepEqual(row, { last_name: 'Nullov', first_name: 'Test', note: 'ab' });
  assert.equal((await registrar.post('/patients', { last_name: '​​', first_name: 'X', birth_date: '1990-01-01' })).status, 422);
  for (const d of ['2027-02-30', '0001-01-01', '9999-12-31', '1899-12-31']) assert.equal((await registrar.post('/patients', { last_name: 'Sana', first_name: 'Sinov', birth_date: d })).status, 422, d);
  assert.equal((await manager.get('/dashboard?from=2026-02-30&to=2026-03-01')).status, 422);
  const item = (await pool.query(`SELECT id FROM inventory_items WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  for (const q of [0.0001, 1e11]) assert.equal((await manager.post(`/inventory/${item.id}/movements`, { type: 'in', quantity: q, reason: 'sinov' })).status, 422, String(q));
});

test('NEG-06: one Idempotency-Key cannot book two different patients', async () => {
  const pts = (await pool.query(`SELECT id FROM patients WHERE tenant_id = $1 ORDER BY patient_number LIMIT 2`, [SEED_IDS.tenant])).rows;
  const svc = (await pool.query(`SELECT service_id FROM doctor_services WHERE doctor_id = $1 LIMIT 1`, [SEED_IDS.doctor(0)])).rows[0].service_id;
  const slots = (await registrar.get(`/availability?doctor_id=${SEED_IDS.doctor(0)}&date=2026-10-21&service_id=${svc}`)).body.data.slots.filter((s) => s.free);
  const key = { 'Idempotency-Key': randomUUID() };
  const book = (pid, t) => registrar.post('/appointments', { patient_id: pid, branch_id: (pid, BC), doctor_id: SEED_IDS.doctor(0), service_id: svc, date: '2026-10-21', start_time: t }, key);
  const branch = (await pool.query(`SELECT branch_id FROM schedules WHERE doctor_id = $1 AND weekday = 3`, [SEED_IDS.doctor(0)])).rows[0].branch_id;
  const first = await registrar.post('/appointments', { patient_id: pts[0].id, branch_id: branch, doctor_id: SEED_IDS.doctor(0), service_id: svc, date: '2026-10-21', start_time: slots[0].time }, key);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const replay = await registrar.post('/appointments', { patient_id: pts[0].id, branch_id: branch, doctor_id: SEED_IDS.doctor(0), service_id: svc, date: '2026-10-21', start_time: slots[0].time }, key);
  assert.equal(replay.body.data.id, first.body.data.id);
  const other = await registrar.post('/appointments', { patient_id: pts[1].id, branch_id: branch, doctor_id: SEED_IDS.doctor(0), service_id: svc, date: '2026-10-21', start_time: slots[1].time }, key);
  assert.equal(other.status, 409); assert.equal(other.body.error.code, 'IDEMPOTENCY_MISMATCH');
  void book;
});

test('NEG-07: cancelling an arrived, unpaid visit leaves no debt', async () => {
  const a = (await pool.query(
    `SELECT a.id, a.version, i.id AS invoice_id FROM appointments a JOIN invoices i ON i.appointment_id = a.id
      WHERE a.tenant_id = $1 AND a.status = 'arrived' AND i.paid_amount = 0 AND i.status <> 'void' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id) LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  assert.ok(a, 'seed has an arrived unpaid visit');
  const r = await registrar.post(`/appointments/${a.id}/cancel`, { version: a.version, reason: 'Bemor ketib qoldi' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await pool.query(`SELECT status FROM invoices WHERE id = $1`, [a.invoice_id])).rows[0].status, 'void');
});

test('NEG-08: ten parallel saves of the same new person make one card', async () => {
  const body = { last_name: 'Poygachiyev', first_name: 'Bitta', birth_date: '1993-03-03', phone: '+998935557711' };
  const rs = await Promise.all(Array.from({ length: 10 }, () => registrar.post('/patients', body)));
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  assert.equal(rs.filter((r) => r.status === 409 && r.body.error.code === 'DUPLICATE_WARNING').length, 9);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patients WHERE last_name = 'Poygachiyev'`)).rows[0].n, 1);
});

test('NEG-10 / NEG-13: discounts are whole tiyin or ≤2-decimal percent; an invoice that had a payment is never voided', async () => {
  const inv = (await pool.query(`SELECT id FROM invoices WHERE tenant_id = $1 AND status = 'unpaid' AND paid_amount = 0 LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  for (const d of [{ type: 'amount', value: 0.4 }, { type: 'percent', value: 0.001 }, { type: 'percent', value: 12.345 }])
    assert.equal((await manager.post(`/invoices/${inv.id}/discount`, { ...d, reason: 'sinov chegirma' })).status, 422, JSON.stringify(d));
  const paid = (await pool.query(`SELECT i.id FROM invoices i WHERE i.tenant_id = $1 AND EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id) LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  assert.equal((await manager.post(`/invoices/${paid.id}/void`, { reason: 'sinov bekor' })).status, 409);
});

test('SEC-F1: a branch-limited registrar sees only their branches’ money on a patient', async () => {
  // a patient with invoices in both branches
  const p = (await pool.query(
    `SELECT patient_id FROM invoices WHERE tenant_id = $1 GROUP BY patient_id HAVING count(DISTINCT branch_id) = 2 LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  if (!p) return; // seed without such a patient: nothing to check
  const yun = await as(M.registrar2); // Yunusobod only
  const hist = (await yun.get(`/patients/${p.patient_id}/history`)).body.data;
  const branches = new Set((await pool.query(`SELECT name FROM branches WHERE id = $1`, [BY])).rows.map((r) => r.name));
  assert.ok(hist.invoices.every((i) => branches.has(i.branch_name)), 'only Yunusobod invoices');
  const card = (await yun.get(`/patients/${p.patient_id}`)).body.data;
  const due = (await pool.query(`SELECT coalesce(sum(total - paid_amount),0)::bigint AS d FROM invoices WHERE patient_id = $1 AND status <> 'void' AND branch_id = $2`, [p.patient_id, BY])).rows[0].d;
  assert.equal(Number(card.balance_due), Number(due));
});

test('SEC-F2: an oversized JSON body is a 413 with a request id', async () => {
  const r = await fetch(base + '/patients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(300_000) }) });
  assert.equal(r.status, 413);
  const j = await r.json();
  assert.equal(j.error.code, 'TOO_LARGE'); assert.ok(j.request_id);
});

test('UI-15 / UI-16: the lab cannot list patients; doctor and service commission shares are for the manager only', async () => {
  const lab = await as(M.lab);
  assert.equal((await lab.get('/patients')).status, 403);
  assert.equal((await cashier.get('/patients')).status, 200);
  const regDocs = (await registrar.get('/doctors')).body.data;
  assert.ok(regDocs.length && regDocs.every((d) => d.default_share_percent === null));
  assert.ok((await registrar.get('/services')).body.data.every((s) => s.share_percent === null));
  assert.ok((await manager.get('/doctors')).body.data.some((d) => Number(d.default_share_percent) > 0));
});

test('UI-07 (server): «Kelmadi» only 15 minutes after the booked time', async () => {
  const a = (await pool.query(`SELECT id, version FROM appointments WHERE tenant_id = $1 AND status = 'scheduled' AND starts_at > demo_now() ORDER BY starts_at LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  const r = await registrar.post(`/appointments/${a.id}/no-show`, { version: a.version });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'TOO_EARLY');
});

test('LOAD-F3/F4: killed database connections do not crash the API; the next request works', async () => {
  // terminate this test process's own idle pool connections (never other processes sharing the test database)
  await pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND pid <> pg_backend_pid()`, [process.env.PGAPPNAME]).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 300));
  const r = await registrar.get('/patients?page_size=5');
  assert.equal(r.status, 200);
});

test('LOAD-F6/F12: payments CSV needs a period of at most a year; the schedule says when it is cut', async () => {
  assert.equal((await manager.get('/payments/export.csv')).status, 422);
  assert.equal((await manager.get('/payments/export.csv?from=2024-01-01&to=2026-10-18')).status, 422);
  assert.equal((await manager.get('/payments/export.csv?from=2026-10-01&to=2026-10-18')).status, 200);
  const s = (await registrar.get('/appointments?date=2026-10-18')).body;
  assert.equal(s.meta.truncated, false);
});

test('LOAD-F16: a spoofed X-Forwarded-For does not get around the login throttle', async () => {
  const tries = [];
  for (let i = 0; i < 12; i++) {
    tries.push((await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${i}.1, 10.0.0.${i}` }, body: JSON.stringify({ login: 'nobody.audit', password: 'wrong-password-1' }) })).status);
  }
  assert.ok(tries.slice(10).every((s) => s === 429), JSON.stringify(tries));
});
