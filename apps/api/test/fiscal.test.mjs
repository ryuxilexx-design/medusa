// Fiscalisation foundation (migration 023): manual provider rows on pay/refund (parallel mode with the clinic's
// certified KKM), entering the receipt number (roles, validation, 409 once issued, DB immutability), none provider
// (demo) → skipped, CSV columns, shift and finance counts, service IKPU/VAT fields, outbox worker for automatic providers.
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
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), patch: (p, b) => req('PATCH', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const key = () => ({ 'Idempotency-Key': randomUUID() });

let manager, cashier, cashier2, registrar, t2manager, central;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  // the first clinic runs in parallel mode (certified KKM + manual receipt entry); the second stays on the deployment default (none in tests)
  await pool.query(`UPDATE tenants SET fiscal_provider = 'manual' WHERE id = $1`, [SEED_IDS.tenant]);
  cashier = session(); await cashier.demo(M.cashier);     // Nodira: seed shift open in central
  cashier2 = session(); await cashier2.demo(M.cashier2);  // Jasur: Yunusobod
  registrar = session(); await registrar.demo(M.registrar);
  t2manager = session(); await t2manager.demo(M.tenant2Manager);
  central = (await manager.get('/me')).body.data.branches.find((b) => b.code === 'MRK').id;
});
after(async () => { await app?.close(); });

async function unpaid(branch, min = 1) {
  const list = (await manager.get(`/invoices?status=unpaid&branch_id=${branch}&page_size=50`)).body.data;
  const inv = list.find((i) => Number(i.due) >= min && Number(i.total) > 0);
  assert.ok(inv, 'to‘lanmagan hisob bor');
  return inv;
}

let payment, invoiceId;
test('to‘lov: manual provayder «pending» qator ochadi; /me va /settings rejimni ko‘rsatadi', async () => {
  assert.equal((await cashier.get('/me')).body.data.fiscal_provider, 'manual');
  assert.equal((await t2manager.get('/me')).body.data.fiscal_provider, 'none');
  const settings = (await manager.get('/settings')).body.data;
  assert.equal(settings.fiscal.provider, 'manual');
  assert.equal(typeof settings.fiscal.services_without_ikpu, 'number');
  const inv = await unpaid(central, 20_000_00);
  invoiceId = inv.id;
  const r = await cashier.post(`/invoices/${inv.id}/payments`, { amount: 20_000_00, method: 'cash' }, key());
  assert.equal(r.status, 201, r.text);
  payment = r.body.data.payment;
  assert.equal(r.body.data.fiscal.status, 'pending');
  assert.equal(r.body.data.fiscal.provider, 'manual');
  const one = (await cashier.get(`/payments/${payment.id}`)).body.data;
  assert.equal(one.fiscal.status, 'pending');
  assert.ok(Array.isArray(one.items) && 'ikpu_code' in one.items[0], 'chek qatorlarida IKPU maydoni bor');
  const invPayments = (await cashier.get(`/invoices/${inv.id}`)).body.data.payments;
  assert.equal(invPayments.find((p) => p.id === payment.id).fiscal.status, 'pending');
});

test('chek raqamini kiritish: 422 validatsiya, registrator 403, boshqa kassir 403, kassir → issued, qayta → 409, bazada o‘zgarmaydi', async () => {
  const bad = await cashier.post(`/payments/${payment.id}/fiscal`, { receipt_number: '' });
  assert.equal(bad.status, 422); assert.ok(bad.body.error.fields.receipt_number);
  const badUrl = await cashier.post(`/payments/${payment.id}/fiscal`, { receipt_number: '12345', qr_url: 'ofd.uz/check/1' });
  assert.equal(badUrl.status, 422); assert.ok(badUrl.body.error.fields.qr_url);
  assert.equal((await registrar.post(`/payments/${payment.id}/fiscal`, { receipt_number: '12345' })).status, 403);
  assert.equal((await cashier2.post(`/payments/${payment.id}/fiscal`, { receipt_number: '12345' })).status, 404, 'boshqa filial kassiri uchun to‘lov yo‘q');
  assert.equal((await manager.post(`/payments/${randomUUID()}/fiscal`, { receipt_number: '12345' })).status, 404);
  const ok = await cashier.post(`/payments/${payment.id}/fiscal`, { receipt_number: '000123', fiscal_sign: 'AB12CD34', qr_url: 'https://ofd.soliq.uz/check?t=1&r=000123', terminal_id: 'UZ1234567890' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.data.status, 'issued');
  assert.equal(ok.body.data.receipt_number, '000123');
  assert.ok(ok.body.data.issued_at && ok.body.data.entered_by_name);
  const again = await cashier.post(`/payments/${payment.id}/fiscal`, { receipt_number: '000124' });
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'FISCAL_ALREADY_ISSUED');
  assert.equal((await cashier.get(`/payments/${payment.id}`)).body.data.fiscal.receipt_number, '000123');
  // DB: an issued receipt never changes or disappears
  await assert.rejects(pool.query(`UPDATE fiscal_receipts SET receipt_number = 'x' WHERE payment_id = $1`, [payment.id]), /immutable/);
  await assert.rejects(pool.query(`DELETE FROM fiscal_receipts WHERE payment_id = $1`, [payment.id]), /append-only/);
  // a second row for the same payment is impossible
  await assert.rejects(pool.query(`INSERT INTO fiscal_receipts (tenant_id, kind, payment_id, provider, status) VALUES ($1,'sale',$2,'manual','pending')`, [SEED_IDS.tenant, payment.id]), /unique|duplicate/i);
  const audit = (await manager.get('/audit?action=payment.fiscal&page_size=5')).body.data;
  assert.ok(audit.some((a) => a.entity_id === payment.id || a.summary.includes('000123')), 'audit yozuvi bor');
});

test('smena: fiskal chek kiritilmagan to‘lovlar soni; manager ro‘yxati ?fiscal=missing; moliya jamlanmasi', async () => {
  const shiftId = payment.shift_id;
  const before = (await cashier.get(`/cash-shifts/${shiftId}`)).body.data;
  assert.equal(before.fiscal_pending, 0, 'kiritilgan chek hisobga olinmaydi');
  const inv = await unpaid(central, 5_000_00);
  const r = await cashier.post(`/invoices/${inv.id}/payments`, { amount: 5_000_00, method: 'card' }, key());
  assert.equal(r.status, 201, r.text);
  const after = (await cashier.get(`/cash-shifts/${shiftId}`)).body.data;
  assert.equal(after.fiscal_pending, 1);
  assert.equal(after.payments.find((p) => p.id === r.body.data.payment.id).fiscal.status, 'pending');
  // the manager takes money in their own shift; a cashier cannot enter the receipt of someone else's payment (same branch → 403)
  assert.equal((await manager.post('/cash-shifts', { branch_id: central, opening_cash: 0 })).status, 201);
  const inv2 = await unpaid(central, 3_000_00);
  const r2 = await manager.post(`/invoices/${inv2.id}/payments`, { amount: 3_000_00, method: 'card' }, key());
  assert.equal(r2.status, 201, r2.text);
  const other = await cashier.post(`/payments/${r2.body.data.payment.id}/fiscal`, { receipt_number: '000126' });
  assert.equal(other.status, 403, other.text);
  const missing = (await manager.get(`/payments?from=2026-10-18&to=2026-10-18&fiscal=missing&page_size=50`)).body;
  assert.ok(missing.data.some((p) => p.id === r.body.data.payment.id) && missing.data.some((p) => p.id === r2.body.data.payment.id));
  assert.ok(missing.data.every((p) => p.fiscal && ['pending', 'failed'].includes(p.fiscal.status)));
  assert.equal(missing.meta.fiscal_missing, missing.meta.total);
  assert.ok(!missing.data.some((p) => p.id === payment.id), 'kiritilgan chek ro‘yxatda yo‘q');
  const all = (await manager.get(`/payments?from=2026-10-18&to=2026-10-18&page_size=1`)).body.meta;
  assert.equal(all.fiscal_missing, missing.meta.total);
  const summary = (await manager.get('/finance/summary?from=2026-10-18&to=2026-10-18')).body.data;
  assert.equal(summary.fiscal.missing, missing.meta.total);
  // the manager may enter it for any payment in their branches
  const ok = await manager.post(`/payments/${r.body.data.payment.id}/fiscal`, { receipt_number: '000125' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await manager.post(`/payments/${r2.body.data.payment.id}/fiscal`, { receipt_number: '000126' })).status, 200);
  assert.equal((await cashier.get(`/cash-shifts/${shiftId}`)).body.data.fiscal_pending, 0);
  assert.equal((await manager.get('/finance/summary?from=2026-10-18&to=2026-10-18')).body.data.fiscal.missing, summary.fiscal.missing - 2);
});

test('CSV eksport: IKPU, QQS, fiskal chek № va holat ustunlari', async () => {
  const csv = await manager.get('/payments/export.csv?from=2026-10-18&to=2026-10-18');
  assert.equal(csv.status, 200);
  const lines = csv.text.trim().split('\r\n');
  const header = lines[0];
  for (const col of ['IKPU', 'QQS', 'Fiskal chek №', 'Fiskal holati']) assert.ok(header.includes(`"${col}"`), `ustun ${col}`);
  const row = lines.find((l) => l.includes(`"${payment.receipt_number}";`));
  assert.ok(row, 'to‘lov qatori bor');
  assert.ok(row.includes('"000123"') && row.includes('"kiritilgan"'), row);
  assert.ok(row.includes('"12%"'), 'QQS sukut 12%');
});

test('qaytarish: fiskal «refund» qatori pending; rahbar raqam kiritadi → issued', async () => {
  const r = await manager.post(`/invoices/${invoiceId}/refunds`, { payment_id: payment.id, amount: 1_000_00, method: 'card', reason_code: 'other', reason: 'Fiskal test' }, key());
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.data.fiscal.status, 'pending'); assert.equal(r.body.data.fiscal.kind, 'refund');
  const inv = (await manager.get(`/invoices/${invoiceId}`)).body.data;
  assert.equal(inv.refunds.find((x) => x.id === r.body.data.refund.id).fiscal.status, 'pending');
  assert.equal((await cashier.post(`/refunds/${r.body.data.refund.id}/fiscal`, { receipt_number: 'R-1' })).status, 403);
  const ok = await manager.post(`/refunds/${r.body.data.refund.id}/fiscal`, { receipt_number: 'R-1' });
  assert.equal(ok.status, 200, ok.text); assert.equal(ok.body.data.status, 'issued');
  assert.equal((await manager.post(`/refunds/${r.body.data.refund.id}/fiscal`, { receipt_number: 'R-2' })).status, 409);
});

test('none provayder (demo klinika): to‘lov «skipped», raqam kiritish 409', async () => {
  // the second seed clinic has no open invoices: bill one service through the shared billing helper
  const { createBilledOrder } = require('../dist/modules/billing.js');
  const t2 = SEED_IDS.tenant2;
  const branch = (await pool.query(`SELECT id FROM branches WHERE tenant_id = $1 AND active ORDER BY code LIMIT 1`, [t2])).rows[0].id;
  const patient = (await pool.query(`SELECT id FROM patients WHERE tenant_id = $1 ORDER BY patient_number LIMIT 1`, [t2])).rows[0].id;
  const created = await t2manager.post('/services', { name: 'Konsultatsiya (fiskal test)', category: 'consultation', price: 50_000_00, duration_min: 20 });
  assert.equal(created.status, 201, created.text);
  const service = created.body.data.id;
  const ctx = { tenantId: t2, membershipId: M.tenant2Manager, name: 'Test' };
  const { invoiceId: invId } = await createBilledOrder(pool, ctx, { branchId: branch, patientId: patient, appointmentId: null, encounterId: null, serviceId: service, isPrimary: true, doctorId: null, performerDoctorId: null });
  const inv = (await t2manager.get(`/invoices/${invId}`)).body.data;
  assert.ok(Number(inv.due) >= 1_000_00, 'ikkinchi klinikada to‘lanmagan hisob bor');
  const cur = (await t2manager.get('/cash-shifts/current')).body.data;
  if (!cur) assert.equal((await t2manager.post('/cash-shifts', { branch_id: branch, opening_cash: 0 })).status, 201);
  const r = await t2manager.post(`/invoices/${inv.id}/payments`, { amount: 1_000_00, method: 'cash' }, key());
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.data.fiscal.status, 'skipped'); assert.equal(r.body.data.fiscal.provider, 'none');
  const no = await t2manager.post(`/payments/${r.body.data.payment.id}/fiscal`, { receipt_number: '1' });
  assert.equal(no.status, 409); assert.equal(no.body.error.code, 'FISCAL_NOT_REQUIRED');
  assert.equal((await t2manager.get('/finance/summary?from=2026-10-18&to=2026-10-18')).body.data.fiscal.missing, 0);
  // the first clinic never sees the second clinic's payment
  assert.equal((await manager.post(`/payments/${r.body.data.payment.id}/fiscal`, { receipt_number: '1' })).status, 404);
});

test('xizmat: IKPU 17 raqam (422 aks holda), QQS/QQSsiz saqlanadi va ro‘yxatda qaytadi', async () => {
  const services = (await manager.get('/services')).body.data;
  const s = services[0];
  assert.ok('ikpu_code' in s && 'vat_percent' in s && 'vat_exempt' in s);
  const bad = await manager.patch(`/services/${s.id}`, { ikpu_code: '1234567890123456' });
  assert.equal(bad.status, 422); assert.ok(bad.body.error.fields.ikpu_code);
  assert.equal((await manager.patch(`/services/${s.id}`, { vat_percent: 150 })).status, 422);
  const ok = await manager.patch(`/services/${s.id}`, { ikpu_code: '10304001001000000', vat_percent: 12, package_code: '1490744' });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(ok.body.data.changes.some((c) => c.includes('IKPU')), ok.body.data.changes.join(','));
  const after = (await manager.get('/services?active=all')).body.data.find((x) => x.id === s.id);
  assert.equal(after.ikpu_code, '10304001001000000'); assert.equal(after.vat_percent, 12); assert.equal(after.package_code, '1490744');
  const created = await manager.post('/services', { name: `Fiskal test ${Date.now()}`, category: 'procedure', price: 10_000_00, duration_min: 15, ikpu_code: '10304001001000001', vat_exempt: true });
  assert.equal(created.status, 201, created.text);
  const c = (await manager.get('/services?active=all')).body.data.find((x) => x.id === created.body.data.id);
  assert.equal(c.vat_exempt, true); assert.equal(c.ikpu_code, '10304001001000001');
  assert.equal((await registrar.patch(`/services/${s.id}`, { ikpu_code: '10304001001000000' })).status, 403);
  // the settings card counts active services without an IKPU code
  const settings = (await manager.get('/settings')).body.data;
  assert.equal(settings.fiscal.services_without_ikpu, (await manager.get('/services')).body.data.filter((x) => !x.ikpu_code).length);
});

test('worker: avtomatik provayder qatorlari qayta uriniladi (issued / failed / noma’lum provayder), manual va none tegilmaydi', async () => {
  const { runFiscalWorker } = require('../dist/fiscal/worker.js');
  const { DEFAULT_PROVIDERS } = require('../dist/fiscal/provider.js');
  // seed payments predate fiscalisation and have no rows: borrow three of them for automatic-provider rows
  const pays = (await pool.query(`SELECT id FROM payments WHERE tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM fiscal_receipts f WHERE f.payment_id = payments.id) ORDER BY paid_at LIMIT 3`, [SEED_IDS.tenant])).rows;
  assert.equal(pays.length, 3);
  const [okRow, failRow, unknownRow] = await Promise.all(pays.map((p, i) =>
    pool.query(`INSERT INTO fiscal_receipts (tenant_id, kind, payment_id, provider, status) VALUES ($1,'sale',$2,$3,'pending') RETURNING id`, [SEED_IDS.tenant, p.id, i === 2 ? 'ghost_ofd' : 'test_ofd']).then((r) => r.rows[0].id)));
  let calls = 0;
  const fake = {
    name: 'test_ofd', automatic: true,
    async issueSale(req) {
      calls++;
      assert.ok(req.items.length > 0 && req.amount > 0 && req.tenantId === SEED_IDS.tenant);
      if (req.paymentId === pays[1].id) throw new Error('ОФД javob bermadi');
      return { status: 'issued', receipt_number: `AUTO-${calls}`, qr_url: 'https://ofd.example/q/1' };
    },
    async issueRefund() { return { status: 'pending' }; },
  };
  const pendingManual = (await pool.query(`SELECT count(*)::int AS n FROM fiscal_receipts WHERE provider IN ('manual','none') AND status = 'pending'`)).rows[0].n;
  const r = await runFiscalWorker(pool, { ...DEFAULT_PROVIDERS, test_ofd: fake });
  assert.deepEqual(r, { issued: 1, failed: 2, pending: 0 });
  const rows = Object.fromEntries((await pool.query(`SELECT id, status, receipt_number, error, attempts FROM fiscal_receipts WHERE id = ANY($1::uuid[])`, [[okRow, failRow, unknownRow]])).rows.map((x) => [x.id, x]));
  assert.equal(rows[okRow].status, 'issued'); assert.ok(rows[okRow].receipt_number.startsWith('AUTO-'));
  assert.equal(rows[failRow].status, 'failed'); assert.match(rows[failRow].error, /javob bermadi/); assert.equal(rows[failRow].attempts, 1);
  assert.equal(rows[unknownRow].status, 'failed'); assert.match(rows[unknownRow].error, /sozlanmagan/);
  // manual rows are a person's job: untouched
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM fiscal_receipts WHERE provider IN ('manual','none') AND status = 'pending'`)).rows[0].n, pendingManual);
  // a failed row is retried on the next pass and may succeed
  fake.issueSale = async () => ({ status: 'issued', receipt_number: 'AUTO-RETRY' });
  const r2 = await runFiscalWorker(pool, { ...DEFAULT_PROVIDERS, test_ofd: fake });
  assert.equal(r2.issued, 1);
  assert.equal((await pool.query(`SELECT status, attempts FROM fiscal_receipts WHERE id = $1`, [failRow])).rows[0].attempts, 2);
  // issued stays issued: the worker never picks it again
  assert.deepEqual(await runFiscalWorker(pool, { ...DEFAULT_PROVIDERS, test_ofd: fake }), { issued: 0, failed: 1, pending: 0 }, 'faqat noma’lum provayder qatori qoladi');
});

test('provayder xatosi savdoni to‘xtatmaydi: qator «failed», to‘lov saqlanadi', async () => {
  const { recordFiscal } = require('../dist/fiscal/provider.js');
  const inv = await unpaid(central, 2_000_00);
  const r = await cashier.post(`/invoices/${inv.id}/payments`, { amount: 2_000_00, method: 'cash' }, key());
  assert.equal(r.status, 201, r.text);
  // same code path as the payment transaction, with a provider that throws
  const pay = (await pool.query(`SELECT id FROM payments WHERE tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM fiscal_receipts f WHERE f.payment_id = payments.id) ORDER BY paid_at LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  const boom = { name: 'manual', automatic: false, async issueSale() { throw new Error('KKM ulanmagan'); }, async issueRefund() { throw new Error('KKM ulanmagan'); } };
  const row = await recordFiscal(pool, { tenantId: SEED_IDS.tenant, branchId: central, kind: 'sale', paymentId: pay.id, invoiceId: inv.id, amount: 1, method: 'cash' }, { manual: boom });
  assert.equal(row.status, 'failed'); assert.match(row.error, /KKM ulanmagan/);
  // a failed manual row can still be finished by hand
  const ok = await manager.post(`/payments/${pay.id}/fiscal`, { receipt_number: '000777' });
  assert.equal(ok.status, 200, ok.text);
});
