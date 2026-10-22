// AI phase 1 against a fake Claude Messages API and a fake PubMed (no real model calls, no cost):
// request shape, de-identification, refusal/bad output/auth errors, usage metering, ICD-10 search/suggest/save,
// daily specialty news.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool, config, news;

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

// ---------- fake Claude API ----------
const claude = { calls: [], next: null, server: null, url: '' };
const msg = (obj, extra = {}) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
  usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...extra,
});
function answerFor(body) {
  const sys = JSON.stringify(body.system);
  if (sys.includes('hujjat tartiblovchisan')) return msg({ complaints: 'Bosh og‘rig‘i 2 kundan beri.', anamnesis: 'Kiritilmagan', examination: 'AQB 150/95.', diagnosis: 'Arterial gipertenziya.', recommendations: 'Kuzatuv.' });
  if (sys.includes('MKB-10')) return msg({ suggestions: [
    { code: 'I10', confidence: 'high', reason_uz: 'Birlamchi gipertenziya.' },
    { code: 'X99.9', confidence: 'low', reason_uz: 'To‘qib chiqarilgan kod.' },
    { code: 'I10', confidence: 'high', reason_uz: 'Takror.' }] });
  if (sys.includes('maqolalarni qisqa')) {
    const items = JSON.parse(body.messages[0].content);
    return msg({ items: [...items.map((i) => ({ pmid: i.pmid, title_uz: `Tarjima: ${i.title}`, summary_uz: `Randomizatsiyalangan tadqiqot qisqa mazmuni (${i.pmid}).`, takeaway_uz: 'Dastlabki natija.' })),
      { pmid: '999999', title_uz: 'Kiritilmagan maqola', summary_uz: 'Bu ro‘yxatda yo‘q edi.', takeaway_uz: '-' }] });
  }
  return msg({});
}
function startClaude() {
  return new Promise((resolve) => {
    claude.server = http.createServer(async (req, res) => {
      let raw = ''; for await (const ch of req) raw += ch;
      const body = raw ? JSON.parse(raw) : {};
      claude.calls.push({ url: req.url, headers: req.headers, body });
      const send = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
      const next = claude.next; claude.next = null;
      if (next === 'refusal') return send(200, { ...msg(''), content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: 'test' } });
      if (next === 'garbage') return send(200, msg('bu JSON emas'));
      if (next === 'auth') return send(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
      return send(200, answerFor(body));
    }).listen(0, '127.0.0.1', () => { claude.url = `http://127.0.0.1:${claude.server.address().port}`; resolve(); });
  });
}

// ---------- fake PubMed ----------
const pubmed = { server: null, url: '', calls: [], throttleNext: 0 };
const ABSTRACT_MARK = 'UNIQUEABSTRACTSENTENCE';
const xmlArticle = (pmid, title) => `<PubmedArticle><MedlineCitation><PMID Version="1">${pmid}</PMID><Article><Journal><Title>Test Journal of Medicine</Title><JournalIssue><PubDate><Year>2026</Year><Month>Oct</Month><Day>2</Day></PubDate></JournalIssue></Journal>
  <ArticleTitle>${title} &amp; outcomes</ArticleTitle><Abstract><AbstractText Label="BACKGROUND">Background ${ABSTRACT_MARK} text.</AbstractText><AbstractText Label="RESULTS">HR 0.8 (95% CI 0.7&#8211;0.9).</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle>`;
function startPubmed() {
  return new Promise((resolve) => {
    pubmed.server = http.createServer((req, res) => {
      pubmed.calls.push(req.url);
      if (pubmed.throttleNext > 0) { pubmed.throttleNext--; res.writeHead(429, { 'retry-after': '0' }); return res.end('Too Many Requests'); }
      if (req.url.startsWith('/esearch.fcgi')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ esearchresult: { idlist: ['40000001', '40000002'] } })); }
      if (req.url.startsWith('/efetch.fcgi')) { res.setHeader('content-type', 'text/xml'); return res.end(`<?xml version="1.0"?><PubmedArticleSet>${xmlArticle('40000001', 'Statins in older adults')}${xmlArticle('40000002', 'Salt reduction trial')}</PubmedArticleSet>`); }
      res.statusCode = 404; res.end();
    }).listen(0, '127.0.0.1', () => { pubmed.url = `http://127.0.0.1:${pubmed.server.address().port}`; resolve(); });
  });
}

let manager, doctor, other, encounter;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  config = require('../dist/core/config.js').config;
  news = app.get(require('../dist/ai/news.js').NewsService);
  await Promise.all([startClaude(), startPubmed()]);
  config.ai.mode = 'live'; config.ai.provider = 'anthropic'; config.ai.apiKey = 'test-key'; config.ai.baseUrl = claude.url; config.ai.model = 'claude-opus-5-5';
  config.news.pubmedBase = pubmed.url; config.news.ncbiKey = 'x'; // short pause between specialties in tests
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  doctor = session(); await doctor.demo(M.doctor(0));
  other = session(); await other.demo(M.doctor(1));
  const today = (await doctor.get('/me')).body.data.today;
  const appt = (await doctor.get(`/appointments?date=${today}`)).body.data.find((a) => a.status === 'in_progress' && a.encounter_id);
  assert.ok(appt, 'seed’da shifokor 0 ning davom etayotgan qabuli bor');
  encounter = (await doctor.get(`/encounters/${appt.encounter_id}`)).body.data;
});
after(async () => {
  // fake articles must not leak into other suites (news is global, a demo reset does not clear it)
  await pool?.query(`DELETE FROM news_items WHERE journal = 'Test Journal of Medicine'`).catch(() => undefined);
  await app?.close(); claude.server?.close(); pubmed.server?.close();
});

test('qaydni tartiblash (jonli): SDK so‘rovi to‘g‘ri; bemor ismi va telefoni AI’ga ketmaydi; xarajat yoziladi', async () => {
  const p = encounter.patient;
  const text = `${p.last_name} ${p.first_name} 2 kundan beri bosh og‘rig‘idan shikoyat qiladi, tel +998 90 123 45 67. Ko‘rikda AQB 150/95. Gipertenziya.`;
  const before = claude.calls.length;
  const r = await doctor.post('/ai/note-draft', { text, encounter_id: encounter.encounter.id });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.mode, 'live');
  assert.equal(r.body.data.draft.diagnosis, 'Arterial gipertenziya.');
  const call = claude.calls[before];
  assert.match(call.url, /^\/v1\/messages/);
  assert.equal(call.headers['x-api-key'], 'test-key');
  assert.match(String(call.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.equal(call.body.model, 'claude-opus-5-5');
  assert.equal(call.body.fallbacks, 'default');
  assert.equal(call.body.output_config.format.type, 'json_schema');
  const sent = JSON.stringify(call.body.messages);
  assert.ok(!sent.includes(p.last_name) && !sent.includes(p.first_name), 'ism yuborilmadi');
  assert.ok(!sent.includes('123 45 67') && sent.includes('[telefon]') && sent.includes('[bemor]'), sent);
  const u = (await pool.query(`SELECT * FROM ai_usage WHERE route = 'note_draft' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(u.outcome, 'ok'); assert.equal(u.input_tokens, 1200); assert.equal(u.output_tokens, 300);
  assert.equal(Number(u.cost_usd), (1200 * 4 + 300 * 20) / 1e6);
  assert.equal(u.tenant_id, SEED_IDS.tenant);
  const a = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'ai.note_draft' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.ok(!a.summary.includes('bosh og‘rig‘i'), 'audit’da klinik matn yo‘q');
});

test('AI shifokor tilida javob beradi: ruscha sessiyada ko‘rsatma rus tilida yozishni so‘raydi, «Kiritilmagan» belgisi o‘zgarmaydi', async () => {
  assert.equal((await doctor.put('/me/preferences', { locale: 'ru' })).status, 200);
  try {
    const before = claude.calls.length;
    const r = await doctor.post('/ai/note-draft', { text: 'Bemor 2 kundan beri yo‘taldan shikoyat qiladi, harorat 37.5.' });
    assert.equal(r.status, 200, r.text);
    const sys = JSON.stringify(claude.calls[before].body.system);
    assert.match(sys, /rus tilida/); assert.match(sys, /Kiritilmagan/);
    const icd = await doctor.post('/ai/icd10-suggest', { text: 'Arterial gipertenziya' });
    assert.equal(icd.status, 200);
    assert.match(JSON.stringify(claude.calls.at(-1).body.messages), /rus tilida/, 'MKB-10 izohi ham rus tilida so‘raladi');
  } finally {
    await doctor.put('/me/preferences', { locale: 'uz' });
  }
});

test('xatolar: boshqa shifokor qabuli 403; rad etish, buzuq javob, noto‘g‘ri kalit — tushunarli xato va hisobda qayd', async () => {
  const text = 'Bemor 3 kundan beri yo‘taldan shikoyat qiladi, harorat 37.5.';
  assert.equal((await other.post('/ai/note-draft', { text, encounter_id: encounter.encounter.id })).status, 403);
  claude.next = 'refusal';
  let r = await doctor.post('/ai/note-draft', { text });
  assert.equal(r.status, 502); assert.equal(r.body.error.code, 'AI_REFUSED');
  claude.next = 'garbage';
  r = await doctor.post('/ai/note-draft', { text });
  assert.equal(r.status, 502); assert.equal(r.body.error.code, 'AI_BAD_OUTPUT');
  claude.next = 'auth';
  r = await doctor.post('/ai/note-draft', { text });
  assert.equal(r.status, 503); assert.equal(r.body.error.code, 'AI_KEY');
  const outcomes = (await pool.query(`SELECT outcome FROM ai_usage WHERE route = 'note_draft' ORDER BY id DESC LIMIT 3`)).rows.map((x) => x.outcome);
  assert.deepEqual(outcomes, ['error', 'bad_output', 'refusal']);
});

test('MKB-10: qidiruv; AI faqat jadvaldagi kodni beradi (to‘qilgan va takror kod olib tashlanadi); AI o‘chiq bo‘lsa — so‘z bo‘yicha', async () => {
  const s = (await doctor.get('/icd10?q=gipert')).body.data;
  assert.ok(s.some((x) => x.code === 'I10'), JSON.stringify(s));
  assert.ok((await doctor.get('/icd10?q=J0')).body.data.every((x) => x.code.startsWith('J0')));
  assert.equal((await manager.get('/icd10?q=gipert')).status, 403);
  const before = claude.calls.length;
  const r = await doctor.post('/ai/icd10-suggest', { text: 'Arterial gipertenziya, birlamchi', encounter_id: encounter.encounter.id });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.mode, 'live');
  assert.deepEqual(r.body.data.suggestions.map((x) => x.code), ['I10']);
  assert.ok(r.body.data.suggestions[0].title.length > 3);
  const call = claude.calls[before];
  assert.equal(call.body.system[0].cache_control.type, 'ephemeral', 'kodlar ro‘yxati keshlanadi');
  assert.ok(call.body.system[0].text.includes('I10 —'));
  config.ai.mode = 'sample';
  try {
    const off = await doctor.post('/ai/icd10-suggest', { text: 'surunkali gastrit' });
    assert.equal(off.body.data.mode, 'search');
    assert.ok(off.body.data.suggestions.some((x) => x.code === 'K29.5'), JSON.stringify(off.body.data));
    assert.equal(claude.calls.length, before + 1, 'namunaviy rejimda AI chaqirilmadi');
  } finally { config.ai.mode = 'live'; }
});

test('MKB-10 qaydda: saqlanadi (nom bilan), noma’lum kod 422, tasdiqlashda audit’ga kodlar yoziladi', async () => {
  const id = encounter.encounter.id;
  let note = (await doctor.get(`/encounters/${id}`)).body.data.note;
  const body = (v, icd10) => ({ version: v, complaints: 'Bosh og‘rig‘i', anamnesis: null, examination: 'AQB 150/95', diagnosis: 'Gipertenziya', recommendations: 'Kuzatuv', follow_up_date: null, vitals: {}, icd10 });
  let r = await doctor.put(`/encounters/${id}/draft`, body(note.version, ['Z99.99']));
  assert.equal(r.status, 422); assert.ok(r.body.error.fields.icd10);
  r = await doctor.put(`/encounters/${id}/draft`, body(note.version, ['I10', 'R51']));
  assert.equal(r.status, 200, r.text);
  note = (await doctor.get(`/encounters/${id}`)).body.data.note;
  assert.deepEqual(note.icd10.map((x) => x.code), ['I10', 'R51']);
  assert.ok(note.icd10[0].title.toLowerCase().includes('gipertenziya'));
  // codes omitted on the next save → kept
  r = await doctor.put(`/encounters/${id}/draft`, { ...body(note.version), icd10: undefined });
  assert.equal(r.status, 200);
  note = (await doctor.get(`/encounters/${id}`)).body.data.note;
  assert.equal(note.icd10.length, 2);
  r = await doctor.post(`/encounters/${id}/sign`, body(note.version, ['I10']));
  assert.equal(r.status, 200, r.text);
  const a = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'clinical_note.sign' AND resource_id = $1`, [id])).rows[0];
  assert.match(a.summary, /MKB-10: I10/);
});

test('AI sarfi: rahbar ko‘radi (marshrut, token, $), shifokor ko‘rmaydi', async () => {
  const r = await manager.get('/ai/usage');
  assert.equal(r.status, 200);
  const note = r.body.data.by_route.find((x) => x.route === 'note_draft');
  assert.ok(note.calls >= 4 && note.ok >= 1 && note.failed >= 3);
  assert.ok(note.cost_usd > 0);
  assert.equal(r.body.data.key_configured, true);
  assert.ok(r.body.data.icd10.n >= 100);
  assert.equal((await doctor.get('/ai/usage')).status, 403);
});

test('yangiliklar: PubMed → AI o‘zbekcha qisqa mazmun; annotatsiya saqlanmaydi; begona PMID olinmaydi; baho; kuniga bir marta', async () => {
  await pool.query(`DELETE FROM news_items`);
  const added = await news.refreshSpecialty('internal');
  assert.equal(added, 2);
  const term = decodeURIComponent(pubmed.calls.find((u) => u.startsWith('/esearch')).replace(/\+/g, ' '));
  assert.match(term, /internal medicine/); assert.match(term, /randomized controlled trial/);
  const list = (await doctor.get('/news')).body;
  assert.equal(list.meta.specialty, 'internal', 'Terapevt → ichki kasalliklar');
  assert.equal(list.data.length, 2);
  const item = list.data.find((x) => x.url.endsWith('/40000001/'));
  assert.equal(item.title, 'Statins in older adults & outcomes');
  assert.match(item.title_uz, /^Tarjima:/); assert.ok(item.summary_uz && item.takeaway_uz);
  assert.equal(item.journal, 'Test Journal of Medicine'); assert.equal(item.published, '2026 Oct 2');
  const stored = JSON.stringify((await pool.query(`SELECT * FROM news_items`)).rows);
  assert.ok(!stored.includes(ABSTRACT_MARK), 'annotatsiya bazada yo‘q');
  assert.ok(!stored.includes('999999'), 'so‘ralmagan PMID saqlanmadi');
  const sentToAi = JSON.stringify(claude.calls.at(-1).body.messages);
  assert.ok(sentToAi.includes(ABSTRACT_MARK) && sentToAi.includes('0.7–0.9'), 'AI faqat annotatsiyadan ishlaydi (entity decode)');
  assert.equal((await doctor.post(`/news/${item.id}/feedback`, { useful: true })).status, 200);
  assert.equal((await doctor.get('/news')).body.data.find((x) => x.id === item.id).useful, true);
  assert.equal(await news.refreshSpecialty('internal'), 0, 'bugun allaqachon yangilangan');
  const usage = (await pool.query(`SELECT tenant_id, outcome FROM ai_usage WHERE route = 'news_summary' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(usage.tenant_id, null); assert.equal(usage.outcome, 'ok');
});

test('PubMed 429 (limit): kutib qayta so‘raladi va maqolalar baribir olinadi', async () => {
  await pool.query(`DELETE FROM news_items WHERE specialty_key = 'neurology'`);
  pubmed.throttleNext = 2; // esearch: 429, 429, then OK
  const calls = pubmed.calls.length;
  assert.equal(await news.refreshSpecialty('neurology'), 2);
  assert.equal(pubmed.calls.slice(calls).filter((u) => u.startsWith('/esearch')).length, 3, 'ikki marta kutib, uchinchisida oldi');
});

test('yangiliklar AI o‘chiq: faqat asl sarlavha va havola; rahbar yangilashi 10 daqiqada bir marta', async () => {
  config.ai.mode = 'sample';
  try {
    const calls = claude.calls.length;
    assert.equal(await news.refreshSpecialty('cardiology'), 2);
    assert.equal(claude.calls.length, calls, 'AI chaqirilmadi');
    const items = (await manager.get('/news?specialty=cardiology')).body.data;
    assert.equal(items.length, 2);
    assert.ok(items.every((x) => x.title && x.title_uz === null && x.summary_uz === null && x.url.startsWith('https://pubmed.ncbi.nlm.nih.gov/')));
  } finally { config.ai.mode = 'live'; }
  assert.equal((await manager.post('/news/refresh')).status, 200);
  assert.equal((await manager.post('/news/refresh')).status, 429);
  assert.equal((await doctor.post('/news/refresh')).status, 403);
});

test('shaxsiy yangiliklar: o‘z mutaxassisligi + tanlangan mavzular; saqlash, o‘qildi; begona mavzu va ortiqcha tanlov rad etiladi', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const put = (key, pmid, title) => pool.query(
    `INSERT INTO news_items (specialty_key, external_id, title, url, fetched_on, journal) VALUES ($1,$2,$3,$4,$5,'Test Journal of Medicine') ON CONFLICT DO NOTHING`,
    [key, pmid, title, `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, today]);
  await put('urology', '50000001', 'Prostate biopsy trial');
  await put('surgery', '50000002', 'Laparoscopic hernia repair');
  await put('internal', '50000003', 'Hypertension in primary care');
  await doctor.put('/news/topics', { keys: [] });
  let feed = (await doctor.get('/news')).body;
  assert.equal(feed.meta.own, 'internal');
  assert.ok(feed.data.every((x) => x.specialty_key === 'internal'), 'faqat o‘z sohasi');
  const topics = (await doctor.get('/news/topics')).body.data;
  assert.ok(topics.all.length >= 25 && topics.all.some((x) => x.key === 'urology') && topics.all.some((x) => x.key === 'surgery'));
  // follow urology and surgery (the own specialty is dropped from the stored list)
  const r = await doctor.put('/news/topics', { keys: ['urology', 'surgery', 'internal'] });
  assert.equal(r.status, 200); assert.deepEqual(r.body.data.followed, ['urology', 'surgery']);
  feed = (await doctor.get('/news')).body;
  const titles = feed.data.map((x) => x.title);
  assert.ok(titles.includes('Prostate biopsy trial') && titles.includes('Laparoscopic hernia repair') && titles.includes('Hypertension in primary care'));
  assert.equal(new Set(feed.data.map((x) => x.url)).size, feed.data.length, 'bir maqola bir marta');
  assert.ok((await doctor.get('/news?specialty=urology')).body.data.every((x) => x.specialty_key === 'urology'));
  // saved / read
  const item = feed.data.find((x) => x.title === 'Prostate biopsy trial');
  const unread = feed.meta.unread;
  assert.equal((await doctor.post(`/news/${item.id}/save`, { saved: true })).status, 200);
  const saved = (await doctor.get('/news?view=saved')).body.data;
  assert.deepEqual(saved.map((x) => x.id), [item.id]);
  assert.ok(saved[0].saved_at && saved[0].read_at);
  assert.equal((await doctor.get('/news')).body.meta.unread, unread - 1);
  assert.equal((await doctor.post(`/news/${feed.data.find((x) => x.title === 'Laparoscopic hernia repair').id}/read`)).status, 200);
  assert.equal((await doctor.get('/news')).body.meta.unread, unread - 2);
  assert.equal((await doctor.post(`/news/${item.id}/save`, { saved: false })).status, 200);
  assert.equal((await doctor.get('/news?view=saved')).body.data.length, 0);
  // rules
  const many = await doctor.put('/news/topics', { keys: ['urology', 'surgery', 'dentistry', 'ent', 'oncology', 'dermatology'] });
  assert.equal(many.status, 422);
  const unknown = await doctor.put('/news/topics', { keys: ['astrology'] });
  assert.equal(unknown.status, 422); assert.ok(unknown.body.error.fields.keys);
  assert.equal((await manager.put('/news/topics', { keys: ['urology'] })).status, 403);
  assert.equal((await doctor.post('/news/00000000-0000-4000-8000-000000000000/save', { saved: true })).status, 404);
  // the daily job also covers the topics doctors follow
  assert.ok((await news.activeSpecialties()).includes('urology'));
  await doctor.put('/news/topics', { keys: [] });
});

// ---------- Gemini (second provider behind the same AiClient) ----------
test('Gemini: so‘rov shakli, ism yuborilmaydi, sarf hisobi; rad etish, kesilgan javob, kalit, limit; bepul tarifga real klinikada bemor matni ketmaydi', async () => {
  const gem = { calls: [], next: null };
  const ok = (obj, extra = {}) => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'o‘ylash', thought: true }, { text: JSON.stringify(obj) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 200, candidatesTokenCount: 100, thoughtsTokenCount: 50 }, modelVersion: 'gemini-3.8-flash-001', ...extra });
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const ch of req) raw += ch;
    const body = JSON.parse(raw || '{}');
    gem.calls.push({ url: req.url, headers: req.headers, body });
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const next = gem.next; gem.next = null;
    if (next === 'blocked') return send(200, { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: { promptTokenCount: 50 } });
    if (next === 'cut') return send(200, { ...ok({}), candidates: [{ content: { parts: [{ text: '{"complaints":"Bosh' }] }, finishReason: 'MAX_TOKENS' }] });
    if (next === 'auth') return send(401, { error: { code: 401, message: 'API key not valid.', status: 'UNAUTHENTICATED' } });
    if (next === 'stall') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"candidates":'); return; } // body never ends
    if (next === 'overloaded') return send(503, { error: { code: 503, message: 'high demand', status: 'UNAVAILABLE' } });
    if (next === 'overloaded2') { gem.next = 'overloaded'; return send(503, { error: { code: 503, message: 'high demand', status: 'UNAVAILABLE' } }); }
    if (next === 'quota') return send(429, { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } });
    const sys = body.systemInstruction.parts[0].text;
    if (sys.includes('MKB-10')) return send(200, ok({ suggestions: [{ code: 'I10', confidence: 'high', reason_uz: 'Gipertenziya.' }, { code: 'Q00.0', confidence: 'low', reason_uz: 'To‘qilgan.' }] }));
    return send(200, ok({ complaints: "Bosh og'rig'i, ma`lumot yo'q.", anamnesis: 'Kiritilmagan', examination: 'AQB 150/95.', diagnosis: 'Arterial gipertenziya.', recommendations: 'Kuzatuv.' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const saved = { ...config.ai }, savedMode = config.mode;
  Object.assign(config.ai, { provider: 'gemini', apiKey: 'gem-test-key', model: 'gemini-3.8-flash', baseUrl: `http://127.0.0.1:${server.address().port}`, geminiPaid: false });
  try {
    const p = encounter.patient;
    const text = `${p.last_name} ${p.first_name} 2 kundan beri bosh og‘rig‘i, tel +998 90 123 45 67. AQB 150/95.`;
    let r = await doctor.post('/ai/note-draft', { text, encounter_id: encounter.encounter.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.draft.diagnosis, 'Arterial gipertenziya.', 'o‘ylash qismi javobga qo‘shilmadi');
    assert.equal(r.body.data.draft.complaints, 'Bosh og‘rig‘i, ma’lumot yo‘q.', 'ASCII apostrof o‘zbekcha belgiga almashtirildi');
    const call = gem.calls.at(-1);
    assert.equal(call.url, '/v1beta/models/gemini-3.8-flash:generateContent');
    assert.equal(call.headers['x-goog-api-key'], 'gem-test-key');
    assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(call.body.generationConfig.responseJsonSchema.required, ['complaints', 'anamnesis', 'examination', 'diagnosis', 'recommendations']);
    assert.equal(call.body.generationConfig.thinkingConfig.thinkingLevel, 'low');
    const sent = JSON.stringify(call.body.contents);
    assert.ok(!sent.includes(p.last_name) && !sent.includes('123 45 67') && sent.includes('[bemor]'), sent);
    const u = (await pool.query(`SELECT * FROM ai_usage WHERE route = 'note_draft' ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.equal(u.model, 'gemini-3.8-flash-001'); assert.equal(u.outcome, 'ok');
    assert.equal(u.input_tokens, 800, 'keshdan o‘qilgan tokenlar alohida'); assert.equal(u.cache_read_tokens, 200);
    assert.equal(u.output_tokens, 150, 'o‘ylash tokenlari chiqishga qo‘shiladi');
    assert.equal(Number(u.cost_usd), 0, 'bepul tarif — to‘lov yo‘q');

    r = await doctor.post('/ai/icd10-suggest', { text: 'Arterial gipertenziya' });
    assert.deepEqual(r.body.data.suggestions.map((x) => x.code), ['I10']);

    // only the note-draft calls are counted: the doctor's news feed summarises articles through the same fake Gemini in the background
    const noteCalls = () => gem.calls.filter((c) => JSON.stringify(c.body?.systemInstruction ?? '').includes('tartiblovchisan')).length;
    gem.next = 'overloaded'; // 503 once: retried after a second
    const before503 = noteCalls();
    r = await doctor.post('/ai/note-draft', { text: 'Bemor yo‘taldan shikoyat qiladi.' });
    assert.equal(r.status, 200, r.text); assert.equal(noteCalls(), before503 + 2, 'bir marta qayta so‘raldi');

    config.ai.timeoutMs = 800; gem.next = 'stall'; // headers arrive, the body stalls: a timeout, not "bad output"
    r = await doctor.post('/ai/note-draft', { text: 'Bemor yo‘taldan shikoyat qiladi.' });
    assert.equal(r.status, 504, r.text); assert.equal(r.body.error.code, 'AI_TIMEOUT');
    config.ai.timeoutMs = saved.timeoutMs;

    for (const [next, status, code] of [['blocked', 502, 'AI_REFUSED'], ['cut', 502, 'AI_BAD_OUTPUT'], ['auth', 503, 'AI_KEY'], ['quota', 429, 'AI_BUSY'], ['overloaded2', 429, 'AI_BUSY']]) {
      gem.next = next;
      r = await doctor.post('/ai/note-draft', { text: 'Bemor yo‘taldan shikoyat qiladi.' });
      assert.equal(r.status, status, `${next}: ${r.text}`); assert.equal(r.body.error.code, code);
      assert.ok(!r.text.includes('gem-test-key'));
    }
    const outcomes = (await pool.query(`SELECT outcome, error_code FROM ai_usage WHERE route = 'note_draft' ORDER BY id DESC LIMIT 6`)).rows;
    assert.deepEqual(outcomes.map((x) => x.outcome), ['error', 'error', 'error', 'bad_output', 'refusal', 'error']);
    assert.equal(outcomes[5].error_code, 'AI_TIMEOUT');

    // apostrophes: Uzbek letters get ‘, an English possessive keeps ’
    const { uzQuotes, AiClient } = require('../dist/ai/ai-client.js');
    assert.equal(uzQuotes("Hodgkin's va dog's; o'zbek, ma'lumot, toʼg'ri"), 'Hodgkin’s va dog’s; o‘zbek, ma’lumot, to‘g‘ri');

    // a real (non-seed) clinic on a demo deployment: the free tier gets no clinical text either
    const ai = app.get(AiClient);
    assert.equal(ai.clinicalAllowed(SEED_IDS.tenant), true, 'demo klinika — sun’iy ma’lumot');
    assert.equal(ai.clinicalAllowed('00000000-0000-4000-8000-000000000001'), false, 'haqiqiy klinika demo serverda ham');
    assert.equal(ai.clinicalAllowed(null), false);

    // a real clinic on the free tier: no clinical text leaves the server; ICD-10 falls back to word search
    // (AI_CLINICAL_ALLOWED=1 here, so it is the free-tier rule that refuses, not the production switch)
    config.mode = 'production'; config.ai.clinicalInProduction = true;
    const calls = noteCalls();
    assert.equal((await doctor.get('/ai/status')).body.data.mode, 'off');
    const me = (await doctor.get('/me')).body.data;
    assert.equal(me.ai_mode, 'off', 'shifokor tugmasi ham o‘chadi'); assert.match(me.ai_off_reason, /Bepul Gemini/);
    r = await doctor.post('/ai/note-draft', { text: 'Bemor yo‘taldan shikoyat qiladi.' });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'AI_NOT_ALLOWED'); assert.match(r.body.error.message, /Bepul Gemini/);
    r = await doctor.post('/ai/icd10-suggest', { text: 'Arterial gipertenziya' });
    assert.equal(r.body.data.mode, 'search');
    assert.equal(noteCalls(), calls, 'Gemini’ga hech narsa yuborilmadi');
    const usage = (await manager.get('/ai/usage')).body.data;
    assert.equal(usage.provider, 'gemini'); assert.equal(usage.gemini_free, true); assert.equal(usage.clinical_allowed, false);
    config.ai.geminiPaid = true;
    assert.equal((await doctor.post('/ai/note-draft', { text: 'Bemor yo‘taldan shikoyat qiladi.' })).status, 200, 'pullik kalit bilan ruxsat');
    const paid = (await pool.query(`SELECT cost_usd FROM ai_usage WHERE route = 'note_draft' ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.ok(Math.abs(Number(paid.cost_usd) - (800 * 0.75 + 150 * 3.75 + 200 * 0.075) / 1e6) < 1e-6, `versiyali model nomi asosiy narx bilan: ${paid.cost_usd}`);
  } finally {
    Object.assign(config.ai, saved); config.mode = savedMode;
    server.close();
  }
});

// ---------- production guard and the daily budget ----------
test('production: klinik marshrutlar AI_CLINICAL_ALLOWED=1 bo‘lmaguncha 503 AI_DISABLED_PRODUCTION (uz/ru); yangiliklar ishlaydi; ruxsat bilan — 200', async () => {
  const savedMode = config.mode, savedAllowed = config.ai.clinicalInProduction;
  config.mode = 'production'; config.ai.clinicalInProduction = false;
  try {
    const calls = claude.calls.length;
    const text = 'Bemor 2 kundan beri yo‘taldan shikoyat qiladi, harorat 37.5.';
    let r = await doctor.post('/ai/note-draft', { text, encounter_id: encounter.encounter.id });
    assert.equal(r.status, 503, r.text); assert.equal(r.body.error.code, 'AI_DISABLED_PRODUCTION');
    assert.match(r.body.error.message, /klinik matn uchun AI yoqilmagan/);
    r = await doctor.post('/ai/icd10-suggest', { text: 'Arterial gipertenziya' });
    assert.equal(r.status, 200); assert.equal(r.body.data.mode, 'search', 'MKB-10 so‘z bo‘yicha qidiradi, AI’siz');
    assert.equal(claude.calls.length, calls, 'klinik matn modelga ketmadi');
    const me = (await doctor.get('/me')).body.data;
    assert.equal(me.ai_mode, 'off'); assert.match(me.ai_off_reason, /klinik matn uchun AI yoqilmagan/);
    assert.equal((await doctor.get('/ai/status')).body.data.mode, 'off');
    // the person's language: the same refusal in Russian
    assert.equal((await doctor.put('/me/preferences', { locale: 'ru' })).status, 200);
    try {
      r = await doctor.post('/ai/note-draft', { text });
      assert.equal(r.status, 503); assert.equal(r.body.error.code, 'AI_DISABLED_PRODUCTION'); assert.match(r.body.error.message, /не включён/);
      assert.match((await doctor.get('/me')).body.data.ai_off_reason, /не включён/);
    } finally { await doctor.put('/me/preferences', { locale: 'uz' }); }
    // public route: specialty news summaries still run on a production server
    await pool.query(`DELETE FROM news_items WHERE specialty_key = 'dermatology'`);
    assert.equal(await news.refreshSpecialty('dermatology'), 2);
    assert.equal(claude.calls.length, calls + 1, 'yangiliklar uchun model chaqirildi');
    // the clinic switched clinical AI on
    config.ai.clinicalInProduction = true;
    r = await doctor.post('/ai/note-draft', { text, encounter_id: encounter.encounter.id });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.data.mode, 'live');
    assert.equal((await doctor.get('/me')).body.data.ai_mode, 'live');
  } finally { config.mode = savedMode; config.ai.clinicalInProduction = savedAllowed; }
});

test('kunlik limit: klinikaning bugungi sarfi AI_DAILY_LIMIT_USD ga yetganda 429 AI_BUDGET (uz/ru), model chaqirilmaydi; yangiliklar chegaralanmaydi', async () => {
  const savedLimit = config.ai.dailyLimitUsd;
  const spent = Number((await pool.query(`SELECT coalesce(sum(cost_usd),0) AS s FROM ai_usage WHERE tenant_id = $1 AND created_at >= date_trunc('day', demo_now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'`, [SEED_IDS.tenant])).rows[0].s);
  assert.ok(spent > 0, `bugungi sarf bor: ${spent}`);
  config.ai.dailyLimitUsd = spent; // the cap is reached exactly
  try {
    const calls = claude.calls.length;
    const text = 'Bemor 2 kundan beri yo‘taldan shikoyat qiladi, harorat 37.5.';
    let r = await doctor.post('/ai/note-draft', { text, encounter_id: encounter.encounter.id });
    assert.equal(r.status, 429, r.text); assert.equal(r.body.error.code, 'AI_BUDGET'); assert.match(r.body.error.message, /limiti tugadi/);
    assert.equal(claude.calls.length, calls, 'model chaqirilmadi');
    assert.equal((await doctor.put('/me/preferences', { locale: 'ru' })).status, 200);
    try {
      r = await doctor.post('/ai/note-draft', { text });
      assert.equal(r.status, 429); assert.match(r.body.error.message, /лимит/);
    } finally { await doctor.put('/me/preferences', { locale: 'uz' }); }
    // the other clinic has its own budget
    const t2 = session(); await t2.demo(M.tenant2Doctor ?? M.tenant2Manager);
    const usage2 = (await pool.query(`SELECT count(*)::int AS n FROM ai_usage WHERE tenant_id = $1`, [SEED_IDS.tenant2])).rows[0].n;
    assert.equal(usage2, 0);
    // news has no tenant: not capped per clinic
    await pool.query(`DELETE FROM news_items WHERE specialty_key = 'ophthalmology'`);
    assert.equal(await news.refreshSpecialty('ophthalmology'), 2);
    assert.equal(claude.calls.length, calls + 1);
    // a higher cap lets the next call through
    config.ai.dailyLimitUsd = spent + 1;
    r = await doctor.post('/ai/note-draft', { text, encounter_id: encounter.encounter.id });
    assert.equal(r.status, 200, r.text);
    // 0 = no cap
    config.ai.dailyLimitUsd = 0;
    assert.equal((await doctor.post('/ai/note-draft', { text })).status, 200);
  } finally { config.ai.dailyLimitUsd = savedLimit; }
});

test('sozlamalar: APP_MODE=production da AI_MODE sukut bo‘yicha off, model sukut bo‘yicha claude-sonnet-5-5, limit 5 $', () => {
  const { execFileSync } = require('node:child_process');
  const read = (env) => JSON.parse(execFileSync(process.execPath, ['-e', 'const { config } = require("./dist/core/config.js"); console.log(JSON.stringify({ mode: config.ai.mode, model: config.ai.model, limit: config.ai.dailyLimitUsd, allowed: config.ai.clinicalInProduction }))'],
    { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, AI_MODE: '', AI_MODEL: '', AI_PROVIDER: 'anthropic', AI_DAILY_LIMIT_USD: '', AI_CLINICAL_ALLOWED: '', ...env }, encoding: 'utf8' }).trim());
  assert.deepEqual(read({ APP_MODE: 'production' }), { mode: 'off', model: 'claude-sonnet-5-5', limit: 5, allowed: false });
  assert.deepEqual(read({ APP_MODE: 'demo' }), { mode: 'sample', model: 'claude-sonnet-5-5', limit: 5, allowed: false });
  assert.deepEqual(read({ APP_MODE: 'production', AI_MODE: 'live', AI_CLINICAL_ALLOWED: '1', AI_DAILY_LIMIT_USD: '12.5', AI_MODEL: 'claude-opus-5-5' }), { mode: 'live', model: 'claude-opus-5-5', limit: 12.5, allowed: true });
});
