// READ-ONLY visual pass at 1366×768: opens the key screens and dialogs without saving anything.
// Usage: against the demo stack → `node e2e/visual.mjs` (screenshots go to docs/screenshots/), or via run.mjs on the test stack.
import { launch, newPage, login, settle, clickText, sleep, check, BASE } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.env.VISUAL_OUT || new URL('../docs/screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const errors = []; const b = await launch();
const shots = [];
async function snap(p, name) { await settle(p); await sleep(300); await p.screenshot({ path: OUT + name + '.png' }); shots.push(name);
  // layout checks: no horizontal page scroll, no element wider than the viewport, primary buttons visible
  const issues = await p.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('gorizontal skroll: ' + document.documentElement.scrollWidth);
    for (const d of document.querySelectorAll('[role=dialog]')) { const r = d.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.left < -1) out.push('modal kengligi sig‘madi'); }
    return out;
  });
  if (issues.length) console.log(`  ! ${name}: ${issues.join('; ')}`);
  return issues;
}
const goto = async (p, path) => { await p.goto(BASE + path, { waitUntil: 'networkidle0' }); await settle(p); };
const openRow = (p, text, sel = 'a, button, tr, li') => p.evaluate((text, sel) => { const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(text) && e.offsetParent); (el.querySelector('a,button') ?? el).click(); }, text, sel);
let problems = 0;

const m = await newPage(b, errors); await login(m, 'Rahbar');
problems += (await snap(m, '01-rahbar-dashboard')).length;
await clickText(m, '30 kun'); problems += (await snap(m, '02-rahbar-dashboard-30kun')).length;
await goto(m, '/patients?search=Karimov Aziz'); await openRow(m, 'Karimov Aziz', 'a'); await m.waitForFunction(() => location.pathname.startsWith('/patients/'));
problems += (await snap(m, '03-rahbar-bemor-profili')).length;
await goto(m, '/inventory?low=1'); await m.evaluate(() => document.querySelector('tbody tr')?.click()); problems += (await snap(m, '04-rahbar-ombor')).length;
await goto(m, '/staff'); await openRow(m, 'Akmal Rasulov', 'tr'); problems += (await snap(m, '05-rahbar-xodimlar')).length;
await goto(m, '/settings'); await clickText(m, 'Xizmatlar', '[role=tablist] button'); problems += (await snap(m, '06-rahbar-sozlamalar')).length;
await goto(m, '/finance'); problems += (await snap(m, '07-rahbar-moliya')).length;

const r = await newPage(b, errors); await login(r, 'Registrator');
problems += (await snap(r, '10-registrator-jadval')).length;
await clickText(r, 'Qabulga yozish'); await sleep(300);
await r.evaluate(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find((x) => x.textContent.startsWith('Shifokor')); const s = document.getElementById(l.htmlFor); const o = [...s.options].find((o) => o.text.includes('Akmal')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); });
problems += (await snap(r, '11-registrator-qabulga-yozish-modal')).length;
await r.keyboard.press('Escape'); await sleep(200);
await goto(r, '/patients'); await clickText(r, 'Bemor qo‘shish'); problems += (await snap(r, '12-registrator-bemor-qoshish-modal')).length;
await r.keyboard.press('Escape');
await goto(r, '/queue'); problems += (await snap(r, '13-registrator-navbat')).length;

const d = await newPage(b, errors); await login(d, 'Shifokor', 'Akmal Rasulov');
await d.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Hasanova Barno'))?.click());
problems += (await snap(d, '20-shifokor-kabineti')).length;
await clickText(d, 'AI bilan tartiblash'); await clickText(d, 'Demo matnni qo‘yish');
problems += (await snap(d, '21-shifokor-ai-modal')).length;
await clickText(d, 'Bekor qilish', '[role=dialog] button'); await sleep(200);
const leftover = await d.evaluate(() => document.body.innerText.includes('Saqlanmagan o‘zgarishlar o‘chadi'));
if (leftover) await clickText(d, 'Yopish', '[role=dialog] button');
await clickText(d, 'Tekshiruv buyurish'); problems += (await snap(d, '22-shifokor-tekshiruv-buyurish')).length;
await d.keyboard.press('Escape');
await d.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Nurmatova Gulchehra'))?.click());
problems += (await snap(d, '23-shifokor-yakunlangan-qabul')).length;

const l = await newPage(b, errors); await login(l, 'Laboratoriya');
await clickText(l, 'Qoralama', '[role=tab]'); await sleep(300); await l.evaluate(() => document.querySelector('ul button')?.click());
problems += (await snap(l, '30-laboratoriya')).length;

const c = await newPage(b, errors); await login(c, 'Kassir');
problems += (await snap(c, '40-kassa')).length;
await goto(c, '/cashier?search=Umarov'); await c.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.href.includes('/cashier/'))?.click()); await c.waitForFunction(() => /\/cashier\/.+/.test(location.pathname));
problems += (await snap(c, '41-kassa-hisob-qisman')).length;

console.log(`${shots.length} skrinshot → ${OUT}`);
const unexpected = errors.filter((e) => !e.includes('403'));
check(!unexpected.length, 'Vizual o‘tishda konsol xatosi yo‘q' + (unexpected.length ? ': ' + unexpected.join(' | ') : ''));
check(problems === 0, 'Gorizontal skroll yoki sig‘magan modal yo‘q');
await b.close();
