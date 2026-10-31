// MedPlus → Med.uz.ai full switch («O‘tishni yakunlash», migration 044, docs/MEDPLUS_SYNC.md «Full switch»): the
// mirrored cards, visits, lines and invoices become ordinary rows (editable, payable in our shift with a fiscal row),
// MedPlus's payments stay mirrored history, overlapping MedPlus visits survive, waiting records block unless dropped,
// the source is closed for good (no batch, no file, no new key), manager-only and tenant-scoped.
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
    const isForm = body instanceof FormData;
    const r = await fetch(base + path, { method, headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), cookie, ...headers }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), patch: (p, b) => req('PATCH', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const key = () => ({ 'Idempotency-Key': randomUUID() });
const one = async (sql, p = []) => (await pool.query(sql, p)).rows[0];

let manager, cashier, registrar, t2manager, source, token;
async function bridge(records, tok = token) {
  const r = await fetch(`${base}/integrations/${source.id}/batch`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ records }) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
const refOf = async (kind, ext) => (await one(`SELECT our_id FROM external_refs WHERE source_id = $1 AND kind = $2 AND external_id = $3`, [source.id, kind, ext])).our_id;

before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  cashier = session(); await cashier.demo(M.cashier);
  registrar = session(); await registrar.demo(M.registrar);
  t2manager = session(); await t2manager.demo(M.tenant2Manager);
  source = (await manager.get('/integrations/sources')).body.data[0];
  token = (await manager.post(`/integrations/sources/${source.id}/token`)).body.data.token;
});
after(async () => { await app?.close(); });

// MedPlus history: one card with an unpaid line (a debt), two overlapping visits of one doctor, a paid visit
const HISTORY = [
  { kind: 'patient', external_id: '40001', data: { full_name: 'Sinovova Dilnoza Karimovna', birth_date: '05.06.1992', sex: 'Ж', phone: '+998 90 400 00 01' } },
  { kind: 'visit', external_id: 'cv-1', data: { patient_id: '40001', branch_id: '1', doctor_name: 'Karimov Bahodir', service_name: 'Консультация терапевта', starts_at: '2026-10-16 10:00:00', duration_min: 30 } },
  { kind: 'visit', external_id: 'cv-2', data: { patient_id: '27102', branch_id: '1', doctor_name: 'Karimov Bahodir', service_name: 'Консультация терапевта', starts_at: '2026-10-16 10:10:00', duration_min: 30 } },
  { kind: 'order', external_id: 'co-1', data: { patient_id: '40001', visit_id: 'cv-1', service_name: 'Консультация терапевта', price: 150_000_00, ordered_at: '2026-10-16 10:05' } },
  { kind: 'order', external_id: 'co-2', data: { patient_id: '27102', visit_id: 'cv-2', service_name: 'Консультация терапевта', price: 150_000_00, ordered_at: '2026-10-16 10:15' } },
  { kind: 'payment', external_id: 'cp-1', data: { patient_id: '40001', branch_id: '1', amount: 50_000_00, method: 'Наличными', paid_at: '2026-10-16 10:40:00' } },
  { kind: 'payment', external_id: 'cp-2', data: { patient_id: '27102', branch_id: '1', amount: 150_000_00, method: 'Терминал', paid_at: '2026-10-16 10:45:00' } },
];

test('o‘tishdan oldin: ko‘rinish sanog‘i to‘g‘ri, bemor va hisob faqat o‘qish; boshqa rollar 403, boshqa klinika 404', async () => {
  const r = await bridge(HISTORY);
  assert.equal(r.status, 200); assert.equal(r.body.data.errors, 0, JSON.stringify(r.body.data)); assert.equal(r.body.data.parked, 0);
  const pv = (await manager.get(`/integrations/sources/${source.id}/cutover`)).body.data;
  assert.equal(pv.done, false);
  // demo seed: 3 patients, 2 visits, 3 lines, 2 payments — plus this history
  assert.deepEqual([pv.counts.patients, pv.counts.visits, pv.counts.orders, pv.counts.payments, pv.counts.pending], [4, 4, 5, 4, 0]);
  assert.equal(pv.counts.debt_invoices, 1); assert.equal(pv.counts.debt_sum, 100_000_00);
  const p = await refOf('patient', '40001');
  assert.equal((await registrar.patch(`/patients/${p}`, { last_name: 'Boshqa' })).body.error.code, 'MIRRORED_RECORD');
  for (const who of [cashier, registrar]) {
    assert.equal((await who.get(`/integrations/sources/${source.id}/cutover`)).status, 403);
    assert.equal((await who.post(`/integrations/sources/${source.id}/cutover`, { confirm: true })).status, 403);
  }
  assert.equal((await t2manager.get(`/integrations/sources/${source.id}/cutover`)).status, 404);
  assert.equal((await t2manager.post(`/integrations/sources/${source.id}/cutover`, { confirm: true })).status, 404);
  assert.equal((await manager.post(`/integrations/sources/${source.id}/cutover`, {})).status, 422, 'tasdiqsiz yo‘q');
});

test('kutayotgan yozuv o‘tishni to‘xtatadi; «tashlab yuborish» bilan o‘tadi', async () => {
  // a payment whose services never arrived waits
  const r = await bridge([{ kind: 'payment', external_id: 'cp-9', data: { patient_id: '40001', branch_id: '1', amount: 900_000_00, method: 'Наличными', paid_at: '2026-10-16 12:00' } }]);
  assert.equal(r.body.data.parked, 1);
  const blocked = await manager.post(`/integrations/sources/${source.id}/cutover`, { confirm: true });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'PENDING_RECORDS');
  assert.equal((await one(`SELECT cutover_at FROM external_sources WHERE id = $1`, [source.id])).cutover_at, null, 'hech narsa o‘zgarmadi');
  const ok = await manager.post(`/integrations/sources/${source.id}/cutover`, { confirm: true, discard_pending: true });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.data.counts.patients, 4); assert.equal(ok.body.data.counts.pending_dropped, 1);
  const s = await one(`SELECT active, token_hash, cutover_at, cutover_by_name FROM external_sources WHERE id = $1`, [source.id]);
  assert.deepEqual([s.active, s.token_hash, !!s.cutover_at], [false, null, true]);
  assert.equal((await one(`SELECT count(*)::int AS n FROM external_pending WHERE source_id = $1`, [source.id])).n, 0);
  const a = await one(`SELECT summary FROM audit_logs WHERE action = 'sync.cutover' ORDER BY occurred_at DESC LIMIT 1`);
  assert.ok(a && !/Sinovova|Dilnoza|\+998/.test(a.summary), 'auditda shaxsiy ma’lumot yo‘q');
});

test('o‘tishdan keyin: karta tahrirlanadi, eski qarz bizning smenada to‘lanadi (fiskal yozuv bilan), MedPlus to‘lovlari tarix', async () => {
  const p = await refOf('patient', '40001');
  assert.equal((await one(`SELECT count(*)::int AS n FROM patients WHERE external_source_id = $1`, [source.id])).n, 0);
  assert.equal((await one(`SELECT imported_source_id FROM patients WHERE id = $1`, [p])).imported_source_id, source.id, 'qayerdan kelgani saqlanadi');
  const card = (await registrar.get(`/patients/${p}`)).body.data;
  assert.equal(card.mirror, null, 'MedPlus nishoni yo‘q — tahrirlash mumkin');
  const ed = await registrar.patch(`/patients/${p}`, { last_name: 'Yangiyeva' });
  assert.equal(ed.status, 200, ed.text);
  // the old debt is paid at our desk: our shift, a fiscal row
  const inv = await refOf('invoice', 'visit:cv-1');
  const before = await one(`SELECT total, paid_amount, external_source_id, imported_source_id FROM invoices WHERE id = $1`, [inv]);
  assert.deepEqual([Number(before.total), Number(before.paid_amount), before.external_source_id, before.imported_source_id], [150_000_00, 50_000_00, null, source.id]);
  const pay = await cashier.post(`/invoices/${inv}/payments`, { amount: 100_000_00, method: 'cash' }, key());
  assert.equal(pay.status, 201, pay.text);
  const rows = (await pool.query(`SELECT amount, shift_id, external_source_id FROM payments WHERE invoice_id = $1 ORDER BY paid_at`, [inv])).rows;
  assert.equal(rows.length, 2);
  assert.deepEqual([Number(rows[0].amount), rows[0].shift_id, rows[0].external_source_id], [50_000_00, null, source.id], 'MedPlus to‘lovi tarix bo‘lib qoladi');
  assert.ok(rows[1].shift_id, 'yangi to‘lov kassir smenasida'); assert.equal(rows[1].external_source_id, null);
  assert.equal((await one(`SELECT status FROM invoices WHERE id = $1`, [inv])).status, 'paid');
  const fiscal = (await pool.query(`SELECT f.payment_id FROM fiscal_receipts f JOIN payments pm ON pm.id = f.payment_id WHERE pm.invoice_id = $1`, [inv])).rows;
  assert.equal(fiscal.length, 1, 'faqat yangi to‘lovga fiskal yozuv');
  // MedPlus's overlapping visits of one doctor are kept as they were
  const ov = (await pool.query(`SELECT a.status FROM appointments a JOIN external_refs x ON x.our_id = a.id WHERE x.source_id = $1 AND x.external_id IN ('cv-1','cv-2')`, [source.id])).rows;
  assert.equal(ov.length, 2);
});

test('yopilgan manba: paket, fayl, yangi kalit, qayta yoqish, ikkinchi o‘tish — rad; baza ham himoyalaydi', async () => {
  assert.equal((await bridge([])).status, 401, 'eski kalit ishlamaydi');
  assert.equal((await manager.post(`/integrations/sources/${source.id}/token`)).body.error.code, 'SOURCE_CLOSED');
  assert.equal((await manager.patch(`/integrations/sources/${source.id}`, { active: true })).body.error.code, 'SOURCE_CLOSED');
  const fd = new FormData(); fd.append('kind', 'patients'); fd.append('file', new Blob(['ID;ФИО;Дата рож.\n1;Test Test;01.01.1990\n']), 'p.csv');
  assert.equal((await manager.post(`/integrations/sources/${source.id}/import`, fd)).body.error.code, 'SOURCE_CLOSED');
  const again = await manager.post(`/integrations/sources/${source.id}/cutover`, { confirm: true });
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'SOURCE_CLOSED');
  const info = (await manager.get(`/integrations/sources/${source.id}/cutover`)).body.data;
  assert.equal(info.done, true); assert.equal(info.cutover_counts.patients, 4);
  // history screens still answer
  assert.equal((await manager.get(`/integrations/sources/${source.id}/log`)).status, 200);
  await assert.rejects(pool.query(`UPDATE external_sources SET active = true WHERE id = $1`, [source.id]), (e) => e.code === 'MR409');
  await assert.rejects(pool.query(`UPDATE external_sources SET cutover_at = NULL WHERE id = $1`, [source.id]), (e) => e.code === 'MR409');
  const p = await refOf('patient', '40001');
  await assert.rejects(pool.query(`UPDATE patients SET imported_source_id = NULL WHERE id = $1`, [p]), (e) => e.code === 'MR409');
  await assert.rejects(pool.query(`UPDATE patients SET external_source_id = $2 WHERE id = $1`, [p, source.id]), (e) => e.code === 'MR409');
});
