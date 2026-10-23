// Patient-friendly visit summary («Bemor uchun xulosa», AI route patient_summary) and «fill from the note» for the
// visit documents (deterministic + AI route document_draft) — against a fake Claude server and the Telegram simulator.
// Treating doctor only; signed note only; de-identified prompt; invented drugs/doses/numbers dropped by the server;
// approval = immutable version + text-free audit; delivery only after approval: Telegram text to the patient's own
// chat, SMS a generic line; sample/off = template; production guard; autofill issues nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool, config, notifier, bots;

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

// ---------- fake Claude ----------
const claude = { calls: [], summary: null, reason: null, server: null, url: '' };
const msg = (obj) => ({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 900, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
function startClaude() {
  return new Promise((resolve) => {
    claude.server = http.createServer(async (req, res) => {
      let raw = ''; for await (const ch of req) raw += ch;
      const body = JSON.parse(raw || '{}');
      claude.calls.push(body);
      const sys = JSON.stringify(body.system);
      const answer = sys.includes('oddiy tilga') ? claude.summary : sys.includes('yo‘llanma sababi') ? claude.reason : {};
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(msg(answer)));
    }).listen(0, '127.0.0.1', () => { claude.url = `http://127.0.0.1:${claude.server.address().port}`; resolve(); });
  });
}

const PHONE_A = '+998907770011', PHONE_GUARD = '+998907770022', PHONE_B = '+998907770033';
const RECS = 'Paratsetamol 500 mg kuniga 3 marta 5 kun. Ko‘p suyuqlik ichish. 3 kun uyda dam olish. Harorat 39 dan oshsa darhol murojaat qiling.';
let doctor, other, registrar, manager, enc, encB, patient, today, followUp, chatOwn, chatGuard, bot;

before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  config = require('../dist/core/config.js').config;
  ({ Notifier: notifier, BotRegistry: bots } = require('../dist/telegram/notifier.js'));
  notifier = app.get(notifier); bots = app.get(bots);
  await startClaude();
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  await db.assertDatabaseName(pool, '_test');
  // chats survive demo resets; start from none (test database only). Notices go out 08:00–21:00: move the clock past 07:30.
  await pool.query(`DELETE FROM telegram_chats`);
  await pool.query(`UPDATE demo_clock SET demo_anchor = demo_anchor + interval '2 hours' WHERE id = 1`);
  doctor = session(); await doctor.demo(M.doctor(0));
  other = session(); await other.demo(M.doctor(1));
  registrar = session(); await registrar.demo(M.registrar);
  today = (await doctor.get('/me')).body.data.today;
  const appts = (await doctor.get(`/appointments?date=${today}`)).body.data;
  const open = appts.find((a) => a.status === 'in_progress' && a.encounter_id);
  const done = appts.find((a) => a.status === 'completed' && a.encounter_id && a.patient_id !== open?.patient_id);
  assert.ok(open && done, 'seed’da davom etayotgan va yakunlangan qabul bor');
  enc = open.encounter_id; encB = done.encounter_id;
  const e = (await doctor.get(`/encounters/${enc}`)).body.data;
  patient = e.patient;
  // patient A: an adult with an own number; the contact number belongs to someone else (must never get the text)
  await pool.query(`UPDATE patients SET phone = $2, contact_phone = $3, birth_date = '1980-05-14' WHERE id = $1`, [patient.id, PHONE_A, PHONE_GUARD]);
  await pool.query(`UPDATE patients SET phone = $2, contact_phone = NULL WHERE id = $1`, [done.patient_id, PHONE_B]);
  const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7); followUp = d.toISOString().slice(0, 10);
  bot = await bots.simulator(SEED_IDS.tenant);
  chatOwn = 700001; chatGuard = 700002;
  for (const [chat, phone] of [[chatOwn, PHONE_A], [chatGuard, PHONE_GUARD]])
    await pool.query(`INSERT INTO telegram_chats (tenant_id, bot_id, chat_id, phone, lang, linked_at) VALUES ($1,$2,$3,$4,'uz',demo_now())`, [SEED_IDS.tenant, bot.id, chat, phone]);
  config.ai.mode = 'live'; config.ai.provider = 'anthropic'; config.ai.apiKey = 'test-key'; config.ai.baseUrl = claude.url; config.ai.model = 'claude-opus-5-5';
});
after(async () => {
  await pool?.query(`UPDATE notifications SET status = 'skipped' WHERE status = 'pending' AND kind = 'patient_summary'`).catch(() => undefined);
  await pool?.query(`UPDATE sms_settings SET enabled = false WHERE tenant_id = $1`, [SEED_IDS.tenant]).catch(() => undefined);
  await pool?.query(`DELETE FROM telegram_chats WHERE chat_id IN (700001, 700002)`).catch(() => undefined);
  await app?.close(); claude.server?.close();
});

const out = async (chat) => (await pool.query(`SELECT text FROM telegram_sim_messages WHERE bot_id = $1 AND chat_id = $2 AND direction = 'out' ORDER BY id`, [bot.id, chat])).rows.map((r) => r.text);

test('tasdiqlanmagan qayd: xulosa 409 NOTE_NOT_SIGNED; boshqa shifokor va registrator 403; model chaqirilmaydi', async () => {
  const before = claude.calls.length;
  const r = await doctor.post(`/encounters/${enc}/patient-summary/draft`, { language: 'uz' });
  assert.equal(r.status, 409, r.text); assert.equal(r.body.error.code, 'NOTE_NOT_SIGNED');
  assert.equal((await other.post(`/encounters/${enc}/patient-summary/draft`, { language: 'uz' })).status, 403);
  assert.equal((await registrar.post(`/encounters/${enc}/patient-summary/draft`, { language: 'uz' })).status, 403);
  assert.equal((await manager.get(`/encounters/${enc}/patient-summaries`)).status, 403);
  assert.equal(claude.calls.length, before);
});

test('qayddan to‘ldirish (qoralama): yo‘llanma, ma’lumotnoma, dori tavsiyasi maydonlari qayddan; hech narsa berilmaydi', async () => {
  const e = (await doctor.get(`/encounters/${enc}`)).body.data;
  const draft = { version: e.note.version, complaints: `Tomoq og‘rig‘i, harorat 38.5. Bemor ${patient.last_name}, tel ${PHONE_A}.`, anamnesis: null,
    examination: 'Tomoq qizargan, o‘pkada xirillash yo‘q.', diagnosis: 'O‘tkir respirator infeksiya', recommendations: RECS, follow_up_date: followUp, vitals: {}, icd10: ['J06.9'] };
  assert.equal((await doctor.put(`/encounters/${enc}/draft`, draft)).status, 200);
  const docsBefore = (await pool.query(`SELECT count(*)::int AS n FROM medical_documents WHERE encounter_id = $1`, [enc])).rows[0].n;
  const ref = await doctor.get(`/encounters/${enc}/documents/autofill?kind=referral`);
  assert.equal(ref.status, 200, ref.text);
  assert.equal(ref.body.data.meta.note_status, 'draft');
  assert.equal(ref.body.data.body.reason, 'O‘tkir respirator infeksiya');
  assert.deepEqual(ref.body.data.body.icd10.map((x) => x.code), ['J06.9']);
  assert.equal(ref.body.data.body.notes, RECS);
  const cert = (await doctor.get(`/encounters/${enc}/documents/autofill?kind=certificate`)).body.data.body;
  assert.equal(cert.rest_days, 3); assert.equal(cert.include_diagnosis, false, 'tashxis hech qachon avtomatik qo‘yilmaydi');
  const rx = (await doctor.get(`/encounters/${enc}/documents/autofill?kind=prescription`)).body.data.body;
  assert.equal(rx.items.length, 1, JSON.stringify(rx));
  assert.equal(rx.items[0].name, 'Paratsetamol'); assert.equal(rx.items[0].dose, '500 mg');
  assert.equal(rx.items[0].frequency, 'kuniga 3 marta'); assert.equal(rx.items[0].duration, '5 kun');
  const para = (await pool.query(`SELECT id FROM drugs WHERE inn = 'Paracetamol'`)).rows[0];
  if (para) assert.equal(rx.items[0].drug_id, para.id, 'ma’lumotnomadagi dori bog‘landi');
  assert.match(rx.notes, /suyuqlik/);
  assert.equal((await doctor.get(`/encounters/${enc}/documents/autofill?kind=bogus`)).status, 422);
  assert.equal((await other.get(`/encounters/${enc}/documents/autofill?kind=referral`)).status, 403);
  assert.equal((await registrar.get(`/encounters/${enc}/documents/autofill?kind=referral`)).status, 403);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM medical_documents WHERE encounter_id = $1`, [enc])).rows[0].n, docsBefore, 'hech qanday hujjat berilmadi');
});

test('yo‘llanma sababi (document_draft): AI qayddan yozadi, ism/telefon ketmaydi, to‘qilgan dori gapi tashlanadi; namunaviy rejimda shablon', async () => {
  claude.reason = { reason: 'Bemorda 38.5 gacha harorat va tomoq og‘rig‘i. Ibuprofen 400 mg buyurildi. LOR konsultatsiyasi so‘raladi.' };
  const before = claude.calls.length;
  const r = await doctor.post(`/encounters/${enc}/documents/reason-draft`, { to_specialty: 'LOR' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.mode, 'live');
  assert.equal(r.body.data.dropped, 1);
  assert.ok(!/Ibuprofen|400/.test(r.body.data.reason), r.body.data.reason);
  assert.match(r.body.data.reason, /38\.5/);
  const sent = JSON.stringify(claude.calls[before].messages);
  assert.ok(!sent.includes(patient.last_name) && !sent.includes('77 00 11') && !sent.includes('7770011'), 'ism va telefon yuborilmadi');
  const u = (await pool.query(`SELECT * FROM ai_usage WHERE route = 'document_draft' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(u.outcome, 'ok');
  config.ai.mode = 'sample';
  try {
    const s = await doctor.post(`/encounters/${enc}/documents/reason-draft`, {});
    assert.equal(s.status, 200); assert.equal(s.body.data.mode, 'sample');
    assert.match(s.body.data.reason, /O‘tkir respirator infeksiya/);
    assert.equal(claude.calls.length, before + 1, 'namunaviy rejimda model chaqirilmaydi');
  } finally { config.ai.mode = 'live'; }
});

test('AI xulosa: imzolangan qayddan; prompt de-identifikatsiya; qaydda yo‘q dori/son gapi va MKB kodi olib tashlanadi; qayta ko‘rik sanasi server qo‘shadi', async () => {
  const e = (await doctor.get(`/encounters/${enc}`)).body.data;
  const sign = await doctor.post(`/encounters/${enc}/sign`, { version: e.note.version, complaints: e.note.complaints, anamnesis: null, examination: e.note.examination,
    diagnosis: e.note.diagnosis, recommendations: e.note.recommendations, follow_up_date: followUp, vitals: {}, icd10: ['J06.9'] });
  assert.equal(sign.status, 200, sign.text);
  claude.summary = {
    found: 'Sizda shamollash (J06.9) aniqlandi — tomoq va burun yo‘llari yallig‘langan. 7 kun ichida albatta o‘tadi.',
    steps: ['Paratsetamol 500 mg dan kuniga 3 marta, 5 kun iching.', 'Amoksitsillin 1000 mg kuniga 2 marta iching.', 'Ko‘p suyuqlik iching.', 'Antibiotik qabul qiling.'],
    red_flags: ['Harorat 39 dan oshsa, darhol shifokorga murojaat qiling.'],
  };
  const before = claude.calls.length;
  const r = await doctor.post(`/encounters/${enc}/patient-summary/draft`, { language: 'uz' });
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.equal(d.mode, 'live');
  assert.equal(d.dropped, 3, d.text);
  assert.match(d.text, /Sizda nima aniqlandi/); assert.match(d.text, /Nima qilish kerak/);
  assert.match(d.text, /Paratsetamol 500 mg/);
  assert.ok(!/Amoksitsillin|1000|Antibiotik|7 kun|J06/.test(d.text), d.text);
  assert.match(d.text, /Qachon qayta kelish kerak\n.*2026 kuni qayta ko‘rikka keling/);
  assert.match(d.text, /Qachon darhol shifokorga murojaat qiling\n• Harorat 39/);
  const call = claude.calls[before];
  const sent = JSON.stringify(call.messages);
  assert.ok(!sent.includes(patient.last_name) && !sent.includes('7770011') && !sent.includes('77 00 11'), 'ism va telefon yuborilmadi');
  assert.ok(sent.includes('[bemor]') && sent.includes('[telefon]'), sent);
  assert.match(JSON.stringify(call.system), /lotin yozuvida/);
  // nothing stored or queued by a draft
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patient_summaries WHERE encounter_id = $1`, [enc])).rows[0].n, 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'patient_summary'`)).rows[0].n, 0);
  // ai_usage: tokens and cost only, never the text
  const u = (await pool.query(`SELECT * FROM ai_usage WHERE route = 'patient_summary' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(u.outcome, 'ok'); assert.equal(u.input_tokens, 900);
  assert.ok(!JSON.stringify(u).includes('Paratsetamol') && !JSON.stringify(u).includes('suyuqlik'));
  const a = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'ai.patient_summary' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.ok(!/Paratsetamol|infeksiya|suyuqlik/.test(a.summary), a.summary);
  // ru: the instruction asks for Russian; a red flag the note has no warning for would be dropped (unit check below)
  const ru = await doctor.post(`/encounters/${enc}/patient-summary/draft`, { language: 'ru' });
  assert.equal(ru.status, 200); assert.match(JSON.stringify(claude.calls.at(-1).system), /rus tilida/);
  assert.match(ru.body.data.text, /Что у вас обнаружено/);
});

test('tekshiruv qoidalari: yozuv shakli farqi (Парацетамол ~ Paratsetamol) o‘tadi, qaydda yo‘q dori/son/shakl o‘tmaydi', () => {
  const { sourceOf, sentenceProblem, templateParts, noteHasRedFlags, skeleton } = require('../dist/ai/patient-summary.js');
  const stems = ['Paracetamol', 'Ibuprofen'].map((inn) => ({ stem: skeleton(inn).slice(0, 8), id: inn, inn }));
  const src = sourceOf(['Paratsetamol 500 mg kuniga 3 marta. Ko‘p suyuqlik.']);
  assert.equal(sentenceProblem('Принимайте Парацетамол по 500 мг 3 раза в день.', src, stems), null);
  assert.equal(sentenceProblem('Парацетамолни 500 мг дан ичинг.', src, stems), null);
  assert.equal(sentenceProblem('Ibuprofen iching.', src, stems), 'drug');
  assert.equal(sentenceProblem('Paratsetamol 1000 mg iching.', src, stems), 'number');
  assert.equal(sentenceProblem('Tabletkalarni ovqatdan keyin iching.', src, stems), 'drug');
  assert.equal(sentenceProblem('Omeprazol iching.', src, stems), 'drug', 'ro‘yxatda yo‘q, lekin dori nomiga o‘xshash');
  assert.equal(sentenceProblem('Shamollash tez o‘tadi, ko‘p suyuqlik iching.', src, stems), null);
  const n = { complaints: 'x', examination: 'y', diagnosis: 'Gipertenziya (I10)', recommendations: 'Tuzni kamaytirish. Kuzatuv.', follow_up_date: null, icd10: [] };
  assert.equal(noteHasRedFlags(n), false);
  const t = templateParts(n, 'uz-Cyrl');
  assert.equal(t.found, 'Гипертензия'); assert.deepEqual(t.red_flags, []);
});

test('namunaviy / o‘chiq rejim: modelsiz shablon (tavsiyalar + qayta ko‘rik sanasi), «Namunaviy» belgisi; production: AI_CLINICAL_ALLOWED siz model chaqirilmaydi', async () => {
  const before = claude.calls.length;
  config.ai.mode = 'sample';
  try {
    const s = await doctor.post(`/encounters/${enc}/patient-summary/draft`, { language: 'uz' });
    assert.equal(s.status, 200); assert.equal(s.body.data.mode, 'sample'); assert.equal(s.body.data.reason, null);
    assert.match(s.body.data.text, /Sizda nima aniqlandi\nO‘tkir respirator infeksiya/);
    assert.match(s.body.data.text, /1\. Paratsetamol 500 mg kuniga 3 marta 5 kun\./);
    assert.match(s.body.data.text, /kuni qayta ko‘rikka keling/);
    assert.match(s.body.data.text, /• Harorat 39 dan oshsa darhol murojaat qiling\./, 'ogohlantirish gapi alohida bo‘limda');
    const a = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'ai.patient_summary' ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.match(a.summary, /Namunaviy/);
    config.ai.mode = 'off';
    const o = await doctor.post(`/encounters/${enc}/patient-summary/draft`, { language: 'ru' });
    assert.equal(o.status, 200); assert.equal(o.body.data.mode, 'off'); assert.ok(o.body.data.reason);
    assert.match(o.body.data.text, /Что нужно делать/);
  } finally { config.ai.mode = 'live'; }
  const savedMode = config.mode, savedAllowed = config.ai.clinicalInProduction;
  config.mode = 'production'; config.ai.clinicalInProduction = false;
  try {
    const p = await doctor.post(`/encounters/${enc}/patient-summary/draft`, { language: 'uz' });
    assert.equal(p.status, 200); assert.equal(p.body.data.mode, 'off');
    assert.match(p.body.data.reason, /yoqilmagan/, p.body.data.reason);
    const rd = await doctor.post(`/encounters/${enc}/documents/reason-draft`, {});
    assert.equal(rd.status, 200); assert.equal(rd.body.data.mode, 'off');
    assert.equal(claude.calls.length, before, 'production himoyasi: model chaqirilmadi');
    config.ai.clinicalInProduction = true;
    const ok = await doctor.post(`/encounters/${enc}/patient-summary/draft`, { language: 'uz' });
    assert.equal(ok.body.data.mode, 'live'); assert.equal(claude.calls.length, before + 1);
  } finally { config.mode = savedMode; config.ai.clinicalInProduction = savedAllowed; }
});

test('tasdiqlash: versiya, kim/qachon, audit’da matn yo‘q, o‘zgartirib bo‘lmaydi; yuborish faqat aniq tasdiq bilan', async () => {
  const text = 'Sizda nima aniqlandi\nShamollash.\n\nNima qilish kerak\n1. Paratsetamol 500 mg kuniga 3 marta, 5 kun.\n2. Ko‘p suyuqlik iching.';
  assert.equal((await other.post(`/encounters/${enc}/patient-summaries`, { language: 'uz', text, draft_source: 'live' })).status, 403);
  assert.equal((await registrar.post(`/encounters/${enc}/patient-summaries`, { language: 'uz', text, draft_source: 'live' })).status, 403);
  const noConfirm = await doctor.post(`/encounters/${enc}/patient-summaries`, { language: 'uz', text, draft_source: 'live', send: true });
  assert.equal(noConfirm.status, 422, noConfirm.text);
  const v1 = await doctor.post(`/encounters/${enc}/patient-summaries`, { language: 'uz', text, draft_source: 'live' });
  assert.equal(v1.status, 201, v1.text);
  assert.equal(v1.body.data.version, 1); assert.equal(v1.body.data.channel, null);
  assert.ok(v1.body.data.approved_by_name && v1.body.data.approved_at);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE summary_id = $1`, [v1.body.data.id])).rows[0].n, 0, 'yuborish so‘ralmagan — navbatga qo‘yilmadi');
  await notifier.deliverDue();
  assert.equal((await out(chatOwn)).length, 0, 'tasdiqlangan, lekin yuborilmagan xulosa chatga bormaydi');
  const log = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'patient_summary.approve' AND resource_id = $1`, [enc])).rows;
  assert.equal(log.length, 1); assert.match(log[0].summary, /v1/);
  assert.ok(!/Paratsetamol|Shamollash|suyuqlik/.test(log[0].summary), 'audit’da matn yo‘q');
  await assert.rejects(pool.query(`UPDATE patient_summaries SET text = 'x' WHERE id = $1`, [v1.body.data.id]), /immutable/);
  await assert.rejects(pool.query(`DELETE FROM patient_summaries WHERE id = $1`, [v1.body.data.id]), /immutable/);
  // print: the treating doctor only
  const p = await doctor.get(`/patient-summaries/${v1.body.data.id}`);
  assert.equal(p.status, 200); assert.equal(p.body.data.text, text); assert.equal(p.body.data.patient.id, patient.id);
  assert.equal((await other.get(`/patient-summaries/${v1.body.data.id}`)).status, 403);
  assert.equal((await manager.get(`/patient-summaries/${v1.body.data.id}`)).status, 403);
});

test('Telegram: faqat tasdiqlangandan keyin va faqat bemorning o‘z chatiga (kattaning kontakt raqamiga emas)', async () => {
  const list = (await doctor.get(`/encounters/${enc}/patient-summaries`)).body;
  assert.equal(list.meta.channel, 'telegram'); assert.equal(list.meta.default_language, 'uz');
  const text = 'Sizda nima aniqlandi\nShamollash.\n\nNima qilish kerak\n1. Ko‘p suyuqlik iching.\n2. Dam oling.';
  const v2 = await doctor.post(`/encounters/${enc}/patient-summaries`, { language: 'uz', text, draft_source: 'template', send: true, confirm_send: true });
  assert.equal(v2.status, 201, v2.text);
  assert.equal(v2.body.data.version, 2); assert.equal(v2.body.data.channel, 'telegram');
  await notifier.deliverDue();
  const own = await out(chatOwn);
  assert.equal(own.length, 1, JSON.stringify(own));
  assert.match(own[0], /Ko‘p suyuqlik iching/); assert.match(own[0], /tasdiqlagan xulosangiz/);
  assert.equal((await out(chatGuard)).length, 0, 'kattaning kontakt raqami (vasiy emas) matnni olmaydi');
  const after = (await doctor.get(`/encounters/${enc}/patient-summaries`)).body.data;
  assert.equal(after[0].version, 2); assert.equal(after[0].delivery_status, 'sent'); assert.equal(after[1].delivery_status, null);
  const log = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'patient_summary.approve' AND resource_id = $1 ORDER BY id DESC LIMIT 1`, [enc])).rows[0];
  assert.match(log.summary, /Telegram/); assert.ok(!/suyuqlik/.test(log.summary));
});

test('SMS: faqat «Xulosangiz tayyor, klinikadan oling» — matn yo‘q; bemorga yetib bo‘lmasa 409 va hech narsa saqlanmaydi', async () => {
  const text = 'Sizda nima aniqlandi\nBosh og‘rig‘i.\n\nNima qilish kerak\n1. Dam oling.';
  // another suite may have left the clinic's SMS channel on in the test database
  await pool.query(`UPDATE sms_settings SET enabled = false WHERE tenant_id = $1`, [SEED_IDS.tenant]);
  const no = await doctor.post(`/encounters/${encB}/patient-summaries`, { language: 'uz', text, draft_source: 'template', send: true, confirm_send: true });
  assert.equal(no.status, 409, no.text); assert.equal(no.body.error.code, 'NO_CHANNEL');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patient_summaries WHERE encounter_id = $1`, [encB])).rows[0].n, 0);
  await pool.query(`INSERT INTO sms_settings (tenant_id, eskiz_email, password_enc, enabled) VALUES ($1, 'test@example.uz', 'v1.test', true)
                    ON CONFLICT (tenant_id) DO UPDATE SET enabled = true, eskiz_email = EXCLUDED.eskiz_email, password_enc = EXCLUDED.password_enc`, [SEED_IDS.tenant]);
  try {
    const r = await doctor.post(`/encounters/${encB}/patient-summaries`, { language: 'uz', text, draft_source: 'template', send: true, confirm_send: true });
    assert.equal(r.status, 201, r.text); assert.equal(r.body.data.channel, 'sms');
    const n = (await pool.query(`SELECT * FROM notifications WHERE summary_id = $1`, [r.body.data.id])).rows[0];
    assert.equal(n.channel, 'sms');
    const sms = await notifier.smsMessage(pool, n);
    assert.equal(sms, 'Xulosangiz tayyor, klinikadan oling.');
    assert.ok(!sms.includes('Bosh') && !sms.includes('Dam'));
    const { smsText } = require('../dist/sms/texts.js');
    assert.ok(!smsText('patient_summary', 'ru', {}).includes('Бош'));
  } finally {
    // never let the worker try the real gateway
    await pool.query(`UPDATE notifications SET status = 'skipped' WHERE status = 'pending' AND channel = 'sms'`);
    await pool.query(`UPDATE sms_settings SET enabled = false WHERE tenant_id = $1`, [SEED_IDS.tenant]);
  }
});
