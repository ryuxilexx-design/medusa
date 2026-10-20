// Second batch of races (after a fresh reset): shift close vs payments, arrival accept, duplicate patient.
import { login, reset, M, record, summary, short, key, pool, SEED_IDS } from './lib.mjs';
const CENTRAL = SEED_IDS.branchCentral, YUN = SEED_IDS.branchYunusobod;
const AKMAL = 'e868c980-e2d8-554d-a01a-273d42be7913';
const CONSULT = '891f37ae-4e84-58e9-8f8d-a146b6bac8d3';
const tally = (rs) => rs.reduce((a, r) => { const k = r.status + (r.body?.error?.code ? ':' + r.body.error.code : ''); a[k] = (a[k] || 0) + 1; return a; }, {});
const q1 = async (sql, p) => (await pool.query(sql, p)).rows;
await reset();
const m = await login(M.manager), reg = await login(M.registrar), regB = await login(M.registrar), c2 = await login(M.cashier2);
const today = (await reg.get('/me')).body.data.today;
const patients = (await reg.get('/patients?page_size=100')).body.data;
// C8: shift close racing payments
{
  const sh = (await c2.get('/cash-shifts/current')).body.data;
  const invs = (await m.get(`/invoices?status=unpaid&page_size=100&branch_id=${YUN}`)).body.data.filter((i) => i.due > 0).slice(0, 10);
  const rs = await Promise.all([...invs.map((inv) => c2.post(`/invoices/${inv.id}/payments`, { amount: inv.due, method: 'cash' }, key())),
    c2.post(`/cash-shifts/${sh.id}/close`, { counted_cash: sh.expected_cash, note: 'race close' })]);
  const row = (await q1(`SELECT status, expected_cash, totals FROM cash_shifts WHERE id = $1`, [sh.id]))[0];
  const live = (await q1(`SELECT coalesce(sum(amount),0)::bigint s, count(*)::int n FROM payments WHERE shift_id = $1 AND method = 'cash'`, [sh.id]))[0];
  record('C8', row.status === 'closed' && row.totals.payments.cash.sum === live.s, `shift close racing ${invs.length} cash payments: frozen totals = payments in the shift`, `${JSON.stringify(tally(rs))} frozen=${row.totals.payments.cash.sum} live=${live.s}`);
}
// C11: arrival suggestion accepted in parallel
{
  const p = patients[71];
  await reg.post(`/patients/${p.id}/consents`, { kind: 'biometric', granted: true, method: 'signed_paper' });
  const av = (await reg.get(`/availability?doctor_id=${AKMAL}&date=${today}&service_id=${CONSULT}`)).body.data;
  const docs = (await reg.get('/doctors')).body.data;
  // any doctor/service with a free slot within the next 2 hours today in the central branch
  let ap;
  for (const d of docs) {
    for (const sid of d.service_ids ?? []) {
      const a = (await reg.get(`/availability?doctor_id=${d.id}&date=${today}&service_id=${sid}`)).body.data;
      if (!a.working || a.branch_id !== CENTRAL) continue;
      const s = a.slots.find((x) => x.free && !x.past && x.time <= '13:00');
      if (!s) continue;
      const r = await reg.post('/appointments', { patient_id: p.id, branch_id: CENTRAL, doctor_id: d.id, service_id: sid, date: today, start_time: s.time });
      if (r.status === 201) { ap = r.body.data.id; console.log('booked', d.display_name, s.time); break; }
    }
    if (ap) break;
  }
  const cams = (await m.get('/cameras')).body.data.filter((c) => c.branch_id === CENTRAL && c.purposes.includes('patient_arrival') && c.status === 'active');
  const sim = await m.post(`/cameras/${cams[0].id}/simulate`, { kind: 'face_match', code: 'P-' + p.patient_number });
  const sug = (await reg.get('/cameras/arrivals')).body.data.find((s) => s.appointment_id === ap);
  if (!sug) record('C11', false, 'arrival suggestion created', short(sim));
  else {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? reg : regB).post(`/cameras/arrivals/${sug.id}/accept`)));
    const t = (await q1(`SELECT count(*)::int n FROM queue_tickets WHERE appointment_id = $1`, [ap]))[0];
    const inv = (await q1(`SELECT count(*)::int n FROM invoices WHERE appointment_id = $1`, [ap]))[0];
    record('C11', t.n === 1 && inv.n === 1 && tally(rs)['200'] === 1, 'arrival accept ×20: one check-in/invoice, others 409', `${JSON.stringify(tally(rs))} tickets=${t.n} invoices=${inv.n}`);
  }
}
// C12: same new patient in parallel
{
  const body = { last_name: 'Parallelov', first_name: 'Ikkinchi', birth_date: '1991-05-05', phone: '+998937770011' };
  const before = (await reg.post('/patients/duplicates', body)).body.data.length;
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? reg : regB).post('/patients', body)));
  const n = (await q1(`SELECT count(*)::int n FROM patients WHERE last_name = 'Parallelov'`))[0].n;
  record('C12', n === 1, `same new patient ×10 in parallel (no confirm_duplicate; ${before} prior matches): one card, rest DUPLICATE_WARNING`, `${JSON.stringify(tally(rs))} cards=${n}`);
}
// C16: shift open ×10 for a cashier without an open shift
{
  const sh = (await c2.get('/cash-shifts/current')).body.data;
  const rs = await Promise.all(Array.from({ length: 10 }, () => c2.post('/cash-shifts', { branch_id: YUN, opening_cash: 0 })));
  const n = (await q1(`SELECT count(*)::int n FROM cash_shifts WHERE cashier_membership_id = $1 AND status = 'open'`, [M.cashier2]))[0].n;
  record('C16', n === 1 && !Object.keys(tally(rs)).some((k) => k.startsWith('5')), 'shift open ×10: one open shift', `${JSON.stringify(tally(rs))} open=${n} (had open before: ${!!sh})`);
}
summary(); await pool.end();
