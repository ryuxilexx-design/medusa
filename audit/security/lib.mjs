// Shared helpers for the security audit scripts. Point them at an ISOLATED API + *_test database only:
//   BASE=http://127.0.0.1:4301/api/v1 DATABASE_URL=postgres://meduza:meduza_local@127.0.0.1:5433/meduza_sec_test node audit/security/<script>.mjs
import pg from 'pg';

export const BASE = process.env.BASE || 'http://127.0.0.1:4301/api/v1';
export const DATABASE_URL = process.env.DATABASE_URL || 'postgres://meduza:meduza_local@127.0.0.1:5433/meduza_sec_test';
if (!/_test(\?|$)/.test(new URL(DATABASE_URL).pathname + '')) throw new Error('Refusing: DATABASE_URL must point at a *_test database');
if (/:(3000|4000|3100|4100)\//.test(BASE)) throw new Error('Refusing: BASE must not be the shared demo/E2E ports');

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
export const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
export const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

/** fetch wrapper: returns { status, headers, text, json }. */
export async function call(cookie, method, path, body, headers = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let payload;
  if (body !== undefined) {
    if (typeof body === 'string' || body instanceof Uint8Array) payload = body;
    else { payload = JSON.stringify(body); h['content-type'] ??= 'application/json'; }
  }
  const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, headers: res.headers, text, json };
}

export function cookieFrom(res) {
  const sc = res.headers.getSetCookie?.() ?? [];
  const c = sc.find((x) => x.startsWith('meduza_session='));
  return c ? c.split(';')[0] : null;
}

export async function demoLogin(membershipId) {
  const r = await call(null, 'POST', '/demo/login', { membership_id: membershipId });
  if (r.status !== 200) throw new Error(`demo login ${membershipId}: ${r.status} ${r.text}`);
  return cookieFrom(r);
}

export async function passwordLogin(login, password, headers = {}) {
  const r = await call(null, 'POST', '/auth/login', { login, password }, headers);
  return { ...r, cookie: cookieFrom(r) };
}

export const SEED = {
  tenant1: 'c04df94a-e1ae-5d29-a395-ddc2c31d6d0e',
  tenant2: '4d39633c-85e2-538d-a3fc-14b3e68f167a',
  branchM: 'e4b7b3a7-a1e1-5656-a30e-b5242a5ea8d9', // Markaziy
  branchY: '28105494-3373-53d1-b267-b3832c1756b8', // Yunusobod
  branchT2: '9920fbf7-e200-53b1-aa1b-f7a958ef5fd6',
  m: {
    manager: '96806128-c685-515d-beb8-a777eb562a19',
    registrar: 'c8b9bc9d-e4d6-5c9c-b672-2ccfed7505d1',
    registrarY: 'b03940fa-dcd7-503f-bae5-3d4f9460918c', // Yunusobod only
    doctorA: '4142700f-c111-5c02-9c43-85ee316374e9',  // Akmal Rasulov
    doctorB: 'bbdb0bec-5608-5a6c-9b34-6e7df023dcb7',  // Bekzod Ergashev
    uzi: 'c1b2feaf-c9c5-55b6-a1cc-a9ee339c04d2',      // Kamola Ismoilova
    cashier: '50e885ae-58e6-52f3-8f5b-d0e96bb2c63c',
    cashierY: 'ed5943b4-ee10-5500-939f-fcc7a521f0c5', // Yunusobod only
    lab: 'ec87596e-f96f-5d56-aac8-438fcf72450c',
    t2manager: '5d1f7d4b-b9e0-586c-97db-721abf068ccb',
  },
};

export const log = (...a) => console.log(...a);
export const short = (s, n = 160) => (s ?? '').replace(/\s+/g, ' ').slice(0, n);
