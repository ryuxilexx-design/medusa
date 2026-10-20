// Writes under contention: bookings, check-ins, payments; lock waits sampled from pg_stat_activity.
// Usage: node writes.mjs [book|hotslot|checkin|pay|hotpay|all] [concurrency=50]
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { demoLogin, passwordLogin, run } from './lib.mjs';
import { LT_PASSWORD, sql } from './setup.mjs';

const what = process.argv[2] || 'all';
const C = Number(process.argv[3] || 50);
const PSQL = new URL('./psql.sh', import.meta.url).pathname;
const REG = 'c8b9bc9d-e4d6-5c9c-b672-2ccfed7505d1';

/** Samples sessions of the load DB waiting on locks (every 200 ms) while fn runs. */
async function withLockSampling(label, fn) {
  const dl0 = Number(sql(`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`));
  let on = true; const samples = [];
  const loop = (async () => {
    while (on) {
      const out = await new Promise((res) => execFile(PSQL, ['-At', '-F', '\t', '-c',
        `SELECT count(*) FILTER (WHERE wait_event_type = 'Lock'), count(*) FILTER (WHERE state = 'active'), count(*) FILTER (WHERE state LIKE 'idle in transaction%'),
                coalesce(max(extract(epoch FROM now() - query_start)) FILTER (WHERE wait_event_type = 'Lock'), 0), count(*),
                coalesce(string_agg(DISTINCT left(regexp_replace(query, '\\s+', ' ', 'g'), 70), ' | ') FILTER (WHERE wait_event_type = 'Lock'), '')
           FROM pg_stat_activity WHERE datname = 'meduza_load_test' AND pid <> pg_backend_pid()`], (e, o) => res(e ? '' : o.trim())));
      if (out) { const [lock, active, idleTx, maxWait, total, q] = out.split('\t'); samples.push({ lock: +lock, active: +active, idleTx: +idleTx, maxWait: +maxWait, total: +total, q }); }
      await new Promise((r) => setTimeout(r, 200));
    }
  })();
  const stat = await fn();
  on = false; await loop;
  const dl1 = Number(sql(`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`));
  const lockQ = {}; for (const s of samples) for (const q of (s.q || '').split(' | ').filter(Boolean)) lockQ[q] = (lockQ[q] || 0) + 1;
  const summary = { label, lock_waiters_max: Math.max(0, ...samples.map((s) => s.lock)), lock_wait_max_s: +Math.max(0, ...samples.map((s) => s.maxWait)).toFixed(2),
    db_conns_max: Math.max(0, ...samples.map((s) => s.total)), active_max: Math.max(0, ...samples.map((s) => s.active)), deadlocks: dl1 - dl0,
    lock_queries: Object.entries(lockQ).sort((a, b) => b[1] - a[1]).slice(0, 4) };
  console.log(JSON.stringify(summary));
  return { stat, summary };
}

const regs = await Promise.all(Array.from({ length: 10 }, () => demoLogin(REG)));

if (what === 'book' || what === 'all') {
  // free 30-min slots of the synthetic doctors (not booked, inside their schedule), next 2 weeks
  const free = sql(`
    WITH d AS (SELECT d.id, s.branch_id, ds.service_id, s.weekday FROM doctors d JOIN schedules s ON s.doctor_id = d.id JOIN doctor_services ds ON ds.doctor_id = d.id WHERE d.display_name LIKE 'Sintetik%'),
    g AS (SELECT d.id, d.branch_id, d.service_id, day::date AS day, (time '08:00' + k * interval '30 min')::time AS t
            FROM d, generate_series(date '2026-10-19', date '2026-10-31', interval '1 day') day, generate_series(0, 19) k
           WHERE extract(dow FROM day) = d.weekday AND k NOT IN (10, 11))
    SELECT g.id, g.branch_id, g.service_id, g.day, to_char(g.t, 'HH24:MI') FROM g
     WHERE NOT EXISTS (SELECT 1 FROM appointments a WHERE a.doctor_id = g.id AND a.status NOT IN ('cancelled','no_show')
                         AND a.starts_at = (g.day + g.t) AT TIME ZONE 'Asia/Tashkent')
     ORDER BY random() LIMIT 3000`).split('\n').map((l) => l.split('\t'));
  const pats = sql(`SELECT id FROM patients TABLESAMPLE SYSTEM (2) LIMIT 3000`).split('\n');
  console.log('free slots', free.length);
  await withLockSampling(`book c=${C}`, () => run('write.book.distinct-slots', { concurrency: C, durationS: 20, maxRequests: free.length,
    make: (i, w) => { const [doctor_id, branch_id, service_id, date, start_time] = free[i];
      return { path: '/appointments', method: 'POST', cookie: regs[w % regs.length], headers: { 'idempotency-key': randomUUID() },
        body: { patient_id: pats[i % pats.length], branch_id, doctor_id, service_id, date, start_time } }; } }));
}

if (what === 'hotslot' || what === 'all') {
  const [doctor_id, branch_id, service_id] = sql(`SELECT d.id, s.branch_id, ds.service_id FROM doctors d JOIN schedules s ON s.doctor_id = d.id AND s.weekday = 5
    JOIN doctor_services ds ON ds.doctor_id = d.id WHERE d.display_name LIKE 'Sintetik%' LIMIT 1`).split('\t');
  const pats = sql(`SELECT id FROM patients LIMIT 200`).split('\n');
  // cancel whatever is booked at that slot so it is free
  sql(`UPDATE appointments SET status = 'cancelled' WHERE doctor_id = '${doctor_id}' AND starts_at = '2026-10-23 09:00+05'::timestamptz AND status = 'scheduled'`);
  await withLockSampling('hotslot', () => run('write.book.same-slot', { concurrency: C, durationS: 30, maxRequests: C, ok: (r) => r.status === 201 || r.status === 409,
    make: (i, w) => ({ path: '/appointments', method: 'POST', cookie: regs[w % regs.length], headers: { 'idempotency-key': randomUUID() },
      body: { patient_id: pats[i], branch_id, doctor_id, service_id, date: '2026-10-23', start_time: '09:00' } }) }));
  console.log('booked at hot slot:', sql(`SELECT count(*) FROM appointments WHERE doctor_id = '${doctor_id}' AND starts_at = '2026-10-23 09:00+05'::timestamptz AND status = 'scheduled'`));
}

if (what === 'checkin' || what === 'all') {
  const appts = sql(`SELECT id, version FROM appointments WHERE status = 'scheduled' AND starts_at >= demo_now() AND starts_at < '2026-10-18 19:00Z' ORDER BY random() LIMIT 1500`).split('\n').map((l) => l.split('\t'));
  console.log('check-in candidates', appts.length);
  await withLockSampling(`checkin c=${C}`, () => run('write.checkin', { concurrency: C, durationS: 30, maxRequests: appts.length,
    make: (i, w) => ({ path: `/appointments/${appts[i][0]}/check-in`, method: 'POST', cookie: regs[w % regs.length], body: { version: Number(appts[i][1]) } }) }));
}

if (what === 'pay' || what === 'all' || what === 'hotpay') {
  const cashiers = sql(`SELECT u.login, m.branch_ids[1] FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.login LIKE 'lt-cashier-%'`).split('\n').map((l) => l.split('\t'));
  const byBranch = {};
  for (const [login, b] of cashiers) (byBranch[b] ??= []).push(await passwordLogin(login, LT_PASSWORD));
  if (what !== 'hotpay') {
    const inv = sql(`SELECT id, branch_id, total - paid_amount FROM invoices WHERE status = 'unpaid' AND total > 0 AND created_at >= '2026-01-01' ORDER BY random() LIMIT 3000`).split('\n').map((l) => l.split('\t'));
    await withLockSampling(`pay c=${C}`, () => run('write.payment', { concurrency: C, durationS: 30, maxRequests: inv.length,
      make: (i, w) => { const [id, b, due] = inv[i]; const cs = byBranch[b];
        return { path: `/invoices/${id}/payments`, method: 'POST', cookie: cs[w % cs.length], headers: { 'idempotency-key': randomUUID() }, body: { amount: Number(due), method: 'card' } }; } }));
  }
  // the same invoice paid in full by C cashiers at once: exactly one may succeed
  const [id, b, due] = sql(`SELECT id, branch_id, total - paid_amount FROM invoices WHERE status = 'unpaid' AND total > 0 ORDER BY created_at DESC LIMIT 1`).split('\t');
  const cs = byBranch[b];
  await withLockSampling('hotpay', () => run('write.payment.same-invoice', { concurrency: C, durationS: 30, maxRequests: C, ok: (r) => r.status === 201 || r.status === 409,
    make: (i, w) => ({ path: `/invoices/${id}/payments`, method: 'POST', cookie: cs[w % cs.length], headers: { 'idempotency-key': randomUUID() }, body: { amount: Number(due), method: 'card' } }) }));
  console.log('payments on hot invoice:', sql(`SELECT count(*), sum(amount) FROM payments WHERE invoice_id = '${id}'`), 'due was', due);
}
