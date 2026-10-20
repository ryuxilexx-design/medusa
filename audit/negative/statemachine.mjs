// Illegal state transitions, immutability, idempotency-key reuse. Isolated API only.
import { login, reset, M, record, summary, short, key, pool, SEED_IDS } from './lib.mjs';
const CENTRAL = SEED_IDS.branchCentral, YUN = SEED_IDS.branchYunusobod;
const AKMAL = 'e868c980-e2d8-554d-a01a-273d42be7913', AKMAL_M = '4142700f-c111-5c02-9c43-85ee316374e9';
const CONSULT = '891f37ae-4e84-58e9-8f8d-a146b6bac8d3';
function exp(id, r, ok, what) { record(id, ok.includes(r.status), what, short(r)); return r; }

await reset();
const m = await login(M.manager), reg = await login(M.registrar), cash = await login(M.cashier), lab = await login(M.lab), doc = await login(AKMAL_M);
const me = (await reg.get('/me')).body.data; const today = me.today; console.log('today', today, me.now);
const patients = (await reg.get('/patients?page_size=50')).body.data;
const P = patients[5];

async function freeSlot(date, after = '00:00') {
  const av = (await reg.get(`/availability?doctor_id=${AKMAL}&date=${date}&service_id=${CONSULT}`)).body.data;
  return av.slots.find((s) => s.free && !s.past && s.time > after)?.time;
}
async function book(date, time, patient = P, extra = {}, headers) {
  return reg.post('/appointments', { patient_id: patient.id, branch_id: CENTRAL, doctor_id: AKMAL, service_id: CONSULT, date, start_time: time, ...extra }, headers);
}

// ---- appointment lifecycle
const t1 = await freeSlot(today, '14:00');
const a1 = exp('SM-1', await book(today, t1), [201], `book today ${t1}`).body.data.id;
exp('SM-2', await doc.post(`/appointments/${a1}/start`), [409], 'start before arrive');
exp('SM-3', await doc.post(`/appointments/${a1}/complete`), [409], 'complete scheduled');
const tomorrow = '2026-10-19';
const a2 = exp('SM-4', await book(tomorrow, await freeSlot(tomorrow)), [201], 'book tomorrow').body.data.id;
exp('SM-5', await reg.post(`/appointments/${a2}/check-in`, {}), [409], 'check-in tomorrow → NOT_TODAY');
exp('SM-6', await reg.post(`/appointments/${a2}/no-show`, {}), [409], 'no-show future');
let v = (await reg.get(`/appointments/${a1}`)).body.data.version;
exp('SM-7', await reg.post(`/appointments/${a1}/check-in`, { version: v + 5 }), [409], 'check-in stale version');
const ci = exp('SM-8', await reg.post(`/appointments/${a1}/check-in`, { version: v }), [200], 'check-in');
exp('SM-9', await reg.post(`/appointments/${a1}/check-in`, {}), [200], 'check-in again (idempotent)');
v = (await reg.get(`/appointments/${a1}`)).body.data.version;
exp('SM-10', await reg.patch(`/appointments/${a1}`, { version: v, start_time: '16:00' }), [409], 'reschedule arrived');
exp('SM-11', await reg.post(`/appointments/${a1}/cancel`, { version: v }), [422], 'cancel arrived without reason');
exp('SM-12', await reg.post(`/appointments/${a1}/no-show`, { version: v }), [409], 'no-show arrived');
const other = await login(SEED_IDS.membership.doctor(3));
exp('SM-13', await other.post(`/appointments/${a1}/start`), [403, 404], 'other doctor starts');
const st = exp('SM-14', await doc.post(`/appointments/${a1}/start`), [200], 'start');
exp('SM-15', await doc.post(`/appointments/${a1}/start`), [200], 'start again (already)');
const enc = st.body.data.encounter_id;
exp('SM-16', await doc.post(`/appointments/${a1}/complete`), [409], 'complete without signed note');
const note = { version: 1, complaints: 'Bosh og‘rig‘i', examination: 'Normal', diagnosis: 'Migren', recommendations: 'Dam olish' };
exp('SM-17', await doc.post(`/encounters/${enc}/sign`, { ...note, diagnosis: '   ' }), [422], 'sign with whitespace diagnosis');
exp('SM-18', await doc.post(`/encounters/${enc}/sign`, { ...note, version: 99 }), [409], 'sign stale version');
exp('SM-19', await doc.post(`/encounters/${enc}/sign`, { ...note, icd10: ['Z99.99'] }), [422], 'sign with unknown ICD');
exp('SM-20', await doc.post(`/encounters/${enc}/sign`, note), [200], 'sign');
exp('SM-21', await doc.post(`/encounters/${enc}/sign`, { ...note, version: 2 }), [409], 'sign twice');
exp('SM-22', await doc.put(`/encounters/${enc}/draft`, { ...note, version: 2, diagnosis: 'changed' }), [409], 'edit signed note');
await pool.query(`UPDATE clinical_notes SET diagnosis = 'tamper' WHERE encounter_id = $1`, [enc]).then(
  () => record('SM-23', false, 'DB trigger: signed note UPDATE must fail', 'UPDATE succeeded'),
  (e) => record('SM-23', true, 'DB trigger: signed note UPDATE rejected', e.message));
const ap = (await reg.get(`/appointments/${a1}`)).body.data;
record('SM-24', ap.status === 'completed', 'sign completes appointment', ap.status);
exp('SM-25', await reg.post(`/appointments/${a1}/cancel`, { version: ap.version, reason: 'test' }), [409], 'cancel completed');
exp('SM-26', await reg.post(`/appointments/${a1}/no-show`, {}), [409], 'no-show completed');
exp('SM-27', await reg.patch(`/appointments/${a1}`, { version: ap.version, start_time: '16:30' }), [409], 'reschedule completed');
// orders after the visit is closed (encounter closed, note signed)
const labSvc = (await m.get('/services?category=lab')).body.data[0];
const late = await doc.post(`/encounters/${enc}/orders`, { service_ids: [labSvc.id] });
exp('SM-28', late, [409, 422], 'doctor adds order to a closed encounter (signed note, completed visit)');
const docs = await doc.post(`/encounters/${enc}/documents`, { kind: 'certificate', body: { purpose: 'Ish joyiga', include_diagnosis: true, rest_days: 3 } });
exp('SM-29', docs, [201], 'certificate with diagnosis after sign');
if (docs.status === 201) {
  exp('SM-30', await doc.post(`/documents/${docs.body.data.id}/void`, { reason: 'xato' }), [200], 'void document');
  exp('SM-31', await doc.post(`/documents/${docs.body.data.id}/void`, { reason: 'xato' }), [409], 'void document twice');
}

// ---- lab state machine
const lo = late.status === 201 ? late.body.data.order_ids[0] : null;
const labOrder = lo ?? (await lab.get('/orders?status=ordered&page_size=1')).body.data[0].id;
exp('LB-1', await lab.post(`/orders/${labOrder}/verify`), [409], 'verify before result');
exp('LB-2', await lab.put(`/orders/${labOrder}/result`, { values: [] }), [409], 'result before collect');
exp('LB-3', await doc.post(`/orders/${labOrder}/collect`), [403], 'doctor cannot collect');
exp('LB-4', await lab.post(`/orders/${labOrder}/collect`), [200], 'collect');
exp('LB-5', await lab.post(`/orders/${labOrder}/collect`), [200], 'collect again (already)');
const tmpl = (await lab.get(`/orders/${labOrder}`)).body.data.lab_template ?? [];
exp('LB-6', await lab.put(`/orders/${labOrder}/result`, { values: tmpl.map((t) => ({ code: t.code, value: '1e5' })) }), [422], 'result value 1e5');
exp('LB-7', await lab.put(`/orders/${labOrder}/result`, { values: tmpl.map((t) => ({ code: t.code, value: 'Infinity' })) }), [422], 'result value Infinity');
exp('LB-8', await lab.put(`/orders/${labOrder}/result`, { values: tmpl.slice(1).map((t) => ({ code: t.code, value: '5' })) }), [200], 'partial result as draft');
exp('LB-9', await lab.post(`/orders/${labOrder}/verify`), [422], 'verify with empty parameter');
exp('LB-10', await lab.put(`/orders/${labOrder}/result`, { values: tmpl.map((t) => ({ code: t.code, value: '5,5' })) }), [200], 'full result');
const dview = await doc.get(`/orders/${labOrder}`);
record('LB-11', dview.body.data && dview.body.data.values === undefined, 'doctor cannot see unverified values', JSON.stringify(dview.body.data?.values));
exp('LB-12', await lab.post(`/orders/${labOrder}/verify`), [200], 'verify');
exp('LB-13', await lab.post(`/orders/${labOrder}/verify`), [200], 'verify twice → already');
exp('LB-14', await lab.put(`/orders/${labOrder}/result`, { values: [] }), [409], 'edit verified result');
await pool.query(`UPDATE lab_results SET values = '[]' WHERE order_id = $1`, [labOrder]).then(
  () => record('LB-15', false, 'DB trigger: verified result UPDATE must fail', 'UPDATE succeeded'),
  (e) => record('LB-15', true, 'DB trigger: verified result UPDATE rejected', e.message));

// ---- invoice / payment / refund state machine
const inv = (await m.get(`/appointments/${a1}`)).body.data.invoice;
const invFull = (await m.get(`/invoices/${inv.id}`)).body.data;
console.log('visit invoice', invFull.invoice_number, invFull.status, invFull.total, invFull.paid_amount);
const k1 = key();
const p1 = exp('IV-1', await cash.post(`/invoices/${inv.id}/payments`, { amount: invFull.total, method: 'cash' }, k1), [201], 'pay in full');
exp('IV-2', await cash.post(`/invoices/${inv.id}/payments`, { amount: invFull.total, method: 'cash' }, k1), [200], 'replay same key → 200 replayed');
exp('IV-3', await cash.post(`/invoices/${inv.id}/payments`, { amount: invFull.total - 1, method: 'cash' }, k1), [422], 'same key, different amount → IDEMPOTENCY_MISMATCH');
exp('IV-4', await cash.post(`/invoices/${inv.id}/payments`, { amount: 100, method: 'cash' }, key()), [409], 'pay fully paid invoice');
exp('IV-5', await m.post(`/invoices/${inv.id}/void`, { reason: 'test void' }), [409], 'void paid invoice');
exp('IV-6', await m.post(`/invoices/${inv.id}/discount`, { type: 'percent', value: 10, reason: 'late discount' }), [409], 'discount after payment');
await pool.query(`UPDATE payments SET amount = 1 WHERE id = $1`, [p1.body.data.payment.id]).then(
  () => record('IV-7', false, 'DB trigger: payment UPDATE must fail', 'UPDATE succeeded'),
  (e) => record('IV-7', true, 'DB trigger: payment UPDATE rejected', e.message));
const payId = p1.body.data.payment.id;
const shift = (await cash.get('/cash-shifts/current')).body.data;
const R = (amount, h = key(), method = 'cash') => m.post(`/invoices/${inv.id}/refunds`, { payment_id: payId, amount, method, reason_code: 'other', reason: 'test refund', shift_id: shift.id }, h);
exp('IV-8', await R(invFull.total + 1), [422], 'refund more than paid');
exp('IV-9', await R(100, key(), 'card'), [201], 'partial card refund');
const rk = key();
exp('IV-10', await R(100, rk), [201], 'partial cash refund');
exp('IV-11', await R(200, rk), [422], 'refund key reuse with different amount');
exp('IV-12', await R(100, rk), [200], 'refund replay');
const after = (await m.get(`/invoices/${inv.id}`)).body.data;
record('IV-13', after.paid_amount === invFull.total - 200 && after.total === invFull.total - 200 && after.paid_amount <= after.total, 'refund reduces paid and total equally', `paid=${after.paid_amount} total=${after.total} credit=${after.credit_amount}`);
exp('IV-14', await cash.post(`/invoices/${inv.id}/payments`, { amount: 100, method: 'cash' }, key()), [409], 'pay after refund (invoice already paid net)');
exp('IV-15', await R(after.paid_amount), [201, 409], 'refund the rest');
exp('IV-16', await R(1), [409], 'refund after fully refunded');
const fin = (await m.get(`/invoices/${inv.id}`)).body.data; console.log('   after full refund:', fin.status, fin.total, fin.paid_amount, fin.credit_amount);
const vd = await m.post(`/invoices/${inv.id}/void`, { reason: 'void a refunded invoice' });
exp('IV-17', vd, [409], 'void a fully refunded invoice (it had payments)');
exp('IV-18', await cash.post(`/invoices/${inv.id}/payments`, { amount: 100, method: 'cash' }, key()), [409], 'pay refunded/void invoice');

// ---- pay a void invoice
const un = (await m.get(`/invoices?status=unpaid&page_size=50&branch_id=${CENTRAL}`)).body.data.find((i) => i.due > 0);
exp('IV-19', await m.post(`/invoices/${un.id}/void`, { reason: 'Xato hisob' }), [200], 'void unpaid');
exp('IV-20', await m.post(`/invoices/${un.id}/void`, { reason: 'Xato hisob' }), [200], 'void twice → already');
exp('IV-21', await cash.post(`/invoices/${un.id}/payments`, { amount: 100, method: 'cash' }, key()), [409], 'pay void invoice');
exp('IV-22', await m.post(`/invoices/${un.id}/discount`, { type: 'percent', value: 5, reason: 'void disc' }), [409], 'discount void invoice');

// ---- shifts
const c2 = await login(M.cashier2);
const s2 = (await c2.get('/cash-shifts/current')).body.data;
exp('SHF-1', await cash.post(`/cash-shifts/${s2.id}/close`, { counted_cash: 0, note: 'x' }), [403, 404], 'cashier closes another cashier shift');
const exp2 = s2.expected_cash;
exp('SHF-2', await c2.post(`/cash-shifts/${s2.id}/close`, { counted_cash: exp2 }), [200], 'close shift');
exp('SHF-3', await c2.post(`/cash-shifts/${s2.id}/close`, { counted_cash: exp2 }), [409], 'close closed shift');
exp('SHF-4', await m.post(`/invoices/${inv.id}/refunds`, { payment_id: payId, amount: 1, method: 'cash', reason_code: 'other', reason: 'closed shift', shift_id: s2.id }, key()), [409], 'cash refund into closed shift');

// ---- reschedule rules
let a3 = (await book(tomorrow, await freeSlot(tomorrow, '09:00'))).body.data.id;
let v3 = (await reg.get(`/appointments/${a3}`)).body.data.version;
exp('RS-1', await reg.patch(`/appointments/${a3}`, { version: v3, date: '2026-10-17' }), [422], 'reschedule into past');
exp('RS-2', await reg.patch(`/appointments/${a3}`, { version: v3, start_time: '13:30' }), [422], 'reschedule over break');
exp('RS-3', await reg.patch(`/appointments/${a3}`, { version: v3, start_time: '18:00' }), [422], 'reschedule outside schedule');
exp('RS-4', await reg.patch(`/appointments/${a3}`, { version: v3 - 1, start_time: '15:00' }), [409], 'reschedule stale version');
const reg2 = await login(M.registrar2); // Yunusobod only
exp('RS-5', await reg2.patch(`/appointments/${a3}`, { version: v3, start_time: '15:00' }), [404], 'registrar of other branch cannot see');
const rs6 = await reg.patch(`/appointments/${a3}`, { version: v3, date: '2026-10-20', start_time: '15:00' });
exp('RS-6', rs6, [200], 'reschedule to a day the doctor works in another branch (moves branch)');
const moved = (await reg.get(`/appointments/${a3}`)).body.data; console.log('   moved branch:', moved.branch_name, moved.starts_at);
// non-existent date via reschedule
v3 = moved.version;
const rs7 = await reg.patch(`/appointments/${a3}`, { version: v3, date: '2027-02-30', start_time: '10:00' });
exp('RS-7', rs7, [422], 'reschedule to 2027-02-30');
if (rs7.status === 200) console.log('   stored:', (await reg.get(`/appointments/${a3}`)).body.data.starts_at);
const bk = await reg.post('/appointments', { patient_id: P.id, branch_id: YUN, doctor_id: AKMAL, service_id: CONSULT, date: '2027-02-30', start_time: '10:00' });
exp('RS-8', bk, [422], 'book 2027-02-30 in YUN (day the date rolls into)');
if (bk.status === 201) console.log('   stored starts_at:', (await reg.get(`/appointments/${bk.body.data.id}`)).body.data.starts_at);

// ---- idempotency key reuse on bookings
const ik = { 'Idempotency-Key': 'booking-key-123456' };
const b1 = await book('2026-10-21', '10:00', patients[10], {}, ik);
const b2 = await book('2026-10-21', '11:00', patients[11], {}, ik);
record('IDK-1', !(b2.status < 300 && b2.body.data.id === b1.body.data.id), 'booking: same Idempotency-Key, different patient/time must not silently return the first booking', `first=${short(b1)} second=${short(b2)}`);
const ap2 = await reg.get(`/appointments?date=2026-10-21&patient_id=${patients[11].id}`);
console.log('   patient 11 bookings on 2026-10-21:', ap2.body.data.length);

summary();
await pool.end();
