// Telegram bot: linking, booking, races, registration, questionnaire, reschedule/cancel, reminders and notices,
// security, token connection and long polling. The engine runs for real; Telegram is either the simulator
// transport or a local fake Bot API server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool, engine, notifier, bots, workers, config;

function session() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), del: (p) => req('DELETE', p), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}

// ---------- simulator helpers ----------
let manager;
const out = async (chat, after = 0) => (await manager.get(`/telegram/sim/messages?chat_id=${chat}&after=${after}`)).body.data.filter((m) => m.direction === 'out');
const lastId = async (chat) => { const all = (await manager.get(`/telegram/sim/messages?chat_id=${chat}`)).body.data; return all.length ? all[all.length - 1].id : 0; };
const say = (chat, text) => manager.post('/telegram/sim/send', { chat_id: chat, text });
const share = (chat, phone) => manager.post('/telegram/sim/send', { chat_id: chat, contact_phone: phone });
/** Presses the newest inline button whose caption matches. */
async function press(chat, match) {
  const msgs = (await out(chat)).reverse();
  for (const m of msgs) {
    const btn = (m.markup?.inline_keyboard ?? []).flat().find((b) => (typeof match === 'function' ? match(b.text) : b.text.includes(match)));
    if (btn) { const r = await manager.post('/telegram/sim/send', { chat_id: chat, callback_data: btn.callback_data, label: btn.text }); assert.equal(r.status, 200); return btn; }
  }
  throw new Error(`button "${match}" not found; last: ${JSON.stringify(msgs[0])}`);
}
const newChat = async () => (await manager.post('/telegram/sim/chats')).body.data.chat_id;
const texts = async (chat, after = 0) => (await out(chat, after)).map((m) => m.text).join('\n---\n');
/** Links a fresh simulated chat to a phone and returns the chat id. */
async function linked(phone) {
  const chat = await newChat();
  await say(chat, '/start');
  await share(chat, phone);
  return chat;
}
/** Books via the bot: first service/doctor/date/time on offer (or the given service). Returns the appointment row. */
async function bookVia(chat, { service } = {}) {
  await say(chat, '📅 Qabulga yozilish');
  const first = (await out(chat)).at(-1);
  if (first.text.includes('Kim uchun')) await press(chat, (t) => !t.includes('➕'));
  if (service) await press(chat, service); else await press(chat, (t) => t.includes('so‘m'));
  await press(chat, (t) => t.includes('·'));                         // doctor
  await press(chat, (t) => /^\d\d\.\d\d /.test(t));                    // date
  await press(chat, (t) => /^\d\d:\d\d$/.test(t));                    // time
  await press(chat, '✅ Tasdiqlash');
  return (await pool.query(`SELECT * FROM appointments WHERE source = 'telegram' ORDER BY created_at DESC, id DESC LIMIT 1`)).rows[0];
}

// ---------- fake Telegram Bot API ----------
const fake = { calls: [], updates: [], server: null, url: '' };
function startFake() {
  return new Promise((resolve) => {
    fake.server = http.createServer(async (req, res) => {
      let body = ''; for await (const ch of req) body += ch;
      const [, token, method] = req.url.match(/^\/bot([^/]+)\/(\w+)$/) ?? [];
      const params = body ? JSON.parse(body) : {};
      fake.calls.push({ token, method, params });
      const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (!token?.startsWith('111111:')) return send({ ok: false, error_code: 401, description: 'Unauthorized' });
      if (method === 'getMe') return send({ ok: true, result: { id: 111111, is_bot: true, username: 'TestClinicBot' } });
      if (method === 'getUpdates') {
        const due = fake.updates.filter((u) => u.update_id >= (params.offset ?? 0));
        if (!due.length) await new Promise((r) => setTimeout(r, 150));
        fake.updates = fake.updates.filter((u) => u.update_id >= (params.offset ?? 0) && !due.includes(u));
        return send({ ok: true, result: due });
      }
      return send({ ok: true, result: method === 'sendMessage' ? { message_id: fake.calls.length } : true });
    }).listen(0, '127.0.0.1', () => { fake.url = `http://127.0.0.1:${fake.server.address().port}`; resolve(); });
  });
}

let registrar, lab, branchByName;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  engine = app.get(require('../dist/telegram/engine.js').BotEngine);
  ({ Notifier: notifier, BotRegistry: bots } = require('../dist/telegram/notifier.js'));
  notifier = app.get(notifier); bots = app.get(bots);
  workers = app.get(require('../dist/telegram/workers.js').TelegramWorkers);
  config = require('../dist/core/config.js').config;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  // chats deliberately survive demo resets; every run must start from unlinked phones (test database only)
  await db.assertDatabaseName(pool, '_test');
  await pool.query(`DELETE FROM telegram_chats`);
  await pool.query(`DELETE FROM telegram_sim_messages`);
  // the suite boots at 07:30 — quiet hours for patient notices (08:00–21:00): the bot's day starts at 09:30
  await pool.query(`UPDATE demo_clock SET demo_anchor = demo_anchor + interval '2 hours' WHERE id = 1`);
  registrar = session(); await registrar.demo(M.registrar);
  lab = session(); await lab.demo(M.lab);
  await startFake();
});
after(async () => { await app?.close(); fake.server?.close(); });

/** A seed patient whose phone is theirs alone and not yet used by any test chat — tests never share a patient. */
const uniquePhone = async () => (await pool.query(
  `SELECT p.phone, p.last_name, p.first_name FROM patients p
    WHERE p.tenant_id = $1 AND p.phone IS NOT NULL
      AND (SELECT count(*) FROM patients x WHERE x.tenant_id = $1 AND x.phone = p.phone) = 1
      AND NOT EXISTS (SELECT 1 FROM telegram_chats tc WHERE tc.phone = p.phone)
      AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.status = 'scheduled' AND a.starts_at > demo_now())
    ORDER BY p.patient_number LIMIT 1`, [SEED_IDS.tenant])).rows[0];

test('ulash: /start kontakt so‘raydi; kontaktsiz menyu yo‘q; o‘z raqami bilan karta topiladi', async () => {
  const p = await uniquePhone();
  const chat = await newChat();
  await say(chat, '/start');
  let m = (await out(chat)).at(-1);
  assert.match(m.text, /telefon raqamingizni ulashing/);
  assert.ok(m.markup.keyboard[0][0].request_contact, 'kontakt tugmasi');
  await say(chat, '📅 Qabulga yozilish');
  assert.match((await out(chat)).at(-1).text, /Telefon raqamni ulashish/, 'kontaktsiz yozilish yo‘q');
  await share(chat, p.phone.slice(1)); // Telegram sends 998… without “+”
  const all = await texts(chat);
  assert.ok(all.includes(`${p.last_name} ${p.first_name}`), all);
  assert.ok((await out(chat)).at(-1).markup.keyboard.flat().some((b) => b.text === '📅 Qabulga yozilish'), 'asosiy menyu');
  // non-Uzbek number
  const c2 = await newChat(); await say(c2, '/start'); await share(c2, '+7 912 345 67 89');
  assert.match((await out(c2)).at(-1).text, /\+998/);
});

test('til: bemor o‘zbek kirillni tanlaydi — menyu va xabarlar kirillda, ismlar o‘zgarmaydi; yozilish ishlaydi', async () => {
  const p = await uniquePhone();
  const chat = await linked(p.phone);
  await say(chat, '🌐 Til / Язык');
  assert.match((await out(chat)).at(-1).text, /Тилни танланг/);
  await press(chat, 'Ўзбекча');
  const menu = (await out(chat)).at(-1);
  const labels = menu.markup.keyboard.flat().map((b) => b.text);
  assert.ok(labels.includes('📅 Қабулга ёзилиш'), JSON.stringify(labels));
  assert.equal((await pool.query(`SELECT lang FROM telegram_chats WHERE phone = $1`, [p.phone])).rows[0].lang, 'uz-Cyrl');
  // the Cyrillic menu label works like the Latin one; a booking confirmation keeps names as stored
  await say(chat, '📅 Қабулга ёзилиш');
  const first = (await out(chat)).at(-1);
  if (first.text.includes('Ким учун')) await press(chat, (t) => !t.includes('➕'));
  await press(chat, (t) => t.includes('сўм'));
  await press(chat, (t) => t.includes('·'));
  await press(chat, (t) => /^\d\d\.\d\d /.test(t));
  await press(chat, (t) => /^\d\d:\d\d$/.test(t));
  const confirm = (await out(chat)).at(-1).text;
  assert.match(confirm, /Маълумотларни текширинг/);
  assert.ok(confirm.includes(`${p.last_name} ${p.first_name}`), 'bemor ismi lotinda qoldi: ' + confirm);
  await press(chat, '✅ Тасдиқлаш');
  const all = await texts(chat);
  assert.match(all, /Қабулга ёзилдингиз/);
  assert.match(all, /Шифокор вақтини тежаш/, 'so‘rovnoma taklifi ham kirillda');
});

test('boshqa odamning kontakti qabul qilinmaydi (engine darajasida)', async () => {
  const bot = await bots.simulator(SEED_IDS.tenant);
  const t = bots.transportFor(bot);
  const chatId = -777001;
  await engine.handleUpdate(bot, { update_id: 900001, message: { message_id: 1, chat: { id: chatId, type: 'private' }, from: { id: chatId }, text: '/start' } }, t);
  await engine.handleUpdate(bot, { update_id: 900002, message: { message_id: 2, chat: { id: chatId, type: 'private' }, from: { id: chatId }, contact: { phone_number: '998901112233', user_id: 12345 } } }, t);
  const row = (await pool.query(`SELECT phone FROM telegram_chats WHERE bot_id = $1 AND chat_id = $2`, [bot.id, chatId])).rows[0];
  assert.equal(row.phone, null, 'begona kontakt bog‘lanmadi');
  assert.match((await out(chatId)).at(-1).text, /o‘zingizning raqamingizni/);
  // group chats are ignored completely
  await engine.handleUpdate(bot, { update_id: 900003, message: { message_id: 3, chat: { id: -100555, type: 'group' }, from: { id: 1 }, text: '/start' } }, t);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM telegram_chats WHERE chat_id = -100555`)).rows[0].n, 0);
});

test('yozilish: xizmat → shifokor → kun → vaqt → tasdiq; qabul jadvalda, manba Telegram, audit «Telegram bot»', async () => {
  const p = await uniquePhone();
  const chat = await linked(p.phone);
  const a = await bookVia(chat);
  assert.ok(a, 'qabul yaratildi');
  assert.equal(a.status, 'scheduled');
  const pat = (await pool.query(`SELECT phone FROM patients WHERE id = $1`, [a.patient_id])).rows[0];
  assert.equal(pat.phone, p.phone);
  assert.match(await texts(chat), /Qabulga yozildingiz/);
  const audit = (await pool.query(`SELECT actor_name, actor_role, actor_membership_id, summary FROM audit_logs WHERE resource_id = $1 AND action = 'appointment.create'`, [a.id])).rows[0];
  assert.equal(audit.actor_name, 'Telegram bot'); assert.equal(audit.actor_role, 'system'); assert.equal(audit.actor_membership_id, null);
  assert.match(audit.summary, /Telegram/);
  assert.ok(new Date(a.starts_at).getTime() >= Date.now() - 1e12, 'sana bor');
  // staff sees it in the schedule like any other booking
  const day = new Date(a.starts_at.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
  assert.ok((await registrar.get(`/appointments?date=${day}`)).body.data.some((x) => x.id === a.id));
});

test('takroriy update va eski tugma: dublikat yo‘q; band bo‘lgan vaqt — «band qildi» va boshqa vaqt', async () => {
  const p = await uniquePhone();
  const chat = await linked(p.phone);
  const bot = await bots.simulator(SEED_IDS.tenant);
  const t = bots.transportFor(bot);
  // replayed update_id is processed once
  const u = { update_id: 900100, message: { message_id: 1, chat: { id: chat, type: 'private' }, from: { id: chat }, text: '🗓 Mening qabullarim' } };
  const before = (await out(chat)).length;
  await engine.handleUpdate(bot, u, t); await engine.handleUpdate(bot, u, t);
  assert.equal((await out(chat)).length - before, 1, 'bir marta javob');

  // reach the confirm step, then a registrar takes that exact slot
  await say(chat, '📅 Qabulga yozilish');
  if ((await out(chat)).at(-1).text.includes('Kim uchun')) await press(chat, (x) => !x.includes('➕'));
  await press(chat, (x) => x.includes('so‘m'));
  await press(chat, (x) => x.includes('·'));
  await press(chat, (x) => /^\d\d\.\d\d /.test(x));
  const timeBtn = await press(chat, (x) => /^\d\d:\d\d$/.test(x));
  const st = (await pool.query(`SELECT state FROM telegram_chats WHERE bot_id = $1 AND chat_id = $2`, [bot.id, chat])).rows[0].state;
  assert.equal(st.step, 'confirm');
  const other = (await pool.query(`SELECT id FROM patients WHERE tenant_id = $1 AND phone IS DISTINCT FROM $2 LIMIT 1`, [SEED_IDS.tenant, p.phone])).rows[0];
  const taken = await registrar.post('/appointments', { patient_id: other.id, branch_id: st.d.branch_id, doctor_id: st.d.doctor_id, service_id: st.d.service_id, date: st.d.date, start_time: timeBtn.text }, { 'Idempotency-Key': randomUUID() });
  assert.equal(taken.status, 201, JSON.stringify(taken.body));
  const n0 = (await pool.query(`SELECT count(*)::int AS n FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE phone = $1) AND source = 'telegram'`, [p.phone])).rows[0].n;
  await press(chat, '✅ Tasdiqlash');
  assert.match((await out(chat)).at(-1).text, /boshqa bemor band qildi/);
  const n1 = (await pool.query(`SELECT count(*)::int AS n FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE phone = $1) AND source = 'telegram'`, [p.phone])).rows[0].n;
  assert.equal(n1, n0, 'band vaqtga yozilmadi');
  assert.ok(!(await out(chat)).at(-1).markup.inline_keyboard.flat().some((b) => b.text === timeBtn.text), 'band vaqt endi taklif qilinmaydi');
  // an old keyboard is stale
  const stale = await manager.post('/telegram/sim/send', { chat_id: chat, callback_data: `${st.v}:ok`, label: 'eski' });
  assert.equal(stale.status, 200);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE phone = $1) AND source = 'telegram'`, [p.phone])).rows[0].n, n1);
});

test('yangi bemor: ro‘yxatdan o‘tish (noto‘g‘ri sana rad etiladi), karta Telegram manbasi bilan, keyin yozilish', async () => {
  const phone = '+998935550001';
  const chat = await linked(phone);
  assert.match(await texts(chat), /karta topilmadi/);
  await say(chat, '📅 Qabulga yozilish');
  assert.match((await out(chat)).at(-1).text, /Familiyani/);
  await say(chat, 'x');
  assert.match((await out(chat)).at(-1).text, /2–40/);
  await say(chat, 'telegramov'); await say(chat, 'sinov');
  await say(chat, '31.02.1990');
  assert.match((await out(chat)).at(-1).text, /Sana noto‘g‘ri/);
  await say(chat, '05.03.1991');
  assert.match((await out(chat)).at(-1).text, /roziligingiz kerak/, 'yangi karta oldidan rozilik so‘raladi');
  await press(chat, '✅ Roziman');
  const p = (await pool.query(`SELECT * FROM patients WHERE phone = $1`, [phone])).rows[0];
  assert.equal(p.last_name, 'Telegramov'); assert.equal(p.first_name, 'Sinov'); assert.equal(p.birth_date, '1991-03-05'); assert.equal(p.source, 'telegram');
  assert.match((await out(chat)).at(-1).text, /Xizmatni tanlang/);
  // same person again → no duplicate card
  await say(chat, '📅 Qabulga yozilish');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patients WHERE phone = $1`, [phone])).rows[0].n, 1);
});

test('so‘rovnoma: javoblar faqat shu qabul shifokoriga ko‘rinadi', async () => {
  const p = await uniquePhone();
  const chat = await linked(p.phone);
  const a = await bookVia(chat);
  await press(chat, 'Ha, to‘ldiraman');
  await say(chat, 'Ikki kundan beri bosh og‘riyapti');
  await press(chat, 'Yo‘q');
  await say(chat, 'Paratsetamol');
  assert.match((await out(chat)).at(-1).text, /shifokoringizga yetkaziladi/);
  const doctorMembership = (await pool.query(`SELECT membership_id FROM doctors WHERE id = $1`, [a.doctor_id])).rows[0].membership_id;
  const doc = session(); await doc.demo(doctorMembership);
  const r = await doc.get(`/appointments/${a.id}/intake`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.complaints, 'Ikki kundan beri bosh og‘riyapti');
  assert.equal(r.body.data.allergies, null);
  assert.equal(r.body.data.medications, 'Paratsetamol');
  // another doctor who works in the same branch (outside the branch the answer would be 404, not 403)
  const otherDoc = (await pool.query(
    `SELECT d.membership_id FROM doctors d JOIN memberships m ON m.id = d.membership_id
      WHERE d.id <> $1 AND d.tenant_id = $2 AND m.branch_ids @> ARRAY[(SELECT branch_id FROM appointments WHERE id = $3)] ORDER BY d.display_name LIMIT 1`,
    [a.doctor_id, SEED_IDS.tenant, a.id])).rows[0].membership_id;
  const d2 = session(); await d2.demo(otherDoc);
  assert.equal((await d2.get(`/appointments/${a.id}/intake`)).status, 403);
  assert.equal((await manager.get(`/appointments/${a.id}/intake`)).status, 403, 'rahbar klinik matnni o‘qimaydi');
  assert.equal((await registrar.get(`/appointments/${a.id}/intake`)).status, 403);
  // audit never contains the patient's text
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE summary LIKE '%bosh og‘riyapti%'`)).rows[0].n, 0);
});

test('mening qabullarim: ko‘chirish va bekor qilish; begona qabulga tegib bo‘lmaydi', async () => {
  const p = await uniquePhone();
  const chat = await linked(p.phone);
  const a = await bookVia(chat);
  await say(chat, '🗓 Mening qabullarim');
  await press(chat, '🔁 Ko‘chirish');
  await press(chat, (x) => /^\d\d\.\d\d /.test(x));
  const msgs = (await out(chat)).at(-1).markup.inline_keyboard.flat().filter((b) => /^\d\d:\d\d$/.test(b.text));
  const pick = msgs.at(-1);
  await manager.post('/telegram/sim/send', { chat_id: chat, callback_data: pick.callback_data, label: pick.text });
  await press(chat, '✅ Tasdiqlash');
  assert.match((await out(chat)).at(-1).text, /Qabul ko‘chirildi/);
  const moved = (await pool.query(`SELECT * FROM appointments WHERE id = $1`, [a.id])).rows[0];
  assert.equal(new Date(moved.starts_at.getTime() + 5 * 3600_000).toISOString().slice(11, 16), pick.text);
  assert.equal(moved.version, a.version + 1);

  // someone else's appointment id in a forged callback
  const foreign = (await pool.query(`SELECT a.id FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.status = 'scheduled' AND p.phone IS DISTINCT FROM $1 AND a.starts_at > now() - interval '30 days' LIMIT 1`, [p.phone])).rows[0];
  await manager.post('/telegram/sim/send', { chat_id: chat, callback_data: `a:cy:${foreign.id}`, label: 'soxta' });
  assert.equal((await pool.query(`SELECT status FROM appointments WHERE id = $1`, [foreign.id])).rows[0].status, 'scheduled');
  assert.match((await out(chat)).at(-1).text, /topilmadi/);

  await say(chat, '🗓 Mening qabullarim');
  await press(chat, '❌ Bekor qilish');
  await press(chat, 'Ha, bekor qilish');
  const c = (await pool.query(`SELECT status, cancel_reason FROM appointments WHERE id = $1`, [a.id])).rows[0];
  assert.equal(c.status, 'cancelled'); assert.match(c.cancel_reason, /Telegram/);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE appointment_id = $1 AND kind = 'cancelled_by_clinic'`, [a.id])).rows[0].n, 0, 'bemorning o‘ziga «klinika bekor qildi» yuborilmaydi');
});

test('eslatmalar: bir kun oldin (tugmalar bilan) va 2 soat oldin; ikki marta yuborilmaydi; «Kelaman» belgilanadi', async () => {
  const p = await uniquePhone();
  const chat = await linked(p.phone);
  const patient = (await pool.query(`SELECT id FROM patients WHERE phone = $1`, [p.phone])).rows[0];
  // two staff bookings for this patient: ~5 h and ~1.5 h ahead (doctor working today)
  const nowLocal = (await pool.query(`SELECT demo_now() AS n`)).rows[0].n;
  const today = new Date(nowLocal.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
  const hhmm = (h) => new Date(nowLocal.getTime() + 5 * 3600_000 + h * 3600_000).toISOString().slice(11, 16).replace(/:(\d\d)$/, (_, m) => ':' + String(Math.ceil(Number(m) / 15) * 15 % 60).padStart(2, '0'));
  const docs = (await registrar.get(`/doctors`)).body.data;
  async function bookAt(hoursAhead) {
    for (const d of docs) {
      const svc = d.service_ids?.[0]; if (!svc) continue;
      const av = (await registrar.get(`/availability?doctor_id=${d.id}&date=${today}&service_id=${svc}`)).body.data;
      if (!av.working) continue;
      const target = hhmm(hoursAhead);
      const slot = av.slots.find((s) => s.free && !s.past && s.time >= target);
      if (!slot) continue;
      const r = await registrar.post('/appointments', { patient_id: patient.id, branch_id: av.branch_id, doctor_id: d.id, service_id: svc, date: today, start_time: slot.time }, { 'Idempotency-Key': randomUUID() });
      if (r.status === 201) return r.body.data.id;
    }
    throw new Error('no slot for ' + hoursAhead);
  }
  const dayId = await bookAt(5), soonId = await bookAt(1.25);
  // booked yesterday (a booking made less than 20 h before the visit gets no day-before reminder); the staff booking
  // confirmations are delivered first so the reminder texts are read from a clean mark
  await pool.query(`UPDATE appointments SET created_at = starts_at - interval '25 hours' WHERE id = ANY($1)`, [[dayId, soonId]]);
  await notifier.deliverDue();
  const mark = await lastId(chat);
  assert.ok((await notifier.planReminders()) >= 2);
  await notifier.deliverDue();
  const got = await out(chat, mark);
  const day = got.find((m) => m.text.includes('🔔 Eslatma'));
  const soon = got.find((m) => m.text.includes('⏰'));
  assert.ok(day && soon, JSON.stringify(got.map((m) => m.text)));
  assert.ok(day.markup.inline_keyboard.flat().some((b) => b.callback_data === `a:ok:${dayId}`));
  // idempotent planning and delivery
  assert.equal(await notifier.planReminders(), 0);
  await notifier.deliverDue();
  assert.equal((await out(chat, mark)).length, got.length);
  await press(chat, '✅ Kelaman');
  assert.ok((await pool.query(`SELECT patient_confirmed_at FROM appointments WHERE id = $1`, [dayId])).rows[0].patient_confirmed_at);
  // registrar moves the booking → patient is told; the day reminder for the new time is a new notice
  const ap = (await registrar.get(`/appointments/${dayId}`)).body.data;
  const mark2 = await lastId(chat);
  const resched = await registrar.post(`/appointments/${dayId}/cancel`, { version: ap.version, reason: 'Shifokor kasal' });
  assert.equal(resched.status, 200);
  await notifier.deliverDue();
  assert.match(await texts(chat, mark2), /Klinika .* bekor qildi/);
});

test('natija tayyor: lab tasdiqlasa bemorga xabar boradi, qiymatlar yuborilmaydi', async () => {
  const o = (await pool.query(
    `SELECT o.id, p.phone, lr.values FROM service_orders o JOIN patients p ON p.id = o.patient_id JOIN lab_results lr ON lr.order_id = o.id
      WHERE o.tenant_id = $1 AND o.status = 'draft_result' AND p.phone IS NOT NULL LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  assert.ok(o, 'seed’da qoralama natija bor');
  const chat = await linked(o.phone);
  const mark = await lastId(chat);
  assert.equal((await lab.post(`/orders/${o.id}/verify`)).status, 200);
  await notifier.deliverDue();
  const msg = await texts(chat, mark);
  assert.match(msg, /natijasi tayyor/);
  // no result value (3+ characters, so it can't collide with digits in a service name) and no unit reaches Telegram
  const values = o.values.map((v) => String(v.value ?? '')).filter((v) => v.length >= 3);
  assert.ok(values.length > 0, 'tekshiradigan qiymat bor');
  for (const v of values) assert.ok(!msg.includes(v), `qiymat ${v} yuborilmagan`);
  for (const u of o.values.map((v) => v.unit).filter((u) => u && u.length >= 2)) assert.ok(!msg.includes(u), `birlik ${u} yo‘q`);
});

test('cheklov: bitta chat daqiqasiga 30 tadan ko‘p xabar yubora olmaydi', async () => {
  const chat = await newChat();
  for (let i = 0; i < 35; i++) await say(chat, '/start');
  const answers = (await out(chat)).length;
  assert.equal(answers, 30, `30 ta javob, qolgani tashlab yuborildi (${answers})`);
});

test('ruxsatlar: simulyator faqat rahbar va demo rejimda; boshqa klinikaning suhbatini ko‘rib bo‘lmaydi', async () => {
  const chat = await newChat();
  await say(chat, '/start');
  assert.equal((await registrar.post('/telegram/sim/send', { chat_id: chat, text: 'salom' })).status, 403);
  assert.equal((await registrar.get(`/telegram`)).status, 403);
  const t2 = session(); await t2.demo(M.tenant2Manager);
  assert.deepEqual((await t2.get(`/telegram/sim/messages?chat_id=${chat}`)).body.data, [], 'boshqa tenant boti');
  assert.equal((await manager.post('/telegram/sim/send', { chat_id: 5, text: 'x' })).status, 422, 'faqat manfiy (simulyator) chat id');
});

test('token ulash: shifrlanadi, javobda qaytmaydi; noto‘g‘ri token 422; kalitsiz 409; long polling ishlaydi', async () => {
  config.telegram.apiBase = fake.url;
  const token = '111111:' + 'A'.repeat(35);
  config.secretKey = '';
  let r = await manager.post('/telegram/bot', { token });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'SECRETS_NOT_CONFIGURED');
  config.secretKey = Buffer.alloc(32, 7).toString('base64');
  assert.equal((await manager.post('/telegram/bot', { token: 'abc' })).status, 422);
  assert.equal((await manager.post('/telegram/bot', { token: '222222:' + 'B'.repeat(35) })).status, 422, 'Telegram rad etgan token');
  r = await manager.post('/telegram/bot', { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.username, 'TestClinicBot');
  const st = await manager.get('/telegram');
  assert.equal(st.body.data.bot.username, 'TestClinicBot');
  assert.ok(!st.text.includes(token) && !st.text.includes('AAAAAAAAAA'), 'token javobda yo‘q');
  const row = (await pool.query(`SELECT token_enc FROM telegram_bots WHERE tenant_id = $1 AND kind = 'telegram'`, [SEED_IDS.tenant])).rows[0];
  assert.ok(row.token_enc.startsWith('v1.') && !row.token_enc.includes('AAAAAAAAAA'));
  assert.ok(fake.calls.some((c) => c.method === 'deleteWebhook'));

  // long polling: an update from "Telegram" is processed and answered through the real HTTP transport
  // the bot row survives demo resets (by design), so continue after the stored offset like Telegram would
  const nextId = Number((await pool.query(`SELECT last_update_id FROM telegram_bots WHERE tenant_id = $1 AND kind = 'telegram'`, [SEED_IDS.tenant])).rows[0].last_update_id) + 1;
  fake.updates.push({ update_id: nextId, message: { message_id: 1, chat: { id: 4242, type: 'private' }, from: { id: 4242, language_code: 'ru' }, text: '/start' } });
  await workers.syncPollers();
  const t0 = Date.now();
  while (!fake.calls.some((c) => c.method === 'sendMessage' && c.params.chat_id === 4242) && Date.now() - t0 < 5000) await new Promise((x) => setTimeout(x, 100));
  const reply = fake.calls.find((c) => c.method === 'sendMessage' && c.params.chat_id === 4242);
  assert.ok(reply, 'javob yuborildi');
  assert.match(reply.params.text, /Здравствуйте/, 'til Telegram sozlamasidan');
  const bot = (await pool.query(`SELECT last_update_id FROM telegram_bots WHERE tenant_id = $1 AND kind = 'telegram'`, [SEED_IDS.tenant])).rows[0];
  assert.equal(Number(bot.last_update_id), nextId);
  // disconnect stops polling and is audited
  assert.equal((await manager.del('/telegram/bot')).status, 200);
  await workers.syncPollers();
  assert.equal((await manager.get('/telegram')).body.data.bot.status, 'disabled');
  workers.onModuleDestroy();
});

test('demo reset ulangan botni va suhbatlarni saqlaydi', async () => {
  const before = (await pool.query(`SELECT count(*)::int AS n FROM telegram_bots`)).rows[0].n;
  const chats = (await pool.query(`SELECT count(*)::int AS n FROM telegram_chats`)).rows[0].n;
  assert.ok(before >= 1 && chats >= 1);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM telegram_bots`)).rows[0].n, before);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM telegram_chats`)).rows[0].n, chats);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM telegram_chats WHERE state <> '{}'::jsonb`)).rows[0].n, 0, 'suhbat holati tozalandi');
});
