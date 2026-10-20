// Extra state/race checks: cancelled visit billing, reschedule/cancel/check-in races, key reuse across invoices, expense void race.
import { login, reset, M, record, summary, short, key, pool, SEED_IDS } from './lib.mjs';
const CENTRAL = SEED_IDS.branchCentral;
const AKMAL = 'e868c980-e2d8-554d-a01a-273d42be7913', AKMAL_M = '4142700f-c111-5c02-9c43-85ee316374e9', CONSULT = '891f37ae-4e84-58e9-8f8d-a146b6bac8d3';
const tally = (rs) => rs.reduce((a, r) => { const k = r.status + (r.body?.error?.code ? ':' + r.body.error.code : ''); a[k] = (a[k] || 0) + 1; return a; }, {});
await reset();
const m = await login(M.manager), reg = await login(M.registrar), regB = await login(M.registrar), cash = await login(M.cashier), doc = await login(AKMAL_M);
const today = (await reg.get('/me')).body.data.today;
const pats = (await reg.get('/patients?page_size=90')).body.data;
const free = async (date) => (await reg.get(`/availability?doctor_id=${AKMAL}&date=${date}&service_id=${CONSULT}`)).body.data.slots.filter((s) => s.free && !s.past).map((s) => s.time);
async function book(p, date) { for (const t of await free(date)) { const r = await reg.post('/appointments', { patient_id: p.id, branch_id: CENTRAL, doctor_id: AKMAL, service_id: CONSULT, date, start_time: t }); if (r.status === 201) return r.body.data.id; } }

// E1: cancel an arrived (checked-in, unpaid) visit → what happens to its invoice / debt?
{
  const debt0 = (await m.get('/dashboard')).body.data.kpi.debt;
  const ap = await book(pats[80], today);
  const ci = (await reg.post(`/appointments/${ap}/check-in`, {})).body.data;
  const debt1 = (await m.get('/dashboard')).body.data.kpi.debt;
  const v = (await reg.get(`/appointments/${ap}`)).body.data.version;
  const cx = await reg.post(`/appointments/${ap}/cancel`, { version: v, reason: 'Bemor ketib qoldi' });
  const inv = (await m.get(`/invoices/${ci.invoice_id}`)).body.data;
  const debt2 = (await m.get('/dashboard')).body.data.kpi.debt;
  const pb = (await reg.get(`/patients/${pats[80].id}`)).body.data.balance_due;
  record('E1', inv.status === 'void' || debt2 === debt0, 'cancelling an arrived, unpaid visit must not leave the patient owing for the cancelled service',
    `cancel=${short(cx)} invoice=${inv.status} total=${inv.total} item_order_status=${inv.items.map((i) => i.order_status)} debt before=${debt0} after check-in=${debt1} after cancel=${debt2} patient balance_due=${pb}`);
}
// E2: reschedule the same appointment ×10 in parallel with the same version
{
  const ap = await book(pats[81], '2026-10-19');
  const v = (await reg.get(`/appointments/${ap}`)).body.data.version;
  const times = (await free('2026-10-19')).filter((t, i) => i % 3 === 0).slice(0, 10);
  const rs = await Promise.all(times.map((t, i) => (i % 2 ? reg : regB).patch(`/appointments/${ap}`, { version: v, start_time: t })));
  const after = (await reg.get(`/appointments/${ap}`)).body.data;
  record('E2', tally(rs)['200'] === 1 && after.version === v + 1, 'reschedule ×10 with one version: one wins, rest 409 STALE_STATE', `${JSON.stringify(tally(rs))} version ${v}→${after.version}`);
}
// E3: cancel racing check-in racing doctor start
{
  const ap = await book(pats[82], today);
  const v = (await reg.get(`/appointments/${ap}`)).body.data.version;
  const rs = await Promise.all([reg.post(`/appointments/${ap}/check-in`, { version: v }), regB.post(`/appointments/${ap}/cancel`, { version: v, reason: 'race' }), doc.post(`/appointments/${ap}/start`)]);
  const a = (await reg.get(`/appointments/${ap}`)).body.data;
  const t = (await pool.query(`SELECT count(*)::int n FROM queue_tickets WHERE appointment_id = $1`, [ap])).rows[0].n;
  const ok = (a.status === 'cancelled' && t === 0) || (a.status !== 'cancelled' && t === 1);
  record('E3', ok && !rs.some((r) => r.status >= 500), 'check-in ∥ cancel ∥ start: consistent final state', `${rs.map((r) => r.status + (r.body?.error?.code ? ':' + r.body.error.code : '')).join(', ')} → ${a.status}, tickets=${t}`);
}
// E4: one Idempotency-Key on two different invoices at the same time
{
  const invs = (await m.get(`/invoices?status=unpaid&page_size=50&branch_id=${CENTRAL}`)).body.data.filter((i) => i.due > 1000).slice(0, 2);
  const h = key();
  const rs = await Promise.all(invs.map((i) => cash.post(`/invoices/${i.id}/payments`, { amount: 1000, method: 'card' }, h)));
  record('E4', tally(rs)['201'] === 1 && !rs.some((r) => r.status >= 500), 'same Idempotency-Key on two invoices concurrently: one payment, the other rejected (no 500)', JSON.stringify(tally(rs)));
}
// E5: expense void ×10 in parallel
{
  const e = (await m.post('/expenses', { branch_id: CENTRAL, category: 'Boshqa', amount: 5000, paid_from: 'bank' })).body.data.id;
  const rs = await Promise.all(Array.from({ length: 10 }, () => m.post(`/expenses/${e}/void`, { reason: 'race void' })));
  record('E5', tally(rs)['200'] === 1, 'expense void ×10: one 200, rest 409 ALREADY_VOID', JSON.stringify(tally(rs)));
}
// E6: discount on an invoice with percent, then the doctor adds an order: is the new line discounted too?
{
  const ap = await book(pats[83], today);
  const ci = (await reg.post(`/appointments/${ap}/check-in`, {})).body.data;
  await m.post(`/invoices/${ci.invoice_id}/discount`, { type: 'percent', value: 50, reason: 'Only the consultation' });
  const enc = (await doc.post(`/appointments/${ap}/start`)).body.data.encounter_id;
  const lab = (await m.get('/services?category=lab')).body.data[0];
  await doc.post(`/encounters/${enc}/orders`, { service_ids: [lab.id] });
  const inv = (await m.get(`/invoices/${ci.invoice_id}`)).body.data;
  console.log('   E6 (observation): after manager approved 50% on the consultation, a later lab order on the same invoice:', JSON.stringify(inv.items.map((i) => [i.description, i.line_subtotal, i.discount_share])));
}
summary(); await pool.end();
