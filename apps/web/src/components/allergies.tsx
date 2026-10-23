'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Plus, ShieldAlert } from 'lucide-react';
import { ALLERGY_SEVERITIES, latinToCyrillic, type AllergySeverity, type MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Alert, Badge, Button, cx, ErrorState, Field, Input, LoadingRows, Modal, ModalCancel, Select, type Tone, useToast } from '@/components/ui';
import { DrugCombobox, drugName, type Drug } from '@/components/drug-picker';
import { useI18n, useT } from '@/lib/i18n';

type Row = {
  id: string; class_code: string | null; class_name_uz: string | null; class_name_ru: string | null; drug_id: string | null; drug_inn: string | null; drug_inn_ru: string | null;
  free_text: string | null; reaction: string | null; severity: AllergySeverity; source: 'manual' | 'intake'; recorded_by_name: string; recorded_by_role: string; recorded_at: string;
  confirmed_at: string | null; withdrawn_at: string | null; withdrawn_by_name: string | null; withdraw_reason: string | null;
};
type AllergyClass = { code: string; name_uz: string; name_ru: string };

/** A class name (reference data in uz + ru) in the person's language; Uzbek Cyrillic is derived from the Latin name. */
export function useClassName() {
  const { locale } = useI18n();
  return (uz: string | null, ru: string | null) => (locale === 'ru' ? ru ?? uz ?? '' : locale === 'uz-Cyrl' ? latinToCyrillic(uz ?? ru ?? '') : uz ?? ru ?? '');
}
export const SEVERITY_TONE: Record<AllergySeverity, Tone> = { severe: 'red', moderate: 'yellow', mild: 'gray', unknown: 'gray' };

/**
 * The patient's structured allergy list (doctor only): add by drug group, a drug or free text with reaction and severity;
 * a reception entry («bemor aytdi») waits for the doctor's confirmation; withdrawing keeps the row with its reason.
 */
export function AllergiesPanel({ patientId, legacyNote }: { patientId: string; legacyNote?: string | null }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const name = useClassName();
  const [adding, setAdding] = useState(false);
  const [withdrawing, setWithdrawing] = useState<Row | null>(null);
  const [showOld, setShowOld] = useState(false);
  const q = useQuery({ queryKey: ['allergies', patientId], queryFn: () => api<{ data: Row[] }>(`/patients/${patientId}/allergies`).then((r) => r.data) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['allergies', patientId] }); qc.invalidateQueries({ queryKey: ['patient'] }); qc.invalidateQueries({ queryKey: ['encounter'] }); };
  const confirm = useMutation({
    mutationFn: (id: string) => api(`/patients/${patientId}/allergies/${id}/confirm`, { method: 'POST' }),
    onSuccess: () => { toast.success(t('alg.confirmedToast')); refresh(); },
    onError: (e) => { toast.error(e); refresh(); },
  });
  const active = q.data?.filter((a) => !a.withdrawn_at) ?? [];
  const old = q.data?.filter((a) => a.withdrawn_at) ?? [];
  const what = (a: Row) => a.class_code ? name(a.class_name_uz, a.class_name_ru) : a.drug_id ? drugName({ inn: a.drug_inn ?? '', inn_ru: a.drug_inn_ru ?? '' }, locale) : a.free_text;

  return (
    <section aria-labelledby={`alg-${patientId}`} data-testid="allergies-panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`alg-${patientId}`} className="flex items-center gap-2 text-[0.9375rem] font-bold text-slate-900"><ShieldAlert className="h-5 w-5 text-red-700" />{t('alg.title')}</h3>
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>{t('alg.add')}</Button>
      </div>
      {q.isLoading ? <LoadingRows rows={2} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          {!active.length && <p className="text-sm text-slate-600">{t('alg.none')}</p>}
          {active.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {active.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm">
                  <div className="min-w-[11rem] flex-1">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <b className="text-slate-900 [overflow-wrap:anywhere]">{what(a)}</b>
                      <Badge tone={SEVERITY_TONE[a.severity]}>{t(`alg.sev.${a.severity}` as MessageKey)}</Badge>
                      {a.source === 'intake' && <Badge tone="blue">{t('alg.intake')}</Badge>}
                      {!a.confirmed_at && <Badge tone="yellow">{t('alg.unconfirmed')}</Badge>}
                    </p>
                    {a.reaction && <p className="mt-0.5 text-slate-800">{t('rx.warn.reaction', { r: a.reaction })}</p>}
                    <p className="mt-0.5 text-[0.8125rem] text-slate-600">{t('alg.recorded', { name: a.recorded_by_name, at: fmtDateTime(a.recorded_at) })}</p>
                  </div>
                  <span className="flex shrink-0 gap-1.5">
                    {!a.confirmed_at && <Button size="sm" icon={<Check className="h-4 w-4" />} loading={confirm.isPending && confirm.variables === a.id} onClick={() => confirm.mutate(a.id)}>{t('alg.confirm')}</Button>}
                    <Button size="sm" variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setWithdrawing(a)}>{t('alg.withdraw')}</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {legacyNote && <p className="mt-2 text-[0.8125rem] text-slate-700">{t('alg.cardNote', { note: legacyNote })}</p>}
          {old.length > 0 && (
            <div className="mt-2">
              <button type="button" className="min-h-10 rounded text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" aria-expanded={showOld} onClick={() => setShowOld((v) => !v)}>{t('alg.showWithdrawn', { n: old.length })}</button>
              {showOld && (
                <ul className="mt-1 space-y-1 text-sm text-slate-600">
                  {old.map((a) => <li key={a.id}><span className="line-through">{what(a)}</span> — {t('alg.withdrawn', { reason: a.withdraw_reason ?? '' })} ({a.withdrawn_by_name})</li>)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      {adding && <AllergyAddModal patientId={patientId} onClose={() => setAdding(false)} onSaved={refresh} />}
      {withdrawing && <WithdrawModal patientId={patientId} row={withdrawing} label={what(withdrawing) ?? ''} onClose={() => setWithdrawing(null)} onDone={refresh} />}
    </section>
  );
}

type Kind = 'class' | 'drug' | 'text';

export function AllergyAddModal({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const name = useClassName();
  const [kind, setKind] = useState<Kind>('class');
  const [classCode, setClassCode] = useState('');
  const [drugText, setDrugText] = useState('');
  const [drug, setDrug] = useState<Drug | null>(null);
  const [text, setText] = useState('');
  const [reaction, setReaction] = useState('');
  const [severity, setSeverity] = useState<AllergySeverity>('unknown');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const classes = useQuery({ queryKey: ['allergy-classes'], queryFn: () => api<{ data: AllergyClass[] }>('/allergy-classes').then((r) => r.data), staleTime: 3600_000 });
  const ready = kind === 'class' ? !!classCode : kind === 'drug' ? !!drug : text.trim().length >= 2;
  const dirty = !!(classCode || drugText || text || reaction || severity !== 'unknown');
  const save = useMutation({
    mutationFn: () => api(`/patients/${patientId}/allergies`, { method: 'POST', body: {
      class_code: kind === 'class' ? classCode : null, drug_id: kind === 'drug' ? drug?.id : null, free_text: kind === 'text' ? text : null,
      reaction: reaction || null, severity, source: 'manual' } }),
    onSuccess: () => { toast.success(t('alg.saved')); onSaved(); onClose(); },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) { setErrors(e.fields); setFormError(null); } else setFormError(e instanceof Error ? e.message : String(e));
    },
  });
  return (
    <Modal open onClose={onClose} dirty={dirty && !save.isPending} title={t('alg.add')}
      footer={<><ModalCancel /><Button variant="primary" loading={save.isPending} disabled={!ready} onClick={() => { setFormError(null); save.mutate(); }}>{t('common.save')}</Button></>}>
      <div className="space-y-3">
        {formError && <Alert tone="red">{formError}</Alert>}
        <fieldset className="flex flex-wrap gap-x-5 gap-y-1 text-[0.9375rem]"><legend className="mb-1 text-sm font-semibold text-slate-800">{t('alg.kind')}</legend>
          {(['class', 'drug', 'text'] as Kind[]).map((k) => (
            <label key={k} className="flex min-h-10 items-center gap-2"><input type="radio" name="alg-kind" className="h-4 w-4 accent-brand-600" checked={kind === k} onChange={() => setKind(k)} />{t(`alg.kind.${k}` as MessageKey)}</label>
          ))}
        </fieldset>
        {kind === 'class' && (
          <Field label={t('alg.class')} required error={errors.class_code}>{(id) => (
            <Select id={id} data-autofocus value={classCode} onChange={(e) => setClassCode(e.target.value)} invalid={!!errors.class_code}>
              <option value="">{t('alg.classPick')}</option>
              {classes.data?.map((c) => <option key={c.code} value={c.code}>{name(c.name_uz, c.name_ru)}</option>)}
            </Select>
          )}</Field>
        )}
        {kind === 'drug' && (
          <Field label={t('alg.drug')} required error={errors.drug_id}>{() => (
            <DrugCombobox value={drugText} drugId={drug?.id ?? null} ariaLabel={t('alg.drug')} placeholder={t('rx.search')}
              onText={(v) => { setDrugText(v); setDrug(null); }} onPick={(d) => { setDrug(d); setDrugText(drugName(d, locale)); }} />
          )}</Field>
        )}
        {kind === 'text' && <Field label={t('alg.text')} required error={errors.free_text}>{(id) => <Input id={id} data-autofocus maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('alg.textPh')} invalid={!!errors.free_text} />}</Field>}
        <Field label={t('alg.reaction')} error={errors.reaction}>{(id) => <Input id={id} maxLength={300} value={reaction} onChange={(e) => setReaction(e.target.value)} placeholder={t('alg.reactionPh')} />}</Field>
        <fieldset className="flex flex-wrap gap-x-5 gap-y-1 text-[0.9375rem]"><legend className="mb-1 text-sm font-semibold text-slate-800">{t('alg.severity')}</legend>
          {ALLERGY_SEVERITIES.map((s) => (
            <label key={s} className={cx('flex min-h-10 items-center gap-2', s === 'severe' && 'font-semibold text-red-800')}><input type="radio" name="alg-sev" className="h-4 w-4 accent-brand-600" checked={severity === s} onChange={() => setSeverity(s)} />{t(`alg.sev.${s}` as MessageKey)}</label>
          ))}
        </fieldset>
      </div>
    </Modal>
  );
}

function WithdrawModal({ patientId, row, label, onClose, onDone }: { patientId: string; row: Row; label: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/patients/${patientId}/allergies/${row.id}/withdraw`, { method: 'POST', body: { reason } }),
    onSuccess: () => { toast.success(t('alg.withdrawnToast')); onDone(); onClose(); },
    onError: (e) => { toast.error(e); onDone(); },
  });
  return (
    <Modal open onClose={onClose} dirty={!!reason.trim() && !m.isPending} title={t('alg.withdrawTitle')}
      footer={<><ModalCancel>{t('common.back')}</ModalCancel><Button variant="danger" loading={m.isPending} disabled={reason.trim().length < 3} onClick={() => m.mutate()}>{t('alg.withdraw')}</Button></>}>
      <p className="mb-1 font-semibold text-slate-900 [overflow-wrap:anywhere]">{label}</p>
      <p className="mb-2 text-sm text-slate-700">{t('alg.withdrawText')}</p>
      <Field label={t('docs.reason')} required>{(id) => <Input id={id} data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('alg.withdrawPh')} />}</Field>
    </Modal>
  );
}

/** Reception: writes down what the patient says about an allergy (text only); the doctor confirms it. Reception never reads the list. */
export function ReportAllergyButton({ patientId }: { patientId: string }) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [reaction, setReaction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = () => { setOpen(false); setText(''); setReaction(''); setError(null); };
  const m = useMutation({
    mutationFn: () => api(`/patients/${patientId}/allergies`, { method: 'POST', body: { free_text: text, reaction: reaction || null, source: 'intake' } }),
    onSuccess: () => { toast.success(t('alg.reportSaved')); close(); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  return (
    <>
      <Button size="sm" icon={<ShieldAlert className="h-4 w-4" />} onClick={() => setOpen(true)}>{t('alg.report')}</Button>
      <Modal open={open} onClose={close} dirty={!!(text || reaction) && !m.isPending} title={t('alg.report')}
        footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={text.trim().length < 2} onClick={() => { setError(null); m.mutate(); }}>{t('common.save')}</Button></>}>
        <div className="space-y-3">
          {error && <Alert tone="red">{error}</Alert>}
          <Field label={t('alg.text')} required hint={t('alg.reportHint')}>{(id) => <Input id={id} data-autofocus maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('alg.textPh')} />}</Field>
          <Field label={t('alg.reaction')}>{(id) => <Input id={id} maxLength={300} value={reaction} onChange={(e) => setReaction(e.target.value)} placeholder={t('alg.reactionPh')} />}</Field>
        </div>
      </Modal>
    </>
  );
}
