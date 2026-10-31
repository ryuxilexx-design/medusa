// Price-list import in the browser (docs/PRICE_LIST_IMPORT.md): Sozlamalar → Xizmatlar → «Narxlar ro‘yxatini yuklash»,
// file → guessed columns → outcome counts and error rows → «Yuklash» → toast only after the server answered → new price
// in the catalogue. Then a visual pass of the preview at 1366×768 and 390×844 in uz and ru (sideways scroll, tap targets).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launch, newPage, login, settle, clickText, waitText, sleep, check, BASE, SHOTS } from './lib.mjs';
const require = createRequire(import.meta.url);
const { buildXlsx } = require('../apps/api/dist/core/xlsx.js');
const DIR = SHOTS + 'price-import/';
mkdirSync(DIR, { recursive: true });
const file = DIR + 'prays.xlsx';
writeFileSync(file, buildXlsx(['Прейскурант'], [
  ['Код', 'Наименование услуги', 'Категория', 'Цена, сум'],
  ['C01', 'Terapevt konsultatsiyasi', 'Консультация', '150 000,00'],
  [null, 'Kardiolog konsultatsiyasi', null, '250 000'],
  [null, 'УЗИ щитовидной железы', 'УЗИ', '180 000'],
  [null, 'Yomon narx', null, 'abc'],
]));
const file2 = DIR + 'prays-2.xlsx';
writeFileSync(file2, buildXlsx(['Наименование', 'Цена'], [['Kardiolog konsultatsiyasi', '260 000']]));
const file3 = DIR + 'prays-3.xlsx';
writeFileSync(file3, buildXlsx(['Код', 'Наименование услуги', 'Цена, сум'], [['C02', 'Terapevt qayta ko‘rigi', '120 000'], ['C04', 'Kardiolog qayta ko‘rigi', '150 000'],
  [null, 'Гистероскопия диагностическая с биопсией эндометрия', '1 450 000'], [null, 'Yomon IKPU', '-1']]));
const errors = [];
const issues = [];
const audit = (p, tag) => p.evaluate((tag) => {
  const out = [];
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`${tag}: sideways scroll ${document.documentElement.scrollWidth}px`);
  for (const el of document.querySelectorAll('[role=dialog] button, [role=dialog] input, [role=dialog] select')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('[aria-hidden="true"]')) continue;
    const after = getComputedStyle(el, '::after');
    const extra = after.content !== 'none' && after.position === 'absolute' ? Math.max(0, -parseFloat(after.top || '0')) * 2 : 0;
    if (r.height + extra < 43.5) out.push(`${tag}: small target ${Math.round(r.height)}px «${(el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40)}»`);
  }
  return out;
}, tag);
const b = await launch();
const openImport = async (p, ru = false, f = file) => {
  await p.goto(BASE + '/settings', { waitUntil: 'networkidle0' }); await settle(p);
  await clickText(p, ru ? 'Услуги' : 'Xizmatlar', '[role=tab]'); await settle(p);
  await p.click('[data-testid="price-import-open"]'); await sleep(300);
  const input = await p.$('[data-testid="price-import-file"]'); await input.uploadFile(f);
  await p.click('[data-testid="price-import-read"]'); await settle(p);
  await p.waitForSelector('[data-testid="price-import-preview"]');
};
try {
  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  await openImport(m);
  const mapped = await m.evaluate(() => [...document.querySelectorAll('[role=dialog] select')].map((s) => s.options[s.selectedIndex]?.text));
  check(mapped.includes('Наименование услуги') && mapped.includes('Цена, сум') && mapped.includes('Код'), 'Ustunlar ruscha sarlavhalardan taxmin qilindi');
  const pv = await m.evaluate(() => document.querySelector('[data-testid="price-import-preview"]').innerText);
  check(pv.includes('Yangi: 1') && pv.includes('Narx o‘zgaradi: 1') && pv.includes('O‘zgarishsiz: 1') && pv.includes('Xato: 1'), 'Ko‘rib chiqish: 1 yangi, 1 narx, 1 o‘zgarishsiz, 1 xato');
  check(pv.includes('Narx son emas'), 'Xato qatori sababi bilan');
  const before = await m.evaluate(async () => (await (await fetch('/api/v1/services?active=all')).json()).data.find((s) => s.name === 'Kardiolog konsultatsiyasi').price);
  check(Number(before) === 22_000_000, 'Ko‘rib chiqish narxni o‘zgartirmadi');
  await m.screenshot({ path: DIR + 'flow-1-preview.png' });
  await m.click('[data-testid="price-import-run"]');
  await waitText(m, 'Narxlar yuklandi');
  await settle(m);
  const after = await m.evaluate(async () => (await (await fetch('/api/v1/services?active=all')).json()).data);
  check(Number(after.find((s) => s.name === 'Kardiolog konsultatsiyasi').price) === 25_000_000 && after.some((s) => s.name === 'УЗИ щитовидной железы' && s.category === 'ultrasound'), 'Yuklandi: yangi narx va yangi xizmat katalogda');
  check(!(await m.$('[role=dialog]')), 'Muvaffaqiyatdan keyin oyna yopildi');
  await m.screenshot({ path: DIR + 'flow-2-done.png' });

  // the server refuses (the file has gone bad between preview and import): error toast, the dialog and the choice stay
  await openImport(m, false, file2);
  await m.evaluate(() => { const f = window.fetch; window.fetch = (u, o) => (String(u).endsWith('/services/import') ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'BAD_FILE', message: 'Faylni o‘qib bo‘lmadi: jadval topilmadi' } }), { status: 422, headers: { 'content-type': 'application/json' } })) : f(u, o)); });
  await m.click('[data-testid="price-import-run"]');
  await waitText(m, 'Faylni o‘qib bo‘lmadi');
  check(!!(await m.$('[data-testid="price-import-preview"]')) && !(await m.evaluate(() => document.body.innerText.includes('Narxlar yuklandi'))), 'Xatoda oyna, fayl va ustunlar saqlanadi, muvaffaqiyat xabari yo‘q');
  const still = await m.evaluate(async () => (await (await fetch('/api/v1/services?active=all')).json()).data.find((s) => s.name === 'Kardiolog konsultatsiyasi').price);
  check(Number(still) === 25_000_000, 'Rad etilgan yuklash narxni o‘zgartirmadi');
  await m.close();

  for (const [w, h, size] of [[1366, 768, 'desk'], [390, 844, 'phone']]) {
    for (const locale of ['uz', 'ru']) {
      const ctx = await b.createBrowserContext();
      const p = await ctx.newPage();
      await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await login(p, 'Rahbar');
      await p.evaluate(async (l) => { await fetch('/api/v1/me/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: l }) }); }, locale);
      await openImport(p, locale === 'ru', file3);
      await sleep(300);
      issues.push(...await audit(p, `${size}-${locale}`));
      await p.screenshot({ path: `${DIR}${size}-${locale}-preview.png` });
      await p.evaluate(() => document.querySelector('[data-modal-body]')?.scrollBy(0, 2000));
      await sleep(200);
      await p.screenshot({ path: `${DIR}${size}-${locale}-preview-bottom.png` });
      await ctx.close();
    }
  }
  check(!issues.length, issues.length ? `Ko‘rinish muammolari:\n${[...new Set(issues)].join('\n')}` : 'Ko‘rinish: yon aylantirish yo‘q, tugmalar ≥ 44 px (1366 va 390, uz va ru)');
  check(!errors.length, errors.length ? `Konsol xatolari: ${errors.slice(0, 5).join(' | ')}` : 'Konsolda xato yo‘q');
} finally { await b.close(); }
