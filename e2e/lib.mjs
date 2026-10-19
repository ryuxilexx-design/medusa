import puppeteer from 'puppeteer-core';
export const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
export function check(cond, label) { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) { process.exitCode = 1; throw new Error('Tekshiruv o‘tmadi: ' + label); } }
import { mkdirSync } from 'node:fs';
export const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
export async function launch() {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--window-size=1366,768', '--lang=uz'] });
  return browser;
}
export async function newPage(browser, errors) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`[${r.status()}] ${r.url()}`); });
  return page;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function login(page, roleLabel, doctorText) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  if (doctorText) {
    await page.evaluate((t) => { const s = document.querySelector('select[data-testid="doctor-pick"]'); const o = [...s.options].find((o) => o.text.includes(t)); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); }, doctorText);
  }
  await page.evaluate((label) => {
    const card = [...document.querySelectorAll('h2')].find((h) => h.textContent === label).parentElement;
    card.querySelector('button').click();
  }, roleLabel);
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 });
  await page.waitForNetworkIdle({ idleTime: 400 });
}
export async function clickText(page, text, sel = 'button, a') {
  const ok = await page.evaluate((text, sel) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null && e.textContent.trim().includes(text) && !e.disabled);
    const el = els[els.length - 1];
    if (!el) return false; el.click(); return true;
  }, text, sel);
  if (!ok) throw new Error(`clickText: not found "${text}"`);
  await sleep(250);
}
export async function shot(page, name) { await page.screenshot({ path: SHOTS + name + '.png' }); }
export async function settle(page) { await page.waitForNetworkIdle({ idleTime: 400, timeout: 15000 }).catch(() => undefined); await sleep(200); }
/** Set a React-controlled input/select/textarea by its <label> text (exact start match). */
export async function fill(page, label, value, scope = 'body') {
  const ok = await page.evaluate((label, value, scope) => {
    const root = [...document.querySelectorAll(scope)].pop() || document.body;
    const lab = [...root.querySelectorAll('label')].find((l) => l.offsetParent !== null && l.textContent.replace('*', '').trim().startsWith(label));
    if (!lab) return 'nolabel';
    const el = lab.htmlFor ? document.getElementById(lab.htmlFor) : lab.querySelector('input,select,textarea');
    if (!el) return 'noel';
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find((o) => o.value === value || o.text.includes(value));
      if (!opt) return 'noopt';
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, opt.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return 'ok';
  }, label, value, scope);
  if (ok !== 'ok') throw new Error(`fill(${label}): ${ok}`);
  await sleep(150);
}
export async function waitText(page, text, timeout = 10000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
}
