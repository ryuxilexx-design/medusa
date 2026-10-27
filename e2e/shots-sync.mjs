// Visual pass of «Sozlamalar → Integratsiyalar → MedPlus» and the mirrored badges (not part of `npm run e2e`):
// 1366×768 and 390×844, Uzbek and Russian. Saves full-page PNGs to SYNC_SHOTS (default e2e/shots/sync) and reports
// sideways scroll and visible tap targets under 44 px. Run with the isolated stack: `node run.mjs shots-sync`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launch, login, settle, sleep, clickText, BASE } from './lib.mjs';
const require = createRequire(import.meta.url);
const { buildXlsx } = require('../apps/api/dist/core/xlsx.js');
const DIR = process.env.SYNC_SHOTS || new URL('./shots/sync/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const file = DIR + 'medplus-patients.xlsx';
writeFileSync(file, buildXlsx(['ID', 'ФИО пациента', 'Дата рож.', 'Пол', 'Мобильный телефон'], [[52001, 'Ergasheva Zarina Botirovna', '04.04.1994', 'Ж', '+998 91 204 40 04'], [52003, 'Sanasiz Bemor', '', 'М', '']]));
const b = await launch();
const issues = [];
const audit = (p, tag) => p.evaluate((tag) => {
  const out = [];
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`${tag}: sideways scroll ${document.documentElement.scrollWidth}px`);
  for (const el of document.querySelectorAll('main button, main a, main [role=tab], main select, main input, [role=dialog] button, [role=dialog] input')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('[aria-hidden="true"]') || el.type === 'checkbox') continue;
    const after = getComputedStyle(el, '::after');
    const extra = after.content !== 'none' && after.position === 'absolute' ? Math.max(0, -parseFloat(after.top || '0')) * 2 : 0;
    if (r.height + extra < 43.5) out.push(`${tag}: small target ${Math.round(r.height)}px «${(el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40)}»`);
  }
  return out;
}, tag);
const snap = async (p, name) => { await settle(p); await sleep(300); issues.push(...await audit(p, name)); await p.screenshot({ path: `${DIR}${name}.png`, fullPage: true }); };
const tab = async (p, i) => { await p.evaluate((i) => document.querySelectorAll('main [role=tablist]')[1]?.querySelectorAll('[role=tab]')[i]?.click(), i); await settle(p); };
try {
  for (const [w, h, size] of [[1366, 768, 'desk'], [390, 844, 'phone']]) {
    for (const locale of ['uz', 'ru']) {
      const ctx = await b.createBrowserContext();
      const p = await ctx.newPage();
      await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      if (locale === 'ru') await p.setCookie({ name: 'meduza_lang', value: 'ru', url: BASE });
      await login(p, locale === 'ru' ? 'Руководитель' : 'Rahbar').catch(async () => login(p, 'Rahbar'));
      await p.evaluate(async (l) => { await fetch('/api/v1/me/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: l }) }); }, locale);
      const tag = `${size}-${locale}`;
      await p.goto(BASE + '/settings', { waitUntil: 'networkidle0' }); await settle(p);
      await clickText(p, locale === 'ru' ? 'Интеграции' : 'Integratsiyalar', '[role=tab]'); await settle(p);
      await snap(p, `${tag}-1-status-mapping`);
      await tab(p, 3); // import
      const input = await p.$('[data-testid="sync-file"]'); await input.uploadFile(file);
      await clickText(p, locale === 'ru' ? 'Прочитать файл' : 'Faylni o‘qish'); await settle(p);
      await clickText(p, locale === 'ru' ? 'Проверить' : 'Tekshirish'); await settle(p);
      await snap(p, `${tag}-2-import`);
      await tab(p, 4); await snap(p, `${tag}-3-reconcile`);
      await tab(p, 5); await snap(p, `${tag}-4-log`);
      const pt = await p.evaluate(async () => (await (await fetch('/api/v1/patients?search=973001101')).json()).data[0]);
      await p.goto(`${BASE}/patients/${pt.id}`, { waitUntil: 'networkidle0' }); await snap(p, `${tag}-5-patient`);
      const inv = await p.evaluate(async (id) => (await (await fetch(`/api/v1/patients/${id}/history`)).json()).data.invoices.find((i) => i.mirrored), pt.id);
      await p.goto(`${BASE}/cashier/${inv.id}`, { waitUntil: 'networkidle0' }); await snap(p, `${tag}-6-invoice`);
      await p.goto(`${BASE}/finance`, { waitUntil: 'networkidle0' }); await snap(p, `${tag}-7-finance-export`);
      await ctx.close();
    }
  }
} finally { await b.close(); }
console.log(issues.length ? `Muammolar:\n${[...new Set(issues)].join('\n')}` : 'Muammo topilmadi');
console.log(`Suratlar: ${DIR}`);
