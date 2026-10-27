// The batch protocol between the bridge (or a file import) and Med.uz.ai — docs/MEDPLUS_SYNC.md «Protocol».
// A batch is a list of records {kind, external_id, updated_at?, deleted?, data}. Money is integer tiyin (the bridge
// converts MedPlus so‘m), times are ISO or «YYYY-MM-DD HH:MM[:SS]» clinic wall time.
import { z } from 'zod';

/** Applied in this order inside a batch, so a patient is in place before its visit, a visit before its orders, … */
export const RECORD_KINDS = ['branch', 'staff', 'method', 'doctor', 'service', 'patient', 'visit', 'order', 'payment', 'refund', 'daily_totals'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export const KIND_ORDER = new Map(RECORD_KINDS.map((k, i) => [k, i]));

/** Most records in one batch (the bridge sends 200 by default). */
export const MAX_BATCH = 1000;

const id = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(z.string().min(1).max(100));
const optId = z.union([z.string(), z.number(), z.null()]).optional().transform((v) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, 100)));
const text = (max: number) => z.union([z.string(), z.number(), z.null()]).optional().transform((v) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, max) || null));
const when = z.union([z.string().max(40), z.number(), z.date()]);
const tiyin = z.union([z.number(), z.string()]).transform((v) => Number(v)).pipe(z.number().int().min(-1e13).max(1e13));
const optTiyin = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v == null || v === '' ? null : Number(v))).pipe(z.number().int().min(0).max(1e13).nullable());

export const recordSchema = z.object({
  kind: z.enum(RECORD_KINDS),
  external_id: id,
  updated_at: z.union([z.string().max(40), z.null()]).optional(),
  deleted: z.boolean().optional(),
  data: z.record(z.unknown()).default({}),
});
export type SyncRecord = z.infer<typeof recordSchema>;

export const batchSchema = z.object({
  /** the bridge's cursor after this batch (ids and timestamps only) — kept for the status screen */
  cursor: z.record(z.union([z.string().max(300), z.number(), z.null()])).optional(),
  records: z.array(z.unknown()).max(MAX_BATCH),
});

const branchRef = { branch_id: optId, branch_name: text(200) };
export const dataSchemas = {
  branch: z.object({ name: text(200) }),
  staff: z.object({ name: text(200), role: text(60) }),
  method: z.object({ name: text(200) }),
  doctor: z.object({ name: text(200), specialty: text(120), percent: z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v == null || v === '' ? null : Number(v))).pipe(z.number().min(0).max(100).nullable()) }),
  service: z.object({ name: text(200), category: text(40) }),
  patient: z.object({
    full_name: text(300), last_name: text(100), first_name: text(100), middle_name: text(100),
    birth_date: z.union([z.string().max(40), z.date(), z.null()]).optional(), sex: text(20),
    phone: text(40), phone2: text(40), pinfl: text(20), address: text(500),
  }),
  visit: z.object({
    patient_id: id, ...branchRef, doctor_id: optId, doctor_name: text(200), service_id: optId, service_name: text(200),
    starts_at: when, duration_min: z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v == null || v === '' ? null : Number(v))), status: text(40),
  }),
  order: z.object({
    patient_id: id, visit_id: optId, ...branchRef, service_id: optId, service_name: text(200), category: text(40), doctor_id: optId, doctor_name: text(200),
    price: tiyin.pipe(z.number().min(0)), quantity: z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v == null || v === '' ? 1 : Number(v))),
    discount: optTiyin, doctor_percent: z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v == null || v === '' ? null : Number(v))).pipe(z.number().min(0).max(100).nullable()),
    ordered_at: when,
  }),
  payment: z.object({
    patient_id: id, visit_id: optId, ...branchRef, amount: tiyin, method: text(200), paid_at: when,
    cashier: text(200), cashier_id: optId, comment: text(300),
  }),
  refund: z.object({
    payment_id: optId, patient_id: optId, ...branchRef, amount: tiyin.pipe(z.number().positive()), method: text(200), refunded_at: when,
    cashier: text(200), cashier_id: optId, reason: text(300),
  }),
  daily_totals: z.object({
    date: z.union([z.string().max(40), z.date()]), ...branchRef,
    payments_sum: tiyin, payments_count: z.union([z.number(), z.string()]).transform((v) => Number(v)).pipe(z.number().int().min(0).max(1e7)),
    patients_total: z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v == null || v === '' ? null : Number(v))).pipe(z.number().int().min(0).max(1e8).nullable()),
  }),
} satisfies Record<RecordKind, z.ZodTypeAny>;
