// Two tabs of one registrar: stale check-in (409 handling), then logout in tab A → tab B's next action redirects to /login.
import { launch, ctxPage, login, track, go, sleep, SH, save } from './common.mjs';
const out = []; const note = (k, v) => { out.push({ k, v }); console.log('•', k, JSON.stringify(v)?.slice(0, 400)); };
const b = await launch();
const A = await ctxPage(b); const logA = track(A);
await login(A, 'Registrator');
const B = await A.browserContext().newPage(); await B.setViewport({ width: 1366, height: 768 }); const logB = track(B);
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('[aria-live] > div')].map((d) => d.innerText));
async function openAppt(p, name) {
  await go(p, '/schedule');
  // list view row with the patient name → «Ochish»
  const ok = await p.evaluate((name) => { const tr = [...document.querySelectorAll('tr')].find((r) => r.innerText.includes(name)); if (!tr) return false; [...tr.querySelectorAll('button')].pop().click(); return true; }, name);
  if (!ok) { // timeline view: button with aria-label containing the name
    await p.evaluate((name) => { const btn = [...document.querySelectorAll('button[aria-label]')].find((x) => x.getAttribute('aria-label').includes(name)); btn?.click(); }, name);
  }
  await sleep(600);
  return p.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? null);
}
note('A dialog', (await openAppt(A, process.env.APPT || 'Sobirov'))?.slice(0, 160));
note('B dialog', (await openAppt(B, process.env.APPT || 'Sobirov'))?.slice(0, 160));
note('no-show button for a later-today appt?', await B.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].map((x) => x.textContent.trim())));
const clickIn = (p, txt) => p.evaluate((txt) => { const x = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim().startsWith(txt)); x?.click(); return !!x; }, txt);
note('A check-in clicked', await clickIn(A, 'Keldi')); await sleep(1500);
note('A toasts', await toasts(A));
await B.bringToFront();
note('B check-in clicked (stale)', await clickIn(B, 'Keldi')); await sleep(1500);
note('B toasts', await toasts(B));
note('B dialog after', (await B.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? null))?.slice(0, 300));
await B.screenshot({ path: SH + 'stale-checkin-tabB.png' });
note('B net', logB.net);
// session expiry: logout in A, act in B
await A.bringToFront();
await A.evaluate(() => fetch('/api/v1/logout', { method: 'POST' }));
await B.bringToFront();
await B.keyboard.press('Escape'); await sleep(300);
await B.evaluate(() => { const a = [...document.querySelectorAll('nav a')].find((x) => x.textContent.includes('Bemorlar')); a?.click(); });
await sleep(2500);
note('B after logout elsewhere: url', B.url());
await B.screenshot({ path: SH + 'session-expired-tabB.png' });
await save('flows-stale.json', out);
await b.close();
