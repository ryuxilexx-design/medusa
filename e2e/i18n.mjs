// Interface language in the browser: pick Russian on the login page → the doctor's workplace opens in
// Russian; switch to Uzbek Cyrillic → it survives a reload (saved for the session);
// patient data is never transliterated.
import { createRequire } from 'node:module';
import { launch, newPage, login, shot, settle, sleep, check, waitText, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const text = (p) => p.evaluate(() => document.body.innerText);
// before sign-in: the select on the login page; signed in: the segments in the user menu (top bar → person's menu)
const pickLanguage = (p, id) => p.evaluate((id) => {
  const seg = document.querySelector(`[data-testid="language-switch"] [data-value="${id}"]`);
  if (seg) { seg.click(); return; }
  const s = document.querySelector('select[data-testid="language"]');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, id);
  s.dispatchEvent(new Event('change', { bubbles: true }));
}, id);
try {
  const p = await newPage(b, errors);
  await p.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  check((await text(p)).includes('Tizimga kirish'), 'Kirish sahifasi standart tilda — o‘zbek (lotin)');
  await pickLanguage(p, 'ru');
  await waitText(p, 'Вход в систему');
  check(await p.evaluate(() => document.documentElement.lang) === 'ru', '<html lang="ru">');
  check((await text(p)).includes('Демо-роли'), 'Kirish sahifasi ruscha');
  await shot(p, 'i18n-01-login-ru');

  // login() opens /login again: the cookie keeps Russian, so the role card heading is «Врач»
  await login(p, 'Врач', 'Akmal Rasulov');
  await p.goto(BASE + '/doctor', { waitUntil: 'networkidle0' }); await settle(p);
  await waitText(p, 'Пациенты на сегодня');
  const ru = await text(p);
  check(ru.includes('Медицинская запись') || ru.includes('Пациент ещё не пришёл') || ru.includes('Пациент ждёт в очереди'), 'Shifokor sahifasi ruscha');
  check(/\d{1,2} (января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря) \d{4}/.test(ru), 'Sana ruscha: «18 октября 2026»');
  check(ru.includes('Akmal Rasulov') || ru.includes('Rasulov'), 'Xodim ismi o‘zgarmaydi (lotinda qoladi)');
  await shot(p, 'i18n-02-doctor-ru');

  // switch to Uzbek Cyrillic from the header; saved on the server for this session
  await pickLanguage(p, 'uz-Cyrl');
  await waitText(p, 'Бугунги беморлар');
  await p.reload({ waitUntil: 'networkidle0' }); await settle(p);
  await waitText(p, 'Бугунги беморлар');
  check(await p.evaluate(() => document.documentElement.lang) === 'uz-Cyrl', 'Yangilangandan keyin ham kirill (sessiyada saqlangan)');
  const cy = await text(p);
  check(!/Bugungi bemorlar|Klinik qayd/.test(cy), 'Lotin interfeys matni qolmagan');
  check(cy.includes('Med.uz.ai') || (await p.evaluate(() => !!document.querySelector('a[aria-label^="Med.uz.ai"]'))), 'Brend nomi lotinda');
  await shot(p, 'i18n-03-doctor-cyrl');

  // one text size for everyone: 18px root
  check(await p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)) === 18, 'Asosiy matn 18px');
  check(await p.evaluate(() => !document.querySelector('[role=group][aria-label="Матн"]')), 'Matn o‘lchami tugmasi yo‘q');

  // back to Uzbek Latin, so the demo card stays as other visitors expect
  await pickLanguage(p, 'uz');
  await waitText(p, 'Bugungi bemorlar');
  check(true, 'O‘zbek (lotin) tiliga qaytdi');
  await shot(p, 'i18n-05-doctor-uz');

  // every screen of every role in Russian: no Uzbek interface sentence may remain (data — names, services — may)
  const { MESSAGES } = createRequire(import.meta.url)('../packages/contracts/dist/index.js');
  const uzPhrases = Object.values(MESSAGES).map((e) => e[0]).filter((x) => x.length >= 14 && x.includes(' ') && !x.includes('{') && /[a-z]/.test(x));
  const ROLES = { 'Руководитель': ['/dashboard', '/patients', '/schedule', '/queue', '/lab', '/cashier', '/finance', '/staff', '/inventory', '/reports', '/settings'],
    'Регистратор': ['/patients', '/schedule', '/queue', '/lab', '/cashier'], 'Кассир': ['/cashier', '/finance', '/queue', '/patients'],
    'Лаборатория': ['/lab', '/materials'], 'Врач': ['/doctor', '/diagnostics', '/reports', '/schedule', '/patients', '/materials'], 'Кладовщик (провизор)': ['/inventory'] };
  const leaks = [];
  for (const [role, pages] of Object.entries(ROLES)) {
    const r = await newPage(b, errors);
    await r.setCookie({ name: 'meduza_lang', value: 'ru', url: BASE });
    await login(r, role);
    for (const path of pages) {
      await r.goto(BASE + path, { waitUntil: 'networkidle0' }); await settle(r);
      // a label is a leaf element's whole text; a long sentence counts anywhere. Data (note texts, service names) holds
      // Uzbek words too, so a short phrase inside a longer data text is not a leak.
      const { body, leaves } = await r.evaluate(() => ({
        body: document.body.innerText,
        leaves: [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.offsetParent !== null).map((e) => e.textContent.trim()),
      }));
      const leafSet = new Set(leaves);
      for (const ph of uzPhrases) if (leafSet.has(ph) || (ph.length >= 30 && body.includes(ph))) leaks.push(`${role} ${path}: «${ph}»`);
      await shot(r, `i18n-ru${path.replace(/\//g, '-')}-${role === 'Руководитель' ? 'manager' : role === 'Регистратор' ? 'registrar' : role === 'Кассир' ? 'cashier' : role === 'Лаборатория' ? 'lab' : role === 'Кладовщик (провизор)' ? 'storekeeper' : 'doctor'}`);
    }
    await r.close();
  }
  check(leaks.length === 0, `Ruscha sahifalarda o‘zbekcha interfeys jumlasi qolmagan${leaks.length ? ':\n  ' + [...new Set(leaks)].join('\n  ') : ''}`);
} catch (e) {
  for (const [i, pg] of (await b.pages()).entries()) await pg.screenshot({ path: new URL(`./shots/i18n-fail-${i}.png`, import.meta.url).pathname }).catch(() => undefined);
  throw e;
} finally {
  await b.close();
}
check(errors.length === 0, `Brauzer xatolari yo‘q${errors.length ? ': ' + errors.join(' | ') : ''}`);
