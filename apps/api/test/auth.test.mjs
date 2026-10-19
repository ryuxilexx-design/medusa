// Real staff authentication: password login, lockout, forced password change, staff CRUD, isolation, demo-card limits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bootTestApp, db } from './_helpers.mjs';
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  };
  return {
    req, get: (p) => req('GET', p), post: (p, b = {}) => req('POST', p, b), patch: (p, b) => req('PATCH', p, b),
    demo: (mid) => req('POST', '/demo/login', { membership_id: mid }),
    login: (login, password, membership_id) => req('POST', '/auth/login', { login, password, ...(membership_id ? { membership_id } : {}) }),
  };
}

let manager;
before(async () => {
  ({ app, base } = await bootTestApp());
  const { Db } = (await import('node:module')).createRequire(import.meta.url)('../dist/core/db.js');
  pool = app.get(Db).pool;
  manager = session();
  await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
});
after(async () => { await app?.close(); });

let branchId;
async function newStaff(body) {
  branchId ??= (await manager.get('/me')).body.data.branches[0].id;
  const r = await manager.post('/staff', { branch_ids: [branchId], ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}

test('xodim yaratish: vaqtinchalik parol bir marta; birinchi kirishda parolni almashtirish majburiy', async () => {
  const s = await newStaff({ full_name: 'Sinov Kassir', role: 'cashier', login: '+998 90 111 22 33' });
  assert.equal(s.login, '+998901112233');
  assert.match(s.temp_password, /^[a-z2-9]{10}$/);
  const row = (await pool.query(`SELECT password_hash, must_change_password FROM users WHERE login = $1`, [s.login])).rows[0];
  assert.ok(row.password_hash.startsWith('scrypt$') && !row.password_hash.includes(s.temp_password));
  assert.equal(row.must_change_password, true);
  assert.ok(!JSON.stringify((await manager.get('/staff')).body).includes(s.temp_password), 'ro‘yxatda parol yo‘q');

  const u = session();
  assert.equal((await u.login('901112233', s.temp_password)).status, 200, 'telefon har xil formatda ham ishlaydi');
  const m = (await u.get('/me')).body.data;
  assert.equal(m.must_change_password, true);
  assert.equal(m.auth_kind, 'password');
  assert.equal((await u.get('/invoices')).body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await u.post('/auth/password', { current_password: 'xato12345', new_password: 'Yangi2026parol' })).status, 422);
  assert.equal((await u.post('/auth/password', { current_password: s.temp_password, new_password: 'qisqa1' })).status, 422);
  assert.equal((await u.post('/auth/password', { current_password: s.temp_password, new_password: 'Yangi2026parol' })).status, 200);
  assert.equal((await u.get('/invoices')).status, 200, 'parol almashgach ish ochiladi');
  assert.equal((await u.get('/staff')).status, 403, 'kassir xodimlar ro‘yxatini ko‘rmaydi');
  assert.equal((await session().login('+998901112233', s.temp_password)).status, 401, 'eski vaqtinchalik parol ishlamaydi');
});

test('login: xato javobi login borligini oshkor qilmaydi; 5 xatodan keyin blok; rahbar tiklaydi', async () => {
  const s = await newStaff({ full_name: 'Sinov Laborant', role: 'lab', login: 'lab.sinov' });
  const a = await session().login('lab.sinov', 'notogri123');
  const b = await session().login('yoq.login', 'notogri123');
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.body.error.message, b.body.error.message);
  for (let i = 0; i < 4; i++) await session().login('LAB.SINOV', 'notogri123');
  const locked = await session().login('lab.sinov', s.temp_password);
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error.code, 'ACCOUNT_LOCKED');
  const audits = (await manager.get('/audit?action=auth.locked')).body.data;
  assert.ok(audits.length >= 1, 'blok audit jurnalida');

  const r = await manager.post(`/staff/${s.membership_id}/reset-password`);
  assert.equal(r.status, 200);
  assert.notEqual(r.body.data.temp_password, s.temp_password);
  assert.equal((await session().login('lab.sinov', r.body.data.temp_password)).status, 200, 'tiklash blokni ochadi');
});

test('faolsizlantirish sessiyani darhol yopadi; rol o‘zgarishi kuchga kiradi', async () => {
  const s = await newStaff({ full_name: 'Sinov Registrator', role: 'registrar', login: 'reg.sinov' });
  const u = session();
  await u.login('reg.sinov', s.temp_password);
  await u.post('/auth/password', { current_password: s.temp_password, new_password: 'Registr2026' });
  assert.equal((await u.get('/patients')).status, 200);
  assert.equal((await manager.patch(`/staff/${s.membership_id}`, { status: 'inactive' })).status, 200);
  assert.equal((await u.get('/patients')).status, 401, 'sessiya yopildi');
  assert.equal((await session().login('reg.sinov', 'Registr2026')).status, 403, 'faolsiz xodim kira olmaydi');
  assert.equal((await manager.patch(`/staff/${s.membership_id}`, { status: 'active', role: 'cashier' })).status, 200);
  const u2 = session();
  assert.equal((await u2.login('reg.sinov', 'Registr2026')).status, 200);
  assert.equal((await u2.get('/me')).body.data.role, 'cashier');
});

test('shifokor yaratish: shifokor yozuvi va xizmatlari bilan; rolini o‘zgartirib bo‘lmaydi', async () => {
  const services = (await manager.get('/services')).body.data.filter((x) => x.category === 'consultation').slice(0, 2);
  const s = await newStaff({ full_name: 'Sinov Shifokor', role: 'doctor', login: 'dr.sinov', doctor: { specialty: 'Terapevt', share_percent: 35, service_ids: services.map((x) => x.id) } });
  const row = (await manager.get('/staff')).body.data.find((x) => x.membership_id === s.membership_id);
  assert.equal(row.specialty, 'Terapevt');
  assert.equal(Number(row.default_share_percent), 35);
  assert.equal(row.service_ids.length, 2);
  assert.equal((await manager.patch(`/staff/${s.membership_id}`, { role: 'cashier' })).status, 422);
  assert.equal((await manager.post('/staff', { full_name: 'Shifokor Yo‘q', role: 'doctor', login: 'dr.yoq', branch_ids: row.branch_ids })).status, 422, 'mutaxassislik majburiy');
  assert.equal((await manager.patch(`/staff/${s.membership_id}`, { doctor: { share_percent: 40, service_ids: [services[0].id] } })).status, 200);
  const after = (await manager.get('/staff')).body.data.find((x) => x.membership_id === s.membership_id);
  assert.equal(Number(after.default_share_percent), 40);
  assert.equal(after.service_ids.length, 1);
});

test('login band: 409; noto‘g‘ri login formati: 422', async () => {
  await newStaff({ full_name: 'Birinchi Odam', role: 'cashier', login: 'band.login' });
  const dup = await manager.post('/staff', { full_name: 'Ikkinchi Odam', role: 'cashier', login: 'BAND.LOGIN', branch_ids: [(await manager.get('/me')).body.data.branches[0].id] });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.fields.login, 'Bu login band');
  assert.equal((await manager.post('/staff', { full_name: 'Uchinchi Odam', role: 'cashier', login: 'a b', branch_ids: [(await manager.get('/me')).body.data.branches[0].id] })).status, 422);
});

test('himoya: o‘zini o‘chira olmaydi; demo kartalar himoyalangan; boshqa tenant ko‘rinmaydi; begona filial yo‘q', async () => {
  assert.equal((await manager.patch(`/staff/${M.manager}`, { status: 'inactive' })).status, 403);
  assert.equal((await manager.patch(`/staff/${M.manager}`, { role: 'cashier' })).status, 403);
  assert.equal((await manager.patch(`/staff/${M.cashier}`, { status: 'inactive' })).status, 403, 'demo karta');
  const t2 = session();
  await t2.demo(M.tenant2Manager);
  const s = (await t2.post('/staff', { full_name: 'Ikkinchi Rahbar', role: 'manager', login: 't2.rahbar2', branch_ids: [SEED_IDS.branchTenant2] })).body.data;
  assert.ok(s?.membership_id);
  assert.equal((await manager.patch(`/staff/${s.membership_id}`, { full_name: 'Buzg‘unchi' })).status, 404);
  assert.equal((await manager.post(`/staff/${s.membership_id}/reset-password`)).status, 404);
  assert.ok(!(await manager.get('/staff')).body.data.some((x) => x.membership_id === s.membership_id));
  assert.equal((await manager.post('/staff', { full_name: 'Begona Filial', role: 'cashier', login: 'begona.f', branch_ids: [SEED_IDS.branchTenant2] })).status, 422);
});

test('oxirgi rahbar: ikki rahbar bir vaqtda bir-birini o‘chirsa, bittasi faol qoladi', async () => {
  const t2 = session();
  await t2.demo(M.tenant2Manager);
  const s = (await t2.post('/staff', { full_name: 'Poyga Rahbar', role: 'manager', login: 't2.poyga', branch_ids: [SEED_IDS.branchTenant2] })).body.data;
  const r = session();
  await r.login('t2.poyga', s.temp_password);
  assert.equal((await r.post('/auth/password', { current_password: s.temp_password, new_password: 'Poyga2026x' })).status, 200);
  // the race needs two ordinary managers: lift the demo-card protection for this test only
  await pool.query(`UPDATE memberships SET demo_card = false WHERE id = $1`, [M.tenant2Manager]);
  try {
    await pool.query(`UPDATE memberships SET status = 'inactive' WHERE tenant_id = $1 AND role = 'manager' AND id NOT IN ($2, $3)`, [SEED_IDS.tenant2, M.tenant2Manager, s.membership_id]);
    const res = await Promise.all([t2.patch(`/staff/${s.membership_id}`, { status: 'inactive' }), r.patch(`/staff/${M.tenant2Manager}`, { status: 'inactive' })]);
    const codes = res.map((x) => x.status).sort();
    assert.equal(codes.filter((c) => c === 200).length, 1, `faqat bittasi o‘tadi: ${codes}`);
    assert.ok(res.some((x) => x.status === 401 || x.body?.error?.code === 'LAST_MANAGER'), JSON.stringify(res.map((x) => x.body)));
    const n = (await pool.query(`SELECT count(*)::int AS n FROM memberships WHERE tenant_id = $1 AND role = 'manager' AND status = 'active'`, [SEED_IDS.tenant2])).rows[0].n;
    assert.equal(n, 1);
  } finally {
    await pool.query(`UPDATE memberships SET demo_card = true, status = 'active' WHERE id = $1`, [M.tenant2Manager]);
  }
});

test('demo/login faqat demo klinikalarga; demo reseti haqiqiy klinika bor bazada to‘xtaydi', async () => {
  const tenant = randomUUID(), branch = randomUUID(), user = randomUUID(), membership = randomUUID();
  await pool.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Haqiqiy klinika (test)')`, [tenant]);
  try {
    await pool.query(`INSERT INTO branches (id, tenant_id, name, code) VALUES ($1, $2, 'Asosiy', 'ASO')`, [branch, tenant]);
    await pool.query(`INSERT INTO users (id, email, full_name) VALUES ($1, NULL, 'Haqiqiy Rahbar')`, [user]);
    await pool.query(`INSERT INTO memberships (id, tenant_id, user_id, role, branch_ids, demo_card) VALUES ($1, $2, $3, 'manager', $4, true)`, [membership, tenant, user, [branch]]);
    const s = session();
    assert.equal((await s.demo(membership)).status, 403, 'demo karta bayrog‘i bo‘lsa ham, demo bo‘lmagan klinikaga kirilmaydi');
    const r = await manager.post('/demo/reset');
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'REAL_CLINIC_PRESENT');
  } finally {
    await pool.query(`DELETE FROM audit_logs WHERE tenant_id = $1`, [tenant]);
    await pool.query(`DELETE FROM sessions WHERE tenant_id = $1`, [tenant]);
    await pool.query(`DELETE FROM memberships WHERE tenant_id = $1`, [tenant]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [user]);
    await pool.query(`DELETE FROM branches WHERE tenant_id = $1`, [tenant]);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenant]);
  }
  assert.equal((await manager.post('/demo/reset')).status, 200, 'tozalangach reset yana ishlaydi');
});
