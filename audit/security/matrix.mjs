// Authorization matrix: every route × every persona (incl. a second tenant and branch-limited staff).
// Mutating routes are only exercised where the guard/lookup must reject before any write
// (anonymous, forbidden role, other tenant's id, other branch's id). Writes allowed for the role are skipped.
import { call, demoLogin, passwordLogin, q, one, pool, SEED, log, short } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const ROLES = ['manager', 'registrar', 'doctor', 'cashier', 'lab'];
const ALL = ROLES;

// ---------------------------------------------------------------- fixtures (tenant 1)
const F = {};
F.encA = 'c5de8318-940c-5dea-b996-c35841fac977';            // Akmal, in progress, Markaziy
F.apptA = 'a0f89f75-df8b-5433-a4e7-feb8a410a174';
F.patA = 'b5a65215-5436-5448-b9a6-0a729dd8a681';
F.apptB = '9df0f1bb-84a4-5d6e-9134-5a17419656a1';            // Bekzod, arrived, Markaziy
F.apptY = '68abd4e0-ff20-542c-ad3d-21419b9cedb2';            // Sardor, arrived, Yunusobod
F.labDraft = '1b3b18ac-0c3d-5ce9-aba6-6bff5248b6c0';         // Akmal ordered, draft_result, Markaziy
F.usOrder = 'd104afca-166b-596d-ab02-de7caf838071';
F.shiftM = 'cc4b7136-45c6-5326-b2e5-0f3b7ce91a62';
F.shiftY = '246e8bb3-ff79-582e-98c8-587827c41cd1';
F.camM = 'fc40b394-935f-5938-a434-d31f992f1b42';
F.doctorA = 'e868c980-e2d8-554d-a01a-273d42be7913';
F.t2patient = '6cb6b27b-3afd-50f7-ba9c-6ed785227bf1';

async function loadFixtures() {
  F.encB = (await one(`SELECT e.id FROM encounters e JOIN doctors d ON d.id = e.doctor_id WHERE d.display_name = 'Bekzod Ergashev' AND e.branch_id = $1 LIMIT 1`, [SEED.branchM])).id;
  F.patNotA = (await one(`SELECT p.id FROM patients p WHERE p.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.doctor_id = $2) LIMIT 1`, [SEED.tenant1, F.doctorA])).id;
  F.labVer = (await one(`SELECT id FROM service_orders WHERE category = 'lab' AND status = 'verified' AND branch_id = $1 LIMIT 1`, [SEED.branchM])).id;
  F.invM = (await one(`SELECT id FROM invoices WHERE branch_id = $1 AND status = 'unpaid' LIMIT 1`, [SEED.branchM])).id;
  F.invMpaid = (await one(`SELECT i.id FROM invoices i WHERE i.branch_id = $1 AND i.paid_amount > 0 LIMIT 1`, [SEED.branchM])).id;
  F.payM = (await one(`SELECT id FROM payments WHERE invoice_id = $1 LIMIT 1`, [F.invMpaid])).id;
  F.expM = (await one(`SELECT id FROM expenses WHERE branch_id = $1 AND status = 'active' LIMIT 1`, [SEED.branchM])).id;
  F.invItemM = (await one(`SELECT id FROM inventory_items WHERE branch_id = $1 LIMIT 1`, [SEED.branchM])).id;
  F.faceStaff = (await one(`SELECT fc.id FROM face_codes fc JOIN memberships m ON m.id = fc.membership_id WHERE fc.subject_type = 'staff' AND fc.revoked_at IS NULL AND $1 = ANY(m.branch_ids) LIMIT 1`, [SEED.branchM]))?.id;
  F.service = (await one(`SELECT id FROM services WHERE tenant_id = $1 AND category = 'lab' LIMIT 1`, [SEED.tenant1])).id;
  F.arrival = (await one(`SELECT id FROM camera_events WHERE tenant_id = $1 AND kind = 'face_match' LIMIT 1`, [SEED.tenant1]))?.id;
  F.security = (await one(`SELECT id FROM camera_events WHERE tenant_id = $1 AND kind IN ('intrusion','line_crossing','tamper','region_entrance') LIMIT 1`, [SEED.tenant1]))?.id;
  F.news = (await one(`SELECT id FROM news_items LIMIT 1`))?.id ?? '00000000-0000-4000-8000-000000000000';
  F.staffReg = SEED.m.registrar;
  F.doc = '00000000-0000-4000-8000-000000000001';
}

// ---------------------------------------------------------------- routes
// roles: null = any authenticated role. mut = writes when allowed. branch = resource has a branch (M = Markaziy).
const R = (method, path, roles, opts = {}) => ({ method, path, roles, ...opts });
const routes = () => [
  R('GET', '/me', null), R('PUT', '/me/preferences', null, { body: { locale: 'uz' }, mut: true }),
  R('GET', '/ai/status', null),
  R('GET', '/branches', null), R('GET', '/rooms', null), R('GET', '/doctors', null), R('GET', '/services', null), R('GET', '/settings', null),
  R('PATCH', `/services/${F.service}`, ['manager'], { body: { duration_min: 30 }, mut: true }),
  R('PATCH', '/settings/clinic', ['manager'], { body: { name: 'X clinic' }, mut: true, tenantScoped: true }),
  R('GET', `/availability?doctor_id=${F.doctorA}&date=2026-10-19`, ['manager', 'registrar', 'doctor']),
  R('GET', '/patients', null, { list: true }),
  R('POST', '/patients/duplicates', ['manager', 'registrar'], { body: { phone: '+998901234567' } }),
  R('POST', '/patients', ['manager', 'registrar'], { body: {}, mut: true }),
  R('GET', `/patients/${F.patA}`, null, { ownerA: true }), R('GET', `/patients/${F.patNotA}`, null, { notA: true }), R('GET', `/patients/${F.t2patient}`, null, { t2obj: true }),
  R('GET', `/patients/${F.patA}/consents`, ['manager', 'registrar', 'doctor'], { ownerA: true }),
  R('POST', `/patients/${F.patA}/consents`, ['manager', 'registrar', 'doctor'], { body: { kind: 'notifications', granted: true, method: 'verbal' }, mut: true }),
  R('PATCH', `/patients/${F.patA}`, ['manager', 'registrar', 'doctor'], { body: { address: 'x' }, mut: true }),
  R('GET', `/patients/${F.patA}/history`, null, { ownerA: true }),
  R('GET', `/appointments?from=2026-10-01&to=2026-10-31`, ['manager', 'registrar', 'doctor', 'cashier'], { list: true }),
  R('GET', `/appointments/${F.apptA}`, ['manager', 'registrar', 'doctor', 'cashier'], { branch: 'M' , ownerA: true }),
  R('GET', `/appointments/${F.apptB}`, ['manager', 'registrar', 'doctor', 'cashier'], { branch: 'M', ownerB: true }),
  R('POST', '/appointments', ['manager', 'registrar'], { body: {}, mut: true }),
  R('PATCH', `/appointments/${F.apptB}`, ['manager', 'registrar'], { body: { version: 1 }, mut: true, branch: 'M' }),
  R('POST', `/appointments/${F.apptB}/check-in`, ['manager', 'registrar'], { body: {}, mut: true, branch: 'M' }),
  R('POST', `/appointments/${F.apptB}/start`, ['doctor'], { mut: true, branch: 'M' }),
  R('POST', `/appointments/${F.apptA}/complete`, ['doctor'], { mut: true, branch: 'M' }),
  R('POST', `/appointments/${F.apptB}/cancel`, ['manager', 'registrar'], { body: { version: 0 }, mut: true, branch: 'M' }),
  R('POST', `/appointments/${F.apptB}/no-show`, ['manager', 'registrar'], { body: { version: 0 }, mut: true, branch: 'M' }),
  R('GET', `/appointments/${F.apptA}/intake`, ['doctor'], { branch: 'M' , ownerA: true }),
  R('GET', '/queue', ['manager', 'registrar', 'doctor', 'cashier'], { list: true }),
  R('GET', `/encounters/${F.encA}`, null, { clinical: true, ownerA: true }),
  R('PUT', `/encounters/${F.encA}/draft`, null, { body: { version: 999 }, mut: true, clinical: true }),
  R('POST', `/encounters/${F.encA}/sign`, null, { body: { version: 999, complaints: 'a', examination: 'b', diagnosis: 'c', recommendations: 'd' }, mut: true, clinical: true }),
  R('POST', `/encounters/${F.encA}/orders`, null, { body: { service_ids: [F.service] }, mut: true, clinical: true }),
  R('GET', `/encounters/${F.encB}`, null, { clinical: true, ownerB: true }),
  R('GET', `/doctor/patient-history?patient_id=${F.patA}`, ['doctor'], { ownerA: true }),
  R('GET', `/encounters/${F.encA}/documents`, ['doctor'], { ownerA: true }),
  R('POST', `/encounters/${F.encA}/documents`, ['doctor'], { body: { kind: 'prescription', body: { items: [{ name: 'Aa', dose: '1', frequency: '1', duration: '1' }] } }, mut: true }),
  R('GET', `/documents/${F.doc}`, ['doctor']),
  R('POST', `/documents/${F.doc}/void`, ['doctor'], { body: { reason: 'xyz' }, mut: true }),
  R('GET', '/orders', ['lab', 'manager', 'registrar', 'doctor'], { list: true }),
  R('GET', '/orders?category=ultrasound', ['lab', 'manager', 'registrar', 'doctor'], { list: true }),
  R('GET', `/orders/${F.labDraft}`, ['lab', 'manager', 'registrar', 'doctor'], { branch: 'M' , ownerA: true }),
  R('GET', `/orders/${F.labVer}`, ['lab', 'manager', 'registrar', 'doctor'], { branch: 'M' , ownerA: true }),
  R('POST', `/orders/${F.labDraft}/collect`, ['lab'], { mut: true, branch: 'M' }),
  R('PUT', `/orders/${F.labDraft}/result`, ['lab'], { body: { values: [] }, mut: true, branch: 'M' }),
  R('POST', `/orders/${F.labDraft}/verify`, ['lab'], { mut: true, branch: 'M' }),
  R('GET', '/diagnostics', ['doctor'], { list: true }),
  R('GET', `/diagnostics/${F.usOrder}`, ['doctor']),
  R('PUT', `/diagnostics/${F.usOrder}`, ['doctor'], { body: { description: 'x', conclusion: 'y' }, mut: true }),
  R('POST', `/diagnostics/${F.usOrder}/sign`, ['doctor'], { body: { description: 'x', conclusion: 'y' }, mut: true }),
  R('GET', '/invoices', ['manager', 'cashier', 'registrar'], { list: true }),
  R('GET', `/invoices/${F.invM}`, ['manager', 'cashier', 'registrar'], { branch: 'M' }),
  R('POST', `/invoices/${F.invM}/discount`, ['manager'], { body: { type: 'percent', value: 1, reason: 'test' }, mut: true, branch: 'M' }),
  R('POST', `/invoices/${F.invM}/payments`, ['cashier'], { body: { amount: 100, method: 'cash' }, headers: { 'idempotency-key': 'audit-key-' + Date.now() }, mut: true, branch: 'M' }),
  R('POST', `/invoices/${F.invM}/void`, ['manager', 'cashier'], { body: { reason: 'test' }, mut: true, branch: 'M' }),
  R('POST', `/invoices/${F.invMpaid}/refunds`, ['manager'], { body: { payment_id: '00000000-0000-4000-8000-000000000000', amount: 1, method: 'card', reason_code: 'other', reason: 'test' }, headers: { 'idempotency-key': 'audit-ref-' + Date.now() }, mut: true, branch: 'M' }),
  R('GET', '/payments', ['manager', 'cashier'], { list: true }),
  R('GET', '/payments/export.csv?from=2026-09-01&to=2026-10-31', ['manager', 'cashier'], { list: true }),
  R('GET', `/payments/${F.payM}`, ['manager', 'cashier'], { branch: 'M' }),
  R('GET', '/cash-shifts/current', ['cashier']),
  R('POST', '/cash-shifts', ['cashier'], { body: { branch_id: SEED.branchM, opening_cash: 0 }, mut: true }),
  R('POST', `/cash-shifts/${F.shiftM}/close`, ['cashier', 'manager'], { body: { counted_cash: 0, note: 'x' }, mut: true, branch: 'M' }),
  R('GET', '/cash-shifts', ['cashier', 'manager'], { list: true }),
  R('GET', `/cash-shifts/${F.shiftM}`, ['cashier', 'manager'], { branch: 'M' }),
  R('GET', '/refunds', ['manager'], { list: true }),
  R('POST', '/expenses', ['manager', 'cashier'], { body: { branch_id: SEED.branchM, category: 'other', amount: 100, paid_from: 'bank' }, mut: true }),
  R('POST', `/expenses/${F.expM}/void`, ['manager'], { body: { reason: 'test' }, mut: true, branch: 'M' }),
  R('GET', '/expenses', ['manager'], { list: true }),
  R('GET', '/finance/summary', ['manager'], { list: true }),
  R('GET', '/dashboard', ['manager'], { list: true }),
  R('GET', '/reports/services', ['manager'], { list: true }),
  R('GET', '/reports/doctors', ['manager', 'doctor'], { list: true }),
  R('GET', '/staff', ['manager'], { list: true }),
  R('GET', `/staff/doctors/${F.doctorA}`, ['manager', 'doctor'], { ownerA: true }),
  R('GET', '/audit', ['manager'], { list: true }),
  R('POST', '/staff', ['manager'], { body: {}, mut: true }),
  R('PATCH', `/staff/${F.staffReg}`, ['manager'], { body: { title: 'x' }, mut: true }),
  R('POST', `/staff/${F.staffReg}/reset-password`, ['manager'], { mut: true }),
  R('PUT', `/staff/doctors/${F.doctorA}/schedule`, ['manager'], { body: { days: [] }, mut: true }),
  R('GET', '/inventory', ['manager'], { list: true }),
  R('GET', `/inventory/${F.invItemM}`, ['manager'], { branch: 'M' }),
  R('POST', `/inventory/${F.invItemM}/movements`, ['manager'], { body: { type: 'in', quantity: 1, reason: 'test' }, mut: true, branch: 'M' }),
  R('POST', '/ai/note-draft', ['doctor'], { body: { text: 'qisqa test matni', encounter_id: F.encA } }),
  R('GET', '/icd10?q=J06', ['doctor']),
  R('POST', '/ai/icd10-suggest', ['doctor'], { body: { text: 'gripp', encounter_id: F.encA } , ownerA: true }),
  R('GET', '/ai/usage', ['manager']),
  R('GET', '/news', ['doctor', 'manager']),
  R('GET', '/news/topics', ['doctor']),
  R('PUT', '/news/topics', ['doctor'], { body: { keys: [] }, mut: true }),
  R('POST', `/news/${F.news}/read`, ['doctor'], { mut: true }),
  R('POST', `/news/${F.news}/save`, ['doctor'], { body: { saved: false }, mut: true }),
  R('POST', `/news/${F.news}/feedback`, ['doctor'], { body: { useful: true }, mut: true }),
  R('POST', '/news/refresh', ['manager'], { mut: true }),
  R('POST', '/ai/report-explanation', ['manager'], { body: { question: 'debts' } }),
  R('GET', '/telegram', ['manager']),
  R('POST', '/telegram/bot', ['manager'], { body: { token: 'bad' }, mut: true }),
  R('DELETE', '/telegram/bot', ['manager'], { mut: true }),
  R('POST', '/telegram/sim/chats', ['manager']),
  R('GET', '/telegram/sim/messages?chat_id=-5', ['manager']),
  R('POST', '/telegram/sim/send', ['manager'], { body: { chat_id: -5, text: '/start' }, mut: true }),
  R('POST', '/telegram/sim/run-workers', ['manager'], { mut: true }),
  R('GET', '/cameras', ['manager'], { list: true }),
  R('POST', '/cameras', ['manager'], { body: { branch_id: SEED.branchM, name: 'x', purposes: ['counting'] }, mut: true }),
  R('PATCH', `/cameras/${F.camM}`, ['manager'], { body: { name: 'x' }, mut: true, branch: 'M' }),
  R('POST', `/cameras/${F.camM}/token`, ['manager'], { mut: true, branch: 'M' }),
  R('GET', '/cameras/face-codes', ['manager'], { list: true }),
  R('POST', '/cameras/face-codes', ['manager'], { body: { membership_id: SEED.m.registrar, consent_confirmed: true }, mut: true }),
  R('DELETE', `/cameras/face-codes/${F.faceStaff}`, ['manager'], { mut: true, branch: 'M' }),
  R('GET', '/cameras/attendance', ['manager'], { list: true }),
  R('GET', '/cameras/traffic', ['manager'], { list: true }),
  R('GET', '/cameras/security', ['manager'], { list: true }),
  R('POST', `/cameras/security/${F.security}/ack`, ['manager'], { mut: true, branch: 'M' }),
  R('GET', '/cameras/arrivals', ['manager', 'registrar'], { list: true }),
  R('POST', `/cameras/arrivals/${F.arrival}/accept`, ['manager', 'registrar'], { mut: true, branch: 'M' }),
  R('POST', `/cameras/arrivals/${F.arrival}/dismiss`, ['manager', 'registrar'], { mut: true, branch: 'M' }),
  R('POST', `/cameras/${F.camM}/simulate`, ['manager'], { body: { kind: 'tamper' }, mut: true, branch: 'M' }),
  R('POST', '/demo/reset', ['manager'], { mut: true }),
];

// ---------------------------------------------------------------- personas
const P = {};
async function setupPersonas() {
  P.anon = { role: 'anon', cookie: null, tenant: null };
  for (const [k, id] of Object.entries(SEED.m)) {
    const role = k.replace(/[A-Z].*$|Y$/, '').replace('uzi', 'doctor').replace('t2manager', 'manager');
    P[k] = { role: k === 't2manager' ? 'manager' : k === 'uzi' ? 'doctor' : k.startsWith('doctor') ? 'doctor' : k.replace(/Y$/, ''), cookie: await demoLogin(id), tenant: k === 't2manager' ? 2 : 1, branchLimited: k.endsWith('Y') };
    void role;
  }
  // tenant-2 staff of every role, created by tenant-2's manager, signed in with a password (temp → changed)
  for (const role of ['registrar', 'doctor', 'cashier', 'lab']) {
    const login = `sec_t2_${role}_${Date.now() % 100000}`;
    const body = { full_name: `T2 ${role} audit`, role, login, branch_ids: [SEED.branchT2], ...(role === 'doctor' ? { doctor: { specialty: 'Terapevt' } } : {}) };
    const c = await call(P.t2manager.cookie, 'POST', '/staff', body);
    if (c.status !== 201) throw new Error(`t2 staff ${role}: ${c.status} ${c.text}`);
    const l = await passwordLogin(login, c.json.data.temp_password);
    const pw = `Audit${Date.now()}x9`;
    const ch = await call(l.cookie, 'POST', '/auth/password', { current_password: c.json.data.temp_password, new_password: pw });
    if (ch.status !== 200) throw new Error(`t2 pw change ${role}: ${ch.status} ${ch.text}`);
    P['t2' + role] = { role, cookie: l.cookie, tenant: 2, login, password: pw };
  }
}

// ---------------------------------------------------------------- leak detectors
const T1 = { ids: new Set(), branchMIds: new Set(), clinical: [], labValueOrders: new Set() };
async function loadLeakSets() {
  for (const t of ['patients', 'appointments', 'invoices', 'payments', 'service_orders', 'encounters', 'cash_shifts', 'expenses', 'inventory_items', 'cameras'])
    for (const r of await q(`SELECT id FROM ${t} WHERE tenant_id = $1`, [SEED.tenant1])) T1.ids.add(r.id);
  for (const t of ['appointments', 'invoices', 'payments', 'cash_shifts', 'expenses', 'inventory_items', 'cameras', 'service_orders'])
    for (const r of await q(`SELECT id FROM ${t} WHERE tenant_id = $1 AND branch_id = $2`, [SEED.tenant1, SEED.branchM])) T1.branchMIds.add(r.id);
  // distinctive clinical strings (≥ 25 chars) from notes / reports
  for (const r of await q(`SELECT complaints, diagnosis, recommendations FROM clinical_notes WHERE complaints IS NOT NULL LIMIT 200`))
    for (const s of [r.complaints, r.diagnosis, r.recommendations]) if (s && s.length >= 25) T1.clinical.push(s.slice(0, 25));
  for (const r of await q(`SELECT conclusion FROM diagnostic_reports WHERE conclusion IS NOT NULL`)) if (r.conclusion.length >= 20) T1.clinical.push(r.conclusion.slice(0, 20));
  // drop strings that are also non-clinical text (service names, the public AI sample text)
  const services = (await q(`SELECT string_agg(name, ' | ') AS s FROM services`))[0].s;
  const sample = (await call(P.manager.cookie, 'GET', '/ai/status')).json?.data?.sample_text ?? '';
  T1.clinical = [...new Set(T1.clinical)].filter((x) => !services.includes(x.slice(0, 15)) && !sample.includes(x.slice(0, 15)));
}
const hasLabValues = (text) => /"values":\s*\[\s*\{/.test(text);

// ---------------------------------------------------------------- run
const results = [];
function expected(route, pk, persona) {
  if (pk === 'anon') return [401];
  const role = persona.role;
  const allowed = !route.roles || route.roles.includes(role);
  if (!allowed) return [403];
  if (route.path.startsWith('/demo/reset')) return persona.tenant === 2 ? [403] : null;
  if (persona.tenant === 2 && !route.list && /[0-9a-f]{8}-[0-9a-f]{4}-/.test(route.path) && !route.t2obj && !route.path.startsWith('/news/') && !route.path.startsWith('/availability') && !route.path.startsWith('/doctor/'))
    return [404, 422, 403];
  return null; // allowed: anything except 401/403 is acceptable, leak checks decide
}

async function main() {
  await loadFixtures();
  await setupPersonas();
  await loadLeakSets();
  const list = routes();
  for (const route of list) {
    for (const [pk, persona] of Object.entries(P)) {
      const role = persona.role;
      const allowed = pk !== 'anon' && (!route.roles || route.roles.includes(role));
      const crossTenant = persona.tenant === 2;
      const branchCase = persona.branchLimited && route.branch === 'M';
      // writes that the role may legitimately perform on its own tenant/branch are skipped (no state change in the audit run)
      if (route.mut && allowed && !crossTenant && !branchCase) { results.push({ route: `${route.method} ${route.path}`, persona: pk, status: 'skip(write-allowed)' }); continue; }
      if (route.path.startsWith('/demo/reset') && allowed && !crossTenant) { results.push({ route: `${route.method} ${route.path}`, persona: pk, status: 'skip(reset)' }); continue; }
      const headers = { ...(route.headers ?? {}) };
      if (headers['idempotency-key']) headers['idempotency-key'] += '-' + pk;
      const r = await call(persona.cookie, route.method, route.path, route.body, headers);
      const issues = [];
      const exp = expected(route, pk, persona);
      if (exp && !exp.includes(r.status)) issues.push(`expected ${exp.join('/')} got ${r.status}`);
      // expected denials inside an allowed role: another doctor's patient/visit/order (403), clinical routes for non-doctors (403)
      const otherDoc = role === 'doctor' && ((route.ownerA && pk !== 'doctorA') || (route.ownerB && pk !== 'doctorB') || route.otherDoctor || route.notA);
      const nonDoctorClinical = route.clinical && role !== 'doctor';
      if (nonDoctorClinical && pk !== 'anon' && r.status !== 403 && !(crossTenant && r.status === 404)) issues.push(`clinical route for ${role}: expected 403 got ${r.status}`);
      if (!exp && (r.status === 401 || r.status === 403) && !branchCase && !otherDoc && !nonDoctorClinical && !route.t2obj && !(crossTenant && r.json?.error?.code === 'FORBIDDEN' && /filial/.test(r.json?.error?.message ?? ''))) issues.push(`allowed role got ${r.status}`);
      if (branchCase && r.status < 300) issues.push(`branch-limited persona got ${r.status} for other-branch resource`);
      if (route.t2obj && persona.tenant === 1 && r.status !== 404 && pk !== 'anon') issues.push(`tenant-1 persona read tenant-2 patient: ${r.status}`);
      if (r.status < 300) {
        if (crossTenant) for (const id of T1.ids) if (r.text.includes(id)) { issues.push(`LEAK tenant-1 id ${id} in tenant-2 response`); break; }
        if (persona.branchLimited) for (const id of T1.branchMIds) if (r.text.includes(id)) { issues.push(`LEAK Markaziy-branch id ${id} to branch-limited persona`); break; }
        if (role !== 'doctor') {
          for (const s of T1.clinical) if (r.text.includes(s)) { issues.push(`CLINICAL text leak to ${role}: "${s}"`); break; }
          if (role !== 'lab' && hasLabValues(r.text)) issues.push(`lab values visible to ${role}`);
        }
      }
      results.push({ route: `${route.method} ${route.path}`, persona: pk, status: r.status, code: r.json?.error?.code, issues });
    }
  }
  const bad = results.filter((x) => x.issues?.length);
  const out = { when: new Date().toISOString(), routes: list.length, personas: Object.keys(P), calls: results.filter((x) => typeof x.status === 'number').length, skipped: results.filter((x) => typeof x.status !== 'number').length, issues: bad, results };
  writeFileSync(process.env.OUT || 'matrix-result.json', JSON.stringify(out, null, 1));
  log(`routes=${list.length} personas=${Object.keys(P).length} calls=${out.calls} skipped=${out.skipped} issues=${bad.length}`);
  for (const b of bad) log(`ISSUE ${b.persona.padEnd(14)} ${b.route} → ${b.status} ${b.code ?? ''} :: ${b.issues.join('; ')}`);
  await pool.end();
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
