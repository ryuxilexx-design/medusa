// Read-path latency under concurrency. Usage: node reads.mjs [levels=1,10,50,200] [nameRegex] [durationS=10]
import { demoLogin, passwordLogin, pick, run } from './lib.mjs';
import { LT_PASSWORD, sql } from './setup.mjs';

const levels = (process.argv[2] || '1,10,50,200').split(',').map(Number);
const filter = new RegExp(process.argv[3] || '.');
const durationS = Number(process.argv[4] || 10);

const M = { manager: '96806128-c685-515d-beb8-a777eb562a19', registrar: 'c8b9bc9d-e4d6-5c9c-b672-2ccfed7505d1', cashier: '50e885ae-58e6-52f3-8f5b-d0e96bb2c63c' };
const sessions = async (n, f) => Promise.all(Array.from({ length: n }, f));
const S = {
  manager: await sessions(10, () => demoLogin(M.manager)),
  registrar: await sessions(10, () => demoLogin(M.registrar)),
  cashier: await sessions(5, () => demoLogin(M.cashier)),
  lab: await sessions(3, () => demoLogin('ec87596e-f96f-5d56-aac8-438fcf72450c')),
  doctor: await sessions(5, (_, i) => passwordLogin(`lt-doc-${1 + i}`, LT_PASSWORD)),
};
const ck = (role, w) => pick(S[role], w);

const patients = sql(`SELECT id, patient_number, substr(phone, 6, 7) FROM patients TABLESAMPLE SYSTEM (5) LIMIT 3000`).split('\n').map((l) => l.split('\t'));
const surnames = ['Karim', 'Rasul', 'Yusup', 'Aliyev', 'Toshm', 'Saidov', 'Ergash', 'Nazar', 'Ismoil', 'Qodir', 'Mirza', 'Abdull', 'Xolma', 'Rahim', 'Sobir', 'Umarov', 'Tursun', 'Hasan'];
const docIds = sql(`SELECT id FROM doctors WHERE display_name LIKE 'Sintetik%' LIMIT 20`).split('\n');
const T = '2026-10-18';
const Y1 = 'from=2025-10-19&to=2026-10-18', D30 = 'from=2026-09-19&to=2026-10-18', Y3 = 'from=2023-10-18&to=2026-10-18';

const scenarios = [
  ['patients.search.name', 'registrar', (i) => `/patients?search=${encodeURIComponent(pick(surnames, i))}`],
  ['patients.search.phone', 'registrar', (i) => `/patients?search=${pick(patients, i * 7)[2]}`],
  ['patients.search.id', 'registrar', (i) => `/patients?search=${pick(patients, i * 13)[1]}`],
  ['patients.list', 'registrar', () => `/patients`],
  ['patient.card', 'registrar', (i) => `/patients/${pick(patients, i)[0]}`],
  ['patient.history', 'registrar', (i) => `/patients/${pick(patients, i)[0]}/history`],
  ['schedule.day.all', 'registrar', () => `/appointments?date=${T}`],
  ['availability', 'registrar', (i) => `/availability?doctor_id=${pick(docIds, i)}&date=2026-10-20`],
  ['queue.day', 'registrar', () => `/queue?date=${T}`],
  ['doctor.today', 'doctor', (i) => (i % 2 ? `/appointments?date=${T}` : `/queue?date=${T}`)],
  ['doctor.patients', 'doctor', () => `/patients`],
  ['dashboard.today', 'manager', () => `/dashboard`],
  ['dashboard.30d', 'manager', () => `/dashboard?period=30d`],
  ['dashboard.1y', 'manager', () => `/dashboard?${Y1}`],
  ['finance.summary.30d', 'manager', () => `/finance/summary?${D30}`],
  ['finance.summary.1y', 'manager', () => `/finance/summary?${Y1}`],
  ['payments.register.1y', 'manager', () => `/payments?${Y1}`],
  ['payments.csv.1y', 'manager', () => `/payments/export.csv?${Y1}`],
  ['reports.services.1y', 'manager', () => `/reports/services?${Y1}`],
  ['reports.doctors.1y', 'manager', () => `/reports/doctors?${Y1}`],
  ['invoices.cashdesk', 'cashier', () => `/invoices`],
  ['invoices.debt', 'cashier', () => `/invoices?debt=1`],
  ['invoices.today', 'cashier', () => `/invoices?from=${T}&to=${T}&page_size=20`],
  ['lab.orders.all', 'lab', () => `/orders?page_size=20`],
  ['cameras.list', 'manager', () => `/cameras`],
  ['cameras.attendance.30d', 'manager', () => `/cameras/attendance?${D30}`],
  ['cameras.attendance.92d', 'manager', () => `/cameras/attendance?from=2026-07-19&to=2026-10-18`],
  ['cameras.traffic.30d', 'manager', () => `/cameras/traffic?${D30}`],
  ['cameras.security.30d', 'manager', () => `/cameras/security?${D30}`],
  ['news.doctor', 'doctor', () => `/news`],
  ['audit.page1', 'manager', () => `/audit`],
  ['me', 'registrar', () => `/me`],
];

for (const [name, role, path] of scenarios) {
  if (!filter.test(name)) continue;
  for (const c of levels) {
    // let the server finish work abandoned by timed-out clients before measuring the next scenario
    const t0 = Date.now();
    while (Number(sql(`SELECT count(*) FROM pg_stat_activity WHERE datname = 'meduza_load_test' AND state = 'active' AND pid <> pg_backend_pid()`)) > 0 && Date.now() - t0 < 900_000) await new Promise((r) => setTimeout(r, 1000));
    if (Date.now() - t0 > 2000) console.log(JSON.stringify({ drain_before: name, c, drain_s: Math.round((Date.now() - t0) / 1000) }));
    const heavy = /csv|1y|92d|schedule.day|cameras.list|dashboard|invoices\.(cashdesk|debt|today)|patient.history/.test(name);
    await run(name, { concurrency: c, durationS: c === 1 ? 3 : durationS, maxRequests: c === 1 ? 5 : heavy ? c : Infinity,
      make: (i, w) => ({ path: path(i), cookie: ck(role, w), timeoutMs: 120_000 }) });
  }
}
