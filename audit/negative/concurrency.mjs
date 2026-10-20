// Concurrency races: N parallel identical (or conflicting) requests, then DB invariants. Isolated API only.
import { login, reset, M, record, summary, short, key, pool, SEED_IDS } from './lib.mjs';
const CENTRAL = SEED_IDS.branchCentral, YUN = SEED_IDS.branchYunusobod;
const AKMAL = 'e868c980-e2d8-554d-a01a-273d42be7913', AKMAL_M = '4142700f-c111-5c02-9c43-85ee316374e9';
const CONSULT = '891f37ae-4e84-58e9-8f8d-a146b6bac8d3';
const N = Number(process.env.N || 30);
const tally = (rs) => rs.reduce((a, r) => { const k = r.status + (r.body?.error?.code ? ':' + r.body.error.code : ''); a[k] = (a[k] || 0) + 1; return a; }, {});
const q1 = async (sql, p) => (await pool.query(sql, p)).rows;

await reset();
const m = await login(M.manager), reg = await login(M.registrar), cash = await login(M.cashier), doc = await login(AKMAL_M), lab = await login(M.lab);
const regs = await Promise.all([M.registrar, M.registrar, M.registrar, M.manager].map((x) => login(x)));
const me = (await reg.get('/me')).body.data; const today = me.today;
const patients = (await reg.get('/patients?page_size=100')).body.data;
async function freeSlots(date) {
  const av = (await reg.get(`/availability?doctor_id=${AKMAL}&date=${date}&service_id=${CONSULT}`)).body.data;
  return av.slots.filter((s) => s.free && !s.past).map((s) => s.time);
}
const book = (s, p, date, time, h = key()) => s.post('/appointments', { patient_id: p.id, branch_id: CENTRAL, doctor_id: AKMAL, service_id: CONSULT, date, start_time: time }, h);

// ---------------- C1: same slot booked by several registrars (different keys, different patients)
{
  const slot = (await freeSlots('2026-10-19'))[0];
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => book(regs[i % regs.length], patients[i], '2026-10-19', slot)));
  const t = tally(rs);
  const rows = await q1(`SELECT count(*)::int n FROM appointments WHERE doctor_id = $1 AND starts_at = $2 AND status <> 'cancelled'`, [AKMAL, new Date(`2026-10-19T${slot}:00+05:00`)]);
  record('C1', (t['201'] === 1) && rows[0].n === 1 && !Object.keys(t).some((k) => k.startsWith('5')), `same slot ×${N}: exactly one booking`, JSON.stringify(t) + ' rows=' + rows[0].n);
}
// ---------------- C2: same booking replayed with the same Idempotency-Key
{
  const slot = (await freeSlots('2026-10-19'))[0];
  const h = { 'Idempotency-Key': 'race-booking-key-1' };
  const rs = await Promise.all(Array.from({ length: N }, () => book(reg, patients[40], '2026-10-19', slot, h)));
  const ids = new Set(rs.filter((r) => r.status < 300).map((r) => r.body.data.id));
  record('C2', ids.size === 1 && rs.every((r) => r.status < 300), `same booking key ×${N}: one appointment, all succeed`, JSON.stringify(tally(rs)) + ' ids=' + ids.size);
}
// ---------------- C3: parallel check-in of one appointment + many appointments at once (queue numbers)
{
  const slots = (await freeSlots(today)).slice(0, 8);
  const ids = [];
  for (let i = 0; i < slots.length; i++) { const r = await book(reg, patients[50 + i], today, slots[i]); if (r.status === 201) ids.push(r.body.data.id); }
  const one = ids.shift();
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => regs[i % regs.length].post(`/appointments/${one}/check-in`, {})));
  const tickets = await q1(`SELECT count(*)::int n FROM queue_tickets WHERE appointment_id = $1`, [one]);
  const invs = await q1(`SELECT count(*)::int n FROM invoices WHERE appointment_id = $1 AND status <> 'void'`, [one]);
  const nums = new Set(rs.filter((r) => r.status === 200).map((r) => r.body.data.queue_number));
  record('C3a', tickets[0].n === 1 && invs[0].n === 1 && nums.size === 1 && rs.every((r) => r.status === 200), `check-in one appointment ×${N}: one ticket, one invoice, one number`, JSON.stringify(tally(rs)) + ` tickets=${tickets[0].n} invoices=${invs[0].n} nums=${[...nums]}`);
  const rs2 = await Promise.all(ids.map((id, i) => regs[i % regs.length].post(`/appointments/${id}/check-in`, {})));
  const dup = await q1(`SELECT branch_id, local_date, number, count(*)::int c FROM queue_tickets GROUP BY 1,2,3 HAVING count(*) > 1`);
  record('C3b', rs2.every((r) => r.status === 200) && dup.length === 0, `check-in ${ids.length} different appointments at once: unique queue numbers`, JSON.stringify(tally(rs2)) + ' dups=' + JSON.stringify(dup));
}
// ---------------- C4: double payment, same key and different keys
const shift = (await cash.get('/cash-shifts/current')).body.data;
const unpaid = async (min = 1, skip = []) => (await m.get(`/invoices?status=unpaid&page_size=100&branch_id=${CENTRAL}`)).body.data.filter((i) => i.due >= min && !skip.includes(i.id));
const used = [];
{
  const inv = (await unpaid(10000))[0]; used.push(inv.id);
  const h = key();
  const rs = await Promise.all(Array.from({ length: N }, () => cash.post(`/invoices/${inv.id}/payments`, { amount: inv.due, method: 'cash' }, h)));
  const pays = await q1(`SELECT count(*)::int n, coalesce(sum(amount),0)::bigint s FROM payments WHERE invoice_id = $1`, [inv.id]);
  record('C4a', pays[0].n === 1 && rs.every((r) => r.status === 201 || r.status === 200), `same Idempotency-Key ×${N}: one payment`, JSON.stringify(tally(rs)) + ` payments=${pays[0].n}`);
  const inv2 = (await unpaid(10000, used))[0]; used.push(inv2.id);
  const rs2 = await Promise.all(Array.from({ length: N }, () => cash.post(`/invoices/${inv2.id}/payments`, { amount: inv2.due, method: 'card' }, key())));
  const p2 = (await q1(`SELECT count(*)::int n, coalesce(sum(amount),0)::bigint s FROM payments WHERE invoice_id = $1`, [inv2.id]))[0];
  const i2 = (await q1(`SELECT total, paid_amount FROM invoices WHERE id = $1`, [inv2.id]))[0];
  record('C4b', p2.n === 1 && i2.paid_amount <= i2.total, `different keys, full amount ×${N}: one payment, paid ≤ total`, JSON.stringify(tally(rs2)) + ` payments=${p2.n} paid=${i2.paid_amount} total=${i2.total}`);
  // partial amounts that together exceed the due
  const inv3 = (await unpaid(100000, used))[0]; used.push(inv3.id);
  const part = Math.ceil(inv3.due / 5);
  const rs3 = await Promise.all(Array.from({ length: N }, () => cash.post(`/invoices/${inv3.id}/payments`, { amount: part, method: 'card' }, key())));
  const i3 = (await q1(`SELECT total, paid_amount, (SELECT coalesce(sum(amount),0)::bigint FROM payments WHERE invoice_id = $1) s FROM invoices WHERE id = $1`, [inv3.id]))[0];
  record('C4c', i3.paid_amount <= i3.total && i3.s === i3.paid_amount, `partial payments ×${N} exceeding due: paid ≤ total, sum(payments)=paid`, JSON.stringify(tally(rs3)) + ` paid=${i3.paid_amount} total=${i3.total} sum=${i3.s}`);
}
// ---------------- C5: parallel refunds of one payment exceeding it
let refundPay;
{
  const inv = (await unpaid(100000, used))[0]; used.push(inv.id);
  const p = await cash.post(`/invoices/${inv.id}/payments`, { amount: inv.due, method: 'card' }, key());
  refundPay = { inv: inv.id, pay: p.body.data.payment.id, amount: inv.due };
  const part = Math.ceil(inv.due / 4);
  const rs = await Promise.all(Array.from({ length: N }, () => m.post(`/invoices/${inv.id}/refunds`, { payment_id: refundPay.pay, amount: part, method: 'card', reason_code: 'other', reason: 'race test' }, key())));
  const r = (await q1(`SELECT coalesce(sum(amount),0)::bigint s, count(*)::int n FROM refunds WHERE payment_id = $1`, [refundPay.pay]))[0];
  const i = (await q1(`SELECT total, paid_amount, credit_amount FROM invoices WHERE id = $1`, [inv.id]))[0];
  record('C5', r.s <= inv.due && i.paid_amount >= 0 && i.paid_amount <= i.total, `refunds ×${N} of ${part} on payment ${inv.due}: total refunded ≤ payment`, JSON.stringify(tally(rs)) + ` refunded=${r.s} n=${r.n} inv=${JSON.stringify(i)}`);
}
// ---------------- C6: cash leaving one drawer in parallel (cashier expenses) — INSUFFICIENT_CASH must hold
{
  const cur = (await cash.get('/cash-shifts/current')).body.data;
  const avail = cur.expected_cash;
  const amt = Math.max(1, Math.floor(avail * 0.6));
  const rs = await Promise.all(Array.from({ length: 10 }, () => cash.post('/expenses', { category: 'Boshqa', amount: amt, note: 'race' })));
  const after = (await cash.get('/cash-shifts/current')).body.data;
  record('C6', after.expected_cash >= 0, `cashier drawer expenses ×10 of 60% of ${avail}: drawer never negative`, JSON.stringify(tally(rs)) + ` expected_cash after=${after.expected_cash}`);
}
// ---------------- C7: manager cash refunds from one drawer in parallel (different invoices)
{
  const c2 = await login(M.cashier2); // Yunusobod drawer
  const s2 = (await c2.get('/cash-shifts/current')).body.data;
  // card payments on several Yunusobod invoices, then refund each in CASH from the same drawer at once
  const invs = (await m.get(`/invoices?status=unpaid&page_size=100&branch_id=${YUN}`)).body.data.filter((i) => i.due > 0).slice(0, 8);
  const pays = [];
  for (const inv of invs) { const p = await c2.post(`/invoices/${inv.id}/payments`, { amount: inv.due, method: 'card' }, key()); if (p.status === 201) pays.push({ inv: inv.id, pay: p.body.data.payment.id, amount: inv.due }); }
  const cur = (await c2.get(`/cash-shifts/current`)).body.data;
  const each = Math.min(...pays.map((p) => p.amount), Math.floor(cur.expected_cash * 0.6));
  const rs = await Promise.all(pays.map((p) => m.post(`/invoices/${p.inv}/refunds`, { payment_id: p.pay, amount: each, method: 'cash', reason_code: 'other', reason: 'drawer race', shift_id: s2.id }, key())));
  const after = (await c2.get('/cash-shifts/current')).body.data;
  record('C7', after.expected_cash >= 0, `cash refunds ×${pays.length} of ${each} from a drawer holding ${cur.expected_cash}: drawer never negative`, JSON.stringify(tally(rs)) + ` expected_cash after=${after.expected_cash}`);
}
// ---------------- C8: shift close racing payments
{
  const c2 = await login(M.cashier2);
  const s = (await c2.get('/cash-shifts/current')).body.data;
  if (!s) { await c2.post('/cash-shifts', { branch_id: YUN, opening_cash: 1000000 }); }
  const sh = (await c2.get('/cash-shifts/current')).body.data;
  const invs = (await m.get(`/invoices?status=unpaid&page_size=100&branch_id=${YUN}`)).body.data.filter((i) => i.due > 0).slice(0, 10);
  const pays = invs.map((inv) => c2.post(`/invoices/${inv.id}/payments`, { amount: inv.due, method: 'cash' }, key()));
  const close = c2.post(`/cash-shifts/${sh.id}/close`, { counted_cash: sh.expected_cash, note: 'race close' });
  const rs = await Promise.all([...pays, close]);
  const row = (await q1(`SELECT status, expected_cash, totals FROM cash_shifts WHERE id = $1`, [sh.id]))[0];
  const live = (await q1(`SELECT coalesce(sum(amount),0)::bigint s, count(*)::int n FROM payments WHERE shift_id = $1 AND method = 'cash'`, [sh.id]))[0];
  const frozen = row.totals?.payments?.cash?.sum;
  record('C8', row.status === 'closed' && frozen === live.s, 'shift close racing 10 cash payments: frozen totals = payments in the shift', `${JSON.stringify(tally(rs))} frozen=${frozen} live=${live.s}`);
}
// ---------------- C9: inventory out exceeding stock in parallel
{
  const items = (await m.get('/inventory')).body.data;
  const it = items.find((x) => x.qty >= 2) ?? items[0];
  const qty = Number(it.qty);
  const each = Math.max(1, Math.floor(qty / 2));
  const rs = await Promise.all(Array.from({ length: 20 }, () => m.post(`/inventory/${it.id}/movements`, { type: 'out', quantity: each, reason: 'race out' })));
  const after = (await m.get(`/inventory/${it.id}`)).body.data;
  record('C9', Number(after.qty) >= 0, `inventory out ×20 of ${each} with stock ${qty}: stock never negative`, `${JSON.stringify(tally(rs))} qty after=${after.qty} (${it.name})`);
}
// ---------------- C10: face codes + consent races
{
  const rs = await Promise.all(Array.from({ length: 20 }, () => m.post('/cameras/face-codes', { membership_id: M.registrar2, consent_confirmed: true })));
  const live = await q1(`SELECT count(*)::int n FROM face_codes WHERE membership_id = $1 AND revoked_at IS NULL`, [M.registrar2]);
  record('C10a', live[0].n === 1, 'staff face code ×20: one live code', `${JSON.stringify(tally(rs))} live=${live[0].n}`);
  const p = patients[70];
  const rs2 = await Promise.all(Array.from({ length: 20 }, (_, i) => reg.post(`/patients/${p.id}/consents`, { kind: 'biometric', granted: i % 2 === 0, method: 'signed_paper' })));
  const last = (await q1(`SELECT granted FROM patient_consents WHERE patient_id = $1 AND kind = 'biometric' ORDER BY recorded_at DESC, seq DESC LIMIT 1`, [p.id]))[0];
  const fc = (await q1(`SELECT count(*)::int n FROM face_codes WHERE patient_id = $1 AND revoked_at IS NULL`, [p.id]))[0];
  record('C10b', (last.granted ? 1 : 0) === fc.n, 'biometric grant/withdraw ×20 interleaved: live face code matches latest consent', `${JSON.stringify(tally(rs2))} latest=${last.granted} live_codes=${fc.n}`);
}
// ---------------- C11: arrival suggestion accepted in parallel
{
  const p = patients[71];
  await reg.post(`/patients/${p.id}/consents`, { kind: 'biometric', granted: true, method: 'signed_paper' });
  const slot = (await freeSlots(today))[0];
  const ap = await book(reg, p, today, slot);
  const cams = (await m.get('/cameras')).body.data.filter((c) => c.branch_id === CENTRAL && c.purposes.includes('patient_arrival') && c.status === 'active');
  const sim = await m.post(`/cameras/${cams[0].id}/simulate`, { kind: 'face_match', code: 'P-' + p.patient_number });
  const sug = (await reg.get('/cameras/arrivals')).body.data.find((s) => s.appointment_id === ap.body.data?.id);
  if (!sug) record('C11', false, 'arrival suggestion created', short(sim) + ' slot=' + slot);
  else {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => regs[i % regs.length].post(`/cameras/arrivals/${sug.id}/accept`)));
    const t = (await q1(`SELECT count(*)::int n FROM queue_tickets WHERE appointment_id = $1`, [ap.body.data.id]))[0];
    record('C11', t.n === 1 && tally(rs)['200'] === 1, 'arrival accept ×20: one check-in, others 409', `${JSON.stringify(tally(rs))} tickets=${t.n}`);
  }
}
// ---------------- C12: duplicate patient created in parallel
{
  const body = { last_name: 'Parallelov', first_name: 'Ikkinchi', birth_date: '1991-05-05', phone: '+998901112233' };
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => regs[i % regs.length].post('/patients', body)));
  const n = (await q1(`SELECT count(*)::int n FROM patients WHERE last_name = 'Parallelov'`))[0].n;
  record('C12', n === 1, 'same new patient ×10 in parallel without confirm_duplicate: one card, rest DUPLICATE_WARNING', `${JSON.stringify(tally(rs))} cards=${n}`);
}
// ---------------- C13: staff with the same login in parallel
{
  const rs = await Promise.all(Array.from({ length: 10 }, () => m.post('/staff', { full_name: 'Race Kassir', role: 'cashier', login: 'race.login', branch_ids: [CENTRAL] })));
  const n = (await q1(`SELECT count(*)::int n FROM users WHERE login = 'race.login'`))[0].n;
  record('C13', n === 1 && tally(rs)['201'] === 1 && !Object.keys(tally(rs)).some((k) => k.startsWith('5')), 'staff same login ×10: one created, others 409 LOGIN_TAKEN', `${JSON.stringify(tally(rs))} users=${n}`);
}
// ---------------- C14: sign the same note in parallel; orders in parallel
{
  const slot = (await freeSlots(today))[0];
  const ap = (await book(reg, patients[72], today, slot)).body.data.id;
  await reg.post(`/appointments/${ap}/check-in`, {});
  const enc = (await doc.post(`/appointments/${ap}/start`)).body.data.encounter_id;
  const labSvc = (await m.get('/services?category=lab')).body.data[0];
  const ro = await Promise.all(Array.from({ length: 15 }, () => doc.post(`/encounters/${enc}/orders`, { service_ids: [labSvc.id] })));
  const no = (await q1(`SELECT count(*)::int n FROM service_orders WHERE encounter_id = $1 AND service_id = $2`, [enc, labSvc.id]))[0].n;
  record('C14a', no === 1, 'same lab order ×15: one order', `${JSON.stringify(tally(ro))} orders=${no}`);
  const note = { version: 1, complaints: 'a', examination: 'b', diagnosis: 'c', recommendations: 'd' };
  const rs = await Promise.all(Array.from({ length: 15 }, () => doc.post(`/encounters/${enc}/sign`, note)));
  record('C14b', tally(rs)['200'] === 1, 'sign ×15: exactly one 200', JSON.stringify(tally(rs)));
}
// ---------------- C15: payment racing void / discount
{
  const inv = (await unpaid(10000, used))[0]; used.push(inv.id);
  const rs = await Promise.all([
    ...Array.from({ length: 5 }, () => cash.post(`/invoices/${inv.id}/payments`, { amount: 100, method: 'card' }, key())),
    m.post(`/invoices/${inv.id}/void`, { reason: 'race void' }),
    m.post(`/invoices/${inv.id}/discount`, { type: 'percent', value: 50, reason: 'race discount' }),
  ]);
  const i = (await q1(`SELECT status, total, paid_amount, subtotal, discount_amount FROM invoices WHERE id = $1`, [inv.id]))[0];
  const ok = i.paid_amount <= i.total && (i.status !== 'void' || i.paid_amount === 0) && i.total === i.subtotal - i.discount_amount;
  record('C15', ok, 'payment ×5 racing void + discount: invariants hold', `${JSON.stringify(tally(rs))} inv=${JSON.stringify(i)}`);
}

// ---------------- global invariants
const inv1 = await q1(`SELECT id, total, paid_amount, credit_amount, status FROM invoices WHERE paid_amount > total OR paid_amount < 0 OR (status = 'void' AND paid_amount > 0)`);
record('INV-A', inv1.length === 0, 'no invoice with paid > total / negative / paid void', JSON.stringify(inv1.slice(0, 3)));
const inv2 = await q1(`SELECT i.id, i.paid_amount, coalesce(p.s,0) - coalesce(r.s,0) AS net FROM invoices i
  LEFT JOIN (SELECT invoice_id, sum(amount) s FROM payments GROUP BY 1) p ON p.invoice_id = i.id LEFT JOIN (SELECT invoice_id, sum(amount) s FROM refunds GROUP BY 1) r ON r.invoice_id = i.id
  WHERE i.paid_amount <> coalesce(p.s,0) - coalesce(r.s,0)`);
record('INV-B', inv2.length === 0, 'paid_amount = Σpayments − Σrefunds for every invoice', JSON.stringify(inv2.slice(0, 3)));
const inv3 = await q1(`SELECT i.id, i.subtotal, s.s FROM invoices i JOIN (SELECT invoice_id, sum(line_subtotal) s FROM invoice_items GROUP BY 1) s ON s.invoice_id = i.id WHERE i.subtotal <> s.s`);
record('INV-C', inv3.length === 0, 'invoice subtotal = Σ line_subtotal', JSON.stringify(inv3.slice(0, 3)));
const inv4 = await q1(`SELECT i.id FROM invoices i JOIN (SELECT invoice_id, sum(discount_share) s FROM invoice_items GROUP BY 1) s ON s.invoice_id = i.id WHERE i.discount_amount <> s.s`);
record('INV-D', inv4.length === 0, 'invoice discount = Σ discount_share', JSON.stringify(inv4.slice(0, 3)));
const rf = await q1(`SELECT p.id, p.amount, sum(r.amount) s FROM payments p JOIN refunds r ON r.payment_id = p.id GROUP BY 1,2 HAVING sum(r.amount) > p.amount`);
record('INV-E', rf.length === 0, 'Σrefunds per payment ≤ payment', JSON.stringify(rf));
const dupR = await q1(`SELECT tenant_id, receipt_number, count(*) FROM payments GROUP BY 1,2 HAVING count(*) > 1`);
record('INV-F', dupR.length === 0, 'unique receipt numbers', JSON.stringify(dupR));
const shifts = await q1(`SELECT s.id, s.number, s.opening_cash + coalesce((SELECT sum(amount) FROM payments WHERE shift_id = s.id AND method='cash'),0)
    - coalesce((SELECT sum(amount) FROM refunds WHERE shift_id = s.id AND method='cash'),0)
    - coalesce((SELECT sum(amount) FROM expenses WHERE shift_id = s.id AND status='active' AND paid_from='cash_drawer'),0) AS cash FROM cash_shifts s`);
const neg = shifts.filter((s) => Number(s.cash) < 0);
record('INV-G', neg.length === 0, 'no drawer with negative expected cash', JSON.stringify(neg));
const stock = await q1(`SELECT i.id, i.name, i.opening_qty + coalesce(sum(CASE WHEN m.type='in' THEN m.quantity ELSE -m.quantity END),0) q FROM inventory_items i LEFT JOIN inventory_movements m ON m.item_id = i.id GROUP BY i.id HAVING i.opening_qty + coalesce(sum(CASE WHEN m.type='in' THEN m.quantity ELSE -m.quantity END),0) < 0`);
record('INV-H', stock.length === 0, 'no negative stock', JSON.stringify(stock));
summary();
await pool.end();
