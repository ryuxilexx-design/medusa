// Failure modes. Usage: node failures.mjs <pool|terminate|slowloris|slowreader|login|loginxff|loginok>
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { BASE, demoLogin, passwordLogin, req, run } from './lib.mjs';
import { LT_PASSWORD, sql } from './setup.mjs';

const what = process.argv[2];
const MGR = '96806128-c685-515d-beb8-a777eb562a19', REG = 'c8b9bc9d-e4d6-5c9c-b672-2ccfed7505d1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (s, p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
const apiPid = () => Number(readFileSync(process.env.LT_API_PID, 'utf8'));
const alive = () => { try { process.kill(apiPid(), 0); return true; } catch { return false; } };
const rss = () => { try { return Math.round(Number(execFileSync('ps', ['-o', 'rss=', '-p', String(apiPid())], { encoding: 'utf8' }).trim()) / 1024); } catch { return null; } };

/** Polls a cheap authenticated endpoint every `every` ms until stop(); returns latency stats. */
function poller(path, cookie, every = 100) {
  const lats = []; const st = {}; let on = true;
  const p = (async () => { while (on) { const r = await req(path, { cookie, timeoutMs: 120_000 }); lats.push(r.ms); st[r.status || r.error] = (st[r.status || r.error] || 0) + 1; await sleep(every); } })();
  return async () => { on = false; await p; lats.sort((a, b) => a - b); return { path, n: lats.length, p50: Math.round(pct(lats, 50)), p95: Math.round(pct(lats, 95)), max: Math.round(lats.at(-1)), statuses: st }; };
}

if (what === 'pool') {
  // 30 managers on the 1-year dashboard occupy the 10-connection pool; a registrar's /me and the camera push wait behind them
  const mgr = await Promise.all(Array.from({ length: 5 }, () => demoLogin(MGR)));
  const reg = await demoLogin(REG);
  const base = poller('/me', reg); await sleep(3000); console.log('idle /me', JSON.stringify(await base()));
  const stopMe = poller('/me', reg); const stopQ = poller('/queue?date=2026-10-18', reg, 250);
  const hik = (async () => { const l = []; for (let i = 0; i < 20; i++) { const r = await req(BASE.replace('/api/v1', '') + '/api/v1/hik/lt-load-camera-token-c1', { method: 'POST', body: '<EventNotificationAlert><eventType>videoloss</eventType><eventState>inactive</eventState><dateTime>2026-10-18T07:00:00+05:00</dateTime></EventNotificationAlert>', headers: { 'content-type': 'application/xml' }, timeoutMs: 120_000 }); l.push(Math.round(r.ms)); await sleep(500); } return l; })();
  await run('pool.dashboard1y.c30', { concurrency: 30, durationS: 20, make: (i, w) => ({ path: '/dashboard?from=2025-10-19&to=2026-10-18', cookie: mgr[w % 5], timeoutMs: 180_000 }) });
  console.log('during: /me', JSON.stringify(await stopMe()));
  console.log('during: /queue', JSON.stringify(await stopQ()));
  console.log('during: camera heartbeat ms', JSON.stringify(await hik));
}

if (what === 'terminate') {
  const reg = await Promise.all(Array.from({ length: 5 }, () => demoLogin(REG)));
  const load = run('terminate.queue.c20', { concurrency: 20, durationS: 25, make: (i, w) => ({ path: '/queue?date=2026-10-18', cookie: reg[w % 5] }) });
  await sleep(6000);
  const killed = sql(`SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = 'meduza_load_test' AND pid <> pg_backend_pid() AND backend_type = 'client backend'`);
  console.log('terminated backends:', killed, 'api alive right after:', alive());
  await sleep(4000);
  // second wave while the pool is idle between requests: the classic "idle client error" path
  console.log('api alive +4s:', alive());
  await load;
  console.log('api alive after load:', alive());
  const idle = await demoLogin(REG); await req('/me', { cookie: idle }); await sleep(1500);
  const killed2 = sql(`SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = 'meduza_load_test' AND pid <> pg_backend_pid() AND backend_type = 'client backend'`);
  await sleep(1500);
  console.log('terminated idle pool backends:', killed2, 'api alive:', alive());
  const r = await req('/me', { cookie: idle }); console.log('first request after idle kill:', r.status, r.error ?? '', Math.round(r.ms), 'ms');
}

if (what === 'slowloris') {
  const url = new URL(BASE); const socks = [];
  const reg = await demoLogin(REG);
  const N = Number(process.argv[3] || 2000);
  for (let i = 0; i < N; i++) {
    const s = net.connect(Number(url.port), url.hostname); s.on('error', () => {});
    s.write(`GET /api/v1/me HTTP/1.1\r\nHost: x\r\n`); socks.push(s);
  }
  const drip = setInterval(() => { for (const s of socks) if (!s.destroyed) s.write(`X-a: b\r\n`); }, 10_000);
  await sleep(2000);
  const stop = poller('/me', reg, 200); await sleep(20_000);
  console.log(`with ${N} slow-header sockets: /me`, JSON.stringify(await stop()), 'open sockets:', socks.filter((s) => !s.destroyed).length, 'rss MB', rss());
  await sleep(50_000);
  console.log('after 72 s: open slow sockets', socks.filter((s) => !s.destroyed).length);
  clearInterval(drip); socks.forEach((s) => s.destroy());
}

if (what === 'slowreader') {
  // 20 clients request the 3-year CSV export and never read the body
  const mgr = await demoLogin(MGR); const url = new URL(BASE); const socks = [];
  const before = rss();
  for (let i = 0; i < 20; i++) {
    const s = net.connect(Number(url.port), url.hostname); s.on('error', () => {}); s.pause();
    s.write(`GET /api/v1/payments/export.csv?from=2023-10-18&to=2026-10-18 HTTP/1.1\r\nHost: x\r\nCookie: ${mgr}\r\n\r\n`); socks.push(s);
  }
  const stop = poller('/me', mgr, 250);
  let peak = before; for (let i = 0; i < 60; i++) { await sleep(1000); peak = Math.max(peak, rss() ?? 0); }
  console.log('slow readers: rss before', before, 'peak', peak, 'MB; /me meanwhile', JSON.stringify(await stop()));
  socks.forEach((s) => s.destroy()); await sleep(3000); console.log('rss after close', rss());
}

if (what === 'login') {
  // wrong passwords from one IP: the per-IP throttle should answer 429 after 20 failures
  await run('login.flood.sameip', { concurrency: 20, durationS: 10, ok: (r) => r.status === 429,
    make: (i) => ({ path: '/auth/login', method: 'POST', body: { login: `nobody-${i}`, password: "wrong-password" } }) });
}
if (what === 'loginxff') {
  // the same flood, each request with a different X-Forwarded-For (trust proxy = true): does the throttle hold?
  const reg = await demoLogin(REG);
  const stop = poller('/me', reg, 200);
  await run('login.flood.rotating-xff', { concurrency: 50, durationS: 15, ok: (r) => r.status === 429,
    make: (i) => ({ path: '/auth/login', method: 'POST', headers: { 'x-forwarded-for': `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` }, body: { login: `nobody-${i}`, password: 'wrong-password' } }) });
  console.log('during flood /me', JSON.stringify(await stop()));
  console.log('legit login during idle:', await passwordLogin('lt-cashier-9', LT_PASSWORD).then(() => 'ok', (e) => e.message));
}
if (what === 'loginok') {
  await run('login.valid.c20', { concurrency: 20, durationS: 10, make: (i) => ({ path: '/auth/login', method: 'POST', headers: { 'x-forwarded-for': `10.9.${(i >> 8) & 255}.${i & 255}` }, body: { login: `lt-registrar-${1 + (i % 8)}`, password: LT_PASSWORD } }) });
}
