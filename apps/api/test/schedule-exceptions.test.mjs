// Days off, vacations, clinic holidays and custom hours: booking is refused (DOCTOR_UNAVAILABLE), availability is
// empty, custom hours replace the weekly row, affected bookings are reported (never cancelled), tenant and role
// checks, and the Telegram bot (shared availability) skips the day.
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
    return { status: r.status, body: j };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), patch: (p, b) => req('PATCH', p, b), del: (p) => req('DELETE', p), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}

const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const weekdayOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const book = (s, body) => s.post('/appointments', body, { 'Idempotency-Key': randomUUID() });

let manager, registrar, doctor, t2manager, me, doc, service, sch, freshDay;
/** The first date ≥ from on which the doctor has a weekly row. */
const workingDay = (from) => { for (let i = 0; i < 14; i++) { const d = addDays(from, i); if (sch.some((s) => s.weekday === weekdayOf(d))) return d; } throw new Error('ish kuni topilmadi'); };
let nextOffset = 3;
/** A fresh working day for each test, so exceptions never overlap. */
const nextDay = () => { const d = workingDay(addDays(me.today, nextOffset)); nextOffset = (Date.parse(d) - Date.parse(me.today)) / 86400_000 + 1; return d; };
const rowFor = (date) => sch.find((s) => s.weekday === weekdayOf(date));

before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  await db.assertDatabaseName(pool, '_test');
  registrar = session(); await registrar.demo(M.registrar);
  doctor = session(); await doctor.demo(M.doctor(0));
  t2manager = session(); await t2manager.demo(M.tenant2Manager);
  me = (await manager.get('/me')).body.data;
  doc = (await manager.get(`/staff/doctors/${SEED_IDS.doctor(0)}`)).body.data;
  sch = doc.schedule;
  assert.ok(sch.length, 'seed shifokorining jadvali bor');
  const services = (await manager.get('/services')).body.data;
  const links = (await pool.query(`SELECT service_id FROM doctor_services WHERE doctor_id = $1`, [SEED_IDS.doctor(0)])).rows.map((r) => r.service_id);
  service = services.find((s) => s.category === 'consultation' && links.includes(s.id));
  assert.ok(service, 'shifokorning konsultatsiya xizmati bor');
  freshDay = nextDay();
});
after(async () => { await app?.close(); });

test('dam olish kuni: qabul 409 DOCTOR_UNAVAILABLE, bo‘sh vaqt yo‘q, ro‘yxat va audit; shifokor o‘zinikini o‘qiydi', async () => {
  const day = freshDay;
  const r = await manager.post('/schedule-exceptions', { doctor_id: SEED_IDS.doctor(0), from: day, kind: 'day_off', note: 'Kasal' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.days, 1);
  // the seed may already hold bookings that day: every reported one is this doctor's, on this day
  assert.ok(r.body.data.affected.every((a) => a.date === day && a.doctor_id === SEED_IDS.doctor(0)), JSON.stringify(r.body.data.affected));
  const av = (await registrar.get(`/availability?doctor_id=${SEED_IDS.doctor(0)}&date=${day}&service_id=${service.id}`)).body.data;
  assert.equal(av.working, false); assert.equal(av.reason, 'day_off'); assert.equal(av.slots.length, 0);
  const patient = (await manager.get('/patients?page_size=1')).body.data[0];
  const b = await book(registrar, { patient_id: patient.id, branch_id: rowFor(day).branch_id, doctor_id: SEED_IDS.doctor(0), service_id: service.id, date: day, start_time: rowFor(day).start });
  assert.equal(b.status, 409, JSON.stringify(b.body));
  assert.equal(b.body.error.code, 'DOCTOR_UNAVAILABLE');
  assert.match(b.body.error.message, /dam olish kuni/);
  // the list: manager, and the doctor for their own days
  const list = (await manager.get(`/schedule-exceptions?from=${day}&to=${day}&doctor_id=${SEED_IDS.doctor(0)}`)).body.data; // the seed has other doctors' days off too
  assert.equal(list.length, 1); assert.equal(list[0].kind, 'day_off'); assert.equal(list[0].note, 'Kasal'); assert.equal(list[0].doctor_name, doc.doctor.display_name);
  const own = (await doctor.get(`/schedule-exceptions?from=${day}&to=${day}&doctor_id=${SEED_IDS.doctor(1)}`)).body.data;
  assert.equal(own.length, 1, 'shifokor boshqa shifokorni so‘rasa ham faqat o‘zinikini ko‘radi'); assert.equal(own[0].doctor_id, SEED_IDS.doctor(0));
  const audits = (await manager.get('/audit?action=schedule.exception.create')).body.data;
  assert.ok(audits.some((a) => a.summary.includes(doc.doctor.display_name) && a.summary.includes('dam olish kuni')));
  // delete: the day is bookable again
  const d = await manager.del(`/schedule-exceptions/${list[0].id}`);
  assert.equal(d.status, 200);
  assert.equal((await registrar.get(`/availability?doctor_id=${SEED_IDS.doctor(0)}&date=${day}&service_id=${service.id}`)).body.data.working, true);
  assert.ok((await manager.get('/audit?action=schedule.exception.delete')).body.data.length);
});

test('maxsus ish vaqti: haftalik soat o‘rniga berilgan oyna, tanaffussiz; tashqarisiga yozib bo‘lmaydi', async () => {
  const day = nextDay(), row = rowFor(day);
  const r = await manager.post('/schedule-exceptions', { doctor_id: SEED_IDS.doctor(0), from: day, kind: 'custom_hours', start_time: '14:00', end_time: '16:00' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const av = (await registrar.get(`/availability?doctor_id=${SEED_IDS.doctor(0)}&date=${day}&service_id=${service.id}`)).body.data;
  assert.equal(av.working, true); assert.equal(av.start, '14:00'); assert.equal(av.end, '16:00'); assert.equal(av.custom_hours, true); assert.equal(av.break_start, null);
  assert.ok(av.slots.every((s) => s.time >= '14:00' && s.time < '16:00'), JSON.stringify(av.slots.map((s) => s.time)));
  const patient = (await manager.get('/patients?page_size=1')).body.data[0];
  const outside = await book(registrar, { patient_id: patient.id, branch_id: row.branch_id, doctor_id: SEED_IDS.doctor(0), service_id: service.id, date: day, start_time: row.start });
  assert.equal(outside.status, 422); assert.match(outside.body.error.fields.start_time, /14:00–16:00/);
  const inside = await book(registrar, { patient_id: patient.id, branch_id: row.branch_id, doctor_id: SEED_IDS.doctor(0), service_id: service.id, date: day, start_time: '14:30' });
  assert.equal(inside.status, 201, JSON.stringify(inside.body));
  // custom hours need a weekly row on that weekday
  const noRow = []; for (let i = 0; i < 7; i++) { const d = addDays(me.today, 30 + i); if (!rowFor(d)) noRow.push(d); }
  if (noRow.length) {
    const bad = await manager.post('/schedule-exceptions', { doctor_id: SEED_IDS.doctor(0), from: noRow[0], kind: 'custom_hours', start_time: '09:00', end_time: '12:00' });
    assert.equal(bad.status, 422); assert.match(bad.body.error.fields.from, /jadvali yo‘q/);
  }
  // validation: hours only with custom_hours, clinic-wide custom hours are impossible
  assert.equal((await manager.post('/schedule-exceptions', { doctor_id: SEED_IDS.doctor(0), from: day, kind: 'day_off', start_time: '09:00', end_time: '12:00' })).status, 422);
  assert.equal((await manager.post('/schedule-exceptions', { from: day, kind: 'custom_hours', start_time: '09:00', end_time: '12:00' })).status, 422);
  assert.equal((await manager.post('/schedule-exceptions', { doctor_id: SEED_IDS.doctor(0), from: day, to: addDays(day, -1), kind: 'vacation' })).status, 422);
});

test('bayram: butun klinika — har bir shifokor yopiq; filial bayrami faqat shu filialga', async () => {
  const day = nextDay();
  const r = await manager.post('/schedule-exceptions', { from: day, kind: 'holiday', note: 'Mustaqillik kuni' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const doctors = (await manager.get('/doctors')).body.data.filter((d) => d.schedule?.some((s) => s.weekday === weekdayOf(day)));
  assert.ok(doctors.length >= 2);
  for (const d of doctors) {
    const av = (await registrar.get(`/availability?doctor_id=${d.id}&date=${day}`)).body.data;
    assert.equal(av.working, false, d.display_name); assert.equal(av.reason, 'holiday'); assert.equal(av.note, 'Mustaqillik kuni');
  }
  const list = (await doctor.get(`/schedule-exceptions?from=${day}&to=${day}`)).body.data;
  assert.equal(list.length, 1); assert.equal(list[0].doctor_id, null);
  assert.equal((await manager.del(`/schedule-exceptions/${r.body.data.ids[0]}`)).status, 200);

  // a holiday of one branch: doctors of the other branch keep working that day
  const day2 = nextDay();
  const byBranch = new Map();
  for (const d of (await manager.get('/doctors')).body.data) { const s = d.schedule?.find((x) => x.weekday === weekdayOf(day2)); if (s && !byBranch.has(s.branch_id)) byBranch.set(s.branch_id, d); }
  if (byBranch.size >= 2) {
    const [[b1, d1], [, d2]] = [...byBranch.entries()];
    const br = await manager.post('/schedule-exceptions', { from: day2, kind: 'holiday', branch_id: b1 });
    assert.equal(br.status, 201, JSON.stringify(br.body));
    assert.equal((await registrar.get(`/availability?doctor_id=${d1.id}&date=${day2}`)).body.data.working, false);
    assert.equal((await registrar.get(`/availability?doctor_id=${d2.id}&date=${day2}`)).body.data.working, true);
    await manager.del(`/schedule-exceptions/${br.body.data.ids[0]}`);
  }
});

test('ta’til: mavjud qabullar bekor qilinmaydi, javobda «affected» ro‘yxati; bir kunga ikkinchi yozuv birinchisini almashtiradi', async () => {
  const day = nextDay(), row = rowFor(day);
  const patient = (await manager.get('/patients?page_size=1')).body.data[0];
  const b = await book(registrar, { patient_id: patient.id, branch_id: row.branch_id, doctor_id: SEED_IDS.doctor(0), service_id: service.id, date: day, start_time: row.start });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const r = await manager.post('/schedule-exceptions', { doctor_id: SEED_IDS.doctor(0), from: day, to: addDays(day, 6), kind: 'vacation' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.days, 7); assert.equal(r.body.data.ids.length, 7);
  const hit = r.body.data.affected.find((a) => a.appointment_id === b.body.data.id);
  assert.ok(hit, JSON.stringify(r.body.data.affected));
  assert.equal(hit.date, day); assert.equal(hit.time, row.start); assert.equal(hit.patient, `${patient.last_name} ${patient.first_name}`); assert.equal(hit.doctor_name, doc.doctor.display_name);
  assert.equal((await registrar.get(`/appointments/${b.body.data.id}`)).body.data.status, 'scheduled', 'qabul bekor qilinmadi');
  // same day again as a day off: one row, the kind changed
  const again = await manager.post('/schedule-exceptions', { doctor_id: SEED_IDS.doctor(0), from: day, kind: 'day_off' });
  assert.equal(again.status, 201);
  const rows = (await manager.get(`/schedule-exceptions?from=${day}&to=${day}&doctor_id=${SEED_IDS.doctor(0)}`)).body.data;
  assert.equal(rows.length, 1); assert.equal(rows[0].kind, 'day_off');
  // custom hours report only the bookings outside the window
  const day2 = addDays(day, 1);
  if (rowFor(day2)) {
    const b2 = await book(registrar, { patient_id: patient.id, branch_id: rowFor(day2).branch_id, doctor_id: SEED_IDS.doctor(0), service_id: service.id, date: day2, start_time: rowFor(day2).start });
    assert.equal(b2.status, 409, 'ta’tilda yozib bo‘lmaydi');
  }
  // moving a booking into the vacation is refused too
  const a = (await registrar.get(`/appointments/${b.body.data.id}`)).body.data;
  const moved = await registrar.patch(`/appointments/${a.id}`, { version: a.version, date: addDays(day, 2), start_time: row.start });
  assert.equal(moved.status, 409, JSON.stringify(moved.body)); assert.equal(moved.body.error.code, 'DOCTOR_UNAVAILABLE');
  for (const id of r.body.data.ids) await manager.del(`/schedule-exceptions/${id}`);
  nextOffset += 7;
});

test('boshqa klinika 404, registrator/shifokor yozolmaydi 403, o‘tgan kun 422', async () => {
  const day = nextDay();
  const r = await manager.post('/schedule-exceptions', { doctor_id: SEED_IDS.doctor(0), from: day, kind: 'day_off' });
  assert.equal(r.status, 201);
  const id = r.body.data.ids[0];
  assert.equal((await t2manager.del(`/schedule-exceptions/${id}`)).status, 404);
  assert.equal((await t2manager.get(`/schedule-exceptions?from=${day}&to=${day}`)).body.data.length, 0);
  assert.equal((await t2manager.post('/schedule-exceptions', { doctor_id: SEED_IDS.doctor(0), from: day, kind: 'day_off' })).status, 404, 'begona shifokor 404');
  assert.equal((await registrar.post('/schedule-exceptions', { doctor_id: SEED_IDS.doctor(0), from: day, kind: 'day_off' })).status, 403);
  assert.equal((await doctor.post('/schedule-exceptions', { doctor_id: SEED_IDS.doctor(0), from: day, kind: 'day_off' })).status, 403);
  assert.equal((await registrar.del(`/schedule-exceptions/${id}`)).status, 403);
  assert.equal((await doctor.del(`/schedule-exceptions/${id}`)).status, 403);
  assert.equal((await manager.del(`/schedule-exceptions/${randomUUID()}`)).status, 404);
  assert.equal((await manager.post('/schedule-exceptions', { doctor_id: SEED_IDS.doctor(0), from: addDays(me.today, -1), kind: 'day_off' })).status, 422);
  assert.equal((await manager.del(`/schedule-exceptions/${id}`)).status, 200);
  assert.equal((await manager.del(`/schedule-exceptions/${id}`)).status, 404, 'ikkinchi o‘chirish 404');
});

test('Telegram bot: bayram kuni sanalar ro‘yxatida chiqmaydi (umumiy availability)', async () => {
  await pool.query(`DELETE FROM telegram_chats`); await pool.query(`DELETE FROM telegram_sim_messages`);
  const out = async (chat) => (await manager.get(`/telegram/sim/messages?chat_id=${chat}`)).body.data.filter((m) => m.direction === 'out');
  const say = (chat, text) => manager.post('/telegram/sim/send', { chat_id: chat, text });
  const press = async (chat, match) => {
    for (const m of (await out(chat)).reverse()) {
      const btn = (m.markup?.inline_keyboard ?? []).flat().find((b) => match(b.text));
      if (btn) { assert.equal((await manager.post('/telegram/sim/send', { chat_id: chat, callback_data: btn.callback_data, label: btn.text })).status, 200); return btn; }
    }
    throw new Error('tugma topilmadi');
  };
  const dateButtons = async (chat) => (await out(chat)).at(-1).markup.inline_keyboard.flat().map((b) => b.text).filter((x) => /^\d\d\.\d\d /.test(x));
  const p = (await pool.query(
    `SELECT p.phone FROM patients p WHERE p.tenant_id = $1 AND p.phone IS NOT NULL
        AND (SELECT count(*) FROM patients x WHERE x.tenant_id = $1 AND x.phone = p.phone) = 1 ORDER BY p.patient_number LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  const chat = (await manager.post('/telegram/sim/chats')).body.data.chat_id;
  await say(chat, '/start');
  await manager.post('/telegram/sim/send', { chat_id: chat, contact_phone: p.phone });
  const toDates = async () => {
    await say(chat, '📅 Qabulga yozilish');
    if ((await out(chat)).at(-1).text.includes('Kim uchun')) await press(chat, (x) => !x.includes('➕'));
    await press(chat, (x) => x.includes('so‘m'));
    await press(chat, (x) => x.includes('·'));
    return dateButtons(chat);
  };
  const before = await toDates();
  assert.ok(before.length, 'sanalar bor');
  // the first offered date becomes a clinic holiday
  const first = before[0].slice(0, 5); // DD.MM
  const year = me.today.slice(0, 4);
  let date = `${year}-${first.slice(3, 5)}-${first.slice(0, 2)}`; if (date < me.today) date = `${Number(year) + 1}-${first.slice(3, 5)}-${first.slice(0, 2)}`;
  const r = await manager.post('/schedule-exceptions', { from: date, kind: 'holiday' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await press(chat, (x) => x.includes('Bekor qilish'));
  const after = await toDates();
  assert.ok(!after.some((x) => x.startsWith(first)), `bayram kuni ro‘yxatda qoldi: ${after.join(', ')}`);
  for (const id of r.body.data.ids) await manager.del(`/schedule-exceptions/${id}`);
});
