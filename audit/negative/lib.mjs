// Shared helpers for the negative / concurrency audit scripts.
// Talks ONLY to the isolated API (default http://127.0.0.1:4311) backed by the meduza_neg_test database.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const dbpkg = require('../../database/dist/src/index.js');
export const { SEED_IDS } = dbpkg;
export const M = SEED_IDS.membership;
export const BASE = process.env.NEG_BASE || 'http://127.0.0.1:4311/api/v1';
export const DB_URL = process.env.NEG_DB || 'postgres://meduza:meduza_local@127.0.0.1:5433/meduza_neg_test';
if (!/meduza_neg_test/.test(DB_URL) || /:(3000|4000|3100|4100)\b/.test(BASE)) throw new Error('refusing: not the isolated audit environment');
export const pool = dbpkg.createPool(DB_URL);
export const key = () => ({ 'Idempotency-Key': randomUUID() });

export function session(name = '') {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const t0 = Date.now();
    const r = await fetch(BASE + path, {
      method, headers: { 'content-type': 'application/json', cookie, ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t, ms: Date.now() - t0 };
  };
  return {
    name,
    get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), put: (p, b = {}, h) => req('PUT', p, b, h),
    patch: (p, b = {}, h) => req('PATCH', p, b, h), del: (p, h) => req('DELETE', p, undefined, h), raw: req,
    demo: (mid) => req('POST', '/demo/login', { membership_id: mid }),
  };
}

export async function login(mid, name) { const s = session(name); const r = await s.demo(mid); if (r.status !== 200) throw new Error('login ' + r.text); return s; }

export async function reset() {
  const m = await login(M.manager, 'manager');
  const r = await m.post('/demo/reset');
  if (r.status !== 200) throw new Error('reset failed ' + r.text);
}

const results = [];
export function record(id, ok, what, detail = '') {
  results.push({ id, ok, what, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${what}${detail ? ' :: ' + String(detail).slice(0, 600) : ''}`);
}
export function summary() {
  const f = results.filter((r) => !r.ok);
  console.log(`\n== ${results.length - f.length} pass, ${f.length} fail ==`);
  return results;
}
export const short = (r) => `${r.status} ${typeof r.body === 'object' ? JSON.stringify(r.body).slice(0, 300) : String(r.text).slice(0, 300)}`;
export const is5xx = (r) => r.status >= 500;
