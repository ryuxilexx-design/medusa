// Starts an ISOLATED Meduza stack for browser tests: API :4100 + web :3100 on the *_test database.
// The demo database and the demo servers (:3000/:4000) are never touched.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://meduza:meduza_local@127.0.0.1:5433/meduza_test';
if (!/\/[a-z0-9_]+_test(\?|$)/.test(TEST_DB)) throw new Error('Xavfsizlik to‘xtatdi: E2E faqat *_test bazada ishlaydi');
export const WEB = 'http://127.0.0.1:3100', API = 'http://127.0.0.1:4100/api/v1';
const procs = [];
const env = { ...process.env, DATABASE_URL: TEST_DB, MEDUZA_TEST: '1', API_PORT: '4100', APP_MODE: 'demo', AI_MODE: 'sample', DEMO_TIME: process.env.E2E_DEMO_TIME || '11:30', API_INTERNAL_URL: 'http://127.0.0.1:4100', NEXT_DIST_DIR: '.next-e2e' };
async function up(url, ms = 120000) {
  const t = Date.now();
  for (;;) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not yet */ } if (Date.now() - t > ms) throw new Error('Ishga tushmadi: ' + url); await new Promise((r) => setTimeout(r, 700)); }
}
export async function startStack() {
  procs.push(spawn('node', ['apps/api/dist/main.js'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] }));
  await up(API + '/demo/accounts');
  procs.push(spawn('npx', ['next', 'dev', '-p', '3100', '-H', '127.0.0.1'], { cwd: path.join(root, 'apps/web'), env, stdio: ['ignore', 'ignore', 'inherit'] }));
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
