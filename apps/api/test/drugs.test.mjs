// Drug reference + structured allergies + prescription allergy check (migration 028, docs/DRUGS.md):
// search, allergy list roles / tenant isolation / append-only, cross-reactivity, severe → 409 without an override reason,
// override → 201 + audit, duplicate INN, DMED note data on the printed prescription.
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

let doctor, other, manager, registrar, t2, open, patientId, otherPatient, t2Patient;
const drug = {};
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  doctor = session(); await doctor.demo(M.doctor(0));
  other = session(); await other.demo(M.doctor(1));
  registrar = session(); await registrar.demo(M.registrar);
  t2 = session(); await t2.demo(M.tenant2Manager);
  const today = (await doctor.get('/me')).body.data.today;
  const appts = (await doctor.get(`/appointments?date=${today}`)).body.data;
  const a = appts.find((x) => x.status === 'in_progress' && x.encounter_id);
  open = a.encounter_id; patientId = a.patient_id;
  // a patient of this clinic the first doctor never saw, and a patient of the other clinic
  otherPatient = (await pool.query(`SELECT p.id FROM patients p WHERE p.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM appointments x WHERE x.patient_id = p.id AND x.doctor_id = $2) LIMIT 1`,
    [SEED_IDS.tenant, SEED_IDS.doctor(0)])).rows[0].id;
  t2Patient = (await pool.query(`SELECT id FROM patients WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant2])).rows[0].id;
  for (const [k, inn] of [['amox', 'Amoxicillin'], ['ceftri', 'Ceftriaxone'], ['mero', 'Meropenem'], ['para', 'Paracetamol'], ['ibu', 'Ibuprofen'], ['diclo', 'Diclofenac'], ['azi', 'Azithromycin']])
    drug[k] = (await pool.query(`SELECT id FROM drugs WHERE inn = $1`, [inn])).rows[0].id;
});
after(async () => { await app?.close(); });

const item = (drug_id, name) => ({ drug_id, name, dose: '500 mg', frequency: 'kuniga 3 marta', duration: '7 kun' });
const rx = (items, extra = {}) => ({ kind: 'prescription', body: { items, ...extra } });
async function withdrawAll() {
  for (const a of (await doctor.get(`/patients/${patientId}/allergies`)).body.data.filter((x) => !x.withdrawn_at))
    assert.equal((await doctor.post(`/patients/${patientId}/allergies/${a.id}/withdraw`, { reason: 'test tozalash' })).status, 200);
}

test('boshlang‘ich ro‘yxat migratsiyada yuklangan: ~400 ta XPN, ATX, shakllar, allergiya sinflari', async () => {
  const r = (await pool.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE source = 'starter')::int AS s, count(*) FILTER (WHERE atc IS NOT NULL)::int AS atc FROM drugs`)).rows[0];
  assert.ok(r.n >= 300 && r.s >= 300, `dorilar: ${r.n}`);
  assert.ok(r.atc >= 300);
  const bad = (await pool.query(`SELECT inn FROM drugs d WHERE EXISTS (SELECT 1 FROM unnest(d.allergy_classes) c WHERE c NOT IN (SELECT code FROM allergy_classes))`)).rows;
  assert.deepEqual(bad, [], 'har bir sinf allergy_classes jadvalida bor');
});

test('qidiruv: lotin, kirill, o‘zbekcha yozilish (amoks → амокс), ATX prefiksi; LIMIT 20; faqat shifokor', async () => {
  const names = async (q) => (await doctor.get(`/drugs?q=${encodeURIComponent(q)}`)).body.data.map((d) => d.inn);
  assert.ok((await names('amox')).includes('Amoxicillin'));
  assert.ok((await names('Амокс')).includes('Amoxicillin'));
  assert.ok((await names('amoks')).includes('Amoxicillin'), 'lotincha yozilgan ruscha nom ham topadi');
  assert.equal((await names('amox'))[0], 'Amoxicillin', 'boshidan mos kelgan birinchi');
  const atc = (await doctor.get('/drugs?q=J01CA')).body.data;
  assert.ok(atc.length >= 2 && atc.every((d) => d.atc.startsWith('J01CA')));
  const d = atc.find((x) => x.inn === 'Amoxicillin');
  assert.deepEqual(d.allergy_classes, ['penicillins']); assert.equal(d.prescription_only, true); assert.ok(d.forms.includes('caps'));
  assert.ok((await doctor.get('/drugs?q=in')).body.data.length <= 20);
  assert.deepEqual((await doctor.get('/drugs?q=a')).body.data, []);
  assert.equal((await registrar.get('/drugs?q=amox')).status, 403);
  assert.equal((await manager.get('/drugs?q=amox')).status, 403);
});

test('allergiyalar: shifokor qo‘shadi (karta «ma’lum» bo‘ladi), registrator faqat matn yozadi va o‘qiy olmaydi, shifokor tasdiqlaydi', async () => {
  assert.deepEqual((await doctor.get(`/patients/${patientId}/allergies`)).body.data, []);
  const a = await doctor.post(`/patients/${patientId}/allergies`, { class_code: 'penicillins', reaction: 'toshma', severity: 'moderate' });
  assert.equal(a.status, 201, a.text);
  assert.equal((await pool.query(`SELECT allergy_state FROM patients WHERE id = $1`, [patientId])).rows[0].allergy_state, 'known');
  assert.equal((await doctor.post(`/patients/${patientId}/allergies`, { class_code: 'nope_class' })).status, 422);
  assert.equal((await doctor.post(`/patients/${patientId}/allergies`, { severity: 'severe' })).status, 422, 'sinf, dori yoki matn shart');

  // reception: patient's words only, never a class; cannot read the list
  assert.equal((await registrar.post(`/patients/${patientId}/allergies`, { class_code: 'penicillins' })).status, 403);
  const r = await registrar.post(`/patients/${patientId}/allergies`, { free_text: 'Asalga toshma chiqadi' });
  assert.equal(r.status, 201, r.text);
  assert.equal((await registrar.get(`/patients/${patientId}/allergies`)).status, 403);
  assert.equal((await manager.get(`/patients/${patientId}/allergies`)).status, 403);
  assert.equal((await manager.post(`/patients/${patientId}/allergies`, { free_text: 'asal' })).status, 403);

  const list = (await doctor.get(`/patients/${patientId}/allergies`)).body.data;
  const rep = list.find((x) => x.id === r.body.data.id);
  assert.equal(rep.source, 'intake'); assert.equal(rep.confirmed_at, null); assert.equal(rep.recorded_by_role, 'registrar');
  assert.equal(list.find((x) => x.id === a.body.data.id).class_name_uz, 'Penitsillinlar');
  assert.equal((await doctor.post(`/patients/${patientId}/allergies/${rep.id}/confirm`)).status, 200);
  assert.equal((await doctor.post(`/patients/${patientId}/allergies/${rep.id}/confirm`)).body.error.code, 'ALREADY_CONFIRMED');

  // Telegram intake answer → one click; a second click is the same row
  const i1 = await doctor.post(`/patients/${patientId}/allergies`, { free_text: 'Analgin', source: 'intake' });
  const i2 = await doctor.post(`/patients/${patientId}/allergies`, { free_text: 'analgin', source: 'intake' });
  assert.equal(i2.body.data.id, i1.body.data.id); assert.equal(i2.body.data.existing, true);

  const audits = (await pool.query(`SELECT action, summary FROM audit_logs WHERE resource_id = $1 AND action LIKE 'patient.allergy_%'`, [patientId])).rows;
  assert.ok(audits.some((x) => x.action === 'patient.allergy_reported') && audits.some((x) => x.action === 'patient.allergy_confirm'));
  assert.ok(audits.every((x) => !/toshma|asal|analgin/i.test(x.summary)), 'audit’da klinik matn yo‘q');
  await withdrawAll();
});

test('ruxsat va klinika ajratilishi: boshqa shifokorning bemori 403, boshqa klinika bemori 404', async () => {
  assert.equal((await doctor.get(`/patients/${otherPatient}/allergies`)).status, 403);
  assert.equal((await doctor.post(`/patients/${otherPatient}/allergies`, { free_text: 'asal' })).status, 403);
  assert.equal((await doctor.get(`/patients/${t2Patient}/allergies`)).status, 404);
  assert.equal((await registrar.post(`/patients/${t2Patient}/allergies`, { free_text: 'asal' })).status, 404);
  assert.equal((await t2.get(`/patients/${patientId}/allergies`)).status, 403, 'rahbar rol bo‘yicha rad etiladi');
  const aid = (await pool.query(`SELECT id FROM patient_allergies WHERE patient_id = $1 LIMIT 1`, [patientId])).rows[0].id;
  assert.equal((await doctor.post(`/patients/${otherPatient}/allergies/${aid}/withdraw`, { reason: 'begona' })).status, 403);
});

test('faqat qo‘shish/bekor qilish: bekor qilish sabab bilan, ikkinchi marta 409, bazada tahrir va o‘chirish yo‘q', async () => {
  const id = (await doctor.post(`/patients/${patientId}/allergies`, { class_code: 'macrolides', severity: 'mild' })).body.data.id;
  assert.equal((await doctor.post(`/patients/${patientId}/allergies/${id}/withdraw`, {})).status, 422);
  assert.equal((await doctor.post(`/patients/${patientId}/allergies/${id}/withdraw`, { reason: 'Allergolog: proba manfiy' })).status, 200);
  const again = await doctor.post(`/patients/${patientId}/allergies/${id}/withdraw`, { reason: 'yana' });
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'ALREADY_WITHDRAWN');
  await assert.rejects(pool.query(`UPDATE patient_allergies SET severity = 'severe' WHERE id = $1`, [id]), /append-only/);
  await assert.rejects(pool.query(`UPDATE patient_allergies SET withdrawn_at = NULL WHERE id = $1`, [id]), /append-only/);
  await assert.rejects(pool.query(`DELETE FROM patient_allergies WHERE id = $1`, [id]), /cannot be deleted/);
  const list = (await doctor.get(`/patients/${patientId}/allergies`)).body.data;
  assert.equal(list.find((x) => x.id === id).withdraw_reason, 'Allergolog: proba manfiy');
});

test('o‘zaro reaksiya: penitsillin (o‘rtacha) → amoksitsillin ogohlantirish, seftriakson qisman (bloklamaydi), paratsetamol toza', async () => {
  await doctor.post(`/patients/${patientId}/allergies`, { class_code: 'penicillins', reaction: 'eshakemi', severity: 'moderate' });
  const c = await doctor.post(`/encounters/${open}/prescription-check`, { items: [{ drug_id: drug.amox, name: 'Amoxicillin' }, { drug_id: drug.ceftri, name: 'Ceftriaxone' }, { drug_id: drug.para, name: 'Paracetamol' }] });
  assert.equal(c.status, 200, c.text);
  const w = c.body.data.warnings;
  const amox = w.find((x) => x.item === 0), cef = w.find((x) => x.item === 1);
  assert.equal(amox.match, 'class'); assert.equal(amox.class_code, 'penicillins'); assert.equal(amox.reaction, 'eshakemi'); assert.equal(amox.blocking, false);
  assert.equal(cef.match, 'cross'); assert.equal(cef.class_code, 'cephalosporins'); assert.equal(cef.blocking, false);
  assert.ok(!w.some((x) => x.item === 2), 'paratsetamolga ogohlantirish yo‘q');
  // a typed (not picked) name of a listed drug is recognised too
  const typed = (await doctor.post(`/encounters/${open}/prescription-check`, { items: [{ name: 'амоксициллин' }] })).body.data.warnings;
  assert.equal(typed[0]?.class_code, 'penicillins');
  // issuing with only non-severe hits works and returns the warnings
  const ok = await doctor.post(`/encounters/${open}/documents`, rx([item(drug.amox, 'Amoxicillin')]));
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.body.data.warnings.length, 1);
  await withdrawAll();
});

test('og‘ir allergiya: sababsiz 409 ALLERGY_CONFLICT (uz/ru), sabab bilan 201 + audit; sabab hujjatda saqlanadi', async () => {
  await doctor.post(`/patients/${patientId}/allergies`, { class_code: 'cephalosporins', reaction: 'anafilaksiya', severity: 'severe' });
  const no = await doctor.post(`/encounters/${open}/documents`, rx([item(drug.ceftri, 'Ceftriaxone')]));
  assert.equal(no.status, 409); assert.equal(no.body.error.code, 'ALLERGY_CONFLICT');
  assert.match(no.body.error.message, /og‘ir allergiya/);
  assert.equal(no.body.error.details.warnings[0].blocking, true);
  // severe cephalosporin allergy: a penicillin is a partial cross-reaction — still blocks, because the allergy is severe
  assert.equal((await doctor.post(`/encounters/${open}/documents`, rx([item(drug.amox, 'Amoxicillin')]))).status, 409);
  const ru = session(); await ru.demo(M.doctor(0));
  assert.equal((await ru.put('/me/preferences', { locale: 'ru' })).status, 200);
  const noRu = await ru.post(`/encounters/${open}/documents`, rx([item(drug.ceftri, 'Ceftriaxone')]));
  assert.match(noRu.body.error.message, /^Ceftriaxone: у пациента отмечена тяжёлая аллергия/);
  assert.equal((await doctor.post(`/encounters/${open}/documents`, rx([item(drug.ceftri, 'Ceftriaxone')], { override_reason: 'ok' }))).status, 422, 'sabab juda qisqa');
  const reason = 'Allergolog bilan kelishildi, teri probasi manfiy';
  const yes = await doctor.post(`/encounters/${open}/documents`, rx([item(drug.ceftri, 'Ceftriaxone')], { override_reason: reason }));
  assert.equal(yes.status, 201, yes.text);
  const d = (await doctor.get(`/documents/${yes.body.data.id}`)).body.data;
  assert.equal(d.body.allergy_check.override_reason, reason);
  assert.equal(d.body.allergy_check.warnings[0].class_code, 'cephalosporins');
  const a = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'document.allergy_override' AND resource_id = $1`, [yes.body.data.id])).rows;
  assert.equal(a.length, 1);
  assert.ok(!a[0].summary.includes('Allergolog'), 'sabab matni audit’ga yozilmaydi');
  // a non-severe drug of an unrelated class needs nothing
  assert.equal((await doctor.post(`/encounters/${open}/documents`, rx([item(drug.azi, 'Azithromycin')]))).status, 201);
  await withdrawAll();
});

test('erkin matnli allergiya (registrator yoki eski karta yozuvi): dori nomi va sinf kalit so‘zlari bo‘yicha ogohlantiradi, bloklamaydi', async () => {
  await registrar.post(`/patients/${patientId}/allergies`, { free_text: 'ibuprofen ichsa nafas qisadi' });
  const w = (await doctor.post(`/encounters/${open}/prescription-check`, { items: [{ drug_id: drug.ibu, name: 'Ibuprofen' }, { drug_id: drug.diclo, name: 'Diclofenac' }, { drug_id: drug.para, name: 'Paracetamol' }] })).body.data.warnings;
  assert.equal(w.find((x) => x.item === 0).match, 'drug');
  assert.equal(w.find((x) => x.item === 1).match, 'class');
  assert.ok(w.every((x) => !x.blocking));
  assert.ok(!w.some((x) => x.item === 2));
  await withdrawAll();
  // the old card field still counts
  await pool.query(`UPDATE patients SET allergy_state = 'known', allergy_note = 'Penitsillin — toshma' WHERE id = $1`, [patientId]);
  const legacy = (await doctor.post(`/encounters/${open}/prescription-check`, { items: [{ drug_id: drug.amox, name: 'Amoxicillin' }] })).body.data.warnings;
  assert.equal(legacy[0]?.source, 'card'); assert.equal(legacy[0]?.class_code, 'penicillins');
  await pool.query(`UPDATE patients SET allergy_note = NULL WHERE id = $1`, [patientId]);
});

test('bir retseptda bir xil XPN ikki marta — 422; yozilgan va tanlangan bir xil nom ham takror', async () => {
  const r = await doctor.post(`/encounters/${open}/documents`, rx([item(drug.para, 'Paracetamol'), item(drug.para, 'Paracetamol')]));
  assert.equal(r.status, 422); assert.ok(r.body.error.fields['body.items.1.name']);
  const r2 = await doctor.post(`/encounters/${open}/documents`, rx([item(drug.para, 'Paracetamol'), item(null, 'paracetamol')]));
  assert.equal(r2.status, 422);
  assert.equal((await doctor.post(`/encounters/${open}/documents`, rx([item('00000000-0000-4000-8000-000000000000', 'Nima')]))).status, 422, 'noma’lum dori id');
});

test('chop etish ma’lumoti: retsept bo‘yicha dori DMED belgisi bilan, XPN va ATX snapshot; erkin matnli dori ham ishlaydi', async () => {
  const r = await doctor.post(`/encounters/${open}/documents`, rx([item(drug.amox, 'Amoxicillin'), item(drug.para, 'Paracetamol'), item(null, 'Na’matak damlamasi')]));
  assert.equal(r.status, 201, r.text);
  const items = (await doctor.get(`/documents/${r.body.data.id}`)).body.data.body.items;
  assert.equal(items[0].prescription_only, true); assert.equal(items[0].inn, 'Amoxicillin'); assert.equal(items[0].atc, 'J01CA04');
  assert.equal(items[1].prescription_only, false);
  assert.equal(items[2].drug_id, null); assert.equal(items[2].prescription_only, false);
});
