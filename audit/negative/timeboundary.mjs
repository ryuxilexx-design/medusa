// Tashkent midnight: payments at 23:59 and 00:00 local, refunds on the next day; dashboard, finance summary,
// payments register and the AI report must put each in the same local day and agree. Moves the demo clock of the
// ISOLATED meduza_neg_test database only.
import { login, reset, M, record, summary, short, key, pool, SEED_IDS } from './lib.mjs';
const CENTRAL = SEED_IDS.branchCentral;
const AKMAL = 'e868c980-e2d8-554d-a01a-273d42be7913', CONSULT = '891f37ae-4e84-58e9-8f8d-a146b6bac8d3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await reset();
await pool.query(`UPDATE demo_clock SET demo_anchor = '2026-10-18T23:59:25+05:00', real_anchor = clock_timestamp(), set_reason = 'audit'`);
const m = await login(M.manager), cash = await login(M.cashier), reg = await login(M.registrar);
console.log('now', (await m.get('/me')).body.data.now, 'today', (await m.get('/me')).body.data.today);
const pats = (await reg.get('/patients?page_size=60')).body.data;
// a booking for tomorrow 08:00 made before midnight
const bk = await reg.post('/appointments', { patient_id: pats[33].id, branch_id: CENTRAL, doctor_id: AKMAL, service_id: CONSULT, date: '2026-10-19', start_time: '08:00' });
console.log('book tomorrow 08:00:', short(bk));
const early = bk.status === 201 ? await reg.post(`/appointments/${bk.body.data.id}/check-in`, {}) : null;
if (early) record('TB-0', early.status === 409, 'check-in of tomorrow’s booking at 23:59 → 409 NOT_TODAY', short(early));
const invs = (await m.get(`/invoices?status=unpaid&page_size=100&branch_id=${CENTRAL}`)).body.data.filter((i) => i.due >= 300000);
const X = invs[0], Y = invs[1];
const px = await cash.post(`/invoices/${X.id}/payments`, { amount: 100000, method: 'card' }, key());
console.log('pay X at', px.body.data?.payment?.paid_at, px.status);
// wait for local midnight
for (;;) { const t = (await m.get('/me')).body.data; if (t.today === '2026-10-19') { console.log('crossed midnight at', t.now); break; } await sleep(1000); }
await sleep(2000);
const py = await cash.post(`/invoices/${Y.id}/payments`, { amount: 200000, method: 'card' }, key());
console.log('pay Y at', py.body.data?.payment?.paid_at, py.status);
const rf = await m.post(`/invoices/${X.id}/refunds`, { payment_id: px.body.data.payment.id, amount: 30000, method: 'card', reason_code: 'other', reason: 'midnight refund' }, key());
console.log('refund X at', rf.body.data?.refund?.refunded_at, rf.status);
if (bk.status === 201) {
  const ci = await reg.post(`/appointments/${bk.body.data.id}/check-in`, {});
  record('TB-1', ci.status === 200 && ci.body.data.queue_number === 1, 'after midnight: check-in allowed, queue number restarts at 1 for the new local day', short(ci));
}

const day = async (d) => {
  const dash = (await m.get(`/dashboard?from=${d}&to=${d}`)).body.data.kpi;
  const fin = (await m.get(`/finance/summary?from=${d}&to=${d}`)).body.data;
  const pay = (await m.get(`/payments?from=${d}&to=${d}&page_size=100`)).body.meta;
  return { dash_rev: dash.revenue, dash_ref: dash.refunds, dash_n: dash.payments, fin_net: fin.net_revenue, fin_gross: fin.payments.total, fin_ref: fin.refunds.total, pay_sum: pay.sum, pay_n: pay.total };
};
const d18 = await day('2026-10-18'), d19 = await day('2026-10-19');
console.log('2026-10-18', d18); console.log('2026-10-19', d19);
const both = (await m.get('/dashboard?from=2026-10-18&to=2026-10-19')).body.data;
console.log('daily', JSON.stringify(both.daily));
const ai = (await m.post('/ai/report-explanation', { question: 'revenue_today' })).body.data;
console.log('ai', JSON.stringify(ai.facts));
// the 23:59 payment is on the 18th, the 00:00 payment and the refund on the 19th
const p18 = await pool.query(`SELECT count(*)::int n FROM payments WHERE id = $1 AND (paid_at AT TIME ZONE 'Asia/Tashkent')::date = '2026-10-18'`, [px.body.data.payment.id]);
record('TB-2', p18.rows[0].n === 1, '23:59 payment is stored on 2026-10-18 local', '');
record('TB-3', d18.dash_rev === d18.fin_net && d18.fin_gross === d18.pay_sum, '2026-10-18: dashboard revenue = finance net, finance gross = payments register', JSON.stringify(d18));
record('TB-4', d19.dash_rev === d19.fin_net && d19.fin_gross === d19.pay_sum && d19.fin_ref === 30000, '2026-10-19: dashboard = finance net; refund counted on the 19th', JSON.stringify(d19));
record('TB-5', ai.facts.revenue === d19.fin_net && ai.facts.date === '2026-10-19', 'AI report revenue_today = finance net for the new day', JSON.stringify(ai.facts));
const s18 = both.daily.find((x) => x.date === '2026-10-18'), s19 = both.daily.find((x) => x.date === '2026-10-19');
record('TB-6', s18?.revenue === d18.dash_rev && s19?.revenue === d19.dash_rev && both.kpi.revenue === d18.dash_rev + d19.dash_rev, 'dashboard daily series matches per-day KPIs and the 2-day total', JSON.stringify({ s18, s19, total: both.kpi.revenue }));
// invoice created at 23:59 belongs to the 18th in the invoice list filter
const inv19 = (await m.get(`/invoices?from=2026-10-19&to=2026-10-19&page_size=100`)).body.data.map((i) => i.id);
record('TB-7', !inv19.includes(X.id), 'invoice list day filter uses local day', '');
summary(); await pool.end();
