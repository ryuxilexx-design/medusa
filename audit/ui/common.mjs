// Shared helpers for the UI audit (reuses e2e/lib.mjs). Screens go to AUDIT_SHOTS.
export * from '../../e2e/lib.mjs';
import { launch as _launch, BASE, sleep } from '../../e2e/lib.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
export const OUT = process.env.AUDIT_OUT || '/private/tmp/claude-501/-Users-levi-Desktop-Meduza/681f0b69-e040-4e3e-acee-1d9c17057603/scratchpad/audit';
export const SH = OUT + '/ui-shots/';
mkdirSync(SH, { recursive: true });
export const AXE_PATH = process.env.AXE_PATH || '/Users/levi/AsosLab/node_modules/axe-core/axe.min.js';
export const ROLES = { manager: 'Rahbar', registrar: 'Registrator', doctor: 'Shifokor', cashier: 'Kassir', lab: 'Laboratoriya' };
export const ROUTES = ['/dashboard', '/patients', '/schedule', '/queue', '/doctor', '/lab', '/diagnostics', '/news', '/cashier', '/finance', '/staff', '/inventory', '/cameras', '/reports', '/settings'];
export const ALLOWED = {
  manager: ['/dashboard', '/patients', '/schedule', '/queue', '/lab', '/cashier', '/finance', '/staff', '/inventory', '/cameras', '/reports', '/settings'],
  registrar: ['/patients', '/schedule', '/queue', '/lab', '/cashier'],
  doctor: ['/patients', '/schedule', '/queue', '/doctor', '/diagnostics', '/news', '/reports'],
  cashier: ['/patients', '/queue', '/cashier', '/finance'],
  lab: ['/lab'],
};
export function track(page) {
  const log = { console: [], net: [], big: [] };
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.console.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => log.console.push(`[pageerror] ${e.message.slice(0, 300)}`));
  page.on('response', async (r) => {
    const u = r.url();
    if (!u.includes('/api/v1/')) return;
    if (r.status() >= 400) log.net.push(`${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`);
    const len = Number(r.headers()['content-length'] || 0);
    if (len > 300_000) log.big.push(`${len} ${u.replace(BASE, '')}`);
  });
  return log;
}
export async function launch() { return _launch(); }
export async function ctxPage(browser, vw = { width: 1366, height: 768 }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(vw);
  return page;
}
export async function axe(page) {
  await page.addScriptTag({ content: readFileSync(AXE_PATH, 'utf8') });
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 2).join('').slice(0, 140)) }));
  });
}
export async function layout(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const hscroll = doc.scrollWidth > doc.clientWidth + 1;
    const wide = [];
    if (hscroll) for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.right > doc.clientWidth + 2 && r.width > 0 && getComputedStyle(el).position !== 'fixed') { wide.push((el.tagName + '.' + (el.className?.toString?.() || '').split(' ').slice(0, 3).join('.')).slice(0, 90) + ' r=' + Math.round(r.right)); if (wide.length > 5) break; } }
    // clipped buttons: text overflowing its box
    const clipped = [];
    for (const el of document.querySelectorAll('button, a, th, label, h1, h2')) { if (el.offsetParent === null) continue; if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible' ) clipped.push((el.textContent || '').trim().slice(0, 40)); if (clipped.length > 8) break; }
    return { hscroll, sw: doc.scrollWidth, cw: doc.clientWidth, wide, clipped };
  });
}
export const text = (page) => page.evaluate(() => document.querySelector('main')?.innerText ?? document.body.innerText);
export async function save(name, data) { writeFileSync(OUT + '/' + name, typeof data === 'string' ? data : JSON.stringify(data, null, 2)); }
export async function go(page, path) { await page.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => undefined); await sleep(500); }
