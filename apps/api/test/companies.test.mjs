// Companies (employers, insurers): directory, the company split of a bill, patient debt vs company receivable,
// company payments (allocation, idempotency, fiscal row, revenue) and their void, the credit limit, ageing, the report,
// the statement / reconciliation act and CSVs; role sweep (403) and tenant isolation (404). Migration 043,
// docs/DISCOUNTS_COMPANIES.md.
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

let visitN = 0;
/** A new open bill on a past visit in the central branch (createBilledOrder), orders performed now. */
async function newBill(lines) {
  const [a] = await sql(`SELECT a.id, a.patient_id, a.doctor_id, a.branch_id FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.tenant_id = $1 AND a.branch_id = $2 AND a.status = 'completed' AND a.referral_partner_id IS NULL AND p.benefit_category_id IS NULL AND p.company_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.appointment_id = a.id AND i.status = 'unpaid' AND i.paid_amount = 0)
    ORDER BY a.starts_at, a.id OFFSET $3 LIMIT 1`, [SEED_IDS.tenant, SEED_IDS.branchCentral, visitN++]);
  const ctx = { tenantId: SEED_IDS.tenant, membershipId: M.registrar };
  const svc = await sql(`SELECT id, code FROM services WHERE tenant_id = $1`, [SEED_IDS.tenant]);
  let invoiceId; const orders = [];
  for (const [code, qty] of lines) {
    const r = await billing.createBilledOrder(pool, ctx, { branchId: a.branch_id, patientId: a.patient_id, appointmentId: a.id, encounterId: null, serviceId: svc.find((s) => s.code === code).id,
      isPrimary: false, doctorId: a.doctor_id, performerDoctorId: a.doctor_id, quantity: qty });
    invoiceId = r.invoiceId; orders.push(r.orderId);
  }
  await sql(`UPDATE service_orders SET status = 'completed', performed_at = demo_now() WHERE id = ANY($1::uuid[])`, [orders]);
  return { invoiceId, orders, patientId: a.patient_id };
}
const inv = async (id) => (await manager.get(`/invoices/${id}`)).body.data;
const kpi = async () => (await manager.get('/dashboard?period=today')).body.data.kpi;
const company = async (name) => (await sql(`SELECT * FROM companies WHERE tenant_id = $1 AND name LIKE $2`, [SEED_IDS.tenant, `%${name}%`]))[0];

test('ma’lumotnoma: rahbar qo‘shadi (STIR 9 raqam, takror 409); registrator faqat nomlar, kassir qoldiq bilan', async () => {
  assert.equal((await manager.post('/companies', { name: 'Xato STIR', kind: 'employer', inn: '12345' })).status, 422);
  const c = await manager.post('/companies', { name: 'Test Zavod (demo)', kind: 'employer', inn: '309999999', coverage_percent: 100, coverage_categories: ['procedure'], payment_terms_days: 10,
    credit_limit: 0, contract_number: 'T-1', contact_phone: '90 111 22 33', note: 'Ichki izoh' });
  assert.equal(c.status, 201, c.text); S.companyId = c.body.data.id;
  assert.equal((await manager.post('/companies', { name: 'Boshqa nom', kind: 'other', inn: '309999999' })).status, 409);
  const reg = (await registrar.get('/companies?page_size=50')).body.data;
  assert.ok(reg.length >= 4 && reg.every((x) => Object.keys(x).sort().join() === 'id,kind,name'), 'registrator: faqat nomi va turi');
  const cash = (await cashier.get('/companies?page_size=50')).body.data.find((x) => x.id === S.companyId);
  assert.ok(cash && 'outstanding' in cash && !('note' in cash) && !('contact_phone' in cash));
  const one = (await cashier.get(`/companies/${S.companyId}`)).body.data;
  assert.equal(one.outstanding, 0); assert.ok(!('note' in one));
  assert.equal((await manager.get(`/companies/${S.companyId}`)).body.data.note, 'Ichki izoh');
});

test('bemor kartasida kompaniya; hisobda ulush: bemor faqat o‘z qismini to‘laydi, qarzdorlar va KPI faqat bemor qarzi', async () => {
  const before = await kpi();
  const b = await newBill([['P01', 1], ['P03', 2], ['L03', 1]]);
  S.b = b;
  assert.equal((await registrar.patch(`/patients/${b.patientId}`, { company_id: S.companyId, company_member_no: 'TAB-77' })).status, 200);
  let x = await inv(b.invoiceId);
  assert.equal(x.patient_company_id, S.companyId);
  const split = await cashier.post(`/invoices/${b.invoiceId}/company`, { company_id: S.companyId });
  assert.equal(split.status, 200, split.text);
  x = await inv(b.invoiceId);
  // coverage: procedures only (the lab line is the patient's), 100 %
  const procedures = x.items.filter((it) => it.category === 'procedure').reduce((a, it) => a + Number(it.line_total), 0);
  assert.equal(Number(x.company_share_amount), procedures); assert.equal(x.company_member_no, 'TAB-77');
  assert.equal(Number(x.due), Number(x.total) - procedures, 'bemor qismi'); assert.equal(Number(x.company_due), procedures);
  // the patient pays exactly their part; more is refused
  const over = await cashier.post(`/invoices/${b.invoiceId}/payments`, { amount: Number(x.due) + 100, method: 'cash' }, key());
  assert.equal(over.status, 422);
  const p = await cashier.post(`/invoices/${b.invoiceId}/payments`, { amount: Number(x.due), method: 'cash' }, key());
  assert.equal(p.status, 201, p.text);
  x = await inv(b.invoiceId);
  assert.equal(x.status, 'partially_paid'); assert.equal(Number(x.due), 0); assert.equal(Number(x.company_due), procedures);
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/payments`, { amount: 100, method: 'cash' }, key())).status, 409, 'bemorning qarzi yo‘q');
  // debtors: not a patient debtor; listed among company receivables
  const debt = (await manager.get('/invoices?debt=1&page_size=100')).body;
  assert.ok(!debt.data.some((i) => i.id === b.invoiceId));
  const comp = (await manager.get(`/invoices?debt=1&payer=company&page_size=100&company_id=${S.companyId}`)).body;
  assert.equal(comp.data.length, 1); assert.equal(Number(comp.data[0].due), procedures); assert.equal(comp.meta.sums.due, procedures);
  const after = await kpi();
  assert.equal(after.debt, before.debt); assert.equal(after.debt_invoices, before.debt_invoices);
  assert.equal(after.company_receivable, before.company_receivable + procedures);
  // after money moved the split and the discount are frozen
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/company`, { company_id: null })).status, 409);
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: null })).status, 409);
  // the patient card's balance is the patient's only
  const card = (await registrar.get(`/patients/${b.patientId}`)).body.data;
  assert.equal(card.company_name, 'Test Zavod (demo)');
  const [own] = await sql(`SELECT coalesce(sum(total - company_share_amount - (paid_amount - company_paid_amount)),0)::bigint AS s FROM invoices WHERE patient_id = $1 AND status <> 'void'`, [b.patientId]);
  assert.equal(Number(card.balance_due), Number(own.s));
});

test('chegirma + kompaniya: ulush chegirmali sofdan; kompaniya foizi limitdan yuqori — faqat rahbar', async () => {
  const b = await newBill([['P05', 1], ['P04', 1]]);
  const insurer = await company('Ishonch');
  const pension = (await sql(`SELECT id FROM discount_rules WHERE tenant_id = $1 AND name = 'Pensionerlar 10 %'`, [SEED_IDS.tenant]))[0];
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: pension.id })).status, 200);
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/company`, { company_id: insurer.id, percent: 90 })).status, 403, 'shartnomadagi 80 % dan yuqori');
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/company`, { company_id: insurer.id })).status, 200);
  const x = await inv(b.invoiceId);
  assert.equal(Number(x.company_share_amount), Math.round(Number(x.total) * 80 / 100));
  assert.equal(Number(x.due), Number(x.total) - Number(x.company_share_amount));
  // the split follows the lines: removing the discount raises the company part (still a draft)
  assert.equal((await cashier.post(`/invoices/${b.invoiceId}/apply-discount`, { rule_id: null })).status, 200);
  const y = await inv(b.invoiceId);
  assert.equal(Number(y.company_share_amount), Math.round(Number(y.subtotal) * 80 / 100));
  assert.equal((await manager.post(`/invoices/${b.invoiceId}/company`, { company_id: null })).status, 200);
  assert.equal(Number((await inv(b.invoiceId)).company_share_amount), 0);
});

test('kredit limiti: oshsa kassir 403, rahbar tasdiqlaydi (over_limit)', async () => {
  const c = await manager.post('/companies', { name: 'Limitli MChJ (demo)', kind: 'employer', inn: '308888888', coverage_percent: 100, credit_limit: 100_000_00 });
  assert.equal(c.status, 201, c.text);
  const b1 = await newBill([['P01', 1]]); // 70 000
  assert.equal((await cashier.post(`/invoices/${b1.invoiceId}/company`, { company_id: c.body.data.id })).status, 200);
  const b2 = await newBill([['P01', 1]]);
  const r = await cashier.post(`/invoices/${b2.invoiceId}/company`, { company_id: c.body.data.id });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'COMPANY_CREDIT_LIMIT');
  const m = await manager.post(`/invoices/${b2.invoiceId}/company`, { company_id: c.body.data.id });
  assert.equal(m.status, 200); assert.equal(m.body.data.over_limit, true);
  assert.equal((await manager.get(`/companies/${c.body.data.id}`)).body.data.over_limit, true);
  const rep = (await manager.get(`/reports/companies?from=${today}&to=${today}`)).body.data.find((x) => x.company_id === c.body.data.id);
  assert.equal(rep.over_limit, true); assert.equal(rep.outstanding, 140_000_00);
  S.limitCompany = c.body.data.id; S.limitBills = [b1.invoiceId, b2.invoiceId];
});

test('kompaniya to‘lovi: taqsimot, idempotentlik, fiskal qator, tushum; qaytarish emas — bekor qilish (bir marta, sabab bilan)', async () => {
  const [b1, b2] = S.limitBills;
  const bad = await cashier.post('/company-payments', { company_id: S.limitCompany, amount: 100_000_00, allocations: [{ invoice_id: b1, amount: 70_000_00 }] }, key());
  assert.equal(bad.status, 422, 'taqsimot summasi teng emas');
  assert.equal((await cashier.post('/company-payments', { company_id: S.limitCompany, amount: 80_000_00, allocations: [{ invoice_id: b1, amount: 80_000_00 }] }, key())).status, 422, 'qarzdan ko‘p');
  assert.equal((await cashier.post('/company-payments', { company_id: S.limitCompany, amount: 1_00, allocations: [{ invoice_id: S.b.invoiceId, amount: 1_00 }] }, key())).status, 422, 'boshqa kompaniya hisobi');
  assert.equal((await cashier.post('/company-payments', { company_id: S.limitCompany, amount: 1_00, allocations: [{ invoice_id: b1, amount: 1_00 }] })).status, 422, 'Idempotency-Key majburiy');
  const finBefore = (await manager.get(`/finance/summary?from=${today}&to=${today}`)).body.data;
  const k = key();
  const body = { company_id: S.limitCompany, amount: 110_000_00, document_number: 'p/t 55', document_date: today, allocations: [{ invoice_id: b1, amount: 70_000_00 }, { invoice_id: b2, amount: 40_000_00 }] };
  const r = await cashier.post('/company-payments', body, k);
  assert.equal(r.status, 201, r.text); S.cp = r.body.data.payment;
  const again = await cashier.post('/company-payments', body, k);
  assert.equal(again.status, 200); assert.equal(again.body.data.replayed, true); assert.equal(again.body.data.payment.id, S.cp.id);
  assert.equal((await cashier.post('/company-payments', { ...body, amount: 70_000_00, allocations: [{ invoice_id: b1, amount: 70_000_00 }] }, k)).status, 422, 'kalit boshqa to‘lovga');
  const x1 = await inv(b1), x2 = await inv(b2);
  assert.equal(x1.status, 'paid'); assert.equal(Number(x1.company_due), 0);
  assert.equal(x2.status, 'partially_paid'); assert.equal(Number(x2.company_due), 30_000_00); assert.equal(Number(x2.due), 0);
  // ordinary payment rows: bank transfer, no drawer, a fiscal row each (the demo provider: skipped)
  const rows = await sql(`SELECT p.method, p.shift_id, (SELECT status FROM fiscal_receipts f WHERE f.payment_id = p.id) AS fiscal FROM payments p WHERE p.company_payment_id = $1`, [S.cp.id]);
  assert.equal(rows.length, 2); assert.ok(rows.every((p) => p.method === 'transfer' && !p.shift_id && p.fiscal));
  // revenue counts it when received (cash basis), once
  const finAfter = (await manager.get(`/finance/summary?from=${today}&to=${today}`)).body.data;
  assert.equal(finAfter.net_revenue, finBefore.net_revenue + 110_000_00);
  assert.equal(finAfter.companies.received, finBefore.companies.received + 110_000_00);
  const shift = (await cashier.get('/cash-shifts/current')).body.data;
  assert.ok(!shift.payments?.some?.((p) => p.amount === 70_000_00 && p.method === 'transfer'), 'kassaga tushmaydi');
  // a company payment row is not refunded to the patient
  const pay = x1.payments.find((p) => p.company_payment_id);
  assert.equal(pay.refundable, 0);
  const ref = await manager.post(`/invoices/${b1}/refunds`, { payment_id: pay.id, amount: 1_00, method: 'transfer', reason_code: 'other', reason: 'Sinov' }, key());
  assert.equal(ref.status, 409); assert.equal(ref.body.error.code, 'COMPANY_PAYMENT');
  // void: manager only, once, with a reason; the bills owe it again and revenue goes back down
  assert.equal((await cashier.post(`/company-payments/${S.cp.id}/void`, { reason: 'Xato' })).status, 403);
  const v = await manager.post(`/company-payments/${S.cp.id}/void`, { reason: 'Boshqa kompaniya to‘lovi' });
  assert.equal(v.status, 200, v.text);
  assert.equal((await manager.post(`/company-payments/${S.cp.id}/void`, { reason: 'Yana' })).status, 409);
  const y1 = await inv(b1);
  assert.equal(Number(y1.company_due), 70_000_00); assert.equal(Number(y1.paid_amount), 0); assert.equal(y1.status, 'unpaid'); assert.equal(Number(y1.total), 70_000_00, 'hisob summasi kamaymaydi');
  assert.ok(y1.refunds.some((r) => r.reason_code === 'company_payment_void'));
  const finVoid = (await manager.get(`/finance/summary?from=${today}&to=${today}`)).body.data;
  assert.equal(finVoid.net_revenue, finBefore.net_revenue);
  const list = (await manager.get(`/company-payments?from=${today}&to=${today}&company_id=${S.limitCompany}`)).body;
  assert.equal(list.meta.total, 1); assert.equal(list.data[0].status, 'void'); assert.equal(list.meta.sum, 0);
  const audits = await sql(`SELECT summary FROM audit_logs WHERE resource_id = $1`, [S.cp.id]);
  assert.ok(audits.length === 2 && audits.every((a) => !a.summary.includes('Boshqa kompaniya to‘lovi')), 'auditda sabab matni yo‘q');
  // pay again for real
  assert.equal((await cashier.post('/company-payments', { ...body, amount: 140_000_00, allocations: [{ invoice_id: b1, amount: 70_000_00 }, { invoice_id: b2, amount: 70_000_00 }] }, key())).status, 201);
  assert.equal((await inv(b2)).status, 'paid');
});

test('hisobot, qarz yoshi, solishtirma dalolatnoma (akt sverki) va CSV', async () => {
  const from = (await sql(`SELECT to_char((demo_now() AT TIME ZONE 'Asia/Tashkent')::date - 90, 'YYYY-MM-DD') AS d`))[0].d;
  const rep = (await manager.get(`/reports/companies?from=${from}&to=${today}`)).body;
  for (const k of ['invoices', 'covered', 'paid', 'outstanding']) assert.equal(rep.meta.totals[k], rep.data.reduce((a, x) => a + x[k], 0), k);
  for (const x of rep.data) assert.equal(x.ageing['0-30'] + x.ageing['31-60'] + x.ageing['61+'], x.outstanding, `${x.name}: yosh guruhlari = qoldiq`);
  const k = await kpi();
  assert.equal(rep.meta.totals.outstanding, k.company_receivable, 'hisobot qoldig‘i = dashboard');
  const ds = rep.data.find((x) => x.name.includes('DataSoft'));
  assert.ok(ds.outstanding > 0 && ds.paid === 0, 'DataSoft hali to‘lamagan');
  const csv = await manager.get(`/reports/companies/export.csv?from=${from}&to=${today}`);
  assert.equal(csv.status, 200);
  const lines = csvLines(csv.text);
  assert.equal(lines.length, 1 + rep.data.length + 1); assert.match(lines.at(-1), /^"Jami"/);
  assert.equal((await manager.get(`/reports/companies/export.csv?from=2024-01-01&to=${today}`)).status, 422);
  // statement: opening + debit − credit = closing; up to today the closing balance is what the company owes now
  const plant = await company('Toshkent Metall');
  const st = (await manager.get(`/companies/${plant.id}/statement?from=${from}&to=${today}`)).body.data;
  assert.equal(st.closing, st.opening + st.debit - st.credit);
  assert.equal(st.debit, st.invoices.reduce((a, x) => a + x.amount, 0)); assert.equal(st.credit, st.payments.reduce((a, x) => a + x.amount, 0));
  assert.equal(st.closing, rep.data.find((x) => x.company_id === plant.id).outstanding);
  assert.ok(st.payments.length >= 1, 'bekor qilingan to‘lov aktga kirmaydi');
  const [voided] = await sql(`SELECT number FROM company_payments WHERE company_id = $1 AND status = 'void'`, [plant.id]);
  assert.ok(!st.payments.some((p) => p.number === voided.number));
  const mid = (await sql(`SELECT to_char((demo_now() AT TIME ZONE 'Asia/Tashkent')::date - 10, 'YYYY-MM-DD') AS d`))[0].d;
  const part = (await manager.get(`/companies/${plant.id}/statement?from=${mid}&to=${today}`)).body.data;
  const first = (await manager.get(`/companies/${plant.id}/statement?from=${from}&to=${(await sql(`SELECT to_char($1::date - 1, 'YYYY-MM-DD') AS d`, [mid]))[0].d}`)).body.data;
  assert.equal(part.opening, first.closing, 'davr boshidagi qoldiq = oldingi davr oxiri');
  const scsv = await manager.get(`/companies/${plant.id}/statement.csv?from=${from}&to=${today}`);
  assert.equal(scsv.status, 200);
  const sl = csvLines(scsv.text);
  assert.equal(sl.length, 1 + 1 + st.invoices.length + st.payments.length + 2);
  assert.match(sl.at(-2), /^"Jami"/);
  // debtors: the company list has ageing too
  const comp = (await manager.get('/invoices?debt=1&payer=company')).body;
  assert.equal(comp.meta.sums.due, k.company_receivable);
  assert.equal(Object.values(comp.meta.ageing).reduce((a, x) => a + x.sum, 0), k.company_receivable);
});

test('rollar 403 va tenant izolyatsiyasi 404', async () => {
  const id = S.companyId, invoiceId = S.b.invoiceId;
  const routes = [['GET', '/companies'], ['GET', `/companies/${id}`], ['POST', '/companies', { name: 'X MChJ', kind: 'other' }], ['PATCH', `/companies/${id}`, { name: 'X', kind: 'other' }],
    ['GET', `/companies/${id}/open-invoices`], ['POST', `/invoices/${invoiceId}/company`, { company_id: null }], ['GET', `/company-payments?from=${today}&to=${today}`],
    ['POST', '/company-payments', { company_id: id, amount: 1, allocations: [{ invoice_id: invoiceId, amount: 1 }] }], ['POST', `/company-payments/${S.cp.id}/void`, { reason: 'Sinov' }],
    ['GET', `/reports/companies?from=${today}&to=${today}`], ['GET', `/reports/companies/export.csv?from=${today}&to=${today}`],
    ['GET', `/companies/${id}/statement?from=${today}&to=${today}`], ['GET', `/companies/${id}/statement.csv?from=${today}&to=${today}`]];
  const call = (s, [m, p, b]) => (m === 'GET' ? s.get(p) : m === 'POST' ? s.post(p, b, key()) : s.patch(p, b));
  for (const [name, s] of [['doctor', doctor], ['lab', lab], ['storekeeper', storekeeper], ['guard', guard]])
    for (const r of routes) assert.equal((await call(s, r)).status, 403, `${name} ${r[0]} ${r[1]}`);
  for (const r of routes) if (!(r[0] === 'GET' && r[1] === '/companies')) assert.equal((await call(registrar, r)).status, 403, `registrator ${r[0]} ${r[1]}`);
  const cashierDenied = new Set(['POST /companies', `PATCH /companies/${id}`, `POST /company-payments/${S.cp.id}/void`, `GET /reports/companies?from=${today}&to=${today}`,
    `GET /reports/companies/export.csv?from=${today}&to=${today}`, `GET /companies/${id}/statement?from=${today}&to=${today}`, `GET /companies/${id}/statement.csv?from=${today}&to=${today}`]);
  for (const r of routes) if (cashierDenied.has(`${r[0]} ${r[1]}`)) assert.equal((await call(cashier, r)).status, 403, `kassir ${r[0]} ${r[1]}`);
  // another clinic sees nothing of ours
  assert.equal((await t2manager.get('/companies?all=1')).body.meta.total, 0);
  assert.equal((await t2manager.get(`/companies/${id}`)).status, 404);
  assert.equal((await t2manager.patch(`/companies/${id}`, { name: 'Begona', kind: 'other' })).status, 404);
  assert.equal((await t2manager.get(`/companies/${id}/statement?from=${today}&to=${today}`)).status, 404);
  assert.equal((await t2manager.get(`/companies/${id}/open-invoices`)).status, 404);
  assert.equal((await t2manager.post(`/invoices/${invoiceId}/company`, { company_id: null })).status, 404);
  assert.equal((await t2manager.post('/company-payments', { company_id: id, amount: 1_00, allocations: [{ invoice_id: invoiceId, amount: 1_00 }] }, key())).status, 404);
  assert.equal((await t2manager.post(`/company-payments/${S.cp.id}/void`, { reason: 'Begona' })).status, 404);
  assert.equal((await t2manager.get(`/company-payments?from=${today}&to=${today}`)).body.meta.total, 0);
  // the patient card cannot point at another clinic's company
  const t2p = (await sql(`SELECT id FROM patients WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant2]))[0];
  if (t2p) assert.equal((await t2manager.patch(`/patients/${t2p.id}`, { company_id: id })).status, 422);
});
