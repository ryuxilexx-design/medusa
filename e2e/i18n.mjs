// Interface language and text size in the browser: pick Russian on the login page → the doctor's workplace opens in
// Russian; switch to Uzbek Cyrillic in the header → it survives a reload (saved for the session); «Крупный/Katta»
// text size enlarges everything and is kept; patient data is never transliterated.
import { launch, newPage, login, shot, settle, sleep, check, waitText, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const text = (p) => p.evaluate(() => document.body.innerText);
const pickLanguage = (p, id) => p.evaluate((id) => {
  const s = document.querySelector('select[data-testid="language"]');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, id);
  s.dispatchEvent(new Event('change', { bubbles: true }));
}, id);
try {
  const p = await newPage(b, errors);
  await p.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  check((await text(p)).includes('Xodim kirishi'), 'Kirish sahifasi standart tilda — o‘zbek (lotin)');
  await pickLanguage(p, 'ru');
  await waitText(p, 'Вход для сотрудников');
  check(await p.evaluate(() => document.documentElement.lang) === 'ru', '<html lang="ru">');
  check((await text(p)).includes('Демо: вход по роли'), 'Kirish sahifasi ruscha');
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

  // text size: larger root font, kept after reload
  const before = await p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await p.evaluate(() => [...document.querySelectorAll('[role=group] button')].find((x) => x.textContent.trim() === 'Катта')?.click());
  await sleep(400);
  const after = await p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  check(before === 18 && after === 20, `Matn kattalashdi: ${before}px → ${after}px`);
  await p.reload({ waitUntil: 'networkidle0' }); await settle(p);
  await waitText(p, 'Бугунги беморлар');
  check(await p.evaluate(() => document.documentElement.dataset.textSize) === 'large', 'Katta matn yangilangandan keyin ham saqlangan');
  await shot(p, 'i18n-04-doctor-cyrl-large');

  // back to Uzbek Latin and normal size, so the demo card stays as other visitors expect
  await p.evaluate(() => [...document.querySelectorAll('[role=group] button')].find((x) => x.textContent.trim() === 'Оддий')?.click());
  await pickLanguage(p, 'uz');
  await waitText(p, 'Bugungi bemorlar');
  check(true, 'O‘zbek (lotin) tiliga qaytdi');
  await shot(p, 'i18n-05-doctor-uz');
} catch (e) {
  for (const [i, pg] of (await b.pages()).entries()) await pg.screenshot({ path: new URL(`./shots/i18n-fail-${i}.png`, import.meta.url).pathname }).catch(() => undefined);
  throw e;
} finally {
  await b.close();
}
check(errors.length === 0, `Brauzer xatolari yo‘q${errors.length ? ': ' + errors.join(' | ') : ''}`);
