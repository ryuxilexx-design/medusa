// Registrar: new patient modal (empty submit, cancel-dirty, double-click, offline, slow 3G), booking modal, check-in double-click.
import { execFileSync } from 'node:child_process';
import { launch, ctxPage, login, track, go, sleep, SH, clickText, fill, save, settle } from './common.mjs';
const Q = (sql) => execFileSync(new URL('./q.sh', import.meta.url).pathname, [sql]).toString().trim();
const out = []; const note = (k, v) => { out.push({ k, v }); console.log('•', k, typeof v === 'string' ? v : JSON.stringify(v)); };
const b = await launch();
const p = await ctxPage(b); const log = track(p);
await login(p, 'Registrator');
const toasts = () => p.evaluate(() => [...document.querySelectorAll('[aria-live] > div')].map((d) => d.innerText));
const dialogText = () => p.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? null);
const openAdd = async () => { await go(p, '/patients'); await clickText(p, 'Bemor qo‘shish'); await p.waitForSelector('[role=dialog]'); await sleep(300); };
const dlgBtn = (txt) => p.evaluate((txt) => { const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.trim() === txt); if (!b) return false; b.click(); return true; }, txt);

// 1. empty submit
await openAdd();
note('focus on open', await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
await dlgBtn('Bemorni saqlash');
await sleep(400);
note('empty submit errors', await p.evaluate(() => [...document.querySelectorAll('[role=dialog] [role=alert], [role=dialog] .text-red-700')].map((e) => e.textContent)));
note('focus after invalid submit', await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
await p.screenshot({ path: SH + 'reg-patient-empty-submit.png' });
// 2. dirty cancel via footer «Bekor qilish»
await fill(p, 'Familiya', 'Testov', '[role=dialog]');
await dlgBtn('Bekor qilish'); await sleep(300);
note('after Cancel with typed text: dialog still open?', !!(await dialogText()));
note('after Cancel: confirm bar shown?', ((await dialogText()) || '').includes('saqlanmagan'));
await p.screenshot({ path: SH + 'reg-patient-cancel-dirty.png' });
if (await dialogText()) { await p.keyboard.press('Escape'); await sleep(300); note('Esc on dirty: dialog text', (await dialogText())?.slice(0, 120)); await p.screenshot({ path: SH + 'reg-patient-esc-dirty.png' }); }
// close fully
await p.evaluate(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.trim() === 'Yopish'); b?.click(); });
await sleep(300);

// 3. double-click create
const NAME = 'Ikkiboskich' + Date.now().toString().slice(-5);
await openAdd();
await fill(p, 'Familiya', NAME, '[role=dialog]'); await fill(p, 'Ism', 'Sinov', '[role=dialog]');
await p.evaluate(() => { const el = document.querySelector('[role=dialog] input[type=date]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '1990-05-05'); el.dispatchEvent(new Event('input', { bubbles: true })); });
const btn = await p.evaluateHandle(() => [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.trim() === 'Bemorni saqlash'));
const box = await btn.boundingBox();
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { count: 2, delay: 30 });
await sleep(2500);
note('double-click create: rows in DB', Q(`select count(*) from patients where last_name='${NAME}'`));
note('double-click create: toasts', await toasts());
note('double-click create: dialog left', (await dialogText())?.slice(0, 200) ?? null);
await p.screenshot({ path: SH + 'reg-patient-doubleclick.png' });
if (await dialogText()) { await p.keyboard.press('Escape'); await sleep(200); await dlgBtn('Yopish'); }

// 4. offline save
const N2 = 'Oflayn' + Date.now().toString().slice(-5);
await openAdd();
await fill(p, 'Familiya', N2, '[role=dialog]'); await fill(p, 'Ism', 'Sinov', '[role=dialog]');
await p.evaluate(() => { const el = document.querySelector('[role=dialog] input[type=date]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '1991-06-06'); el.dispatchEvent(new Event('input', { bubbles: true })); });
await p.setOfflineMode(true);
await dlgBtn('Bemorni saqlash'); await sleep(1500);
note('offline: dialog text', (await dialogText())?.slice(0, 200));
note('offline: input kept', await p.evaluate(() => document.querySelector('[role=dialog] input')?.value));
note('offline: toasts', await toasts());
await p.screenshot({ path: SH + 'reg-patient-offline.png' });
await p.setOfflineMode(false);
await dlgBtn('Bemorni saqlash'); await sleep(2000);
note('back online retry: rows', Q(`select count(*) from patients where last_name='${N2}'`));

// 5. Slow 3G on booking save + loading states
const cdp = await p.createCDPSession();
await go(p, '/schedule');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 });
await clickText(p, 'Qabulga yozish'); await sleep(500);
note('slow: booking dialog shows', (await dialogText())?.slice(0, 150));
await dlgBtn('Qabulga yozish'); await sleep(300);
note('booking empty submit errors', await p.evaluate(() => [...document.querySelectorAll('[role=dialog] .text-red-700')].map((e) => e.textContent)));
await p.screenshot({ path: SH + 'reg-booking-empty.png' });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await p.keyboard.press('Escape'); await sleep(300);

note('net errors', log.net); note('console', log.console.filter((c) => !c.includes('Failed to load resource')));
await save('flows-registrar.json', out);
await b.close();
