'use client';
import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CheckCircle2, Clock, Eye, FilePlus2, FlaskConical, LayoutTemplate, PlayCircle, Printer, Save, ShieldAlert, Sparkles, Stethoscope } from 'lucide-react';
import { REQUIRED_FOR_SIGN, type MessageKey, type NoteTextField } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { ageFrom, fmtDate, fmtDateTime, fmtTime, formatSom, fullName, longDate, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useUnsavedGuard } from '@/lib/unsaved';
import { useT } from '@/lib/i18n';
import { IntakePanel } from '@/components/intake-panel';
import { IcdPicker, type Icd } from '@/components/icd-picker';
import { NewsCard } from '@/components/news-card';
import { DocumentsCard } from '@/components/documents-card';
import { PatientSummaryCard } from '@/components/patient-summary';
import { EncounterMaterials } from '@/components/warehouse/encounter-materials';
import { AllergiesPanel } from '@/components/allergies';
import { Alert, Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, LinkButton, LoadingRows, Modal, ModalCancel, Select, Skeleton, Textarea, Toolbar, useToast } from '@/components/ui';
import { AppointmentStatus, LabStatus, NoteStatus } from '@/components/status';
import { LabValues } from '@/components/lab-values';
import { applyFields, type Choice, FieldApplyList } from '@/components/apply-fields';
import { QuickPhrases, SaveTemplateModal, TemplateModal, useFieldDefs } from '@/components/note-templates';
import { BookingModal } from '@/components/booking';
import { DictationBar, type DictResult, MicButton, useDictation } from '@/components/dictation';

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
        : !appt ? (single.isError || day.isError ? <Card><ErrorState error={single.isError ? single.error : day.error} onRetry={() => (single.isError ? single.refetch() : day.refetch())} /></Card> : <Card><LoadingRows /></Card>)
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
    <section className="overflow-hidden surface">
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
  const [addendumOpen, setAddendumOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  // the patient's own intake answers (same query as the intake panel): the allergy line is repeated inside the prescription form
  const intake = useQuery({ queryKey: ['intake', appointmentId], queryFn: () => api<{ data: { allergies: string | null } | null }>(`/appointments/${appointmentId}/intake`).then((r) => r.data), retry: false });

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

  // ---- dictation: a field's text goes in at the cursor (or under the text); the whole note opens the apply dialog ----
  const dictOn = me.dictation_mode !== 'off';
  const [dictResult, setDictResult] = useState<DictResult | null>(null);
  /** where the cursor was when a field lost focus, and whether focus went straight to that field's microphone */
  const lastSel = useRef<{ key: TextKey; start: number; end: number; toMic: boolean } | null>(null);
  const insertAt = useRef<{ key: TextKey; start: number; end: number } | null>(null);
  const rememberCursor = (k: TextKey) => {
    const el = fieldRefs.current[k];
    const sel = el && document.activeElement === el ? { start: el.selectionStart, end: el.selectionEnd }
      : lastSel.current?.key === k && lastSel.current.toMic ? lastSel.current : null;
    insertAt.current = sel ? { key: k, start: sel.start, end: sel.end } : null;
  };
  const insertDictated = (k: TextKey, text: string) => {
    const at = insertAt.current?.key === k ? insertAt.current : null;
    insertAt.current = null;
    setForm((f) => {
      const v = f![k];
      let next: string;
      if (at && v.trim()) {
        const before = v.slice(0, Math.min(at.start, v.length)), after = v.slice(Math.min(at.end, v.length));
        next = `${before}${before && !/\s$/.test(before) ? ' ' : ''}${text}${after && !/^\s/.test(after) ? ' ' : ''}${after}`;
      } else next = v.trim() ? `${v.replace(/\s+$/, '')}\n${text}` : text;
      return { ...f!, [k]: next };
    });
    setErrors((x) => ({ ...x, [k]: '' }));
    toast.info(t('dict.inserted'));
    requestAnimationFrame(() => fieldRefs.current[k]?.focus({ preventScroll: true }));
  };
  const dict = useDictation({ encounterId, structure: me.ai_mode !== 'off', onResult: (r) => (r.field === 'all' ? setDictResult(r) : insertDictated(r.field, r.text)) });

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
      setSaveError(t('note.saveFailed', { msg: sentence((e as Error).message) })); if (e instanceof ApiError && e.fields) setErrors(mapFields(e.fields));
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
      setSaveError(t('note.signFailed', { msg: sentence((e as Error).message) })); if (e instanceof ApiError && e.fields) setErrors(mapFields(e.fields));
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
  const applyDraft = (d: Partial<NoteForm>, done: MessageKey = 'note.aiApplied') => { if (!Object.keys(d).length) { toast.info(t('ai.nothingApplied')); return; } setForm((f) => ({ ...f!, ...d })); setErrors((x) => ({ ...x, ...Object.fromEntries(Object.keys(d).map((k) => [k, ''])) })); toast.info(t(done)); };
  const printLink = <LinkButton size="sm" variant="ghost" target="_blank" href={`/print/note/${encounterId}`} icon={<Printer className="h-4 w-4" />}>{t('common.print')}</LinkButton>;
  // a chip puts its line under the text already in the field (a new line), never over it
  const insertPhrase = (k: NoteTextField) => (text: string) => { setForm((f) => ({ ...f!, [k]: f![k].trim() ? `${f![k].replace(/\s+$/, '')}\n${text}` : text })); setErrors((x) => ({ ...x, [k]: '' })); };
  const textField = (f: (typeof FIELDS)[number]) => (
    <div key={f.key} className="space-y-2">
      <Field label={t(f.label)} required={f.required} error={errors[f.key]}>
        {(id) => <Textarea ref={(el) => { fieldRefs.current[f.key] = el; }} id={id} rows={f.rows} value={form[f.key]} onChange={set(f.key)} invalid={!!errors[f.key]} placeholder={t('common.notEntered')}
          onBlur={(e) => { lastSel.current = { key: f.key, start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd, toMic: (e.relatedTarget as HTMLElement | null)?.dataset?.testid === `dict-${f.key}` }; }} />}
      </Field>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1"><QuickPhrases field={f.key as NoteTextField} value={form[f.key]} textarea={{ current: fieldRefs.current[f.key] ?? null }} onInsert={insertPhrase(f.key as NoteTextField)} /></div>
        {dictOn && <MicButton d={dict} target={f.key as NoteTextField} className="ml-auto" label={t('dict.fieldTitle', { field: t(f.label) })} onBeforeStart={() => rememberCursor(f.key)}>{t('dict.field')}</MicButton>}
      </div>
      <DictationBar d={dict} target={f.key as NoteTextField} />
    </div>
  );
  const vital = (k: 'bp_sys' | 'bp_dia' | 'pulse' | 'temp', cls: string, mode: 'numeric' | 'decimal' = 'numeric') => (
    <Input id={`${bpId}-${k}`} inputMode={mode} className={cls} value={form[k]} onChange={set(k)} invalid={!!errors[k]} placeholder="—" />
  );
  // the server names the field in Uzbek («Sistolik bosim: …»); show the label in the doctor's language instead
  const VITAL_LABEL = { bp_sys: 'note.bpSys', bp_dia: 'note.bpDia', pulse: 'note.pulse', temp: 'note.temp' } as const;
  const vitalErrors = (['bp_sys', 'bp_dia', 'pulse', 'temp'] as const).filter((k) => errors[k]).map((k) => `${t(VITAL_LABEL[k])}: ${errors[k].replace(/^[^:]+:\s*/, '')}`);

  return (
    <div className="space-y-5">
      {mine && <MyText mine={mine} server={form} canPutBack={!signed} onPutBack={() => { setForm(mine); setMine(null); }} onDismiss={() => setMine(null)} />}
      <Card padded={false} title={<span className="flex items-center gap-2 whitespace-nowrap">{t('note.title')} <NoteStatus status={enc.data.note.status} /></span>}
        actions={signed ? <><Button size="sm" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setAddendumOpen(true)}>{t('note.addendum')}</Button>{printLink}</> : undefined}>
        {!signed && (
          <Toolbar actions={<><Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>{t('note.preview')}</Button>{printLink}</>}>
            <Button size="sm" icon={<LayoutTemplate className="h-4 w-4 text-brand-600" />} data-testid="tpl-open" onClick={() => setTplOpen(true)}>{t('tpl.button')}</Button>
            <Button size="sm" icon={<Sparkles className="h-4 w-4 text-brand-600" />} disabled={!!aiDisabledReason} title={aiDisabledReason ?? t('note.aiButtonTitle')} onClick={() => setAiOpen(true)}>{t('note.aiButton')}</Button>
            {FIELDS.some((f) => form[f.key].trim()) && <Button size="sm" variant="ghost" icon={<Save className="h-4 w-4" />} onClick={() => setSaveTplOpen(true)}>{t('tpl.save')}</Button>}
            {dictOn && <MicButton d={dict} target="all" variant="secondary" label={t('dict.wholeNote')}>{t('dict.wholeNote')}</MicButton>}
            {aiDisabledReason && <span className="text-[0.8125rem] text-slate-600">{t('note.aiOffLine', { reason: aiDisabledReason })}</span>}
            {!dictOn && me.dictation_off_reason && <span className="text-[0.8125rem] text-slate-600" data-testid="dict-off">{t('dict.offLine', { reason: me.dictation_off_reason.replace(/\.$/, '') })}</span>}
            {dictOn && dict.micBlocked && <span className="text-[0.8125rem] text-red-700">{t('dict.offLine', { reason: t('dict.micBlocked') })}</span>}
          </Toolbar>
        )}
        <div className="space-y-4 p-5">
          {!signed && <DictationBar d={dict} target="all" />}
          {signed && <p className="text-[0.8125rem] text-slate-600">{t('note.signedBy', { name: enc.data.note.signed_by_name, at: fmtDateTime(enc.data.note.signed_at) })}</p>}
          <IntakePanel appointmentId={appointmentId} recordAllergyFor={enc.data.patient?.id} onUseComplaints={signed ? undefined : (text) => {
            setForm((f) => ({ ...f!, complaints: f!.complaints.trim() ? `${f!.complaints.trim()}\n${text}` : text }));
            setErrors((x) => ({ ...x, complaints: '' }));
            toast.info(t('note.intakeAdded'));
          }} />
          {signed ? <><div className="divide-y divide-slate-100"><NoteRows form={form} /></div>{form.follow_up_date && <FollowUp patient={enc.data.patient} date={form.follow_up_date} />}<Addenda items={enc.data.addenda ?? []} /></> : <>
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
            {vitalErrors.length > 0 && <ul className="space-y-0.5 text-sm font-medium text-red-700" role="alert">{vitalErrors.map((m) => <li key={m}>{m}</li>)}</ul>}
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
                  <span className="min-w-[12rem] flex-1"><span className="text-[0.9375rem] font-semibold text-slate-900">{o.service_name}{o.quantity > 1 && <span className="ml-1 tabular-nums text-slate-700">{t('orders.times', { n: o.quantity })}</span>}</span>
                    <span className="block text-[0.8125rem] text-slate-600">{t(`service.${o.category}` as MessageKey)} · {fmtTime(o.ordered_at)} · {formatSom(o.price_snapshot * (o.quantity ?? 1))}</span></span>
                  {o.category === 'ultrasound' ? <NoteStatus status={o.report_status} /> : <LabStatus status={o.status} />}
                </div>
                {o.category === 'lab' && o.status === 'verified' && o.values && <div className="mt-2"><LabValues values={o.values} compact /><p className="mt-1 text-[0.8125rem] text-slate-600">{t('orders.verifiedBy', { name: o.verified_by_name, at: fmtDateTime(o.verified_at) })}</p></div>}
                {o.category === 'ultrasound' && o.report_status === 'signed' && <p className="mt-1.5 text-[0.9375rem]"><span className="text-slate-600">{t('orders.conclusion')}</span> {o.conclusion}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {signed && <PatientSummaryCard encounterId={encounterId} />}

      <EncounterMaterials encounterId={encounterId} icdDraft={form.icd10.map((x) => x.code)} />

      {enc.data.patient?.id && <Card><AllergiesPanel patientId={enc.data.patient.id} legacyNote={enc.data.patient.allergy_note} /></Card>}

      <DocumentsCard encounterId={encounterId} note={{ diagnosis: form.diagnosis, icd10: form.icd10, signed }}
        allergy={{ state: enc.data.patient?.allergy_state ?? null, note: enc.data.patient?.allergy_note ?? null, intake: intake.data?.allergies ?? null }} />

      {/* the two decisions of the visit, always in reach while the doctor writes, orders and issues documents */}
      {!signed && (
        <div className="surface sticky bottom-[var(--tabbar)] z-10 space-y-2 px-4 py-3 lg:bottom-0" data-testid="note-actions">
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

      <AiModal open={aiOpen} encounterId={encounterId} current={form} onClose={() => setAiOpen(false)} onApply={(d) => applyDraft(d)} />
      <DictationModal result={dictResult} current={form} onClose={() => setDictResult(null)} onApply={applyDraft} />
      <TemplateModal open={tplOpen} onClose={() => setTplOpen(false)} encounterId={encounterId} current={form} existingOrders={enc.data.orders}
        onApply={({ fields, icd10 }) => {
          setForm((f) => ({ ...f!, ...fields, icd10: [...f!.icd10, ...icd10].slice(0, 5) }));
          setErrors((x) => ({ ...x, ...Object.fromEntries(Object.keys(fields).map((k) => [k, ''])), icd10: '' }));
        }} />
      <SaveTemplateModal open={saveTplOpen} onClose={() => setSaveTplOpen(false)} current={form} />
      <AddendumModal open={addendumOpen} encounterId={encounterId} onClose={() => setAddendumOpen(false)} />
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
/** A server message is embedded in a sentence («Saqlanmadi: {msg} …»): make sure it ends with a full stop. */
function sentence(m: string) { const s = m.trim(); return /[.!?…]$/.test(s) ? s : `${s}.`; }
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

type Addendum = { id: string; text: string; reason: string; author_name: string; signed_at: string };
/** Addenda under a signed note: each one signed, dated and never editable — the only way a signed note grows. */
function Addenda({ items }: { items: Addendum[] }) {
  const t = useT();
  if (!items.length) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4" data-testid="note-addenda">
      <h3 className="text-[0.8125rem] font-bold uppercase tracking-wide text-slate-600">{t('note.addendaTitle')}</h3>
      <ol className="mt-2 divide-y divide-slate-200">
        {items.map((a, i) => (
          <li key={a.id} className="py-2.5 first:pt-0 last:pb-0">
            <div className="text-[0.8125rem] font-semibold text-slate-600">{t('note.addendumMeta', { n: i + 1, name: a.author_name, at: fmtDateTime(a.signed_at) })}</div>
            <div className="whitespace-pre-wrap text-[0.9375rem] text-slate-900">{a.text}</div>
            <div className="text-[0.8125rem] text-slate-600">{t('note.addendumReasonLine', { reason: a.reason })}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AddendumModal({ open, encounterId, onClose }: { open: boolean; encounterId: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => { if (open) { setText(''); setReason(''); setErrors({}); setFormError(null); } }, [open]);
  const add = useMutation({
    mutationFn: () => api(`/encounters/${encounterId}/addendum`, { method: 'POST', body: { text, reason } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['encounter', encounterId] }); toast.success(t('note.addendumAdded')); onClose(); },
    onError: (e) => {
      // the typed text stays in the form; field errors beside the fields, anything else above them
      if (e instanceof ApiError && e.fields) { setErrors(e.fields); setFormError(null); } else setFormError((e as Error).message);
    },
  });
  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" dirty={(!!text.trim() || !!reason.trim()) && !add.isPending} title={t('note.addendumTitle')}
      footer={<><ModalCancel /><Button variant="primary" loading={add.isPending} disabled={text.trim().length < 3 || reason.trim().length < 3} onClick={() => { setFormError(null); add.mutate(); }}>{t('note.addendumSave')}</Button></>}>
      <div className="space-y-3">
        {formError && <Alert tone="red">{formError}</Alert>}
        <Field label={t('note.addendumText')} required error={errors.text}>{(id) => <Textarea id={id} data-autofocus rows={5} value={text} invalid={!!errors.text} onChange={(e) => { setText(e.target.value); setErrors((x) => ({ ...x, text: '' })); }} />}</Field>
        <Field label={t('note.addendumReason')} required error={errors.reason}>{(id) => <Input id={id} value={reason} invalid={!!errors.reason} placeholder={t('note.addendumReasonPh')} onChange={(e) => { setReason(e.target.value); setErrors((x) => ({ ...x, reason: '' })); }} />}</Field>
        <p className="text-[0.8125rem] text-slate-600">{t('note.addendumHint')}</p>
      </div>
    </Modal>
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

/**
 * The follow-up the doctor recommended, under the signed note: «book it» opens the normal booking dialog (patient,
 * self, the recommended date, the doctor's «qayta ko‘rik» service) — the server applies the usual rules.
 */
function FollowUp({ patient, date }: { patient: { id: string; last_name: string; first_name: string; patient_number: number }; date: string }) {
  const t = useT();
  const { me } = useSession();
  const [book, setBook] = useState(false);
  const p = useQuery({ queryKey: ['patient', patient.id], queryFn: () => api(`/patients/${patient.id}`).then((r) => r.data) });
  const fu = p.data?.follow_up as { date: string; booked: boolean; starts_at: string | null } | null | undefined;
  const booked = !!fu?.booked && fu.date === date;
  // a stable init: the dialog resets its fields whenever this object changes
  const init = useMemo(() => ({ patient, doctorId: me.doctor_id ?? undefined, date, followUp: true }), [patient, me.doctor_id, date]);
  // no follow-up on the card (e.g. an anonymised patient): nothing to book
  if (p.data && !fu) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3" data-testid="follow-up">
      <span className="min-w-[12rem] flex-1 text-[0.9375rem] text-slate-800">{t('fu.recommended', { date: fmtDate(date) })}</span>
      {booked ? <Badge tone="green" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>{fu?.starts_at ? t('fu.bookedAt', { at: fmtDateTime(fu.starts_at) }) : t('fu.booked')}</Badge>
        : <Button size="sm" variant="primary" icon={<CalendarPlus className="h-4 w-4" />} disabled={p.isLoading} onClick={() => setBook(true)}>{t('fu.book')}</Button>}
      <BookingModal open={book} onClose={() => setBook(false)} init={init} />
    </div>
  );
}

type AiField = (typeof FIELDS)[number]['key'];
const AI_FIELDS = FIELDS.map((f) => f.key);

function AiModal({ open, onClose, onApply, encounterId, current }: { open: boolean; onClose: () => void; onApply: (d: Partial<NoteForm>) => void; encounterId: string; current: NoteForm }) {
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api('/ai/status').then((r) => r.data), enabled: open });
  const t = useT();
  const [text, setText] = useState('');
  const [choice, setChoice] = useState<Partial<Record<AiField, Choice>>>({});
  const fields = useFieldDefs();
  const run = useMutation({ mutationFn: () => api('/ai/note-draft', { method: 'POST', body: { text, encounter_id: encounterId } }).then((r) => r.data) });
  // opening with an empty scratch text: start from what is already in the note, so the doctor never types it twice
  useEffect(() => {
    if (!open) { run.reset(); setChoice({}); return; }
    setText((s) => s.trim() ? s : AI_FIELDS.map((k) => current[k].trim()).filter(Boolean).join('\n\n'));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = run.data?.draft;
  const label = run.data?.mode === 'sample' ? t('ai.sampleLabel') : t('ai.liveLabel');
  // the model answers «Kiritilmagan» for an empty section (its prompt is Uzbek); show it in the doctor's language
  const NOT_ENTERED = 'Kiritilmagan';
  const draftOf = (k: AiField) => (d && d[k] !== NOT_ENTERED ? String(d[k]).trim() : '');
  // what applying does to each field (fill an empty one, leave an identical one, ask about a typed one) is shared with the templates
  const apply = () => { onApply(applyFields(AI_FIELDS, draftOf, current, choice)); onClose(); };
  return (
    <Modal open={open} onClose={onClose} width="max-w-5xl" dirty={!!text && !d} title={<span className="flex flex-wrap items-center gap-2"><Sparkles className="h-5 w-5 shrink-0 text-brand-600" />{t('ai.title')} {status.data?.mode === 'sample' && <Badge tone="yellow">{t('ai.sampleMode')}</Badge>}{status.data?.mode === 'live' && <Badge tone="teal">{t('ai.live')}</Badge>}</span>}
      footer={d ? <><ModalCancel /><Button variant="primary" onClick={apply}>{t('ai.apply')}</Button></>
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
                <FieldApplyList fields={fields} draftOf={draftOf} current={current} choice={choice} onChoice={(k, c) => setChoice((x) => ({ ...x, [k]: c }))} testIdPrefix="ai-choice" />
              </div>
            ) : <p className="rounded-lg border-2 border-dashed border-slate-300 p-8 text-center text-[0.9375rem] text-slate-600">{t('ai.empty')}</p>}
        </div>
      </div>
    </Modal>
  );
}

/**
 * The whole note dictated: the transcript split into the five fields (AI note draft, when AI is on) with the same
 * keep / replace / append choice as the AI and template dialogs; without a draft the doctor puts the text into one field.
 */
function DictationModal({ result, current, onClose, onApply }: { result: DictResult | null; current: NoteForm; onClose: () => void; onApply: (d: Partial<NoteForm>, done?: MessageKey) => void }) {
  const t = useT();
  const fields = useFieldDefs();
  const [choice, setChoice] = useState<Partial<Record<AiField, Choice>>>({});
  const [text, setText] = useState('');
  const [into, setInto] = useState<AiField>('complaints');
  useEffect(() => { setChoice({}); setText(result?.text ?? ''); setInto('complaints'); }, [result]);
  const d = result?.draft?.draft;
  const draftOf = (k: AiField) => (d && d[k] && d[k] !== 'Kiritilmagan' ? String(d[k]).trim() : '');
  const apply = () => {
    if (d) onApply(applyFields(AI_FIELDS, draftOf, current, choice));
    else if (text.trim()) onApply({ [into]: current[into].trim() ? `${current[into].replace(/\s+$/, '')}\n${text.trim()}` : text.trim() }, 'dict.inserted');
    onClose();
  };
  const label = result?.draft?.mode === 'sample' ? t('ai.sampleLabel') : t('ai.liveLabel');
  return (
    <Modal open={!!result} onClose={onClose} width="max-w-3xl" dirty={!!result} title={t('dict.resultTitle')}
      footer={<><ModalCancel /><Button variant="primary" disabled={!d && !text.trim()} onClick={apply} data-testid="dict-apply">{d ? t('ai.apply') : t('dict.add')}</Button></>}>
      <div className="space-y-3">
        <Alert tone={result?.draft?.mode === 'sample' ? 'yellow' : 'blue'}>{d ? t('ai.rules', { label }) : t('dict.review')}</Alert>
        {result?.draft_error && <Alert tone="yellow">{t('dict.noDraft', { msg: result.draft_error.message })}</Alert>}
        {d ? (
          <>
            <FieldApplyList fields={fields} draftOf={draftOf} current={current} choice={choice} onChoice={(k, c) => setChoice((x) => ({ ...x, [k]: c }))} testIdPrefix="dict-choice" />
            <details className="rounded-lg border border-slate-200 px-3 py-2"><summary className="cursor-pointer text-sm font-semibold text-slate-800">{t('dict.transcript')}</summary>
              <p className="mt-1 whitespace-pre-wrap text-[0.9375rem] text-slate-900">{result?.text}</p></details>
          </>
        ) : (
          <>
            <Field label={t('dict.transcript')}>{(id) => <Textarea id={id} data-autofocus rows={6} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
            <Field label={t('dict.putInto')}>{(id) => <Select id={id} className="sm:w-72" value={into} onChange={(e) => setInto(e.target.value as AiField)}>{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>}</Field>
          </>
        )}
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
  // quantity per chosen service: only a procedure can be a course (× 10 injections); a test or a scan has one result
  const [qty, setQty] = useState<Record<string, number>>({});
  useEffect(() => { if (open) { setSel([]); setQty({}); } }, [open]);
  const taken = new Set(existing.filter((o) => o.status !== 'cancelled').map((o) => o.service_name));
  const groups = useMemo(() => ['lab', 'ultrasound', 'procedure'].map((c) => ({ c, items: (services.data ?? []).filter((s) => s.category === c) })), [services.data]);
  const qtyOf = (id: string) => qty[id] ?? 1;
  const m = useMutation({
    mutationFn: () => api(`/encounters/${encounterId}/orders`, { method: 'POST', body: { items: sel.map((id) => ({ service_id: id, quantity: qtyOf(id) })) } }),
    onSuccess: () => { ['encounter', 'invoices', 'orders'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('orders.done', { n: sel.length })); onClose(); },
    onError: (e) => toast.error(e),
  });
  const total = (services.data ?? []).filter((s) => sel.includes(s.id)).reduce((a, s) => a + s.price * qtyOf(s.id), 0);
  const step = (id: string, d: number) => setQty((x) => ({ ...x, [id]: Math.min(50, Math.max(1, (x[id] ?? 1) + d)) }));
  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" dirty={sel.length > 0} title={t('orders.modalTitle')}
      footer={<><span className="mr-auto text-sm text-slate-700">{t('orders.selected', { n: sel.length, sum: formatSom(total) })}</span><ModalCancel /><Button variant="primary" disabled={!sel.length} loading={m.isPending} onClick={() => m.mutate()}>{t('orders.submit')}</Button></>}>
      {services.isLoading ? <LoadingRows /> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {groups.map((g) => (
            <fieldset key={g.c}><legend className="mb-1 text-sm font-bold text-slate-800">{t(`service.${g.c}` as MessageKey)}</legend>
              {g.items.map((s) => {
                const on = sel.includes(s.id);
                return (
                  <div key={s.id} className={cx('rounded-lg px-2 py-1.5 hover:bg-slate-50', taken.has(s.name) && 'opacity-60')}>
                    <label className={cx('flex min-h-10 cursor-pointer items-start gap-2.5 text-[0.9375rem]', taken.has(s.name) && 'cursor-not-allowed')}>
                      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" disabled={taken.has(s.name)} checked={on} onChange={(e) => setSel((x) => e.target.checked ? [...x, s.id] : x.filter((i) => i !== s.id))} />
                      <span className="min-w-0 flex-1">{s.name}{taken.has(s.name) && <span className="text-[0.8125rem] text-slate-600"> {t('orders.taken')}</span>}</span><span className="shrink-0 whitespace-nowrap tabular-nums text-[0.8125rem] text-slate-600">{formatSom(s.price, false)}</span>
                    </label>
                    {on && g.c === 'procedure' && (
                      <div className="ml-7 mt-1 flex items-center gap-2" role="group" aria-label={t('orders.qty')}>
                        <Button type="button" size="sm" aria-label={t('orders.qtyLess')} disabled={qtyOf(s.id) <= 1} onClick={() => step(s.id, -1)}>−</Button>
                        <span className="min-w-[3.5rem] text-center text-[0.9375rem] font-semibold tabular-nums">{t('orders.times', { n: qtyOf(s.id) })}</span>
                        <Button type="button" size="sm" aria-label={t('orders.qtyMore')} disabled={qtyOf(s.id) >= 50} onClick={() => step(s.id, 1)}>+</Button>
                        {qtyOf(s.id) > 1 && <span className="text-[0.8125rem] tabular-nums text-slate-600">= {formatSom(s.price * qtyOf(s.id), false)}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
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
