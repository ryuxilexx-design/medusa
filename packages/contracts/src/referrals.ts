// Referral partners, their payouts and lead sources (docs/REFERRALS.md). Shared by the API and the web.
import { z } from 'zod';
import { normalizePhone } from './money';
import { partnerPercent } from './schemas';

const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g;
const text = (min: number, max: number, label: string) =>
  z.string({ required_error: `${label} kiritilishi shart` })
    .transform((s) => s.replace(INVISIBLE, '').trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(min, `${label} kamida ${min} belgidan iborat bo‘lsin`).max(max, `${label} ${max} belgidan oshmasin`));
const optional = (max: number) =>
  z.string().max(max, `${max} belgidan oshmasin`).optional().nullable()
    .transform((s) => { const v = s == null ? '' : s.replace(INVISIBLE, '').trim(); return v === '' ? null : v; });
const phone = z.string().optional().nullable().transform((s, ctx) => {
  if (s == null || s.trim() === '') return null;
  const p = normalizePhone(s);
  if (!p) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefon +998 va 9 raqam ko‘rinishida bo‘lsin' }); return z.NEVER; }
  return p;
});
const uuid = z.string().uuid('Noto‘g‘ri identifikator');

export const PARTNER_KINDS = ['doctor', 'med_rep', 'clinic', 'other'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];
/** Uzbek labels for exports (the UI uses `ref.kind.*`). */
export const PARTNER_KIND_LABEL: Record<PartnerKind, string> = { doctor: 'Shifokor', med_rep: 'Med. vakil', clinic: 'Klinika', other: 'Boshqa' };

export const partnerCreateSchema = z.object({
  full_name: text(2, 120, 'F.I.Sh.'),
  phone,
  kind: z.enum(PARTNER_KINDS, { errorMap: () => ({ message: 'Hamkor turini tanlang' }) }).default('doctor'),
  workplace: optional(160),
  specialty: optional(80),
  region: optional(120),
  note: optional(500),
  /** manager only: the registrar's quick-add leaves it at 0 and the manager sets it */
  default_percent: partnerPercent.optional(),
});
export const partnerUpdateSchema = partnerCreateSchema.partial().extend({ active: z.boolean().optional() });
export type PartnerInput = z.infer<typeof partnerCreateSchema>;
/** This partner's percent on chosen services (replaces the whole list). */
export const partnerServicesSchema = z.object({
  items: z.array(z.object({ service_id: uuid, percent: partnerPercent })).max(500, 'Juda ko‘p xizmat'),
});

/** The visit's partner and lead source, set or corrected by reception (allowed until money is taken for the visit). */
export const visitReferralSchema = z.object({
  referral_partner_id: uuid.nullable().optional(),
  lead_source_id: uuid.nullable().optional(),
});

const tiyin = z.number({ invalid_type_error: 'Summa kiritilishi shart' }).int('Summa tiyinda butun son bo‘lsin');
export const payoutCreateSchema = z.object({
  partner_id: uuid,
  amount: tiyin.positive('Summa 0 dan katta bo‘lsin').max(100_000_000_000),
  method: z.enum(['cash', 'transfer'], { errorMap: () => ({ message: 'To‘lov usulini tanlang' }) }),
  /** cash: the open drawer it comes out of; transfer: the branch it is booked to */
  shift_id: uuid.optional(),
  branch_id: uuid.optional(),
  note: optional(300),
});
export const payoutVoidSchema = z.object({ reason: text(3, 300, 'Sabab') });

export const leadSourceCreateSchema = z.object({
  name: text(1, 80, 'Nomi'),
  sort: z.number().int().min(0).max(10000).optional(),
});
export const leadSourceUpdateSchema = leadSourceCreateSchema.partial().extend({ active: z.boolean().optional() });
