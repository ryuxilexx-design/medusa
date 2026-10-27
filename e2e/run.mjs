// `npm run e2e`: isolated stack → reset test DB → happy path → error-state checks. Never touches the demo database.
import { startStack, resetTestData, stopStack, WEB } from './stack.mjs';
process.env.E2E_BASE_URL = WEB;
const which = process.argv.slice(2);
const suites = which.length ? which : ['demo', 'errors', 'auth', 'schedule', 'telegram', 'ai', 'documents', 'cash', 'i18n', 'consent', 'cameras', 'news', 'warehouse', 'guard', 'referrals'];
let failed = false;
try {
  console.log(`Izolyatsiyalangan stek ishga tushirilmoqda (${WEB}, baza *_test)…`);
  await startStack();
  for (const s of suites) {
    await resetTestData();
    console.log(`\n=== ${s} ===`);
    try { await import(`./${s}.mjs`); } catch (e) { failed = true; console.error(`✗ ${s}: ${e.message}`); }
  }
} finally { stopStack(); }
process.exit(failed ? 1 : 0);
