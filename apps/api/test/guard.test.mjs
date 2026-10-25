// Security guard «Qorovul» (migration 038, docs/SECURITY_GUARD.md): the guard's privacy boundary (403 sweep over the
// patient, clinical, finance and warehouse endpoints), tenant isolation (404) and branch scope (403), the patient code
// masked as «Bemor», alert snapshots for the guard (alert only, ≤ 30 days, audited), alert handling with races (409),
// incidents (append-only, corrections, manager close), SOS → manager alarm, the visitor log (no ID numbers, purge
// after the retention period), keys, patrol rounds, the post shift and its handover, staff on site, manager stats and
// CSV exports, the append-only triggers and the seed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS, GUARD_IDS } = db;
const M = SEED_IDS.membership;
const BC = SEED_IDS.branchCentral, BY = SEED_IDS.branchYunusobod;
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t, type: r.headers.get('content-type') };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}) => req('POST', p, b), put: (p, b) => req('PUT', p, b), patch: (p, b) => req('PATCH', p, b), del: (p) => req('DELETE', p), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}

let guard, guard2, manager, registrar, cashier, doctor, lab, keeper, t2;
let today;
const fx = {};
const one = async (sql, p = []) => (await pool.query(sql, p)).rows[0];
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  guard = session(); assert.equal((await guard.demo(GUARD_IDS.bahodir)).status, 200);
  guard2 = session(); assert.equal((await guard2.demo(GUARD_IDS.dilshod)).status, 200);
  registrar = session(); await registrar.demo(M.registrar);
  cashier = session(); await cashier.demo(M.cashier);
  doctor = session(); await doctor.demo(M.doctor(0));
  lab = session(); await lab.demo(M.lab);
  keeper = session(); await keeper.demo(M.storekeeper);
  t2 = session(); await t2.demo(M.tenant2Manager);
  today = (await guard.get('/me')).body.data.today;
  const a = (await doctor.get(`/appointments?date=${today}`)).body.data.find((x) => x.encounter_id);
  fx.encounter = a?.encounter_id ?? (await one(`SELECT id FROM encounters WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant])).id; fx.patient = a?.patient_id ?? (await one(`SELECT id FROM patients WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant])).id;
  fx.appointment = a?.id ?? (await one(`SELECT id FROM appointments WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant])).id;
  fx.invoice = (await one(`SELECT id FROM invoices WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant])).id;
  fx.payment = (await one(`SELECT id FROM payments WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant])).id;
  fx.order = (await one(`SELECT id FROM service_orders WHERE tenant_id = $1 AND category = 'lab' LIMIT 1`, [SEED_IDS.tenant])).id;
  fx.item = (await one(`SELECT id FROM inventory_items WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant])).id;
  fx.camStore = (await one(`SELECT id FROM cameras WHERE tenant_id = $1 AND name = 'Dori ombori'`, [SEED_IDS.tenant])).id;
  fx.camEntry = (await one(`SELECT id FROM cameras WHERE tenant_id = $1 AND name = 'Asosiy kirish'`, [SEED_IDS.tenant])).id;
});
after(async () => { await app?.close(); });

/** A fresh alert on the store camera («always» mode), through the same ingest as a real camera. */
async function newAlert(kind = 'intrusion') {
  const r = await manager.post(`/cameras/${fx.camStore}/simulate`, { kind });
  assert.equal(r.status, 200); assert.ok(r.body.data.stored);
  return r.body.data.event_id;
}
const alertRow = async (s, id) => (await s.get('/security/alerts?state=open&page_size=100')).body.data.find((x) => x.id === id)
  ?? (await s.get(`/security/alerts?from=${today}&to=${today}&page_size=100`)).body.data.find((x) => x.id === id);

test('seed: Qorovul demo kartasi, smenalar, obxodlar, hodisalar, tashriflar, kalitlar; asosiy KPI o‘zgarmagan', async () => {
  const cards = (await session().get('/demo/accounts')).body.data;
  assert.ok(cards.some((c) => c.role === 'guard' && c.membership_id === GUARD_IDS.bahodir && c.full_name === 'Bahodir Usmonov'));
  assert.equal(cards.filter((c) => c.role === 'guard').length, 1, 'faqat bitta qorovul kartasi');
  const me = (await guard.get('/me')).body.data;
  assert.equal(me.role, 'guard'); assert.deepEqual(me.branches.map((b) => b.id), [BC]);
  const n = await one(`SELECT (SELECT count(*)::int FROM guard_shifts) s, (SELECT count(*)::int FROM patrol_rounds) r, (SELECT count(*)::int FROM security_incidents) i,
    (SELECT count(*)::int FROM security_alert_actions) a, (SELECT count(*)::int FROM security_visitors) v, (SELECT count(*)::int FROM key_events) k`);
  assert.ok(n.s >= 40 && n.r >= 100 && n.i >= 10 && n.a >= 20 && n.v >= 40 && n.k >= 100, JSON.stringify(n));
  // one escalated alert that the manager then closed, one alert filed as an incident
  assert.ok(await one(`SELECT 1 FROM security_alert_actions WHERE outcome = 'escalated'`));
  assert.ok(await one(`SELECT 1 FROM security_alert_actions a JOIN security_incidents i ON i.id = a.incident_id WHERE a.outcome = 'incident' AND i.alert_event_id = a.event_id`));
  // the dashboard KPIs of the main seed did not move (docs/DEMO_SCRIPT.md)
  const d = (await manager.get('/dashboard')).body.data;
  assert.ok(d, 'dashboard');
  const counters = await one(`SELECT last FROM security_counters WHERE tenant_id = $1 AND kind = 'incident'`, [SEED_IDS.tenant]);
  assert.equal(counters.last, n.i);
});

test('maxfiylik: qorovul bemor, qabul, klinik, moliya, ombor va sozlamalarga kira olmaydi (403)', async () => {
  const forbidden = ['/patients', `/patients/${fx.patient}`, `/patients/${fx.patient}/card`, `/patients/${fx.patient}/history`, `/patients/${fx.patient}/consents`,
    `/patients/${fx.patient}/export.json`, `/patients/${fx.patient}/deposits`, `/patients/${fx.patient}/allergies`,
    `/appointments?date=${today}`, `/appointments/${fx.appointment}`, `/appointments/${fx.appointment}/intake`, '/queue', `/encounters/${fx.encounter}`, '/doctor/patient-history',
    `/encounters/${fx.encounter}/documents`, `/encounters/${fx.encounter}/patient-summaries`, '/orders', `/orders/${fx.order}`, '/diagnostics', '/icd10?q=I10', '/drugs?q=para',
    '/invoices', `/invoices/${fx.invoice}`, '/invoices/debtors.csv', '/payments', `/payments/${fx.payment}`, '/cash-shifts/current', '/cash-shifts', '/refunds', '/finance/summary',
    '/expenses', '/dashboard', '/reports/doctors', '/reports/services', '/staff', '/audit', '/ai/digest', '/ai/usage', '/news',
    '/inventory', `/inventory/${fx.item}`, '/warehouse/stock', '/warehouse/summary', '/warehouse/catalog', '/warehouse/requests', '/warehouse/reorder',
    '/cameras', '/cameras/security', '/cameras/attendance', '/cameras/traffic', '/cameras/face-codes', '/cameras/arrivals', `/cameras/${fx.camStore}/isapi`,
    '/settings', '/services', '/doctors', '/telegram', '/sms/settings', '/schedule-exceptions', '/note-templates', '/quick-phrases', '/dhp/settings',
    // the manager's own security views
    '/security/stats', '/security/alarms', `/security/incidents.csv?from=${today}&to=${today}`, `/security/visitors.csv?from=${today}&to=${today}`, `/security/alerts.csv?from=${today}&to=${today}`];
  const bad = [];
  for (const p of forbidden) { const r = await guard.get(p); if (r.status !== 403) bad.push(`${p} → ${r.status}`); }
  assert.deepEqual(bad, [], 'qorovulga 403 bo‘lishi kerak');
  for (const [p, b] of [['/patients', { last_name: 'X' }], ['/appointments', {}], [`/invoices/${fx.invoice}/payments`, {}], ['/warehouse/requests', {}], ['/staff', {}],
    [`/cameras/security/${fx.camStore}/ack`, {}], ['/security/checkpoints', { branch_id: BC, name: 'Sinov' }]]) {
    assert.equal((await guard.post(p, b)).status, 403, `POST ${p}`);
  }
  // what the guard may use
  for (const p of ['/me', '/branches', '/rooms', '/security/overview', '/security/alerts', '/security/incidents', '/security/visitors?inside=1', '/security/keys', '/security/rounds/current', '/security/shifts/current', '/security/presence', '/security/staff'])
    assert.equal((await guard.get(p)).status, 200, p);
  // other roles never see the guard's section
  for (const s of [registrar, cashier, doctor, lab, keeper]) for (const p of ['/security/overview', '/security/alerts', '/security/visitors?inside=1', '/security/incidents'])
    assert.equal((await s.get(p)).status, 403, p);
});

test('bemor kodi qorovulga faqat «Bemor»: na ism, na raqam, na P-kod; bemor oqimi faqat son', async () => {
  const p = await one(`SELECT fc.code, pt.last_name, pt.first_name, pt.patient_number FROM face_codes fc JOIN patients pt ON pt.id = fc.patient_id
     WHERE fc.tenant_id = $1 AND fc.subject_type = 'patient' AND fc.revoked_at IS NULL AND EXISTS (SELECT 1 FROM patient_consents c WHERE c.patient_id = pt.id AND c.kind = 'biometric' AND c.granted) LIMIT 1`, [SEED_IDS.tenant]);
  const r = await manager.post(`/cameras/${fx.camEntry}/simulate`, { kind: 'face_match', code: p.code });
  assert.equal(r.status, 200); assert.ok(r.body.data.stored);
  const staffCode = (await one(`SELECT code FROM face_codes WHERE tenant_id = $1 AND membership_id = $2`, [SEED_IDS.tenant, M.cashier])).code;
  await manager.post(`/cameras/${fx.camEntry}/simulate`, { kind: 'face_match', code: staffCode });
  const ov = await guard.get('/security/overview');
  assert.equal(ov.status, 200);
  const faces = ov.body.data.recent_faces;
  const pat = faces.find((f) => f.subject === 'patient');
  assert.ok(pat, 'bemor tanilgani ko‘rinadi');
  assert.deepEqual(Object.keys(pat).sort(), ['at', 'camera_name', 'subject']);
  assert.ok(faces.some((f) => f.subject === 'staff' && f.name === 'Nodira Aliyeva' && f.title), 'xodim ismi va lavozimi');
  const txt = JSON.stringify(ov.body);
  for (const leak of [`"${p.code}"`, `${p.last_name} ${p.first_name}`, `"patient_number"`, `"patient_id"`]) assert.ok(!txt.includes(leak), `oshkor bo‘ldi: ${leak}`);
  for (const h of ov.body.data.arrivals_by_hour) assert.deepEqual(Object.keys(h).sort(), ['came', 'hour', 'n']);
  // every guard list: no patient field anywhere
  for (const path of ['/security/alerts', '/security/presence', '/security/visitors', `/security/keys`, '/security/incidents'])
    assert.ok(!/patient_(id|number)|"last_name"|"phone"|birth_date/.test((await guard.get(path)).text), path);
});

test('ogohlantirish surati: qorovul o‘z filialida ko‘radi (audit), face_match/eski surat 404, boshqa rollar 403', async () => {
  const s = await one(`SELECT s.event_id FROM camera_snapshots s JOIN camera_events e ON e.id = s.event_id WHERE e.tenant_id = $1 AND e.branch_id = $2 AND e.alert LIMIT 1`, [SEED_IDS.tenant, BC]);
  const r = await fetch(`${base}/security/alerts/${s.event_id}/snapshot`, { headers: { cookie: await cookieOf(GUARD_IDS.bahodir) } });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.ok(await one(`SELECT 1 FROM audit_logs WHERE action = 'security.snapshot_view' AND resource_id = $1 AND actor_role = 'guard'`, [s.event_id]), 'audit yozuvi');
  const yun = await one(`SELECT s.event_id FROM camera_snapshots s JOIN camera_events e ON e.id = s.event_id WHERE e.tenant_id = $1 AND e.branch_id = $2 LIMIT 1`, [SEED_IDS.tenant, BY]);
  assert.equal((await guard.get(`/security/alerts/${yun.event_id}/snapshot`)).status, 403, 'boshqa filial');
  const face = await one(`SELECT id FROM camera_events WHERE tenant_id = $1 AND kind = 'face_match' LIMIT 1`, [SEED_IDS.tenant]);
  assert.equal((await guard.get(`/security/alerts/${face.id}/snapshot`)).status, 404);
  // a picture older than SNAPSHOT_DAYS is never served (even before the hourly purge)
  const old = (await pool.query(`INSERT INTO camera_events (tenant_id, camera_id, branch_id, kind, occurred_at, alert, dedupe_key, target)
     VALUES ($1,$2,$3,'intrusion', demo_now() - interval '40 days', true, 'test:old-snap', 'human') RETURNING id`, [SEED_IDS.tenant, fx.camStore, BC])).rows[0].id;
  await pool.query(`INSERT INTO camera_snapshots (event_id, tenant_id, content_type, bytes, created_at) VALUES ($1,$2,'image/jpeg',$3, demo_now() - interval '40 days')`, [old, SEED_IDS.tenant, Buffer.alloc(200, 1)]);
  assert.equal((await guard.get(`/security/alerts/${old}/snapshot`)).status, 404);
  for (const x of [registrar, cashier, doctor, keeper]) assert.equal((await x.get(`/security/alerts/${s.event_id}/snapshot`)).status, 403);
  assert.equal((await t2.get(`/security/alerts/${s.event_id}/snapshot`)).status, 404);
});
const cookies = new Map();
async function cookieOf(mid) {
  if (!cookies.has(mid)) { const r = await fetch(base + '/demo/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ membership_id: mid }) }); cookies.set(mid, r.headers.get('set-cookie').split(';')[0]); }
  return cookies.get(mid);
}

test('ogohlantirishni olish va yopish: seq bilan poyga 409, rahbarga yuborish, javob vaqti, kamera sahifasida yopilgan', async () => {
  const id = await newAlert();
  let row = await alertRow(guard, id);
  assert.equal(row.state, 'new'); assert.equal(row.seq, 0); assert.ok(row.has_snapshot);
  // two guards press «Ko‘ryapman» at the same time: exactly one wins
  const [a, b] = await Promise.all([guard.post(`/security/alerts/${id}/take`, { seq: 0 }), guard2.post(`/security/alerts/${id}/take`, { seq: 0 })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.match((a.status === 409 ? a : b).body.error.message, /yangilang/);
  // a stale screen (seq 0) cannot resolve
  assert.equal((await guard.post(`/security/alerts/${id}/resolve`, { seq: 0, outcome: 'false_alarm' })).status, 409);
  assert.equal((await guard.post(`/security/alerts/${id}/resolve`, { seq: 1, outcome: 'incident' })).status, 422, 'hodisa tavsifisiz');
  // escalate → only the manager closes it; the manager's alarm banner shows it meanwhile
  assert.equal((await guard.post(`/security/alerts/${id}/resolve`, { seq: 1, outcome: 'escalated', note: 'Eshik oldida begona odam' })).status, 200);
  assert.ok((await manager.get('/security/alarms')).body.data.escalated.some((e) => e.id === id));
  assert.equal((await guard.post(`/security/alerts/${id}/resolve`, { seq: 2, outcome: 'checked_ok' })).status, 403);
  assert.equal((await manager.post(`/security/alerts/${id}/resolve`, { seq: 2, outcome: 'escalated' })).status, 422);
  assert.equal((await manager.post(`/security/alerts/${id}/resolve`, { seq: 2, outcome: 'checked_ok', note: 'Tekshirildi' })).status, 200);
  assert.equal((await manager.post(`/security/alerts/${id}/resolve`, { seq: 3, outcome: 'checked_ok' })).status, 409, 'yopilgan');
  row = await alertRow(guard, id);
  assert.equal(row.state, 'resolved'); assert.ok(row.response_sec >= 0);
  assert.ok(!(await manager.get('/security/alarms')).body.data.escalated.some((e) => e.id === id));
  const cam = (await manager.get('/cameras/security')).body.data.find((x) => x.id === id);
  assert.ok(cam.acked_at, 'kameralar sahifasida ham yopilgan');
  // outcome «incident»: the incident is filed and linked
  const id2 = await newAlert('loitering');
  assert.equal((await guard.post(`/security/alerts/${id2}/take`, { seq: 0 })).status, 200);
  const r = await guard.post(`/security/alerts/${id2}/resolve`, { seq: 1, outcome: 'incident', incident: { category: 'suspicious', severity: 'high', description: 'Ombor eshigi oldida begona odam, tel +998 90 123 45 67' } });
  assert.equal(r.status, 200); assert.ok(r.body.data.incident.number);
  const inc = (await guard.get(`/security/incidents/${r.body.data.incident.id}`)).body.data;
  assert.equal(inc.alert_event_id, id2); assert.equal(inc.source, 'alert');
  assert.ok(inc.description.includes('[telefon]') && !inc.description.includes('123 45 67'), 'telefon raqami olib tashlandi');
  // a direct resolve from «new» works too (one step)
  const id3 = await newAlert('tamper');
  assert.equal((await guard.post(`/security/alerts/${id3}/resolve`, { seq: 0, outcome: 'false_alarm' })).status, 200);
  // another clinic: not found
  assert.equal((await t2.post(`/security/alerts/${id3}/take`, { seq: 1 })).status, 404);
  // the audit trail has the steps, never the free text
  const au = (await pool.query(`SELECT summary FROM audit_logs WHERE resource_id = $1 AND action LIKE 'security.alert%'`, [id])).rows.map((x) => x.summary).join(' ');
  assert.ok(au && !au.includes('begona'), au);
});

test('hodisalar: qo‘lda yozish, tuzatish yangi qator, qorovul yopolmaydi, rahbar yopadi; boshqa klinika 404; filial doirasi', async () => {
  const room = (await one(`SELECT id FROM rooms WHERE tenant_id = $1 AND branch_id = $2 LIMIT 1`, [SEED_IDS.tenant, BC])).id;
  const r = await guard.post('/security/incidents', { category: 'damage', severity: 'low', room_id: room, place: 'Eshik', description: 'Eshik oynasi darz ketgan' });
  assert.equal(r.status, 201);
  const id = r.body.data.id;
  assert.equal((await guard.post(`/security/incidents/${id}/entries`, { kind: 'correction', text: 'Oyna emas, ramka darz ketgan' })).status, 201);
  assert.equal((await guard.post(`/security/incidents/${id}/entries`, { kind: 'close', text: 'Yopildi' })).status, 403);
  assert.equal((await manager.post(`/security/incidents/${id}/entries`, { kind: 'close', text: 'Usta chaqirildi, almashtirildi' })).status, 201);
  assert.equal((await guard.post(`/security/incidents/${id}/entries`, { kind: 'note', text: 'Yana bir izoh' })).status, 409);
  const full = (await guard.get(`/security/incidents/${id}`)).body.data;
  assert.equal(full.description, 'Eshik oynasi darz ketgan', 'birinchi matn o‘zgarmaydi');
  assert.deepEqual(full.entries.map((e) => e.kind), ['correction', 'close']); assert.ok(full.closed);
  assert.equal((await guard.post('/security/incidents', { category: 'bad', severity: 'low', description: 'x' })).status, 422);
  assert.equal((await guard.post('/security/incidents', { category: 'other', severity: 'low', description: 'Boshqa filial', branch_id: BY })).status, 403);
  const yRoom = (await one(`SELECT id FROM rooms WHERE tenant_id = $1 AND branch_id = $2 LIMIT 1`, [SEED_IDS.tenant, BY])).id;
  assert.equal((await guard.post('/security/incidents', { category: 'other', severity: 'low', description: 'Xona boshqa filialda', room_id: yRoom })).status, 422);
  assert.equal((await t2.get(`/security/incidents/${id}`)).status, 404);
  assert.equal((await t2.post(`/security/incidents/${id}/entries`, { kind: 'note', text: 'Begona' })).status, 404);
  assert.equal((await guard.get(`/security/incidents?branch_id=${BY}`)).status, 403);
  const list = (await guard.get('/security/incidents?status=open')).body;
  assert.ok(list.data.every((x) => !x.closed) && list.meta.total >= 2);
});

test('SOS: qorovul rahbarga tez xabar yuboradi → rahbar bannerida, «Ko‘rdim» dan keyin yo‘qoladi', async () => {
  assert.equal((await manager.post('/security/sos', { reason: 'fire' })).status, 403, 'faqat qorovul');
  const r = await guard.post('/security/sos', { reason: 'aggression', note: 'Qabulxonada janjal' });
  assert.equal(r.status, 201);
  const al = (await manager.get('/security/alarms')).body.data.sos;
  assert.ok(al.some((s) => s.id === r.body.data.id && s.sos_reason === 'aggression'));
  const inc = (await manager.get(`/security/incidents/${r.body.data.id}`)).body.data;
  assert.equal(inc.severity, 'critical'); assert.equal(inc.category, 'conflict'); assert.equal(inc.source, 'sos');
  assert.equal((await manager.post(`/security/incidents/${r.body.data.id}/seen`)).status, 200);
  assert.equal((await manager.post(`/security/incidents/${r.body.data.id}/seen`)).status, 200, 'qayta bosish xato emas');
  assert.ok(!(await manager.get('/security/alarms')).body.data.sos.some((s) => s.id === r.body.data.id));
  assert.equal((await guard.post('/security/sos', { reason: 'nope' })).status, 422);
});

test('tashrif buyuruvchilar: kirdi → ichkarida → chiqdi (ikkinchi marta 409); pasport/JShShIR yozilmaydi; 90 kundan keyin ism o‘chadi', async () => {
  for (const bad of [{ full_name: 'Ali Valiyev AA1234567', purpose: 'delivery' }, { full_name: 'Ali Valiyev', purpose: 'delivery', purpose_note: 'JShShIR 12345678901234' },
    { full_name: 'Ali Valiyev', purpose: 'delivery', pass_no: 'AB 1234567' }, { full_name: 'Ali Valiyev', purpose: 'patient' }, { full_name: 'A', purpose: 'delivery' }]) {
    assert.equal((await guard.post('/security/visitors', bad)).status, 422, JSON.stringify(bad));
  }
  const r = await guard.post('/security/visitors', { full_name: 'Sinov Kuryer', organisation: 'Express24', purpose: 'delivery', host_membership_id: M.storekeeper, pass_no: 'M-07' });
  assert.equal(r.status, 201);
  const inside = (await guard.get('/security/visitors?inside=1')).body.data;
  const v = inside.find((x) => x.id === r.body.data.id);
  assert.equal(v.host_name, 'Sherzod Qodirov'); assert.equal(v.pass_no, 'M-07');
  assert.equal((await t2.post(`/security/visitors/${v.id}/out`)).status, 404);
  assert.equal((await guard.post(`/security/visitors/${v.id}/out`)).status, 200);
  assert.equal((await guard.post(`/security/visitors/${v.id}/out`)).status, 409);
  assert.ok(!(await guard.get('/security/visitors?inside=1')).body.data.some((x) => x.id === v.id));
  assert.equal((await guard.post('/security/visitors', { full_name: 'Begona Xost', purpose: 'meeting', host_membership_id: M.tenant2Manager })).status, 422, 'boshqa klinika xodimi');
  // the audit trail never keeps the visitor's name
  assert.ok(!(await one(`SELECT 1 FROM audit_logs WHERE summary LIKE '%Sinov Kuryer%'`)));
  // retention: an old record loses its personal fields, a recent one keeps them
  const old = (await pool.query(`INSERT INTO security_visitors (tenant_id, branch_id, full_name, organisation, purpose, purpose_note, pass_no, in_at, out_at, recorded_by, recorded_by_name)
     VALUES ($1,$2,'Eski Mehmon','Eski MChJ','repair','Konditsioner','M-01', demo_now() - interval '100 days', demo_now() - interval '100 days' + interval '1 hour', $3, 'Bahodir Usmonov') RETURNING id`,
    [SEED_IDS.tenant, BC, GUARD_IDS.bahodir])).rows[0].id;
  const { purgeVisitors } = require('../dist/modules/security.js');
  assert.ok(await purgeVisitors(pool) >= 1);
  const o = await one(`SELECT full_name, organisation, purpose_note, pass_no, purged_at, purpose, out_at FROM security_visitors WHERE id = $1`, [old]);
  assert.equal(o.full_name, null); assert.equal(o.organisation, null); assert.equal(o.purpose_note, null); assert.equal(o.pass_no, null);
  assert.ok(o.purged_at && o.out_at); assert.equal(o.purpose, 'repair');
  assert.equal((await one(`SELECT full_name FROM security_visitors WHERE id = $1`, [v.id])).full_name, 'Sinov Kuryer');
});

test('kalitlar: berish → ikkinchi berish 409 → qaytarish → ikkinchi qaytarish 409; bajarilmagan kalit «qaytarilmagan»', async () => {
  const keys = (await guard.get('/security/keys')).body.data;
  assert.ok(keys.some((k) => k.out && k.overdue), 'kecha olingan kalit qaytarilmagan');
  const free = keys.find((k) => !k.out);
  const [x, y] = await Promise.all([guard.post(`/security/keys/${free.room_id}/out`, { holder_membership_id: M.doctor(0) }), guard2.post(`/security/keys/${free.room_id}/out`, { holder_membership_id: M.doctor(1) })]);
  assert.deepEqual([x.status, y.status].sort(), [201, 409]);
  const now = (await guard.get('/security/keys')).body.data.find((k) => k.room_id === free.room_id);
  assert.ok(now.out && !now.overdue);
  assert.equal((await guard.post(`/security/keys/${free.room_id}/in`, {})).status, 201);
  assert.equal((await guard.post(`/security/keys/${free.room_id}/in`, {})).status, 409);
  assert.equal((await guard.post(`/security/keys/${free.room_id}/out`, {})).status, 422, 'kimga — majburiy');
  assert.equal((await guard.post(`/security/keys/${free.room_id}/out`, { holder_membership_id: M.tenant2Manager })).status, 422);
  assert.equal((await t2.post(`/security/keys/${free.room_id}/out`, { holder_membership_id: M.tenant2Manager })).status, 404);
  const yRoom = (await one(`SELECT id FROM rooms WHERE tenant_id = $1 AND branch_id = $2 LIMIT 1`, [SEED_IDS.tenant, BY])).id;
  assert.equal((await guard.post(`/security/keys/${yRoom}/out`, { holder_membership_id: M.doctor(0) })).status, 403);
  const log = (await guard.get(`/security/keys/log?from=${today}&to=${today}`)).body;
  assert.ok(log.data.filter((e) => e.room_id === free.room_id).length >= 2);
});

test('obxod: rahbar nuqta qo‘shadi; qorovul boshlaydi, belgilaydi (muammo → hodisa), tugatadi; poyga va begona obxod', async () => {
  assert.equal((await guard.post('/security/checkpoints', { branch_id: BC, name: 'Sinov nuqtasi' })).status, 403);
  const cp = await manager.post('/security/checkpoints', { branch_id: BC, name: 'Sinov nuqtasi' });
  assert.equal(cp.status, 201);
  assert.equal((await manager.patch(`/security/checkpoints/${cp.body.data.id}`, { active: false })).status, 200);
  assert.equal((await manager.patch(`/security/checkpoints/${cp.body.data.id}`, { active: true })).status, 200);
  assert.equal((await t2.patch(`/security/checkpoints/${cp.body.data.id}`, { active: false })).status, 404);
  const start = await guard.post('/security/rounds', {});
  assert.equal(start.status, 201);
  assert.equal((await guard.post('/security/rounds', {})).status, 409);
  const cur = (await guard.get('/security/rounds/current')).body.data;
  assert.equal(cur.round.id, start.body.data.id);
  const pts = cur.checkpoints;
  assert.ok(pts.length >= 8);
  assert.equal((await guard.post(`/security/rounds/${cur.round.id}/marks`, { checkpoint_id: pts[0].id, result: 'ok' })).status, 201);
  assert.equal((await guard.post(`/security/rounds/${cur.round.id}/marks`, { checkpoint_id: pts[0].id, result: 'ok' })).status, 409);
  assert.equal((await guard.post(`/security/rounds/${cur.round.id}/marks`, { checkpoint_id: pts[1].id, result: 'problem' })).status, 422, 'muammo izohsiz');
  assert.equal((await guard2.post(`/security/rounds/${cur.round.id}/marks`, { checkpoint_id: pts[2].id, result: 'ok' })).status, 403, 'begona obxod');
  const pr = await guard.post(`/security/rounds/${cur.round.id}/marks`, { checkpoint_id: pts[1].id, result: 'problem', note: 'Orqa eshik ochiq qolgan', incident: { category: 'other', severity: 'medium' } });
  assert.equal(pr.status, 201); assert.ok(pr.body.data.incident.number);
  assert.equal((await guard.get(`/security/incidents/${pr.body.data.incident.id}`)).body.data.source, 'patrol');
  const yPoint = (await one(`SELECT id FROM patrol_checkpoints WHERE branch_id = $1 LIMIT 1`, [BY])).id;
  assert.equal((await guard.post(`/security/rounds/${cur.round.id}/marks`, { checkpoint_id: yPoint, result: 'ok' })).status, 422);
  const fin = await guard.post(`/security/rounds/${cur.round.id}/finish`);
  assert.equal(fin.status, 200); assert.equal(fin.body.data.marked, 2);
  assert.equal((await guard.post(`/security/rounds/${cur.round.id}/finish`)).status, 409);
  const hist = (await manager.get(`/security/rounds?from=${today}&to=${today}`)).body.data;
  assert.ok(hist.some((r) => r.id === cur.round.id && r.problems === 1));
});

test('smena: ochish, ikkinchi ochish 409, topshiriqsiz yopib bo‘lmaydi, keyingi qorovul topshiriqni ko‘radi, A4 hisobot', async () => {
  // the seed's day guard has no open shift at 07:30 (the night guard is still on duty)
  let cur = (await guard.get('/security/shifts/current')).body.data;
  assert.equal(cur.shift, null);
  assert.ok(cur.previous?.handover_note, 'oldingi smenaning topshirig‘i');
  assert.equal((await manager.post('/security/shifts', {})).status, 403);
  const o = await guard.post('/security/shifts', {});
  assert.equal(o.status, 201);
  assert.equal((await guard.post('/security/shifts', {})).status, 409);
  cur = (await guard.get('/security/shifts/current')).body.data;
  assert.equal(cur.shift.id, o.body.data.id);
  assert.ok(Array.isArray(cur.open_items.keys_out) && cur.open_items.keys_out.some((k) => k.overdue));
  assert.equal((await guard2.post(`/security/shifts/${o.body.data.id}/close`, { handover_note: 'Begona smena' })).status, 403);
  assert.equal((await guard.post(`/security/shifts/${o.body.data.id}/close`, {})).status, 422);
  // an open round ends with the shift
  assert.equal((await guard.post('/security/rounds', {})).status, 201);
  assert.equal((await guard.post(`/security/shifts/${o.body.data.id}/close`, { handover_note: '103-xona kaliti shifokorda, qaytarilmagan. Tel 901234567' })).status, 200);
  assert.equal((await guard.post(`/security/shifts/${o.body.data.id}/close`, { handover_note: 'Yana' })).status, 409);
  assert.equal((await guard.get('/security/rounds/current')).body.data.round, null);
  const next = (await guard2.get('/security/shifts/current')).body.data;
  assert.equal(next.previous.handover_note, '103-xona kaliti shifokorda, qaytarilmagan. Tel [telefon]');
  const rep = await manager.get(`/security/shifts/${o.body.data.id}`);
  assert.equal(rep.status, 200);
  for (const k of ['alerts', 'incidents', 'visitors', 'keys', 'rounds', 'open_items']) assert.ok(k in rep.body.data, k);
  assert.equal((await t2.get(`/security/shifts/${o.body.data.id}`)).status, 404);
  assert.equal((await registrar.get(`/security/shifts/${o.body.data.id}`)).status, 403);
});

test('xodimlar binoda: kamera + qo‘lda belgi; shifokor jadvalga solishtiriladi; bemor yo‘q', async () => {
  assert.equal((await guard.post('/security/presence', { membership_id: M.storekeeper, kind: 'in' })).status, 201);
  assert.equal((await guard.post('/security/presence', { membership_id: M.tenant2Manager, kind: 'in' })).status, 422);
  const p = (await guard.get('/security/presence')).body;
  const k = p.data.find((x) => x.membership_id === M.storekeeper);
  assert.equal(k.status, 'in'); assert.equal(k.source, 'manual');
  assert.ok(p.data.some((x) => x.specialty && x.planned_start), 'shifokorlar jadvali bilan');
  assert.ok(p.data.every((x) => x.membership_id && !('patient_id' in x)));
  assert.equal((await guard.post('/security/presence', { membership_id: M.storekeeper, kind: 'out' })).status, 201);
  assert.equal((await guard.get('/security/presence')).body.data.find((x) => x.membership_id === M.storekeeper).status, 'left');
});

test('rahbar: davr statistikasi (javob vaqti, obxod intizomi), CSV (davr ≤ 1 yil, jami qatori), qorovul xodim yaratish', async () => {
  const from = new Date(Date.parse(today) - 20 * 86400_000).toISOString().slice(0, 10);
  const s = await manager.get(`/security/stats?from=${from}&to=${today}`);
  assert.equal(s.status, 200);
  assert.ok(s.body.data.alerts.total > 0 && s.body.data.alerts.median_response_sec > 0);
  assert.ok(s.body.data.patrol.expected > 0 && s.body.data.patrol.done > 0);
  assert.ok(s.body.data.incidents.length > 0 && s.body.data.visitors.total > 0 && s.body.data.keys.issued > 0);
  assert.equal((await manager.get(`/security/stats?from=2024-01-01&to=${today}`)).status, 422);
  for (const what of ['incidents', 'visitors', 'alerts']) {
    const r = await manager.get(`/security/${what}.csv?from=${from}&to=${today}`);
    assert.equal(r.status, 200, what); assert.match(r.type, /text\/csv/);
    const lines = r.text.replace(/^﻿/, '').trim().split('\r\n');
    assert.ok(lines.length >= 3, what); assert.match(lines.at(-1), /^"Jami"/, `${what}: jami qatori`);
    assert.equal((await manager.get(`/security/${what}.csv?from=2024-01-01&to=${today}`)).status, 422);
    assert.equal((await manager.get(`/security/${what}.csv`)).status, 422);
  }
  assert.ok(await one(`SELECT 1 FROM audit_logs WHERE action = 'security.export'`));
  const st = await manager.post('/staff', { full_name: 'Yangi Qorovul', role: 'guard', login: 'qorovul_sinov', branch_ids: [BC] });
  assert.equal(st.status, 201);
  assert.ok((await manager.get('/staff')).body.data.some((x) => x.role === 'guard' && x.full_name === 'Yangi Qorovul'));
});

test('faqat qo‘shiladi: hodisa, yozuv, harakat, kalit, belgi, obxod va smena triggerlar bilan himoyalangan', async () => {
  const tries = [
    `UPDATE security_alert_actions SET note = 'x'`, `DELETE FROM security_alert_actions`,
    `UPDATE security_incidents SET description = 'x'`, `DELETE FROM security_incidents WHERE number = 1`,
    `UPDATE security_incident_entries SET text = 'x'`, `DELETE FROM security_incident_entries`,
    `UPDATE key_events SET holder_name = 'x'`, `DELETE FROM key_events`, `UPDATE patrol_marks SET note = 'x'`, `DELETE FROM staff_presence_marks`,
    `UPDATE guard_shifts SET handover_note = 'xyz' WHERE closed_at IS NOT NULL`, `DELETE FROM guard_shifts`,
    `UPDATE patrol_rounds SET checkpoints_total = 3 WHERE finished_at IS NOT NULL`, `DELETE FROM patrol_checkpoints`,
    `UPDATE security_visitors SET full_name = 'Boshqa' WHERE purged_at IS NULL`, `DELETE FROM security_visitors`,
    `UPDATE security_visitors SET out_at = demo_now() WHERE out_at IS NOT NULL`, `UPDATE security_visitors SET purpose = 'other'`,
  ];
  for (const sql of tries) {
    const c = await pool.connect();
    try { await c.query('BEGIN'); await assert.rejects(c.query(sql), /append-only|never edited|set once|only cleared|closed once|finished once/, sql); } finally { await c.query('ROLLBACK'); c.release(); }
  }
  // the role CHECK knows the guard
  await assert.rejects(pool.query(`UPDATE memberships SET role = 'janitor' WHERE id = $1`, [GUARD_IDS.bahodir]), /memberships_role_check/);
});
