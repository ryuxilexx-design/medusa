// Cash desk in the browser: cashier shift panel → cash expense → close with a shortage (reason required) →
// payment blocked while closed → reopen; manager refunds a paid invoice in cash from the drawer; finance summary,
// shift list and printed shift report.
import { launch, newPage, login, shot, settle, clickText, sleep, check, waitText, fill, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const panelText = (p) => p.evaluate(() => document.querySelector('main, body').innerText);
// «Kassada hozir» key number of the open shift (expected cash in the drawer)
const expected = async (p) => {
  const t = await p.evaluate(() => document.querySelector('[data-testid="expected-cash"]')?.innerText ?? '');
  return Number(t.replace(/[^\d]/g, ''));
};
try {
  const c = await newPage(b, errors);
  await login(c, 'Kassir');
  await c.goto(BASE + '/cashier', { waitUntil: 'networkidle0' }); await settle(c);
  await waitText(c, 'ochiq · Markaziy filial');
  const e0 = await expected(c);
  check(e0 > 0, `Smena paneli: seed smenasi ochiq, kassada ${e0} so‘m bo‘lishi kerak`);
  await shot(c, 'cash-01-panel');

  await clickText(c, 'Kassadan xarajat');
  await c.waitForSelector('[role=dialog]');
  await fill(c, 'Summa, so‘m', '25000', '[role=dialog]');
  await fill(c, 'Nima uchun', 'Ichimlik suvi', '[role=dialog]');
  await clickText(c, 'Yozish', '[role=dialog] button');
  await waitText(c, 'Xarajat yozildi'); await settle(c);
  check(await expected(c) === e0 - 25000, 'Kassadan xarajat kutilgan summani kamaytirdi');

  await clickText(c, 'Smenani yopish');
  await waitText(c, 'ni yopish');
  const e1 = await expected(c);
  await fill(c, 'Kassada sanalgan naqd pul, so‘m', String(e1 - 1000), '[role=dialog]');
  await waitText(c, 'Kassada pul yetmayapti');
  check(await c.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.trim() === 'Smenani yopish').disabled), 'Farq bor — izohsiz yopib bo‘lmaydi');
  await fill(c, 'Farq sababi', 'Qaytim xatosi', '[role=dialog]');
  await shot(c, 'cash-02-close');
  await clickText(c, 'Smenani yopish', '[role=dialog] button');
  await waitText(c, 'Smena yopildi'); await settle(c);
  await waitText(c, 'Smena yopiq');
  check(true, 'Smena farq va izoh bilan yopildi');

  // a payment is impossible while the drawer is closed
  const unpaidId = await c.evaluate(async () => (await (await fetch('/api/v1/invoices?status=unpaid&page_size=50')).json()).data.find((i) => i.branch_name === 'Markaziy filial')?.id);
  await c.goto(`${BASE}/cashier/${unpaidId}`, { waitUntil: 'networkidle0' }); await settle(c);
  check(await c.evaluate(() => document.body.innerText.includes('To‘lov qabul qilish uchun')), 'Smena yopiq — to‘lov formasi o‘rniga ogohlantirish');
  await c.goto(BASE + '/cashier', { waitUntil: 'networkidle0' }); await settle(c);
  await clickText(c, 'Smenani ochish');
  await fill(c, 'Filial', 'Markaziy filial', '[role=dialog]').catch(() => undefined);
  await fill(c, 'Kassadagi boshlang‘ich naqd pul, so‘m', '200000', '[role=dialog]');
  await clickText(c, 'Ochish', '[role=dialog] button');
  await waitText(c, 'ochildi'); await settle(c);
  check(await c.evaluate(() => document.body.innerText.includes('ochiq · Markaziy filial')), 'Yangi smena ochildi');

  // manager: cash refund for a paid central invoice, paid out of the new drawer
  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  const paidId = await m.evaluate(async () => (await (await fetch('/api/v1/invoices?status=paid&page_size=50')).json()).data.find((i) => i.branch_name === 'Markaziy filial' && Number(i.paid_amount) > 0)?.id);
  await m.goto(`${BASE}/cashier/${paidId}`, { waitUntil: 'networkidle0' }); await settle(m);
  await clickText(m, 'Pulni qaytarish');
  await waitText(m, 'pulni qaytarish');
  await fill(m, 'Summa, so‘m', '10000', '[role=dialog]');
  await fill(m, 'Qanday qaytariladi', 'Naqd', '[role=dialog]');
  await waitText(m, 'Qaysi kassadan');
  await fill(m, 'Izoh', 'Muolaja qisman bajarilmadi', '[role=dialog]');
  await shot(m, 'cash-03-refund');
  await clickText(m, 'Qaytarish', '[role=dialog] [data-modal-footer] button');
  await waitText(m, 'yozildi'); await settle(m);
  check(await m.evaluate(() => document.body.innerText.includes('Qaytarishlar') && document.body.innerText.includes('Muolaja qisman bajarilmadi')), 'Hisobda qaytarish ko‘rinadi');

  await c.reload({ waitUntil: 'networkidle0' }); await settle(c);
  check(await c.evaluate(() => document.body.innerText.includes('Kassadan chiqim')), 'Kassir panelida naqd qaytarish chiqim bo‘lib ko‘rinadi');

  await m.goto(BASE + '/finance', { waitUntil: 'networkidle0' }); await settle(m);
  check(await m.evaluate(() => document.querySelector('[aria-label="Moliyaviy natija"]')?.textContent.includes('Sof natija')), 'Moliya: sof natija paneli');
  await clickText(m, 'Kassa smenalari', '[role=tablist] button, button');
  await waitText(m, 'Qaytim xatosi', 2000).catch(() => undefined);
  check(await m.evaluate(() => /−1\s?000/.test(document.body.innerText) || document.body.innerText.includes('-1 000')), 'Smenalar ro‘yxatida yopilgan smena farqi (−1 000)');
  await shot(m, 'cash-04-shifts');
  const href = await m.evaluate(() => [...document.querySelectorAll('a[href^="/print/shift/"]')].at(-1)?.getAttribute('href'));
  await m.goto(BASE + href, { waitUntil: 'networkidle0' }); await settle(m);
  check(await m.evaluate(() => document.body.innerText.includes('Kassa smenasi hisoboti') && document.body.innerText.includes('Kassada bo‘lishi kerak')), 'Smena hisoboti chop etish sahifasi');
  await shot(m, 'cash-05-report');
} catch (e) {
  for (const [i, pg] of (await b.pages()).entries()) await pg.screenshot({ path: new URL(`./shots/cash-fail-${i}.png`, import.meta.url).pathname }).catch(() => undefined);
  throw e;
} finally {
  await b.close();
}
check(errors.length === 0, `Brauzer xatolari yo‘q${errors.length ? ': ' + errors.join(' | ') : ''}`);
