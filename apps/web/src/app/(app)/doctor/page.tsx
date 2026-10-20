'use client';
import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Eye, FlaskConical, PlayCircle, Printer, ShieldAlert, Sparkles, Stethoscope } from 'lucide-react';
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
import { Alert, Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, LinkButton, LoadingRows, Modal, ModalCancel, Skeleton, Textarea, Toolbar, useToast } from '@/components/ui';
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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[16rem_minmax(0,1fr)] 2xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
      <Card padded={false} className="self-start lg:sticky lg:top-[5rem]"
        title={<span className="flex items-center gap-2">{t('doctor.today')}{day.data && <span className="rounded-full bg-slate-100 px-2 text-[0.8125rem] font-semibold tabular-nums text-slate-700">{sorted.length}</span>}</span>}>
        {day.isLoading ? <LoadingRows rows={5} /> : day.isError ? <ErrorState error={day.error} onRetry={() => day.refetch()} /> : !sorted.length ? <EmptyState compact title={t('doctor.noVisits')} /> : (
          <ul className="max-h-[16rem] divide-y divide-slate-100 overflow-y-auto lg:max-h-[calc(100vh-9rem)]">
            {sorted.map((a) => (
              <li key={a.id}>
                <Link href={`/doctor?appointment=${a.id}`} aria-current={a.id === selectedId ? 'true' : undefined}
                  className={cx('block px-4 py-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300', a.id === selectedId && 'bg-brand-50 shadow-[inset_4px_0_0_#2d64bd] hover:bg-brand-50')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-bold tabular-nums text-slate-900">{fmtTime(a.starts_at)}{a.queue_number && <span className="ml-2 text-[0.8125rem] font-semibold text-slate-600">{t('doctor.queueNo', { n: a.queue_number })}</span>}</span>
                    <AppointmentStatus status={a.status} />
                  </div>
                  <div className="mt-0.5 truncate text-[0.9375rem] font-semibold text-slate-900">{fullName(a)}</div>
                  <div className="truncate text-[0.8125rem] text-slate-600">{a.service_name}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {!selectedId ? <Card><EmptyState icon={<Stethoscope />} title={t('doctor.pickPatient')} /></Card>
        : !appt ? (single.isError ? <Card><ErrorState error={single.error} /></Card> : <Card><LoadingRows /></Card>)
        : <Workspace key={appt.id} appt={appt} />}
      {/* side information: history and news, quiet, in a third column only on wide screens */}
      <div className="hidden space-y-5 2xl:block">{appt && <HistoryPanel patientId={appt.patient_id} currentEncounter={appt.encounter_id} />}<NewsCard /></div>
      {/* column 2 only: the sticky patient list in column 1 must never slide over it */}
      <div className="lg:col-start-2 2xl:hidden"><NewsCard /></div>
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
  const allergy = patient.data?.allergy_state as string | undefined;

  const header = (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h1 className="text-2xl font-bold leading-tight text-slate-900">{fullName(appt, true)}</h1><AppointmentStatus status={appt.status} /></div>
          <p className="mt-1.5 text-[0.9375rem] text-slate-600">
            <span className="whitespace-nowrap font-semibold text-slate-900">{ageFrom(appt.birth_date, me.today)}</span>
            {[fmtDate(appt.birth_date), pid(appt.patient_number), appt.service_name, [fmtTime(appt.starts_at), appt.room_name ?? appt.branch_name].filter(Boolean).join(', ')].map((x, i) => <span key={i}> <span aria-hidden="true" className="text-slate-400">·</span> <span className={i !== 2 ? 'whitespace-nowrap' : undefined}>{x}</span></span>)}
          </p>
        </div>
        {appt.status === 'arrived' && <Button variant="primary" className="shrink-0 self-start sm:self-center" icon={<PlayCircle className="h-5 w-5" />} loading={start.isPending} onClick={() => start.mutate()}>{t('doctor.start')}</Button>}
      </div>
      {patient.data && allergy && (
        // a known allergy is the one thing that must never be missed: full-width red band
        <div role={allergy === 'known' ? 'alert' : undefined} className={cx('flex flex-wrap items-start gap-x-2 gap-y-1 px-5 py-2.5 text-[0.9375rem]',
          allergy === 'known' ? 'bg-red-700 font-bold text-white' : allergy === 'denied' ? 'border-t border-slate-100 bg-slate-50 text-slate-800' : 'border-t border-amber-200 bg-amber-50 font-medium text-amber-900')}>
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="min-w-[12rem] flex-1">{allergy === 'known' && patient.data.allergy_note
            ? t('doctor.allergyKnown', { note: patient.data.allergy_note })
            : `${t('doctor.allergy', { state: t(`allergy.${allergy}` as MessageKey) })}${patient.data.allergy_note ? `: ${patient.data.allergy_note}` : ''}`}</span>
          <Link href={`/patients/${appt.patient_id}`} className={cx('ml-7 shrink-0 whitespace-nowrap rounded text-sm font-semibold underline-offset-2 sm:ml-0 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300', allergy === 'known' ? 'text-white' : 'text-brand-700')}>{t('doctor.profile')}</Link>
        </div>
      )}
    </section>
  );

  const intake = <IntakePanel appointmentId={appt.id} />;
  const history = <div className="2xl:hidden"><HistoryPanel patientId={appt.patient_id} currentEncounter={appt.encounter_id} /></div>;
  if (appt.status === 'scheduled') return <div className="space-y-5">{header}{intake}<Card><EmptyState compact icon={<Clock />} title={t('doctor.notArrivedTitle')} text={t('doctor.notArrivedText')} /></Card>{history}</div>;
  if (appt.status === 'no_show' || appt.status === 'cancelled') return <div className="space-y-5">{header}<Card><EmptyState compact title={t('doctor.notHeld')} /></Card>{history}</div>;
  if (appt.status === 'arrived') return <div className="space-y-5">{header}{intake}<Card><EmptyState compact icon={<PlayCircle />} title={t('doctor.waitingTitle')} text={t('doctor.waitingText', { n: appt.queue_number ?? '—' })} /></Card>{history}</div>;
  if (!appt.encounter_id) return <div className="space-y-5">{header}<Card><LoadingRows /></Card></div>;
  return <div className="space-y-5">{header}<Encounter encounterId={appt.encounter_id} appointmentId={appt.id} />{history}</div>;
}

function Encounter({ encounterId, appointmentId }: { encounterId: string; appointmentId: string }) {
  const { me } = useSession();
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const bpId = useId();
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
  // Two tabs on one note: the other tab saved first, so ours is rejected (409 STALE_STATE). `conflict` holds our text
  // until the doctor opens the newer version; then it moves to `mine`, shown beside the form to copy or put back.
  const [conflict, setConflict] = useState<NoteForm | null>(null);
  const [mine, setMine] = useState<NoteForm | null>(null);
  const [loadingServer, setLoadingServer] = useState(false);
  const dirty = dirtyOf(form, base);
  useUnsavedGuard(dirty || !!conflict || !!mine);
  const lastAttempt = useRef<NoteForm | null>(null); // text of the most recent save whose outcome is unknown/failed
  const fieldRefs = useRef<Partial<Record<TextKey, HTMLTextAreaElement | null>>>({});

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
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'STALE_STATE') { setConflict(form); setSaveError(null); return; }
      setSaveError(t('note.saveFailed', { msg: (e as Error).message })); if (e instanceof ApiError && e.fields) setErrors(mapFields(e.fields));
    },
  });
  /** Loads the version saved in the other tab into the form; the doctor's own text stays beside it («Mening matnim»). */
  async function openServerVersion() {
    setLoadingServer(true);
    const fresh = await enc.refetch();
    setLoadingServer(false);
    if (!fresh.data) { toast.error(fresh.error ?? t('state.loadFailed')); return; }
    const n = fresh.data.note, f = toForm(n);
    setMine(conflict); setConflict(null); setForm(f); setBase(f); setVersion(n.version); setSavedAt(n.saved_at); setErrors({}); lastAttempt.current = null;
  }
  const sign = useMutation({
    mutationFn: () => api(`/encounters/${encounterId}/sign`, { method: 'POST', body: toBody(form!, version) }),
    onSuccess: () => {
      setConfirmSign(false); setBase(form);
      ['encounter', 'appointments', 'queue', 'patient', 'doctor-history', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(t('note.signedToast'));
    },
    onError: async (e) => {
      setConfirmSign(false);
      if (e instanceof ApiError && e.code === 'STALE_STATE') { setConflict(form); setSaveError(null); return; }
      // A sign whose response was lost: the retry hits IMMUTABLE. Reload and show the real (signed) state instead of a false error.
      if (e instanceof ApiError && e.code === 'IMMUTABLE') {
        const fresh = await enc.refetch();
        if (fresh.data?.note.status === 'signed') { setBase(form); ['appointments', 'queue', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); setSaveError(null); toast.info(t('note.alreadySigned')); return; }
      }
      setSaveError(t('note.signFailed', { msg: (e as Error).message })); if (e instanceof ApiError && e.fields) setErrors(mapFields(e.fields));
    },
  });

  // a failed first load shows the error and «Retry»; a failed background refetch keeps the form as it is
  if (!enc.data) return <Card>{enc.isError ? <ErrorState error={enc.error} onRetry={() => enc.refetch()} /> : <LoadingRows rows={8} />}</Card>;
  if (!form) return <Card><LoadingRows rows={8} /></Card>;
  const signed = enc.data.note.status === 'signed';
  const set = (k: TextKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setForm((f) => ({ ...f!, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: '' })); };
  function trySign() {
    const e: Record<string, string> = {};
    for (const k of REQUIRED_FOR_SIGN) if (!form![k].trim()) e[k] = t('note.fillToSign');
    setErrors(e);
    // take the doctor straight to the first empty required field
    const first = REQUIRED_FOR_SIGN.find((k) => e[k]);
    if (first) { const el = fieldRefs.current[first as TextKey]; el?.focus({ preventScroll: true }); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    setConfirmSign(true);
  }
  // the summary stays only while a required field is still empty (it clears as soon as they are filled)
  const missingToSign = REQUIRED_FOR_SIGN.some((k) => errors[k] === t('note.fillToSign'));
  const aiDisabledReason = me.ai_mode === 'off' ? (me.ai_off_reason ?? t('note.aiOff')).replace(/\.$/, '') : null;
  const printLink = <LinkButton size="sm" variant="ghost" target="_blank" href={`/print/note/${encounterId}`} icon={<Printer className="h-4 w-4" />}>{t('common.print')}</LinkButton>;
  const textField = (f: (typeof FIELDS)[number]) => (
    <Field key={f.key} label={t(f.label)} required={f.required} error={errors[f.key]}>
      {(id) => <Textarea ref={(el) => { fieldRefs.current[f.key] = el; }} id={id} rows={f.rows} value={form[f.key]} onChange={set(f.key)} invalid={!!errors[f.key]} placeholder={t('common.notEntered')} />}
    </Field>
  );
  const vital = (k: 'bp_sys' | 'bp_dia' | 'pulse' | 'temp', cls: string, mode: 'numeric' | 'decimal' = 'numeric') => (
    <Input id={`${bpId}-${k}`} inputMode={mode} className={cls} value={form[k]} onChange={set(k)} invalid={!!errors[k]} placeholder="—" />
  );
  const vitalErrors = (['bp_sys', 'bp_dia', 'pulse', 'temp'] as const).map((k) => errors[k]).filter(Boolean);

  return (
    <div className="space-y-5">
      {mine && <MyText mine={mine} server={form} canPutBack={!signed} onPutBack={() => { setForm(mine); setMine(null); }} onDismiss={() => setMine(null)} />}
      <Card padded={false} title={<span className="flex items-center gap-2 whitespace-nowrap">{t('note.title')} <NoteStatus status={enc.data.note.status} /></span>}
        actions={signed ? printLink : undefined}>
        {!signed && (
          <Toolbar actions={<><Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>{t('note.preview')}</Button>{printLink}</>}>
            <Button size="sm" icon={<Sparkles className="h-4 w-4 text-brand-600" />} disabled={!!aiDisabledReason} title={aiDisabledReason ?? t('note.aiButtonTitle')} onClick={() => setAiOpen(true)}>{t('note.aiButton')}</Button>
            {aiDisabledReason && <span className="text-[0.8125rem] text-slate-600">{t('note.aiOffLine', { reason: aiDisabledReason })}</span>}
          </Toolbar>
        )}
        <div className="space-y-4 p-5">
          {signed && <p className="text-[0.8125rem] text-slate-600">{t('note.signedBy', { name: enc.data.note.signed_by_name, at: fmtDateTime(enc.data.note.signed_at) })}</p>}
          <IntakePanel appointmentId={appointmentId} onUseComplaints={signed ? undefined : (text) => {
            setForm((f) => ({ ...f!, complaints: f!.complaints.trim() ? `${f!.complaints.trim()}\n${text}` : text }));
            setErrors((x) => ({ ...x, complaints: '' }));
            toast.info(t('note.intakeAdded'));
          }} />
          {signed ? <div className="divide-y divide-slate-100"><NoteRows form={form} /></div> : <>
            {/* vitals: one short row; the two pressure numbers sit together like the doctor writes them (120 / 80) */}
            <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
              <div role="group" aria-labelledby={`${bpId}-bp`} className="flex flex-col gap-1">
                <span id={`${bpId}-bp`} className="whitespace-nowrap text-sm font-semibold text-slate-800">{t('note.bp')} <span className="font-normal text-slate-600">{t('note.bpUnit')}</span></span>
                <div className="flex items-center gap-2">
                  <label htmlFor={`${bpId}-bp_sys`} className="sr-only">{t('note.bpSys')}</label>{vital('bp_sys', 'w-20')}
                  <span aria-hidden="true" className="text-lg text-slate-600">/</span>
                  <label htmlFor={`${bpId}-bp_dia`} className="sr-only">{t('note.bpDia')}</label>{vital('bp_dia', 'w-20')}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${bpId}-pulse`} className="whitespace-nowrap text-sm font-semibold text-slate-800">{t('note.pulse')} <span className="font-normal text-slate-600">{t('note.pulseUnit')}</span></label>
                {vital('pulse', 'w-24')}
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${bpId}-temp`} className="whitespace-nowrap text-sm font-semibold text-slate-800">{t('note.temp')} <span className="font-normal text-slate-600">°C</span></label>
                {vital('temp', 'w-24', 'decimal')}
              </div>
            </div>
            {vitalErrors.length > 0 && <p className="text-sm font-medium text-red-700" role="alert">{vitalErrors.join(' ')}</p>}
            {FIELDS.map((f) => f.key !== 'diagnosis' ? textField(f) : (
              <div key={f.key} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                {textField(f)}
                <IcdPicker value={form.icd10} diagnosis={form.diagnosis} encounterId={encounterId}
                  onChange={(icd10) => { setForm((x) => ({ ...x!, icd10 })); setErrors((x) => ({ ...x, icd10: '' })); }} />
                {errors.icd10 && <p className="text-sm font-medium text-red-700" role="alert">{errors.icd10}</p>}
              </div>
            ))}
            <Field label={t('note.followUp')} error={errors.follow_up_date}>{(id) => <Input id={id} type="date" min={me.today} className="w-52" value={form.follow_up_date} onChange={set('follow_up_date')} />}</Field>
          </>}
        </div>
      </Card>

      <Card title={t('orders.title')} actions={!signed && <Button size="sm" icon={<FlaskConical className="h-4 w-4" />} onClick={() => setOrderOpen(true)}>{t('note.order')}</Button>}>
        {!enc.data.orders.length ? <p className="text-[0.9375rem] text-slate-600">{t('orders.none')}</p> : (
          <ul className="divide-y divide-slate-100">
            {enc.data.orders.map((o: any) => (
              <li key={o.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="min-w-[12rem] flex-1"><span className="text-[0.9375rem] font-semibold text-slate-900">{o.service_name}</span>
                    <span className="block text-[0.8125rem] text-slate-600">{t(`service.${o.category}` as MessageKey)} · {fmtTime(o.ordered_at)} · {formatSom(o.price_snapshot)}</span></span>
                  {o.category === 'ultrasound' ? <NoteStatus status={o.report_status} /> : <LabStatus status={o.status} />}
                </div>
                {o.category === 'lab' && o.status === 'verified' && o.values && <div className="mt-2"><LabValues values={o.values} compact /><p className="mt-1 text-[0.8125rem] text-slate-600">{t('orders.verifiedBy', { name: o.verified_by_name, at: fmtDateTime(o.verified_at) })}</p></div>}
                {o.category === 'ultrasound' && o.report_status === 'signed' && <p className="mt-1.5 text-[0.9375rem]"><span className="text-slate-600">{t('orders.conclusion')}</span> {o.conclusion}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DocumentsCard encounterId={encounterId} note={{ diagnosis: form.diagnosis, icd10: form.icd10, signed }} />

      {/* the two decisions of the visit, always in reach while the doctor writes, orders and issues documents */}
      {!signed && (
        <div className="sticky bottom-0 z-10 space-y-2 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(26,34,51,0.4)] backdrop-blur">
          {saveError && <Alert tone="red">{saveError}</Alert>}
          {conflict && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900" role="alert" data-testid="note-conflict">
              <span className="min-w-[14rem] flex-1">{t('note.conflict')}</span>
              <Button size="sm" variant="primary" loading={loadingServer} onClick={openServerVersion}>{t('note.conflictLoad')}</Button>
            </div>
          )}
          {missingToSign && <Alert tone="red">{t('note.requiredToSign')}</Alert>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className={cx('w-full text-[0.8125rem] sm:w-auto sm:flex-1 sm:whitespace-nowrap', dirty ? 'font-semibold text-amber-800' : 'text-slate-600')}>{dirty ? t('note.dirty') : savedAt ? t('note.savedAt', { time: fmtTime(savedAt) }) : t('note.notSaved')}</span>
            <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto">
              <Button className="max-sm:!whitespace-normal max-sm:!px-3 max-sm:text-sm max-sm:leading-tight" loading={saveDraft.isPending} disabled={!dirty || !!conflict} onClick={() => saveDraft.mutate()}>{t('note.saveDraft')}</Button>
              <Button variant="primary" className="max-sm:!whitespace-normal max-sm:!px-3 max-sm:text-sm max-sm:leading-tight" loading={sign.isPending} disabled={!!conflict} onClick={trySign}>{t('note.sign')}</Button>
            </div>
          </div>
        </div>
      )}

      <AiModal open={aiOpen} encounterId={encounterId} onClose={() => setAiOpen(false)} onApply={(d) => { setForm((f) => ({ ...f!, ...d })); toast.info(t('note.aiApplied')); }} />
      <OrderModal open={orderOpen} onClose={() => setOrderOpen(false)} encounterId={encounterId} existing={enc.data.orders} />
      <Modal open={preview} onClose={() => setPreview(false)} width="max-w-2xl" title={t('note.previewTitle')} footer={<Button onClick={() => setPreview(false)}>{t('common.close')}</Button>}>
        <NotePreview form={form} patient={enc.data.patient} appt={enc.data.appointment} status={enc.data.note.status} />
      </Modal>
      <Modal open={confirmSign} onClose={() => setConfirmSign(false)} title={t('note.signTitle')}
        footer={<><Button onClick={() => setConfirmSign(false)}>{t('common.back')}</Button><Button variant="primary" loading={sign.isPending} icon={<CheckCircle2 className="h-5 w-5" />} onClick={() => sign.mutate()}>{t('note.signConfirm')}</Button></>}>
        <p className="text-base text-slate-800">{t('note.signText')}</p>
        <p className="mt-2 text-[0.8125rem] text-slate-600">{t('note.signLegal')}</p>
      </Modal>
    </div>
  );
}

/** Compares note texts the way the server stores them (trimmed, numbers normalised). */
function sameNote(a: NoteForm, b: NoteForm) {
  const n = (f: NoteForm) => Object.entries(f).map(([k, v]) => [k, typeof v !== 'string' ? (v as Icd[]).map((x) => x.code).join(',') : ['bp_sys', 'bp_dia', 'pulse', 'temp'].includes(k) && v.trim() ? String(Number(v.replace(',', '.'))) : v.trim()]);
  return JSON.stringify(n(a)) === JSON.stringify(n(b));
}
function dirtyOf(a: NoteForm | null, b: NoteForm | null) { return !!a && !!b && JSON.stringify(a) !== JSON.stringify(b); }
function mapFields(f: Record<string, string>) { const o: Record<string, string> = {}; for (const [k, v] of Object.entries(f)) o[k.replace('vitals.', '')] = v; return o; }

/** After a two-tab conflict: the doctor's unsaved text beside the newer version, each differing part with «Copy». */
function MyText({ mine, server, canPutBack, onPutBack, onDismiss }: { mine: NoteForm; server: NoteForm; canPutBack: boolean; onPutBack: () => void; onDismiss: () => void }) {
  const t = useT();
  const toast = useToast();
  const vit = (f: NoteForm) => [f.bp_sys && f.bp_dia ? t('note.vitalsBp', { sys: f.bp_sys, dia: f.bp_dia }) : '', f.pulse ? t('note.vitalsPulse', { n: f.pulse }) : '', f.temp ? t('note.vitalsTemp', { n: f.temp }) : ''].filter(Boolean).join(', ');
  const icd = (f: NoteForm) => f.icd10.map((x) => `${x.code} — ${x.title}`).join('\n');
  const parts: { label: string; text: string; other: string }[] = [
    { label: t('note.vitals'), text: vit(mine), other: vit(server) },
    ...FIELDS.map((f) => ({ label: t(f.label), text: mine[f.key], other: server[f.key] })),
    { label: t('icd.label'), text: icd(mine), other: icd(server) },
    { label: t('note.followUpShort'), text: mine.follow_up_date ? fmtDate(mine.follow_up_date) : '', other: server.follow_up_date ? fmtDate(server.follow_up_date) : '' },
  ].filter((x) => x.text.trim() && x.text.trim() !== x.other.trim());
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.success(t('note.mineCopied')), () => toast.error(t('note.mineCopyFailed')));
  return (
    <section className="rounded-xl border-2 border-amber-300 bg-amber-50/60" data-testid="note-mine">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-amber-200 px-5 py-2.5">
        <h2 className="text-base font-bold text-slate-900">{t('note.mineTitle')}</h2>
        <div className="flex flex-wrap gap-2">
          {canPutBack && parts.length > 0 && <Button size="sm" onClick={onPutBack}>{t('note.mineUse')}</Button>}
          <Button size="sm" variant="ghost" onClick={onDismiss}>{t('common.close')}</Button>
        </div>
      </header>
      <div className="space-y-3 px-5 py-4">
        <p className="text-sm text-slate-700">{parts.length ? t('note.mineText') : t('note.mineSame')}</p>
        {parts.map((p) => (
          <div key={p.label} className="rounded-lg border border-amber-200 bg-white px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-3"><span className="text-[0.8125rem] font-semibold text-slate-600">{p.label}</span><Button size="sm" variant="ghost" onClick={() => copy(p.text)}>{t('note.mineCopy')}</Button></div>
            <div className="mt-1 select-text whitespace-pre-wrap text-[0.9375rem] text-slate-900">{p.text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The note as text (preview and the read-only view of a signed note): no input boxes, nothing to edit. */
function NoteRows({ form }: { form: NoteForm }) {
  const t = useT();
  const row = (k: string, v: string) => <div className="py-1.5"><div className="text-[0.8125rem] font-semibold text-slate-600">{k}</div><div className="whitespace-pre-wrap text-[0.9375rem] text-slate-900">{v.trim() || <span className="text-slate-600">{t('common.notEntered')}</span>}</div></div>;
  const vit = [form.bp_sys && form.bp_dia ? t('note.vitalsBp', { sys: form.bp_sys, dia: form.bp_dia }) : '', form.pulse ? t('note.vitalsPulse', { n: form.pulse }) : '', form.temp ? t('note.vitalsTemp', { n: form.temp }) : ''].filter(Boolean).join(', ');
  return (
    <>
      {vit && row(t('note.vitals'), vit)}
      {FIELDS.map((f) => <div key={f.key}>{row(t(f.label), form[f.key])}{f.key === 'diagnosis' && form.icd10.length > 0 && row(t('icd.label'), form.icd10.map((x) => `${x.code} — ${x.title}`).join('\n'))}</div>)}
      {form.follow_up_date && row(t('note.followUpShort'), fmtDate(form.follow_up_date))}
    </>
  );
}

function NotePreview({ form, patient, appt, status }: { form: NoteForm; patient: any; appt: any; status: string }) {
  const t = useT();
  return (
    <div>
      {status !== 'signed' && <div className="mb-2 inline-block rounded border-2 border-amber-500 px-2 py-0.5 text-sm font-bold text-amber-800">{t('note.draftStamp')}</div>}
      <p className="text-[0.9375rem]"><b>{fullName(patient, true)}</b> {pid(patient.patient_number)}, {fmtDate(patient.birth_date)}, {appt.service_name}, {appt.doctor_name}</p>
      <div className="mt-2 divide-y divide-slate-100"><NoteRows form={form} /></div>
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
    <Modal open={open} onClose={onClose} width="max-w-5xl" dirty={!!text && !d} title={<span className="flex flex-wrap items-center gap-2"><Sparkles className="h-5 w-5 shrink-0 text-brand-600" />{t('ai.title')} {status.data?.mode === 'sample' && <Badge tone="yellow">{t('ai.sampleMode')}</Badge>}{status.data?.mode === 'live' && <Badge tone="teal">{t('ai.live')}</Badge>}</span>}
      footer={d ? <><ModalCancel /><Button variant="primary" onClick={() => { onApply(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === NOT_ENTERED ? '' : v])) as Partial<NoteForm>); onClose(); }}>{t('ai.apply')}</Button></>
        : <><ModalCancel /><Button variant="primary" loading={run.isPending} disabled={text.trim().length < 10} onClick={() => run.mutate()}>{t('ai.run')}</Button></>}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2"><label htmlFor="ai-source" className="text-sm font-semibold text-slate-800">{t('ai.source')}</label>
            {status.data?.sample_text && !d && <Button size="sm" variant="ghost" className="-mr-2 !px-2" onClick={() => setText(status.data.sample_text)}>{t('ai.useSample')}</Button>}</div>
          <Textarea id="ai-source" rows={8} className="md:min-h-[22rem]" value={text} onChange={(e) => setText(e.target.value)} disabled={!!d} placeholder={t('ai.placeholder')} />
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
      footer={<><span className="mr-auto text-sm text-slate-700">{t('orders.selected', { n: sel.length, sum: formatSom(total) })}</span><ModalCancel /><Button variant="primary" disabled={!sel.length} loading={m.isPending} onClick={() => m.mutate()}>{t('orders.submit')}</Button></>}>
      {services.isLoading ? <LoadingRows /> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {groups.map((g) => (
            <fieldset key={g.c}><legend className="mb-1 text-sm font-bold text-slate-800">{t(`service.${g.c}` as MessageKey)}</legend>
              {g.items.map((s) => (
                <label key={s.id} className={cx('flex min-h-10 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-[0.9375rem] hover:bg-slate-50', taken.has(s.name) && 'cursor-not-allowed opacity-60')}>
                  <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" disabled={taken.has(s.name)} checked={sel.includes(s.id)} onChange={(e) => setSel((x) => e.target.checked ? [...x, s.id] : x.filter((i) => i !== s.id))} />
                  <span className="min-w-0 flex-1">{s.name}{taken.has(s.name) && <span className="text-[0.8125rem] text-slate-600"> {t('orders.taken')}</span>}</span><span className="shrink-0 whitespace-nowrap tabular-nums text-[0.8125rem] text-slate-600">{formatSom(s.price, false)}</span>
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
  const notes = (h.data?.notes ?? []).filter((n: any) => n.encounter_id !== currentEncounter);
  const head = (text: string) => <h3 className="mb-2 text-[0.8125rem] font-bold uppercase tracking-wide text-slate-600">{text}</h3>;
  const none = <p className="text-sm text-slate-600">{t('common.none')}</p>;
  return (
    <Card padded={false} title={t('history.title')}>
      {h.isLoading ? <LoadingRows rows={4} /> : h.isError ? <ErrorState error={h.error} onRetry={() => h.refetch()} /> : (
        <div className="space-y-5 p-4">
          <section>
            {head(t('history.visits'))}
            {!notes.length ? <p className="text-sm text-slate-600">{t('history.noVisits')}</p> : (
              <ul className="space-y-2">{notes.map((n: any) => (
                <li key={n.encounter_id}>
                  <button aria-expanded={open === n.encounter_id} onClick={() => setOpen(open === n.encounter_id ? null : n.encounter_id)} className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">
                    <span className="flex justify-between gap-2 text-[0.8125rem]"><b className="text-slate-900">{fmtDate(n.starts_at)}</b><span className="truncate text-slate-600">{n.specialty}</span></span>
                    <span className="block text-sm text-slate-900">{n.diagnosis}</span>
                    {open === n.encounter_id && <span className="mt-1 block space-y-0.5 text-[0.8125rem] text-slate-700"><span className="block">{t('history.complaint', { text: n.complaints })}</span><span className="block">{t('history.advice', { text: n.recommendations })}</span><span className="block text-slate-600">{n.doctor_name}</span></span>}
                  </button>
                </li>
              ))}</ul>
            )}
          </section>
          <section>
            {head(t('history.labs'))}
            {!h.data.labs.length ? none : <ul className="space-y-2">{h.data.labs.map((l: any) => (
              <li key={l.id} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-[0.8125rem]"><b className="truncate text-slate-900">{l.service_name}</b><LabStatus status={l.status} /></div>
                <div className="text-[0.8125rem] text-slate-600">{fmtDate(l.ordered_at)}</div>
                {l.values && <div className="mt-1"><LabValues values={l.values} compact /></div>}
              </li>
            ))}</ul>}
          </section>
          <section>
            {head(t('history.ultrasound'))}
            {!h.data.diagnostics.length ? none : <ul className="space-y-2">{h.data.diagnostics.map((d: any) => (
              <li key={d.id} className="rounded-lg border border-slate-200 px-3 py-2 text-[0.8125rem]">
                <div className="flex items-center justify-between gap-2"><b className="truncate text-slate-900">{d.service_name}</b><NoteStatus status={d.report_status} /></div>
                {d.conclusion && <p className="mt-0.5 text-slate-800">{d.conclusion}</p>}
              </li>
            ))}</ul>}
          </section>
        </div>
      )}
    </Card>
  );
}
