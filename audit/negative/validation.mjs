// Input-validation battery: every request here is invalid or an edge case. Expectation: 4xx with a field error,
// never 5xx, never a 2xx that stores garbage. Run against the isolated API only (see lib.mjs).
import { login, reset, M, record, summary, short, key, pool, SEED_IDS } from './lib.mjs';

const CENTRAL = SEED_IDS.branchCentral, YUN = SEED_IDS.branchYunusobod;
const AKMAL = 'e868c980-e2d8-554d-a01a-273d42be7913'; const AKMAL_M = '4142700f-c111-5c02-9c43-85ee316374e9';
const CONSULT = '891f37ae-4e84-58e9-8f8d-a146b6bac8d3';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function exp(id, r, ok, what) {
  const good = Array.isArray(ok) ? ok.includes(r.status) : ok(r);
  record(id, good && r.status < 500, what, short(r));
  return r;
}

await reset();
const m = await login(M.manager), reg = await login(M.registrar), cash = await login(M.cashier), lab = await login(M.lab);
const doc = await login(AKMAL_M); // Akmal
const docId = (await doc.get('/me')).body.data.doctor_id;
console.log('akmal doctor id', docId, 'seed', AKMAL);
const patient = (await reg.get('/patients?page_size=1')).body.data[0];

// ---------------------------------------------------------------- patients
const P = { last_name: 'Testov', first_name: 'Test', birth_date: '1990-01-01', confirm_duplicate: true };
exp('PAT-1', await reg.post('/patients', {}), [422], 'patient: empty body');
exp('PAT-2', await reg.post('/patients', { ...P, last_name: '   ' }), [422], 'patient: whitespace-only last_name');
exp('PAT-3', await reg.post('/patients', { ...P, last_name: 'x'.repeat(10000) }), [422], 'patient: 10k last_name');
exp('PAT-4', await reg.post('/patients', { ...P, last_name: 123 }), [422], 'patient: number as last_name');
exp('PAT-5', await reg.post('/patients', { ...P, birth_date: '2026-02-30' }), [422], 'patient: birth_date 2026-02-30');
exp('PAT-6', await reg.post('/patients', { ...P, birth_date: '1899-12-31' }), [422], 'patient: birth_date 1899');
exp('PAT-7', await reg.post('/patients', { ...P, birth_date: '2099-01-01' }), [422], 'patient: birth_date future');
exp('PAT-8', await reg.post('/patients', { ...P, birth_date: '1990-01-01T00:00:00+05:00' }), [422], 'patient: birth_date ISO with offset');
exp('PAT-9', await reg.post('/patients', { ...P, phone: '12345' }), [422], 'patient: bad phone');
exp('PAT-10', await reg.post('/patients', { ...P, sex: 'x' }), [422], 'patient: bad sex enum');
const nul = await reg.post('/patients', { ...P, note: 'abc\u0000def' });
exp('PAT-11', nul, [422], 'patient: NUL byte in note');
const zw = await reg.post('/patients', { ...P, last_name: '​​​', first_name: '​​' });
exp('PAT-12', zw, [422], 'patient: zero-width-only names');
exp('PAT-13', await reg.post('/patients', { ...P, last_name: 'Тестов', first_name: 'مرحبا', middle_name: '😀 test' }), [201], 'patient: Cyrillic/RTL/emoji accepted (data, not UI)');
exp('PAT-14', await reg.post('/patients', { ...P, patient_number: 1, tenant_id: ZERO_UUID }), [201], 'patient: extra fields ignored');
exp('PAT-15', await reg.post('/patients', '{"last_name":'), [400], 'patient: malformed JSON → 400 BAD_JSON');
exp('PAT-16', await reg.patch(`/patients/${patient.id}`, { birth_date: '1800-01-01' }), [422], 'patient PATCH: birth_date 1800 (create rejects <1900)');
exp('PAT-17', await reg.patch(`/patients/${patient.id}`, { last_name: null }), [422], 'patient PATCH: null last_name');
exp('PAT-18', await reg.get('/patients/not-a-uuid'), [404], 'patient GET: invalid uuid');
exp('PAT-19', await reg.get(`/patients/${ZERO_UUID}`), [404], 'patient GET: unknown uuid');
for (const s of ['+998 90 123 45 67', '998901234567', '12345678901', '%', '_', '\\', "'; DROP TABLE patients;--", 'a'.repeat(5000)]) {
  const r = await reg.get('/patients?search=' + encodeURIComponent(s));
  exp('PAT-S', r, [200], `patient search "${s.slice(0, 30)}" → ${r.status}${r.status === 200 ? ' total=' + r.body.meta.total : ''}`);
}
for (const pg of ['0', '-1', 'abc', '1e3', '99999999', '5000000000000000000']) {
  const r = await reg.get('/patients?page=' + pg + '&page_size=1000');
  exp('PAT-PG', r, [200], `patients page=${pg} page_size=1000 → ${r.status} ${r.status === 200 ? 'page_size=' + r.body.meta.page_size + ' rows=' + r.body.data.length : ''}`);
}
for (const pg of ['5000000000000000000']) {
  for (const path of ['/invoices', '/payments', '/orders', '/audit']) {
    const s = path === '/orders' ? lab : m;
    exp('PG-' + path, await s.get(`${path}?page=${pg}`), [200], `${path} page=${pg}`);
  }
}
exp('CONS-1', await reg.post(`/patients/${patient.id}/consents`, { kind: 'biometric', granted: true, method: 'verbal' }), [422], 'consent: biometric verbal');
exp('CONS-2', await reg.post(`/patients/${patient.id}/consents`, { kind: 'x', granted: true, method: 'verbal' }), [422], 'consent: bad kind');
exp('CONS-3', await reg.post(`/patients/${patient.id}/consents`, { kind: 'notifications', granted: 'yes', method: 'verbal' }), [422], 'consent: granted string');
exp('CONS-4', await reg.post(`/patients/${patient.id}/consents`, { kind: 'notifications', granted: true, method: 'telegram' }), [422], 'consent: staff cannot claim telegram method');
exp('CONS-5', await cash.post(`/patients/${patient.id}/consents`, { kind: 'notifications', granted: true, method: 'verbal' }), [403], 'consent: cashier forbidden');
exp('CONS-6', await reg.post(`/patients/${patient.id}/consents`, { kind: 'notifications', granted: true, method: 'verbal', note: 'x'.repeat(501) }), [422], 'consent: 501-char note');

// ---------------------------------------------------------------- appointments
const A = { patient_id: patient.id, branch_id: CENTRAL, doctor_id: AKMAL, service_id: CONSULT, date: '2026-10-19', start_time: '09:00' };
exp('APT-1', await reg.post('/appointments', {}), [422], 'appt: empty');
exp('APT-2', await reg.post('/appointments', { ...A, start_time: '24:00' }), [422], 'appt: 24:00');
exp('APT-3', await reg.post('/appointments', { ...A, start_time: '9:00' }), [422], 'appt: 9:00 format');
exp('APT-4', await reg.post('/appointments', { ...A, duration_min: 4 }), [422], 'appt: duration 4');
exp('APT-5', await reg.post('/appointments', { ...A, duration_min: 30.5 }), [422], 'appt: duration 30.5');
exp('APT-6', await reg.post('/appointments', { ...A, date: '2027-02-30' }), [422], 'appt: date 2027-02-30 (non-existent)');
exp('APT-7', await reg.post('/appointments', { ...A, date: '9999-12-27', start_time: '09:00' }), [422], 'appt: year 9999');
exp('APT-8', await reg.post('/appointments', { ...A, start_time: '07:45' }), [422], 'appt: before schedule');
exp('APT-9', await reg.post('/appointments', { ...A, start_time: '17:45' }), [422], 'appt: ends after schedule');
exp('APT-10', await reg.post('/appointments', { ...A, start_time: '12:45' }), [422], 'appt: overlaps break');
exp('APT-11', await reg.post('/appointments', { ...A, date: '2026-10-17' }), [422], 'appt: past date');
exp('APT-12', await reg.post('/appointments', { ...A, branch_id: YUN }), [422], 'appt: wrong branch for weekday');
exp('APT-13', await reg.post('/appointments', { ...A, patient_id: ZERO_UUID }), [422], 'appt: unknown patient');
exp('APT-14', await reg.post('/appointments', { ...A, doctor_id: 'x' }), [422], 'appt: bad uuid');
exp('APT-15', await reg.post('/appointments', { ...A, note: 'a\u0000b' }), [422], 'appt: NUL in note');
exp('APT-16', await reg.post('/appointments', { ...A, branch_id: SEED_IDS.branchTenant2 }), [403, 422], 'appt: other tenant branch');
exp('APT-17', await cash.post('/appointments', A), [403], 'appt: cashier forbidden');
exp('APT-18', await reg.post('/appointments', { ...A, service_id: '3dbec03c-f75e-5181-b8e4-0a1fea67b593', start_time: '13:00', duration_min: 5 }), [422], 'appt: break start exactly');
for (const q of ['date=2026-02-30', 'from=9999-12-31&to=9999-12-31', 'from=2026-10-20&to=2026-10-01', 'status=bogus', 'from=0001-01-01&to=9999-12-31', 'branch_id=abc']) {
  const r = await reg.get('/appointments?' + q);
  exp('APT-L', r, [200, 403, 422], `appt list ?${q} → ${r.status}`);
}
for (const q of ['duration_min=abc', 'duration_min=0', 'duration_min=-5', 'date=2026-02-30']) {
  const r = await reg.get(`/availability?doctor_id=${AKMAL}&date=2026-10-19&${q}`);
  exp('AV', r, [200, 422], `availability ${q} → ${r.status} slots=${r.body?.data?.slots?.length}`);
}

// ---------------------------------------------------------------- invoices & payments
const inv = (await m.get('/invoices?status=unpaid&page_size=50&branch_id=' + CENTRAL)).body.data.find((i) => i.due > 100000);
console.log('invoice', inv?.invoice_number, inv?.due);
const pay = (b, h = key()) => cash.post(`/invoices/${inv.id}/payments`, b, h);
exp('PAY-1', await pay({ amount: 100, method: 'cash' }, {}), [422], 'pay: no Idempotency-Key');
exp('PAY-2', await pay({ amount: 100, method: 'cash' }, { 'Idempotency-Key': 'short' }), [422], 'pay: 5-char key');
exp('PAY-3', await pay({ amount: 0, method: 'cash' }), [422], 'pay: amount 0');
exp('PAY-4', await pay({ amount: -100, method: 'cash' }), [422], 'pay: negative');
exp('PAY-5', await pay({ amount: 100.5, method: 'cash' }), [422], 'pay: decimal tiyin');
exp('PAY-6', await pay({ amount: '100', method: 'cash' }), [422], 'pay: string amount');
exp('PAY-7', await pay({ amount: 1e20, method: 'cash' }), [422], 'pay: 1e20');
exp('PAY-8', await pay({ amount: inv.due + 1, method: 'cash' }), [422], 'pay: more than due');
exp('PAY-9', await pay({ amount: 100, method: 'crypto' }), [422], 'pay: bad method');
exp('PAY-10', await pay({ amount: 100, method: 'cash', note: 'x\u0000' }), [422], 'pay: NUL in note');
exp('PAY-11', await cash.post(`/invoices/not-a-uuid/payments`, { amount: 100, method: 'cash' }, key()), [404], 'pay: bad invoice id');
exp('PAY-12', await m.post(`/invoices/${inv.id}/payments`, { amount: 100, method: 'cash' }, key()), [403], 'pay: manager cannot take money');
exp('DSC-1', await m.post(`/invoices/${inv.id}/discount`, { type: 'percent', value: 101, reason: 'test' }), [422], 'discount: 101%');
exp('DSC-2', await m.post(`/invoices/${inv.id}/discount`, { type: 'percent', value: 0, reason: 'test' }), [422], 'discount: 0');
exp('DSC-3', await m.post(`/invoices/${inv.id}/discount`, { type: 'percent', value: 10, reason: '  ' }), [422], 'discount: blank reason');
exp('DSC-4', await m.post(`/invoices/${inv.id}/discount`, { type: 'amount', value: inv.total + 1, reason: 'test' }), [422], 'discount: amount > subtotal');
exp('DSC-5', await cash.post(`/invoices/${inv.id}/discount`, { type: 'percent', value: 10, reason: 'test' }), [403], 'discount: cashier forbidden');
const inv2 = (await m.get('/invoices?status=unpaid&page_size=50&branch_id=' + CENTRAL)).body.data.filter((i) => i.due > 100000)[1];
const d6 = await m.post(`/invoices/${inv2.id}/discount`, { type: 'amount', value: 0.4, reason: 'fractional tiyin' });
exp('DSC-6', d6, [422], 'discount: amount 0.4 tiyin (fraction of a tiyin)');
const d7 = await m.post(`/invoices/${inv2.id}/discount`, { type: 'percent', value: 0.001, reason: 'tiny percent' });
exp('DSC-7', d7, [422], 'discount: 0.001% (rounds to 0.00 in numeric(18,2))');
exp('VOID-1', await m.post(`/invoices/${inv.id}/void`, { reason: '' }), [422], 'void: empty reason');
exp('INV-L', await m.get('/invoices?search=%25'), [200], 'invoices search=% → ' );
exp('INV-L2', await m.get('/invoices?status=bogus'), [200, 422], 'invoices status=bogus');
exp('PAYL', await m.get('/payments?method=bogus&from=2026-02-30'), [200, 422], 'payments method=bogus');

// ---------------------------------------------------------------- cash shifts, refunds, expenses
const cur = (await cash.get('/cash-shifts/current')).body.data;
exp('SH-1', await cash.post('/cash-shifts', { branch_id: CENTRAL, opening_cash: -1 }), [409, 422], 'shift open: negative opening (or already open)');
exp('SH-2', await cash.post(`/cash-shifts/${cur.id}/close`, { counted_cash: 1.5 }), [422], 'shift close: decimal');
exp('SH-3', await cash.post(`/cash-shifts/${cur.id}/close`, { counted_cash: -1 }), [422], 'shift close: negative');
exp('SH-4', await cash.post(`/cash-shifts/${cur.id}/close`, { counted_cash: 1e12 }), [422], 'shift close: > max');
exp('SH-5', await cash.post(`/cash-shifts/not-uuid/close`, { counted_cash: 0 }), [404], 'shift close: bad id');
exp('EXP-1', await m.post('/expenses', { branch_id: CENTRAL, category: 'Ijara', amount: 100, occurred_on: '2099-01-01' }), [422], 'expense: future date');
const e0001 = await m.post('/expenses', { branch_id: CENTRAL, category: 'Ijara', amount: 100, occurred_on: '0001-01-01' });
exp('EXP-2', e0001, [422], 'expense: occurred_on 0001-01-01');
if (e0001.status === 201) console.log('   stored occurred_at:', (await pool.query('SELECT occurred_at FROM expenses WHERE id = $1', [e0001.body.data.id])).rows[0].occurred_at);
const e0230 = await m.post('/expenses', { branch_id: CENTRAL, category: 'Ijara', amount: 100, occurred_on: '2026-02-30' });
exp('EXP-3', e0230, [422], 'expense: occurred_on 2026-02-30');
if (e0230.status === 201) console.log('   stored occurred_at:', (await pool.query('SELECT occurred_at FROM expenses WHERE id = $1', [e0230.body.data.id])).rows[0].occurred_at);
exp('EXP-4', await m.post('/expenses', { branch_id: CENTRAL, category: 'bogus', amount: 100 }), [422], 'expense: bad category');
exp('EXP-5', await m.post('/expenses', { branch_id: CENTRAL, category: 'Ijara', amount: 1.5 }), [422], 'expense: decimal');
exp('EXP-6', await m.post('/expenses', { branch_id: CENTRAL, category: 'Ijara', amount: 100, paid_from: 'cash_drawer' }), [422], 'expense: drawer without shift');
exp('EXP-7', await m.post('/expenses/not-uuid/void', { reason: 'abc' }), [404], 'expense void bad id');
exp('EXP-8', await cash.post('/expenses', { category: 'Ijara', amount: 1e11 }), [409, 422], 'expense: cashier huge amount (INSUFFICIENT_CASH)');
exp('RF-1', await cash.post(`/invoices/${inv.id}/refunds`, {}, key()), [403], 'refund: cashier forbidden');
exp('RF-2', await m.post(`/invoices/${inv.id}/refunds`, { payment_id: ZERO_UUID, amount: 1, method: 'card', reason_code: 'other', reason: 'abc' }, key()), [422], 'refund: payment not on invoice');
for (const q of ['from=2026-01-01&to=2027-06-01', 'from=2026-10-20&to=2026-10-01', 'from=2026-02-30', 'period=bogus']) {
  const r = await m.get('/finance/summary?' + q);
  exp('FIN', r, [200, 422], `finance/summary ?${q} → ${r.status} ${r.status === 200 ? r.body.data.from + '..' + r.body.data.to : ''}`);
}

// ---------------------------------------------------------------- inventory
const items = (await m.get('/inventory')).body.data;
const it = items[0];
console.log('item', it.name, it.qty);
exp('INVT-1', await m.post(`/inventory/${it.id}/movements`, { type: 'in', quantity: 0.001, reason: 'tiny' }), [422], 'inventory: 0.001 (rounds to 0.00)');
exp('INVT-2', await m.post(`/inventory/${it.id}/movements`, { type: 'in', quantity: 1e11, reason: 'huge' }), [422], 'inventory: 1e11 (> numeric(12,2))');
exp('INVT-3', await m.post(`/inventory/${it.id}/movements`, { type: 'in', quantity: -1, reason: 'neg' }), [422], 'inventory: negative');
exp('INVT-4', await m.post(`/inventory/${it.id}/movements`, { type: 'out', quantity: it.qty + 1, reason: 'too much' }), [422], 'inventory: out > stock');
exp('INVT-5', await m.post(`/inventory/${it.id}/movements`, { type: 'in', quantity: 1, reason: 'x', date: '2099-01-01' }), [422], 'inventory: future date');
exp('INVT-6', await m.post(`/inventory/${it.id}/movements`, { type: 'move', quantity: 1, reason: 'xyz' }), [422], 'inventory: bad type');
exp('INVT-7', await m.post(`/inventory/${it.id}/movements`, { type: 'in', quantity: 1, reason: 'abc', date: '0001-01-01' }), [422], 'inventory: date 0001-01-01');

// ---------------------------------------------------------------- staff / schedule / services / settings
exp('STF-1', await m.post('/staff', { full_name: 'Ab', role: 'cashier', login: 'abc', branch_ids: [CENTRAL] }), [422], 'staff: short name');
exp('STF-2', await m.post('/staff', { full_name: 'Abc Def', role: 'admin', login: 'abcdef', branch_ids: [CENTRAL] }), [422], 'staff: bad role');
exp('STF-3', await m.post('/staff', { full_name: 'Abc Def', role: 'cashier', login: 'ab', branch_ids: [CENTRAL] }), [422], 'staff: short login');
exp('STF-4', await m.post('/staff', { full_name: 'Abc Def', role: 'cashier', login: 'abcdef', branch_ids: [SEED_IDS.branchTenant2] }), [422], 'staff: other tenant branch');
exp('STF-5', await m.post('/staff', { full_name: 'Abc Def', role: 'doctor', login: 'abcdefg', branch_ids: [CENTRAL] }), [422], 'staff: doctor without specialty');
exp('STF-6', await m.post('/staff', { full_name: 'Abc Def', role: 'doctor', login: 'abcdefh', branch_ids: [CENTRAL], doctor: { specialty: 'Terapevt', share_percent: 101 } }), [422], 'staff: share 101%');
exp('STF-7', await m.post('/staff', { full_name: 'Abc Def', role: 'cashier', login: 'abcdefi', branch_ids: [] }), [422], 'staff: empty branches');
exp('STF-8', await reg.post('/staff', { full_name: 'Abc Def', role: 'cashier', login: 'abcdefj', branch_ids: [CENTRAL] }), [403], 'staff: registrar forbidden');
exp('STF-9', await m.patch(`/staff/${M.manager}`, { status: 'inactive' }), [403], 'staff: manager deactivates self');
const dayOk = { weekday: 1, branch_id: CENTRAL, start: '08:00', end: '18:00' };
exp('SCH-1', await m.put(`/staff/doctors/${AKMAL}/schedule`, { days: [{ ...dayOk, weekday: 7 }] }), [422], 'schedule: weekday 7');
exp('SCH-2', await m.put(`/staff/doctors/${AKMAL}/schedule`, { days: [{ ...dayOk, end: '08:10' }] }), [422], 'schedule: <30 min');
exp('SCH-3', await m.put(`/staff/doctors/${AKMAL}/schedule`, { days: [{ ...dayOk, break_start: '07:00', break_end: '07:30' }] }), [422], 'schedule: break outside');
exp('SCH-4', await m.put(`/staff/doctors/${AKMAL}/schedule`, { days: [dayOk, dayOk] }), [422], 'schedule: duplicate weekday');
exp('SCH-5', await m.put(`/staff/doctors/${AKMAL}/schedule`, { days: [{ ...dayOk, end: '07:00' }] }), [422], 'schedule: end before start');
exp('SVC-1', await m.patch(`/services/${CONSULT}`, { price: -1 }), [422], 'service: negative price');
exp('SVC-2', await m.patch(`/services/${CONSULT}`, { price: 1.5 }), [422], 'service: decimal price');
exp('SVC-3', await m.patch(`/services/${CONSULT}`, { price: 1e20 }), [422], 'service: price 1e20 (bigint overflow)');
exp('SVC-4', await m.patch(`/services/${CONSULT}`, { duration_min: 0 }), [422], 'service: duration 0');
exp('SET-1', await m.patch('/settings/clinic', { name: ' ' }), [422], 'clinic name blank');
exp('PREF-1', await m.put('/me/preferences', { locale: 'en' }), [422], 'preferences: bad locale');
exp('PREF-2', await m.put('/me/preferences', {}), [422], 'preferences: empty');
exp('AUTH-1', await m.post('/auth/login', { login: '', password: '' }), [422], 'login empty');
exp('AUTH-2', await m.post('/auth/login', { login: 'x'.repeat(65), password: 'a' }), [422], 'login 65 chars');

// ---------------------------------------------------------------- AI / news / telegram / cameras (manager+doctor)
exp('AI-1', await doc.post('/ai/note-draft', { text: 'short' }), [422], 'ai note: <10 chars');
exp('AI-2', await doc.post('/ai/note-draft', { text: 'x'.repeat(6001) }), [422], 'ai note: 6001 chars');
exp('AI-3', await doc.post('/ai/note-draft', { text: 'Bemor bosh og‘rig‘idan shikoyat qiladi uch kundan beri' }), [422], 'ai note: non-sample text in sample mode → AI_SAMPLE_ONLY');
exp('AI-4', await doc.post('/ai/icd10-suggest', { text: 'bosh og‘rig‘i', encounter_id: ZERO_UUID }), [404], 'icd suggest: unknown encounter');
exp('AI-5', await doc.get('/icd10?q=' + encodeURIComponent('%_\\' + 'a'.repeat(500))), [200], 'icd search wildcards/long');
exp('AI-6', await m.post('/ai/report-explanation', { question: 'drop' }), [422], 'ai report: bad question');
exp('AI-7', await reg.post('/ai/note-draft', { text: 'x'.repeat(20) }), [403], 'ai note: registrar forbidden');
exp('NEWS-1', await doc.put('/news/topics', { keys: ['a', 'b'] }), [422], 'news topics: invalid');
exp('NEWS-2', await doc.put('/news/topics', { keys: ['cardiology', 'neurology', 'pediatrics', 'endocrinology', 'gynecology', 'oncology'] }), [422], 'news topics: >5');
exp('NEWS-3', await doc.post(`/news/${ZERO_UUID}/save`, { saved: 'yes' }), [422], 'news save: bad body');
exp('TG-1', await m.post('/telegram/sim/send', { chat_id: 5, text: 'hi' }), [422], 'tg sim: positive chat id');
exp('TG-2', await m.post('/telegram/sim/send', { chat_id: -5, text: 'x'.repeat(10000) }), [200, 422], 'tg sim: 10k text');
exp('TG-3', await m.get('/telegram/sim/messages?chat_id=-5&after=1e30'), [200, 422], 'tg sim messages after=1e30');
exp('TG-4', await m.post('/telegram/sim/send', { chat_id: -5, text: 'a\u0000b' }), [200, 422], 'tg sim: NUL text');
const cams = (await m.get('/cameras')).body.data;
exp('CAM-1', await m.post('/cameras', { branch_id: CENTRAL, name: 'x', purposes: [] }), [422], 'camera: no purposes');
exp('CAM-2', await m.post('/cameras', { branch_id: CENTRAL, name: 'x'.repeat(81), purposes: ['security'] }), [422], 'camera: 81-char name');
exp('CAM-3', await m.post('/cameras', { branch_id: SEED_IDS.branchTenant2, name: 'x', purposes: ['security'] }), [403, 404, 422], 'camera: other tenant branch');
exp('CAM-4', await m.post('/cameras/face-codes', { membership_id: M.cashier, consent_confirmed: false }), [422], 'face code: no consent');
exp('CAM-5', await m.post(`/cameras/${cams[0].id}/simulate`, { kind: 'people_count', enter: -1 }), [422], 'simulate: negative count');
exp('CAM-6', await m.post(`/cameras/${cams[0].id}/simulate`, { kind: 'face_match', code: 'P-1'.repeat(10) }), [422], 'simulate: long code');
for (const q of ['from=2026-01-01&to=2026-10-18', 'from=2026-10-20&to=2026-10-01', 'from=2026-02-30&to=2026-03-01']) {
  exp('CAM-R', await m.get('/cameras/attendance?' + q), [200, 422], 'camera attendance ' + q);
}
exp('HIK-1', await m.post('/hik/short', 'x'), [404], 'hik: bad token format');
exp('HIK-2', await m.post('/hik/' + 'a'.repeat(40), '<xml/>', { 'content-type': 'application/xml' }), [404], 'hik: unknown token');

// ---------------------------------------------------------------- documents (doctor)
const enc = (await pool.query(`SELECT e.id FROM encounters e WHERE e.doctor_id = $1 LIMIT 1`, [docId])).rows[0];
if (enc) {
  exp('DOC-1', await doc.post(`/encounters/${enc.id}/documents`, { kind: 'certificate', body: { purpose: 'Ishxonaga', rest_days: 31 } }), [422], 'document: rest_days 31');
  exp('DOC-2', await doc.post(`/encounters/${enc.id}/documents`, { kind: 'prescription', body: { items: [] } }), [422], 'document: no items');
  exp('DOC-3', await doc.post(`/encounters/${enc.id}/documents`, { kind: 'referral', body: { to_specialty: 'Kardiolog', reason: 'Tekshiruv', icd10: ['Z99.99'] } }), [422], 'document: unknown icd');
  exp('DOC-4', await doc.post(`/encounters/${enc.id}/documents`, { kind: 'bogus', body: {} }), [422], 'document: bad kind');
  exp('DOC-5', await doc.post(`/encounters/${enc.id}/documents`, { kind: 'prescription', body: { items: Array(16).fill({ name: 'Paracetamol', dose: '1', frequency: '2', duration: '3' }) } }), [422], 'document: 16 items');
  exp('ENC-1', await doc.put(`/encounters/${enc.id}/draft`, { version: 1, vitals: { temp: 99 } }), [409, 422], 'note draft: temp 99');
  exp('ENC-2', await doc.put(`/encounters/${enc.id}/draft`, { version: 'x' }), [422], 'note draft: version string');
  exp('ENC-3', await doc.put(`/encounters/${enc.id}/draft`, { version: 1, icd10: ['a10'] }), [422], 'note draft: bad icd format');
}
exp('LAB-1', await lab.put(`/orders/${ZERO_UUID}/result`, { values: [] }), [404], 'lab result: unknown order');
exp('LAB-2', await lab.put(`/orders/x/result`, { values: 'x' }), [404, 422], 'lab result: bad id + bad body');

summary();
await pool.end();
