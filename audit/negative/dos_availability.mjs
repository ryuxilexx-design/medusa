// /availability with a negative duration_min: the slot loop runs (end - duration)/15 times on the event loop.
import { login, M, record, summary, pool } from './lib.mjs';
const AKMAL = 'e868c980-e2d8-554d-a01a-273d42be7913';
const reg = await login(M.registrar);
for (const d of (process.env.DURS || "30,-1000000,-10000000").split(",").map(Number)) {
  const t0 = Date.now();
  const p = reg.get(`/availability?doctor_id=${AKMAL}&date=2026-10-19&duration_min=${d}`);
  await new Promise((r) => setTimeout(r, 30));
  const t1 = Date.now(); const me = await reg.get('/me'); const meMs = Date.now() - t1; // a concurrent cheap request
  const r = await p;
  console.log(`duration_min=${d}: status=${r.status} slots=${r.body?.data?.slots?.length} bytes=${r.text.length} took=${Date.now() - t0}ms; concurrent /me took ${meMs}ms`);
}
record('DOS-1', false, 'availability negative duration_min is accepted and blocks the event loop (see timings)');
summary(); await pool.end();
