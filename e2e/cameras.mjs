// Hikvision cameras in the browser: the manager's camera page (attendance, people flow, security with an open
// night alert → acknowledged, devices, staff codes), the dashboard's camera alert, and the registrar's
// «Kamera tanidi» card on the queue: accepting it is the normal check-in (queue number).
import { launch, newPage, login, shot, settle, clickText, waitText, sleep, check, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
try {
  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  await m.goto(BASE + '/dashboard', { waitUntil: 'networkidle0' }); await settle(m);
  check((await m.evaluate(() => document.body.innerText)).includes('Kamera: xavfsizlik ogohlantirishi'), 'Bosh sahifada kamera ogohlantirishi');
  await m.goto(BASE + '/cameras?tab=attendance', { waitUntil: 'networkidle0' }); await settle(m);
  await waitText(m, 'Davomat');
  const att = await m.evaluate(() => document.body.innerText);
  check(att.includes('Kelgan kunlar') && att.includes('Kechikkan') && /jami \d+ daq\./.test(att), 'Davomat (7 kun): xodim bo‘yicha jamlangan');
  await shot(m, 'cam-01-attendance');
  await clickText(m, 'Kunlar bo‘yicha', 'button'); await settle(m);
  const one = await m.evaluate(() => document.body.innerText);
  check(one.includes('Barcha xodimlar') && one.includes('Keldi'), 'Davomat: bitta xodimning kunlari');
  await shot(m, 'cam-01b-attendance-person');
  await m.goto(BASE + '/cameras?tab=traffic', { waitUntil: 'networkidle0' }); await settle(m);
  await shot(m, 'cam-02-traffic');
  await m.goto(BASE + '/cameras?tab=security', { waitUntil: 'networkidle0' }); await settle(m);
  const open = () => m.evaluate(() => [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null && x.textContent.includes('Ko‘rib chiqildi')).length);
  check(await open() === 2, 'Xavfsizlik: ikkita ko‘rib chiqilmagan tungi ogohlantirish');
  await clickText(m, 'Ko‘rib chiqildi', 'button');
  for (let i = 0; i < 40 && (await open()) !== 1; i++) await sleep(250);
  check(await open() === 1, 'Bittasi ko‘rib chiqildi, bittasi qoldi');
  check((await m.evaluate(() => document.body.innerText)).includes('Ko‘rib chiqdi: Dilnoza Karimova'), 'Xavfsizlik: ko‘rib chiqildi, kim belgilagani ko‘rinadi');
  await shot(m, 'cam-03-security');
  await m.goto(BASE + '/cameras?tab=devices', { waitUntil: 'networkidle0' }); await settle(m);
  const dev = await m.evaluate(() => document.body.innerText);
  check(dev.includes('Asosiy kirish') && dev.includes('Dori ombori'), 'Qurilmalar: demo kameralar');
  await shot(m, 'cam-04-devices');
  await m.goto(BASE + '/cameras?tab=codes', { waitUntil: 'networkidle0' }); await settle(m);
  check(/S-\d+/.test(await m.evaluate(() => document.body.innerText)), 'Kodlar: xodim kodlari');
  await shot(m, 'cam-05-codes');

  const r = await newPage(b, errors);
  await login(r, 'Registrator');
  await r.goto(BASE + '/queue', { waitUntil: 'networkidle0' }); await settle(r);
  await waitText(r, 'Kamera tanidi');
  // only the camera card (the queue table below has its own «Keldi» buttons)
  const inCard = () => r.evaluate(() => {
    const h = [...document.querySelectorAll('h2, h3')].find((x) => x.textContent.includes('Kamera tanidi'));
    const card = h?.closest('section') ?? h?.parentElement?.parentElement;
    return card ? [...card.querySelectorAll('button')].filter((x) => x.textContent.includes('Keldi deb belgilash')).length : 0;
  });
  const before = await inCard();
  await shot(r, 'cam-06-arrivals');
  check(before >= 1, 'Navbatda «Kamera tanidi» kartasi (takliflar: ' + before + ')');
  await r.evaluate(() => {
    const h = [...document.querySelectorAll('h2, h3')].find((x) => x.textContent.includes('Kamera tanidi'));
    const card = h.closest('section') ?? h.parentElement.parentElement;
    [...card.querySelectorAll('button')].find((x) => x.textContent.includes('Keldi deb belgilash')).click();
  });
  await settle(r);
  for (let i = 0; i < 40 && (await inCard()) !== before - 1; i++) await sleep(250);
  check((await inCard()) === before - 1, 'Tasdiqlangan taklif kartadan yo‘qoldi');
  check((await r.evaluate(() => document.body.innerText)).includes('Haydarov Nodir'), 'Bemor navbat jadvalida');
  await shot(r, 'cam-07-accepted');
  check(!errors.length, 'Konsolda kutilmagan JS xato yo‘q' + (errors.length ? ': ' + errors.join(' | ') : ''));
} finally { await b.close(); }
