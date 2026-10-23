// Doctor dictation (POST /dictation, ai/stt.ts) against a fake OpenAI-compatible speech server and the fake Claude
// API (no real model, no real audio service): roles, treating doctor, size/type errors, provider off, the production
// guard for the cloud provider, ai_usage without text, the per-doctor rate limit, structure=1 → a note draft.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool, config;

function session() {
  let cookie = '';
  const save = (r) => { const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; };
  const out = async (r) => { save(r); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j, text: t }; };
  const req = async (method, path, body) => out(await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }));
  /** multipart POST /dictation; `audio` = { bytes, type } or null */
  const dictate = async (fields, audio = { bytes: WEBM, type: 'audio/webm;codecs=opus' }) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
    if (audio) f.append('audio', new Blob([audio.bytes], { type: audio.type }), 'rec.webm');
    return out(await fetch(base + '/dictation', { method: 'POST', headers: { cookie }, body: f }));
  };
  return { get: (p) => req('GET', p), post: (p, b = {}) => req('POST', p, b), put: (p, b) => req('PUT', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }), dictate };
}

// a webm (EBML) header followed by filler: enough for the type check, never decoded by the fake
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 7)]);
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(500)]);

// ---------- fake OpenAI-compatible speech-to-text server ----------
const stt = { server: null, url: '', calls: [], next: null, text: 'Bemor 3 kundan beri bosh og\'rig\'idan shikoyat qiladi.' };
function startStt() {
  return new Promise((resolve) => {
    stt.server = http.createServer(async (req, res) => {
      const chunks = []; for await (const c of req) chunks.push(c);
      const form = await new Request('http://x' + req.url, { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) }).formData();
      const file = form.get('file');
      stt.calls.push({ url: req.url, auth: req.headers.authorization ?? null, model: form.get('model'), language: form.get('language'),
        response_format: form.get('response_format'), prompt: form.get('prompt'), fileName: file?.name, fileType: file?.type, size: file?.size });
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const next = stt.next; stt.next = null;
      if (next === 'error') return send(500, { detail: 'model crashed' });
      if (next === 'silence') return send(200, { text: ' Продолжение следует... ', duration: 4, language: 'ru' });
      if (next?.text) return send(200, { text: next.text, duration: 21.5, language: form.get('language') });
      if (form.get('response_format') === 'json') return send(200, { text: stt.text });
      send(200, { task: 'transcribe', language: form.get('language'), duration: 12.34, text: stt.text, segments: [{ start: 0, end: 12.3, text: stt.text }] });
    }).listen(0, '127.0.0.1', () => { stt.url = `http://127.0.0.1:${stt.server.address().port}`; resolve(); });
  });
}

// ---------- fake Claude (only the note draft is needed) ----------
const claude = { server: null, url: '', calls: [] };
function startClaude() {
  return new Promise((resolve) => {
    claude.server = http.createServer(async (req, res) => {
      let raw = ''; for await (const ch of req) raw += ch;
      claude.calls.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify({ complaints: 'Bosh og‘rig‘i 3 kundan beri.', anamnesis: 'Kiritilmagan', examination: 'Kiritilmagan', diagnosis: 'Kiritilmagan', recommendations: 'Kiritilmagan' }) }],
        usage: { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
    }).listen(0, '127.0.0.1', () => { claude.url = `http://127.0.0.1:${claude.server.address().port}`; resolve(); });
  });
}

const useLocal = () => Object.assign(config.stt, { provider: 'local', baseUrl: stt.url, model: 'Systran/faster-whisper-large-v3', modelUz: 'uz-finetune-ct2', modelRu: '', apiKey: '' });
const useOpenai = () => Object.assign(config.stt, { provider: 'openai', baseUrl: stt.url, model: 'whisper-1', modelUz: '', modelRu: '', apiKey: 'sk-test' });
const lastUsage = async () => (await pool.query(`SELECT * FROM ai_usage WHERE route = 'dictation' ORDER BY id DESC LIMIT 1`)).rows[0];

let manager, registrar, cashier, doctor, other, encounter, otherEncounter, sttDefaults;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  config = require('../dist/core/config.js').config;
  sttDefaults = { ...config.stt };
  await Promise.all([startStt(), startClaude()]);
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  registrar = session(); await registrar.demo(M.registrar);
  cashier = session(); await cashier.demo(M.cashier);
  doctor = session(); await doctor.demo(M.doctor(0));
  other = session(); await other.demo(M.doctor(1));
  await pool.query(`DELETE FROM ai_usage WHERE route = 'dictation'`);
  const today = (await doctor.get('/me')).body.data.today;
  const appt = (await doctor.get(`/appointments?date=${today}`)).body.data.find((a) => a.status === 'in_progress' && a.encounter_id);
  assert.ok(appt, 'seed’da shifokor 0 ning davom etayotgan qabuli bor');
  encounter = (await doctor.get(`/encounters/${appt.encounter_id}`)).body.data;
  otherEncounter = (await pool.query(`SELECT id FROM encounters WHERE tenant_id = $1 AND doctor_id <> (SELECT doctor_id FROM encounters WHERE id = $2) LIMIT 1`, [SEED_IDS.tenant, encounter.encounter.id])).rows[0]?.id;
  assert.ok(otherEncounter, 'boshqa shifokorning qabul yozuvi bor');
});
after(async () => {
  if (config) { Object.assign(config.stt, sttDefaults); config.mode = 'demo'; config.ai.clinicalInProduction = false; config.ai.mode = 'sample'; }
  await pool?.query(`DELETE FROM ai_usage WHERE route = 'dictation'`).catch(() => undefined);
  await app?.close(); stt.server?.close(); claude.server?.close();
});

test('sukut bo‘yicha o‘chiq: /me sababini aytadi, POST /dictation 503 STT_OFF (uz/ru)', async () => {
  Object.assign(config.stt, { provider: 'off' });
  const me = (await doctor.get('/me')).body.data;
  assert.equal(me.dictation_mode, 'off');
  assert.equal(me.dictation_off_reason, 'serverda ulanmagan');
  const r = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id });
  assert.equal(r.status, 503, r.text); assert.equal(r.body.error.code, 'STT_OFF');
  assert.match(r.body.error.message, /o‘chirilgan/);
  // local without an address counts as off too, with its own reason
  Object.assign(config.stt, { provider: 'local', baseUrl: '' });
  assert.equal((await doctor.get('/me')).body.data.dictation_off_reason, 'nutq serveri manzili sozlanmagan');
  assert.equal((await doctor.put('/me/preferences', { locale: 'ru' })).status, 200);
  try {
    const ru = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id });
    assert.equal(ru.status, 503); assert.match(ru.body.error.message, /Голосовой ввод сейчас выключен/);
  } finally { await doctor.put('/me/preferences', { locale: 'uz' }); }
});

test('shifokor: mahalliy server matn qaytaradi (o‘zbekcha apostroflar, sekundlar); serverga model/til/format to‘g‘ri; ai_usage va auditda matn yo‘q', async () => {
  useLocal();
  assert.equal((await doctor.get('/me')).body.data.dictation_mode, 'local');
  const before = stt.calls.length;
  const r = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id, seconds: '12' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.text, 'Bemor 3 kundan beri bosh og‘rig‘idan shikoyat qiladi.');
  assert.equal(r.body.data.seconds, 12.3);
  assert.equal(r.body.data.language, 'uz'); assert.equal(r.body.data.draft, null);
  const call = stt.calls[before];
  assert.equal(call.url, '/v1/audio/transcriptions');
  assert.equal(call.model, 'uz-finetune-ct2', 'o‘zbekcha uchun alohida model (STT_MODEL_UZ)');
  assert.equal(call.language, 'uz'); assert.equal(call.response_format, 'verbose_json');
  assert.equal(call.auth, null, 'mahalliy serverga kalit yuborilmaydi');
  assert.equal(call.size, WEBM.length); assert.equal(call.fileType, 'audio/webm'); assert.equal(call.fileName, 'dictation.webm');
  assert.match(call.prompt, /og‘rig‘i/);
  const u = await lastUsage();
  assert.equal(u.outcome, 'ok'); assert.equal(Number(u.audio_seconds), 12.3); assert.equal(u.model, 'local:uz-finetune-ct2');
  assert.equal(Number(u.cost_usd), 0); assert.equal(u.membership_id, M.doctor(0)); assert.equal(u.tenant_id, SEED_IDS.tenant);
  assert.ok(!JSON.stringify(u).includes('shikoyat'), 'ai_usage’da matn yo‘q');
  const a = (await pool.query(`SELECT summary, resource_id FROM audit_logs WHERE action = 'ai.dictation' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(a.resource_id, encounter.encounter.id); assert.ok(!a.summary.includes('shikoyat'), 'auditda matn yo‘q');
  // Russian: the language field (or a Russian interface) picks ru and the default model
  const ru = await doctor.dictate({ field: 'anamnesis', encounter_id: encounter.encounter.id, language: 'ru' }, { bytes: WAV, type: 'audio/wav' });
  assert.equal(ru.status, 200, ru.text);
  assert.equal(stt.calls.at(-1).language, 'ru'); assert.equal(stt.calls.at(-1).model, 'Systran/faster-whisper-large-v3'); assert.equal(stt.calls.at(-1).fileName, 'dictation.wav');
});

test('rollar: rahbar, registrator, kassir — 403; boshqa shifokorning qabuli — 403; mavjud bo‘lmagan qabul — 404; xato maydon — 422', async () => {
  useLocal();
  const n = stt.calls.length;
  for (const s of [manager, registrar, cashier]) {
    const r = await s.dictate({ field: 'complaints', encounter_id: encounter.encounter.id });
    assert.equal(r.status, 403, r.text);
  }
  const o = await doctor.dictate({ field: 'complaints', encounter_id: otherEncounter });
  assert.equal(o.status, 403, o.text);
  const o2 = await other.dictate({ field: 'complaints', encounter_id: encounter.encounter.id });
  assert.equal(o2.status, 403, 'davolovchi bo‘lmagan shifokor');
  const nf = await doctor.dictate({ field: 'complaints', encounter_id: '00000000-0000-4000-8000-000000000000' });
  assert.equal(nf.status, 404, nf.text);
  const bad = await doctor.dictate({ field: 'signature', encounter_id: encounter.encounter.id });
  assert.equal(bad.status, 422); assert.ok(bad.body.error.fields.field);
  assert.equal(stt.calls.length, n, 'rad etilgan so‘rovlarning ovozi serverga ketmadi');
});

test('fayl: 20 MB dan katta — 413; noto‘g‘ri tur yoki soxta webm — 415; fayl yo‘q — 422', async () => {
  useLocal();
  const n = stt.calls.length;
  const big = Buffer.concat([WEBM, Buffer.alloc(20 * 1024 * 1024)]);
  const r = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id }, { bytes: big, type: 'audio/webm' });
  assert.equal(r.status, 413, r.text); assert.equal(r.body.error.code, 'AUDIO_TOO_LARGE'); assert.match(r.body.error.message, /20 MB/);
  const txt = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id }, { bytes: Buffer.from('hello world, not audio at all'), type: 'text/plain' });
  assert.equal(txt.status, 415); assert.equal(txt.body.error.code, 'AUDIO_TYPE');
  const fake = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id }, { bytes: Buffer.alloc(3000, 1), type: 'audio/webm' });
  assert.equal(fake.status, 415, 'e’lon qilingan tur baytlarga mos emas');
  const none = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id }, null);
  assert.equal(none.status, 422); assert.ok(none.body.error.fields.audio);
  assert.equal(stt.calls.length, n);
});

test('nutq serveri: xato — 502, sukunatdagi «Продолжение следует» — 422 STT_EMPTY; ikkalasi ham ai_usage’da', async () => {
  useLocal();
  stt.next = 'error';
  const e = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id });
  assert.equal(e.status, 502); assert.equal(e.body.error.code, 'STT_ERROR');
  assert.equal((await lastUsage()).outcome, 'error');
  stt.next = 'silence';
  const s = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id, language: 'ru' });
  assert.equal(s.status, 422, s.text); assert.equal(s.body.error.code, 'STT_EMPTY');
  assert.equal((await lastUsage()).error_code, 'empty');
  Object.assign(config.stt, { baseUrl: 'http://127.0.0.1:9' });
  const down = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id });
  assert.equal(down.status, 502); assert.equal(down.body.error.code, 'STT_UNREACHABLE');
});

test('production: bulutli (openai) AI_CLINICAL_ALLOWED=1 siz rad etiladi, mahalliy ishlaydi; ruxsat bilan bulut ishlaydi (kalit, narx)', async () => {
  config.mode = 'production'; config.ai.clinicalInProduction = false;
  try {
    useOpenai();
    const me = (await doctor.get('/me')).body.data;
    assert.equal(me.dictation_mode, 'off'); assert.match(me.dictation_off_reason, /bulutli/);
    const n = stt.calls.length;
    const r = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id });
    assert.equal(r.status, 503, r.text); assert.equal(r.body.error.code, 'STT_DISABLED_PRODUCTION');
    assert.equal(stt.calls.length, n, 'ovoz bulutga ketmadi');
    useLocal();
    assert.equal((await doctor.get('/me')).body.data.dictation_mode, 'local');
    assert.equal((await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id })).status, 200, 'mahalliy server productionda ishlaydi');
    config.ai.clinicalInProduction = true; useOpenai();
    assert.equal((await doctor.get('/me')).body.data.dictation_mode, 'cloud');
    const ok = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(stt.calls.at(-1).auth, 'Bearer sk-test'); assert.equal(stt.calls.at(-1).model, 'whisper-1');
    const u = await lastUsage();
    assert.equal(u.model, 'openai:whisper-1'); assert.ok(Math.abs(Number(u.cost_usd) - (12.34 / 60) * 0.006) < 1e-6, String(u.cost_usd));
  } finally { config.mode = 'demo'; config.ai.clinicalInProduction = false; useLocal(); }
});

test('structure=1: butun qayd — matn AI qayd loyihasiga o‘tadi (bemor ismi yashirilgan), saqlanmaydi; namunaviy rejimda matn qaytadi, loyiha xatosi bilan', async () => {
  useLocal();
  const p = encounter.patient;
  const noteBefore = (await pool.query(`SELECT version FROM clinical_notes WHERE encounter_id = $1`, [encounter.encounter.id])).rows[0].version;
  // sample AI mode: the transcript is not the demo text → draft_error, text kept
  config.ai.mode = 'sample';
  const s = await doctor.dictate({ field: 'all', structure: '1', encounter_id: encounter.encounter.id });
  assert.equal(s.status, 200, s.text);
  assert.ok(s.body.data.text.length > 10); assert.equal(s.body.data.draft, null);
  assert.equal(s.body.data.draft_error.code, 'AI_SAMPLE_ONLY');
  // live AI through the fake Claude
  Object.assign(config.ai, { mode: 'live', provider: 'anthropic', apiKey: 'test-key', baseUrl: claude.url, model: 'claude-opus-5-5' });
  try {
    stt.next = { text: `${p.last_name} ${p.first_name} 3 kundan beri bosh og'rig'idan shikoyat qiladi.` };
    const n = claude.calls.length;
    const r = await doctor.dictate({ field: 'all', structure: '1', encounter_id: encounter.encounter.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.seconds, 21.5);
    assert.equal(r.body.data.draft.mode, 'live'); assert.equal(r.body.data.draft.draft.complaints, 'Bosh og‘rig‘i 3 kundan beri.');
    const sent = JSON.stringify(claude.calls[n].messages);
    assert.ok(!sent.includes(p.last_name) && sent.includes('[bemor]'), 'AI’ga bemor ismi ketmadi');
    // production without AI_CLINICAL_ALLOWED: the transcript (local) comes back, the cloud draft is refused
    config.mode = 'production';
    const pr = await doctor.dictate({ field: 'all', structure: '1', encounter_id: encounter.encounter.id });
    assert.equal(pr.status, 200, pr.text); assert.equal(pr.body.data.draft_error.code, 'AI_DISABLED_PRODUCTION');
    assert.equal(claude.calls.length, n + 1);
  } finally { config.mode = 'demo'; config.ai.mode = 'sample'; }
  const noteAfter = (await pool.query(`SELECT version FROM clinical_notes WHERE encounter_id = $1`, [encounter.encounter.id])).rows[0].version;
  assert.equal(noteAfter, noteBefore, 'diktovka qaydni saqlamaydi');
});

test('tezlik chegarasi: bir soatda 30 ta diktovkadan keyin 429 STT_RATE; bir soatdan keyin yana ishlaydi', async () => {
  useLocal();
  await pool.query(`DELETE FROM ai_usage WHERE route = 'dictation'`);
  await pool.query(`INSERT INTO ai_usage (tenant_id, membership_id, route, model, outcome, audio_seconds)
                    SELECT $1, $2, 'dictation', 'local:test', 'ok', 10 FROM generate_series(1, 30)`, [SEED_IDS.tenant, M.doctor(0)]);
  const r = await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id });
  assert.equal(r.status, 429, r.text); assert.equal(r.body.error.code, 'STT_RATE'); assert.match(r.body.error.message, /30/);
  // an hour later the limit is free again
  await pool.query(`UPDATE ai_usage SET created_at = created_at - interval '61 minutes' WHERE route = 'dictation'`);
  assert.equal((await doctor.dictate({ field: 'complaints', encounter_id: encounter.encounter.id })).status, 200);
});
