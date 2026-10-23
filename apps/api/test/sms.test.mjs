// SMS channel (Eskiz.uz) for patients without Telegram: settings (password write-only, encrypted), channel choice in the
// outbox, texts, token refresh on 401, retry on 5xx, failure on 4xx, opt-out, test message, stats. Eskiz is a local
// fake HTTP server — no real gateway, no real phone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool, notifier, config;

function session() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), put: (p, b) => req('PUT', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}

// ---------- fake Eskiz ----------
const fake = { server: null, url: '', logins: [], sends: [], tokens: new Set(), failWith: null, seq: 0, password: 'secret-1' };
function startFake() {
  return new Promise((resolve) => {
    fake.server = http.createServer(async (req, res) => {
      let body = ''; for await (const ch of req) body += ch;
      const json = body ? JSON.parse(body) : {};
      const send = (status, o) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.method === 'POST' && req.url === '/api/auth/login') {
        fake.logins.push(json);
        if (json.password !== fake.password) return send(401, { message: 'Неверный логин или пароль' });
        const token = `tok-${++fake.seq}`; fake.tokens.add(token);
        return send(200, { message: 'token_generated', data: { token }, token_type: 'bearer' });
      }
      const auth = req.headers.authorization ?? '';
      if (!fake.tokens.has(auth.replace('Bearer ', ''))) return send(401, { message: 'Expired token' });
      if (req.method === 'POST' && req.url === '/api/message/sms/send') {
        if (fake.failWith) return send(fake.failWith, { message: `fail ${fake.failWith}` });
        fake.sends.push(json);
        return send(200, { id: String(1000 + fake.sends.length), message: 'Waiting for SMS provider', status: 'waiting' });
      }
      const m = req.url.match(/^\/api\/message\/sms\/status_by_id\/(\d+)$/);
      if (req.method === 'GET' && m) return send(200, { status: 'success', data: { status: 'DELIVRD', message_id: m[1] } });
      send(404, { message: 'not found' });
    }).listen(0, '127.0.0.1', () => { fake.url = `http://127.0.0.1:${fake.server.address().port}`; resolve(); });
  });
}

let manager, registrar, me;
const demoNow = async () => (await pool.query(`SELECT demo_now() AS n`)).rows[0].n;
const localOf = (d) => new Date(d.getTime() + 5 * 3600_000);
const dateOf = (d) => localOf(d).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
async function setLocal(date, hhmm) {
  const target = new Date(Date.parse(`${date}T${hhmm}:00Z`) - 5 * 3600_000);
  await pool.query(`UPDATE demo_clock SET demo_anchor = demo_anchor + ($1::timestamptz - $2::timestamptz) WHERE id = 1`, [target, await demoNow()]);
}
/** A seed patient with their own unique Uzbek phone, no Telegram chat and no future appointment. */
const uniquePhone = async () => (await pool.query(
  `SELECT p.id, p.phone, p.last_name, p.first_name FROM patients p
    WHERE p.tenant_id = $1 AND p.phone LIKE '+998%' AND p.contact_phone IS NULL
      AND (SELECT count(*) FROM patients x WHERE x.tenant_id = $1 AND (x.phone = p.phone OR x.contact_phone = p.phone)) = 1
      AND NOT EXISTS (SELECT 1 FROM telegram_chats tc WHERE tc.phone = p.phone)
      AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.status = 'scheduled' AND a.starts_at > demo_now())
    ORDER BY p.patient_number LIMIT 1`, [SEED_IDS.tenant])).rows[0];
async function bookOn(patientId, date, atLeast = '00:00') {
  const docs = (await registrar.get('/doctors')).body.data;
  for (const d of docs) {
    const svc = d.service_ids?.[0]; if (!svc) continue;
    const av = (await registrar.get(`/availability?doctor_id=${d.id}&date=${date}&service_id=${svc}`)).body.data;
    if (!av.working || !me.branches.some((b) => b.id === av.branch_id)) continue;
    const slot = av.slots.find((s) => s.free && !s.past && s.time >= atLeast);
    if (!slot) continue;
    const r = await registrar.post('/appointments', { patient_id: patientId, branch_id: av.branch_id, doctor_id: d.id, service_id: svc, date, start_time: slot.time }, { 'Idempotency-Key': randomUUID() });
    if (r.status === 201) return { id: r.body.data.id, doctor: d, time: slot.time };
  }
  throw new Error(`no slot on ${date}`);
}
const notice = async (apptId, kind = 'booked') => (await pool.query(`SELECT * FROM notifications WHERE appointment_id = $1 AND kind = $2`, [apptId, kind])).rows;
const enable = (on) => manager.put('/sms/settings', { enabled: on });

before(async () => {
  await startFake();
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  notifier = app.get(require('../dist/telegram/notifier.js').Notifier);
  config = require('../dist/core/config.js').config;
  config.secretKey = Buffer.alloc(32, 9).toString('base64');
  config.sms.baseUrl = fake.url;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  await db.assertDatabaseName(pool, '_test');
  await pool.query(`DELETE FROM telegram_chats`);
  await pool.query(`DELETE FROM sms_settings`);
  await setLocal(dateOf(await demoNow()), '09:30'); // out of quiet hours
  registrar = session(); await registrar.demo(M.registrar);
  me = (await registrar.get('/me')).body.data;
});
after(async () => { await app?.close(); fake.server?.close(); });

test('ruxsat: registrator SMS sozlamalarini ko‘rmaydi va o‘zgartirmaydi (403)', async () => {
  assert.equal((await registrar.get('/sms/settings')).status, 403);
  assert.equal((await registrar.put('/sms/settings', { enabled: true })).status, 403);
  assert.equal((await registrar.get('/sms/stats')).status, 403);
  assert.equal((await registrar.post('/sms/test', { phone: '+998901234567' })).status, 403);
});

test('sozlamalar: noto‘g‘ri parol 422; to‘g‘risi saqlanadi — javobda parol yo‘q, bazada faqat shifrlangan', async () => {
  const bad = await manager.put('/sms/settings', { eskiz_email: 'clinic@example.uz', password: 'wrong', enabled: true });
  assert.equal(bad.status, 422); assert.ok(bad.body.error.fields.password);
  // switching on without credentials is refused
  const noCreds = await manager.put('/sms/settings', { enabled: true });
  assert.equal(noCreds.status, 422);
  const ok = await manager.put('/sms/settings', { eskiz_email: 'clinic@example.uz', password: fake.password, enabled: true });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.data.enabled, true); assert.equal(ok.body.data.has_password, true); assert.equal(ok.body.data.sender, '4546');
  assert.ok(!ok.text.includes(fake.password) && !('password' in ok.body.data) && !('password_enc' in ok.body.data), 'parol javobda yo‘q');
  const g = await manager.get('/sms/settings');
  assert.ok(!g.text.includes(fake.password) && !('password' in g.body.data));
  const row = (await pool.query(`SELECT password_enc FROM sms_settings WHERE tenant_id = $1`, [SEED_IDS.tenant])).rows[0];
  assert.match(row.password_enc, /^v1\./); assert.ok(!row.password_enc.includes(fake.password));
  assert.equal(fake.logins.length, 2, 'ikkala urinish ham Eskiz’da tekshirildi');
  // the saved password is kept when the form is sent without one
  assert.equal((await manager.put('/sms/settings', { sender: 'MEDUZ' })).body.data.has_password, true);
  assert.equal((await manager.put('/sms/settings', { sender: '4546' })).status, 200);
  const au = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'sms.settings' ORDER BY occurred_at DESC LIMIT 1`)).rows[0];
  assert.ok(au && !au.summary.includes(fake.password));
});

test('yozilganda Telegram’siz bemorga SMS ketadi: lotin, qisqa, vaqt va shifokor bor; matn bazada saqlanmaydi', async () => {
  const p = await uniquePhone();
  const b = await bookOn(p.id, addDays(dateOf(await demoNow()), 1));
  const [n] = await notice(b.id);
  assert.ok(n, 'xabar navbatda'); assert.equal(n.channel, 'sms');
  const before = fake.sends.length;
  await notifier.deliverDue();
  assert.equal(fake.sends.length, before + 1);
  const s = fake.sends.at(-1);
  assert.equal(s.mobile_phone, p.phone.slice(1)); assert.equal(s.from, '4546');
  assert.ok(s.message.includes(b.time) && s.message.includes(b.doctor.display_name), s.message);
  assert.ok(!/[Ѐ-ӿ‘’]/.test(s.message), `faqat lotin, apostrofsiz: ${s.message}`);
  assert.ok(s.message.length <= 160, `${s.message.length} belgi`);
  assert.equal((await notice(b.id))[0].status, 'sent');
  const log = (await pool.query(`SELECT * FROM sms_messages WHERE notification_id = $1`, [n.id])).rows[0];
  assert.equal(log.kind, 'booked'); assert.equal(log.phone, p.phone); assert.equal(log.status, 'sent'); assert.ok(log.provider_id);
  assert.ok(!Object.keys(log).some((k) => /text|message|body/.test(k)), 'log’da matn ustuni yo‘q');
  // not sent twice
  await notifier.deliverDue();
  assert.equal(fake.sends.length, before + 1);
  // the patient card says which channel the reminders go through
  assert.equal((await registrar.get(`/patients/${p.id}`)).body.data.notice_channel, 'sms');
});

test('Telegram ulangan bemorga SMS emas, Telegram boradi', async () => {
  const p = await uniquePhone();
  const chat = (await manager.post('/telegram/sim/chats')).body.data.chat_id;
  await manager.post('/telegram/sim/send', { chat_id: chat, text: '/start' });
  await manager.post('/telegram/sim/send', { chat_id: chat, contact_phone: p.phone });
  const b = await bookOn(p.id, addDays(dateOf(await demoNow()), 1));
  const rows = await notice(b.id);
  assert.equal(rows.length, 1); assert.equal(rows[0].channel, 'telegram');
  const before = fake.sends.length;
  await notifier.deliverDue();
  assert.equal(fake.sends.length, before, 'SMS yuborilmadi');
  assert.equal((await notice(b.id))[0].status, 'sent');
  assert.equal((await registrar.get(`/patients/${p.id}`)).body.data.notice_channel, 'telegram');
});

test('rozilik: xabarnomalarga «yo‘q» degan bemorga SMS navbatga qo‘yilmaydi', async () => {
  const p = await uniquePhone();
  const r = await manager.post(`/patients/${p.id}/consents`, { kind: 'notifications', granted: false, method: 'verbal' });
  assert.equal(r.status, 201, r.text);
  const b = await bookOn(p.id, addDays(dateOf(await demoNow()), 1));
  assert.equal((await notice(b.id)).length, 0);
  assert.equal((await registrar.get(`/patients/${p.id}`)).body.data.notice_channel, null);
});

test('token muddati tugagan (401): qayta login va xabar yuboriladi', async () => {
  const p = await uniquePhone();
  const b = await bookOn(p.id, addDays(dateOf(await demoNow()), 1));
  fake.tokens.clear(); // every stored token is now invalid
  const logins = fake.logins.length, before = fake.sends.length;
  await notifier.deliverDue();
  assert.equal(fake.sends.length, before + 1);
  assert.equal(fake.logins.length, logins + 1, 'bir marta qayta login');
  assert.equal((await notice(b.id))[0].status, 'sent');
});

test('Eskiz 5xx: xabar navbatda qoladi va keyinroq qayta uriniladi; 4xx: «failed»', async () => {
  const p = await uniquePhone();
  const b = await bookOn(p.id, addDays(dateOf(await demoNow()), 1));
  fake.failWith = 503;
  try { await notifier.deliverDue(); } finally { fake.failWith = null; }
  let [n] = await notice(b.id);
  assert.equal(n.status, 'pending'); assert.equal(n.attempts, 1); assert.ok(new Date(n.next_attempt_at) > await demoNow()); assert.match(n.error, /Eskiz/);
  assert.match((await manager.get('/sms/settings')).body.data.last_error, /Eskiz/);
  await pool.query(`UPDATE notifications SET next_attempt_at = demo_now() WHERE id = $1`, [n.id]);
  const before = fake.sends.length;
  await notifier.deliverDue();
  [n] = await notice(b.id);
  assert.equal(n.status, 'sent'); assert.equal(fake.sends.length, before + 1);
  assert.equal((await manager.get('/sms/settings')).body.data.last_error, null, 'muvaffaqiyat xatoni tozalaydi');
  // a 4xx answer is final
  const p2 = await uniquePhone();
  const b2 = await bookOn(p2.id, addDays(dateOf(await demoNow()), 1));
  fake.failWith = 400;
  try { await notifier.deliverDue(); } finally { fake.failWith = null; }
  const [n2] = await notice(b2.id);
  assert.equal(n2.status, 'failed'); assert.equal(n2.attempts, 1);
  const log = (await pool.query(`SELECT status, error FROM sms_messages WHERE notification_id = $1`, [n2.id])).rows[0];
  assert.equal(log.status, 'failed'); assert.match(log.error, /Eskiz/);
});

test('eslatma rejalashtiruvchi: Telegram’siz bemor uchun kun oldingi eslatma SMS kanalida', async () => {
  const p = await uniquePhone();
  const today = dateOf(await demoNow());
  const b = await bookOn(p.id, addDays(today, 1), '12:00');
  await setLocal(today, '14:00'); // > 1 h after booking, 20+ h before the visit
  await notifier.planReminders();
  const rows = await notice(b.id, 'reminder_day');
  assert.equal(rows.length, 1); assert.equal(rows[0].channel, 'sms');
  // other seed patients without Telegram get their reminders too — look at this patient's message
  await notifier.deliverDue(200);
  const mine = fake.sends.filter((s) => s.mobile_phone === p.phone.slice(1) && /Eslatma/.test(s.message));
  assert.equal(mine.length, 1, JSON.stringify(fake.sends.slice(-3)));
  assert.ok(mine[0].message.includes(b.time) && !/[Ѐ-ӿ‘’]/.test(mine[0].message), mine[0].message);
  assert.equal((await notice(b.id, 'reminder_day'))[0].status, 'sent');
});

test('sinov SMS: rahbarning raqamiga Eskiz sinov matni; bir daqiqada bittadan (429); o‘chirilgan bo‘lsa 409', async () => {
  const r = await manager.post('/sms/test', { phone: '+998 90 123-45-67' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.phone, '+998901234567'); assert.ok(r.body.data.provider_id);
  assert.equal(fake.sends.at(-1).mobile_phone, '998901234567'); assert.equal(fake.sends.at(-1).message, 'Bu Eskiz dan test');
  assert.equal((await manager.post('/sms/test', { phone: '+998901234567' })).status, 429);
  assert.equal((await manager.post('/sms/test', { phone: 'abc' })).status, 422);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM sms_messages WHERE kind = 'test'`)).rows[0].n, 1);
  assert.equal((await enable(false)).status, 200);
  assert.equal((await manager.post('/sms/test', { phone: '+998901234567' })).status, 409);
  assert.equal((await enable(true)).status, 200);
});

test('statistika: kunlik yuborilgan/xato, navbat va oxirgi xato; yetkazilganlik Eskiz’dan so‘raladi', async () => {
  await pool.query(`UPDATE sms_messages SET created_at = created_at - interval '2 minutes', updated_at = updated_at - interval '10 minutes'`);
  const r = await manager.get('/sms/stats');
  assert.equal(r.status, 200, r.text);
  const day = dateOf(await demoNow());
  const today = r.body.data.days.find((d) => d.day === day);
  assert.ok(today && today.sent >= 5, JSON.stringify(r.body.data.days));
  assert.ok(today.failed >= 1); assert.ok(today.delivered >= 1, 'status_by_id → DELIVRD');
  assert.ok(r.body.data.totals.sent_30d >= 5); assert.equal(typeof r.body.data.totals.pending, 'number');
  assert.equal(r.body.data.last_error, null);
});

test('SMS o‘chirilgan: Telegram’siz bemorga hech narsa navbatga qo‘yilmaydi; kartada kanal yo‘q', async () => {
  assert.equal((await enable(false)).status, 200);
  const p = await uniquePhone();
  const b = await bookOn(p.id, addDays(dateOf(await demoNow()), 1));
  assert.equal((await notice(b.id)).length, 0);
  assert.equal((await registrar.get(`/patients/${p.id}`)).body.data.notice_channel, null);
  assert.equal((await enable(true)).status, 200);
});

test('boshqa klinika: sozlamalar klinikaga bog‘liq — ikkinchi klinikada SMS o‘chiq', async () => {
  const other = session(); await other.demo(M.tenant2Manager);
  const g = await other.get('/sms/settings');
  assert.equal(g.status, 200); assert.equal(g.body.data.enabled, false); assert.equal(g.body.data.eskiz_email, null);
});
