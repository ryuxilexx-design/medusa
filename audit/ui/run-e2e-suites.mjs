// Runs the existing e2e suites against the audit stack (E2E_BASE_URL), resetting the audit DB between suites
// through the manager's /demo/reset (only the isolated meduza_ui_test instance is used).
import { launch, ctxPage, login, BASE } from './common.mjs';
const suites = process.argv.slice(2).length ? process.argv.slice(2) : ['errors', 'auth', 'schedule', 'telegram', 'ai', 'documents', 'cash', 'i18n', 'consent', 'cameras', 'news'];
async function reset() {
  const b = await launch(); const p = await ctxPage(b); await login(p, 'Rahbar');
  const r = await p.evaluate(() => fetch('/api/v1/demo/reset', { method: 'POST' }).then((r) => r.status)); await b.close(); return r;
}
for (const s of suites) {
  console.log(`\n=== ${s} === reset:`, await reset());
  process.exitCode = 0;
  try { await import(`../../e2e/${s}.mjs?x=${Date.now()}`); } catch (e) { console.error(`✗ ${s}: ${e.message}`); }
  console.log(`=== ${s} exit=${process.exitCode}`);
}
