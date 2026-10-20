// Steady-state mix that mirrors the web app's polling (refetchInterval) for a clinic of N staff, open loop.
// Usage: node mixed.mjs [scale=1] [seconds=180]   scale 1 = 30 doctors, 10 registrars, 6 cashiers, 3 managers, 2 lab, 3 cameras
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { BASE, OUT, demoLogin, passwordLogin, req } from './lib.mjs';
import { LT_PASSWORD, sql } from './setup.mjs';

const scale = Number(process.argv[2] || 1), secs = Number(process.argv[3] || 180);
const T = '2026-10-18';
const M = { manager: '96806128-c685-515d-beb8-a777eb562a19', registrar: 'c8b9bc9d-e4d6-5c9c-b672-2ccfed7505d1', lab: 'ec87596e-f96f-5d56-aac8-438fcf72450c' };
const patients = sql(`SELECT id, patient_number FROM patients TABLESAMPLE SYSTEM (5) LIMIT 2000`).split('\n').map((l) => l.split('\t'));
const surnames = ['Karim', 'Rasul', 'Yusup', 'Aliyev', 'Toshm', 'Saidov', 'Ergash', 'Nazar', 'Ismoil', 'Qodir'];
const free = sql(`WITH d AS (SELECT d.id, s.branch_id, ds.service_id, s.weekday FROM doctors d JOIN schedules s ON s.doctor_id = d.id JOIN doctor_services ds ON ds.doctor_id = d.id WHERE d.display_name LIKE 'Sintetik%'),
  g AS (SELECT d.id, d.branch_id, d.service_id, day::date AS day, (time '08:00' + k * interval '30 min')::time AS t FROM d, generate_series(date '2026-10-24', date '2026-10-31', interval '1 day') day, generate_series(0, 19) k
         WHERE extract(dow FROM day) = d.weekday AND k NOT IN (10, 11))
  SELECT g.id, g.branch_id, g.service_id, g.day, to_char(g.t, 'HH24:MI') FROM g WHERE NOT EXISTS (SELECT 1 FROM appointments a WHERE a.doctor_id = g.id AND a.status NOT IN ('cancelled','no_show') AND a.starts_at = (g.day + g.t) AT TIME ZONE 'Asia/Tashkent')
  ORDER BY random() LIMIT 2000`).split('\n').map((l) => l.split('\t'));
let fi = 0, pi = 0;

const n = (k) => Math.max(1, Math.round(k * scale));
const users = [];
const add = async (count, login, tasks) => { for (let i = 0; i < count; i++) users.push({ cookie: await login(i), tasks }); };
await add(n(30), (i) => passwordLogin(`lt-doc-${1 + (i % 64)}`, LT_PASSWORD), [['doctor.day', 15, () => `/appointments?date=${T}`], ['doctor.patients', 120, () => `/patients`]]);
await add(n(10), () => demoLogin(M.registrar), [
  ['reg.queue', 12, () => `/queue`], ['reg.schedule', 30, () => `/appointments?date=${T}`], ['reg.arrivals', 30, () => `/cameras/arrivals`],
  ['reg.search', 20, () => `/patients?search=${encodeURIComponent(surnames[pi++ % surnames.length])}`], ['reg.card', 20, () => `/patients/${patients[pi++ % patients.length][0]}`],
  ['reg.book', 60, () => { const [doctor_id, branch_id, service_id, date, start_time] = free[fi++ % free.length];
    return { path: '/appointments', method: 'POST', headers: { 'idempotency-key': randomUUID() }, body: { patient_id: patients[pi++ % patients.length][0], branch_id, doctor_id, service_id, date, start_time } }; }]]);
await add(n(6), () => demoLogin('50e885ae-58e6-52f3-8f5b-d0e96bb2c63c'), [['cash.invoices', 20, () => `/invoices?from=${T}&to=${T}&page=1&page_size=20`], ['cash.shift', 30, () => `/cash-shifts/current`]]);
await add(n(3), () => demoLogin(M.manager), [['mgr.dashboard', 30, () => `/dashboard`], ['mgr.security', 60, () => `/cameras/security?from=2026-10-12&to=${T}`]]);
await add(n(2), () => demoLogin(M.lab), [['lab.orders', 20, () => `/orders?page=1&page_size=20`]]);

const stats = {}; const pending = []; const t0 = Date.now(); const end = t0 + secs * 1000;
function schedule(u, [name, every, make]) {
  const fire = () => {
    if (Date.now() >= end) return;
    const spec = make(); const s = typeof spec === 'string' ? { path: spec } : spec;
    pending.push(req(s.path, { ...s, cookie: u.cookie, timeoutMs: 120_000 }).then((r) => {
      const st = (stats[name] ??= { lat: [], err: 0 }); st.lat.push(r.ms); if (r.status < 200 || (r.status >= 300 && !(name === 'reg.book' && r.status === 409))) st.err++;
    }));
    setTimeout(fire, every * 1000 * (0.9 + Math.random() * 0.2));
  };
  setTimeout(fire, Math.random() * every * 1000);
}
for (const u of users) for (const t of u.tasks) schedule(u, t);
// three counting cameras, one event per minute each, plus staff passing every ~20 s
const CAM = BASE.replace('/api/v1', '') + '/api/v1/hik/lt-load-camera-token-c1';
const camTimer = setInterval(() => { if (Date.now() < end) pending.push(req(CAM, { method: 'POST', body: '<EventNotificationAlert><eventType>videoloss</eventType><eventState>inactive</eventState></EventNotificationAlert>', headers: { 'content-type': 'application/xml' } }).then((r) => { const st = (stats['camera.push'] ??= { lat: [], err: 0 }); st.lat.push(r.ms); if (r.status !== 200) st.err++; })); }, 6000 / scale);
await new Promise((r) => setTimeout(r, secs * 1000 + 500));
clearInterval(camTimer); await Promise.all(pending);
const pct = (s, p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
const all = [];
const rows = Object.entries(stats).map(([name, s]) => { s.lat.sort((a, b) => a - b); all.push(...s.lat);
  return { name, n: s.lat.length, err: s.err, p50: Math.round(pct(s.lat, 50)), p95: Math.round(pct(s.lat, 95)), p99: Math.round(pct(s.lat, 99)), max: Math.round(s.lat.at(-1)) }; });
all.sort((a, b) => a - b);
const summary = { name: `mixed.scale${scale}`, users: users.length, secs, req: all.length, rps: +(all.length / secs).toFixed(1), p50: Math.round(pct(all, 50)), p95: Math.round(pct(all, 95)), p99: Math.round(pct(all, 99)), max: Math.round(all.at(-1)), endpoints: rows };
console.log(JSON.stringify(summary, null, 1));
if (OUT) appendFileSync(OUT, JSON.stringify(summary) + '\n');
