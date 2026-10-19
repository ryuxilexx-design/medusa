'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, Eye, FlaskConical, PlayCircle, Printer, Save, ShieldAlert, Sparkles, Stethoscope } from 'lucide-react';
import { REQUIRED_FOR_SIGN, type MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { ageFrom, fmtDate, fmtDateTime, fmtTime, formatSom, fullName, longDate, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useUnsavedGuard } from '@/lib/unsaved';
import { useT } from '@/lib/i18n';
import { IntakePanel } from '@/components/intake-panel';
import { IcdPicker, type Icd } from '@/components/icd-picker';
import { NewsCard } from '@/components/news-card';
import { DocumentsCard } from '@/components/documents-card';
import { Alert, Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Skeleton, Textarea, useToast } from '@/components/ui';
import { AppointmentStatus, LabStatus, NoteStatus } from '@/components/status';
import { LabValues } from '@/components/lab-values';

type TextKey = 'complaints' | 'anamnesis' | 'examination' | 'diagnosis' | 'recommendations' | 'follow_up_date' | 'bp_sys' | 'bp_dia' | 'pulse' | 'temp';
type NoteForm = Record<TextKey, string> & { icd10: Icd[] };
const FIELDS: { key: TextKey; label: MessageKey; rows: number; required?: boolean }[] = [
  { key: 'complaints', label: 'note.complaints', rows: 3, required: true },
  { key: 'anamnesis', label: 'note.anamnesis', rows: 3 },
  { key: 'examination', label: 'note.examination', rows: 3, required: true },
  { key: 'diagnosis', label: 'note.diagnosis', rows: 2, required: true },
  { key: 'recommendations', label: 'note.recommendations', rows: 3, required: true },
];
const toForm = (n: any): NoteForm => ({
  complaints: n?.complaints ?? '', anamnesis: n?.anamnesis ?? '', examination: n?.examination ?? '', diagnosis: n?.diagnosis ?? '', recommendations: n?.recommendations ?? '',
  follow_up_date: n?.follow_up_date ?? '', bp_sys: n?.vitals?.bp_sys?.toString() ?? '', bp_dia: n?.vitals?.bp_dia?.toString() ?? '', pulse: n?.vitals?.pulse?.toString() ?? '', temp: n?.vitals?.temp?.toString() ?? '',
  icd10: Array.isArray(n?.icd10) ? n.icd10.map((x: Icd) => ({ code: x.code, title: x.title })) : [],
});
const toBody = (f: NoteForm, version: number) => {
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  return { version, complaints: f.complaints, anamnesis: f.anamnesis, examination: f.examination, diagnosis: f.diagnosis, recommendations: f.recommendations,
    follow_up_date: f.follow_up_date || null, vitals: { bp_sys: num(f.bp_sys), bp_dia: num(f.bp_dia), pulse: num(f.pulse), temp: num(f.temp) },
    icd10: f.icd10.map((x) => x.code) };
};

export default function DoctorPage() { return <Suspense><Cabinet /></Suspense>; }

function Cabinet() {
  const { me } = useSession();
  const t = useT();
  const sp = useSearchParams();
  const router = useRouter();
  const selectedId = sp.get('appointment');
  const day = useQuery({ queryKey: ['appointments', 'doctor-day', me.today], queryFn: () => api(`/appointments?date=${me.today}`).then((r) => r.data as any[]), refetchInterval: 15_000 });
  const fromList = day.data?.find((a) => a.id === selectedId);
  const single = useQuery({ queryKey: ['appointments', 'one', selectedId], queryFn: () => api(`/appointments/${selectedId}`).then((r) => r.data), enabled: !!selectedId && !!day.data && !fromList });
  const appt = fromList ?? single.data;
  const list = (day.data ?? []).filter((a) => !['cancelled'].includes(a.status));
  const order = { in_progress: 0, arrived: 1, scheduled: 2, completed: 3, no_show: 4 } as Record<string, number>;
  const sorted = [...list].sort((a, b) => (order[a.status] - order[b.status]) || +new Date(a.starts_at) - +new Date(b.starts_at));

  useEffect(() => {
    if (!selectedId && sorted.length) router.replace(`/doctor?appointment=${(sorted.find((a) => a.status === 'in_progress') ?? sorted.find((a) => a.status === 'arrived') ?? sorted[0]).id}`);
  }, [selectedId, sorted, router]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[270px_minmax(0,1fr)] 2xl:grid-cols-[270px_minmax(0,1fr)_320px]">
      <Card padded={false} className="self-start lg:sticky lg:top-[88px]" title={t('doctor.today')}>
        {day.isLoading ? <LoadingRows rows={5} /> : day.isError ? <ErrorState error={day.error} onRetry={() => day.refetch()} /> : !sorted.length ? <EmptyState title={t('doctor.noVisits')} /> : (
          <ul className="max-h-[calc(100vh-150px)] divide-y divide-slate-100 overflow-y-auto">
            {sorted.map((a) => (
              <li key={a.id}>
                <Link href={`/doctor?appointment=${a.id}`} className={cx('block px-3 py-2.5 hover:bg-slate-50', a.id === selectedId && 'bg-brand-50 shadow-[inset_3px_0_0_#2d64bd] hover:bg-brand-50')} aria-current={a.id === selectedId ? 'true' : undefined}>
                  <div className="flex items-center justify-between gap-2"><span className="text-base font-bold tabular-nums">{fmtTime(a.starts_at)}</span>{a.queue_number && <span className="text-[0.8125rem] text-slate-600">{t('doctor.queueNo', { n: a.queue_number })}</span>}<AppointmentStatus status={a.status} /></div>
                  <div className="truncate text-[0.9375rem] font-semibold text-slate-900">{fullName(a)}</div>
                  <div className="truncate text-[0.8125rem] text-slate-600">{a.service_name}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {!selectedId ? <Card><EmptyState icon={<Stethoscope className="h-8 w-8" />} title={t('doctor.pickPatient')} /></Card>
        : !appt ? (single.isError ? <Card><ErrorState error={single.error} /></Card> : <Card><LoadingRows /></Card>)
        : <Workspace key={appt.id} appt={appt} />}
      <div className="hidden space-y-4 2xl:block"><NewsCard />{appt && <HistoryPanel patientId={appt.patient_id} currentEncounter={appt.encounter_id} />}</div>
      <div className="lg:col-span-2 2xl:hidden"><NewsCard /></div>
    </div>
  );
}

function Workspace({ appt }: { appt: any }) {
  const { me } = useSession();
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const start = useMutation({
    mutationFn: () => api(`/appointments/${appt.id}/start`, { method: 'POST' }),
    onSuccess: () => { ['appointments', 'queue', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('doctor.started')); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['appointments'] }); },
  });
  const patient = useQuery({ queryKey: ['patient', appt.patient_id], queryFn: () => api(`/patients/${appt.patient_id}`).then((r) => r.data) });

  const header = (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2.5"><h1 className="text-2xl font-bold leading-tight text-slate-900">{fullName(appt, true)}</h1><span className="text-base text-slate-600">{pid(appt.patient_number)}</span><AppointmentStatus status={appt.status} /></div>
          <div className="mt-1 text-base text-slate-700">{[fmtDate(appt.birth_date), ageFrom(appt.birth_date, me.today), appt.service_name, fmtTime(appt.starts_at), appt.room_name ?? appt.branch_name].join(', ')}</div>
        </div>
        {appt.status === 'arrived' && <Button variant="primary" className="min-h-12 px-5 text-base" icon={<PlayCircle className="h-5 w-5" />} loading={start.isPending} onClick={() => start.mutate()}>{t('doctor.start')}</Button>}
      </div>
      {patient.data && (
        // a known allergy is the one thing that must never be missed: full-width red band
        <div role={patient.data.allergy_state === 'known' ? 'alert' : undefined} className={cx('flex flex-wrap items-center gap-2 px-4 py-2.5 text-[0.9375rem] sm:px-5',
          patient.data.allergy_state === 'known' ? 'bg-red-700 font-bold text-white' : patient.data.allergy_state === 'denied' ? 'border-t border-slate-100 bg-slate-50 text-slate-800' : 'border-t border-amber-200 bg-amber-50 font-medium text-amber-900')}>
          <ShieldAlert className="h-5 w-5 shrink-0" />
          {t('doctor.allergy', { state: t(`allergy.${patient.data.allergy_state}` as MessageKey) })}{patient.data.allergy_note ? `: ${patient.data.allergy_note}` : ''}
          <Link href={`/patients/${appt.patient_id}`} className={cx('ml-auto text-sm font-semibold underline-offset-2 hover:underline', patient.data.allergy_state === 'known' ? 'text-white' : 'text-brand-700')}>{t('doctor.profile')}</Link>
        </div>
      )}
    </div>
  );

  const intake = <IntakePanel appointmentId={appt.id} />;
  if (appt.status === 'scheduled') return <div className="space-y-4">{header}{intake}<Card><EmptyState title={t('doctor.notArrivedTitle')} text={t('doctor.notArrivedText')} /></Card></div>;
  if (appt.status === 'no_show' || appt.status === 'cancelled') return <div className="space-y-4">{header}<Card><EmptyState title={t('doctor.notHeld')} /></Card></div>;
  if (appt.status === 'arrived') return <div className="space-y-4">{header}{intake}<Card><EmptyState icon={<PlayCircle className="h-8 w-8" />} title={t('doctor.waitingTitle')} text={t('doctor.waitingText', { n: appt.queue_number ?? '—' })} /></Card>
    <div className="2xl:hidden"><HistoryPanel patientId={appt.patient_id} /></div></div>;
  if (!appt.encounter_id) return <div className="space-y-4">{header}<Card><LoadingRows /></Card></div>;
  return <div className="space-y-4">{header}<Encounter encounterId={appt.encounter_id} appointmentId={appt.id} /><div className="2xl:hidden"><HistoryPanel patientId={appt.patient_id} currentEncounter={appt.encounter_id} /></div></div>;
}

function Encounter({ encounterId, appointmentId }: { encounterId: string; appointmentId: string }) {
  const { me } = useSession();
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const enc = useQuery({ queryKey: ['encounter', encounterId], queryFn: () => api(`/encounters/${encounterId}`).then((r) => r.data) });
  const [form, setForm] = useState<NoteForm | null>(null);
  const [base, setBase] = useState<NoteForm | null>(null);
  const [version, setVersion] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirmSign, setConfirmSign] = useState(false);

  useEffect(() => {
    if (enc.data && (!form || enc.data.note.version !== version && !dirtyOf(form, base))) {
      const f = toForm(enc.data.note); setForm(f); setBase(f); setVersion(enc.data.note.version); setSavedAt(enc.data.note.saved_at);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enc.data]);
  const dirty = dirtyOf(form, base);
  useUnsavedGuard(dirty);
  const lastAttempt = useRef<NoteForm | null>(null); // text of the most recent save whose outcome is unknown/failed

  /**
   * Saves the draft. If an earlier save reached the server but its response was lost, the server version has moved on:
   * we detect that (server text == our last attempt), adopt the server version and save the current text again.
   */
  const saveDraft = useMutation({
    mutationFn: async () => {
      const snapshot = form!;
      const previous = lastAttempt.current;
      lastAttempt.current = snapshot;
      try {
        return { r: await api(`/encounters/${encounterId}/draft`, { method: 'PUT', body: toBody(snapshot, version) }), snapshot };
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'STALE_STATE' && previous)) throw e;
        const server = (await api(`/encounters/${encounterId}`)).data.note;
        if (server.status !== 'draft' || (sameNote(toForm(server), previous)) === false) throw e;
        return { r: await api(`/encounters/${encounterId}/draft`, { method: 'PUT', body: toBody(snapshot, server.version) }), snapshot };
      }
    },
    onSuccess: ({ r, snapshot }: any) => { setVersion(r.data.version); setSavedAt(r.data.saved_at); setBase(snapshot); lastAttempt.current = null; setSaveError(null); setErrors({}); toast.success(t('note.savedToast', { time: fmtTime(r.data.saved_at) })); },
    onError: (e) => { setSaveError(t('note.saveFailed', { msg: (e as Error).message })); if (e instanceof ApiError && e.fields) setErrors(mapFields(e.fields)); },
  });
  const sign = useMutation({
    mutationFn: () => api(`/encounters/${encounterId}/sign`, { method: 'POST', body: toBody(form!, version) }),
    onSuccess: () => {
      setConfirmSign(false); setBase(form);
      ['encounter', 'appointments', 'queue', 'patient', 'doctor-history', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(t('note.signedToast'));
    },
    onError: async (e) => {
      setConfirmSign(false);
      // A sign whose response was lost: the retry hits IMMUTABLE. Reload and show the real (signed) state instead of a false error.
      if (e instanceof ApiError && e.code === 'IMMUTABLE') {
        const fresh = await enc.refetch();
        if (fresh.data?.note.status === 'signed') { setBase(form); ['appointments', 'queue', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); setSaveError(null); toast.info(t('note.alreadySigned')); return; }
      }
      setSaveError(t('note.signFailed', { msg: (e as Error).message })); if (e instanceof ApiError && e.fields) setErrors(mapFields(e.fields));
    },
  });

  if (enc.isLoading || !form) return <Card><LoadingRows rows={8} /></Card>;
  if (enc.isError) return <Card><ErrorState error={enc.error} onRetry={() => enc.refetch()} /></Card>;
  const signed = enc.data.note.status === 'signed';
  const set = (k: TextKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setForm((f) => ({ ...f!, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: '' })); };
  function trySign() {
    const e: Record<string, string> = {};
    for (const k of REQUIRED_FOR_SIGN) if (!form![k].trim()) e[k] = t('note.fillToSign');
    setErrors(e);
    if (Object.keys(e).length) { setSaveError(t('note.requiredToSign')); return; }
    setConfirmSign(true);
  }
  const aiDisabledReason = me.ai_mode === 'off' ? (me.ai_off_reason ?? t('note.aiOff')).replace(/\.$/, '') : null;

  return (
    <>
      <Card padded={false} title={<span className="flex items-center gap-2 whitespace-nowrap">{t('note.title')} <NoteStatus status={enc.data.note.status} /></span>}
        actions={<span className={cx('text-right text-[0.8125rem]', dirty && !signed ? 'font-semibold text-amber-800' : 'text-slate-600')}>{signed ? t('note.signedBy', { name: enc.data.note.signed_by_name, at: fmtDateTime(enc.data.note.signed_at) }) : dirty ? t('note.dirty') : savedAt ? t('note.savedAt', { time: fmtTime(savedAt) }) : t('note.notSaved')}</span>}>
        {/* helpers above the note; the bottom bar keeps only the two decisions: save and sign */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          {!signed && <>
            <Button size="sm" icon={<Sparkles className="h-4 w-4" />} disabled={!!aiDisabledReason} title={aiDisabledReason ?? t('note.aiButtonTitle')} onClick={() => setAiOpen(true)}>{t('note.aiButton')}</Button>
            <Button size="sm" icon={<FlaskConical className="h-4 w-4" />} onClick={() => setOrderOpen(true)}>{t('note.order')}</Button>
          </>}
          <Button size="sm" icon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>{t('note.preview')}</Button>
          <Link href={`/print/note/${encounterId}`} target="_blank" className="inline-flex min-h-9 items-center gap-2 rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:border-slate-500"><Printer className="h-4 w-4" />{t('common.print')}</Link>
          {aiDisabledReason && !signed && <span className="w-full text-[0.8125rem] text-slate-600">{t('note.aiOffLine', { reason: aiDisabledReason })}</span>}
        </div>
        <div className="space-y-3 p-4">
          {saveError && <Alert tone="red">{saveError}</Alert>}
          {signed && <Alert tone="blue">{t('note.signedLocked')}</Alert>}
          <IntakePanel appointmentId={appointmentId} onUseComplaints={signed ? undefined : (text) => {
            setForm((f) => ({ ...f!, complaints: f!.complaints.trim() ? `${f!.complaints.trim()}\n${text}` : text }));
            setErrors((x) => ({ ...x, complaints: '' }));
            toast.info(t('note.intakeAdded'));
          }} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Field label={t('note.bpSys')} error={errors.bp_sys}>{(id) => <Input id={id} inputMode="numeric" value={form.bp_sys} onChange={set('bp_sys')} disabled={signed} placeholder="—" />}</Field>
            <Field label={t('note.bpDia')} error={errors.bp_dia}>{(id) => <Input id={id} inputMode="numeric" value={form.bp_dia} onChange={set('bp_dia')} disabled={signed} placeholder="—" />}</Field>
            <Field label={t('note.pulse')} error={errors.pulse}>{(id) => <Input id={id} inputMode="numeric" value={form.pulse} onChange={set('pulse')} disabled={signed} placeholder="—" />}</Field>
            <Field label={t('note.temp')} error={errors.temp}>{(id) => <Input id={id} inputMode="decimal" value={form.temp} onChange={set('temp')} disabled={signed} placeholder="—" />}</Field>
            <Field label={t('note.followUp')} error={errors.follow_up_date}>{(id) => <Input id={id} type="date" min={me.today} value={form.follow_up_date} onChange={set('follow_up_date')} disabled={signed} />}</Field>
          </div>
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-2">
              <Field label={t(f.label)} required={f.required} error={errors[f.key]}>
                {(id) => <Textarea id={id} rows={f.rows} value={form[f.key]} onChange={set(f.key)} disabled={signed} invalid={!!errors[f.key]} placeholder={signed ? '' : t('common.notEntered')} />}
              </Field>
              {f.key === 'diagnosis' && (
                <IcdPicker value={form.icd10} diagnosis={form.diagnosis} encounterId={encounterId} disabled={signed}
                  onChange={(icd10) => { setForm((x) => ({ ...x!, icd10 })); setErrors((x) => ({ ...x, icd10: '' })); }} />
              )}
              {f.key === 'diagnosis' && errors.icd10 && <p className="text-sm font-medium text-red-700" role="alert">{errors.icd10}</p>}
            </div>
          ))}
        </div>
        {!signed && (
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-b-xl border-t border-slate-200 bg-white/95 px-4 py-2.5 shadow-[0_-8px_20px_-16px_rgba(26,34,51,0.35)] backdrop-blur">
            <span className={cx('min-w-[8rem] flex-1 text-[0.8125rem]', dirty ? 'font-semibold text-amber-800' : 'text-slate-600')}>{dirty ? t('note.dirty') : savedAt ? t('note.savedAt', { time: fmtTime(savedAt) }) : t('note.notSaved')}</span>
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <Button icon={<Save className="h-5 w-5" />} loading={saveDraft.isPending} disabled={!dirty} onClick={() => saveDraft.mutate()}>{t('note.saveDraft')}</Button>
              <Button variant="success" className="min-h-12 px-5 text-base" icon={<ClipboardCheck className="h-5 w-5" />} loading={sign.isPending} onClick={trySign}>{t('note.sign')}</Button>
            </div>
          </div>
        )}
      </Card>

      <Card title={t('orders.title')} actions={!signed && <Button size="sm" icon={<FlaskConical className="h-4 w-4" />} onClick={() => setOrderOpen(true)}>{t('note.order')}</Button>}>
        {!enc.data.orders.length ? <p className="text-sm text-slate-600">{t('orders.none')}</p> : (
          <ul className="space-y-3">
            {enc.data.orders.map((o: any) => (
              <li key={o.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm"><b>{o.service_name}</b><Badge>{t(`service.${o.category}` as MessageKey)}</Badge><span className="text-slate-600">{fmtTime(o.ordered_at)}, {formatSom(o.price_snapshot)}</span>
                  <span className="ml-auto">{o.category === 'ultrasound' ? <NoteStatus status={o.report_status} /> : <LabStatus status={o.status} />}</span></div>
                {o.category === 'lab' && o.status === 'verified' && o.values && <div className="mt-2"><LabValues values={o.values} compact /><p className="mt-1 text-[0.8125rem] text-slate-600">{t('orders.verifiedBy', { name: o.verified_by_name, at: fmtDateTime(o.verified_at) })}</p></div>}
                {o.category === 'lab' && o.status !== 'verified' && <p className="mt-1 text-[0.8125rem] text-slate-600">{t('orders.pending')}</p>}
                {o.category === 'ultrasound' && o.report_status === 'signed' && <p className="mt-1 text-sm"><span className="text-slate-600">{t('orders.conclusion')}</span> {o.conclusion}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DocumentsCard encounterId={encounterId} note={{ diagnosis: form.diagnosis, icd10: form.icd10, signed }} />

      <AiModal open={aiOpen} encounterId={encounterId} onClose={() => setAiOpen(false)} onApply={(d) => { setForm((f) => ({ ...f!, ...d })); toast.info(t('note.aiApplied')); }} />
      <OrderModal open={orderOpen} onClose={() => setOrderOpen(false)} encounterId={encounterId} existing={enc.data.orders} />
      <Modal open={preview} onClose={() => setPreview(false)} width="max-w-2xl" title={t('note.previewTitle')} footer={<Button onClick={() => setPreview(false)}>{t('common.close')}</Button>}>
        <NotePreview form={form} patient={enc.data.patient} appt={enc.data.appointment} status={enc.data.note.status} />
      </Modal>
      <Modal open={confirmSign} onClose={() => setConfirmSign(false)} title={t('note.signTitle')}
        footer={<><Button onClick={() => setConfirmSign(false)}>{t('common.back')}</Button><Button variant="success" loading={sign.isPending} icon={<CheckCircle2 className="h-5 w-5" />} onClick={() => sign.mutate()}>{t('note.signConfirm')}</Button></>}>
        <p className="text-base text-slate-800">{t('note.signText')}</p>
        <p className="mt-2 text-[0.8125rem] text-slate-600">{t('note.signLegal')}</p>
      </Modal>
    </>
  );
}

/** Compares note texts the way the server stores them (trimmed, numbers normalised). */
function sameNote(a: NoteForm, b: NoteForm) {
  const n = (f: NoteForm) => Object.entries(f).map(([k, v]) => [k, typeof v !== 'string' ? (v as Icd[]).map((x) => x.code).join(',') : ['bp_sys', 'bp_dia', 'pulse', 'temp'].includes(k) && v.trim() ? String(Number(v.replace(',', '.'))) : v.trim()]);
  return JSON.stringify(n(a)) === JSON.stringify(n(b));
}
function dirtyOf(a: NoteForm | null, b: NoteForm | null) { return !!a && !!b && JSON.stringify(a) !== JSON.stringify(b); }
function mapFields(f: Record<string, string>) { const o: Record<string, string> = {}; for (const [k, v] of Object.entries(f)) o[k.replace('vitals.', '')] = v; return o; }

function NotePreview({ form, patient, appt, status }: { form: NoteForm; patient: any; appt: any; status: string }) {
  const t = useT();
  const row = (k: string, v: string) => <div className="py-1.5"><div className="text-[0.8125rem] font-semibold text-slate-600">{k}</div><div className="whitespace-pre-wrap text-[0.9375rem]">{v.trim() || <span className="text-slate-500">{t('common.notEntered')}</span>}</div></div>;
  const vit = [form.bp_sys && form.bp_dia ? t('note.vitalsBp', { sys: form.bp_sys, dia: form.bp_dia }) : '', form.pulse ? t('note.vitalsPulse', { n: form.pulse }) : '', form.temp ? t('note.vitalsTemp', { n: form.temp }) : ''].filter(Boolean).join(', ');
  return (
    <div>
      {status !== 'signed' && <div className="mb-2 inline-block rounded border-2 border-amber-500 px-2 py-0.5 text-sm font-bold text-amber-800">{t('note.draftStamp')}</div>}
      <p className="text-[0.9375rem]"><b>{fullName(patient, true)}</b> {pid(patient.patient_number)}, {fmtDate(patient.birth_date)}, {appt.service_name}, {appt.doctor_name}</p>
      <div className="mt-2 divide-y divide-slate-100">
        {vit && row(t('note.vitals'), vit)}
        {FIELDS.map((f) => <div key={f.key}>{row(t(f.label), form[f.key])}{f.key === 'diagnosis' && form.icd10.length > 0 && row(t('icd.label'), form.icd10.map((x) => `${x.code} — ${x.title}`).join('\n'))}</div>)}
        {form.follow_up_date && row(t('note.followUpShort'), fmtDate(form.follow_up_date))}
      </div>
    </div>
  );
}

function AiModal({ open, onClose, onApply, encounterId }: { open: boolean; onClose: () => void; onApply: (d: Partial<NoteForm>) => void; encounterId: string }) {
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api('/ai/status').then((r) => r.data), enabled: open });
  const t = useT();
  const [text, setText] = useState('');
  const run = useMutation({ mutationFn: () => api('/ai/note-draft', { method: 'POST', body: { text, encounter_id: encounterId } }).then((r) => r.data) });
  useEffect(() => { if (!open) { run.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = run.data?.draft;
  const label = run.data?.mode === 'sample' ? t('ai.sampleLabel') : t('ai.liveLabel');
  // the model answers «Kiritilmagan» for an empty section (its prompt is Uzbek); show it in the doctor's language
  const NOT_ENTERED = 'Kiritilmagan';
  return (
    <Modal open={open} onClose={onClose} width="max-w-5xl" dirty={!!text && !d} title={<span className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-brand-600" />{t('ai.title')} {status.data?.mode === 'sample' && <Badge tone="yellow">{t('ai.sampleMode')}</Badge>}{status.data?.mode === 'live' && <Badge tone="teal">{t('ai.live')}</Badge>}</span>}
      footer={d ? <><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => { onApply(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === NOT_ENTERED ? '' : v])) as Partial<NoteForm>); onClose(); }}>{t('ai.apply')}</Button></>
        : <><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={run.isPending} disabled={text.trim().length < 10} onClick={() => run.mutate()}>{t('ai.run')}</Button></>}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between"><span className="text-sm font-semibold text-slate-800">{t('ai.source')}</span>
            {status.data?.sample_text && !d && <button className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => setText(status.data.sample_text)}>{t('ai.useSample')}</button>}</div>
          <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} disabled={!!d} placeholder={t('ai.placeholder')} />
          {status.data?.mode === 'sample' && <p className="mt-1 text-[0.8125rem] text-slate-600">{t('ai.sampleOnly')}</p>}
        </div>
        <div>
          <span className="mb-1 block text-sm font-semibold text-slate-800">{t('ai.draft')}</span>
          {run.isPending ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            : run.isError ? <Alert tone="red">{t('ai.failed', { msg: (run.error as Error).message })}</Alert>
            : d ? (
              <div className="space-y-2">
                <Alert tone={run.data.mode === 'sample' ? 'yellow' : 'blue'}>{t('ai.rules', { label })}</Alert>
                {FIELDS.map((f) => <div key={f.key} className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-[0.8125rem] font-semibold text-slate-600">{t(f.label)}</div><div className={cx('whitespace-pre-wrap text-[0.9375rem]', d[f.key] === NOT_ENTERED && 'text-slate-500')}>{d[f.key] === NOT_ENTERED ? t('common.notEntered') : d[f.key]}</div></div>)}
              </div>
            ) : <p className="rounded-lg border-2 border-dashed border-slate-300 p-8 text-center text-[0.9375rem] text-slate-600">{t('ai.empty')}</p>}
        </div>
      </div>
    </Modal>
  );
}

function OrderModal({ open, onClose, encounterId, existing }: { open: boolean; onClose: () => void; encounterId: string; existing: any[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const services = useQuery({ queryKey: ['services'], queryFn: () => api('/services').then((r) => r.data as any[]), enabled: open });
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => { if (open) setSel([]); }, [open]);
  const taken = new Set(existing.filter((o) => o.status !== 'cancelled').map((o) => o.service_name));
  const groups = useMemo(() => ['lab', 'ultrasound', 'procedure'].map((c) => ({ c, items: (services.data ?? []).filter((s) => s.category === c) })), [services.data]);
  const m = useMutation({
    mutationFn: () => api(`/encounters/${encounterId}/orders`, { method: 'POST', body: { service_ids: sel } }),
    onSuccess: () => { ['encounter', 'invoices', 'orders'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('orders.done', { n: sel.length })); onClose(); },
    onError: (e) => toast.error(e),
  });
  const total = (services.data ?? []).filter((s) => sel.includes(s.id)).reduce((a, s) => a + s.price, 0);
  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" dirty={sel.length > 0} title={t('orders.modalTitle')}
      footer={<><span className="mr-auto text-sm text-slate-700">{t('orders.selected', { n: sel.length, sum: formatSom(total) })}</span><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!sel.length} loading={m.isPending} onClick={() => m.mutate()}>{t('orders.submit')}</Button></>}>
      {services.isLoading ? <LoadingRows /> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {groups.map((g) => (
            <fieldset key={g.c}><legend className="mb-1 text-sm font-bold text-slate-800">{t(`service.${g.c}` as MessageKey)}</legend>
              {g.items.map((s) => (
                <label key={s.id} className={cx('flex min-h-10 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-[0.9375rem] hover:bg-slate-50', taken.has(s.name) && 'cursor-not-allowed opacity-60')}>
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" disabled={taken.has(s.name)} checked={sel.includes(s.id)} onChange={(e) => setSel((x) => e.target.checked ? [...x, s.id] : x.filter((i) => i !== s.id))} />
                  <span className="flex-1">{s.name}{taken.has(s.name) && <span className="text-[0.8125rem] text-slate-600"> {t('orders.taken')}</span>}</span><span className="tabular-nums text-[0.8125rem] text-slate-600">{formatSom(s.price, false)}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}
      <p className="mt-3 text-[0.8125rem] text-slate-600">{t('orders.priceNote')}</p>
    </Modal>
  );
}

function HistoryPanel({ patientId, currentEncounter }: { patientId: string; currentEncounter?: string }) {
  const t = useT();
  const h = useQuery({ queryKey: ['doctor-history', patientId], queryFn: () => api(`/doctor/patient-history?patient_id=${patientId}`).then((r) => r.data) });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card padded={false} title={t('history.title')} className="self-start 2xl:sticky 2xl:top-[88px]">
      {h.isLoading ? <LoadingRows rows={4} /> : h.isError ? <ErrorState error={h.error} onRetry={() => h.refetch()} /> : (
        <div className="max-h-[calc(100vh-150px)] space-y-4 overflow-y-auto p-3 text-sm">
          <section>
            <h3 className="mb-1 text-sm font-bold text-slate-800">{t('history.visits')}</h3>
            {h.data.notes.filter((n: any) => n.encounter_id !== currentEncounter).length === 0 ? <p className="text-slate-600">{t('history.noVisits')}</p> :
              h.data.notes.filter((n: any) => n.encounter_id !== currentEncounter).map((n: any) => (
                <button key={n.encounter_id} aria-expanded={open === n.encounter_id} onClick={() => setOpen(open === n.encounter_id ? null : n.encounter_id)} className="mb-1.5 block w-full rounded-lg border border-slate-200 px-2.5 py-2 text-left hover:bg-slate-50">
                  <div className="flex justify-between text-[0.8125rem]"><b>{fmtDate(n.starts_at)}</b><span className="text-slate-600">{n.specialty}</span></div>
                  <div className="text-sm">{n.diagnosis}</div>
                  {open === n.encounter_id && <div className="mt-1 space-y-0.5 text-[0.8125rem] text-slate-700"><p>{t('history.complaint', { text: n.complaints })}</p><p>{t('history.advice', { text: n.recommendations })}</p><p className="text-slate-600">{n.doctor_name}</p></div>}
                </button>
              ))}
            <p className="mt-1 text-2xs text-slate-600">{t('history.noCopy')}</p>
          </section>
          <section>
            <h3 className="mb-1 text-sm font-bold text-slate-800">{t('history.labs')}</h3>
            {!h.data.labs.length ? <p className="text-slate-600">{t('common.none')}</p> : h.data.labs.map((l: any) => (
              <div key={l.id} className="mb-1.5 rounded-lg border border-slate-200 px-2.5 py-2">
                <div className="flex items-center justify-between gap-1 text-[0.8125rem]"><b className="truncate">{l.service_name}</b><LabStatus status={l.status} /></div>
                <div className="text-2xs text-slate-600">{fmtDate(l.ordered_at)}</div>
                {l.values && <div className="mt-1"><LabValues values={l.values} compact /></div>}
              </div>
            ))}
          </section>
          <section>
            <h3 className="mb-1 text-sm font-bold text-slate-800">{t('history.ultrasound')}</h3>
            {!h.data.diagnostics.length ? <p className="text-slate-600">{t('common.none')}</p> : h.data.diagnostics.map((d: any) => (
              <div key={d.id} className="mb-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-[0.8125rem]"><div className="flex justify-between"><b>{d.service_name}</b><NoteStatus status={d.report_status} /></div>{d.conclusion && <p className="mt-0.5">{d.conclusion}</p>}</div>
            ))}
          </section>
        </div>
      )}
    </Card>
  );
}
