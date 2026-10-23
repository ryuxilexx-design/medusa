// FHIR R4 mappers for the Ministry of Health's Digital Health Platform (DHP / DMED).
//
// Pure functions: plain rows in, FHIR R4 JSON out, every resource checked with a zod schema of the elements the
// platform needs (resourceType, required elements, code systems). No DB access here — dhp/outbox.ts loads the rows.
//
// Status of the national guide (checked 2026-10-23, docs/DMED_INTEGRATION.md): UZINFOCOM's «uz.dhp.core» IG
// (build.fhir.org/ig/uzinfocom-org/digital-health-ig, v0.11.1) is a DRAFT on FHIR R5 and «not ready for production».
// These mappers emit R4 (what the task and most tooling target) with the IG's VERIFIED identifier systems; anything
// marked «placeholder / UNVERIFIED» must be confirmed with the IG / the integrator before mode «live» goes to the
// real endpoint. All of them are constants in this file, so the change is one place and needs no migration.
//
// Data minimisation: a resource carries only what that resource needs. No complaints, anamnesis, examination or
// recommendations text leaves the clinic; a Condition carries the ICD-10 code and its catalogue name, not the
// doctor's free-text diagnosis. The only free clinical text sent is an addendum's own text (that is the document).
import { createHash } from 'crypto';
import { z } from 'zod';

// ------------------------------------------------------------------ systems

/** PINFL (JShShIR), identifier type NI — VERIFIED in uz.dhp.core 0.11.1 (uz-core-patient). Re-check on each IG release. */
export const PINFL_SYSTEM = 'https://dhp.uz/fhir/core/sid/pid/uz/ni';
/** Local passport / ID card, identifier type PPN — VERIFIED in uz.dhp.core 0.11.1. */
export const ID_DOCUMENT_SYSTEM = 'https://dhp.uz/fhir/core/sid/pid/uz/ppn/local';
const V2_0203 = 'http://terminology.hl7.org/CodeSystem/v2-0203';
/** Our own record ids (UUIDs), so a retried bundle is recognised as the same record (conditional create). */
export const LOCAL_SYSTEM = 'https://med.uz.ai/fhir/sid';
/** ICD-10 — VERIFIED: the IG's condition-code value set uses this URI (version «2019-covid-expanded»). */
export const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10';
/** Our lab parameter codes (no LOINC mapping yet — UNVERIFIED whether the platform requires LOINC). */
export const LAB_CODE_SYSTEM = 'https://med.uz.ai/fhir/CodeSystem/lab-parameter';
const ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';
const INTERPRETATION = 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation';
const OBS_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category';
const COND_CLINICAL = 'http://terminology.hl7.org/CodeSystem/condition-clinical';
const COND_VERIFICATION = 'http://terminology.hl7.org/CodeSystem/condition-ver-status';
const COND_CATEGORY = 'http://terminology.hl7.org/CodeSystem/condition-category';

/** Local identifier of a record: system per kind (patient, practitioner, encounter, …), value = our UUID. */
export const localId = (kind: string, value: string) => ({ system: `${LOCAL_SYSTEM}/${kind}`, value });
/** A deterministic UUID (v5-shaped) for resources we have no row id for (one Condition per ICD code of a note). */
export function stableUuid(...parts: string[]) {
  const h = createHash('sha1').update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}
const urn = (id: string) => `urn:uuid:${id}`;

// ------------------------------------------------------------------ zod: the elements we promise to send

const identifier = z.object({ type: z.object({ coding: z.array(z.object({ system: z.string().url(), code: z.string().min(1) })).length(1) }).optional(), system: z.string().url(), value: z.string().min(1) });
const coding = z.object({ system: z.string().url(), code: z.string().min(1), display: z.string().optional() });
const concept = z.object({ coding: z.array(coding).optional(), text: z.string().optional() }).refine((c) => (c.coding?.length ?? 0) > 0 || !!c.text, 'CodeableConcept needs a coding or a text');
const reference = z.object({ reference: z.string().regex(/^urn:uuid:[0-9a-f-]{36}$/), display: z.string().optional() });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);

export const patientSchema = z.object({
  resourceType: z.literal('Patient'),
  identifier: z.array(identifier).min(1),
  name: z.array(z.object({ use: z.literal('official'), family: z.string().min(1), given: z.array(z.string().min(1)).min(1), text: z.string() })).length(1),
  gender: z.enum(['male', 'female', 'unknown']),
  birthDate: isoDate,
  telecom: z.array(z.object({ system: z.literal('phone'), value: z.string().regex(/^\+998\d{9}$/), use: z.literal('mobile') })).optional(),
});
export const practitionerSchema = z.object({
  resourceType: z.literal('Practitioner'),
  identifier: z.array(identifier).min(1),
  name: z.array(z.object({ text: z.string().min(1) })).length(1),
  qualification: z.array(z.object({ code: concept })).optional(),
});
export const encounterSchema = z.object({
  resourceType: z.literal('Encounter'),
  identifier: z.array(identifier).min(1),
  status: z.literal('finished'),
  class: z.object({ system: z.literal(ACT_CODE), code: z.literal('AMB'), display: z.string() }),
  serviceType: concept.optional(),
  subject: reference,
  participant: z.array(z.object({ individual: reference })).min(1),
  period: z.object({ start: instant, end: instant.optional() }),
  diagnosis: z.array(z.object({ condition: reference, rank: z.number().int().positive() })).optional(),
  serviceProvider: z.object({ display: z.string().min(1) }),
});
export const conditionSchema = z.object({
  resourceType: z.literal('Condition'),
  identifier: z.array(identifier).min(1),
  clinicalStatus: z.object({ coding: z.array(coding.extend({ system: z.literal(COND_CLINICAL) })).length(1) }),
  verificationStatus: z.object({ coding: z.array(coding.extend({ system: z.literal(COND_VERIFICATION) })).length(1) }),
  category: z.array(z.object({ coding: z.array(coding.extend({ system: z.literal(COND_CATEGORY) })).length(1) })).length(1),
  code: z.object({ coding: z.array(coding.extend({ system: z.literal(ICD10_SYSTEM), code: z.string().regex(/^[A-Z][0-9]{2}(\.[0-9]{1,2})?$/) })).length(1), text: z.string().optional() }),
  subject: reference,
  encounter: reference,
  recordedDate: instant,
  recorder: reference,
});
export const observationSchema = z.object({
  resourceType: z.literal('Observation'),
  identifier: z.array(identifier).min(1),
  status: z.literal('final'),
  category: z.array(z.object({ coding: z.array(coding.extend({ system: z.literal(OBS_CATEGORY), code: z.literal('laboratory') })).length(1) })).length(1),
  code: z.object({ coding: z.array(coding).min(1), text: z.string().min(1) }),
  subject: reference,
  encounter: reference.optional(),
  effectiveDateTime: instant,
  issued: instant,
  valueQuantity: z.object({ value: z.number().finite(), unit: z.string().optional() }).optional(),
  valueString: z.string().optional(),
  interpretation: z.array(z.object({ coding: z.array(coding.extend({ system: z.literal(INTERPRETATION) })).length(1) })).optional(),
  referenceRange: z.array(z.object({ low: z.object({ value: z.number(), unit: z.string().optional() }).optional(), high: z.object({ value: z.number(), unit: z.string().optional() }).optional() })).optional(),
}).refine((o) => o.valueQuantity !== undefined || o.valueString !== undefined, 'Observation needs a value');
export const medicationRequestSchema = z.object({
  resourceType: z.literal('MedicationRequest'),
  identifier: z.array(identifier).min(1),
  status: z.enum(['active', 'cancelled']),
  intent: z.literal('order'),
  medicationCodeableConcept: z.object({ text: z.string().min(1) }),
  subject: reference,
  encounter: reference,
  authoredOn: instant,
  requester: reference,
  dosageInstruction: z.array(z.object({ text: z.string().min(1), patientInstruction: z.string().optional() })).length(1),
  groupIdentifier: identifier,
});
export const documentReferenceSchema = z.object({
  resourceType: z.literal('DocumentReference'),
  identifier: z.array(identifier).min(1),
  status: z.literal('current'),
  docStatus: z.literal('final'),
  type: z.object({ text: z.string().min(1) }),
  subject: reference,
  date: instant,
  author: z.array(reference).length(1),
  content: z.array(z.object({ attachment: z.object({ contentType: z.literal('text/plain; charset=utf-8'), language: z.string(), data: z.string().min(1), creation: instant }) })).length(1),
  context: z.object({ encounter: z.array(reference).length(1) }),
});

const RESOURCE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  Patient: patientSchema, Practitioner: practitionerSchema, Encounter: encounterSchema, Condition: conditionSchema,
  Observation: observationSchema, MedicationRequest: medicationRequestSchema, DocumentReference: documentReferenceSchema,
};

export const bundleSchema = z.object({
  resourceType: z.literal('Bundle'),
  type: z.literal('transaction'),
  timestamp: instant,
  meta: z.object({ tag: z.array(coding).min(1) }),
  entry: z.array(z.object({
    fullUrl: z.string().regex(/^urn:uuid:[0-9a-f-]{36}$/),
    resource: z.object({ resourceType: z.string() }).passthrough(),
    request: z.object({ method: z.enum(['POST', 'PUT']), url: z.string().min(1), ifNoneExist: z.string().optional() }),
  })).min(2),
});
export type FhirBundle = z.infer<typeof bundleSchema>;

/** Throws when a bundle or one of its resources misses an element we promise (a programming error, never user input). */
export function validateBundle(b: unknown): FhirBundle {
  const bundle = bundleSchema.parse(b);
  for (const e of bundle.entry) {
    const schema = RESOURCE_SCHEMAS[e.resource.resourceType];
    if (!schema) throw new Error(`FHIR: unsupported resource ${e.resource.resourceType}`);
    schema.parse(e.resource);
  }
  return bundle;
}

// ------------------------------------------------------------------ inputs (what dhp/outbox.ts loads)

export type PatientRow = { id: string; last_name: string; first_name: string; middle_name: string | null; birth_date: string; sex: string; phone: string | null; pinfl: string | null; id_document: string | null };
export type DoctorRow = { id: string; display_name: string; specialty: string | null };
export type EncounterRow = { id: string; started_at: string | Date; closed_at: string | Date | null; service_name: string | null; clinic_name: string };
export type IcdRow = { code: string; name?: string | null };
export type LabValueRow = { code: string; name: string; unit: string | null; ref_low: number | null; ref_high: number | null; value: string; flag: string | null };
export type PrescriptionItemRow = { name: string; form?: string | null; dose: string; frequency: string; duration: string; instructions?: string | null };

const iso = (d: string | Date) => new Date(d).toISOString();
const ymd = (d: string | Date) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date(d).toISOString().slice(0, 10));

// ------------------------------------------------------------------ resources

export function patientResource(p: PatientRow) {
  const identifier = [] as { type?: { coding: { system: string; code: string }[] }; system: string; value: string }[];
  // the IG wants type + system + value on every national identifier
  if (p.pinfl) identifier.push({ type: { coding: [{ system: V2_0203, code: 'NI' }] }, system: PINFL_SYSTEM, value: p.pinfl });
  if (p.id_document) identifier.push({ type: { coding: [{ system: V2_0203, code: 'PPN' }] }, system: ID_DOCUMENT_SYSTEM, value: p.id_document });
  identifier.push(localId('patient', p.id));
  const given = [p.first_name, p.middle_name].filter((x): x is string => !!x);
  return patientSchema.parse({
    resourceType: 'Patient', identifier,
    name: [{ use: 'official', family: p.last_name, given, text: [p.last_name, ...given].join(' ') }],
    gender: p.sex === 'male' || p.sex === 'female' ? p.sex : 'unknown',
    birthDate: ymd(p.birth_date),
    ...(p.phone && /^\+998\d{9}$/.test(p.phone) ? { telecom: [{ system: 'phone', value: p.phone, use: 'mobile' }] } : {}),
  });
}

export function practitionerResource(d: DoctorRow) {
  return practitionerSchema.parse({
    resourceType: 'Practitioner', identifier: [localId('practitioner', d.id)], name: [{ text: d.display_name }],
    ...(d.specialty ? { qualification: [{ code: { text: d.specialty } }] } : {}),
  });
}

export const conditionId = (encounterId: string, code: string) => stableUuid('condition', encounterId, code);

export function encounterResource(e: EncounterRow, patientId: string, doctorId: string, icd: IcdRow[]) {
  return encounterSchema.parse({
    resourceType: 'Encounter', identifier: [localId('encounter', e.id)], status: 'finished',
    class: { system: ACT_CODE, code: 'AMB', display: 'ambulatory' },
    ...(e.service_name ? { serviceType: { text: e.service_name } } : {}),
    subject: { reference: urn(patientId) },
    participant: [{ individual: { reference: urn(doctorId) } }],
    period: { start: iso(e.started_at), ...(e.closed_at ? { end: iso(e.closed_at) } : {}) },
    ...(icd.length ? { diagnosis: icd.map((c, i) => ({ condition: { reference: urn(conditionId(e.id, c.code)) }, rank: i + 1 })) } : {}),
    serviceProvider: { display: e.clinic_name },
  });
}

export function conditionResource(encounterId: string, c: IcdRow, patientId: string, doctorId: string, recordedAt: string | Date) {
  return conditionSchema.parse({
    resourceType: 'Condition', identifier: [localId('condition', conditionId(encounterId, c.code))],
    clinicalStatus: { coding: [{ system: COND_CLINICAL, code: 'active' }] },
    verificationStatus: { coding: [{ system: COND_VERIFICATION, code: 'confirmed' }] },
    category: [{ coding: [{ system: COND_CATEGORY, code: 'encounter-diagnosis' }] }],
    code: { coding: [{ system: ICD10_SYSTEM, code: c.code, ...(c.name ? { display: c.name } : {}) }], ...(c.name ? { text: c.name } : {}) },
    subject: { reference: urn(patientId) }, encounter: { reference: urn(encounterId) },
    recordedDate: iso(recordedAt), recorder: { reference: urn(doctorId) },
  });
}

export const observationId = (orderId: string, code: string) => stableUuid('observation', orderId, code);

export function observationResource(orderId: string, v: LabValueRow, patientId: string, encounterId: string | null, at: { collected_at: string | Date | null; verified_at: string | Date }) {
  const num = Number(String(v.value).replace(',', '.'));
  const numeric = String(v.value).trim() !== '' && Number.isFinite(num);
  const unit = v.unit || undefined;
  const range = v.ref_low != null || v.ref_high != null
    ? [{ ...(v.ref_low != null ? { low: { value: Number(v.ref_low), ...(unit ? { unit } : {}) } } : {}), ...(v.ref_high != null ? { high: { value: Number(v.ref_high), ...(unit ? { unit } : {}) } } : {}) }]
    : undefined;
  const interp = v.flag === 'low' ? 'L' : v.flag === 'high' ? 'H' : v.flag === 'normal' ? 'N' : null;
  return observationSchema.parse({
    resourceType: 'Observation', identifier: [localId('observation', observationId(orderId, v.code))], status: 'final',
    category: [{ coding: [{ system: OBS_CATEGORY, code: 'laboratory' }] }],
    code: { coding: [{ system: LAB_CODE_SYSTEM, code: v.code }], text: v.name },
    subject: { reference: urn(patientId) },
    ...(encounterId ? { encounter: { reference: urn(encounterId) } } : {}),
    effectiveDateTime: iso(at.collected_at ?? at.verified_at), issued: iso(at.verified_at),
    ...(numeric ? { valueQuantity: { value: num, ...(unit ? { unit } : {}) } } : { valueString: String(v.value) }),
    ...(interp ? { interpretation: [{ coding: [{ system: INTERPRETATION, code: interp }] }] } : {}),
    ...(range ? { referenceRange: range } : {}),
  });
}

export const medicationRequestId = (documentId: string, index: number) => stableUuid('medication-request', documentId, String(index));

export function medicationRequestResource(documentId: string, documentNumber: number, index: number, item: PrescriptionItemRow, patientId: string, encounterId: string, doctorId: string, authoredOn: string | Date, cancelled: boolean) {
  const name = [item.name, item.form].filter(Boolean).join(', ');
  return medicationRequestSchema.parse({
    resourceType: 'MedicationRequest', identifier: [localId('medication-request', medicationRequestId(documentId, index))],
    status: cancelled ? 'cancelled' : 'active', intent: 'order',
    // free text: Med.uz.ai has no national drug registry (INN / MNN) yet — UNVERIFIED whether the platform requires a code
    medicationCodeableConcept: { text: name },
    subject: { reference: urn(patientId) }, encounter: { reference: urn(encounterId) },
    authoredOn: iso(authoredOn), requester: { reference: urn(doctorId) },
    dosageInstruction: [{ text: `${item.dose}; ${item.frequency}; ${item.duration}`, ...(item.instructions ? { patientInstruction: item.instructions } : {}) }],
    groupIdentifier: { system: `${LOCAL_SYSTEM}/prescription-number`, value: String(documentNumber) },
  });
}

export function addendumResource(a: { id: string; text: string; signed_at: string | Date }, patientId: string, encounterId: string, doctorId: string) {
  return documentReferenceSchema.parse({
    resourceType: 'DocumentReference', identifier: [localId('addendum', a.id)], status: 'current', docStatus: 'final',
    type: { text: 'Addendum to a signed clinical note' },
    subject: { reference: urn(patientId) }, date: iso(a.signed_at), author: [{ reference: urn(doctorId) }],
    content: [{ attachment: { contentType: 'text/plain; charset=utf-8', language: 'uz', data: Buffer.from(a.text, 'utf8').toString('base64'), creation: iso(a.signed_at) } }],
    context: { encounter: [{ reference: urn(encounterId) }] },
  });
}

// ------------------------------------------------------------------ bundle

type AnyResource = { resourceType: string; identifier: { system: string; value: string }[] };

/**
 * A transaction Bundle. Every entry is a conditional create on our own identifier (ifNoneExist), so a retried or
 * re-exported bundle never duplicates a record on the platform. The patient is matched on PINFL when we have it.
 * UNVERIFIED: whether the platform accepts conditional creates or wants PUT / its own ids — one place to change.
 */
export function makeBundle(entries: { id: string; resource: AnyResource }[], meta: { kind: string; at: string | Date }): FhirBundle {
  const bundle = {
    resourceType: 'Bundle', type: 'transaction', timestamp: iso(meta.at),
    meta: { tag: [{ system: `${LOCAL_SYSTEM}/event`, code: meta.kind }] },
    entry: entries.map(({ id, resource }) => {
      const key = resource.identifier.find((i) => i.system === PINFL_SYSTEM) ?? resource.identifier.find((i) => i.system.startsWith(LOCAL_SYSTEM))!;
      return { fullUrl: urn(id), resource, request: { method: 'POST' as const, url: resource.resourceType, ifNoneExist: `identifier=${key.system}|${key.value}` } };
    }),
  };
  return validateBundle(bundle);
}

/** Whether the bundle's Patient carries a PINFL (the platform matches patients on it). */
export const bundleHasPinfl = (b: FhirBundle) =>
  b.entry.some((e) => e.resource.resourceType === 'Patient' && ((e.resource as any).identifier as { system: string }[]).some((i) => i.system === PINFL_SYSTEM));
