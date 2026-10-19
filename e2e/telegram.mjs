// Telegram bot in the browser: Settings → Telegram bot → simulator. A patient links their phone, books, fills the
// pre-visit questionnaire; the booking shows "TG" in the schedule and the doctor sees the answers.
import { launch, newPage, login, shot, settle, clickText, sleep, check, waitText, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const sim = '[aria-label="Telegram simulyatori"]';
const lastBotText = (p) => p.evaluate((sim) => { const bs = [...document.querySelectorAll(`${sim} [aria-live] .bg-white.rounded-2xl, ${sim} [aria-live] .rounded-bl-sm`)]; return bs.at(-1)?.innerText ?? ''; }, sim);
/** Clicks the newest simulator button (inline or reply keyboard) whose caption matches the regex. */
async function tap(p, re) {
  const ok = await p.evaluate((sim, src) => {
    const re = new RegExp(src);
    const btn = [...document.querySelectorAll(`${sim} button`)].filter((x) => re.test(x.innerText.trim()) && !x.disabled).at(-1);
    if (!btn) return false; btn.click(); return true;
  }, sim, re.source);
  if (!ok) throw new Error(`tap: no button ${re}`);
  await sleep(700); await settle(p);
}
async function type(p, text) {
  await p.evaluate((sim, text) => {
    const el = document.querySelector(`${sim} input[aria-label="Xabar"]`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, sim, text);
  await sleep(100);
  await p.evaluate((sim) => document.querySelector(`${sim} button[aria-label="Yuborish"]`).click(), sim);
  await sleep(700); await settle(p);
}
try {
  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  await m.goto(BASE + '/settings', { waitUntil: 'networkidle0' }); await settle(m);
  await clickText(m, 'Telegram bot', '[role=tablist] button, button');
  await waitText(m, 'Klinika boti');
  await m.waitForSelector(`${sim} input[aria-label="Xabar"]`);
  await shot(m, 'tg-01-settings');
  check(await m.evaluate(() => document.body.innerText.includes('@BotFather')), 'Botni ulash yo‘riqnomasi ko‘rinadi');

  // a seed patient with their own phone number
  const patient = await m.evaluate(async () => {
    const list = (await (await fetch('/api/v1/patients?page_size=100')).json()).data.filter((x) => x.phone);
    const counts = {}; for (const x of list) counts[x.phone] = (counts[x.phone] ?? 0) + 1;
    return list.find((x) => counts[x.phone] === 1);
  });
  await type(m, '/start');
  check((await lastBotText(m)).includes('telefon raqamingizni ulashing'), 'Bot kontakt so‘radi');
  await tap(m, /Telefon raqamni ulashish/);
  await m.evaluate((sim, phone) => {
    const el = document.querySelector(`${sim} input[aria-label="Ulashiladigan telefon raqami"]`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, phone);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, sim, patient.phone);
  await tap(m, /^Ulashish$/);
  await waitText(m, 'Raqamingiz bo‘yicha topildi');
  check(await m.evaluate((n) => document.body.innerText.includes(n), `${patient.last_name} ${patient.first_name}`), 'Bemor kartasi topildi');

  await tap(m, /Qabulga yozilish/);
  await tap(m, /so‘m/);           // first service
  await tap(m, /·/);              // first doctor
  await tap(m, /^\d\d\.\d\d /);   // first free day
  await tap(m, /^\d\d:\d\d$/);    // first free time
  await waitText(m, 'Tasdiqlaysizmi');
  await shot(m, 'tg-02-confirm');
  await tap(m, /Tasdiqlash/);
  await waitText(m, 'Qabulga yozildingiz');
  check(true, 'Simulyatorda qabulga yozildi');
  await tap(m, /Ha, to‘ldiraman/);
  await type(m, 'Uch kundan beri tomoq og‘riyapti');
  await tap(m, /^Yo‘q$/);
  await type(m, 'Hech narsa ichmayapman');
  await waitText(m, 'shifokoringizga yetkaziladi');
  await shot(m, 'tg-03-intake-done');
  check(true, 'So‘rovnoma to‘ldirildi');

  // the booking in the staff schedule
  const appt = await m.evaluate(async () => {
    const me = (await (await fetch('/api/v1/me')).json()).data;
    const to = new Date(Date.parse(me.today + 'T00:00:00Z') + 14 * 86400_000).toISOString().slice(0, 10);
    const list = (await (await fetch(`/api/v1/appointments?from=${me.today}&to=${to}`)).json()).data.filter((a) => a.source === 'telegram');
    return list.at(-1);
  });
  check(!!appt, 'Qabul tizimda bor (manba: Telegram)');
  const date = new Date(Date.parse(appt.starts_at) + 5 * 3600_000).toISOString().slice(0, 10);
  await m.goto(`${BASE}/schedule?date=${date}`, { waitUntil: 'networkidle0' }); await settle(m);
  const hasTg = await m.evaluate(() => !!document.querySelector('[aria-label="Telegram orqali"]'));
  await shot(m, 'tg-04-schedule');
  check(hasTg, 'Qabul jadvalida «TG» belgisi');

  // the doctor of that appointment sees the questionnaire
  const d = await newPage(b, errors);
  await login(d, 'Shifokor', appt.doctor_name);
  await d.goto(`${BASE}/doctor?appointment=${appt.id}`, { waitUntil: 'networkidle0' }); await settle(d);
  await waitText(d, 'Bemor Telegram’da yozgan');
  check(await d.evaluate(() => document.body.innerText.includes('Uch kundan beri tomoq og‘riyapti')), 'Shifokor bemor javoblarini ko‘rdi');
  await shot(d, 'tg-05-doctor-intake');
} catch (e) {
  for (const [i, p] of (await b.pages()).entries()) await p.screenshot({ path: new URL(`./shots/tg-fail-${i}.png`, import.meta.url).pathname }).catch(() => undefined);
  throw e;
} finally {
  await b.close();
}
check(errors.length === 0, `Brauzer xatolari yo‘q${errors.length ? ': ' + errors.join(' | ') : ''}`);
