// Usage: start the app (npm run demo), reset demo data, then `npm run e2e`. Creates patient «Abdullayev Jamshid».
// Full P0 demo path through the UI: registrar -> doctor -> lab -> cashier -> manager.
import { launch, newPage, login, shot, settle, clickText, fill, waitText, sleep, check, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const step = (s) => console.log('✓ ' + s);
const PAT = { last: 'Abdullayev', first: 'Jamshid' };

// Manager: baseline revenue
const kpi = (page) => page.evaluate(() => { const l = [...document.querySelectorAll('div')].find((d) => d.textContent.trim() === 'Qayd etilgan tushum'); return l?.nextElementSibling?.textContent; });
let m = await newPage(b, errors);
await login(m, 'Rahbar');
const revenue0 = await kpi(m);
step('Rahbar: boshlang‘ich tushum = ' + revenue0);

// Registrar
const r = await newPage(b, errors);
await login(r, 'Registrator');
await r.goto(BASE + '/patients', { waitUntil: 'networkidle0' });
await clickText(r, 'Bemor qo‘shish');
await fill(r, 'Familiya', PAT.last); await fill(r, 'Ism', PAT.first); await fill(r, 'Tug‘ilgan sana', '1990-05-14');
await fill(r, 'Jins', 'male'); await fill(r, 'Telefon', '93 555 12 34');
await shot(r, 'e2e-01-patient-form');
await clickText(r, 'Bemorni saqlash');
await waitText(r, 'Qabulga yozish'); await settle(r);
step('Registrator: bemor yaratildi, qabul oynasi ochildi');
await fill(r, 'Shifokor', 'Akmal Rasulov'); await settle(r);
const slot = await r.evaluate(() => { const btn = [...document.querySelectorAll('[role=dialog] button')].find((x) => /^\d\d:\d\d$/.test(x.textContent.trim()) && !x.disabled); btn?.click(); return btn?.textContent; });
step('Registrator: bo‘sh slot tanlandi ' + slot);
await shot(r, 'e2e-02-booking');
await clickText(r, 'Qabulga yozish', '[role=dialog] button'); await settle(r);
await r.goto(BASE + '/queue', { waitUntil: 'networkidle0' }); await settle(r);
await r.evaluate((n) => { const li = [...document.querySelectorAll('li')].find((l) => l.textContent.includes(n)); [...li.querySelectorAll('button')].find((x) => x.textContent.includes('Keldi')).click(); }, `${PAT.last} ${PAT.first}`);
await settle(r); await sleep(500);
await shot(r, 'e2e-03-queue');
const qn = await r.evaluate((n) => [...document.querySelectorAll('tr')].find((t) => t.textContent.includes(n))?.querySelector('span')?.textContent, `${PAT.last} ${PAT.first}`);
step('Registrator: «Keldi» → navbat №' + qn);
// double check-in protection: reload queue, still single row
await r.reload({ waitUntil: 'networkidle0' });
const rows = await r.evaluate((n) => [...document.querySelectorAll('tr')].filter((t) => t.textContent.includes(n)).length, `${PAT.last} ${PAT.first}`);
check(rows === 1, 'Registrator: refreshdan keyin navbatda bitta qator (№' + qn + ')');

// Doctor
const d = await newPage(b, errors);
await login(d, 'Shifokor', 'Akmal Rasulov');
await d.goto(BASE + '/queue', { waitUntil: 'networkidle0' }); await settle(d);
await d.evaluate((n) => { const tr = [...document.querySelectorAll('tr')].find((t) => t.textContent.includes(n)); [...tr.querySelectorAll('button')].find((x) => x.textContent.includes('Qabulni boshlash')).click(); }, `${PAT.last} ${PAT.first}`);
await d.waitForFunction(() => location.pathname === '/doctor'); await settle(d);
await clickText(d, 'Qabulni boshlash'); await waitText(d, 'Klinik qayd'); await settle(d);
step('Shifokor: qabul boshlandi');
await clickText(d, 'AI bilan tartiblash'); await settle(d);
await clickText(d, 'Demo matnni qo‘yish'); await clickText(d, 'Tartiblash', '[role=dialog] button');
await waitText(d, 'Namunaviy AI natijasi'); await shot(d, 'e2e-04-ai');
await clickText(d, 'Loyihani formaga qo‘llash');
step('Shifokor: namunaviy AI loyihasi formaga qo‘llandi');
await fill(d, 'Sistolik bosim', '125'); await fill(d, 'Diastolik', '80'); await fill(d, 'Harorat', '37.6');
await clickText(d, 'Qoralamani saqlash'); await settle(d); await waitText(d, 'Qoralama saqlangan');
// reopen (refresh) and confirm draft persisted
await d.reload({ waitUntil: 'networkidle0' }); await settle(d);
const persisted = await d.evaluate(() => [...document.querySelectorAll('textarea')].some((t) => t.value.includes('tomoq og‘rig‘i')));
check(persisted, 'Shifokor: refreshdan keyin qoralama saqlangan');
await clickText(d, 'Tekshiruv buyurish'); await settle(d);
await d.evaluate(() => { const lab = [...document.querySelectorAll('[role=dialog] label')].find((l) => l.textContent.includes('Umumiy qon tahlili')); lab.querySelector('input').click(); });
await clickText(d, 'Buyurtma berish'); await settle(d);
step('Shifokor: UQT buyurildi');
await clickText(d, 'Tasdiqlash va yakunlash'); await settle(d);
await clickText(d, 'Tasdiqlash', '[role=dialog] button'); await settle(d); await waitText(d, 'Tasdiqladi:');
await shot(d, 'e2e-05-signed');
step('Shifokor: qayd tasdiqlandi, qabul yakunlandi');

// Lab
const l = await newPage(b, errors);
await login(l, 'Laboratoriya');
await l.evaluate(() => { const i = document.querySelector('input[aria-label="Bemor bo‘yicha qidirish"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Abdullayev Jamshid'); i.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(700); await settle(l);
await l.evaluate(() => [...document.querySelectorAll('ul button')].find((x) => x.textContent.includes('Umumiy qon tahlili')).click()); await settle(l);
await clickText(l, 'Namuna olindi'); await settle(l); await waitText(l, 'Gemoglobin');
const vals = { HGB: '138', RBC: '4.6', WBC: '11.2', PLT: '250', ESR: '9' };
for (const [k, v] of Object.entries(vals)) await l.evaluate((k, v) => { const i = document.getElementById('v-' + k); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); }, k, v);
await sleep(200); await shot(l, 'e2e-06-lab-entry');
await clickText(l, 'Qoralama saqlash'); await settle(l); await sleep(400);
await clickText(l, 'Natijani tasdiqlash'); await settle(l); await waitText(l, 'Tasdiqlandi:');
step('Laboratoriya: namuna → natija → tasdiqlandi');

// Doctor sees verified result
await d.reload({ waitUntil: 'networkidle0' }); await settle(d);
const docSees = await d.evaluate(() => document.body.innerText.includes('Leykotsitlar') && /yuqori/i.test(document.body.innerText));
await shot(d, 'e2e-07-doctor-result');
check(docSees, 'Shifokor: tasdiqlangan natija kartada ko‘rinadi');

// Cashier
const c = await newPage(b, errors);
await login(c, 'Kassir');
await c.evaluate(() => { const i = document.querySelector('input[aria-label="Qidirish"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Abdullayev'); i.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(700); await settle(c);
await clickText(c, 'To‘lash'); await c.waitForFunction(() => location.pathname.startsWith('/cashier/')); await settle(c);
const total = await c.evaluate(() => document.body.innerText.match(/Qoldiq\s*([\d\s]+so‘m)/)?.[1]);
step('Kassir: hisob ochildi, qoldiq ' + total);
await fill(c, 'Summa', '100000'); await clickText(c, 'To‘lovni qayd qilish', 'form button'); await settle(c); await waitText(c, 'Qayd №');
step('Kassir: qisman to‘lov 100 000');
await fill(c, 'Summa', '999999999'); await clickText(c, 'To‘lovni qayd qilish', 'form button'); await sleep(300);
const overErr = await c.evaluate(() => document.body.innerText.includes('qoldiqdan'));
check(overErr, 'Kassir: ortiqcha summa bloklandi');
await clickText(c, 'To‘liq'); await fill(c, 'To‘lov usuli', 'card'); await clickText(c, 'To‘lovni qayd qilish', 'form button'); await settle(c);
await waitText(c, 'Hisob to‘liq to‘langan');
await shot(c, 'e2e-08-paid');
step('Kassir: qoldiq karta bilan to‘landi — hisob to‘langan');

// Manager dashboard updated
await m.reload({ waitUntil: 'networkidle0' }); await settle(m);
const revenue1 = await kpi(m);
await shot(m, 'e2e-09-dashboard');
const num = (x) => Number(String(x).replace(/\D/g, ''));
check(num(revenue1) - num(revenue0) === 210000, `Rahbar: tushum ${revenue0} → ${revenue1} (+210 000)`);
// Cashier cannot open clinical note URL
const enc = await d.evaluate(() => document.querySelector('a[href^="/print/note/"]')?.getAttribute('href'));
await c.goto(BASE + enc, { waitUntil: 'networkidle0' }); await settle(c);
const denied = await c.evaluate(() => document.body.innerText.includes('ruxsat'));
check(denied, 'Kassir: klinik qayd print URL rad etildi');
await d.goto(BASE + enc, { waitUntil: 'networkidle0' }); await settle(d); await shot(d, 'e2e-10-print-note');
const unexpected = errors.filter((e) => !e.includes('403'));
check(!unexpected.length, 'Konsolda kutilmagan xato yo‘q' + (unexpected.length ? ': ' + unexpected.join(' | ') : ''));
await b.close();
