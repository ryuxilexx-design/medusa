// The one upsert path of the MedPlus mirror (docs/MEDPLUS_SYNC.md). The bridge's batches and the manager's file
// import both end here, so a record seen twice — or once from each channel — is applied once.
//
// Rules:
//  - every record is keyed by (source, kind, external_id) in external_refs; an unchanged payload (same hash) is skipped;
//  - a record whose dependency is missing (patient, visit, services to pay for, a mapping) is parked in
//    external_pending and retried after every batch and after a mapping change — the order of arrival does not matter;
//  - mirrored rows carry external_source_id and are written only inside a transaction marked `meduza.sync = on`
//    (migration 042 refuses every other write);
//  - payments/refunds: no Med.uz.ai cash shift, no fiscal receipt (MedPlus's KKM is the fiscal source), cash-basis
//    revenue as usual; amounts are what MedPlus charged (price snapshot from the record, not our price list);
//  - patients: matched by ref, then PINFL, then phone + birth date (+ name); never two existing cards merged —
//    ambiguous → a new card and a «possible duplicate» row for the manager.
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { Db } from '../core/db';
import { Ctx } from '../core/context';
import { audit } from '../core/audit';
import { coded } from '../core/errors';
import { localDate, now } from '../core/clock';
import { invoiceStatus, sharePercentFor } from '../modules/billing';
import { clip, guessCategory, guessMethod, normName, normPhone, normPinfl, normSex, parseExtDate, parseExtTime, splitFullName, stableHash } from './normalize';
import { dataSchemas, KIND_ORDER, RecordKind, recordSchema, SyncRecord } from './records';

export type Source = { id: string; tenant_id: string; kind: string; name: string; settings: any };
export type Outcome = 'created' | 'updated' | 'unchanged' | 'parked' | 'skipped' | 'error';
export type RecordResult = { kind: string; external_id: string; outcome: Outcome; code?: string };
export type BatchResult = {
  received: number; created: number; updated: number; unchanged: number; parked: number; skipped: number; errors: number; applied_pending: number;
  error_samples: { kind: string; external_id: string; code: string }[];
  results?: RecordResult[];
};

/**
 * A dependency is not there yet: the record waits in external_pending. `mapping` is an unmapped reference (branch,
 * payment form) that must stay listed for the manager even though the record's own changes are rolled back.
 */
export class Park extends Error { constructor(public reason: string, public mapping?: { kind: string; key: string; name: string | null }) { super(reason); } }
/** The record cannot be applied (bad data, a change MedPlus made after payment that would break our invariants). */
export class RecordError extends Error { constructor(public code: string) { super(code); } }
class Skip extends Error { constructor(public code: string) { super(code); } }

/** A parked record is retried for this many days, then reported as an error and dropped. */
export const PENDING_DAYS = 30;
const MAX_SAMPLES = 20;
/** Pending records retried after one batch (oldest first). */
const RETRY_LIMIT = 500;

type Run = { c: PoolClient; src: Source; dry: boolean; fake: { n: number }; actor: string };

/** The server-side actor of a bridge batch (no session): audited as «system». */
export function systemCtx(src: Source, requestId: string = randomUUID()): Ctx {
  return { membershipId: '', userId: '', tenantId: src.tenant_id, tenantName: '', role: 'manager', name: src.name || 'MedPlus', title: null, branchIds: [],
    doctorId: null, doctorSpecialty: null, requestId, sessionHash: '', authKind: 'system', mustChangePassword: false, locale: 'uz', textSize: 'normal' };
}

// ---------------------------------------------------------------- small helpers

async function ref(run: Run, kind: string, extId: string) {
  return (await run.c.query(`SELECT our_id, payload_hash FROM external_refs WHERE source_id = $1 AND kind = $2 AND external_id = $3`, [run.src.id, kind, extId])).rows[0] as { our_id: string; payload_hash: string | null } | undefined;
}
async function setRef(run: Run, kind: string, extId: string, ourId: string, hash: string | null, extUpdated?: string | null) {
  await run.c.query(
    `INSERT INTO external_refs (tenant_id, source_id, kind, external_id, our_id, payload_hash, ext_updated_at, first_seen_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT (source_id, kind, external_id) DO UPDATE SET payload_hash = EXCLUDED.payload_hash, ext_updated_at = EXCLUDED.ext_updated_at, updated_at = EXCLUDED.updated_at`,
    [run.src.tenant_id, run.src.id, kind, extId, ourId, hash, extUpdated ? parseExtTime(extUpdated) : null, now()]);
}
/** Invoice, receipt, refund and patient numbers. A dry run (file preview) never takes the clinic's numbers: no tenant row lock. */
async function nextNumber(run: Run, col: 'patient_seq' | 'invoice_seq' | 'receipt_seq' | 'refund_seq'): Promise<number> {
  if (run.dry) return -(++run.fake.n);
  return (await run.c.query(`UPDATE tenants SET ${col} = ${col} + 1 WHERE id = $1 RETURNING ${col} AS n`, [run.src.tenant_id])).rows[0].n;
}
const mustTime = (v: unknown) => { const t = parseExtTime(v); if (!t) throw new RecordError('bad_time'); return t; };

// ---------------------------------------------------------------- mappings (branch / service / doctor / method / staff)

type Mapping = { id: string; external_id: string; target_id: string | null; target_code: string | null; external_name: string | null; placeholder: boolean };
type MapKind = 'branch' | 'service' | 'doctor' | 'method' | 'staff';

/** The mapping key: MedPlus's id when it sends one, else the name («name:наличными»). */
const mapKey = (extId: string | null | undefined, name: string | null | undefined) => (extId ? String(extId) : name ? 'name:' + normName(name).slice(0, 190) : null);

/**
 * The mapping row for a MedPlus reference, created on first sight: a branch matched by name (or the clinic's only
 * branch), a service/doctor matched by exact name or else a placeholder (inactive «MedPlus: …» service, inactive
 * doctor stub), a payment form by keywords. Branch and payment form stay unmapped (null) until the manager maps them.
 */
export async function mapRef(run: Run, kind: MapKind, extId: string | null | undefined, name: string | null | undefined, hint: { category?: string | null; percent?: number | null; specialty?: string | null } = {}): Promise<Mapping | null> {
  const key = mapKey(extId, name);
  if (!key) return null;
  const { c, src } = run;
  const cur = (await c.query(`SELECT id, external_id, target_id, target_code, external_name, placeholder FROM external_mappings WHERE source_id = $1 AND kind = $2 AND external_id = $3`, [src.id, kind, key])).rows[0] as Mapping | undefined;
  if (cur) {
    if (name && cur.external_name !== name) await c.query(`UPDATE external_mappings SET external_name = $2 WHERE id = $1`, [cur.id, name.slice(0, 200)]);
    return cur;
  }
  const label = (name || key).slice(0, 200);
  let target: string | null = null, code: string | null = null, placeholder = false;
  // the same service/doctor already mapped under another key (a file import keys by name, the bridge by MedPlus's id):
  // follow that mapping, so a manager's choice holds for both and no second placeholder is made
  const sibling = (kind === 'service' || kind === 'doctor') && name
    ? (await c.query(`SELECT target_id, placeholder FROM external_mappings WHERE source_id = $1 AND kind = $2 AND target_id IS NOT NULL AND lower(external_name) = lower($3)
                       ORDER BY placeholder, created_at LIMIT 1`, [src.id, kind, name.slice(0, 200)])).rows[0]
    : undefined;
  if (sibling) { target = sibling.target_id; placeholder = sibling.placeholder; }
  else if (kind === 'branch') {
    const b = name ? (await c.query(`SELECT id FROM branches WHERE tenant_id = $1 AND lower(name) = $2`, [src.tenant_id, normName(name)])).rows : [];
    if (b.length === 1) target = b[0].id;
    else {
      const all = (await c.query(`SELECT id FROM branches WHERE tenant_id = $1 LIMIT 2`, [src.tenant_id])).rows;
      if (all.length === 1) target = all[0].id;
    }
  } else if (kind === 'service') {
    const s = name ? (await c.query(`SELECT id FROM services WHERE tenant_id = $1 AND active AND lower(name) = $2 LIMIT 2`, [src.tenant_id, normName(name)])).rows : [];
    if (s.length === 1) target = s[0].id;
    else {
      // the same name may already have a placeholder under another key (a file import keyed it by name, the bridge
      // now sends MedPlus's id; or two MedPlus services share a name) — reuse it, service names are unique per clinic
      const pname = `MedPlus: ${label}`.slice(0, 200);
      const cat = hint.category && ['consultation', 'lab', 'ultrasound', 'procedure'].includes(hint.category) ? hint.category : guessCategory(label);
      target = (await c.query(`SELECT id FROM services WHERE tenant_id = $1 AND lower(name) = lower($2)`, [src.tenant_id, pname])).rows[0]?.id
        ?? (await c.query(
          `INSERT INTO services (id, tenant_id, code, name, category, duration_min, share_percent, active) VALUES (gen_random_uuid(), $1, $2, $3, $4, 15, 0, false) RETURNING id`,
          [src.tenant_id, `MP-${stableHash([src.id, key]).slice(0, 10).toUpperCase()}`, pname, cat])).rows[0].id;
      placeholder = true;
    }
  } else if (kind === 'doctor') {
    const d = name ? (await c.query(`SELECT id FROM doctors WHERE tenant_id = $1 AND lower(display_name) = $2 LIMIT 2`, [src.tenant_id, normName(name)])).rows : [];
    if (d.length === 1) target = d[0].id;
    else {
      target = (await c.query(
        `INSERT INTO doctors (id, tenant_id, display_name, specialty, default_share_percent, active) VALUES (gen_random_uuid(), $1, $2, $3, $4, false) RETURNING id`,
        [src.tenant_id, label, (hint.specialty || 'MedPlus').slice(0, 120), hint.percent ?? 0])).rows[0].id;
      placeholder = true;
    }
  } else if (kind === 'method') {
    code = guessMethod(label);
  }
  const row = (await c.query(
    `INSERT INTO external_mappings (tenant_id, source_id, kind, external_id, external_name, target_id, target_code, placeholder, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, external_id, target_id, target_code, external_name, placeholder`,
    [src.tenant_id, src.id, kind, key, name ? name.slice(0, 200) : null, target, code, placeholder, now()])).rows[0];
  return row;
}

/** The branch of a record: its MedPlus branch mapped, else the source's default, else the clinic's only branch. */
async function resolveBranch(run: Run, d: { branch_id?: string | null; branch_name?: string | null }): Promise<string> {
  const m = await mapRef(run, 'branch', d.branch_id, d.branch_name);
  if (m) { if (!m.target_id) throw new Park('branch_unmapped', { kind: 'branch', key: m.external_id, name: m.external_name }); return m.target_id; }
  const def = run.src.settings?.default_branch_id;
  if (def) return def;
  const all = (await run.c.query(`SELECT id FROM branches WHERE tenant_id = $1 LIMIT 2`, [run.src.tenant_id])).rows;
  if (all.length === 1) return all[0].id;
  throw new Park('branch_unmapped');
}

/** A per-source stub used when MedPlus sends a visit without a doctor or a service. */
async function stub(run: Run, kind: 'doctor' | 'service') {
  return (await mapRef(run, kind, kind === 'doctor' ? '_none' : '_visit', kind === 'doctor' ? 'MedPlus' : 'Tashrif', { category: 'consultation' }))!.target_id!;
}

async function patientOf(run: Run, extPatient: string): Promise<string> {
  const r = await ref(run, 'patient', extPatient);
  if (!r) throw new Park('patient_missing');
  return r.our_id;
}

// ---------------------------------------------------------------- patients

async function applyPatient(run: Run, rec: SyncRecord, hash: string): Promise<Outcome> {
  const { c, src } = run;
  const d = dataSchemas.patient.parse(rec.data);
  const split = d.last_name ? { last_name: d.last_name, first_name: d.first_name || '—', middle_name: d.middle_name } : d.full_name ? splitFullName(d.full_name) : null;
  if (!split) throw new RecordError('name_missing');
  const birth = d.birth_date ? parseExtDate(d.birth_date) : null;
  if (!birth) throw new RecordError('birth_date_missing');
  const p = {
    last_name: split.last_name, first_name: split.first_name, middle_name: split.middle_name ?? null, birth_date: birth, sex: normSex(d.sex),
    phone: normPhone(d.phone) ?? normPhone(d.phone2), contact_phone: normPhone(d.phone) ? normPhone(d.phone2) : null, pinfl: normPinfl(d.pinfl), address: clip(d.address, 500),
  };
  const pinflFree = async (pinfl: string | null, self: string | null) =>
    !pinfl || !(await c.query(`SELECT 1 FROM patients WHERE tenant_id = $1 AND pinfl = $2 AND ($3::uuid IS NULL OR id <> $3)`, [src.tenant_id, pinfl, self])).rowCount;
  const existing = await ref(run, 'patient', rec.external_id);
  if (existing) {
    const cur = (await c.query(`SELECT id, anonymised_at, pinfl FROM patients WHERE id = $1 FOR UPDATE`, [existing.our_id])).rows[0];
    if (cur.anonymised_at) { await setRef(run, 'patient', rec.external_id, cur.id, hash, rec.updated_at); throw new Skip('anonymised'); }
    if (rec.deleted) { await setRef(run, 'patient', rec.external_id, cur.id, hash, rec.updated_at); return 'updated'; } // a card is never deleted (records retention)
    const pinfl = p.pinfl && (await pinflFree(p.pinfl, cur.id)) ? p.pinfl : cur.pinfl;
    await c.query(
      `UPDATE patients SET last_name = $2, first_name = $3, middle_name = $4, birth_date = $5, sex = $6, phone = $7, contact_phone = $8, address = $9, pinfl = $10, updated_at = demo_now() WHERE id = $1`,
      [cur.id, p.last_name, p.first_name, p.middle_name, p.birth_date, p.sex, p.phone, p.contact_phone, p.address, pinfl]);
    await setRef(run, 'patient', rec.external_id, cur.id, hash, rec.updated_at);
    return 'updated';
  }
  if (rec.deleted) throw new Skip('deleted');
  // match an existing card: PINFL, then phone + birth date (+ the same first or last name)
  const linked = async (id: string) => !!(await c.query(`SELECT 1 FROM external_refs WHERE source_id = $1 AND kind = 'patient' AND our_id = $2`, [src.id, id])).rowCount;
  let target: string | null = null; let dup: { reason: string; ids: string[] } | null = null; let keepPinfl = true;
  if (p.pinfl) {
    const hit = (await c.query(`SELECT id, anonymised_at FROM patients WHERE tenant_id = $1 AND pinfl = $2`, [src.tenant_id, p.pinfl])).rows[0];
    if (hit) {
      if (!hit.anonymised_at && !(await linked(hit.id))) target = hit.id;
      else { dup = { reason: 'pinfl_taken', ids: [hit.id] }; keepPinfl = false; }
    }
  }
  if (!target && !dup && p.phone) {
    const cands = (await c.query(
      `SELECT id, lower(first_name) AS f, lower(last_name) AS l FROM patients WHERE tenant_id = $1 AND phone = $2 AND birth_date = $3 AND anonymised_at IS NULL LIMIT 10`,
      [src.tenant_id, p.phone, p.birth_date])).rows;
    if (cands.length) {
      const free = [];
      for (const x of cands) if (!(await linked(x.id))) free.push(x);
      const sameName = (x: any) => x.f === normName(p.first_name) || x.l === normName(p.last_name);
      if (cands.length === 1 && free.length === 1 && sameName(free[0])) target = free[0].id;
      else dup = { reason: cands.length > 1 ? 'phone_birth_many' : !free.length ? 'phone_birth_linked' : 'phone_birth_name', ids: cands.map((x) => x.id) };
    }
  }
  if (target) {
    // link: the card becomes the mirror of this MedPlus patient; its own data stays, empty fields are filled
    await c.query(
      `UPDATE patients SET external_source_id = $2, middle_name = coalesce(middle_name, $3), phone = coalesce(phone, $4), contact_phone = coalesce(contact_phone, $5),
              address = coalesce(address, $6), pinfl = coalesce(pinfl, $7), updated_at = demo_now() WHERE id = $1`,
      [target, src.id, p.middle_name, p.phone, p.contact_phone, p.address, p.pinfl && (await pinflFree(p.pinfl, target)) ? p.pinfl : null]);
    await setRef(run, 'patient', rec.external_id, target, hash, rec.updated_at);
    return 'updated';
  }
  const pinfl = keepPinfl && (await pinflFree(p.pinfl, null)) ? p.pinfl : null;
  const num = await nextNumber(run, 'patient_seq');
  const id = (await c.query(
    `INSERT INTO patients (id, tenant_id, patient_number, last_name, first_name, middle_name, birth_date, sex, phone, contact_phone, address, pinfl, external_source_id)
     VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [src.tenant_id, num, p.last_name, p.first_name, p.middle_name, p.birth_date, p.sex, p.phone, p.contact_phone, p.address, pinfl, src.id])).rows[0].id;
  await setRef(run, 'patient', rec.external_id, id, hash, rec.updated_at);
  if (dup) await c.query(
    `INSERT INTO external_duplicates (tenant_id, source_id, patient_id, candidate_ids, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source_id, patient_id) DO NOTHING`,
    [src.tenant_id, src.id, id, dup.ids, dup.reason, now()]);
  return 'created';
}

// ---------------------------------------------------------------- visits

function visitStatus(raw: string | null, deleted: boolean | undefined, startsAt: Date): string {
  const s = normName(raw);
  if (deleted || /отмен|cancel|bekor/.test(s)) return 'cancelled';
  if (/не приш|неяв|no.?show|kelmadi/.test(s)) return 'no_show';
  return startsAt.getTime() > now().getTime() ? 'scheduled' : 'completed';
}

async function applyVisit(run: Run, rec: SyncRecord, hash: string): Promise<Outcome> {
  const { c, src } = run;
  const d = dataSchemas.visit.parse(rec.data);
  const patientId = await patientOf(run, d.patient_id);
  const branchId = await resolveBranch(run, d);
  const doctor = d.doctor_id || d.doctor_name ? (await mapRef(run, 'doctor', d.doctor_id, d.doctor_name))!.target_id! : await stub(run, 'doctor');
  const service = d.service_id || d.service_name ? (await mapRef(run, 'service', d.service_id, d.service_name))!.target_id! : await stub(run, 'service');
  const starts = mustTime(d.starts_at);
  const dur = Math.min(240, Math.max(5, Math.round(Number(d.duration_min) || 15)));
  const ends = new Date(starts.getTime() + dur * 60_000);
  const status = visitStatus(d.status, rec.deleted, starts);
  const existing = await ref(run, 'visit', rec.external_id);
  if (existing) {
    await c.query(`UPDATE appointments SET patient_id = $2, branch_id = $3, doctor_id = $4, service_id = $5, starts_at = $6, ends_at = $7, status = $8, version = version + 1, updated_at = demo_now() WHERE id = $1`,
      [existing.our_id, patientId, branchId, doctor, service, starts, ends, status]);
    await setRef(run, 'visit', rec.external_id, existing.our_id, hash, rec.updated_at);
    return 'updated';
  }
  if (rec.deleted) throw new Skip('deleted');
  const id = (await c.query(
    `INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, service_id, starts_at, ends_at, status, created_at, external_source_id)
     VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [src.tenant_id, branchId, patientId, doctor, service, starts, ends, status, starts.getTime() < now().getTime() ? starts : now(), src.id])).rows[0].id;
  await setRef(run, 'visit', rec.external_id, id, hash, rec.updated_at);
  return 'created';
}

// ---------------------------------------------------------------- orders (service lines) and their invoices

/**
 * Recomputes a mirrored invoice from its lines: each line carries MedPlus's own discount, so no invoice-level
 * allocation. A change that would leave less than was already paid (or a negative total) is refused.
 */
async function recalcMirror(run: Run, invoiceId: string) {
  const { c } = run;
  const inv = (await c.query(`SELECT credit_amount, paid_amount, status FROM invoices WHERE id = $1`, [invoiceId])).rows[0];
  const s = (await c.query(`SELECT coalesce(sum(line_subtotal),0)::bigint AS sub, coalesce(sum(discount_share),0)::bigint AS disc, count(*)::int AS n FROM invoice_items WHERE invoice_id = $1`, [invoiceId])).rows[0];
  const credit = Number(inv.credit_amount), paid = Number(inv.paid_amount);
  const total = Number(s.sub) - Number(s.disc) - credit;
  if (total < 0 || total < paid) throw new RecordError('changed_after_payment');
  const status = s.n === 0 && paid === 0 && credit === 0 ? 'void' : invoiceStatus({ total, paid, credit, hasItems: s.n > 0 });
  await c.query(`UPDATE invoices SET subtotal = $2, discount_amount = $3, total = $4, status = $5, void_reason = CASE WHEN $5 = 'void' THEN 'MedPlus: bekor qilingan' END,
                  version = version + 1, updated_at = demo_now() WHERE id = $1`, [invoiceId, s.sub, s.disc, total, status]);
}

/** The mirrored invoice of a visit, or of a patient's day in a branch when MedPlus sends lines without a visit. */
async function invoiceFor(run: Run, key: string, o: { branchId: string; patientId: string; appointmentId: string | null; at: Date }): Promise<string> {
  const r = await ref(run, 'invoice', key);
  if (r) { await run.c.query(`SELECT id FROM invoices WHERE id = $1 FOR UPDATE`, [r.our_id]); return r.our_id; }
  const num = await nextNumber(run, 'invoice_seq');
  const id = (await run.c.query(
    `INSERT INTO invoices (id, tenant_id, branch_id, patient_id, appointment_id, invoice_number, status, created_at, external_source_id) VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,'unpaid',$6,$7) RETURNING id`,
    [run.src.tenant_id, o.branchId, o.patientId, o.appointmentId, num, o.at, run.src.id])).rows[0].id;
  await setRef(run, 'invoice', key, id, null);
  return id;
}

async function applyOrder(run: Run, rec: SyncRecord, hash: string): Promise<Outcome> {
  const { c, src } = run;
  const d = dataSchemas.order.parse(rec.data);
  const existing = await ref(run, 'order', rec.external_id);
  if (!existing && rec.deleted) throw new Skip('deleted');
  const patientId = await patientOf(run, d.patient_id);
  let appt: { id: string; branch_id: string; doctor_id: string } | null = null;
  if (d.visit_id) {
    const v = await ref(run, 'visit', d.visit_id);
    if (!v) throw new Park('visit_missing');
    appt = (await c.query(`SELECT id, branch_id, doctor_id FROM appointments WHERE id = $1`, [v.our_id])).rows[0];
  }
  const branchId = appt ? appt.branch_id : await resolveBranch(run, d);
  if (!d.service_id && !d.service_name) throw new RecordError('service_missing');
  const sm = (await mapRef(run, 'service', d.service_id, d.service_name, { category: d.category }))!;
  const service = (await c.query(`SELECT id, name, category, share_percent FROM services WHERE id = $1`, [sm.target_id])).rows[0];
  const doctorId = d.doctor_id || d.doctor_name ? (await mapRef(run, 'doctor', d.doctor_id, d.doctor_name))!.target_id : appt?.doctor_id ?? null;
  const at = mustTime(d.ordered_at);
  const qty = Math.round(Number(d.quantity));
  if (!Number.isFinite(qty) || qty < 1 || qty > 50) throw new RecordError('quantity_range');
  const price = d.price;
  const subtotal = price * qty;
  const discount = Math.min(d.discount ?? 0, subtotal);
  if (!existing) {
    const share = d.doctor_percent ?? (await sharePercentFor(c, src.tenant_id, doctorId, Number(service.share_percent)));
    const key = d.visit_id ? `visit:${d.visit_id}` : `day:${d.patient_id}:${branchId}:${localDate(at)}`;
    const invoiceId = await invoiceFor(run, key, { branchId, patientId, appointmentId: appt?.id ?? null, at });
    const orderId = (await c.query(
      `INSERT INTO service_orders (id, tenant_id, branch_id, patient_id, appointment_id, encounter_id, service_id, category, service_name, is_primary, price_snapshot,
                                   share_percent_snapshot, doctor_id, performer_doctor_id, status, ordered_at, performed_at, created_by, quantity, external_source_id)
       VALUES (gen_random_uuid(), $1,$2,$3,$4,NULL,$5,$6,$7,false,$8,$9,$10,$10,'completed',$11,$11,NULL,$12,$13) RETURNING id`,
      [src.tenant_id, branchId, patientId, appt?.id ?? null, service.id, service.category, service.name, price, share, doctorId, at, qty, src.id])).rows[0].id;
    const pos = (await c.query(`SELECT coalesce(max(position), -1) + 1 AS p FROM invoice_items WHERE invoice_id = $1`, [invoiceId])).rows[0].p;
    await c.query(
      `INSERT INTO invoice_items (tenant_id, invoice_id, order_id, service_id, description, quantity, unit_price, line_subtotal, discount_share, line_total, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [src.tenant_id, invoiceId, orderId, service.id, service.name, qty, price, subtotal, discount, subtotal - discount, pos]);
    await recalcMirror(run, invoiceId);
    await setRef(run, 'order', rec.external_id, orderId, hash, rec.updated_at);
    return 'created';
  }
  // a changed or deleted line: allowed while the invoice still covers what was paid (the share % snapshot never changes)
  const it = (await c.query(`SELECT it.id, it.invoice_id, it.refunded_amount FROM invoice_items it WHERE it.order_id = $1`, [existing.our_id])).rows[0];
  if (it) await c.query(`SELECT id FROM invoices WHERE id = $1 FOR UPDATE`, [it.invoice_id]);
  if (rec.deleted) {
    if (!it) { await setRef(run, 'order', rec.external_id, existing.our_id, hash, rec.updated_at); return 'updated'; }
    if (Number(it.refunded_amount) > 0) throw new RecordError('changed_after_payment');
    await c.query(`DELETE FROM invoice_items WHERE id = $1`, [it.id]);
    await c.query(`UPDATE service_orders SET status = 'cancelled' WHERE id = $1`, [existing.our_id]);
    await recalcMirror(run, it.invoice_id);
  } else {
    if (!it) throw new RecordError('order_cancelled');
    if (subtotal - discount < Number(it.refunded_amount)) throw new RecordError('changed_after_payment');
    await c.query(`UPDATE service_orders SET service_id = $2, category = $3, service_name = $4, price_snapshot = $5, quantity = $6, doctor_id = $7, performer_doctor_id = $7,
                    ordered_at = $8, performed_at = $8, status = 'completed' WHERE id = $1`, [existing.our_id, service.id, service.category, service.name, price, qty, doctorId, at]);
    await c.query(`UPDATE invoice_items SET service_id = $2, description = $3, quantity = $4, unit_price = $5, line_subtotal = $6, discount_share = $7, line_total = $8 WHERE id = $1`,
      [it.id, service.id, service.name, qty, price, subtotal, discount, subtotal - discount]);
    await recalcMirror(run, it.invoice_id);
  }
  await setRef(run, 'order', rec.external_id, existing.our_id, hash, rec.updated_at);
  return 'updated';
}

// ---------------------------------------------------------------- payments and refunds

/** The payment form of a record: mapped, else parked until the manager maps it. */
async function methodOf(run: Run, name: string | null): Promise<'cash' | 'card' | 'transfer'> {
  const m = await mapRef(run, 'method', null, name || 'Naqd');
  if (!m?.target_code) throw new Park('method_unmapped', m ? { kind: 'method', key: m.external_id, name: m.external_name } : undefined);
  return m.target_code as 'cash' | 'card' | 'transfer';
}
/** Who took the money: the mapped staff member's name, else MedPlus's user name. */
async function cashierName(run: Run, id: string | null, name: string | null): Promise<string> {
  const m = await mapRef(run, 'staff', id, name);
  if (m?.target_id) {
    const u = (await run.c.query(`SELECT u.full_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.id = $1`, [m.target_id])).rows[0];
    if (u) return u.full_name;
  }
  return (name || m?.external_name || run.src.name || 'MedPlus').slice(0, 200);
}

/**
 * Splits an amount over the patient's open mirrored invoices in this branch (oldest first) — or the one invoice of
 * the named visit. All or nothing: when the services are not there yet the payment waits (parked).
 */
async function allocate(run: Run, o: { patientId: string; branchId: string; visitExt: string | null; amount: number }): Promise<{ id: string; take: number; status: string; total: number; paid: number; credit: number }[]> {
  const { c, src } = run;
  let rows: any[];
  if (o.visitExt) {
    const r = await ref(run, 'invoice', `visit:${o.visitExt}`);
    if (!r) throw new Park('payment_unallocated');
    rows = (await c.query(`SELECT id, status, total, paid_amount, credit_amount FROM invoices WHERE id = $1 FOR UPDATE`, [r.our_id])).rows;
  } else {
    rows = (await c.query(
      `SELECT id, status, total, paid_amount, credit_amount FROM invoices WHERE tenant_id = $1 AND external_source_id = $2 AND patient_id = $3 AND branch_id = $4
          AND status IN ('unpaid', 'partially_paid') AND total > paid_amount ORDER BY created_at, invoice_number FOR UPDATE`, [src.tenant_id, src.id, o.patientId, o.branchId])).rows;
  }
  const out = []; let left = o.amount;
  for (const r of rows) {
    if (left <= 0) break;
    const due = Number(r.total) - Number(r.paid_amount);
    if (due <= 0 || r.status === 'void') continue;
    const take = Math.min(due, left);
    out.push({ id: r.id, take, status: r.status, total: Number(r.total), paid: Number(r.paid_amount), credit: Number(r.credit_amount) });
    left -= take;
  }
  if (left > 0) throw new Park('payment_unallocated');
  return out;
}

async function insertPaymentParts(run: Run, extId: string, firstPart: number, o: { branchId: string; method: string; cashier: string; paidAt: Date; note: string | null; parts: Awaited<ReturnType<typeof allocate>> }) {
  const { c, src } = run;
  let n = firstPart;
  for (const p of o.parts) {
    const receipt = await nextNumber(run, 'receipt_seq');
    const partId = n === 1 ? extId : `${extId}#${n}`;
    const pay = (await c.query(
      `INSERT INTO payments (id, tenant_id, branch_id, invoice_id, receipt_number, amount, method, cashier_membership_id, cashier_name, paid_at, note, idempotency_key, request_hash, shift_id, external_source_id)
       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,NULL,NULL,$11) RETURNING id`,
      [src.tenant_id, o.branchId, p.id, receipt, p.take, o.method, o.cashier, o.paidAt, o.note, `ext:${src.id}:payment:${partId}`, src.id])).rows[0];
    const paid = p.paid + p.take;
    await c.query(`UPDATE invoices SET paid_amount = $2, status = $3, version = version + 1, updated_at = demo_now() WHERE id = $1`,
      [p.id, paid, invoiceStatus({ status: p.status, total: p.total, paid, credit: p.credit, hasItems: true })]);
    await setRef(run, 'payment', partId, pay.id, null);
    n++;
  }
}

/** Parts of a mirrored payment («<id>», «<id>#2», …), newest first. */
async function paymentParts(run: Run, extId: string) {
  return (await run.c.query(
    `SELECT p.id, p.invoice_id, p.amount, p.method, p.branch_id, (p.amount - coalesce((SELECT sum(r.amount) FROM refunds r WHERE r.payment_id = p.id), 0))::bigint AS refundable
       FROM external_refs x JOIN payments p ON p.id = x.our_id
      WHERE x.source_id = $1 AND x.kind = 'payment' AND (x.external_id = $2 OR x.external_id LIKE $3) ORDER BY p.paid_at DESC, x.id DESC`,
    [run.src.id, extId, `${extId.replace(/[\\%_]/g, '\\$&')}#%`])).rows as { id: string; invoice_id: string; amount: string; method: string; branch_id: string; refundable: string }[];
}

/** Money back on mirrored payments (newest first), reducing their invoices exactly like a manager's refund does. */
async function refundParts(run: Run, keyBase: string, parts: Awaited<ReturnType<typeof paymentParts>>, amount: number, o: { method: string | null; at: Date; by: string; reason: string }): Promise<string> {
  const { c, src } = run;
  let left = amount; let first: string | null = null; let k = 1;
  // lock the invoices first, then read what is still refundable
  for (const p of parts) await c.query(`SELECT id FROM invoices WHERE id = $1 FOR UPDATE`, [p.invoice_id]);
  const avail = parts.reduce((a, p) => a + Number(p.refundable), 0);
  if (avail < amount) throw new Park('refund_unallocated');
  for (const p of parts) {
    if (left <= 0) break;
    const inv = (await c.query(`SELECT id, branch_id, status, total, paid_amount, credit_amount FROM invoices WHERE id = $1`, [p.invoice_id])).rows[0];
    const take = Math.min(left, Number(p.refundable), Number(inv.paid_amount));
    if (take <= 0) continue;
    const number = await nextNumber(run, 'refund_seq');
    const r = (await c.query(
      `INSERT INTO refunds (tenant_id, branch_id, invoice_id, payment_id, refund_number, amount, method, reason_code, reason, shift_id, approved_by, approved_by_name, refunded_at, idempotency_key, order_id, external_source_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'other',$8,NULL,NULL,$9,$10,$11,NULL,$12) RETURNING id`,
      [src.tenant_id, inv.branch_id, inv.id, p.id, number, take, o.method ?? p.method, o.reason, o.by, o.at, `ext:${src.id}:${keyBase}#${k}`, src.id])).rows[0];
    const paid = Number(inv.paid_amount) - take, credit = Number(inv.credit_amount) + take, total = Number(inv.total) - take;
    await c.query(`UPDATE invoices SET paid_amount = $2, credit_amount = $3, total = $4, refunded_amount = refunded_amount + $5, status = $6, version = version + 1, updated_at = demo_now() WHERE id = $1`,
      [inv.id, paid, credit, total, take, invoiceStatus({ status: inv.status, total, paid, credit, hasItems: true })]);
    first ??= r.id; left -= take; k++;
  }
  if (left > 0) throw new Park('refund_unallocated');
  return first!;
}

async function applyPayment(run: Run, rec: SyncRecord, hash: string): Promise<Outcome> {
  const { c, src } = run;
  const d = dataSchemas.payment.parse(rec.data);
  // MedPlus writes a refund as a negative row of the cash history
  if (d.amount < 0 && !rec.deleted) {
    return applyRefund(run, { ...rec, kind: 'refund', data: { patient_id: d.patient_id, branch_id: d.branch_id, branch_name: d.branch_name, amount: -d.amount, method: d.method, refunded_at: d.paid_at, cashier: d.cashier, cashier_id: d.cashier_id, reason: d.comment } }, hash);
  }
  const existing = await ref(run, 'payment', rec.external_id);
  if (!existing && (rec.deleted || d.amount === 0)) throw new Skip(rec.deleted ? 'deleted' : 'zero');
  const at = mustTime(d.paid_at);
  const parts = existing ? await paymentParts(run, rec.external_id) : [];
  if (!existing) {
    const patientId = await patientOf(run, d.patient_id);
    const branchId = await resolveBranch(run, d);
    const method = await methodOf(run, d.method);
    const cashier = await cashierName(run, d.cashier_id, d.cashier);
    const alloc = await allocate(run, { patientId, branchId, visitExt: d.visit_id, amount: d.amount });
    await insertPaymentParts(run, rec.external_id, 1, { branchId, method, cashier, paidAt: at, note: d.comment, parts: alloc });
    await setRef(run, 'payment', rec.external_id, (await ref(run, 'payment', rec.external_id))!.our_id, hash, rec.updated_at);
    return 'created';
  }
  // MedPlus changed or deleted a payment: payments are append-only here, so the difference is booked — a smaller
  // amount as a refund («adj»), a larger one as another part
  const adjusted = Number((await c.query(`SELECT coalesce(sum(amount),0)::bigint AS s FROM refunds WHERE tenant_id = $1 AND idempotency_key LIKE $2`,
    [src.tenant_id, `ext:${src.id}:adj:${rec.external_id.replace(/[\\%_]/g, '\\$&')}:%`])).rows[0].s);
  const gross = parts.reduce((a, p) => a + Number(p.amount), 0);
  const want = rec.deleted ? 0 : Math.max(0, d.amount);
  const delta = want - (gross - adjusted);
  if (delta < 0) {
    const n = Number((await c.query(`SELECT count(*)::int AS n FROM refunds WHERE tenant_id = $1 AND idempotency_key LIKE $2`,
      [src.tenant_id, `ext:${src.id}:adj:${rec.external_id.replace(/[\\%_]/g, '\\$&')}:%`])).rows[0].n);
    await refundParts(run, `adj:${rec.external_id}:${n + 1}`, parts, -delta, { method: null, at: rec.deleted ? now() : at, by: await cashierName(run, d.cashier_id, d.cashier), reason: rec.deleted ? 'MedPlus: to‘lov o‘chirildi' : 'MedPlus: to‘lov summasi kamaydi' });
  } else if (delta > 0) {
    const patientId = await patientOf(run, d.patient_id);
    const branchId = parts[0]?.branch_id ?? (await resolveBranch(run, d));
    const alloc = await allocate(run, { patientId, branchId, visitExt: d.visit_id, amount: delta });
    await insertPaymentParts(run, rec.external_id, parts.length + 1, { branchId, method: await methodOf(run, d.method), cashier: await cashierName(run, d.cashier_id, d.cashier), paidAt: at, note: d.comment, parts: alloc });
  }
  await setRef(run, 'payment', rec.external_id, existing.our_id, hash, rec.updated_at);
  return 'updated';
}

async function applyRefund(run: Run, rec: SyncRecord, hash: string): Promise<Outcome> {
  const { c, src } = run;
  const d = dataSchemas.refund.parse(rec.data);
  const existing = await ref(run, 'refund', rec.external_id);
  // refunds are append-only: a later change of a MedPlus refund is reported, never rewritten
  if (existing) { if (existing.payload_hash === hash) return 'unchanged'; throw new RecordError('refund_changed'); }
  if (rec.deleted) throw new Skip('deleted');
  const at = mustTime(d.refunded_at);
  let parts: Awaited<ReturnType<typeof paymentParts>>;
  if (d.payment_id) {
    parts = await paymentParts(run, d.payment_id);
    if (!parts.length) throw new Park('payment_missing');
  } else {
    if (!d.patient_id) throw new RecordError('payment_missing');
    const patientId = await patientOf(run, d.patient_id);
    const branchId = await resolveBranch(run, d);
    parts = (await c.query(
      `SELECT p.id, p.invoice_id, p.amount, p.method, p.branch_id, (p.amount - coalesce((SELECT sum(r.amount) FROM refunds r WHERE r.payment_id = p.id), 0))::bigint AS refundable
         FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.tenant_id = $1 AND p.external_source_id = $2 AND i.patient_id = $3 AND p.branch_id = $4 ORDER BY p.paid_at DESC, p.receipt_number DESC LIMIT 50`,
      [src.tenant_id, src.id, patientId, branchId])).rows;
  }
  const method = d.method ? await methodOf(run, d.method) : null;
  const first = await refundParts(run, `refund:${rec.external_id}`, parts, d.amount, { method, at, by: await cashierName(run, d.cashier_id, d.cashier), reason: d.reason ? `MedPlus: ${d.reason}`.slice(0, 500) : 'MedPlus: qaytarish' });
  await setRef(run, 'refund', rec.external_id, first, hash, rec.updated_at);
  return 'created';
}

// ---------------------------------------------------------------- reference records and control totals

async function applyReference(run: Run, rec: SyncRecord): Promise<Outcome> {
  const kind = rec.kind as MapKind;
  const d = (dataSchemas as any)[kind].parse(rec.data);
  const before = (await run.c.query(`SELECT 1 FROM external_mappings WHERE source_id = $1 AND kind = $2 AND external_id = $3`, [run.src.id, kind, rec.external_id])).rowCount;
  await mapRef(run, kind, rec.external_id, d.name ?? null, { percent: d.percent ?? null, specialty: d.specialty ?? null, category: d.category ?? null });
  return before ? 'unchanged' : 'created';
}

async function applyTotals(run: Run, rec: SyncRecord): Promise<Outcome> {
  const d = dataSchemas.daily_totals.parse(rec.data);
  const day = parseExtDate(d.date);
  if (!day) throw new RecordError('bad_time');
  const branch = (d.branch_id ? d.branch_id : d.branch_name ? 'name:' + normName(d.branch_name) : '').slice(0, 200);
  const r = await run.c.query(
    `INSERT INTO external_daily_totals (tenant_id, source_id, day, branch_external_id, payments_sum, payments_count, patients_total, received_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (source_id, day, branch_external_id) DO UPDATE SET payments_sum = EXCLUDED.payments_sum, payments_count = EXCLUDED.payments_count,
       patients_total = EXCLUDED.patients_total, received_at = EXCLUDED.received_at RETURNING (xmax = 0) AS inserted`,
    [run.src.tenant_id, run.src.id, day, branch, d.payments_sum, d.payments_count, d.patients_total, now()]);
  return r.rows[0].inserted ? 'created' : 'updated';
}

// ---------------------------------------------------------------- one record

const HASHED: Partial<Record<RecordKind, string>> = { patient: 'patient', visit: 'visit', order: 'order', payment: 'payment', refund: 'refund' };

/** Applies one record inside the caller's transaction. Park/RecordError/Skip are thrown; the caller turns them into outcomes. */
async function applyRecord(run: Run, rec: SyncRecord): Promise<Outcome> {
  const refKind = HASHED[rec.kind];
  // empty fields do not count: the same MedPlus row from the bridge and from a file has the same hash
  const hash = stableHash({ d: Object.fromEntries(Object.entries(rec.data).filter(([, v]) => v !== null && v !== undefined && v !== '')), x: !!rec.deleted });
  if (refKind) {
    const r = await ref(run, refKind, rec.external_id);
    if (r && r.payload_hash === hash) return 'unchanged';
  }
  switch (rec.kind) {
    case 'patient': return applyPatient(run, rec, hash);
    case 'visit': return applyVisit(run, rec, hash);
    case 'order': return applyOrder(run, rec, hash);
    case 'payment': return applyPayment(run, rec, hash);
    case 'refund': return applyRefund(run, rec, hash);
    case 'daily_totals': return applyTotals(run, rec);
    default: return applyReference(run, rec);
  }
}

const markSync = (c: PoolClient) => c.query(`SELECT set_config('meduza.sync', 'on', true)`);

async function park(run: Run, rec: SyncRecord, reason: string) {
  await run.c.query(
    `INSERT INTO external_pending (tenant_id, source_id, kind, external_id, record, reason, first_seen_at, last_tried_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT (source_id, kind, external_id) DO UPDATE SET record = EXCLUDED.record, reason = EXCLUDED.reason, attempts = external_pending.attempts + 1, last_tried_at = EXCLUDED.last_tried_at`,
    [run.src.tenant_id, run.src.id, rec.kind, rec.external_id, JSON.stringify(rec), reason, now()]);
}

function codeOf(e: unknown): string {
  if (e instanceof RecordError || e instanceof Skip) return e.code;
  if ((e as any)?.name === 'ZodError') return 'invalid_data';
  const pg = (e as any)?.code;
  if (pg === '23505') return 'duplicate';
  if (pg === 'MR409') return 'read_only';
  if (typeof pg === 'string' && /^2[23]/.test(pg)) return 'invalid_data';
  return 'internal';
}

/**
 * Applies one record in its own savepoint on `c` (the caller owns the transaction): success, a park (the record goes
 * to external_pending in the same transaction), a skip or an error. Unknown failures are rethrown only when they are
 * not about this record's data.
 */
async function applyIsolated(run: Run, rec: SyncRecord): Promise<RecordResult> {
  const { c } = run;
  await c.query('SAVEPOINT rec');
  try {
    const outcome = await applyRecord(run, rec);
    await c.query(`DELETE FROM external_pending WHERE source_id = $1 AND kind = $2 AND external_id = $3`, [run.src.id, rec.kind, rec.external_id]);
    await c.query('RELEASE SAVEPOINT rec');
    return { kind: rec.kind, external_id: rec.external_id, outcome };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT rec');
    if (e instanceof Park) {
      await park(run, rec, e.reason);
      if (e.mapping) await c.query(
        `INSERT INTO external_mappings (tenant_id, source_id, kind, external_id, external_name, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source_id, kind, external_id) DO NOTHING`,
        [run.src.tenant_id, run.src.id, e.mapping.kind, e.mapping.key, e.mapping.name, now()]);
      await c.query('RELEASE SAVEPOINT rec');
      return { kind: rec.kind, external_id: rec.external_id, outcome: 'parked', code: e.reason };
    }
    await c.query('RELEASE SAVEPOINT rec');
    const code = codeOf(e);
    if (code === 'internal') console.warn(`[sync] ${rec.kind} ${rec.external_id}: ${(e as Error)?.message}`);
    return { kind: rec.kind, external_id: rec.external_id, outcome: e instanceof Skip ? 'skipped' : 'error', code };
  }
}

// ---------------------------------------------------------------- batches

/** One batch per source at a time: the second sender retries a little later. */
export const syncBusy = () => coded(409, 'SYNC_BUSY', 'api.sync.busy');

/** Validates the raw records: bad shapes become errors (with the external id when it is readable) without stopping the batch. */
export function parseRecords(raw: unknown[]): { records: SyncRecord[]; bad: RecordResult[] } {
  const records: SyncRecord[] = []; const bad: RecordResult[] = [];
  for (const r of raw) {
    const p = recordSchema.safeParse(r);
    if (p.success) records.push(p.data);
    else bad.push({ kind: String((r as any)?.kind ?? '?').slice(0, 20), external_id: String((r as any)?.external_id ?? '?').slice(0, 60), outcome: 'error', code: 'invalid_record' });
  }
  records.sort((a, b) => KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)!);
  return { records, bad };
}

function tally(results: RecordResult[], appliedPending = 0): BatchResult {
  const r: BatchResult = { received: results.length, created: 0, updated: 0, unchanged: 0, parked: 0, skipped: 0, errors: 0, applied_pending: appliedPending, error_samples: [] };
  for (const x of results) {
    if (x.outcome === 'error') { r.errors++; if (r.error_samples.length < MAX_SAMPLES) r.error_samples.push({ kind: x.kind, external_id: x.external_id.slice(0, 60), code: x.code ?? 'error' }); }
    else if (x.outcome === 'created') r.created++; else if (x.outcome === 'updated') r.updated++; else if (x.outcome === 'unchanged') r.unchanged++;
    else if (x.outcome === 'parked') r.parked++; else r.skipped++;
  }
  return r;
}

/**
 * Runs a batch for one source. One source runs one batch at a time (advisory lock; a second sender gets SYNC_BUSY and
 * retries). Live: each record commits on its own, then the parked records are retried. Dry run (file preview): the
 * whole batch runs in one transaction that is rolled back — the preview shows exactly what an import would do.
 */
export async function runBatch(db: Db, src: Source, raw: unknown[], opts: { channel: 'bridge' | 'file'; actor: string; ctx: Ctx; dryRun?: boolean; cursor?: unknown; withResults?: boolean }): Promise<BatchResult> {
  const lock = await db.pool.connect();
  let locked = false;
  try {
    locked = (await lock.query(`SELECT pg_try_advisory_lock(74042, hashtext($1)) AS ok`, [src.id])).rows[0].ok;
    if (!locked) throw syncBusy();
    const started = now();
    const { records, bad } = parseRecords(raw);
    const results: RecordResult[] = [...bad];
    const fake = { n: 0 };
    let appliedPending = 0;
    if (opts.dryRun) {
      await db.tx(async (c) => {
        await markSync(c);
        const run: Run = { c, src, dry: true, fake, actor: opts.actor };
        for (const rec of records) results.push(await applyIsolated(run, rec));
        throw new DryRunDone();
      }).catch((e) => { if (!(e instanceof DryRunDone)) throw e; });
      const r = tally(results);
      if (opts.withResults) r.results = results;
      return r;
    }
    for (const rec of records) {
      results.push(await db.tx(async (c) => { await markSync(c); return applyIsolated({ c, src, dry: false, fake, actor: opts.actor }, rec); }));
    }
    const retried = await retryPendingLocked(db, src, opts.actor);
    appliedPending = retried.filter((x) => x.outcome === 'created' || x.outcome === 'updated').length;
    const r = tally(results, appliedPending);
    for (const x of retried) if (x.outcome === 'error') { r.errors++; if (r.error_samples.length < MAX_SAMPLES) r.error_samples.push({ kind: x.kind, external_id: x.external_id.slice(0, 60), code: x.code ?? 'error' }); }
    await db.tx(async (c) => {
      await c.query(
        `INSERT INTO external_sync_log (tenant_id, source_id, channel, actor_name, received, created, updated, unchanged, parked, skipped, errors, applied_pending, error_samples, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [src.tenant_id, src.id, opts.channel, opts.actor.slice(0, 200), r.received, r.created, r.updated, r.unchanged, r.parked, r.skipped, r.errors, r.applied_pending, JSON.stringify(r.error_samples), started, now()]);
      await c.query(`UPDATE external_sources SET last_batch_at = $2${opts.cursor ? ', last_cursor = $3' : ''} WHERE id = $1`, opts.cursor ? [src.id, now(), JSON.stringify(opts.cursor)] : [src.id, now()]);
      await audit(c, opts.ctx, opts.channel === 'file' ? 'sync.import' : 'sync.batch', 'external_source', src.id,
        `MedPlus ${opts.channel === 'file' ? 'fayl importi' : 'paketi'}: ${r.received} ta yozuv — yangi ${r.created}, yangilangan ${r.updated}, o‘zgarmagan ${r.unchanged}, kutilmoqda ${r.parked}, xato ${r.errors}`);
    });
    if (opts.withResults) r.results = results;
    return r;
  } finally {
    if (locked) await lock.query(`SELECT pg_advisory_unlock(74042, hashtext($1))`, [src.id]).catch(() => undefined);
    lock.release();
  }
}
class DryRunDone extends Error {}

/** Retries parked records (oldest first) and drops the ones older than PENDING_DAYS. Needs the source lock. */
async function retryPendingLocked(db: Db, src: Source, actor: string): Promise<RecordResult[]> {
  const out: RecordResult[] = [];
  const fake = { n: 0 };
  await db.rows(`DELETE FROM external_pending WHERE source_id = $1 AND first_seen_at < $2::timestamptz - make_interval(days => $3)`, [src.id, now(), PENDING_DAYS]);
  const rows = await db.rows(`SELECT kind, external_id, record FROM external_pending WHERE source_id = $1 ORDER BY first_seen_at, id LIMIT $2`, [src.id, RETRY_LIMIT]);
  const recs = rows.map((r) => recordSchema.safeParse(r.record)).filter((p) => p.success).map((p) => (p as any).data as SyncRecord);
  recs.sort((a, b) => KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)!);
  for (const rec of recs) {
    const res = await db.tx(async (c) => { await markSync(c); return applyIsolated({ c, src, dry: false, fake, actor }, rec); });
    if (res.outcome === 'error' || res.outcome === 'skipped') await db.rows(`DELETE FROM external_pending WHERE source_id = $1 AND kind = $2 AND external_id = $3`, [src.id, rec.kind, rec.external_id]);
    out.push(res);
  }
  return out;
}

/** After the manager maps a branch or a payment form: the waiting records get another try right away. */
export async function retryPending(db: Db, src: Source, actor: string): Promise<number> {
  const lock = await db.pool.connect();
  try {
    const ok = (await lock.query(`SELECT pg_try_advisory_lock(74042, hashtext($1)) AS ok`, [src.id])).rows[0].ok;
    if (!ok) return 0; // a batch is running: it retries the pending records itself at its end
    try { return (await retryPendingLocked(db, src, actor)).filter((x) => x.outcome === 'created' || x.outcome === 'updated').length; } finally { await lock.query(`SELECT pg_advisory_unlock(74042, hashtext($1))`, [src.id]).catch(() => undefined); }
  } finally { lock.release(); }
}
