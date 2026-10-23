// Starts an ISOLATED Med.uz.ai stack for browser tests: API :4100 + web :3100 on the *_test database.
// The demo database and the demo servers (:3000/:4000) are never touched.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://meduza:meduza_local@127.0.0.1:5433/meduza_test';
if (!/\/[a-z0-9_]+_test(\?|$)/.test(TEST_DB)) throw new Error('Xavfsizlik to‘xtatdi: E2E faqat *_test bazada ishlaydi');
// ports can be moved (E2E_WEB_PORT / E2E_API_PORT) when two stacks run side by side
const WEB_PORT = process.env.E2E_WEB_PORT || '3100', API_PORT = process.env.E2E_API_PORT || '4100';
export const WEB = `http://127.0.0.1:${WEB_PORT}`, API = `http://127.0.0.1:${API_PORT}/api/v1`;
const procs = [];
const env = { ...process.env, DATABASE_URL: TEST_DB, MEDUZA_TEST: '1', API_PORT, APP_MODE: 'demo', AI_MODE: 'sample', DEMO_TIME: process.env.E2E_DEMO_TIME || '11:30', API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`, NEXT_DIST_DIR: '.next-e2e', TRUST_PROXY_HOPS: '1', APP_SECRET_KEY: process.env.APP_SECRET_KEY || Buffer.alloc(32, 7).toString('base64') };
async function up(url, ms = 120000) {
  const t = Date.now();
  for (;;) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not yet */ } if (Date.now() - t > ms) throw new Error('Ishga tushmadi: ' + url); await new Promise((r) => setTimeout(r, 700)); }
}
export async function startStack() {
  procs.push(spawn('node', ['apps/api/dist/main.js'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] }));
  await up(API + '/demo/accounts');
  procs.push(spawn('npx', ['next', 'dev', '-p', WEB_PORT, '-H', '127.0.0.1'], { cwd: path.join(root, 'apps/web'), env, stdio: ['ignore', 'ignore', 'inherit'] }));
  await up(WEB + '/login');
  await fetch(WEB + '/doctor').catch(() => undefined); // warm up compilation
  return { WEB, API };
}
/** Resets the TEST database through the API (the API itself refuses to reset a non-*_test database when MEDUZA_TEST=1). */
export async function resetTestData() {
  const acc = (await (await fetch(API + '/demo/accounts')).json()).data.find((a) => a.role === 'manager');
  const r = await fetch(API + '/demo/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ membership_id: acc.membership_id }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const res = await fetch(API + '/demo/reset', { method: 'POST', headers: { cookie } });
  if (res.status !== 200) throw new Error('Test reset muvaffaqiyatsiz: ' + res.status);
}
export function stopStack() { for (const p of procs) { try { p.kill('SIGTERM'); } catch { /* gone */ } } }
process.on('exit', stopStack);
