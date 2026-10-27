// Visual pass of the discounts / companies screens (not part of `npm run e2e`): «Chegirmalar» (report, rules,
// categories and their forms), «Kompaniyalar» (receivables, directory, payments, the payment dialog), the cashier's
// bill with the «Chegirma va to‘lovchi» block, the patient form's payer fields, the company debtors in «Moliya» and the
// reconciliation act — at 1366×768 and 390×844 in Uzbek and Russian. Saves PNGs to DISC_SHOTS (default
// e2e/shots/discounts) and reports sideways scroll, small tap targets and clipped cells. `node run.mjs shots-discounts`.
import { mkdirSync } from 'node:fs';
import { launch, login, settle, sleep, BASE } from './lib.mjs';
const DIR = process.env.DISC_SHOTS || new URL('./shots/discounts/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const b = await launch();
const issues = [];
const audit = (p, tag) => p.evaluate((tag) => {
  const out = [];
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`${tag}: sideways scroll ${document.documentElement.scrollWidth}px`);
  for (const el of document.querySelectorAll('main button, main a, main [role=tab], [role=dialog] button, [role=dialog] a, [role=dialog] input, [role=dialog] select')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('[aria-hidden="true"]')) continue;
    const after = getComputedStyle(el, '::after');
    const extra = after.content !== 'none' && after.position === 'absolute' ? Math.max(0, -parseFloat(after.top || '0')) * 2 : 0;
    if (r.height + extra < 43.5 && el.type !== 'checkbox' && el.type !== 'radio') out.push(`${tag}: small target ${Math.round(r.height)}px «${(el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40)}»`);
  }
  for (const td of document.querySelectorAll('main td, main th, [role=dialog] td')) {
    if (td.scrollWidth > td.clientWidth + 2 && getComputedStyle(td).overflow !== 'visible') out.push(`${tag}: clipped cell «${td.innerText.trim().slice(0, 30)}»`);
  }
  return out;
}, tag);
async function page(role, w, h, locale) {
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (locale === 'ru') await p.setCookie({ name: 'meduza_lang', value: 'ru', url: BASE });
  await login(p, role);
  await p.evaluate(async (l) => { await fetch('/api/v1/me/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: l }) }); }, locale);
  return { p, ctx };
}
const snap = async (p, name, tag, full = true) => { await settle(p); await sleep(300); issues.push(...await audit(p, tag)); await p.screenshot({ path: `${DIR}${name}.png`, fullPage: full }); };
const tab = (p, i) => p.evaluate((i) => document.querySelectorAll('main [role=tablist] [role=tab]')[i]?.click(), i);
const closeDialog = async (p) => { await p.keyboard.press('Escape'); await sleep(250); };
const api = (p, path) => p.evaluate(async (path) => (await (await fetch('/api/v1' + path)).json()), path);
try {
  for (const [w, h, size] of [[1366, 768, 'desk'], [390, 844, 'phone']]) {
    for (const locale of ['uz', 'ru']) {
      const pre = `${size}-${locale}`;
      // ---- manager: «Chegirmalar»
      const { p, ctx } = await page(locale === 'ru' ? 'Руководитель' : 'Rahbar', w, h, locale);
      const today = (await api(p, '/me')).data.today;
      await p.goto(`${BASE}/discounts?from=${today.slice(0, 5)}09-01&to=${today}`, { waitUntil: 'networkidle0' });
      await snap(p, `${pre}-discounts-report`, `${pre} disc report`);
      await p.evaluate(() => [...document.querySelectorAll('main [role=radiogroup] [role=radio]')].at(-3)?.click()); // by category
      await snap(p, `${pre}-discounts-by-category`, `${pre} disc category`);
      await tab(p, 1); await snap(p, `${pre}-discounts-rules`, `${pre} rules`);
      if (await p.evaluate(() => { const b = document.querySelector('main tbody tr button'); b?.click(); return !!b; })) {
        await p.waitForSelector('[role=dialog]'); await snap(p, `${pre}-modal-rule`, `${pre} rule form`, false); await closeDialog(p);
      }
      await tab(p, 2); await snap(p, `${pre}-discounts-categories`, `${pre} categories`);
      if (await p.evaluate(() => { const b = document.querySelector('main tbody tr button'); b?.click(); return !!b; })) {
        await p.waitForSelector('[role=dialog]'); await snap(p, `${pre}-modal-category`, `${pre} category form`, false); await closeDialog(p);
      }
      // ---- «Kompaniyalar»
      await p.goto(`${BASE}/companies?from=${today.slice(0, 5)}09-01&to=${today}`, { waitUntil: 'networkidle0' });
      await snap(p, `${pre}-companies-receivables`, `${pre} receivables`);
      await tab(p, 1); await snap(p, `${pre}-companies-directory`, `${pre} directory`);
      if (await p.evaluate(() => { const b = [...document.querySelectorAll('main tbody tr button')].at(-1); b?.click(); return !!b; })) {
        await p.waitForSelector('[role=dialog]'); await snap(p, `${pre}-modal-company`, `${pre} company form`, false); await closeDialog(p);
      }
      await tab(p, 2); await snap(p, `${pre}-companies-payments`, `${pre} payments`);
      await p.click('[data-testid="company-payment-open"]'); await p.waitForSelector('[role=dialog]');
      await p.waitForFunction(() => document.querySelector('[data-testid="company-payment-company"]')?.options.length > 1);
      await p.evaluate(() => { const s = document.querySelector('[data-testid="company-payment-company"]'); const o = [...s.options].find((o) => o.text.includes('DataSoft')); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); });
      await settle(p); await snap(p, `${pre}-modal-company-payment`, `${pre} company payment`, false); await closeDialog(p);
      // ---- the act, the company debtors in «Moliya»
      const ds = (await api(p, '/companies?all=1&page_size=50')).data.find((c) => c.name.includes('Toshkent Metall'));
      await p.goto(`${BASE}/print/company-act/${ds.id}?from=${today.slice(0, 5)}09-01&to=${today}`, { waitUntil: 'networkidle0' });
      await snap(p, `${pre}-print-act`, `${pre} act`);
      await p.goto(`${BASE}/finance?tab=debts&payer=company`, { waitUntil: 'networkidle0' });
      await snap(p, `${pre}-finance-company-debts`, `${pre} finance debts`);
      await ctx.close();
      // ---- cashier: an open bill with the block; a bill paid by a company
      const c = await page(locale === 'ru' ? 'Кассир' : 'Kassir', w, h, locale);
      const me = (await api(c.p, '/me')).data;
      const central = me.branches.find((x) => x.code === 'MRK').id;
      const open = (await api(c.p, `/invoices?status=unpaid&branch_id=${central}&page_size=50`)).data.find((i) => Number(i.paid_amount) === 0);
      await c.p.goto(`${BASE}/cashier/${open.id}`, { waitUntil: 'networkidle0' });
      await c.p.waitForFunction(() => document.querySelector('[data-testid="discount-rule"]')?.options.length > 1 && document.querySelector('[data-testid="company-select"]')?.options.length > 1);
      await c.p.evaluate(() => { const s = document.querySelector('[data-testid="discount-rule"]'); const o = [...s.options].find((o) => o.text.includes('Xodimlar')); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); });
      await c.p.evaluate(() => { const s = document.querySelector('[data-testid="company-select"]'); const o = [...s.options].find((o) => o.text.includes('Ishonch')); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); });
      await sleep(300);
      await c.p.evaluate(() => document.querySelector('[data-testid="discount-picker"]')?.scrollIntoView({ block: 'start' }));
      await snap(c.p, `${pre}-cashier-block`, `${pre} cashier block`, size === 'desk');
      const companyBill = (await api(c.p, '/invoices?debt=1&payer=company&page_size=5')).data[0];
      if (companyBill) { await c.p.goto(`${BASE}/cashier/${companyBill.id}`, { waitUntil: 'networkidle0' }); await snap(c.p, `${pre}-cashier-company-bill`, `${pre} company bill`); }
      await c.ctx.close();
      // ---- registrar: the patient form's payer fields
      const r = await page(locale === 'ru' ? 'Регистратор' : 'Registrator', w, h, locale);
      const pt = (await api(r.p, '/patients?page_size=1')).data[0];
      await r.p.goto(`${BASE}/patients/${pt.id}`, { waitUntil: 'networkidle0' });
      await r.p.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.querySelector('.lucide-pencil'))?.click());
      await r.p.waitForSelector('[role=dialog]'); await settle(r.p);
      await r.p.evaluate(() => [...document.querySelectorAll('[role=dialog] fieldset')].find((f) => f.querySelector('.lucide-badge-percent'))?.scrollIntoView({ block: 'center' }));
      await snap(r.p, `${pre}-modal-patient-payer`, `${pre} patient payer`, false);
      await r.ctx.close();
    }
  }
} finally {
  await b.close();
}
console.log(issues.length ? `Topilgan muammolar (${issues.length}):\n` + [...new Set(issues)].join('\n') : 'Muammo topilmadi');
console.log('Suratlar: ' + DIR);
