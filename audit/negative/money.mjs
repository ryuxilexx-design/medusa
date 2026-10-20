// Money: discount allocation on multi-line invoices, refund pro-rating (NET_LINE) vs invoice total,
// and agreement of debt / revenue numbers across dashboard, finance summary, reports and the AI report.
import { createRequire } from 'node:module';
import { login, reset, M, record, summary, short, key, pool, SEED_IDS } from './lib.mjs';
const require = createRequire(import.meta.url);
const { NET_LINE } = require('../../apps/api/dist/modules/billing.js');
const CENTRAL = SEED_IDS.branchCentral;
const AKMAL = 'e868c980-e2d8-554d-a01a-273d42be7913', AKMAL_M = '4142700f-c111-5c02-9c43-85ee316374e9', CONSULT = '891f37ae-4e84-58e9-8f8d-a146b6bac8d3';
await reset();
const m = await login(M.manager), reg = await login(M.registrar), cash = await login(M.cashier), doc = await login(AKMAL_M), lab = await login(M.lab);
const today = (await reg.get('/me')).body.data.today;
const pats = (await reg.get('/patients?page_size=80')).body.data;
const av = (await reg.get(`/availability?doctor_id=${AKMAL}&date=${today}&service_id=${CONSULT}`)).body.data;
const free = av.slots.filter((s) => s.free && !s.past).map((s) => s.time);
const labs = (await m.get('/services?category=lab')).body.data;

async function visitInvoice(i, nLabs) {
  let ap;
  while (!ap && free.length) { const r = await reg.post('/appointments', { patient_id: pats[60 + i].id, branch_id: CENTRAL, doctor_id: AKMAL, service_id: CONSULT, date: today, start_time: free.shift() }); if (r.status === 201) ap = r.body.data.id; }
  await reg.post(`/appointments/${ap}/check-in`, {});
  const enc = (await doc.post(`/appointments/${ap}/start`)).body.data.encounter_id;
  if (nLabs) await doc.post(`/encounters/${enc}/orders`, { service_ids: labs.slice(0, nLabs).map((s) => s.id) });
  const inv = (await m.get(`/appointments/${ap}`)).body.data.invoice;
  return { ap, enc, inv: (await m.get(`/invoices/${inv.id}`)).body.data };
}
const lines = async (id) => (await pool.query(`SELECT line_subtotal, discount_share, line_total FROM invoice_items WHERE invoice_id = $1 ORDER BY position`, [id])).rows;

// percent discount with an awkward rate over 3 lines
const v1 = await visitInvoice(0, 2);
const d1 = await m.post(`/invoices/${v1.inv.id}/discount`, { type: 'percent', value: 33.33, reason: 'Rounding test' });
const i1 = (await m.get(`/invoices/${v1.inv.id}`)).body.data; const l1 = await lines(v1.inv.id);
const sumLines = l1.reduce((a, b) => a + b.line_total, 0);
record('MON-1', d1.status === 200 && sumLines === i1.total && l1.every((x) => x.line_total >= 0 && x.discount_share >= 0) && i1.discount_amount === Math.round(i1.subtotal * 33.33 / 100),
  '33.33% discount on 3 lines: Σ line_total = total, no negative line, discount = round(subtotal×p)', JSON.stringify({ subtotal: i1.subtotal, discount: i1.discount_amount, total: i1.total, lines: l1 }));
// fixed amount that does not divide evenly
const v2 = await visitInvoice(1, 2);
await m.post(`/invoices/${v2.inv.id}/discount`, { type: 'amount', value: 100001, reason: 'Odd amount' });
const i2 = (await m.get(`/invoices/${v2.inv.id}`)).body.data; const l2 = await lines(v2.inv.id);
record('MON-2', l2.reduce((a, b) => a + b.discount_share, 0) === 100001 && l2.reduce((a, b) => a + b.line_total, 0) === i2.total, 'odd fixed discount: Σ shares = discount, Σ lines = total', JSON.stringify(l2));
// pay, refund an odd amount, then the pro-rated line values must still add up to the invoice total
const pay = await cash.post(`/invoices/${v2.inv.id}/payments`, { amount: i2.total, method: 'card' }, key());
await m.post(`/invoices/${v2.inv.id}/refunds`, { payment_id: pay.body.data.payment.id, amount: 33333, method: 'card', reason_code: 'other', reason: 'odd refund' }, key());
const net = (await pool.query(`SELECT i.total, sum(${NET_LINE})::bigint AS net FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id WHERE i.id = $1 GROUP BY i.total`, [v2.inv.id])).rows[0];
record('MON-3', Number(net.net) === Number(net.total), 'after an odd partial refund: Σ NET_LINE (service revenue) = invoice total', JSON.stringify(net));
// a refund on a 3-line invoice with no discount, several odd refunds
const v3 = await visitInvoice(2, 2);
const p3 = await cash.post(`/invoices/${v3.inv.id}/payments`, { amount: v3.inv.total, method: 'card' }, key());
for (const a of [1, 7, 33, 101]) await m.post(`/invoices/${v3.inv.id}/refunds`, { payment_id: p3.body.data.payment.id, amount: a, method: 'card', reason_code: 'other', reason: 'odd refund' }, key());
const net3 = (await pool.query(`SELECT i.total, sum(${NET_LINE})::bigint AS net, array_agg(${NET_LINE} ORDER BY it.position) AS per_line FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id WHERE i.id = $1 GROUP BY i.total`, [v3.inv.id])).rows[0];
record('MON-4', Number(net3.net) === Number(net3.total), '4 small refunds on a 3-line invoice: Σ NET_LINE = invoice total', JSON.stringify(net3));

// numbers that must agree across screens
const dash = (await m.get('/dashboard')).body.data;
const fin = (await m.get('/finance/summary')).body.data;
const ai = (await m.post('/ai/report-explanation', { question: 'debts' })).body.data.facts;
const debtList = (await m.get('/invoices?debt=1&page_size=1')).body.meta.sums.due;
record('MON-5', dash.kpi.revenue === fin.net_revenue, 'dashboard revenue = finance net revenue (today)', `${dash.kpi.revenue} vs ${fin.net_revenue}`);
record('MON-6', dash.kpi.debt === ai.debt && ai.debt === debtList, 'debt: dashboard = AI report = invoices?debt=1 sum', `${dash.kpi.debt} / ${ai.debt} / ${debtList}`);
const d30 = (await m.get('/dashboard?period=30d')).body.data;
const s30 = (await m.get('/reports/services?period=30d')).body;
const bySvc = d30.by_service.reduce((a, b) => a + b.value, 0);
record('MON-7', bySvc === s30.meta.total, 'dashboard by_service total = services report total (30d)', `${bySvc} vs ${s30.meta.total}`);
const top = (await m.post('/ai/report-explanation', { question: 'top_services' })).body.data.facts.top;
record('MON-8', top.every((t, i) => s30.data[i] && s30.data[i].service_name === t.service && Number(s30.data[i].value) === t.value), 'AI top services = services report top 3 (30d)', JSON.stringify({ top, rep: s30.data.slice(0, 3).map((x) => [x.service_name, x.value]) }));
const f30 = (await m.get('/finance/summary?period=30d')).body.data;
record('MON-9', d30.kpi.revenue === f30.net_revenue && d30.daily.reduce((a, b) => a + b.revenue, 0) === f30.net_revenue, '30d: dashboard revenue = Σ daily = finance net', `${d30.kpi.revenue} / ${d30.daily.reduce((a, b) => a + b.revenue, 0)} / ${f30.net_revenue}`);
// patient balance vs invoices
const pb = (await reg.get(`/patients/${pats[61].id}`)).body.data.balance_due;
const pbi = (await m.get(`/invoices?patient_id=${pats[61].id}&page_size=100`)).body.meta.sums.due;
record('MON-10', pb === pbi, 'patient card balance_due = Σ due of their invoices', `${pb} vs ${pbi}`);
summary(); await pool.end();
