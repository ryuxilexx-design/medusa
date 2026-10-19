// Doctor schedule in the browser: open editor → client validation → day off with booked patients → conflict list →
// "save anyway" keeps the bookings → the doctor card shows the new week.
// The doctor and weekday are taken from a real upcoming booking, so the conflict always exists.
import { launch, newPage, login, shot, settle, clickText, sleep, check, waitText, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const setInput = (p, label, v) => p.evaluate((label, v) => {
  const el = document.querySelector(`[role=dialog] [aria-label="${label}"]`);
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}, label, v);
try {
  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  // pick a doctor with a booking still ahead in the next week (data comes from the app's own API, same session)
  const target = await m.evaluate(async () => {
    const me = (await (await fetch('/api/v1/me')).json()).data;
    const to = new Date(Date.parse(me.today + 'T00:00:00Z') + 7 * 86400_000).toISOString().slice(0, 10);
    const list = (await (await fetch(`/api/v1/appointments?from=${me.today}&to=${to}&status=scheduled`)).json()).data;
    const a = list.find((x) => Date.parse(x.starts_at) > Date.parse(me.now));
    const local = new Date(Date.parse(a.starts_at) + 5 * 3600_000).toISOString().slice(0, 10);
    return { doctor: a.doctor_name, weekday: new Date(local + 'T00:00:00Z').getUTCDay() };
  });
  const DAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
  const todayLabel = DAYS[target.weekday];
  await m.goto(BASE + '/staff', { waitUntil: 'networkidle0' }); await settle(m);
  await m.evaluate((n) => [...document.querySelectorAll('tr')].find((r) => r.innerText.includes(n)).click(), target.doctor); await settle(m);
  await waitText(m, 'Jadvalni tahrirlash');
  const hasDay = (d) => m.evaluate((d) => { const card = [...document.querySelectorAll('h3')].find((h) => h.textContent === 'Ish jadvali')?.closest('div')?.parentElement; return [...(card?.querySelectorAll('tbody tr') ?? [])].some((r) => r.innerText.startsWith(d)); }, d);
  check(await hasDay(todayLabel), `${target.doctor}: ${todayLabel} kuni kelgusi qabul bor va u shu kuni ishlaydi`);
  await clickText(m, 'Jadvalni tahrirlash');
  await waitText(m, 'ish jadvali');
  await shot(m, 'sched-01-editor');

  // client-side validation: break outside working hours
  await setInput(m, `${todayLabel}: tanaffus boshi`, '05:00');
  await clickText(m, 'Saqlash', '[role=dialog] button');
  await waitText(m, 'Tanaffus ish vaqti ichida');
  check(true, 'Tanaffus ish vaqtidan tashqarida — forma xatosi, so‘rov yuborilmadi');
  await setInput(m, `${todayLabel}: tanaffus boshi`, '');
  await setInput(m, `${todayLabel}: tanaffus oxiri`, '');

  // today off → bookings that no longer fit are listed, nothing is saved yet
  await m.evaluate((d) => document.querySelector(`[role=dialog] input[aria-label="${d}: ishlaydi"]`).click(), todayLabel); await sleep(200);
  await clickText(m, 'Saqlash', '[role=dialog] button');
  await waitText(m, 'yangi jadvalga sig‘maydi');
  await shot(m, 'sched-02-conflicts');
  const listed = await m.evaluate(() => document.querySelectorAll('[role=dialog] ul li').length);
  check(listed >= 1, `Sig‘magan qabullar ro‘yxati ko‘rsatildi (${listed} ta)`);
  check(await m.evaluate(() => document.body.innerText.includes('Qabullar o‘chirilmaydi')), 'Qabullar o‘chirilmasligi aytilgan');
  await clickText(m, 'Baribir saqlash', '[role=dialog] button');
  await waitText(m, 'registrator ko‘chirishi kerak');
  await settle(m);
  check(!(await m.evaluate(() => !!document.querySelector('[role=dialog]'))), 'Saqlangach oyna yopildi');
  check(!(await hasDay(todayLabel)), `Kartada ${todayLabel} endi yo‘q`);
  const still = await m.evaluate(async () => {
    const me = (await (await fetch('/api/v1/me')).json()).data;
    const to = new Date(Date.parse(me.today + 'T00:00:00Z') + 7 * 86400_000).toISOString().slice(0, 10);
    return (await (await fetch(`/api/v1/appointments?from=${me.today}&to=${to}&status=scheduled`)).json()).data.filter((x) => Date.parse(x.starts_at) > Date.parse(me.now)).length;
  });
  check(still > 0, `Kelgusi qabullar o‘chmagan (${still} ta rejalashtirilgan)`);
  await shot(m, 'sched-03-saved');
} catch (e) {
  for (const [i, p] of (await b.pages()).entries()) await p.screenshot({ path: new URL(`./shots/sched-fail-${i}.png`, import.meta.url).pathname }).catch(() => undefined);
  throw e;
} finally {
  await b.close();
}
// The single 409 is the intended SCHEDULE_CONFLICTS answer; anything else is a real error.
const real = errors.filter((e) => !e.includes('status of 409'));
check(real.length === 0 && errors.length <= 1, `Brauzer xatolari yo‘q (kutilgan bitta 409 dan tashqari)${real.length ? ': ' + real.join(' | ') : ''}`);
