// Warehouse (migration 030, docs/WAREHOUSE.md): the storekeeper role and its access matrix, receipts → batches,
// FEFO issue (never an expired lot), requests (lifecycle, partial issue, own only), mandatory doctor/purpose/ICD on
// every issue, returns to the same batch, write-off with a commission and a second signature, controlled items
// (manager approval + storekeeper issue, register, append-only ledger), inventory count, race on the last unit,
// reports = ledger, CSV bounds, fridge log, seed invariant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
const BC = SEED_IDS.branchCentral, BY = SEED_IDS.branchYunusobod;
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t, type: r.headers.get('content-type') };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}) => req('POST', p, b), put: (p, b) => req('PUT', p, b), patch: (p, b) => req('PATCH', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}

let keeper, manager, doctor, doctor2, registrar, cashier, lab, t2;
let today, openEnc, openPatient;
const item = {};
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  keeper = session(); assert.equal((await keeper.demo(M.storekeeper)).status, 200);
  doctor = session(); await doctor.demo(M.doctor(0));
  doctor2 = session(); await doctor2.demo(M.doctor(1));
  registrar = session(); await registrar.demo(M.registrar);
  cashier = session(); await cashier.demo(M.cashier);
  lab = session(); await lab.demo(M.lab);
  t2 = session(); await t2.demo(M.tenant2Manager);
  today = (await doctor.get('/me')).body.data.today;
  const a = (await doctor.get(`/appointments?date=${today}`)).body.data.find((x) => x.status === 'in_progress' && x.encounter_id);
  openEnc = a.encounter_id; openPatient = a.patient_id;
  const id = async (name) => (await pool.query(`SELECT id FROM inventory_items WHERE tenant_id = $1 AND name = $2`, [SEED_IDS.tenant, name])).rows[0].id;
  item.tramadol = await id('Tramadol 50 mg/ml, 2 ml');
  item.ceftri = await id('Seftriakson 1 g');
  item.lido = await id('Lidokain 2%, 2 ml');
  item.salfetka = await id('Spirtli salfetka');
  item.reagent = await id('UQT reagenti to‘plami');
});
after(async () => { await app?.close(); });

const stock = async (itemId) => Number((await pool.query(`SELECT coalesce(sum(qty),0) AS q FROM inventory_batches WHERE item_id = $1`, [itemId])).rows[0].q);
const batchQty = async (batchId) => Number((await pool.query(`SELECT qty FROM inventory_batches WHERE id = $1`, [batchId])).rows[0].qty);
/** opening + Σ ledger = Σ batches, for every item of the demo clinic. */
async function ledgerMatchesBatches() {
  const bad = (await pool.query(
    `SELECT i.name, i.opening_qty + coalesce((SELECT sum(CASE WHEN m.type = 'in' THEN m.quantity ELSE -m.quantity END) FROM inventory_movements m WHERE m.item_id = i.id),0) AS ledger,
            coalesce((SELECT sum(qty) FROM inventory_batches b WHERE b.item_id = i.id),0) AS batches
       FROM inventory_items i WHERE i.tenant_id = $1`, [SEED_IDS.tenant])).rows.filter((r) => Number(r.ledger) !== Number(r.batches));
  assert.deepEqual(bad, [], 'qoldiq = partiyalar yig‘indisi');
}

test('seed: omborchi kartasi, partiyalar = daftar, muddati o‘tgan va yaqin partiya, nazoratdagi tramadol jurnali', async () => {
  const cards = (await session().get('/demo/accounts')).body.data;
  assert.ok(cards.some((c) => c.role === 'storekeeper' && c.membership_id === M.storekeeper));
  assert.equal((await keeper.get('/me')).body.data.role, 'storekeeper');
  await ledgerMatchesBatches();
  const exp = (await keeper.get('/warehouse/batches?expiring=30')).body.data;
  assert.ok(exp.some((b) => b.expired) && exp.some((b) => !b.expired), 'muddati o‘tgan va 30 kun ichida tugaydigan partiya');
  const j = (await keeper.get(`/warehouse/controlled/${item.tramadol}`)).body.data;
  assert.ok(j.entries.length >= 3, 'kirim + chiqimlar');
  const last = j.entries.at(-1);
  assert.equal(Number(last.balance), Number(j.item.qty), 'jurnal qoldig‘i = ombor qoldig‘i');
  assert.ok(j.entries.filter((e) => e.kind === 'issue').every((e) => e.second_signer_name && e.receiver_name && e.patient_number), 'ikki imzo, oluvchi, bemor');
  const s = (await keeper.get('/warehouse/summary')).body.data;
  assert.ok(s.requests >= 1 && s.writeoffs === 1 && s.has_controlled);
});

test('rol matritsasi: omborchi faqat omborda; shifokor/laboratoriya so‘raydi; kassir/registrator yo‘q; boshqa klinika 404', async () => {
  for (const p of ['/warehouse/stock', '/warehouse/summary', '/inventory', '/warehouse/receipts', '/warehouse/requests', '/warehouse/movements', '/warehouse/writeoffs', '/warehouse/counts', '/warehouse/fridge', '/warehouse/reports/consumption?group=patient'])
    assert.equal((await keeper.get(p)).status, 200, p);
  for (const p of ['/patients', '/dashboard', `/appointments?date=${today}`, '/invoices', '/cash-shifts/current', `/encounters/${openEnc}`, `/patients/${openPatient}`, '/staff', '/reports/doctors'])
    assert.equal((await keeper.get(p)).status, 403, `omborchi: ${p}`);
  for (const s of [doctor, lab]) {
    assert.equal((await s.get(`/warehouse/catalog?branch_id=${BC}`)).status, 200);
    for (const p of ['/warehouse/stock', '/warehouse/movements', '/warehouse/receipts', '/inventory', '/warehouse/reports/consumption']) assert.equal((await s.get(p)).status, 403, p);
    assert.equal((await s.post('/warehouse/receipts', {})).status, 403);
    assert.equal((await s.post('/warehouse/issues', {})).status, 403);
  }
  for (const s of [cashier, registrar]) for (const p of ['/warehouse/catalog?branch_id=' + BC, '/warehouse/requests', '/warehouse/stock'])
    assert.equal((await s.get(p)).status, 403, p);
  assert.equal((await registrar.post('/warehouse/requests', {})).status, 403);
  assert.equal((await keeper.post('/warehouse/requests', {})).status, 403, 'omborchi o‘ziga talabnoma yozmaydi');
  // the lab sees reagents/consumables only and asks for its own department, never for a patient
  const cat = (await lab.get(`/warehouse/catalog?branch_id=${BC}`)).body.data;
  assert.ok(cat.length && cat.every((c) => c.category !== 'medicine'));
  assert.equal((await lab.post('/warehouse/requests', { branch_id: BC, purpose: 'department', department: 'Laboratoriya', lines: [{ item_id: item.reagent, qty: 1 }] })).status, 201);
  assert.equal((await lab.post('/warehouse/requests', { branch_id: BC, purpose: 'patient', department: 'Laboratoriya', encounter_id: openEnc, icd_codes: ['I10'], lines: [{ item_id: item.reagent, qty: 1 }] })).status, 403);
  // another clinic
  const req = (await keeper.get('/warehouse/requests')).body.data[0];
  assert.equal((await t2.get(`/warehouse/requests/${req.id}`)).status, 404);
  assert.equal((await t2.get(`/inventory/${item.ceftri}`)).status, 404);
  assert.equal((await t2.get(`/warehouse/controlled/${item.tramadol}`)).status, 404);
  assert.equal((await t2.post(`/warehouse/requests/${req.id}/issue`, {})).status, 404);
  // branch scope: the cardiologist works in the central branch only
  assert.equal((await doctor2.get(`/warehouse/catalog?branch_id=${BY}`)).status, 403);
});

test('kirim → partiyalar (seriya, muddat, narx); muddati o‘tgan partiya qabul qilinmaydi; yangi material maydonlari', async () => {
  const cr = await keeper.post('/inventory', { name: 'Sinov dori A', unit: 'ampula', branch_id: BC, category: 'medicine', storage: 'fridge', minimum_qty: 2, purchase_price: 500000 });
  assert.equal(cr.status, 201); item.a = cr.body.data.id;
  const r = await keeper.post('/warehouse/receipts', { branch_id: BC, supplier: 'Sinov ta’minot', invoice_no: 'NK-1', invoice_date: today,
    lines: [{ item_id: item.a, batch_no: 'L2', expiry_date: '2027-06-30', qty: 5, unit_cost: 600000 }, { item_id: item.a, batch_no: 'L1', expiry_date: '2027-01-31', qty: 3, unit_cost: 500000 }] });
  assert.equal(r.status, 201);
  const doc = (await keeper.get(`/warehouse/receipts/${r.body.data.id}`)).body.data;
  assert.equal(doc.lines.length, 2); assert.equal(doc.total, 5 * 600000 + 3 * 500000);
  assert.equal(await stock(item.a), 8);
  const it = (await keeper.get(`/inventory/${item.a}`)).body.data;
  assert.equal(it.category, 'medicine'); assert.equal(it.storage, 'fridge'); assert.equal(it.batches[0].batch_no, 'L1', 'birinchi — eng erta muddat');
  assert.equal((await keeper.post('/warehouse/receipts', { branch_id: BC, supplier: 'X tamin', invoice_no: '1', invoice_date: today, lines: [{ item_id: item.a, batch_no: 'Z', expiry_date: '2020-01-01', qty: 1, unit_cost: 1 }] })).status, 422);
  assert.equal((await keeper.post('/warehouse/receipts', { branch_id: BY, supplier: 'X tamin', invoice_no: '1', invoice_date: today, lines: [{ item_id: item.a, batch_no: 'Z', qty: 1, unit_cost: 1 }] })).status, 422, 'boshqa filial materiali');
  await ledgerMatchesBatches();
});

test('FEFO: eng erta muddatli partiyadan; muddati o‘tgan partiya hech qachon berilmaydi; maqsad/oluvchi/MKB majburiy', async () => {
  // an expired lot with the most units: it must never be touched
  const expired = (await pool.query(`INSERT INTO inventory_batches (id, tenant_id, item_id, batch_no, expiry_date, qty, received_qty, unit_cost, received_at)
    VALUES (gen_random_uuid(), $1, $2, 'OLD', '2026-01-01', 50, 50, 1, now()) RETURNING id`, [SEED_IDS.tenant, item.a])).rows[0].id;
  await pool.query(`INSERT INTO inventory_movements (id, tenant_id, item_id, type, quantity, reason, actor_name, occurred_at, kind, batch_id, branch_id)
    VALUES (gen_random_uuid(), $1, $2, 'in', 50, 'eski partiya (sinov)', 'test', now(), 'adjust', $3, $4)`, [SEED_IDS.tenant, item.a, expired, BC]);
  const base = { branch_id: BC, purpose: 'department', department: 'Muolaja xonasi', receiver_membership_id: M.doctor(0) };
  assert.equal((await keeper.post('/warehouse/issues', { ...base, lines: [{ item_id: item.a, qty: 9 }] })).status, 409, 'faqat 8 tasi yaroqli');
  const ok = await keeper.post('/warehouse/issues', { ...base, lines: [{ item_id: item.a, qty: 4 }] });
  assert.equal(ok.status, 201);
  const mv = (await pool.query(`SELECT b.batch_no, m.quantity, m.receiver_membership_id, m.purpose FROM inventory_movements m JOIN inventory_batches b ON b.id = m.batch_id WHERE m.request_id = $1 ORDER BY m.seq`, [ok.body.data.id])).rows;
  assert.deepEqual(mv.map((x) => [x.batch_no, Number(x.quantity)]), [['L1', 3], ['L2', 1]]);
  assert.ok(mv.every((x) => x.receiver_membership_id === M.doctor(0) && x.purpose === 'department'));
  assert.equal(await batchQty(expired), 50);
  // mandatory fields
  assert.equal((await keeper.post('/warehouse/issues', { ...base, receiver_membership_id: undefined, lines: [{ item_id: item.a, qty: 1 }] })).status, 422, 'kim oldi');
  assert.equal((await keeper.post('/warehouse/issues', { ...base, purpose: undefined, lines: [{ item_id: item.a, qty: 1 }] })).status, 422, 'maqsad');
  assert.equal((await keeper.post('/warehouse/issues', { ...base, purpose: 'patient', lines: [{ item_id: item.a, qty: 1 }] })).status, 422, 'qabul');
  assert.equal((await keeper.post('/warehouse/issues', { ...base, purpose: 'patient', encounter_id: openEnc, lines: [{ item_id: item.a, qty: 1 }] })).status, 422, 'MKB-10 kodi');
  assert.equal((await keeper.post('/warehouse/issues', { ...base, purpose: 'patient', encounter_id: openEnc, icd_codes: ['Z99.99'], lines: [{ item_id: item.a, qty: 1 }] })).status, 422, 'ro‘yxatda yo‘q kod');
  assert.equal((await keeper.post('/warehouse/issues', { ...base, purpose: 'department', encounter_id: openEnc, lines: [{ item_id: item.a, qty: 1 }] })).status, 422);
  const pat = await keeper.post('/warehouse/issues', { ...base, purpose: 'patient', encounter_id: openEnc, icd_codes: ['I10'], lines: [{ item_id: item.a, qty: 1 }] });
  assert.equal(pat.status, 201);
  const m = (await pool.query(`SELECT patient_id, encounter_id, icd_codes FROM inventory_movements WHERE request_id = $1`, [pat.body.data.id])).rows[0];
  assert.equal(m.patient_id, openPatient); assert.equal(m.encounter_id, openEnc); assert.deepEqual(m.icd_codes, ['I10']);
  // the database refuses an issue without a person or purpose even if the API were bypassed
  await assert.rejects(pool.query(`INSERT INTO inventory_movements (id, tenant_id, item_id, type, quantity, reason, actor_name, occurred_at, kind, batch_id, branch_id)
    VALUES (gen_random_uuid(), $1, $2, 'out', 1, 'x', 'x', now(), 'issue', $3, $4)`, [SEED_IDS.tenant, item.a, expired, BC]));
  await ledgerMatchesBatches();
});

test('talabnoma: shifokor o‘z qabuli uchun; begona qabul 403; qisman berish; to‘liq; o‘zinikini ko‘radi; bekor qilish qoidalari', async () => {
  const body = { branch_id: BC, purpose: 'patient', department: 'Muolaja xonasi', encounter_id: openEnc, lines: [{ item_id: item.ceftri, qty: 4 }, { item_id: item.lido, qty: 2 }] };
  assert.equal((await doctor.post('/warehouse/requests', body)).status, 422, 'qaydda MKB yo‘q — kod kerak');
  assert.equal((await doctor2.post('/warehouse/requests', { ...body, icd_codes: ['I10'] })).status, 403, 'boshqa shifokorning qabuli');
  const r = await doctor.post('/warehouse/requests', { ...body, icd_codes: ['J06.9'] });
  assert.equal(r.status, 201);
  const id = r.body.data.id;
  const ctx = (await doctor.get(`/warehouse/encounters/${openEnc}`)).body.data;
  assert.ok(ctx.requests.some((x) => x.id === id));
  assert.equal((await doctor2.get(`/warehouse/encounters/${openEnc}`)).status, 403);
  assert.ok((await doctor.get('/warehouse/requests')).body.data.every((x) => x.requester_membership_id === M.doctor(0)), 'faqat o‘ziniki');
  assert.equal((await doctor2.get(`/warehouse/requests/${id}`)).status, 404);
  assert.ok((await keeper.get('/warehouse/requests?status=open')).body.data.some((x) => x.id === id));
  const req = (await keeper.get(`/warehouse/requests/${id}`)).body.data;
  const lCef = req.lines.find((l) => l.item_id === item.ceftri);
  const before = await stock(item.ceftri);
  const p1 = await keeper.post(`/warehouse/requests/${id}/issue`, { lines: [{ line_id: lCef.id, qty: 3 }] });
  assert.equal(p1.status, 200); assert.equal(p1.body.data.status, 'partially_issued');
  assert.equal(await stock(item.ceftri), before - 3);
  assert.equal((await keeper.post(`/warehouse/requests/${id}/issue`, { lines: [{ line_id: lCef.id, qty: 5 }] })).status, 422, 'so‘ralgandan ko‘p');
  assert.equal((await doctor.post(`/warehouse/requests/${id}/cancel`)).status, 409, 'berila boshlangan talabnoma bekor qilinmaydi');
  const p2 = await keeper.post(`/warehouse/requests/${id}/issue`, {});
  assert.equal(p2.body.data.status, 'issued');
  const mv = (await keeper.get(`/warehouse/requests/${id}`)).body.data.movements;
  assert.ok(mv.every((m) => m.receiver_name === 'Akmal Rasulov' && m.kind === 'issue'));
  const rows = (await pool.query(`SELECT DISTINCT receiver_membership_id, patient_id, encounter_id, icd_codes FROM inventory_movements WHERE request_id = $1`, [id])).rows;
  assert.deepEqual(rows.map((x) => [x.receiver_membership_id, x.patient_id, x.encounter_id, x.icd_codes.join()]), [[M.doctor(0), openPatient, openEnc, 'J06.9']]);
  assert.equal((await keeper.post(`/warehouse/requests/${id}/issue`, {})).status, 409, 'eskirgan holat');
  // draft → submit; cancel; reject by the storekeeper
  const d = await doctor.post('/warehouse/requests', { branch_id: BC, purpose: 'department', department: 'Muolaja xonasi', lines: [{ item_id: item.salfetka, qty: 10 }], draft: true });
  assert.ok(!(await keeper.get('/warehouse/requests')).body.data.some((x) => x.id === d.body.data.id), 'qoralama omborchiga ko‘rinmaydi');
  assert.equal((await doctor.post(`/warehouse/requests/${d.body.data.id}/submit`)).status, 200);
  assert.equal((await doctor.post(`/warehouse/requests/${d.body.data.id}/cancel`)).status, 200);
  const e = await doctor.post('/warehouse/requests', { branch_id: BC, purpose: 'department', department: 'Muolaja xonasi', lines: [{ item_id: item.salfetka, qty: 10 }] });
  assert.equal((await doctor.post(`/warehouse/requests/${e.body.data.id}/reject`, { reason: 'yo‘q' })).status, 403);
  assert.equal((await keeper.post(`/warehouse/requests/${e.body.data.id}/reject`, { reason: 'Bo‘limda zaxira yetarli' })).status, 200);
  assert.equal((await keeper.get(`/warehouse/requests/${e.body.data.id}`)).body.data.status, 'rejected');
  await ledgerMatchesBatches();
});

test('qaytarish: o‘sha partiyaga, berilganidan ko‘p emas; shifokor/bemor saqlanadi', async () => {
  const m = (await pool.query(`SELECT id, batch_id, quantity FROM inventory_movements WHERE kind = 'issue' AND item_id = $1 AND voided_at IS NULL ORDER BY seq DESC LIMIT 1`, [item.ceftri])).rows[0];
  const q0 = await batchQty(m.batch_id);
  assert.equal((await keeper.post(`/warehouse/movements/${m.id}/return`, { qty: Number(m.quantity) + 1, reason: 'ortiqcha' })).status, 422);
  const r = await keeper.post(`/warehouse/movements/${m.id}/return`, { qty: 1, reason: 'Ishlatilmadi' });
  assert.equal(r.status, 201);
  assert.equal(await batchQty(m.batch_id), q0 + 1);
  const ret = (await pool.query(`SELECT kind, batch_id, receiver_membership_id, patient_id, return_of FROM inventory_movements WHERE id = $1`, [r.body.data.id])).rows[0];
  assert.equal(ret.kind, 'return'); assert.equal(ret.batch_id, m.batch_id); assert.equal(ret.return_of, m.id); assert.ok(ret.receiver_membership_id && ret.patient_id);
  assert.equal((await doctor.post(`/warehouse/movements/${m.id}/return`, { qty: 1, reason: 'x x x' })).status, 403);
  await ledgerMatchesBatches();
});

test('hisobdan chiqarish: komissiya ≥ 3; omborchi tuzadi, rahbar tasdiqlaydi; o‘zi tuzganini o‘zi tasdiqlamaydi', async () => {
  const b = (await keeper.get(`/warehouse/batches?item_id=${item.a}`)).body.data.find((x) => !x.expired && x.qty >= 1);
  const body = { branch_id: BC, reason: 'damaged', note: 'Ampula singan', commission: ['Sherzod Qodirov', 'Gulnora Saidova', 'Feruza Mirzayeva'], lines: [{ batch_id: b.id, qty: 1 }] };
  assert.equal((await keeper.post('/warehouse/writeoffs', { ...body, commission: ['A aa', 'B bb'] })).status, 422);
  assert.equal((await keeper.post('/warehouse/writeoffs', { ...body, lines: [{ batch_id: b.id, qty: 1000 }] })).status, 422);
  const w = await keeper.post('/warehouse/writeoffs', body);
  assert.equal(w.status, 201);
  const q0 = await batchQty(b.id);
  assert.equal((await keeper.post(`/warehouse/writeoffs/${w.body.data.id}/decide`, { approve: true })).status, 403, 'omborchi tasdiqlamaydi');
  assert.equal(await batchQty(b.id), q0, 'tasdiqsiz qoldiq o‘zgarmaydi');
  assert.equal((await manager.post(`/warehouse/writeoffs/${w.body.data.id}/decide`, { approve: true })).status, 200);
  assert.equal(await batchQty(b.id), q0 - 1);
  assert.equal((await manager.post(`/warehouse/writeoffs/${w.body.data.id}/decide`, { approve: true })).status, 409);
  const own = await manager.post('/warehouse/writeoffs', body);
  assert.equal((await manager.post(`/warehouse/writeoffs/${own.body.data.id}/decide`, { approve: true })).status, 409, 'ikkinchi imzo boshqa odamdan');
  const mv = (await pool.query(`SELECT second_signer_name, actor_name FROM inventory_movements WHERE writeoff_id = $1`, [w.body.data.id])).rows[0];
  assert.deepEqual([mv.actor_name, mv.second_signer_name], ['Dilnoza Karimova', 'Sherzod Qodirov']);
  await ledgerMatchesBatches();
});

test('nazoratdagi dori: rahbar tasdig‘i + omborchi berishi (ikki imzo), to‘g‘ridan-to‘g‘ri berib bo‘lmaydi, jurnal o‘zgarmas', async () => {
  const base = { branch_id: BC, purpose: 'patient', department: 'Muolaja xonasi', encounter_id: openEnc, icd_codes: ['M54.5'], lines: [{ item_id: item.tramadol, qty: 1 }] };
  assert.equal((await keeper.post('/warehouse/issues', { ...base, receiver_membership_id: M.doctor(0) })).status, 409);
  assert.equal((await keeper.post(`/inventory/${item.tramadol}/movements`, { type: 'out', quantity: 1, reason: 'Tezkor chiqim' })).status, 409);
  // the storekeeper cannot lift the special regime to skip the second signature
  assert.equal((await keeper.patch(`/inventory/${item.tramadol}`, { controlled: false })).status, 403, 'nazoratni faqat rahbar o‘zgartiradi');
  // a manager who asks for a controlled drug cannot approve their own request
  const mine = await manager.post('/warehouse/requests', { ...base, purpose: 'department', encounter_id: undefined, icd_codes: undefined });
  assert.equal(mine.status, 201, mine.text);
  assert.equal((await manager.post(`/warehouse/requests/${mine.body.data.id}/approve`)).status, 409, 'o‘zi so‘raganini o‘zi tasdiqlamaydi');
  const r = await doctor.post('/warehouse/requests', base);
  assert.equal(r.status, 201); assert.equal(r.body.data.needs_approval, true);
  const id = r.body.data.id;
  assert.equal((await keeper.post(`/warehouse/requests/${id}/issue`, {})).status, 409, 'tasdiqsiz berilmaydi');
  assert.equal((await keeper.post(`/warehouse/requests/${id}/approve`)).status, 403, 'omborchi tasdiqlamaydi');
  assert.equal((await manager.post(`/warehouse/requests/${id}/approve`)).status, 200);
  assert.equal((await manager.post(`/warehouse/requests/${id}/issue`, {})).status, 409, 'tasdiqlagan o‘zi bermaydi');
  const before = await stock(item.tramadol);
  assert.equal((await keeper.post(`/warehouse/requests/${id}/issue`, {})).status, 200);
  assert.equal(await stock(item.tramadol), before - 1);
  const j = (await keeper.get(`/warehouse/controlled/${item.tramadol}`)).body.data;
  const e = j.entries.at(-1);
  assert.deepEqual([e.actor_name, e.second_signer_name, e.receiver_name, e.kind], ['Sherzod Qodirov', 'Dilnoza Karimova', 'Akmal Rasulov', 'issue']);
  assert.equal(Number(e.balance), before - 1);
  assert.equal((await keeper.get(`/warehouse/controlled/${item.ceftri}`)).status, 409, 'oddiy dori uchun jurnal yo‘q');
  // append-only: no edit, no delete — only a one-time void with a reason (manager), which reverses the quantity
  await assert.rejects(pool.query(`UPDATE inventory_movements SET quantity = 2 WHERE id = $1`, [e.id]), /append-only/);
  await assert.rejects(pool.query(`DELETE FROM inventory_movements WHERE id = $1`, [e.id]), /append-only/);
  await assert.rejects(pool.query(`UPDATE inventory_movements SET voided_at = now(), voided_by_name = 'x', void_reason = 'x', receiver_name = 'boshqa' WHERE id = $1`, [e.id]), /append-only/);
  await assert.rejects(pool.query(`UPDATE inventory_batches SET expiry_date = '2030-01-01' WHERE item_id = $1`, [item.tramadol]), /balance/);
  await assert.rejects(pool.query(`DELETE FROM inventory_batches WHERE item_id = $1`, [item.tramadol]));
  assert.equal((await keeper.post(`/warehouse/movements/${e.id}/void`, { reason: 'Xato yozuv' })).status, 403);
  assert.equal((await manager.post(`/warehouse/movements/${e.id}/void`, { reason: 'x' })).status, 422, 'sabab');
  assert.equal((await manager.post(`/warehouse/movements/${e.id}/void`, { reason: 'Noto‘g‘ri bemor tanlangan' })).status, 200);
  assert.equal(await stock(item.tramadol), before);
  assert.equal((await manager.post(`/warehouse/movements/${e.id}/void`, { reason: 'Yana bir marta' })).status, 409);
  const j2 = (await keeper.get(`/warehouse/controlled/${item.tramadol}`)).body.data;
  assert.equal(Number(j2.entries.at(-1).balance), before);
  assert.ok(j2.entries.some((x) => x.id === e.id && x.voided_at && x.void_reason), 'bekor qilingan yozuv jurnalda qoladi');
  await ledgerMatchesBatches();
});

test('poyga: oxirgi birlikni ikki kishi bir vaqtda — bittasi beriladi, ikkinchisi 409', async () => {
  const cr = await keeper.post('/inventory', { name: 'Oxirgi dona', unit: 'dona', branch_id: BC, opening_qty: 1 });
  const body = { branch_id: BC, purpose: 'department', department: 'Muolaja xonasi', receiver_membership_id: M.doctor(0), lines: [{ item_id: cr.body.data.id, qty: 1 }] };
  const rs = await Promise.all([keeper.post('/warehouse/issues', body), manager.post('/warehouse/issues', body), keeper.post('/warehouse/issues', body)]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409]);
  assert.equal(await stock(cr.body.data.id), 0);
  await ledgerMatchesBatches();
});

test('inventarizatsiya: kutilgan → sanalgan → farq sababi → rahbar tasdig‘i → tuzatish harakati', async () => {
  const s = await keeper.post('/warehouse/counts', { branch_id: BC, scope: 'controlled', commission: ['Sherzod Qodirov', 'Dilnoza Karimova', 'Feruza Mirzayeva'] });
  assert.equal(s.status, 201);
  assert.equal((await keeper.post('/warehouse/counts', { branch_id: BC })).status, 409, 'bitta ochiq inventarizatsiya');
  const c = (await keeper.get(`/warehouse/counts/${s.body.data.id}`)).body.data;
  assert.ok(c.lines.length && c.lines.every((l) => l.controlled));
  assert.equal((await keeper.post(`/warehouse/counts/${c.id}/submit`)).status, 422, 'sanalmagan qatorlar');
  const lines = c.lines.map((l, i) => ({ line_id: l.id, counted_qty: i === 0 ? Number(l.expected_qty) - 1 : Number(l.expected_qty), reason: null }));
  assert.equal((await keeper.put(`/warehouse/counts/${c.id}/lines`, { lines })).status, 200);
  assert.equal((await keeper.post(`/warehouse/counts/${c.id}/submit`)).status, 422, 'farq sababi');
  lines[0].reason = 'Singan ampula, akt tuziladi';
  await keeper.put(`/warehouse/counts/${c.id}/lines`, { lines });
  assert.equal((await keeper.post(`/warehouse/counts/${c.id}/submit`)).status, 200);
  const q0 = await batchQty(c.lines[0].batch_id);
  assert.equal((await keeper.post(`/warehouse/counts/${c.id}/decide`, { approve: true })).status, 403);
  const d = await manager.post(`/warehouse/counts/${c.id}/decide`, { approve: true });
  assert.equal(d.status, 200); assert.equal(d.body.data.adjusted, 1);
  assert.equal(await batchQty(c.lines[0].batch_id), q0 - 1);
  const adj = (await pool.query(`SELECT kind, type, quantity FROM inventory_movements WHERE count_id = $1`, [c.id])).rows;
  assert.deepEqual(adj.map((x) => [x.kind, x.type, Number(x.quantity)]), [['adjust', 'out', 1]]);
  // a manager who entered a counted quantity cannot approve that count (the person counting ≠ the person approving)
  const s2 = await keeper.post('/warehouse/counts', { branch_id: BC, scope: 'controlled', commission: ['Sherzod Qodirov', 'Dilnoza Karimova', 'Feruza Mirzayeva'] });
  assert.equal(s2.status, 201, s2.text);
  const c2 = (await keeper.get(`/warehouse/counts/${s2.body.data.id}`)).body.data;
  const lines2 = c2.lines.map((l) => ({ line_id: l.id, counted_qty: Number(l.expected_qty), reason: null }));
  assert.equal((await manager.put(`/warehouse/counts/${c2.id}/lines`, { lines: lines2.slice(0, 1) })).status, 200);
  await keeper.put(`/warehouse/counts/${c2.id}/lines`, { lines: lines2.slice(1) });
  assert.equal((await keeper.post(`/warehouse/counts/${c2.id}/submit`)).status, 200);
  assert.equal((await manager.post(`/warehouse/counts/${c2.id}/decide`, { approve: true })).status, 409, 'sanagan rahbar o‘zi tasdiqlamaydi');
  await ledgerMatchesBatches();
});

test('hisobotlar: har bir guruh yig‘indisi = jami = daftar (berilgan − qaytarilgan, bekor qilinganlarsiz)', async () => {
  const from = '2026-09-01';
  const ledger = Number((await pool.query(
    `SELECT coalesce(sum(CASE WHEN kind = 'issue' THEN value ELSE -value END),0) AS v FROM inventory_movements WHERE tenant_id = $1 AND kind IN ('issue','return') AND voided_at IS NULL AND occurred_at >= $2`,
    [SEED_IDS.tenant, from])).rows[0].v);
  assert.ok(ledger > 0);
  for (const g of ['doctor', 'patient', 'icd', 'service', 'department', 'item']) {
    const r = (await manager.get(`/warehouse/reports/consumption?group=${g}&from=${from}&to=${today}`)).body.data;
    assert.equal(r.total, ledger, g);
    assert.equal(r.rows.reduce((a, x) => a + x.value, 0), ledger, `${g}: guruhlar yig‘indisi`);
  }
  const byPatient = (await keeper.get(`/warehouse/reports/consumption?group=patient&from=${from}&to=${today}`)).body.data.rows;
  assert.ok(byPatient.some((x) => x.label && x.key));
  assert.equal((await manager.get(`/warehouse/reports/consumption?from=2024-01-01&to=${today}`)).status, 422, 'davr ≤ 1 yil');
});

test('CSV: davr majburiy va ≤ 1 yil; Excel uchun BOM; rollar', async () => {
  assert.equal((await keeper.get('/warehouse/movements.csv')).status, 422);
  assert.equal((await keeper.get(`/warehouse/movements.csv?from=2025-01-01&to=${today}`)).status, 422);
  const r = await keeper.get(`/warehouse/movements.csv?from=2026-09-01&to=${today}`);
  assert.equal(r.status, 200); assert.match(r.type, /text\/csv/);
  assert.ok(r.text.includes('Tramadol') && r.text.split('\n').length > 10);
  assert.equal((await doctor.get(`/warehouse/movements.csv?from=2026-09-01&to=${today}`)).status, 403);
  const page = (await keeper.get(`/warehouse/movements?from=2026-09-01&to=${today}&page_size=5`)).body;
  assert.equal(page.data.length, 5); assert.ok(page.meta.total > 5);
});

test('muzlatkich jurnali: me’yordan tashqari belgisi, faqat qo‘shiladi; audit yozuvlari', async () => {
  const r = await keeper.post('/warehouse/fridge', { branch_id: BC, fridge: 'Muzlatkich №1 (dorilar)', temperature: 9.5 });
  assert.equal(r.status, 201); assert.equal(r.body.data.out_of_range, true);
  assert.equal((await keeper.post('/warehouse/fridge', { branch_id: BC, fridge: 'Muzlatkich №1', temperature: 5 })).body.data.out_of_range, false);
  await assert.rejects(pool.query(`UPDATE fridge_temperature_log SET temperature = 5 WHERE id = $1`, [r.body.data.id]));
  assert.equal((await doctor.post('/warehouse/fridge', { branch_id: BC, fridge: 'x', temperature: 5 })).status, 403);
  const actions = (await pool.query(`SELECT DISTINCT action FROM audit_logs WHERE tenant_id = $1 AND action LIKE 'warehouse.%'`, [SEED_IDS.tenant])).rows.map((x) => x.action);
  for (const a of ['warehouse.receipt', 'warehouse.request', 'warehouse.issue', 'warehouse.issue_direct', 'warehouse.return', 'warehouse.writeoff', 'warehouse.writeoff_approve', 'warehouse.request_approve', 'warehouse.void', 'warehouse.count_approve', 'warehouse.fridge'])
    assert.ok(actions.includes(a), a);
  // no clinical text in the warehouse audit
  const sums = (await pool.query(`SELECT summary FROM audit_logs WHERE tenant_id = $1 AND action LIKE 'warehouse.%'`, [SEED_IDS.tenant])).rows.map((x) => x.summary).join('\n');
  assert.ok(!/J06|I10|M54/.test(sums), 'auditda tashxis kodi yo‘q');
});

test('xodimlar: rahbar omborchi qo‘sha oladi va rolini almashtira oladi', async () => {
  const r = await manager.post('/staff', { full_name: 'Yangi Omborchi', role: 'storekeeper', login: 'ombor_sinov', branch_ids: [BC] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const list = (await manager.get('/staff')).body.data;
  assert.ok(list.some((s) => s.role === 'storekeeper' && s.full_name === 'Yangi Omborchi'));
});
