// Discounts and companies in the browser (docs/DISCOUNTS_COMPANIES.md): the registrar gives a patient the benefit
// category «Pensionerlar» (with the certificate number); the cashier opens the patient's open bill, applies the
// category's discount (pre-selected), puts the bill on the insurer, and takes only the patient's part; the manager
// records the insurer's bank transfer (spread over its bills) and opens the reconciliation act.
import { launch, newPage, login, shot, settle, clickText, sleep, check, waitText, fill, BASE } from './lib.mjs';
const errors = [];
const b = await launch();
const api = (p, path) => p.evaluate(async (path) => (await (await fetch('/api/v1' + path)).json()), path);
try {
  // ---- an open bill of today in the central branch (the seed cashier's drawer is open there)
  const r = await newPage(b, errors);
  await login(r, 'Registrator');
  const me = (await api(r, '/me')).data;
  const central = me.branches.find((x) => x.code === 'MRK').id;
  const bills = (await api(r, `/invoices?status=unpaid&branch_id=${central}&page_size=50`)).data;
  const bill = bills.find((i) => Number(i.paid_amount) === 0 && Number(i.discount_amount) === 0 && Number(i.total) >= 100_000_00);
  check(!!bill, `Ochiq hisob topildi (№${bill?.invoice_number})`);

  // ---- registrar: the benefit category on the card
  await r.goto(`${BASE}/patients/${bill.patient_id}`, { waitUntil: 'networkidle0' }); await settle(r);
  await clickText(r, 'Tahrirlash'); await r.waitForSelector('[role=dialog]');
  await fill(r, 'Imtiyoz toifasi', 'Pensionerlar', '[role=dialog]');
  await fill(r, 'Pensiya guvohnomasi', 'PN-555001', '[role=dialog]');
  await shot(r, 'disc-01-patient-benefit');
  await clickText(r, 'Saqlash', '[role=dialog] button'); await settle(r);
  await waitText(r, 'Pensionerlar · PN-555001');
  check(true, 'Registrator: kartada «Pensionerlar · PN-555001»');

  // ---- cashier: discount, company split, the patient's part
  const c = await newPage(b, errors);
  await login(c, 'Kassir');
  await c.goto(`${BASE}/cashier/${bill.id}`, { waitUntil: 'networkidle0' }); await settle(c);
  await c.waitForSelector('[data-testid="discount-picker"]');
  const picked = await c.evaluate(() => { const s = document.querySelector('[data-testid="discount-rule"]'); return s.options[s.selectedIndex].text; });
  check(picked.startsWith('Pensionerlar 10 %'), `Toifaning chegirmasi oldindan tanlangan (${picked})`);
  await c.click('[data-testid="discount-apply"]'); await settle(c);
  await waitText(c, 'Chegirma qo‘llandi');
  let inv = (await api(c, `/invoices/${bill.id}`)).data;
  check(Number(inv.discount_amount) === inv.items.reduce((a, it) => a + Math.round(Number(it.line_subtotal) / 10), 0), `Har xizmatga 10 %: −${inv.discount_amount / 100} so‘m`);
  check(inv.discount_source === 'benefit' && inv.discount_granted_by_name === 'Nodira Aliyeva', 'Imtiyoz toifasidan, kassir bergan');
  await fill(c, 'Kompaniya', 'Ishonch', '[data-testid="company-split"]');
  await settle(c);
  await shot(c, 'disc-02-cashier-split');
  await c.click('[data-testid="company-apply"]'); await settle(c);
  await waitText(c, 'Kompaniya ulushi');
  inv = (await api(c, `/invoices/${bill.id}`)).data;
  const share = Math.round(Number(inv.total) * 80 / 100);
  check(Number(inv.company_share_amount) === share && Number(inv.due) === Number(inv.total) - share, `Sug‘urta 80 %: ${share / 100}, bemor ${inv.due / 100} so‘m`);
  check(await c.evaluate(() => document.body.innerText.includes('Bemor to‘laydi')), 'Hisobda: «Bemor to‘laydi» va «Kompaniya to‘laydi»');
  // the payment form offers exactly the patient's part
  await clickText(c, 'To‘lovni qayd qilish', 'form button[type=submit]'); await settle(c);
  await waitText(c, 'To‘lov qabul qilindi').catch(() => undefined);
  inv = (await api(c, `/invoices/${bill.id}`)).data;
  check(inv.status === 'partially_paid' && Number(inv.due) === 0 && Number(inv.company_due) === share, 'Bemor o‘z qismini to‘ladi; qolgani kompaniya qarzi');
  check(await c.evaluate(() => document.body.innerText.includes('To‘lovdan keyin chegirma va to‘lovchi o‘zgarmaydi')), 'To‘lovdan keyin blok faqat o‘qish uchun');
  await shot(c, 'disc-03-cashier-paid');
  const debtors = (await api(c, '/invoices?debt=1&page_size=100')).data;
  check(!debtors.some((i) => i.id === bill.id), 'Bemor qarzdorlar ro‘yxatida yo‘q');

  // ---- manager: the insurer's transfer, then the act
  const m = await newPage(b, errors);
  await login(m, 'Rahbar');
  await m.goto(BASE + '/companies', { waitUntil: 'networkidle0' }); await settle(m);
  await m.waitForSelector('tr[data-company]');
  check(await m.evaluate(() => !!document.querySelector('tr[data-company*="Ishonch"]')), 'Qarzlar ro‘yxatida sug‘urta kompaniyasi');
  await shot(m, 'disc-04-companies');
  const insurer = (await api(m, '/companies?all=1&page_size=50')).data.find((x) => x.name.includes('Ishonch'));
  const open = await api(m, `/companies/${insurer.id}/open-invoices?page_size=100`);
  check(open.data.some((i) => i.id === bill.id), 'Ochiq hisoblar orasida bizning hisob');
  await m.click('[data-testid="company-payment-open"]'); await m.waitForSelector('[role=dialog]'); await settle(m);
  await fill(m, 'Kompaniya', insurer.name, '[role=dialog]'); await settle(m);
  await fill(m, 'Summa', String(open.meta.due / 100), '[role=dialog]');
  await fill(m, 'To‘lov topshiriqnomasi', 'p/t 777', '[role=dialog]');
  await clickText(m, 'Eskilaridan boshlab taqsimlash', '[role=dialog] button'); await sleep(200);
  await shot(m, 'disc-05-company-payment');
  await m.click('[data-testid="company-payment-save"]'); await settle(m);
  await waitText(m, 'Kompaniya to‘lovi №');
  const after = (await api(m, `/companies/${insurer.id}`)).data;
  check(after.outstanding === 0, 'Sug‘urta qarzi yopildi');
  inv = (await api(m, `/invoices/${bill.id}`)).data;
  check(inv.status === 'paid' && Number(inv.company_due) === 0, 'Hisob to‘liq yopildi');
  await clickText(m, 'To‘lovlar', '[role=tablist] button'); await settle(m);
  check(await m.evaluate(() => document.body.innerText.includes('p/t 777')), 'To‘lovlar ro‘yxatida yangi o‘tkazma');
  // the reconciliation act (A4) for this month
  const from = me.today.slice(0, 8) + '01';
  await m.goto(`${BASE}/print/company-act/${insurer.id}?from=${from}&to=${me.today}`, { waitUntil: 'networkidle0' }); await settle(m);
  await waitText(m, 'solishtirish dalolatnomasi');
  check(await m.evaluate(() => document.body.innerText.includes('Davr oxiriga qoldiq') && document.body.innerText.includes('Kontragent nomidan')), 'Akt sverki: qoldiqlar va imzolar');
  await shot(m, 'disc-06-act');
  // the discounts report shows the cashier's discount
  await m.goto(BASE + '/discounts', { waitUntil: 'networkidle0' }); await settle(m);
  check(await m.evaluate(() => document.body.innerText.includes('Pensionerlar 10 %')), '«Chegirmalar» hisobotida pensionerlar qoidasi');
  await shot(m, 'disc-07-report');
  // the cashier cannot open the manager's discounts section
  await c.goto(BASE + '/discounts', { waitUntil: 'networkidle0' }); await settle(c);
  check(await c.evaluate(() => !document.body.innerText.includes('Berilgan chegirma')), 'Kassir «Chegirmalar» bo‘limini ko‘rmaydi');
} catch (e) {
  for (const [i, pg] of (await b.pages()).entries()) await pg.screenshot({ path: new URL(`./shots/disc-fail-${i}.png`, import.meta.url).pathname }).catch(() => undefined);
  throw e;
} finally {
  await b.close();
}
check(errors.length === 0, `Brauzer xatolari yo‘q${errors.length ? ': ' + errors.join(' | ') : ''}`);
