import { z } from 'zod';
import { normalizePhone } from './money';

const trimmed = (min: number, max: number, label: string) =>
  z.string({ required_error: `${label} kiritilishi shart` })
    .transform((s) => s.trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(min, `${label} kamida ${min} belgidan iborat bo‘lsin`).max(max, `${label} ${max} belgidan oshmasin`));
const optionalText = (max: number) =>
  z.string().max(max, `${max} belgidan oshmasin`).optional().nullable()
    .transform((s) => (s == null || s.trim() === '' ? null : s.trim()));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana YYYY-MM-DD formatida bo‘lsin')
  .refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')), 'Noto‘g‘ri sana');
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
export const patientCreateSchema = patientBaseSchema.extend({ confirm_duplicate: z.boolean().optional() });
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
export const REQUIRED_FOR_SIGN = ['complaints', 'examination', 'diagnosis', 'recommendations'] as const;

export const ordersCreateSchema = z.object({ service_ids: z.array(uuid).min(1, 'Kamida bitta tekshiruv tanlang').max(10) });

export const labResultSchema = z.object({
  values: z.array(z.object({ code: z.string().max(20), value: z.string().max(40).transform((s) => s.trim()) })).max(30),
  comment: optionalText(1000),
});

export const discountSchema = z.object({
  type: z.enum(['percent', 'amount']),
  value: z.number().positive('Qiymat 0 dan katta bo‘lsin'),
  reason: trimmed(3, 300, 'Sabab'),
}).refine((d) => d.type !== 'percent' || d.value <= 100, { message: 'Foiz 0–100 oralig‘ida bo‘lsin', path: ['value'] });

export const paymentSchema = z.object({
  amount: z.number({ invalid_type_error: 'Summa kiritilishi shart' }).int('Summa tiyinda butun son bo‘lsin').positive('Summa 0 dan katta bo‘lsin'),
  method: z.enum(['cash', 'card', 'transfer'], { errorMap: () => ({ message: 'To‘lov usulini tanlang' }) }),
  note: optionalText(300),
});
export const voidSchema = z.object({ reason: trimmed(3, 300, 'Sabab') });

export const servicePatchSchema = z.object({
  name: trimmed(2, 120, 'Nomi').optional(),
  price: z.number().int().min(0, 'Narx manfiy bo‘lmasin').optional(), // tiyin
  duration_min: z.number().int().min(5).max(240).optional(),
  active: z.boolean().optional(),
});
export const clinicPatchSchema = z.object({ name: trimmed(2, 120, 'Klinika nomi') });

export const inventoryMovementSchema = z.object({
  type: z.enum(['in', 'out']),
  quantity: z.number().positive('Miqdor 0 dan katta bo‘lsin'),
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
  referral: 'Yo‘llanma', certificate: 'Tibbiy ma’lumotnoma', prescription: 'Retsept (dori tavsiyasi)',
};
