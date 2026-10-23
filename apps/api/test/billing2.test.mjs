// Cash audit 2026-10-22: quantity on orders, per-line vs proportional refunds, patient deposits (incl. the race),
// debtor ageing buckets and promises, CSV exports (headers, row counts, injection), list limits/pagination.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t, type: r.headers.get('content-type') ?? '' };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), put: (p, b) => req('PUT', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const key = () => ({ 'Idempotency-Key': randomUUID() });
const csvLines = (text) => text.replace(/^﻿/, '').split('\r\n').filter((l) => l.length);

let manager, cashier, cashier2, registrar, doctor, today, branches;
const S = {}; // shared state between the sequential tests
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  cashier = session(); await cashier.demo(M.cashier);     // Nodira: seed shift open in central
  cashier2 = session(); await cashier2.demo(M.cashier2);  // Jasur: seed shift open in Yunusobod
  registrar = session(); await registrar.demo(M.registrar);
  doctor = session(); await doctor.demo(M.doctor(0));
  const me = (await manager.get('/me')).body.data;
  today = me.today; branches = me.branches;
});
after(async () => { await app?.close(); });

/** The cashier whose seed shift is open in `branchId`. */
const cashierFor = (branchId) => (branches.find((b) => b.id === branchId).code === 'MRK' ? cashier : cashier2);

test('miqdor: muolaja × 3 → qator = narx × 3; laboratoriya uchun miqdor 1 dan ko‘p 422; 51 → 422; eski service_ids ishlaydi', async () => {
  // a visit of a new patient today: booked, checked in, started — the doctor orders from it
  const p = await registrar.post('/patients', { last_name: 'Miqdorov', first_name: 'Test', birth_date: '1985-03-03', sex: 'male', phone: '93 777 11 22' });
  assert.equal(p.status, 201, p.text); S.patientId = p.body.data.id;
  const svc = (await registrar.get('/services')).body.data;
  const c01 = svc.find((s) => s.code === 'C01');
  const avail = (await registrar.get(`/availability?doctor_id=${SEED_IDS.doctor(0)}&date=${today}&service_id=${c01.id}`)).body.data;
  const slot = avail.slots.find((s) => s.free && !s.past) ?? avail.slots.find((s) => s.free);
  assert.ok(slot, 'bo‘sh vaqt bor');
  S.branchId = avail.branch_id;
  const appt = await registrar.post('/appointments', { patient_id: S.patientId, branch_id: avail.branch_id, doctor_id: SEED_IDS.doctor(0), service_id: c01.id, date: today, start_time: slot.time }, key());
  assert.equal(appt.status, 201, appt.text);
  assert.equal((await registrar.post(`/appointments/${appt.body.data.id}/check-in`)).status, 200);
  const start = await doctor.post(`/appointments/${appt.body.data.id}/start`);
  assert.equal(start.status, 200, start.text);
  S.encId = start.body.data.encounter_id ?? start.body.data.id;
  const procs = svc.filter((s) => s.category === 'procedure' && s.active !== false);
  const labs = svc.filter((s) => s.category === 'lab' && s.active !== false);
  const [P, P2] = procs; const [L, L2] = labs;
  S.P = P; S.L = L;
  const bad = await doctor.post(`/encounters/${S.encId}/orders`, { items: [{ service_id: P.id, quantity: 51 }] });
  assert.equal(bad.status, 422, bad.text); assert.ok(bad.body.error.fields['items.0.quantity']);
  const labQty = await doctor.post(`/encounters/${S.encId}/orders`, { items: [{ service_id: L2.id, quantity: 2 }] });
  assert.equal(labQty.status, 422, labQty.text); assert.match(labQty.body.error.fields.items, /miqdor/);
  const ok = await doctor.post(`/encounters/${S.encId}/orders`, { items: [{ service_id: P.id, quantity: 3 }, { service_id: L.id }] });
  assert.equal(ok.status, 201, ok.text); assert.equal(ok.body.data.order_ids.length, 2);
  const legacy = await doctor.post(`/encounters/${S.encId}/orders`, { service_ids: [P2.id] });
  assert.equal(legacy.status, 201, legacy.text);
  assert.equal((await doctor.post(`/encounters/${S.encId}/orders`, {})).status, 422, 'bo‘sh buyurtma');
  const inv = (await manager.get(`/invoices?patient_id=${S.patientId}&page_size=5`)).body.data[0];
  S.invoiceId = inv.id;
  assert.ok(inv.services.includes(`${P.name} × 3`), 'ro‘yxatda «× 3»: ' + inv.services);
  const full = (await manager.get(`/invoices/${inv.id}`)).body.data;
  const pLine = full.items.find((it) => it.description === P.name), lLine = full.items.find((it) => it.description === L.name), p2Line = full.items.find((it) => it.description === P2.name);
  assert.equal(pLine.quantity, 3); assert.equal(Number(pLine.unit_price), P.price); assert.equal(Number(pLine.line_total), P.price * 3);
  assert.equal(lLine.quantity, 1); assert.equal(p2Line.quantity, 1);
  assert.equal(Number(full.total), P.price * 3 + L.price + P2.price + c01.price);
  const o = (await pool.query(`SELECT quantity, price_snapshot FROM service_orders WHERE id = $1`, [pLine.order_id])).rows[0];
  assert.equal(o.quantity, 3); assert.equal(Number(o.price_snapshot), P.price, 'buyurtmada birlik narxi');
  const enc = (await doctor.get(`/encounters/${S.encId}`)).body.data;
  assert.equal(enc.orders.find((x) => x.service_name === P.name).quantity, 3);
  S.pOrderId = pLine.order_id; S.lOrderId = lLine.order_id;
});

test('qator bo‘yicha qaytarish: faqat shu xizmat qiymati kamayadi; qoldiqdan ortig‘i 422; order_id siz — mutanosib; takror so‘rov bitta', async () => {
  const cash = cashierFor(S.branchId);
  const inv0 = (await manager.get(`/invoices/${S.invoiceId}`)).body.data;
  const pay = await cash.post(`/invoices/${S.invoiceId}/payments`, { amount: Number(inv0.due), method: 'card' }, key());
  assert.equal(pay.status, 201, pay.text);
  // performed today, so the reports count them
  await pool.query(`UPDATE service_orders SET status = 'completed', performed_at = demo_now() WHERE encounter_id = $1 OR appointment_id = (SELECT appointment_id FROM encounters WHERE id = $1)`, [S.encId]);
  const svcValue = async (name) => Number((await manager.get(`/reports/services?from=${today}&to=${today}`)).body.data.find((r) => r.service_name === name)?.value ?? 0);
  const pBefore = await svcValue(S.P.name), lBefore = await svcValue(S.L.name);
  assert.ok(pBefore >= S.P.price * 3);
  const payment = pay.body.data.payment;
  const base = { payment_id: payment.id, method: 'card', reason_code: 'service_not_provided', reason: 'Bir muolaja qilinmadi' };
  // more than what is left on the line
  const tooMuch = await manager.post(`/invoices/${S.invoiceId}/refunds`, { ...base, amount: S.P.price * 3 + 1, order_id: S.pOrderId }, key());
  assert.equal(tooMuch.status, 422, tooMuch.text); assert.match(tooMuch.body.error.fields.amount, /ko‘pi bilan/i);
  // a line of another invoice
  const foreign = (await pool.query(`SELECT order_id FROM invoice_items WHERE invoice_id <> $1 LIMIT 1`, [S.invoiceId])).rows[0];
  const wrong = await manager.post(`/invoices/${S.invoiceId}/refunds`, { ...base, amount: 1000, order_id: foreign.order_id }, key());
  assert.equal(wrong.status, 422); assert.ok(wrong.body.error.fields.order_id);
  // one unit of the procedure back — and the same request again with the same key
  const k = key();
  const r1 = await manager.post(`/invoices/${S.invoiceId}/refunds`, { ...base, amount: S.P.price, order_id: S.pOrderId }, k);
  assert.equal(r1.status, 201, r1.text); assert.equal(r1.body.data.refund.order_id, S.pOrderId);
  const r2 = await manager.post(`/invoices/${S.invoiceId}/refunds`, { ...base, amount: S.P.price, order_id: S.pOrderId }, k);
  assert.equal(r2.status, 200); assert.equal(r2.body.data.replayed, true);
  assert.equal((await manager.post(`/invoices/${S.invoiceId}/refunds`, { ...base, amount: S.P.price }, k)).status, 422, 'kalit: qator bilan/qatorsiz boshqa so‘rov');
  const it = (await pool.query(`SELECT refunded_amount, line_total FROM invoice_items WHERE order_id = $1`, [S.pOrderId])).rows[0];
  assert.equal(Number(it.refunded_amount), S.P.price);
  const inv1 = (await manager.get(`/invoices/${S.invoiceId}`)).body.data;
  assert.equal(Number(inv1.line_refunded_amount), S.P.price); assert.equal(Number(inv1.credit_amount), S.P.price);
  assert.equal(Number(inv1.items.find((x) => x.order_id === S.pOrderId).refundable), S.P.price * 2);
  assert.equal(inv1.refunds[0].service_name, S.P.name);
  assert.equal(await svcValue(S.P.name), pBefore - S.P.price, 'faqat muolaja qiymati kamaydi');
  assert.equal(await svcValue(S.L.name), lBefore, 'tahlil qiymati o‘zgarmadi');
  // now a proportional refund (no order_id): spread over what is left of every line
  const prop = 20_000_00;
  const r3 = await manager.post(`/invoices/${S.invoiceId}/refunds`, { ...base, amount: prop, reason: 'Umumiy chegirma o‘rnida' }, key());
  assert.equal(r3.status, 201, r3.text);
  const inv2 = (await manager.get(`/invoices/${S.invoiceId}`)).body.data;
  const S0 = Number(inv2.subtotal) - Number(inv2.discount_amount);
  const expectP = Math.round((S.P.price * 3 - S.P.price) * Number(inv2.total) / (S0 - S.P.price));
  const expectL = Math.round(S.L.price * Number(inv2.total) / (S0 - S.P.price));
  assert.equal(await svcValue(S.P.name) - (pBefore - S.P.price * 3), expectP, 'mutanosib: muolaja');
  assert.equal(await svcValue(S.L.name) - (lBefore - S.L.price), expectL, 'mutanosib: tahlil');
  const net = (await pool.query(`SELECT sum(${require('../dist/modules/billing.js').NET_LINE})::bigint AS s FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id WHERE i.id = $1`, [S.invoiceId])).rows[0];
  assert.ok(Math.abs(Number(net.s) - Number(inv2.total)) <= inv2.items.length, 'NET_LINE yig‘indisi hisob jamiga teng (yaxlitlash ±1 har qatorga)');
  await assert.rejects(pool.query(`UPDATE invoice_items SET refunded_amount = line_total + 1 WHERE order_id = $1`, [S.pOrderId]), /check/i, 'qaytarish qator jamidan oshmaydi (DB)');
});

test('depozit: kassir qabul qiladi (smena, kalit); hisobga «deposit» usuli — poygada bittasi; rahbar qoldiqni qaytaradi; roli yo‘qlar 403', async () => {
  // a seed debtor in central with a decent balance due
  const list = (await manager.get(`/invoices?debt=1&branch_id=${branches.find((b) => b.code === 'MRK').id}&page_size=50`)).body.data;
  const inv = list.find((i) => Number(i.due) >= 60_000_00); assert.ok(inv, 'qarzdor hisob bor');
  const pid = inv.patient_id;
  const shift0 = (await cashier.get('/cash-shifts/current')).body.data;
  assert.equal((await registrar.post(`/patients/${pid}/deposits`, { amount: 1000_00, method: 'cash' }, key())).status, 403);
  assert.equal((await cashier.post(`/patients/${pid}/deposits`, { amount: 1000_00, method: 'cash' })).status, 422, 'kalit majburiy');
  const half = Math.floor(Number(inv.due) / 2 / 100) * 100;
  const k = key();
  const d1 = await cashier.post(`/patients/${pid}/deposits`, { amount: half, method: 'cash', note: 'Kurs uchun oldindan' }, k);
  assert.equal(d1.status, 201, d1.text); assert.equal(d1.body.data.balance, half);
  const d2 = await cashier.post(`/patients/${pid}/deposits`, { amount: half, method: 'cash', note: 'Kurs uchun oldindan' }, k);
  assert.equal(d2.status, 200); assert.equal(d2.body.data.replayed, true);
  const shift1 = (await cashier.get('/cash-shifts/current')).body.data;
  assert.equal(shift1.expected_cash, shift0.expected_cash + half, 'naqd depozit kassaga tushdi');
  assert.equal(shift1.totals.deposit_in.cash.sum, half);
  assert.equal((await manager.get(`/patients/${pid}`)).body.data.deposit_balance, half);
  // the liability is scoped like every other summary figure: the deposit was taken in central, so Yunusobod shows none of it
  const yun = branches.find((b) => b.code === 'YUN').id, mrk = branches.find((b) => b.code === 'MRK').id;
  assert.equal((await manager.get(`/finance/summary?from=${today}&to=${today}&branch_id=${yun}`)).body.data.deposits.balance, 0, 'boshqa filial depozit balansini ko‘rmaydi');
  assert.equal((await manager.get(`/finance/summary?from=${today}&to=${today}&branch_id=${mrk}`)).body.data.deposits.balance, half);
  assert.equal((await manager.get(`/invoices/${inv.id}`)).body.data.deposit_balance, half);
  const lst = (await cashier.get(`/patients/${pid}/deposits`)).body;
  assert.equal(lst.data.length, 1); assert.equal(lst.meta.balance, half); assert.equal(lst.data[0].kind, 'in');
  // the race: two applications of the same balance — exactly one goes through
  const [a, b] = await Promise.all([
    cashier.post(`/invoices/${inv.id}/payments`, { amount: half, method: 'deposit' }, key()),
    cashier.post(`/invoices/${inv.id}/payments`, { amount: half, method: 'deposit' }, key()),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409], a.text + b.text);
  assert.equal((a.status === 409 ? a : b).body.error.code, 'INSUFFICIENT_DEPOSIT');
  const won = a.status === 201 ? a : b;
  assert.equal(won.body.data.payment.method, 'deposit'); assert.equal(won.body.data.payment.shift_id, null, 'depozitdan to‘lov smenaga bog‘lanmaydi');
  assert.equal((await cashier.get(`/patients/${pid}/deposits`)).body.meta.balance, 0);
  assert.equal((await cashier.get('/cash-shifts/current')).body.data.expected_cash, shift1.expected_cash, 'qo‘llashda naqd pul harakatlanmaydi');
  const after = (await manager.get(`/invoices/${inv.id}`)).body.data;
  assert.equal(Number(after.paid_amount), Number(inv.paid_amount) + half);
  // no balance left: a deposit payment is refused even without a race
  const none = await cashier.post(`/invoices/${inv.id}/payments`, { amount: 1000_00, method: 'deposit' }, key());
  assert.equal(none.status, 409); assert.equal(none.body.error.code, 'INSUFFICIENT_DEPOSIT');
  // unused money back: manager only, cash from an open drawer
  const d3 = await cashier.post(`/patients/${pid}/deposits`, { amount: 50_000_00, method: 'card' }, key());
  assert.equal(d3.status, 201, d3.text);
  assert.equal((await cashier.post(`/patients/${pid}/deposits/refund`, { amount: 50_000_00, method: 'cash', note: 'Bemor so‘radi', shift_id: shift1.id }, key())).status, 403);
  const over = await manager.post(`/patients/${pid}/deposits/refund`, { amount: 50_000_01, method: 'cash', note: 'Bemor so‘radi', shift_id: shift1.id }, key());
  assert.equal(over.status, 409); assert.equal(over.body.error.code, 'INSUFFICIENT_DEPOSIT');
  const cashBefore = (await cashier.get('/cash-shifts/current')).body.data.expected_cash;
  const out = await manager.post(`/patients/${pid}/deposits/refund`, { amount: 50_000_00, method: 'cash', note: 'Bemor so‘radi', shift_id: shift1.id }, key());
  assert.equal(out.status, 201, out.text); assert.equal(out.body.data.balance, 0);
  assert.equal((await cashier.get('/cash-shifts/current')).body.data.expected_cash, cashBefore - 50_000_00, 'qaytarilgan depozit kassadan chiqdi');
  await assert.rejects(pool.query(`UPDATE patient_deposits SET amount = 1 WHERE id = $1`, [out.body.data.deposit.id]), /append-only/);
  await assert.rejects(pool.query(`INSERT INTO patient_deposits (tenant_id, branch_id, patient_id, kind, amount, method, actor_name) VALUES ($1,$2,$3,'out',1,'card','x')`, [SEED_IDS.tenant, inv.branch_id, pid]), /negative/, 'trigger: balans manfiy bo‘lmaydi');
  // finance: deposits are a liability, revenue counts the applied amount as a payment
  const s = (await manager.get(`/finance/summary?from=${today}&to=${today}`)).body.data;
  assert.equal(s.deposits.in, half + 50_000_00); assert.equal(s.deposits.out, 50_000_00); assert.equal(s.deposits.applied, half);
  assert.equal(s.payments.by_method.deposit, half);
  const pays = Number((await pool.query(`SELECT coalesce(sum(amount),0) AS s FROM payments WHERE tenant_id = $1 AND (paid_at AT TIME ZONE 'Asia/Tashkent')::date = (demo_now() AT TIME ZONE 'Asia/Tashkent')::date`, [SEED_IDS.tenant])).rows[0].s);
  assert.equal(s.payments.total, pays, 'depozit kirimi tushumga qo‘shilmaydi, qo‘llangani to‘lov sifatida hisoblanadi');
  assert.equal((await manager.get('/dashboard?period=today')).body.data.kpi.revenue, s.net_revenue);
  // closing the drawer still reconciles with the deposit movements in it
  const cur = (await cashier.get('/cash-shifts/current')).body.data;
  assert.equal(cur.expected_cash, cur.opening_cash + cur.totals.payments.cash.sum + cur.totals.deposit_in.cash.sum - cur.totals.refunds.cash.sum - cur.totals.cash_expenses.sum - cur.totals.deposit_out.cash.sum);
  const detail = (await cashier.get(`/cash-shifts/${cur.id}`)).body.data;
  assert.equal(detail.deposits.length, 3, 'naqd kirim, karta kirim, naqd qaytarish');
});

test('qarzdorlar: yoshi bo‘yicha guruhlar yig‘indisi jami qarzga teng; filtr; va’da sanasi (o‘tgan kun 422, qarzsiz hisob 409)', async () => {
  const r = (await manager.get('/invoices?debt=1&page_size=5')).body;
  const a = r.meta.ageing;
  assert.ok(a['0-7'] && a['8-30'] && a['31+']);
  assert.equal(a['0-7'].sum + a['8-30'].sum + a['31+'].sum, r.meta.sums.due);
  assert.equal(a['0-7'].n + a['8-30'].n + a['31+'].n, r.meta.total);
  assert.ok(r.data.every((i) => typeof i.age_days === 'number'));
  const old = (await manager.get('/invoices?debt=1&age=31%2B&page_size=50')).body;
  assert.equal(old.meta.total, a['31+'].n); assert.ok(old.data.every((i) => i.age_days >= 31));
  const fresh = (await manager.get('/invoices?debt=1&age=0-7&page_size=50')).body;
  assert.ok(fresh.data.every((i) => i.age_days <= 7));
  const inv = fresh.data[0] ?? r.data[0];
  const date = new Date(Date.parse(today) + 3 * 86400_000).toISOString().slice(0, 10);
  assert.equal((await registrar.post(`/invoices/${inv.id}/promise`, { promise_date: date })).status, 403);
  const past = await cashier.post(`/invoices/${inv.id}/promise`, { promise_date: '2026-01-01' });
  assert.equal(past.status, 422); assert.ok(past.body.error.fields.promise_date);
  const ok = await cashier.post(`/invoices/${inv.id}/promise`, { promise_date: date, note: 'Shanba kuni to‘laydi' });
  assert.equal(ok.status, 200, ok.text);
  const row = (await manager.get(`/invoices?debt=1&search=${inv.invoice_number}`)).body.data.find((i) => i.id === inv.id);
  assert.equal(String(row.promise_date).slice(0, 10), date); assert.equal(row.promise_note, 'Shanba kuni to‘laydi');
  assert.equal((await manager.post(`/invoices/${inv.id}/promise`, { promise_date: null })).status, 200, 'va’da olib tashlanadi');
  const paid = (await manager.get('/invoices?status=paid&page_size=1')).body.data[0];
  const notDebt = await manager.post(`/invoices/${paid.id}/promise`, { promise_date: date });
  assert.equal(notDebt.status, 409); assert.equal(notDebt.body.error.code, 'NOT_A_DEBT');
  S.debtCount = r.meta.total;
});

test('eksport: qaytarish, xarajat, smena, shifokor ulushi, qarzdorlar — sarlavha, qatorlar soni, jami, 1 yil chegarasi, formula himoyasi', async () => {
  const period = `from=${today}&to=${today}`;
  // an expense whose note would be a formula in a spreadsheet
  const e = await manager.post('/expenses', { branch_id: S.branchId, category: 'Boshqa', amount: 1000_00, paid_from: 'bank', note: '=HYPERLINK("x")' });
  assert.equal(e.status, 201, e.text);
  const checks = [
    ['/refunds/export.csv', 13, async () => (await manager.get(`/refunds?${period}&page_size=1`)).body.meta.count],
    ['/expenses/export.csv', 10, async () => (await manager.get(`/expenses?${period}&page_size=1`)).body.meta.count],
    ['/cash-shifts/export.csv', 18, async () => (await manager.get(`/cash-shifts?${period}`)).body.data.length],
    ['/reports/doctors/export.csv', 5, async () => (await manager.get(`/reports/doctors?${period}`)).body.data.length],
  ];
  for (const [path, cols, count] of checks) {
    assert.equal((await manager.get(path)).status, 422, `${path}: davr majburiy`);
    assert.equal((await manager.get(`${path}?from=2024-01-01&to=${today}`)).status, 422, `${path}: 1 yildan oshmasin`);
    const r = await manager.get(`${path}?${period}`);
    assert.equal(r.status, 200, `${path}: ${r.text}`); assert.match(r.type, /text\/csv/);
    const lines = csvLines(r.text);
    assert.equal(lines[0].split(';').length, cols, `${path}: ustunlar`);
    assert.equal(lines.length, 1 + (await count()) + 1, `${path}: sarlavha + qatorlar + jami`);
    assert.match(lines[lines.length - 1], /^"Jami/);
    assert.ok(lines.every((l) => l.split(';').length === cols), `${path}: har qator ${cols} ustun`);
    assert.match(lines[0], /Toshkent|Shifokor/);
  }
  const ex = csvLines((await manager.get(`/expenses/export.csv?${period}`)).text);
  assert.ok(ex.some((l) => l.includes(`"'=HYPERLINK(""x"")"`)), 'formula apostrof bilan neytrallanadi');
  const dbt = await manager.get('/invoices/debtors.csv');
  assert.equal(dbt.status, 200); assert.match(dbt.type, /text\/csv/);
  const dl = csvLines(dbt.text);
  assert.equal(dl.length, 1 + S.debtCount + 1); assert.equal(dl[0].split(';').length, 13);
  assert.equal((await cashier.get('/invoices/debtors.csv')).status, 200, 'kassir ham yuklaydi');
  assert.equal((await registrar.get('/invoices/debtors.csv')).status, 403);
  assert.equal((await doctor.get(`/reports/doctors/export.csv?${period}`)).status, 403);
  assert.equal((await cashier.get(`/refunds/export.csv?${period}`)).status, 403);
  // a cashier's shifts export holds only their own shifts
  const own = csvLines((await cashier.get(`/cash-shifts/export.csv?${period}`)).text);
  assert.ok(own.slice(1, -1).every((l) => l.includes('Nodira Aliyeva')));
});

test('ro‘yxat chegaralari: xarajat va qaytarish sahifalanadi; ombor harakatlari 100 tagacha + alohida sahifali ro‘yxat', async () => {
  const ex = (await manager.get(`/expenses?from=${today}&to=${today}&page_size=1`)).body;
  assert.equal(ex.data.length, 1); assert.ok(ex.meta.count >= 1); assert.equal(ex.meta.page_size, 1); assert.equal(typeof ex.meta.total, 'number');
  const ex2 = (await manager.get(`/expenses?from=${today}&to=${today}&page_size=1&page=2`)).body;
  assert.ok(!ex2.data.length || ex2.data[0].id !== ex.data[0].id);
  const rf = (await manager.get(`/refunds?from=${today}&to=${today}&page_size=1`)).body;
  assert.equal(rf.data.length, 1); assert.ok(rf.meta.count >= 2); assert.equal(rf.meta.total, Number((await pool.query(`SELECT sum(amount) AS s FROM refunds WHERE tenant_id = $1`, [SEED_IDS.tenant])).rows[0].s));
  const item = (await manager.get('/inventory')).body.data[0];
  const one = (await manager.get(`/inventory/${item.id}`)).body.data;
  assert.ok(one.movements.length <= 100); assert.equal(typeof one.movements_total, 'number'); assert.ok(one.movements_total >= one.movements.length);
  const mv = (await manager.get(`/inventory/${item.id}/movements?page_size=1`)).body;
  assert.ok(mv.data.length <= 1); assert.equal(mv.meta.total, one.movements_total);
  assert.equal((await cashier.get(`/inventory/${item.id}/movements`)).status, 403);
});
