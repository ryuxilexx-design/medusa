// Operations: the public health check, sliding session expiry, the one route with a 3 MB body and the operator's
// password reset from the server console (database/src/cli.ts reset-password).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool;

function session() {
  const s = { cookie: '' };
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: s.cookie, ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) s.cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t, headers: r.headers };
  };
  s.get = (p) => req('GET', p); s.post = (p, b = {}, h) => req('POST', p, b, h);
  s.demo = (mid) => req('POST', '/demo/login', { membership_id: mid });
  s.login = (login, password) => req('POST', '/auth/login', { login, password });
  s.hash = () => createHash('sha256').update(s.cookie.split('=')[1]).digest('hex');
  return s;
}

let manager;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); assert.equal((await manager.demo(M.manager)).status, 200);
  assert.equal((await manager.post('/demo/reset')).status, 200);
});
after(async () => { await app?.close(); });

test('health: sessiyasiz 200, baza va versiya; demo soati; audit va so‘rov jurnali yo‘q', async () => {
  const r = await fetch(base + '/health');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.db, 'ok');
  assert.ok(typeof j.version === 'string' && j.version.length, 'versiya bor');
  assert.match(j.demo_clock, /^2026-10-18T/, 'demo rejimida demo soati ko‘rsatiladi');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(Number((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE 'health%'`)).rows[0].n), 0);
  // a wrong method is still a plain 404, never a stack trace
  assert.equal((await fetch(base + '/health', { method: 'POST' })).status, 404);
});

test('sessiya: faollik muddatni uzaytiradi (SESSION_TTL_HOURS), lekin kirishdan SESSION_MAX_HOURS dan oshmaydi', async () => {
  const { config } = require('../dist/core/config.js');
  const s = session(); assert.equal((await s.demo(M.cashier)).status, 200);
  const h = s.hash();
  const row0 = (await pool.query(`SELECT created_at, expires_at FROM sessions WHERE token_hash = $1`, [h])).rows[0];
  assert.ok(row0, 'sessiya bazada');
  // 1) signed in an hour ago, 10 minutes left, last seen 5 minutes ago: one request pushes the expiry out by the idle TTL
  await pool.query(`UPDATE sessions SET created_at = now() - interval '1 hour', expires_at = now() + interval '10 minutes', last_seen_at = now() - interval '5 minutes' WHERE token_hash = $1`, [h]);
  assert.equal((await s.get('/me')).status, 200);
  let row = (await pool.query(`SELECT created_at, expires_at, (expires_at - now()) AS left FROM sessions WHERE token_hash = $1`, [h])).rows[0];
  const hoursLeft = (new Date(row.expires_at) - Date.now()) / 3600_000;
  assert.ok(hoursLeft > config.sessionTtlHours - 0.1 && hoursLeft <= config.sessionTtlHours + 0.1, `uzaytirildi: ${hoursLeft.toFixed(2)} soat qoldi`);
  // 2) signed in 13 hours ago: the extension stops at created_at + max (14 h) — not another 12 hours
  await pool.query(`UPDATE sessions SET created_at = now() - interval '13 hours', expires_at = now() + interval '10 minutes', last_seen_at = now() - interval '5 minutes' WHERE token_hash = $1`, [h]);
  assert.equal((await s.get('/me')).status, 200);
  row = (await pool.query(`SELECT created_at, expires_at FROM sessions WHERE token_hash = $1`, [h])).rows[0];
  const sinceLogin = (new Date(row.expires_at) - new Date(row.created_at)) / 3600_000;
  assert.ok(Math.abs(sinceLogin - config.sessionMaxHours) < 0.05, `chegara: kirishdan ${sinceLogin.toFixed(2)} soat`);
  // 3) past the cap the session is gone, whatever the activity
  await pool.query(`UPDATE sessions SET created_at = now() - interval '15 hours', expires_at = now() - interval '1 second', last_seen_at = now() - interval '5 minutes' WHERE token_hash = $1`, [h]);
  assert.equal((await s.get('/me')).status, 401);
  // a request within the same minute does not touch the row (no write per request)
  const s2 = session(); assert.equal((await s2.demo(M.cashier)).status, 200);
  const before = (await pool.query(`SELECT expires_at, last_seen_at FROM sessions WHERE token_hash = $1`, [s2.hash()])).rows[0];
  await s2.get('/me');
  const afterReq = (await pool.query(`SELECT expires_at, last_seen_at FROM sessions WHERE token_hash = $1`, [s2.hash()])).rows[0];
  assert.deepEqual(afterReq, before);
});

test('so‘rov hajmi: yuz surati yo‘li 3 MB gacha qabul qiladi (413 emas), undan katta — 413; boshqa yo‘llarda 100 kB chegarasi qoladi', async () => {
  const id = randomUUID();
  const mb = (n) => 'A'.repeat(Math.round(n * 1024 * 1024));
  // 1.5 MB JSON: parsed, then refused by the schema / as an unknown code — proof that the body got through the parser
  const okSize = await manager.post(`/cameras/face-codes/${id}/photo`, `{"photo_base64":"${mb(1.5)}","camera_ids":["${id}"]}`);
  assert.ok([404, 422].includes(okSize.status), okSize.text); assert.notEqual(okSize.body.error.code, 'TOO_LARGE');
  const tooBig = await manager.post(`/cameras/face-codes/${id}/photo`, `{"photo_base64":"${mb(3.2)}","camera_ids":["${id}"]}`);
  assert.equal(tooBig.status, 413, tooBig.text); assert.equal(tooBig.body.error.code, 'TOO_LARGE');
  assert.ok(tooBig.body.request_id, 'xato javobida request_id');
  // any other route keeps the small default
  const other = await manager.post('/patients', `{"last_name":"${mb(0.2)}"}`);
  assert.equal(other.status, 413, other.text);
});

test('CLI reset-password: yangi vaqtinchalik parol bir marta, qulf ochiladi, sessiyalar yopiladi; noto‘g‘ri klinika — rad', async () => {
  const branchId = (await manager.get('/me')).body.data.branches[0].id;
  const created = await manager.post('/staff', { full_name: 'Sinov Rahbar', role: 'cashier', login: '+998 90 777 66 55', branch_ids: [branchId] });
  assert.equal(created.status, 201, created.text);
  const { login } = created.body.data;
  // the person is signed in and locked out at the same time (forgot the password after a few tries)
  const staff = session();
  assert.equal((await staff.login(login, created.body.data.temp_password)).status, 200);
  assert.equal((await staff.get('/me')).status, 200);
  await pool.query(`UPDATE users SET failed_logins = 5, locked_until = now() + interval '15 minutes' WHERE login = $1`, [login]);
  assert.equal((await session().login(login, created.body.data.temp_password)).status, 429);

  const cli = resolve(fileURLToPath(import.meta.url), '../../../../database/dist/src/cli.js');
  const run = (args) => new Promise((done) => execFile(process.execPath, [cli, 'reset-password', ...args], { env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL } }, (err, stdout, stderr) => done({ code: err?.code ?? 0, stdout, stderr })));
  const wrong = await run(['--login', login, '--tenant', 'Boshqa klinika']);
  assert.notEqual(wrong.code, 0); assert.match(wrong.stderr, /ishlamaydi/);
  assert.equal((await staff.get('/me')).status, 200, 'rad etilgan buyruq sessiyaga tegmaydi');
  const missing = await run(['--login', '+998901234500']);
  assert.notEqual(missing.code, 0); assert.match(missing.stderr, /topilmadi/);
  const noArgs = await run([]);
  assert.equal(noArgs.code, 2); assert.match(noArgs.stderr, /db:reset-password/);

  const r = await run(['--login', '+998 90 777 66 55', '--tenant', 'Med.uz.ai Demo Clinic']);
  assert.equal(r.code, 0, r.stderr);
  const temp = /vaqtinchalik parol: (\S+)/.exec(r.stdout)?.[1];
  assert.match(temp ?? '', /^[a-z2-9]{10}$/, 'parol chiqarildi');
  assert.match(r.stdout, /yopilgan sessiyalar: 1/);
  assert.equal((await staff.get('/me')).status, 401, 'eski sessiya yopildi');
  const u = (await pool.query(`SELECT must_change_password, failed_logins, locked_until, password_hash FROM users WHERE login = $1`, [login])).rows[0];
  assert.equal(u.must_change_password, true); assert.equal(u.failed_logins, 0); assert.equal(u.locked_until, null);
  assert.ok(!u.password_hash.includes(temp));
  assert.equal(Number((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'staff.password_reset' AND actor_name = 'CLI'`)).rows[0].n), 1);
  const again = session();
  assert.equal((await again.login(login, temp)).status, 200);
  assert.equal((await again.get('/me')).body.data.must_change_password, true);
  assert.equal((await again.get('/patients')).status, 403, 'parol almashtirilmaguncha boshqa yo‘llar yopiq');
});
