import { z } from 'zod';
import { normalizePhone } from './money';
import { EXPENSE_CATEGORIES } from './labels';

/** Control and invisible characters (NUL, zero-width, bidi marks) never belong in typed text. */
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
export const cleanText = (s: string) => s.replace(INVISIBLE, '');
const trimmed = (min: number, max: number, label: string) =>
  z.string({ required_error: `${label} kiritilishi shart` })
    .transform((s) => cleanText(s).trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(min, `${label} kamida ${min} belgidan iborat bo‘lsin`).max(max, `${label} ${max} belgidan oshmasin`));
const optionalText = (max: number) =>
  z.string().max(max, `${max} belgidan oshmasin`).optional().nullable()
    .transform((s) => { const v = s == null ? '' : cleanText(s).trim(); return v === '' ? null : v; });
/** A real calendar day (2027-02-30 is not rolled over to March) between 1900 and 2100. */
export const isRealDate = (s: string) => {
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= '1900-01-01' && s <= '2100-12-31';
};
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana YYYY-MM-DD formatida bo‘lsin')
  .refine(isRealDate, 'Noto‘g‘ri sana');
const phone = z.string().optional().nullable().transform((s, ctx) => {
  if (s == null || s.trim() === '') return null;
  const p = normalizePhone(s);
  if (!p) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefon +998 va 9 raqam ko‘rinishida bo‘lsin' }); return z.NEVER; }
  return p;
});
const uuid = z.string().uuid('Noto‘g‘ri identifikator');

export const loginSchema = z.object({ membership_id: uuid, access_code: z.string().max(200).optional() });

export const patientBaseSchema = z.object({
  last_name: trimmed(2, 80, 'Familiya'),
  first_name: trimmed(2, 80, 'Ism'),
  middle_name: optionalText(80),
  birth_date: isoDate,
  sex: z.enum(['male', 'female', 'unspecified']).default('unspecified'),
  phone,
  contact_name: optionalText(120),
  contact_phone: phone,
  address: optionalText(300),
  note: optionalText(500),
  allergy_state: z.enum(['known', 'denied', 'unknown']).default('unknown'),
  allergy_note: optionalText(300),
});
// ---------- patient consent (ZRU-547) ----------
// 'biometric' = face recognition by the clinic's camera (written consent only; the face stays in the camera, never in Med.uz.ai)
export const CONSENT_KINDS = ['data_processing', 'notifications', 'biometric'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
/** How the consent was obtained. 'telegram' is recorded only by the bot (the patient pressed «Roziman» themselves). */
export const CONSENT_METHODS = ['signed_paper', 'telegram', 'verbal'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];
const staffConsentMethod = z.enum(['signed_paper', 'verbal'], { errorMap: () => ({ message: 'Rozilik qanday olinganini tanlang' }) });
export const consentRecordSchema = z.object({
  kind: z.enum(CONSENT_KINDS, { errorMap: () => ({ message: 'Rozilik turini tanlang' }) }),
  granted: z.boolean({ errorMap: () => ({ message: 'Bemor javobini tanlang' }) }),
  method: staffConsentMethod,
  note: optionalText(500),
});
export type ConsentRecordInput = z.infer<typeof consentRecordSchema>;

export const patientCreateSchema = patientBaseSchema.extend({
  confirm_duplicate: z.boolean().optional(),
  /** Consent given at registration; recorded in the same transaction. Required in production (APP_MODE=production). */
  consent: z.object({
    data_processing: z.boolean({ errorMap: () => ({ message: 'Bemor javobini tanlang' }) }),
    notifications: z.boolean().optional(),
    method: staffConsentMethod,
  }).optional().nullable(),
});
export const patientUpdateSchema = patientBaseSchema.partial();
export type PatientInput = z.infer<typeof patientCreateSchema>;

export const appointmentCreateSchema = z.object({
  patient_id: uuid,
  branch_id: uuid,
  doctor_id: uuid,
  service_id: uuid,
  date: isoDate,
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Vaqt HH:MM formatida bo‘lsin'),
  duration_min: z.number().int().min(5, 'Kamida 5 daqiqa').max(240, '240 daqiqadan oshmasin').optional(),
  note: optionalText(300),
});
export const appointmentUpdateSchema = z.object({
  version: z.number().int(),
  doctor_id: uuid.optional(),
  service_id: uuid.optional(),
  date: isoDate.optional(),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Vaqt HH:MM formatida bo‘lsin').optional(),
  duration_min: z.number().int().min(5).max(240).optional(),
  note: optionalText(300),
});
export const appointmentActionSchema = z.object({ version: z.number().int().optional(), reason: optionalText(300) });
/** Walk-in: the registrar picks the doctor (and optionally the service); the server picks the time and checks the patient in. */
export const walkInSchema = z.object({ patient_id: uuid, doctor_id: uuid, service_id: uuid.optional(), note: optionalText(300) });

const vitalNum = (min: number, max: number, label: string) =>
  z.union([z.number(), z.null()]).optional().refine((v) => v == null || (v >= min && v <= max), `${label}: ${min}–${max} oralig‘ida bo‘lsin`);
export const noteFieldsSchema = z.object({
  complaints: optionalText(4000),
  anamnesis: optionalText(4000),
  examination: optionalText(4000),
  diagnosis: optionalText(2000),
  recommendations: optionalText(4000),
  follow_up_date: isoDate.optional().nullable(),
  /** ICD-10 (MKB-10) codes chosen by the doctor; titles are snapshotted on the server. */
  icd10: z.array(z.string().regex(/^[A-Z][0-9]{2}(\.[0-9]{1,2})?$/, 'Noto‘g‘ri MKB-10 kodi')).max(5, 'Ko‘pi bilan 5 ta kod').optional(),
  vitals: z.object({
    bp_sys: vitalNum(50, 260, 'Sistolik bosim'),
    bp_dia: vitalNum(30, 160, 'Diastolik bosim'),
    pulse: vitalNum(20, 250, 'Puls'),
    temp: vitalNum(30, 43, 'Harorat'),
  }).partial().default({}),
});
export const noteDraftSchema = noteFieldsSchema.extend({ version: z.number().int() });
export const noteSignSchema = noteDraftSchema;
/** Addendum to a signed note: the text and why it is added (both required, both kept as written). */
export const noteAddendumSchema = z.object({
  text: z.string({ required_error: 'Qo‘shimcha matn kiritilishi shart' }).transform((s) => cleanText(s).trim())
    .pipe(z.string().min(3, 'Qo‘shimcha matn kamida 3 belgidan iborat bo‘lsin').max(4000, 'Qo‘shimcha matn 4000 belgidan oshmasin')),
  reason: trimmed(3, 300, 'Sabab'),
});
/** Personal display settings: interface language and text size (at least one). */
export const preferencesSchema = z.object({
  locale: z.enum(['uz', 'uz-Cyrl', 'ru']).optional(),
  text_size: z.enum(['normal', 'large']).optional(),
}).strict().refine((p) => p.locale !== undefined || p.text_size !== undefined, { message: 'Til yoki matn o‘lchamini tanlang' });

export const REQUIRED_FOR_SIGN = ['complaints', 'examination', 'diagnosis', 'recommendations'] as const;

/** Doctor's orders: `items` with a quantity (1–50, a course of procedures) or the older `service_ids` (quantity 1). */
export const orderItemSchema = z.object({
  service_id: uuid,
  quantity: z.number({ invalid_type_error: 'Miqdorni kiriting' }).int('Miqdor butun son bo‘lsin').min(1, 'Miqdor 1–50 oralig‘ida bo‘lsin').max(50, 'Miqdor 1–50 oralig‘ida bo‘lsin').default(1),
});
export const ordersCreateSchema = z.object({
  service_ids: z.array(uuid).max(10).optional(),
  items: z.array(orderItemSchema).max(10).optional(),
}).transform((o) => ({ items: [...(o.items ?? []), ...(o.service_ids ?? []).map((service_id) => ({ service_id, quantity: 1 }))] }))
  .refine((o) => o.items.length >= 1, { message: 'Kamida bitta tekshiruv tanlang', path: ['service_ids'] })
  .refine((o) => o.items.length <= 10, { message: 'Ko‘pi bilan 10 ta tekshiruv', path: ['service_ids'] });

export const labResultSchema = z.object({
  values: z.array(z.object({ code: z.string().max(20), value: z.string().max(40).transform((s) => s.trim()) })).max(30),
  comment: optionalText(1000),
});

export const discountSchema = z.object({
  type: z.enum(['percent', 'amount']),
  value: z.number().positive('Qiymat 0 dan katta bo‘lsin'),
  reason: trimmed(3, 300, 'Sabab'),
}).refine((d) => d.type !== 'percent' || d.value <= 100, { message: 'Foiz 0–100 oralig‘ida bo‘lsin', path: ['value'] })
  // an amount is whole tiyin, a percent has at most two decimals (no discounts that round to nothing)
  .refine((d) => (d.type === 'amount' ? Number.isInteger(d.value) : d.value >= 0.01 && Math.abs(d.value * 100 - Math.round(d.value * 100)) < 1e-6),
    { message: 'Chegirma qiymati noto‘g‘ri', path: ['value'] });

export const paymentSchema = z.object({
  amount: z.number({ invalid_type_error: 'Summa kiritilishi shart' }).int('Summa tiyinda butun son bo‘lsin').positive('Summa 0 dan katta bo‘lsin'),
  // 'deposit' = covered from the patient's prepayment balance (no cash moves, no shift)
  method: z.enum(['cash', 'card', 'transfer', 'deposit'], { errorMap: () => ({ message: 'To‘lov usulini tanlang' }) }),
  note: optionalText(300),
});
export const voidSchema = z.object({ reason: trimmed(3, 300, 'Sabab') });

// ---------- Catalogue (manager-only: services, rooms, branches, stock items) ----------
export const SERVICE_CATEGORIES = ['consultation', 'lab', 'ultrasound', 'procedure'] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
const serviceCategory = z.enum(SERVICE_CATEGORIES, { errorMap: () => ({ message: 'Xizmat turini tanlang' }) });
const priceTiyin = z.number({ invalid_type_error: 'Narxni kiriting' }).int('Narx tiyinda butun son bo‘lsin').min(0, 'Narx manfiy bo‘lmasin').max(1_000_000_000_00, 'Narx juda katta');
const sharePercent = z.number({ invalid_type_error: 'Ulushni kiriting' }).min(0, 'Ulush 0–100 oralig‘ida bo‘lsin').max(100, 'Ulush 0–100 oralig‘ida bo‘lsin')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Ulush ko‘pi bilan 2 ta kasr xona');
const durationMin = z.number({ invalid_type_error: 'Davomiylikni kiriting' }).int('Davomiylik butun son bo‘lsin').min(5, 'Davomiylik 5–240 daqiqa bo‘lsin').max(240, 'Davomiylik 5–240 daqiqa bo‘lsin');
/** One row of a lab service's result form: what the laborant fills in and the reference range shown to the doctor. */
export const labTemplateRowSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: trimmed(1, 80, 'Ko‘rsatkich nomi'),
  unit: z.string().trim().max(20).default(''),
  ref_low: z.number().nullable().default(null),
  ref_high: z.number().nullable().default(null),
  ref_text: z.string().trim().max(80).nullable().default(null),
});
export const labTemplateSchema = z.array(labTemplateRowSchema).max(30, 'Ko‘pi bilan 30 ta ko‘rsatkich');

export const serviceCreateSchema = z.object({
  name: trimmed(2, 120, 'Nomi'),
  category: serviceCategory,
  price: priceTiyin, // tiyin, general price (all branches)
  duration_min: durationMin,
  share_percent: sharePercent.default(0),
  lab_template: labTemplateSchema.nullable().optional(),
  active: z.boolean().default(true),
});
export const servicePatchSchema = z.object({
  name: trimmed(2, 120, 'Nomi').optional(),
  category: serviceCategory.optional(),
  price: priceTiyin.optional(), // tiyin
  /** with `price`: the price applies to this branch only (NULL/absent = the general price) */
  branch_id: uuid.nullable().optional(),
  duration_min: durationMin.optional(),
  share_percent: sharePercent.optional(),
  lab_template: labTemplateSchema.nullable().optional(),
  active: z.boolean().optional(),
});

export const roomCreateSchema = z.object({
  name: trimmed(1, 60, 'Xona nomi'),
  branch_id: uuid,
  purpose: optionalText(80),
  active: z.boolean().default(true),
});
export const roomPatchSchema = roomCreateSchema.partial();

export const branchCreateSchema = z.object({
  name: trimmed(2, 80, 'Filial nomi'),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, 'Kod 2–8 ta lotin harfi yoki raqam').optional(),
  address: optionalText(200),
  phone,
  active: z.boolean().default(true),
});
export const branchPatchSchema = branchCreateSchema.omit({ code: true }).partial();

const qty = z.number().min(0, 'Miqdor manfiy bo‘lmasin').max(1_000_000, 'Miqdor juda katta')
  .refine((q) => Math.abs(q * 100 - Math.round(q * 100)) < 1e-6, 'Ko‘pi bilan 2 ta kasr xona');
export const inventoryItemCreateSchema = z.object({
  name: trimmed(2, 100, 'Material nomi'),
  unit: trimmed(1, 20, 'O‘lchov birligi'),
  branch_id: uuid,
  minimum_qty: qty.default(0),
  opening_qty: qty.default(0),
  active: z.boolean().default(true),
});
export const inventoryItemPatchSchema = inventoryItemCreateSchema.omit({ opening_qty: true }).partial();
export const clinicPatchSchema = z.object({ name: trimmed(2, 120, 'Klinika nomi') });

export const inventoryMovementSchema = z.object({
  type: z.enum(['in', 'out']),
  quantity: z.number().positive('Miqdor 0 dan katta bo‘lsin').max(1_000_000, 'Miqdor juda katta')
    .refine((q) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6, 'Ko‘pi bilan 3 ta kasr xona'),
  reason: trimmed(3, 200, 'Sabab'),
  date: isoDate.optional(),
});

export const uziReportSchema = z.object({
  description: optionalText(4000),
  conclusion: optionalText(2000),
});

export const aiNoteDraftSchema = z.object({ text: z.string().trim().min(10, 'Kamida 10 belgi kiriting').max(6000), encounter_id: uuid.optional() });
export const icd10SuggestSchema = z.object({ text: z.string().trim().min(3, 'Tashxis matnini kiriting').max(2000), encounter_id: uuid.optional() });
export const newsFeedbackSchema = z.object({ useful: z.boolean() });
/** Extra news topics a doctor follows besides their own specialty (at most 5). */
export const NEWS_TOPICS_MAX = 5;
export const newsTopicsSchema = z.object({ keys: z.array(z.string().regex(/^[a-z_]{2,32}$/)).max(NEWS_TOPICS_MAX, `Ko‘pi bilan ${NEWS_TOPICS_MAX} ta mavzu`) });
export const newsSaveSchema = z.object({ saved: z.boolean() });
export const aiReportSchema = z.object({ question: z.enum(['revenue_today', 'top_services', 'debts']), branch_id: uuid.optional().nullable() });

// ---------- Staff authentication ----------
/**
 * A login is either an Uzbek phone number (normalised to +998XXXXXXXXX) or a username
 * (3–32 chars: a-z, 0-9, dot, underscore, dash), compared case-insensitively.
 */
export function normalizeLogin(input: string | null | undefined): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const phone = normalizePhone(raw);
  if (phone) return phone;
  const u = raw.toLowerCase();
  return /^[a-z][a-z0-9._-]{2,31}$/.test(u) ? u : null;
}

export const PASSWORD_RULE = 'Parol kamida 8 belgi, kamida bitta harf va bitta raqamdan iborat bo‘lsin';
export const passwordSchema = z.string().min(8, PASSWORD_RULE).max(128, 'Parol 128 belgidan oshmasin')
  .refine((p) => /[A-Za-zЀ-ӿ]/.test(p) && /\d/.test(p), PASSWORD_RULE);

export const passwordLoginSchema = z.object({
  login: z.string().trim().min(1, 'Telefon yoki loginni kiriting').max(64),
  password: z.string().min(1, 'Parolni kiriting').max(128),
  membership_id: uuid.optional(),
});

export const passwordChangeSchema = z.object({
  current_password: z.string().min(1, 'Joriy parolni kiriting').max(128),
  new_password: passwordSchema,
}).refine((d) => d.current_password !== d.new_password, { message: 'Yangi parol eskisidan farq qilsin', path: ['new_password'] });

const loginField = z.string().transform((s, ctx) => {
  const l = normalizeLogin(s);
  if (!l) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefon (+998 …) yoki lotin harflaridagi login (3–32 belgi) kiriting' }); return z.NEVER; }
  return l;
});

export const staffDoctorSchema = z.object({
  specialty: trimmed(2, 80, 'Mutaxassislik'),
  share_percent: z.number().min(0, '0–100 oralig‘ida').max(100, '0–100 oralig‘ida').default(0),
  service_ids: z.array(uuid).max(100).default([]),
});

export const staffCreateSchema = z.object({
  full_name: trimmed(3, 120, 'F.I.Sh.'),
  role: z.enum(['manager', 'registrar', 'doctor', 'cashier', 'lab'], { errorMap: () => ({ message: 'Rolni tanlang' }) }),
  title: optionalText(80),
  login: loginField,
  branch_ids: z.array(uuid).min(1, 'Kamida bitta filialni tanlang'),
  doctor: staffDoctorSchema.optional(),
}).refine((d) => d.role !== 'doctor' || !!d.doctor, { message: 'Shifokor uchun mutaxassislikni kiriting', path: ['doctor.specialty'] });

export const staffUpdateSchema = z.object({
  full_name: trimmed(3, 120, 'F.I.Sh.').optional(),
  role: z.enum(['manager', 'registrar', 'cashier', 'lab']).optional(), // doctor role is fixed at creation (linked doctor record)
  title: optionalText(80),
  login: loginField.optional(),
  branch_ids: z.array(uuid).min(1, 'Kamida bitta filialni tanlang').optional(),
  status: z.enum(['active', 'inactive']).optional(),
  doctor: staffDoctorSchema.partial().optional(),
});

// ---------- Doctor weekly schedule ----------
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Vaqt HH:MM formatida bo‘lsin');
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** One working day. A doctor works in a single branch per weekday (0 = Sunday). */
export const scheduleDaySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  branch_id: uuid,
  room_id: uuid.nullable().optional(),
  start: hhmm,
  end: hhmm,
  break_start: hhmm.nullable().optional(),
  break_end: hhmm.nullable().optional(),
}).superRefine((d, ctx) => {
  if (mins(d.end) - mins(d.start) < 30) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'Ish vaqti kamida 30 daqiqa bo‘lsin' });
  if (!!d.break_start !== !!d.break_end) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['break_end'], message: 'Tanaffusning boshi va oxirini kiriting' });
  else if (d.break_start && d.break_end) {
    if (mins(d.break_end) <= mins(d.break_start)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['break_end'], message: 'Tanaffus oxiri boshidan keyin bo‘lsin' });
    else if (mins(d.break_start) < mins(d.start) || mins(d.break_end) > mins(d.end)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['break_start'], message: 'Tanaffus ish vaqti ichida bo‘lsin' });
  }
});

export const schedulePutSchema = z.object({
  days: z.array(scheduleDaySchema).max(7),
  /** Save even though some future appointments fall outside the new hours (they are kept and must be rescheduled). */
  confirm_conflicts: z.boolean().optional(),
}).refine((d) => new Set(d.days.map((x) => x.weekday)).size === d.days.length, { message: 'Har bir hafta kuni bir marta', path: ['days'] });

export const SCHEDULE_EXCEPTION_KINDS = ['day_off', 'vacation', 'holiday', 'custom_hours'] as const;
export type ScheduleExceptionKind = (typeof SCHEDULE_EXCEPTION_KINDS)[number];
/** A day off / vacation / holiday / custom hours for one doctor (doctor_id) or the whole clinic (null), one row per day of [from, to]. */
export const scheduleExceptionSchema = z.object({
  doctor_id: uuid.nullable().optional(),
  branch_id: uuid.nullable().optional(),
  from: isoDate,
  to: isoDate.optional(),
  kind: z.enum(SCHEDULE_EXCEPTION_KINDS),
  start_time: hhmm.nullable().optional(),
  end_time: hhmm.nullable().optional(),
  note: optionalText(200),
}).superRefine((d, ctx) => {
  const to = d.to ?? d.from;
  if (to < d.from) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Tugash sanasi boshlanishdan oldin' });
  if ((Date.parse(to) - Date.parse(d.from)) / 86400_000 > 92) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Davr 93 kundan oshmasin' });
  if (d.kind === 'custom_hours') {
    if (!d.doctor_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['doctor_id'], message: 'Maxsus ish vaqti faqat bitta shifokor uchun' });
    if (!d.start_time || !d.end_time) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end_time'], message: 'Ish vaqtining boshi va oxirini kiriting' });
    else if (mins(d.end_time) - mins(d.start_time) < 30) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end_time'], message: 'Ish vaqti kamida 30 daqiqa bo‘lsin' });
  } else if (d.start_time || d.end_time) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['start_time'], message: 'Vaqt faqat maxsus ish vaqti uchun' });
  if (d.doctor_id && d.branch_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['branch_id'], message: 'Shifokor uchun filial tanlanmaydi' });
});

// ---------- Visit documents (referral, certificate, prescription) ----------
const icdCode = z.string().regex(/^[A-Z][0-9]{2}(\.[0-9]{1,2})?$/, 'Noto‘g‘ri MKB-10 kodi');

export const referralBodySchema = z.object({
  to_specialty: trimmed(2, 120, 'Kimga (mutaxassislik yoki tekshiruv)'),
  to_institution: optionalText(200),
  reason: trimmed(3, 1000, 'Yo‘llanma sababi'),
  urgency: z.enum(['routine', 'urgent']).default('routine'),
  icd10: z.array(icdCode).max(5).default([]),
  notes: optionalText(1000),
});

export const certificateBodySchema = z.object({
  purpose: trimmed(2, 200, 'Qayerga taqdim etiladi'),
  /** Off by default: a certificate leaves the clinic, the diagnosis is shown only if the patient asks for it. */
  include_diagnosis: z.boolean().default(false),
  rest_days: z.number().int().min(0, '0–30 kun').max(30, '0–30 kun').default(0),
  notes: optionalText(1000),
});

export const prescriptionItemSchema = z.object({
  name: trimmed(2, 120, 'Dori nomi'),
  form: optionalText(60),
  dose: trimmed(1, 60, 'Doza'),
  frequency: trimmed(1, 80, 'Qabul tartibi'),
  duration: trimmed(1, 60, 'Davomiyligi'),
  instructions: optionalText(200),
});
export const prescriptionBodySchema = z.object({
  items: z.array(prescriptionItemSchema).min(1, 'Kamida bitta dori kiriting').max(15, 'Ko‘pi bilan 15 ta dori'),
  notes: optionalText(1000),
});

export const documentCreateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('referral'), body: referralBodySchema }),
  z.object({ kind: z.literal('certificate'), body: certificateBodySchema }),
  z.object({ kind: z.literal('prescription'), body: prescriptionBodySchema }),
]);
export const documentVoidSchema = z.object({ reason: trimmed(3, 300, 'Bekor qilish sababi') });

export const DOCUMENT_KIND_LABEL: Record<'referral' | 'certificate' | 'prescription', string> = {
  referral: 'Yo‘llanma', certificate: 'Tibbiy ma’lumotnoma', prescription: 'Dori tavsiyasi',
};

// ---------- Cash desk: shifts, refunds, expenses ----------
const tiyin = (label: string) => z.number({ invalid_type_error: `${label} kiritilishi shart` }).int(`${label} tiyinda butun son bo‘lsin`);

export const shiftOpenSchema = z.object({ branch_id: uuid, opening_cash: tiyin('Boshlang‘ich naqd pul').min(0, 'Manfiy bo‘lmasin').max(100_000_000_000) });
export const shiftCloseSchema = z.object({ counted_cash: tiyin('Sanalgan naqd pul').min(0, 'Manfiy bo‘lmasin').max(100_000_000_000), note: optionalText(500) });

export const refundCreateSchema = z.object({
  payment_id: uuid,
  amount: tiyin('Summa').positive('Summa 0 dan katta bo‘lsin'),
  method: z.enum(['cash', 'card', 'transfer'], { errorMap: () => ({ message: 'Qaytarish usulini tanlang' }) }),
  reason_code: z.enum(['service_not_provided', 'appointment_cancelled', 'patient_complaint', 'other'], { errorMap: () => ({ message: 'Sababni tanlang' }) }),
  reason: trimmed(3, 500, 'Izoh'),
  shift_id: uuid.optional(),
  /** one line of the invoice: only that service's net value drops; without it the refund is spread proportionally */
  order_id: uuid.optional(),
});

/** Patient deposit (prepayment) taken by a cashier in an open shift. */
export const depositCreateSchema = z.object({
  amount: tiyin('Summa').positive('Summa 0 dan katta bo‘lsin').max(100_000_000_000),
  method: z.enum(['cash', 'card', 'transfer'], { errorMap: () => ({ message: 'To‘lov usulini tanlang' }) }),
  note: optionalText(300),
});
/** Unused deposit returned by the manager; cash leaves an open drawer. */
export const depositRefundSchema = z.object({
  amount: tiyin('Summa').positive('Summa 0 dan katta bo‘lsin'),
  method: z.enum(['cash', 'card', 'transfer'], { errorMap: () => ({ message: 'Qaytarish usulini tanlang' }) }),
  note: trimmed(3, 300, 'Izoh'),
  shift_id: uuid.optional(),
});
/** Debtor's promise: when the patient said they will pay, and a short note. */
export const promiseSchema = z.object({
  promise_date: isoDate.nullable(),
  note: optionalText(300),
});

export const expenseCreateSchema = z.object({
  branch_id: uuid.optional(),
  category: z.enum(EXPENSE_CATEGORIES, { errorMap: () => ({ message: 'Kategoriyani tanlang' }) }),
  amount: tiyin('Summa').positive('Summa 0 dan katta bo‘lsin').max(100_000_000_000),
  occurred_on: isoDate.optional(),
  paid_from: z.enum(['cash_drawer', 'bank', 'card', 'other']).default('bank'),
  note: optionalText(300),
  shift_id: uuid.optional(),
});
export const expenseVoidSchema = z.object({ reason: trimmed(3, 300, 'Sabab') });

// ---------- Hikvision cameras ----------
export const CAMERA_PURPOSES = ['attendance', 'patient_arrival', 'counting', 'security'] as const;
/** Security event kinds a camera reports (the ones that can raise an alert and carry a snapshot). */
export const CAMERA_SECURITY_KINDS = ['intrusion', 'line_crossing', 'region_entrance', 'region_exit', 'loitering', 'tamper'] as const;
export type CameraSecurityKind = (typeof CAMERA_SECURITY_KINDS)[number];
export type CameraPurpose = (typeof CAMERA_PURPOSES)[number];
export const cameraSchema = z.object({
  branch_id: z.string().uuid({ message: 'Filialni tanlang' }),
  name: z.string().trim().min(1, 'Kamera nomini kiriting').max(80, 'Nom juda uzun'),
  location: optionalText(120),
  model: optionalText(60),
  purposes: z.array(z.enum(CAMERA_PURPOSES)).min(1, 'Kamera vazifasini tanlang'),
  security_mode: z.enum(['always', 'after_hours']).default('after_hours'),
  /** keep the camera's picture of a security alert (30 days, manager only); never for face events */
  alert_snapshots: z.boolean().default(false),
});
export type CameraInput = z.infer<typeof cameraSchema>;
export const cameraUpdateSchema = cameraSchema.partial().extend({ status: z.enum(['active', 'disabled']).optional() });
/** Direct ISAPI connection of a camera (the camera's own admin login; the password is stored encrypted). */
export const cameraIsapiSchema = z.object({
  host: z.string().trim().min(1, 'Kamera IP manzilini kiriting').max(15).regex(/^\d{1,3}(\.\d{1,3}){3}$/, 'IPv4 manzil kiriting (masalan 192.168.1.64)'),
  port: z.number().int().min(1).max(65535).default(80),
  https: z.boolean().default(false),
  username: z.string().trim().min(1, 'Kamera loginini kiriting').max(64),
  password: z.string().min(1, 'Kamera parolini kiriting').max(128),
  delivery: z.enum(['push', 'pull']).default('push'),
});
export type CameraIsapiInput = z.infer<typeof cameraIsapiSchema>;
/** A face picture for the camera's library (base64 JPEG, 20–300 KB): forwarded to the camera, never stored. */
export const facePhotoSchema = z.object({
  photo_base64: z.string().min(100, 'Rasm yuklang').max(420_000, 'Rasm 300 KB dan katta'),
  camera_ids: z.array(z.string().uuid()).min(1, 'Kamerani tanlang').max(20),
});
/** A staff face code: the manager confirms the employee gave written consent to face recognition. */
export const staffFaceCodeSchema = z.object({
  membership_id: z.string().uuid(),
  consent_confirmed: z.literal(true, { errorMap: () => ({ message: 'Xodimning yozma roziligini tasdiqlang' }) }),
});

