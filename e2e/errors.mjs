// Browser error-state checks (isolated test stack): offline draft save, lost responses (draft, sign, payment),
// unsaved-changes guard, and "no success message when nothing was saved".
import { launch, newPage, login, shot, settle, clickText, sleep, check, waitText, BASE } from './lib.mjs';
const API = BASE.replace(':3100', ':4100') + '/api/v1';
const errors = [];
const b = await launch();
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('[aria-live] > div')].map((d) => d.textContent));
const setVal = (p, sel, v) => p.evaluate((sel, v) => { const el = document.querySelector(sel); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, sel, v);
async function textareaFor(p, label) { return p.evaluate((label) => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.replace('*', '').trim() === label); return '#' + CSS.escape(l.htmlFor); }, label); }
/** Fails the next matching request AFTER the server handled it (the response is lost on the way back). */
async function loseNextResponse(page, urlPattern, method) {
  const cdp = await page.createCDPSession();
  let armed = true;
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern, requestStage: 'Response' }] });
  cdp.on('Fetch.requestPaused', async (ev) => {
    if (armed && ev.request.method === method) { armed = false; await cdp.send('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'ConnectionReset' }); }
    else await cdp.send('Fetch.continueRequest', { requestId: ev.requestId });
  });
  return { done: () => !armed, off: () => cdp.send('Fetch.disable') };
}

// ---------- Doctor: offline save, retry, lost response, unsaved guard, lost sign response ----------
const d = await newPage(b, errors);
await login(d, 'Shifokor', 'Akmal Rasulov');
await d.goto(BASE + '/doctor', { waitUntil: 'networkidle0' }); await settle(d);
// Karimov Aziz is "arrived" in the seed → start his visit
await d.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Karimov Aziz')).click()); await settle(d);
await clickText(d, 'Qabulni boshlash'); await waitText(d, 'Klinik qayd'); await settle(d);
const complaints = await textareaFor(d, 'Shikoyatlar');
// print and preview of a draft live in the note's «Yana» menu
await d.click('[data-testid="note-more"]'); await sleep(200);
const encId = await d.evaluate(() => new URL(document.querySelector('a[href^="/print/note/"]').href).pathname.split('/').pop());
await d.keyboard.press('Escape');
const TEXT1 = 'Ikki kundan beri bosh og‘rig‘i (oflayn sinov matni)';
await setVal(d, complaints, TEXT1);
await d.setOfflineMode(true);
await clickText(d, 'Qoralamani saqlash'); await sleep(800);
const offlineErr = await d.evaluate(() => document.body.innerText.includes('Saqlanmadi'));
const textKept = await d.evaluate((s) => document.querySelector(s).value, complaints);
const okToast = (await toasts(d)).some((t) => t.includes('Qoralama saqlandi'));
await shot(d, 'err-01-draft-offline');
check(offlineErr, 'Oflayn: «Saqlanmadi» xatosi ko‘rinadi');
check(textKept === TEXT1, 'Oflayn: yozilgan matn formada qoldi');
check(!okToast, 'Oflayn: muvaffaqiyat xabari chiqmadi');
await d.setOfflineMode(false);
await clickText(d, 'Qoralamani saqlash'); await waitText(d, 'Qoralama saqlandi');
let server = await d.evaluate((id) => fetch(`/api/v1/encounters/${id}`).then((r) => r.json()).then((j) => j.data.note.complaints), encId);
check(server === TEXT1, 'Aloqa tiklangach qayta saqlash serverga yozildi');

// lost response on a draft save, then the user keeps typing and saves again (no false 409)
const TEXT2 = TEXT1 + ' — javob yo‘qolgan saqlash';
await setVal(d, complaints, TEXT2);
const lost = await loseNextResponse(d, '*/api/v1/encounters/*/draft', 'PUT');
await clickText(d, 'Qoralamani saqlash');
// wait for the outcome instead of a fixed pause (the dev server can be slow); the check below still decides
await d.waitForFunction(() => document.body.innerText.includes('Saqlanmadi'), { timeout: 20000 }).catch(() => undefined);
check(lost.done() && await d.evaluate(() => document.body.innerText.includes('Saqlanmadi')), 'Javob yo‘qolgan saqlash: xato ko‘rsatildi (muvaffaqiyat emas)');
server = await d.evaluate((id) => fetch(`/api/v1/encounters/${id}`).then((r) => r.json()).then((j) => j.data.note.complaints), encId);
check(server === TEXT2, 'Javob yo‘qolgan bo‘lsa ham server saqlagan (haqiqiy holat)');
const TEXT3 = TEXT2 + ' + qo‘shimcha';
await setVal(d, complaints, TEXT3);
await clickText(d, 'Qoralamani saqlash'); await sleep(1200);
server = await d.evaluate((id) => fetch(`/api/v1/encounters/${id}`).then((r) => r.json()).then((j) => j.data.note.complaints), encId);
const alertsNow = await d.evaluate(() => [...document.querySelectorAll('[role=alert]')].map((a) => a.textContent).join(' '));
check(server === TEXT3 && !alertsNow.includes('Saqlanmadi') && (await toasts(d)).some((t) => t.includes('Qoralama saqlandi')), 'Qayta saqlash versiya konfliktisiz o‘tdi (avtomatik tiklash)');
await lost.off();

// unsaved guard: type, then click a sidebar link
await setVal(d, complaints, TEXT3 + ' (saqlanmagan)');
await d.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.textContent.includes('Navbat')).click()); await sleep(500);
const guard = await d.evaluate(() => document.body.innerText.includes('Saqlanmagan o‘zgarishlar bor'));
await shot(d, 'err-02-unsaved-guard');
check(guard && new URL(d.url()).pathname === '/doctor', 'Saqlanmagan matn bilan menyuga o‘tishda ogohlantirish chiqdi, sahifa almashmadi');
await clickText(d, 'Sahifada qolish'); await sleep(300);
check(await d.evaluate((s) => document.querySelector(s).value.endsWith('(saqlanmagan)'), complaints), '«Sahifada qolish» — matn joyida');
await clickText(d, 'Qoralamani saqlash'); await waitText(d, 'Qoralama saqlandi'); await sleep(300);

// lost response on sign → retry shows the real (signed) state, not an error
for (const [label, v] of [['Ko‘rik', 'O‘zgarishsiz (sinov)'], ['Tashxis / xulosa', 'Sinov xulosasi'], ['Tavsiyalar', 'Dam olish']]) await setVal(d, await textareaFor(d, label), v);
const lostSign = await loseNextResponse(d, '*/api/v1/encounters/*/sign', 'POST');
await clickText(d, 'Tasdiqlash va yakunlash'); await sleep(300);
await clickText(d, 'Tasdiqlash', '[role=dialog] button'); await sleep(1000);
const signErr = await d.evaluate(() => document.body.innerText.includes('Tasdiqlanmadi'));
check(lostSign.done() && signErr, 'Tasdiqlash javobi yo‘qoldi: interfeys muvaffaqiyat emas, xato ko‘rsatdi');
await lostSign.off();
await clickText(d, 'Tasdiqlash va yakunlash'); await sleep(300);
await clickText(d, 'Tasdiqlash', '[role=dialog] button'); await sleep(1500);
const signedNow = await d.evaluate(() => document.body.innerText.includes('Tasdiqladi:'));
check(signedNow && (await toasts(d)).some((t) => t.includes('allaqachon tasdiqlangan')), 'Qayta urinish: «allaqachon tasdiqlangan» — haqiqiy holat ko‘rsatildi');

// ---------- Cashier: lost payment response, retry with the same key ----------
const c = await newPage(b, errors);
await login(c, 'Kassir');
const inv = await c.evaluate(() => fetch('/api/v1/invoices?status=unpaid&page_size=50').then((r) => r.json()).then((j) => j.data.find((i) => i.services.startsWith('Terapevt'))));
await c.goto(`${BASE}/cashier/${inv.id}`, { waitUntil: 'networkidle0' }); await settle(c);
const lostPay = await loseNextResponse(c, '*/api/v1/invoices/*/payments', 'POST');
await setVal(c, 'form input[inputmode=decimal]', '50000');
await clickText(c, 'To‘lovni qayd qilish', 'form button');
await c.waitForFunction(() => document.body.innerText.includes('Server javobi olinmadi'), { timeout: 20000 }).catch(() => undefined);
const pendingUi = await c.evaluate(() => document.body.innerText.includes('Server javobi olinmadi') && [...document.querySelectorAll('form button')].some((b) => b.textContent.includes('Shu to‘lovni qayta yuborish')));
const noSuccess = !(await toasts(c)).some((t) => t.includes('qayd etildi'));
await shot(c, 'err-03-payment-lost');
check(lostPay.done() && pendingUi && noSuccess, 'To‘lov javobi yo‘qoldi: «javob olinmadi» holati, muvaffaqiyat xabari yo‘q, summa qulflangan');
await lostPay.off();
await clickText(c, 'Shu to‘lovni qayta yuborish', 'form button'); await sleep(1200);
const pays = await c.evaluate((id) => fetch(`/api/v1/invoices/${id}`).then((r) => r.json()).then((j) => j.data.payments), inv.id);
check(pays.length === 1 && pays[0].amount === 5000000, `Bir xil kalit bilan qayta yuborish: hisobda faqat 1 ta to‘lov (${pays.length})`);
check((await toasts(c)).some((t) => t.includes('avvalroq qayd etilgan')), 'Qayta yuborishda «avvalroq qayd etilgan — ikkinchi marta yozilmadi» xabari');
await shot(c, 'err-04-payment-replayed');

// ---------- Registrar: dirty modal closes only after confirmation ----------
const r = await newPage(b, errors);
await login(r, 'Registrator');
await r.goto(BASE + '/patients', { waitUntil: 'networkidle0' });
await clickText(r, 'Bemor qo‘shish'); await sleep(200);
await r.evaluate(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.startsWith('Familiya')); const i = document.getElementById(l.htmlFor); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Sinov'); i.dispatchEvent(new Event('input', { bubbles: true })); });
await r.keyboard.press('Escape'); await sleep(300);
check(await r.evaluate(() => document.body.innerText.includes('Saqlanmagan o‘zgarishlar o‘chadi')), 'Forma: Esc bosilganda saqlanmagan o‘zgarish haqida so‘raldi');
await shot(r, 'err-05-modal-dirty');

const unexpected = errors.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/.test(e));
check(!unexpected.length, 'Konsolda kutilmagan JS xato yo‘q' + (unexpected.length ? ': ' + unexpected.join(' | ') : ''));
await b.close();
void API;
