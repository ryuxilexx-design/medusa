// Telegram bot answers questions about the clinic: the real engine through the simulator transport and a fake
// Claude Messages API (no real model, no real Telegram). Checks numbers against the clinic's data, the medical
// deflection, that nothing about the person reaches the model, language, limits, the manager's switch, metering
// without text, and tenant isolation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool, config, faqMod;

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

// ---------- fake Claude: answers from the KNOWLEDGE it was given (or a scripted reply) ----------
const claude = { calls: [], next: null, server: null, url: '' };
const msg = (obj) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
const systemText = (body) => (Array.isArray(body.system) ? body.system.map((b) => b.text).join('\n') : String(body.system));
const knowledgeOf = (body) => JSON.parse(systemText(body).split('KNOWLEDGE:\n')[1]);
const ok = (answer, suggest = 'none', facts = []) => ({ answer, answerable: true, medical: false, suggest, facts_used: facts });
function answerFor(body) {
  const k = knowledgeOf(body);
  const q = body.messages[0].content;
  if (/narx|цен/i.test(q)) { const s = k.services.find((x) => x.price); return ok(`«${s.name}» narxi — ${s.price}.`, 'book', ['services']); }
  if (/manzil|адрес/i.test(q)) { const b = k.branches[0]; return ok(`${b.name}: ${b.address}. Telefon: ${b.phone}`, 'contacts', ['branches']); }
  if (/soat|час/i.test(q)) { const h = k.hours.find((x) => x.open); return ok(`${h.branch} ${h.date} kuni ${h.open} dan ${h.close} gacha ishlaydi.`, 'book', ['hours']); }
  return { answer: '', answerable: false, medical: false, suggest: 'none', facts_used: [] };
}
function startClaude() {
  return new Promise((resolve) => {
    claude.server = http.createServer(async (req, res) => {
      let raw = ''; for await (const ch of req) raw += ch;
      const body = raw ? JSON.parse(raw) : {};
      claude.calls.push({ url: req.url, body });
      const next = claude.next; claude.next = null;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(msg(next ?? answerFor(body))));
    }).listen(0, '127.0.0.1', () => { claude.url = `http://127.0.0.1:${claude.server.address().port}`; resolve(); });
  });
}

// ---------- simulator helpers ----------
let manager, manager2;
const out = async (s, chat, after = 0) => (await s.get(`/telegram/sim/messages?chat_id=${chat}&after=${after}`)).body.data.filter((m) => m.direction === 'out');
const lastId = async (s, chat) => { const all = (await s.get(`/telegram/sim/messages?chat_id=${chat}`)).body.data; return all.length ? all.at(-1).id : 0; };
const say = (s, chat, text) => s.post('/telegram/sim/send', { chat_id: chat, text });
let phoneSeq = 0;
async function linked(s = manager, phone) {
  const chat = (await s.post('/telegram/sim/chats')).body.data.chat_id;
  await say(s, chat, '/start');
  await s.post('/telegram/sim/send', { chat_id: chat, contact_phone: phone ?? `+99893${String(7000000 + ++phoneSeq).padStart(7, '0')}` });
  return chat;
}
/** Asks a question and returns the bot's replies to it. */
async function ask(chat, text, s = manager) {
  const from = await lastId(s, chat);
  const r = await say(s, chat, text);
  assert.equal(r.status, 200, r.text);
  return out(s, chat, from);
}
const stats = async (tenant = SEED_IDS.tenant) => (await pool.query(
  `SELECT coalesce(sum(ai_answered),0)::int AS ai, coalesce(sum(keyword_answered),0)::int AS kw, coalesce(sum(fallbacks),0)::int AS fb,
          coalesce(sum(medical),0)::int AS med, coalesce(sum(limited),0)::int AS lim FROM telegram_faq_stats WHERE tenant_id = $1`, [tenant])).rows[0];
const som = (tiyin) => `${(Number(tiyin) / 100).toLocaleString('ru-RU').replace(/[\s  ]/g, ' ')} so‘m`;
const norm = (s) => s.replace(/[  ]/g, ' ');

before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  config = require('../dist/core/config.js').config;
  faqMod = require('../dist/telegram/faq.js');
  await startClaude();
  config.ai.mode = 'live'; config.ai.provider = 'anthropic'; config.ai.apiKey = 'test-key'; config.ai.baseUrl = claude.url; config.ai.model = 'claude-opus-5-5';
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  await db.assertDatabaseName(pool, '_test');
  await pool.query(`DELETE FROM telegram_chats`);
  await pool.query(`DELETE FROM telegram_sim_messages`);
  await pool.query(`DELETE FROM telegram_faq_settings`);
  await pool.query(`DELETE FROM telegram_faq_stats`);
  manager2 = session(); await manager2.demo(M.tenant2Manager);
});
after(async () => { await app?.close(); claude.server?.close(); });

test('narx savoli: AI javobidagi narx bazadagi narxga teng; «avtomatik javob» belgisi, «Registrator» tugmasi; ai_usage’da matn yo‘q', async () => {
  const chat = await linked();
  const n = claude.calls.length;
  const replies = await ask(chat, 'Konsultatsiya narxi qancha?');
  assert.equal(claude.calls.length, n + 1, 'bitta model chaqiruvi');
  const k = knowledgeOf(claude.calls.at(-1).body);
  const svc = k.services.find((x) => x.price);
  const db = (await pool.query(
    `SELECT (SELECT sp.amount FROM service_prices sp WHERE sp.service_id = s.id AND sp.branch_id IS NULL AND sp.valid_from <= demo_now() ORDER BY sp.valid_from DESC LIMIT 1) AS amount
       FROM services s WHERE s.tenant_id = $1 AND s.name = $2 AND s.active`, [SEED_IDS.tenant, svc.name])).rows[0];
  const text = norm(replies.map((m) => m.text).join('\n'));
  assert.ok(text.includes(som(db.amount)), `${text} ↔ ${som(db.amount)}`);
  assert.match(text, /Avtomatik javob/);
  const kb = replies.at(-1).markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(kb, ['faq:book', 'faq:reg']);
  const u = (await pool.query(`SELECT * FROM ai_usage WHERE route = 'bot_faq' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(u.outcome, 'ok'); assert.equal(u.tenant_id, SEED_IDS.tenant); assert.equal(u.membership_id, null);
  assert.ok(!JSON.stringify(u).includes('Konsultatsiya'), 'ai_usage’da savol matni yo‘q');
  const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name IN ('ai_usage','telegram_faq_stats')`)).rows.map((r) => r.column_name);
  assert.ok(!cols.some((c) => /text|question|prompt|^answer$|message/.test(c)), cols.join(','));
  assert.equal((await stats()).ai, 1);
});

test('manzil va ish vaqti: javobdagi telefon, manzil va soatlar klinika ma’lumotidan', async () => {
  const chat = await linked();
  const addr = norm((await ask(chat, 'Manzilingiz qayerda?')).map((m) => m.text).join('\n'));
  const b = (await pool.query(`SELECT name, address, phone FROM branches WHERE tenant_id = $1 AND active ORDER BY code LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  assert.ok(addr.includes(b.address), addr);
  assert.ok(addr.replace(/\D/g, '').includes(b.phone.replace(/\D/g, '')), 'filial telefoni');
  const hours = norm((await ask(chat, 'Ertaga soat nechada ochiqsiz?')).map((m) => m.text).join('\n'));
  const sch = (await pool.query(
    `SELECT to_char(min(s.start_time),'HH24:MI') AS open, to_char(max(s.end_time),'HH24:MI') AS close FROM schedules s JOIN doctors d ON d.id = s.doctor_id
      WHERE s.tenant_id = $1 AND d.active GROUP BY s.branch_id, s.weekday`, [SEED_IDS.tenant])).rows;
  assert.ok(sch.some((r) => hours.includes(r.open) && hours.includes(r.close)), hours);
  assert.match(hours, /Avtomatik javob/);
});

test('to‘qib chiqarilgan narx: javob yuborilmaydi — «registratordan so‘rang: <telefon>»', async () => {
  const chat = await linked();
  const before = await stats();
  claude.next = { answer: 'Konsultatsiya narxi 999 999 so‘m, soat 23:45 gacha.', answerable: true, medical: false, suggest: 'none', facts_used: ['services'] };
  const text = norm((await ask(chat, 'Konsultatsiya qancha turadi?')).map((m) => m.text).join('\n'));
  assert.ok(!text.includes('999'), text);
  assert.match(text, /registratordan so‘rang: \+998 71 200 00 01/);
  assert.equal((await stats()).fb, before.fb + 1);
  // a wrong phone number is caught too
  claude.next = { answer: 'Qo‘ng‘iroq qiling: +998 90 111 22 33', answerable: true, medical: false, suggest: 'contacts', facts_used: [] };
  assert.match((await ask(chat, 'Telefoningiz?')).map((m) => m.text).join('\n'), /registratordan so‘rang/);
  // unit: grouped prices, «ming», times and phones from the knowledge pass; others do not
  const kt = JSON.stringify({ p: '150 000 so‘m', h: '08:00', tel: '+998 71 200 00 01', d: '2026-10-19' });
  assert.deepEqual(faqMod.unverifiedNumbers('150 000 so‘m, 150 ming, 150.000; soat 8:00 dan; 19-oktabr; +998712000001; 2 ta filial', kt, ['+998712000001']), []);
  assert.deepEqual(faqMod.unverifiedNumbers('120 000 so‘m', kt, []), ['120000']);
  assert.deepEqual(faqMod.unverifiedNumbers('soat 09:30 da', kt, []), ['09:30']);
});

test('tibbiy savol: modelga yuborilmaydi, qat’iy matn va «Qabulga yozilish» tugmasi; model tibbiy deb belgilasa ham shunday', async () => {
  const chat = await linked();
  const n = claude.calls.length, before = await stats();
  const r = await ask(chat, 'Boshim og‘riyapti, qaysi dorini ichsam bo‘ladi?');
  assert.equal(claude.calls.length, n, 'model chaqirilmadi');
  assert.match(r[0].text, /Tibbiy savolga javob bera olmayman/);
  assert.deepEqual(r[0].markup.inline_keyboard.flat().map((b) => b.callback_data), ['faq:book', 'faq:reg']);
  claude.next = { answer: 'Paratsetamol iching', answerable: true, medical: true, suggest: 'none', facts_used: [] };
  const r2 = await ask(chat, 'Menga nima tavsiya qilasiz?');
  assert.equal(claude.calls.length, n + 1);
  assert.ok(!r2.map((m) => m.text).join().includes('Paratsetamol'));
  assert.match(r2[0].text, /Tibbiy savolga/);
  assert.equal((await stats()).med, before.med + 2);
  // the booking button starts the normal booking flow
  const from = await lastId(manager, chat);
  await manager.post('/telegram/sim/send', { chat_id: chat, callback_data: 'faq:book', label: '📅 Qabulga yozilish' });
  assert.match((await out(manager, chat, from)).map((m) => m.text).join('\n'), /Familiyani yozing|Xizmatni tanlang|Kim uchun/);
});

test('modelga bemor haqida hech narsa ketmaydi: qabullari bor bemorning chati — ism, telefon, karta raqami, qabul yo‘q; savoldagi raqam yashiriladi', async () => {
  const p = (await pool.query(
    `SELECT p.last_name, p.first_name, p.phone, p.patient_number FROM patients p
      WHERE p.tenant_id = $1 AND p.phone IS NOT NULL AND (SELECT count(*) FROM patients x WHERE x.tenant_id = $1 AND x.phone = p.phone) = 1
        AND EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.status = 'scheduled' AND a.starts_at > demo_now())
      ORDER BY p.patient_number LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  assert.ok(p, 'seed’da kelajakdagi qabuli bor bemor');
  const chat = await linked(manager, p.phone);
  const linkedMsg = (await out(manager, chat)).map((m) => m.text).join('\n');
  assert.match(linkedMsg, new RegExp(p.last_name), 'chat bemorga bog‘langan');
  await ask(chat, 'Narxlar qancha? Mening raqamim +998 90 123 45 67');
  const sent = JSON.stringify(claude.calls.at(-1).body);
  for (const x of [p.last_name, p.first_name, p.phone, p.phone.slice(4), `#${p.patient_number}`]) assert.ok(!sent.includes(x), `modelga ketmadi: ${x}`);
  assert.ok(!sent.includes('123 45 67') && sent.includes('[telefon]'), 'savoldagi telefon yashirildi');
  assert.ok(!/appointment|qabul vaqti|starts_at/.test(sent));
});

test('til: ruscha chatda model rus tilida javob berishga so‘raladi, bot matnlari ruscha', async () => {
  const chat = await linked();
  await manager.post('/telegram/sim/send', { chat_id: chat, callback_data: 'lang:ru', label: 'Русский' });
  claude.next = ok('Консультация терапевта — по прайсу клиники.', 'none');
  const r = await ask(chat, 'Сколько стоит прием?');
  assert.match(systemText(claude.calls.at(-1).body), /rus tilida/);
  assert.match(r[0].text, /Автоматический ответ/);
  assert.equal(r[0].markup.inline_keyboard.flat()[0].text, '📞 Связаться с регистратором');
  const med = await ask(chat, 'Какое лекарство принять от температуры?');
  assert.match(med[0].text, /медицинские вопросы/);
});

test('rahbar sozlamasi: AI o‘chirilsa — modelsiz kalit so‘z javobi (to‘g‘ri narxlar); qo‘shimcha matn bilimga qo‘shiladi; faqat rahbar', async () => {
  const registrar = session(); await registrar.demo(M.registrar);
  assert.equal((await registrar.get('/telegram/faq')).status, 403);
  assert.equal((await registrar.put('/telegram/faq', { ai_enabled: false, extra_text: '' })).status, 403);
  assert.equal((await manager.put('/telegram/faq', { ai_enabled: true, extra_text: 'x'.repeat(2001) })).status, 422);
  let g = await manager.get('/telegram/faq');
  assert.equal(g.status, 200); assert.equal(g.body.data.ai_enabled, true, 'demo’da standart — yoqilgan'); assert.equal(g.body.data.ai_default, true);

  const extra = 'Klinika oldida bepul avtoturargoh bor. Qon tahliliga 8 soat och holda keling.';
  assert.equal((await manager.put('/telegram/faq', { ai_enabled: true, extra_text: extra })).status, 200);
  const chat = await linked();
  await ask(chat, 'Avtoturargoh bormi?');
  assert.equal(knowledgeOf(claude.calls.at(-1).body).extra, extra);
  const audit = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'telegram.faq' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.ok(audit && !audit.summary.includes('avtoturargoh'), 'audit’da klinika matni yo‘q');

  assert.equal((await manager.put('/telegram/faq', { ai_enabled: false, extra_text: extra })).status, 200);
  const n = claude.calls.length, before = await stats();
  const text = norm((await ask(chat, 'Narxlar qancha?')).map((m) => m.text).join('\n'));
  assert.equal(claude.calls.length, n, 'model chaqirilmadi');
  const price = (await pool.query(
    `SELECT s.name, (SELECT sp.amount FROM service_prices sp WHERE sp.service_id = s.id AND sp.branch_id IS NULL AND sp.valid_from <= demo_now() ORDER BY sp.valid_from DESC LIMIT 1) AS amount
       FROM services s WHERE s.tenant_id = $1 AND s.active AND s.category = 'consultation' ORDER BY s.name LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  assert.ok(text.includes(`${price.name} — ${som(price.amount)}`), text);
  assert.doesNotMatch(text, /Avtomatik javob/);
  const addr = norm((await ask(chat, 'Manzil qayerda?')).map((m) => m.text).join('\n'));
  assert.match(addr, /Amir Temur/);
  const unknown = await ask(chat, 'Salom, qalaysiz');
  assert.match(unknown[0].text, /tushunmadim/i);
  const after = await stats();
  assert.equal(after.kw, before.kw + 2); assert.equal(after.fb, before.fb + 1);
  g = await manager.get('/telegram/faq');
  assert.equal(g.body.data.ai_enabled, false);
  assert.ok(g.body.data.today.keyword_answered >= 2 && g.body.data.last7.keyword_answered >= g.body.data.today.keyword_answered);
  assert.ok(!JSON.stringify(g.body).includes('Narxlar qancha'), 'savol matni saqlanmaydi');
  // «Registrator» button: the branches' phones, no model
  const from = await lastId(manager, chat);
  await manager.post('/telegram/sim/send', { chat_id: chat, callback_data: 'faq:reg', label: '📞' });
  assert.match(norm((await out(manager, chat, from)).map((m) => m.text).join('\n')), /\+998 71 200 00 01/);
  assert.equal((await manager.put('/telegram/faq', { ai_enabled: true, extra_text: '' })).status, 200);
});

test('AI namunaviy rejimda yoki ishlamasa ham bot kalit so‘zlar bilan javob beradi', async () => {
  const chat = await linked();
  config.ai.mode = 'sample';
  try {
    const n = claude.calls.length;
    const r = await ask(chat, 'Shifokorlaringiz kimlar?');
    assert.equal(claude.calls.length, n);
    const doc = (await pool.query(`SELECT display_name FROM doctors WHERE tenant_id = $1 AND active ORDER BY display_name LIMIT 1`, [SEED_IDS.tenant])).rows[0];
    assert.match(r[0].text, new RegExp(doc.display_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally { config.ai.mode = 'live'; }
  // the daily budget is spent: no call, keyword answer
  const saved = config.ai.dailyLimitUsd; config.ai.dailyLimitUsd = 0.000001;
  try {
    const n = claude.calls.length;
    const r = await ask(chat, 'Ish vaqtingiz qanday?');
    assert.equal(claude.calls.length, n);
    assert.match(r[0].text, /Ish vaqti/);
  } finally { config.ai.dailyLimitUsd = saved; }
});

test('cheklov: bitta chatdan soatiga 20 tadan ortiq savol — «juda ko‘p», model chaqirilmaydi', async () => {
  const chat = await linked();
  for (let i = 0; i < 20; i++) await say(manager, chat, `Narx ${i}?`);
  const n = claude.calls.length, before = await stats();
  const r = await ask(chat, 'Yana bir narx?');
  assert.equal(claude.calls.length, n);
  assert.match(r[0].text, /Savollar juda ko‘p/);
  assert.equal((await stats()).lim, before.lim + 1);
});

test('tenant izolyatsiyasi: B klinikasi boti A klinikasining bilimini ishlatmaydi', async () => {
  await manager.put('/telegram/faq', { ai_enabled: true, extra_text: 'A-KLINIKA-MAXSUS-MATN' });
  const chat = await linked(manager2);
  claude.next = ok('Javob.');
  await ask(chat, 'Qanday xizmatlar bor?', manager2);
  const body = claude.calls.at(-1).body;
  const k = knowledgeOf(body);
  const t2 = (await pool.query(`SELECT name FROM tenants WHERE id = $1`, [SEED_IDS.tenant2])).rows[0].name;
  const t1 = (await pool.query(`SELECT name FROM tenants WHERE id = $1`, [SEED_IDS.tenant])).rows[0].name;
  assert.equal(k.clinic, t2);
  const sent = JSON.stringify(body);
  assert.ok(!sent.includes(t1) && !sent.includes('A-KLINIKA-MAXSUS-MATN') && !sent.includes('Amir Temur'), 'A klinikasidan hech narsa yo‘q');
  assert.deepEqual(k.branches.map((b) => b.name), ['Test filiali']);
  const u = (await pool.query(`SELECT tenant_id FROM ai_usage WHERE route = 'bot_faq' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(u.tenant_id, SEED_IDS.tenant2);
  // B's manager sees only B's counters and settings
  const g = (await manager2.get('/telegram/faq')).body.data;
  assert.equal(g.extra_text, '');
  assert.equal(g.today.ai_answered + g.today.fallbacks, 1);
  await manager.put('/telegram/faq', { ai_enabled: true, extra_text: '' });
});
