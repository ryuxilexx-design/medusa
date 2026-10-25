// Visual pass of the security guard's screens and the manager's «Xavfsizlik» (not part of `npm run e2e`):
// every screen at 1366×768 and 390×844 in Uzbek and Russian, plus the main dialogs. Saves full-page PNGs to
// GUARD_SHOTS (default e2e/shots/guard) and reports sideways scroll and visible tap targets under 44 px.
// Run with the isolated stack: `node run.mjs shots-guard`.
import { mkdirSync } from 'node:fs';
import { launch, login, settle, sleep, BASE } from './lib.mjs';
const DIR = process.env.GUARD_SHOTS || new URL('./shots/guard/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const b = await launch();
const issues = [];
const audit = (p, tag) => p.evaluate((tag) => {
  const out = [];
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`${tag}: sideways scroll ${document.documentElement.scrollWidth}px`);
  for (const el of document.querySelectorAll('main button, main a, main [role=tab], [role=dialog] button, [role=dialog] a, [role=dialog] input, [role=dialog] select')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('[aria-hidden="true"]')) continue;
    // a TextLink's hit area is extended by an invisible ::after (≥ 44 px)
    const after = getComputedStyle(el, '::after');
    const extra = after.content !== 'none' && after.position === 'absolute' ? Math.max(0, -parseFloat(after.top || '0')) * 2 : 0;
    if (r.height + extra < 43.5 && el.type !== 'checkbox' && el.type !== 'radio') out.push(`${tag}: small target ${Math.round(r.height)}px «${(el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40)}»`);
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
const snap = async (p, name, tag) => { await settle(p); await sleep(250); issues.push(...await audit(p, tag)); await p.screenshot({ path: `${DIR}${name}.png`, fullPage: true }); };
try {
  for (const [w, h, size] of [[1366, 768, 'desk'], [390, 844, 'phone']]) {
    for (const locale of ['uz', 'ru']) {
      const { p, ctx } = await page(locale === 'ru' ? 'Охранник' : 'Qorovul', w, h, locale);
      for (const path of ['/guard', '/visitors', '/keys', '/patrol', '/incidents', '/on-site', '/post']) {
        await p.goto(BASE + path, { waitUntil: 'networkidle0' });
        await snap(p, `${size}-${locale}-guard${path.replace(/\//g, '-')}`, `${size} ${locale} ${path}`);
      }
      // dialogs (opened and closed again, nothing saved)
      const modal = async (path, open, name) => {
        await p.goto(BASE + path, { waitUntil: 'networkidle0' }); await settle(p);
        if (!(await p.evaluate(open))) return;
        await p.waitForSelector('[role=dialog]'); await sleep(300);
        issues.push(...await audit(p, `${size} ${locale} ${name}`));
        await p.screenshot({ path: `${DIR}${size}-${locale}-modal-${name}.png` });
        await p.keyboard.press('Escape'); await sleep(200);
      };
      await modal('/guard', () => { const b = [...document.querySelectorAll('[data-alert] button')].find((x) => /Yopish|Закрыть/.test(x.textContent)); b?.click(); return !!b; }, 'resolve');
      await modal('/guard', () => { document.querySelector('[data-testid="sos"]')?.click(); return true; }, 'sos');
      await modal('/visitors', () => { document.querySelector('[data-testid="visitor-add"]')?.click(); return true; }, 'visitor');
      await modal('/incidents', () => { document.querySelector('[data-testid="incident-add"]')?.click(); return true; }, 'incident');
      await modal('/incidents', () => { const b = document.querySelector('[data-incident]'); b?.click(); return !!b; }, 'incident-detail');
      await modal('/keys', () => { const b = [...document.querySelectorAll('[data-room] button')][0]; b?.click(); return !!b; }, 'key');
      await modal('/post', () => { const b = document.querySelector('[data-testid="shift-close"]'); b?.click(); return !!b; }, 'shift-close');
      if (size === 'phone') { await p.goto(BASE + '/guard', { waitUntil: 'networkidle0' }); await p.click('button[aria-controls="app-menu"]'); await sleep(400); await p.screenshot({ path: `${DIR}${size}-${locale}-menu.png` }); }
      await ctx.close();
      const m = await page(locale === 'ru' ? 'Руководитель' : 'Rahbar', w, h, locale);
      for (const tab of ['overview', 'alerts', 'incidents', 'visitors', 'keys', 'patrol', 'shifts']) {
        await m.p.goto(`${BASE}/security?tab=${tab}`, { waitUntil: 'networkidle0' });
        await snap(m.p, `${size}-${locale}-security-${tab}`, `${size} ${locale} security ${tab}`);
      }
      // the manager's force-close dialog (opened and closed, nothing saved)
      if (await m.p.evaluate(() => { const b = [...document.querySelectorAll('[data-testid="shift-force"]')].find((x) => x.offsetParent !== null); b?.click(); return !!b; })) {
        await m.p.waitForSelector('[role=dialog]'); await sleep(300);
        issues.push(...await audit(m.p, `${size} ${locale} force-close`));
        await m.p.screenshot({ path: `${DIR}${size}-${locale}-modal-force-close.png` });
        await m.p.keyboard.press('Escape'); await sleep(200);
      }
      await m.p.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0' });
      await snap(m.p, `${size}-${locale}-manager-alarm`, `${size} ${locale} manager alarm`);
      await m.ctx.close();
    }
  }
  const pr = await page('Qorovul', 1366, 768, 'uz');
  // a closed shift: its hand-over snapshot (the open one prints «now»)
  const id = await pr.p.evaluate(async () => (await (await fetch('/api/v1/security/shifts?page_size=10')).json()).data.find((s) => s.closed_at)?.id);
  if (id) { await pr.p.goto(`${BASE}/print/guard-shift/${id}`, { waitUntil: 'networkidle0' }); await settle(pr.p); await pr.p.screenshot({ path: `${DIR}print-shift.png`, fullPage: true }); }
  await pr.ctx.close();
} finally { await b.close(); }
console.log(issues.length ? `Topilgan muammolar (${issues.length}):\n  ` + [...new Set(issues)].join('\n  ') : 'Muammo topilmadi');
console.log('Suratlar: ' + DIR);
