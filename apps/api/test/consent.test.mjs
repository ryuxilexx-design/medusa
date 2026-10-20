// Patient consent (ZRU-547): append-only evidence, tenant isolation, role checks, production rule for new cards,
// Telegram bot registration (consent yes/no) and Telegram notices stopping after a «no».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool, config;

function session() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), put: (p, b) => req('PUT', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const as = async (mid) => { const s = session(); assert.equal((await s.demo(mid)).status, 200); return s; };

let manager, registrar, cashier, lab, t2;
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  config = require('../dist/core/config.js').config;
  manager = await as(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  await db.assertDatabaseName(pool, '_test');
  await pool.query(`DELETE FROM telegram_chats`); // chats survive resets; start from unlinked phones (test database only)
  registrar = await as(M.registrar); cashier = await as(M.cashier); lab = await as(M.lab); t2 = await as(M.tenant2Manager);
});
after(async () => { await app?.close(); });

/** A seed patient of the main clinic without any consent row (seed: patient_number % 10 >= 7). */
const unconsented = async (offset = 0) => (await pool.query(
  `SELECT p.* FROM patients p WHERE p.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM patient_consents c WHERE c.patient_id = p.id)
    ORDER BY p.patient_number OFFSET $2 LIMIT 1`, [SEED_IDS.tenant, offset])).rows[0];

test('seed: ~70% bemorda imzolangan rozilik bor, qolganida yo‘q; deterministik', async () => {
  const r = (await pool.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE method = 'signed_paper' AND granted AND text_version = '2026-10')::int AS ok
                                 FROM patient_consents WHERE tenant_id = $1`, [SEED_IDS.tenant])).rows[0];
  assert.equal(r.n, 70); assert.equal(r.ok, 70);
  const first = (await registrar.get(`/patients/${SEED_IDS.patient(0)}`)).body.data; // #1001
  assert.equal(first.consents.data_processing.granted, true);
  assert.equal(first.consents.data_processing.recorded_by_name, 'Malika Yusupova');
  assert.equal(first.consents.notifications, null);
});

test('qayd etish: registrator rozilik va qaytarib olishni yozadi; holat = oxirgi yozuv; tarix; audit izohsiz', async () => {
  const p = await unconsented();
  let card = (await registrar.get(`/patients/${p.id}`)).body.data;
  assert.deepEqual(card.consents, { data_processing: null, notifications: null });

  let r = await registrar.post(`/patients/${p.id}/consents`, { kind: 'data_processing', granted: true, method: 'signed_paper', note: 'Onasi imzoladi — maxfiy izoh' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.text_version, '2026-10');
  assert.equal(r.body.data.method, 'signed_paper');
  assert.equal(r.body.data.recorded_by_name, 'Malika Yusupova');
  card = (await registrar.get(`/patients/${p.id}`)).body.data;
  assert.equal(card.consents.data_processing.granted, true);

  r = await manager.post(`/patients/${p.id}/consents`, { kind: 'notifications', granted: false, method: 'verbal' });
  assert.equal(r.status, 201);
  r = await manager.post(`/patients/${p.id}/consents`, { kind: 'data_processing', granted: false, method: 'verbal' });
  assert.equal(r.status, 201);
  card = (await manager.get(`/patients/${p.id}`)).body.data;
  assert.equal(card.consents.data_processing.granted, false, 'oxirgi yozuv — qaytarib olingan');
  assert.equal(card.consents.data_processing.recorded_by_name, 'Dilnoza Karimova');
  assert.equal(card.consents.notifications.granted, false);

  const hist = (await registrar.get(`/patients/${p.id}/consents`)).body.data;
  assert.equal(hist.length, 3);
  assert.deepEqual(hist.map((h) => [h.kind, h.granted]), [['data_processing', false], ['notifications', false], ['data_processing', true]], 'eng yangisi birinchi');

  const audits = (await pool.query(`SELECT action, summary, actor_name FROM audit_logs WHERE resource_id = $1 AND action LIKE 'patient.consent%' ORDER BY occurred_at`, [p.id])).rows;
  assert.equal(audits.length, 3);
  assert.deepEqual(audits.map((a) => a.action), ['patient.consent_grant', 'patient.consent_withdraw', 'patient.consent_withdraw']);
  assert.ok(audits.every((a) => !a.summary.includes('maxfiy izoh')), 'izoh auditga tushmaydi');

  // validation: staff cannot claim the Telegram method, unknown kind, missing answer
  for (const bad of [{ kind: 'data_processing', granted: true, method: 'telegram' }, { kind: 'marketing', granted: true, method: 'verbal' }, { kind: 'notifications', method: 'verbal' }]) {
    const v = await registrar.post(`/patients/${p.id}/consents`, bad);
    assert.equal(v.status, 422, JSON.stringify(bad)); assert.ok(v.body.error.fields, JSON.stringify(v.body));
  }
});

test('append-only: bazadagi trigger UPDATE va DELETE’ni rad etadi', async () => {
  const row = (await pool.query(`SELECT id FROM patient_consents LIMIT 1`)).rows[0];
  await assert.rejects(pool.query(`UPDATE patient_consents SET granted = NOT granted WHERE id = $1`, [row.id]), (e) => e.code === 'P0001' && /append-only/.test(e.message));
  await assert.rejects(pool.query(`UPDATE patient_consents SET note = 'x' WHERE id = $1`, [row.id]), (e) => e.code === 'P0001');
  await assert.rejects(pool.query(`DELETE FROM patient_consents WHERE id = $1`, [row.id]), (e) => e.code === 'P0001');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patient_consents WHERE id = $1`, [row.id])).rows[0].n, 1);
});

test('izolyatsiya va rollar: boshqa klinika 404; kassir/laborant 403; biriktirilmagan shifokor 403', async () => {
  const p = await unconsented(1);
  const body = { kind: 'data_processing', granted: true, method: 'signed_paper' };
  // another clinic: 404 both ways
  assert.equal((await t2.get(`/patients/${p.id}/consents`)).status, 404);
  assert.equal((await t2.post(`/patients/${p.id}/consents`, body)).status, 404);
  const foreign = (await pool.query(`SELECT id FROM patients WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant2])).rows[0].id;
  assert.equal((await registrar.post(`/patients/${foreign}/consents`, body)).status, 404);
  assert.equal((await registrar.get(`/patients/${foreign}/consents`)).status, 404);
  assert.equal((await registrar.post(`/patients/not-a-uuid/consents`, body)).status, 404);
  // roles that do not collect consent
  for (const s of [cashier, lab]) {
    assert.equal((await s.post(`/patients/${p.id}/consents`, body)).status, 403);
    assert.equal((await s.get(`/patients/${p.id}/consents`)).status, 403);
    assert.equal((await s.get(`/patients/${p.id}`)).body.data.consents, undefined, 'minimal kartada rozilik yo‘q');
  }
  // doctors: only their own patients
  const own = (await pool.query(`SELECT d.membership_id FROM appointments a JOIN doctors d ON d.id = a.doctor_id WHERE a.patient_id = $1 AND d.membership_id IS NOT NULL LIMIT 1`, [p.id])).rows[0];
  const other = (await pool.query(`SELECT d.membership_id FROM doctors d WHERE d.tenant_id = $1 AND d.membership_id IS NOT NULL
                                    AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = $2 AND a.doctor_id = d.id) LIMIT 1`, [SEED_IDS.tenant, p.id])).rows[0];
  const stranger = await as(other.membership_id);
  assert.equal((await stranger.post(`/patients/${p.id}/consents`, body)).status, 403);
  if (own) {
    const doc = await as(own.membership_id);
    const r = await doc.post(`/patients/${p.id}/consents`, body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patient_consents WHERE patient_id = $1`, [p.id])).rows[0].n, own ? 1 : 0, 'rad etilgan so‘rovlar hech narsa yozmadi');
});

const newPatient = (extra = {}) => ({ last_name: 'Roziliksiz', first_name: 'Sinov' + Math.random().toString(36).slice(2, 6).replace(/\d/g, 'x'), birth_date: '1990-02-03', sex: 'female', confirm_duplicate: true, ...extra });

test('yangi bemor: rozilik shu tranzaksiyada yoziladi; demo rejimida roziliksiz ham ochiladi; production’da 422', async () => {
  // demo: with consent (+ Telegram reminders) → both recorded
  let r = await registrar.post('/patients', newPatient({ consent: { data_processing: true, notifications: true, method: 'signed_paper' } }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  let card = (await registrar.get(`/patients/${r.body.data.id}`)).body.data;
  assert.equal(card.consents.data_processing.granted, true); assert.equal(card.consents.data_processing.method, 'signed_paper');
  assert.equal(card.consents.notifications.granted, true);
  // demo: without consent → allowed (seed and E2E keep working), nothing recorded
  r = await registrar.post('/patients', newPatient());
  assert.equal(r.status, 201);
  card = (await registrar.get(`/patients/${r.body.data.id}`)).body.data;
  assert.deepEqual(card.consents, { data_processing: null, notifications: null });

  const saved = config.mode;
  config.mode = 'production';
  try {
    const before = (await pool.query(`SELECT count(*)::int AS n FROM patients`)).rows[0].n;
    for (const body of [newPatient(), newPatient({ consent: { data_processing: false, method: 'signed_paper' } }), newPatient({ consent: null })]) {
      r = await registrar.post('/patients', body);
      assert.equal(r.status, 422, JSON.stringify(r.body));
      assert.equal(r.body.error.code, 'CONSENT_REQUIRED');
      assert.match(r.body.error.fields.consent, /rozilik/);
    }
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patients`)).rows[0].n, before, 'karta ochilmadi');
    r = await registrar.post('/patients', newPatient({ consent: { data_processing: true, method: 'verbal' } }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const rows = (await pool.query(`SELECT kind, granted, method, text_version, recorded_by FROM patient_consents WHERE patient_id = $1`, [r.body.data.id])).rows;
    assert.deepEqual(rows, [{ kind: 'data_processing', granted: true, method: 'verbal', text_version: '2026-10', recorded_by: M.registrar }]);
    // Russian interface: the refusal is translated
    const ru = await as(M.registrar);
    assert.equal((await ru.put('/me/preferences', { locale: 'ru' })).status, 200);
    const rr = await ru.post('/patients', newPatient());
    assert.equal(rr.status, 422);
    assert.equal(rr.body.error.message, 'Без согласия карта пациента не создаётся');
    assert.match(rr.body.error.fields.consent, /согласие/);
  } finally { config.mode = saved; }
});

// ---------- Telegram bot (simulator transport) ----------
const out = async (chat) => (await manager.get(`/telegram/sim/messages?chat_id=${chat}`)).body.data.filter((m) => m.direction === 'out');
const say = (chat, text) => manager.post('/telegram/sim/send', { chat_id: chat, text });
async function press(chat, caption) {
  for (const m of (await out(chat)).reverse()) {
    const btn = (m.markup?.inline_keyboard ?? []).flat().find((b) => b.text === caption);
    if (btn) { assert.equal((await manager.post('/telegram/sim/send', { chat_id: chat, callback_data: btn.callback_data, label: btn.text })).status, 200); return; }
  }
  throw new Error(`button "${caption}" not found`);
}
async function registerUpTo(phone, last, first, birth) {
  const chat = (await manager.post('/telegram/sim/chats')).body.data.chat_id;
  await say(chat, '/start');
  await manager.post('/telegram/sim/send', { chat_id: chat, contact_phone: phone });
  await say(chat, '📅 Qabulga yozilish');
  await say(chat, last); await say(chat, first); await say(chat, birth);
  return chat;
}

test('bot: yangi bemor «Yo‘q» desa karta ochilmaydi; «Roziman» — karta va ikkala rozilik (telegram)', async () => {
  const phone = '+998935557001';
  const chat = await registerUpTo(phone, 'Rozimas', 'Sinov', '01.02.1985');
  const ask = (await out(chat)).at(-1);
  assert.match(ask.text, /roziligingiz kerak/);
  assert.deepEqual(ask.markup.inline_keyboard.flat().map((b) => b.text), ['✅ Roziman', 'Yo‘q']);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patients WHERE phone = $1`, [phone])).rows[0].n, 0, 'javobdan oldin hech narsa saqlanmaydi');
  await say(chat, 'nima?');
  assert.match((await out(chat)).at(-1).text, /tugmalardan birini/);
  await press(chat, 'Yo‘q');
  const texts = (await out(chat)).map((m) => m.text).join('\n');
  assert.match(texts, /Roziliksiz karta ochilmaydi/);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patients WHERE phone = $1`, [phone])).rows[0].n, 0);
  assert.equal((await out(chat)).at(-1).markup.keyboard.flat().some((b) => b.text === '📅 Qabulga yozilish'), true, 'menyuga qaytdi');

  // same chat, again — this time «Roziman»
  await say(chat, '📅 Qabulga yozilish');
  await say(chat, 'Rozimas'); await say(chat, 'Sinov'); await say(chat, '01.02.1985');
  await press(chat, '✅ Roziman');
  const p = (await pool.query(`SELECT * FROM patients WHERE phone = $1`, [phone])).rows[0];
  assert.ok(p, 'karta yaratildi'); assert.equal(p.source, 'telegram');
  assert.match((await out(chat)).at(-1).text, /Xizmatni tanlang/);
  const rows = (await pool.query(`SELECT kind, granted, method, text_version, recorded_by, recorded_by_name FROM patient_consents WHERE patient_id = $1 ORDER BY kind`, [p.id])).rows;
  assert.deepEqual(rows, [
    { kind: 'data_processing', granted: true, method: 'telegram', text_version: 'tg-2026-10', recorded_by: null, recorded_by_name: null },
    { kind: 'notifications', granted: true, method: 'telegram', text_version: 'tg-2026-10', recorded_by: null, recorded_by_name: null },
  ]);
  const card = (await registrar.get(`/patients/${p.id}`)).body.data;
  assert.equal(card.consents.data_processing.method, 'telegram');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = $1 AND action = 'patient.consent_grant' AND actor_role = 'system'`, [p.id])).rows[0].n, 2);

  // the same person registering again is matched to the existing card — no second consent question
  await say(chat, '📅 Qabulga yozilish');
  const n0 = (await out(chat)).length;
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patients WHERE phone = $1`, [phone])).rows[0].n, 1);
  assert.ok(!(await out(chat)).slice(n0 - 1).some((m) => /roziligingiz kerak/.test(m.text)));

  // Telegram notices stop once the patient says «no» to them (a new row; the old one stays)
  const { enqueueNotice } = require('../dist/telegram/outbox.js');
  assert.equal(await enqueueNotice(pool, { tenantId: SEED_IDS.tenant, kind: 'result_ready', patientId: p.id, dedupeKey: `t:${randomUUID()}` }), true);
  assert.equal((await registrar.post(`/patients/${p.id}/consents`, { kind: 'notifications', granted: false, method: 'verbal' })).status, 201);
  assert.equal(await enqueueNotice(pool, { tenantId: SEED_IDS.tenant, kind: 'result_ready', patientId: p.id, dedupeKey: `t:${randomUUID()}` }), false, '«yo‘q»dan keyin xabar navbatga qo‘yilmaydi');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM patient_consents WHERE patient_id = $1`, [p.id])).rows[0].n, 3);
});

test('bot: klinikada kartasi bor bemor (bog‘langan) rozilik savolisiz yoziladi; rus va kirill tilida tugmalar', async () => {
  const seed = (await pool.query(
    `SELECT p.phone FROM patients p WHERE p.tenant_id = $1 AND p.phone IS NOT NULL AND (SELECT count(*) FROM patients x WHERE x.phone = p.phone) = 1
      AND NOT EXISTS (SELECT 1 FROM telegram_chats tc WHERE tc.phone = p.phone) ORDER BY p.patient_number LIMIT 1`, [SEED_IDS.tenant])).rows[0];
  const chat = (await manager.post('/telegram/sim/chats')).body.data.chat_id;
  await say(chat, '/start');
  await manager.post('/telegram/sim/send', { chat_id: chat, contact_phone: seed.phone });
  await say(chat, '📅 Qabulga yozilish');
  const last = (await out(chat)).at(-1).text;
  assert.match(last, /Xizmatni tanlang/); assert.doesNotMatch(last, /rozilig/);

  // the consent question in the other bot languages
  const { T } = require('../dist/telegram/texts.js');
  assert.match(T.ru.consentAsk('Klinika'), /согласие/); assert.equal(T.ru.consentNo, 'Нет');
  const cy = T['uz-Cyrl'].consentAsk('Med.uz.ai Demo Clinic');
  assert.match(cy, /розилигингиз/i); assert.ok(cy.includes('«Med.uz.ai Demo Clinic»'), 'klinika nomi o‘girilmaydi');
  assert.equal(T['uz-Cyrl'].consentYes, '✅ Розиман');
  assert.ok(!/[A-Za-z]/.test(cy.replace('Med.uz.ai Demo Clinic', '')), cy);
});
