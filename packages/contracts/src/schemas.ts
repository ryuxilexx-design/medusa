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

export const aiNoteDraftSchema = z.object({ text: z.string().trim().min(10, 'Kamida 10 belgi kiriting').max(6000) });
export const aiReportSchema = z.object({ question: z.enum(['revenue_today', 'top_services', 'debts']), branch_id: uuid.optional().nullable() });
