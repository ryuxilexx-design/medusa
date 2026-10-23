// Less typing for the doctor (migration 025): note templates per specialty (starter set, CRUD, roles, tenant isolation),
// quick phrases with a usage counter, and the follow-up recommended in a signed note that the doctor books themselves.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS, STARTER_TEMPLATES } = db;
const M = SEED_IDS.membership;
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), put: (p, b) => req('PUT', p, b), patch: (p, b) => req('PATCH', p, b), del: (p) => req('DELETE', p), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}

let manager, doctor, other, registrar, t2, today;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  doctor = session(); await doctor.demo(M.doctor(0));   // Terapevt
  other = session(); await other.demo(M.doctor(1));     // Kardiolog
  registrar = session(); await registrar.demo(M.registrar);
  t2 = session(); await t2.demo(M.tenant2Manager);
  today = (await doctor.get('/me')).body.data.today;
});
after(async () => { await app?.close(); });

const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);

test('boshlang‘ich shablonlar: demo tiklangach ikkala klinikada bor, shifokorga o‘z mutaxassisligi birinchi, kodlar va tekshiruvlar nomi bilan', async () => {
  const r = await doctor.get('/note-templates');
  assert.equal(r.status, 200, r.text);
  const list = r.body.data;
  assert.ok(list.length >= STARTER_TEMPLATES.length, `shablonlar: ${list.length}`);
  assert.equal(r.body.meta.specialty, 'Terapevt');
  const first = list.filter((t) => t.specialty === 'Terapevt');
  assert.equal(first.length, 4, 'terapevt uchun 4 ta boshlang‘ich shablon');
  assert.deepEqual(list.slice(0, 4).map((t) => t.specialty), ['Terapevt', 'Terapevt', 'Terapevt', 'Terapevt'], 'o‘z mutaxassisligi birinchi');
  const ht = list.find((t) => t.name.startsWith('Gipertoniya'));
  assert.ok(ht.starter && !ht.mine && ht.created_by === null);
  assert.deepEqual(ht.icd.map((c) => c.code), ['I10']); assert.ok(ht.icd[0].title, 'kod nomi bilan');
  assert.deepEqual(ht.order_services.map((s) => s.name).sort(), ['Bioximik qon tahlili', 'Elektrokardiografiya (EKG)', 'Lipid profil'].sort(), 'tekshiruvlar katalog kodi bo‘yicha topilgan');
  for (const t of list) for (const f of Object.values(t.fields)) assert.ok(!/[A-Za-z]'[A-Za-z]/.test(f), `oddiy apostrof: ${t.name}`);
  // the second (empty) clinic has the starter set too, but no services to propose
  const l2 = (await t2.get('/note-templates')).body.data;
  assert.equal(l2.length, STARTER_TEMPLATES.length);
  assert.ok(l2.every((t) => t.order_services.length === 0 && !list.some((x) => x.id === t.id)), 'boshqa klinikaning shabloni ko‘rinmaydi');
  // the kardiolog sees the same set, ordered for them
  const l1 = (await other.get('/note-templates')).body.data;
  assert.equal(l1[0].specialty, 'Kardiolog');
});

test('ensureStarterTemplates idempotent: qayta chaqirish nusxa qo‘shmaydi; yangi klinikaga 12 ta kiradi; yashirilgan boshlang‘ich qaytib kelmaydi', async () => {
  assert.equal(await db.ensureStarterTemplates(pool, SEED_IDS.tenant), 0);
  const n0 = (await pool.query(`SELECT count(*)::int AS n FROM note_templates WHERE tenant_id = $1`, [SEED_IDS.tenant])).rows[0].n;
  assert.equal(n0, STARTER_TEMPLATES.length);
  const tid = randomUUID();
  await pool.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Test klinika (shablon)')`, [tid]);
  try {
    assert.equal(await db.ensureStarterTemplates(pool, tid), STARTER_TEMPLATES.length);
    assert.equal(await db.ensureStarterTemplates(pool, tid), 0);
    const rows = (await pool.query(`SELECT starter_key, order_service_ids, icd_codes FROM note_templates WHERE tenant_id = $1`, [tid])).rows;
    assert.equal(rows.length, STARTER_TEMPLATES.length);
    assert.ok(rows.every((r) => r.order_service_ids.length === 0), 'xizmat katalogi yo‘q — taklif qilinadigan tekshiruv yo‘q');
    assert.ok(rows.some((r) => r.icd_codes.includes('I10')));
    await pool.query(`UPDATE note_templates SET active = false WHERE tenant_id = $1 AND starter_key = 'therapist-arvi'`, [tid]);
    assert.equal(await db.ensureStarterTemplates(pool, tid), 0, 'yashirilgan shablon qayta kirmaydi');
  } finally {
    await pool.query(`DELETE FROM note_templates WHERE tenant_id = $1`, [tid]);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tid]);
  }
});

let created;
test('shifokor shablon yaratadi: kodlar va tekshiruvlar server tomonda tekshiriladi; registrator 403; boshqa klinika ko‘rmaydi', async () => {
  const services = (await doctor.get('/services')).body.data;
  const uqt = services.find((s) => s.name.startsWith('Umumiy qon')), cons = services.find((s) => s.category === 'consultation');
  const body = { name: 'Mening O‘RVI shablonim', specialty: 'Terapevt', fields: { complaints: 'Harorat, tomoq og‘rig‘i', diagnosis: 'O‘RVI', recommendations: 'Ko‘p suyuqlik' }, icd_codes: ['J06.9'], order_service_ids: [uqt.id] };
  let r = await doctor.post('/note-templates', { ...body, icd_codes: ['Z99.9'] });
  assert.equal(r.status, 422); assert.ok(r.body.error.fields.icd_codes, r.text);
  r = await doctor.post('/note-templates', { ...body, order_service_ids: [cons.id] });
  assert.equal(r.status, 422); assert.ok(r.body.error.fields.order_service_ids, 'konsultatsiya buyurtma qilinmaydi');
  r = await doctor.post('/note-templates', { name: 'Bo‘sh', fields: {} });
  assert.equal(r.status, 422, 'bo‘sh shablon');
  r = await doctor.post('/note-templates', body);
  assert.equal(r.status, 201, r.text);
  created = r.body.data;
  assert.equal(created.mine, true); assert.equal(created.starter, false);
  assert.equal(created.icd[0].code, 'J06.9'); assert.equal(created.order_services[0].id, uqt.id);
  assert.equal(created.fields.anamnesis ?? null, null, 'to‘ldirilmagan maydon saqlanmaydi');
  const list = (await doctor.get('/note-templates')).body.data;
  assert.ok(list.some((t) => t.id === created.id));
  assert.equal((await registrar.get('/note-templates')).status, 403);
  const c2 = session(); await c2.demo(M.cashier);
  assert.equal((await c2.get('/note-templates')).status, 403);
  assert.ok(!(await t2.get('/note-templates')).body.data.some((t) => t.id === created.id));
  assert.equal((await t2.patch(`/note-templates/${created.id}`, { name: 'x' })).status, 404, 'boshqa klinika — 404');
  assert.equal((await t2.del(`/note-templates/${created.id}`)).status, 404);
  const log = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'note_template.create' AND resource_id = $1`, [created.id])).rows;
  assert.equal(log.length, 1); assert.ok(!log[0].summary.includes('Harorat'), 'audit’da shablon matni yo‘q');
});

test('o‘zgartirish: o‘zi va rahbar — ha, boshqa shifokor — 403; boshlang‘ichni shifokor o‘zgartira olmaydi; o‘chirish = yashirish', async () => {
  assert.equal((await other.patch(`/note-templates/${created.id}`, { name: 'Boshqa' })).status, 403);
  let r = await doctor.patch(`/note-templates/${created.id}`, { name: 'O‘RVI (yangilangan)', specialty: null, icd_codes: ['J06.9', 'J00'] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.name, 'O‘RVI (yangilangan)'); assert.equal(r.body.data.specialty, null); assert.equal(r.body.data.icd.length, 2);
  assert.equal(r.body.data.fields.complaints, 'Harorat, tomoq og‘rig‘i', 'berilmagan maydonlar o‘zgarmaydi');
  r = await manager.patch(`/note-templates/${created.id}`, { sort: 5 });
  assert.equal(r.status, 200);
  const starter = (await doctor.get('/note-templates')).body.data.find((t) => t.starter);
  assert.equal((await doctor.patch(`/note-templates/${starter.id}`, { name: 'x' })).status, 403, 'boshlang‘ich shablonni shifokor o‘zgartira olmaydi');
  assert.equal((await manager.patch(`/note-templates/${starter.id}`, { sort: 1 })).status, 200, 'rahbar — o‘zgartiradi');
  assert.equal((await other.del(`/note-templates/${created.id}`)).status, 403);
  r = await doctor.del(`/note-templates/${created.id}`);
  assert.equal(r.status, 200);
  assert.ok(!(await doctor.get('/note-templates')).body.data.some((t) => t.id === created.id), 'ro‘yxatdan chiqdi');
  const row = (await pool.query(`SELECT active FROM note_templates WHERE id = $1`, [created.id])).rows[0];
  assert.equal(row.active, false, 'qator qoladi, active=false');
  assert.equal((await doctor.patch(`/note-templates/${randomUUID()}`, { name: 'x' })).status, 404);
});

test('tez iboralar: takror matn bitta qator; «use» hisoblagichi tartibni belgilaydi; boshqa shifokor ko‘rmaydi; rahbar umumiy ibora qo‘shadi; registrator 403', async () => {
  let r = await doctor.post('/quick-phrases', { field: 'examination', text: 'Umumiy ahvoli qoniqarli.' });
  assert.equal(r.status, 201, r.text);
  const a = r.body.data; assert.equal(a.uses, 0); assert.equal(a.shared, false);
  r = await doctor.post('/quick-phrases', { field: 'examination', text: 'Umumiy ahvoli qoniqarli.' });
  assert.equal(r.body.data.id, a.id, 'bir xil matn — bir qator');
  const b = (await doctor.post('/quick-phrases', { field: 'examination', text: 'O‘pkada vezikulyar nafas.' })).body.data;
  assert.equal((await doctor.post(`/quick-phrases/${b.id}/use`)).body.data.uses, 1);
  assert.equal((await doctor.post(`/quick-phrases/${b.id}/use`)).body.data.uses, 2);
  const list = (await doctor.get('/quick-phrases?field=examination')).body.data;
  assert.deepEqual(list.map((p) => p.id), [b.id, a.id], 'ko‘p ishlatilgani birinchi');
  assert.equal((await doctor.get('/quick-phrases?field=complaints')).body.data.length, 0);
  assert.equal((await other.get('/quick-phrases?field=examination')).body.data.length, 0, 'boshqa shifokorning iboralari ko‘rinmaydi');
  assert.equal((await other.post(`/quick-phrases/${a.id}/use`)).status, 404);
  assert.equal((await other.del(`/quick-phrases/${a.id}`)).status, 403);
  assert.equal((await doctor.post('/quick-phrases', { field: 'examination', text: 'Umumiy', shared: true })).status, 403, 'umumiy iborani faqat rahbar');
  const sh = (await manager.post('/quick-phrases', { field: 'recommendations', text: 'Qayta ko‘rik — 1 haftadan keyin.' })).body.data;
  assert.equal(sh.shared, true);
  assert.ok((await other.get('/quick-phrases?field=recommendations')).body.data.some((p) => p.id === sh.id), 'umumiy ibora hammaga');
  assert.equal((await registrar.get('/quick-phrases')).status, 403);
  assert.equal((await doctor.post('/quick-phrases', { field: 'vitals', text: 'x' })).status, 422);
  assert.equal((await doctor.post('/quick-phrases', { field: 'diagnosis', text: '' })).status, 422);
  assert.equal((await doctor.del(`/quick-phrases/${a.id}`)).status, 200);
  assert.equal((await doctor.get('/quick-phrases?field=examination')).body.data.length, 1);
});

test('qayta qabul: tasdiqlashda sana → bemor kartasida follow_up.booked=false → shifokor o‘zi band qiladi (source=doctor) → true; boshqa shifokorga yozolmaydi', async () => {
  const appts = (await doctor.get(`/appointments?date=${today}`)).body.data;
  const open = appts.find((a) => a.status === 'in_progress' && a.encounter_id);
  assert.ok(open, 'seed’da davom etayotgan qabul bor');
  const enc = (await doctor.get(`/encounters/${open.encounter_id}`)).body.data;
  // the first working day with a free slot in the next two weeks
  const myServices = (await doctor.get('/services')).body.data;
  const me = (await doctor.get('/me')).body.data;
  const docs = (await doctor.get('/doctors')).body.data;
  const self = docs.find((d) => d.id === me.doctor_id);
  const svc = myServices.find((s) => self.service_ids.includes(s.id) && /qayta/i.test(s.name)) ?? myServices.find((s) => self.service_ids.includes(s.id) && s.category === 'consultation');
  assert.ok(svc, 'shifokorning qayta ko‘rik xizmati');
  let date, slot, branch;
  for (let i = 3; i < 17 && !slot; i++) {
    const d = addDays(today, i);
    const av = (await doctor.get(`/availability?doctor_id=${me.doctor_id}&date=${d}&service_id=${svc.id}`)).body.data;
    const free = av.working && av.slots.find((s) => s.free && !s.past);
    if (free) { date = d; slot = free.time; branch = av.branch_id; }
  }
  assert.ok(slot, 'bo‘sh vaqt topildi');
  const signBody = { version: enc.note.version, complaints: enc.note.complaints || 'Bosh og‘rig‘i', anamnesis: enc.note.anamnesis ?? null, examination: enc.note.examination || 'Umumiy ahvoli qoniqarli',
    diagnosis: enc.note.diagnosis || 'Kuzatuv', recommendations: enc.note.recommendations || 'Qayta ko‘rik', follow_up_date: date, vitals: {} };
  const signed = await doctor.post(`/encounters/${open.encounter_id}/sign`, signBody);
  assert.equal(signed.status, 200, signed.text);
  // a booking the patient already has with this doctor after the visit counts as the follow-up: clear the seed's ones first
  for (const a of (await registrar.get(`/appointments?patient_id=${open.patient_id}&status=scheduled`)).body.data.filter((a) => a.doctor_id === me.doctor_id))
    assert.equal((await registrar.post(`/appointments/${a.id}/cancel`, { version: a.version, reason: 'test' })).status, 200);

  let card = (await registrar.get(`/patients/${open.patient_id}`)).body.data;
  assert.ok(card.follow_up, 'registrator belgini ko‘radi');
  assert.equal(card.follow_up.date, date); assert.equal(card.follow_up.booked, false); assert.equal(card.follow_up.doctor_id, me.doctor_id);
  assert.ok(card.follow_up.doctor_name && !('complaints' in card.follow_up), 'klinik matn yo‘q');
  // the doctor sees it on the patient card too; the cashier's minimal card has no such field
  assert.equal((await doctor.get(`/patients/${open.patient_id}`)).body.data.follow_up.booked, false);
  const cashier = session(); await cashier.demo(M.cashier);
  assert.equal((await cashier.get(`/patients/${open.patient_id}`)).body.data.follow_up, undefined);

  // the doctor may book only their own follow-up
  const otherDoc = docs.find((d) => d.id !== me.doctor_id);
  const wrong = await doctor.post('/appointments', { patient_id: open.patient_id, branch_id: branch, doctor_id: otherDoc.id, service_id: svc.id, date, start_time: slot }, { 'Idempotency-Key': randomUUID() });
  assert.equal(wrong.status, 403, wrong.text);
  // …and only for a patient they have already seen (a signed note): a booking must never be what grants access
  const stranger = (await pool.query(
    `SELECT p.id FROM patients p WHERE p.tenant_id = (SELECT tenant_id FROM doctors WHERE id = $1)
        AND NOT EXISTS (SELECT 1 FROM encounters e JOIN clinical_notes n ON n.encounter_id = e.id WHERE e.patient_id = p.id AND e.doctor_id = $1 AND n.status = 'signed')
      LIMIT 1`, [me.doctor_id])).rows[0];
  const unseen = await doctor.post('/appointments', { patient_id: stranger.id, branch_id: branch, doctor_id: me.doctor_id, service_id: svc.id, date, start_time: slot }, { 'Idempotency-Key': randomUUID() });
  assert.equal(unseen.status, 403, unseen.text);
  const book = await doctor.post('/appointments', { patient_id: open.patient_id, branch_id: branch, doctor_id: me.doctor_id, service_id: svc.id, date, start_time: slot }, { 'Idempotency-Key': randomUUID() });
  assert.equal(book.status, 201, book.text);
  const appt = (await registrar.get(`/appointments/${book.body.data.id}`)).body.data;
  assert.equal(appt.source, 'doctor', 'jadvalda manba: shifokor');
  assert.equal(appt.status, 'scheduled'); assert.equal(appt.service_id, svc.id);
  card = (await registrar.get(`/patients/${open.patient_id}`)).body.data;
  assert.equal(card.follow_up.booked, true); assert.equal(card.follow_up.appointment_id, appt.id);
  const log = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'appointment.create' AND resource_id = $1`, [appt.id])).rows[0];
  assert.match(log.summary, /shifokor/);
  // the same rules as every booking: the taken slot is refused
  const dup = await doctor.post('/appointments', { patient_id: open.patient_id, branch_id: branch, doctor_id: me.doctor_id, service_id: svc.id, date, start_time: slot }, { 'Idempotency-Key': randomUUID() });
  assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'SLOT_TAKEN');
  // cancelled by reception → the marker is open again
  assert.equal((await registrar.post(`/appointments/${appt.id}/cancel`, { version: appt.version, reason: 'test' })).status, 200);
  assert.equal((await registrar.get(`/patients/${open.patient_id}`)).body.data.follow_up.booked, false);
});
