// The manager's AI (docs/AI.md) against fake Claude and Gemini servers (no real model calls, no cost):
// the daily digest's fact sheet equals SQL, no patient name or clinical text reaches the model, bullets with
// invented numbers or unknown facts are dropped, the cache answers without a second call, the regenerate limit,
// branch scope and roles, the template digest in sample/off mode, and «ask the numbers»: the model may only pick a
// whitelisted template with in-range parameters — anything else is refused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool, config, facts;

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

const fmt = (n) => Number(n).toLocaleString('ru-RU'); // «1 250 000» with no-break spaces, as a model might write it

// ---------- fake Claude ----------
const claude = { calls: [], server: null, url: '', digest: null, plan: null, answer: null };
const msg = (obj) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 900, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
function defaultDigest(f) {
  return {
    bullets: [
      { text: `Sof tushum ${fmt(f['revenue.net'].value)} so‘m bo‘ldi.`, fact_keys: ['revenue.net'] },
      { text: `${f['visits.completed'].value} ta qabul yakunlandi.`, fact_keys: ['visits.completed'] },
      { text: 'Tushum 99 999 999 so‘mga yetdi.', fact_keys: ['revenue.net'] }, // invented number → dropped
      { text: `Yangi bemorlar: ${f['patients.new'].value}.`, fact_keys: ['patients.total_invented'] }, // unknown fact → dropped
    ],
    alerts: [{ text: `${f['debts.invoices'].value} ta hisob bo‘yicha qarz bor.`, fact_keys: ['debts.invoices'], severity: 'warning' }],
  };
}
function answerFor(body) {
  const sys = JSON.stringify(body.system);
  const user = body.messages[0].content;
  if (sys.includes('kunlik qisqa xulosa')) { const { facts: f } = JSON.parse(user); return msg((claude.digest ?? defaultDigest)(f)); }
  if (sys.includes('shablonlaridan')) return msg(claude.plan);
  if (sys.includes('jadval natijasi')) {
    const { facts: f } = JSON.parse(user);
    return msg(claude.answer ? claude.answer(f) : { sentences: [{ text: `Jadvalda ${f['rows.count'].value} ta qator.`, fact_keys: ['rows.count'] }] });
  }
  return msg({});
}
function startClaude() {
  return new Promise((resolve) => {
    claude.server = http.createServer(async (req, res) => {
      let raw = ''; for await (const ch of req) raw += ch;
      const body = raw ? JSON.parse(raw) : {};
      claude.calls.push({ url: req.url, body });
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answerFor(body)));
    }).listen(0, '127.0.0.1', () => { claude.url = `http://127.0.0.1:${claude.server.address().port}`; resolve(); });
  });
}
const callsOf = (part) => claude.calls.filter((c) => JSON.stringify(c.body.system).includes(part));

let manager, doctor, cashier, other, today, yesterday;
const dayStart = (d) => new Date(`${d}T00:00:00+05:00`);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  config = require('../dist/core/config.js').config;
  facts = require('../dist/ai/manager-facts.js');
  await startClaude();
  config.ai.mode = 'live'; config.ai.provider = 'anthropic'; config.ai.apiKey = 'test-key'; config.ai.baseUrl = claude.url; config.ai.model = 'claude-opus-5-5';
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  doctor = session(); await doctor.demo(M.doctor(0));
  cashier = session(); await cashier.demo(M.cashier);
  other = session(); await other.demo(M.tenant2Manager);
  today = (await manager.get('/me')).body.data.today;
  yesterday = addDays(today, -1);
});
after(async () => { await app?.close(); claude.server?.close(); });

test('raqam tekshiruvi: bo‘shliqli, mln, foiz, kasr; yorliqdagi raqam hisoblanmaydi; boshqa raqam rad etiladi', () => {
  const f = (value, unit = 'som', label) => ({ value, unit, ...(label ? { label } : {}) });
  assert.ok(facts.numbersMatch('Tushum 1 254 000 so‘m', [f(1254000)]));
  assert.ok(facts.numbersMatch('Tushum 1 254 000 so‘m', [f(1254000)]));
  assert.ok(facts.numbersMatch('Tushum 1,3 mln so‘m', [f(1254000)]), 'yaxlitlangan million');
  assert.ok(facts.numbersMatch('Выручка 1,25 млн сум', [f(1254000)]));
  assert.ok(facts.numbersMatch('12% kam', [f(-12, 'pct')]), 'ishora hisobga olinmaydi');
  assert.ok(facts.numbersMatch('UZI 3D — 5 ta', [f(5, 'count', 'UZI 3D')]), 'nomdagi raqam o‘tkaziladi');
  assert.ok(!facts.numbersMatch('Tushum 1 300 000 so‘m', [f(1254000)]));
  assert.ok(!facts.numbersMatch('Tushum 1,4 mln so‘m', [f(1254000)]));
  assert.ok(!facts.numbersMatch('17-oktabr kuni 5 ta', [f(5, 'count')]), 'faktda yo‘q sana ham raqam');
  const { kept, dropped } = facts.checkItems([
    { text: '5 ta qabul', fact_keys: ['a'] }, { text: '6 ta qabul', fact_keys: ['a'] }, { text: '5 ta', fact_keys: ['zz'] }, { text: 'Hammasi yaxshi', fact_keys: [] },
  ], { a: f(5, 'count') }, 6);
  assert.equal(kept.length, 1); assert.equal(dropped, 3);
});

test('kun xulosasi: faktlar SQL bilan bir xil; AI’ga bemor ismi va klinik matn ketmaydi; mos kelmagan bandlar tashlanadi; kesh', async () => {
  const before = callsOf('kunlik qisqa xulosa').length;
  const r = await manager.get(`/ai/digest?date=${yesterday}`);
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.equal(d.mode, 'live'); assert.equal(d.source, 'model'); assert.equal(d.day, yesterday); assert.equal(d.compare_day, addDays(yesterday, -7));
  assert.equal(d.dropped, 2, 'to‘qilgan raqam va noma’lum fakt tashlandi');
  assert.equal(d.digest.bullets.length, 2);
  assert.equal(d.digest.alerts.length, 1);
  assert.equal(callsOf('kunlik qisqa xulosa').length, before + 1);

  // the facts equal the SQL (cash basis, net of refunds; branch scope = all of the manager's branches)
  const branches = [SEED_IDS.branchCentral, SEED_IDS.branchYunusobod];
  const P = [SEED_IDS.tenant, branches, dayStart(yesterday), dayStart(today)];
  const pay = (await pool.query(`SELECT coalesce(sum(amount),0)::bigint AS s, count(*)::int AS n FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4`, P)).rows[0];
  const ref = (await pool.query(`SELECT coalesce(sum(amount),0)::bigint AS s FROM refunds WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4`, P)).rows[0];
  assert.equal(d.facts['revenue.net'].value, Math.round((Number(pay.s) - Number(ref.s)) / 100));
  assert.equal(d.facts['payments.count'].value, pay.n);
  assert.ok(pay.n > 0, 'seed’da kechagi to‘lovlar bor');
  const v = (await pool.query(`SELECT count(*) FILTER (WHERE status = 'completed')::int AS c, count(*) FILTER (WHERE status = 'no_show')::int AS ns, count(*) FILTER (WHERE status = 'cancelled')::int AS cx
      FROM appointments WHERE tenant_id = $1 AND branch_id = ANY($2) AND starts_at >= $3 AND starts_at < $4`, P)).rows[0];
  assert.equal(d.facts['visits.completed'].value, v.c); assert.equal(d.facts['visits.no_show'].value, v.ns); assert.equal(d.facts['visits.cancelled'].value, v.cx);
  // patient debt: a company's part of a bill is the company's receivable (docs/DISCOUNTS_COMPANIES.md)
  const debt = (await pool.query(`SELECT coalesce(sum(total - company_share_amount - (paid_amount - company_paid_amount)),0)::bigint AS s, count(*)::int AS n FROM invoices
      WHERE tenant_id = $1 AND branch_id = ANY($2) AND status IN ('unpaid','partially_paid') AND total - company_share_amount - (paid_amount - company_paid_amount) > 0`, [SEED_IDS.tenant, branches])).rows[0];
  assert.equal(d.facts['debts.invoices'].value, debt.n); assert.equal(d.facts['debts.total'].value, Math.round(Number(debt.s) / 100));
  const P7 = [SEED_IDS.tenant, branches, dayStart(addDays(yesterday, -7)), dayStart(addDays(yesterday, -6))];
  const pay7 = (await pool.query(`SELECT coalesce(sum(amount),0)::bigint AS s FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4`, P7)).rows[0];
  const ref7 = (await pool.query(`SELECT coalesce(sum(amount),0)::bigint AS s FROM refunds WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4`, P7)).rows[0];
  assert.equal(d.facts['revenue.net_last_week'].value, Math.round((Number(pay7.s) - Number(ref7.s)) / 100));
  assert.equal(d.facts['revenue.change'].value, d.facts['revenue.net'].value - d.facts['revenue.net_last_week'].value, 'farqni server hisoblaydi');

  // what the model received: numbers and doctor/service names only — no patient, no clinical text
  const sent = callsOf('kunlik qisqa xulosa').at(-1).body.messages[0].content;
  const sheet = JSON.parse(sent);
  for (const [k, f] of Object.entries(sheet.facts)) {
    assert.equal(typeof f.value, 'number', k);
    assert.deepEqual(Object.keys(f).filter((x) => !['value', 'unit', 'label', 'period'].includes(x)), [], k);
  }
  const people = (await pool.query(
    `SELECT DISTINCT p.last_name, p.first_name, p.phone FROM appointments a JOIN patients p ON p.id = a.patient_id
      WHERE a.tenant_id = $1 AND a.starts_at >= $2 AND a.starts_at < $3`, [SEED_IDS.tenant, dayStart(addDays(yesterday, -7)), dayStart(today)])).rows;
  assert.ok(people.length > 5);
  for (const p of people) {
    assert.ok(!sent.includes(`${p.last_name} ${p.first_name}`), `bemor ismi yuborildi: ${p.last_name}`);
    if (p.phone) assert.ok(!sent.includes(p.phone.slice(4)), 'telefon yuborildi');
  }
  const notes = (await pool.query(
    `SELECT n.complaints, n.diagnosis, n.examination FROM clinical_notes n JOIN encounters e ON e.id = n.encounter_id
      WHERE e.tenant_id = $1 AND e.started_at >= $2 AND e.started_at < $3`, [SEED_IDS.tenant, dayStart(addDays(yesterday, -7)), dayStart(today)])).rows;
  for (const n of notes) for (const s of [n.complaints, n.diagnosis, n.examination]) if (s && s.length > 8) assert.ok(!sent.includes(s), `klinik matn yuborildi: ${s}`);

  // opening the dashboard again reads the cache: no second model call
  const again = await manager.get(`/ai/digest?date=${yesterday}`);
  assert.equal(again.body.data.source, 'cache');
  assert.deepEqual(again.body.data.digest, d.digest);
  assert.equal(callsOf('kunlik qisqa xulosa').length, before + 1, 'keshdan: model chaqirilmadi');
  // another language is another digest
  assert.equal((await manager.put('/me/preferences', { locale: 'ru' })).status, 200);
  try {
    const ru = await manager.get(`/ai/digest?date=${yesterday}`);
    assert.equal(ru.body.data.source, 'model');
    assert.match(JSON.stringify(callsOf('kunlik qisqa xulosa').at(-1).body.system), /rus tilida/);
  } finally { await manager.put('/me/preferences', { locale: 'uz' }); }
  // the usage row carries no text
  const u = (await pool.query(`SELECT to_jsonb(u) AS j FROM ai_usage u WHERE route = 'manager_digest' ORDER BY id DESC LIMIT 1`)).rows[0].j;
  assert.equal(u.outcome, 'ok'); assert.equal(u.tenant_id, SEED_IDS.tenant);
  assert.ok(!JSON.stringify(u).includes('so‘m') && !JSON.stringify(u).includes('qabul'), 'ai_usage’da matn yo‘q');
});

test('hech bir band tekshiruvdan o‘tmasa — raqamlardan tuzilgan xulosa; xato bo‘lsa ham kun ko‘rinadi', async () => {
  claude.digest = () => ({ bullets: [{ text: 'Tushum 123 456 789 so‘m.', fact_keys: ['revenue.net'] }], alerts: [] });
  try {
    const r = await manager.get(`/ai/digest?date=${addDays(yesterday, -1)}`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.source, 'template'); assert.equal(r.body.data.dropped, 1);
    assert.ok(r.body.data.digest.bullets.length >= 3);
    assert.ok(r.body.data.digest.bullets.every((b) => !b.text.includes('123 456 789')));
  } finally { claude.digest = null; }
});

test('qayta yaratish: modelga yangi so‘rov, kuniga 5 marta; keyin 429', async () => {
  await pool.query(`DELETE FROM ai_digest_runs WHERE tenant_id = $1`, [SEED_IDS.tenant]);
  const n0 = callsOf('kunlik qisqa xulosa').length;
  for (let i = 0; i < 5; i++) {
    const r = await manager.post('/ai/digest/regenerate', { date: yesterday });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.source, 'model'); assert.equal(r.body.data.regenerations_left, 4 - i);
  }
  assert.equal(callsOf('kunlik qisqa xulosa').length, n0 + 5);
  const r = await manager.post('/ai/digest/regenerate', { date: yesterday });
  assert.equal(r.status, 429); assert.equal(r.body.error.code, 'AI_DIGEST_LIMIT');
  assert.equal(callsOf('kunlik qisqa xulosa').length, n0 + 5, 'limitdan keyin model chaqirilmadi');
  // the cached digest is the latest one and still opens
  assert.equal((await manager.get(`/ai/digest?date=${yesterday}`)).body.data.source, 'cache');
  const a = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'ai.digest' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.match(a.summary, /qayta yaratildi/);
});

test('filial qamrovi, sana va rollar: begona filial 403, kelajak sana 422, shifokor/kassir 403', async () => {
  const one = await manager.get(`/ai/digest?date=${yesterday}&branch_id=${SEED_IDS.branchCentral}`);
  assert.equal(one.status, 200, one.text);
  const P = [SEED_IDS.tenant, [SEED_IDS.branchCentral], dayStart(yesterday), dayStart(today)];
  const pay = (await pool.query(`SELECT coalesce(sum(amount),0)::bigint AS s FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4`, P)).rows[0];
  const ref = (await pool.query(`SELECT coalesce(sum(amount),0)::bigint AS s FROM refunds WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4`, P)).rows[0];
  assert.equal(one.body.data.facts['revenue.net'].value, Math.round((Number(pay.s) - Number(ref.s)) / 100), 'faqat tanlangan filial');
  assert.equal((await manager.get(`/ai/digest?branch_id=${SEED_IDS.branchTenant2}`)).status, 403);
  assert.equal((await other.get(`/ai/digest?branch_id=${SEED_IDS.branchCentral}`)).status, 403, 'boshqa klinika filiali');
  assert.equal((await manager.get(`/ai/digest?date=${addDays(today, 1)}`)).status, 422);
  assert.equal((await manager.get(`/ai/digest?date=2020-01-01`)).status, 422);
  assert.equal((await doctor.get('/ai/digest')).status, 403);
  assert.equal((await cashier.get('/ai/digest')).status, 403);
  assert.equal((await cashier.post('/ai/ask', { question: 'Kecha tushum qancha?' })).status, 403);
  assert.equal((await doctor.post('/ai/digest/regenerate', {})).status, 403);
  assert.equal((await manager.post('/ai/ask', { question: 'Kecha?', branch_id: SEED_IDS.branchTenant2 })).status, 403);
  // the other clinic's manager gets their own numbers, never this clinic's cache
  const t2 = await other.get(`/ai/digest?date=${yesterday}`);
  assert.equal(t2.status, 200, t2.text);
  assert.notDeepEqual(t2.body.data.facts, one.body.data.facts);
});

test('namunaviy va o‘chiq rejim: model chaqirilmaydi, xulosa raqamlardan, aniq belgilangan', async () => {
  const n0 = claude.calls.length;
  config.ai.mode = 'sample';
  try {
    let r = await manager.get(`/ai/digest?date=${yesterday}`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.mode, 'sample'); assert.equal(r.body.data.source, 'template');
    const b = r.body.data.digest.bullets;
    assert.ok(b.length >= 3 && b.every((x) => x.fact_keys.length > 0));
    assert.ok(b[1].text.includes(String(r.body.data.facts['visits.completed'].value)));
    assert.equal((await manager.post('/ai/digest/regenerate', { date: yesterday })).status, 503, 'namunaviyda qayta yaratish yo‘q');
    // ask: a fixed example works without a model; a free question cannot be planned
    r = await manager.post('/ai/ask', { template: 'debts_ageing' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.status, 'answered'); assert.equal(r.body.data.answer_source, 'template'); assert.equal(r.body.data.rows.length, 3);
    r = await manager.post('/ai/ask', { question: 'O‘tgan oy qaysi shifokor ko‘p ishladi?' });
    assert.equal(r.body.data.status, 'unsupported'); assert.equal(r.body.data.reason, 'ai_off');
    assert.equal(r.body.data.can_ask.length, 11);
    config.ai.mode = 'off';
    r = await manager.get(`/ai/digest?date=${yesterday}`);
    assert.equal(r.body.data.mode, 'off'); assert.equal(r.body.data.source, 'template'); assert.ok(r.body.data.reason);
  } finally { config.ai.mode = 'live'; }
  assert.equal(claude.calls.length, n0, 'hech qanday model chaqiruvi yo‘q');
});

test('savol-javob: model shablon tanlaydi, server tekshirib bajaradi; javob raqamlari jadvaldan', async () => {
  claude.plan = { template: 'visits', params: { group_by: 'doctor', from: addDays(today, -6), to: today } };
  const q = 'Oxirgi haftada qaysi shifokorda kelmaganlar ko‘p? Tel +998 90 123 45 67';
  const n0 = claude.calls.length;
  const r = await manager.post('/ai/ask', { question: q });
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.equal(d.status, 'answered'); assert.equal(d.template, 'visits');
  assert.deepEqual(d.params, { from: addDays(today, -6), to: today, group_by: 'doctor', limit: 10 });
  assert.equal(claude.calls.length, n0 + 2, 'reja + javob');
  const plan = claude.calls[n0].body;
  assert.ok(!plan.messages[0].content.includes('123 45 67') && plan.messages[0].content.includes('[telefon]'), 'savol ham tozalanadi');
  assert.ok(plan.output_config.format.schema.properties.template.enum.includes('revenue'));
  // rows = the SQL
  const sql = (await pool.query(
    `SELECT d.display_name AS label, count(*) FILTER (WHERE a.status = 'no_show')::int AS no_show, count(*) FILTER (WHERE a.status = 'completed')::int AS completed
       FROM appointments a JOIN doctors d ON d.id = a.doctor_id WHERE a.tenant_id = $1 AND a.starts_at >= $2 AND a.starts_at < $3 GROUP BY 1`,
    [SEED_IDS.tenant, dayStart(addDays(today, -6)), dayStart(addDays(today, 1))])).rows;
  assert.ok(d.rows.length > 0 && d.rows.length <= 10);
  for (const row of d.rows) {
    const s = sql.find((x) => x.label === row.label);
    assert.ok(s, row.label); assert.equal(row.no_show, s.no_show); assert.equal(row.completed, s.completed);
  }
  assert.equal(d.answer_source, 'model');
  assert.equal(d.answer[0].text, `Jadvalda ${d.rows.length} ta qator.`);
  const ans = JSON.parse(claude.calls[n0 + 1].body.messages[0].content);
  assert.equal(ans.facts['r1.no_show'].value, d.rows[0].no_show);
  // the audit keeps the template, never the question
  const a = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'ai.ask' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(a.summary, 'Shablon: visits');
  const usage = (await pool.query(`SELECT to_jsonb(u)::text AS j FROM ai_usage u WHERE route = 'manager_ask' ORDER BY id DESC LIMIT 2`)).rows;
  assert.equal(usage.length, 2);
  for (const u of usage) assert.ok(!u.j.includes('shifokor') && !u.j.includes('kelmagan'), 'ai_usage’da savol matni yo‘q');
});

test('savol-javob: pul summasi so‘mda, jami server hisoblaydi; to‘qilgan raqamli javob tashlanadi', async () => {
  claude.plan = { template: 'revenue', params: { group_by: 'method', from: yesterday, to: yesterday } };
  claude.answer = (f) => ({ sentences: [
    { text: `Jami ${fmt(f['total.revenue'].value)} so‘m.`, fact_keys: ['total.revenue'] },
    { text: 'Naqd pul 77 777 777 so‘m.', fact_keys: ['r1.revenue'] },
  ] });
  try {
    const r = await manager.post('/ai/ask', { question: 'Kecha to‘lov usullari bo‘yicha tushum?' });
    assert.equal(r.status, 200, r.text);
    const d = r.body.data;
    assert.equal(d.dropped, 1); assert.equal(d.answer.length, 1);
    const total = d.rows.reduce((a, x) => a + x.revenue, 0);
    const P = [SEED_IDS.tenant, [SEED_IDS.branchCentral, SEED_IDS.branchYunusobod], dayStart(yesterday), dayStart(today)];
    const pay = (await pool.query(`SELECT coalesce(sum(amount),0)::bigint AS s FROM payments WHERE tenant_id = $1 AND branch_id = ANY($2) AND paid_at >= $3 AND paid_at < $4`, P)).rows[0];
    const ref = (await pool.query(`SELECT coalesce(sum(amount),0)::bigint AS s FROM refunds WHERE tenant_id = $1 AND branch_id = ANY($2) AND refunded_at >= $3 AND refunded_at < $4`, P)).rows[0];
    assert.equal(total, Number(pay.s) - Number(ref.s), 'usullar yig‘indisi = sof tushum (tiyin)');
    assert.ok(d.rows.every((x) => ['Naqd', 'Karta', 'O‘tkazma'].includes(x.label)));
    // every sentence wrong → the template answer
    claude.answer = () => ({ sentences: [{ text: 'Tushum 5 mlrd so‘m.', fact_keys: ['total.revenue'] }] });
    const r2 = await manager.post('/ai/ask', { question: 'Kecha to‘lov usullari bo‘yicha tushum?' });
    assert.equal(r2.body.data.answer_source, 'template');
    assert.match(r2.body.data.answer[0].text, /Tushum/);
  } finally { claude.answer = null; }
});

test('savol-javob: ro‘yxatda yo‘q shablon, chegaradan tashqari parametr, mos kelmaydigan savol — rad etiladi, SQL bajarilmaydi', async () => {
  const ask = async (plan) => {
    claude.plan = plan;
    const n0 = claude.calls.length;
    const r = await manager.post('/ai/ask', { question: 'Shunchaki savol' });
    assert.equal(r.status, 200, r.text);
    assert.equal(claude.calls.length, n0 + 1, 'faqat reja chaqirildi, javob chaqirilmadi');
    assert.equal(r.body.data.rows, undefined);
    return r.body.data;
  };
  let d = await ask({ template: 'raw_sql', params: {} });
  assert.equal(d.status, 'unsupported'); assert.equal(d.reason, 'template');
  d = await ask({ template: 'constructor', params: {} });
  assert.equal(d.reason, 'template', 'prototip nomlari ham shablon emas');
  for (const params of [
    { from: '2024-01-01', to: today },                   // > 1 year
    { from: today, to: addDays(today, 3) },               // future
    { from: today, to: addDays(today, -3) },              // reversed
    { group_by: 'patient' },                              // not a grouping of this template
    { group_by: 'doctor', limit: 50 },                    // limit > 20
    { group_by: 'day', from: addDays(today, -60), to: today }, // day table > 31 days
    { branch_id: SEED_IDS.branchTenant2 },                // another clinic's branch
    { sql: 'SELECT * FROM patients' },                    // unknown parameter
  ]) {
    d = await ask({ template: 'revenue', params });
    assert.equal(d.status, 'unsupported', JSON.stringify(params)); assert.equal(d.reason, 'params', JSON.stringify(params));
  }
  d = await ask({ template: 'unsupported', params: {} });
  assert.equal(d.reason, 'question');
  assert.match(d.message, /so‘ray olmayman/);
  assert.deepEqual(d.can_ask.map((x) => x.id).sort(), ['debts_ageing', 'expenses', 'new_vs_returning', 'patient_flow', 'refunds', 'revenue', 'staff_lateness', 'stock', 'top_services', 'visits', 'warehouse_consumption']);
  // a fixed example with bad params is refused the same way (no model involved)
  const r = await manager.post('/ai/ask', { template: 'stock', params: { kind: 'expiring', days: 999 } });
  assert.equal(r.body.data.reason, 'params');
});

test('savol-javob: har bir shablon ishlaydi (tayyor misol, AI’siz), bemor ma’lumoti qaytmaydi', async () => {
  config.ai.mode = 'sample';
  try {
    const cases = [
      ['revenue', { group_by: 'day', from: addDays(today, -6), to: today }], ['revenue', { group_by: 'month', from: addDays(today, -90), to: today }],
      ['revenue', { group_by: 'branch' }], ['revenue', { group_by: 'doctor' }], ['revenue', { group_by: 'service', limit: 3 }],
      ['visits', { group_by: 'day', from: addDays(today, -6), to: today }], ['top_services', {}], ['debts_ageing', {}],
      ['refunds', { group_by: 'reason' }], ['refunds', { group_by: 'day', from: addDays(today, -6), to: today }], ['expenses', {}],
      ['warehouse_consumption', { group_by: 'item' }], ['warehouse_consumption', { group_by: 'doctor' }], ['warehouse_consumption', { group_by: 'icd_group' }],
      ['stock', { kind: 'low' }], ['stock', { kind: 'expiring', days: 90 }], ['staff_lateness', {}], ['patient_flow', {}], ['new_vs_returning', {}],
    ];
    const names = (await pool.query(`SELECT last_name || ' ' || first_name AS n FROM patients WHERE tenant_id = $1 LIMIT 200`, [SEED_IDS.tenant])).rows.map((x) => x.n);
    for (const [template, params] of cases) {
      const r = await manager.post('/ai/ask', { template, params });
      assert.equal(r.status, 200, `${template}: ${r.text}`);
      assert.equal(r.body.data.status, 'answered', `${template} ${JSON.stringify(params)}: ${JSON.stringify(r.body.data)}`);
      assert.ok(r.body.data.rows.length <= 31);
      const s = JSON.stringify(r.body.data.rows);
      assert.ok(!names.some((n) => s.includes(n)), `${template}: bemor ismi`);
    }
    const icd = (await manager.post('/ai/ask', { template: 'warehouse_consumption', params: { group_by: 'icd_group' } })).body.data.rows;
    assert.ok(icd.every((x) => x.label === '—' || /^[A-Z]\d{2}$/.test(x.label)), JSON.stringify(icd));
    const nvr = (await manager.post('/ai/ask', { template: 'new_vs_returning', params: {} })).body.data.rows;
    assert.equal(nvr.length, 2);
  } finally { config.ai.mode = 'live'; }
});

test('provayder: Gemini bepul tarifi faqat seed klinikada; production’da klinik ruxsatsiz ham ishlaydi (klinik matn yo‘q)', async () => {
  const gem = { calls: [] };
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const ch of req) raw += ch;
    const body = JSON.parse(raw || '{}');
    gem.calls.push(body);
    const { facts: f } = JSON.parse(body.contents[0].parts[0].text);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(defaultDigest(f)) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 80 }, modelVersion: 'gemini-3.8-flash' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const saved = { ...config.ai }, savedMode = config.mode, savedAllowed = config.ai.clinicalInProduction;
  Object.assign(config.ai, { provider: 'gemini', apiKey: 'gem-key', model: 'gemini-3.8-flash', baseUrl: `http://127.0.0.1:${server.address().port}`, geminiPaid: false });
  await pool.query(`DELETE FROM ai_digest_runs WHERE tenant_id = $1`, [SEED_IDS.tenant]);
  try {
    let r = await manager.post('/ai/digest/regenerate', { date: yesterday });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.mode, 'live'); assert.equal(gem.calls.length, 1, 'seed klinika: bepul tarif mumkin');
    assert.match(gem.calls[0].systemInstruction.parts[0].text, /kunlik qisqa xulosa/);
    // production: a real clinic's numbers never go to the free tier
    config.mode = 'production'; config.ai.clinicalInProduction = false;
    r = await manager.get(`/ai/digest?date=${addDays(yesterday, -2)}`);
    assert.equal(r.body.data.mode, 'off'); assert.equal(r.body.data.source, 'template');
    assert.equal(gem.calls.length, 1, 'Gemini’ga yuborilmadi');
    // a paid provider in production: allowed without AI_CLINICAL_ALLOWED (no clinical text in these routes)
    Object.assign(config.ai, saved); config.ai.clinicalInProduction = false;
    const n0 = callsOf('kunlik qisqa xulosa').length;
    r = await manager.get(`/ai/digest?date=${addDays(yesterday, -3)}`);
    assert.equal(r.body.data.mode, 'live'); assert.equal(callsOf('kunlik qisqa xulosa').length, n0 + 1);
  } finally {
    Object.assign(config.ai, saved); config.mode = savedMode; config.ai.clinicalInProduction = savedAllowed;
    server.close();
  }
});

test('MKB guruhi bo‘yicha sarf — jadval faqat serverda, modelga yuborilmaydi (jamlangan bo‘lsa ham tashxis ma’lumoti)', async () => {
  const before = claude.calls.length;
  const r = await manager.post('/ai/ask', { template: 'warehouse_consumption', params: { group_by: 'icd_group' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.status, 'answered');
  assert.equal(r.body.data.answer_source, 'template');
  assert.equal(claude.calls.length, before, 'MKB jadvali bilan model chaqirilmadi');
});
