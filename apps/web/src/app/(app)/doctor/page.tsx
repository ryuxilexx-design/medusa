'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, Eye, FlaskConical, PlayCircle, Printer, Save, ShieldAlert, Sparkles, Stethoscope } from 'lucide-react';
import { ALLERGY_LABEL, REQUIRED_FOR_SIGN, SERVICE_CATEGORY_LABEL } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { ageFrom, fmtDate, fmtDateTime, fmtTime, formatSom, fullName, longDate, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useUnsavedGuard } from '@/lib/unsaved';
import { IntakePanel } from '@/components/intake-panel';
import { IcdPicker, type Icd } from '@/components/icd-picker';
import { NewsCard } from '@/components/news-card';
import { DocumentsCard } from '@/components/documents-card';
import { Alert, Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Skeleton, Textarea, useToast } from '@/components/ui';
import { AppointmentStatus, LabStatus, NoteStatus } from '@/components/status';
import { LabValues } from '@/components/lab-values';

type TextKey = 'complaints' | 'anamnesis' | 'examination' | 'diagnosis' | 'recommendations' | 'follow_up_date' | 'bp_sys' | 'bp_dia' | 'pulse' | 'temp';
type NoteForm = Record<TextKey, string> & { icd10: Icd[] };
const FIELDS: { key: TextKey; label: string; rows: number; required?: boolean }[] = [
  { key: 'complaints', label: 'Shikoyatlar', rows: 3, required: true },
  { key: 'anamnesis', label: 'Anamnez', rows: 3 },
  { key: 'examination', label: 'Ko‘rik', rows: 3, required: true },
  { key: 'diagnosis', label: 'Tashxis / xulosa', rows: 2, required: true },
  { key: 'recommendations', label: 'Tavsiyalar', rows: 3, required: true },
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[250px_1fr] xl:grid-cols-[250px_1fr_290px]">
      <Card padded={false} className="self-start lg:sticky lg:top-[72px]" title="Bugungi bemorlar">
        {day.isLoading ? <LoadingRows rows={5} /> : day.isError ? <ErrorState error={day.error} onRetry={() => day.refetch()} /> : !sorted.length ? <EmptyState title="Bugun qabul yo‘q" /> : (
          <ul className="max-h-[calc(100vh-150px)] divide-y divide-slate-100 overflow-y-auto">
            {sorted.map((a) => (
              <li key={a.id}>
                <Link href={`/doctor?appointment=${a.id}`} className={cx('block px-3 py-2 hover:bg-slate-50', a.id === selectedId && 'bg-brand-50 hover:bg-brand-50')} aria-current={a.id === selectedId ? 'true' : undefined}>
                  <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold tabular-nums">{fmtTime(a.starts_at)}</span>{a.queue_number && <span className="text-2xs text-slate-500">№{a.queue_number}</span>}<AppointmentStatus status={a.status} /></div>
                  <div className="truncate text-sm font-medium text-slate-800">{fullName(a)}</div>
                  <div className="truncate text-xs text-slate-500">{a.service_name}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {!selectedId ? <Card><EmptyState icon={<Stethoscope className="h-8 w-8" />} title="Bemorni tanlang" /></Card>
        : !appt ? (single.isError ? <Card><ErrorState error={single.error} /></Card> : <Card><LoadingRows /></Card>)
        : <Workspace key={appt.id} appt={appt} />}
      <div className="hidden space-y-4 xl:block"><NewsCard />{appt && <HistoryPanel patientId={appt.patient_id} currentEncounter={appt.encounter_id} />}</div>
      <div className="lg:col-span-2 xl:hidden"><NewsCard /></div>
    </div>
  );
}

function Workspace({ appt }: { appt: any }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const start = useMutation({
    mutationFn: () => api(`/appointments/${appt.id}/start`, { method: 'POST' }),
    onSuccess: () => { ['appointments', 'queue', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success('Qabul boshlandi'); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['appointments'] }); },
  });
  const patient = useQuery({ queryKey: ['patient', appt.patient_id], queryFn: () => api(`/patients/${appt.patient_id}`).then((r) => r.data) });

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold">{fullName(appt, true)}</h1><span className="text-sm text-slate-500">{pid(appt.patient_number)}</span><AppointmentStatus status={appt.status} /></div>
        <div className="mt-0.5 text-sm text-slate-600">{fmtDate(appt.birth_date)} · {ageFrom(appt.birth_date, me.today)} · {appt.service_name} · {fmtTime(appt.starts_at)} · {appt.room_name ?? appt.branch_name}</div>
        {patient.data && (
          <div className={cx('mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px]', patient.data.allergy_state === 'known' ? 'bg-red-50 font-medium text-red-800' : patient.data.allergy_state === 'denied' ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-800')}>
            <ShieldAlert className="h-3.5 w-3.5" />Allergiya: {ALLERGY_LABEL[patient.data.allergy_state]}{patient.data.allergy_note ? ` — ${patient.data.allergy_note}` : ''}
            <Link href={`/patients/${appt.patient_id}`} className="ml-1 text-xs font-normal text-brand-700 hover:underline">profil</Link>
          </div>
        )}
      </div>
      {appt.status === 'arrived' && <Button variant="primary" icon={<PlayCircle className="h-4 w-4" />} loading={start.isPending} onClick={() => start.mutate()}>Qabulni boshlash</Button>}
    </div>
  );

  const intake = <IntakePanel appointmentId={appt.id} />;
  if (appt.status === 'scheduled') return <div className="space-y-4">{header}{intake}<Card><EmptyState title="Bemor hali kelmagan" text="Registratura «Keldi» belgilagach, qabulni boshlash mumkin bo‘ladi." /></Card></div>;
  if (appt.status === 'no_show' || appt.status === 'cancelled') return <div className="space-y-4">{header}<Card><EmptyState title="Bu qabul bo‘lib o‘tmadi" /></Card></div>;
  if (appt.status === 'arrived') return <div className="space-y-4">{header}{intake}<Card><EmptyState icon={<PlayCircle className="h-8 w-8" />} title="Bemor navbatda kutmoqda" text={`Navbat №${appt.queue_number ?? '—'}. «Qabulni boshlash» qabul yozuvini ochadi: bemor, sana, shifokor va xizmat avtomatik olinadi.`} /></Card>
    <div className="xl:hidden"><HistoryPanel patientId={appt.patient_id} /></div></div>;
  if (!appt.encounter_id) return <div className="space-y-4">{header}<Card><LoadingRows /></Card></div>;
  return <div className="space-y-4">{header}<Encounter encounterId={appt.encounter_id} appointmentId={appt.id} /><div className="xl:hidden"><HistoryPanel patientId={appt.patient_id} currentEncounter={appt.encounter_id} /></div></div>;
}

function Encounter({ encounterId, appointmentId }: { encounterId: string; appointmentId: string }) {
  const { me } = useSession();
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
    onSuccess: ({ r, snapshot }: any) => { setVersion(r.data.version); setSavedAt(r.data.saved_at); setBase(snapshot); lastAttempt.current = null; setSaveError(null); setErrors({}); toast.success(`Qoralama saqlandi (${fmtTime(r.data.saved_at)})`); },
    onError: (e) => { setSaveError(`Saqlanmadi: ${(e as Error).message} Matningiz formada qoldi — aloqa tiklangach «Qoralamani saqlash» ni qayta bosing.`); if (e instanceof ApiError && e.fields) setErrors(mapFields(e.fields)); },
  });
  const sign = useMutation({
    mutationFn: () => api(`/encounters/${encounterId}/sign`, { method: 'POST', body: toBody(form!, version) }),
    onSuccess: () => {
      setConfirmSign(false); setBase(form);
      ['encounter', 'appointments', 'queue', 'patient', 'doctor-history', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success('Qayd tasdiqlandi, qabul yakunlandi');
    },
    onError: async (e) => {
      setConfirmSign(false);
      // A sign whose response was lost: the retry hits IMMUTABLE. Reload and show the real (signed) state instead of a false error.
      if (e instanceof ApiError && e.code === 'IMMUTABLE') {
        const fresh = await enc.refetch();
        if (fresh.data?.note.status === 'signed') { setBase(form); ['appointments', 'queue', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); setSaveError(null); toast.info('Qayd allaqachon tasdiqlangan (oldingi so‘rov serverga yetib borgan).'); return; }
      }
      setSaveError(`Tasdiqlanmadi: ${(e as Error).message} Matningiz formada qoldi.`); if (e instanceof ApiError && e.fields) setErrors(mapFields(e.fields));
    },
  });

  if (enc.isLoading || !form) return <Card><LoadingRows rows={8} /></Card>;
  if (enc.isError) return <Card><ErrorState error={enc.error} onRetry={() => enc.refetch()} /></Card>;
  const signed = enc.data.note.status === 'signed';
  const set = (k: TextKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setForm((f) => ({ ...f!, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: '' })); };
  function trySign() {
    const e: Record<string, string> = {};
    for (const k of REQUIRED_FOR_SIGN) if (!form![k].trim()) e[k] = 'Tasdiqlash uchun to‘ldiring';
    setErrors(e);
    if (Object.keys(e).length) { setSaveError('Tasdiqlash uchun shikoyat, ko‘rik, tashxis/xulosa va tavsiyalar to‘ldirilishi kerak (demo forma qoidasi).'); return; }
    setConfirmSign(true);
  }
  const aiDisabledReason = me.ai_mode === 'off' ? 'AI o‘chirilgan yoki kalit sozlanmagan' : null;

  return (
    <>
      <Card padded={false} title={<span className="flex items-center gap-2 whitespace-nowrap">Klinik qayd <NoteStatus status={enc.data.note.status} /></span>}
        actions={<span className={cx('text-right text-xs', dirty && !signed ? 'font-medium text-amber-700' : 'text-slate-500')}>{signed ? `Tasdiqladi: ${enc.data.note.signed_by_name}, ${fmtDateTime(enc.data.note.signed_at)}` : dirty ? 'Saqlanmagan o‘zgarishlar bor' : savedAt ? `Qoralama saqlangan: ${fmtTime(savedAt)}` : 'Hali saqlanmagan'}</span>}>
        <div className="space-y-3 p-4">
          {saveError && <Alert tone="red">{saveError}</Alert>}
          {signed && <Alert tone="blue">Tasdiqlangan qayd o‘zgartirilmaydi. Tuzatish (alohida versiya) keyingi relizda.</Alert>}
          <IntakePanel appointmentId={appointmentId} onUseComplaints={signed ? undefined : (text) => {
            setForm((f) => ({ ...f!, complaints: f!.complaints.trim() ? `${f!.complaints.trim()}\n${text}` : text }));
            setErrors((x) => ({ ...x, complaints: '' }));
            toast.info('Bemor yozgan shikoyat qoralamaga qo‘shildi — tekshirib, saqlang');
          }} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Field label="Sistolik bosim (mm sim. ust.)" error={errors.bp_sys}>{(id) => <Input id={id} inputMode="numeric" value={form.bp_sys} onChange={set('bp_sys')} disabled={signed} placeholder="—" />}</Field>
            <Field label="Diastolik (mm sim. ust.)" error={errors.bp_dia}>{(id) => <Input id={id} inputMode="numeric" value={form.bp_dia} onChange={set('bp_dia')} disabled={signed} placeholder="—" />}</Field>
            <Field label="Puls (urish/daq.)" error={errors.pulse}>{(id) => <Input id={id} inputMode="numeric" value={form.pulse} onChange={set('pulse')} disabled={signed} placeholder="—" />}</Field>
            <Field label="Harorat (°C)" error={errors.temp}>{(id) => <Input id={id} inputMode="decimal" value={form.temp} onChange={set('temp')} disabled={signed} placeholder="—" />}</Field>
            <Field label="Qayta qabul sanasi" error={errors.follow_up_date}>{(id) => <Input id={id} type="date" min={me.today} value={form.follow_up_date} onChange={set('follow_up_date')} disabled={signed} />}</Field>
          </div>
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-2">
              <Field label={f.label} required={f.required} error={errors[f.key]}>
                {(id) => <Textarea id={id} rows={f.rows} value={form[f.key]} onChange={set(f.key)} disabled={signed} invalid={!!errors[f.key]} placeholder={signed ? '' : 'Kiritilmagan'} />}
              </Field>
              {f.key === 'diagnosis' && (
                <IcdPicker value={form.icd10} diagnosis={form.diagnosis} encounterId={encounterId} disabled={signed}
                  onChange={(icd10) => { setForm((x) => ({ ...x!, icd10 })); setErrors((x) => ({ ...x, icd10: '' })); }} />
              )}
              {f.key === 'diagnosis' && errors.icd10 && <p className="text-xs text-red-600" role="alert">{errors.icd10}</p>}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
          {!signed && <>
            <Button icon={<Save className="h-4 w-4" />} loading={saveDraft.isPending} disabled={!dirty} onClick={() => saveDraft.mutate()}>Qoralamani saqlash</Button>
            <Button icon={<Sparkles className="h-4 w-4" />} disabled={!!aiDisabledReason} title={aiDisabledReason ?? 'Erkin matnni bo‘limlarga ajratish (loyiha)'} onClick={() => setAiOpen(true)}>AI bilan tartiblash</Button>
            <Button icon={<FlaskConical className="h-4 w-4" />} onClick={() => setOrderOpen(true)}>Tekshiruv buyurish</Button>
          </>}
          <Button icon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>Ko‘rib chiqish</Button>
          <Link href={`/print/note/${encounterId}`} target="_blank" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"><Printer className="h-4 w-4" />Chop etish</Link>
          {!signed && <Button variant="success" className="ml-auto" icon={<ClipboardCheck className="h-4 w-4" />} loading={sign.isPending} onClick={trySign}>Tasdiqlash va yakunlash</Button>}
          {aiDisabledReason && !signed && <span className="w-full text-xs text-slate-500">AI: {aiDisabledReason}.</span>}
        </div>
      </Card>

      <Card title="Buyurtmalar va natijalar" actions={!signed && <Button size="sm" icon={<FlaskConical className="h-3.5 w-3.5" />} onClick={() => setOrderOpen(true)}>Tekshiruv buyurish</Button>}>
        {!enc.data.orders.length ? <p className="text-sm text-slate-500">Bu qabulda tekshiruv buyurilmagan.</p> : (
          <ul className="space-y-3">
            {enc.data.orders.map((o: any) => (
              <li key={o.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm"><b>{o.service_name}</b><Badge>{SERVICE_CATEGORY_LABEL[o.category]}</Badge><span className="text-slate-500">{fmtTime(o.ordered_at)} · {formatSom(o.price_snapshot)}</span>
                  <span className="ml-auto">{o.category === 'ultrasound' ? <NoteStatus status={o.report_status} /> : <LabStatus status={o.status} />}</span></div>
                {o.category === 'lab' && o.status === 'verified' && o.values && <div className="mt-2"><LabValues values={o.values} compact /><p className="mt-1 text-xs text-slate-500">Tasdiqladi: {o.verified_by_name}, {fmtDateTime(o.verified_at)}. Natija o‘zi tashxis emas.</p></div>}
                {o.category === 'lab' && o.status !== 'verified' && <p className="mt-1 text-xs text-slate-500">Natija laboratoriyada tasdiqlangach shu yerda ko‘rinadi.</p>}
                {o.category === 'ultrasound' && o.report_status === 'signed' && <p className="mt-1 text-sm"><span className="text-slate-500">Xulosa:</span> {o.conclusion}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DocumentsCard encounterId={encounterId} note={{ diagnosis: form.diagnosis, icd10: form.icd10, signed }} />

      <AiModal open={aiOpen} encounterId={encounterId} onClose={() => setAiOpen(false)} onApply={(d) => { setForm((f) => ({ ...f!, ...d })); toast.info('AI loyihasi formaga qo‘llandi. Tekshirib, qoralamani saqlang.'); }} />
      <OrderModal open={orderOpen} onClose={() => setOrderOpen(false)} encounterId={encounterId} existing={enc.data.orders} />
      <Modal open={preview} onClose={() => setPreview(false)} width="max-w-2xl" title="Qaydni ko‘rib chiqish" footer={<Button onClick={() => setPreview(false)}>Yopish</Button>}>
        <NotePreview form={form} patient={enc.data.patient} appt={enc.data.appointment} status={enc.data.note.status} />
      </Modal>
      <Modal open={confirmSign} onClose={() => setConfirmSign(false)} title="Qaydni tasdiqlash va qabulni yakunlash"
        footer={<><Button onClick={() => setConfirmSign(false)}>Ortga</Button><Button variant="success" loading={sign.isPending} icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => sign.mutate()}>Tasdiqlash</Button></>}>
        <p className="text-sm text-slate-700">Tasdiqlangandan keyin qayd oddiy tahrirlanmaydi va qabul «Yakunlangan» holatiga o‘tadi. Buyurilgan tekshiruvlar alohida holatda davom etadi.</p>
        <p className="mt-2 text-xs text-slate-500">«Tasdiqlangan» holati huquqiy elektron raqamli imzo emas.</p>
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
  const row = (k: string, v: string) => <div className="py-1.5"><div className="text-xs font-semibold uppercase text-slate-500">{k}</div><div className="whitespace-pre-wrap text-sm">{v.trim() || <span className="text-slate-400">Kiritilmagan</span>}</div></div>;
  const vit = [form.bp_sys && form.bp_dia ? `AQB ${form.bp_sys}/${form.bp_dia} mm sim. ust.` : '', form.pulse ? `puls ${form.pulse} urish/daq.` : '', form.temp ? `harorat ${form.temp} °C` : ''].filter(Boolean).join(', ');
  return (
    <div>
      {status !== 'signed' && <div className="mb-2 inline-block rounded border-2 border-amber-400 px-2 py-0.5 text-sm font-bold uppercase text-amber-700">Qoralama</div>}
      <p className="text-sm"><b>{fullName(patient, true)}</b> {pid(patient.patient_number)} · {fmtDate(patient.birth_date)} · {appt.service_name} · {appt.doctor_name}</p>
      <div className="mt-2 divide-y divide-slate-100">
        {vit && row('Ko‘rsatkichlar', vit)}
        {FIELDS.map((f) => <div key={f.key}>{row(f.label, form[f.key])}{f.key === 'diagnosis' && form.icd10.length > 0 && row('MKB-10', form.icd10.map((x) => `${x.code} — ${x.title}`).join('\n'))}</div>)}
        {form.follow_up_date && row('Qayta qabul', fmtDate(form.follow_up_date))}
      </div>
    </div>
  );
}

function AiModal({ open, onClose, onApply, encounterId }: { open: boolean; onClose: () => void; onApply: (d: Partial<NoteForm>) => void; encounterId: string }) {
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api('/ai/status').then((r) => r.data), enabled: open });
  const [text, setText] = useState('');
  const run = useMutation({ mutationFn: () => api('/ai/note-draft', { method: 'POST', body: { text, encounter_id: encounterId } }).then((r) => r.data) });
  useEffect(() => { if (!open) { run.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = run.data?.draft;
  const label = run.data?.mode === 'sample' ? 'Namunaviy AI natijasi — haqiqiy model chaqirilmagan' : 'AI loyihasi — shifokor tekshirishi kerak';
  return (
    <Modal open={open} onClose={onClose} width="max-w-5xl" dirty={!!text && !d} title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand-600" />AI bilan tartiblash {status.data?.mode === 'sample' && <Badge tone="yellow">Namunaviy rejim</Badge>}{status.data?.mode === 'live' && <Badge tone="teal">Jonli AI</Badge>}</span>}
      footer={d ? <><Button onClick={onClose}>Bekor qilish</Button><Button variant="primary" onClick={() => { onApply(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === 'Kiritilmagan' ? '' : v])) as Partial<NoteForm>); onClose(); }}>Loyihani formaga qo‘llash</Button></>
        : <><Button onClick={onClose}>Bekor qilish</Button><Button variant="primary" loading={run.isPending} disabled={text.trim().length < 10} onClick={() => run.mutate()}>Tartiblash</Button></>}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between"><span className="text-[13px] font-medium text-slate-700">Asl matn (shifokor yozgan)</span>
            {status.data?.sample_text && !d && <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setText(status.data.sample_text)}>Demo matnni qo‘yish</button>}</div>
          <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} disabled={!!d} placeholder="Ko‘rik davomida erkin yozilgan matn. Bemorning ismi, telefoni va tug‘ilgan sanasi AI’ga yuborilishidan oldin olib tashlanadi." />
          {status.data?.mode === 'sample' && <p className="mt-1 text-xs text-slate-500">Namunaviy rejimda faqat tayyor demo matni tartiblanadi; boshqa matnga sun’iy javob qaytarilmaydi.</p>}
        </div>
        <div>
          <span className="mb-1 block text-[13px] font-medium text-slate-700">Loyiha</span>
          {run.isPending ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            : run.isError ? <Alert tone="red">{(run.error as Error).message} Formadagi qoralama o‘zgarmadi.</Alert>
            : d ? (
              <div className="space-y-2">
                <Alert tone={run.data.mode === 'sample' ? 'yellow' : 'blue'}>{label}. Yangi tashxis yoki dori qo‘shilmaydi; yo‘q bo‘lim «Kiritilmagan» bo‘lib qoladi. Qo‘llash faqat qoralamani yangilaydi.</Alert>
                {FIELDS.map((f) => <div key={f.key} className="rounded-md border border-slate-200 px-3 py-2"><div className="text-xs font-semibold uppercase text-slate-500">{f.label}</div><div className={cx('whitespace-pre-wrap text-sm', d[f.key] === 'Kiritilmagan' && 'text-slate-400')}>{d[f.key]}</div></div>)}
              </div>
            ) : <p className="rounded-md border border-dashed p-8 text-center text-sm text-slate-500">Matnni kiriting va «Tartiblash» ni bosing.</p>}
        </div>
      </div>
    </Modal>
  );
}

function OrderModal({ open, onClose, encounterId, existing }: { open: boolean; onClose: () => void; encounterId: string; existing: any[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const services = useQuery({ queryKey: ['services'], queryFn: () => api('/services').then((r) => r.data as any[]), enabled: open });
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => { if (open) setSel([]); }, [open]);
  const taken = new Set(existing.filter((o) => o.status !== 'cancelled').map((o) => o.service_name));
  const groups = useMemo(() => ['lab', 'ultrasound', 'procedure'].map((c) => ({ c, items: (services.data ?? []).filter((s) => s.category === c) })), [services.data]);
  const m = useMutation({
    mutationFn: () => api(`/encounters/${encounterId}/orders`, { method: 'POST', body: { service_ids: sel } }),
    onSuccess: () => { ['encounter', 'invoices', 'orders'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(`${sel.length} ta tekshiruv buyurildi va hisobga qo‘shildi`); onClose(); },
    onError: (e) => toast.error(e),
  });
  const total = (services.data ?? []).filter((s) => sel.includes(s.id)).reduce((a, s) => a + s.price, 0);
  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" dirty={sel.length > 0} title="Tekshiruv buyurish"
      footer={<><span className="mr-auto text-sm text-slate-600">Tanlandi: {sel.length} · {formatSom(total)}</span><Button onClick={onClose}>Bekor qilish</Button><Button variant="primary" disabled={!sel.length} loading={m.isPending} onClick={() => m.mutate()}>Buyurtma berish</Button></>}>
      {services.isLoading ? <LoadingRows /> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {groups.map((g) => (
            <fieldset key={g.c}><legend className="mb-1 text-xs font-semibold uppercase text-slate-500">{SERVICE_CATEGORY_LABEL[g.c]}</legend>
              {g.items.map((s) => (
                <label key={s.id} className={cx('flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50', taken.has(s.name) && 'cursor-not-allowed opacity-50')}>
                  <input type="checkbox" className="mt-0.5 accent-brand-600" disabled={taken.has(s.name)} checked={sel.includes(s.id)} onChange={(e) => setSel((x) => e.target.checked ? [...x, s.id] : x.filter((i) => i !== s.id))} />
                  <span className="flex-1">{s.name}{taken.has(s.name) && <span className="text-xs text-slate-500"> (buyurilgan)</span>}</span><span className="tabular-nums text-xs text-slate-500">{formatSom(s.price, false)}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">Narx buyurtma paytida qayd etiladi (snapshot). Buyurtma laboratoriya ro‘yxatiga va bemor hisobiga bir marta tushadi.</p>
    </Modal>
  );
}

function HistoryPanel({ patientId, currentEncounter }: { patientId: string; currentEncounter?: string }) {
  const h = useQuery({ queryKey: ['doctor-history', patientId], queryFn: () => api(`/doctor/patient-history?patient_id=${patientId}`).then((r) => r.data) });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card padded={false} title="Bemor tarixi" className="self-start xl:sticky xl:top-[72px]">
      {h.isLoading ? <LoadingRows rows={4} /> : h.isError ? <ErrorState error={h.error} onRetry={() => h.refetch()} /> : (
        <div className="max-h-[calc(100vh-150px)] space-y-4 overflow-y-auto p-3 text-sm">
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Oldingi qabullar</h3>
            {h.data.notes.filter((n: any) => n.encounter_id !== currentEncounter).length === 0 ? <p className="text-slate-500">Tasdiqlangan oldingi qayd yo‘q</p> :
              h.data.notes.filter((n: any) => n.encounter_id !== currentEncounter).map((n: any) => (
                <button key={n.encounter_id} onClick={() => setOpen(open === n.encounter_id ? null : n.encounter_id)} className="mb-1 block w-full rounded-md border border-slate-200 px-2 py-1.5 text-left hover:bg-slate-50">
                  <div className="flex justify-between text-xs"><b>{fmtDate(n.starts_at)}</b><span className="text-slate-500">{n.specialty}</span></div>
                  <div className="text-[13px]">{n.diagnosis}</div>
                  {open === n.encounter_id && <div className="mt-1 space-y-0.5 text-xs text-slate-600"><p>Shikoyat: {n.complaints}</p><p>Tavsiya: {n.recommendations}</p><p className="text-slate-400">{n.doctor_name}</p></div>}
                </button>
              ))}
            <p className="mt-1 text-2xs text-slate-400">Oldingi matn yangi qaydga avtomatik ko‘chirilmaydi.</p>
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Tahlillar</h3>
            {!h.data.labs.length ? <p className="text-slate-500">Yo‘q</p> : h.data.labs.map((l: any) => (
              <div key={l.id} className="mb-1 rounded-md border border-slate-200 px-2 py-1.5">
                <div className="flex items-center justify-between gap-1 text-xs"><b className="truncate">{l.service_name}</b><LabStatus status={l.status} /></div>
                <div className="text-2xs text-slate-500">{fmtDate(l.ordered_at)}</div>
                {l.values && <div className="mt-1"><LabValues values={l.values} compact /></div>}
              </div>
            ))}
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">UZI</h3>
            {!h.data.diagnostics.length ? <p className="text-slate-500">Yo‘q</p> : h.data.diagnostics.map((d: any) => (
              <div key={d.id} className="mb-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs"><div className="flex justify-between"><b>{d.service_name}</b><NoteStatus status={d.report_status} /></div>{d.conclusion && <p className="mt-0.5">{d.conclusion}</p>}</div>
            ))}
          </section>
        </div>
      )}
    </Card>
  );
}
