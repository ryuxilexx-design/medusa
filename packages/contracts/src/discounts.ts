// Discount rules, benefit categories, corporate payers and their payments (docs/DISCOUNTS_COMPANIES.md, migration 043).
// Shared by the API and the web. Money is integer tiyin; a percent has at most two decimals.
import { z } from 'zod';
import { normalizePhone } from './money';
import { isRealDate, SERVICE_CATEGORIES } from './schemas';

const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g;
const text = (min: number, max: number, label: string) =>
  z.string({ required_error: `${label} kiritilishi shart` })
    .transform((s) => s.replace(INVISIBLE, '').trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(min, `${label} kamida ${min} belgidan iborat bo‘lsin`).max(max, `${label} ${max} belgidan oshmasin`));
const optional = (max: number) =>
  z.string().max(max, `${max} belgidan oshmasin`).optional().nullable()
    .transform((s) => { const v = s == null ? '' : s.replace(INVISIBLE, '').trim().replace(/\s+/g, ' '); return v === '' ? null : v; });
const phone = z.string().optional().nullable().transform((s, ctx) => {
  if (s == null || s.trim() === '') return null;
  const p = normalizePhone(s);
  if (!p) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefon +998 va 9 raqam ko‘rinishida bo‘lsin' }); return z.NEVER; }
  return p;
});
const uuid = z.string().uuid('Noto‘g‘ri identifikator');
const date = z.string().refine(isRealDate, 'Sana noto‘g‘ri').optional().nullable().transform((s) => s || null);
const pct = z.number({ invalid_type_error: 'Foizni kiriting' }).min(0, 'Foiz 0–100 oralig‘ida bo‘lsin').max(100, 'Foiz 0–100 oralig‘ida bo‘lsin')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Foiz ko‘pi bilan 2 ta kasr xona');
const tiyin = z.number({ invalid_type_error: 'Summa kiritilishi shart' }).int('Summa tiyinda butun son bo‘lsin').min(0, 'Manfiy bo‘lmasin').max(100_000_000_000);
const category = z.enum(SERVICE_CATEGORIES, { errorMap: () => ({ message: 'Xizmat turini tanlang' }) });

export const DISCOUNT_KINDS = ['percent', 'fixed'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];
export const DISCOUNT_SCOPES = ['all', 'categories', 'services'] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];
export const COMPANY_KINDS = ['employer', 'insurance', 'other'] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];
/** Uzbek labels for exports (the UI uses `disc.*` / `comp.*` keys). */
export const COMPANY_KIND_LABEL: Record<CompanyKind, string> = { employer: 'Ish beruvchi', insurance: 'Sug‘urta', other: 'Boshqa' };
export const DISCOUNT_SOURCE_LABEL: Record<string, string> = { manual: 'Qo‘lda (rahbar)', rule: 'Qoida', benefit: 'Imtiyoz toifasi', company: 'Kompaniya' };

// ---------- discount rules ----------
const ruleBase = z.object({
  name: text(2, 80, 'Nomi'),
  kind: z.enum(DISCOUNT_KINDS, { errorMap: () => ({ message: 'Chegirma turini tanlang' }) }),
  /** percent rule: 0.01–100 */
  percent: pct.optional().nullable(),
  /** fixed rule: tiyin off each line in scope */
  amount: tiyin.optional().nullable(),
  /** the most a registrar or cashier may give (same unit as the rule); above it — manager only */
  staff_max_percent: pct.optional().nullable(),
  staff_max_amount: tiyin.optional().nullable(),
  scope: z.enum(DISCOUNT_SCOPES, { errorMap: () => ({ message: 'Qamrovni tanlang' }) }).default('all'),
  categories: z.array(category).max(4).default([]),
  service_ids: z.array(uuid).max(500, 'Juda ko‘p xizmat').default([]),
  valid_from: date,
  valid_to: date,
  active: z.boolean().optional(),
});
const ruleCheck = (d: z.infer<typeof ruleBase>, ctx: z.RefinementCtx) => {
  if (d.kind === 'percent' && !(d.percent && d.percent > 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['percent'], message: 'Foizni kiriting' });
  if (d.kind === 'fixed' && !(d.amount && d.amount > 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: 'Summa 0 dan katta bo‘lsin' });
  if (d.scope === 'categories' && !d.categories.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'Xizmat turini tanlang' });
  if (d.scope === 'services' && !d.service_ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['service_ids'], message: 'Xizmatlarni tanlang' });
  if (d.valid_from && d.valid_to && d.valid_to < d.valid_from) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valid_to'], message: 'Tugash sanasi boshlanishidan oldin bo‘lmasin' });
};
export const discountRuleSchema = ruleBase.superRefine(ruleCheck);
export type DiscountRuleInput = z.infer<typeof discountRuleSchema>;

// ---------- benefit categories ----------
export const benefitCategorySchema = z.object({
  name: text(2, 80, 'Nomi'),
  discount_rule_id: uuid.nullable().optional(),
  requires_document: z.boolean().default(false),
  document_label: optional(60),
  active: z.boolean().optional(),
});
export type BenefitCategoryInput = z.infer<typeof benefitCategorySchema>;

// ---------- companies ----------
export const companySchema = z.object({
  name: text(2, 120, 'Nomi'),
  kind: z.enum(COMPANY_KINDS, { errorMap: () => ({ message: 'Kompaniya turini tanlang' }) }).default('employer'),
  /** STIR (INN): 9 digits */
  inn: z.string().max(20).optional().nullable().transform((s, ctx) => {
    const v = (s ?? '').replace(/\s/g, '');
    if (v === '') return null;
    if (!/^\d{9}$/.test(v)) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'STIR (INN) 9 ta raqamdan iborat bo‘lsin' }); return z.NEVER; }
    return v;
  }),
  contract_number: optional(60),
  contract_date: date,
  contact_name: optional(120),
  contact_phone: phone,
  note: optional(500),
  discount_rule_id: uuid.nullable().optional(),
  coverage_percent: pct.refine((v) => v > 0, 'Foiz 0 dan katta bo‘lsin').default(100),
  coverage_categories: z.array(category).max(4).default([]),
  payment_terms_days: z.number({ invalid_type_error: 'Kunni kiriting' }).int('Butun son bo‘lsin').min(0, 'To‘lov muddati 0–365 kun').max(365, 'To‘lov muddati 0–365 kun').default(30),
  credit_limit: tiyin.default(0),
  active: z.boolean().optional(),
});
export type CompanyInput = z.infer<typeof companySchema>;

// ---------- on an invoice ----------
/** Applies a rule to an open bill (before any payment). `rule_id: null` removes the discount. */
export const applyDiscountSchema = z.object({
  rule_id: uuid.nullable(),
  /** a value other than the rule's own (same unit); above the rule's staff maximum — manager only, with a reason */
  percent: pct.refine((v) => v > 0, 'Foiz 0 dan katta bo‘lsin').optional(),
  amount: tiyin.refine((v) => v > 0, 'Summa 0 dan katta bo‘lsin').optional(),
  /** only these lines (order ids) of the bill; default every line the rule covers */
  order_ids: z.array(uuid).max(200).optional(),
  /** where the choice came from (for the report): the patient's benefit category, the company, or a rule picked by hand */
  source: z.enum(['rule', 'benefit', 'company']).default('rule'),
  reason: optional(300),
});
export type ApplyDiscountInput = z.infer<typeof applyDiscountSchema>;

/** Company split on an open bill: `company_id: null` removes it. */
export const companySplitSchema = z.object({
  company_id: uuid.nullable(),
  /** default: the company's coverage percent */
  percent: pct.refine((v) => v > 0, 'Foiz 0 dan katta bo‘lsin').optional(),
  member_no: optional(60),
});

/** A company's bank transfer, allocated to one or many of its bills; the allocations must add up to the amount. */
export const companyPaymentSchema = z.object({
  company_id: uuid,
  amount: tiyin.refine((v) => v > 0, 'Summa 0 dan katta bo‘lsin'),
  document_number: optional(60),
  document_date: date,
  note: optional(300),
  allocations: z.array(z.object({ invoice_id: uuid, amount: tiyin.refine((v) => v > 0, 'Summa 0 dan katta bo‘lsin') })).min(1, 'Hisoblarni tanlang').max(200),
});
export type CompanyPaymentInput = z.infer<typeof companyPaymentSchema>;
export const companyPaymentVoidSchema = z.object({ reason: text(3, 300, 'Sabab') });
