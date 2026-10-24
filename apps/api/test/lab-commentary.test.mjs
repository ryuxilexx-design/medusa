// «Natija sharhi» (docs/AI.md) against a fake Claude server (no real model, no key): only verified results, only
// doctors of the patient (lab/registrar/manager 403, another tenant 404), the server's facts (previous value, change),
// the prompt carries no patient identity, invented numbers and diagnosis/treatment sentences are dropped, critical
// values come first from the server, the production guard and sample mode give the template without a model call.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool, config, labFacts;

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
const claude = { calls: [], server: null, url: '', answer: null };
const msg = (obj) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 700, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
const DEFAULT_ANSWER = {
  sentences: [
    { text: 'Gemoglobin 172 g/L — me’yordan yuqori (me’yor 120–160).', fact_keys: ['HGB.value', 'HGB.ref_low', 'HGB.ref_high'] },
    { text: 'Gemoglobin oldingi tahlilga nisbatan 22 g/L ga (15%) oshgan.', fact_keys: ['HGB.change', 'HGB.change_pct'] },
    { text: 'Gemoglobin 180 g/L ga yetgan.', fact_keys: ['HGB.value'] },                       // invented number → dropped
    { text: 'Bu anemiya belgisi bo‘lishi mumkin.', fact_keys: [] },                              // diagnosis → dropped
    { text: 'Temir preparatini buyurish kerak.', fact_keys: [] },                               // treatment → dropped
    { text: 'Leykotsitlar 35 ×10⁹/L.', fact_keys: ['WBC.value_invented'] },                     // unknown fact → dropped
  ],
};
function startClaude() {
  return new Promise((resolve) => {
    claude.server = http.createServer(async (req, res) => {
      let raw = ''; for await (const ch of req) raw += ch;
      const body = raw ? JSON.parse(raw) : {};
      claude.calls.push({ url: req.url, body, raw });
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(msg(claude.answer ?? DEFAULT_ANSWER)));
    }).listen(0, '127.0.0.1', () => { claude.url = `http://127.0.0.1:${claude.server.address().port}`; resolve(); });
  });
}
const labCalls = () => claude.calls.filter((c) => JSON.stringify(c.body.system).includes('laboratoriya natijasi'));

let doctor, otherDoctor, lab, registrar, manager, t2, patient, current, previous, draft, foreign;
const HGB_TPL = { HGB: 'Gemoglobin', RBC: 'Eritrotsitlar', WBC: 'Leykotsitlar', PLT: 'Trombotsitlar', ESR: 'EChT' };
const values = (tpl, v) => tpl.map((p) => ({ code: p.code, name: p.name, unit: p.unit, ref_low: p.ref_low, ref_high: p.ref_high, value: String(v[p.code]),
  flag: v[p.code] < p.ref_low ? 'low' : v[p.code] > p.ref_high ? 'high' : 'normal' }));
async function insertOrder({ tenant, branch, patientId, service, status, verifiedDaysAgo, vals }) {
  const id = (await pool.query(
    `INSERT INTO service_orders (id, tenant_id, branch_id, patient_id, service_id, category, service_name, price_snapshot, status, ordered_at, performed_at)
     VALUES (gen_random_uuid(), $1,$2,$3,$4,'lab',$5,6000000,$6, demo_now() - make_interval(days => $7) - interval '2 hours', CASE WHEN $6 = 'verified' THEN demo_now() - make_interval(days => $7) END) RETURNING id`,
    [tenant, branch, patientId, service.id, service.name, status, verifiedDaysAgo])).rows[0].id;
  await pool.query(
    `INSERT INTO lab_results (tenant_id, order_id, values, status, collected_at, collected_by_name, entered_at, entered_by_name, verified_at, verified_by_name)
     VALUES ($1,$2,$3,$4, demo_now() - make_interval(days => $5) - interval '1 hour', 'Test Lab', demo_now() - make_interval(days => $5) - interval '30 minutes', 'Test Lab',
             CASE WHEN $4 = 'verified' THEN demo_now() - make_interval(days => $5) END, CASE WHEN $4 = 'verified' THEN 'Test Lab' END)`,
    [tenant, id, JSON.stringify(vals), status === 'verified' ? 'verified' : 'draft', verifiedDaysAgo]);
  return id;
}

before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  config = require('../dist/core/config.js').config;
  labFacts = require('../dist/ai/lab-facts.js');
  await startClaude();
  config.ai.mode = 'live'; config.ai.provider = 'anthropic'; config.ai.apiKey = 'test-key'; config.ai.baseUrl = claude.url; config.ai.model = 'claude-opus-5-5';
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  doctor = session(); await doctor.demo(M.doctor(0));
  lab = session(); await lab.demo(M.lab);
  registrar = session(); await registrar.demo(M.registrar);
  t2 = session(); await t2.demo(M.tenant2Manager);

  const docId = (await pool.query(`SELECT id FROM doctors WHERE membership_id = $1`, [M.doctor(0)])).rows[0].id;
  // a patient of this doctor with no verified results of their own yet (the seed follows some patients for months)
  const a = (await pool.query(`SELECT a.patient_id, a.branch_id FROM appointments a WHERE a.doctor_id = $1
      AND NOT EXISTS (SELECT 1 FROM service_orders o WHERE o.patient_id = a.patient_id AND o.category = 'lab' AND o.status = 'verified') ORDER BY a.starts_at LIMIT 1`, [docId])).rows[0];
  patient = (await pool.query(`SELECT id, last_name, first_name, middle_name, patient_number, phone, to_char(birth_date, 'YYYY-MM-DD') AS birth FROM patients WHERE id = $1`, [a.patient_id])).rows[0];
  // a doctor who never saw this patient
  for (let i = 1; i < 8; i++) {
    const d = (await pool.query(`SELECT d.id FROM doctors d WHERE d.membership_id = $1`, [M.doctor(i)])).rows[0];
    if (!d) continue;
    const seen = (await pool.query(`SELECT 1 FROM appointments WHERE doctor_id = $1 AND patient_id = $2`, [d.id, patient.id])).rowCount;
    if (!seen) { otherDoctor = session(); await otherDoctor.demo(M.doctor(i)); break; }
  }
  assert.ok(otherDoctor, 'bemorni ko‘rmagan shifokor bor');
  const svc = (await pool.query(`SELECT id, name, lab_template FROM services WHERE tenant_id = $1 AND code = 'L01'`, [SEED_IDS.tenant])).rows[0];
  const tpl = svc.lab_template;
  assert.deepEqual(tpl.map((p) => p.code), Object.keys(HGB_TPL));
  previous = await insertOrder({ tenant: SEED_IDS.tenant, branch: a.branch_id, patientId: patient.id, service: svc, status: 'verified', verifiedDaysAgo: 40,
    vals: values(tpl, { HGB: 150, RBC: 4.4, WBC: 8.0, PLT: 260, ESR: 10 }) });
  current = await insertOrder({ tenant: SEED_IDS.tenant, branch: a.branch_id, patientId: patient.id, service: svc, status: 'verified', verifiedDaysAgo: 1,
    vals: values(tpl, { HGB: 172, RBC: 4.5, WBC: 35, PLT: 250, ESR: 10 }) });
  draft = await insertOrder({ tenant: SEED_IDS.tenant, branch: a.branch_id, patientId: patient.id, service: svc, status: 'draft_result', verifiedDaysAgo: 0,
    vals: values(tpl, { HGB: 140, RBC: 4.5, WBC: 6, PLT: 250, ESR: 10 }) });
  // another clinic's verified order (its own lab service)
  const t2svc = (await pool.query(`INSERT INTO services (id, tenant_id, code, name, category, duration_min, lab_template) VALUES (gen_random_uuid(), $1, 'LT2', 'Test tahlil', 'lab', 10, $2)
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id, name`, [SEED_IDS.tenant2, JSON.stringify(tpl)])).rows[0];
  const t2patient = (await pool.query(`SELECT id FROM patients WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant2])).rows[0].id;
  foreign = await insertOrder({ tenant: SEED_IDS.tenant2, branch: SEED_IDS.branchTenant2, patientId: t2patient, service: t2svc, status: 'verified', verifiedDaysAgo: 1,
    vals: values(tpl, { HGB: 150, RBC: 4.4, WBC: 8.0, PLT: 260, ESR: 10 }) });
});
after(async () => { await app?.close(); claude.server?.close(); });

test('faqat shifokor: laborant / registrator / rahbar 403; bemorni ko‘rmagan shifokor 403; boshqa klinika va noma’lum id 404; tasdiqlanmagan 409', async () => {
  for (const s of [lab, registrar, manager, t2]) assert.equal((await s.post(`/orders/${current}/commentary`)).status, 403);
  assert.equal((await otherDoctor.post(`/orders/${current}/commentary`)).status, 403);
  assert.equal((await doctor.post(`/orders/${foreign}/commentary`)).status, 404, 'boshqa klinika buyurtmasi');
  assert.equal((await doctor.post(`/orders/00000000-0000-4000-8000-000000000000/commentary`)).status, 404);
  assert.equal((await doctor.post(`/orders/abc/commentary`)).status, 404);
  const d = await doctor.post(`/orders/${draft}/commentary`);
  assert.equal(d.status, 409); assert.equal(d.body.error.code, 'NOT_VERIFIED');
  assert.equal(labCalls().length, 0, 'rad etilganda model chaqirilmaydi');
});

test('faktlar: oldingi qiymat, farq va foiz; kritik qiymat; yosh guruhi', async () => {
  const o = (await pool.query(`SELECT o.id, o.tenant_id, o.patient_id, o.service_name, p.sex, p.birth_date, lr.values, lr.verified_at, s.lab_template
      FROM service_orders o JOIN patients p ON p.id = o.patient_id JOIN services s ON s.id = o.service_id JOIN lab_results lr ON lr.order_id = o.id WHERE o.id = $1`, [current])).rows[0];
  const { Db } = require('../dist/core/db.js');
  const f = await labFacts.buildLabFacts(app.get(Db), o);
  const hgb = f.params.find((p) => p.code === 'HGB');
  assert.equal(hgb.flag, 'high'); assert.equal(hgb.critical, null);
  assert.equal(hgb.previous.length, 1); assert.equal(hgb.previous[0].value, 150); assert.equal(hgb.previous[0].days_before, 39);
  assert.equal(hgb.change, 22); assert.equal(hgb.change_pct, 15);
  const rbc = f.params.find((p) => p.code === 'RBC');
  assert.equal(rbc.change, 0.1, 'kasr farq suzuvchi nuqta xatosisiz'); assert.equal(rbc.change_pct, 2);
  const wbc = f.params.find((p) => p.code === 'WBC');
  assert.equal(wbc.critical, 'high'); assert.equal(wbc.crit_high, 30);
  assert.equal(f.facts['count.critical'].value, 1); assert.equal(f.facts['count.out_of_range'].value, 2);
  assert.match(f.age_band, /^(\d+–\d+|80\+|0)$/);
  assert.equal(labFacts.ageBand('1980-06-15', '2026-10-18'), '40–49');
  assert.equal(labFacts.ageBand('2020-01-01', '2026-10-18'), '5–11');
  // the number check
  assert.ok(labFacts.labNumbersMatch('Gemoglobin 172 g/L', [172], f));
  assert.ok(labFacts.labNumbersMatch('Eritrotsitlar 4,5 ×10¹²/L, 0,1 ga oshgan', [4.5, 0.1], f), 'birlikdagi 10 raqam hisoblanmaydi');
  assert.ok(!labFacts.labNumbersMatch('Gemoglobin 173 g/L', [172], f));
  assert.ok(labFacts.hasForbidden('Это может указывать на анемию'));
  assert.ok(labFacts.hasForbidden('Назначить препарат железа'));
  assert.ok(!labFacts.hasForbidden('Gemoglobin oldingi tahlilga nisbatan oshgan'));
});

test('jonli sharh: kritik qiymat birinchi (serverdan); to‘qilgan raqam, tashxis va dori gaplari tashlanadi; promptda bemor ismi yo‘q; kesh', async () => {
  const usageBefore = (await pool.query(`SELECT count(*)::int AS n FROM ai_usage WHERE route = 'lab_commentary'`)).rows[0].n;
  const r = await doctor.post(`/orders/${current}/commentary`);
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.equal(d.mode, 'live'); assert.equal(d.source, 'model'); assert.equal(d.cached, false);
  assert.equal(d.critical.length, 1); assert.equal(d.critical[0].code, 'WBC');
  assert.match(d.critical[0].text, /^KRITIK: Leykotsitlar 35/);
  assert.equal(d.sentences.length, 2); assert.equal(d.dropped, 4);
  assert.ok(d.sentences.every((s) => !/180|anemiya|preparat/.test(s.text)));
  const hgb = d.params.find((p) => p.code === 'HGB');
  assert.deepEqual(hgb.previous.map((p) => p.value), ['150']); assert.equal(hgb.change, 22); assert.equal(hgb.change_pct, 15);
  assert.equal(labCalls().length, 1);
  const raw = labCalls()[0].raw;
  for (const s of [patient.last_name, patient.first_name, patient.middle_name, patient.phone, patient.birth, `#${patient.patient_number}`].filter(Boolean)) assert.ok(!raw.includes(s), `promptda: ${s}`);
  const user = labCalls()[0].body.messages[0].content;
  assert.ok(user.includes('"age_band"') && user.includes('"HGB.prev1"'));
  // one usage row (tokens only), an audit line without values
  const usage = (await pool.query(`SELECT * FROM ai_usage WHERE route = 'lab_commentary' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ai_usage WHERE route = 'lab_commentary'`)).rows[0].n, usageBefore + 1);
  assert.ok(!JSON.stringify(usage).includes('172'));
  const au = (await pool.query(`SELECT summary FROM audit_logs WHERE action = 'ai.lab_commentary' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.ok(!/172|35|Gemoglobin/.test(au.summary));
  // the same order again: from memory, no second call
  const again = await doctor.post(`/orders/${current}/commentary`);
  assert.equal(again.body.data.cached, true); assert.equal(labCalls().length, 1);
});

test('model hech narsa o‘tkazmasa — shablon; kritik baribir birinchi', async () => {
  require('../dist/modules/lab-commentary.controller.js').clearLabCommentaryCache();
  claude.answer = { sentences: [{ text: 'Gemoglobin 999 g/L.', fact_keys: ['HGB.value'] }] };
  try {
    const d = (await doctor.post(`/orders/${current}/commentary`)).body.data;
    assert.equal(d.source, 'template'); assert.equal(d.dropped, 1);
    assert.equal(d.critical[0].code, 'WBC');
    assert.ok(d.sentences.some((s) => s.text.includes('Gemoglobin: 172 g/L')));
    assert.ok(d.sentences.some((s) => s.text.includes('39 kun oldin 150')));
  } finally { claude.answer = null; }
});

test('production himoyasi: AI_CLINICAL_ALLOWED bo‘lmasa model chaqirilmaydi, shablon + sabab; namunaviy rejimda ham shablon', async () => {
  require('../dist/modules/lab-commentary.controller.js').clearLabCommentaryCache();
  const savedMode = config.mode, savedAllowed = config.ai.clinicalInProduction, calls = labCalls().length;
  config.mode = 'production'; config.ai.clinicalInProduction = false;
  try {
    const d = (await doctor.post(`/orders/${current}/commentary`)).body.data;
    assert.equal(d.mode, 'off'); assert.equal(d.source, 'template'); assert.ok(d.reason);
    assert.equal(d.critical[0].code, 'WBC');
    assert.equal(labCalls().length, calls, 'production’da model chaqirilmadi');
  } finally { config.mode = savedMode; config.ai.clinicalInProduction = savedAllowed; }
  config.ai.mode = 'sample';
  try {
    const d = (await doctor.post(`/orders/${current}/commentary`)).body.data;
    assert.equal(d.mode, 'sample'); assert.equal(d.source, 'template'); assert.equal(d.reason, null);
    assert.equal(labCalls().length, calls);
  } finally { config.ai.mode = 'live'; }
  // the Gemini free tier never gets a real clinic's values; the demo tenant may (non-production) — covered by clinicalBlock
  const ai = app.get(require('../dist/ai/ai-client.js').AiClient);
  assert.ok(!require('../dist/ai/ai-client.js').PUBLIC_ROUTES.has('lab_commentary'), 'klinik marshrut');
  config.mode = 'production'; config.ai.clinicalInProduction = false;
  try { await assert.rejects(ai.json({ route: 'lab_commentary', system: 's', user: 'u', schema: {}, validate: { safeParse: () => ({ success: true, data: {} }) }, effort: 'low', tenantId: SEED_IDS.tenant, membershipId: null }), (e) => e.code === 'AI_DISABLED_PRODUCTION'); }
  finally { config.mode = savedMode; config.ai.clinicalInProduction = savedAllowed; }
});

test('uz-Cyrl / ru: server matni shaxs tilida', async () => {
  require('../dist/modules/lab-commentary.controller.js').clearLabCommentaryCache();
  config.ai.mode = 'sample';
  try {
    assert.equal((await doctor.put('/me/preferences', { locale: 'ru' })).status, 200);
    const d = (await doctor.post(`/orders/${current}/commentary`)).body.data;
    assert.match(d.critical[0].text, /^КРИТИЧНО: Leykotsitlar 35/, 'parametr nomi o‘girilmaydi');
  } finally { config.ai.mode = 'live'; await doctor.put('/me/preferences', { locale: 'uz' }); }
});
