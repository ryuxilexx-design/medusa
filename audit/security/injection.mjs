// Injection & input handling: SQL injection attempts in search/filter/sort params, CSV formula injection in the
// payments export, oversized bodies, JSON prototype pollution, and whether a raw non-JSON body corrupts state.
import { call, demoLogin, one, pool, SEED, log } from './lib.mjs';

const show = (label, r, extra = '') => log(`${label.padEnd(66)} -> ${r.status} ${r.json?.error?.code ?? ''} ${extra}`);
const mgr = await demoLogin(SEED.m.manager);
const cashier = await demoLogin(SEED.m.cashier);
const reg = await demoLogin(SEED.m.registrar);

log('== 1. SQL injection in list search / filter params (server must not error 500 or leak) ==');
const inj = ["' OR '1'='1", "'); DROP TABLE patients;--", "%' UNION SELECT token_hash FROM sessions--", "1;SELECT pg_sleep(5)--", "\\'", "a' AND 1=CAST((SELECT count(*) FROM users) AS text)--"];
for (const p of inj) {
  const r = await call(mgr, 'GET', `/patients?search=${encodeURIComponent(p)}`);
  show(`GET /patients?search=${p.slice(0, 28)}`, r, `rows=${r.json?.data?.length}`);
}
for (const p of ["' OR 1=1--", "scheduled','completed",  "x,y"]) {
  const r = await call(mgr, 'GET', `/appointments?from=2026-10-01&to=2026-10-31&status=${encodeURIComponent(p)}`);
  show(`GET /appointments?status=${p.slice(0, 24)}`, r, `rows=${r.json?.data?.length}`);
}
for (const p of ["' OR 1=1--", "../../etc", "1 OR 1=1"]) {
  const r = await call(mgr, 'GET', `/invoices?search=${encodeURIComponent(p)}`);
  show(`GET /invoices?search=${p.slice(0, 24)}`, r, `rows=${r.json?.data?.length}`);
}
// id params that are not UUIDs
for (const p of ["' OR '1'='1", '1 OR 1=1', 'abc']) {
  const r = await call(mgr, 'GET', `/patients/${encodeURIComponent(p)}`);
  show(`GET /patients/${p.slice(0, 20)}`, r);
}
// pagination params
show('GET /patients?page=-1&page_size=99999', await call(mgr, 'GET', '/patients?page=-1&page_size=99999'), `meta: ${JSON.stringify((await call(mgr, 'GET', '/patients?page=-1&page_size=99999')).json?.meta)}`);
// lab order search
show("GET /orders?search=' OR 1=1--", await call(mgr, 'GET', `/orders?search=${encodeURIComponent("' OR 1=1--")}`));
// icd10 search (doctor)
const doc = await demoLogin(SEED.m.doctorA);
show("GET /icd10?q=' OR 1=1--", await call(doc, 'GET', `/icd10?q=${encodeURIComponent("' OR 1=1--")}`));
show('GET /audit?action=<inj>', await call(mgr, 'GET', `/audit?action=${encodeURIComponent("%' OR '1'='1")}`), `rows=${(await call(mgr, 'GET', `/audit?action=${encodeURIComponent("%' OR '1'='1")}`)).json?.data?.length}`);

log('\n== 2. SQL injection in the cameras PATCH SET-list (keys come from the parsed object) ==');
const camId = (await one(`SELECT id FROM cameras WHERE tenant_id = $1 LIMIT 1`, [SEED.tenant1])).id;
const r = await call(mgr, 'PATCH', `/cameras/${camId}`, { 'name = (SELECT token_hash FROM sessions LIMIT 1), location': 'x', name: 'Audit Cam' });
show('PATCH /cameras/:id with crafted extra key', r);
const nameNow = (await one(`SELECT name FROM cameras WHERE id = $1`, [camId])).name;
log('   camera name after:', nameNow);

log('\n== 3. CSV formula injection in /payments/export.csv ==');
// rename an existing patient who already has a payment, so the row appears in the export
const payPat = (await one(`SELECT p.id FROM patients p JOIN invoices i ON i.patient_id = p.id JOIN payments pm ON pm.invoice_id = i.id WHERE p.tenant_id = $1 AND pm.branch_id = $2 LIMIT 1`, [SEED.tenant1, SEED.branchM])).id;
await pool.query(`UPDATE patients SET last_name = $2, first_name = $3, note = $4 WHERE id = $1`, [payPat, '=SUM(A1:A9)', '@cmd', '+inj']);
const csv = await call(cashier, 'GET', '/payments/export.csv?from=2026-09-01&to=2026-12-31');
log('   content-type:', csv.headers.get('content-type'));
log('   header row:', csv.text.split('\r\n')[0]);
const rows = csv.text.split('\r\n');
const formulaRow = rows.find((l) => l.includes('SUM(A1'));
log('   patient cell in export:', formulaRow?.split(';').find((c) => c.includes('SUM')) ?? '(patient not in range)');
// a cell is unsafe if, inside its quotes, the first char is = + @ - (tab/CR handled too). Neutralised cells get a leading apostrophe.
const unsafe = rows.filter((l) => /;"[=+@\-\t\r]/.test(l));
log('   number of cells beginning with = + @ - (unquoted-danger):', unsafe.length);

log('\n== 4. JSON prototype pollution ==');
const before = ({}).polluted;
const pp = await call(mgr, 'POST', '/patients', { last_name: 'Proto', first_name: 'Test', birth_date: '1990-01-01', sex: 'male', __proto__: { polluted: 'yes' }, constructor: { prototype: { polluted2: 'yes' } } });
show('POST /patients with __proto__ payload', pp);
log('   Object.prototype.polluted after:', ({}).polluted, '(was', before, ')');

log('\n== 5. Oversized body ==');
const big = 'A'.repeat(2_000_000);
const ob = await call(mgr, 'POST', '/patients', { last_name: 'Big', first_name: 'Body', birth_date: '1990-01-01', sex: 'male', note: big });
show('POST /patients with 2MB note', ob);

log('\n== 6. Path params with traversal / encoded slashes ==');
for (const p of ['..%2f..%2fetc', '%2e%2e', 'null']) show(`GET /invoices/${p}`, await call(mgr, 'GET', `/invoices/${p}`));

log('\n== 7. Numeric/date filter abuse in dashboard range ==');
show('GET /dashboard?from=2020-01-01&to=2030-01-01 (range cap)', await call(mgr, 'GET', '/dashboard?from=2020-01-01&to=2030-01-01'));
show('GET /finance/summary?from=zzz', await call(mgr, 'GET', '/finance/summary?from=zzz'));

await pool.end();
