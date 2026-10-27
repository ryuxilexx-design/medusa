// P1 checks: discount rules, inventory balance, UZI report ownership, AI sample mode, CSV formula guard, doctor share formula.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bootTestApp, db } from './_helpers.mjs';
const { SEED_IDS } = db;
import { createRequire } from 'node:module';
const { SAMPLE_NOTE_TEXT } = createRequire(import.meta.url)('../dist/modules/ai.controller.js');
const M = SEED_IDS.membership;
let app, base;
async function client(mid) {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t };
  };
  await req('POST', '/demo/login', { membership_id: mid });
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), put: (p, b) => req('PUT', p, b) };
}
let manager, cashier, uzi, doctor;
before(async () => {
  ({ app, base } = await bootTestApp());
  manager = await client(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  [cashier, uzi, doctor] = await Promise.all([client(M.cashier), client(M.doctor(6)), client(M.doctor(0))]);
});
after(async () => { await app?.close(); });

test('chegirma: faqat rahbar, sabab majburiy, proporsional taqsimot, to‘lovdan keyin bloklanadi', async () => {
  const inv = (await manager.get('/invoices?status=unpaid&page_size=50')).body.data.find((i) => i.services.includes(','));
  assert.ok(inv, 'ko‘p qatorli to‘lanmagan hisob bor');
  assert.equal((await cashier.post(`/invoices/${inv.id}/discount`, { type: 'percent', value: 10, reason: 'Sinov' })).status, 403);
  assert.equal((await manager.post(`/invoices/${inv.id}/discount`, { type: 'percent', value: 10 })).status, 422);
  const r = await manager.post(`/invoices/${inv.id}/discount`, { type: 'percent', value: 15, reason: 'Doimiy bemor' });
  assert.equal(r.status, 200);
  const d = (await manager.get(`/invoices/${inv.id}`)).body.data;
  assert.equal(d.discount_amount, Math.round(d.subtotal * 0.15));
  assert.equal(d.items.reduce((a, b) => a + b.discount_share, 0), d.discount_amount);
  assert.equal(d.items.reduce((a, b) => a + b.line_total, 0), d.total);
  await cashier.post(`/invoices/${inv.id}/payments`, { amount: 100, method: 'cash' }, { 'Idempotency-Key': randomUUID() });
  assert.equal((await manager.post(`/invoices/${inv.id}/discount`, { type: 'amount', value: 100, reason: 'Keyin' })).status, 409);
});

test('ombor: qoldiq = boshlang‘ich + kirim − chiqim; qoldiqdan ko‘p chiqim bloklanadi; kam qolganlar 4 ta', async () => {
  const low = (await manager.get('/inventory?low=1')).body.data;
  assert.equal(low.length, 4);
  const all = (await manager.get('/inventory')).body.data;
  for (const i of all) assert.equal(Number(i.qty), Number(i.opening_qty) + Number(i.in_qty) - Number(i.out_qty));
  const it = all.find((x) => x.branch_id === SEED_IDS.branchCentral && x.active);
  // stock changes only through documents (audit 2026-10-25): an issue beyond the usable stock is refused, a receipt adds
  const out = await manager.post('/warehouse/issues', { branch_id: it.branch_id, purpose: 'department', department: 'Sinov', receiver_membership_id: M.doctor(0), lines: [{ item_id: it.id, qty: Number(it.qty) + 1 }] });
  assert.equal(out.status, 409); assert.equal(out.body.error.code, 'INSUFFICIENT_STOCK');
  assert.equal((await manager.post('/warehouse/receipts', { branch_id: it.branch_id, supplier: 'Sinov ta’minot', invoice_no: 'P1-1', invoice_date: (await manager.get('/me')).body.data.today,
    lines: [{ item_id: it.id, batch_no: 'P1', qty: 5, unit_cost: 100 }] }, { 'Idempotency-Key': randomUUID() })).status, 201);
  const after = (await manager.get(`/inventory/${it.id}`)).body.data;
  assert.equal(Number(after.qty), Number(it.qty) + 5);
});

test('UZI: faqat bajaruvchi mutaxassis yozadi/tasdiqlaydi; tasdiqlangan xulosa o‘zgarmaydi', async () => {
  const list = (await uzi.get('/diagnostics')).body.data;
  assert.ok(list.length >= 1);
  const draft = list.find((o) => o.report_status !== 'signed');
  assert.ok(draft);
  const foreign = await doctor.put(`/diagnostics/${draft.id}`, { description: 'x', conclusion: 'y' });
  assert.ok([403, 404].includes(foreign.status), 'boshqa shifokor xulosa yozolmaydi');
  assert.equal((await uzi.post(`/diagnostics/${draft.id}/sign`, { description: 'Tavsif' })).status, 422);
  assert.equal((await uzi.post(`/diagnostics/${draft.id}/sign`, { description: 'Tavsif', conclusion: 'Xulosa' })).status, 200);
  assert.equal((await uzi.put(`/diagnostics/${draft.id}`, { description: 'o‘zgartirish', conclusion: 'z' })).status, 409);
  assert.equal((await manager.get(`/diagnostics/${draft.id}`)).status, 403, 'rahbar klinik xulosani o‘qimaydi');
});

test('AI namunaviy rejim: faqat demo matni, boshqa matnga uydirma javob yo‘q; rol cheklovi', async () => {
  assert.equal((await doctor.get('/ai/status')).body.data.mode, 'sample');
  const ok = await doctor.post('/ai/note-draft', { text: SAMPLE_NOTE_TEXT });
  assert.equal(ok.status, 200); assert.equal(ok.body.data.mode, 'sample');
  const other = await doctor.post('/ai/note-draft', { text: 'Bemor bosh og‘rig‘idan shikoyat qiladi, 2 kundan beri.' });
  assert.equal(other.status, 422); assert.equal(other.body.error.code, 'AI_SAMPLE_ONLY');
  assert.equal((await cashier.post('/ai/note-draft', { text: SAMPLE_NOTE_TEXT })).status, 403);
  const rep = await manager.post('/ai/report-explanation', { question: 'debts' });
  const debts = (await manager.get('/invoices?debt=1&page_size=1')).body.meta;
  assert.equal(rep.body.data.facts.invoices, debts.total);
  assert.equal(rep.body.data.facts.debt, debts.sums.due);
});

test('CSV eksport formula in’ektsiyasidan himoyalangan va filtrga mos', async () => {
  const csv = await manager.get('/payments/export.csv?from=2026-10-01&to=2026-10-18');
  assert.equal(csv.status, 200);
  const lines = csv.text.trim().split('\r\n');
  const meta = (await manager.get('/payments?from=2026-10-01&to=2026-10-18&page_size=1')).body.meta;
  assert.equal(lines.length - 2, meta.total); // header + rows + the totals row
  assert.match(lines[lines.length - 1], /^"Jami";/);
  assert.ok(lines.slice(1).every((l) => !/;"[=+\-@]/.test(l)));
});

test('shifokor ulushi = Σ(qiymat × foiz snapshot); shifokor faqat o‘zini ko‘radi', async () => {
  const mine = (await doctor.get('/reports/doctors?period=30d')).body.data;
  assert.equal(mine.length, 1);
  const det = (await doctor.get(`/staff/doctors/${SEED_IDS.doctor(0)}?period=30d`)).body.data;
  assert.equal(mine[0].share, det.services.reduce((a, s) => a + s.share, 0));
  // the percent behind the amount is the manager's (audit 2026-10-25, B20)
  assert.ok(det.services.every((s) => s.share_percent_snapshot === null) && det.doctor.default_share_percent === null);
  const full = (await manager.get(`/staff/doctors/${SEED_IDS.doctor(0)}?period=30d`)).body.data;
  for (const s of full.services) assert.equal(s.share, Math.round(s.line_total * Number(s.share_percent_snapshot) / 100));
  assert.equal((await doctor.get(`/staff/doctors/${SEED_IDS.doctor(1)}`)).status, 403);
});
