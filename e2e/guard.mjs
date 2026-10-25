// The security guard «Qorovul» in the browser (docs/SECURITY_GUARD.md): the demo card opens the guard's panel with
// only the guard's sections; the badge, the sound switch and «Rahbarga xabar» in the top bar of every guard page;
// «Kechikkan» alerts and «Yana N ta» (no silent cut-off at 30); take and close a camera alert; the resolve dialog after
// somebody else closed the alert (409 → clear message, no stuck dialog); a double tap on «Yuborish» files one SOS;
// a visitor in and out; a key handed out; a full patrol round and the «next round» cue; the manager's banner (compact
// with «+N» on a phone); the shift is handed over with a note; the manager force-closes a shift; the A4 report prints
// the hand-over snapshot; the guard never opens a patient list or the dashboard; the phone width has no sideways
// scroll and stacked rows instead of hidden columns (uz, ru).
import { launch, newPage, login, shot, settle, clickText, check, waitText, fill, sleep, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const text = (p) => p.evaluate(() => document.body.innerText);
const noSideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const dialog = (p) => p.waitForSelector('[role=dialog]');
const apiIn = (p, method, path, body) => p.evaluate(async (method, path, body) => {
  const r = await fetch('/api/v1' + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, method, path, body);
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
  // overdue on top, the badge on the menu, the top bar's SOS and sound switch
  check(await g.evaluate(() => document.querySelector('[data-alert]')?.dataset.overdue === 'true'), '«Kechikkan» ogohlantirish ro‘yxat boshida');
  check((await text(g)).includes('Kechikkan'), '«Kechikkan» belgisi ko‘rinadi');
  check(await g.evaluate(() => Number(document.querySelector('#app-menu [data-testid="guard-badge"]')?.textContent) >= 1), 'Menyuda ochiq ogohlantirishlar soni');
  check(await g.evaluate(() => !!document.querySelector('header [data-testid="sos"]') && !document.querySelector('main [data-testid="sos"]')), '«Rahbarga xabar» yuqori panelda (har sahifada)');
  const sound0 = await g.$eval('[data-testid="guard-sound"]', (e) => e.getAttribute('aria-pressed'));
  await g.click('[data-testid="guard-sound"]'); await sleep(150);
  const sound1 = await g.$eval('[data-testid="guard-sound"]', (e) => e.getAttribute('aria-pressed'));
  check(sound0 === 'true' && sound1 === 'false', 'Ovozli signal standart yoqilgan, bosilsa o‘chadi');
  await g.click('[data-testid="guard-sound"]');
  await shot(g, 'guard-01-panel');
  // the manager sees yesterday's untouched alert as «Kechikkan» in the banner (in-app escalation)
  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  await m.waitForSelector('[data-testid="security-alarm"]', { timeout: 10000 });
  check((await text(m)).includes('Kechikkan ogohlantirish'), 'Rahbar ekranida «Kechikkan» ogohlantirish');

  // take the first new alert, then close it as a false alarm
  await g.evaluate(() => [...document.querySelectorAll('[data-alert][data-state="new"] button')].find((x) => x.textContent.includes('Ko‘ryapman'))?.click());
  await waitText(g, 'Ogohlantirish sizda'); await settle(g);
  check(await g.evaluate(() => !!document.querySelector('[data-alert][data-state="taken"]')), '«Ko‘ryapman» → «Ko‘rilmoqda»');
  await g.evaluate(() => [...document.querySelector('[data-alert][data-state="taken"]').querySelectorAll('button')].find((x) => x.textContent.includes('Yopish'))?.click());
  await dialog(g); await settle(g);
  check(await g.evaluate(() => document.activeElement?.type === 'radio'), 'Yopish oynasida birinchi natija tanlanadigan holatda (klaviatura emas)');
  await g.evaluate(() => [...document.querySelectorAll('[role=dialog] label')].find((l) => l.textContent.includes('Yolg‘on signal'))?.click());
  await shot(g, 'guard-02-resolve');
  await clickText(g, 'Saqlash', '[role=dialog] button');
  await waitText(g, 'Ogohlantirish yopildi'); await settle(g);
  check(true, 'Ogohlantirish yolg‘on signal sifatida yopildi');

  // somebody else closes the alert while the dialog is open: a clear message, the dialog does not get stuck
  const other = await g.evaluate(() => document.querySelector('[data-alert][data-state="taken"], [data-alert][data-state="new"]')?.dataset.alert);
  await g.evaluate((id) => [...document.querySelector(`[data-alert="${id}"]`).querySelectorAll('button')].find((x) => x.textContent.includes('Yopish'))?.click(), other);
  await dialog(g); await settle(g);
  await g.evaluate(() => [...document.querySelectorAll('[role=dialog] label')].find((l) => l.textContent.includes('Tekshirildi'))?.click());
  const row = (await apiIn(g, 'GET', '/security/alerts?state=open&page_size=100')).body.data.find((x) => x.id === other);
  check((await apiIn(g, 'POST', `/security/alerts/${other}/resolve`, { seq: row.seq, outcome: 'false_alarm' })).status === 200, 'Ogohlantirishni «boshqa oynada» yopish');
  await clickText(g, 'Saqlash', '[role=dialog] button');
  await waitText(g, 'boshqa kishi yopdi'); await settle(g);
  check(await g.evaluate(() => !document.querySelector('[role=dialog]')), '409 dan keyin oyna yopildi, sabab aytildi (osilib qolmaydi)');

  // more than 30 open alerts: «Yana N ta ko‘rsatish», never a silent cut-off
  const store = (await apiIn(m, 'GET', '/cameras')).body.data.find((c) => c.name === 'Dori ombori').id;
  for (let i = 0; i < 32; i++) await apiIn(m, 'POST', `/cameras/${store}/simulate`, { kind: i % 2 ? 'intrusion' : 'loitering' });
  await g.goto(BASE + '/guard', { waitUntil: 'networkidle0' }); await settle(g);
  const before = await g.evaluate(() => document.querySelectorAll('[data-alert]').length);
  check(before === 30 && (await g.$eval('[data-testid="alerts-more"]', (e) => e.textContent)).match(/Yana \d+ ta/), `30 ta ko‘rinadi va «Yana N ta» tugmasi (${before})`);
  await g.click('[data-testid="alerts-more"]'); await settle(g);
  check(await g.evaluate(() => document.querySelectorAll('[data-alert]').length) > 30, '«Yana» bosilganda qolganlari yuklandi');

  // a double tap on «Yuborish» files one SOS
  const sosCount = async () => (await apiIn(g, 'GET', `/security/incidents?source=sos&status=open&page_size=1`)).body.meta.total;
  const s0 = await sosCount();
  await g.click('[data-testid="sos"]'); await dialog(g); await settle(g);
  await g.click('[role=dialog] [data-reason="suspicious"]');
  await shot(g, 'guard-07-sos');
  await g.evaluate(() => { const btn = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.includes('Yuborish')); btn.click(); btn.click(); });
  await waitText(g, 'Rahbarga yuborildi'); await settle(g);
  check(await sosCount() === s0 + 1, 'Ikki marta bosilgan «Yuborish» — bitta tez xabar');
  check((await apiIn(g, 'POST', '/security/sos', { reason: 'other' })).status === 201, 'Ikkinchi tez xabar (boshqa sabab)');

  // visitor in and out
  await g.goto(BASE + '/visitors', { waitUntil: 'networkidle0' }); await settle(g);
  check(await g.evaluate(() => !!document.querySelector('header [data-testid="sos"]')), 'Tashriflar sahifasida ham «Rahbarga xabar»');
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
  // every doctor took their key this morning: one comes back (by the same person, nobody to pick), then it is handed out again
  const room = await g.evaluate(() => { const li = [...document.querySelectorAll('[data-room]')].find((r) => !r.innerText.includes('Qaytarilmagan') && [...r.querySelectorAll('button')].some((x) => x.textContent.includes('Qaytdi'))); [...li.querySelectorAll('button')].find((x) => x.textContent.includes('Qaytdi')).click(); return li.dataset.room; });
  await dialog(g); await settle(g);
  check((await g.$eval('[role=dialog] select', (s) => s.options[s.selectedIndex].text)).includes('(o‘zi)'), 'Qaytaruvchi — kalitni olgan odam («o‘zi»)');
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

  // a full patrol round, then the «next round» cue
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
  check((await g.$eval('[data-testid="patrol-due"]', (e) => e.textContent)).includes('Keyingi obxod'), 'Keyingi obxod vaqti ko‘rsatiladi');

  // an incident: a soft hint when the text seems to name a patient
  await g.goto(BASE + '/incidents', { waitUntil: 'networkidle0' }); await settle(g);
  await g.click('[data-testid="incident-add"]'); await dialog(g); await settle(g);
  await fill(g, 'Nima bo‘ldi', 'Bemor Aliyev Vali kirishda baqirdi', '[role=dialog]');
  check(await g.evaluate(() => !!document.querySelector('[role=dialog] [data-testid="name-hint"]')), 'Bemor ismiga o‘xshash matn — ogohlantirish');
  await fill(g, 'Nima bo‘ldi', 'Kirishda janjal bo‘ldi', '[role=dialog]');
  check(await g.evaluate(() => !document.querySelector('[role=dialog] [data-testid="name-hint"]')), 'Ism yo‘q — ogohlantirish yo‘qoldi');
  await fill(g, 'Nima bo‘ldi', '', '[role=dialog]');
  await g.keyboard.press('Escape'); await sleep(300);
  check(await g.evaluate(() => !document.querySelector('[role=dialog]')), 'Bo‘sh hodisa oynasi yopildi');

  // the manager's banner: the SOS (seen → gone), the overdue alert stays; on a phone — one row and «+N»
  await m.goto(BASE + '/dashboard', { waitUntil: 'networkidle0' });
  await m.waitForSelector('[data-testid="security-alarm"]', { timeout: 10000 });
  check((await text(m)).includes('Shubhali odam'), 'Rahbar ekranida qorovulning tez xabari');
  await shot(m, 'guard-08-manager-alarm');
  await m.setViewport({ width: 390, height: 844 }); await settle(m);
  const banner = await m.$eval('[data-testid="security-alarm"]', (e) => ({ h: e.getBoundingClientRect().height, rows: [...e.children].filter((c) => c.offsetParent !== null && !c.querySelector('[data-testid="alarm-more"]')).length, more: !!e.querySelector('[data-testid="alarm-more"]') && e.querySelector('[data-testid="alarm-more"]').offsetParent !== null }));
  check(banner.rows === 1 && banner.more && banner.h < 220, `Telefonda banner ixcham: 1 qator + «Yana N ta» (${JSON.stringify(banner)})`);
  await shot(m, 'guard-08b-manager-alarm-phone');
  await m.setViewport({ width: 1366, height: 768 }); await settle(m);
  await m.evaluate(() => [...document.querySelectorAll('[data-testid="security-alarm"] .bg-red-600')].find((r) => r.innerText.includes('Shubhali odam'))?.querySelectorAll('button').forEach((x) => { if (x.textContent.includes('Ko‘rdim')) x.click(); }));
  await settle(m);
  check(!(await m.$eval('[data-testid="security-alarm"]', (e) => e.innerText).catch(() => '')).includes('Shubhali odam'), '«Ko‘rdim» → tez xabar bannerdan yo‘qoldi');
  await m.goto(BASE + '/security', { waitUntil: 'networkidle0' }); await settle(m);
  check((await text(m)).includes('Obxod intizomi'), 'Rahbar «Xavfsizlik» → umumiy ko‘rinish');
  await shot(m, 'guard-09-manager-security');
  await m.goto(BASE + '/security?tab=incidents', { waitUntil: 'networkidle0' }); await settle(m);
  check((await text(m)).includes('Shubhali odam'), 'Rahbar hodisalar jurnalida SOS yozuvi');
  await m.goto(BASE + '/settings', { waitUntil: 'networkidle0' }); await settle(m);
  await clickText(m, 'Audit jurnali', 'button, [role=tab]'); await settle(m);
  check(await m.evaluate(() => [...document.querySelectorAll('select option')].some((o) => o.value === 'security.')), 'Tizim jurnali filtrida «Xavfsizlik (qorovul)»');

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
  check((await text(pr)).includes('holatiga'), 'A4: topshirishdagi ochiq ishlar saqlangan holat bo‘yicha');
  await shot(pr, 'guard-11-print');

  // the guard opens a new shift and leaves; the manager force-closes it with a reason
  await clickText(g, 'Smenani ochish', 'button'); await waitText(g, 'ochildi'); await settle(g);
  await m.goto(BASE + '/security?tab=shifts', { waitUntil: 'networkidle0' }); await settle(m);
  await m.evaluate(() => [...document.querySelectorAll('[data-testid="shift-force"]')].find((x) => x.offsetParent !== null).click()); await dialog(m); await settle(m);
  await fill(m, 'Sabab', 'Qorovul smenani topshirmay ketdi', '[role=dialog]');
  await clickText(m, 'Majburan yopish', '[role=dialog] button');
  await waitText(m, 'Smena yopildi'); await settle(m);
  check((await text(m)).includes('Rahbar yopdi'), 'Rahbar smenani sabab bilan yopdi — «Rahbar yopdi»');
  await g.goto(BASE + '/post', { waitUntil: 'networkidle0' }); await settle(g);
  check((await text(g)).includes('Smenani rahbar yopdi') && (await text(g)).includes('topshirmay ketdi'), 'Keyingi qorovul rahbarning yopish sababini ko‘radi');

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
  check(await g.evaluate(() => { const r = document.querySelector('header [data-testid="sos"]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && r.height >= 44; }), '390 px: «Rahbarga xabar» ekranda, ≥ 44 px');
  check(await g.evaluate(() => !!document.querySelector('[data-testid="shifts-stacked"]') && document.querySelector('[data-testid="shifts-stacked"]').offsetParent !== null), '390 px /post: smenalar qatorma-qator (yashirin ustun yo‘q)');
  await g.goto(BASE + '/guard', { waitUntil: 'networkidle0' }); await settle(g);
  await g.evaluate(() => [...document.querySelectorAll('[data-alert] button')].find((x) => x.textContent.includes('Yopish'))?.click());
  await dialog(g); await settle(g);
  check(await g.evaluate(() => document.activeElement?.type === 'radio'), '390 px: yopish oynasida fokus birinchi natijada (klaviatura yopmaydi)');
  await g.keyboard.press('Escape'); await sleep(300);
  await m.setViewport({ width: 390, height: 844 });
  for (const path of ['/security?tab=shifts', '/security']) {
    await m.goto(BASE + path, { waitUntil: 'networkidle0' }); await settle(m);
    check(await noSideScroll(m), `390 px ${path}: yon tomonga aylantirish yo‘q`);
  }
  check(await m.evaluate(() => document.querySelector('[data-testid="compliance-stacked"]')?.offsetParent !== null), '390 px: «Obxod intizomi» qatorma-qator');
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
// the single 409 is the intended answer to the resolve dialog's stale save; anything else is a real error
const real = errors.filter((e) => !e.includes('status of 409'));
check(real.length === 0 && errors.length <= 1, `Brauzer xatolari yo‘q (kutilgan bitta 409 dan tashqari)${real.length ? ': ' + real.join(' | ') : ''}`);
