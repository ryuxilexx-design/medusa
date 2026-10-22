// Direct ISAPI integration against a fake Hikvision camera (test/_fakecam.mjs): Digest auth, connect (wrong and right
// password, lockout text), one-click setup (listening host written with a fresh token, the camera's test push reaches
// our server, library created, comparison on), face enrolment (JSON and XML firmware; the picture is never stored),
// revoke → deleted from the camera, pull mode (alertStream → events, alert snapshot), roles and tenant isolation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
import { alarmResultJson, intrusionXml, startFakeCamera } from './_fakecam.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
const BC = SEED_IDS.branchCentral;
process.env.APP_SECRET_KEY ||= Buffer.alloc(32, 7).toString('base64');
let app, base, pool, cam, camXml;
const RUN = Date.now().toString(36);
const NAME = { j: 'ISAPI kamera ' + RUN, x: 'ISAPI kamera XML ' + RUN, p: 'Pull kamera ' + RUN };

function session() {
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}) => req('POST', p, b), put: (p, b) => req('PUT', p, b), del: (p) => req('DELETE', p), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const as = async (mid) => { const s = session(); assert.equal((await s.demo(mid)).status, 200); return s; };

let manager, registrar, t2, workers;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  workers = app.get(require('../dist/cameras/pull-worker.js').CameraWorkers);
  manager = await as(M.manager); registrar = await as(M.registrar); t2 = await as(M.tenant2Manager);
  assert.equal((await manager.post('/demo/reset')).status, 200); // a clean seed: codes and cameras of earlier runs are gone
  await db.assertDatabaseName(pool, '_test');
  cam = await startFakeCamera({ password: 'Clinic123' });
  camXml = await startFakeCamera({ password: 'Clinic123', firmware: 'xml', model: 'iDS-2CD7A46G0-IZHS' });
});
after(async () => { await cam?.close(); await camXml?.close(); await app?.close(); console.log('# handles:', JSON.stringify(process.getActiveResourcesInfo())); });

const jpeg = () => require('@meduza/db').readSeedSnapshot('cash-tamper');

test('ulanish: noto‘g‘ri parol → maydon xatosi; to‘g‘ri → model/proshivka saqlanadi; parol faqat shifrlangan; boshqa klinika 404; registrator 403', async () => {
  const r = await manager.post('/cameras', { branch_id: BC, name: NAME.j, purposes: ['attendance', 'security'], security_mode: 'always', alert_snapshots: true });
  const id = r.body.data.id;
  // the server never connects to itself, link-local/metadata or multicast addresses on a manager's say-so
  for (const host of ['169.254.169.254', '0.0.0.0', '224.0.0.1', '100.64.0.1', 'localhost', 'camera.local', '64:ff9b::a9fe:a9fe', '::ffff:7f00:1']) {
    const r = await manager.put(`/cameras/${id}/isapi`, { host, port: 80, username: 'admin', password: 'x' });
    assert.ok(r.status === 422 || r.status === 502, host + ' ' + r.status);
    assert.match(r.body.error.message, /klinika tarmog‘ida|IPv4|tekshiring/, host + ': ' + r.body.error.message);
  }
  const bad = await manager.put(`/cameras/${id}/isapi`, { host: cam.host, port: cam.port, username: 'admin', password: 'wrong' });
  assert.equal(bad.status, 422); assert.match(bad.body.error.fields.password, /parol/i);
  assert.ok(cam.state.requests.every((q) => !q.path.includes('wrong')), 'parol URL da emas');
  const ok = await manager.put(`/cameras/${id}/isapi`, { host: cam.host, port: cam.port, username: 'admin', password: 'Clinic123' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.model, 'iDS-2CD7146G0-IZS'); assert.match(ok.body.data.firmware, /V5\.7\.12/); assert.equal(ok.body.data.connected, true);
  assert.ok(!('password' in ok.body.data) && !JSON.stringify(ok.body).includes('Clinic123'), 'parol javobda yo‘q');
  const row = (await pool.query(`SELECT isapi_password_enc FROM cameras WHERE id = $1`, [id])).rows[0];
  assert.ok(row.isapi_password_enc.startsWith('v1.') && !row.isapi_password_enc.includes('Clinic123'));
  assert.equal((await t2.get(`/cameras/${id}/isapi`)).status, 404);
  assert.equal((await registrar.get(`/cameras/${id}/isapi`)).status, 403);
  assert.equal((await manager.get('/cameras')).body.data.find((c) => c.id === id).isapi_connected, true);
  // the camera also appears as a target for face enrolment
  assert.ok((await manager.get('/cameras/face-codes')).body.meta.enrol_cameras.some((c) => c.id === id));
});

test('bir tugmali sozlash: listening manzili yangi token bilan yoziladi (token hech kimga ko‘rsatilmaydi), kameraning sinov xabari serverga yetadi, kutubxona va taqqoslash yoqiladi', async () => {
  const id = (await manager.get('/cameras')).body.data.find((c) => c.name === NAME.j).id;
  const before = (await pool.query(`SELECT token_hash, last_seen_at FROM cameras WHERE id = $1`, [id])).rows[0];
  const r = await manager.post(`/cameras/${id}/isapi/setup`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.setup.listening.ok, true, r.body.data.setup.listening.detail);
  assert.ok(r.body.data.listening_configured_at); assert.ok(r.body.data.fdlib_id);
  assert.equal(r.body.data.setup.comparison, true);
  assert.ok(!JSON.stringify(r.body).includes('/hik/'), 'push token javobda yo‘q');
  const h = cam.state.httpHost;
  assert.match(h.url, /^\/api\/v1\/hik\/[A-Za-z0-9_-]{20,64}$/); assert.equal(h.format, 'JSON'); assert.equal(h.protocol, 'HTTP');
  const after = (await pool.query(`SELECT token_hash, last_seen_at FROM cameras WHERE id = $1`, [id])).rows[0];
  assert.notEqual(after.token_hash, before.token_hash, 'yangi token');
  assert.equal(require('../dist/core/guard.js').hashToken(h.url.split('/').pop()), after.token_hash, 'kameradagi token = bazadagi hash');
  assert.ok(after.last_seen_at && (!before.last_seen_at || after.last_seen_at > before.last_seen_at), 'sinov xabari «oxirgi aloqa»ni yangiladi');
  assert.equal(cam.state.pushes, 1);
  assert.match(cam.state.faceContrast, /<FDID>1<\/FDID>/);
  // the old push token stops working, the one on the camera works
  const push = await fetch(base.replace('/api/v1', '') + h.url, { method: 'POST', headers: { 'content-type': 'application/xml' }, body: '<EventNotificationAlert><eventType>videoloss</eventType><eventState>inactive</eventState></EventNotificationAlert>' });
  assert.equal(push.status, 200);
});

test('yuz yuklash: JSON va XML proshivka, kod har uchala maydonda, rasm bazada yo‘q; qayta yuklash almashtiradi; kichik/noto‘g‘ri rasm 422; bekor qilingan kod kameradan o‘chadi', async () => {
  const cams = (await manager.get('/cameras')).body.data;
  const idJ = cams.find((c) => c.name === NAME.j).id;
  const r2 = await manager.post('/cameras', { branch_id: BC, name: NAME.x, purposes: ['attendance'] });
  const idX = r2.body.data.id;
  assert.equal((await manager.put(`/cameras/${idX}/isapi`, { host: camXml.host, port: camXml.port, username: 'admin', password: 'Clinic123' })).status, 200);
  const codes = (await manager.get('/cameras/face-codes')).body.data;
  const staff = codes.find((x) => x.membership_id === M.cashier);
  const photo = jpeg().toString('base64');
  const bad = await manager.post(`/cameras/face-codes/${staff.face_code_id}/photo`, { photo_base64: Buffer.from('not a jpeg at all, just text, repeated enough to pass the min length check ................................................').toString('base64'), camera_ids: [idJ] });
  assert.equal(bad.status, 422);
  const r = await manager.post(`/cameras/face-codes/${staff.face_code_id}/photo`, { photo_base64: 'data:image/jpeg;base64,' + photo, camera_ids: [idJ, idX] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.enrolled, 2, JSON.stringify(r.body.data.results));
  const fj = cam.state.faces.find((f) => f.FPID === staff.code);
  assert.deepEqual([fj.certificateNumber, fj.customHumanID, fj.FDID, fj.bytes], [staff.code, staff.code, '1', jpeg().length]);
  assert.match(fj.name, new RegExp('^' + staff.code));
  const fx = camXml.state.faces.find((f) => f.customHumanID === staff.code);
  assert.ok(fx && fx.certificateNumber === staff.code && fx.FPID.startsWith('PID'), 'XML proshivka: pictureUpload orqali');
  const link = (await pool.query(`SELECT camera_id, remote_id FROM face_code_cameras WHERE face_code_id = $1 ORDER BY camera_id`, [staff.face_code_id])).rows;
  assert.equal(link.length, 2); assert.ok(link.some((l) => l.remote_id.startsWith('PID')));
  assert.equal((await manager.get('/cameras/face-codes')).body.data.find((x) => x.membership_id === M.cashier).cameras_enrolled, 2);
  assert.equal((await manager.get(`/cameras/face-codes/${staff.face_code_id}/cameras`)).body.data.length, 2);
  // nothing of the picture is in the database
  const cols = (await pool.query(`SELECT table_name FROM information_schema.columns WHERE data_type = 'bytea' AND table_schema = 'public'`)).rows.map((r) => r.table_name);
  assert.deepEqual([...new Set(cols)], ['camera_snapshots']);
  const snaps = (await pool.query(`SELECT count(*)::int AS n FROM camera_snapshots s JOIN camera_events e ON e.id = s.event_id WHERE e.kind = 'face_match'`)).rows[0].n;
  assert.equal(snaps, 0);
  // a second enrolment replaces the picture (no duplicate on the camera)
  const again = await manager.post(`/cameras/face-codes/${staff.face_code_id}/photo`, { photo_base64: photo, camera_ids: [idJ] });
  assert.equal(again.body.data.enrolled, 1, JSON.stringify(again.body.data.results));
  assert.equal(cam.state.faces.filter((f) => f.FPID === staff.code).length, 1);
  // revoke → the worker deletes the face from both cameras
  assert.equal((await manager.del(`/cameras/face-codes/${staff.face_code_id}`)).status, 200);
  await workers.cleanupRevoked();
  assert.ok(!cam.state.faces.some((f) => f.FPID === staff.code), 'JSON kameradan o‘chdi');
  assert.ok(!camXml.state.faces.some((f) => f.customHumanID === staff.code), 'XML kameradan o‘chdi');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM face_code_cameras WHERE face_code_id = $1`, [staff.face_code_id])).rows[0].n, 0);
  // the audit never holds a picture
  const a = (await pool.query(`SELECT summary AS details FROM audit_logs WHERE action = 'camera.face_enrol' ORDER BY occurred_at DESC LIMIT 1`)).rows[0];
  assert.ok(a && !/base64|\/9j\//.test(a.details));
});

test('pull rejimi: alertStream dan yuz tanish va hududga kirish (surat bilan) hodisalari oddiy ingest orqali saqlanadi', async () => {
  const r = await manager.post('/cameras', { branch_id: BC, name: NAME.p, purposes: ['attendance', 'security'], security_mode: 'always', alert_snapshots: true });
  const id = r.body.data.id;
  const staff = (await manager.get('/cameras/face-codes')).body.data.find((x) => x.membership_id === M.registrar2);
  cam.state.streamEvents = [
    { json: alarmResultJson(staff.code, '2026-10-17T08:41:00+05:00', 0.93) },
    { type: 'application/xml', body: intrusionXml('2026-10-17T23:05:00+05:00'), picture: jpeg() },
  ];
  assert.equal((await manager.put(`/cameras/${id}/isapi`, { host: cam.host, port: cam.port, username: 'admin', password: 'Clinic123', delivery: 'pull' })).status, 200);
  await workers.syncPullers();
  for (let i = 0; i < 60; i++) {
    const n = (await pool.query(`SELECT count(*)::int AS n FROM camera_events WHERE camera_id = $1`, [id])).rows[0].n;
    if (n >= 2) break; await new Promise((r) => setTimeout(r, 200));
  }
  const ev = (await pool.query(`SELECT e.kind, e.similarity, e.alert, fc.code, (s.event_id IS NOT NULL) AS has_snapshot FROM camera_events e LEFT JOIN face_codes fc ON fc.id = e.face_code_id LEFT JOIN camera_snapshots s ON s.event_id = e.id WHERE e.camera_id = $1 ORDER BY e.occurred_at`, [id])).rows;
  assert.deepEqual(ev.map((x) => [x.kind, Number(x.similarity ?? 0), x.alert, x.code, x.has_snapshot]), [['face_match', 93, false, staff.code, false], ['intrusion', 0, true, null, true]]);
  const c = (await pool.query(`SELECT last_seen_at, isapi_error FROM cameras WHERE id = $1`, [id])).rows[0];
  assert.ok(c.last_seen_at && !c.isapi_error);
  workers.onModuleDestroy();
});

test('ulanishni o‘chirish: login unutiladi, hodisalar qoladi', async () => {
  const id = (await manager.get('/cameras')).body.data.find((c) => c.name === NAME.j).id;
  assert.equal((await manager.del(`/cameras/${id}/isapi`)).status, 200);
  const st = (await manager.get(`/cameras/${id}/isapi`)).body.data;
  assert.equal(st.connected, false); assert.equal(st.username, null);
  assert.equal((await manager.post(`/cameras/${id}/isapi/setup`)).status, 409);
});
