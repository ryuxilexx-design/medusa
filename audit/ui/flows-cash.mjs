// Cashier payment (double-click, offline → resend, shift query failure), manager refund modal, registrar on /settings tabs.
import { execFileSync } from 'node:child_process';
import { launch, ctxPage, login, track, go, sleep, SH, save, settle } from './common.mjs';
const Q = (sql) => execFileSync(new URL('./q.sh', import.meta.url).pathname, [sql]).toString().trim();
const out = []; const note = (k, v) => { out.push({ k, v }); console.log('•', k, JSON.stringify(v)?.slice(0, 500)); };
const T = 'c04df94a-e1ae-5d29-a395-ddc2c31d6d0e';
const b = await launch();
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('[aria-live] > div')].map((d) => d.innerText));
const clickBtn = (p, txt, scope = 'body') => p.evaluate((txt, scope) => { const x = [...document.querySelectorAll(scope + ' button')].filter((b) => b.offsetParent && !b.disabled).find((b) => b.textContent.trim().startsWith(txt)); x?.click(); return !!x; }, txt, scope);
const setVal = (p, sel, v) => p.evaluate((sel, v) => { const el = document.querySelector(sel); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, sel, v);

// cashier's open shift branch
const C = await ctxPage(b); const logC = track(C); C.on('dialog', (d) => d.accept());
await login(C, 'Kassir');
const shiftBranch = await C.evaluate(() => fetch('/api/v1/cash-shifts/current').then((r) => r.json()).then((j) => j.data?.branch_id));
const invs = Q(`select id from invoices where tenant_id='${T}' and status='unpaid' and branch_id='${shiftBranch}' and total>=20000000 order by created_at desc limit 3`).split('\n');
note('invoices', invs);
// 1. double-click «To‘lovni qabul qilish» with half amount
await go(C, '/cashier/' + invs[0]); await sleep(600);
await setVal(C, 'main form input', '10000');
const btn = await C.evaluateHandle(() => { const x = document.querySelector('main form button[type=submit]'); x.scrollIntoView({ block: 'center' }); return x; }); await sleep(300);
const bb = await btn.boundingBox();
await C.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2, { count: 2, delay: 40 });
await sleep(2500);
note('double-click pay: payments rows', Q(`select count(*), sum(amount) from payments where invoice_id='${invs[0]}'`));
note('double-click pay: toasts', await toasts(C));
await C.screenshot({ path: SH + 'cash-doubleclick.png' });
// 2. offline payment → pending state → resend online (same key)
await go(C, '/cashier/' + invs[1]); await sleep(600);
await setVal(C, 'main form input', '10000');
await C.setOfflineMode(true);
await clickBtn(C, 'To‘lovni qayd', 'main form'); await sleep(1500);
note('offline pay: alert', await C.evaluate(() => document.querySelector('main form')?.innerText.slice(0, 300)));
note('offline pay: toasts', await toasts(C));
await C.screenshot({ path: SH + 'cash-offline.png' });
await C.setOfflineMode(false);
note('resend clicked', await clickBtn(C, 'Shu to‘lovni qayta', 'main form')); await sleep(2000);
note('after resend: payments', Q(`select count(*), sum(amount) from payments where invoice_id='${invs[1]}'`));
note('after resend: toasts', await toasts(C));
// 3. current-shift request fails → what does the invoice page say?
await C.setRequestInterception(true);
C.on('request', (r) => { if (r.url().includes('/cash-shifts/current')) r.respond({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"x"}}' }); else r.continue(); });
await go(C, '/cashier/' + invs[2]); await sleep(5000);
note('shift query 500: payment card text', (await C.evaluate(() => document.querySelector('main')?.innerText))?.slice(0, 600));
await C.screenshot({ path: SH + 'cash-shift-500.png' });
await C.browserContext().close();

// 4. manager refund modal
const M = await ctxPage(b); const logM = track(M); M.on('dialog', (d) => d.accept());
await login(M, 'Rahbar');
const paidInv = Q(`select i.id from invoices i where i.tenant_id='${T}' and i.status='paid' and exists(select 1 from payments p where p.invoice_id=i.id and p.method='card') order by i.created_at desc limit 1`);
await go(M, '/cashier/' + paidInv); await sleep(600);
note('refund button', await clickBtn(M, 'Pulni qaytarish')); await sleep(600);
note('refund modal', (await M.evaluate(() => document.querySelector('[role=dialog]')?.innerText))?.slice(0, 500));
note('refund buttons', await M.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].map((b) => b.textContent.trim() + (b.disabled ? '(disabled)' : ''))));
await M.screenshot({ path: SH + 'refund-modal.png' });
await setVal(M, '[role=dialog] textarea', 'Audit sinov sababi');
await clickBtn(M, 'Bekor qilish', '[role=dialog]'); await sleep(300);
note('refund cancel with reason typed: still open?', !!(await M.evaluate(() => document.querySelector('[role=dialog]'))));
// refund double-click
if (!(await M.evaluate(() => document.querySelector('[role=dialog]')))) { await clickBtn(M, 'Pulni qaytarish'); await sleep(500); }
await setVal(M, '[role=dialog] textarea', 'Audit sinov sababi');
await sleep(200);
const rb = await M.evaluateHandle(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Qaytarish'));
note('refund submit label/disabled', await M.evaluate((b) => b && (b.textContent + (b.disabled ? '(disabled)' : '')), rb));
const rbb = await rb.boundingBox().catch(() => null);
if (rbb) { await M.mouse.click(rbb.x + rbb.width / 2, rbb.y + rbb.height / 2, { count: 2, delay: 40 }); await sleep(2500); }
note('refunds rows', Q(`select count(*), sum(amount) from refunds where invoice_id='${paidInv}'`));
note('refund toasts', await toasts(M));
note('refund dialog after', (await M.evaluate(() => document.querySelector('[role=dialog]')?.innerText))?.slice(0, 300));
await M.screenshot({ path: SH + 'refund-after.png' });
note('manager net', logM.net);
await M.browserContext().close();

// 5. registrar on /settings: tabs and save
const R = await ctxPage(b); const logR = track(R);
await login(R, 'Registrator');
await go(R, '/settings');
for (const tab of ['Xizmatlar', 'Telegram bot', 'AI', 'Audit jurnali', 'Demo']) {
  await R.evaluate((tab) => [...document.querySelectorAll('[role=tab], button')].find((b) => b.textContent.trim().startsWith(tab))?.click(), tab); await sleep(1200);
  note(`registrar settings tab ${tab}`, (await R.evaluate(() => document.querySelector('main')?.innerText))?.slice(0, 250).replace(/\s+/g, ' '));
  await R.screenshot({ path: SH + `reg-settings-${tab.replace(/\s/g, '')}.png` });
}
await R.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Klinika')?.click()); await sleep(600);
await setVal(R, 'main input', 'Registrator nomi');
await clickBtn(R, 'Saqlash'); await sleep(1500);
note('registrar save clinic name: toasts', await toasts(R));
note('registrar net', logR.net);
await save('flows-cash.json', out);
await b.close();
