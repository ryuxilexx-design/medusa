// P0 acceptance tests. They boot the API in-process against the separate *_test database (see helpers.mjs) and reset it first.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bootTestApp, db } from './_helpers.mjs';

const { SEED_IDS } = db;

let app, base;
const M = SEED_IDS.membership;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', cookie: this.cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  get(p) { return this.req('GET', p); }
  post(p, b, h) { return this.req('POST', p, b ?? {}, h); }
  put(p, b) { return this.req('PUT', p, b); }
  patch(p, b) { return this.req('PATCH', p, b); }
}
async function login(membershipId) {
  const c = new Client();
  const r = await c.post('/demo/login', { membership_id: membershipId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c;
}

let manager, registrar, doctor, cashier, lab, me;
const state = {};

before(async () => {
  ({ app, base } = await bootTestApp());
  manager = await login(M.manager);
  const reset = await manager.post('/demo/reset');
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  [registrar, doctor, cashier, lab] = await Promise.all([login(M.registrar), login(M.doctor(0)), login(M.cashier), login(M.lab)]);
  me = (await registrar.get('/me')).body.data;
});
after(async () => { await app?.close(); });

test('5 rol serverdagi sessiya bilan kiradi, ruxsatsiz so‘rov 401', async () => {
  const roles = await Promise.all([manager, registrar, doctor, cashier, lab].map((c) => c.get('/me')));
  assert.deepEqual(roles.map((r) => r.body.data.role), ['manager', 'registrar', 'doctor', 'cashier', 'lab']);
  assert.equal((await new Client().get('/patients')).status, 401);
});

test('seed: 100 bemor, bugungi jadval va navbat bo‘sh emas', async () => {
  const p = await manager.get('/patients?page_size=1');
  assert.equal(p.body.meta.total, 100);
  const a = await registrar.get(`/appointments?date=${me.today}`);
  assert.equal(a.body.data.length, 30);
  const q = await registrar.get('/queue');
  assert.ok(q.body.data.tickets.length >= 10);
});

test('yangi bemor yaratiladi, qidiruvdan topiladi; oilaviy telefon dublikat ogohlantirishidan keyin saqlanadi', async () => {
  const input = { last_name: 'Testov', first_name: 'Jamshid', birth_date: '1990-05-14', sex: 'male', phone: '93 555 12 34' };
  const r = await registrar.post('/patients', input);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  state.patientId = r.body.data.id;
  const s = await registrar.get('/patients?search=testov');
  assert.ok(s.body.data.some((x) => x.id === state.patientId && x.phone === '+998935551234'));
  const child = { last_name: 'Tursunov', first_name: 'Amir', birth_date: '2020-02-02', phone: '+998 90 111 22 33' };
  const warn = await registrar.post('/patients', child);
  assert.equal(warn.status, 409);
  assert.equal(warn.body.error.code, 'DUPLICATE_WARNING');
  assert.ok(warn.body.error.details.candidates.length >= 2);
  const ok = await registrar.post('/patients', { ...child, confirm_duplicate: true });
  assert.equal(ok.status, 201);
  const bad = await registrar.post('/patients', { last_name: 'A', first_name: '', birth_date: '2999-01-01', phone: '123' });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.error.fields.last_name && bad.body.error.fields.phone);
});

test('band vaqtga parallel yozilishdan faqat bittasi o‘tadi (409)', async () => {
  const svc = (await registrar.get('/services')).body.data.find((s) => s.code === 'C01');
  const avail = (await registrar.get(`/availability?doctor_id=${SEED_IDS.doctor(0)}&date=${me.today}&service_id=${svc.id}`)).body.data;
  const slot = avail.slots.find((s) => s.free && !s.past) ?? avail.slots.find((s) => s.free);
  assert.ok(slot, 'bo‘sh slot bor');
  state.slot = slot.time;
  const body = { patient_id: state.patientId, branch_id: avail.branch_id, doctor_id: SEED_IDS.doctor(0), service_id: svc.id, date: me.today, start_time: slot.time };
  const r2 = await login(M.manager);
  const [a, b] = await Promise.all([registrar.post('/appointments', body), r2.post('/appointments', { ...body })]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  const winner = a.status === 201 ? a : b;
  state.apptId = winner.body.data.id;
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.body.error.code, 'SLOT_TAKEN');
  const list = (await registrar.get(`/appointments?date=${me.today}&doctor_id=${SEED_IDS.doctor(0)}`)).body.data;
  assert.equal(list.filter((x) => x.patient_id === state.patientId).length, 1);
});

test('check-in navbat yaratadi, qayta bosish raqamni ko‘paytirmaydi', async () => {
  const [a, b] = await Promise.all([registrar.post(`/appointments/${state.apptId}/check-in`), registrar.post(`/appointments/${state.apptId}/check-in`)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.body.data.queue_number, b.body.data.queue_number);
  const q = (await registrar.get('/queue')).body.data.tickets.filter((t) => t.appointment_id === state.apptId);
  assert.equal(q.length, 1);
});

test('shifokor qoralama saqlaydi, qayta ochadi, buyurtma beradi, tasdiqlaydi; tasdiqlangan qayd o‘zgarmaydi', async () => {
  const s = await doctor.post(`/appointments/${state.apptId}/start`);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  state.encId = s.body.data.encounter_id;
  let enc = (await doctor.get(`/encounters/${state.encId}`)).body.data;
  const d = await doctor.put(`/encounters/${state.encId}/draft`, { version: enc.note.version, complaints: 'Bosh og‘rig‘i', vitals: { bp_sys: 120, bp_dia: 80 } });
  assert.equal(d.status, 200);
  enc = (await doctor.get(`/encounters/${state.encId}`)).body.data;
  assert.equal(enc.note.complaints, 'Bosh og‘rig‘i');
  const stale = await doctor.put(`/encounters/${state.encId}/draft`, { version: enc.note.version - 1, complaints: 'x' });
  assert.equal(stale.status, 409);
  const notSigned = await doctor.post(`/appointments/${state.apptId}/complete`);
  assert.equal(notSigned.status, 409);
  const lab1 = (await doctor.get('/services?category=lab')).body.data.find((x) => x.code === 'L01');
  const o = await doctor.post(`/encounters/${state.encId}/orders`, { service_ids: [lab1.id] });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  state.orderId = o.body.data.order_ids[0];
  const dup = await doctor.post(`/encounters/${state.encId}/orders`, { service_ids: [lab1.id] });
  assert.equal(dup.status, 409);
  const missing = await doctor.post(`/encounters/${state.encId}/sign`, { version: enc.note.version, complaints: 'Bosh og‘rig‘i' });
  assert.equal(missing.status, 422);
  const sign = await doctor.post(`/encounters/${state.encId}/sign`, { version: enc.note.version, complaints: 'Bosh og‘rig‘i', examination: 'O‘zgarishsiz', diagnosis: 'Kuchlanish tipidagi bosh og‘rig‘i', recommendations: 'Dam olish' });
  assert.equal(sign.status, 200, JSON.stringify(sign.body));
  const appt = (await registrar.get(`/appointments/${state.apptId}`)).body.data;
  assert.equal(appt.status, 'completed');
  enc = (await doctor.get(`/encounters/${state.encId}`)).body.data;
  const edit = await doctor.put(`/encounters/${state.encId}/draft`, { version: enc.note.version, complaints: 'o‘zgartirish' });
  assert.equal(edit.status, 409);
  assert.equal(edit.body.error.code, 'IMMUTABLE');
});

test('tahlil buyurtmasi laboratoriyada va hisobda bir marta; tasdiqlangach shifokorda ko‘rinadi', async () => {
  const l = (await lab.get(`/orders?patient_id=${state.patientId}`)).body.data;
  assert.equal(l.length, 1);
  const inv = (await cashier.get(`/invoices?patient_id=${state.patientId}`)).body.data;
  assert.equal(inv.length, 1);
  state.invoiceId = inv[0].id;
  const detail = (await cashier.get(`/invoices/${state.invoiceId}`)).body.data;
  assert.equal(detail.items.length, 2);
  assert.equal(detail.total, 150_000_00 + 60_000_00);
  assert.equal((await lab.post(`/orders/${state.orderId}/verify`)).status, 409);
  assert.equal((await lab.post(`/orders/${state.orderId}/collect`)).status, 200);
  const tpl = (await lab.get(`/orders/${state.orderId}`)).body.data.lab_template;
  const values = tpl.map((p) => ({ code: p.code, value: String(p.ref_low ?? 1) }));
  assert.equal((await lab.put(`/orders/${state.orderId}/result`, { values })).status, 200);
  const beforeVerify = (await doctor.get(`/encounters/${state.encId}`)).body.data.orders[0];
  assert.equal(beforeVerify.values, null, 'tasdiqlanmagan natija shifokorga ko‘rinmaydi');
  assert.equal((await lab.post(`/orders/${state.orderId}/verify`)).status, 200);
  const after = (await doctor.get(`/encounters/${state.encId}`)).body.data.orders[0];
  assert.equal(after.status, 'verified');
  assert.ok(after.values.length === tpl.length && after.verified_by_name);
  assert.equal((await lab.put(`/orders/${state.orderId}/result`, { values })).status, 409);
});

test('to‘lov: idempotency, qoldiqdan ortiq to‘lash va parallel to‘lovlar', async () => {
  const pay = (amount, key) => cashier.post(`/invoices/${state.invoiceId}/payments`, { amount, method: 'cash' }, { 'Idempotency-Key': key });
  assert.equal((await cashier.post(`/invoices/${state.invoiceId}/payments`, { amount: 100, method: 'cash' })).status, 422, 'kalitsiz rad');
  const key = randomUUID();
  const p1 = await pay(100_000_00, key);
  assert.equal(p1.status, 201);
  assert.equal(p1.body.data.invoice.status, 'partially_paid');
  const replay = await pay(100_000_00, key);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.payment.id, p1.body.data.payment.id);
  assert.equal(replay.body.data.replayed, true);
  const over = await pay(200_000_00, randomUUID());
  assert.equal(over.status, 422);
  assert.ok(over.body.error.fields.amount);
  const cashier2 = await login(M.cashier);
  const [a, b] = await Promise.all([pay(110_000_00, randomUUID()), cashier2.post(`/invoices/${state.invoiceId}/payments`, { amount: 110_000_00, method: 'card' }, { 'Idempotency-Key': randomUUID() })]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const inv = (await cashier.get(`/invoices/${state.invoiceId}`)).body.data;
  assert.equal(inv.status, 'paid');
  assert.equal(inv.paid_amount, inv.total);
  assert.equal(inv.payments.length, 2);
  // the manager may take money too, but only with their own open shift; a registrar never
  const m = await manager.post(`/invoices/${state.invoiceId}/payments`, { amount: 1, method: 'cash' }, { 'Idempotency-Key': randomUUID() });
  assert.equal(m.status, 409, 'rahbar smenasiz to‘lov qayd qilmaydi'); assert.equal(m.body.error.code, 'SHIFT_REQUIRED');
  assert.equal((await registrar.post(`/invoices/${state.invoiceId}/payments`, { amount: 1, method: 'cash' }, { 'Idempotency-Key': randomUUID() })).status, 403, 'registrator to‘lov qayd qilmaydi');
});

test('dashboard tushumi filtrlangan to‘lovlar yig‘indisiga teng (filial kesimida ham)', async () => {
  for (const branch of ['', `&branch_id=${SEED_IDS.branchYunusobod}`]) {
    for (const period of ['today', '7d', '30d']) {
      const d = (await manager.get(`/dashboard?period=${period}${branch}`)).body.data;
      const p = (await manager.get(`/payments?from=${d.range.from}&to=${d.range.to}${branch}&page_size=1`)).body.meta;
      assert.equal(d.kpi.revenue, p.sum, `${period} ${branch}`);
      assert.equal(d.daily.reduce((s, x) => s + x.revenue, 0), p.sum);
      const debts = (await manager.get(`/invoices?debt=1${branch}&page_size=1`)).body.meta.sums.due;
      assert.equal(d.kpi.debt, debts);
    }
  }
  const svc = (await manager.get('/reports/services?period=30d')).body;
  const doc = (await manager.get('/reports/doctors?period=30d')).body;
  assert.equal(svc.meta.total, doc.data.reduce((s, x) => s + x.value, 0), 'xizmatlar va shifokorlar kesimi bir xil summa');
});

test('rol va tenant chegaralari serverda', async () => {
  assert.equal((await cashier.get(`/encounters/${state.encId}`)).status, 403, 'kassir klinik yozuvni o‘qiy olmaydi');
  assert.equal((await manager.get(`/encounters/${state.encId}`)).status, 403, 'rahbar ham klinik yozuvni o‘qimaydi');
  assert.equal((await lab.get('/invoices')).status, 403);
  assert.equal((await cashier.post('/patients', { last_name: 'Xx', first_name: 'Yy', birth_date: '2000-01-01' })).status, 403);
  const otherDoctor = await login(M.doctor(1));
  assert.equal((await otherDoctor.get(`/encounters/${state.encId}`)).status, 403);
  const t2 = await login(M.tenant2Manager);
  assert.equal((await t2.get(`/patients/${state.patientId}`)).status, 404, 'boshqa tenant bemori ochilmaydi');
  assert.equal((await t2.get(`/invoices/${state.invoiceId}`)).status, 404);
  assert.equal((await t2.get('/patients')).body.meta.total, 3);
  const reg2 = await login(M.registrar2); // Yunusobod only
  assert.equal((await reg2.get(`/appointments?branch_id=${SEED_IDS.branchCentral}`)).status, 403);
  const own = (await reg2.get(`/appointments?date=${me.today}`)).body.data;
  assert.ok(own.length > 0 && own.every((a) => a.branch_id === SEED_IDS.branchYunusobod));
  assert.equal((await reg2.get(`/appointments/${state.apptId}`)).status, 404, 'boshqa filial qabuli');
  assert.equal((await registrar.post('/demo/reset')).status, 403);
});

test('reset: boshlang‘ich seed tiklanadi, parallel reset bloklanadi', async () => {
  const [a, b] = await Promise.all([manager.post('/demo/reset'), manager.post('/demo/reset')]);
  assert.ok([a.status, b.status].includes(200));
  assert.ok([a.status, b.status].every((s) => s === 200 || s === 409));
  assert.equal((await manager.get('/patients?page_size=1')).body.meta.total, 100);
  assert.equal((await manager.get(`/patients/${state.patientId}`)).status, 404);
  const inv = (await cashier.get('/invoices?page_size=1')).body.meta.total;
  assert.equal(inv, 180);
  assert.equal((await manager.get('/me')).status, 200, 'sessiya resetdan keyin saqlanadi');
});
