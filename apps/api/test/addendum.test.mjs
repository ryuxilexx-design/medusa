// Addendum to a signed clinical note (migration 019): only the treating doctor, only on a signed note, append-only
// at the API and in the database, returned with the encounter (the doctor's screen and the print page read it there).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}) => req('POST', p, b), put: (p, b) => req('PUT', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}

let doctor, other, manager, open, signed;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  doctor = session(); await doctor.demo(M.doctor(0));
  other = session(); await other.demo(M.doctor(1));
  const today = (await doctor.get('/me')).body.data.today;
  const appts = (await doctor.get(`/appointments?date=${today}`)).body.data;
  open = appts.find((a) => a.status === 'in_progress' && a.encounter_id).encounter_id;
  signed = appts.find((a) => a.status === 'completed' && a.encounter_id).encounter_id;
  assert.ok(open && signed, 'seed’da davom etayotgan va yakunlangan qabul bor');
});
after(async () => { await app?.close(); });

const addendum = { text: 'Qon tahlili natijasi keldi: gemoglobin 118 g/l. Temir preparati tavsiya etildi.', reason: 'Tahlil natijasi keldi' };

test('davolovchi shifokor tasdiqlangan qaydga qo‘shimcha yozuv qo‘shadi; qayd o‘zi o‘zgarmaydi; audit’da klinik matn yo‘q', async () => {
  const before = (await doctor.get(`/encounters/${signed}`)).body.data;
  assert.equal(before.note.status, 'signed');
  assert.deepEqual(before.addenda, []);
  const r = await doctor.post(`/encounters/${signed}/addendum`, addendum);
  assert.equal(r.status, 201, r.text);
  const a = r.body.data;
  assert.equal(a.text, addendum.text); assert.equal(a.reason, addendum.reason);
  assert.ok(a.id && a.signed_at && a.author_name, 'imzo: kim va qachon');
  const after = (await doctor.get(`/encounters/${signed}`)).body.data;
  assert.equal(after.addenda.length, 1); assert.equal(after.addenda[0].id, a.id);
  assert.equal(after.note.version, before.note.version, 'asl qayd o‘zgarmadi');
  assert.equal(after.note.diagnosis, before.note.diagnosis);
  const log = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'clinical_note.addendum' AND resource_id = $1`, [signed])).rows;
  assert.equal(log.length, 1);
  assert.ok(!log[0].summary.includes('gemoglobin') && !log[0].summary.includes('Tahlil'), 'audit’da matn va sabab yo‘q');
});

test('ikkinchi qo‘shimcha tartib bilan keladi; chop etish ma’lumoti (GET /encounters/:id) ikkalasini ham beradi', async () => {
  const r = await doctor.post(`/encounters/${signed}/addendum`, { text: 'Tashxis aniqlashtirildi: temir tanqisligi anemiyasi, yengil daraja.', reason: 'Tashxis aniqlashtirildi' });
  assert.equal(r.status, 201, r.text);
  const print = (await doctor.get(`/encounters/${signed}`)).body.data;
  assert.equal(print.addenda.length, 2);
  assert.ok(Date.parse(print.addenda[0].signed_at) <= Date.parse(print.addenda[1].signed_at), 'eskisi birinchi');
  assert.match(print.addenda[1].text, /aniqlashtirildi/);
  assert.ok(print.note.signed_by_name && print.patient.last_name, 'chop etish uchun qayd va bemor ham bor');
});

test('ruxsat: boshqa shifokor, rahbar va registrator — 403; boshqa klinika — 404', async () => {
  assert.equal((await other.post(`/encounters/${signed}/addendum`, addendum)).status, 403);
  assert.equal((await manager.post(`/encounters/${signed}/addendum`, addendum)).status, 403);
  const reg = session(); await reg.demo(M.registrar);
  assert.equal((await reg.post(`/encounters/${signed}/addendum`, addendum)).status, 403);
  const t2 = session(); await t2.demo(M.tenant2Doctor ?? M.tenant2Manager);
  const foreign = await t2.post(`/encounters/${signed}/addendum`, addendum);
  assert.ok([403, 404].includes(foreign.status), `boshqa klinika: ${foreign.status}`);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM note_addenda WHERE encounter_id = $1`, [signed])).rows[0].n, 2, 'hech biri yozilmadi');
});

test('tasdiqlanmagan qaydga qo‘shimcha yo‘q — 409 NOTE_NOT_SIGNED (ruscha sessiyada xabar rus tilida)', async () => {
  const r = await doctor.post(`/encounters/${open}/addendum`, addendum);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'NOTE_NOT_SIGNED');
  assert.match(r.body.error.message, /tasdiqlangan qaydga/);
  assert.equal((await doctor.put('/me/preferences', { locale: 'ru' })).status, 200);
  try {
    const ru = await doctor.post(`/encounters/${open}/addendum`, addendum);
    assert.equal(ru.status, 409); assert.match(ru.body.error.message, /подписанной записи/);
  } finally { await doctor.put('/me/preferences', { locale: 'uz' }); }
});

test('validatsiya: bo‘sh matn yoki sabab — 422 maydon xatosi bilan', async () => {
  let r = await doctor.post(`/encounters/${signed}/addendum`, { text: '', reason: 'sabab' });
  assert.equal(r.status, 422); assert.ok(r.body.error.fields.text, r.text);
  r = await doctor.post(`/encounters/${signed}/addendum`, { text: 'Qo‘shimcha matn', reason: '' });
  assert.equal(r.status, 422); assert.ok(r.body.error.fields.reason, r.text);
  r = await doctor.post(`/encounters/${signed}/addendum`, { text: 'x'.repeat(4001), reason: 'sabab' });
  assert.equal(r.status, 422);
});

test('o‘zgarmaslik: qo‘shimcha yozuvni bazada ham o‘zgartirib, o‘chirib bo‘lmaydi; tasdiqlangan qayd ham', async () => {
  const id = (await pool.query(`SELECT id FROM note_addenda WHERE encounter_id = $1 LIMIT 1`, [signed])).rows[0].id;
  await assert.rejects(pool.query(`UPDATE note_addenda SET text = 'boshqa' WHERE id = $1`, [id]), /immutable/);
  await assert.rejects(pool.query(`UPDATE note_addenda SET reason = 'boshqa' WHERE id = $1`, [id]), /immutable/);
  await assert.rejects(pool.query(`DELETE FROM note_addenda WHERE id = $1`, [id]), /immutable/);
  await assert.rejects(pool.query(`UPDATE clinical_notes SET diagnosis = 'boshqa' WHERE encounter_id = $1`, [signed]), /immutable/);
  // the API has no edit or delete route either
  const r = await doctor.put(`/encounters/${signed}/draft`, { version: 1, complaints: 'x', anamnesis: null, examination: 'x', diagnosis: 'x', recommendations: 'x', follow_up_date: null, vitals: {} });
  assert.equal(r.status, 409);
});
