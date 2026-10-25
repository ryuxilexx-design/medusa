// Catalogue management by the manager (no SQL): services, rooms, branches and stock items —
// create/patch, roles, tenant isolation, uniqueness, branch price resolution in billing, audit rows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';

const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;

let app, base, pool;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body) {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
  patch(p, b) { return this.req('PATCH', p, b); }
}
async function login(membershipId) {
  const c = new Client();
  const r = await c.post('/demo/login', { membership_id: membershipId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c;
}

let manager, registrar, cashier, t2;
const S = {};

before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = await login(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  [registrar, cashier, t2] = await Promise.all([login(M.registrar), login(M.cashier), login(M.tenant2Manager)]);
});
after(async () => { await app?.close(); });

// ---------- services ----------
test('xizmat: rahbar yaratadi (kod avtomatik, narx service_prices’da), nom takrori 409, tekshiruv 422', async () => {
  const r = await manager.post('/services', { name: 'Dietolog maslahati', category: 'consultation', price: 180_000_00, duration_min: 30, share_percent: 35 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  S.serviceId = r.body.data.id;
  assert.match(r.body.data.code, /^C\d{2}$/);
  const list = (await manager.get('/services?active=all')).body.data;
  const s = list.find((x) => x.id === S.serviceId);
  assert.equal(Number(s.price), 180_000_00);
  assert.equal(Number(s.share_percent), 35);
  assert.equal(s.category, 'consultation');
  const prices = (await pool.query(`SELECT branch_id, amount FROM service_prices WHERE service_id = $1`, [S.serviceId])).rows;
  assert.deepEqual(prices.map((p) => [p.branch_id, Number(p.amount)]), [[null, 180_000_00]]);

  const dup = await manager.post('/services', { name: 'dietolog MASLAHATI', category: 'consultation', price: 1, duration_min: 30 });
  assert.equal(dup.status, 409, JSON.stringify(dup.body));
  assert.equal(dup.body.error.code, 'DUPLICATE');

  const bad = await manager.post('/services', { name: 'X', category: 'spa', price: -5, duration_min: 3, share_percent: 120 });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.error.fields.name && bad.body.error.fields.category && bad.body.error.fields.price && bad.body.error.fields.duration_min && bad.body.error.fields.share_percent, JSON.stringify(bad.body));

  const labTplOnNonLab = await manager.post('/services', { name: 'Massaj', category: 'procedure', price: 1000, duration_min: 30, lab_template: [{ code: 'A', name: 'A' }] });
  assert.equal(labTplOnNonLab.status, 422);
});

test('xizmat: PATCH turi, ulushi, natija shakli; nomini boshqa xizmat nomiga o‘zgartirish 409', async () => {
  const r = await manager.patch(`/services/${S.serviceId}`, { category: 'lab', share_percent: 12.5, lab_template: [{ code: 'TSH', name: 'TSH', unit: 'mIU/L', ref_low: 0.4, ref_high: 4 }], duration_min: 15 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.data.changes.length >= 4, r.body.data.changes.join(', '));
  const s = (await manager.get('/services?active=all')).body.data.find((x) => x.id === S.serviceId);
  assert.equal(s.category, 'lab');
  assert.equal(Number(s.share_percent), 12.5);
  assert.equal(s.lab_template[0].code, 'TSH');
  assert.equal(s.duration_min, 15);

  const other = (await manager.get('/services')).body.data.find((x) => x.id !== S.serviceId);
  const dup = await manager.patch(`/services/${S.serviceId}`, { name: other.name.toUpperCase() });
  assert.equal(dup.status, 409);
  // unchanged request → no changes, no new audit row
  const same = await manager.patch(`/services/${S.serviceId}`, { share_percent: 12.5 });
  assert.deepEqual(same.body.data.changes, []);
});

test('xizmat: filial narxi umumiy narxdan ustun (billing.currentPrice), eski buyurtma narxi o‘zgarmaydi', async () => {
  const { currentPrice } = require('../dist/modules/billing.js');
  const general = 180_000_00, yun = 150_000_00;
  const r = await manager.patch(`/services/${S.serviceId}`, { price: yun, branch_id: SEED_IDS.branchYunusobod });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.data.changes[0].includes('Yunusobod'), r.body.data.changes.join());
  assert.equal(await currentPrice(pool, S.serviceId, SEED_IDS.branchYunusobod), yun, 'filial narxi');
  assert.equal(await currentPrice(pool, S.serviceId, SEED_IDS.branchCentral), general, 'boshqa filialda umumiy narx');
  // the list shows the branch price only when asked for that branch
  const forYun = (await manager.get(`/services?active=all&branch_id=${SEED_IDS.branchYunusobod}`)).body.data.find((x) => x.id === S.serviceId);
  assert.equal(Number(forYun.price), yun); assert.equal(Number(forYun.general_price), general);
  const plain = (await manager.get('/services?active=all')).body.data.find((x) => x.id === S.serviceId);
  assert.equal(Number(plain.price), general);
  // a newer general price does not override the branch price
  assert.equal((await manager.patch(`/services/${S.serviceId}`, { price: 200_000_00 })).status, 200);
  assert.equal(await currentPrice(pool, S.serviceId, SEED_IDS.branchYunusobod), yun);
  assert.equal(await currentPrice(pool, S.serviceId, SEED_IDS.branchCentral), 200_000_00);
  // branch price without a price, or for another clinic's branch → 422
  assert.equal((await manager.patch(`/services/${S.serviceId}`, { branch_id: SEED_IDS.branchYunusobod })).status, 422);
  assert.equal((await manager.patch(`/services/${S.serviceId}`, { price: 1, branch_id: SEED_IDS.branchTenant2 })).status, 422);

  // old orders keep their snapshot: change the price of a seeded, used service and compare
  const used = (await manager.get('/services')).body.data.find((x) => x.used);
  const before = (await pool.query(`SELECT id, price_snapshot FROM service_orders WHERE service_id = $1 ORDER BY ordered_at LIMIT 1`, [used.id])).rows[0];
  assert.equal((await manager.patch(`/services/${used.id}`, { price: Number(used.price) + 5000_00 })).status, 200);
  const after = (await pool.query(`SELECT price_snapshot FROM service_orders WHERE id = $1`, [before.id])).rows[0];
  assert.equal(Number(after.price_snapshot), Number(before.price_snapshot));
});

// ---------- rooms ----------
test('xona: yaratish, o‘zgartirish, nofaol xona ro‘yxatda ko‘rinmaydi, filialda nom takrori 409', async () => {
  const r = await manager.post('/rooms', { name: '305-xona', branch_id: SEED_IDS.branchCentral, purpose: 'Endokrinologiya' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  S.roomId = r.body.data.id;
  assert.equal((await manager.post('/rooms', { name: '305-XONA', branch_id: SEED_IDS.branchCentral })).status, 409);
  assert.equal((await manager.post('/rooms', { name: '305-xona', branch_id: SEED_IDS.branchTenant2 })).status, 422, 'boshqa klinika filiali');
  assert.equal((await manager.post('/rooms', { name: '', branch_id: 'x' })).status, 422);

  const p = await manager.patch(`/rooms/${S.roomId}`, { name: '306-xona', branch_id: SEED_IDS.branchYunusobod, active: false });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.ok(!(await registrar.get('/rooms')).body.data.some((x) => x.id === S.roomId), 'nofaol xona oddiy ro‘yxatda yo‘q');
  const all = (await manager.get('/rooms?active=all')).body.data.find((x) => x.id === S.roomId);
  assert.equal(all.name, '306-xona'); assert.equal(all.branch_id, SEED_IDS.branchYunusobod); assert.equal(all.active, false);
  assert.equal((await manager.patch(`/rooms/${S.roomId}`, { active: true })).status, 200);
  assert.ok((await registrar.get('/rooms')).body.data.some((x) => x.id === S.roomId));
});

// ---------- branches ----------
test('filial: yaratish (kod avtomatik), rahbar avtomatik biriktiriladi, nofaol filial /me’da yo‘q, oxirgi filial o‘chmaydi', async () => {
  const r = await manager.post('/branches', { name: 'Chilonzor filiali', address: 'Chilonzor, 5-kvartal', phone: '90 123 45 67' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  S.branchId = r.body.data.id;
  assert.equal(r.body.data.code, 'CHI');
  const me = (await manager.get('/me')).body.data;
  assert.ok(me.branches.some((b) => b.id === S.branchId), 'yangi filial rahbarning ro‘yxatida');
  const b = (await manager.get('/branches')).body.data.find((x) => x.id === S.branchId);
  assert.equal(b.phone, '+998901234567'); assert.equal(b.timezone, 'Asia/Tashkent');
  // the new branch is usable at once: a room and a stock item in it
  assert.equal((await manager.post('/rooms', { name: '1-xona', branch_id: S.branchId })).status, 201);
  assert.equal((await manager.post('/branches', { name: 'Chilonzor 2' })).body.data.code, 'CHI2', 'band kod raqamlanadi');
  assert.equal((await manager.post('/branches', { name: 'Yana', code: 'MRK' })).status, 409, 'band kod');
  assert.equal((await manager.post('/branches', { name: 'Yana', phone: '123' })).status, 422);

  const p = await manager.patch(`/branches/${S.branchId}`, { name: 'Chilonzor', active: false, address: null });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.ok(!(await manager.get('/me')).body.data.branches.some((x) => x.id === S.branchId), 'nofaol filial sarlavhada yo‘q');
  assert.ok(!(await registrar.get('/branches')).body.data.some((x) => x.id === S.branchId));
  const all = (await manager.get('/branches?active=all')).body.data.find((x) => x.id === S.branchId);
  assert.equal(all.name, 'Chilonzor'); assert.equal(all.active, false); assert.equal(all.address, null);
  assert.ok(!(await registrar.get('/rooms')).body.data.some((x) => x.branch_id === S.branchId), 'nofaol filial xonalari ham yashirin');
  assert.equal((await manager.post('/rooms', { name: '2-xona', branch_id: S.branchId })).status, 422, 'nofaol filialga xona qo‘shilmaydi');
  // the last active branch of a clinic cannot be switched off
  const t2branch = (await t2.get('/branches')).body.data[0];
  const last = await t2.patch(`/branches/${t2branch.id}`, { active: false });
  assert.equal(last.status, 422); assert.ok(last.body.error.fields.active);
});

// ---------- inventory ----------
test('ombor: tovar yaratish va o‘zgartirish, nom takrori 409, harakatlar o‘zgarmaydi', async () => {
  const r = await manager.post('/inventory', { name: 'Shprits 5 ml', unit: 'dona', branch_id: SEED_IDS.branchCentral, minimum_qty: 50, opening_qty: 120.5 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  S.itemId = r.body.data.id;
  const it = (await manager.get(`/inventory/${S.itemId}`)).body.data;
  assert.equal(Number(it.qty), 120.5); assert.equal(Number(it.minimum_qty), 50); assert.equal(it.unit, 'dona');
  assert.equal((await manager.post('/inventory', { name: 'shprits 5 ML', unit: 'dona', branch_id: SEED_IDS.branchCentral })).status, 409);
  assert.equal((await manager.post('/inventory', { name: 'Paxta', unit: 'kg', branch_id: SEED_IDS.branchTenant2 })).status, 403, 'boshqa klinika filiali');
  assert.equal((await manager.post('/inventory', { name: 'P', unit: '', branch_id: SEED_IDS.branchCentral, minimum_qty: -1 })).status, 422);

  assert.equal((await manager.post('/warehouse/issues', { branch_id: SEED_IDS.branchCentral, purpose: 'department', department: 'Bo‘limga berildi', receiver_membership_id: M.doctor(0), lines: [{ item_id: S.itemId, qty: 20.5 }] })).status, 201);
  const p = await manager.patch(`/inventory/${S.itemId}`, { name: 'Shprits 5 ml (uch qismli)', minimum_qty: 60, unit: 'dona', active: false });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const after = (await manager.get(`/inventory/${S.itemId}`)).body.data;
  assert.equal(after.name, 'Shprits 5 ml (uch qismli)'); assert.equal(Number(after.qty), 100); assert.equal(after.movements.length, 1);
  const list = (await manager.get('/inventory')).body.data;
  assert.equal(list.find((x) => x.id === S.itemId).active, false);
  assert.ok(!(await manager.get('/inventory?low=1')).body.data.some((x) => x.id === S.itemId), 'nofaol tovar «kam qolganlar»da yo‘q');
});

// ---------- roles and tenants ----------
test('rollar: registrator va kassir yarata olmaydi (403); o‘qish ruxsati saqlanadi', async () => {
  for (const c of [registrar, cashier]) {
    assert.equal((await c.post('/services', { name: 'X', category: 'lab', price: 1, duration_min: 10 })).status, 403);
    assert.equal((await c.patch(`/services/${S.serviceId}`, { name: 'Y' })).status, 403);
    assert.equal((await c.post('/rooms', { name: 'X', branch_id: SEED_IDS.branchCentral })).status, 403);
    assert.equal((await c.patch(`/rooms/${S.roomId}`, { name: 'Y' })).status, 403);
    assert.equal((await c.post('/branches', { name: 'Xx' })).status, 403);
    assert.equal((await c.patch(`/branches/${S.branchId}`, { name: 'Yy' })).status, 403);
    assert.equal((await c.post('/inventory', { name: 'Xx', unit: 'd', branch_id: SEED_IDS.branchCentral })).status, 403);
    assert.equal((await c.patch(`/inventory/${S.itemId}`, { name: 'Yy' })).status, 403);
  }
  const svc = (await registrar.get('/services')).body.data;
  assert.ok(svc.length > 10 && svc.every((s) => s.share_percent == null), 'ulush faqat rahbarga');
  assert.equal((await cashier.get('/branches')).status, 200);
});

test('boshqa klinika: rahbar begona xizmat, xona, filial va tovarni o‘zgartira olmaydi (404)', async () => {
  assert.equal((await t2.patch(`/services/${S.serviceId}`, { name: 'Begona' })).status, 404);
  assert.equal((await t2.patch(`/rooms/${S.roomId}`, { name: 'Begona' })).status, 404);
  assert.equal((await t2.patch(`/branches/${S.branchId}`, { name: 'Begona' })).status, 404);
  assert.equal((await t2.patch(`/inventory/${S.itemId}`, { name: 'Begona' })).status, 404);
  assert.equal((await t2.get(`/inventory/${S.itemId}`)).status, 404);
  // nothing leaked into the other clinic's lists
  assert.ok(!(await t2.get('/services?active=all')).body.data.some((s) => s.id === S.serviceId));
  assert.ok(!(await t2.get('/rooms?active=all')).body.data.some((r) => r.id === S.roomId));
  assert.ok(!(await t2.get('/branches?active=all')).body.data.some((b) => b.id === S.branchId));
});

test('audit: har bir yaratish va o‘zgartirish uchun yozuv bor (klinik matnsiz)', async () => {
  const actions = async (prefix) => (await manager.get(`/audit?action=${prefix}&page_size=50`)).body.data.map((a) => a.action);
  const svc = await actions('service.');
  assert.ok(svc.includes('service.create') && svc.includes('service.update'), svc.join());
  const rooms = await actions('room.');
  assert.ok(rooms.includes('room.create') && rooms.includes('room.update'), rooms.join());
  const br = await actions('branch.');
  assert.ok(br.includes('branch.create') && br.includes('branch.update'), br.join());
  const inv = await actions('inventory.');
  assert.ok(inv.includes('inventory.create') && inv.includes('inventory.update'), inv.join());
  assert.ok((await actions('warehouse.issue')).includes('warehouse.issue_direct'), 'chiqim — hujjat bilan');
  const rows = (await manager.get('/audit?action=branch.create&page_size=5')).body.data;
  assert.ok(rows.some((r) => r.resource_id === S.branchId && r.summary.includes('Chilonzor filiali') && r.actor_role === 'manager'));
  // an unchanged PATCH writes nothing
  const n0 = (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'room.update'`)).rows[0].n;
  assert.deepEqual((await manager.patch(`/rooms/${S.roomId}`, { name: '306-xona' })).body.data.changes, []);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'room.update'`)).rows[0].n, n0);
});
