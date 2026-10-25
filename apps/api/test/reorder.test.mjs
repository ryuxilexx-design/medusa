// «Buyurtma taklifi» (docs/WAREHOUSE.md): the reorder math against a ledger written here (consumption over 30/90 days
// = issues − returns, voided rows / write-offs / old rows excluded; days left; FEFO projection of lots that expire
// unused; the suggested quantity rounded to packs), roles (storekeeper/manager only), branch scope, the CSV bounds,
// and the AI brief (business route, fake Claude): every number must be a cited fact.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
const BC = SEED_IDS.branchCentral, BY = SEED_IDS.branchYunusobod;
let app, base, pool, config, reorder;

function session() {
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t, type: r.headers.get('content-type') };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}) => req('POST', p, b), patch: (p, b) => req('PATCH', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}

// ---------- fake Claude ----------
const claude = { calls: [], server: null, url: '', answer: null };
const msg = (obj) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 600, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
function startClaude() {
  return new Promise((resolve) => {
    claude.server = http.createServer(async (req, res) => {
      let raw = ''; for await (const ch of req) raw += ch;
      const body = raw ? JSON.parse(raw) : {};
      claude.calls.push({ body });
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(msg(claude.answer(JSON.parse(body.messages[0].content)))));
    }).listen(0, '127.0.0.1', () => { claude.url = `http://127.0.0.1:${claude.server.address().port}`; resolve(); });
  });
}

let keeper, manager, doctor, registrar, cashier, lab, t2, X, Y, today;
const NAME_X = 'Reorder test: shprits 10 ml', NAME_Y = 'Reorder test: kateter';
const at = (daysAgo) => `(date_trunc('day', (SELECT demo_now()) AT TIME ZONE 'Asia/Tashkent') - make_interval(days => ${daysAgo}) + interval '10 hours') AT TIME ZONE 'Asia/Tashkent'`;
async function batch(item, qty, expiryDays) {
  return (await pool.query(`INSERT INTO inventory_batches (id, tenant_id, item_id, batch_no, expiry_date, qty, received_qty, unit_cost, received_at)
      VALUES (gen_random_uuid(), $1, $2, 'RT', CASE WHEN $4::int IS NULL THEN NULL ELSE ((SELECT demo_now()) AT TIME ZONE 'Asia/Tashkent')::date + $4::int END, $3, $3, 150000, (SELECT demo_now())) RETURNING id`,
    [SEED_IDS.tenant, item, qty, expiryDays])).rows[0].id;
}
async function move(item, batchId, kind, qty, daysAgo, extra = '') {
  const type = kind === 'return' ? 'in' : 'out';
  const who = kind === 'issue' || kind === 'return';
  await pool.query(`INSERT INTO inventory_movements (id, tenant_id, item_id, type, quantity, reason, actor_name, occurred_at, kind, batch_id, branch_id,
      receiver_membership_id, receiver_name, purpose, department, unit_cost, value ${extra ? ', voided_at, voided_by_name, void_reason' : ''})
    VALUES (gen_random_uuid(), $1, $2, $3, $4::numeric, 'test', 'Test', ${at(daysAgo)}, $5, $6, $7, $8, $9, $10, $11, 150000, round($4::numeric * 150000) ${extra ? `, ${at(daysAgo - 1)}, 'Test', 'xato'` : ''})`,
    [SEED_IDS.tenant, item, type, qty, kind, batchId, BC, who ? M.storekeeper : null, who ? 'Sherzod Qodirov' : null, who ? 'department' : null, who ? 'Muolaja xonasi' : null]);
}

before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  config = require('../dist/core/config.js').config;
  reorder = require('../dist/modules/reorder.js');
  await startClaude();
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  keeper = session(); await keeper.demo(M.storekeeper);
  doctor = session(); await doctor.demo(M.doctor(0));
  registrar = session(); await registrar.demo(M.registrar);
  cashier = session(); await cashier.demo(M.cashier);
  lab = session(); await lab.demo(M.lab);
  t2 = session(); await t2.demo(M.tenant2Manager);
  today = (await keeper.get('/me')).body.data.today;
  // item X: 12 per pack, minimum 10, price 1 500 so‘m; item Y: no pack size, consumed only 50 days ago, nothing in stock
  const cx = await keeper.post('/inventory', { name: NAME_X, unit: 'dona', branch_id: BC, minimum_qty: 10, pack_size: 12, purchase_price: 150000 });
  assert.equal(cx.status, 201, cx.text); X = cx.body.data.id;
  const cy = await keeper.post('/inventory', { name: NAME_Y, unit: 'dona', branch_id: BC, minimum_qty: 0, purchase_price: 150000 });
  assert.equal(cy.status, 201, cy.text); Y = cy.body.data.id;
  const b1 = await batch(X, 30, 10);    // expires in 10 days: only 19.80 can be used by then
  const b2 = await batch(X, 50, 200);
  await batch(X, 5, -3);                // already expired: not usable, not «expiring»
  for (const d of [5, 15, 25]) await move(X, b2, 'issue', 20, d);   // 60 in 30 days
  await move(X, b2, 'return', 6, 4);                                 // −6 → 54
  await move(X, b2, 'issue', 36, 60);                                // 90 days: 90
  await move(X, b2, 'issue', 100, 2, 'voided');                      // voided: not consumption
  await move(X, b1, 'writeoff', 7, 3);                               // write-off: not consumption
  await move(X, b2, 'issue', 500, 95);                               // older than 90 days
  const by = await batch(Y, 1, 100);
  await move(Y, by, 'issue', 9, 50);
  await pool.query(`UPDATE inventory_batches SET qty = 0 WHERE id = $1`, [by]);
});
after(async () => { await app?.close(); claude.server?.close(); });

const rowOf = (data, id) => data.rows.find((r) => r.item_id === id);

test('hisob: sarf (30/90 kun), necha kunga yetadi, ishlatilmay o‘tadigan miqdor (FEFO), buyurtma — qadoqqa yaxlitlangan', async () => {
  const r = await keeper.get('/warehouse/reorder');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.horizon, 30); assert.equal(r.body.data.today, today);
  const x = rowOf(r.body.data, X);
  assert.equal(x.stock, '85.00'); assert.equal(x.usable, '80.00');
  assert.equal(x.consumed_30, '54.00', 'chiqim − qaytarish; bekor qilingan va hisobdan chiqarilgan kirmaydi');
  assert.equal(x.consumed_90, '90.00');
  assert.equal(x.daily_rate, '1.80'); assert.equal(x.rate_basis, 30);
  assert.equal(x.expiring_30, '30.00'); assert.equal(x.expiring_unusable, '10.20', '30 − 1.8 × 11 kun');
  assert.equal(x.days_left, 38, '(80 − 10.2) / 1.8');
  assert.equal(x.suggested, '0.00'); assert.equal(x.status, 'ok');
  assert.equal(x.pack_size, '12.00');
  const y = rowOf(r.body.data, Y);
  assert.equal(y.consumed_30, '0.00'); assert.equal(y.consumed_90, '9.00'); assert.equal(y.rate_basis, 90); assert.equal(y.daily_rate, '0.10');
  assert.equal(y.status, 'out'); assert.equal(y.days_left, 0);
  assert.equal(y.suggested, '3.00', '0.1 × 30 kun, qadoq noma’lum — butun birlik'); assert.equal(y.packs, null);
  assert.ok(r.body.data.rows.indexOf(y) < r.body.data.rows.indexOf(x), 'tugagan birinchi');

  const h60 = rowOf((await keeper.get('/warehouse/reorder?horizon=60')).body.data, X);
  // 1.8 × 60 + 10 − 69.8 = 48.2 → 5 packs of 12
  assert.equal(h60.suggested, '60.00'); assert.equal(h60.packs, 5); assert.equal(h60.status, 'order');
  assert.equal(h60.est_cost, 60 * 150000, 'butun tiyin');
  const only = (await keeper.get('/warehouse/reorder?horizon=60&only=order')).body.data.rows;
  assert.ok(only.every((r) => Number(r.suggested) > 0) && only.some((r) => r.item_id === X));
});

test('FEFO proyeksiyasi va yaxlitlash: sof funksiyalar', () => {
  const T = '2026-10-18';
  // 2 per day: lot A (10, expires in 2 days → 6 usable) wastes 4; lot B (10, in 20 days) fully used
  assert.deepEqual(reorder.fefoWaste([{ qtyC: 1000, expiry: '2026-10-20' }, { qtyC: 1000, expiry: '2026-11-07' }], T, 200), { expiringC: 2000, wasteC: 400 });
  assert.deepEqual(reorder.fefoWaste([{ qtyC: 500, expiry: '2026-10-10' }, { qtyC: 500, expiry: null }], T, 100), { expiringC: 0, wasteC: 0 }, 'muddati o‘tgan va muddatsiz');
  assert.deepEqual(reorder.fefoWaste([{ qtyC: 500, expiry: '2026-10-25' }], T, 0), { expiringC: 500, wasteC: 500 }, 'sarf yo‘q — hammasi isrof');
  assert.deepEqual(reorder.roundUp(4820, 1200), { qtyC: 6000, packs: 5 });
  assert.deepEqual(reorder.roundUp(250, null), { qtyC: 300, packs: null });
  assert.deepEqual(reorder.roundUp(-5, 1200), { qtyC: 0, packs: 0 });
});

test('kim ko‘radi: omborchi va rahbar; shifokor / registrator / kassir / laborant 403; filial doirasi; boshqa klinika', async () => {
  assert.equal((await manager.get('/warehouse/reorder')).status, 200);
  for (const s of [doctor, registrar, cashier, lab]) {
    assert.equal((await s.get('/warehouse/reorder')).status, 403);
    assert.equal((await s.get(`/warehouse/reorder.csv?horizon=30`)).status, 403);
    assert.equal((await s.post('/warehouse/reorder/brief', {})).status, 403);
  }
  const by = (await keeper.get(`/warehouse/reorder?branch_id=${BY}`)).body.data.rows;
  assert.ok(by.length > 0 && by.every((r) => r.branch_id === BY) && !rowOf({ rows: by }, X));
  const other = await t2.get('/warehouse/reorder');
  assert.equal(other.status, 200);
  assert.ok(!other.body.data.rows.some((r) => r.item_id === X), 'boshqa klinika materiali ko‘rinmaydi');
  assert.equal((await t2.get(`/warehouse/reorder?branch_id=${BC}`)).status, 403);
  assert.equal((await t2.post('/warehouse/reorder/brief', { branch_id: BC })).status, 403);
});

test('CSV: davr 7–180 kun; faqat buyurtma qatorlari; formula-xavfsiz; chegaralar', async () => {
  for (const h of ['5', '181', 'abc', '30.5']) assert.equal((await keeper.get(`/warehouse/reorder.csv?horizon=${h}`)).status, 422, h);
  assert.equal((await keeper.get('/warehouse/reorder?horizon=0')).status, 422);
  const r = await keeper.get('/warehouse/reorder.csv?horizon=60');
  assert.equal(r.status, 200); assert.match(r.type, /text\/csv/);
  const lines = r.text.replace(/^﻿/, '').split('\r\n');
  assert.match(lines[0], /^"Material";"Birlik";"Filial"/);
  const x = lines.find((l) => l.includes(NAME_X));
  assert.ok(x && x.includes('"60.00"') && x.includes('"5"') && x.includes('"90000.00"'), x);
  const body = lines.slice(1, -1);
  assert.ok(body.every((l) => l.split(';')[11] !== '"0.00"'), 'nol buyurtma eksport qilinmaydi');
  assert.ok(body.length <= require('../dist/modules/reorder.controller.js').REORDER_EXPORT_MAX);
  // B7: the totals row closes the file — rows counted, the estimated cost summed in whole tiyin
  const total = lines.at(-1).split(';');
  assert.equal(total[1], `"${body.length}"`);
  const cost = body.reduce((a, l) => a + Math.round(Number(l.split(';')[13].replace(/"/g, '')) * 100), 0);
  assert.equal(total[13], `"${(cost / 100).toFixed(2)}"`);
  // more rows than an export may hold is refused (narrow the scope), never cut silently
  process.env.CSV_MAX_ROWS = '1';
  try { assert.equal((await keeper.get('/warehouse/reorder.csv?horizon=60')).status, 422); } finally { delete process.env.CSV_MAX_ROWS; }
});

test('B22: ochiq (tasdiqlangan, hali berilmagan) talabnomalar miqdori yaroqli qoldiqdan ayriladi', async () => {
  const before = rowOf((await keeper.get('/warehouse/reorder?horizon=60')).body.data, X);
  assert.equal(before.reserved, '0.00');
  const r = await manager.post('/warehouse/requests', { branch_id: BC, purpose: 'department', department: 'Muolaja xonasi', lines: [{ item_id: X, qty: 30 }] });
  assert.equal(r.status, 201, r.text);
  const after = rowOf((await keeper.get('/warehouse/reorder?horizon=60')).body.data, X);
  assert.equal(after.reserved, '30.00');
  // 1.8 × 60 + 10 − (80 − 10.2 − 30) = 78.2 → 7 packs of 12
  assert.equal(after.suggested, '84.00'); assert.equal(after.packs, 7);
  assert.equal(after.days_left, 22, '(80 − 10.2 − 30) / 1.8');
  // half issued: only the rest is still promised; cancelled / rejected requests promise nothing
  const line = (await keeper.get(`/warehouse/requests/${r.body.data.id}`)).body.data.lines[0];
  assert.equal((await keeper.post(`/warehouse/requests/${r.body.data.id}/issue`, { lines: [{ line_id: line.id, qty: 10 }] })).status, 200);
  assert.equal(rowOf((await keeper.get('/warehouse/reorder?horizon=60')).body.data, X).reserved, '20.00');
  assert.equal((await keeper.post(`/warehouse/requests/${r.body.data.id}/reject`, { reason: 'Qolgani kerak emas' })).status, 200);
  assert.equal(rowOf((await keeper.get('/warehouse/reorder?horizon=60')).body.data, X).reserved, '0.00');
});

test('qadoq hajmi: API orqali o‘zgartiriladi va tozalanadi', async () => {
  assert.equal((await keeper.patch(`/inventory/${Y}`, { pack_size: 0 })).status, 422);
  assert.equal((await keeper.patch(`/inventory/${Y}`, { pack_size: 2 })).status, 200);
  assert.equal(rowOf((await keeper.get('/warehouse/reorder')).body.data, Y).suggested, '4.00', '3 → 2 lik qadoq: 4');
  assert.equal((await keeper.patch(`/inventory/${Y}`, { pack_size: null })).status, 200);
  assert.equal(rowOf((await keeper.get('/warehouse/reorder')).body.data, Y).pack_size, null);
});

test('AI xulosa: faktdagi raqamlar o‘tadi, to‘qilgani tashlanadi; namunaviy/o‘chiq rejimda shablon', async () => {
  const saved = { ...config.ai };
  config.ai.mode = 'live'; config.ai.provider = 'anthropic'; config.ai.apiKey = 'test-key'; config.ai.baseUrl = claude.url; config.ai.model = 'claude-opus-5-5';
  let seenKey;
  claude.answer = (input) => {
    const it = input.items.find((i) => i.name === NAME_Y);
    seenKey = it.key;
    return { bullets: [
      { text: `Tugagan: ${NAME_Y} — ${input.facts[`${it.key}.suggested`].value} dona buyurtma qiling.`, fact_keys: [`${it.key}.suggested`, `${it.key}.out_of_stock`] },
      { text: `${NAME_Y} 12 kunga yetadi.`, fact_keys: [`${it.key}.suggested`] },     // invented → dropped
      { text: 'Hamma narsa joyida.', fact_keys: ['no.such.key'] },                    // unknown key → dropped
    ] };
  };
  try {
    const usage = (await pool.query(`SELECT count(*)::int AS n FROM ai_usage WHERE route = 'warehouse_brief'`)).rows[0].n;
    const r = await keeper.post('/warehouse/reorder/brief', { branch_id: BC });
    assert.equal(r.status, 200, r.text);
    const d = r.body.data;
    assert.equal(d.mode, 'live'); assert.equal(d.source, 'model'); assert.equal(d.dropped, 2);
    assert.equal(d.bullets.length, 1); assert.match(d.bullets[0].text, /3 dona/);
    assert.ok(seenKey);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ai_usage WHERE route = 'warehouse_brief'`)).rows[0].n, usage + 1);
    const user = claude.calls.at(-1).body.messages[0].content;
    assert.ok(!/patient|bemor|last_name/i.test(user), 'xulosada bemor ma’lumoti yo‘q');
    assert.equal((await keeper.post('/warehouse/reorder/brief', { horizon: 500 })).status, 422);
    // nothing survives → the template
    claude.answer = () => ({ bullets: [{ text: 'Buyurtma 77 dona.', fact_keys: ['horizon.days'] }] });
    // B17: the same brief again the same day comes from the cache — no model call
    const before = claude.calls.length;
    const cached = (await keeper.post('/warehouse/reorder/brief', { branch_id: BC })).body.data;
    assert.equal(cached.cached, true); assert.equal(cached.source, 'model'); assert.equal(claude.calls.length, before);
    const t = (await keeper.post('/warehouse/reorder/brief', { branch_id: BC, regenerate: true })).body.data;
    assert.equal(t.source, 'template'); assert.equal(t.dropped, 1); assert.equal(t.cached, false);
    assert.equal(t.runs_left, 3, '5 tadan 2 tasi ishlatildi');
    // at most 5 model calls per clinic and day: the 6th is refused (429), the cached brief still opens
    for (let i = 0; i < 3; i++) assert.equal((await keeper.post('/warehouse/reorder/brief', { branch_id: BC, regenerate: true })).status, 200);
    const over = await keeper.post('/warehouse/reorder/brief', { branch_id: BC, regenerate: true });
    assert.equal(over.status, 429); assert.equal(over.body.error.code, 'AI_BRIEF_LIMIT');
    assert.equal((await manager.post('/warehouse/reorder/brief', { horizon: 14, branch_id: BC })).status, 429, 'limit butun klinika uchun');
    assert.equal((await keeper.post('/warehouse/reorder/brief', { branch_id: BC })).body.data.cached, true);
    assert.ok(t.bullets.some((b) => b.text.startsWith('Tugagan:') && b.text.includes(NAME_Y)));
    // Gemini free tier: never a real clinic's numbers — for the seed demo clinic on a demo server it is allowed (manager rule)
    const calls = claude.calls.length;
    config.ai.mode = 'sample';
    const s = (await keeper.post('/warehouse/reorder/brief', {})).body.data;
    assert.equal(s.mode, 'sample'); assert.equal(s.source, 'template'); assert.equal(claude.calls.length, calls);
    config.ai.mode = 'off';
    const o = (await keeper.post('/warehouse/reorder/brief', {})).body.data;
    assert.equal(o.mode, 'off'); assert.equal(o.source, 'template'); assert.ok(o.reason);
    const ac = require('../dist/ai/ai-client.js');
    assert.ok(ac.PUBLIC_ROUTES.has('warehouse_brief'), 'biznes marshrut (klinik emas)');
  } finally { Object.assign(config.ai, saved); claude.answer = null; }
});

test('AI xulosa yo‘riqnomasi faktda yo‘q raqam so‘ramaydi («2 hafta» kabi) — aks holda tekshiruv har safar bandni tashlaydi', () => {
  const { BRIEF_SYSTEM } = require('../dist/ai/warehouse-brief.js');
  const quoted = [...BRIEF_SYSTEM.matchAll(/«([^»]*)»/g)].map((m) => m[1]).join(' ');
  assert.ok(!/\d/.test(quoted), quoted);
});
