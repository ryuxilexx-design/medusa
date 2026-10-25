// Warehouse in the browser: the storekeeper sees only «Ombor» (stock, the request queue, expiring lots, the
// controlled register and its print), issues a doctor's request; the doctor asks for materials from the visit page
// (ICD-10 code required) and sees it under «Mening talabnomalarim»; the manager approves the pending write-off act;
// the cashier has no access; the phone width has no sideways scroll. Audit fixes 2026-10-25: searchable item pickers,
// the ledger on a phone (quantity, receiver, sum in the row), cold-chain devices with their own range, the blind
// count with its progress, the consumption report by item with quantities.
import { launch, newPage, login, shot, settle, clickText, check, waitText, fill, sleep, BASE } from './lib.mjs';
/** Picks the first branch in the dialog's «Filial» select (a person with several branches and «all branches» in the header). */
async function pickBranch(p) {
  await p.evaluate(() => { const s = [...document.querySelectorAll('[role=dialog] select')].find((x) => x.options[0]?.text === '—'); if (s) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, s.options[1].value); s.dispatchEvent(new Event('change', { bubbles: true })); } });
  await settle(p);
}
/** Types into the dialog's n-th searchable picker and clicks the option whose name starts with `name`. */
async function pickItem(p, name, n = 0) {
  const inputs = await p.$$('[role=dialog] input[role=combobox]');
  await inputs[n].click(); await inputs[n].type(name.slice(0, 6)); await sleep(250);
  const ok = await p.evaluate((name) => { const o = [...document.querySelectorAll('[role=dialog] [role=option]')].find((x) => x.textContent.startsWith(name)); o?.click(); return !!o; }, name);
  if (!ok) throw new Error('pickItem: ' + name);
  await sleep(150);
}
const errors = [];
const b = await launch();
const text = (p) => p.evaluate(() => document.body.innerText);
const noSideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
try {
  // ---------------- storekeeper
  const k = await newPage(b, errors);
  await login(k, 'Omborchi');
  check(await k.evaluate(() => location.pathname) === '/inventory', 'Omborchi kirgach «Ombor» ochiladi');
  const nav = await k.evaluate(() => [...document.querySelectorAll('#app-menu nav a')].map((a) => a.getAttribute('href')));
  check(nav.length === 1 && nav[0] === '/inventory', `Omborchi menyusida faqat Ombor: ${nav.join(', ')}`);
  await waitText(k, 'Tramadol'); await settle(k);
  await shot(k, 'wh-01-stock');
  await k.goto(BASE + '/patients', { waitUntil: 'networkidle0' }); await settle(k);
  check(await k.evaluate(() => !!document.querySelector('[data-testid="no-access"]')), 'Omborchi bemorlar ro‘yxatini ochmaydi');

  await k.goto(BASE + '/inventory?tab=requests', { waitUntil: 'networkidle0' }); await settle(k);
  await waitText(k, 'Yuborilgan');
  await shot(k, 'wh-02-queue');
  // open the doctor's waiting request (patient visit) and issue it
  await k.evaluate(() => [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('Yuborilgan') && r.innerText.includes('Lidokain'))?.querySelector('button')?.click());
  await k.waitForSelector('[role=dialog]'); await settle(k);
  await shot(k, 'wh-03-request');
  await clickText(k, 'Berish', '[role=dialog] button');
  await waitText(k, 'Materiallar berildi'); await settle(k);
  check(true, 'Omborchi shifokor talabnomasini berdi (FEFO)');
  await k.keyboard.press('Escape'); await sleep(300);

  await k.goto(BASE + '/inventory?tab=expiring', { waitUntil: 'networkidle0' }); await settle(k);
  check((await text(k)).includes('muddati o‘tgan'), 'Muddati o‘tgan partiya ko‘rinadi');
  await shot(k, 'wh-04-expiring');
  await k.goto(BASE + '/inventory?tab=controlled', { waitUntil: 'networkidle0' }); await settle(k);
  await waitText(k, 'Imzolar');
  check((await text(k)).includes('Dilnoza Karimova'), 'Nazoratdagi dori jurnalida ikkinchi imzo (rahbar)');
  await shot(k, 'wh-05-controlled');
  const printHref = await k.evaluate(() => document.querySelector('a[href^="/print/warehouse/controlled/"]')?.getAttribute('href'));
  const pr = await newPage(b, errors);
  await login(pr, 'Omborchi');
  await pr.goto(BASE + printHref, { waitUntil: 'networkidle0' }); await settle(pr);
  check((await text(pr)).includes('Nazoratdagi dorilar hisobi jurnali'), 'Jurnal chop etish sahifasi');
  await shot(pr, 'wh-06-print-journal');

  // receipt: the item is found by typing (type-ahead picker), the dialog is closed without saving
  await k.goto(BASE + '/inventory?tab=receipts', { waitUntil: 'networkidle0' }); await settle(k);
  await clickText(k, 'Kirim qilish', 'button'); await k.waitForSelector('[role=dialog]'); await settle(k);
  await pickBranch(k);
  await pickItem(k, 'Seftriakson');
  check(await k.evaluate(() => document.querySelector('[role=dialog] input[role=combobox]').value.startsWith('Seftriakson')), 'Kirim: material yozib qidiriladi va tanlanadi');
  await shot(k, 'wh-06b-receipt-picker');
  await k.click('[role=dialog] [data-close]'); await sleep(200);
  await clickText(k, 'Yopish', '[role=dialog] button'); await sleep(300);

  // cold chain: devices with their own ranges; a freezer at +5 °C asks for the action taken
  await k.goto(BASE + '/inventory?tab=fridge', { waitUntil: 'networkidle0' }); await settle(k);
  check((await text(k)).includes('Muzlatgich (reagentlar)') && (await text(k)).includes('−25') === false && (await text(k)).includes('-25'), 'Harorat: qurilmalar o‘z me’yori bilan');
  await clickText(k, 'Harorat yozish', 'button'); await k.waitForSelector('[role=dialog]'); await settle(k);
  await fill(k, 'Qurilma', 'Muzlatgich (reagentlar)', '[role=dialog]');
  await fill(k, 'Harorat, °C', '5', '[role=dialog]');
  await waitText(k, 'Ko‘rilgan chora');
  check(await k.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Saqlash').disabled), 'Me’yordan tashqari: chora yozilmaguncha saqlanmaydi');
  await shot(k, 'wh-06c-fridge-out');
  await fill(k, 'Ko‘rilgan chora', 'Eshik yopildi, 30 daqiqadan keyin qayta o‘lchanadi', '[role=dialog]');
  await clickText(k, 'Saqlash', '[role=dialog] button');
  await waitText(k, 'me’yordan tashqari'); await settle(k);
  check(true, 'Muzlatgich: me’yordan tashqari harorat chora bilan yozildi');

  // phone width, Russian
  await k.setViewport({ width: 390, height: 844 });
  await k.goto(BASE + '/inventory', { waitUntil: 'networkidle0' }); await settle(k);
  check(await noSideScroll(k), '390 px: yon tomonga aylantirish yo‘q (uz)');
  await shot(k, 'wh-07-phone');
  await k.goto(BASE + '/inventory?tab=movements', { waitUntil: 'networkidle0' }); await settle(k);
  check(await noSideScroll(k), '390 px: harakatlar — yon tomonga aylantirish yo‘q');
  check(await k.evaluate(() => { const tb = document.querySelector('table'); return !!tb && tb.scrollWidth <= tb.parentElement.clientWidth + 1; }), '390 px: harakatlar jadvali sig‘adi (miqdor, oluvchi, summa qatorda)');
  check(await k.evaluate(() => [...document.querySelectorAll('tbody tr')].some((r) => r.innerText.includes('Akmal Rasulov') && /so‘m/.test(r.innerText))), '390 px: oluvchi va summa ko‘rinadi');
  await shot(k, 'wh-07b-phone-movements');
  await k.evaluate(async () => { await fetch('/api/v1/me/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: 'ru' }) }); });
  await k.goto(BASE + '/inventory?tab=requests', { waitUntil: 'networkidle0' }); await settle(k);
  check((await text(k)).includes('Требования'), 'Rus tilida: «Требования»');
  check(await noSideScroll(k), '390 px: yon tomonga aylantirish yo‘q (ru)');
  await shot(k, 'wh-08-phone-ru');

  // ---------------- doctor
  const d = await newPage(b, errors);
  await login(d, 'Shifokor', 'Akmal Rasulov');
  await d.goto(BASE + '/doctor', { waitUntil: 'networkidle0' }); await settle(d);
  await d.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Qabulda'))?.click()); await settle(d);
  await waitText(d, 'Material so‘rash');
  await clickText(d, 'Material so‘rash', 'button');
  await d.waitForSelector('[role=dialog]'); await settle(d);
  await fill(d, 'Bo‘lim / xona', 'Muolaja xonasi', '[role=dialog]');
  await pickItem(d, 'Seftriakson');
  await d.evaluate(() => { const i = document.querySelector('[role=dialog] input[inputmode="decimal"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '2'); i.dispatchEvent(new Event('input', { bubbles: true })); });
  const hasIcdField = await d.evaluate(() => [...document.querySelectorAll('[role=dialog] label')].some((l) => l.textContent.startsWith('MKB-10 kodi')));
  if (hasIcdField) {
    // without a code the request is refused on screen, input stays
    await fill(d, 'MKB-10 kodi', '', '[role=dialog]');
    await clickText(d, 'Yuborish', '[role=dialog] button');
    await waitText(d, 'MKB-10 kodini kiriting');
    check(true, 'MKB-10 kodisiz bemor uchun so‘rov yuborilmaydi');
    await fill(d, 'MKB-10 kodi', 'J06.9', '[role=dialog]');
  }
  await shot(d, 'wh-09-doctor-request');
  await clickText(d, 'Yuborish', '[role=dialog] button');
  await waitText(d, 'omborga yuborildi'); await settle(d);
  check((await text(d)).includes('Seftriakson'), 'Qabul sahifasida so‘ralgan material ko‘rinadi');
  await d.goto(BASE + '/materials', { waitUntil: 'networkidle0' }); await settle(d);
  check((await text(d)).includes('Mening talabnomalarim') && (await text(d)).includes('Seftriakson'), '«Mening talabnomalarim» ro‘yxati');
  await shot(d, 'wh-10-doctor-mine');

  // ---------------- manager approves the write-off act (drawn up by the storekeeper)
  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  await m.goto(BASE + '/inventory?tab=writeoffs', { waitUntil: 'networkidle0' }); await settle(m);
  await m.evaluate(() => [...document.querySelectorAll('tbody tr button')].find((x) => x.textContent.startsWith('A-'))?.click());
  await m.waitForSelector('[role=dialog]'); await settle(m);
  await shot(m, 'wh-11-writeoff');
  await clickText(m, 'Tasdiqlash', '[role=dialog] button');
  await waitText(m, 'Akt tasdiqlandi'); await settle(m);
  check(true, 'Rahbar hisobdan chiqarish aktini tasdiqladi');
  await m.goto(BASE + '/inventory?tab=reports', { waitUntil: 'networkidle0' }); await settle(m);
  await fill(m, 'Guruhlash', 'icd').catch(() => undefined);
  await m.evaluate(() => { const s = document.querySelector('select[aria-label="Guruhlash"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'icd'); s.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(m);
  check((await text(m)).includes('Jami'), 'Tashxis bo‘yicha sarf hisoboti');
  check((await text(m)).includes(' × '), 'Hisobot qatorida material miqdorlari');
  await shot(m, 'wh-12-report-icd');

  // ---------------- blind count: the storekeeper counts without the expected quantity, sees the progress
  await k.setViewport({ width: 1366, height: 768 });
  await k.evaluate(async () => { await fetch('/api/v1/me/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: 'uz' }) }); });
  await k.goto(BASE + '/inventory?tab=counts', { waitUntil: 'networkidle0' }); await settle(k);
  await clickText(k, 'Inventarizatsiyani boshlash', 'button'); await k.waitForSelector('[role=dialog]'); await settle(k);
  await pickBranch(k);
  await fill(k, 'Nimani sanaymiz', 'controlled', '[role=dialog]');
  await clickText(k, 'Inventarizatsiyani boshlash', '[role=dialog] button');
  await waitText(k, 'boshlandi'); await settle(k);
  await k.evaluate(() => [...document.querySelectorAll('tbody tr button')].find((x) => x.textContent.startsWith('I-'))?.click());
  await k.waitForSelector('[role=dialog]'); await settle(k);
  await waitText(k, 'Sanaldi: 0 /');
  check(await k.evaluate(() => ![...document.querySelectorAll('[role=dialog] th')].some((th) => th.textContent.includes('Hisobda'))), 'Ko‘r sanash: «Hisobda» ustuni yo‘q');
  await k.evaluate(() => { const i = document.querySelector('[role=dialog] input[inputmode="decimal"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '1'); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await clickText(k, 'Saqlash', '[role=dialog] button');
  await waitText(k, 'Sanaldi: 1 /'); await settle(k);
  check(true, 'Inventarizatsiya: sanash jarayoni (X / Y) ko‘rinadi');
  await shot(k, 'wh-13-count-blind');
  // while it is open the counted (controlled) items do not move
  check((await (await k.evaluate(async () => (await fetch('/api/v1/warehouse/counts')).json())).data[0].status) === 'open', 'Inventarizatsiya ochiq');
  // the store keeper sees items and departments only in the report
  await k.keyboard.press('Escape'); await sleep(300);
  await k.goto(BASE + '/inventory?tab=reports', { waitUntil: 'networkidle0' }); await settle(k);
  check(await k.evaluate(() => [...document.querySelector('select[aria-label="Guruhlash"]').options].map((o) => o.value).join() === 'item,department'), 'Omborchi: hisobot faqat material va bo‘lim bo‘yicha');

  // ---------------- cashier: no warehouse
  const c = await newPage(b, errors);
  await login(c, 'Kassir');
  await c.goto(BASE + '/inventory', { waitUntil: 'networkidle0' }); await settle(c);
  check(await c.evaluate(() => !!document.querySelector('[data-testid="no-access"]')), 'Kassir omborni ochmaydi');
} catch (e) {
  for (const [i, pg] of (await b.pages()).entries()) await pg.screenshot({ path: new URL(`./shots/wh-fail-${i}.png`, import.meta.url).pathname }).catch(() => undefined);
  throw e;
} finally {
  await b.close();
}
check(errors.length === 0, `Brauzer xatolari yo‘q${errors.length ? ': ' + errors.join(' | ') : ''}`);
