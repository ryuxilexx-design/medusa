'use client';
// Referral partners and lead sources (docs/REFERRALS.md): the pickers reception uses on a booking, the visit's
// «Yo‘llanma / manba» dialog, and the manager's partner form, payout dialog and per-partner lines.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserPlus } from 'lucide-react';
import { PARTNER_KINDS, type MessageKey } from '@meduza/contracts';
import { api, ApiError, newIdempotencyKey, qs } from '@/lib/api';
import { fmtDate, formatPhone, formatSom, fullName, parseSomToTiyin, pid } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Button, Checkbox, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, ModalCancel, Pagination, Segmented, Select, Skeleton, Table, Td, Th, useToast } from './ui';
import { MoneyInput } from './money-input';

export type PartnerRef = { id: string; code: number; full_name: string; phone?: string | null; workplace?: string | null; kind?: string };
export type LeadSource = { id: string; name: string; system_key: 'telegram_bot' | 'referral' | null; active: boolean; sort: number };

/** Reception and the manager pick partners and sources; the server checks the role on every call. */
export const canRefer = (role: string) => role === 'manager' || role === 'registrar';

/** Active lead sources (the bot's own source is never chosen by hand). */
export function useLeadSources(enabled = true) {
  return useQuery({ queryKey: ['lead-sources'], queryFn: () => api<{ data: LeadSource[] }>('/lead-sources').then((r) => r.data), enabled, staleTime: 60_000 });
}

export function LeadSourceSelect({ value, onChange, error, label, className }: { value: string; onChange: (id: string) => void; error?: string; label?: string; className?: string }) {
  const t = useT();
  const q = useLeadSources();
  return (
    <Field label={label ?? t('ref.source')} error={error} className={className}>{(id) => (
      <Select id={id} value={value} invalid={!!error} onChange={(e) => onChange(e.target.value)} disabled={q.isLoading}>
        <option value="">{t('ref.sourceNone')}</option>
        {(q.data ?? []).filter((s) => s.system_key !== 'telegram_bot' || s.id === value).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
    )}</Field>
  );
}

/** Search a partner by name, phone or ID (code), or add a new one right here (without a percent: the manager sets it). */
export function PartnerPicker({ value, onChange, error }: { value: PartnerRef | null; onChange: (p: PartnerRef | null) => void; error?: string }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ full_name: '', phone: '', workplace: '' });
  const [addErr, setAddErr] = useState<Record<string, string>>({});
  const dq = useDebounced(search, 300);
  const found = useQuery({ queryKey: ['referral-partners', 'pick', dq], queryFn: () => api(`/referral-partners${qs({ search: dq, page_size: 6 })}`).then((r) => r.data as PartnerRef[]), enabled: !value && !adding && dq.trim().length >= 2 });
  const pick = (p: PartnerRef | null) => { onChange(p); setSearch(''); setAdding(false); };
  const add = useMutation({
    mutationFn: () => api<{ data: PartnerRef }>('/referral-partners', { method: 'POST', body: { full_name: draft.full_name, phone: draft.phone || null, workplace: draft.workplace || null, kind: 'doctor' } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['referral-partners'] }); toast.success(t('ref.added', { code: r.data.code })); pick(r.data); setDraft({ full_name: '', phone: '', workplace: '' }); },
    onError: (e) => {
      // the same phone is already a partner: take that card instead of a duplicate
      if (e instanceof ApiError && e.code === 'PARTNER_EXISTS' && e.details?.partner) { toast.info(e.message); pick(e.details.partner); return; }
      if (e instanceof ApiError && e.fields) setAddErr(e.fields); else toast.error(e);
    },
  });
  if (value) return (
    <Field label={t('ref.partner')} required error={error}>{() => (
      <div className="flex min-h-control items-center justify-between gap-2 rounded-field border-2 border-slate-200 bg-slate-50 py-0.5 pl-3 pr-0.5 text-body" data-testid="partner-chosen">
        <span className="min-w-0 [overflow-wrap:anywhere]"><b>{value.full_name}</b> <span className="text-slate-600">{t('ref.codeShort', { code: value.code })}</span></span>
        <Button size="sm" variant="ghost" onClick={() => pick(null)}>{t('registrar.change')}</Button>
      </div>
    )}</Field>
  );
  if (adding) return (
    <fieldset className="space-y-3 rounded-field border border-slate-200 p-3">
      <legend className="px-1 text-sm font-semibold text-slate-800">{t('ref.quickAdd')}</legend>
      <Field label={t('ref.fullName')} required error={addErr.full_name}>{(id) => <Input id={id} value={draft.full_name} data-autofocus onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} invalid={!!addErr.full_name} autoComplete="off" />}</Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('registrar.phone')} error={addErr.phone}>{(id) => <Input id={id} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} invalid={!!addErr.phone} inputMode="tel" placeholder="+998 90 123 45 67" />}</Field>
        <Field label={t('ref.workplace')} error={addErr.workplace}>{(id) => <Input id={id} value={draft.workplace} onChange={(e) => setDraft({ ...draft, workplace: e.target.value })} />}</Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setAddErr({}); }}>{t('common.back')}</Button>
        <Button size="sm" icon={<UserPlus className="h-4 w-4" />} loading={add.isPending} disabled={draft.full_name.trim().length < 2} onClick={() => { setAddErr({}); add.mutate(); }}>{t('ref.addPartner')}</Button>
      </div>
    </fieldset>
  );
  return (
    <Field label={t('ref.partner')} required error={error}>{(id) => (
      <div>
        <Input id={id} value={search} invalid={!!error} onChange={(e) => setSearch(e.target.value)} placeholder={t('ref.searchPlaceholder')} autoComplete="off" data-testid="partner-search" />
        <div className="mt-1 overflow-hidden rounded-field border border-slate-200">
          {dq.trim().length < 2 ? <p className="px-3 py-2 text-small text-slate-600">{t('registrar.bk.min2')}</p>
            : found.isLoading ? <Skeleton className="m-2 h-6" />
            : found.data?.length ? found.data.map((p) => (
              <button key={p.id} type="button" data-no-press onClick={() => pick(p)} className="block min-h-control-sm w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 [overflow-wrap:anywhere] hover:bg-brand-50 focus-visible:bg-brand-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus">
                <b>{p.full_name}</b> <span className="text-slate-600">{t('ref.codeShort', { code: p.code })}{p.workplace ? `, ${p.workplace}` : ''}{p.phone ? `, ${formatPhone(p.phone)}` : ''}</span>
              </button>
            )) : <p className="px-3 py-2 text-small text-slate-600">{t('ref.notFound')}</p>}
          <button type="button" data-no-press onClick={() => { setAdding(true); setDraft((d) => ({ ...d, full_name: /\d/.test(search) ? '' : search.trim() })); }} className="flex min-h-control-sm w-full items-center gap-2 border-t border-slate-200 px-3 py-2 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus"><Plus className="h-4 w-4" />{t('ref.newPartner')}</button>
        </div>
      </div>
    )}</Field>
  );
}

/**
 * «Yo‘llanma bor» + partner + «Qayerdan bildi» for a booking or a walk-in. The source follows the choice until the
 * person picks one: a partner → the referral source, otherwise the patient's own source.
 */
export function ReferralFields({ referred, onReferred, partner, onPartner, sourceId, onSource, patientSourceId, errors }: {
  referred: boolean; onReferred: (v: boolean) => void;
  partner: PartnerRef | null; onPartner: (p: PartnerRef | null) => void; sourceId: string; onSource: (id: string) => void; patientSourceId?: string | null; errors: Record<string, string>;
}) {
  const t = useT();
  const sources = useLeadSources();
  const touched = useRef(false);
  const referral = sources.data?.find((s) => s.system_key === 'referral')?.id ?? '';
  useEffect(() => {
    if (touched.current) return;
    onSource(partner ? referral : patientSourceId ?? '');
  }, [partner, referral, patientSourceId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3" data-testid="referral-fields">
      <Checkbox checked={referred} onChange={(e) => { onReferred(e.target.checked); if (!e.target.checked) onPartner(null); }} label={t('ref.hasReferral')} data-testid="has-referral" />
      {referred && <PartnerPicker value={partner} onChange={onPartner} error={errors.referral_partner_id} />}
      <LeadSourceSelect value={sourceId} onChange={(id) => { touched.current = true; onSource(id); }} error={errors.lead_source_id} />
    </div>
  );
}

/** The patient card's visit: correct who referred the patient and the source (the partner only until money is taken). */
export function VisitReferralModal({ visit, onClose }: { visit: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [partner, setPartner] = useState<PartnerRef | null>(visit.referral_partner_id ? { id: visit.referral_partner_id, code: visit.referral_partner_code, full_name: visit.referral_partner_name } : null);
  const [sourceId, setSourceId] = useState<string>(visit.lead_source_id ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [referred, setReferred] = useState(!!visit.referral_partner_id);
  const m = useMutation({
    mutationFn: () => api(`/appointments/${visit.id}/referral`, { method: 'PATCH', body: { referral_partner_id: referred ? partner?.id ?? null : null, lead_source_id: sourceId || null } }),
    onSuccess: () => { ['patient', 'appointments', 'patients'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('ref.visitSaved')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); setErr((e as Error).message); },
  });
  const dirty = (referred ? partner?.id ?? null : null) !== (visit.referral_partner_id ?? null) || (sourceId || null) !== (visit.lead_source_id ?? null);
  return (
    <Modal open onClose={onClose} dirty={dirty && !m.isSuccess} title={t('ref.visitTitle', { date: fmtDate(visit.starts_at) })}
      footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={!dirty || (referred && !partner)} onClick={() => { setErr(null); setErrors({}); m.mutate(); }}>{t('common.save')}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="red">{err}</Alert>}
        <Checkbox checked={referred} onChange={(e) => setReferred(e.target.checked)} label={t('ref.hasReferral')} />
        {referred && <PartnerPicker value={partner} onChange={setPartner} error={errors.referral_partner_id} />}
        <LeadSourceSelect value={sourceId} onChange={setSourceId} error={errors.lead_source_id} />
        <p className="text-small text-slate-600">{t('ref.visitHint')}</p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- manager

type PartnerForm = { full_name: string; phone: string; kind: string; workplace: string; specialty: string; region: string; note: string; default_percent: string; active: boolean };
const EMPTY_FORM: PartnerForm = { full_name: '', phone: '', kind: 'doctor', workplace: '', specialty: '', region: '', note: '', default_percent: '', active: true };

/** Manager: add or edit a partner, its percent and its own percent on chosen services. */
export function PartnerFormModal({ partner, onClose }: { partner?: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const init: PartnerForm = partner ? { full_name: partner.full_name, phone: partner.phone ? formatPhone(partner.phone) : '', kind: partner.kind, workplace: partner.workplace ?? '', specialty: partner.specialty ?? '', region: partner.region ?? '',
    note: partner.note ?? '', default_percent: String(partner.default_percent ?? ''), active: partner.active } : EMPTY_FORM;
  const [v, setV] = useState<PartnerForm>(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ['referral-partner', partner?.id], queryFn: () => api(`/referral-partners/${partner.id}`).then((r) => r.data), enabled: !!partner });
  const services = useQuery({ queryKey: ['services', 'all'], queryFn: () => api('/services').then((r) => r.data as any[]) });
  const [overrides, setOverrides] = useState<{ service_id: string; percent: string }[] | null>(null);
  useEffect(() => { if (detail.data && overrides === null) setOverrides(detail.data.services.map((s: any) => ({ service_id: s.service_id, percent: String(s.percent) }))); }, [detail.data, overrides]);
  const set = (k: keyof PartnerForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: '' })); };
  const pct = v.default_percent.trim() === '' ? 0 : Number(v.default_percent.replace(',', '.'));
  const save = useMutation({
    mutationFn: async () => {
      const body = { full_name: v.full_name, phone: v.phone || null, kind: v.kind, workplace: v.workplace || null, specialty: v.specialty || null, region: v.region || null, note: v.note || null, default_percent: pct };
      if (!partner) return api('/referral-partners', { method: 'POST', body });
      await api(`/referral-partners/${partner.id}`, { method: 'PATCH', body: { ...body, active: v.active } });
      if (overrides) await api(`/referral-partners/${partner.id}/services`, { method: 'PUT', body: { items: overrides.filter((o) => o.service_id).map((o) => ({ service_id: o.service_id, percent: Number(o.percent.replace(',', '.')) })) } });
    },
    onSuccess: () => { ['referral-partners', 'referral-partner', 'reports'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(partner ? t('ref.saved') : t('ref.created')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); setErr((e as Error).message); },
  });
  const badPct = Number.isNaN(pct) || pct < 0 || pct > 100;
  const badOverride = (overrides ?? []).some((o) => o.service_id && (o.percent.trim() === '' || Number.isNaN(Number(o.percent.replace(',', '.'))) || Number(o.percent.replace(',', '.')) > 100 || Number(o.percent.replace(',', '.')) < 0));
  const ready = v.full_name.trim().length >= 2 && !badPct && !badOverride;
  return (
    <Modal open onClose={onClose} width="max-w-2xl" dirty={JSON.stringify(v) !== JSON.stringify(init) && !save.isSuccess} title={partner ? t('ref.editTitle', { code: partner.code }) : t('ref.addPartner')}
      footer={<><ModalCancel /><Button variant="primary" loading={save.isPending} disabled={!ready} onClick={() => { setErr(null); setErrors({}); save.mutate(); }}>{partner ? t('common.save') : t('ref.addPartner')}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {err && <div className="sm:col-span-2"><Alert tone="red">{err}</Alert></div>}
        <Field label={t('ref.fullName')} required className="sm:col-span-2" error={errors.full_name}>{(id) => <Input id={id} value={v.full_name} onChange={set('full_name')} invalid={!!errors.full_name} autoComplete="off" />}</Field>
        <Field label={t('ref.kind')} error={errors.kind}>{(id) => <Select id={id} value={v.kind} onChange={set('kind')}>{PARTNER_KINDS.map((k) => <option key={k} value={k}>{t(`ref.kind.${k}` as MessageKey)}</option>)}</Select>}</Field>
        <Field label={t('registrar.phone')} error={errors.phone}>{(id) => <Input id={id} value={v.phone} onChange={set('phone')} invalid={!!errors.phone} inputMode="tel" placeholder="+998 90 123 45 67" />}</Field>
        <Field label={t('ref.workplace')} error={errors.workplace}>{(id) => <Input id={id} value={v.workplace} onChange={set('workplace')} />}</Field>
        <Field label={t('ref.specialty')} error={errors.specialty}>{(id) => <Input id={id} value={v.specialty} onChange={set('specialty')} />}</Field>
        <Field label={t('ref.region')} error={errors.region}>{(id) => <Input id={id} value={v.region} onChange={set('region')} />}</Field>
        <Field label={t('ref.percent')} error={errors.default_percent ?? (badPct ? t('ref.percentRange') : undefined)} hint={t('ref.percentHint')}>{(id) => <Input id={id} value={v.default_percent} onChange={set('default_percent')} invalid={badPct || !!errors.default_percent} inputMode="decimal" placeholder="0" className="w-32" />}</Field>
        <Field label={t('registrar.note')} className="sm:col-span-2" error={errors.note}>{(id) => <Input id={id} value={v.note} onChange={set('note')} />}</Field>
        {partner && <div className="sm:col-span-2"><Checkbox checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} label={t('ref.activeLabel')} hint={t('ref.activeHint')} /></div>}
        {partner && (
          <fieldset className="space-y-2 rounded-field border border-slate-200 p-3 sm:col-span-2">
            <legend className="px-1 text-sm font-semibold text-slate-800">{t('ref.serviceOverrides')}</legend>
            {overrides === null ? <Skeleton className="h-8" /> : <>
              {overrides.map((o, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select aria-label={t('registrar.service')} className="min-w-0 flex-1 basis-56" value={o.service_id} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, service_id: e.target.value } : x)))}>
                    <option value="">{t('registrar.bk.choose')}</option>
                    {(services.data ?? []).map((s) => <option key={s.id} value={s.id} disabled={overrides.some((x, j) => j !== i && x.service_id === s.id)}>{s.code} · {s.name}</option>)}
                  </Select>
                  <Input aria-label={t('ref.percent')} className="!w-24" inputMode="decimal" value={o.percent} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} placeholder="%" />
                  <Button size="sm" variant="ghost" onClick={() => setOverrides(overrides.filter((_, j) => j !== i))}>{t('ref.remove')}</Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setOverrides([...overrides, { service_id: '', percent: '' }])}>{t('ref.addOverride')}</Button>
              <p className="text-small text-slate-600">{t('ref.overrideHint')}</p>
            </>}
          </fieldset>
        )}
      </div>
    </Modal>
  );
}

/** Manager: money to a partner — cash from an open drawer (the drawer must hold it) or a bank transfer. */
export function PayoutModal({ partner, onClose }: { partner: { partner_id: string; code: number; full_name: string; balance: number }; onClose: () => void }) {
  const t = useT();
  const { me, branchId } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState(partner.balance > 0 ? formatSom(partner.balance, false) : '');
  const [method, setMethod] = useState<'transfer' | 'cash'>('transfer');
  const [branch, setBranch] = useState(branchId || me.branches[0]?.id || '');
  const [shiftId, setShiftId] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const shifts = useQuery({ queryKey: ['cash-shifts', 'open', branch], queryFn: () => api(`/cash-shifts?status=open&branch_id=${branch}`).then((r) => r.data as any[]), enabled: method === 'cash' && !!branch });
  const chosenShift = shiftId || (shifts.data?.length === 1 ? shifts.data[0].id : '');
  const drawer = shifts.data?.find((s) => s.id === chosenShift);
  const tiyin = amount.trim() ? parseSomToTiyin(amount) : null;
  const m = useMutation({
    mutationFn: () => api('/referral-payouts', { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: { partner_id: partner.partner_id, amount: tiyin, method, shift_id: method === 'cash' ? chosenShift || undefined : undefined, branch_id: method === 'transfer' ? branch : undefined, note: note.trim() || null } }),
    onSuccess: () => { ['reports', 'referral-payouts', 'referral-partner', 'cash-shifts', 'cash-shift', 'finance-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('ref.paid', { amount: formatSom(tiyin) })); onClose(); },
    onError: (e) => { key.current = newIdempotencyKey(); if (e instanceof ApiError && e.fields) setErrors(e.fields); setErr((e as Error).message); },
  });
  const over = tiyin != null && tiyin > partner.balance;
  const ready = !!tiyin && tiyin > 0 && !over && (method !== 'cash' || !!chosenShift);
  return (
    <Modal open onClose={onClose} dirty={!!note} title={t('ref.payTitle', { name: partner.full_name })}
      footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={!ready} onClick={() => { setErr(null); setErrors({}); m.mutate(); }}>{t('ref.pay')}</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="red">{err}</Alert>}
        <p className="text-body text-slate-700">{t('ref.balanceLine', { amount: formatSom(partner.balance) })}</p>
        <Segmented label={t('ref.method')} value={method} onChange={setMethod} stretch options={[{ value: 'transfer', label: t('payment.transfer') }, { value: 'cash', label: t('ref.cashFromDrawer') }]} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('cash.amountSomComma')} required error={errors.amount ?? (over ? t('ref.overBalance') : amount && tiyin == null ? t('cash.enterNumber') : undefined)}>{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} invalid={over || !!errors.amount} />}</Field>
          {me.branches.length > 1 && <Field label={t('cash.branch')} required error={errors.branch_id}>{(id) => <Select id={id} value={branch} onChange={(e) => { setBranch(e.target.value); setShiftId(''); }}>{me.branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>}
          {method === 'cash' && (
            <Field className="sm:col-span-2" label={t('cash.fromDrawer')} required error={errors.shift_id} hint={drawer ? t('cash.drawerHint', { amount: formatSom(drawer.expected_cash) }) : undefined}>{(id) => shifts.data?.length === 0
              ? <p id={id} className="text-sm text-amber-800">{t('cash.noOpenDrawerDot')}</p>
              : <Select id={id} value={chosenShift} onChange={(e) => setShiftId(e.target.value)}>{(shifts.data?.length ?? 0) > 1 && <option value="">{t('cash.choose')}</option>}{(shifts.data ?? []).map((s) => <option key={s.id} value={s.id}>{t('cash.shiftOptionShort', { n: s.number, cashier: s.cashier_name })}</option>)}</Select>}</Field>
          )}
        </div>
        <Field label={t('cash.note')}>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ref.payNotePlaceholder')} />}</Field>
      </div>
    </Modal>
  );
}

/** Manager: one partner's lines of the period — who, when, what, its net value, the percent and the amount. */
export function PartnerLinesModal({ partner, from, to, branchId, onClose }: { partner: { partner_id: string; code: number; full_name: string }; from: string; to: string; branchId: string; onClose: () => void }) {
  const t = useT();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['reports', 'referral-lines', partner.partner_id, from, to, branchId, page], queryFn: () => api(`/reports/referrals/${partner.partner_id}/lines${qs({ from, to, branch_id: branchId, page, page_size: 20 })}`), placeholderData: (p) => p });
  return (
    <Modal open onClose={onClose} width="max-w-4xl" title={t('ref.linesTitle', { name: partner.full_name, code: partner.code })}>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? <EmptyState compact title={t('ref.noLines')} /> : <>
        <Table>
          <thead><tr><Th className="hidden sm:table-cell">{t('cash.colDate')}</Th><Th>{t('cash.colPatient')}</Th><Th className="hidden md:table-cell">{t('registrar.service')}</Th><Th right className="hidden sm:table-cell">{t('ref.colNet')}</Th><Th right>{t('ref.colDue')}</Th></tr></thead>
          <tbody>{q.data.data.map((l: any) => (
            <tr key={l.order_id}>
              <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{fmtDate(l.performed_at)}</Td>
              <Td><div className="font-medium text-slate-900">{fullName(l)}</div><div className="text-small text-slate-600">{pid(l.patient_number)}<span className="md:hidden"> · {l.service_name}{l.quantity > 1 ? ` × ${l.quantity}` : ''}</span></div></Td>
              <Td className="hidden md:table-cell">{l.service_name}{l.quantity > 1 ? ` × ${l.quantity}` : ''}<div className="text-small text-slate-600">{t('ref.invoiceNo', { n: l.invoice_number })}</div></Td>
              <Td right className="hidden sm:table-cell">{formatSom(l.net)}</Td>
              <Td right className="font-medium"><div>{formatSom(l.due)}</div><div className="text-small font-normal text-slate-600">{l.percent}%</div></Td>
            </tr>
          ))}</tbody>
          <tfoot><tr className="bg-slate-50 font-semibold text-slate-900"><td className="hidden sm:table-cell" /><td className="px-3 py-3 pl-5">{t('ref.nLines', { n: q.data.meta.count })}</td><td className="hidden md:table-cell" /><td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">{formatSom(q.data.meta.net)}</td><td className="px-3 py-3 pr-5 text-right tabular-nums">{formatSom(q.data.meta.due)}</td></tr></tfoot>
        </Table>
        <Pagination page={page} pageSize={20} total={q.data.meta.count} onPage={setPage} />
      </>}
    </Modal>
  );
}
