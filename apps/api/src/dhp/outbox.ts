// DHP outbox: builds the FHIR bundle of a clinical event from the stored rows and queues it inside the event's own
// transaction (like notifications / fiscal receipts). Nothing is queued while the clinic's mode is «off».
import { Q } from '../core/db';
import {
  addendumResource, conditionResource, encounterResource, FhirBundle, makeBundle, medicationRequestResource, observationResource,
  patientResource, practitionerResource,
} from './fhir';

export type DhpResourceType = 'encounter' | 'lab_result' | 'prescription' | 'addendum';
export type DhpMode = 'off' | 'export' | 'live';

const PATIENT_COLS = `p.id, p.last_name, p.first_name, p.middle_name, to_char(p.birth_date, 'YYYY-MM-DD') AS birth_date, p.sex, p.phone, p.pinfl, p.id_document`;

async function one(q: Q, sql: string, params: unknown[]) { return (await q.query(sql, params)).rows[0]; }
async function patientAndDoctor(q: Q, patientId: string, doctorId: string) {
  const patient = await one(q, `SELECT ${PATIENT_COLS} FROM patients p WHERE p.id = $1`, [patientId]);
  const doctor = await one(q, `SELECT id, display_name, specialty FROM doctors WHERE id = $1`, [doctorId]);
  return [{ id: patient.id, resource: patientResource(patient) }, { id: doctor.id, resource: practitionerResource(doctor) }];
}

/**
 * The bundle of one event, read from the database as it is now (signed notes, verified results and issued documents
 * are immutable; only the patient's identity can change, e.g. a PINFL added later — a retry picks it up).
 * Returns null when the record is not (or no longer) in a sendable state.
 */
export async function buildDhpBundle(q: Q, tenantId: string, type: DhpResourceType, id: string, version = 1): Promise<{ patientId: string; bundle: FhirBundle } | null> {
  if (type === 'encounter') {
    const e = await one(q,
      `SELECT e.id, e.patient_id, e.doctor_id, e.started_at, e.closed_at, n.status, n.icd10, n.signed_at, s.name AS service_name, t.name AS clinic_name
         FROM encounters e JOIN clinical_notes n ON n.encounter_id = e.id JOIN appointments a ON a.id = e.appointment_id
         JOIN services s ON s.id = a.service_id JOIN tenants t ON t.id = e.tenant_id
        WHERE e.id = $1 AND e.tenant_id = $2`, [id, tenantId]);
    if (!e || e.status !== 'signed') return null;
    const icd = ((e.icd10 ?? []) as { code: string; title?: string }[]).map((c) => ({ code: c.code, name: c.title ?? null }));
    const entries = [
      ...(await patientAndDoctor(q, e.patient_id, e.doctor_id)),
      { id: e.id, resource: encounterResource({ ...e, closed_at: e.closed_at ?? e.signed_at }, e.patient_id, e.doctor_id, icd) },
      ...icd.map((c) => { const r = conditionResource(e.id, c, e.patient_id, e.doctor_id, e.signed_at); return { id: r.identifier[0].value, resource: r }; }),
    ];
    return { patientId: e.patient_id, bundle: makeBundle(entries, { kind: 'encounter', at: e.signed_at }) };
  }
  if (type === 'lab_result') {
    const o = await one(q,
      `SELECT o.id, o.patient_id, o.encounter_id, o.doctor_id, e.doctor_id AS encounter_doctor_id, r.values, r.collected_at, r.verified_at, r.status
         FROM service_orders o JOIN lab_results r ON r.order_id = o.id LEFT JOIN encounters e ON e.id = o.encounter_id
        WHERE o.id = $1 AND o.tenant_id = $2`, [id, tenantId]);
    if (!o || o.status !== 'verified') return null;
    const patient = await one(q, `SELECT ${PATIENT_COLS} FROM patients p WHERE p.id = $1`, [o.patient_id]);
    const values = (o.values ?? []) as any[];
    if (!values.length) return null;
    // the encounter is referenced by its identifier only when it is part of this bundle — it is sent in its own one
    const entries: { id: string; resource: any }[] = [{ id: patient.id, resource: patientResource(patient) }];
    for (const v of values) {
      const r = observationResource(o.id, v, o.patient_id, null, o);
      entries.push({ id: r.identifier[0].value, resource: r });
    }
    return { patientId: o.patient_id, bundle: makeBundle(entries, { kind: 'lab_result', at: o.verified_at }) };
  }
  if (type === 'prescription') {
    const d = await one(q,
      `SELECT id, patient_id, encounter_id, doctor_id, kind, number, body, status, issued_at, voided_at FROM medical_documents WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!d || d.kind !== 'prescription') return null;
    const cancelled = version > 1;
    if (cancelled && d.status !== 'void') return null;
    const encounter = await one(q, `SELECT e.id, e.started_at, e.closed_at, s.name AS service_name, t.name AS clinic_name
         FROM encounters e JOIN appointments a ON a.id = e.appointment_id JOIN services s ON s.id = a.service_id JOIN tenants t ON t.id = e.tenant_id WHERE e.id = $1`, [d.encounter_id]);
    const items = ((d.body?.items ?? []) as any[]);
    const entries = [
      ...(await patientAndDoctor(q, d.patient_id, d.doctor_id)),
      ...items.map((it, i) => { const r = medicationRequestResource(d.id, d.number, i, it, d.patient_id, encounter.id, d.doctor_id, d.issued_at, cancelled); return { id: r.identifier[0].value, resource: r }; }),
    ];
    return { patientId: d.patient_id, bundle: makeBundle(entries, { kind: cancelled ? 'prescription.void' : 'prescription', at: cancelled ? d.voided_at : d.issued_at }) };
  }
  // addendum
  const a = await one(q,
    `SELECT x.id, x.text, x.signed_at, x.doctor_id, e.id AS encounter_id, e.patient_id FROM note_addenda x JOIN encounters e ON e.id = x.encounter_id
      WHERE x.id = $1 AND x.tenant_id = $2`, [id, tenantId]);
  if (!a) return null;
  const entries = [
    ...(await patientAndDoctor(q, a.patient_id, a.doctor_id)),
    { id: a.id, resource: addendumResource(a, a.patient_id, a.encounter_id, a.doctor_id) },
  ];
  return { patientId: a.patient_id, bundle: makeBundle(entries, { kind: 'addendum', at: a.signed_at }) };
}

export async function dhpMode(q: Q, tenantId: string): Promise<DhpMode> {
  return ((await q.query(`SELECT mode FROM dhp_settings WHERE tenant_id = $1`, [tenantId])).rows[0]?.mode as DhpMode | undefined) ?? 'off';
}

/**
 * Queues the bundle of an event inside the caller's transaction (once per resource + version). A mapping failure
 * never rolls back the clinical action: it is caught at a savepoint and stored as a «failed» row for the manager.
 */
export async function enqueueDhp(q: Q, tenantId: string, type: DhpResourceType, id: string, version = 1): Promise<'queued' | 'off' | 'failed' | 'skipped'> {
  if ((await dhpMode(q, tenantId)) === 'off') return 'off';
  await q.query('SAVEPOINT dhp_enqueue');
  try {
    const built = await buildDhpBundle(q, tenantId, type, id, version);
    if (!built) { await q.query('RELEASE SAVEPOINT dhp_enqueue'); return 'skipped'; }
    await q.query(
      `INSERT INTO dhp_outbox (tenant_id, patient_id, resource_type, resource_id, version, fhir) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, resource_type, resource_id, version) DO NOTHING`,
      [tenantId, built.patientId, type, id, version, JSON.stringify(built.bundle)]);
    await q.query('RELEASE SAVEPOINT dhp_enqueue');
    return 'queued';
  } catch (e) {
    await q.query('ROLLBACK TO SAVEPOINT dhp_enqueue');
    const patientId = await patientOf(q, tenantId, type, id);
    if (!patientId) return 'failed';
    await q.query(
      `INSERT INTO dhp_outbox (tenant_id, patient_id, resource_type, resource_id, version, fhir, status, error) VALUES ($1,$2,$3,$4,$5,NULL,'failed',$6)
       ON CONFLICT (tenant_id, resource_type, resource_id, version) DO NOTHING`,
      [tenantId, patientId, type, id, version, `FHIR: ${String((e as Error)?.message || e).slice(0, 400)}`]);
    return 'failed';
  }
}

async function patientOf(q: Q, tenantId: string, type: DhpResourceType, id: string): Promise<string | null> {
  const sql = {
    encounter: `SELECT patient_id FROM encounters WHERE id = $1 AND tenant_id = $2`,
    lab_result: `SELECT patient_id FROM service_orders WHERE id = $1 AND tenant_id = $2`,
    prescription: `SELECT patient_id FROM medical_documents WHERE id = $1 AND tenant_id = $2`,
    addendum: `SELECT e.patient_id FROM note_addenda x JOIN encounters e ON e.id = x.encounter_id WHERE x.id = $1 AND x.tenant_id = $2`,
  }[type];
  return (await q.query(sql, [id, tenantId])).rows[0]?.patient_id ?? null;
}

/** Erasure (ZRU-547): the queued payloads of an anonymised patient lose their content; unsent ones are never sent. */
export async function stripDhpForPatient(q: Q, tenantId: string, patientId: string) {
  await q.query(
    `UPDATE dhp_outbox SET fhir = NULL, status = CASE WHEN status = 'sent' THEN 'sent' ELSE 'skipped' END,
            error = CASE WHEN status = 'sent' THEN error ELSE 'Bemor anonimlashtirildi' END
      WHERE tenant_id = $1 AND patient_id = $2`, [tenantId, patientId]);
}
