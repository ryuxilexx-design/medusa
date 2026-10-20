// Keyboard-only: Tab order + visible focus on main pages, modal open via Enter, trap, Esc, focus return; user menu; login page.
import { launch, ctxPage, login, go, sleep, SH, save, BASE } from './common.mjs';
const out = []; const note = (k, v) => { out.push({ k, v }); console.log('•', k, JSON.stringify(v)?.slice(0, 600)); };
const b = await launch();
const desc = (p) => p.evaluate(() => {
  const el = document.activeElement; if (!el || el === document.body) return 'BODY';
  const cs = getComputedStyle(el);
  const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
  return `${el.tagName}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''} "${(el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '').trim().slice(0, 30)}"${visible ? '' : ' (NO-FOCUS-RING)'}`;
});
async function tabWalk(p, n) { const seq = []; for (let i = 0; i < n; i++) { await p.keyboard.press('Tab'); await sleep(60); seq.push(await desc(p)); } return seq; }
// login page keyboard
const L = await ctxPage(b);
await L.goto(BASE + '/login', { waitUntil: 'networkidle0' });
note('login tab order', await tabWalk(L, 10));
await L.browserContext().close();
for (const [label, path, opener] of [['Registrator', '/patients', 'Bemor qo‘shish'], ['Rahbar', '/staff', 'Xodim qo‘shish'], ['Kassir', '/cashier', null], ['Shifokor', '/doctor', null], ['Laboratoriya', '/lab', null], ['Rahbar', '/finance', 'Xarajat qo‘shish']]) {
  const p = await ctxPage(b); await login(p, label); await go(p, path);
  await p.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  const seq = await tabWalk(p, 22);
  note(`${label} ${path} tab order`, seq);
  note(`${label} ${path} focus without ring`, seq.filter((s) => s.includes('NO-FOCUS-RING')));
  if (opener) {
    // focus the opener by keyboard and press Enter
    await p.evaluate((t) => [...document.querySelectorAll('main button')].find((x) => x.textContent.trim().includes(t))?.focus(), opener);
    await p.keyboard.press('Enter'); await sleep(500);
    note(`${path} modal open via Enter`, !!(await p.$('[role=dialog]')));
    note(`${path} first focus in modal`, await desc(p));
    const inside = []; for (let i = 0; i < 30; i++) { await p.keyboard.press('Tab'); await sleep(30); inside.push(await p.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))); }
    note(`${path} focus trapped (30 tabs)`, inside.every(Boolean));
    await p.keyboard.press('Escape'); await sleep(400);
    note(`${path} Esc closes clean modal`, !(await p.$('[role=dialog]')));
    note(`${path} focus returned to`, await desc(p));
    await p.screenshot({ path: SH + `kbd-${label}${path.replace(/\//g, '-')}.png` });
  }
  // user menu via keyboard
  await p.focus('[data-testid=user-menu]'); await p.keyboard.press('Enter'); await sleep(300);
  note(`${label} user menu opens with Enter`, await p.evaluate(() => document.querySelector('[data-testid=user-menu]').getAttribute('aria-expanded')));
  await p.keyboard.press('Tab'); await sleep(80); note(`${label} user menu: Tab goes to`, await desc(p));
  await p.keyboard.press('Escape'); await sleep(200);
  note(`${label} user menu Esc → expanded`, await p.evaluate(() => document.querySelector('[data-testid=user-menu]').getAttribute('aria-expanded')));
  await p.browserContext().close();
}
// mobile drawer
const m = await ctxPage(b, { width: 390, height: 844 }); await login(m, 'Rahbar'); await go(m, '/dashboard');
await m.focus('button[aria-controls=app-menu]'); await m.keyboard.press('Enter'); await sleep(400);
note('mobile drawer: focus after open', await desc(m));
await m.keyboard.press('Escape'); await sleep(300); note('mobile drawer: focus after Esc', await desc(m));
await save('keyboard.json', out);
await b.close().catch(() => undefined); process.exit(0);
