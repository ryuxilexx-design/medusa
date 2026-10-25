// The security guard «Qorovul» in the browser (docs/SECURITY_GUARD.md): the demo card opens the guard's panel with
// only the guard's sections; take and close a camera alert; a visitor in and out; a key handed out; a full patrol
// round; «Rahbarga xabar» reaches the manager's banner; the shift is handed over with a note; the guard never opens a
// patient list or the dashboard; the phone width has no sideways scroll (uz, ru); the manager's «Xavfsizlik» and the
// A4 shift report open.
import { launch, newPage, login, shot, settle, clickText, check, waitText, fill, sleep, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const text = (p) => p.evaluate(() => document.body.innerText);
const noSideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const dialog = (p) => p.waitForSelector('[role=dialog]');
try {
  const g = await newPage(b, errors);
  await login(g, 'Qorovul');
  check(await g.evaluate(() => location.pathname) === '/guard', 'Qorovul kirgach «Qo‘riqlash paneli» ochiladi');
  const nav = await g.evaluate(() => [...document.querySelectorAll('#app-menu nav a')].map((a) => a.getAttribute('href')));
  check(JSON.stringify(nav) === JSON.stringify(['/guard', '/visitors', '/keys', '/patrol', '/incidents', '/on-site', '/post']), `Qorovul menyusi faqat o‘z bo‘limlari: ${nav.join(', ')}`);
  await waitText(g, 'Ogohlantirishlar'); await settle(g);
  check(await g.evaluate(() => document.querySelectorAll('[data-alert][data-state="new"]').length) >= 1, 'Ochiq ogohlantirish ro‘yxatda');
  check((await text(g)).includes('Kamera to‘sildi') || (await text(g)).includes('Zonaga kirish') || (await text(g)).includes('Shubhali turish'), 'Ogohlantirish turi yozilgan');
  check(!(await text(g)).includes('P-'), 'Panelda bemor kodi yo‘q');
  await shot(g, 'guard-01-panel');

  // take the first new alert, then close it as a false alarm
  await g.evaluate(() => [...document.querySelectorAll('[data-alert][data-state="new"] button')].find((x) => x.textContent.includes('Ko‘ryapman'))?.click());
  await waitText(g, 'Ogohlantirish sizda'); await settle(g);
  check(await g.evaluate(() => !!document.querySelector('[data-alert][data-state="taken"]')), '«Ko‘ryapman» → «Ko‘rilmoqda»');
  await g.evaluate(() => [...document.querySelector('[data-alert][data-state="taken"]').querySelectorAll('button')].find((x) => x.textContent.includes('Yopish'))?.click());
  await dialog(g); await settle(g);
  await g.evaluate(() => [...document.querySelectorAll('[role=dialog] label')].find((l) => l.textContent.includes('Yolg‘on signal'))?.click());
  await shot(g, 'guard-02-resolve');
  await clickText(g, 'Saqlash', '[role=dialog] button');
  await waitText(g, 'Ogohlantirish yopildi'); await settle(g);
  check(true, 'Ogohlantirish yolg‘on signal sifatida yopildi');

  // visitor in and out
  await g.goto(BASE + '/visitors', { waitUntil: 'networkidle0' }); await settle(g);
  await clickText(g, 'Kirdi — yozish', 'button');
  await dialog(g); await settle(g);
  await fill(g, 'F.I.Sh.', 'E2E Kuryer', '[role=dialog]');
  await fill(g, 'Tashkilot', 'Express24', '[role=dialog]');
  await clickText(g, 'Yetkazib berish', '[role=dialog] button');
  await shot(g, 'guard-03-visitor-form');
  await clickText(g, 'Saqlash', '[role=dialog] button');
  await waitText(g, 'Yozildi'); await settle(g);
  check(await g.evaluate(() => !!document.querySelector('[data-visitor="E2E Kuryer"]')), 'Tashrif buyuruvchi «Ichkarida» ro‘yxatida');
  await shot(g, 'guard-04-visitors');
  await g.evaluate(() => [...document.querySelector('[data-visitor="E2E Kuryer"]').querySelectorAll('button')].find((x) => x.textContent.includes('Chiqdi'))?.click());
  await waitText(g, 'Chiqish vaqti yozildi'); await settle(g);
  check(await g.evaluate(() => !document.querySelector('[data-visitor="E2E Kuryer"]')), '«Chiqdi» → ro‘yxatdan chiqdi');

  // a key handed to a doctor
  await g.goto(BASE + '/keys', { waitUntil: 'networkidle0' }); await settle(g);
  check((await text(g)).includes('Qaytarilmagan'), 'Kecha olingan kalit «Qaytarilmagan»');
  // every doctor took their key this morning: one comes back, then it is handed out again
  const room = await g.evaluate(() => { const li = [...document.querySelectorAll('[data-room]')].find((r) => !r.innerText.includes('Qaytarilmagan') && [...r.querySelectorAll('button')].some((x) => x.textContent.includes('Qaytdi'))); [...li.querySelectorAll('button')].find((x) => x.textContent.includes('Qaytdi')).click(); return li.dataset.room; });
  await dialog(g); await settle(g);
  await clickText(g, 'Qaytdi', '[role=dialog] button');
  await waitText(g, 'Kalit joyiga qaytdi'); await settle(g);
  check((await g.evaluate((r) => document.querySelector(`[data-room="${r}"]`).innerText, room)).includes('Joyida'), `${room} kaliti qaytdi — «Joyida»`);
  await g.evaluate((r) => [...document.querySelector(`[data-room="${r}"]`).querySelectorAll('button')].find((x) => x.textContent.includes('Berish')).click(), room);
  await dialog(g); await settle(g);
  await fill(g, 'Kim oldi', 'Akmal Rasulov', '[role=dialog]');
  await clickText(g, 'Berish', '[role=dialog] button');
  await waitText(g, 'Kalit berildi'); await settle(g);
  check((await g.evaluate((r) => document.querySelector(`[data-room="${r}"]`).innerText, room)).includes('Akmal Rasulov'), `${room} kaliti shifokorda`);
  await shot(g, 'guard-05-keys');

  // a full patrol round
  await g.goto(BASE + '/patrol', { waitUntil: 'networkidle0' }); await settle(g);
  if ((await text(g)).includes('Obxodni boshlash')) { await clickText(g, 'Obxodni boshlash', 'button'); await waitText(g, 'Obxod boshlandi'); await settle(g); }
  for (let i = 0; i < 12; i++) {
    const clicked = await g.evaluate(() => { const btn = [...document.querySelectorAll('[data-point] button')].find((x) => x.textContent.includes('Joyida')); btn?.click(); return !!btn; });
    if (!clicked) break;
    await settle(g);
  }
  check((await g.$eval('[data-testid="round-progress"]', (e) => e.textContent)).startsWith('7 / 7'), 'Barcha nazorat nuqtalari belgilandi');
  await shot(g, 'guard-06-patrol');
  await clickText(g, 'Obxodni tugatish', 'button');
  await waitText(g, 'Obxod tugadi'); await settle(g);

  // «Rahbarga xabar» → the manager's banner
  await g.goto(BASE + '/guard', { waitUntil: 'networkidle0' }); await settle(g);
  await g.click('[data-testid="sos"]'); await dialog(g); await settle(g);
  await g.click('[role=dialog] [data-reason="suspicious"]');
  await shot(g, 'guard-07-sos');
  await clickText(g, 'Yuborish', '[role=dialog] button');
  await waitText(g, 'Rahbarga yuborildi'); await settle(g);
  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  await m.waitForSelector('[data-testid="security-alarm"]', { timeout: 10000 });
  check((await text(m)).includes('Shubhali odam'), 'Rahbar ekranida qorovulning tez xabari');
  await shot(m, 'guard-08-manager-alarm');
  await clickText(m, 'Ko‘rdim', '[data-testid="security-alarm"] button');
  await settle(m);
  check(await m.evaluate(() => !document.querySelector('[data-testid="security-alarm"]')), '«Ko‘rdim» → banner yo‘qoldi');
  await m.goto(BASE + '/security', { waitUntil: 'networkidle0' }); await settle(m);
  check((await text(m)).includes('Obxod intizomi'), 'Rahbar «Xavfsizlik» → umumiy ko‘rinish');
  await shot(m, 'guard-09-manager-security');
  await m.goto(BASE + '/security?tab=incidents', { waitUntil: 'networkidle0' }); await settle(m);
  check((await text(m)).includes('Shubhali odam'), 'Rahbar hodisalar jurnalida SOS yozuvi');

  // hand over the shift
  await g.goto(BASE + '/post', { waitUntil: 'networkidle0' }); await settle(g);
  check(await g.evaluate(() => !!document.querySelector('[data-testid="handover-note"]')), 'Oldingi smenaning topshirig‘i ko‘rinadi');
  const printHref = await g.evaluate(() => document.querySelector('a[href^="/print/guard-shift/"]')?.getAttribute('href'));
  await shot(g, 'guard-10-post');
  await g.click('[data-testid="shift-close"]'); await dialog(g); await settle(g);
  await fill(g, 'Keyingi qorovulga topshiriq', 'Hammasi joyida, kalitlar ro‘yxat bo‘yicha.', '[role=dialog]');
  await clickText(g, 'Smenani topshirish', '[role=dialog] button');
  await waitText(g, 'Smena topshirildi'); await settle(g);
  check((await text(g)).includes('Smenani ochish'), 'Smena yopildi — «Smenani ochish» qaytdi');
  const pr = await newPage(b, errors);
  await login(pr, 'Qorovul');
  await pr.goto(BASE + printHref, { waitUntil: 'networkidle0' }); await settle(pr);
  check((await text(pr)).includes('Qorovul smenasi hisoboti') && (await text(pr)).includes('Hammasi joyida'), 'A4 smena hisoboti');
  await shot(pr, 'guard-11-print');

  // never a patient
  for (const path of ['/patients', '/dashboard', '/cashier', '/inventory', '/security']) {
    await g.goto(BASE + path, { waitUntil: 'networkidle0' }); await settle(g);
    check(await g.evaluate(() => !!document.querySelector('[data-testid="no-access"]')), `Qorovul ${path} ni ochmaydi`);
  }

  // phone, uz and ru
  await g.setViewport({ width: 390, height: 844 });
  for (const path of ['/guard', '/visitors', '/keys', '/patrol', '/post']) {
    await g.goto(BASE + path, { waitUntil: 'networkidle0' }); await settle(g);
    check(await noSideScroll(g), `390 px ${path}: yon tomonga aylantirish yo‘q (uz)`);
  }
  await g.evaluate(async () => { await fetch('/api/v1/me/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: 'ru' }) }); });
  await g.goto(BASE + '/guard', { waitUntil: 'networkidle0' }); await settle(g);
  check((await text(g)).includes('Пост охраны'), 'Rus tilida: «Пост охраны»');
  check(await noSideScroll(g), '390 px /guard: yon tomonga aylantirish yo‘q (ru)');
  await shot(g, 'guard-12-phone-ru');
} catch (e) {
  for (const [i, pg] of (await b.pages()).entries()) await pg.screenshot({ path: new URL(`./shots/guard-fail-${i}.png`, import.meta.url).pathname }).catch(() => undefined);
  throw e;
} finally {
  await b.close();
}
check(errors.length === 0, `Brauzer xatolari yo‘q${errors.length ? ': ' + errors.join(' | ') : ''}`);
