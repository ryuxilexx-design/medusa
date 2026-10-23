// Digital Health Platform (DMED) integration layer (migration 029): FHIR R4 mappers, outbox rows on sign / verify /
// prescription only when the clinic's mode is on, export mode (ready + bounded NDJSON download, audited, manager only),
// live mode against a fake FHIR endpoint (200 sent, 401/400 failed, 503 retried), token write-only, PINFL validation
// and uniqueness, erasure strips the payload, tenant isolation. Never a real DMED / UZINFOCOM endpoint.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
const { config } = require('../dist/core/config.js');
config.secretKey ||= Buffer.alloc(32, 9).toString('base64');
const fhir = require('../dist/dhp/fhir.js');
const { runDhpWorker } = require('../dist/dhp/worker.js');
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t, headers: r.headers };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}) => req('POST', p, b), put: (p, b) => req('PUT', p, b), patch: (p, b) => req('PATCH', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const as = async (mid) => { const s = session(); assert.equal((await s.demo(mid)).status, 200); return s; };

// fake FHIR endpoint: answers with the next queued status (default 200) and records what it got
let fake, fakeUrl; const replies = []; const received = [];
function startFake() {
  return new Promise((resolve) => {
    fake = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push({ auth: req.headers.authorization, type: req.headers['content-type'], body: JSON.parse(body) });
        const status = replies.shift() ?? 200;
        res.writeHead(status, { 'content-type': 'application/fhir+json' });
        res.end(JSON.stringify(status < 300 ? { resourceType: 'Bundle', type: 'transaction-response', entry: [] }
          : { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid', diagnostics: `fake ${status}` }] }));
      });
    }).listen(0, '127.0.0.1', () => { fakeUrl = `http://127.0.0.1:${fake.address().port}/fhir`; resolve(); });
  });
}

let manager, registrar, doctor, lab, t2manager, today, open, openPatient;
const TOKEN = 'dhp-test-token-very-secret-123';
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  await startFake();
  manager = await as(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  registrar = await as(M.registrar); doctor = await as(M.doctor(0)); lab = await as(M.lab); t2manager = await as(M.tenant2Manager);
  today = (await doctor.get('/me')).body.data.today;
  const appts = (await doctor.get(`/appointments?date=${today}`)).body.data;
  const a = appts.find((x) => x.status === 'in_progress' && x.encounter_id);
  open = a.encounter_id; openPatient = a.patient_id;
  assert.ok(open && openPatient, 'seed’da davom etayotgan qabul bor');
});
after(async () => { await app?.close(); fake?.close(); });

const outbox = async (where = 'TRUE', params = []) => (await pool.query(`SELECT * FROM dhp_outbox WHERE tenant_id = $1 AND ${where} ORDER BY created_at, id`, [SEED_IDS.tenant, ...params])).rows;
const prescription = { kind: 'prescription', body: { items: [{ name: 'Amlodipin', form: 'tabletka', dose: '5 mg', frequency: 'kuniga 1 marta', duration: '30 kun', instructions: 'ovqatdan keyin' }] } };

// ------------------------------------------------------------------ mappers

const P = { id: '11111111-1111-4111-8111-111111111111', last_name: 'Karimov', first_name: 'Aziz', middle_name: 'Bahodirovich', birth_date: '1980-05-12', sex: 'male', phone: '+998901234567', pinfl: '31205800123456', id_document: 'AA1234567' };
const D = { id: '22222222-2222-4222-8222-222222222222', display_name: 'Dr. Rustamova', specialty: 'Kardiolog' };
const E = '33333333-3333-4333-8333-333333333333';

test('mapper: Patient — PINFL identifier (tizim, NI turi), ism, jins, tug‘ilgan sana, telefon', () => {
  const p = fhir.patientResource(P);
  assert.equal(p.resourceType, 'Patient');
  const pin = p.identifier.find((i) => i.system === fhir.PINFL_SYSTEM);
  assert.equal(pin.value, P.pinfl); assert.equal(pin.type.coding[0].code, 'NI');
  assert.ok(p.identifier.some((i) => i.system === fhir.ID_DOCUMENT_SYSTEM && i.value === 'AA1234567'));
  assert.ok(p.identifier.some((i) => i.value === P.id), 'o‘z identifikatorimiz ham bor');
  assert.equal(p.name[0].family, 'Karimov'); assert.deepEqual(p.name[0].given, ['Aziz', 'Bahodirovich']);
  assert.equal(p.gender, 'male'); assert.equal(p.birthDate, '1980-05-12');
  assert.equal(p.telecom[0].value, '+998901234567');
  const anon = fhir.patientResource({ ...P, pinfl: null, id_document: null, phone: null, sex: 'unspecified', middle_name: null });
  assert.equal(anon.gender, 'unknown'); assert.equal(anon.telecom, undefined);
  assert.ok(!anon.identifier.some((i) => i.system === fhir.PINFL_SYSTEM));
});

test('mapper: Encounter + Condition (ICD-10 tizimi) + Practitioner → tranzaksiya Bundle', () => {
  const icd = [{ code: 'I10', name: 'Essensial gipertenziya' }, { code: 'E11.9', name: null }];
  const enc = fhir.encounterResource({ id: E, started_at: '2026-10-18T05:00:00Z', closed_at: '2026-10-18T05:30:00Z', service_name: 'Kardiolog qabuli', clinic_name: 'Demo klinika' }, P.id, D.id, icd);
  assert.equal(enc.resourceType, 'Encounter'); assert.equal(enc.status, 'finished'); assert.equal(enc.class.code, 'AMB');
  assert.equal(enc.diagnosis.length, 2);
  const conds = icd.map((c) => fhir.conditionResource(E, c, P.id, D.id, '2026-10-18T05:30:00Z'));
  assert.equal(conds[0].code.coding[0].system, 'http://hl7.org/fhir/sid/icd-10');
  assert.equal(conds[0].code.coding[0].code, 'I10');
  assert.equal(enc.diagnosis[0].condition.reference, `urn:uuid:${conds[0].identifier[0].value}`, 'Encounter tashxisi Condition’ga bog‘langan');
  assert.throws(() => fhir.conditionResource(E, { code: 'bad' }, P.id, D.id, '2026-10-18T05:30:00Z'), 'noto‘g‘ri MKB-10 kodi o‘tmaydi');
  const b = fhir.makeBundle([
    { id: P.id, resource: fhir.patientResource(P) }, { id: D.id, resource: fhir.practitionerResource(D) }, { id: E, resource: enc },
    ...conds.map((c) => ({ id: c.identifier[0].value, resource: c })),
  ], { kind: 'encounter', at: '2026-10-18T05:30:00Z' });
  assert.equal(b.resourceType, 'Bundle'); assert.equal(b.type, 'transaction'); assert.equal(b.entry.length, 5);
  for (const e of b.entry) { assert.match(e.fullUrl, /^urn:uuid:/); assert.equal(e.request.method, 'POST'); assert.ok(e.request.ifNoneExist); }
  assert.ok(b.entry[0].request.ifNoneExist.startsWith(`identifier=${fhir.PINFL_SYSTEM}|`), 'bemor PINFL bo‘yicha topiladi');
  assert.ok(fhir.bundleHasPinfl(b));
  const json = JSON.stringify(b);
  assert.ok(!json.includes('complaints') && !json.includes('examination'), 'shikoyat/ko‘rik matni yo‘q');
  assert.throws(() => fhir.validateBundle({ ...b, type: 'collection' }));
  assert.throws(() => fhir.validateBundle({ ...b, entry: [b.entry[0], { ...b.entry[2], resource: { ...b.entry[2].resource, status: undefined } }] }), 'Encounter.status majburiy');
});

test('mapper: Observation (birlik, me’yor, H/L), MedicationRequest (dori nomi, doza), DocumentReference (qo‘shimcha)', () => {
  const o = fhir.observationResource('44444444-4444-4444-8444-444444444444', { code: 'HGB', name: 'Gemoglobin', unit: 'g/l', ref_low: 120, ref_high: 160, value: '118', flag: 'low' }, P.id, null, { collected_at: '2026-10-18T04:00:00Z', verified_at: '2026-10-18T06:00:00Z' });
  assert.equal(o.resourceType, 'Observation'); assert.equal(o.status, 'final');
  assert.equal(o.category[0].coding[0].code, 'laboratory');
  assert.deepEqual(o.valueQuantity, { value: 118, unit: 'g/l' });
  assert.equal(o.referenceRange[0].low.value, 120); assert.equal(o.referenceRange[0].high.value, 160);
  assert.equal(o.interpretation[0].coding[0].code, 'L');
  const m = fhir.medicationRequestResource('55555555-5555-4555-8555-555555555555', 17, 0, prescription.body.items[0], P.id, E, D.id, '2026-10-18T05:20:00Z', false);
  assert.equal(m.resourceType, 'MedicationRequest'); assert.equal(m.status, 'active'); assert.equal(m.intent, 'order');
  assert.equal(m.medicationCodeableConcept.text, 'Amlodipin, tabletka');
  assert.match(m.dosageInstruction[0].text, /5 mg/);
  assert.equal(m.groupIdentifier.value, '17');
  assert.equal(fhir.medicationRequestResource('55555555-5555-4555-8555-555555555555', 17, 0, prescription.body.items[0], P.id, E, D.id, '2026-10-18T05:20:00Z', true).status, 'cancelled');
  const d = fhir.addendumResource({ id: '66666666-6666-4666-8666-666666666666', text: 'Qo‘shimcha', signed_at: '2026-10-18T07:00:00Z' }, P.id, E, D.id);
  assert.equal(d.resourceType, 'DocumentReference');
  assert.equal(Buffer.from(d.content[0].attachment.data, 'base64').toString('utf8'), 'Qo‘shimcha');
});

// ------------------------------------------------------------------ PINFL on the patient card

test('PINFL: 14 raqam tekshiruvi, registrator saqlaydi, klinika ichida takrorlanmaydi, boshqa klinikada mumkin; shifokor o‘zgartira olmaydi', async () => {
  const bad = await registrar.patch(`/patients/${openPatient}`, { pinfl: '12345' });
  assert.equal(bad.status, 422); assert.ok(bad.body.error.fields.pinfl);
  const badDoc = await registrar.patch(`/patients/${openPatient}`, { id_document: '12AB' });
  assert.equal(badDoc.status, 422); assert.ok(badDoc.body.error.fields.id_document);
  const ok = await registrar.patch(`/patients/${openPatient}`, { pinfl: '3120 5800 1234 56', id_document: 'aa 1234567' });
  assert.equal(ok.status, 200, ok.text);
  const p = (await registrar.get(`/patients/${openPatient}`)).body.data;
  assert.equal(p.pinfl, '31205800123456'); assert.equal(p.id_document, 'AA1234567');
  const card = (await registrar.get(`/patients/${openPatient}/card`)).body.data;
  assert.equal(card.patient.pinfl, '31205800123456', 'chop etiladigan kartada bor');
  const created = await registrar.post('/patients', { last_name: 'Pinflova', first_name: 'Dilnoza', birth_date: '1991-02-03', pinfl: '31205800123456', confirm_duplicate: true });
  assert.equal(created.status, 409); assert.equal(created.body.error.code, 'PINFL_TAKEN'); assert.ok(created.body.error.fields.pinfl);
  const other = await registrar.post('/patients', { last_name: 'Pinflova', first_name: 'Dilnoza', birth_date: '1991-02-03', pinfl: '42002910765432', confirm_duplicate: true });
  assert.equal(other.status, 201, other.text);
  assert.equal((await registrar.patch(`/patients/${other.body.data.id}`, { pinfl: '31205800123456' })).status, 409);
  const t2 = await t2manager.post('/patients', { last_name: 'Boshqa', first_name: 'Klinika', birth_date: '1985-01-01', pinfl: '31205800123456', confirm_duplicate: true });
  assert.equal(t2.status, 201, 'PINFL faqat bitta klinika ichida noyob');
  await doctor.patch(`/patients/${openPatient}`, { pinfl: '50000000000000' });
  assert.equal((await registrar.get(`/patients/${openPatient}`)).body.data.pinfl, '31205800123456', 'shifokor PINFL’ni o‘zgartirmaydi');
});

// ------------------------------------------------------------------ settings + outbox hooks

test('rejim «off»: retsept berilsa ham navbatga hech narsa tushmaydi', async () => {
  const r = await doctor.post(`/encounters/${open}/documents`, prescription);
  assert.equal(r.status, 201, r.text);
  assert.equal((await outbox()).length, 0);
});

test('sozlamalar: faqat rahbar; token qaytarilmaydi va shifrlangan; jonli rejim manzil+token talab qiladi; http faqat localhost', async () => {
  assert.equal((await registrar.get('/dhp/settings')).status, 403);
  assert.equal((await doctor.put('/dhp/settings', { mode: 'export' })).status, 403);
  const s0 = (await manager.get('/dhp/settings')).body.data;
  assert.equal(s0.mode, 'off'); assert.equal(s0.has_token, false);
  const noTok = await manager.put('/dhp/settings', { mode: 'live', endpoint: fakeUrl });
  assert.equal(noTok.status, 422); assert.ok(noTok.body.error.fields.token);
  const badUrl = await manager.put('/dhp/settings', { endpoint: 'http://dhp.example.uz/fhir' });
  assert.equal(badUrl.status, 422); assert.ok(badUrl.body.error.fields.endpoint);
  const r = await manager.put('/dhp/settings', { mode: 'export', endpoint: fakeUrl, token: TOKEN });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.mode, 'export'); assert.equal(r.body.data.has_token, true);
  assert.ok(!r.text.includes(TOKEN), 'token javobda yo‘q');
  assert.ok(!(await manager.get('/dhp/settings')).text.includes(TOKEN));
  const row = (await pool.query(`SELECT token_enc FROM dhp_settings WHERE tenant_id = $1`, [SEED_IDS.tenant])).rows[0];
  assert.match(row.token_enc, /^v1\./); assert.ok(!row.token_enc.includes(TOKEN));
  const logs = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'dhp.settings'`)).rows;
  assert.ok(logs.length && logs.every((l) => !l.summary.includes(TOKEN)), 'audit’da token yo‘q');
  assert.equal((await t2manager.get('/dhp/settings')).body.data.mode, 'off', 'boshqa klinika sozlamasi alohida');
});

let rxId, labOrder, addendumId;
test('rejim «export»: imzolangan qayd, tasdiqlangan tahlil, retsept, bekor qilingan retsept va qo‘shimcha — bir tranzaksiyada navbatga', async () => {
  const rx = await doctor.post(`/encounters/${open}/documents`, prescription);
  assert.equal(rx.status, 201); rxId = rx.body.data.id;
  const enc = (await doctor.get(`/encounters/${open}`)).body.data;
  const sign = await doctor.post(`/encounters/${open}/sign`, { version: enc.note.version, complaints: 'Bosh og‘rig‘i maxfiy-shikoyat', examination: 'AQB 150/95', diagnosis: 'Gipertoniya', recommendations: 'Dam olish', icd10: ['I10'] });
  assert.equal(sign.status, 200, sign.text);
  const o = (await pool.query(
    `SELECT o.id FROM service_orders o JOIN lab_results lr ON lr.order_id = o.id WHERE o.tenant_id = $1 AND o.status = 'draft_result' LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  assert.ok(o, 'seed’da qoralama natija bor'); labOrder = o.id;
  assert.equal((await lab.post(`/orders/${labOrder}/verify`)).status, 200);
  assert.equal((await doctor.post(`/documents/${rxId}/void`, { reason: 'Doza xato' })).status, 200);
  const ad = await doctor.post(`/encounters/${open}/addendum`, { text: 'Natija keldi', reason: 'Tahlil' });
  assert.equal(ad.status, 201); addendumId = ad.body.data.id;

  const rows = await outbox();
  const by = (t, id, v = 1) => rows.find((r) => r.resource_type === t && r.resource_id === id && r.version === v);
  const encRow = by('encounter', open);
  assert.ok(encRow && encRow.status === 'pending');
  const types = encRow.fhir.entry.map((e) => e.resource.resourceType);
  assert.deepEqual(types, ['Patient', 'Practitioner', 'Encounter', 'Condition']);
  assert.equal(encRow.fhir.entry[3].resource.code.coding[0].code, 'I10');
  assert.ok(!JSON.stringify(encRow.fhir).includes('maxfiy-shikoyat'), 'shikoyat matni platformaga ketmaydi');
  const labRow = by('lab_result', labOrder);
  assert.ok(labRow); assert.ok(labRow.fhir.entry.slice(1).every((e) => e.resource.resourceType === 'Observation'));
  assert.ok(by('prescription', rxId)); assert.equal(by('prescription', rxId).fhir.entry[2].resource.status, 'active');
  assert.equal(by('prescription', rxId, 2).fhir.entry[2].resource.status, 'cancelled', 'bekor qilingan retsept — 2-versiya');
  assert.equal(by('addendum', addendumId).fhir.entry[2].resource.resourceType, 'DocumentReference');
  assert.equal(rows.filter((r) => r.resource_type === 'prescription').length, 2, '«off» paytidagi retsept navbatga tushmagan');

  const w = await runDhpWorker(pool);
  assert.ok(w.ready >= 5);
  assert.equal(received.length, 0, 'eksport rejimida tashqariga hech narsa yuborilmaydi');
  assert.ok((await outbox()).every((r) => r.status === 'ready'));
  const list = await manager.get('/dhp/outbox?status=ready');
  assert.equal(list.status, 200);
  assert.ok(list.body.data.length >= 5 && list.body.counts.ready >= 5);
  assert.ok(!('fhir' in list.body.data[0]) && !list.text.includes('Amlodipin'), 'ro‘yxatda klinik yuk yo‘q');
  assert.equal((await manager.get('/dhp/outbox?status=nope')).status, 422);
  assert.equal((await t2manager.get('/dhp/outbox')).body.data.length, 0, 'boshqa klinika ko‘rmaydi');
});

test('NDJSON eksport: faqat rahbar, davr ≤ 31 kun, har qatorda Bundle, audit, boshqa klinika — bo‘sh', async () => {
  assert.equal((await registrar.get(`/dhp/export.ndjson?from=${today}&to=${today}`)).status, 403);
  assert.equal((await manager.get(`/dhp/export.ndjson?from=${today}`)).status, 422);
  assert.equal((await manager.get(`/dhp/export.ndjson?from=2026-01-01&to=2026-03-01`)).status, 422, '31 kundan uzun');
  assert.equal((await manager.get(`/dhp/export.ndjson?from=${today}&to=2026-01-01`)).status, 422);
  const r = await manager.get(`/dhp/export.ndjson?from=${today}&to=${today}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/fhir\+ndjson/);
  assert.match(r.headers.get('content-disposition'), /attachment/);
  const lines = r.text.trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.length >= 5 && lines.every((b) => b.resourceType === 'Bundle' && b.type === 'transaction'));
  const a = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'dhp.export' ORDER BY occurred_at DESC LIMIT 1`)).rows[0];
  assert.match(a.summary, new RegExp(`${today}.*${lines.length} ta`));
  const t2 = await t2manager.get(`/dhp/export.ndjson?from=${today}&to=${today}`);
  assert.equal(t2.status, 200); assert.equal(t2.text, '');
});

test('jonli rejim: PINFL yo‘q → failed; 200 → sent (Bearer token); 503 → qayta urinish; 401 va 400 → failed; retry qayta tuzadi', async () => {
  assert.equal((await manager.put('/dhp/settings', { mode: 'live' })).status, 200);
  // the lab patient may have no PINFL: that row fails without a request; the others go out
  const rows = await outbox(`status = 'ready'`);
  const withPinfl = rows.filter((r) => r.patient_id === openPatient);
  const noPinfl = rows.filter((r) => r.patient_id !== openPatient);
  await pool.query(`UPDATE patients SET pinfl = NULL WHERE id = ANY($1)`, [noPinfl.map((r) => r.patient_id)]);
  replies.push(200, 200, 200, 200, 200, 200);
  const w = await runDhpWorker(pool);
  replies.length = 0;
  assert.equal(w.sent, withPinfl.length);
  assert.equal(w.failed, noPinfl.length);
  assert.equal(received.length, withPinfl.length);
  assert.equal(received[0].auth, `Bearer ${TOKEN}`); assert.match(received[0].type, /application\/fhir\+json/);
  assert.equal(received[0].body.resourceType, 'Bundle');
  const s = (await manager.get('/dhp/settings')).body.data;
  assert.equal(s.counts.sent, withPinfl.length); assert.ok(s.last_sent_at);
  if (noPinfl.length) {
    const f = (await outbox(`id = $2`, [noPinfl[0].id]))[0];
    assert.equal(f.status, 'failed'); assert.match(f.error, /PINFL/);
    assert.ok(s.without_pinfl >= 1);
  }

  // a new event: 503 → stays open with backoff, then 401 → failed with the settings error
  const rx2 = await doctor.post(`/encounters/${open}/documents`, prescription);
  assert.equal(rx2.status, 201);
  const row2 = (await outbox(`resource_id = $2`, [rx2.body.data.id]))[0];
  assert.equal(row2.status, 'pending');
  replies.push(503);
  assert.equal((await runDhpWorker(pool)).retry, 1);
  let r2 = (await outbox(`id = $2`, [row2.id]))[0];
  assert.equal(r2.status, 'pending'); assert.equal(r2.attempts, 1); assert.equal(r2.http_status, 503);
  assert.ok(new Date(r2.next_attempt_at) > new Date(row2.next_attempt_at), 'keyingi urinish keyinroq');
  assert.equal((await runDhpWorker(pool)).retry, 0, 'muddati kelmaguncha qayta yuborilmaydi');
  await pool.query(`UPDATE dhp_outbox SET next_attempt_at = demo_now() - interval '1 second' WHERE id = $1`, [row2.id]);
  replies.push(401);
  assert.equal((await runDhpWorker(pool)).failed, 1);
  r2 = (await outbox(`id = $2`, [row2.id]))[0];
  assert.equal(r2.status, 'failed'); assert.equal(r2.http_status, 401);
  assert.match((await manager.get('/dhp/settings')).body.data.last_error, /401/);

  // retry: manager only, other clinic 404, only failed rows; 400 → failed with the platform's text
  assert.equal((await registrar.post(`/dhp/outbox/${row2.id}/retry`)).status, 403);
  assert.equal((await t2manager.post(`/dhp/outbox/${row2.id}/retry`)).status, 404);
  const sentRow = (await outbox(`status = 'sent'`))[0];
  assert.equal((await manager.post(`/dhp/outbox/${sentRow.id}/retry`)).status, 409);
  const re = await manager.post(`/dhp/outbox/${row2.id}/retry`);
  assert.equal(re.status, 200, re.text); assert.equal(re.body.data.status, 'pending');
  replies.push(400);
  assert.equal((await runDhpWorker(pool)).failed, 1);
  r2 = (await outbox(`id = $2`, [row2.id]))[0];
  assert.equal(r2.status, 'failed'); assert.match(r2.error, /HTTP 400: fake 400/);
});

test('anonimlashtirish: bemorning navbatdagi FHIR yuki o‘chiriladi, yuborilmaganlari «skipped»; eksportga tushmaydi', async () => {
  const p = (await registrar.post('/patients', { last_name: 'Anonimova', first_name: 'Test', birth_date: '1970-01-01', pinfl: '61001700000001', confirm_duplicate: true })).body.data;
  // a queued row for this patient (directly: the clinical flow is covered above)
  await pool.query(`INSERT INTO dhp_outbox (tenant_id, patient_id, resource_type, resource_id, version, fhir) VALUES ($1,$2,'encounter',gen_random_uuid(),1,$3)`,
    [SEED_IDS.tenant, p.id, JSON.stringify({ resourceType: 'Bundle', type: 'transaction', entry: [] })]);
  const an = await manager.post(`/patients/${p.id}/anonymise`, { reason: 'Bemor so‘rovi', method: 'signed_paper' });
  assert.equal(an.status, 201, an.text);
  const rows = (await pool.query(`SELECT status, fhir FROM dhp_outbox WHERE patient_id = $1`, [p.id])).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'skipped'); assert.equal(rows[0].fhir, null);
  assert.equal((await pool.query(`SELECT pinfl FROM patients WHERE id = $1`, [p.id])).rows[0].pinfl, null, 'PINFL ham o‘chirildi');
  await assert.rejects(pool.query(`UPDATE patients SET pinfl = '61001700000001' WHERE id = $1`, [p.id]), /no identifying data/);
});
