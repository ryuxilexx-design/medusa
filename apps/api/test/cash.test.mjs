// Cash desk: shift lifecycle and reconciliation, payment ↔ shift rules and the close race, refunds (rules,
// idempotency, invoice effect), expenses (drawer/bank, void, immutability), finance summary = dashboard.
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
    return { status: r.status, body: j, text: t };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const key = () => ({ 'Idempotency-Key': randomUUID() });

let manager, cashier, cashier2, central, yunusobod;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  cashier = session(); await cashier.demo(M.cashier);     // Nodira: central + Yunusobod, seed shift open in central
  cashier2 = session(); await cashier2.demo(M.cashier2);  // Jasur: Yunusobod, seed shift open there
  const branches = (await manager.get('/me')).body.data.branches;
  central = branches.find((b) => b.code === 'MRK').id; yunusobod = branches.find((b) => b.code === 'YUN').id;
});
after(async () => { await app?.close(); });

/** An unpaid invoice in a branch with at least `min` due (tiyin). */
async function unpaid(branch, min = 1) {
  const list = (await manager.get(`/invoices?status=unpaid&branch_id=${branch}&page_size=50`)).body.data;
  const inv = list.find((i) => Number(i.due) >= min && Number(i.total) > 0);
  assert.ok(inv, 'to‘lanmagan hisob bor');
  return inv;
}

test('smena: seed’da ochiq; to‘lov smenaga yoziladi; yopish — kutilgan = boshlang‘ich + naqd; yopilgach to‘lov yo‘q; yangi smena', async () => {
  const cur = (await cashier.get('/cash-shifts/current')).body.data;
  assert.ok(cur && cur.status === 'open'); assert.equal(cur.branch_id, central);
  assert.equal(cur.expected_cash, cur.opening_cash + cur.totals.payments.cash.sum - cur.totals.cash_out);
  const inv = await unpaid(central, 50_000_00);
  const r = await cashier.post(`/invoices/${inv.id}/payments`, { amount: 50_000_00, method: 'cash' }, key());
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.data.payment.shift_id, cur.id);
  const after = (await cashier.get('/cash-shifts/current')).body.data;
  assert.equal(after.expected_cash, cur.expected_cash + 50_000_00);
  // close with the exact count
  const close = await cashier.post(`/cash-shifts/${cur.id}/close`, { counted_cash: after.expected_cash });
  assert.equal(close.status, 200, close.text); assert.equal(close.body.data.difference, 0);
  assert.equal((await cashier.get('/cash-shifts/current')).body.data, null);
  const blocked = await cashier.post(`/invoices/${(await unpaid(central)).id}/payments`, { amount: 1000_00, method: 'cash' }, key());
  assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'SHIFT_REQUIRED');
  await assert.rejects(pool.query(`UPDATE cash_shifts SET counted_cash = 0 WHERE id = $1`, [cur.id]), /immutable/, 'yopilgan smena bazada ham o‘zgarmaydi');
  // a new shift, opened twice at once: exactly one wins
  const [a, b] = await Promise.all([cashier.post('/cash-shifts', { branch_id: central, opening_cash: 0 }), cashier.post('/cash-shifts', { branch_id: central, opening_cash: 0 })]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const ok = await cashier.post(`/invoices/${(await unpaid(central)).id}/payments`, { amount: 1000_00, method: 'card' }, key());
  assert.equal(ok.status, 201, ok.text);
});

test('smena: farq bo‘lsa izoh majburiy; boshqa filialdagi smena bilan to‘lov olinmaydi; boshqa kassir smenasi ko‘rinmaydi', async () => {
  const cur = (await cashier.get('/cash-shifts/current')).body.data;
  // a surplus (the drawer may hold no cash yet, so test the "more than expected" side)
  let r = await cashier.post(`/cash-shifts/${cur.id}/close`, { counted_cash: cur.expected_cash + 5_000_00 });
  assert.equal(r.status, 422, r.text); assert.match(r.body.error.fields.note, /Farq \+/);
  r = await cashier.post(`/cash-shifts/${cur.id}/close`, { counted_cash: cur.expected_cash + 5_000_00, note: 'Qaytim berilmay qolgan' });
  assert.equal(r.status, 200); assert.equal(r.body.data.difference, 5_000_00);
  // Nodira opens her drawer in Yunusobod, then tries to take money for a central invoice
  assert.equal((await cashier.post('/cash-shifts', { branch_id: yunusobod, opening_cash: 100_000_00 })).status, 201);
  const other = await cashier.post(`/invoices/${(await unpaid(central)).id}/payments`, { amount: 1000_00, method: 'cash' }, key());
  assert.equal(other.status, 409); assert.equal(other.body.error.code, 'SHIFT_OTHER_BRANCH');
  const jasur = (await cashier2.get('/cash-shifts/current')).body.data;
  assert.equal((await cashier.get(`/cash-shifts/${jasur.id}`)).status, 403, 'boshqa kassirning smenasi');
  assert.equal((await cashier.post(`/cash-shifts/${jasur.id}/close`, { counted_cash: 0, note: 'x' })).status, 403);
  assert.ok((await cashier.get('/cash-shifts')).body.data.every((s) => s.cashier_name === 'Nodira Aliyeva'), 'kassir faqat o‘z smenalarini ko‘radi');
  assert.ok((await manager.get('/cash-shifts?status=open')).body.data.length >= 2, 'rahbar barchasini ko‘radi');
});

test('poyga: smena yopilayotganda to‘lov — yoki smenaga kiradi, yoki rad etiladi; hisob doim mos', async () => {
  const sh = (await cashier2.get('/cash-shifts/current')).body.data; // Jasur, Yunusobod
  const inv = await unpaid(yunusobod, 20_000_00);
  const [pay, close] = await Promise.all([
    cashier2.post(`/invoices/${inv.id}/payments`, { amount: 20_000_00, method: 'cash' }, key()),
    (async () => { const cur = (await cashier2.get('/cash-shifts/current')).body.data; return cashier2.post(`/cash-shifts/${sh.id}/close`, { counted_cash: cur.expected_cash, note: 'poyga sinovi' }); })(),
  ]);
  assert.equal(close.status, 200, close.text);
  assert.ok([201, 409].includes(pay.status), pay.text);
  const s = (await pool.query(`SELECT * FROM cash_shifts WHERE id = $1`, [sh.id])).rows[0];
  const inShift = Number((await pool.query(`SELECT coalesce(sum(amount),0)::bigint AS s FROM payments WHERE shift_id = $1 AND method = 'cash'`, [sh.id])).rows[0].s);
  assert.equal(s.totals.payments.cash.sum, inShift, 'yopilgan smena hisobi bazadagi to‘lovlarga teng');
  if (pay.status === 409) assert.equal(pay.body.error.code, 'SHIFT_REQUIRED');
  assert.equal((await cashier2.post('/cash-shifts', { branch_id: yunusobod, opening_cash: 0 })).status, 201);
});

test('qaytarish: faqat rahbar; naqd — ochiq smenadan; hisob kamayadi, qarz paydo bo‘lmaydi; ortig‘i 422; takror so‘rov bitta', async () => {
  const shift = (await cashier.get('/cash-shifts/current')).body.data; // Nodira, Yunusobod (opened above)
  const inv = await unpaid(yunusobod, 30_000_00);
  const paid = await cashier.post(`/invoices/${inv.id}/payments`, { amount: Number(inv.due), method: 'cash' }, key());
  assert.equal(paid.status, 201, paid.text);
  const payment = paid.body.data.payment;
  const part = 10_000_00;
  assert.equal((await cashier.post(`/invoices/${inv.id}/refunds`, { payment_id: payment.id, amount: part, method: 'cash', reason_code: 'service_not_provided', reason: 'Tahlil qilinmadi', shift_id: shift.id }, key())).status, 403, 'kassir qaytarmaydi');
  const noShift = await manager.post(`/invoices/${inv.id}/refunds`, { payment_id: payment.id, amount: part, method: 'cash', reason_code: 'service_not_provided', reason: 'Tahlil qilinmadi' }, key());
  assert.equal(noShift.status, 422); assert.ok(noShift.body.error.fields.shift_id);
  const k = key();
  const body = { payment_id: payment.id, amount: part, method: 'cash', reason_code: 'service_not_provided', reason: 'Tahlil qilinmadi', shift_id: shift.id };
  const r1 = await manager.post(`/invoices/${inv.id}/refunds`, body, k);
  assert.equal(r1.status, 201, r1.text);
  const r2 = await manager.post(`/invoices/${inv.id}/refunds`, body, k);
  assert.equal(r2.status, 200); assert.equal(r2.body.data.replayed, true);
  assert.equal((await manager.post(`/invoices/${inv.id}/refunds`, { ...body, amount: part + 1 }, k)).status, 422, 'kalit boshqa so‘rovda');
  let d = (await manager.get(`/invoices/${inv.id}`)).body.data;
  assert.equal(Number(d.total), Number(inv.total) - part); assert.equal(Number(d.paid_amount), Number(inv.total) - part);
  assert.equal(Number(d.due), 0, 'qarz paydo bo‘lmadi'); assert.equal(d.status, 'paid'); assert.equal(Number(d.refunded_amount), part);
  assert.equal(d.refunds.length, 1);
  assert.equal(Number(d.payments[0].refundable), Number(payment.amount) - part);
  const too = await manager.post(`/invoices/${inv.id}/refunds`, { ...body, amount: Number(payment.amount) }, key());
  assert.equal(too.status, 422); assert.match(too.body.error.fields.amount, /Ko‘pi bilan/);
  // the rest by card: no drawer involved → invoice fully refunded
  const rest = await manager.post(`/invoices/${inv.id}/refunds`, { payment_id: payment.id, amount: Number(payment.amount) - part, method: 'card', reason_code: 'appointment_cancelled', reason: 'Qabul bekor qilindi' }, key());
  assert.equal(rest.status, 201, rest.text); assert.equal(rest.body.data.refund.shift_id, null);
  d = (await manager.get(`/invoices/${inv.id}`)).body.data;
  assert.equal(d.status, 'refunded'); assert.equal(Number(d.total), 0); assert.equal(Number(d.paid_amount), 0);
  const s = (await cashier.get('/cash-shifts/current')).body.data;
  assert.equal(s.totals.refunds.cash.sum, part); assert.equal(s.totals.refunds.card.sum, 0, 'karta qaytarishi smenaga bog‘lanmaydi');
  assert.equal(s.expected_cash, s.opening_cash + s.totals.payments.cash.sum - part - s.totals.cash_expenses.sum);
  await assert.rejects(pool.query(`UPDATE refunds SET amount = 1 WHERE id = $1`, [r1.body.data.refund.id]), /append-only/);
  const a = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'refund.create' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.match(a.summary, /Qabul bekor qilindi/);
});

test('xarajat: kassir faqat o‘z kassasidan; rahbar bankdan o‘tgan sana bilan; bekor qilish sabab bilan; yopilgan smenadagi xarajat qoladi', async () => {
  const before = (await cashier.get('/cash-shifts/current')).body.data;
  const e1 = await cashier.post('/expenses', { category: 'Xo‘jalik', amount: 45_000_00, note: 'Suv va salfetka', paid_from: 'bank' });
  assert.equal(e1.status, 201, e1.text);
  const row = (await pool.query(`SELECT paid_from, shift_id, branch_id FROM expenses WHERE id = $1`, [e1.body.data.id])).rows[0];
  assert.equal(row.paid_from, 'cash_drawer', 'kassir uchun doim kassadan'); assert.equal(row.shift_id, before.id); assert.equal(row.branch_id, before.branch_id);
  const mid = (await cashier.get('/cash-shifts/current')).body.data;
  assert.equal(mid.expected_cash, before.expected_cash - 45_000_00);
  const today = (await manager.get('/me')).body.data.today;
  const past = new Date(Date.parse(today) - 3 * 86400_000).toISOString().slice(0, 10);
  const e2 = await manager.post('/expenses', { branch_id: central, category: 'Ijara', amount: 1_000_000_00, occurred_on: past, paid_from: 'bank', note: 'Noyabr ijarasi oldindan' });
  assert.equal(e2.status, 201, e2.text);
  const future = new Date(Date.parse(today) + 86400_000).toISOString().slice(0, 10);
  assert.equal((await manager.post('/expenses', { branch_id: central, category: 'Ijara', amount: 1, occurred_on: future })).status, 422);
  assert.equal((await manager.post('/expenses', { branch_id: central, category: 'Noma’lum', amount: 1 })).status, 422);
  assert.equal((await manager.post('/expenses', { branch_id: central, category: 'Boshqa', amount: 1, paid_from: 'cash_drawer' })).status, 422, 'kassadan — smena tanlanishi shart');
  assert.equal((await cashier.post(`/expenses/${e1.body.data.id}/void`, { reason: 'xato' })).status, 403);
  assert.equal((await manager.post(`/expenses/${e1.body.data.id}/void`, { reason: 'Ikki marta kiritilgan' })).status, 200);
  assert.equal((await cashier.get('/cash-shifts/current')).body.data.expected_cash, before.expected_cash, 'bekor qilingan xarajat kassaga qaytdi');
  await assert.rejects(pool.query(`UPDATE expenses SET amount = 1 WHERE id = $1`, [e2.body.data.id]), /immutable/);
  // an expense in a closed shift cannot be voided
  const e3 = (await cashier.post('/expenses', { category: 'Boshqa', amount: 10_000_00, note: 'Taksi' })).body.data;
  const cur = (await cashier.get('/cash-shifts/current')).body.data;
  assert.equal((await cashier.post(`/cash-shifts/${cur.id}/close`, { counted_cash: cur.expected_cash })).status, 200);
  const late = await manager.post(`/expenses/${e3.id}/void`, { reason: 'kech' });
  assert.equal(late.status, 409); assert.equal(late.body.error.code, 'SHIFT_CLOSED');
  const list = (await manager.get(`/expenses?from=${past}&to=${today}`)).body;
  const voided = list.data.find((x) => x.id === e1.body.data.id);
  assert.equal(voided.status, 'void'); assert.equal(voided.void_reason, 'Ikki marta kiritilgan'); assert.equal(voided.paid_from, 'cash_drawer');
  assert.ok(!list.data.filter((x) => x.status === 'active').some((x) => x.id === e1.body.data.id));
  assert.equal(list.meta.total, list.data.filter((x) => x.status === 'active').reduce((a, b) => a + Number(b.amount), 0), 'jami faqat faol xarajatlar');
});

test('moliya xulosasi: to‘lov − qaytarish − xarajat; dashboard tushumi xulosadagi sof tushumga teng', async () => {
  const today = (await manager.get('/me')).body.data.today;
  const s = (await manager.get(`/finance/summary?from=${today}&to=${today}`)).body.data;
  const sql = async (q) => Number((await pool.query(q, [SEED_IDS.tenant])).rows[0].s);
  const dayStart = `(demo_now() AT TIME ZONE 'Asia/Tashkent')::date`;
  const pays = await sql(`SELECT coalesce(sum(amount),0) AS s FROM payments WHERE tenant_id = $1 AND (paid_at AT TIME ZONE 'Asia/Tashkent')::date = ${dayStart}`);
  const refs = await sql(`SELECT coalesce(sum(amount),0) AS s FROM refunds WHERE tenant_id = $1 AND (refunded_at AT TIME ZONE 'Asia/Tashkent')::date = ${dayStart}`);
  const exps = await sql(`SELECT coalesce(sum(amount),0) AS s FROM expenses WHERE tenant_id = $1 AND status = 'active' AND (occurred_at AT TIME ZONE 'Asia/Tashkent')::date = ${dayStart}`);
  assert.equal(s.payments.total, pays); assert.equal(s.refunds.total, refs); assert.equal(s.expenses.total, exps);
  assert.ok(refs > 0, 'bugun qaytarish bo‘lgan');
  assert.equal(s.net_revenue, pays - refs); assert.equal(s.net_result, pays - refs - exps);
  const dash = (await manager.get('/dashboard?period=today')).body.data;
  assert.equal(dash.kpi.revenue, s.net_revenue); assert.equal(dash.kpi.refunds, refs);
  assert.equal((await cashier.get(`/finance/summary?from=${today}&to=${today}`)).status, 403);
});
