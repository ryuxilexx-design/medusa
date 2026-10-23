// Data-subject rights (ZRU-547): printable card per role, sealed JSON export (manager, audited, rate-limited),
// anonymisation (blocked by debt / deposit / future visit; irreversible; medical record stays; bot and search lose the card).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool, erasure;

function session() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, headers: r.headers };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), patch: (p, b) => req('PATCH', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const as = async (mid) => { const s = session(); assert.equal((await s.demo(mid)).status, 200); return s; };

let manager, registrar, cashier, doctor, otherDoctor, t2;
let victim, debtor, futureOnly, t2patient;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  erasure = require('../dist/modules/erasure.js');
  manager = await as(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  await db.assertDatabaseName(pool, '_test');
  await pool.query(`DELETE FROM telegram_chats`); // chats survive resets; start from unlinked phones (test database only)
  registrar = await as(M.registrar); cashier = await as(M.cashier); doctor = await as(M.doctor(0)); otherDoctor = await as(M.doctor(1)); t2 = await as(M.tenant2Manager);
  // a patient of doctor 0 with a signed note, a phone, a granted consent, no debt and nothing booked ahead
  victim = (await pool.query(
    `SELECT p.* FROM patients p WHERE p.tenant_id = $1 AND p.phone IS NOT NULL
        AND EXISTS (SELECT 1 FROM appointments a JOIN encounters e ON e.appointment_id = a.id JOIN clinical_notes n ON n.encounter_id = e.id WHERE a.patient_id = p.id AND a.doctor_id = $2 AND n.status = 'signed')
        AND EXISTS (SELECT 1 FROM patient_consents c WHERE c.patient_id = p.id AND c.kind = 'data_processing' AND c.granted)
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.patient_id = p.id AND i.status IN ('unpaid','partially_paid'))
        AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.status IN ('scheduled','arrived','in_progress') AND a.ends_at > demo_now())
        AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.doctor_id = $3)
      ORDER BY p.patient_number LIMIT 1`, [SEED_IDS.tenant, SEED_IDS.doctor(0), SEED_IDS.doctor(1)])).rows[0];
  assert.ok(victim, 'seed: a suitable patient exists');
  debtor = (await pool.query(`SELECT p.* FROM patients p WHERE p.tenant_id = $1 AND EXISTS (SELECT 1 FROM invoices i WHERE i.patient_id = p.id AND i.status IN ('unpaid','partially_paid')) ORDER BY p.patient_number LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  futureOnly = (await pool.query(
    `SELECT p.* FROM patients p WHERE p.tenant_id = $1
        AND EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.status IN ('scheduled','arrived','in_progress') AND a.ends_at > demo_now())
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.patient_id = p.id AND i.status IN ('unpaid','partially_paid'))
        AND NOT EXISTS (SELECT 1 FROM patient_deposits d WHERE d.patient_id = p.id) ORDER BY p.patient_number LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  t2patient = (await pool.query(`SELECT id FROM patients WHERE tenant_id = $1 ORDER BY patient_number LIMIT 1`, [SEED_IDS.tenant2])).rows[0];
  assert.ok(debtor && futureOnly && t2patient);
});
after(async () => { await app?.close(); });

// ---------------------------------------------------------------- card

test('karta: rahbar — kontaktlar, roziliklar, hisoblar; klinik matn va tashxis yo‘q', async () => {
  const r = await manager.get(`/patients/${victim.id}/card`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const c = r.body.data;
  assert.equal(c.patient.phone, victim.phone);
  assert.ok('erasure_reason' in c.patient, 'rahbar sababni ko‘radi (hozircha null)');
  assert.equal(c.patient.allergy_state, undefined, 'allergiya — klinik, faqat shifokorga');
  assert.ok(Array.isArray(c.consents) && c.consents.length >= 1);
  assert.ok(c.consents.every((x) => x.text_version && x.recorded_at && !('note' in x)), 'rozilik izohi chop etilmaydi');
  assert.ok(c.visits.length >= 1);
  assert.ok(c.visits.every((v) => v.diagnosis === undefined && v.icd10 === undefined && v.doctor_name && v.service_name), 'tashxis yo‘q');
  assert.ok(c.invoices && typeof c.invoices.summary.count === 'number' && Array.isArray(c.invoices.list));
  assert.equal(Number(c.invoices.summary.due), 0);
});

test('karta: registrator — sababsiz, hisoblar bor; shifokor — allergiya va MKB-10 tashxis, hisoblar yo‘q; begona shifokor 403; kassir 403; boshqa klinika 404', async () => {
  const reg = (await registrar.get(`/patients/${victim.id}/card`)).body.data;
  assert.equal('erasure_reason' in reg.patient, false);
  assert.ok(reg.invoices);
  assert.equal(reg.visits[0].icd10, undefined);

  const r = await doctor.get(`/patients/${victim.id}/card`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const doc = r.body.data;
  assert.ok(['known', 'denied', 'unknown'].includes(doc.patient.allergy_state));
  assert.equal(doc.invoices, null, 'shifokor pulni ko‘rmaydi');
  const signed = doc.visits.find((v) => v.diagnosis || (v.icd10 && v.icd10.length));
  assert.ok(signed, 'imzolangan qabulda tashxis bor');
  assert.ok(doc.visits.every((v) => Array.isArray(v.icd10)));
  for (const v of doc.visits) for (const code of v.icd10) assert.ok(code.code && code.title, 'MKB-10 kodi va nomi');

  assert.equal((await otherDoctor.get(`/patients/${victim.id}/card`)).status, 403);
  assert.equal((await cashier.get(`/patients/${victim.id}/card`)).status, 403);
  assert.equal((await t2.get(`/patients/${victim.id}/card`)).status, 404);
  assert.equal((await manager.get(`/patients/${t2patient.id}/card`)).status, 404);
});

// ---------------------------------------------------------------- export

test('eksport: faqat rahbar; fayl sifatida; klinik bo‘limlar bor, laboratoriya faqat tasdiqlangan; audit yozuvi; boshqa klinika 404', async () => {
  erasure.resetExportSlots();
  for (const s of [registrar, cashier, doctor]) assert.equal((await s.get(`/patients/${victim.id}/export.json`)).status, 403);
  assert.equal((await t2.get(`/patients/${victim.id}/export.json`)).status, 404);
  const r = await manager.get(`/patients/${victim.id}/export.json`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.headers.get('content-disposition'), new RegExp(`attachment; filename="med-uz-ai-patient-${victim.patient_number}\\.json"`));
  const x = r.body;
  assert.equal(x.format, 'med.uz.ai/patient-export');
  assert.match(x.purpose, /so‘rovi bo‘yicha/);
  assert.equal(x.patient.id, victim.id);
  assert.equal(x.exported_by.role, 'manager');
  for (const k of ['consents', 'appointments', 'clinical_notes', 'documents', 'lab_results', 'diagnostic_reports', 'invoices', 'deposits', 'camera_events', 'notices', 'intake_forms']) assert.ok(Array.isArray(x[k]), k);
  assert.ok(x.clinical_notes.length >= 1 && x.clinical_notes.every((n) => n.signed_at && Array.isArray(n.addenda) && Array.isArray(n.icd10)));
  assert.ok(x.lab_results.every((l) => l.verified_at), 'faqat tasdiqlangan natijalar');
  assert.ok(x.notices.every((n) => Object.keys(n).sort().join() === 'channel,created_at,kind,sent_at,status'), 'xabarnoma: faqat tur/kanal/holat/vaqt');
  assert.ok(x.camera_events.every((e) => !('similarity' in e) && !('face_code_id' in e)));
  assert.ok(x.invoices.every((i) => Array.isArray(i.items) && Array.isArray(i.payments) && Array.isArray(i.refunds)));
  const a = (await pool.query(`SELECT summary, actor_role FROM audit_logs WHERE action = 'patient.export' AND resource_id = $1`, [victim.id])).rows;
  assert.equal(a.length, 1);
  assert.equal(a[0].actor_role, 'manager');
  assert.ok(!a[0].summary.includes(victim.last_name), 'audit izohida ism yo‘q');
});

test('eksport: klinika uchun daqiqada 5 ta; 6-chi 429; boshqa klinika hisobi alohida', async () => {
  erasure.resetExportSlots();
  const rs = [];
  for (let i = 0; i < 6; i++) rs.push((await manager.get(`/patients/${victim.id}/export.json`)).status);
  assert.deepEqual(rs, [200, 200, 200, 200, 200, 429]);
  const r = await manager.get(`/patients/${victim.id}/export.json`);
  assert.equal(r.status, 429); assert.equal(r.body.error.code, 'EXPORT_RATE_LIMIT');
  assert.equal((await t2.get(`/patients/${t2patient.id}/export.json`)).status, 200, 'ikkinchi klinika chegaraga tegmagan');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'patient.export' AND resource_id = $1`, [victim.id])).rows[0].n, 6, 'rad etilgan so‘rov audit qilinmaydi');
  erasure.resetExportSlots();
});

// ---------------------------------------------------------------- anonymisation: refusals

test('anonimlashtirish: registrator 403; sababsiz 422; qarz bilan 409 va tafsilot; kelgusi qabul bilan 409; boshqa klinika 404', async () => {
  assert.equal((await registrar.post(`/patients/${victim.id}/anonymise`, { reason: 'bemor arizasi' })).status, 403);
  const v = await manager.post(`/patients/${victim.id}/anonymise`, {});
  assert.equal(v.status, 422); assert.ok(v.body.error.fields.reason);
  const d = await manager.post(`/patients/${debtor.id}/anonymise`, { reason: 'bemor arizasi 23.10.2026' });
  assert.equal(d.status, 409, JSON.stringify(d.body)); assert.equal(d.body.error.code, 'ERASURE_BLOCKED');
  assert.ok(Number(d.body.error.details.debt) > 0);
  const f = await manager.post(`/patients/${futureOnly.id}/anonymise`, { reason: 'bemor arizasi 23.10.2026' });
  assert.equal(f.status, 409); assert.equal(f.body.error.code, 'ERASURE_BLOCKED');
  assert.equal(Number(f.body.error.details.debt), 0);
  assert.ok(f.body.error.details.future_appointments.length >= 1 && f.body.error.details.future_appointments[0].starts_at);
  assert.equal((await manager.post(`/patients/${t2patient.id}/anonymise`, { reason: 'bemor arizasi' })).status, 404);
  for (const p of [debtor, futureOnly]) assert.equal((await pool.query(`SELECT anonymised_at FROM patients WHERE id = $1`, [p.id])).rows[0].anonymised_at, null);
});

// ---------------------------------------------------------------- anonymisation: success

test('anonimlashtirish: karta anonim, qidiruv topmaydi, bot ko‘rmaydi, qaydlar shifokorga qoladi, o‘zgarmas yozuvlar tegilmaydi, qaytarib bo‘lmaydi', async () => {
  const id = victim.id;
  // the person's bot chat sees the card before (one card → straight to the services list)
  const chat = (await manager.post('/telegram/sim/chats')).body.data.chat_id;
  await manager.post('/telegram/sim/send', { chat_id: chat, text: '/start' });
  await manager.post('/telegram/sim/send', { chat_id: chat, contact_phone: victim.phone });
  await manager.post('/telegram/sim/send', { chat_id: chat, text: '📅 Qabulga yozilish' });
  let outs = (await manager.get(`/telegram/sim/messages?chat_id=${chat}`)).body.data.filter((m) => m.direction === 'out');
  assert.ok(!outs.at(-1).text.includes('Familiyani yozing'), 'oldin: karta topildi, ro‘yxatdan o‘tish so‘ralmaydi');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM telegram_chats WHERE phone = $1`, [victim.phone])).rows[0].n, 1);

  const before = {
    notes: (await pool.query(`SELECT n.id, n.diagnosis, n.version, n.saved_at, n.signed_at FROM clinical_notes n JOIN encounters e ON e.id = n.encounter_id WHERE e.patient_id = $1 ORDER BY n.id`, [id])).rows,
    payments: (await pool.query(`SELECT count(*)::int AS n, coalesce(sum(p.amount),0)::bigint AS sum FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.patient_id = $1`, [id])).rows[0],
    appts: (await pool.query(`SELECT count(*)::int AS n FROM appointments WHERE patient_id = $1`, [id])).rows[0].n,
    consents: (await pool.query(`SELECT count(*)::int AS n FROM patient_consents WHERE patient_id = $1`, [id])).rows[0].n,
    history: (await doctor.get(`/patients/${id}/history`)).body.data,
  };
  assert.ok(before.notes.length >= 1 && before.history.notes.length >= 1);

  const r = await manager.post(`/patients/${id}/anonymise`, { reason: 'Bemorning yozma arizasi, 23.10.2026', method: 'signed_paper' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.patient_number, victim.patient_number);

  const p = (await pool.query(`SELECT * FROM patients WHERE id = $1`, [id])).rows[0];
  assert.equal(p.last_name, 'Anonim bemor'); assert.equal(p.first_name, `#${victim.patient_number}`); assert.equal(p.middle_name, null);
  assert.equal(p.phone, null); assert.equal(p.contact_phone, null); assert.equal(p.contact_name, null); assert.equal(p.address, null); assert.equal(p.note, null);
  assert.equal(String(p.birth_date instanceof Date ? p.birth_date.toISOString() : p.birth_date).slice(0, 10), '1900-01-01'); assert.equal(p.sex, 'unspecified');
  assert.ok(p.anonymised_at); assert.equal(p.erasure_reason, 'Bemorning yozma arizasi, 23.10.2026');

  // search: the name and the phone find nothing; the number still opens the record
  const byName = (await registrar.get(`/patients?search=${encodeURIComponent(victim.last_name)}`)).body.data;
  assert.ok(!byName.some((x) => x.id === id), 'ism bilan topilmaydi');
  assert.ok(!(await registrar.get(`/patients?search=${encodeURIComponent('Anonim')}`)).body.data.some((x) => x.id === id), '«Anonim» so‘zi bilan ham topilmaydi');
  assert.ok(!(await registrar.get(`/patients?search=${encodeURIComponent(victim.phone)}`)).body.data.some((x) => x.id === id), 'telefon bilan topilmaydi');
  const byNumber = (await registrar.get(`/patients?search=${victim.patient_number}`)).body.data.find((x) => x.id === id);
  assert.ok(byNumber && byNumber.anonymised_at, 'raqam bilan topiladi va belgilangan');
  const card = (await manager.get(`/patients/${id}`)).body.data;
  assert.ok(card.anonymised_at); assert.equal(card.phone, null); assert.equal(card.telegram_linked, false);
  assert.equal(card.consents.data_processing.granted, false, 'rozilik qaytarib olingan (yangi qator)');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patient_consents WHERE patient_id = $1`, [id])).rows[0].n, before.consents + 1, 'eski rozilik dalili saqlanadi');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM face_codes WHERE patient_id = $1 AND revoked_at IS NULL`, [id])).rows[0].n, 0);

  // bot: the chat verified with that number is unlinked; the number no longer leads to the card
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM telegram_chats WHERE phone = $1`, [victim.phone])).rows[0].n, 0, 'Telegram ulanishi o‘chirildi');
  const chat2 = (await manager.post('/telegram/sim/chats')).body.data.chat_id;
  await manager.post('/telegram/sim/send', { chat_id: chat2, text: '/start' });
  await manager.post('/telegram/sim/send', { chat_id: chat2, contact_phone: victim.phone });
  await manager.post('/telegram/sim/send', { chat_id: chat2, text: '📅 Qabulga yozilish' });
  outs = (await manager.get(`/telegram/sim/messages?chat_id=${chat2}`)).body.data.filter((m) => m.direction === 'out');
  assert.ok(outs.at(-1).text.includes('Familiyani yozing'), `keyin: bot kartani ko‘rmaydi, yangi ro‘yxat so‘raydi: ${outs.at(-1).text}`);
  const { OWN_CARD_SQL } = require('../dist/telegram/outbox.js');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patients p WHERE p.id = $1 AND ${OWN_CARD_SQL('$2')}`, [id, victim.phone])).rows[0].n, 0);

  // the medical record: still readable by the treating doctor, under the anonymous name, byte for byte the same
  const after = (await doctor.get(`/patients/${id}/history`)).body.data;
  assert.equal(after.notes.length, before.history.notes.length);
  assert.deepEqual(after.notes.map((n) => [n.id, n.diagnosis, n.signed_at]), before.history.notes.map((n) => [n.id, n.diagnosis, n.signed_at]));
  const docCard = (await doctor.get(`/patients/${id}`)).body.data;
  assert.equal(docCard.last_name, 'Anonim bemor'); assert.ok(docCard.anonymised_at);
  const notesNow = (await pool.query(`SELECT n.id, n.diagnosis, n.version, n.saved_at, n.signed_at FROM clinical_notes n JOIN encounters e ON e.id = n.encounter_id WHERE e.patient_id = $1 ORDER BY n.id`, [id])).rows;
  assert.deepEqual(notesNow, before.notes, 'imzolangan qaydlar o‘zgarmagan');
  assert.deepEqual((await pool.query(`SELECT count(*)::int AS n, coalesce(sum(p.amount),0)::bigint AS sum FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.patient_id = $1`, [id])).rows[0], before.payments);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM appointments WHERE patient_id = $1`, [id])).rows[0].n, before.appts, 'o‘tgan qabullar qoladi');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE patient_id = $1 AND status = 'pending'`, [id])).rows[0].n, 0);

  // the printable card and the export now carry the anonymous identity
  const printed = (await manager.get(`/patients/${id}/card`)).body.data;
  assert.equal(printed.patient.last_name, 'Anonim bemor'); assert.ok(printed.patient.anonymised_at); assert.equal(printed.patient.erasure_reason, 'Bemorning yozma arizasi, 23.10.2026');
  erasure.resetExportSlots();
  const x = (await manager.get(`/patients/${id}/export.json`)).body;
  assert.equal(x.patient.phone, null); assert.equal(x.patient.last_name, 'Anonim bemor');

  // closed for new processing: booking 422, identity edits 409, new consent 409, second anonymisation 409, DB refuses a restore
  const docs = (await registrar.get('/doctors')).body.data;
  const d0 = docs.find((d) => d.service_ids?.length);
  const b = await registrar.post('/appointments', { patient_id: id, branch_id: SEED_IDS.branchCentral, doctor_id: d0.id, service_id: d0.service_ids[0], date: '2026-10-20', start_time: '10:00' }, { 'Idempotency-Key': randomUUID() });
  assert.equal(b.status, 422, JSON.stringify(b.body)); assert.ok(b.body.error.fields.patient_id);
  const u = await registrar.patch(`/patients/${id}`, { last_name: 'Karimov' });
  assert.equal(u.status, 409); assert.equal(u.body.error.code, 'PATIENT_ANONYMISED');
  assert.equal((await doctor.patch(`/patients/${id}`, { allergy_state: 'denied', allergy_note: null })).status, 200, 'shifokorning allergiya qaydi — tibbiy yozuv, o‘zgartiriladi');
  assert.equal((await manager.post(`/patients/${id}/consents`, { kind: 'data_processing', granted: true, method: 'verbal' })).status, 409);
  const again = await manager.post(`/patients/${id}/anonymise`, { reason: 'ikkinchi marta' });
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'ALREADY_ANONYMISED');
  await assert.rejects(pool.query(`UPDATE patients SET anonymised_at = NULL, erasure_reason = NULL WHERE id = $1`, [id]), /cannot be restored/);
  await assert.rejects(pool.query(`UPDATE patients SET last_name = 'Karimov' WHERE id = $1`, [id]), /no identifying data/);
  await assert.rejects(pool.query(`UPDATE patients SET phone = '+998901234567' WHERE id = $1`, [id]), /no identifying data/);

  const a = (await pool.query(`SELECT summary, actor_name FROM audit_logs WHERE action = 'patient.anonymise' AND resource_id = $1`, [id])).rows;
  assert.equal(a.length, 1);
  assert.ok(a[0].summary.includes(`#${victim.patient_number}`) && !a[0].summary.includes(victim.last_name) && !a[0].summary.includes(victim.phone));
});
