// Patient profile per role (every tab): clinical text / lab values must reach doctors only. Plus the appointment dialog's «Kelmadi».
import { launch, ctxPage, login, track, go, sleep, SH, save, ROLES } from './common.mjs';
const PID = process.argv[2]; const out = {};
const b = await launch();
for (const [role, label] of Object.entries(ROLES)) {
  const p = await ctxPage(b); const log = track(p); await login(p, label); await go(p, '/patients/' + PID); await sleep(800);
  const tabs = await p.evaluate(() => [...document.querySelectorAll('main [role=tab], main [role=tablist] button')].map((x) => x.textContent.trim()));
  const texts = {};
  for (const tb of tabs.length ? tabs : ['-']) {
    if (tb !== '-') { await p.evaluate((tb) => [...document.querySelectorAll('main [role=tab], main [role=tablist] button')].find((x) => x.textContent.trim() === tb)?.click(), tb); await sleep(700); }
    texts[tb] = (await p.evaluate(() => document.querySelector('main')?.innerText)).replace(/\s+/g, ' ').slice(0, 700);
    await p.screenshot({ path: SH + `profile-${role}-${tb.replace(/[^\p{L}\d]+/gu, '')}.png` });
  }
  out[role] = { tabs, texts, net: log.net };
  console.log(role, tabs, log.net);
  await p.browserContext().close();
}
// appointment dialog of a later-today scheduled appointment (registrar)
const r = await ctxPage(b); await login(r, 'Registrator'); await go(r, '/schedule');
await r.evaluate(() => { const btn = [...document.querySelectorAll('button[aria-label]')].find((x) => /^1[5-6]:\d\d–/.test(x.getAttribute('aria-label')) && x.getAttribute('aria-label').includes('Rejalashtirilgan')); btn?.click(); });
await sleep(700); await r.screenshot({ path: SH + 'appt-dialog-noshow.png' });
out.dialog = await r.evaluate(() => document.querySelector('[role=dialog]')?.innerText.slice(0, 300));
await save('profile-roles.json', out);
await b.close().catch(() => undefined); process.exit(0);
