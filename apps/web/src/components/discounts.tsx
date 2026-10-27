'use client';
// Discounts and corporate payers in the interface (docs/DISCOUNTS_COMPANIES.md): the pickers, the forms of the
// directories, the «Chegirma va to‘lovchi» block of a bill and a company's payment. The server checks every limit
// and role again; nothing here is the permission check.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Building2, CheckCircle2, Lock } from 'lucide-react';
import { SERVICE_CATEGORIES, type MessageKey } from '@meduza/contracts';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { fmtDate, formatSom, fullName, parseSomToTiyin, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, Card, Checkbox, cx, Field, Input, KeyVal, LoadingRows, Modal, ModalCancel, Select, Textarea, useToast } from '@/components/ui';
import { MoneyInput } from '@/components/money-input';

type T = ReturnType<typeof useT>;
export type Rule = { id: string; name: string; kind: 'percent' | 'fixed'; percent: number | null; amount: number | null; staff_max_percent: number | null; staff_max_amount: number | null;
  scope: 'all' | 'categories' | 'services'; categories: string[]; service_ids: string[]; valid_from: string | null; valid_to: string | null; active: boolean };
export type Category = { id: string; name: string; discount_rule_id: string | null; discount_rule_name: string | null; requires_document: boolean; document_label: string | null; active: boolean };
export type Company = { id: string; name: string; kind: 'employer' | 'insurance' | 'other'; inn?: string | null; active?: boolean; coverage_percent?: number; coverage_categories?: string[];
  discount_rule_id?: string | null; payment_terms_days?: number; credit_limit?: number; outstanding?: number; contract_number?: string | null; contract_date?: string | null;
  contact_name?: string | null; contact_phone?: string | null; note?: string | null };

/** Who may pick a discount on a bill, and who may put a bill on a company (the server enforces the same). */
export const canDiscount = (role: string) => role === 'manager' || role === 'cashier' || role === 'registrar';
export const canSplit = (role: string) => role === 'manager' || role === 'cashier';
const pctText = (v: number | null | undefined) => `${String(Number(v ?? 0)).replace('.', ',')}%`;
/** «10%» or «−50 000 so‘m» (per line). */
export const ruleValue = (r: Pick<Rule, 'kind' | 'percent' | 'amount'>) => (r.kind === 'percent' ? pctText(r.percent) : `−${formatSom(r.amount ?? 0)}`);
export const ruleStaffMax = (r: Pick<Rule, 'kind' | 'staff_max_percent' | 'staff_max_amount'>) => (r.kind === 'percent' ? pctText(r.staff_max_percent) : formatSom(r.staff_max_amount ?? 0));
export const categoryLabel = (t: T, c: string) => t(`service.${c}` as MessageKey);

export function useRules(all = false) {
  return useQuery({ queryKey: ['discount-rules', all], queryFn: () => api<{ data: Rule[] }>(`/discount-rules${all ? '?all=1' : ''}`).then((r) => r.data), staleTime: 60_000 });
}
export function useCategories(all = false, enabled = true) {
  return useQuery({ queryKey: ['benefit-categories', all], queryFn: () => api<{ data: Category[] }>(`/benefit-categories${all ? '?all=1' : ''}`).then((r) => r.data), staleTime: 60_000, enabled });
}
export function useCompanies(all = false, enabled = true) {
  return useQuery({ queryKey: ['companies', 'list', all], queryFn: () => api<{ data: Company[] }>(`/companies?page_size=100${all ? '&all=1' : ''}`).then((r) => r.data), staleTime: 60_000, enabled });
}

/** The categories a rule or a company covers, in words. */
function scopeText(t: T, scope: string, categories: string[], services = 0) {
  if (scope === 'categories' && categories.length) return categories.map((c) => categoryLabel(t, c)).join(', ');
  if (scope === 'services') return t('disc.scope.services') + (services ? ` (${services})` : '');
  return t('disc.scope.all');
}
export { scopeText };

// ---------------------------------------------------------------- the block on a bill

/**
 * «Chegirma va to‘lovchi» on the cashier's bill: a discount rule (default: the patient's benefit category, else the
 * company's) within the staff limit — above it only the manager, with a reason — and the company split. Both are drafts
 * until the first money; then the block shows what was applied, read-only.
 */
export function InvoicePayerCard({ inv }: { inv: any }) {
  const t = useT();
  const { me } = useSession();
  const moved = inv.status === 'void' || Number(inv.paid_amount) > 0 || Number(inv.credit_amount) > 0 || (inv.payments?.length ?? 0) > 0;
  const hasDiscount = Number(inv.discount_amount) > 0;
  const hasCompany = !!inv.company_id;
  if (moved || !canDiscount(me.role)) {
    if (!hasDiscount && !hasCompany) return null;
    return (
      <Card title={<span className="flex items-center gap-2"><BadgePercent className="h-4 w-4 text-brand-600" />{t('disc.blockTitle')}</span>}>
        <div className="space-y-2 text-body">
          {hasDiscount && <AppliedDiscount inv={inv} />}
          {hasCompany && <AppliedCompany inv={inv} />}
          {moved && inv.status !== 'void' && <p className="flex items-start gap-2 text-small text-slate-600"><Lock className="mt-0.5 h-4 w-4 shrink-0" />{t('disc.lockedHint')}</p>}
        </div>
      </Card>
    );
  }
  return (
    <Card title={<span className="flex items-center gap-2"><BadgePercent className="h-4 w-4 text-brand-600" />{t('disc.blockTitle')}</span>}>
      <div className="space-y-5">
        <DiscountPicker inv={inv} />
        {canSplit(me.role) && <div className="border-t border-slate-100 pt-4"><CompanySplit inv={inv} /></div>}
      </div>
    </Card>
  );
}

function AppliedDiscount({ inv }: { inv: any }) {
  const t = useT();
  const name = inv.discount_rule_name ?? t('disc.manual');
  return (
    <div>
      <div className="font-semibold text-slate-900">{t('disc.current', { rule: name, amount: `−${formatSom(inv.discount_amount)}` })}</div>
      {inv.discount_benefit_category_name && <div className="text-small text-slate-600">{t('disc.fromCategory', { name: inv.discount_benefit_category_name })}</div>}
      {inv.discount_granted_by_name && <div className="text-small text-slate-600">{t('disc.grantedBy', { name: inv.discount_granted_by_name })}</div>}
      {inv.discount_over_limit && inv.discount_approved_by_name && <div className="text-small text-slate-600">{t('disc.approvedBy', { name: inv.discount_approved_by_name })}{inv.discount_reason ? ` — ${inv.discount_reason}` : ''}</div>}
    </div>
  );
}

function AppliedCompany({ inv }: { inv: any }) {
  const t = useT();
  return (
    <div>
      <div className="font-semibold text-slate-900">{inv.company_name} — {formatSom(inv.company_share_amount)}</div>
      <div className="text-small text-slate-600">{pctText(inv.company_percent)}{inv.company_member_no ? ` · ${inv.company_member_no}` : ''}</div>
      {Number(inv.company_due) > 0 && <div className="text-small font-medium text-amber-800">{t('comp.outstanding', { amount: formatSom(inv.company_due) })}</div>}
    </div>
  );
}

function DiscountPicker({ inv }: { inv: any }) {
  const t = useT();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const rules = useRules();
  // the default: what the bill has, else the patient's benefit category's rule, else the company's
  const suggested = inv.discount_rule_id ?? inv.patient_benefit_rule_id ?? inv.patient_company_rule_id ?? '';
  const [ruleId, setRuleId] = useState<string>(suggested);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rule = rules.data?.find((r) => r.id === ruleId);
  useEffect(() => {
    if (!rule) { setValue(''); return; }
    const own = inv.discount_rule_id === rule.id ? Number(inv.discount_rule_value) : rule.kind === 'percent' ? Number(rule.percent) : Number(rule.amount);
    setValue(rule.kind === 'percent' ? String(own).replace('.', ',') : String(own / 100));
  }, [rule?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const num = rule ? (rule.kind === 'percent' ? Number(value.replace(',', '.')) : parseSomToTiyin(value) ?? NaN) : 0;
  const max = rule ? (rule.kind === 'percent' ? Number(rule.staff_max_percent) : Number(rule.staff_max_amount)) : 0;
  const over = !!rule && num > max;
  const manager = me.role === 'manager';
  const valueOk = !rule || (num > 0 && (rule.kind === 'fixed' || num <= 100));
  const source = rule && rule.id === inv.patient_benefit_rule_id ? 'benefit' : rule && rule.id === inv.patient_company_rule_id ? 'company' : 'rule';
  const m = useMutation({
    mutationFn: () => api(`/invoices/${inv.id}/apply-discount`, { method: 'POST', body: rule
      ? { rule_id: rule.id, source, reason: reason.trim() || null, ...(rule.kind === 'percent' ? { percent: num } : { amount: num }) }
      : { rule_id: null } }),
    onSuccess: (r: any) => {
      ['invoices', 'patient', 'dashboard', 'finance-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setError(null);
      toast.success(rule ? t('disc.applied', { amount: formatSom(r.data.discount_amount) }) : t('disc.removed'));
    },
    onError: (e) => { setError((e as Error).message); if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: ['invoices'] }); },
  });
  const changed = (ruleId || null) !== (inv.discount_rule_id ?? null) || (rule && Number(inv.discount_rule_value) !== num);
  const blocked = !valueOk || (over && !manager) || (over && manager && reason.trim().length < 3);
  return (
    <div className="space-y-3" data-testid="discount-picker">
      {error && <Alert tone="red">{error}</Alert>}
      {hasLegacy(inv) && <AppliedDiscount inv={inv} />}
      {(inv.patient_benefit_category_name || inv.patient_company_name) && (
        <div className="flex flex-wrap gap-2">
          {inv.patient_benefit_category_name && <Badge tone="blue">{t('disc.fromCategory', { name: inv.patient_benefit_category_name })}{inv.patient_benefit_note ? ` · ${inv.patient_benefit_note}` : ''}</Badge>}
          {inv.patient_company_name && <Badge tone="blue">{t('disc.fromCompany', { name: inv.patient_company_name })}</Badge>}
        </div>
      )}
      <Field label={t('disc.pick')}>{(id) => (
        <Select id={id} value={ruleId} onChange={(e) => { setRuleId(e.target.value); setError(null); }} data-testid="discount-rule">
          <option value="">{t('disc.none')}</option>
          {rules.data?.map((r) => <option key={r.id} value={r.id}>{r.name} ({ruleValue(r)})</option>)}
        </Select>
      )}</Field>
      {rule && <>
        <Field label={rule.kind === 'percent' ? t('disc.percent') : t('disc.amount')} hint={over ? undefined : t('disc.yourLimit', { max: ruleStaffMax(rule) })}
          error={!valueOk && value.trim() ? (rule.kind === 'percent' ? t('cash.percentRange') : t('cash.amountPositive')) : undefined}>{(id) => rule.kind === 'percent'
          ? <Input id={id} inputMode="decimal" className="text-right tabular-nums" value={value} onChange={(e) => setValue(e.target.value)} invalid={!valueOk} data-testid="discount-value" />
          : <MoneyInput id={id} value={value} onChange={(e) => setValue(e.target.value)} invalid={!valueOk} />}</Field>
        <p className="text-small text-slate-600">{scopeText(t, rule.scope, rule.categories, rule.service_ids.length)} · {t('disc.lineDiscountHint')}</p>
        {over && !manager && <Alert tone="yellow">{t('disc.needsManager')}</Alert>}
        {over && manager && <>
          <Alert tone="blue">{t('disc.managerApproves')}</Alert>
          <Field label={t('disc.reason')} required>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </>}
      </>}
      <div className="flex flex-wrap gap-2">
        <Button icon={<CheckCircle2 className="h-4 w-4" />} disabled={!changed || blocked} loading={m.isPending} onClick={() => m.mutate()} data-testid="discount-apply">{rule ? t('disc.apply') : t('disc.remove')}</Button>
      </div>
    </div>
  );
}
const hasLegacy = (inv: any) => Number(inv.discount_amount) > 0 && !inv.discount_rule_id;

function CompanySplit({ inv }: { inv: any }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const companies = useCompanies();
  const [companyId, setCompanyId] = useState<string>(inv.company_id ?? inv.patient_company_id ?? '');
  const company = companies.data?.find((c) => c.id === companyId);
  const [percent, setPercent] = useState('');
  const [member, setMember] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!company) return;
    setPercent(String(inv.company_id === company.id ? inv.company_percent : company.coverage_percent ?? 100).replace('.', ','));
    setMember(inv.company_id === company.id ? inv.company_member_no ?? '' : inv.patient_company_id === company.id ? inv.patient_company_member_no ?? '' : '');
  }, [company?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const num = Number(percent.replace(',', '.'));
  const m = useMutation({
    mutationFn: () => api(`/invoices/${inv.id}/company`, { method: 'POST', body: company ? { company_id: company.id, percent: num, member_no: member.trim() || null } : { company_id: null } }),
    onSuccess: (r: any) => {
      ['invoices', 'dashboard', 'companies', 'finance-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setError(null);
      if (r.data.over_limit) toast.info(t('comp.overLimitWarn'));
      else toast.success(company ? t('comp.splitSaved', { amount: formatSom(r.data.company_share_amount) }) : t('comp.splitRemoved'));
    },
    onError: (e) => setError((e as Error).message),
  });
  const valid = !company || (num > 0 && num <= 100);
  const changed = (companyId || null) !== (inv.company_id ?? null) || (company && (Number(inv.company_percent) !== num || (inv.company_member_no ?? '') !== member.trim()));
  return (
    <div className="space-y-3" data-testid="company-split">
      <div className="flex items-center gap-2 text-body font-semibold text-slate-900"><Building2 className="h-4 w-4 text-brand-600" />{t('comp.split')}</div>
      {error && <Alert tone="red">{error}</Alert>}
      <Field label={t('comp.pick')}>{(id) => (
        <Select id={id} value={companyId} onChange={(e) => { setCompanyId(e.target.value); setError(null); }} data-testid="company-select">
          <option value="">{t('comp.noneSplit')}</option>
          {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}</Field>
      {company && <>
        <p className="text-small text-slate-600">{t('comp.coverage', { percent: String(company.coverage_percent ?? 100), categories: company.coverage_categories?.length ? company.coverage_categories.map((c) => categoryLabel(t, c)).join(', ') : t('comp.allServices') })}
          {Number(company.outstanding) > 0 && <> · {t('comp.dueOf', { amount: formatSom(company.outstanding) })}</>}</p>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <Field label={t('comp.percent')} error={!valid ? t('cash.percentRange') : undefined}>{(id) => <Input id={id} inputMode="decimal" className="text-right tabular-nums" value={percent} onChange={(e) => setPercent(e.target.value)} invalid={!valid} />}</Field>
          <Field label={t('comp.memberNo')}>{(id) => <Input id={id} value={member} onChange={(e) => setMember(e.target.value)} maxLength={60} />}</Field>
        </div>
      </>}
      <Button icon={<Building2 className="h-4 w-4" />} disabled={!changed || !valid} loading={m.isPending} onClick={() => m.mutate()} data-testid="company-apply">{company ? t('comp.setSplit') : t('comp.removeSplit')}</Button>
    </div>
  );
}

// ---------------------------------------------------------------- patient card fields

export type PayerValue = { benefit_category_id: string; benefit_note: string; company_id: string; company_member_no: string };
/** Benefit category (+ the document number it asks for) and company (+ policy / employee number) on the patient form. */
export function PayerFields({ value, onChange, errors }: { value: PayerValue; onChange: (v: PayerValue) => void; errors: Record<string, string> }) {
  const t = useT();
  const cats = useCategories();
  const companies = useCompanies();
  const cat = cats.data?.find((c) => c.id === value.benefit_category_id);
  // a card may carry a category or company that has since been switched off: keep it selectable as it is
  const set = (k: keyof PayerValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <fieldset className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 px-3 pb-3 pt-1 sm:col-span-3 sm:grid-cols-2">
      <legend className="inline-flex items-center gap-1.5 px-1 text-sm font-semibold text-slate-800"><BadgePercent className="h-4 w-4" />{t('comp.payerSection')}</legend>
      <Field label={t('disc.category')} error={errors.benefit_category_id}>{(id) => (
        <Select id={id} value={value.benefit_category_id} onChange={set('benefit_category_id')} invalid={!!errors.benefit_category_id}>
          <option value="">{t('comp.noBenefit')}</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.discount_rule_name ? ` — ${c.discount_rule_name}` : ''}</option>)}
        </Select>
      )}</Field>
      <Field label={cat?.document_label || t('comp.benefitNote')} required={!!cat?.requires_document} error={errors.benefit_note}>{(id) => (
        <Input id={id} value={value.benefit_note} onChange={set('benefit_note')} disabled={!value.benefit_category_id} invalid={!!errors.benefit_note} maxLength={120} autoComplete="off" />
      )}</Field>
      <Field label={t('comp.cardCompany')} error={errors.company_id}>{(id) => (
        <Select id={id} value={value.company_id} onChange={set('company_id')} invalid={!!errors.company_id}>
          <option value="">{t('comp.noCompany')}</option>
          {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}</Field>
      <Field label={t('comp.memberNo')} error={errors.company_member_no}>{(id) => (
        <Input id={id} value={value.company_member_no} onChange={set('company_member_no')} disabled={!value.company_id} maxLength={60} autoComplete="off" />
      )}</Field>
    </fieldset>
  );
}

// ---------------------------------------------------------------- directory forms (manager)

const toPct = (s: string) => Number(s.replace(',', '.'));
const fromPct = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));

export function RuleFormModal({ rule, onClose }: { rule?: Rule; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const services = useQuery({ queryKey: ['services', 'all'], queryFn: () => api('/services').then((r) => r.data as any[]) });
  const [v, setV] = useState({
    name: rule?.name ?? '', kind: rule?.kind ?? 'percent', value: rule ? (rule.kind === 'percent' ? fromPct(rule.percent) : String((rule.amount ?? 0) / 100)) : '',
    max: rule ? (rule.kind === 'percent' ? fromPct(rule.staff_max_percent) : String((rule.staff_max_amount ?? 0) / 100)) : '',
    scope: rule?.scope ?? 'all', categories: rule?.categories ?? [] as string[], service_ids: rule?.service_ids ?? [] as string[],
    valid_from: rule?.valid_from ?? '', valid_to: rule?.valid_to ?? '', active: rule?.active ?? true,
  });
  const initial = useRef(JSON.stringify(v));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pct = v.kind === 'percent';
  const body = () => ({ name: v.name, kind: v.kind, scope: v.scope, categories: v.categories, service_ids: v.service_ids, valid_from: v.valid_from || null, valid_to: v.valid_to || null, active: v.active,
    ...(pct ? { percent: toPct(v.value), staff_max_percent: v.max ? toPct(v.max) : 0 } : { amount: parseSomToTiyin(v.value) ?? 0, staff_max_amount: v.max ? parseSomToTiyin(v.max) ?? 0 : 0 }) });
  const m = useMutation({
    mutationFn: () => api(rule ? `/discount-rules/${rule.id}` : '/discount-rules', { method: rule ? 'PATCH' : 'POST', body: body() }),
    onSuccess: () => { ['discount-rules', 'benefit-categories', 'reports'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('disc.ruleSaved')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); toast.error(e); },
  });
  const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  return (
    <Modal open onClose={onClose} width="max-w-2xl" dirty={JSON.stringify(v) !== initial.current} title={rule ? t('disc.editRule') : t('disc.newRule')}
      footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={!v.name.trim() || !v.value.trim()} onClick={() => m.mutate()}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('disc.ruleName')} required error={errors.name} className="sm:col-span-2">{(id) => <Input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={80} data-autofocus />}</Field>
        <Field label={t('disc.kind')}>{(id) => <Select id={id} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as Rule['kind'], value: '', max: '' })}>
          <option value="percent">{t('disc.kind.percent')}</option><option value="fixed">{t('disc.kind.fixed')}</option></Select>}</Field>
        <Field label={pct ? t('disc.percent') : t('disc.amount')} required error={errors.percent ?? errors.amount}>{(id) => pct
          ? <Input id={id} inputMode="decimal" className="text-right tabular-nums" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} />
          : <MoneyInput id={id} value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} />}</Field>
        <Field label={t('disc.staffMax')} hint={t('disc.staffMaxHint')} error={errors.staff_max_percent ?? errors.staff_max_amount} className="sm:col-span-2">{(id) => pct
          ? <Input id={id} inputMode="decimal" className="text-right tabular-nums" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} placeholder="0" />
          : <MoneyInput id={id} value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} />}</Field>
        <Field label={t('disc.scope')} error={errors.categories ?? errors.service_ids} className="sm:col-span-2">{(id) => <Select id={id} value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value as Rule['scope'] })}>
          <option value="all">{t('disc.scope.all')}</option><option value="categories">{t('disc.scope.categories')}</option><option value="services">{t('disc.scope.services')}</option></Select>}</Field>
        {v.scope === 'categories' && <div className="flex flex-wrap gap-x-5 gap-y-1 sm:col-span-2">
          {SERVICE_CATEGORIES.map((c) => <Checkbox key={c} checked={v.categories.includes(c)} onChange={() => setV({ ...v, categories: toggle(v.categories, c) })} label={categoryLabel(t, c)} />)}
        </div>}
        {v.scope === 'services' && <div className="max-h-56 overflow-y-auto rounded-field border border-slate-200 px-3 py-1 sm:col-span-2">
          {!services.data ? <LoadingRows rows={3} /> : services.data.map((s: any) => <Checkbox key={s.id} checked={v.service_ids.includes(s.id)} onChange={() => setV({ ...v, service_ids: toggle(v.service_ids, s.id) })} label={`${s.code} · ${s.name}`} />)}
        </div>}
        <Field label={t('disc.validFrom')} error={errors.valid_from}>{(id) => <Input id={id} type="date" value={v.valid_from} onChange={(e) => setV({ ...v, valid_from: e.target.value })} />}</Field>
        <Field label={t('disc.validTo')} error={errors.valid_to}>{(id) => <Input id={id} type="date" value={v.valid_to} onChange={(e) => setV({ ...v, valid_to: e.target.value })} />}</Field>
        <div className="sm:col-span-2"><Checkbox checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} label={t('disc.active')} /></div>
        {rule && <p className="text-small text-slate-600 sm:col-span-2">{t('disc.pastKept')}</p>}
      </div>
    </Modal>
  );
}

export function CategoryFormModal({ category, onClose }: { category?: Category; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const rules = useRules(true);
  const [v, setV] = useState({ name: category?.name ?? '', discount_rule_id: category?.discount_rule_id ?? '', requires_document: category?.requires_document ?? false,
    document_label: category?.document_label ?? '', active: category?.active ?? true });
  const initial = useRef(JSON.stringify(v));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api(category ? `/benefit-categories/${category.id}` : '/benefit-categories', { method: category ? 'PATCH' : 'POST',
      body: { ...v, discount_rule_id: v.discount_rule_id || null, document_label: v.requires_document ? v.document_label || null : null } }),
    onSuccess: () => { ['benefit-categories', 'reports'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('disc.categorySaved')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); toast.error(e); },
  });
  return (
    <Modal open onClose={onClose} dirty={JSON.stringify(v) !== initial.current} title={category ? t('disc.editCategory') : t('disc.newCategory')}
      footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={v.name.trim().length < 2} onClick={() => m.mutate()}>{t('common.save')}</Button></>}>
      <div className="space-y-3">
        <Field label={t('disc.categoryName')} required error={errors.name}>{(id) => <Input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={80} data-autofocus />}</Field>
        <Field label={t('disc.defaultRule')} error={errors.discount_rule_id}>{(id) => <Select id={id} value={v.discount_rule_id} onChange={(e) => setV({ ...v, discount_rule_id: e.target.value })}>
          <option value="">{t('disc.noRule')}</option>{rules.data?.map((r) => <option key={r.id} value={r.id}>{r.name} ({ruleValue(r)})</option>)}</Select>}</Field>
        <Checkbox checked={v.requires_document} onChange={(e) => setV({ ...v, requires_document: e.target.checked })} label={t('disc.requiresDoc')} />
        {v.requires_document && <Field label={t('disc.docLabel')} hint={t('disc.docLabelHint')} error={errors.document_label}>{(id) => <Input id={id} value={v.document_label} onChange={(e) => setV({ ...v, document_label: e.target.value })} maxLength={60} />}</Field>}
        <Checkbox checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} label={t('disc.active')} />
      </div>
    </Modal>
  );
}

export function CompanyFormModal({ company, onClose }: { company?: Company; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const rules = useRules(true);
  const [v, setV] = useState({ name: company?.name ?? '', kind: company?.kind ?? 'employer', inn: company?.inn ?? '', contract_number: company?.contract_number ?? '', contract_date: company?.contract_date ?? '',
    contact_name: company?.contact_name ?? '', contact_phone: company?.contact_phone ?? '', note: company?.note ?? '', discount_rule_id: company?.discount_rule_id ?? '',
    coverage_percent: fromPct(company?.coverage_percent ?? 100), coverage_categories: company?.coverage_categories ?? [] as string[], payment_terms_days: String(company?.payment_terms_days ?? 30),
    credit_limit: String((company?.credit_limit ?? 0) / 100), active: company?.active ?? true });
  const initial = useRef(JSON.stringify(v));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => api(company ? `/companies/${company.id}` : '/companies', { method: company ? 'PATCH' : 'POST', body: {
      ...v, inn: v.inn || null, contract_date: v.contract_date || null, discount_rule_id: v.discount_rule_id || null, coverage_percent: toPct(v.coverage_percent),
      payment_terms_days: Number(v.payment_terms_days), credit_limit: parseSomToTiyin(v.credit_limit || '0') ?? 0 } }),
    onSuccess: () => { ['companies', 'reports'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('comp.saved')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); toast.error(e); },
  });
  const toggle = (x: string) => setV({ ...v, coverage_categories: v.coverage_categories.includes(x) ? v.coverage_categories.filter((y) => y !== x) : [...v.coverage_categories, x] });
  return (
    <Modal open onClose={onClose} width="max-w-2xl" dirty={JSON.stringify(v) !== initial.current} title={company ? t('comp.editCompany') : t('comp.newCompany')}
      footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={v.name.trim().length < 2} onClick={() => m.mutate()}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('comp.name')} required error={errors.name} className="sm:col-span-2">{(id) => <Input id={id} value={v.name} onChange={set('name')} maxLength={120} data-autofocus />}</Field>
        <Field label={t('comp.kind')}>{(id) => <Select id={id} value={v.kind} onChange={set('kind')}>{(['employer', 'insurance', 'other'] as const).map((k) => <option key={k} value={k}>{t(`comp.kind.${k}`)}</option>)}</Select>}</Field>
        <Field label={t('comp.inn')} error={errors.inn}>{(id) => <Input id={id} value={v.inn} onChange={set('inn')} inputMode="numeric" maxLength={9} placeholder="123456789" />}</Field>
        <Field label={t('comp.contract')} error={errors.contract_number}>{(id) => <Input id={id} value={v.contract_number} onChange={set('contract_number')} maxLength={60} />}</Field>
        <Field label={t('comp.contractDate')} error={errors.contract_date}>{(id) => <Input id={id} type="date" value={v.contract_date} onChange={set('contract_date')} />}</Field>
        <Field label={t('comp.contact')} error={errors.contact_name}>{(id) => <Input id={id} value={v.contact_name} onChange={set('contact_name')} maxLength={120} />}</Field>
        <Field label={t('comp.phone')} error={errors.contact_phone}>{(id) => <Input id={id} value={v.contact_phone} onChange={set('contact_phone')} inputMode="tel" />}</Field>
        <Field label={t('comp.coveragePercent')} error={errors.coverage_percent}>{(id) => <Input id={id} value={v.coverage_percent} onChange={set('coverage_percent')} inputMode="decimal" className="text-right tabular-nums" />}</Field>
        <Field label={t('comp.terms')} error={errors.payment_terms_days}>{(id) => <Input id={id} value={v.payment_terms_days} onChange={set('payment_terms_days')} inputMode="numeric" className="text-right tabular-nums" />}</Field>
        <div className="sm:col-span-2">
          <div className="mb-1 text-sm font-semibold text-slate-800">{t('comp.coverageCategories')}</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">{SERVICE_CATEGORIES.map((c) => <Checkbox key={c} checked={v.coverage_categories.includes(c)} onChange={() => toggle(c)} label={categoryLabel(t, c)} />)}</div>
          <p className="mt-1 text-small text-slate-600">{t('comp.coverageAllHint')}</p>
        </div>
        <Field label={t('comp.creditLimit')} hint={t('comp.creditLimitHint')} error={errors.credit_limit}>{(id) => <MoneyInput id={id} value={v.credit_limit} onChange={set('credit_limit')} />}</Field>
        <Field label={t('comp.defaultRule')} error={errors.discount_rule_id}>{(id) => <Select id={id} value={v.discount_rule_id} onChange={set('discount_rule_id')}>
          <option value="">{t('disc.noRule')}</option>{rules.data?.map((r) => <option key={r.id} value={r.id}>{r.name} ({ruleValue(r)})</option>)}</Select>}</Field>
        <Field label={t('comp.note')} error={errors.note} className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={v.note} onChange={set('note')} maxLength={500} />}</Field>
        <div className="sm:col-span-2"><Checkbox checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} label={t('disc.active')} /></div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- a company's bank transfer

/**
 * Records a company's bank transfer and spreads it over its open bills (oldest first by default; each amount can be
 * edited). One Idempotency-Key per intended payment: a retry after a lost answer cannot record it twice.
 */
export function CompanyPaymentModal({ companyId: initialCompany, onClose }: { companyId?: string; onClose: () => void }) {
  const t = useT();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const companies = useCompanies();
  const [companyId, setCompanyId] = useState(initialCompany ?? '');
  const [amount, setAmount] = useState('');
  const [doc, setDoc] = useState('');
  const [docDate, setDocDate] = useState(me.today);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const open = useQuery({ queryKey: ['companies', 'open', companyId], enabled: !!companyId,
    queryFn: () => api(`/companies/${companyId}/open-invoices?page_size=100`).then((r) => r as { data: any[]; meta: { due: number } }) });
  useEffect(() => { setAlloc({}); }, [companyId]);
  const total = parseSomToTiyin(amount) ?? 0;
  const allocated = useMemo(() => Object.values(alloc).reduce((a, v) => a + (parseSomToTiyin(v) ?? 0), 0), [alloc]);
  /** spread the amount over the bills, oldest first */
  function fillOldest(sum = total) {
    let left = sum; const next: Record<string, string> = {};
    for (const i of open.data?.data ?? []) { if (left <= 0) break; const part = Math.min(left, Number(i.due)); next[i.id] = String(part / 100); left -= part; }
    setAlloc(next);
  }
  const m = useMutation({
    mutationFn: () => api('/company-payments', { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: {
      company_id: companyId, amount: total, document_number: doc.trim() || null, document_date: docDate || null,
      allocations: Object.entries(alloc).map(([invoice_id, v]) => ({ invoice_id, amount: parseSomToTiyin(v) ?? 0 })).filter((a) => a.amount > 0) } }),
    onSuccess: (r: any) => {
      ['companies', 'company-payments', 'invoices', 'reports', 'dashboard', 'finance-summary', 'payments'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(r.data.replayed ? t('comp.paymentReplayed', { n: r.data.payment.number }) : t('comp.paymentSaved', { n: r.data.payment.number }));
      onClose();
    },
    onError: (e) => { setError((e as Error).message); if (!(e instanceof ApiError && e.status === 0)) key.current = newIdempotencyKey(); },
  });
  const valid = !!companyId && total > 0 && allocated === total;
  return (
    <Modal open onClose={onClose} width="max-w-2xl" dirty={!!amount || !!doc} title={t('comp.recordPayment')}
      footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={!valid} onClick={() => m.mutate()} data-testid="company-payment-save">{t('common.save')}</Button></>}>
      <div className="space-y-3">
        {error && <Alert tone="red">{error}</Alert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('comp.pick')} required className="sm:col-span-2">{(id) => <Select id={id} value={companyId} onChange={(e) => setCompanyId(e.target.value)} data-autofocus data-testid="company-payment-company">
            <option value="">—</option>{companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}{Number(c.outstanding) > 0 ? ` — ${formatSom(c.outstanding)}` : ''}</option>)}</Select>}</Field>
          <Field label={t('cash.amountSomComma')} required>{(id) => <MoneyInput id={id} value={amount} onChange={(e) => { setAmount(e.target.value); }} onBlur={() => { if (!allocated) fillOldest(); }} data-testid="company-payment-amount" />}</Field>
          <Field label={t('comp.document')}>{(id) => <Input id={id} value={doc} onChange={(e) => setDoc(e.target.value)} maxLength={60} />}</Field>
          <Field label={t('comp.documentDate')}>{(id) => <Input id={id} type="date" max={me.today} value={docDate} onChange={(e) => setDocDate(e.target.value)} />}</Field>
        </div>
        {companyId && (open.isLoading ? <LoadingRows rows={3} /> : !open.data?.data.length ? <p className="text-body text-slate-600">{t('comp.noOpenInvoices')}</p> : (
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">{t('comp.allocations')}</span>
              <Button size="sm" variant="ghost" disabled={!total} onClick={() => fillOldest()}>{t('comp.fillOldest')}</Button>
            </div>
            <ul className="divide-y divide-slate-100 rounded-field border border-slate-200">
              {open.data.data.map((i: any) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="font-medium text-slate-900">№{i.invoice_number} · {fmtDate(i.created_at)}</div>
                    <div className="text-small text-slate-600">{fullName(i)} {pid(i.patient_number)}{i.company_member_no ? ` · ${i.company_member_no}` : ''} · {t('comp.dueOf', { amount: formatSom(i.due) })}</div>
                  </div>
                  <MoneyInput aria-label={`№${i.invoice_number}`} className="w-40" value={alloc[i.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })} />
                </li>
              ))}
            </ul>
            <p className={cx('mt-2 text-body tabular-nums', allocated === total && total > 0 ? 'text-emerald-800' : 'text-amber-800')}>{t('comp.allocated', { sum: formatSom(allocated), total: formatSom(total) })}</p>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** The totals of a bill with a discount and/or a company split (on top of the cashier's due). */
export function PayerTotals({ inv }: { inv: any }) {
  const t = useT();
  const discount = Number(inv.discount_amount) > 0, company = Number(inv.company_share_amount) > 0;
  if (!discount && !company) return null;
  return (
    <>
      {discount && <KeyVal k={t('disc.gross')} v={<span className="tabular-nums">{formatSom(inv.subtotal)}</span>} />}
      {discount && <KeyVal k={t('disc.totalDiscount')} v={<span className="tabular-nums text-emerald-800">−{formatSom(inv.discount_amount)}</span>} />}
      {company && <KeyVal k={t('disc.companyPays')} v={<span className="tabular-nums">{formatSom(inv.company_share_amount)}</span>} />}
      {company && <KeyVal k={t('disc.patientPays')} v={<span className="tabular-nums">{formatSom(Number(inv.total) - Number(inv.company_share_amount))}</span>} />}
    </>
  );
}
