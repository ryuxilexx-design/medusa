// Visit documents: referral / certificate / prescription — validation, numbering, snapshots, diagnosis privacy,
// immutability (API + DB trigger), void with reason, access only for the treating doctor.
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
  return { get: (p) => req('GET', p), post: (p, b = {}) => req('POST', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
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

const referral = { kind: 'referral', body: { to_specialty: 'Kardiolog', to_institution: 'Respublika kardiologiya markazi', reason: 'AQB 160/100, ko‘krak qafasida og‘riq', urgency: 'urgent', icd10: ['I10'] } };
const prescription = { kind: 'prescription', body: { items: [{ name: 'Amlodipin', form: 'tabletka', dose: '5 mg', frequency: 'kuniga 1 marta, ertalab', duration: '30 kun', instructions: 'ovqatdan keyin' }], notes: 'AQB ni kuniga 2 marta o‘lchab yozib boring' } };

test('yo‘llanma va retsept: raqamlanadi, snapshot (shifokor, filial, MKB-10 nomi bilan), audit’da matn yo‘q', async () => {
  const r1 = await doctor.post(`/encounters/${open}/documents`, referral);
  assert.equal(r1.status, 201, r1.text);
  const r2 = await doctor.post(`/encounters/${open}/documents`, prescription);
  assert.equal(r2.status, 201, r2.text);
  assert.equal(r2.body.data.number, r1.body.data.number + 1, 'ketma-ket raqam');
  const d = (await doctor.get(`/documents/${r1.body.data.id}`)).body.data;
  assert.equal(d.kind, 'referral'); assert.equal(d.status, 'issued');
  assert.equal(d.body.urgency, 'urgent');
  assert.deepEqual(d.body.icd10.map((x) => x.code), ['I10']); assert.ok(d.body.icd10[0].title);
  assert.ok(d.body.meta.doctor_name && d.body.meta.branch_name && d.body.meta.visit_date);
  assert.ok(d.patient.last_name);
  const list = (await doctor.get(`/encounters/${open}/documents`)).body.data;
  assert.equal(list.length, 2);
  const a = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'document.issue' AND resource_id = $1`, [r1.body.data.id])).rows[0];
  assert.match(a.summary, /Yo‘llanma №\d+ berildi/);
  assert.ok(!a.summary.includes('ko‘krak'), 'audit’da klinik matn yo‘q');
});

test('validatsiya: bo‘sh retsept, noma’lum MKB-10, 30 kundan ko‘p dam olish — 422', async () => {
  assert.equal((await doctor.post(`/encounters/${open}/documents`, { kind: 'prescription', body: { items: [] } })).status, 422);
  const bad = await doctor.post(`/encounters/${open}/documents`, { ...referral, body: { ...referral.body, icd10: ['Z99.99'] } });
  assert.equal(bad.status, 422); assert.ok(bad.body.error.fields['body.icd10']);
  assert.equal((await doctor.post(`/encounters/${open}/documents`, { kind: 'certificate', body: { purpose: 'Ish joyiga', rest_days: 45 } })).status, 422);
  assert.equal((await doctor.post(`/encounters/${open}/documents`, { kind: 'xyz', body: {} })).status, 422);
});

test('ma’lumotnoma: tashxis sukut bo‘yicha yozilmaydi; so‘ralsa — faqat tasdiqlangan qayddan; dam olish sanalari hisoblanadi', async () => {
  const plain = await doctor.post(`/encounters/${open}/documents`, { kind: 'certificate', body: { purpose: 'O‘qish joyiga', rest_days: 3 } });
  assert.equal(plain.status, 201, plain.text);
  const p = (await doctor.get(`/documents/${plain.body.data.id}`)).body.data.body;
  assert.equal(p.include_diagnosis, false); assert.equal(p.diagnosis, null); assert.deepEqual(p.icd10, []);
  assert.equal(p.rest_from, p.meta.visit_date);
  assert.equal((Date.parse(p.rest_until) - Date.parse(p.rest_from)) / 86400_000, 2, '3 kun: birinchi va oxirgi kun ichida');
  const unsigned = await doctor.post(`/encounters/${open}/documents`, { kind: 'certificate', body: { purpose: 'Ish joyiga', include_diagnosis: true } });
  assert.equal(unsigned.status, 409); assert.equal(unsigned.body.error.code, 'NOTE_NOT_SIGNED');
  const withDx = await doctor.post(`/encounters/${signed}/documents`, { kind: 'certificate', body: { purpose: 'Ish joyiga', include_diagnosis: true } });
  assert.equal(withDx.status, 201, withDx.text);
  const w = (await doctor.get(`/documents/${withDx.body.data.id}`)).body.data.body;
  assert.ok(w.diagnosis && w.diagnosis.length > 2, 'tasdiqlangan qaydagi tashxis');
});

test('o‘zgarmaslik: API’da tahrir yo‘q, bazada trigger; bekor qilish sabab bilan, ikkinchi marta 409', async () => {
  const r = (await doctor.post(`/encounters/${open}/documents`, prescription)).body.data;
  await assert.rejects(pool.query(`UPDATE medical_documents SET body = '{}' WHERE id = $1`, [r.id]), /immutable/);
  await assert.rejects(pool.query(`DELETE FROM medical_documents WHERE id = $1`, [r.id]), /cannot be deleted/);
  assert.equal((await doctor.post(`/documents/${r.id}/void`, {})).status, 422, 'sabab majburiy');
  const v = await doctor.post(`/documents/${r.id}/void`, { reason: 'Doza noto‘g‘ri yozilgan' });
  assert.equal(v.status, 200);
  const d = (await doctor.get(`/documents/${r.id}`)).body.data;
  assert.equal(d.status, 'void'); assert.equal(d.void_reason, 'Doza noto‘g‘ri yozilgan'); assert.ok(d.voided_by_name);
  assert.equal((await doctor.post(`/documents/${r.id}/void`, { reason: 'yana' })).status, 409);
  await assert.rejects(pool.query(`UPDATE medical_documents SET status = 'issued' WHERE id = $1`, [r.id]), /immutable/, 'bekor qilinganini qaytarib bo‘lmaydi');
});

test('ruxsat: faqat davolovchi shifokor; boshqa shifokor, rahbar, registrator va boshqa klinika rahbari — 403', async () => {
  const r = (await doctor.post(`/encounters/${open}/documents`, referral)).body.data;
  assert.equal((await other.post(`/encounters/${open}/documents`, referral)).status, 403);
  assert.equal((await other.get(`/documents/${r.id}`)).status, 403);
  assert.equal((await other.post(`/documents/${r.id}/void`, { reason: 'begona' })).status, 403);
  assert.equal((await manager.get(`/documents/${r.id}`)).status, 403);
  const reg = session(); await reg.demo(M.registrar);
  assert.equal((await reg.get(`/encounters/${open}/documents`)).status, 403);
  const t2 = session(); await t2.demo(M.tenant2Manager);
  assert.equal((await t2.get(`/documents/${r.id}`)).status, 403, 'rol bo‘yicha avval rad etiladi');
});
