// Doctor: order modal cancel with a selection; encounter request failing (500/abort) → error state or endless skeleton?
import { launch, ctxPage, login, track, sleep, SH, save, settle } from './common.mjs';
const out = []; const note = (k, v) => { out.push({ k, v }); console.log('•', k, JSON.stringify(v)?.slice(0, 400)); };
const b = await launch();
const A = await ctxPage(b); const log = track(A);
A.on('dialog', (d) => d.accept());
await login(A, 'Shifokor'); await settle(A); await sleep(800);
const clickBtn = (p, txt, scope = 'body') => p.evaluate((txt, scope) => { const x = [...document.querySelectorAll(scope + ' button')].filter((b) => b.offsetParent && !b.disabled).find((b) => b.textContent.trim().startsWith(txt)); x?.click(); return !!x; }, txt, scope);
note('order btn', await clickBtn(A, 'Tekshiruv buyurish')); await sleep(800);
note('order modal text', (await A.evaluate(() => document.querySelector('[role=dialog]')?.innerText))?.slice(0, 300));
note('empty submit button disabled?', await A.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].map((b) => `${b.textContent.trim()}${b.disabled ? '(disabled)' : ''}`)));
await A.evaluate(() => { const c = [...document.querySelectorAll('[role=dialog] input[type=checkbox], [role=dialog] [role=checkbox], [role=dialog] label')][0]; c?.click(); });
await sleep(300);
await A.screenshot({ path: SH + 'doc-order-selected.png' });
await clickBtn(A, 'Bekor qilish', '[role=dialog]'); await sleep(400);
note('after Cancel with selection: dialog open?', !!(await A.evaluate(() => document.querySelector('[role=dialog]'))));
note('after Cancel: dialog text', (await A.evaluate(() => document.querySelector('[role=dialog]')?.innerText))?.slice(0, 200));
await A.keyboard.press('Escape'); await sleep(300); await clickBtn(A, 'Yopish', '[role=dialog]'); await sleep(300);
// encounter request fails with 500
await A.setRequestInterception(true);
A.on('request', (r) => { if (/\/api\/v1\/encounters\/[^/]+$/.test(r.url()) && r.method() === 'GET') r.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Server xatosi (audit)' }, request_id: 'x' }) }); else r.continue(); });
const completed = await A.evaluate(() => [...document.querySelectorAll('ul a[href*="appointment="]')].find((a) => a.innerText.includes('Yakunlangan'))?.getAttribute('href'));
await A.evaluate((h) => document.querySelector(`a[href="${h}"]`)?.click(), completed);
await sleep(9000);
note('encounter 500: main text', (await A.evaluate(() => document.querySelector('main')?.innerText))?.slice(0, 400));
note('encounter 500: skeletons', await A.evaluate(() => document.querySelectorAll('main .animate-pulse').length));
await A.screenshot({ path: SH + 'doc-encounter-500.png' });
await save('flows-doctor2.json', out);
await b.close();
