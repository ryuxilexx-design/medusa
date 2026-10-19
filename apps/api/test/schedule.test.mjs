// Doctor weekly schedule editing: validation, booking follows the new schedule, conflicts with future bookings, permissions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), put: (p, b) => req('PUT', p, b), patch: (p, b) => req('PATCH', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}

let manager, registrar, me;
before(async () => {
  ({ app, base } = await bootTestApp());
  const { Db } = createRequire(import.meta.url)('../dist/core/db.js');
  pool = app.get(Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  registrar = session(); await registrar.demo(M.registrar);
  me = (await manager.get('/me')).body.data;
});
after(async () => { await app?.close(); });

const weekdayOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);

test('yangi shifokor: jadvalsiz qabul yo‘q; jadval kiritilgach bo‘sh vaqt chiqadi va qabul yoziladi', async () => {
  const branch = me.branches[0].id;
  const service = (await manager.get('/services')).body.data.find((s) => s.category === 'consultation');
  const s = (await manager.post('/staff', { full_name: 'Jadval Shifokorov', role: 'doctor', login: 'dr.jadval', branch_ids: [branch], doctor: { specialty: 'Terapevt', share_percent: 30, service_ids: [service.id] } })).body.data;
  const doc = (await manager.get('/staff')).body.data.find((x) => x.membership_id === s.membership_id);
  assert.equal(doc.has_schedule, false);
  const day = addDays(me.today, 1);
  assert.equal((await manager.get(`/availability?doctor_id=${doc.doctor_id}&date=${day}&service_id=${service.id}`)).body.data.working, false);

  const days = [1, 2, 3, 4, 5, 6, 0].map((wd) => ({ weekday: wd, branch_id: branch, start: '09:00', end: '15:00', break_start: '12:00', break_end: '12:30' }));
  const r = await manager.put(`/staff/doctors/${doc.doctor_id}/schedule`, { days });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const av = (await manager.get(`/availability?doctor_id=${doc.doctor_id}&date=${day}&service_id=${service.id}`)).body.data;
  assert.equal(av.working, true);
  assert.equal(av.start, '09:00');
  assert.ok(!av.slots.some((x) => x.time === '12:00'), 'tanaffusda slot yo‘q');
  const patient = (await manager.get('/patients?page_size=1')).body.data[0];
  const book = await registrar.post('/appointments', { patient_id: patient.id, branch_id: branch, doctor_id: doc.doctor_id, service_id: service.id, date: day, start_time: '10:00' }, { 'Idempotency-Key': randomUUID() });
  assert.equal(book.status, 201, JSON.stringify(book.body));
  assert.equal((await manager.get('/staff')).body.data.find((x) => x.membership_id === s.membership_id).has_schedule, true);
  const detail = (await manager.get(`/staff/doctors/${doc.doctor_id}`)).body.data;
  assert.equal(detail.schedule.length, 7);
  assert.equal(detail.schedule[0].branch_id, branch);
  assert.deepEqual(detail.doctor.branch_ids, [branch]);
  const audits = (await manager.get('/audit?action=doctor.schedule')).body.data;
  assert.ok(audits.some((a) => a.summary.includes('Jadval Shifokorov')));
});

test('validatsiya: tanaffus, takroriy kun, begona xona, biriktirilmagan filial, 30 daqiqadan qisqa', async () => {
  const doctorId = SEED_IDS.doctor(0);
  const [b1, b2] = me.branches.map((b) => b.id);
  const rooms = (await manager.get('/rooms')).body.data;
  const otherRoom = rooms.find((r) => r.branch_id !== b1);
  const put = (days) => manager.put(`/staff/doctors/${doctorId}/schedule`, { days });
  const day = (x) => ({ weekday: 1, branch_id: b1, start: '09:00', end: '17:00', ...x });
  let r = await put([day({ break_start: '08:00', break_end: '08:30' })]);
  assert.equal(r.status, 422); assert.ok(r.body.error.fields['days.0.break_start']);
  r = await put([day({ break_start: '13:00' })]);
  assert.equal(r.status, 422); assert.ok(r.body.error.fields['days.0.break_end']);
  r = await put([day({}), day({})]);
  assert.equal(r.status, 422); assert.ok(r.body.error.fields.days);
  r = await put([day({ room_id: otherRoom.id })]);
  assert.equal(r.status, 422); assert.equal(r.body.error.fields['days.0.room_id'], 'Xona shu filialda emas');
  r = await put([day({ end: '09:20' })]);
  assert.equal(r.status, 422); assert.ok(r.body.error.fields['days.0.end']);
  // a doctor assigned to one branch only cannot be scheduled in the other
  const single = (await manager.get('/staff')).body.data.find((x) => x.role === 'doctor' && x.branch_ids.length === 1);
  const foreign = single.branch_ids[0] === b1 ? b2 : b1;
  r = await manager.put(`/staff/doctors/${single.doctor_id}/schedule`, { days: [{ weekday: 1, branch_id: foreign, start: '09:00', end: '17:00' }] });
  assert.equal(r.status, 422); assert.match(r.body.error.fields['days.0.branch_id'], /biriktirilmagan/);
  // and a branch that is still in the schedule cannot be removed from the doctor
  const multi = (await manager.get('/staff')).body.data.find((x) => x.role === 'doctor' && x.branch_ids.length === 2);
  assert.ok(multi, 'seed’da ikki filialli shifokor bor');
  const keep = multi.branch_ids[0];
  const usesOther = (await pool.query(`SELECT 1 FROM schedules WHERE doctor_id = $1 AND branch_id <> $2`, [multi.doctor_id, keep])).rowCount;
  assert.ok(usesOther, 'u ikkala filialda ishlaydi');
  r = await manager.patch(`/staff/${multi.membership_id}`, { branch_ids: [keep] });
  assert.equal(r.status, 422); assert.match(r.body.error.fields.branch_ids, /jadvalida/);
});

test('kelgusi qabullar sig‘masa: 409 ro‘yxat bilan; tasdiq bilan saqlanadi, qabullar o‘chmaydi', async () => {
  const row = (await pool.query(
    `SELECT a.id, a.doctor_id, a.starts_at FROM appointments a WHERE a.tenant_id = $1 AND a.status = 'scheduled' AND a.starts_at > demo_now() ORDER BY a.starts_at LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  assert.ok(row, 'seed’da kelgusi qabul bor');
  const detail = (await manager.get(`/staff/doctors/${row.doctor_id}`)).body.data;
  const local = new Date(row.starts_at.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
  const days = detail.schedule.filter((s) => s.weekday !== weekdayOf(local))
    .map((s) => ({ weekday: s.weekday, branch_id: s.branch_id, room_id: s.room_id, start: s.start, end: s.end, break_start: s.break_start, break_end: s.break_end }));
  const r = await manager.put(`/staff/doctors/${row.doctor_id}/schedule`, { days });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'SCHEDULE_CONFLICTS');
  const c = r.body.error.details.conflicts.find((x) => x.appointment_id === row.id);
  assert.ok(c); assert.equal(c.reason, 'Bu kuni ishlamaydi');
  const before = (await pool.query(`SELECT count(*)::int AS n FROM schedules WHERE doctor_id = $1`, [row.doctor_id])).rows[0].n;
  assert.equal(before, detail.schedule.length, '409 da jadval o‘zgarmadi');

  const ok = await manager.put(`/staff/doctors/${row.doctor_id}/schedule`, { days, confirm_conflicts: true });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.data.conflicts.length >= 1);
  const appt = (await pool.query(`SELECT status FROM appointments WHERE id = $1`, [row.id])).rows[0];
  assert.equal(appt.status, 'scheduled', 'qabul o‘chirilmadi');
  const audits = (await manager.get('/audit?action=doctor.schedule')).body.data;
  assert.ok(audits.some((a) => a.summary.includes('jadvalga sig‘magan')));
});

test('ruxsat: registrator va shifokor 403; boshqa tenant rahbari 404', async () => {
  const days = [{ weekday: 1, branch_id: me.branches[0].id, start: '09:00', end: '17:00' }];
  assert.equal((await registrar.put(`/staff/doctors/${SEED_IDS.doctor(1)}/schedule`, { days })).status, 403);
  const doctor = session(); await doctor.demo(M.doctor(1));
  assert.equal((await doctor.put(`/staff/doctors/${SEED_IDS.doctor(1)}/schedule`, { days })).status, 403);
  const t2 = session(); await t2.demo(M.tenant2Manager);
  assert.equal((await t2.put(`/staff/doctors/${SEED_IDS.doctor(1)}/schedule`, { days: [{ weekday: 1, branch_id: SEED_IDS.branchTenant2, start: '09:00', end: '17:00' }] })).status, 404);
});
