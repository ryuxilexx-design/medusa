// Doctor workspace: required-to-sign validation, offline draft save, stale two-tab save, encounter load failure,
// AI sample label, order modal cancel-dirty, sign confirm double-click.
import { execFileSync } from 'node:child_process';
import { launch, ctxPage, login, track, go, sleep, SH, save, settle } from './common.mjs';
const Q = (sql) => execFileSync(new URL('./q.sh', import.meta.url).pathname, [sql]).toString().trim();
const out = []; const note = (k, v) => { out.push({ k, v }); console.log('•', k, JSON.stringify(v)?.slice(0, 500)); };
const b = await launch();
const A = await ctxPage(b); const log = track(A);
A.on('dialog', (d) => { note('browser dialog', d.type() + ' ' + d.message()); d.accept(); });
await login(A, 'Shifokor');
await settle(A); await sleep(800);
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('[aria-live] > div')].map((d) => d.innerText));
const setField = (p, label, value) => p.evaluate((label, value) => {
  const lab = [...document.querySelectorAll('label')].find((l) => l.textContent.replace('*', '').trim().startsWith(label));
  const el = document.getElementById(lab.htmlFor);
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value;
}, label, value);
const getField = (p, label) => p.evaluate((label) => { const lab = [...document.querySelectorAll('label')].find((l) => l.textContent.replace('*', '').trim().startsWith(label)); return document.getElementById(lab.htmlFor)?.value; }, label);
const clickBtn = (p, txt, scope = 'body') => p.evaluate((txt, scope) => { const x = [...document.querySelectorAll(scope + ' button')].filter((b) => b.offsetParent && !b.disabled).find((b) => b.textContent.trim().startsWith(txt)); x?.click(); return !!x; }, txt, scope);
const url = A.url(); note('doctor url', url);
const encId = Q(`select e.id from encounters e join appointments a on a.id=e.appointment_id where a.id='${new URL(url).searchParams.get('appointment')}'`);
note('encounter', encId);

// 1. required-to-sign
const diag0 = await getField(A, 'Tashxis');
await setField(A, 'Tashxis', '');
await clickBtn(A, 'Tasdiqlash va yakunlash'); await sleep(600);
note('sign with empty diagnosis: focused', await A.evaluate(() => document.activeElement?.id && document.querySelector(`label[for="${document.activeElement.id}"]`)?.textContent));
note('sign with empty: alerts', await A.evaluate(() => [...document.querySelectorAll('[role=alert], .text-red-700')].map((e) => e.textContent).filter(Boolean).slice(0, 6)));
await A.screenshot({ path: SH + 'doc-sign-missing.png' });

// 2. offline save
await setField(A, 'Tashxis', 'Oflayn tashxis matni');
await A.setOfflineMode(true);
await clickBtn(A, 'Qoralamani saqlash'); await sleep(1500);
note('offline save: toasts', await toasts(A));
note('offline save: diag kept', await getField(A, 'Tashxis'));
note('offline save: error text', await A.evaluate(() => [...document.querySelectorAll('.sticky [role=alert], .sticky .text-red-900, .sticky div')].map((e) => e.innerText).find((t) => /saqlan/i.test(t))?.slice(0, 200)));
await A.screenshot({ path: SH + 'doc-offline-save.png' });
await A.setOfflineMode(false);
await clickBtn(A, 'Qoralamani saqlash'); await sleep(1500);
note('online retry: toasts', await toasts(A));
note('db diagnosis', Q(`select diagnosis, version from clinical_notes where encounter_id='${encId}'`));

// 3. stale save from a second tab
const B = await A.browserContext().newPage(); await B.setViewport({ width: 1366, height: 768 }); track(B);
await B.goto(url, { waitUntil: 'networkidle0' }); await sleep(1000);
await setField(B, 'Tashxis', 'Tab B tashxis'); await clickBtn(B, 'Qoralamani saqlash'); await sleep(1500);
note('tab B save toasts', await toasts(B));
await A.bringToFront();
await setField(A, 'Tashxis', 'Tab A tashxis (eski versiya)'); await clickBtn(A, 'Qoralamani saqlash'); await sleep(1500);
note('tab A stale save toasts', await toasts(A));
note('tab A stale: alert', await A.evaluate(() => [...document.querySelectorAll('.sticky div')].map((e) => e.innerText).find((t) => /saqlan|yangila|o‘zgar/i.test(t))?.slice(0, 250)));
note('tab A stale: kept text', await getField(A, 'Tashxis'));
note('db diagnosis after stale', Q(`select diagnosis, version from clinical_notes where encounter_id='${encId}'`));
await A.screenshot({ path: SH + 'doc-stale-save.png' });
await B.close();
// restore diagnosis & save
await A.reload({ waitUntil: 'networkidle0' }); await sleep(800);
note('after reload: diag shown', await getField(A, 'Tashxis'));

// 4. AI modal
const aiOk = await clickBtn(A, 'AI bilan tartiblash'); await sleep(800);
note('AI modal opened', aiOk);
note('AI modal text', (await A.evaluate(() => document.querySelector('[role=dialog]')?.innerText))?.slice(0, 400));
await A.screenshot({ path: SH + 'doc-ai-modal.png' });
await A.keyboard.press('Escape'); await sleep(300);

// 5. order modal: pick a test then Cancel
await clickBtn(A, 'Buyurtma'); await sleep(700);
note('order modal text', (await A.evaluate(() => document.querySelector('[role=dialog]')?.innerText))?.slice(0, 300));
await A.evaluate(() => { const c = document.querySelector('[role=dialog] input[type=checkbox]'); c?.click(); });
await sleep(200);
await A.evaluate(() => { const x = [...document.querySelectorAll('[role=dialog] button')].find((b) => /Bekor|Orqaga/.test(b.textContent)); x?.click(); });
await sleep(400);
note('order modal after Cancel with a selection: open?', !!(await A.evaluate(() => document.querySelector('[role=dialog]'))));
await A.screenshot({ path: SH + 'doc-order-cancel.png' });
await A.keyboard.press('Escape'); await sleep(200);
await A.evaluate(() => { const x = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Yopish'); x?.click(); });

// 6. encounter load failure: open a completed visit while API refuses (offline)
const completed = await A.evaluate(() => [...document.querySelectorAll('ul a[href*="appointment="]')].find((a) => a.innerText.includes('Yakunlangan'))?.getAttribute('href'));
await A.setOfflineMode(true);
await A.evaluate((h) => document.querySelector(`a[href="${h}"]`)?.click(), completed);
await sleep(4000);
note('offline open completed visit: main text', (await A.evaluate(() => document.querySelector('main')?.innerText))?.slice(0, 300));
await A.screenshot({ path: SH + 'doc-encounter-offline.png' });
await A.setOfflineMode(false); await sleep(4000);
note('after online again: has note card', (await A.evaluate(() => document.querySelector('main')?.innerText))?.includes('Klinik qayd'));
note('net', log.net); note('console', log.console.filter((c) => !c.includes('Failed to load resource')).slice(0, 10));
await save('flows-doctor.json', out);
await b.close();
