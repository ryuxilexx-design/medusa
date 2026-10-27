// MedPlus mirror (migration 042, docs/MEDPLUS_SYNC.md): bridge token auth, idempotent and order-independent upserts,
// patient matching and the duplicate flag, mirrored payments (no shift, no fiscal row, cash-basis revenue), read-only
// mirrored rows (409 MIRRORED_RECORD), tenant isolation, manager-only screens, XLSX writer/reader, file import through
// the bridge's upsert path, CSV/XLSX totals rows, and the bridge core posting to the real endpoint.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
const { buildXlsx, readXlsx, readTable, zip, unzip, openZip } = require('../dist/core/xlsx.js');
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const isForm = body instanceof FormData;
    const r = await fetch(base + path, { method, headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), cookie, ...headers }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const buf = Buffer.from(await r.arrayBuffer());
    const t = buf.toString('utf8'); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t, buf, headers: r.headers };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), patch: (p, b) => req('PATCH', p, b), put: (p, b) => req('PUT', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const key = () => ({ 'Idempotency-Key': randomUUID() });

let manager, cashier, registrar, doctor, t2manager;
let source, token;
const CENTRAL = SEED_IDS.branchCentral;

async function bridge(records, tok = token, sid = source.id, extra = {}) {
  const r = await fetch(`${base}/integrations/${sid}/batch`, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify({ records, ...extra }) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
const one = async (sql, p = []) => (await pool.query(sql, p)).rows[0];

before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  cashier = session(); await cashier.demo(M.cashier);
  registrar = session(); await registrar.demo(M.registrar);
  doctor = session(); await doctor.demo(M.doctor(1));
  t2manager = session(); await t2manager.demo(M.tenant2Manager);
});
after(async () => { await app?.close(); });

// ---------------------------------------------------------------- source and token

let t2source, t2token;
test('manba: demo klinikada kalitsiz MedPlus (demo) bor; rahbar ulaydi, kalit bir marta ko‘rsatiladi (faqat xeshi), ikkinchisi 409', async () => {
  const list = (await manager.get('/integrations/sources')).body.data;
  assert.equal(list.length, 1, 'demo manbasi');
  assert.equal(list[0].has_token, false); assert.equal(list[0].token, undefined, 'ro‘yxatda kalit yo‘q');
  source = list[0];
  assert.equal((await manager.post('/integrations/sources', { name: 'Yana' })).body.error.code, 'SOURCE_EXISTS');
  // the demo records came through the real path: mirrored patients, paid invoices, no debt, no pending
  const st = (await manager.get(`/integrations/sources/${source.id}/status`)).body.data;
  assert.deepEqual([st.counts.patients, st.counts.visits, st.counts.orders, st.counts.payments, st.pending_total], [3, 2, 3, 2, 0]);
  assert.equal((await one(`SELECT count(*)::int AS n FROM invoices WHERE external_source_id = $1 AND status <> 'paid'`, [source.id])).n, 0);
  // a new connection in the second clinic: the token is shown once, only its hash is stored
  const r = await t2manager.post('/integrations/sources', { name: 'MedPlus Markaz' });
  assert.equal(r.status, 201, r.text);
  t2source = r.body.data; t2token = r.body.data.token;
  assert.match(t2token, /^mps_[A-Za-z0-9_-]{43}$/);
  assert.equal(t2source.has_token, true);
  const row = await one(`SELECT token_hash FROM external_sources WHERE id = $1`, [t2source.id]);
  assert.notEqual(row.token_hash, t2token); assert.equal(row.token_hash.length, 64);
  assert.equal((await t2manager.get('/integrations/sources')).body.data[0].token, undefined);
  assert.equal((await t2manager.post('/integrations/sources', {})).body.error.code, 'SOURCE_EXISTS');
  assert.equal((await one(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'sync.source_create' AND summary LIKE '%mps_%'`)).n, 0, 'auditda kalit yo‘q');
  // the demo source gets its first key from «Yangi kalit»
  const rot = await manager.post(`/integrations/sources/${source.id}/token`);
  assert.equal(rot.status, 200); token = rot.body.data.token;
  assert.equal((await manager.get('/integrations/sources')).body.data[0].has_token, true);
});

test('kalit: yo‘q / noto‘g‘ri / boshqa manba → 401; to‘xtatilgan yoki almashtirilgan kalit → 401; to‘g‘risi → 200', async () => {
  assert.equal((await bridge([], null)).status, 401);
  assert.equal((await bridge([], 'mps_' + 'x'.repeat(43))).status, 401);
  assert.equal((await bridge([], token, randomUUID())).status, 401);
  assert.equal((await bridge([], 'Bearer-less')).status, 401);
  const ok = await bridge([]);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.received, 0);
  // paused → 401, resumed → 200
  assert.equal((await manager.patch(`/integrations/sources/${source.id}`, { active: false })).status, 200);
  assert.equal((await bridge([])).status, 401);
  await manager.patch(`/integrations/sources/${source.id}`, { active: true });
  // rotated: the old key is revoked at once
  const rot = await manager.post(`/integrations/sources/${source.id}/token`);
  assert.equal(rot.status, 200);
  assert.equal((await bridge([], token)).status, 401, 'eski kalit ishlamaydi');
  token = rot.body.data.token;
  assert.equal((await bridge([])).status, 200);
  assert.ok((await one(`SELECT last_seen_at FROM external_sources WHERE id = $1`, [source.id])).last_seen_at);
});

test('faqat rahbar: boshqa rollar 403, boshqa klinika rahbari 404', async () => {
  const paths = [['get', '/integrations/sources'], ['post', '/integrations/sources'], ['get', `/integrations/sources/${source.id}/status`], ['get', `/integrations/sources/${source.id}/mappings`],
    ['get', `/integrations/sources/${source.id}/duplicates`], ['get', `/integrations/sources/${source.id}/pending`], ['get', `/integrations/sources/${source.id}/log`],
    ['get', `/integrations/sources/${source.id}/reconciliation`], ['post', `/integrations/sources/${source.id}/token`], ['patch', `/integrations/sources/${source.id}`],
    ['post', `/integrations/sources/${source.id}/import/preview`], ['post', `/integrations/sources/${source.id}/import`]];
  for (const who of [cashier, registrar, doctor]) for (const [m, p] of paths) assert.equal((await who[m](p, m === 'get' ? undefined : {})).status, 403, `${m} ${p}`);
  for (const [m, p] of paths.slice(2)) assert.equal((await t2manager[m](p, m === 'get' ? undefined : {})).status, 404, `t2 ${m} ${p}`);
  assert.deepEqual((await t2manager.get('/integrations/sources')).body.data.map((x) => x.id), [t2source.id]);
  const anon = await fetch(`${base}/integrations/sources`); assert.equal(anon.status, 401);
});

// ---------------------------------------------------------------- the mirror

const P1 = { kind: 'patient', external_id: '28354', data: { full_name: 'Abdullayeva Malika Rustamovna', birth_date: '12.03.1988', sex: 'Ж', phone: '99 812 34 56', address: 'Toshkent' } };
const BR = [{ kind: 'branch', external_id: '1', data: { name: 'Markaziy filial' } }, { kind: 'branch', external_id: '3', data: { name: 'Medwell' } }];
const V1 = { kind: 'visit', external_id: 'v-1', data: { patient_id: '28354', branch_id: '1', doctor_name: 'Karimov Bahodir', service_name: 'Терапевт консультация', starts_at: '2026-10-15 10:00:00' } };
const O1 = { kind: 'order', external_id: 'o-1', data: { patient_id: '28354', visit_id: 'v-1', service_name: 'Терапевт консультация', doctor_name: 'Karimov Bahodir', price: 150_000_00, discount: 10_000_00, doctor_percent: 30, ordered_at: '2026-10-15 10:05' } };
const O2 = { kind: 'order', external_id: 'o-2', data: { patient_id: '28354', visit_id: 'v-1', service_name: 'Общий анализ крови', price: 60_000_00, ordered_at: '2026-10-15 10:10' } };
const PM1 = { kind: 'payment', external_id: 'k-1', data: { patient_id: '28354', branch_id: '1', amount: 200_000_00, method: 'Наличными', paid_at: '2026-10-15 10:30:00', cashier: 'Ахмедова Г.' } };

let shiftBefore, revenueBefore, patient1, invoice1, payment1;
test('paket: bemor, tashrif, xizmatlar va to‘lov ko‘chiriladi — MedPlus narxi, shifokor %, smenasiz, fiskalsiz', async () => {
  shiftBefore = (await cashier.get('/cash-shifts/current')).body.data;
  assert.ok(shiftBefore, 'seed: kassirning ochiq smenasi');
  revenueBefore = (await manager.get('/finance/summary?from=2026-10-15&to=2026-10-15')).body.data;
  const r = await bridge([PM1, O2, O1, V1, P1, ...BR], token, source.id, { cursor: { payment: '{"id":1}' } }); // deliberately shuffled
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // branch «1» is already known (the demo mapped it): 6 new + 1 unchanged
  assert.deepEqual({ received: r.body.data.received, created: r.body.data.created, unchanged: r.body.data.unchanged, parked: r.body.data.parked, errors: r.body.data.errors }, { received: 7, created: 6, unchanged: 1, parked: 0, errors: 0 }, JSON.stringify(r.body.data));
  patient1 = (await one(`SELECT our_id FROM external_refs WHERE source_id = $1 AND kind = 'patient' AND external_id = '28354'`, [source.id])).our_id;
  const p = (await manager.get(`/patients/${patient1}`)).body.data;
  assert.equal(p.last_name, 'Abdullayeva'); assert.equal(p.first_name, 'Malika'); assert.equal(p.middle_name, 'Rustamovna');
  assert.equal(p.birth_date.slice(0, 10), '1988-03-12'); assert.equal(p.sex, 'female'); assert.equal(p.phone, '+998998123456');
  assert.deepEqual(p.mirror, { kind: 'medplus', external_id: '28354' }, 'nishon uchun');
  invoice1 = (await one(`SELECT our_id FROM external_refs WHERE source_id = $1 AND kind = 'invoice' AND external_id = 'visit:v-1'`, [source.id])).our_id;
  const inv = (await manager.get(`/invoices/${invoice1}`)).body.data;
  assert.equal(Number(inv.subtotal), 210_000_00); assert.equal(Number(inv.discount_amount), 10_000_00); assert.equal(Number(inv.total), 200_000_00);
  assert.equal(Number(inv.paid_amount), 200_000_00); assert.equal(inv.status, 'paid');
  assert.ok(inv.external_source_id);
  assert.equal(inv.payments.length, 1); assert.equal(inv.payments[0].fiscal, null, 'fiskal yozuvi yo‘q'); assert.equal(inv.payments[0].mirrored, true);
  payment1 = inv.payments[0].id;
  const pay = await one(`SELECT method, shift_id, cashier_name, cashier_membership_id, paid_at FROM payments WHERE id = $1`, [payment1]);
  assert.deepEqual([pay.method, pay.shift_id, pay.cashier_membership_id, pay.cashier_name], ['cash', null, null, 'Ахмедова Г.']);
  assert.equal(pay.paid_at.toISOString(), '2026-10-15T05:30:00.000Z', 'MedPlus vaqti — Toshkent');
  assert.equal((await one(`SELECT count(*)::int AS n FROM fiscal_receipts WHERE payment_id = $1`, [payment1])).n, 0);
  const o1 = await one(`SELECT o.price_snapshot, o.share_percent_snapshot, o.status, o.category, d.display_name, d.active FROM service_orders o JOIN external_refs x ON x.our_id = o.id LEFT JOIN doctors d ON d.id = o.doctor_id WHERE x.source_id = $1 AND x.external_id = 'o-1'`, [source.id]);
  assert.deepEqual([Number(o1.price_snapshot), Number(o1.share_percent_snapshot), o1.status, o1.display_name, o1.active], [150_000_00, 30, 'completed', 'Karimov Bahodir', false], 'MedPlus narxi va foizi, shifokor — vaqtinchalik yozuv');
  const o2 = await one(`SELECT o.category, s.name, s.active FROM service_orders o JOIN services s ON s.id = o.service_id JOIN external_refs x ON x.our_id = o.id WHERE x.source_id = $1 AND x.external_id = 'o-2'`, [source.id]);
  assert.deepEqual([o2.category, o2.name, o2.active], ['lab', 'MedPlus: Общий анализ крови', false]);
  // drawer untouched, revenue includes it (cash basis)
  const shiftAfter = (await cashier.get('/cash-shifts/current')).body.data;
  assert.deepEqual(shiftAfter.totals, shiftBefore.totals, 'kassir smenasiga tegmaydi');
  assert.equal(shiftAfter.expected_cash, shiftBefore.expected_cash);
  const rev = (await manager.get('/finance/summary?from=2026-10-15&to=2026-10-15')).body.data;
  assert.equal(rev.payments.total - revenueBefore.payments.total, 200_000_00);
  assert.equal(rev.net_revenue - revenueBefore.net_revenue, 200_000_00);
  assert.equal(rev.fiscal.missing, revenueBefore.fiscal.missing);
  // the cashier's own register does not show MedPlus money
  assert.ok(!(await cashier.get('/payments?from=2026-10-15&to=2026-10-15&page_size=100')).body.data.some((x) => x.id === payment1));
  assert.ok((await manager.get('/payments?from=2026-10-15&to=2026-10-15&page_size=100')).body.data.find((x) => x.id === payment1).mirrored);
  // the appointment is a completed MedPlus visit; no reminder is planned for mirrored visits
  const a = await one(`SELECT a.status, a.external_source_id IS NOT NULL AS m FROM appointments a JOIN external_refs x ON x.our_id = a.id WHERE x.source_id = $1 AND x.external_id = 'v-1'`, [source.id]);
  assert.deepEqual([a.status, a.m], ['completed', true]);
  assert.equal((await one(`SELECT last_cursor FROM external_sources WHERE id = $1`, [source.id])).last_cursor.payment, '{"id":1}');
});

test('idempotent: o‘sha paket ikki marta — dublikat yo‘q, hammasi «o‘zgarmagan»', async () => {
  const before = await one(`SELECT (SELECT count(*) FROM patients)::int AS p, (SELECT count(*) FROM payments)::int AS pm, (SELECT count(*) FROM service_orders)::int AS o, (SELECT count(*) FROM invoices)::int AS i`);
  const r = await bridge([P1, ...BR, V1, O1, O2, PM1]);
  assert.equal(r.body.data.created, 0); assert.equal(r.body.data.unchanged, 7, JSON.stringify(r.body.data)); assert.equal(r.body.data.errors, 0);
  assert.deepEqual(await one(`SELECT (SELECT count(*) FROM patients)::int AS p, (SELECT count(*) FROM payments)::int AS pm, (SELECT count(*) FROM service_orders)::int AS o, (SELECT count(*) FROM invoices)::int AS i`), before);
});

test('tartibsiz kelish: to‘lov va xizmat bemordan oldin — kutadi, bemor kelganda qo‘llanadi', async () => {
  const pay = { kind: 'payment', external_id: 'k-2', data: { patient_id: '30001', branch_id: '1', amount: 80_000_00, method: 'Терминал', paid_at: '2026-10-16 12:00' } };
  const ord = { kind: 'order', external_id: 'o-3', data: { patient_id: '30001', branch_id: '1', service_name: 'УЗИ брюшной полости', price: 80_000_00, ordered_at: '2026-10-16 11:40' } };
  const r1 = await bridge([pay, ord]);
  assert.equal(r1.body.data.parked, 2, JSON.stringify(r1.body.data));
  const pend = (await manager.get(`/integrations/sources/${source.id}/pending`)).body.data;
  assert.deepEqual(pend.map((x) => [x.kind, x.external_id, x.reason]).sort(), [['order', 'o-3', 'patient_missing'], ['payment', 'k-2', 'patient_missing']]);
  assert.ok(!('record' in pend[0]), 'kutilayotgan yozuv mazmuni ko‘rsatilmaydi');
  const r2 = await bridge([{ kind: 'patient', external_id: '30001', data: { last_name: 'Toshmatov', first_name: 'Sardor', birth_date: '2001-05-05', phone: '+998935550011' } }]);
  assert.equal(r2.body.data.created, 1); assert.equal(r2.body.data.applied_pending, 2, JSON.stringify(r2.body.data));
  assert.equal((await manager.get(`/integrations/sources/${source.id}/pending`)).body.meta.total, 0);
  const inv = await one(`SELECT i.status, i.total, i.paid_amount, i.appointment_id FROM invoices i JOIN external_refs x ON x.our_id = i.id WHERE x.source_id = $1 AND x.kind = 'invoice' AND x.external_id LIKE 'day:30001:%'`, [source.id]);
  assert.deepEqual([inv.status, Number(inv.total), Number(inv.paid_amount), inv.appointment_id], ['paid', 80_000_00, 80_000_00, null], 'tashrifsiz xizmat — kunlik hisob');
  assert.equal((await one(`SELECT method FROM payments p JOIN external_refs x ON x.our_id = p.id WHERE x.source_id = $1 AND x.external_id = 'k-2'`, [source.id])).method, 'card');
});

test('noma’lum to‘lov usuli va filial: kutadi; rahbar moslashtirsa qo‘llanadi', async () => {
  const pay = { kind: 'payment', external_id: 'k-3', data: { patient_id: '28354', branch_id: '1', amount: 1000_00, method: 'Сертификат', paid_at: '2026-10-16 13:00' } };
  const ord = { kind: 'order', external_id: 'o-4', data: { patient_id: '28354', branch_id: '1', service_name: 'Справка', price: 1000_00, ordered_at: '2026-10-16 12:50' } };
  const ord2 = { kind: 'order', external_id: 'o-5', data: { patient_id: '28354', branch_id: '3', service_name: 'Справка', price: 500_00, ordered_at: '2026-10-16 12:55' } };
  const r = await bridge([ord, pay, ord2]);
  assert.equal(r.body.data.created, 1); assert.equal(r.body.data.parked, 2, JSON.stringify(r.body.data));
  const st = (await manager.get(`/integrations/sources/${source.id}/status`)).body.data;
  assert.ok(st.pending.some((x) => x.reason === 'method_unmapped') && st.pending.some((x) => x.reason === 'branch_unmapped'));
  // map the payment form
  const m = (await manager.get(`/integrations/sources/${source.id}/mappings?kind=method`)).body.data.find((x) => x.external_name === 'Сертификат');
  assert.equal(m.target_code, null);
  assert.equal((await registrar.patch(`/integrations/sources/${source.id}/mappings/${m.id}`, { target_code: 'transfer' })).status, 403);
  const set = await manager.patch(`/integrations/sources/${source.id}/mappings/${m.id}`, { target_code: 'transfer' });
  assert.equal(set.status, 200, set.text); assert.equal(set.body.data.applied_pending, 1);
  // map «Medwell» to Yunusobod
  const b = (await manager.get(`/integrations/sources/${source.id}/mappings?kind=branch`)).body.data;
  assert.equal(b.find((x) => x.external_id === '1').target_id, CENTRAL, 'nomi bo‘yicha topildi');
  assert.equal(b.find((x) => x.external_id === '2').target_id, SEED_IDS.branchYunusobod, 'demo: nomi bo‘yicha');
  const medwell = b.find((x) => x.external_id === '3');
  assert.equal(medwell.target_id, null);
  const targets = (await manager.get(`/integrations/sources/${source.id}/targets?kind=branch`)).body.data;
  assert.equal(targets.length, 2);
  assert.equal((await manager.patch(`/integrations/sources/${source.id}/mappings/${medwell.id}`, { target_id: SEED_IDS.branchTenant2 })).status, 422, 'boshqa klinika filiali');
  const s2 = await manager.patch(`/integrations/sources/${source.id}/mappings/${medwell.id}`, { target_id: SEED_IDS.branchYunusobod });
  assert.equal(s2.body.data.applied_pending, 1);
  assert.equal((await one(`SELECT o.branch_id FROM service_orders o JOIN external_refs x ON x.our_id = o.id WHERE x.source_id = $1 AND x.external_id = 'o-5'`, [source.id])).branch_id, SEED_IDS.branchYunusobod);
  assert.equal((await one(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'sync.mapping'`)).n, 2);
});

test('xizmat moslashtirish: keyingi yozuvlar yangi xizmatga, eskilari o‘z nusxasida qoladi', async () => {
  const maps = (await manager.get(`/integrations/sources/${source.id}/mappings?kind=service&review=1`)).body.data;
  const m = maps.find((x) => x.external_name === 'Справка');
  assert.equal(m.placeholder, true); assert.equal(m.status, 'auto');
  const targets = (await manager.get(`/integrations/sources/${source.id}/targets?kind=service`)).body.data;
  assert.ok(!targets.some((t) => t.id === m.target_id), 'vaqtinchalik xizmat ro‘yxatda yo‘q');
  const real = targets.find((t) => /konsult/i.test(t.name)) ?? targets[0];
  await manager.patch(`/integrations/sources/${source.id}/mappings/${m.id}`, { target_id: real.id });
  await bridge([{ kind: 'order', external_id: 'o-6', data: { patient_id: '28354', branch_id: '1', service_name: 'Справка', price: 700_00, ordered_at: '2026-10-16 14:00' } }]);
  const rows = (await pool.query(`SELECT x.external_id, o.service_id FROM service_orders o JOIN external_refs x ON x.our_id = o.id WHERE x.source_id = $1 AND x.external_id IN ('o-4','o-6') ORDER BY 1`, [source.id])).rows;
  assert.equal(rows[0].service_id, m.target_id, 'eski yozuv o‘zgarmadi');
  assert.equal(rows[1].service_id, real.id, 'yangisi tasdiqlangan xizmatga');
});

test('bemorni moslash: JShShIR, telefon + tug‘ilgan sana bilan mavjud kartaga bog‘lanadi; noaniq — yangi karta + dublikat belgisi', async () => {
  const seed = (await pool.query(`SELECT id, last_name, first_name, birth_date, phone FROM patients p WHERE tenant_id = $1 AND phone IS NOT NULL AND external_source_id IS NULL AND anonymised_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM patients o WHERE o.tenant_id = p.tenant_id AND o.id <> p.id AND o.phone = p.phone AND o.birth_date = p.birth_date) ORDER BY patient_number LIMIT 6`, [SEED_IDS.tenant])).rows;
  // PINFL
  await pool.query(`UPDATE patients SET pinfl = '31212880000011' WHERE id = $1`, [seed[0].id]);
  const n0 = (await one(`SELECT count(*)::int AS n FROM patients`)).n;
  const r1 = await bridge([{ kind: 'patient', external_id: 'p-pinfl', data: { full_name: 'Boshqa Yozilgan Ism', birth_date: '1970-01-01', pinfl: '31212880000011' } }]);
  assert.equal(r1.body.data.updated, 1, JSON.stringify(r1.body.data));
  assert.equal((await one(`SELECT our_id FROM external_refs WHERE source_id = $1 AND external_id = 'p-pinfl'`, [source.id])).our_id, seed[0].id);
  const linked = await one(`SELECT last_name, external_source_id FROM patients WHERE id = $1`, [seed[0].id]);
  assert.equal(linked.last_name, seed[0].last_name, 'bog‘lashda o‘z ma’lumoti saqlanadi'); assert.equal(linked.external_source_id, source.id);
  // phone + birth date (+ name)
  const s = seed[1];
  const bd = typeof s.birth_date === 'string' ? s.birth_date.slice(0, 10) : new Date(s.birth_date.getTime() - s.birth_date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const uniq = (await one(`SELECT count(*)::int AS n FROM patients WHERE tenant_id = $1 AND phone = $2 AND birth_date = $3`, [SEED_IDS.tenant, s.phone, bd])).n;
  assert.equal(uniq, 1);
  await bridge([{ kind: 'patient', external_id: 'p-phone', data: { last_name: s.last_name, first_name: s.first_name, birth_date: bd, phone: s.phone } }]);
  assert.equal((await one(`SELECT our_id FROM external_refs WHERE source_id = $1 AND external_id = 'p-phone'`, [source.id])).our_id, s.id);
  assert.equal((await one(`SELECT count(*)::int AS n FROM patients`)).n, n0, 'yangi karta ochilmadi');
  // ambiguous: two cards share a phone and a birth date → a new card + «possible duplicate»; never merged
  await pool.query(`UPDATE patients SET phone = '+998977770000', birth_date = '1999-09-09' WHERE id = ANY($1)`, [[seed[2].id, seed[3].id]]);
  const r3 = await bridge([{ kind: 'patient', external_id: 'p-amb', data: { full_name: `${seed[2].last_name} ${seed[2].first_name}`, birth_date: '1999-09-09', phone: '+998977770000' } }]);
  assert.equal(r3.body.data.created, 1);
  const amb = (await one(`SELECT our_id FROM external_refs WHERE source_id = $1 AND external_id = 'p-amb'`, [source.id])).our_id;
  assert.ok(![seed[2].id, seed[3].id].includes(amb));
  // the same PINFL already linked to another MedPlus patient → new card without the PINFL, flagged
  const r4 = await bridge([{ kind: 'patient', external_id: 'p-pinfl-2', data: { full_name: 'Ikkinchi Odam', birth_date: '1980-02-02', pinfl: '31212880000011' } }]);
  assert.equal(r4.body.data.created, 1);
  const dups = (await manager.get(`/integrations/sources/${source.id}/duplicates`)).body.data;
  assert.deepEqual(dups.map((d) => d.reason).sort(), ['phone_birth_many', 'pinfl_taken']);
  const d = dups.find((x) => x.reason === 'phone_birth_many');
  assert.deepEqual(d.candidates.map((c) => c.id).sort(), [seed[2].id, seed[3].id].sort());
  assert.equal((await manager.post(`/integrations/sources/${source.id}/duplicates/${d.id}/review`)).status, 200);
  assert.equal((await manager.get(`/integrations/sources/${source.id}/duplicates`)).body.meta.total, 1);
  assert.equal((await t2manager.post(`/integrations/sources/${source.id}/duplicates/${d.id}/review`)).status, 404);
});

test('faqat o‘qish: ko‘chirilgan hisob, to‘lov, bemor va qabulni o‘zgartirish 409 MIRRORED_RECORD (server ham, baza ham)', async () => {
  const pay = await cashier.post(`/invoices/${invoice1}/payments`, { amount: 100, method: 'cash' }, key());
  assert.equal(pay.status, 409); assert.equal(pay.body.error.code, 'MIRRORED_RECORD');
  assert.match(pay.body.error.message, /MedPlus/);
  assert.equal((await manager.post(`/invoices/${invoice1}/discount`, { type: 'percent', value: 10, reason: 'sinov sababi' })).body.error.code, 'MIRRORED_RECORD');
  assert.equal((await manager.post(`/invoices/${invoice1}/void`, { reason: 'sinov sababi' })).body.error.code, 'MIRRORED_RECORD');
  // discounts and the company payer (migration 043) are refused on a mirrored bill too
  const rule = (await manager.get('/discount-rules')).body.data[0];
  assert.equal((await manager.post(`/invoices/${invoice1}/apply-discount`, { rule_id: rule.id, reason: 'sinov sababi' })).body.error.code, 'MIRRORED_RECORD');
  const company = (await manager.get('/companies')).body.data[0];
  assert.equal((await manager.post(`/invoices/${invoice1}/company`, { company_id: company.id })).body.error.code, 'MIRRORED_RECORD');
  const ref = await manager.post(`/invoices/${invoice1}/refunds`, { payment_id: payment1, amount: 100, method: 'card', reason_code: 'other', reason: 'sinov sababi' }, key());
  assert.equal(ref.body.error.code, 'MIRRORED_RECORD');
  const ed = await registrar.patch(`/patients/${patient1}`, { last_name: 'Boshqa' });
  assert.equal(ed.status, 409); assert.equal(ed.body.error.code, 'MIRRORED_RECORD');
  const ru = session(); await ru.demo(M.registrar); assert.equal((await ru.put('/me/preferences', { locale: 'ru' })).status, 200);
  const edRu = await ru.patch(`/patients/${patient1}`, { last_name: 'Boshqa' });
  assert.equal(edRu.body.error.message, 'Эта запись перенесена из MedPlus — измените её в MedPlus');
  const appt = (await one(`SELECT our_id FROM external_refs WHERE source_id = $1 AND external_id = 'v-1'`, [source.id])).our_id;
  const cancel = await registrar.post(`/appointments/${appt}/cancel`, { reason: 'sinov' });
  assert.equal(cancel.status, 409);
  // the database refuses even a direct write outside the sync
  await assert.rejects(pool.query(`UPDATE invoices SET total = total WHERE id = $1`, [invoice1]), (e) => e.code === 'MR409');
  await assert.rejects(pool.query(`INSERT INTO fiscal_receipts (tenant_id, kind, payment_id, provider, status) VALUES ($1, 'sale', $2, 'manual', 'pending')`, [SEED_IDS.tenant, payment1]), (e) => e.code === 'MR409');
  await assert.rejects(pool.query(`INSERT INTO payments (id, tenant_id, branch_id, invoice_id, receipt_number, amount, method, cashier_name, paid_at, idempotency_key, external_source_id)
    VALUES (gen_random_uuid(), $1, $2, $3, 999999, 1, 'cash', 'x', now(), 'x-direct', $4)`, [SEED_IDS.tenant, CENTRAL, invoice1, source.id]), (e) => e.code === 'MR409');
  // the doctor's allergy note on a mirrored card is ours (not MedPlus's identity)
  await pool.query(`UPDATE patients SET allergy_state = 'denied' WHERE id = $1`, [patient1]);
});

test('MedPlus o‘zgarishlari: xizmat narxi to‘lovdan keyin — xato; to‘lov kamaysa yoki o‘chirilsa — qaytarish; manfiy qator — qaytarish', async () => {
  // a line cheaper than what was paid → refused, reported
  const r1 = await bridge([{ ...O1, data: { ...O1.data, price: 10_000_00 } }]);
  assert.equal(r1.body.data.errors, 1); assert.equal(r1.body.data.error_samples[0].code, 'changed_after_payment');
  // payment reduced 200 000 → 150 000: an «adj» refund of 50 000, no fiscal row, invoice reduced
  const r2 = await bridge([{ ...PM1, data: { ...PM1.data, amount: 150_000_00 } }]);
  assert.equal(r2.body.data.updated, 1, JSON.stringify(r2.body.data));
  const inv = await one(`SELECT total, paid_amount, credit_amount, status FROM invoices WHERE id = $1`, [invoice1]);
  assert.deepEqual([Number(inv.total), Number(inv.paid_amount), Number(inv.credit_amount)], [150_000_00, 150_000_00, 50_000_00]);
  const rf = await one(`SELECT amount, shift_id, external_source_id, reason_code FROM refunds WHERE invoice_id = $1`, [invoice1]);
  assert.deepEqual([Number(rf.amount), rf.shift_id, rf.reason_code], [50_000_00, null, 'other']); assert.ok(rf.external_source_id);
  assert.equal((await one(`SELECT count(*)::int AS n FROM fiscal_receipts f JOIN refunds r ON r.id = f.refund_id WHERE r.invoice_id = $1`, [invoice1])).n, 0);
  // the same reduced payment again: unchanged
  assert.equal((await bridge([{ ...PM1, data: { ...PM1.data, amount: 150_000_00 } }])).body.data.unchanged, 1);
  // a negative cash-history row = a refund to the patient (k-2 was 80 000 by card)
  const r3 = await bridge([{ kind: 'payment', external_id: 'k-9', data: { patient_id: '30001', branch_id: '1', amount: -30_000_00, method: 'Терминал', paid_at: '2026-10-16 18:00', comment: 'возврат' } }]);
  assert.equal(r3.body.data.created, 1, JSON.stringify(r3.body.data));
  assert.equal((await bridge([{ kind: 'payment', external_id: 'k-9', data: { patient_id: '30001', branch_id: '1', amount: -30_000_00, method: 'Терминал', paid_at: '2026-10-16 18:00', comment: 'возврат' } }])).body.data.unchanged, 1);
  const rev = (await manager.get('/finance/summary?from=2026-10-16&to=2026-10-16')).body.data;
  assert.ok(rev.refunds.total >= 30_000_00);
  // deleted in MedPlus → fully refunded here; the shift of the cashier still untouched
  const r4 = await bridge([{ ...PM1, deleted: true, data: { ...PM1.data, amount: 150_000_00 } }]);
  assert.equal(r4.body.data.updated, 1);
  assert.equal(Number((await one(`SELECT paid_amount FROM invoices WHERE id = $1`, [invoice1])).paid_amount), 0);
  assert.deepEqual((await cashier.get('/cash-shifts/current')).body.data.totals, shiftBefore.totals);
});

test('jurnal, holat va solishtirish: paketlar sanog‘i shaxsiy ma’lumotsiz; MedPlus kunlik jami bilan farq ko‘rinadi', async () => {
  const log = (await manager.get(`/integrations/sources/${source.id}/log`)).body.data;
  assert.ok(log.length >= 8);
  assert.ok(!JSON.stringify(log).includes('Abdullayeva') && !JSON.stringify(log).includes('+99890'), 'jurnalda shaxsiy ma’lumot yo‘q');
  await assert.rejects(pool.query(`DELETE FROM external_sync_log WHERE id = $1`, [log[0].id]), /append-only/);
  const st = (await manager.get(`/integrations/sources/${source.id}/status`)).body.data;
  assert.ok(st.counts.patients >= 9 && st.counts.payments >= 4 && st.errors_24h >= 1, JSON.stringify(st));
  assert.ok((await one(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'sync.batch' AND actor_role = 'system'`)).n >= 8);
  await bridge([{ kind: 'daily_totals', external_id: '2026-10-16:1', data: { date: '2026-10-16', branch_id: '1', payments_sum: 81_000_00 - 30_000_00, payments_count: 2 } }]);
  const rec = (await manager.get(`/integrations/sources/${source.id}/reconciliation?from=2026-10-15&to=2026-10-16`)).body.data;
  const d16 = rec.rows.find((r) => r.day === '2026-10-16' && r.branch_id === CENTRAL);
  assert.equal(d16.reported_sum, 51_000_00);
  assert.equal(d16.our_sum, 81_000_00 - 30_000_00, 'to‘lovlar − qaytarishlar');
  assert.equal(d16.diff_sum, 0);
  assert.equal((await manager.get(`/integrations/sources/${source.id}/reconciliation?from=2026-01-01&to=2026-10-16`)).status, 422);
});

test('tenant izolyatsiyasi: boshqa klinika kalitidan foydalanib bo‘lmaydi, ko‘chirilgan yozuvlar ko‘rinmaydi', async () => {
  assert.equal((await bridge([], t2token, source.id)).status, 401, 'boshqa manba kaliti');
  assert.equal((await bridge([], token, t2source.id)).status, 401);
  const r = await bridge([{ ...P1, external_id: '28354' }], t2token, t2source.id);
  assert.equal(r.body.data.created, 1, 'xuddi shu MedPlus ID boshqa klinikada — alohida karta');
  const theirs = (await one(`SELECT our_id FROM external_refs WHERE source_id = $1 AND external_id = '28354'`, [t2source.id])).our_id;
  assert.notEqual(theirs, patient1);
  assert.equal((await manager.get(`/patients/${theirs}`)).status, 404);
  assert.equal((await t2manager.get(`/patients/${patient1}`)).status, 404);
  assert.equal((await t2manager.get(`/integrations/sources/${source.id}/pending`)).status, 404);
});

// ---------------------------------------------------------------- XLSX and file import

test('XLSX: yozuvchi → o‘quvchi aylanma (raqam, sana, matn, formula himoyasi), zip CRC to‘g‘ri', () => {
  const header = ['Qayd №', 'Sana (Toshkent)', 'Bemor', 'Summa (so‘m)', 'IKPU', 'Izoh'];
  const rows = [[17, '2026-10-18 14:05', 'Karimov Aziz', '1250000.50', '00102001001000000', '=HYPERLINK("x")'], ['18', '2026-10-17', 'Ёқубова <Нигора> & Co', '-12.50', '', '+998901234567'], ['Jami', '', '2 ta', '1249988.00', '', '']];
  const buf = buildXlsx(header, rows, { boldLastRow: true });
  const back = readXlsx(buf);
  assert.deepEqual(back[0], header);
  assert.equal(back[1][0], 17); assert.ok(back[1][1] instanceof Date); assert.equal(back[1][1].toISOString(), '2026-10-18T14:05:00.000Z', 'devor vaqti');
  assert.equal(back[1][3], 1250000.5); assert.equal(back[1][4], '00102001001000000', 'IKPU matn bo‘lib qoladi'); assert.equal(back[1][5], '=HYPERLINK("x")', 'formula emas, matn');
  assert.equal(back[2][1].toISOString().slice(0, 10), '2026-10-17'); assert.equal(back[2][2], 'Ёқубова <Нигора> & Co'); assert.equal(back[2][3], -12.5); assert.equal(back[2][5], '+998901234567');
  assert.equal(back[3][0], 'Jami');
  const sheet = unzip(buf).get('xl/worksheets/sheet1.xml').toString();
  assert.ok(!sheet.includes('<f>'), 'formula yo‘q');
  assert.match(sheet, /<c r="F2" t="s" s="5">/, 'formulaga o‘xshash matn — quotePrefix uslubi');
  assert.match(sheet, /<c r="D4" s="6">/, 'jami qatori qalin');
  // a zip from another writer (stored entries) reads too
  const plain = zip([{ name: 'a.txt', data: Buffer.from('salom') }]);
  assert.equal(unzip(plain).get('a.txt').toString(), 'salom');
  assert.throws(() => readTable(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])), (e) => e.code === 'XLS_OLD');
  const csv = readTable(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ID;ФИО;Сумма\r\n1;"Иванов; И.";"1 000,50"\r\n')]));
  assert.deepEqual(csv, [['ID', 'ФИО', 'Сумма'], ['1', 'Иванов; И.', '1 000,50']]);
  const cp1251 = Buffer.from([0xc8, 0xc4, 0x3b, 0xd4, 0xc8, 0xce, 0x0a, 0x31, 0x3b, 0xc8, 0xe2, 0xe0, 0xed]); // «ИД;ФИО\n1;Иван» in Windows-1251
  assert.deepEqual(readTable(cp1251), [['ИД', 'ФИО'], ['1', 'Иван']]);
  const html = readTable(Buffer.from('<html><meta charset="utf-8"><table><tr><th>ID</th><th>ФИО</th></tr><tr><td>5</td><td>Петров&nbsp;П.</td></tr></table></html>'));
  assert.deepEqual(html, [['ID', 'ФИО'], ['5', 'Петров' + String.fromCharCode(32) + 'П.']], '&nbsp; → oddiy bo‘shliq');
});

test('zip bomba: umumiy byudjet, faqat kerakli qismlar ochiladi, takroriy nom va ustma-ust yozuv rad etiladi', async () => {
  const zeros = Buffer.alloc(3 * 1024 * 1024); // deflates to a few KB
  // many small-compressed large entries: the archive-wide budget stops them
  const bomb = zip(Array.from({ length: 10 }, (_, i) => ({ name: `x${i}.xml`, data: zeros })));
  assert.ok(bomb.length < 200_000, `kichik arxiv: ${bomb.length}`);
  assert.throws(() => unzip(bomb, { total: 10 * 1024 * 1024 }), (e) => e.code === 'TOO_LARGE');
  // a real workbook padded with 40 × 3 MB junk entries (120 MB, over the 80 MB budget): the junk is never inflated
  const book = unzip(buildXlsx(['ID', 'Ism'], [[1, 'Ali']]));
  const padded = zip([...[...book].map(([name, data]) => ({ name, data })), ...Array.from({ length: 40 }, (_, i) => ({ name: `xl/media/junk${i}.bin`, data: zeros }))]);
  assert.deepEqual(readXlsx(padded), [['ID', 'Ism'], [1, 'Ali']]);
  assert.throws(() => unzip(padded), (e) => e.code === 'TOO_LARGE', 'hammasini ochish byudjetdan oshadi');
  // an entry that lies about its size is cut at the per-entry cap
  const liar = zip([{ name: 'big.xml', data: Buffer.alloc(2 * 1024 * 1024) }]);
  const cd = liar.readUInt32LE(liar.length - 6); liar.writeUInt32LE(100, cd + 24);
  assert.throws(() => openZip(liar, { entry: 1024 * 1024 }).read('big.xml'), (e) => e.code === 'TOO_LARGE');
  // duplicate names and two central entries pointing at one local header
  assert.throws(() => openZip(zip([{ name: 'a', data: Buffer.from('1') }, { name: 'a', data: Buffer.from('2') }])), (e) => e.code === 'BAD_FILE' && /duplicate/.test(e.message));
  const two = zip([{ name: 'a', data: Buffer.from('1') }, { name: 'b', data: Buffer.from('2') }]);
  const cd2 = two.readUInt32LE(two.length - 6); const second = cd2 + 46 + 1; two.writeUInt32LE(0, second + 42);
  assert.throws(() => openZip(two), (e) => e.code === 'BAD_FILE' && /overlapping/.test(e.message));
  // through the upload: refused cleanly
  const f = new FormData(); f.append('file', new Blob([bomb]), 'bomb.xlsx'); f.append('kind', 'patients');
  const r = await manager.post(`/integrations/sources/${source.id}/import/preview`, f);
  assert.equal(r.status, 422); assert.equal(r.body.error.code, 'BAD_FILE');
});

test('filial doirasi: faqat bitta filialga ruxsati bor rahbar integratsiyani boshqara olmaydi (403)', async () => {
  const u = (await pool.query(`INSERT INTO users (id, email, full_name) VALUES (gen_random_uuid(), $1, 'Filial rahbari') RETURNING id`, [`branch-${randomUUID()}@test.local`])).rows[0].id;
  const mid = (await pool.query(`INSERT INTO memberships (id, tenant_id, user_id, role, branch_ids, title) VALUES (gen_random_uuid(), $1, $2, 'manager', $3, 'Filial rahbari') RETURNING id`, [SEED_IDS.tenant, u, [CENTRAL]])).rows[0].id;
  const bm = session(); assert.equal((await bm.demo(mid)).status, 200);
  const f = new FormData(); f.append('file', new Blob([buildXlsx(['ID'], [[1]])]), 'a.xlsx'); f.append('kind', 'patients');
  for (const [m, p, body] of [['get', '/integrations/sources'], ['post', '/integrations/sources', {}], ['get', `/integrations/sources/${source.id}/status`],
    ['get', `/integrations/sources/${source.id}/reconciliation`], ['get', `/integrations/sources/${source.id}/duplicates`], ['get', `/integrations/sources/${source.id}/targets?kind=branch`],
    ['get', `/integrations/sources/${source.id}/mappings?kind=branch`], ['patch', `/integrations/sources/${source.id}`, { default_branch_id: SEED_IDS.branchYunusobod }],
    ['post', `/integrations/sources/${source.id}/token`], ['post', `/integrations/sources/${source.id}/import/preview`, f]]) {
    const r = await bm[m](p, body);
    assert.equal(r.status, 403, `${m} ${p}`);
  }
  assert.equal((await one(`SELECT settings FROM external_sources WHERE id = $1`, [source.id])).settings.default_branch_id, undefined);
});

test('eksport: har CSV yonida XLSX (bir xil ustunlar va Jami qatori), davr chegarasi ham bir xil', async () => {
  const q = 'from=2026-10-15&to=2026-10-16';
  const csv = await manager.get(`/payments/export.csv?${q}`);
  assert.equal(csv.status, 200);
  const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
  assert.match(lines[lines.length - 1], /^"Jami";/, 'to‘lovlar eksporti jami qatori bilan tugaydi');
  assert.ok(lines.some((l) => l.includes('"MedPlus"')), 'ko‘chirilgan to‘lov — fiskal holati «MedPlus»');
  const x = await manager.get(`/payments/export.xlsx?${q}`);
  assert.equal(x.status, 200, x.text);
  assert.match(x.headers.get('content-type'), /spreadsheetml/);
  assert.match(x.headers.get('content-disposition'), /\.xlsx"/);
  const rows = readXlsx(x.buf);
  assert.equal(rows.length, lines.length);
  assert.equal(rows[0].length, lines[0].split(';').length);
  assert.equal(rows[rows.length - 1][0], 'Jami');
  const sumCell = rows[rows.length - 1][7];
  assert.equal(typeof sumCell, 'number');
  assert.equal(Math.round(sumCell * 100), rows.slice(1, -1).reduce((a, r) => a + Math.round(r[7] * 100), 0));
  for (const p of ['/invoices/debtors', '/refunds/export', '/expenses/export', '/cash-shifts/export', '/reports/doctors/export']) {
    const c = await manager.get(`${p}.csv?${q}`); const xl = await manager.get(`${p}.xlsx?${q}`);
    assert.equal(xl.status, 200, `${p} ${xl.text.slice(0, 200)}`);
    const a = c.text.replace(/^﻿/, '').trim().split('\r\n'); const b = readXlsx(xl.buf);
    assert.equal(b.length, a.length, p);
    assert.equal(String(b[b.length - 1][0]), a[a.length - 1].split(';')[0].replace(/"/g, ''), `${p}: jami qatori`);
  }
  assert.equal((await manager.get('/payments/export.xlsx?from=2025-01-01&to=2026-10-16')).status, 422, 'davr ≤ 1 yil');
  assert.equal((await registrar.get(`/payments/export.xlsx?${q}`)).status, 403);
});

function xlsxFile(header, rows) { return new Blob([buildXlsx(header, rows)]); }
const form = (file, fields, name = 'medplus.xlsx') => { const f = new FormData(); f.append('file', file, name); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };

test('fayldan import: MedPlus sarlavhalari taxmin qilinadi, tekshiruv yozmaydi, import ko‘prik yo‘li bilan — takror yo‘q', async () => {
  const header = ['ID', 'ФИО пациента', 'Дата рож.', 'Пол', 'Мобильный телефон', 'Адрес', 'Канал рекламы'];
  const rows = [[41001, 'Qodirova Dilnoza Akmalovna', new Date(Date.UTC(1992, 6, 14)), 'Ж', '+998 90 700 10 01', 'Chilonzor', 'Instagram'],
    [41002, 'Rahimov Jasur', '05.11.1985', 'М', '901112200', '', ''],
    [41003, 'Bezsana Odam', '', 'М', '', '', ''],
    ['28354', 'Abdullayeva Malika Rustamovna', '12.03.1988', 'Ж', '99 812 34 56', 'Toshkent', '']]; // the bridge sent this one already
  const file = xlsxFile(['Список пациентов', '', ''].concat([]), []); // a title-only file is still readable
  assert.equal((await manager.post(`/integrations/sources/${source.id}/import/preview`, form(file, { kind: 'patients' }))).status, 200);
  const all = [['Список пациентов'], header, ...rows];
  const blob = new Blob([buildXlsx(all[0], all.slice(1))]);
  const pv = await manager.post(`/integrations/sources/${source.id}/import/preview`, form(blob, { kind: 'patients' }));
  assert.equal(pv.status, 200, pv.text);
  assert.equal(pv.body.data.header_row, 2, 'sarlavha sarlavhali qatordan keyin topildi');
  assert.deepEqual(pv.body.data.guess, { external_id: 0, full_name: 1, birth_date: 2, sex: 3, phone: 4, address: 5 });
  assert.equal(pv.body.data.rows, 4);
  const before = (await one(`SELECT count(*)::int AS n FROM patients`)).n;
  const dry = await manager.post(`/integrations/sources/${source.id}/import`, form(blob, { kind: 'patients', dry_run: '1' }));
  assert.equal(dry.status, 200, dry.text);
  assert.deepEqual([dry.body.data.created, dry.body.data.unchanged, dry.body.data.errors, dry.body.data.file_errors], [2, 1, 0, 1], JSON.stringify(dry.body.data));
  assert.deepEqual(dry.body.data.row_errors, [{ row: 5, code: 'missing', field: 'birth_date' }]);
  assert.equal((await one(`SELECT count(*)::int AS n FROM patients`)).n, before, 'tekshiruv hech narsa yozmadi');
  assert.equal((await one(`SELECT count(*)::int AS n FROM external_sync_log WHERE channel = 'file'`)).n, 0);
  const imp = await manager.post(`/integrations/sources/${source.id}/import`, form(blob, { kind: 'patients' }));
  assert.deepEqual([imp.body.data.created, imp.body.data.unchanged, imp.body.data.file_errors], [2, 1, 1]);
  assert.equal((await one(`SELECT count(*)::int AS n FROM patients`)).n, before + 2);
  const dz = await one(`SELECT p.last_name, p.birth_date::text AS bd, p.phone FROM patients p JOIN external_refs x ON x.our_id = p.id WHERE x.source_id = $1 AND x.external_id = '41001'`, [source.id]);
  assert.deepEqual(dz, { last_name: 'Qodirova', bd: '1992-07-14', phone: '+998907001001' });
  // the bridge sends the same patient later: same path, same key → unchanged (no second card)
  const again = await bridge([{ kind: 'patient', external_id: '41002', data: { full_name: 'Rahimov Jasur', birth_date: '05.11.1985', sex: 'М', phone: '901112200', address: null } }]);
  assert.equal(again.body.data.created, 0);
  assert.equal((await one(`SELECT count(*)::int AS n FROM external_refs WHERE source_id = $1 AND external_id = '41002'`, [source.id])).n, 1);
  assert.equal((await one(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'sync.import'`)).n, 1);
  // wrong kind or file
  assert.equal((await manager.post(`/integrations/sources/${source.id}/import`, form(blob, { kind: 'nope' }))).status, 422);
  assert.equal((await manager.post(`/integrations/sources/${source.id}/import/preview`, form(new Blob([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3])]), { kind: 'patients' }, 'old.xls'))).body.error.code, 'XLS_OLD');
});

test('fayldan import: xizmatlar hisoboti, keyin kassa tarixi (bemor ID ustunda yoki bemor nomida)', async () => {
  const sv = buildXlsx(['Пациент', 'Услуга', 'Сумма', 'Скидка', 'Форма оплаты', 'Врач', 'Врач %', 'Дата', 'Филиал'], [
    ['41001 Qodirova Dilnoza', 'Консультация гинеколога', 120000, 20000, 'Наличными', 'Saidova Nodira', 40, new Date(Date.UTC(2026, 9, 14, 9, 30)), 'Markaziy filial'],
    ['41001 Qodirova Dilnoza', 'УЗИ малого таза', '90 000', '', 'Наличными', 'Saidova Nodira', '', '14.10.2026 09:45', 'Markaziy filial']]);
  const r = await manager.post(`/integrations/sources/${source.id}/import`, form(new Blob([sv]), { kind: 'services' }));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.created, 2, JSON.stringify(r.body.data));
  const again = await manager.post(`/integrations/sources/${source.id}/import`, form(new Blob([sv]), { kind: 'services' }));
  assert.equal(again.body.data.unchanged, 2, 'xuddi shu fayl ikkinchi marta — o‘zgarmagan');
  const pay = buildXlsx(['ID', 'Пациент', 'Комментарий', 'Оплаченная сумма', 'Форма оплаты', 'Пользователь', 'Филиал', 'Дата платежа'], [
    [9001, 'Qodirova Dilnoza (41001)', '', 190000, 'Наличными', 'Ахмедова Г.', 'Markaziy filial', '14.10.2026 10:00']]);
  const p = await manager.post(`/integrations/sources/${source.id}/import`, form(new Blob([pay]), { kind: 'payments' }));
  assert.equal(p.body.data.created, 1, JSON.stringify(p.body.data));
  const inv = await one(`SELECT i.total, i.paid_amount, i.status FROM invoices i JOIN external_refs x ON x.our_id = i.id WHERE x.source_id = $1 AND x.kind = 'invoice' AND x.external_id LIKE 'day:41001:%'`, [source.id]);
  assert.deepEqual([Number(inv.total), Number(inv.paid_amount), inv.status], [190_000_00, 190_000_00, 'paid']);
  // the bridge later sends the same cash row 9001: nothing doubles
  const br = await bridge([{ kind: 'payment', external_id: '9001', data: { patient_id: '41001', branch_name: 'Markaziy filial', amount: 190_000_00, method: 'Наличными', paid_at: '14.10.2026 10:00', cashier: 'Ахмедова Г.' } }]);
  assert.equal(br.body.data.created, 0);
  assert.equal((await one(`SELECT count(*)::int AS n FROM payments p JOIN external_refs x ON x.our_id = p.id WHERE x.source_id = $1 AND x.kind = 'payment' AND x.external_id LIKE '9001%'`, [source.id])).n, 1);
  const missing = buildXlsx(['ID', 'Пациент', 'Оплаченная сумма', 'Форма оплаты', 'Дата платежа'], [[9002, 'Ismsiz', 5000, 'Наличными', '14.10.2026']]);
  const m = await manager.post(`/integrations/sources/${source.id}/import`, form(new Blob([missing]), { kind: 'payments', dry_run: '1' }));
  assert.deepEqual(m.body.data.row_errors, [{ row: 2, code: 'missing', field: 'patient_id' }]);
});

// ---------------------------------------------------------------- the bridge against the real endpoint

test('ko‘prik yadrosi (soxta MedPlus) → haqiqiy endpoint: sahifalab yuboradi, ikkinchi o‘tish yangisini, xato kalitda to‘xtaydi', async () => {
  const { runOnce, httpSender, loadQueries, memoryCursorStore, FatalSendError } = await import('../../../tools/medplus-bridge/core.mjs');
  const server = base.replace(/\/api\/v1$/, '');
  const queries = loadQueries({
    patient: { sql: 'SELECT * FROM patients WHERE id > :last_id ORDER BY id LIMIT :limit', cursor: ['id'], map: { external_id: 'id', full_name: 'fio', birth_date: 'bday', phone: 'tel' } },
    payment: { sql: 'SELECT * FROM kassa WHERE id > :last_id ORDER BY id LIMIT :limit', cursor: ['id'], money: ['amount'], map: { external_id: 'id', patient_id: 'pid', amount: 'summa', method: 'pay', paid_at: 'dt', branch_id: 'filial' } },
    order: { sql: 'SELECT * FROM xizmat WHERE id > :last_id ORDER BY id LIMIT :limit', cursor: ['id'], money: ['price'], map: { external_id: 'id', patient_id: 'pid', service_name: 'name', price: 'narx', ordered_at: 'dt', branch_id: 'filial' } },
  });
  const tables = {
    patient: Array.from({ length: 5 }, (_, i) => ({ id: 50001 + i, fio: `Ko‘prik Bemor${i}`, bday: `1990-01-1${i}`, tel: null })),
    order: [{ id: 700, pid: 50001, name: 'Массаж', narx: '45000', dt: '2026-10-17 09:00:00', filial: 1 }],
    payment: [{ id: 800, pid: 50001, summa: '45000.00', pay: 'Наличными', dt: '2026-10-17 09:30:00', filial: 1 }],
  };
  const src = { async fetch(kind, _sql, p) { return tables[kind].filter((r) => r.id > p.last_id).slice(0, p.limit); } };
  const cursors = memoryCursorStore();
  const s1 = await runOnce({ source: src, queries, cursors, limit: 2, send: httpSender({ server, sourceId: source.id, token, sleep: async () => {}, retries: 1, fetchImpl: (u, i) => fetch(u, i) }) });
  assert.equal(s1.patient.created, 5); assert.equal(s1.order.created, 1); assert.equal(s1.payment.created, 1);
  assert.deepEqual(cursors.get('patient'), { id: 50005 });
  tables.patient.push({ id: 50006, fio: 'Yana Bir', bday: '2000-02-02', tel: null });
  const s2 = await runOnce({ source: src, queries, cursors, limit: 2, send: httpSender({ server, sourceId: source.id, token, sleep: async () => {} }) });
  assert.equal(s2.patient.sent, 1); assert.equal(s2.patient.created, 1); assert.equal(s2.payment.sent, 0);
  const bad = httpSender({ server, sourceId: source.id, token: 'mps_' + 'y'.repeat(43), sleep: async () => {} });
  await assert.rejects(bad([{ kind: 'patient', external_id: '1', data: {} }]), (e) => e instanceof FatalSendError && e.status === 401);
});

test('batch himoyasi: 1000 dan ko‘p yozuv 422, noto‘g‘ri yozuv paketni to‘xtatmaydi', async () => {
  const many = Array.from({ length: 1001 }, (_, i) => ({ kind: 'branch', external_id: String(i), data: { name: 'x' } }));
  assert.equal((await bridge(many)).status, 422);
  const r = await bridge([{ kind: 'nope', external_id: '1' }, { kind: 'patient' }, { kind: 'patient', external_id: 'p-bad', data: { full_name: 'Ism Familiya', birth_date: '31.02.2000' } }, { kind: 'branch', external_id: '4', data: { name: 'Uchinchi' } }]);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.errors, 3); assert.equal(r.body.data.created, 1);
  assert.deepEqual(r.body.data.error_samples.map((x) => x.code).sort(), ['birth_date_missing', 'invalid_record', 'invalid_record']);
});
