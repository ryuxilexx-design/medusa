// Discount rules, benefit categories and the discounts report (migration 043, docs/DISCOUNTS_COMPANIES.md).
// Seed KPIs unchanged; role sweep (403) and tenant isolation (404/422); staff limit vs manager approval; per-line
// snapshot frozen after a payment (409 + DB trigger); NET_LINE / doctor share / partner share on the discounted net with
// line and proportional refunds; invoiceStatus; the report (every grouping sums the same lines) and its CSV.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool, billing;

function session() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t, type: r.headers.get('content-type') ?? '' };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), patch: (p, b) => req('PATCH', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const key = () => ({ 'Idempotency-Key': randomUUID() });
const csvLines = (text) => text.replace(/^﻿/, '').split('\r\n').filter((l) => l.length);
const sql = async (q, p = []) => (await pool.query(q, p)).rows;

let manager, registrar, cashier, doctor, lab, storekeeper, guard, t2manager, today;
const S = {};
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  billing = require('../dist/modules/billing.js');
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  registrar = session(); await registrar.demo(M.registrar);
  cashier = session(); await cashier.demo(M.cashier);
  doctor = session(); await doctor.demo(M.doctor(0));
  lab = session(); await lab.demo(M.lab);
  storekeeper = session(); await storekeeper.demo(M.storekeeper);
  guard = session(); await guard.demo(M.guard);
  t2manager = session(); await t2manager.demo(M.tenant2Manager);
  today = (await manager.get('/me')).body.data.today;
});
after(async () => { await app?.close(); });

/**
 * A new open bill on a past visit in the central branch (the real createBilledOrder path): one order per [code, qty],
 * performed now, so it counts in today's service and doctor reports. Each call takes another visit.
 */
let visitN = 0;
async function newBill(lines) {
  const [a] = await sql(`SELECT a.id, a.patient_id, a.doctor_id, a.branch_id FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.tenant_id = $1 AND a.branch_id = $2 AND a.status = 'completed' AND a.referral_partner_id IS NULL AND p.benefit_category_id IS NULL AND p.company_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.appointment_id = a.id AND i.status = 'unpaid' AND i.paid_amount = 0)
    ORDER BY a.starts_at DESC, a.id OFFSET $3 LIMIT 1`, [SEED_IDS.tenant, SEED_IDS.branchCentral, visitN++]);
  const ctx = { tenantId: SEED_IDS.tenant, membershipId: M.registrar };
  const svc = await sql(`SELECT id, code, category FROM services WHERE tenant_id = $1`, [SEED_IDS.tenant]);
  let invoiceId; const orders = [];
  for (const [code, qty] of lines) {
    const r = await billing.createBilledOrder(pool, ctx, { branchId: a.branch_id, patientId: a.patient_id, appointmentId: a.id, encounterId: null, serviceId: svc.find((s) => s.code === code).id,
      isPrimary: false, doctorId: a.doctor_id, performerDoctorId: a.doctor_id, quantity: qty });
    invoiceId = r.invoiceId; orders.push(r.orderId);
  }
  await sql(`UPDATE service_orders SET status = 'completed', performed_at = demo_now() WHERE id = ANY($1::uuid[])`, [orders]);
  return { invoiceId, orders, patientId: a.patient_id, doctorId: a.doctor_id };
}
const rule = async (name) => (await sql(`SELECT * FROM discount_rules WHERE tenant_id = $1 AND name = $2`, [SEED_IDS.tenant, name]))[0];
const inv = async (id) => (await manager.get(`/invoices/${id}`)).body.data;

test('seed: 5 qoida, 4 toifa, 3 kompaniya, chegirmali va kompaniyali hisoblar; bugungi KPI va bemor qarzi o‘zgarmagan', async () => {
  assert.equal((await manager.get('/discount-rules?all=1')).body.data.length, 5);
  assert.equal((await manager.get('/benefit-categories?all=1')).body.data.length, 4);
  assert.equal((await manager.get('/companies?all=1')).body.meta.total, 3);
  const [x] = await sql(`SELECT count(*) FILTER (WHERE discount_rule_id IS NOT NULL)::int AS rules, count(*) FILTER (WHERE company_id IS NOT NULL)::int AS comp FROM invoices WHERE tenant_id = $1`, [SEED_IDS.tenant]);
  assert.ok(x.rules >= 10 && x.comp >= 10, JSON.stringify(x));
  // the seed's «today» and the patient debt did not move: 28 bookings, 2 510 000 so‘m in 12 payments, debt 6 315 000 so‘m on 46 bills
  const k = (await manager.get('/dashboard?period=today')).body.data.kpi;
  assert.deepEqual([k.appointments, k.revenue, k.payments, k.debt, k.debt_invoices], [28, 251_000_000, 12, 631_500_000, 46]);
  // the companies' unpaid parts are their receivable, never patient debt
  const [r] = await sql(`SELECT coalesce(sum(company_share_amount - company_paid_amount),0)::bigint AS s FROM invoices WHERE tenant_id = $1 AND status <> 'void'`, [SEED_IDS.tenant]);
  assert.ok(Number(r.s) > 0); assert.equal(k.company_receivable, Number(r.s));
  // every invariant of a split bill
  const bad = await sql(`SELECT invoice_number FROM invoices WHERE tenant_id = $1 AND (company_share_amount > total OR company_paid_amount > company_share_amount OR paid_amount > total
      OR total - company_share_amount - (paid_amount - company_paid_amount) < 0)`, [SEED_IDS.tenant]);
  assert.deepEqual(bad, []);
  // a voided company transfer is reversed (refund rows of its reason), its money nets to zero
  const [v] = await sql(`SELECT cp.amount, (SELECT sum(r.amount) FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.company_payment_id = cp.id AND r.reason_code = 'company_payment_void')::bigint AS back
    FROM company_payments cp WHERE cp.tenant_id = $1 AND cp.status = 'void'`, [SEED_IDS.tenant]);
  assert.equal(Number(v.back), Number(v.amount));
});

test('rollar: shifokor, laborant, omborchi, qorovul — 403; registrator va kassir faqat tanlaydi va limit ichida qo‘llaydi', async () => {
  const r = await rule('Pensionerlar 10 %');
  const cat = (await manager.get('/benefit-categories')).body.data[0];
  const invoiceId = (await sql(`SELECT id FROM invoices WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant]))[0].id;
  const body = { name: 'Rol test', kind: 'percent', percent: 5, staff_max_percent: 5 };
  const routes = [['GET', '/discount-rules'], ['POST', '/discount-rules', body], ['PATCH', `/discount-rules/${r.id}`, body], ['GET', '/benefit-categories'],
    ['POST', '/benefit-categories', { name: 'Rol' }], ['PATCH', `/benefit-categories/${cat.id}`, { name: 'Rol' }], ['POST', `/invoices/${invoiceId}/apply-discount`, { rule_id: null }],
    ['GET', `/reports/discounts?from=${today}&to=${today}`], ['GET', `/reports/discounts/export.csv?from=${today}&to=${today}`]];
  const call = (s, [m, p, b]) => (m === 'GET' ? s.get(p) : m === 'POST' ? s.post(p, b, key()) : s.patch(p, b));
  for (const [name, s] of [['doctor', doctor], ['lab', lab], ['storekeeper', storekeeper], ['guard', guard]])
    for (const x of routes) assert.equal((await call(s, x)).status, 403, `${name} ${x[0]} ${x[1]}`);
  const staffAllowed = new Set(['GET /discount-rules', 'GET /benefit-categories', `POST /invoices/${invoiceId}/apply-discount`]);
  for (const [name, s] of [['registrar', registrar], ['cashier', cashier]])
    for (const x of routes) if (!staffAllowed.has(`${x[0]} ${x[1]}`)) assert.equal((await call(s, x)).status, 403, `${name} ${x[0]} ${x[1]}`);
  // the picker lists only rules usable today; the staff limit is shown as a hint
  const list = (await cashier.get('/discount-rules')).body.data;
  assert.ok(list.length === 5 && list.every((x) => x.active));
  // a doctor never sees the payer fields of a card
  const [p] = await sql(`SELECT a.patient_id FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.doctor_id = $1 AND p.benefit_category_id IS NOT NULL LIMIT 1`, [SEED_IDS.doctor(0)]);
  if (p) {
    const card = (await doctor.get(`/patients/${p.patient_id}`)).body.data;
    assert.ok(!('benefit_category_id' in card) && !('company_name' in card), 'shifokor imtiyoz/kompaniyani ko‘rmaydi');
    assert.ok('benefit_category_name' in (await registrar.get(`/patients/${p.patient_id}`)).body.data);
  }
});

test('tenant izolyatsiyasi: boshqa klinikaning qoidasi, toifasi, hisobi — 404/422', async () => {
  const r = await rule('Pensionerlar 10 %');
  const cat = (await manager.get('/benefit-categories')).body.data[0];
  assert.equal((await t2manager.get('/discount-rules?all=1')).body.data.length, 0);
  assert.equal((await t2manager.patch(`/discount-rules/${r.id}`, { name: 'Begona', kind: 'percent', percent: 5, staff_max_percent: 5 })).status, 404);
  assert.equal((await t2manager.patch(`/benefit-categories/${cat.id}`, { name: 'Begona' })).status, 404);
  const invoiceId = (await sql(`SELECT id FROM invoices WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant]))[0].id;
  assert.equal((await t2manager.post(`/invoices/${invoiceId}/apply-discount`, { rule_id: null })).status, 404);
  // a rule of another clinic cannot be put on a category
  assert.equal((await t2manager.post('/benefit-categories', { name: 'Begona', discount_rule_id: r.id })).status, 422);
  assert.equal((await t2manager.get(`/reports/discounts?from=${today}&to=${today}`)).body.meta.totals.discount, 0);
});

test('limit: kassir limit ichida qo‘llaydi (har qatorga alohida), undan yuqori — 403; rahbar sabab bilan; audit sababsiz', async () => {
  const b = await newBill([['P03', 3], ['L03', 1], ['P01', 1]]);
  S.b1 = b;
  const pension = await rule('Pensionerlar 10 %');
  const a = await cashier.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: pension.id, source: 'rule' });
  assert.equal(a.status, 200, a.text);
  let x = await inv(b.invoiceId);
  for (const it of x.items) assert.equal(Number(it.discount_share), Math.round(Number(it.line_subtotal) * 10 / 100), it.description);
  assert.equal(Number(x.discount_amount), x.items.reduce((s, it) => s + Number(it.discount_share), 0));
  assert.equal(Number(x.total), Number(x.subtotal) - Number(x.discount_amount));
  assert.equal(x.discount_granted_by_name, 'Nodira Aliyeva'); assert.equal(x.discount_rule_name, 'Pensionerlar 10 %');
  // above the staff maximum: the cashier and the registrar get 403, the manager needs a reason
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: pension.id, percent: 25 })).status, 403);
  const reg = await registrar.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: pension.id, percent: 25 });
  assert.equal(reg.status, 403); assert.equal(reg.body.error.code, 'DISCOUNT_OVER_LIMIT');
  assert.equal((await registrar.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: pension.id, percent: 8 })).status, 200, 'limit ichida — registrator ham');
  const noReason = await manager.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: pension.id, percent: 25 });
  assert.equal(noReason.status, 422); assert.ok(noReason.body.error.fields.reason);
  const secret = 'Rahbarning maxfiy izohi 7731';
  const ok = await manager.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: pension.id, percent: 25, reason: secret });
  assert.equal(ok.status, 200, ok.text); assert.equal(ok.body.data.over_limit, true);
  x = await inv(b.invoiceId);
  assert.equal(x.discount_over_limit, true); assert.equal(x.discount_reason, secret); assert.equal(x.discount_approved_by_name, 'Dilnoza Karimova');
  const audits = await sql(`SELECT summary FROM audit_logs WHERE resource_id = $1 AND action LIKE 'invoice.discount%'`, [b.invoiceId]);
  assert.ok(audits.length >= 3 && audits.every((r) => !r.summary.includes(secret)), 'auditda erkin matn yo‘q');
  // a fixed rule takes a sum off each lab line only (scope «lab»), never more than the line
  const promo = await rule('Laboratoriya aksiyasi −50 000');
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: promo.id, percent: 5 })).status, 422, 'summali qoidaga foiz emas');
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: promo.id })).status, 200);
  x = await inv(b.invoiceId);
  for (const it of x.items) assert.equal(Number(it.discount_share), it.category === 'lab' ? Math.min(Number(it.line_subtotal), 50_000_00) : 0, it.description);
  // only chosen lines; an inactive rule — 409; removing the discount
  const fam = await rule('Ko‘p bolali oilalar 15 %');
  const p03 = x.items.find((it) => it.quantity === 3);
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: fam.id, order_ids: [p03.order_id] })).status, 200);
  x = await inv(b.invoiceId);
  assert.ok(x.items.every((it) => (it.order_id === p03.order_id ? Number(it.discount_share) > 0 : Number(it.discount_share) === 0)));
  assert.equal((await manager.patch(`/discount-rules/${fam.id}`, { name: fam.name, kind: 'percent', percent: 15, staff_max_percent: 15, scope: 'categories', categories: ['consultation', 'procedure'], active: false })).status, 200);
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: fam.id })).status, 409);
  assert.equal((await manager.patch(`/discount-rules/${fam.id}`, { name: fam.name, kind: 'percent', percent: 15, staff_max_percent: 15, scope: 'categories', categories: ['consultation', 'procedure'], active: true })).status, 200);
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: null })).status, 200);
  assert.equal(Number((await inv(b.invoiceId)).discount_amount), 0);
});

test('snapshot: to‘lovdan keyin chegirma o‘zgarmaydi (409, DB trigger), qoidani tahrirlash o‘tgan hisobga ta’sir qilmaydi', async () => {
  const b = await newBill([['P02', 4], ['P04', 1]]);
  S.b2 = b;
  const pension = await rule('Pensionerlar 10 %');
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: pension.id })).status, 200);
  const before = await inv(b.invoiceId);
  const p = await cashier.post(`/invoices/${b.invoiceId}/payments`, { amount: Number(before.total), method: 'card' }, key());
  assert.equal(p.status, 201, p.text);
  assert.equal((await inv(b.invoiceId)).status, 'paid');
  const locked = await cashier.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: null });
  assert.equal(locked.status, 409); assert.equal(locked.body.error.code, 'DISCOUNT_LOCKED');
  assert.equal((await manager.post(`/invoices/${b.invoiceId}/discount`, { type: 'percent', value: 5, reason: 'Kech qoldi' })).status, 409);
  // the rule's percent changes: the paid bill keeps its own lines
  assert.equal((await manager.patch(`/discount-rules/${pension.id}`, { name: pension.name, kind: 'percent', percent: 12, staff_max_percent: 12 })).status, 200);
  const after = await inv(b.invoiceId);
  assert.deepEqual(after.items.map((it) => Number(it.discount_share)), before.items.map((it) => Number(it.discount_share)));
  assert.equal(Number(after.discount_rule_value), 10);
  await assert.rejects(pool.query(`UPDATE invoice_items SET discount_share = 0, line_total = line_subtotal WHERE invoice_id = $1`, [b.invoiceId]), /frozen/);
  assert.equal((await manager.patch(`/discount-rules/${pension.id}`, { name: pension.name, kind: 'percent', percent: 10, staff_max_percent: 10 })).status, 200);
});

test('NET_LINE = summa − chegirma − qaytarish (qator va proporsional); shifokor va hamkor ulushi chegirmali sofdan', async () => {
  const b = await newBill([['P03', 2], ['P01', 1], ['P05', 1]]);
  const staffRule = await rule('Xodimlar oilasi 30 %');
  assert.equal((await manager.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: staffRule.id, reason: 'Xodim oilasi' })).status, 200);
  // a referred line: the partner percent snapshot (set here directly)
  const partner = (await sql(`SELECT id FROM referral_partners WHERE tenant_id = $1 AND code = 101`, [SEED_IDS.tenant]))[0].id;
  await sql(`UPDATE service_orders SET referral_partner_id = $2, partner_percent_snapshot = 10 WHERE id = ANY($1::uuid[])`, [b.orders, partner]);
  let x = await inv(b.invoiceId);
  const total = Number(x.total);
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/payments`, { amount: total, method: 'cash' }, key())).status, 201);
  x = await inv(b.invoiceId);
  const pay = x.payments[0];
  const net = async () => Object.fromEntries((await sql(`SELECT it.order_id, it.line_total, ${billing.NET_LINE} AS net, ${billing.PARTNER_LINE} AS partner, round(${billing.NET_LINE} * o.share_percent_snapshot / 100) AS share, o.share_percent_snapshot AS pct
      FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id JOIN service_orders o ON o.id = it.order_id WHERE it.invoice_id = $1`, [b.invoiceId])).map((r) => [r.order_id, r]));
  let n = await net();
  for (const it of x.items) {
    const r = n[it.order_id];
    assert.equal(Number(r.net), Number(it.line_subtotal) - Number(it.discount_share), 'qaytarishsiz: summa − chegirma');
    assert.equal(Number(r.partner), Math.round(Number(r.net) * 10 / 100));
  }
  // a line refund: exactly that line drops
  const line = x.items[0];
  const lr = await manager.post(`/invoices/${b.invoiceId}/refunds`, { payment_id: pay.id, amount: 10_000_00, method: 'card', reason_code: 'service_not_provided', reason: 'Bitta muolaja qilinmadi', order_id: line.order_id }, key());
  assert.equal(lr.status, 201, lr.text);
  n = await net();
  assert.equal(Number(n[line.order_id].net), Number(line.line_total) - 10_000_00);
  for (const it of x.items.slice(1)) assert.equal(Number(n[it.order_id].net), Number(it.line_total), 'boshqa qatorlar o‘zgarmaydi');
  // a proportional refund: spread over what is left of the lines; Σ net = total
  const pr = await manager.post(`/invoices/${b.invoiceId}/refunds`, { payment_id: pay.id, amount: 20_000_00, method: 'card', reason_code: 'patient_complaint', reason: 'Shikoyat bo‘yicha' }, key());
  assert.equal(pr.status, 201, pr.text);
  n = await net();
  const after = await inv(b.invoiceId);
  const sumNet = Object.values(n).reduce((a, r) => a + Number(r.net), 0);
  assert.ok(Math.abs(sumNet - Number(after.total)) <= x.items.length, `Σ NET_LINE ${sumNet} ≈ total ${after.total}`);
  assert.equal(Number(after.total), total - 30_000_00); assert.equal(Number(after.paid_amount), total - 30_000_00);
  assert.equal(after.status, 'paid', 'paid ≤ total, holat to‘g‘ri');
  // the doctor report = Σ round(NET_LINE × %) of the performer's lines of today
  const rep = (await manager.get(`/reports/doctors?from=${today}&to=${today}`)).body.data.find((d) => d.doctor_id === b.doctorId);
  const [own] = await sql(`SELECT coalesce(sum(round(${billing.NET_LINE} * o.share_percent_snapshot / 100)),0)::bigint AS s FROM service_orders o JOIN invoice_items it ON it.order_id = o.id JOIN invoices i ON i.id = it.invoice_id
      WHERE o.performer_doctor_id = $1 AND o.performed_at >= $2 AND o.status IN ('completed','verified') AND i.status <> 'void'`, [b.doctorId, (await sql(`SELECT (date_trunc('day', demo_now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent') AS d`))[0].d]);
  assert.equal(rep.share, Number(own.s));
  // the services report shows gross / discount / net
  const svc = (await manager.get(`/reports/services?from=${today}&to=${today}`)).body.data;
  assert.ok(svc.every((r) => Number(r.gross) - Number(r.discount) - Number(r.refunded) === Number(r.value)), 'summa − chegirma − qaytarish = qiymat');
});

test('imtiyoz toifasi kartada: hujjat izohi majburiy, registrator qo‘yadi, audit; bekor qilingan toifa 422', async () => {
  const p = (await registrar.post('/patients', { last_name: 'Imtiyozov', first_name: 'Test', birth_date: '1950-05-05', sex: 'male' })).body.data;
  const cats = (await registrar.get('/benefit-categories')).body.data;
  const pension = cats.find((c) => c.name === 'Pensionerlar'), staff = cats.find((c) => c.name === 'Xodimlar oilasi');
  const noNote = await registrar.patch(`/patients/${p.id}`, { benefit_category_id: pension.id });
  assert.equal(noNote.status, 422); assert.ok(noNote.body.error.fields.benefit_note);
  assert.equal((await registrar.patch(`/patients/${p.id}`, { benefit_category_id: pension.id, benefit_note: 'PN-123456' })).status, 200);
  let card = (await registrar.get(`/patients/${p.id}`)).body.data;
  assert.equal(card.benefit_category_name, 'Pensionerlar'); assert.equal(card.benefit_note, 'PN-123456');
  assert.equal((await registrar.patch(`/patients/${p.id}`, { benefit_category_id: staff.id })).status, 200, 'hujjatsiz toifa');
  card = (await registrar.get(`/patients/${p.id}`)).body.data;
  assert.equal(card.benefit_category_name, 'Xodimlar oilasi');
  assert.equal((await registrar.patch(`/patients/${p.id}`, { benefit_category_id: null })).status, 200);
  card = (await registrar.get(`/patients/${p.id}`)).body.data;
  assert.equal(card.benefit_category_id, null); assert.equal(card.benefit_note, null, 'toifa olib tashlansa izoh ham');
  const a = await sql(`SELECT summary FROM audit_logs WHERE resource_id = $1 AND action = 'patient.update' ORDER BY id`, [p.id]);
  assert.ok(a.some((r) => r.summary.includes('benefit_category_id')) && a.every((r) => !r.summary.includes('PN-123456')));
  // a doctor's PATCH never touches the payer fields
  const [doc] = await sql(`SELECT patient_id FROM appointments WHERE doctor_id = $1 LIMIT 1`, [SEED_IDS.doctor(0)]);
  await doctor.patch(`/patients/${doc.patient_id}`, { benefit_category_id: pension.id, benefit_note: 'X' });
  assert.equal((await sql(`SELECT benefit_note FROM patients WHERE id = $1`, [doc.patient_id]))[0].benefit_note === 'X', false);
  // a switched-off category cannot be put on a card
  assert.equal((await manager.patch(`/benefit-categories/${staff.id}`, { name: staff.name, discount_rule_id: staff.discount_rule_id, active: false })).status, 200);
  assert.equal((await registrar.patch(`/patients/${p.id}`, { benefit_category_id: staff.id })).status, 422);
  assert.equal((await manager.patch(`/benefit-categories/${staff.id}`, { name: staff.name, discount_rule_id: staff.discount_rule_id, active: true })).status, 200);
  // rule validation
  assert.equal((await manager.post('/discount-rules', { name: 'Xato', kind: 'percent', percent: 120, staff_max_percent: 5 })).status, 422);
  assert.equal((await manager.post('/discount-rules', { name: 'Xato', kind: 'percent', percent: 5, staff_max_percent: 5, scope: 'categories', categories: [] })).status, 422);
  assert.equal((await manager.post('/discount-rules', { name: 'Pensionerlar 10 %', kind: 'percent', percent: 5, staff_max_percent: 5 })).status, 409, 'nom takrorlanmaydi');
});

test('«Chegirmalar» hisoboti: har guruhlash bir xil jami, CSV jami qatori va 1 yil chegarasi; moliya xulosasida chegirma', async () => {
  const from = (await sql(`SELECT to_char((demo_now() AT TIME ZONE 'Asia/Tashkent')::date - 60, 'YYYY-MM-DD') AS d`))[0].d;
  const totals = [];
  for (const group of ['rule', 'category', 'staff', 'service']) {
    const r = (await manager.get(`/reports/discounts?from=${from}&to=${today}&group=${group}`)).body;
    assert.equal(r.meta.group, group);
    for (const k of ['gross', 'discount', 'net']) assert.equal(r.meta.totals[k], r.data.reduce((a, x) => a + x[k], 0), `${group} ${k}`);
    assert.ok(r.data.every((x) => x.gross - x.discount === x.net));
    totals.push(r.meta.totals.discount);
  }
  assert.ok(totals[0] > 0 && totals.every((t) => t === totals[0]), 'guruhlashlar jami bir xil');
  const byCat = (await manager.get(`/reports/discounts?from=${from}&to=${today}&group=category`)).body.data;
  assert.ok(byCat.some((x) => x.label === 'Pensionerlar'));
  const byRule = (await manager.get(`/reports/discounts?from=${from}&to=${today}&group=rule`)).body.data;
  assert.ok(byRule.some((x) => x.key === 'manual'), 'rahbarning eski chegirmasi «qo‘lda»');
  const csv = await manager.get(`/reports/discounts/export.csv?from=${from}&to=${today}&group=rule`);
  assert.equal(csv.status, 200);
  const lines = csvLines(csv.text);
  assert.equal(lines.length, 1 + byRule.length + 1); assert.match(lines.at(-1), /^"Jami"/);
  assert.equal((await manager.get(`/reports/discounts/export.csv?from=2024-01-01&to=${today}`)).status, 422);
  assert.equal((await manager.get('/reports/discounts/export.csv')).status, 422);
  const fin = (await manager.get(`/finance/summary?from=${from}&to=${today}`)).body.data;
  const [d] = await sql(`SELECT coalesce(sum(discount_amount),0)::bigint AS s FROM invoices WHERE tenant_id = $1 AND status <> 'void' AND created_at >= (($2::date)::timestamp AT TIME ZONE 'Asia/Tashkent')`, [SEED_IDS.tenant, from]);
  assert.equal(fin.discounts.total, Number(d.s));
  // discounts are not an expense: net result = revenue − expenses − partner payouts, as before
  assert.equal(fin.net_result, fin.net_revenue - fin.expenses.total - fin.partner_payouts.total);
});
