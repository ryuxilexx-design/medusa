// Visual pass of the referral partners / lead sources screens (not part of `npm run e2e`): «Hamkorlar» (four tabs and
// its dialogs), the dashboard card, the booking dialog with «Yo‘llanma bor» and the patient card's visits, at
// 1366×768 and 390×844 in Uzbek and Russian. Saves PNGs to REF_SHOTS (default e2e/shots/referrals) and reports sideways
// scroll and visible tap targets under 44 px. Run with the isolated stack: `node run.mjs shots-referrals`.
import { mkdirSync } from 'node:fs';
import { launch, login, settle, sleep, BASE } from './lib.mjs';
const DIR = process.env.REF_SHOTS || new URL('./shots/referrals/', import.meta.url).pathname;
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
  // a cell whose text is cut by the next one (a clipped column)
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
try {
  for (const [w, h, size] of [[1366, 768, 'desk'], [390, 844, 'phone']]) {
    for (const locale of ['uz', 'ru']) {
      const pre = `${size}-${locale}`;
      // ---- manager
      const { p, ctx } = await page(locale === 'ru' ? 'Руководитель' : 'Rahbar', w, h, locale);
      await p.goto(BASE + '/partners', { waitUntil: 'networkidle0' });
      await snap(p, `${pre}-partners-report`, `${pre} report`);
      if (await p.evaluate(() => { const b = document.querySelector('tr[data-partner="101"] [data-testid="partner-lines"]'); b?.click(); return !!b; })) {
        await p.waitForSelector('[role=dialog]'); await snap(p, `${pre}-modal-lines`, `${pre} lines`, false); await closeDialog(p);
      }
      if (await p.evaluate(() => { const b = [...document.querySelectorAll('tr[data-partner="102"] button')].at(-1); b?.click(); return !!b; })) {
        await p.waitForSelector('[role=dialog]'); await snap(p, `${pre}-modal-payout`, `${pre} payout`, false);
        await p.evaluate(() => [...document.querySelectorAll('[role=dialog] [role=radio]')].at(-1)?.click()); await sleep(300);
        await snap(p, `${pre}-modal-payout-cash`, `${pre} payout cash`, false); await closeDialog(p);
      }
      await tab(p, 1); await snap(p, `${pre}-partners-directory`, `${pre} directory`);
      if (await p.evaluate(() => { const b = document.querySelector('main tbody tr button'); b?.click(); return !!b; })) {
        await p.waitForSelector('[role=dialog]'); await snap(p, `${pre}-modal-partner-edit`, `${pre} partner edit`, false); await closeDialog(p);
      }
      await tab(p, 2); await snap(p, `${pre}-partners-payouts`, `${pre} payouts`);
      await tab(p, 3); await snap(p, `${pre}-partners-sources`, `${pre} sources`);
      await p.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.querySelector('svg') && /Manbalar ro‘yxati|Список источников/.test(b.textContent))?.click());
      await p.waitForSelector('[role=dialog]').catch(() => undefined); await snap(p, `${pre}-modal-sources`, `${pre} sources modal`, false); await closeDialog(p);
      await p.goto(BASE + '/dashboard', { waitUntil: 'networkidle0' });
      await p.evaluate(() => [...document.querySelectorAll('[role=radiogroup] [role=radio]')][2]?.click()); // 30 days
      await settle(p);
      await p.evaluate(() => [...document.querySelectorAll('h2')].find((x) => /Yangi bemorlar manbasi|Откуда новые пациенты/.test(x.textContent))?.scrollIntoView({ block: 'center' }));
      await snap(p, `${pre}-dashboard-sources`, `${pre} dashboard`, false);
      await ctx.close();
      // ---- registrar: booking with a referral, the visits tab
      const r = await page(locale === 'ru' ? 'Регистратор' : 'Registrator', w, h, locale);
      const pid = await r.p.evaluate(async () => (await (await fetch('/api/v1/appointments?from=2026-09-20&to=2026-10-17')).json()).data.find((a) => a.referral_partner_id)?.patient_id);
      await r.p.goto(`${BASE}/patients/${pid}`, { waitUntil: 'networkidle0' });
      await r.p.evaluate(() => document.querySelectorAll('main [role=tablist] [role=tab]')[1]?.click());
      await snap(r.p, `${pre}-patient-visits`, `${pre} visits`);
      await r.p.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.querySelector('.lucide-calendar-plus'))?.click());
      await r.p.waitForSelector('[role=dialog]'); await settle(r.p);
      await r.p.evaluate(() => { const s = [...document.querySelectorAll('[role=dialog] select')][0]; const o = [...s.options].find((o) => o.text.includes('Akmal')); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); });
      await settle(r.p);
      await r.p.click('[data-testid="has-referral"]'); await sleep(200);
      await r.p.type('[data-testid="partner-search"]', 'Rus'); await settle(r.p); await sleep(400);
      await r.p.evaluate(() => document.querySelector('[data-testid="referral-fields"]')?.scrollIntoView({ block: 'center' }));
      await snap(r.p, `${pre}-modal-booking-referral`, `${pre} booking`, false);
      await r.ctx.close();
    }
  }
} finally {
  await b.close();
}
console.log(issues.length ? `Topilgan muammolar (${issues.length}):\n` + [...new Set(issues)].join('\n') : 'Muammo topilmadi');
console.log('Suratlar: ' + DIR);
