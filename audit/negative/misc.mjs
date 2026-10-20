// AI sample mode, documents/print access, receipts across branches, queue/date params.
import { login, M, record, summary, short, key, pool, SEED_IDS } from './lib.mjs';
const AKMAL_M = '4142700f-c111-5c02-9c43-85ee316374e9';
const m = await login(M.manager), reg = await login(M.registrar), c2 = await login(M.cashier2), doc = await login(AKMAL_M), doc2 = await login(SEED_IDS.membership.doctor(3)), lab = await login(M.lab);
const st = (await doc.get('/ai/status')).body.data;
const r = await doc.post('/ai/note-draft', { text: st.sample_text });
record('AI-S1', r.status === 200 && r.body.data.mode === 'sample', 'sample mode: exact demo text returns a result flagged mode=sample', short(r));
const usage = (await pool.query(`SELECT count(*)::int n FROM ai_usage`)).rows[0].n;
record('AI-S2', usage === 0, 'sample mode writes no ai_usage rows (no provider call)', 'rows=' + usage);
const ws = await doc.post('/ai/note-draft', { text: '  ' + st.sample_text.replace(/ /g, '  ') + '  ' });
console.log('   sample text with extra whitespace:', ws.status);
const d = (await pool.query(`SELECT d.id, d.doctor_id FROM medical_documents d LIMIT 1`)).rows[0];
if (d) {
  for (const [s, n] of [[doc2, 'other doctor'], [m, 'manager'], [reg, 'registrar'], [lab, 'lab']]) {
    const x = await s.get(`/documents/${d.id}`); record('DOCA', x.status === 403 || x.status === 404, `document print data: ${n} denied`, short(x));
  }
}
const pay = (await pool.query(`SELECT id FROM payments WHERE branch_id = $1 LIMIT 1`, [SEED_IDS.branchCentral])).rows[0];
const rc = await c2.get(`/payments/${pay.id}`);
record('RCPT', rc.status === 404, 'receipt of another branch: cashier without that branch → 404', short(rc));
for (const q of ['date=2026-02-30', 'date=9999-12-31', 'branch_id=' + SEED_IDS.branchTenant2, 'doctor_id=xyz']) {
  const x = await reg.get('/queue?' + q); record('QUE', x.status < 500, `queue ?${q} → ${x.status}`, short(x));
}
for (const q of ['from=2026-02-30&to=2026-03-01', 'period=7d&from=2026-10-20&to=2026-10-01']) {
  const x = await m.get('/dashboard?' + q); record('DASH', x.status < 500, `dashboard ?${q} → ${x.status}`, short(x));
}
summary(); await pool.end();
