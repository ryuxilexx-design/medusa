// Minimal load tool: fixed-concurrency closed-loop workers over fetch, latency percentiles, API process sampling.
// Only ever points at the isolated audit API (default http://127.0.0.1:4321).
import { execFile } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';

export const BASE = process.env.LT_BASE || 'http://127.0.0.1:4321/api/v1';
if (/:(3000|4000|3100|4100)\b/.test(BASE)) throw new Error('refusing to load-test a demo port');
export const API_PID = process.env.LT_API_PID ? Number(readFileSync(process.env.LT_API_PID, 'utf8')) : null;
export const OUT = process.env.LT_OUT || null;

export async function req(path, { method = 'GET', cookie, body, headers = {}, timeoutMs = 60_000, raw = false } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let payload = body;
  if (body !== undefined && !(body instanceof Buffer) && typeof body !== 'string') { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const t0 = performance.now();
  try {
    const r = await fetch(path.startsWith('http') ? path : BASE + path, { method, headers: h, body: payload, signal: AbortSignal.timeout(timeoutMs) });
    const buf = Buffer.from(await r.arrayBuffer());
    const ms = performance.now() - t0;
    let json; if (!raw) { try { json = JSON.parse(buf.toString('utf8')); } catch { /* csv etc */ } }
    return { status: r.status, ms, bytes: buf.length, json, headers: r.headers, text: raw ? buf.toString('utf8') : undefined };
  } catch (e) {
    return { status: 0, ms: performance.now() - t0, bytes: 0, error: e.name === 'TimeoutError' ? 'timeout' : String(e.cause?.code || e.message) };
  }
}

export async function demoLogin(membershipId) {
  const r = await fetch(BASE + '/demo/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ membership_id: membershipId }) });
  if (r.status !== 200) throw new Error('demo login failed ' + r.status + ' ' + await r.text());
  return r.headers.get('set-cookie').split(';')[0];
}
export async function passwordLogin(login, password, extraHeaders = {}) {
  const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify({ login, password }) });
  if (r.status !== 200) throw new Error('login failed ' + r.status + ' ' + await r.text());
  return r.headers.get('set-cookie').split(';')[0];
}

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN;

function sampleProc(pid) {
  return new Promise((res) => execFile('ps', ['-o', '%cpu=,rss=', '-p', String(pid)], (err, out) => {
    if (err) return res(null);
    const [cpu, rss] = out.trim().split(/\s+/).map(Number);
    res({ cpu, rssMb: rss / 1024 });
  }));
}

/**
 * Runs `concurrency` workers for `durationS` seconds (or until `maxRequests`), each calling make(i, worker) → request spec.
 * Returns stats: n, rps, error rate, p50/p95/p99/max latency, mean bytes, status histogram, API CPU/RSS peak.
 */
export async function run(name, { concurrency, durationS = 15, maxRequests = Infinity, make, ok = (r) => r.status >= 200 && r.status < 300, warmup = 0 }) {
  for (let i = 0; i < warmup; i++) { const s = make(i, 0); await req(s.path, s); }
  const lat = []; const statuses = {}; let bytes = 0, errors = 0, issued = 0; const errSamples = [];
  const end = Date.now() + durationS * 1000;
  const samples = []; let sampling = true;
  const sampler = API_PID ? (async () => { while (sampling) { const s = await sampleProc(API_PID); if (s) samples.push(s); await new Promise((r) => setTimeout(r, 500)); } })() : null;
  const t0 = performance.now();
  async function worker(w) {
    while (Date.now() < end && issued < maxRequests) {
      const i = issued++;
      const spec = make(i, w);
      const r = await req(spec.path, spec);
      lat.push(r.ms); bytes += r.bytes;
      const key = r.status || r.error; statuses[key] = (statuses[key] || 0) + 1;
      if (!ok(r)) { errors++; if (errSamples.length < 3) errSamples.push(`${r.status} ${r.error || JSON.stringify(r.json?.error ?? '').slice(0, 120)}`); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, (_, w) => worker(w)));
  const wall = (performance.now() - t0) / 1000;
  sampling = false; if (sampler) await sampler;
  lat.sort((a, b) => a - b);
  const stat = {
    name, concurrency, n: lat.length, wall_s: +wall.toFixed(1), rps: +(lat.length / wall).toFixed(1), err_pct: +((100 * errors) / Math.max(1, lat.length)).toFixed(1),
    p50: Math.round(pct(lat, 50)), p95: Math.round(pct(lat, 95)), p99: Math.round(pct(lat, 99)), max: Math.round(lat.at(-1) ?? 0),
    kb: +((bytes / Math.max(1, lat.length)) / 1024).toFixed(1), statuses,
    cpu_max: samples.length ? Math.max(...samples.map((s) => s.cpu)) : null, rss_max_mb: samples.length ? Math.round(Math.max(...samples.map((s) => s.rssMb))) : null,
    err_samples: errSamples,
  };
  console.log(JSON.stringify(stat));
  if (OUT) appendFileSync(OUT, JSON.stringify(stat) + '\n');
  return stat;
}

/** Latency of a trivial request (unmatched route, no DB) every `everyMs` while `promise` runs: measures event-loop blocking. */
export async function probeDuring(promise, everyMs = 50) {
  const lats = []; let done = false;
  const p = promise.finally(() => { done = true; });
  while (!done) { const r = await req('/__probe__', { timeoutMs: 120_000 }); lats.push(r.ms); await new Promise((r) => setTimeout(r, everyMs)); }
  const result = await p;
  lats.sort((a, b) => a - b);
  return { result, probe: { n: lats.length, p50: Math.round(pct(lats, 50)), p99: Math.round(pct(lats, 99)), max: Math.round(lats.at(-1) ?? 0) } };
}

export const pick = (arr, i) => arr[i % arr.length];
