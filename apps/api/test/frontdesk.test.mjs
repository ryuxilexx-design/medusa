// Front desk audit (2026-10-22): booking confirmation to the patient, family cards in the bot, walk-in («Hozir qabul
// qilish»), Latin ↔ Cyrillic patient search, reminder hygiene (quiet hours, 20-hour rule, blocked bot) and the purge
// of processed Telegram update ids. Telegram is always the simulator transport — no real Telegram here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool, notifier, bots, workers, TelegramError;

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

let manager, registrar, cashier, me;
const out = async (chat, after = 0) => (await manager.get(`/telegram/sim/messages?chat_id=${chat}&after=${after}`)).body.data.filter((m) => m.direction === 'out');
const lastId = async (chat) => { const all = (await manager.get(`/telegram/sim/messages?chat_id=${chat}`)).body.data; return all.length ? all[all.length - 1].id : 0; };
const say = (chat, text) => manager.post('/telegram/sim/send', { chat_id: chat, text });
const share = (chat, phone) => manager.post('/telegram/sim/send', { chat_id: chat, contact_phone: phone });
const newChat = async () => (await manager.post('/telegram/sim/chats')).body.data.chat_id;
const texts = async (chat, after = 0) => (await out(chat, after)).map((m) => m.text).join('\n---\n');
async function linked(phone) { const chat = await newChat(); await say(chat, '/start'); await share(chat, phone); return chat; }

const demoNow = async () => (await pool.query(`SELECT demo_now() AS n`)).rows[0].n;
const localOf = (d) => new Date(d.getTime() + 5 * 3600_000); // Tashkent wall clock as a UTC date
const dateOf = (d) => localOf(d).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
/** Moves the demo clock (test database only) so the Tashkent wall clock reads `hhmm` on local `date`. */
async function setLocal(date, hhmm) {
  const target = new Date(Date.parse(`${date}T${hhmm}:00Z`) - 5 * 3600_000);
  const cur = await demoNow();
  await pool.query(`UPDATE demo_clock SET demo_anchor = demo_anchor + ($1::timestamptz - $2::timestamptz) WHERE id = 1`, [target, cur]);
}

/** A seed patient whose phone is theirs alone and not yet used by any test chat. */
const uniquePhone = async () => (await pool.query(
  `SELECT p.id, p.phone, p.last_name, p.first_name FROM patients p
    WHERE p.tenant_id = $1 AND p.phone IS NOT NULL AND p.contact_phone IS NULL
      AND (SELECT count(*) FROM patients x WHERE x.tenant_id = $1 AND (x.phone = p.phone OR x.contact_phone = p.phone)) = 1
      AND NOT EXISTS (SELECT 1 FROM telegram_chats tc WHERE tc.phone = p.phone)
      AND NOT EXISTS (SELECT 1 FROM patient_consents c WHERE c.patient_id = p.id AND c.kind = 'notifications' AND NOT c.granted)
      AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.status = 'scheduled' AND a.starts_at > demo_now())
    ORDER BY p.patient_number LIMIT 1`, [SEED_IDS.tenant])).rows[0];

/** Books `patient` with the registrar: the first free future slot on `date` (any working doctor), optionally at/after HH:MM. */
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

before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  ({ Notifier: notifier, BotRegistry: bots } = require('../dist/telegram/notifier.js'));
  notifier = app.get(notifier); bots = app.get(bots);
  workers = app.get(require('../dist/telegram/workers.js').TelegramWorkers);
  ({ TelegramError } = require('../dist/telegram/transport.js'));
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  await db.assertDatabaseName(pool, '_test');
  await pool.query(`DELETE FROM telegram_chats`);
  await pool.query(`DELETE FROM telegram_sim_messages`);
  // the suite boots at 07:30 (quiet hours): the front desk day starts at 09:30
  await setLocal(dateOf(await demoNow()), '09:30');
  registrar = session(); await registrar.demo(M.registrar);
  cashier = session(); await cashier.demo(M.cashier);
  me = (await registrar.get('/me')).body.data;
});
after(async () => { await app?.close(); });

test('registratura yozsa bemorga Telegram’da tasdiq boradi (sana, vaqt, shifokor, manzil); navbatsiz qabulda yuborilmaydi', async () => {
  const p = await uniquePhone();
  const chat = await linked(p.phone);
  const mark = await lastId(chat);
  const tomorrow = addDays(dateOf(await demoNow()), 1);
  const b = await bookOn(p.id, tomorrow);
  const n = (await pool.query(`SELECT status FROM notifications WHERE appointment_id = $1 AND kind = 'booked'`, [b.id])).rows;
  assert.equal(n.length, 1, 'bitta «booked» xabar navbatda');
  await notifier.deliverDue();
  const msg = await texts(chat, mark);
  assert.match(msg, /Klinika sizni qabulga yozdi/);
  assert.ok(msg.includes(b.time) && msg.includes(b.doctor.display_name), msg);
  const addr = (await pool.query(`SELECT b.address FROM appointments a JOIN branches b ON b.id = a.branch_id WHERE a.id = $1`, [b.id])).rows[0].address;
  assert.ok(msg.includes(addr), 'filial manzili bor');
  assert.equal((await pool.query(`SELECT status FROM notifications WHERE appointment_id = $1 AND kind = 'booked'`, [b.id])).rows[0].status, 'sent');
  // the same appointment is not announced twice
  await notifier.deliverDue();
  assert.equal(await lastId(chat), (await out(chat)).at(-1).id);
});

test('oilaviy karta: bolaning kartasi (contact_phone = ota-ona raqami) ota-onaning chatida ko‘rinadi; begona chat ko‘rmaydi', async () => {
  const parent = await uniquePhone();
  const child = (await registrar.post('/patients', { last_name: 'Oilaviy', first_name: 'Bola', birth_date: '2019-05-05', sex: 'female', phone: null, contact_name: `${parent.last_name} (onasi)`, contact_phone: parent.phone })).body.data;
  assert.ok(child?.id, JSON.stringify(child));
  const chat = await linked(parent.phone);
  assert.match(await texts(chat), /Oilaviy Bola/, 'ulashda bolaning kartasi topildi');
  const tomorrow = addDays(dateOf(await demoNow()), 1);
  const mark = await lastId(chat);
  const b = await bookOn(child.id, tomorrow);
  await notifier.deliverDue();
  assert.match(await texts(chat, mark), /Oilaviy Bola/, 'bolaning yozuvi haqida ota-onaga xabar');
  await say(chat, '🗓 Mening qabullarim');
  assert.match((await out(chat)).at(-1).text, /Oilaviy Bola/, '«Mening qabullarim»da bola bor');
  // another verified phone never reaches this appointment
  const stranger = await uniquePhone();
  const other = await linked(stranger.phone);
  const m2 = await lastId(other);
  await manager.post('/telegram/sim/send', { chat_id: other, callback_data: `a:cx:${b.id}`, label: 'x' });
  assert.match(await texts(other, m2), /topilmadi/, 'begona chat uchun qabul yo‘q');
  await say(other, '🗓 Mening qabullarim');
  assert.ok(!(await out(other)).at(-1).text.includes('Oilaviy Bola'));
  // the card itself shows the Telegram link
  assert.equal((await registrar.get(`/patients/${child.id}`)).body.data.telegram_linked, true);
});

test('oilaviy karta chegarasi: o‘z telefoni bor katta bemorning kartasi aloqa shaxsining chatiga ko‘rinmaydi', async () => {
  const adultPhone = '+99890' + String(7_000_000 + Math.floor(Math.random() * 999_999)).padStart(7, '0'); // not a seed number
  const contact = await uniquePhone();
  const card = (await registrar.post('/patients', { last_name: 'Kattalar', first_name: 'Bemor', birth_date: '1980-02-02', sex: 'male', phone: adultPhone, contact_name: 'Hamkasb', contact_phone: contact.phone })).body.data;
  assert.ok(card?.id, JSON.stringify(card));
  const chat = await linked(contact.phone);
  assert.ok(!(await texts(chat)).includes('Kattalar Bemor'), 'aloqa shaxsi katta bemorning kartasini ko‘rmaydi');
  const tomorrow = addDays(dateOf(await demoNow()), 1);
  const mark = await lastId(chat);
  await bookOn(card.id, tomorrow);
  await notifier.deliverDue();
  assert.ok(!(await texts(chat, mark)).includes('Kattalar Bemor'), 'uning qabuli haqida xabar ham bormaydi');
  await say(chat, '🗓 Mening qabullarim');
  assert.ok(!(await out(chat)).at(-1).text.includes('Kattalar Bemor'));
  // the registrar sees the card as not linked to Telegram
  assert.equal((await registrar.get(`/patients/${card.id}`)).body.data.telegram_linked, false);
});

test('navbatsiz qabul: eng yaqin bo‘sh vaqt + «Keldi» bitta so‘rovda; bo‘sh vaqt bo‘lmasa 409 NO_SLOT; kassir 403', async () => {
  const now = await demoNow();
  const today = dateOf(now), nowMin = localOf(now).getUTCHours() * 60 + localOf(now).getUTCMinutes();
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const docs = (await registrar.get('/doctors')).body.data;
  let pick = null;
  for (const d of docs) {
    const svc = d.service_ids?.[0]; if (!svc) continue;
    const av = (await registrar.get(`/availability?doctor_id=${d.id}&date=${today}&service_id=${svc}`)).body.data;
    if (!av.working || !me.branches.some((b) => b.id === av.branch_id)) continue;
    const s = av.slots.find((x) => x.free && toMin(x.time) >= Math.floor(nowMin / 15) * 15 && toMin(x.time) <= nowMin + 60);
    if (s) { pick = { d, expect: s.time }; break; }
  }
  assert.ok(pick, 'bugun bo‘sh shifokor bor');
  const patient = (await pool.query(`SELECT id FROM patients WHERE tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = patients.id AND a.starts_at::date = $2::date) ORDER BY patient_number DESC LIMIT 1`, [SEED_IDS.tenant, today])).rows[0];
  assert.equal((await cashier.post('/appointments/walk-in', { patient_id: patient.id, doctor_id: pick.d.id })).status, 403);
  const r = await registrar.post('/appointments/walk-in', { patient_id: patient.id, doctor_id: pick.d.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.start_time, pick.expect);
  assert.ok(r.body.data.queue_number >= 1 && r.body.data.invoice_id);
  const a = (await registrar.get(`/appointments/${r.body.data.id}`)).body.data;
  assert.equal(a.status, 'arrived');
  assert.equal(a.queue_number, r.body.data.queue_number);
  assert.ok(a.invoice, 'hisob ochildi');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE appointment_id = $1`, [a.id])).rows[0].n, 0, 'stolda turgan bemorga xabar yo‘q');
  // the slip carries the branch address and phone
  assert.ok(a.branch_address && a.branch_phone, 'manzil va telefon');
  // the audit names the walk-in
  assert.match((await pool.query(`SELECT summary FROM audit_logs WHERE resource_id = $1 AND action = 'appointment.create'`, [a.id])).rows[0].summary, /navbatsiz/);

  // a doctor who does not work today: nothing free → 409 NO_SLOT (and no appointment, no ticket)
  const wd = new Date(today + 'T00:00:00Z').getUTCDay();
  const service = (await manager.get('/services')).body.data.find((s) => s.category === 'consultation');
  const st = (await manager.post('/staff', { full_name: 'Navbatsiz Sinov', role: 'doctor', login: 'dr.navbatsiz', branch_ids: [me.branches[0].id], doctor: { specialty: 'Terapevt', share_percent: 30, service_ids: [service.id] } })).body.data;
  const doc = (await manager.get('/staff')).body.data.find((x) => x.membership_id === st.membership_id);
  const days = [0, 1, 2, 3, 4, 5, 6].filter((x) => x !== wd).map((weekday) => ({ weekday, branch_id: me.branches[0].id, start: '09:00', end: '18:00' }));
  assert.equal((await manager.put(`/staff/doctors/${doc.doctor_id}/schedule`, { days })).status, 200);
  const before = (await pool.query(`SELECT count(*)::int AS n FROM appointments WHERE patient_id = $1`, [patient.id])).rows[0].n;
  const no = await registrar.post('/appointments/walk-in', { patient_id: patient.id, doctor_id: doc.doctor_id });
  assert.equal(no.status, 409); assert.equal(no.body.error.code, 'NO_SLOT');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM appointments WHERE patient_id = $1`, [patient.id])).rows[0].n, before);
});

test('qidiruv: kirillcha so‘rov lotincha kartani topadi va aksincha (apostrof shakli farq qilmaydi)', async () => {
  const mk = (last, first) => registrar.post('/patients', { last_name: last, first_name: first, birth_date: '1990-01-01', sex: 'male', phone: null, contact_phone: null, confirm_duplicate: true });
  assert.equal((await mk('Xolmatova', 'Sevara')).status, 201);
  assert.equal((await mk('Юсупов', 'Ботир')).status, 201);
  assert.equal((await mk('O‘ktamova', 'Dilnoza')).status, 201);
  const find = async (q) => (await registrar.get(`/patients?search=${encodeURIComponent(q)}`)).body.data.map((p) => `${p.last_name} ${p.first_name}`);
  assert.ok((await find('Холматова')).includes('Xolmatova Sevara'), 'kirill → lotin');
  assert.ok((await find('холматова сев')).includes('Xolmatova Sevara'), 'kichik harf, qism');
  assert.ok((await find('Yusupov')).includes('Юсупов Ботир'), 'lotin → kirill');
  assert.ok((await find('Botir Yusupov')).includes('Юсупов Ботир'), 'ism familiya tartibi');
  assert.ok((await find('Ўктамова')).includes('O‘ktamova Dilnoza'), 'ў → o‘');
  assert.ok((await find("O'ktamova")).includes('O‘ktamova Dilnoza'), 'ASCII apostrof');
  assert.ok((await find('Xolmatova')).includes('Xolmatova Sevara'), 'oddiy qidiruv buzilmagan');
});

test('eslatma gigiyenasi: 21:00–08:00 da xabar kutadi (bekor qilish kutmaydi); 20 soatdan kam oldin yozilganga «bir kun oldin» eslatma yo‘q', async () => {
  const p = await uniquePhone();
  const chat = await linked(p.phone);
  const today = dateOf(await demoNow());
  const d2 = addDays(today, 2), d3 = addDays(today, 3);
  const b1 = await bookOn(p.id, d2);
  const b2 = await bookOn(p.id, d3);
  await pool.query(`UPDATE notifications SET status = 'skipped' WHERE appointment_id = ANY($1) AND status = 'pending'`, [[b1.id, b2.id]]); // start clean
  // 22:00: the registrar books one more → the confirmation waits for 08:00
  await setLocal(today, '22:00');
  const b3 = await bookOn(p.id, d3, '12:00');
  const mark = await lastId(chat);
  await notifier.deliverDue();
  const n3 = (await pool.query(`SELECT status, next_attempt_at FROM notifications WHERE appointment_id = $1 AND kind = 'booked'`, [b3.id])).rows[0];
  assert.equal(n3.status, 'pending');
  assert.equal(localOf(n3.next_attempt_at).toISOString().slice(0, 16), `${addDays(today, 1)}T08:00`, 'ertalab 08:00 gacha kutadi');
  assert.equal((await out(chat, mark)).length, 0, 'kechasi hech narsa yuborilmadi');
  // a cancellation by the clinic is urgent: it goes out at night
  const ap = (await registrar.get(`/appointments/${b1.id}`)).body.data;
  assert.equal((await registrar.post(`/appointments/${b1.id}/cancel`, { version: ap.version, reason: 'Shifokor kasal' })).status, 200);
  await notifier.deliverDue();
  assert.match(await texts(chat, mark), /bekor qildi/);
  assert.ok(!(await texts(chat, mark)).includes('qabulga yozdi'));
  // 08:30 next day: the confirmation arrives
  await setLocal(addDays(today, 1), '08:30');
  const mark2 = await lastId(chat);
  await notifier.deliverDue();
  assert.match(await texts(chat, mark2), /qabulga yozdi/);

  // 20-hour rule: both visits on d3 are inside the 3–24 h window; b2 was booked 30 h ahead, b3 only 19 h ahead
  await setLocal(addDays(today, 2), '18:00');
  await pool.query(`UPDATE appointments SET created_at = starts_at - interval '30 hours' WHERE id = $1`, [b2.id]);
  await pool.query(`UPDATE appointments SET created_at = starts_at - interval '19 hours' WHERE id = $1`, [b3.id]);
  await notifier.planReminders();
  const kinds = async (id) => (await pool.query(`SELECT kind FROM notifications WHERE appointment_id = $1 AND kind LIKE 'reminder%'`, [id])).rows.map((r) => r.kind);
  assert.ok((await kinds(b2.id)).includes('reminder_day'), 'oldindan yozilgan qabulga bir kun oldin eslatma bor');
  assert.ok(!(await kinds(b3.id)).includes('reminder_day'), '19 soat oldin yozilgan qabulga «bir kun oldin» eslatma yo‘q');
  await setLocal(addDays(today, 1), '09:30'); // back to a normal day
});

test('bemor botni bloklagan: xabar «sent» emas, «skipped» (sababi bilan), chat bloklangan deb belgilanadi', async () => {
  const p = await uniquePhone();
  const chat = await linked(p.phone);
  const b = await bookOn(p.id, addDays(dateOf(await demoNow()), 1));
  const orig = bots.transportFor;
  bots.transportFor = () => ({ call: async () => { throw new TelegramError(403, 'Forbidden: bot was blocked by the user'); } });
  try { await notifier.deliverDue(); } finally { bots.transportFor = orig; }
  const n = (await pool.query(`SELECT status, error FROM notifications WHERE appointment_id = $1 AND kind = 'booked'`, [b.id])).rows[0];
  assert.equal(n.status, 'skipped'); assert.match(n.error, /bloklagan/);
  assert.equal((await pool.query(`SELECT blocked FROM telegram_chats WHERE chat_id = $1`, [chat])).rows[0].blocked, true);
});

test('telegram_updates: 7 kundan eski yozuvlar kunlik tozalashda o‘chadi, yangilari qoladi', async () => {
  const bot = (await pool.query(`SELECT id FROM telegram_bots WHERE tenant_id = $1 AND kind = 'simulator'`, [SEED_IDS.tenant])).rows[0];
  await pool.query(`INSERT INTO telegram_updates (bot_id, update_id, received_at) VALUES ($1, 9000001, clock_timestamp() - interval '8 days'), ($1, 9000002, clock_timestamp() - interval '1 day')`, [bot.id]);
  assert.ok((await workers.purgeUpdates()) >= 1);
  const left = (await pool.query(`SELECT update_id::text AS id FROM telegram_updates WHERE bot_id = $1 AND update_id IN (9000001, 9000002) ORDER BY update_id`, [bot.id])).rows.map((r) => r.id);
  assert.deepEqual(left, ['9000002']);
});
