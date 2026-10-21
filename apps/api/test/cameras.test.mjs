// Hikvision cameras: devices and push tokens, staff/patient face codes (consent rules), the event rules (purposes,
// unknown/revoked codes, no consent, low similarity, duplicates), attendance, people flow, security alerts and acks,
// the registrar's arrival suggestions (accept = the normal check-in), roles and tenant isolation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
const BC = SEED_IDS.branchCentral;
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}) => req('POST', p, b), patch: (p, b) => req('PATCH', p, b), del: (p) => req('DELETE', p), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }), cookie: () => cookie };
}
const as = async (mid) => { const s = session(); assert.equal((await s.demo(mid)).status, 200); return s; };

let manager, registrar, cashier, doctor, t2;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = await as(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  await db.assertDatabaseName(pool, '_test');
  registrar = await as(M.registrar); cashier = await as(M.cashier); doctor = await as(M.doctor(0)); t2 = await as(M.tenant2Manager);
});
after(async () => { await app?.close(); });

const seedCam = async (name) => (await manager.get('/cameras')).body.data.find((c) => c.name === name);

test('seed: 6 kamera, xodim kodlari, davomat, odam oqimi, xavfsizlik; yuz tasviri hech qayerda yo‘q', async () => {
  const cams = (await manager.get('/cameras')).body.data;
  assert.equal(cams.length, 6);
  assert.ok(cams.every((c) => !('token_hash' in c)), 'token hash qaytarilmaydi');
  const codes = (await manager.get('/cameras/face-codes')).body;
  assert.equal(codes.data.filter((r) => r.code).length, 14, 'har bir xodimda S-kod');
  assert.ok(codes.meta.patient_codes >= 10);
  const att = (await manager.get('/cameras/attendance?from=2026-10-12&to=2026-10-17')).body;
  assert.ok(att.data.length > 50 && att.meta.present > 0);
  assert.ok(att.meta.late > 0, 'kechikkanlar bor');
  const tr = (await manager.get('/cameras/traffic?from=2026-10-12&to=2026-10-17')).body;
  assert.ok(tr.meta.total_enter > 100 && tr.meta.busiest_hour >= 9 && tr.meta.busiest_hour <= 12);
  const sec = (await manager.get('/cameras/security?from=2026-10-01&to=2026-10-18')).body;
  // two open night alerts, plus this morning's loitering at the operating block once the demo clock has passed 09:48
  assert.equal(sec.meta.open_alerts, process.env.DEMO_TIME >= '09:48' ? 3 : 2, 'ko‘rib chiqilmagan ogohlantirishlar');
  // the seed's alert pictures: drawn frames, only on alerts, never on a face event
  assert.ok(sec.data.filter((r) => r.has_snapshot).length >= 8, 'ogohlantirish suratlari bor');
  assert.ok(sec.data.every((r) => !r.has_snapshot || r.alert), 'surat faqat ogohlantirishda');
  const snaps = (await pool.query(`SELECT count(*)::int AS n FROM camera_snapshots s JOIN camera_events e ON e.id = s.event_id WHERE NOT e.alert OR e.kind IN ('face_match', 'people_count')`)).rows[0].n;
  assert.equal(snaps, 0);
  // personas: Bekzod Ergashev is the one most often late; Lola Abdullayeva has three days of leave (no «absent» for them)
  const month = (await manager.get('/cameras/attendance?from=2026-09-19&to=2026-10-18')).body.data;
  const lateBy = (id) => month.filter((r) => r.membership_id === id && r.status === 'late').length;
  const others = [M.doctor(0), M.doctor(1), M.doctor(3), M.doctor(5), M.doctor(6)].map(lateBy);
  assert.ok(lateBy(M.doctor(2)) > Math.max(...others), 'surunkali kechikuvchi');
  const hist = (await pool.query(`SELECT status, count(*)::int AS n FROM arrival_suggestions GROUP BY 1`)).rows;
  assert.ok(hist.find((h) => h.status === 'accepted')?.n > 5, 'bemor kelishi tarixi');
  // the schema has no column for a face picture or a face template: the only picture table holds alert evidence
  const cols = (await pool.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('cameras','face_codes','camera_events','arrival_suggestions','camera_snapshots')`)).rows;
  assert.ok(!cols.some((c) => c.table_name !== 'camera_snapshots' && (c.data_type === 'bytea' || /image|photo|picture|template|face_data/i.test(c.column_name))), cols.map((c) => c.column_name).join(','));
  assert.ok(!cols.some((c) => c.table_name === 'face_codes' && /snapshot/i.test(c.column_name)));
});

test('kamera qo‘shish: manzil bir marta beriladi, faqat hash saqlanadi; yangilash eskisini o‘chiradi', async () => {
  const r = await manager.post('/cameras', { branch_id: BC, name: 'Sinov kamera', purposes: ['counting', 'security'], security_mode: 'always' });
  assert.equal(r.status, 201);
  assert.match(r.body.data.push_path, /^\/api\/v1\/hik\/[A-Za-z0-9_-]{32}$/);
  const token = r.body.data.push_path.split('/').pop();
  const row = (await pool.query(`SELECT token_hash, token_hint FROM cameras WHERE id = $1`, [r.body.data.id])).rows[0];
  assert.notEqual(row.token_hash, token); assert.equal(row.token_hint, token.slice(-4));
  const listed = (await manager.get('/cameras')).body.data.find((c) => c.id === r.body.data.id);
  assert.ok(!JSON.stringify(listed).includes(token), 'token ro‘yxatda yo‘q');
  const rot = await manager.post(`/cameras/${r.body.data.id}/token`);
  assert.equal(rot.status, 200); assert.notEqual(rot.body.data.push_path, r.body.data.push_path);
  const v = await manager.post('/cameras', { branch_id: BC, name: '', purposes: [] });
  assert.equal(v.status, 422); assert.ok(v.body.error.fields.name && v.body.error.fields.purposes);
  assert.equal((await manager.patch(`/cameras/${r.body.data.id}`, { status: 'disabled' })).status, 200);
});

test('rollar va izolyatsiya: kameralar faqat rahbarga; boshqa klinika kamerasi 404', async () => {
  for (const s of [registrar, cashier, doctor]) {
    assert.equal((await s.get('/cameras')).status, 403);
    assert.equal((await s.get('/cameras/attendance')).status, 403);
    assert.equal((await s.post('/cameras', { branch_id: BC, name: 'x', purposes: ['security'] })).status, 403);
  }
  assert.equal((await doctor.get('/cameras/arrivals')).status, 403);
  assert.equal((await registrar.get('/cameras/arrivals')).status, 200);
  const cam = await seedCam('Asosiy kirish');
  assert.equal((await t2.patch(`/cameras/${cam.id}`, { name: 'x' })).status, 404);
  assert.equal((await t2.post(`/cameras/${cam.id}/simulate`, { kind: 'people_count', enter: 1 })).status, 404);
  assert.equal((await t2.get('/cameras')).body.data.length, 0);
});

test('xodim kodi: yozma rozilik tasdig‘isiz berilmaydi; bekor qilingan kod hodisasi saqlanmaydi', async () => {
  const codes = (await manager.get('/cameras/face-codes')).body.data;
  const reg = codes.find((r) => r.membership_id === M.registrar);
  assert.equal((await manager.post('/cameras/face-codes', { membership_id: M.registrar })).status, 422);
  const again = await manager.post('/cameras/face-codes', { membership_id: M.registrar, consent_confirmed: true });
  assert.equal(again.body.data.code, reg.code); assert.equal(again.body.data.already, true);
  const cam = await seedCam('Asosiy kirish');
  let r = await manager.post(`/cameras/${cam.id}/simulate`, { kind: 'face_match', code: reg.code });
  assert.equal(r.body.data.stored, true);
  assert.equal((await manager.del(`/cameras/face-codes/${reg.face_code_id}`)).status, 200);
  r = await manager.post(`/cameras/${cam.id}/simulate`, { kind: 'face_match', code: reg.code });
  assert.deepEqual(r.body.data, { stored: false, ignored: 'unknown_code' });
  const fresh = await manager.post('/cameras/face-codes', { membership_id: M.registrar, consent_confirmed: true });
  assert.equal(fresh.status, 201); assert.notEqual(fresh.body.data.code, reg.code, 'yangi kod');
  const audits = (await pool.query(`SELECT action FROM audit_logs WHERE resource_id = $1 AND action LIKE 'camera.face_code%' ORDER BY occurred_at`, [M.registrar])).rows.map((a) => a.action);
  assert.deepEqual(audits, ['camera.face_code_revoke', 'camera.face_code']);
});

test('qoidalar: vazifa, noma’lum kod, past o‘xshashlik, takror hodisa', async () => {
  const store = await seedCam('Dori ombori');           // security only
  assert.deepEqual((await manager.post(`/cameras/${store.id}/simulate`, { kind: 'people_count', enter: 3 })).body.data, { stored: false, ignored: 'purpose' });
  assert.deepEqual((await manager.post(`/cameras/${store.id}/simulate`, { kind: 'face_match', code: 'S-1' })).body.data, { stored: false, ignored: 'purpose' });
  const entry = await seedCam('Asosiy kirish');
  assert.deepEqual((await manager.post(`/cameras/${entry.id}/simulate`, { kind: 'face_match', code: 'S-999' })).body.data, { stored: false, ignored: 'unknown_code' });
  assert.deepEqual((await manager.post(`/cameras/${entry.id}/simulate`, { kind: 'face_match' })).body.data, { stored: false, ignored: 'no_code' });
  const yun = await seedCam('Kirish');                   // attendance + counting, no security
  assert.deepEqual((await manager.post(`/cameras/${yun.id}/simulate`, { kind: 'intrusion' })).body.data, { stored: false, ignored: 'purpose' });
  // the ingest itself: low similarity and a re-sent notification
  const { ingestEvent } = require('../dist/cameras/ingest.js');
  const cam = (await pool.query(`SELECT * FROM cameras WHERE id = $1`, [entry.id])).rows[0];
  const at = new Date();
  assert.deepEqual(await ingestEvent(pool, cam, { kind: 'face_match', occurredAt: at, code: 'S-1', similarity: 61, sourceKey: 'low' }), { stored: false, ignored: 'low_similarity' });
  const first = await ingestEvent(pool, cam, { kind: 'people_count', occurredAt: at, enter: 2, exit: 1, sourceKey: 'dup-1' });
  assert.equal(first.stored, true);
  assert.deepEqual(await ingestEvent(pool, cam, { kind: 'people_count', occurredAt: at, enter: 2, exit: 1, sourceKey: 'dup-1' }), { stored: false, ignored: 'duplicate' });
  await assert.rejects(pool.query(`UPDATE camera_events SET similarity = 99 WHERE id = $1`, [first.event_id]), (e) => e.code === 'P0001');
  await assert.rejects(pool.query(`DELETE FROM camera_events WHERE id = $1`, [first.event_id]), (e) => e.code === 'P0001');
});

test('bemor: yuzni tanish faqat imzolangan varaqa bilan; rozilik bo‘lmasa yoki qaytarilsa hodisa saqlanmaydi', async () => {
  const p = (await pool.query(`SELECT id, patient_number FROM patients WHERE tenant_id = $1 AND patient_number % 10 = 7 ORDER BY patient_number LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  const code = `P-${p.patient_number}`;
  const entry = await seedCam('Asosiy kirish');
  assert.deepEqual((await manager.post(`/cameras/${entry.id}/simulate`, { kind: 'face_match', code })).body.data, { stored: false, ignored: 'unknown_code' });
  const verbal = await registrar.post(`/patients/${p.id}/consents`, { kind: 'biometric', granted: true, method: 'verbal' });
  assert.equal(verbal.status, 422); assert.ok(verbal.body.error.fields.method);
  assert.equal((await registrar.post(`/patients/${p.id}/consents`, { kind: 'biometric', granted: true, method: 'signed_paper' })).status, 201);
  assert.equal((await registrar.get(`/patients/${p.id}`)).body.data.consents.biometric.granted, true);
  assert.equal((await manager.post(`/cameras/${entry.id}/simulate`, { kind: 'face_match', code })).body.data.stored, true);
  // the Yunusobod entrance does not look for patients
  const yun = await seedCam('Kirish');
  assert.deepEqual((await manager.post(`/cameras/${yun.id}/simulate`, { kind: 'face_match', code })).body.data, { stored: false, ignored: 'purpose' });
  assert.equal((await registrar.post(`/patients/${p.id}/consents`, { kind: 'biometric', granted: false, method: 'verbal' })).status, 201);
  assert.deepEqual((await manager.post(`/cameras/${entry.id}/simulate`, { kind: 'face_match', code })).body.data, { stored: false, ignored: 'unknown_code' });
  // a consent given again brings the same code back
  assert.equal((await registrar.post(`/patients/${p.id}/consents`, { kind: 'biometric', granted: true, method: 'signed_paper' })).status, 201);
  assert.equal((await manager.post(`/cameras/${entry.id}/simulate`, { kind: 'face_match', code })).body.data.stored, true);
});

test('bemor keldi: seed takliflari; qabul qilish = oddiy «Keldi» (navbat raqami, hisob); qayta qabul qilib bo‘lmaydi', async () => {
  // seed: the camera saw (at most) two of the next bookings within 2 hours; make sure there are two to work with
  let list = (await registrar.get('/cameras/arrivals')).body.data;
  if (list.length < 2) {
    const { ingestEvent } = require('../dist/cameras/ingest.js');
    const entry = (await pool.query(`SELECT * FROM cameras WHERE name = 'Asosiy kirish' AND tenant_id = $1`, [SEED_IDS.tenant])).rows[0];
    const appts = (await pool.query(
      `SELECT a.id, a.patient_id, a.starts_at FROM appointments a WHERE a.tenant_id = $1 AND a.branch_id = $2 AND a.status = 'scheduled'
         AND a.starts_at >= demo_now() AND NOT EXISTS (SELECT 1 FROM arrival_suggestions s WHERE s.appointment_id = a.id) ORDER BY a.starts_at LIMIT $3`,
      [SEED_IDS.tenant, BC, 2 - list.length])).rows;
    for (const a of appts) {
      await registrar.post(`/patients/${a.patient_id}/consents`, { kind: 'biometric', granted: true, method: 'signed_paper' });
      const code = 'P-' + (await pool.query(`SELECT patient_number FROM patients WHERE id = $1`, [a.patient_id])).rows[0].patient_number;
      await ingestEvent(pool, entry, { kind: 'face_match', occurredAt: new Date(new Date(a.starts_at).getTime() - 30 * 60_000), code, similarity: 95, sourceKey: 'arr-' + a.id });
    }
    list = (await registrar.get('/cameras/arrivals')).body.data;
  }
  assert.equal(list.length, 2);
  const s = list[0];
  const r = await registrar.post(`/cameras/arrivals/${s.id}/accept`);
  assert.equal(r.status, 200); assert.ok(r.body.data.queue_number >= 1 && r.body.data.invoice_id);
  const a = (await pool.query(`SELECT status FROM appointments WHERE id = $1`, [s.appointment_id])).rows[0];
  assert.equal(a.status, 'arrived');
  assert.equal((await registrar.post(`/cameras/arrivals/${s.id}/accept`)).status, 409);
  assert.equal((await registrar.post(`/cameras/arrivals/${list[1].id}/dismiss`)).status, 200);
  assert.equal((await registrar.get('/cameras/arrivals')).body.data.length, 0);
  assert.equal((await t2.post(`/cameras/arrivals/${list[1].id}/accept`)).status, 404);
  const audit = (await pool.query(`SELECT actor_membership_id FROM audit_logs WHERE resource_id = $1 AND action = 'appointment.check_in'`, [s.appointment_id])).rows[0];
  assert.equal(audit.actor_membership_id, M.registrar, 'kim tasdiqlagani yoziladi');
});

test('xavfsizlik: ish vaqtidan tashqari = ogohlantirish; «har doim» rejimi; ko‘rib chiqildi belgisi', async () => {
  const { ingestEvent } = require('../dist/cameras/ingest.js');
  const cash = (await pool.query(`SELECT * FROM cameras WHERE name = 'Kassa' AND tenant_id = $1`, [SEED_IDS.tenant])).rows[0];
  const day = new Date('2026-10-14T05:00:00Z'); // 10:00 Tashkent, a working Wednesday
  const night = new Date('2026-10-14T18:30:00Z'); // 23:30 Tashkent
  const r1 = await ingestEvent(pool, cash, { kind: 'line_crossing', occurredAt: day, target: 'human', sourceKey: 't-day' });
  const r2 = await ingestEvent(pool, cash, { kind: 'line_crossing', occurredAt: night, target: 'human', sourceKey: 't-night' });
  const alerts = (await pool.query(`SELECT id, alert FROM camera_events WHERE id = ANY($1)`, [[r1.event_id, r2.event_id]])).rows;
  assert.equal(alerts.find((x) => x.id === r1.event_id).alert, false);
  assert.equal(alerts.find((x) => x.id === r2.event_id).alert, true);
  const store = (await pool.query(`SELECT * FROM cameras WHERE name = 'Dori ombori' AND tenant_id = $1`, [SEED_IDS.tenant])).rows[0];
  const r3 = await ingestEvent(pool, store, { kind: 'intrusion', occurredAt: day, target: 'human', sourceKey: 't-always' });
  assert.equal((await pool.query(`SELECT alert FROM camera_events WHERE id = $1`, [r3.event_id])).rows[0].alert, true);
  const before = (await manager.get('/cameras/security?from=2026-10-01&to=2026-10-18')).body.meta.open_alerts;
  assert.equal((await manager.post(`/cameras/security/${r2.event_id}/ack`)).status, 200);
  assert.equal((await manager.post(`/cameras/security/${r2.event_id}/ack`)).status, 200, 'takror — xato emas');
  assert.equal((await manager.get('/cameras/security?from=2026-10-01&to=2026-10-18')).body.meta.open_alerts, before - 1);
  assert.equal((await t2.post(`/cameras/security/${r3.event_id}/ack`)).status, 404);
});

// ---------- the camera push endpoint with real ISAPI payloads (docs/HIKVISION_ISAPI_RESEARCH.md) ----------
const push = (path, body, contentType) => fetch(base.replace('/api/v1', '') + path, { method: 'POST', headers: { 'content-type': contentType }, body });
const PC_RANGE = (start, end, enter, exit) => `<EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<ipAddress>10.18.98.66</ipAddress><macAddress>98:df:82:30:1a:a0</macAddress><channelID>1</channelID>
<dateTime>${end}</dateTime><eventType>PeopleCounting</eventType><eventState>active</eventState><eventDescription>peopleCounting alarm</eventDescription>
<peopleCounting><statisticalMethods>timeRange</statisticalMethods><TimeRange><startTime>${start}</startTime><endTime>${end}</endTime></TimeRange>
<enter>${enter}</enter><exit>${exit}</exit><pass>0</pass><duplicatePeople>0</duplicatePeople><vehicleEnter>38</vehicleEnter><vehicleExit>24</vehicleExit></peopleCounting>
<FaceExpressionList><FaceExpression><value>surprised</value><count>0</count></FaceExpression></FaceExpressionList></EventNotificationAlert>`;
const PC_RT = (time, enter, exit) => `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="1.0" xmlns="urn:psialliance-org"><ipAddress>192.168.1.64</ipAddress><protocolType>HTTP</protocolType>
<macAddress>84:9a:40:ec:f1:6d</macAddress><channelID>1</channelID><dateTime>${time}</dateTime><activePostCount>1</activePostCount>
<eventType>PeopleCounting</eventType><eventState>active</eventState><eventDescription>peopleCounting alarm</eventDescription><channelName>Camera 01</channelName>
<peopleCounting><statisticalMethods>realTime</statisticalMethods><RealTime><time>${time}</time></RealTime><enter>${enter}</enter><exit>${exit}</exit><regionsID>1</regionsID></peopleCounting>
<childCounting><enter>0</enter><exit>0</exit></childCounting></EventNotificationAlert>`;
const FIELD = (time, post = 1) => `<EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<ipAddress>1.0.0.255</ipAddress><portNo>80</portNo><protocol>HTTP</protocol><macAddress>ac:b9:2f:49:44:75</macAddress><channelID>1</channelID>
<dateTime>${time}</dateTime><activePostCount>${post}</activePostCount><eventType>fielddetection</eventType><eventState>active</eventState>
<eventDescription>fielddetection alarm</eventDescription><DetectionRegionList><DetectionRegionEntry><regionID>3</regionID><sensitivityLevel>50</sensitivityLevel>
<detectionTarget>human</detectionTarget><TargetRect><X>0.6</X><Y>0.215278</Y><width>0.135937</width><height>0.505556</height></TargetRect></DetectionRegionEntry></DetectionRegionList>
<channelName>COUR NORD</channelName><detectionPictureTransType>binary</detectionPictureTransType><detectionPicturesNumber>1</detectionPicturesNumber><isDataRetransmission>false</isDataRetransmission></EventNotificationAlert>`;
const HEARTBEAT = `<EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema"><ipAddress>10.0.0.5</ipAddress><channelID>1</channelID>
<dateTime>2026-10-18T07:00:00+05:00</dateTime><activePostCount>0</activePostCount><eventType>videoloss</eventType><eventState>inactive</eventState><eventDescription>videoloss alarm</eventDescription></EventNotificationAlert>`;
// alarmResult (face comparison) as documented; our code is in certificateNumber, similarity 0..1; duplicate keys as on real devices
const ALARM = (time, cert, sim, name = 'Ism') => `{
 "ipAddress": "10.0.0.5", "portNo": 80, "protocol": "HTTP", "channelID": 1, "dateTime": "${time}", "activePostCount": 3,
 "eventType": "alarmResult", "eventState": "active", "eventDescription": "alarmResult",
 "alarmResult": [{ "targetAttrs": { "deviceChannel": 1, "deviceName": "IP CAMERA", "faceTime": "${time}", "contentID": "a", "contentID": "b" },
   "faces": [{ "faceRect": { "height": 0.16, "width": 0.09, "x": 0.4, "y": 0.57 },
     "identify": [{ "maxsimilarity": ${sim}, "candidate": [{ "blacklist_id": "tg",
       "human_data": [{ "bkg_picurl": "http://10.0.0.5:80/FDLib?FDID=529FB9&pId=F4F665&size=22332", "similarity": ${sim} }],
       "reserve_field": { "name": "${name}", "gender": "male", "certificateType": "officerID", "certificateNumber": "${cert}" },
       "similarity": ${sim}, "listType": "blackList" }] }],
     "URL": "http://10.0.0.5:80/picture/Streaming/tracks/203/?name=ch0002&size=58760" }] }],
 "URLCertificationType": "digest" }`;
const multipart = (jsonName, json) => {
  const b = 'boundary';
  const img = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x2d, 0x2d, 0x62, 0x6f, 0xff, 0xd9]); // a JPEG-ish blob, never read
  return Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${jsonName}"\r\nContent-Type: application/json; charset="UTF-8"\r\nContent-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="facePicture"; filename="facePicture.jpg";\r\nContent-Type: image/jpeg\r\nContent-Length: ${img.length}\r\n\r\n`), img,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
};

test('kamera manzili: noto‘g‘ri token 404; yurak urishi; odam sanash (davr va jamlangan); takror yuborish bir marta', async () => {
  assert.equal((await push('/api/v1/hik/' + 'x'.repeat(32), HEARTBEAT, 'application/xml')).status, 404);
  assert.equal((await push('/api/v1/hik/short', HEARTBEAT, 'application/xml')).status, 404);
  const r = await manager.post('/cameras', { branch_id: BC, name: 'Push kamera', purposes: ['counting', 'security', 'attendance'] });
  const path = r.body.data.push_path, id = r.body.data.id;
  let res = await push(path, HEARTBEAT, 'application/xml; charset="UTF-8"');
  assert.equal(res.status, 200); assert.equal((await res.json()).stored, 0);
  assert.ok((await pool.query(`SELECT last_seen_at FROM cameras WHERE id = $1`, [id])).rows[0].last_seen_at, 'yurak urishi ko‘rindi');
  res = await push(path, PC_RANGE('2026-10-16T09:00:00+05:00', '2026-10-16T09:59:59+05:00', 17, 9), 'application/xml');
  assert.equal((await res.json()).stored, 1);
  res = await push(path, PC_RANGE('2026-10-16T09:00:00+05:00', '2026-10-16T09:59:59+05:00', 17, 9), 'application/xml');
  assert.equal((await res.json()).stored, 0, 'xuddi shu davr ikkinchi marta saqlanmaydi');
  // real-time totals: 70 → 75 → 3 (camera reset) becomes 70, 5, 3
  for (const [t, e, x] of [['2026-10-17T10:00:00+05:00', 70, 40], ['2026-10-17T10:05:00+05:00', 75, 44], ['2026-10-17T10:05:00+05:00', 75, 44], ['2026-10-17T10:09:00+05:00', 3, 1]])
    assert.equal((await push(path, PC_RT(t, e, x), 'application/xml')).status, 200);
  const rows = (await pool.query(`SELECT enter_count, exit_count FROM camera_events WHERE camera_id = $1 AND kind = 'people_count' ORDER BY occurred_at`, [id])).rows;
  assert.deepEqual(rows.map((x) => [x.enter_count, x.exit_count]), [[17, 9], [70, 40], [5, 4], [3, 1]]);
  // intrusion repeated with a growing activePostCount within one minute is one event; human target kept
  for (const n of [1, 2, 3]) await push(path, FIELD('2026-10-17T23:41:05+05:00', n), 'application/xml');
  const intr = (await pool.query(`SELECT target, alert, occurred_at FROM camera_events WHERE camera_id = $1 AND kind = 'intrusion'`, [id])).rows;
  assert.equal(intr.length, 1); assert.equal(intr[0].target, 'human'); assert.equal(intr[0].alert, true, 'tunda — ogohlantirish');
  assert.equal(intr[0].occurred_at.toISOString(), '2026-10-17T18:41:05.000Z', 'kamera vaqt mintaqasi hisobga olindi');
  // a disabled camera is heard but nothing is stored
  await manager.patch(`/cameras/${id}`, { status: 'disabled' });
  res = await push(path, FIELD('2026-10-17T23:50:00+05:00'), 'application/xml');
  assert.equal(res.status, 200); assert.equal((await res.json()).stored, 0);
});

test('yuzni tanish: multipart (JSON + rasm) — kod certificateNumber yoki ismdan; rasm o‘qilmaydi; past o‘xshashlik rad', async () => {
  const r = await manager.post('/cameras', { branch_id: BC, name: 'Yuz kamera', purposes: ['attendance'] });
  const path = r.body.data.push_path, id = r.body.data.id;
  const code = (await manager.get('/cameras/face-codes')).body.data.find((x) => x.membership_id === M.cashier).code;
  let res = await push(path, multipart('faceCapture', ALARM('2026-10-17T08:51:00+05:00', code, 0.97)), 'multipart/form-data; boundary=boundary');
  assert.equal(res.status, 200); assert.equal((await res.json()).stored, 1);
  // older enrolments: the code typed into the name field
  res = await push(path, ALARM('2026-10-17T18:12:00+05:00', '333333333333', 0.93, `${code} Nodira`), 'application/json');
  assert.equal((await res.json()).stored, 1);
  res = await push(path, ALARM('2026-10-17T18:20:00+05:00', code, 0.55), 'text/json');
  assert.equal((await res.json()).stored, 0, '55% — shubhali');
  const ev = (await pool.query(`SELECT e.similarity, fc.code FROM camera_events e JOIN face_codes fc ON fc.id = e.face_code_id WHERE e.camera_id = $1 ORDER BY e.occurred_at`, [id])).rows;
  assert.deepEqual(ev.map((x) => [Number(x.similarity), x.code]), [[97, code], [93, code]]);
  const att = (await manager.get('/cameras/attendance?from=2026-10-17&to=2026-10-17')).body.data.find((x) => x.membership_id === M.cashier);
  assert.ok(att.first_at && att.last_at && att.worked_min >= 9 * 60);
  // too large a body is refused before parsing
  res = await push(path, Buffer.alloc(7 * 1024 * 1024, 0x41), 'application/octet-stream');
  assert.equal(res.status, 413);
});

/** A real multipart security notification with the camera's picture (fielddetection + a JPEG part). */
const securityMultipart = (type, time, picture, extraXml = '') => {
  const b = 'MIME_boundary';
  const xml = `<?xml version="1.0" encoding="UTF-8"?><EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<ipAddress>192.168.1.64</ipAddress><channelID>1</channelID><dateTime>${time}</dateTime><activePostCount>1</activePostCount>
<eventType>${type}</eventType><eventState>active</eventState><eventDescription>${type} alarm</eventDescription>
<DetectionRegionList><DetectionRegionEntry><regionID>1</regionID><detectionTarget>human</detectionTarget></DetectionRegionEntry></DetectionRegionList>${extraXml}</EventNotificationAlert>`;
  return { type: `multipart/form-data; boundary=${b}`, body: Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${type}"\r\nContent-Type: application/xml; charset="UTF-8"\r\nContent-Length: ${Buffer.byteLength(xml)}\r\n\r\n${xml}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${type}Picture"; filename="picture.jpg"\r\nContent-Type: image/jpeg\r\nContent-Length: ${picture.length}\r\n\r\n`), picture,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]) };
};

test('ogohlantirish surati: faqat «surat saqlash» yoqilgan kamerada, faqat ogohlantirishda, ≤1 MB; yuz hodisasida hech qachon; faqat rahbarga; 30 kundan keyin o‘chadi', async () => {
  const { readSeedSnapshot } = require('@meduza/db');
  const { purgeSnapshots } = require('../dist/cameras/ingest.js');
  const jpeg = readSeedSnapshot('store-night-1');
  assert.ok(jpeg && jpeg[0] === 0xff && jpeg[1] === 0xd8, 'seed surati JPEG');
  // «always» security camera with snapshots on
  const r = await manager.post('/cameras', { branch_id: BC, name: 'Surat kamera', purposes: ['security', 'attendance'], security_mode: 'always', alert_snapshots: true });
  assert.equal(r.status, 201);
  const path = r.body.data.push_path, id = r.body.data.id;
  assert.equal((await manager.get('/cameras')).body.data.find((c) => c.id === id).alert_snapshots, true);
  // 1) an alert with a picture → stored with the picture
  let m = securityMultipart('fielddetection', '2026-10-17T23:10:00+05:00', jpeg);
  let res = await push(path, m.body, m.type); assert.equal((await res.json()).stored, 1);
  const ev = (await pool.query(`SELECT id FROM camera_events WHERE camera_id = $1 ORDER BY occurred_at`, [id])).rows;
  const snap = (await pool.query(`SELECT content_type, length(bytes)::int AS n FROM camera_snapshots WHERE event_id = $1`, [ev[0].id])).rows[0];
  assert.deepEqual(snap, { content_type: 'image/jpeg', n: jpeg.length });
  // the picture comes back only to the manager, as an image, never cached publicly
  const img = await fetch(base + `/cameras/security/${ev[0].id}/snapshot`, { headers: { cookie: manager.cookie() } });
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg'); assert.match(img.headers.get('cache-control'), /private/);
  assert.equal((await img.arrayBuffer()).byteLength, jpeg.length);
  assert.equal((await registrar.get(`/cameras/security/${ev[0].id}/snapshot`)).status, 403);
  assert.equal((await t2.get(`/cameras/security/${ev[0].id}/snapshot`)).status, 404);
  const list = (await manager.get('/cameras/security?from=2026-10-17&to=2026-10-17')).body.data.find((x) => x.id === ev[0].id);
  assert.equal(list.has_snapshot, true);
  // 2) a face match with a picture → the picture is never kept (the event is, if the code is known)
  const code = (await manager.get('/cameras/face-codes')).body.data.find((x) => x.membership_id === M.cashier).code;
  const face = multipart('alarmResult', ALARM('2026-10-17T08:40:00+05:00', code, 0.95));
  res = await push(path, face, 'multipart/form-data; boundary=boundary'); assert.equal((await res.json()).stored, 1);
  // 3) loitering (a new kind) at night → alert with the picture; a PNG is accepted, junk and oversized pictures are not
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
  m = securityMultipart('loitering', '2026-10-17T23:20:00+05:00', png);
  res = await push(path, m.body, m.type); assert.equal((await res.json()).stored, 1);
  m = securityMultipart('linedetection', '2026-10-17T23:30:00+05:00', Buffer.from('not a picture at all, just text bytes that are long enough to pass the size floor'));
  res = await push(path, m.body, m.type); assert.equal((await res.json()).stored, 1);
  m = securityMultipart('regionEntrance', '2026-10-17T23:40:00+05:00', Buffer.concat([jpeg, Buffer.alloc(1024 * 1024, 0)]));
  res = await push(path, m.body, m.type); assert.equal((await res.json()).stored, 1);
  const byKind = (await pool.query(`SELECT e.kind, e.alert, (s.event_id IS NOT NULL) AS has_snapshot, s.content_type FROM camera_events e LEFT JOIN camera_snapshots s ON s.event_id = e.id WHERE e.camera_id = $1 ORDER BY e.occurred_at`, [id])).rows;
  assert.deepEqual(byKind.map((x) => [x.kind, x.alert, x.has_snapshot, x.content_type]), [
    ['face_match', false, false, null], ['intrusion', true, true, 'image/jpeg'], ['loitering', true, true, 'image/png'], ['line_crossing', true, false, null], ['region_entrance', true, false, null],
  ]);
  // 4) the same camera with snapshots switched off: the alert is stored, the picture is not
  assert.equal((await manager.patch(`/cameras/${id}`, { alert_snapshots: false })).status, 200);
  m = securityMultipart('fielddetection', '2026-10-17T23:50:00+05:00', jpeg);
  res = await push(path, m.body, m.type); assert.equal((await res.json()).stored, 1);
  const last = (await pool.query(`SELECT e.alert, (s.event_id IS NOT NULL) AS has_snapshot FROM camera_events e LEFT JOIN camera_snapshots s ON s.event_id = e.id WHERE e.camera_id = $1 ORDER BY e.occurred_at DESC LIMIT 1`, [id])).rows[0];
  assert.deepEqual(last, { alert: true, has_snapshot: false });
  // 5) an after-hours camera by day: no alert → no picture even with snapshots on
  const r2 = await manager.post('/cameras', { branch_id: BC, name: 'Kunduzgi kamera', purposes: ['security'], security_mode: 'after_hours', alert_snapshots: true });
  m = securityMultipart('fielddetection', '2026-10-14T10:00:00+05:00', jpeg);
  res = await push(r2.body.data.push_path, m.body, m.type); assert.equal((await res.json()).stored, 1);
  const day = (await pool.query(`SELECT e.alert, (s.event_id IS NOT NULL) AS has_snapshot FROM camera_events e LEFT JOIN camera_snapshots s ON s.event_id = e.id WHERE e.camera_id = $1`, [r2.body.data.id])).rows[0];
  assert.deepEqual(day, { alert: false, has_snapshot: false });
  // 6) snapshots are immutable and purged after the retention (an old one is planted on the picture-less line crossing)
  await assert.rejects(pool.query(`UPDATE camera_snapshots SET content_type = 'image/png' WHERE event_id = $1`, [ev[0].id]), /append-only/);
  const before = (await pool.query(`SELECT count(*)::int AS n FROM camera_snapshots`)).rows[0].n;
  const lineId = (await pool.query(`SELECT id FROM camera_events WHERE camera_id = $1 AND kind = 'line_crossing'`, [id])).rows[0].id;
  await pool.query(`INSERT INTO camera_snapshots (event_id, tenant_id, content_type, bytes, created_at) SELECT id, tenant_id, 'image/jpeg', $2, demo_now() - interval '31 days' FROM camera_events WHERE id = $1`, [lineId, jpeg]);
  assert.equal(await purgeSnapshots(pool), 1, 'faqat 31 kunlik surat o‘chdi');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM camera_snapshots`)).rows[0].n, before);
  // 7) the demo simulator attaches a drawn frame to a security alert
  const sim = await manager.post(`/cameras/${r2.body.data.id}/simulate`, { kind: 'tamper' });
  assert.equal(sim.status, 200);
  if (sim.body.data.stored) {
    const s = (await pool.query(`SELECT e.alert, (sn.event_id IS NOT NULL) AS has_snapshot FROM camera_events e LEFT JOIN camera_snapshots sn ON sn.event_id = e.id WHERE e.id = $1`, [sim.body.data.event_id])).rows[0];
    assert.equal(s.has_snapshot, s.alert, 'simulyator: surat faqat ogohlantirishda');
  }
});

test('eski demo bazasi: suratlar bir marta qo‘shiladi, mavjud ogohlantirishlar takrorlanmaydi', async () => {
  const { backfillSeedSnapshots } = require('@meduza/db');
  const count = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM camera_events WHERE alert) AS alerts, (SELECT count(*)::int FROM camera_snapshots WHERE tenant_id = $1) AS snaps,
    (SELECT count(*)::int FROM camera_snapshots s JOIN camera_events e ON e.id = s.event_id WHERE e.dedupe_key LIKE 'seed:%') AS seed_snaps, (SELECT count(*)::int FROM cameras WHERE tenant_id = $1) AS cams`, [SEED_IDS.tenant])).rows[0];
  const before = await count();
  assert.ok(before.seed_snaps >= 8);
  await pool.query(`DELETE FROM camera_snapshots WHERE tenant_id = $1`, [SEED_IDS.tenant]); // a database seeded before migration 016 (the test's own snapshots go too)
  assert.equal(await backfillSeedSnapshots(pool, '2026-10-18'), before.seed_snaps, 'seed suratlari qayta qo‘shildi');
  before.snaps = before.seed_snaps;
  assert.deepEqual(await count(), before, 'hodisalar va kameralar takrorlanmadi');
  assert.equal(await backfillSeedSnapshots(pool, '2026-10-18'), 0, 'ikkinchi marta hech narsa qilmaydi');
});

test('tekshiruv tuzatishlari: filial doirasi, eski ochiq ogohlantirish, o‘chirilgan kamera, koddan oldingi kunlar, noto‘g‘ri qiymatlar', async () => {
  const BY = SEED_IDS.branchYunusobod;
  // a manager limited to Yunusobod cannot give or revoke the code of a central-branch doctor
  const feruza = (await manager.get('/cameras/face-codes')).body.data.find((x) => x.membership_id === M.doctor(1));
  await pool.query(`UPDATE memberships SET branch_ids = ARRAY[$2::uuid] WHERE id = $1`, [M.manager, BY]);
  try {
    assert.equal((await manager.post('/cameras/face-codes', { membership_id: M.doctor(1), consent_confirmed: true })).status, 404);
    assert.equal((await manager.del(`/cameras/face-codes/${feruza.face_code_id}`)).status, 404);
  } finally { await pool.query(`UPDATE memberships SET branch_ids = ARRAY[$2::uuid, $3::uuid] WHERE id = $1`, [M.manager, BC, BY]); }
  // an unacknowledged alert from long ago is still listed (and counted)
  const { ingestEvent } = require('../dist/cameras/ingest.js');
  const store = (await pool.query(`SELECT * FROM cameras WHERE name = 'Dori ombori' AND tenant_id = $1`, [SEED_IDS.tenant])).rows[0];
  const old = await ingestEvent(pool, store, { kind: 'tamper', occurredAt: new Date('2026-09-01T20:00:00Z'), sourceKey: 'old-alert' });
  const sec = (await manager.get('/cameras/security?from=2026-10-12&to=2026-10-18&alerts_only=1')).body;
  assert.ok(sec.data.some((r) => r.id === old.event_id), 'eski ochiq ogohlantirish ro‘yxatda');
  assert.equal(sec.data.filter((r) => !r.acked_at).length, sec.meta.open_alerts);
  // the simulator stores nothing for a switched-off camera
  const off = await manager.post('/cameras', { branch_id: BC, name: 'O‘chirilgan', purposes: ['security'], security_mode: 'always' });
  await manager.patch(`/cameras/${off.body.data.id}`, { status: 'disabled' });
  assert.deepEqual((await manager.post(`/cameras/${off.body.data.id}/simulate`, { kind: 'intrusion' })).body.data, { stored: false, ignored: 'disabled' });
  // no «absent» days before anyone could have been seen (a person whose first code is from today)
  const fresh = (await pool.query(`SELECT m.id FROM memberships m WHERE m.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM face_codes f WHERE f.membership_id = m.id) LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  if (fresh) {
    await manager.post('/cameras/face-codes', { membership_id: fresh.id, consent_confirmed: true });
    const att = (await manager.get('/cameras/attendance?from=2026-10-12&to=2026-10-18')).body.data.filter((x) => x.membership_id === fresh.id);
    assert.ok(att.every((x) => x.day >= '2026-10-18'), 'koddan oldingi kunlar yo‘q');
  }
  // values out of range from a camera are dropped instead of failing the request
  const { parseIsapi } = require('../dist/cameras/isapi.js');
  const bad = parseIsapi(Buffer.from(`<EventNotificationAlert><dateTime>2026-10-17T10:00:00+05:00</dateTime><eventType>PeopleCounting</eventType><eventState>active</eventState>
    <peopleCounting><statisticalMethods>timeRange</statisticalMethods><TimeRange><startTime>2026-10-17T09:00:00+05:00</startTime><endTime>2026-10-17T10:00:00+05:00</endTime></TimeRange><enter>-1</enter><exit>abc</exit></peopleCounting></EventNotificationAlert>`), 'application/xml');
  assert.equal(bad.events.length, 0);
  const sim = parseIsapi(Buffer.from(JSON.stringify({ eventType: 'alarmResult', eventState: 'active', dateTime: '2026-10-17T10:00:00+05:00',
    alarmResult: [{ faces: [{ identify: [{ candidate: [{ reserve_field: { certificateNumber: 'S-1' }, similarity: 250 }] }] }] }] })), 'application/json');
  assert.equal(sim.events[0].similarity, null, '100 % dan katta o‘xshashlik tashlanadi');
});

test('kamera soati: 9999-yil yoki bir yildan eski hodisa saqlanmaydi; demo soatidan oldinda yurgan haqiqiy vaqt qabul qilinadi', async () => {
  const { ingestEvent } = require('../dist/cameras/ingest.js');
  const cam = (await pool.query(`SELECT * FROM cameras WHERE name = 'Asosiy kirish' AND tenant_id = $1`, [SEED_IDS.tenant])).rows[0];
  assert.deepEqual(await ingestEvent(pool, cam, { kind: 'people_count', occurredAt: new Date('9999-01-01T00:00:00Z'), enter: 1, exit: 0, sourceKey: 'y9999' }), { stored: false, ignored: 'bad_time' });
  assert.deepEqual(await ingestEvent(pool, cam, { kind: 'people_count', occurredAt: new Date('2020-01-01T00:00:00Z'), enter: 1, exit: 0, sourceKey: 'y2020' }), { stored: false, ignored: 'bad_time' });
  assert.equal((await ingestEvent(pool, cam, { kind: 'people_count', occurredAt: new Date(), enter: 1, exit: 0, sourceKey: 'real-now' })).stored, true);
});

test('tools/hik-replay.mjs: haqiqiy formatdagi xabarlar serverga yetadi va to‘g‘ri saqlanadi', async () => {
  const { execFile } = await import('node:child_process');
  const run = (args) => new Promise((resolve) => execFile(process.execPath, ['../../tools/hik-replay.mjs', ...args], { cwd: new URL('..', import.meta.url).pathname }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr })));
  const r = await manager.post('/cameras', { branch_id: BC, name: 'Replay kamera', purposes: ['attendance', 'patient_arrival', 'counting', 'security'], security_mode: 'always' });
  const url = base.replace('/api/v1', '') + r.body.data.push_path;
  const patient = (await pool.query(`SELECT code FROM face_codes WHERE tenant_id = $1 AND subject_type = 'patient' AND revoked_at IS NULL ORDER BY code LIMIT 1`, [SEED_IDS.tenant])).rows[0].code;
  const staff = (await pool.query(`SELECT code FROM face_codes WHERE tenant_id = $1 AND subject_type = 'staff' AND revoked_at IS NULL ORDER BY code LIMIT 2`, [SEED_IDS.tenant])).rows.map((x) => x.code);
  const res = await run([url, 'all', '--codes', staff.join(','), '--code', patient, '--time', '2026-10-17T08:47:00+05:00']);
  assert.equal(res.code, 0, res.out);
  const kinds = (await pool.query(`SELECT kind, count(*)::int AS n FROM camera_events WHERE camera_id = $1 GROUP BY 1`, [r.body.data.id])).rows;
  const n = (k) => kinds.find((x) => x.kind === k)?.n ?? 0;
  assert.equal(n('face_match'), 3, 'ikki xodim + bemor');
  assert.equal(n('people_count'), 3);
  assert.equal(n('intrusion') + n('line_crossing') + n('region_entrance'), 3);
  assert.ok((await pool.query(`SELECT last_seen_at FROM cameras WHERE id = $1`, [r.body.data.id])).rows[0].last_seen_at);
  const dry = await run([url, 'night', '--dry']);
  assert.match(dry.out, /fielddetection/); assert.equal(dry.code, 0);
  assert.notEqual((await run(['http://x/api/v1/hik/short', 'all'])).code, 0, 'noto‘g‘ri manzil rad etiladi');
});
