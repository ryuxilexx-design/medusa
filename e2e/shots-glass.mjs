// Visual pass of the Liquid Glass shell: every role's home at 1366×768 and 390×844, plus the login page.
// Screenshots (e2e/shots/glass-*.png); the checks: no sideways page scroll, no console errors.
import { launch, login, shot, settle, check, sleep, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
try {
  const roles = [['Rahbar', '/dashboard'], ['Registrator', '/queue'], ['Shifokor', '/doctor'], ['Kassir', '/cashier'], ['Laboratoriya', '/lab']];
  for (const [w, h, tag] of [[1366, 768, 'desk'], [390, 844, 'phone']]) {
    for (const [role, home] of [['', '/login'], ...roles]) {
      // a fresh browser context per role: no cookies or cache carried over
      const ctx = await b.createBrowserContext();
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(`${tag} ${role || 'login'}: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(`${tag} ${role || 'login'}: ${m.text()}`); });
      await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      if (role) { await login(p, role, role === 'Shifokor' ? 'Akmal Rasulov' : undefined); await p.goto(BASE + home, { waitUntil: 'networkidle0' }); }
      else await p.goto(BASE + '/login', { waitUntil: 'networkidle0' });
      await settle(p); await sleep(300);
      const wide = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      check(!wide, `${tag} ${role || 'login'}: yon tomonga aylantirish yo‘q`);
      await shot(p, `glass-${tag}-${role || 'login'}`);
      if (tag === 'phone' && role) { await p.click('button[aria-controls="app-menu"]').catch(() => undefined); await sleep(400); await shot(p, `glass-${tag}-${role}-menu`); }
      await ctx.close();
    }
  }
  check(errors.length === 0, `Konsolda kutilmagan JS xato yo‘q${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally { await b.close(); }
