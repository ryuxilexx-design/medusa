// Referral partners and lead sources in the browser (docs/REFERRALS.md): the registrar registers a patient with a
// lead source, books them «Yo‘llanma bor» with a partner found by name (the source switches to «Yo‘llovchi shifokor»),
// checks them in; the manager opens «Hamkorlar», sees the partner report, the lines of one partner and records a payout.
import { launch, newPage, login, shot, settle, clickText, sleep, check, waitText, fill, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const PAT = { last: 'Yo‘llanmali', first: 'Sardor' };
const api = (p, path) => p.evaluate(async (path) => (await (await fetch('/api/v1' + path)).json()), path);
try {
  // ---- registrar: a new card (source «Instagram») and a referred booking
  const r = await newPage(b, errors);
  await login(r, 'Registrator');
  await r.goto(BASE + '/patients', { waitUntil: 'networkidle0' });
  await clickText(r, 'Bemor qo‘shish');
  await fill(r, 'Familiya', PAT.last); await fill(r, 'Ism', PAT.first); await fill(r, 'Tug‘ilgan sana', '1987-04-12');
  await fill(r, 'Qayerdan bildi', 'Instagram', '[role=dialog]');
  await clickText(r, 'Bemorni saqlash');
  await waitText(r, 'Qabulga yozish'); await settle(r);
  check(true, 'Registrator: bemor «Instagram» manbasi bilan yaratildi, qabul oynasi ochildi');
  // the booking dialog took the card's source
  const src0 = await r.evaluate(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find((x) => x.textContent.startsWith('Qayerdan bildi')); const s = document.getElementById(l.htmlFor); return s.options[s.selectedIndex].text; });
  check(src0 === 'Instagram', `Qabul oynasida manba = kartaniki (${src0})`);
  await fill(r, 'Shifokor', 'Akmal Rasulov'); await settle(r);
  await r.click('[data-testid="has-referral"]'); await sleep(200);
  await r.type('[data-testid="partner-search"]', 'Rustamov'); await settle(r); await sleep(400);
  await clickText(r, 'Rustamov Anvar', '[role=dialog] button');
  await r.waitForSelector('[data-testid="partner-chosen"]');
  const src1 = await r.evaluate(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find((x) => x.textContent.startsWith('Qayerdan bildi')); const s = document.getElementById(l.htmlFor); return s.options[s.selectedIndex].text; });
  check(src1 === 'Yo‘llovchi shifokor', `Yo‘llovchi tanlandi → manba «Yo‘llovchi shifokor» (${src1})`);
  const slot = await r.evaluate(() => { const btn = [...document.querySelectorAll('[role=dialog] button')].find((x) => /^\d\d:\d\d$/.test(x.textContent.trim()) && !x.disabled); btn?.click(); return btn?.textContent; });
  await shot(r, 'ref-01-booking');
  await clickText(r, 'Qabulga yozish', '[role=dialog] button'); await settle(r);
  await waitText(r, 'yozildi').catch(() => undefined);
  const pt = (await api(r, `/patients?search=${encodeURIComponent(PAT.last)}&page_size=5`)).data[0];
  const appt = (await api(r, `/appointments?patient_id=${pt.id}`)).data[0];
  check(appt.referral_partner_name === 'Rustamov Anvar Baxtiyorovich' && appt.lead_source_name === 'Yo‘llovchi shifokor', `Qabul ${slot}: yo‘llovchi va manba saqlandi`);
  check(pt.lead_source_name === 'Instagram', 'Kartaning birinchi manbasi o‘zgarmadi (Instagram)');
  // check-in from the queue bills the service with the partner's percent (server side)
  await r.goto(BASE + '/queue', { waitUntil: 'networkidle0' }); await settle(r);
  await r.evaluate((n) => { const li = [...document.querySelectorAll('li')].find((l) => l.textContent.includes(n)); [...li.querySelectorAll('button')].find((x) => x.textContent.includes('Keldi')).click(); }, `${PAT.last} ${PAT.first}`);
  await settle(r); await sleep(400);
  // the patient card shows the visit's partner and source
  await r.goto(`${BASE}/patients/${pt.id}`, { waitUntil: 'networkidle0' }); await settle(r);
  await clickText(r, 'Tashriflar', '[role=tablist] button'); await settle(r);
  check(await r.evaluate(() => document.body.innerText.includes('Rustamov Anvar Baxtiyorovich')), 'Bemor kartasi: qabulda yo‘llovchi ko‘rinadi');
  await shot(r, 'ref-02-patient-visits');
  // the registrar never opens the manager's section
  await r.goto(BASE + '/partners', { waitUntil: 'networkidle0' }); await settle(r);
  check(await r.evaluate(() => !document.body.innerText.includes('To‘lanishi kerak')), 'Registrator «Hamkorlar» bo‘limini ko‘rmaydi');

  // ---- manager: report, lines, payout
  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  await m.goto(BASE + '/partners', { waitUntil: 'networkidle0' }); await settle(m);
  await waitText(m, 'Hamkorlar ulushi');
  check(await m.evaluate(() => document.body.innerText.includes('Rustamov Anvar Baxtiyorovich')), 'Rahbar: hamkorlar hisobotida Rustamov bor');
  await shot(m, 'ref-03-report');
  // the lines of Rustamov (#101)
  await m.click('tr[data-partner="101"] [data-testid="partner-lines"]'); await m.waitForSelector('[role=dialog]'); await settle(m);
  check(await m.evaluate(() => /Jami: \d+ ta xizmat/.test(document.querySelector('[role=dialog]').innerText)), 'Hamkor xizmatlari ro‘yxati va jami');
  await m.keyboard.press('Escape'); await sleep(300);
  // a bank transfer of 10 000 so‘m to Rustamov (#101 still has a balance after the seed's payouts)
  const before = (await api(m, `/referral-payouts?from=2026-01-01&to=2026-12-31&page_size=1`)).meta.count;
  await clickText(m, 'To‘lash', 'tr[data-partner="101"] button'); await m.waitForSelector('[role=dialog]');
  await fill(m, 'Summa, so‘m', '10000', '[role=dialog]');
  await fill(m, 'Izoh', 'E2E to‘lov', '[role=dialog]');
  await shot(m, 'ref-04-payout');
  await clickText(m, 'To‘lash', '[role=dialog] button');
  await waitText(m, 'To‘lov qayd etildi'); await settle(m);
  const after = (await api(m, `/referral-payouts?from=2026-01-01&to=2026-12-31&page_size=1`)).meta.count;
  check(after === before + 1, 'To‘lov yozildi (bank o‘tkazmasi)');
  await clickText(m, 'To‘lovlar', '[role=tablist] button'); await settle(m);
  check(await m.evaluate(() => document.body.innerText.includes('E2E to‘lov')), 'To‘lovlar ro‘yxatida yangi to‘lov');
  await clickText(m, 'Manbalar', '[role=tablist] button'); await settle(m);
  check(await m.evaluate(() => document.body.innerText.includes('Yo‘llovchi shifokor') && document.body.innerText.includes('Instagram')), 'Manbalar hisoboti');
  await shot(m, 'ref-05-sources');
  // the dashboard card
  await m.goto(BASE + '/dashboard', { waitUntil: 'networkidle0' }); await settle(m);
  await clickText(m, '30 kun', 'button');
  await settle(m);
  check(await m.evaluate(() => document.body.innerText.includes('Yangi bemorlar manbasi')), 'Dashboard: «Yangi bemorlar manbasi» kartasi');
} catch (e) {
  for (const [i, pg] of (await b.pages()).entries()) await pg.screenshot({ path: new URL(`./shots/ref-fail-${i}.png`, import.meta.url).pathname }).catch(() => undefined);
  throw e;
} finally {
  await b.close();
}
check(errors.length === 0, `Brauzer xatolari yo‘q${errors.length ? ': ' + errors.join(' | ') : ''}`);
