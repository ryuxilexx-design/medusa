// Targeted checks: clinical data visibility between doctors and roles, branch scope of the patient timeline,
// AI de-identification / ICD-10 validation / prompt-injected PubMed content (needs the fake upstreams + AI_MODE=live, gemini).
import { readFileSync } from 'node:fs';
import { call, demoLogin, one, pool, SEED, log, short } from './lib.mjs';

const FAKE_LOG = process.env.FAKE_LOG;
const encA = 'c5de8318-940c-5dea-b996-c35841fac977', patA = 'b5a65215-5436-5448-b9a6-0a729dd8a681';
const usService = '79ff6234-3ee5-5aea-9fe0-dc2182077ff6';
const show = (label, r, extra = '') => log(`${label.padEnd(58)} → ${r.status} ${r.json?.error?.code ?? ''} ${extra}`);

const C = {};
for (const k of ['manager', 'registrarY', 'cashierY', 'doctorA', 'doctorB', 'uzi', 'lab']) C[k] = await demoLogin(SEED.m[k]);

log('\n== 1. Another doctor writing into doctor A\'s encounter (expect 403) ==');
show('doctorB PUT /encounters/encA/draft', await call(C.doctorB, 'PUT', `/encounters/${encA}/draft`, { version: 1, complaints: 'x' }));
show('doctorB POST /encounters/encA/sign', await call(C.doctorB, 'POST', `/encounters/${encA}/sign`, { version: 1, complaints: 'a', examination: 'b', diagnosis: 'c', recommendations: 'd' }));
show('doctorB POST /encounters/encA/orders', await call(C.doctorB, 'POST', `/encounters/${encA}/orders`, { service_ids: [usService] }));
show('doctorB POST /encounters/encA/documents', await call(C.doctorB, 'POST', `/encounters/${encA}/documents`, { kind: 'prescription', body: { items: [{ name: 'Aa', dose: '1', frequency: '1', duration: '1' }] } }));
show('doctorB POST /ai/note-draft (encA)', await call(C.doctorB, 'POST', '/ai/note-draft', { text: 'Bemor tomoq og‘rig‘idan shikoyat qiladi', encounter_id: encA }));
show('doctorB POST /appointments/apptA/complete', await call(C.doctorB, 'POST', `/appointments/a0f89f75-df8b-5433-a4e7-feb8a410a174/complete`));

log('\n== 2. Draft UZI conclusion: visible to the ordering doctor before the specialist signs? ==');
const ord = await call(C.doctorA, 'POST', `/encounters/${encA}/orders`, { service_ids: [usService] });
show('doctorA orders ultrasound in encA', ord, JSON.stringify(ord.json?.data ?? ''));
const orderId = ord.json?.data?.order_ids?.[0] ?? (await one(`SELECT id FROM service_orders WHERE encounter_id = $1 AND service_id = $2`, [encA, usService])).id;
const SECRET = 'DRAFT-CONCLUSION-NOT-SIGNED-777';
show('uzi PUT /diagnostics/:id (draft, not signed)', await call(C.uzi, 'PUT', `/diagnostics/${orderId}`, { description: 'draft description', conclusion: SECRET }));
const dgA = await call(C.doctorA, 'GET', `/diagnostics/${orderId}`);
show('doctorA GET /diagnostics/:id (reference: hidden)', dgA, `conclusion=${JSON.stringify(dgA.json?.data?.conclusion)}`);
const encR = await call(C.doctorA, 'GET', `/encounters/${encA}`);
show('doctorA GET /encounters/encA', encR, `draft conclusion leaked: ${encR.text.includes(SECRET)}`);
const histA = await call(C.doctorA, 'GET', `/patients/${patA}/history`);
show('doctorA GET /patients/patA/history', histA, `draft conclusion leaked: ${histA.text.includes(SECRET)}`);
const dph = await call(C.doctorA, 'GET', `/doctor/patient-history?patient_id=${patA}`);
show('doctorA GET /doctor/patient-history (reference)', dph, `draft conclusion leaked: ${dph.text.includes(SECRET)}`);

log('\n== 3. Unverified lab values for doctors (expect hidden everywhere) ==');
const labDraft = '1b3b18ac-0c3d-5ce9-aba6-6bff5248b6c0';
const lr = await one(`SELECT o.encounter_id, o.patient_id, lr.values FROM service_orders o JOIN lab_results lr ON lr.order_id = o.id WHERE o.id = $1`, [labDraft]);
const v0 = lr.values?.find((x) => x.value)?.value;
for (const [label, path] of [['GET /orders/:draft', `/orders/${labDraft}`], ['GET /encounters/:enc', `/encounters/${lr.encounter_id}`], ['GET /patients/:p/history', `/patients/${lr.patient_id}/history`], ['GET /doctor/patient-history', `/doctor/patient-history?patient_id=${lr.patient_id}`]]) {
  const r = await call(C.doctorA, 'GET', path);
  const hits = []; const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x.id === labDraft && Array.isArray(x.values) && x.values.length) hits.push(x.values.length); Object.values(x).forEach(walk); } };
  walk(r.json);
  show(`doctorA ${label}`, r, `unverified values returned: ${hits.length > 0}`);
}
for (const k of ['manager', 'lab']) {
  const r = await call(C[k], 'GET', `/patients/${lr.patient_id}/history`);
  show(`${k} GET /patients/:p/history`, r, `any lab values: ${/"values":\[\{/.test(r.text)}  (draft value ${v0})`);
}

log('\n== 4. Branch scope of the patient timeline (Yunusobod-only staff, patient seen in Markaziy) ==');
for (const k of ['registrarY', 'cashierY']) {
  const r = await call(C[k], 'GET', `/patients/${patA}/history`);
  const visits = r.json?.data?.visits ?? [], invoices = r.json?.data?.invoices ?? [];
  show(`${k} GET /patients/patA/history`, r, `visits in Markaziy: ${visits.filter((v) => v.branch_id === SEED.branchM).length}, invoices (Markaziy): ${invoices.filter((i) => /Markaziy/.test(i.branch_name)).length} e.g. ${JSON.stringify(invoices[0] ?? {}).slice(0, 160)}`);
  const ref = await call(C[k], 'GET', `/invoices?patient_id=${patA}`);
  show(`${k} GET /invoices?patient_id=patA (reference)`, ref, `rows=${ref.json?.data?.length}`);
  const ref2 = await call(C[k], 'GET', `/invoices/${invoices[0]?.id}`);
  show(`${k} GET /invoices/<that Markaziy invoice> (reference)`, ref2);
}

if (FAKE_LOG) {
  log('\n== 5. AI de-identification before the provider (fake Gemini log) ==');
  const pat = await one(`SELECT last_name, first_name, middle_name, birth_date::text AS b, patient_number, phone FROM patients WHERE id = $1`, [patA]);
  const [y, m, d] = pat.b.split('-');
  const text = `${pat.last_name}a ${pat.first_name} ${pat.middle_name}, tug‘ilgan ${d}.${m}.${y}, ID ${pat.patient_number}, tel ${pat.phone}. Bemor 3 kundan beri tomoq og‘rig‘idan shikoyat qiladi.`;
  const before = readFileSync(FAKE_LOG, 'utf8').split('\n').length;
  const r1 = await call(C.doctorA, 'POST', '/ai/note-draft', { text, encounter_id: encA });
  show('doctorA POST /ai/note-draft with encounter_id', r1);
  const r2 = await call(C.doctorA, 'POST', '/ai/note-draft', { text });
  show('doctorA POST /ai/note-draft WITHOUT encounter_id', r2);
  const lines = readFileSync(FAKE_LOG, 'utf8').split('\n').slice(before - 1).filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.url.includes('generateContent'));
  lines.forEach((l, i) => {
    const user = l.body?.contents?.[0]?.parts?.[0]?.text ?? '';
    const found = [pat.last_name, pat.first_name, pat.middle_name, pat.phone.slice(4), `${d}.${m}.${y}`, String(pat.patient_number)].filter((s) => user.includes(s));
    log(`   provider call ${i + 1}: identifiers present = ${JSON.stringify(found)}  text sent: "${short(user, 200)}"`);
  });

  log('\n== 6. ICD-10: model invents a code (fake returns Z99.99 + J06.9) ==');
  const s = await call(C.doctorA, 'POST', '/ai/icd10-suggest', { text: 'O‘tkir respirator infeksiya', encounter_id: encA });
  show('doctorA POST /ai/icd10-suggest', s, JSON.stringify(s.json?.data));
  const dr = await call(C.doctorA, 'PUT', `/encounters/${encA}/draft`, { version: (await one(`SELECT n.version FROM clinical_notes n WHERE encounter_id = $1`, [encA])).version, icd10: ['Z99.99'] });
  show('doctorA PUT draft with icd10 [Z99.99] (expect 422)', dr, JSON.stringify(dr.json?.error?.fields ?? ''));

  log('\n== 7. ai_usage rows contain no text ==');
  const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_usage' ORDER BY ordinal_position`)).rows.map((r) => r.column_name);
  log('   ai_usage columns:', cols.join(', '));
  const audit = (await pool.query(`SELECT action, summary FROM audit_logs WHERE action LIKE 'ai.%' ORDER BY occurred_at DESC LIMIT 3`)).rows;
  log('   latest ai audit rows:', JSON.stringify(audit));
}
await pool.end();
