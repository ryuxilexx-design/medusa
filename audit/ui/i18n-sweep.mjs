// Language sweep: every role × allowed page in ru and uz-Cyrl (+ settings/cameras tabs). Flags: raw message keys,
// Uzbek-Latin interface strings on ru/uz-Cyrl pages (known uz messages + Latin text in chrome elements).
import { createRequire } from 'node:module';
import { launch, ctxPage, track, go, sleep, SH, save, ALLOWED, BASE } from './common.mjs';
const require = createRequire(import.meta.url);
const { MESSAGES, translate } = require('../../packages/contracts/dist/index.js');
const uzStrings = [...new Set(Object.values(MESSAGES).map((v) => (Array.isArray(v) ? v[0] : null)).filter((s) => typeof s === 'string' && !s.includes('{') && s.length >= 7 && /[a-z]/.test(s)))];
const LOCS = (process.argv[2] || 'ru,uz-Cyrl').split(',');
const ROLE_KEYS = ['manager', 'registrar', 'doctor', 'cashier', 'lab'];
const b = await launch();
const results = [];
for (const loc of LOCS) for (const role of ROLE_KEYS) {
  const p = await ctxPage(b); const log = track(p);
  await p.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await p.evaluate((l) => { document.cookie = `meduza_lang=${encodeURIComponent(l)}; path=/`; }, loc);
  await p.reload({ waitUntil: 'networkidle0' });
  const label = translate(loc, `role.${role}`);
  await p.evaluate((label) => { const row = [...document.querySelectorAll('[data-demo-role]')].find((r) => r.querySelector('h2')?.textContent === label); row.querySelector('button').click(); }, label);
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 });
  for (const r of ALLOWED[role]) {
    await go(p, r); await sleep(700);
    const tabs = await p.evaluate(() => [...document.querySelectorAll('main [role=tablist] button, main [role=tab]')].map((x) => x.textContent.trim()));
    const views = [null, ...(['/settings', '/cameras', '/finance', '/reports', '/news'].includes(r) ? tabs.slice(1) : [])];
    for (const tab of views) {
      if (tab) { await p.evaluate((t) => [...document.querySelectorAll('main [role=tablist] button, main [role=tab]')].find((x) => x.textContent.trim() === t)?.click(), tab); await sleep(900); }
      const res = await p.evaluate((uz, loc) => {
        const body = document.body.innerText;
        const rawKeys = [...new Set(body.match(/\b[a-z]{2,}\.[a-z][A-Za-z]+(\.[A-Za-z_]+)*\b/g) || [])].filter((k) => !/^(med\.uz|uz\.ai|www\.)/.test(k) && !/\.(uz|ai|com|ru|org)$/.test(k));
        const found = uz.filter((s) => body.includes(s));
        const chrome = [];
        const sel = 'h1,h2,h3,button,label,th,legend,[role=tab],option,dt,a';
        for (const el of document.querySelectorAll(sel)) {
          if (el.closest('td') || el.closest('[translate=no]')) continue;
          const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim();
          if (own && /[A-Za-z]{3,}/.test(own) && !/^(Med\.uz\.ai|AI|PDF|ID|UZI|Telegram|Excel|CSV|Hikvision|DEMO|Demo|OK|ICD|MKB|Gemini|Claude|Anthropic|SMS|IP|URL|HbA1c|TTG|USD)$/i.test(own)) chrome.push(own.slice(0, 60));
        }
        for (const el of document.querySelectorAll('[placeholder],[aria-label],[title]')) for (const a of ['placeholder', 'aria-label', 'title']) { const v = el.getAttribute(a); if (v && /[A-Za-z]{4,}/.test(v) && !/Med\.uz\.ai|\+998/.test(v)) chrome.push(`@${a}:${v.slice(0, 60)}`); }
        return { rawKeys, found: found.slice(0, 15), chrome: [...new Set(chrome)].slice(0, 25), lang: document.documentElement.lang };
      }, uzStrings, loc);
      const shot = `i18n-${loc}-${role}${r.replace(/\//g, '-')}${tab ? '-' + tab.replace(/[^\p{L}\d]+/gu, '') : ''}.png`;
      await p.screenshot({ path: SH + shot });
      results.push({ loc, role, route: r, tab, ...res, shot, net: [...log.net] }); log.net.length = 0;
      console.log(loc, role, r, tab ?? '', '| keys', res.rawKeys.length, '| uz', res.found.length, '| latin', res.chrome.length);
    }
  }
  await p.browserContext().close();
}
await save('i18n.json', results);
await b.close();
