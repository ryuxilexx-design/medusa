'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cctv, CheckCircle2, CircleAlert, CircleX, FileSignature, Printer, ShieldAlert } from 'lucide-react';
import { BIOMETRIC_CONSENT_VERSION, CONSENT_TEXT_VERSION, type ConsentKind, type MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, Field, LinkButton, Modal, Select, Textarea, useToast } from './ui';

type Kind = ConsentKind;
type ConsentRow = { id: string; kind: Kind; granted: boolean; text_version: string; method: 'signed_paper' | 'telegram' | 'verbal'; recorded_by_name: string | null; recorded_at: string; note: string | null };
/** `biometric` is missing from an API that predates the camera module: treated as «not recorded». */
export type Consents = { data_processing: ConsentRow | null; notifications: ConsentRow | null; biometric?: ConsentRow | null };
const KINDS: Kind[] = ['data_processing', 'notifications', 'biometric'];
/** Optional consents: «not recorded» is a calm grey, a «no» is «refused» (data processing is the required one). */
const optional = (k: Kind) => k !== 'data_processing';
/** The text version a new record of this kind is made against (face recognition has its own short text). */
const versionOf = (k: Kind) => (k === 'biometric' ? BIOMETRIC_CONSENT_VERSION : CONSENT_TEXT_VERSION);

/** Roles that collect consent (the server checks the same). */
export const canRecordConsent = (role: string) => role === 'manager' || role === 'registrar' || role === 'doctor';

/** Status word + icon + colour: never colour alone. */
function ConsentBadge({ kind, row, everGranted }: { kind: Kind; row: ConsentRow | null; everGranted?: boolean }) {
  const t = useT();
  if (row?.granted) return <Badge tone="green" icon={<CheckCircle2 className="h-4 w-4" />}>{t('consent.status.granted')}</Badge>;
  if (row) return <Badge tone="red" icon={<CircleX className="h-4 w-4" />}>{t(everGranted ? 'consent.status.withdrawn' : optional(kind) ? 'consent.status.refused' : 'consent.status.missing')}</Badge>;
  if (optional(kind)) return <Badge tone="gray" icon={<CircleAlert className="h-4 w-4" />}>{t('consent.status.notAsked')}</Badge>;
  return <Badge tone="yellow" icon={<CircleAlert className="h-4 w-4" />}>{t('consent.status.missing')}</Badge>;
}

function meta(t: ReturnType<typeof useT>, r: ConsentRow) {
  return t('consent.meta', { version: r.text_version, method: t(`consent.method.${r.method}` as MessageKey), who: t('consent.recordedBy', { name: r.recorded_by_name ?? t('consent.bot'), at: fmtDateTime(r.recorded_at) }) });
}

/** Full-width amber band on the patient card while there is no valid consent to data processing: one calm line + actions. */
export function ConsentNotice({ patientId, consents, role, onRecord }: { patientId: string; consents?: Consents; role: string; onRecord: () => void }) {
  const t = useT();
  if (!consents || consents.data_processing?.granted) return null;
  const withdrawn = consents.data_processing?.granted === false;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-amber-200 bg-amber-50 px-5 py-2.5 text-amber-900" data-testid="consent-notice">
      <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 basis-[16rem] text-[0.9375rem]">
        <span className="font-semibold">{t(withdrawn ? 'consent.withdrawnTitle' : 'consent.missingTitle')}.</span>{' '}
        <span className="text-[0.875rem]">{t(withdrawn ? 'consent.withdrawnText' : 'consent.missingText')}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <LinkButton size="sm" href={`/print/consent/${patientId}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('consent.printShort')}</LinkButton>
        {canRecordConsent(role) && <Button size="sm" variant="primary" icon={<FileSignature className="h-4 w-4" />} onClick={onRecord}>{t('consent.record')}</Button>}
      </div>
    </div>
  );
}

/** Consent block of the patient card: status of both kinds (word + icon + colour), who recorded it, history, quiet actions. */
export function ConsentBlock({ patientId, patientNumber, consents, role, onRecord }: { patientId: string; patientNumber: number; consents: Consents; role: string; onRecord: (kind: Kind) => void }) {
  const t = useT();
  const h = useQuery({ queryKey: ['patient', patientId, 'consents'], queryFn: () => api<{ data: ConsentRow[] }>(`/patients/${patientId}/consents`).then((r) => r.data), enabled: canRecordConsent(role) });
  const everGranted = (k: Kind) => !!h.data?.some((r) => r.kind === k && r.granted);
  const quiet = 'text-slate-700 hover:bg-slate-100 hover:text-brand-800 !px-2';
  return (
    <section aria-labelledby="consent-h" data-testid="consent-block">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 id="consent-h" className="text-[0.9375rem] font-bold text-slate-900">{t('consent.block.title')}</h3>
        <div className="-mr-2 flex flex-wrap items-center gap-1">
          {canRecordConsent(role) && <Button size="sm" variant="ghost" className={quiet} icon={<FileSignature className="h-4 w-4" />} aria-label={t('consent.record')} onClick={() => onRecord(consents.data_processing?.granted ? 'notifications' : 'data_processing')}>{t('consent.recordShort')}</Button>}
          <LinkButton size="sm" variant="ghost" className={quiet} href={`/print/consent/${patientId}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('consent.printShort')}</LinkButton>
        </div>
      </div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {KINDS.map((k) => {
          const r = consents[k] ?? null;
          return (
            <div key={k} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{t(`consent.kind.${k}`)}</span>
                <ConsentBadge kind={k} row={r} everGranted={everGranted(k)} />
              </div>
              {r && <p className="mt-1 text-[0.8125rem] text-slate-600">{meta(t, r)}</p>}
              {r?.note && <p className="mt-0.5 text-[0.8125rem] text-slate-600">{t('consent.modal.note')}: {r.note}</p>}
              {k === 'biometric' && r?.granted && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem]" data-testid="camera-code">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-900"><Cctv className="h-4 w-4 text-slate-600" aria-hidden="true" />{t('consent.bio.code', { code: `P-${patientNumber}` })}</span>
                  <span className="text-slate-600">{t('consent.bio.hint')}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!!h.data?.length && (
        <details className="group mt-2 text-[0.8125rem]">
          <summary className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded px-1 font-semibold text-slate-700 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">{t('consent.history', { n: h.data.length })}</summary>
          <div className="mt-1 rounded-lg border border-slate-200 px-3 py-1.5">
            <ol className="divide-y divide-slate-100">
                {h.data.map((r) => (
                  <li key={r.id} className="py-1.5">
                    <div className="flex flex-wrap items-center gap-x-2"><b className="text-slate-900">{t(`consent.kind.${r.kind}`)}</b>
                      <span className={r.granted ? 'inline-flex items-center gap-1 text-emerald-800' : 'inline-flex items-center gap-1 text-red-800'}>{r.granted ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleX className="h-3.5 w-3.5" aria-hidden="true" />}{t(r.granted ? 'consent.modal.granted' : 'consent.modal.denied')}</span></div>
                    <div className="text-slate-600">{meta(t, r)}{r.note ? ` · ${r.note}` : ''}</div>
                  </li>
                ))}
            </ol>
            <p className="pb-1 pt-1.5 text-[0.8125rem] text-slate-600">{t('consent.appendOnly')}</p>
          </div>
        </details>
      )}
    </section>
  );
}

/** Records a consent, a refusal or a withdrawal (always a new row). Keeps the input on failure. */
export function ConsentModal({ open, onClose, patientId, kind: initialKind }: { open: boolean; onClose: () => void; patientId: string; kind: Kind }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [granted, setGranted] = useState<'yes' | 'no' | ''>('');
  const [method, setMethod] = useState<'signed_paper' | 'verbal'>('signed_paper');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => { if (open) { setKind(initialKind); setGranted(''); setMethod('signed_paper'); setNote(''); setErrors({}); setFormError(null); } }, [open, initialKind]);
  // face recognition is written consent only: a verbal «yes» is not accepted (a withdrawal may still be verbal)
  const paperOnly = kind === 'biometric' && granted !== 'no';
  useEffect(() => { if (paperOnly) setMethod('signed_paper'); }, [paperOnly]);
  const m = useMutation({
    mutationFn: () => api(`/patients/${patientId}/consents`, { method: 'POST', body: { kind, granted: granted === 'yes', method, note } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patient', patientId] }); toast.success(t('consent.modal.saved')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); setFormError(e instanceof Error ? e.message : t('registrar.notSaved')); },
  });
  const submit = () => {
    setFormError(null);
    if (!granted) { setErrors({ granted: t('api.v.consentAnswer') }); return; }
    m.mutate();
  };
  const dirty = granted !== '' || note.trim() !== '';
  return (
    <Modal open={open} onClose={onClose} dirty={dirty && !m.isSuccess} title={t('consent.modal.title')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={m.isPending} onClick={submit}>{t('common.save')}</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        {formError && <Alert tone="red">{formError}</Alert>}
        <Field label={t('consent.modal.kind')} error={errors.kind}>{(id) => (
          <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{KINDS.map((k) => <option key={k} value={k}>{t(`consent.kind.${k}`)}</option>)}</Select>
        )}</Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">{t('consent.modal.answer')} <span className="text-red-700" aria-hidden>*</span></legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {(['yes', 'no'] as const).map((v) => (
              <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2 text-[0.9375rem]">
                <input type="radio" name="consent-answer" className="h-5 w-5 accent-brand-600" checked={granted === v} onChange={() => { setGranted(v); setErrors((x) => ({ ...x, granted: '' })); }} aria-invalid={!!errors.granted || undefined} />
                {t(v === 'yes' ? 'consent.modal.granted' : 'consent.modal.denied')}
              </label>
            ))}
          </div>
          {errors.granted && <p className="mt-1 text-[0.8125rem] font-medium text-red-700" role="alert">{errors.granted}</p>}
        </fieldset>
        <Field label={t('consent.modal.method')} error={errors.method} hint={paperOnly ? t('consent.bio.paperOnly') : undefined}>{(id) => (
          <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as 'signed_paper' | 'verbal')}>
            <option value="signed_paper">{t('consent.method.signed_paper')}</option><option value="verbal" disabled={paperOnly}>{t('consent.method.verbal')}</option>
          </Select>
        )}</Field>
        {method === 'verbal' && granted === 'yes' && kind === 'data_processing' && <Alert tone="blue">{t('consent.modal.verbalHint')}</Alert>}
        <Field label={t('consent.modal.note')} error={errors.note} hint={t('consent.modal.noteHint')}>{(id) => <Textarea id={id} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <p className="text-[0.8125rem] text-slate-600">{t('consent.modal.version', { version: versionOf(kind) })}</p>
      </form>
    </Modal>
  );
}
