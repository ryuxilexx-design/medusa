// Referral partners, their percent snapshot, payouts and reports; lead sources (migration 041, docs/REFERRALS.md).
// Role sweep (403), tenant isolation (404), snapshot immutability, partner amount = NET_LINE × % after a refund,
// cash payout rules (open drawer, INSUFFICIENT_CASH, void once), lead-source defaults, report totals and CSVs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { bootTestApp, db } from './_helpers.mjs';
const require = createRequire(import.meta.url);
const { SEED_IDS } = db;
const M = SEED_IDS.membership;
let app, base, pool;

function session() {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t, type: r.headers.get('content-type') ?? '' };
  };
  return { get: (p) => req('GET', p), post: (p, b = {}, h) => req('POST', p, b, h), patch: (p, b) => req('PATCH', p, b), put: (p, b) => req('PUT', p, b), demo: (mid) => req('POST', '/demo/login', { membership_id: mid }) };
}
const key = () => ({ 'Idempotency-Key': randomUUID() });
const csvLines = (text) => text.replace(/^﻿/, '').split('\r\n').filter((l) => l.length);

let manager, registrar, cashier, doctor, lab, storekeeper, guard, t2manager, today, central;
const S = {};
before(async () => {
  ({ app, base } = await bootTestApp());
  pool = app.get(require('../dist/core/db.js').Db).pool;
  manager = session(); await manager.demo(M.manager);
  assert.equal((await manager.post('/demo/reset')).status, 200);
  registrar = session(); await registrar.demo(M.registrar);
  cashier = session(); await cashier.demo(M.cashier);
  doctor = session(); await doctor.demo(M.doctor(0));
  lab = session(); await lab.demo(M.lab);
  storekeeper = session(); await storekeeper.demo(M.storekeeper);
  guard = session(); await guard.demo(M.guard);
  t2manager = session(); await t2manager.demo(M.tenant2Manager);
  const me = (await manager.get('/me')).body.data;
  today = me.today; central = me.branches.find((b) => b.code === 'MRK').id;
});
after(async () => { await app?.close(); });

const sql = async (q, p = []) => (await pool.query(q, p)).rows;
const source = async (key, tenant = SEED_IDS.tenant) => (await sql(`SELECT id FROM lead_sources WHERE tenant_id = $1 AND starter_key = $2`, [tenant, key]))[0].id;

test('seed: 8 hamkor, 10 manba, o‘tgan qabullarning ~25 % yo‘llanma bilan, to‘lovlar bank orqali; bugungi KPI o‘zgarmagan', async () => {
  const list = await manager.get('/referral-partners?page_size=50');
  assert.equal(list.status, 200, list.text);
  assert.equal(list.body.meta.total, 8);
  assert.ok(list.body.data.every((p) => p.code >= 101 && p.code <= 108 && typeof p.default_percent === 'number'));
  assert.equal((await manager.get('/lead-sources?all=1')).body.data.length, 10);
  const [{ referred, past }] = await sql(`SELECT count(*) FILTER (WHERE referral_partner_id IS NOT NULL)::int AS referred, count(*)::int AS past FROM appointments
    WHERE tenant_id = $1 AND starts_at < (date_trunc('day', demo_now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent')`, [SEED_IDS.tenant]);
  assert.ok(referred / past > 0.18 && referred / past < 0.32, `yo‘llanma ulushi: ${referred}/${past}`);
  const [o] = await sql(`SELECT count(*)::int AS n, count(*) FILTER (WHERE partner_percent_snapshot BETWEEN 10 AND 30)::int AS ok FROM service_orders WHERE tenant_id = $1 AND referral_partner_id IS NOT NULL`, [SEED_IDS.tenant]);
  assert.ok(o.n > 20 && o.ok === o.n, `foiz 10–30: ${o.ok}/${o.n}`);
  const pay = await sql(`SELECT method, shift_id, status FROM partner_payouts WHERE tenant_id = $1`, [SEED_IDS.tenant]);
  assert.ok(pay.length >= 4 && pay.every((p) => p.method === 'transfer' && !p.shift_id) && pay.some((p) => p.status === 'void'), 'to‘lovlar: bank o‘tkazmasi, smenasiz, bittasi bekor');
  const [src] = await sql(`SELECT count(*) FILTER (WHERE lead_source_id IS NOT NULL)::int AS n, count(*)::int AS all FROM patients WHERE tenant_id = $1`, [SEED_IDS.tenant]);
  assert.ok(src.n / src.all > 0.8, 'kartalarning manbasi bor');
  // the seed's «today» did not move: 28 bookings, 2 510 000 so‘m in 12 payments, debt 6 315 000 so‘m on 46 bills
  const k = (await manager.get('/dashboard?period=today')).body.data.kpi;
  assert.deepEqual([k.appointments, k.revenue, k.payments, k.debt, k.debt_invoices], [28, 251_000_000, 12, 631_500_000, 46]);
  // the seed's cash drawers of today have no partner payout
  for (const c of [cashier]) assert.equal((await c.get('/cash-shifts/current')).body.data.totals.partner_payouts.sum, 0);
});

test('rollar: hamkorlar, foizlar, to‘lovlar va hisobotlar faqat rahbarniki; registrator qidiradi va foizsiz qo‘shadi', async () => {
  const pid = (await manager.get('/referral-partners?page_size=1')).body.data[0].id;
  const routes = [
    ['GET', '/referral-partners'], ['POST', '/referral-partners', { full_name: 'Rol Testov' }], ['GET', `/referral-partners/${pid}`], ['PATCH', `/referral-partners/${pid}`, { default_percent: 1 }],
    ['PUT', `/referral-partners/${pid}/services`, { items: [] }], ['GET', `/reports/referrals?from=${today}&to=${today}`], ['GET', `/reports/referrals/export.csv?from=${today}&to=${today}`],
    ['GET', `/reports/referrals/${pid}/lines`], ['GET', '/referral-payouts'], ['POST', '/referral-payouts', { partner_id: pid, amount: 100, method: 'transfer' }],
    ['GET', `/reports/lead-sources?from=${today}&to=${today}`], ['GET', `/reports/lead-sources/export.csv?from=${today}&to=${today}`], ['GET', '/lead-sources'], ['POST', '/lead-sources', { name: 'X' }],
  ];
  const call = (s, [m, p, b]) => (m === 'GET' ? s.get(p) : m === 'POST' ? s.post(p, b, key()) : m === 'PUT' ? s.put(p, b) : s.patch(p, b));
  for (const [name, s] of [['doctor', doctor], ['cashier', cashier], ['lab', lab], ['storekeeper', storekeeper], ['guard', guard]])
    for (const r of routes) assert.equal((await call(s, r)).status, 403, `${name} ${r[0]} ${r[1]}`);
  // reception: the directory for the picker (no percent), quick-add without a percent, nothing else
  const allowed = new Set(['GET /referral-partners', 'POST /referral-partners', 'GET /lead-sources']);
  for (const r of routes) if (!allowed.has(`${r[0]} ${r[1]}`)) assert.equal((await call(registrar, r)).status, 403, `registrator ${r[0]} ${r[1]}`);
  const reg = await registrar.get('/referral-partners?search=Rustamov');
  assert.equal(reg.status, 200); assert.equal(reg.body.data.length, 1);
  assert.ok(!('default_percent' in reg.body.data[0]) && !('note' in reg.body.data[0]), 'registrator foizni ko‘rmaydi');
  assert.equal((await registrar.get('/referral-partners?search=101')).body.data[0].code, 101, 'kod bo‘yicha');
  assert.equal((await registrar.get('/referral-partners?search=Рустамов')).body.data.length, 1, 'kirill yozuvida ham topiladi');
  assert.equal((await registrar.post('/referral-partners', { full_name: 'Foizli Registrator', default_percent: 15 })).status, 403);
  const quick = await registrar.post('/referral-partners', { full_name: 'Tez Qo‘shilgan Shifokor', phone: '90 123 45 67', kind: 'doctor' });
  assert.equal(quick.status, 201, quick.text); assert.equal(quick.body.data.code, 109);
  const dup = await registrar.post('/referral-partners', { full_name: 'Boshqa ism', phone: '+998901234567' });
  assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'PARTNER_EXISTS'); assert.equal(dup.body.error.details.partner.code, 109, 'mavjud hamkor qaytariladi');
  assert.equal((await manager.get(`/referral-partners/${quick.body.data.id}`)).body.data.default_percent, 0, 'rahbar foizni keyin belgilaydi');
  // percents of services and doctors' views
  assert.ok((await cashier.get('/services')).body.data.every((s) => s.partner_percent === null), 'kassir xizmat foizini ko‘rmaydi');
  assert.ok((await manager.get('/services')).body.data.some((s) => Number(s.partner_percent) === 10), 'rahbar ko‘radi');
  const docAppts = (await doctor.get(`/appointments?from=2026-09-01&to=${today}`)).body.data;
  assert.ok(docAppts.length && docAppts.every((a) => !('referral_partner_id' in a) && !('lead_source_name' in a)), 'shifokor yo‘llovchini ko‘rmaydi');
  assert.ok((await registrar.get(`/appointments?from=2026-09-20&to=${today}`)).body.data.some((a) => a.referral_partner_name), 'registrator ko‘radi');
  // the patient card and its visits: reception sees the source and the partner, the doctor neither
  const referredPatient = (await sql(`SELECT a.patient_id FROM appointments a WHERE a.tenant_id = $1 AND a.doctor_id = $2 AND a.referral_partner_id IS NOT NULL LIMIT 1`, [SEED_IDS.tenant, SEED_IDS.doctor(0)]))[0].patient_id;
  const regHist = (await registrar.get(`/patients/${referredPatient}/history`)).body.data.visits;
  assert.ok(regHist.some((v) => v.referral_partner_name) && 'lead_source_name' in (await registrar.get(`/patients/${referredPatient}`)).body.data);
  const docHist = (await doctor.get(`/patients/${referredPatient}/history`)).body.data.visits;
  assert.ok(docHist.length && docHist.every((v) => !('referral_partner_name' in v) && !('lead_source_id' in v)), 'shifokor tarixida yo‘llovchi yo‘q');
  const docCard = (await doctor.get(`/patients/${referredPatient}`)).body.data;
  assert.ok(!('lead_source_id' in docCard) && !('lead_source_name' in docCard), 'shifokor kartasida manba yo‘q');
});

test('tenant izolyatsiyasi: boshqa klinikaning hamkori, manbasi, qabuli — 404/422', async () => {
  const pid = (await manager.get('/referral-partners?page_size=1')).body.data[0].id;
  assert.equal((await t2manager.get('/referral-partners')).body.meta.total, 0);
  assert.equal((await t2manager.get(`/referral-partners/${pid}`)).status, 404);
  assert.equal((await t2manager.patch(`/referral-partners/${pid}`, { default_percent: 50 })).status, 404);
  assert.equal((await t2manager.put(`/referral-partners/${pid}/services`, { items: [] })).status, 404);
  assert.equal((await t2manager.get(`/reports/referrals/${pid}/lines`)).status, 404);
  assert.equal((await t2manager.post('/referral-payouts', { partner_id: pid, amount: 100_00, method: 'transfer' }, key())).status, 404);
  const payout = (await sql(`SELECT id FROM partner_payouts WHERE tenant_id = $1 AND status = 'active' LIMIT 1`, [SEED_IDS.tenant]))[0].id;
  assert.equal((await t2manager.post(`/referral-payouts/${payout}/void`, { reason: 'Begona' })).status, 404);
  const src = await source('instagram');
  assert.equal((await t2manager.patch(`/lead-sources/${src}`, { name: 'Begona' })).status, 404);
  const appt = (await sql(`SELECT id FROM appointments WHERE tenant_id = $1 LIMIT 1`, [SEED_IDS.tenant]))[0].id;
  assert.equal((await t2manager.patch(`/appointments/${appt}/referral`, { referral_partner_id: null })).status, 404);
  // a foreign partner / source on this clinic's card or visit: a field error, never a link across clinics
  const t2patient = (await t2manager.get('/patients?page_size=1')).body.data[0];
  assert.equal((await t2manager.patch(`/patients/${t2patient.id}`, { lead_source_id: src })).status, 422);
  assert.equal((await t2manager.get('/reports/referrals?period=30d')).body.data.length, 0);
});

/** A new card booked today with doctor 0 (registrar), optionally referred. */
async function bookToday(patientId, extra = {}) {
  const svc = (await registrar.get('/services')).body.data.find((s) => s.code === 'C01');
  const avail = (await registrar.get(`/availability?doctor_id=${SEED_IDS.doctor(0)}&date=${today}&service_id=${svc.id}`)).body.data;
  const slot = avail.slots.find((s) => s.free && !s.past);
  const r = await registrar.post('/appointments', { patient_id: patientId, branch_id: avail.branch_id, doctor_id: SEED_IDS.doctor(0), service_id: svc.id, date: today, start_time: slot.time, ...extra }, key());
  assert.equal(r.status, 201, r.text);
  return { id: r.body.data.id, svc, branch: avail.branch_id };
}

test('manba: hamkor bilan → «Yo‘llovchi shifokor», karta manbasi bir marta to‘ladi; hamkorsiz → kartaniki; bot → «Telegram bot»', async () => {
  const p = await manager.post('/referral-partners', { full_name: 'Snapshot Hamkorov', kind: 'doctor', default_percent: 20 });
  assert.equal(p.status, 201, p.text); S.partner = p.body.data;
  const card = await registrar.post('/patients', { last_name: 'Yo‘llanmali', first_name: 'Bemor', birth_date: '1980-02-02', sex: 'male', phone: '93 222 33 44' });
  assert.equal(card.status, 201, card.text); S.patient = card.body.data.id;
  const a = await bookToday(S.patient, { referral_partner_id: S.partner.id });
  S.appt = a.id; S.svc = a.svc; S.branch = a.branch;
  const row = (await registrar.get(`/appointments/${a.id}`)).body.data;
  assert.equal(row.referral_partner_name, 'Snapshot Hamkorov');
  assert.equal(row.lead_source_id, await source('referral'));
  assert.equal((await registrar.get(`/patients/${S.patient}`)).body.data.lead_source_id, await source('referral'), 'kartaning birinchi manbasi');
  // a later visit without a partner takes the card's source; an explicit source wins
  const card2 = await registrar.post('/patients', { last_name: 'Instagramli', first_name: 'Bemor', birth_date: '1991-03-03', sex: 'female', lead_source_id: await source('instagram') });
  assert.equal(card2.status, 201, card2.text);
  const b = await bookToday(card2.body.data.id);
  assert.equal((await registrar.get(`/appointments/${b.id}`)).body.data.lead_source_id, await source('instagram'));
  // the bot: no partner, always «Telegram bot» (booking.ts with source 'telegram', as the bot calls it)
  const { createAppointment } = require('../dist/modules/booking.js');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const ctx = { membershipId: '', userId: '', tenantId: SEED_IDS.tenant, tenantName: 'x', role: 'registrar', name: 'Telegram bot', title: null, branchIds: [central, a.branch],
      doctorId: null, doctorSpecialty: null, requestId: randomUUID(), sessionHash: '', authKind: 'system', mustChangePassword: false, locale: 'uz', textSize: 'normal' };
    const avail = (await registrar.get(`/availability?doctor_id=${SEED_IDS.doctor(0)}&date=${today}&service_id=${S.svc.id}`)).body.data;
    const slot = avail.slots.filter((s) => s.free && !s.past).at(-1);
    const r = await createAppointment(c, ctx, { patient_id: card2.body.data.id, branch_id: avail.branch_id, doctor_id: SEED_IDS.doctor(0), service_id: S.svc.id, date: today, start_time: slot.time,
      referral_partner_id: S.partner.id, lead_source_id: await source('instagram') }, null, 'telegram');
    const [bot] = (await c.query(`SELECT referral_partner_id, lead_source_id FROM appointments WHERE id = $1`, [r.id])).rows;
    assert.equal(bot.referral_partner_id, null, 'botda yo‘llovchi yo‘q');
    assert.equal(bot.lead_source_id, await source('telegram_bot'));
    await c.query('ROLLBACK');
  } finally { c.release(); }
  // validation: an inactive partner or source cannot be picked
  const inactive = (await sql(`SELECT id FROM referral_partners WHERE tenant_id = $1 AND NOT active LIMIT 1`, [SEED_IDS.tenant]))[0].id;
  const bad = await registrar.patch(`/appointments/${b.id}/referral`, { referral_partner_id: inactive });
  assert.equal(bad.status, 422); assert.ok(bad.body.error.fields.referral_partner_id);
  // a doctor cannot attach a partner to a booking
  assert.equal((await doctor.post('/appointments', { patient_id: S.patient, branch_id: S.branch, doctor_id: SEED_IDS.doctor(0), service_id: S.svc.id, date: today, start_time: '17:00', referral_partner_id: S.partner.id })).status, 403);
  // the system sources cannot be switched off
  assert.equal((await manager.patch(`/lead-sources/${await source('telegram_bot')}`, { active: false })).status, 409);
  assert.equal((await manager.patch(`/lead-sources/${await source('radio_tv')}`, { active: false })).status, 200);
  assert.ok(!(await registrar.get('/lead-sources')).body.data.some((s) => s.name === 'Radio/TV'), 'o‘chirilgan manba tanlovda yo‘q');
});

test('snapshot: check-in paytidagi foiz qatorda qoladi; foizlar keyin o‘zgarsa — eski qator o‘zgarmaydi, yangisi yangi foizda', async () => {
  assert.equal((await registrar.post(`/appointments/${S.appt}/check-in`)).status, 200);
  const [o1] = await sql(`SELECT id, referral_partner_id, partner_percent_snapshot FROM service_orders WHERE appointment_id = $1`, [S.appt]);
  assert.equal(o1.referral_partner_id, S.partner.id); assert.equal(Number(o1.partner_percent_snapshot), 20);
  S.order = o1.id;
  // the manager raises the partner's default, sets a service percent and a partner-service percent
  assert.equal((await manager.patch(`/referral-partners/${S.partner.id}`, { default_percent: 50 })).status, 200);
  assert.equal((await manager.patch(`/services/${S.svc.id}`, { partner_percent: 12 })).status, 200);
  const [after] = await sql(`SELECT partner_percent_snapshot FROM service_orders WHERE id = $1`, [S.order]);
  assert.equal(Number(after.partner_percent_snapshot), 20, 'o‘tgan qator o‘zgarmadi');
  // a new referred visit: pair > service > partner default
  const card = await registrar.post('/patients', { last_name: 'Ikkinchi', first_name: 'Yo‘llanma', birth_date: '1977-07-07', sex: 'male' });
  const v = await bookToday(card.body.data.id, { referral_partner_id: S.partner.id });
  assert.equal((await registrar.post(`/appointments/${v.id}/check-in`)).status, 200);
  assert.equal(Number((await sql(`SELECT partner_percent_snapshot AS p FROM service_orders WHERE appointment_id = $1`, [v.id]))[0].p), 12, 'xizmat foizi');
  assert.equal((await manager.put(`/referral-partners/${S.partner.id}/services`, { items: [{ service_id: S.svc.id, percent: 7.5 }] })).status, 200);
  const { partnerPercentFor } = require('../dist/modules/billing.js');
  assert.equal(await partnerPercentFor(pool, SEED_IDS.tenant, S.partner.id, S.svc.id), 7.5, 'hamkor+xizmat foizi');
  assert.equal(Number((await sql(`SELECT partner_percent_snapshot AS p FROM service_orders WHERE appointment_id = $1`, [v.id]))[0].p), 12, 'eski qator o‘zgarmadi');
  assert.equal((await manager.patch(`/services/${S.svc.id}`, { partner_percent: null })).status, 200);
  assert.equal((await manager.put(`/referral-partners/${S.partner.id}/services`, { items: [] })).status, 200);
  // correcting the visit's partner while the bill has no money re-snapshots it; after a payment → 409
  const other = (await sql(`SELECT id FROM referral_partners WHERE code = 101`))[0].id;
  assert.equal((await registrar.patch(`/appointments/${v.id}/referral`, { referral_partner_id: other })).status, 200);
  assert.equal(Number((await sql(`SELECT partner_percent_snapshot AS p FROM service_orders WHERE appointment_id = $1`, [v.id]))[0].p), 20, 'yangi hamkor foizi (101: 20 %)');
  S.secondAppt = v.id;
});

test('hamkor summasi = NET_LINE × foiz: qisman qaytarishdan keyin; hisobot jami = qatorlar yig‘indisi; CSV jami va 1 yil', async () => {
  const inv = (await registrar.get(`/appointments/${S.appt}`)).body.data.invoice;
  const pay = await cashier.post(`/invoices/${inv.id}/payments`, { amount: Number(inv.total), method: 'cash' }, key());
  assert.equal(pay.status, 201, pay.text);
  // after a payment the visit's partner is final
  const locked = await registrar.patch(`/appointments/${S.appt}/referral`, { referral_partner_id: null });
  assert.equal(locked.status, 409); assert.equal(locked.body.error.code, 'REFERRAL_LOCKED');
  assert.equal((await registrar.patch(`/appointments/${S.appt}/referral`, { lead_source_id: await source('friend') })).status, 200, 'manba esa o‘zgaradi');
  // the cashier sees the partner's name on the bill, nothing more
  const cinv = (await cashier.get(`/invoices/${inv.id}`)).body.data;
  assert.equal(cinv.referral_partner_name, 'Snapshot Hamkorov');
  assert.ok(!JSON.stringify(cinv).includes('partner_percent'), 'kassirga foiz yo‘q');
  await pool.query(`UPDATE service_orders SET status = 'completed', performed_at = demo_now() WHERE appointment_id = ANY($1)`, [[S.appt, S.secondAppt]]);
  const refund = 30_000_00;
  const r = await manager.post(`/invoices/${inv.id}/refunds`, { payment_id: pay.body.data.payment.id, amount: refund, method: 'card', reason_code: 'patient_complaint', reason: 'Qisman qaytarish', order_id: S.order }, key());
  assert.equal(r.status, 201, r.text);
  const lines = (await manager.get(`/reports/referrals/${S.partner.id}/lines?from=${today}&to=${today}`)).body;
  assert.equal(lines.data.length, 1);
  assert.equal(lines.data[0].net, Number(inv.total) - refund);
  assert.equal(lines.data[0].due, Math.round(((Number(inv.total) - refund) * 20) / 100), 'qaytarishdan keyingi sof qiymat × 20 %');
  // report totals = Σ rows = Σ lines of each partner
  const rep = (await manager.get(`/reports/referrals?from=${today}&to=${today}`)).body;
  const row = rep.data.find((x) => x.partner_id === S.partner.id);
  assert.equal(row.due, lines.meta.due); assert.equal(row.net, lines.meta.net); assert.equal(row.visits, 1); assert.equal(row.patients, 1);
  for (const k of ['patients', 'visits', 'services', 'net', 'due', 'paid', 'balance']) assert.equal(rep.meta.totals[k], rep.data.reduce((a, x) => a + x[k], 0), `jami ${k}`);
  for (const x of rep.data.filter((x) => x.due)) {
    const l = (await manager.get(`/reports/referrals/${x.partner_id}/lines?from=${today}&to=${today}&page_size=100`)).body;
    assert.equal(l.data.reduce((a, y) => a + y.due, 0), x.due, `qatorlar = hisobot (#${x.code})`);
  }
  // a month: seed partners have amounts, payouts and balances
  const month = (await manager.get('/reports/referrals?period=30d')).body;
  assert.ok(month.data.filter((x) => x.due > 0).length >= 5 && month.meta.totals.paid > 0);
  // CSV
  assert.equal((await manager.get('/reports/referrals/export.csv')).status, 422);
  assert.equal((await manager.get(`/reports/referrals/export.csv?from=2024-01-01&to=${today}`)).status, 422);
  const csv = await manager.get(`/reports/referrals/export.csv?from=${today}&to=${today}`);
  assert.equal(csv.status, 200); assert.match(csv.type, /text\/csv/);
  const cl = csvLines(csv.text);
  assert.equal(cl.length, 1 + rep.data.length + 1, 'sarlavha + qatorlar + jami');
  assert.match(cl.at(-1), /^"Jami"/);
  assert.equal(cl.at(-1).split(';')[10], `"${(rep.meta.totals.due / 100).toFixed(2)}"`);
});

test('to‘lov: naqd — ochiq smenadan, INSUFFICIENT_CASH, qoldiqdan ko‘p emas, takror kalit, bir marta bekor; smena va moliya xulosasi', async () => {
  // the seed partner the clinic owes most
  const top = (await manager.get('/reports/referrals?period=30d')).body.data.sort((x, y) => y.balance - x.balance)[0];
  const partner = top.partner_id;
  const bal = (await manager.get(`/referral-partners/${partner}`)).body.data.balance;
  assert.equal(bal, top.balance);
  assert.ok(bal > 60_000_00, `qoldiq: ${bal}`);
  assert.equal((await manager.post('/referral-payouts', { partner_id: partner, amount: 100_00, method: 'cash' })).status, 422, 'Idempotency-Key majburiy');
  const noShift = await manager.post('/referral-payouts', { partner_id: partner, amount: 100_00, method: 'cash' }, key());
  assert.equal(noShift.status, 422); assert.ok(noShift.body.error.fields.shift_id);
  // the manager's own drawer with 50 000 so‘m
  const open = await manager.post('/cash-shifts', { branch_id: central, opening_cash: 50_000_00 });
  assert.equal(open.status, 201, open.text); const shift = open.body.data.id;
  const tooMuch = await manager.post('/referral-payouts', { partner_id: partner, amount: 55_000_00, method: 'cash', shift_id: shift }, key());
  assert.equal(tooMuch.status, 409); assert.equal(tooMuch.body.error.code, 'INSUFFICIENT_CASH');
  const over = await manager.post('/referral-payouts', { partner_id: partner, amount: bal + 100, method: 'transfer', branch_id: central }, key());
  assert.equal(over.status, 409); assert.equal(over.body.error.code, 'PAYOUT_OVER_BALANCE');
  const k = key();
  const ok = await manager.post('/referral-payouts', { partner_id: partner, amount: 30_000_00, method: 'cash', shift_id: shift, note: 'Oktabr' }, k);
  assert.equal(ok.status, 201, ok.text);
  const replay = await manager.post('/referral-payouts', { partner_id: partner, amount: 30_000_00, method: 'cash', shift_id: shift }, k);
  assert.equal(replay.status, 200); assert.equal(replay.body.data.replayed, true); assert.equal(replay.body.data.payout.id, ok.body.data.payout.id);
  assert.equal((await manager.post('/referral-payouts', { partner_id: partner, amount: 1_00, method: 'cash', shift_id: shift }, k)).status, 422, 'kalit boshqa summaga');
  let cur = (await manager.get('/cash-shifts/current')).body.data;
  assert.equal(cur.totals.partner_payouts.sum, 30_000_00);
  assert.equal(cur.expected_cash, 20_000_00, 'kutilgan naqd = 50 000 − 30 000');
  assert.equal((await manager.get(`/cash-shifts/${shift}`)).body.data.partner_payouts.length, 1);
  assert.equal((await manager.get(`/referral-partners/${partner}`)).body.data.balance, bal - 30_000_00);
  // the finance summary: an outflow next to expenses; revenue untouched
  const fin = (await manager.get(`/finance/summary?from=${today}&to=${today}`)).body.data;
  assert.equal(fin.partner_payouts.total, 30_000_00);
  assert.equal(fin.net_result, fin.net_revenue - fin.expenses.total - fin.partner_payouts.total);
  assert.equal((await manager.get('/dashboard?period=today')).body.data.kpi.revenue, fin.net_revenue, 'tushum o‘zgarmaydi');
  // void once: the cash is back in the drawer
  assert.equal((await manager.post(`/referral-payouts/${ok.body.data.payout.id}/void`, {})).status, 422, 'sabab majburiy');
  assert.equal((await manager.post(`/referral-payouts/${ok.body.data.payout.id}/void`, { reason: 'Noto‘g‘ri hamkor' })).status, 200);
  const again = await manager.post(`/referral-payouts/${ok.body.data.payout.id}/void`, { reason: 'Yana' });
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'ALREADY_VOID');
  cur = (await manager.get('/cash-shifts/current')).body.data;
  assert.equal(cur.expected_cash, 50_000_00);
  await assert.rejects(pool.query(`UPDATE partner_payouts SET amount = 1 WHERE id = $1`, [ok.body.data.payout.id]), /immutable/);
  await assert.rejects(pool.query(`DELETE FROM partner_payouts WHERE id = $1`, [ok.body.data.payout.id]), /cannot be deleted/);
  // a cash payout of a closed shift stays: the Z-report is final
  const p2 = await manager.post('/referral-payouts', { partner_id: partner, amount: 5_000_00, method: 'cash', shift_id: shift }, key());
  assert.equal(p2.status, 201);
  assert.equal((await manager.post(`/cash-shifts/${shift}/close`, { counted_cash: 45_000_00 })).status, 200);
  const closed = await manager.post(`/referral-payouts/${p2.body.data.payout.id}/void`, { reason: 'Kech' });
  assert.equal(closed.status, 409); assert.equal(closed.body.error.code, 'SHIFT_CLOSED');
  assert.equal((await manager.post('/referral-payouts', { partner_id: partner, amount: 1_00, method: 'cash', shift_id: shift }, key())).status, 409, 'yopilgan smenadan naqd chiqmaydi');
  // a bank transfer needs no drawer; the list is paginated with a total of active payouts
  assert.equal((await manager.post('/referral-payouts', { partner_id: partner, amount: 2_000_00, method: 'transfer', branch_id: central }, key())).status, 201);
  const list = (await manager.get(`/referral-payouts?from=${today}&to=${today}&partner_id=${partner}&page_size=2`)).body;
  assert.equal(list.meta.count, 3); assert.equal(list.data.length, 2); assert.equal(list.meta.total, 7_000_00);
});

test('«Manbalar bo‘yicha»: tushum dashboard bilan bir xil, jami = qatorlar yig‘indisi; CSV; dashboard kartasi', async () => {
  for (const period of ['today', '30d']) {
    const rep = (await manager.get(`/reports/lead-sources?period=${period}`)).body;
    const dash = (await manager.get(`/dashboard?period=${period}`)).body.data;
    assert.equal(rep.meta.totals.revenue, dash.kpi.revenue, `${period}: tushum = dashboard`);
    for (const k of ['new_patients', 'booked', 'came', 'revenue', 'checks']) assert.equal(rep.meta.totals[k], rep.data.reduce((a, x) => a + x[k], 0), `${period} ${k}`);
    assert.ok(rep.data.every((x) => x.conversion === null || (x.conversion >= 0 && x.conversion <= 100)));
    assert.equal(dash.new_patient_sources.reduce((a, x) => a + x.n, 0) <= rep.meta.totals.new_patients, true);
  }
  const month = (await manager.get('/reports/lead-sources?period=30d')).body;
  const referral = month.data.find((x) => x.system_key === 'referral');
  assert.ok(referral && referral.came > 10 && referral.revenue > 0, 'yo‘llanma manbasi tushum keltirgan');
  assert.ok(month.data.find((x) => x.name === 'Instagram').came > 0);
  const csv = await manager.get(`/reports/lead-sources/export.csv?from=${today}&to=${today}`);
  assert.equal(csv.status, 200);
  const today_ = (await manager.get(`/reports/lead-sources?from=${today}&to=${today}`)).body;
  const cl = csvLines(csv.text);
  assert.equal(cl.length, 1 + today_.data.length + 1); assert.match(cl.at(-1), /^"Jami"/);
  assert.equal((await manager.get(`/reports/lead-sources/export.csv?from=2024-01-01&to=${today}`)).status, 422);
  // the registrar may change a card's source (audited), a doctor may not
  const pid = S.patient;
  assert.equal((await registrar.patch(`/patients/${pid}`, { lead_source_id: await source('google') })).status, 200);
  assert.ok((await sql(`SELECT 1 FROM audit_logs WHERE resource_id = $1 AND action = 'patient.update' AND summary LIKE '%lead_source_id%'`, [pid])).length);
  await doctor.patch(`/patients/${pid}`, { lead_source_id: await source('other') });
  assert.equal((await registrar.get(`/patients/${pid}`)).body.data.lead_source_id, await source('google'), 'shifokor manbani o‘zgartirmaydi');
});

test('backfill: migratsiyadan oldingi demo bazaga hamkorlar bir marta qo‘shiladi (idempotent)', async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // a database seeded before migration 041: no partners, no sources on cards/visits/orders
    await c.query(`ALTER TABLE partner_payouts DISABLE TRIGGER partner_payouts_immutable`);
    await c.query(`DELETE FROM partner_payouts`); await c.query(`DELETE FROM referral_partner_services`);
    await c.query(`UPDATE service_orders SET referral_partner_id = NULL, partner_percent_snapshot = 0`);
    await c.query(`UPDATE appointments SET referral_partner_id = NULL, lead_source_id = NULL`);
    await c.query(`UPDATE patients SET lead_source_id = NULL`);
    await c.query(`UPDATE services SET partner_percent = NULL`);
    await c.query(`DELETE FROM referral_partners`); await c.query(`DELETE FROM lead_sources`);
    await c.query(`ALTER TABLE partner_payouts ENABLE TRIGGER partner_payouts_immutable`);
    const n = await db.backfillSeedReferrals(c, '2026-10-18');
    assert.equal(n, 8);
    assert.equal(await db.backfillSeedReferrals(c, '2026-10-18'), 0, 'ikkinchi marta hech narsa');
    const [r] = (await c.query(`SELECT (SELECT count(*) FROM referral_partners)::int AS p, (SELECT count(*) FROM lead_sources WHERE tenant_id = $1)::int AS s,
      (SELECT count(*) FROM appointments WHERE referral_partner_id IS NOT NULL)::int AS a, (SELECT count(*) FROM service_orders WHERE partner_percent_snapshot > 0)::int AS o,
      (SELECT count(*) FROM partner_payouts)::int AS pay`, [SEED_IDS.tenant])).rows;
    assert.ok(r.p === 8 && r.s === 10 && r.a > 20 && r.o > 20 && r.pay >= 4, JSON.stringify(r));
    await c.query('ROLLBACK');
  } finally { c.release(); }
});
