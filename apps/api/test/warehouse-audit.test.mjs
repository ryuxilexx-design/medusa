// Regression tests of the warehouse audit (2026-10-25, docs/WAREHOUSE.md «Audit 2026-10-25»): one test per finding
// B1–B21 (B17 and B22 live in reorder.test.mjs). Every test names the finding it guards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
const BC = SEED_IDS.branchCentral;
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t, type: r.headers.get('content-type') };
  };
  return {
    get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), put: (p, b) => req('PUT', p, b), patch: (p, b) => req('PATCH', p, b),
    demo: (mid) => req('POST', '/demo/login', { membership_id: mid }),
    receipt: (b, key = randomUUID()) => req('POST', '/warehouse/receipts', b, { 'Idempotency-Key': key }),
  };
}

let keeper, manager, doctor, doctor2, registrar, cashier, lab, today, openEnc;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  keeper = session(); await keeper.demo(M.storekeeper);
  doctor = session(); await doctor.demo(M.doctor(0));
  doctor2 = session(); await doctor2.demo(M.doctor(1));
  registrar = session(); await registrar.demo(M.registrar);
  cashier = session(); await cashier.demo(M.cashier);
  lab = session(); await lab.demo(M.lab);
  today = (await doctor.get('/me')).body.data.today;
  const a = (await doctor.get(`/appointments?date=${today}`)).body.data.find((x) => x.status === 'in_progress' && x.encounter_id);
  openEnc = a.encounter_id;
});
after(async () => { await app?.close(); });

let n = 0;
/** A fresh item of the central branch with an opening balance (one batch without series). */
async function newItem(opening = 20, extra = {}) {
  const r = await keeper.post('/inventory', { name: `Audit ${++n}: ${randomUUID().slice(0, 6)}`, unit: 'dona', branch_id: BC, opening_qty: opening, purchase_price: 10000, ...extra });
  assert.equal(r.status, 201, r.text);
  return r.body.data.id;
}
const stock = async (id) => Number((await pool.query(`SELECT coalesce(sum(qty),0) AS q FROM inventory_batches WHERE item_id = $1`, [id])).rows[0].q);
const dept = (itemId, qty, receiver = M.doctor(0)) => ({ branch_id: BC, purpose: 'department', department: 'Muolaja xonasi', receiver_membership_id: receiver, lines: [{ item_id: itemId, qty }] });
async function ledgerMatchesBatches() {
  const bad = (await pool.query(
    `SELECT i.name FROM inventory_items i WHERE i.tenant_id = $1 AND i.opening_qty + coalesce((SELECT sum(CASE WHEN m.type = 'in' THEN m.quantity ELSE -m.quantity END) FROM inventory_movements m WHERE m.item_id = i.id),0)
       <> coalesce((SELECT sum(qty) FROM inventory_batches b WHERE b.item_id = i.id),0)`, [SEED_IDS.tenant])).rows;
  assert.deepEqual(bad, [], 'qoldiq = partiyalar yig‘indisi');
}
/** Counts every line of a count at the expected quantity (taken from the database: the counter never sees it), except `diff`. */
async function countAll(who, countId, diff = {}) {
  const rows = (await pool.query(`SELECT l.id, l.expected_qty, b.item_id FROM inventory_count_lines l JOIN inventory_batches b ON b.id = l.batch_id WHERE l.count_id = $1`, [countId])).rows;
  const lines = rows.map((r) => ({ line_id: r.id, counted_qty: Number(r.expected_qty) + (diff[r.item_id] ?? 0), reason: null }));
  for (let i = 0; i < lines.length; i += 500) assert.equal((await who.put(`/warehouse/counts/${countId}/lines`, { lines: lines.slice(i, i + 500) })).status, 200);
  return rows;
}

test('B1: ochiq inventarizatsiya paytida sanalayotgan material harakatlanmaydi (409); tasdiqlashda farq bir marta qo‘llanadi', async () => {
  const it = await newItem(20);
  const s = await keeper.post('/warehouse/counts', { branch_id: BC, scope: 'all' });
  assert.equal(s.status, 201, s.text);
  const id = s.body.data.id;
  const issue = await keeper.post('/warehouse/issues', dept(it, 2));
  assert.equal(issue.status, 409); assert.equal(issue.body.error.code, 'COUNT_IN_PROGRESS');
  const rc = await keeper.receipt({ branch_id: BC, supplier: 'Audit ta’minot', invoice_no: 'B1-1', invoice_date: today, lines: [{ item_id: it, batch_no: 'B1', qty: 5, unit_cost: 100 }] });
  assert.equal(rc.status, 409); assert.equal(rc.body.error.code, 'COUNT_IN_PROGRESS');
  // a doctor may still write a request; it is issued after the count
  const req = await doctor.post('/warehouse/requests', { branch_id: BC, purpose: 'department', department: 'Muolaja xonasi', lines: [{ item_id: it, qty: 2 }] });
  assert.equal(req.status, 201);
  assert.equal((await keeper.post(`/warehouse/requests/${req.body.data.id}/issue`, {})).status, 409);
  assert.equal(await stock(it), 20, 'sanash paytida qoldiq o‘zgarmadi');
  // one short on the shelf
  await countAll(keeper, id, { [it]: -1 });
  assert.equal((await keeper.post(`/warehouse/counts/${id}/submit`)).status, 200);
  // handed in: the warehouse works again; the 2 issued now are not subtracted a second time by the approval
  assert.equal((await keeper.post(`/warehouse/requests/${req.body.data.id}/issue`, {})).status, 200);
  assert.equal(await stock(it), 18);
  const line = (await pool.query(`SELECT l.id FROM inventory_count_lines l JOIN inventory_batches b ON b.id = l.batch_id WHERE l.count_id = $1 AND b.item_id = $2`, [id, it])).rows[0].id;
  const d = await manager.post(`/warehouse/counts/${id}/decide`, { approve: true, reasons: [{ line_id: line, reason: 'Yo‘qolgan, tushuntirish xati olindi' }] });
  assert.equal(d.status, 200, d.text); assert.equal(d.body.data.adjusted, 1);
  assert.equal(await stock(it), 17, '20 − 2 (berildi) − 1 (kamomad) = 17, ikki marta ayrilmaydi');
  await ledgerMatchesBatches();
});

test('B2: ko‘r sanash — sanovchi hisobdagi miqdorni ko‘rmaydi; rahbar faqat topshirilgandan keyin ko‘radi; B15: qatorlar sahifalab', async () => {
  const s = await keeper.post('/warehouse/counts', { branch_id: BC, scope: 'all' });
  const id = s.body.data.id;
  for (const who of [keeper, manager]) {
    const c = (await who.get(`/warehouse/counts/${id}`)).body.data;
    assert.ok(c.lines.length > 0 && c.lines.every((l) => l.expected_qty === null && l.unit_cost === null), 'ochiq hisobda hech kim ko‘rmaydi');
    assert.equal(c.sees_expected, false); assert.equal(c.differences, null);
  }
  const page = await keeper.get(`/warehouse/counts/${id}?page=2&page_size=10`);
  assert.equal(page.body.data.lines.length, 10); assert.ok(page.body.meta.total > 10);
  assert.equal(page.body.data.lines_total, page.body.meta.total); assert.equal(page.body.data.lines_counted, 0);
  assert.equal((await keeper.get(`/warehouse/counts/${id}?all=1`)).body.data.lines.length, page.body.meta.total, 'chop etish uchun hammasi');
  const rows = await countAll(keeper, id);
  // progress and filters
  const c1 = (await keeper.get(`/warehouse/counts/${id}?only=uncounted`)).body;
  assert.equal(c1.data.lines_counted, rows.length); assert.equal(c1.meta.total, 0);
  assert.equal((await keeper.post(`/warehouse/counts/${id}/submit`)).status, 200);
  assert.equal((await keeper.get(`/warehouse/counts/${id}`)).body.data.lines[0].expected_qty, null, 'omborchi topshirgandan keyin ham ko‘rmaydi');
  const m = (await manager.get(`/warehouse/counts/${id}`)).body.data;
  assert.equal(m.sees_expected, true); assert.ok(m.lines.every((l) => l.expected_qty !== null)); assert.equal(m.differences, 0);
  assert.ok((await keeper.get('/warehouse/counts')).body.data.every((c) => c.differences === null));
  assert.equal((await manager.post(`/warehouse/counts/${id}/decide`, { approve: true })).status, 200);
});

test('B3: eski «tezkor kirim/chiqim» yopilgan (410), qoldiq o‘zgarmaydi', async () => {
  const it = await newItem(5);
  for (const s of [keeper, manager]) {
    for (const type of ['in', 'out']) {
      const r = await s.post(`/inventory/${it}/movements`, { type, quantity: 1, reason: 'Eski yo‘l', date: '2026-01-01' });
      assert.equal(r.status, 410); assert.equal(r.body.error.code, 'MOVEMENT_ENDPOINT_REMOVED');
    }
  }
  assert.equal(await stock(it), 5);
});

test('B4: bemor uchun material faqat davolovchi shifokor so‘raydi; rahbar/omborchi bemor nomidan so‘ramaydi va bermaydi', async () => {
  const it = await newItem(10);
  const body = { branch_id: BC, purpose: 'patient', department: 'Muolaja xonasi', encounter_id: openEnc, icd_codes: ['I10'], lines: [{ item_id: it, qty: 1 }] };
  assert.equal((await manager.post('/warehouse/requests', body)).status, 403, 'rahbar bemor nomidan so‘ramaydi');
  assert.equal((await keeper.post('/warehouse/requests', body)).status, 403);
  assert.equal((await keeper.post('/warehouse/issues', { ...body, receiver_membership_id: M.doctor(0) })).status, 422, 'to‘g‘ridan-to‘g‘ri bemorga emas');
  const r = await doctor.post('/warehouse/requests', body);
  assert.equal(r.status, 201, r.text);
  assert.equal((await keeper.post(`/warehouse/requests/${r.body.data.id}/issue`, {})).status, 200);
  const mv = (await pool.query(`SELECT receiver_membership_id, actor_membership_id FROM inventory_movements WHERE request_id = $1`, [r.body.data.id])).rows[0];
  assert.equal(mv.receiver_membership_id, M.doctor(0)); assert.equal(mv.actor_membership_id, M.storekeeper);
});

test('B5: material keyin nazoratga olinsa ochiq talabnoma qotib qolmaydi — tasdiq va berish bir xil qoidada', async () => {
  const it = await newItem(10);
  const r = await doctor.post('/warehouse/requests', { branch_id: BC, purpose: 'department', department: 'Muolaja xonasi', lines: [{ item_id: it, qty: 2 }] });
  assert.equal(r.body.data.needs_approval, false);
  assert.equal((await manager.patch(`/inventory/${it}`, { controlled: true })).status, 200);
  assert.equal((await keeper.get(`/warehouse/requests/${r.body.data.id}`)).body.data.needs_approval, true, 'ro‘yxatda ham tasdiq kerak deb ko‘rinadi');
  const blocked = await keeper.post(`/warehouse/requests/${r.body.data.id}/issue`, {});
  assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'APPROVAL_REQUIRED');
  assert.equal((await manager.post(`/warehouse/requests/${r.body.data.id}/approve`)).status, 200, 'NO_APPROVAL_NEEDED emas');
  assert.equal((await keeper.post(`/warehouse/requests/${r.body.data.id}/issue`, {})).status, 200);
  // the other way: a request written while controlled still needs the signature after the flag is lifted
  const r2 = await doctor.post('/warehouse/requests', { branch_id: BC, purpose: 'department', department: 'Muolaja xonasi', lines: [{ item_id: it, qty: 1 }] });
  assert.equal(r2.body.data.needs_approval, true);
  assert.equal((await manager.patch(`/inventory/${it}`, { controlled: false })).status, 200);
  assert.equal((await keeper.post(`/warehouse/requests/${r2.body.data.id}/issue`, {})).status, 409);
  assert.equal((await manager.post(`/warehouse/requests/${r2.body.data.id}/approve`)).status, 200);
  assert.equal((await keeper.post(`/warehouse/requests/${r2.body.data.id}/issue`, {})).status, 200);
});

test('B6: sovuq zanjir — qurilma ma’lumotnomasi, har qurilmaning o‘z me’yori, me’yordan tashqarida chora majburiy', async () => {
  const list = (await keeper.get('/warehouse/fridge/devices')).body.data;
  assert.deepEqual(list.map((d) => [d.kind, d.min_temp, d.max_temp]).sort(), [['freezer', -25, -15], ['fridge', 2, 8], ['room', 15, 25]]);
  // the old free-text log rows point at a device (migration)
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM fridge_temperature_log WHERE device_id IS NULL`)).rows[0].n, 0);
  const c = await keeper.post('/warehouse/fridge/devices', { branch_id: BC, name: 'Muzlatgich №2', kind: 'freezer' });
  assert.equal(c.status, 201, c.text);
  const dev = (await keeper.get('/warehouse/fridge/devices')).body.data.find((d) => d.id === c.body.data.id);
  assert.deepEqual([dev.min_temp, dev.max_temp], [-25, -15], 'turi bo‘yicha standart');
  assert.equal((await keeper.post('/warehouse/fridge/devices', { branch_id: BC, name: 'muzlatgich №2', kind: 'fridge' })).status, 409, 'nom takrori');
  assert.equal((await keeper.post('/warehouse/fridge/devices', { branch_id: BC, name: 'Xato', kind: 'room', min_temp: 25, max_temp: 15 })).status, 422);
  // a freezer at +5 °C is out of range (the old fixed 2–8 rule would have called it fine)
  const noNote = await keeper.post('/warehouse/fridge', { device_id: dev.id, temperature: 5 });
  assert.equal(noNote.status, 422); assert.ok(noNote.body.error.fields.note);
  const out = await keeper.post('/warehouse/fridge', { device_id: dev.id, temperature: 5, note: 'Eshik yopildi, quvvat tekshirildi' });
  assert.equal(out.status, 201); assert.equal(out.body.data.out_of_range, true);
  assert.equal((await keeper.post('/warehouse/fridge', { device_id: dev.id, temperature: -18.5 })).body.data.out_of_range, false);
  // the database refuses an out-of-range row without the action, even past the API
  await assert.rejects(pool.query(`INSERT INTO fridge_temperature_log (id, tenant_id, branch_id, fridge, device_id, recorded_at, temperature, min_allowed, max_allowed, recorded_by_name)
    VALUES (gen_random_uuid(), $1, $2, 'x', $3, now(), 0, -25, -15, 'x')`, [SEED_IDS.tenant, BC, dev.id]));
  // the range is the manager's
  assert.equal((await keeper.patch(`/warehouse/fridge/devices/${dev.id}`, { max_temp: 10 })).status, 403);
  assert.equal((await keeper.patch(`/warehouse/fridge/devices/${dev.id}`, { name: 'Muzlatgich №2 (zaxira)' })).status, 200);
  assert.equal((await manager.patch(`/warehouse/fridge/devices/${dev.id}`, { min_temp: -30, max_temp: -18 })).status, 200);
  assert.equal((await manager.patch(`/warehouse/fridge/devices/${dev.id}`, { active: false })).status, 200);
  assert.equal((await keeper.post('/warehouse/fridge', { device_id: dev.id, temperature: -20 })).status, 422, 'nofaol qurilma');
  for (const s of [doctor, cashier, registrar]) assert.equal((await s.get('/warehouse/fridge/devices')).status, 403);
  const log = (await keeper.get(`/warehouse/fridge?device_id=${dev.id}`)).body.data;
  assert.ok(log.length === 2 && log.every((r) => r.device_id === dev.id && r.kind === 'freezer' && r.min_allowed === -25));
});

test('B7: harakatlar CSV — jami qatori, raqamlar raqam (manfiy apostrofsiz), chegaradan oshsa 422; csvCell formula himoyasi saqlanadi', async () => {
  const { csvCell } = require('../dist/core/csv.js');
  assert.equal(csvCell('-12.50'), '"-12.50"');
  assert.equal(csvCell(-3), '"-3"');
  for (const f of ['=1+1', '-1+2', '+998901234567', '@SUM(A1)', '-2+3+cmd|\' /C calc\'!A0', '\tx']) assert.ok(csvCell(f).startsWith('"\''), f);
  const it = await newItem(10);
  assert.equal((await keeper.post('/warehouse/issues', dept(it, 3))).status, 201);
  const r = await keeper.get(`/warehouse/movements.csv?from=${today}&to=${today}&item_id=${it}`);
  assert.equal(r.status, 200);
  const lines = r.text.replace(/^﻿/, '').split('\r\n');
  const row = lines.find((l) => l.includes('"issue"')).split(';');
  assert.equal(row[6], '"-3.00"', 'chiqim — manfiy son, apostrofsiz');
  assert.equal(row[9], '"-300.00"');
  const total = lines.at(-1).split(';');
  assert.equal(total[0], '"Jami"'); assert.equal(total[6], '"-3.00"'); assert.equal(total[9], '"-300.00"');
  process.env.CSV_MAX_ROWS = '3';
  try {
    const big = await keeper.get(`/warehouse/movements.csv?from=2026-09-01&to=${today}`);
    assert.equal(big.status, 422, 'jimgina kesilmaydi'); assert.match(big.body.error.fields.from, /3/);
  } finally { delete process.env.CSV_MAX_ROWS; }
});

test('B8: omborchi qabullar ro‘yxatini, qabul tafsilotini va bemor/tashxis bo‘yicha hisobotni ko‘rmaydi; shifokor — faqat o‘z qabullari', async () => {
  assert.equal((await keeper.get(`/warehouse/visits?branch_id=${BC}`)).status, 403);
  assert.equal((await manager.get(`/warehouse/visits?branch_id=${BC}`)).status, 403);
  assert.equal((await keeper.get(`/warehouse/encounters/${openEnc}`)).status, 403);
  const mine = (await doctor.get(`/warehouse/visits?branch_id=${BC}`)).body.data;
  assert.ok(mine.length > 0);
  const docs = (await pool.query(`SELECT DISTINCT doctor_id FROM encounters WHERE id = ANY($1::uuid[])`, [mine.map((v) => v.encounter_id)])).rows.map((r) => r.doctor_id);
  assert.deepEqual(docs, [SEED_IDS.doctor(0)], 'faqat o‘z qabullari');
  const oldest = new Date(Date.parse(`${today}T00:00:00+05:00`) - 7 * 86400_000);
  assert.ok(mine.every((v) => new Date(v.started_at) >= oldest), 'oxirgi 7 kun');
  for (const g of ['patient', 'icd']) {
    assert.equal((await keeper.get(`/warehouse/reports/consumption?group=${g}`)).status, 403);
    assert.equal((await keeper.get(`/warehouse/reports/consumption.csv?group=${g}&from=${today}&to=${today}`)).status, 403);
  }
  const csv = await keeper.get(`/warehouse/reports/consumption.csv?group=department&from=2026-09-01&to=${today}`);
  assert.equal(csv.status, 200); assert.match(csv.text.split('\r\n').at(-1), /^"Jami"/);
});

test('B9: berish bekor qilinsa talabnoma qayta ochiladi va yana berish mumkin', async () => {
  const it = await newItem(10);
  const d = await keeper.post('/warehouse/issues', dept(it, 3));
  assert.equal(d.status, 201);
  const mv = (await pool.query(`SELECT id FROM inventory_movements WHERE request_id = $1 AND kind = 'issue'`, [d.body.data.id])).rows[0].id;
  assert.equal((await manager.post(`/warehouse/movements/${mv}/void`, { reason: 'Xato bo‘limga yozilgan' })).status, 200);
  const r = (await keeper.get(`/warehouse/requests/${d.body.data.id}`)).body.data;
  assert.equal(r.status, 'submitted'); assert.equal(Number(r.lines[0].issued_qty), 0); assert.equal(r.closed_at, null);
  assert.equal(await stock(it), 10);
  const again = await keeper.post(`/warehouse/requests/${d.body.data.id}/issue`, {});
  assert.equal(again.status, 200); assert.equal(again.body.data.status, 'issued');
  assert.equal(await stock(it), 7);
  // partly: one of two lines voided → partially issued
  const it2 = await newItem(10);
  const two = await keeper.post('/warehouse/issues', { ...dept(it, 1), lines: [{ item_id: it, qty: 1 }, { item_id: it2, qty: 2 }] });
  const mv2 = (await pool.query(`SELECT id FROM inventory_movements WHERE request_id = $1 AND item_id = $2`, [two.body.data.id, it2])).rows[0].id;
  assert.equal((await manager.post(`/warehouse/movements/${mv2}/void`, { reason: 'Ikkinchi qator xato' })).status, 200);
  assert.equal((await keeper.get(`/warehouse/requests/${two.body.data.id}`)).body.data.status, 'partially_issued');
  await ledgerMatchesBatches();
});

test('B10: kirim — Idempotency-Key majburiy, qayta yuborilsa bitta hujjat; bir nakladnaya ikki marta 409', async () => {
  const it = await newItem(0);
  const body = { branch_id: BC, supplier: 'Takror Farm', invoice_no: 'TF-77', invoice_date: today, lines: [{ item_id: it, batch_no: 'T1', expiry_date: '2027-12-31', qty: 4, unit_cost: 5000 }] };
  const noKey = await keeper.post('/warehouse/receipts', body);
  assert.equal(noKey.status, 422); assert.equal(noKey.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  const key = randomUUID();
  const [a, b] = await Promise.all([keeper.receipt(body, key), keeper.receipt(body, key)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(a.body.data.id, b.body.data.id);
  assert.equal(await stock(it), 4, 'bir marta');
  const dup = await keeper.receipt({ ...body, supplier: '  takror farm ', invoice_no: 'tf-77' });
  assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'DUPLICATE_RECEIPT');
  assert.equal((await keeper.receipt({ ...body, invoice_no: 'TF-78' })).status, 201, 'boshqa nakladnaya');
  assert.equal((await keeper.receipt({ ...body, invoice_no: 'TF-79' }, key)).status, 422, 'bir kalit — boshqa hujjat');
});

test('B11: qoldig‘i bor materialning o‘lchov birligi o‘zgarmaydi (409)', async () => {
  const it = await newItem(3);
  const r = await keeper.patch(`/inventory/${it}`, { unit: 'quti' });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'HAS_STOCK_UNIT');
  const empty = await newItem(0);
  assert.equal((await keeper.patch(`/inventory/${empty}`, { unit: 'quti' })).status, 200);
});

test('B12: nazoratdagi dorini so‘ragan ham, tasdiqlagan ham bermaydi', async () => {
  const it = await newItem(10);
  await manager.patch(`/inventory/${it}`, { controlled: true });
  const r = await doctor.post('/warehouse/requests', { branch_id: BC, purpose: 'department', department: 'Muolaja xonasi', lines: [{ item_id: it, qty: 1 }] });
  assert.equal((await manager.post(`/warehouse/requests/${r.body.data.id}/approve`)).status, 200);
  // the storekeeper as the requester (e.g. a request written for them) cannot also hand it out
  await pool.query(`UPDATE inventory_requests SET requester_membership_id = $2, requester_name = 'Sherzod Qodirov' WHERE id = $1`, [r.body.data.id, M.storekeeper]);
  const own = await keeper.post(`/warehouse/requests/${r.body.data.id}/issue`, {});
  assert.equal(own.status, 409); assert.equal(own.body.error.code, 'SECOND_SIGNATURE');
  assert.equal((await manager.post(`/warehouse/requests/${r.body.data.id}/issue`, {})).status, 409, 'tasdiqlagan bermaydi');
  assert.equal(await stock(it), 10);
});

test('B13: komissiya a’zolari har xil (katta-kichik harf, bo‘shliq, apostrof farq qilmaydi)', async () => {
  const it = await newItem(5);
  const b = (await keeper.get(`/warehouse/batches?item_id=${it}`)).body.data[0];
  const body = { branch_id: BC, reason: 'damaged', note: 'Singan', lines: [{ batch_id: b.id, qty: 1 }] };
  for (const commission of [['Ali Valiyev', 'ali  valiyev', 'Bek Bekov'], ['G‘ani Usmonov', "G'ani usmonov", 'Bek Bekov'], ['Ali Valiyev', 'Bek Bekov', 'Bek Bekov ']]) {
    const r = await keeper.post('/warehouse/writeoffs', { ...body, commission });
    assert.equal(r.status, 422, commission.join('|')); assert.ok(r.body.error.fields.commission);
  }
  assert.equal((await keeper.post('/warehouse/writeoffs', { ...body, commission: ['Ali Valiyev', 'Bek Bekov', 'Gulnora Saidova'] })).status, 201);
  assert.equal((await keeper.post('/warehouse/counts', { branch_id: BC, scope: 'controlled', commission: ['Ali Valiyev', 'ALI VALIYEV'] })).status, 422);
});

test('B14: kam qolgan belgisi muddati o‘tgan partiyani hisobga olmaydi', async () => {
  const it = await newItem(2, { minimum_qty: 5 });
  // 10 more, but already expired
  const b = (await pool.query(`INSERT INTO inventory_batches (id, tenant_id, item_id, batch_no, expiry_date, qty, received_qty, unit_cost, received_at)
    VALUES (gen_random_uuid(), $1, $2, 'EXP', '2026-01-01', 10, 10, 100, now()) RETURNING id`, [SEED_IDS.tenant, it])).rows[0].id;
  await pool.query(`INSERT INTO inventory_movements (id, tenant_id, item_id, type, quantity, reason, actor_name, occurred_at, kind, batch_id, branch_id)
    VALUES (gen_random_uuid(), $1, $2, 'in', 10, 'sinov', 'test', now(), 'adjust', $3, $4)`, [SEED_IDS.tenant, it, b, BC]);
  assert.equal(await stock(it), 12);
  assert.ok((await keeper.get('/warehouse/stock?low=1')).body.data.some((x) => x.id === it), 'ombor: kam qolgan');
  assert.ok((await keeper.get('/inventory?low=1')).body.data.some((x) => x.id === it));
  assert.ok((await manager.get(`/dashboard?from=${today}&to=${today}`)).body.data.attention.low_stock.some((x) => x.id === it), 'boshqaruv paneli');
  assert.equal(Number((await keeper.get(`/inventory/${it}`)).body.data.usable_qty), 2);
});

test('B16: shifokor 7 kundan eski qabul uchun material so‘ramaydi (422)', async () => {
  const old = (await pool.query(`SELECT id FROM encounters WHERE doctor_id = $1 AND branch_id = $2 AND started_at < (SELECT demo_now()) - interval '9 days' ORDER BY started_at DESC LIMIT 1`,
    [SEED_IDS.doctor(0), BC])).rows[0];
  assert.ok(old, 'seed: eski qabul bor');
  const it = await newItem(5);
  const r = await doctor.post('/warehouse/requests', { branch_id: BC, purpose: 'patient', department: 'Muolaja xonasi', encounter_id: old.id, icd_codes: ['I10'], lines: [{ item_id: it, qty: 1 }] });
  assert.equal(r.status, 422); assert.ok(r.body.error.fields.encounter_id);
});

test('B18: nazoratdagi jurnal — tanlangan davr boshidagi va oxiridagi qoldiq', async () => {
  const tram = (await pool.query(`SELECT id, opening_qty FROM inventory_items WHERE tenant_id = $1 AND name LIKE 'Tramadol%'`, [SEED_IDS.tenant])).rows[0];
  const sum = async (cond, params) => Number((await pool.query(`SELECT coalesce(sum(CASE WHEN type = 'in' THEN quantity ELSE -quantity END),0) AS s FROM inventory_movements WHERE item_id = $1 AND ${cond}`, [tram.id, ...params])).rows[0].s);
  const local = async (n) => (await pool.query(`SELECT to_char(((SELECT demo_now()) AT TIME ZONE 'Asia/Tashkent')::date - $1::int, 'YYYY-MM-DD') AS d`, [n])).rows[0].d;
  const fromStr = await local(10), to = await local(3);
  const j = (await keeper.get(`/warehouse/controlled/${tram.id}?from=${fromStr}&to=${to}`)).body.data;
  const start = `(('${fromStr}'::date)::timestamp AT TIME ZONE 'Asia/Tashkent')`, end = `((('${to}'::date) + 1)::timestamp AT TIME ZONE 'Asia/Tashkent')`;
  const opening = Number(tram.opening_qty) + await sum(`occurred_at < ${start}`, []);
  const closing = Number(tram.opening_qty) + await sum(`occurred_at < ${end}`, []);
  assert.equal(Number(j.opening_balance), opening); assert.equal(Number(j.closing_balance), closing);
  if (j.entries.length) assert.equal(Number(j.entries.at(-1).balance), closing, 'oxirgi yozuv qoldig‘i = davr oxiridagi qoldiq');
  assert.equal(Number(j.opening_balance) + Number(j.period_in) - Number(j.period_out), closing);
  const now = (await keeper.get(`/warehouse/controlled/${tram.id}`)).body.data;
  assert.equal(Number(now.closing_balance), Number(now.item.qty), 'bugungi davr: oxiri = hozirgi qoldiq');
});

test('B19: davr — ko‘pi bilan 366 kun (ikki chekka bilan), barcha ombor hisobot/eksportlarida bir xil', async () => {
  const day = (d) => (d instanceof Date ? d : new Date(`${d}T00:00:00Z`)).toISOString().slice(0, 10);
  const minus = (n) => day(new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400_000));
  for (const p of ['/warehouse/movements', '/warehouse/movements.csv', '/warehouse/reports/consumption', '/warehouse/fridge']) {
    assert.equal((await manager.get(`${p}?from=${minus(366)}&to=${today}`)).status, 422, `${p}: 367 kun`);
    assert.equal((await manager.get(`${p}?from=${minus(365)}&to=${today}`)).status, 200, `${p}: 366 kun`);
  }
});

test('B20: ulush foizlari faqat rahbarga — /doctors, /services, shifokor kartasi', async () => {
  const leaks = (v, path = '') => {
    if (Array.isArray(v)) return v.flatMap((x, i) => leaks(x, `${path}[${i}]`));
    if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => (/share_percent/.test(k) && x !== null ? [`${path}.${k}`] : leaks(x, `${path}.${k}`)));
    return [];
  };
  const storekeeper = keeper;
  for (const [name, s] of Object.entries({ registrar, doctor, cashier, lab, storekeeper })) {
    for (const p of ['/doctors', '/services', '/services?active=all']) {
      const r = await s.get(p);
      assert.equal(r.status, 200, `${name} ${p}`);
      assert.deepEqual(leaks(r.body.data), [], `${name} ${p}`);
    }
  }
  const own = await doctor.get(`/staff/doctors/${SEED_IDS.doctor(0)}`);
  assert.equal(own.status, 200);
  assert.deepEqual(leaks(own.body.data), [], 'shifokor o‘z kartasida foizni ko‘rmaydi');
  assert.ok(leaks((await manager.get('/doctors')).body.data).length > 0, 'rahbar ko‘radi');
  assert.ok(leaks((await manager.get('/services')).body.data).length > 0);
});

test('B21: kirim qatori bekor qilinsa hujjat jami kamayadi, qator belgilanadi', async () => {
  const a = await newItem(0), b = await newItem(0);
  const r = await keeper.receipt({ branch_id: BC, supplier: 'Bekor Farm', invoice_no: 'BF-1', invoice_date: today,
    lines: [{ item_id: a, batch_no: 'A1', qty: 2, unit_cost: 10000 }, { item_id: b, batch_no: 'B1', qty: 3, unit_cost: 20000 }] });
  assert.equal(r.status, 201);
  const mv = (await pool.query(`SELECT id FROM inventory_movements WHERE receipt_id = $1 AND item_id = $2`, [r.body.data.id, b])).rows[0].id;
  assert.equal((await manager.post(`/warehouse/movements/${mv}/void`, { reason: 'Noto‘g‘ri material kiritilgan' })).status, 200);
  const doc = (await keeper.get(`/warehouse/receipts/${r.body.data.id}`)).body.data;
  assert.equal(doc.total, 20000); assert.equal(doc.voided_lines, 1);
  assert.ok(doc.lines.find((l) => l.item_id === b).voided_at); assert.equal(doc.lines.find((l) => l.item_id === a).voided_at, null);
  assert.equal(doc.idempotency_key, undefined, 'kalit qaytarilmaydi');
  assert.equal((await keeper.get('/warehouse/receipts')).body.data.find((x) => x.id === r.body.data.id).voided_lines, 1);
  await ledgerMatchesBatches();
});
