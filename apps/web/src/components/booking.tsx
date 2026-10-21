'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, newIdempotencyKey, qs } from '@/lib/api';
import { fmtDate, formatSom, fullName, localDate, fmtTime, pid, longDate } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Alert, Button, cx, Field, Input, Modal, ModalCancel, Select, Skeleton, Textarea, useToast } from './ui';
import { PatientFormModal } from './patient-form';
import { useT } from '@/lib/i18n';

export type BookingInit = { patient?: { id: string; last_name: string; first_name: string; patient_number: number }; doctorId?: string; date?: string; time?: string };

/** «Qabulga yozish» and reschedule. Availability comes from the server; the server re-checks everything on save. */
export function BookingModal({ open, onClose, init, reschedule }: { open: boolean; onClose: () => void; init?: BookingInit; reschedule?: any }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const [patient, setPatient] = useState<BookingInit['patient'] | null>(null);
  const [search, setSearch] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(me.today);
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [newPatient, setNewPatient] = useState(false);
  // one key per booking dialog: a retry after a lost response returns the same appointment instead of a 409
  const requestKey = useRef(newIdempotencyKey());
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    requestKey.current = newIdempotencyKey();
    if (reschedule) {
      setPatient({ id: reschedule.patient_id, last_name: reschedule.last_name, first_name: reschedule.first_name, patient_number: reschedule.patient_number });
      setDoctorId(reschedule.doctor_id); setServiceId(reschedule.service_id); setDate(localDate(reschedule.starts_at)); setTime('');
      setDuration(Math.round((+new Date(reschedule.ends_at) - +new Date(reschedule.starts_at)) / 60000)); setNote(reschedule.note ?? '');
    } else {
      setPatient(init?.patient ?? null); setDoctorId(init?.doctorId ?? ''); setServiceId(''); setDate(init?.date ?? me.today); setTime(init?.time ?? ''); setDuration(''); setNote('');
    }
    setSearch(''); setErrors({}); setFormError(null);
  }, [open, init, reschedule, me.today]);

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api('/doctors').then((r) => r.data as any[]), enabled: open });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api('/services').then((r) => r.data as any[]), enabled: open });
  const doctor = doctors.data?.find((d) => d.id === doctorId);
  const doctorServices = useMemo(() => (services.data ?? []).filter((s) => doctor?.service_ids?.includes(s.id)), [services.data, doctor]);
  useEffect(() => {
    if (!doctor || reschedule) return;
    if (!doctorServices.some((s) => s.id === serviceId)) setServiceId(doctorServices.find((s) => s.category === 'consultation')?.id ?? doctorServices[0]?.id ?? '');
  }, [doctor, doctorServices, serviceId, reschedule]);
  const service = services.data?.find((s) => s.id === serviceId);
  const effDuration = duration === '' ? service?.duration_min : duration;

  const avail = useQuery({
    queryKey: ['availability', doctorId, date, serviceId, effDuration, reschedule?.id],
    queryFn: () => api(`/availability${qs({ doctor_id: doctorId, date, service_id: serviceId, duration_min: duration || undefined, exclude_appointment_id: reschedule?.id })}`).then((r) => r.data),
    enabled: open && !!doctorId && !!date,
  });

  const clearError = (k: string) => setErrors((x) => (x[k] ? { ...x, [k]: '' } : x));
  const pickPatient = (p: BookingInit['patient'] | null) => { setPatient(p); if (p) clearError('patient_id'); };
  // the service is also filled automatically when a doctor is picked: a filled field never keeps its «choose» error
  useEffect(() => { if (serviceId) setErrors((x) => (x.service_id ? { ...x, service_id: '' } : x)); }, [serviceId]);
  const dq = useDebounced(search, 300);
  const found = useQuery({ queryKey: ['patients', 'pick', dq], queryFn: () => api(`/patients${qs({ search: dq, page_size: 6 })}`).then((r) => r.data as any[]), enabled: open && !patient && dq.trim().length >= 2 });

  const save = useMutation({
    mutationFn: () => reschedule
      ? api(`/appointments/${reschedule.id}`, { method: 'PATCH', body: { version: reschedule.version, doctor_id: doctorId, service_id: serviceId, date, start_time: time, duration_min: duration || undefined, note: note || null } })
      : api('/appointments', { method: 'POST', headers: { 'Idempotency-Key': requestKey.current }, body: { patient_id: patient!.id, branch_id: avail.data?.branch_id, doctor_id: doctorId, service_id: serviceId, date, start_time: time, duration_min: duration || undefined, note: note || null } }),
    onSuccess: () => {
      ['appointments', 'queue', 'patient', 'patients', 'availability', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(reschedule ? t('registrar.bk.rescheduled') : t('registrar.bk.booked', { date: fmtDate(date), time, doctor: doctor?.display_name }));
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      if (e instanceof ApiError && (e.code === 'SLOT_TAKEN' || e.code === 'STALE_STATE')) { setTime(''); avail.refetch(); }
      setFormError(e instanceof Error ? e.message : t('registrar.notSaved'));
    },
  });

  function submit() {
    const e: Record<string, string> = {};
    if (!patient) e.patient_id = t('registrar.bk.pickPatient');
    if (!doctorId) e.doctor_id = t('registrar.bk.pickDoctor');
    if (!serviceId) e.service_id = t('registrar.bk.pickService');
    if (!time) e.start_time = t('registrar.bk.pickSlot');
    setErrors(e); setFormError(null);
    if (!Object.keys(e).length) { if (!save.isPending) save.mutate(); return; }
    // the first field with an error gets the focus: the patient search, a select, or the slot grid
    setTimeout(() => panel.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-testid="slot-error"] ~ * button:not([disabled]), [data-testid="slot-error"] ~ p')?.focus(), 30);
  }

  const dirty = !!(time || note || (!init?.patient && patient));
  const canEditDuration = me.role === 'manager' || me.role === 'registrar';
  return (
    <>
      <Modal open={open && !newPatient} onClose={onClose} dirty={dirty && !save.isSuccess} width="max-w-3xl" title={reschedule ? t('registrar.bk.rescheduleTitle') : t('registrar.book')}
        footer={<><ModalCancel /><Button variant="primary" loading={save.isPending} onClick={submit}>{reschedule ? t('registrar.bk.saveReschedule') : t('registrar.book')}</Button></>}>
        <div ref={panel} className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="space-y-3 md:col-span-2">
            {formError && <Alert tone="red">{formError}</Alert>}
            <Field label={t('registrar.patient')} required error={errors.patient_id}>{(id) => patient ? (
              <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border-2 border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-[0.9375rem]">
                <span className="min-w-0 [overflow-wrap:anywhere]"><b>{fullName(patient)}</b> <span className="text-slate-600">{pid(patient.patient_number)}</span></span>
                {!reschedule && !init?.patient && <Button size="sm" variant="ghost" onClick={() => pickPatient(null)}>{t('registrar.change')}</Button>}
              </div>
            ) : (
              <div>
                <Input id={id} value={search} invalid={!!errors.patient_id} onChange={(e) => setSearch(e.target.value)} placeholder={t('registrar.bk.patientSearch')} autoComplete="off" />
                <div className="mt-1 overflow-hidden rounded-lg border border-slate-200">
                  {dq.trim().length < 2 ? <p className="px-3 py-2 text-[0.8125rem] text-slate-600">{t('registrar.bk.min2')}</p>
                    : found.isLoading ? <Skeleton className="m-2 h-6" />
                    : found.data?.length ? found.data.map((p) => (
                      <button key={p.id} type="button" onClick={() => pickPatient(p)} className="block min-h-9 w-full px-3 py-1.5 text-left text-sm [overflow-wrap:anywhere] hover:bg-brand-50 focus-visible:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300">
                        <b>{fullName(p)}</b> <span className="text-slate-600">{pid(p.patient_number)}, {fmtDate(p.birth_date)}</span>
                      </button>
                    )) : <p className="px-3 py-2 text-[0.8125rem] text-slate-600">{t('registrar.patientNotFound')}</p>}
                  <button type="button" onClick={() => setNewPatient(true)} className="block min-h-9 w-full border-t border-slate-200 px-3 py-1.5 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300">{t('registrar.bk.newPatient')}</button>
                </div>
              </div>
            )}</Field>
            <Field label={t('registrar.doctor')} required error={errors.doctor_id}>{(id) => (
              <Select id={id} value={doctorId} invalid={!!errors.doctor_id} onChange={(e) => { setDoctorId(e.target.value); setTime(''); clearError('doctor_id'); }}>
                <option value="">{t('registrar.bk.choose')}</option>
                {doctors.data?.filter((d) => d.service_ids?.length).map((d) => <option key={d.id} value={d.id}>{d.display_name} — {d.specialty}</option>)}
              </Select>
            )}</Field>
            <Field label={t('registrar.service')} required error={errors.service_id}>{(id) => (
              <Select id={id} value={serviceId} invalid={!!errors.service_id} onChange={(e) => { setServiceId(e.target.value); setDuration(''); setTime(''); clearError('service_id'); }} disabled={!doctor}>
                {!doctor && <option>{t('registrar.bk.doctorFirst')}</option>}
                {doctorServices.map((s) => <option key={s.id} value={s.id}>{s.name}, {formatSom(s.price)}, {t('duration.min', { n: s.duration_min })}</option>)}
              </Select>
            )}</Field>
            {/* the date field keeps the room a native date input needs on a phone; the duration is a short number */}
            <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-end gap-3">
              <Field label={t('registrar.date')} required error={errors.date}>{(id) => <Input id={id} type="date" min={me.today} value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />}</Field>
              <Field label={t('registrar.bk.duration')} error={errors.duration_min} >{(id) => <Input id={id} type="number" min={5} max={240} step={5} disabled={!canEditDuration} value={duration === '' ? service?.duration_min ?? '' : duration} onChange={(e) => { setDuration(e.target.value ? Number(e.target.value) : ''); setTime(''); }} />}</Field>
            </div>
            <Field label={t('registrar.bk.shortNote')} error={errors.note}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('common.optional')} />}</Field>
          </div>
          <div className="md:col-span-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-sm font-semibold text-slate-800">{t('registrar.bk.freeSlots')}<span className="text-red-700" aria-hidden="true"> *</span></span>
              <span className="text-[0.8125rem] text-slate-600">{longDate(date)}</span>
            </div>
            {/* the slot error shows in every state of this column, also before a doctor is picked */}
            {errors.start_time && <p className="mb-2 text-sm font-medium text-red-700" role="alert" data-testid="slot-error">{errors.start_time}</p>}
            {!doctorId ? <p tabIndex={-1} className={cx('rounded-lg border-2 border-dashed p-6 text-center text-sm text-slate-600 focus:outline-none', errors.start_time ? 'border-red-300' : 'border-slate-200')}>{t('registrar.bk.pickDoctorDate')}</p>
              : avail.isLoading ? <div className="grid grid-cols-5 gap-1.5">{Array.from({ length: 20 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
              : avail.isError ? <Alert tone="red">{(avail.error as Error).message}</Alert>
              : !avail.data?.working ? <p className="rounded-lg border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-600">{t('registrar.bk.doctorOff')}</p>
              : (
                <>
                  <p className="mb-3 text-[0.8125rem] text-slate-600">{t('registrar.bk.branchLabel')} <b>{avail.data.branch_name}</b>{avail.data.room_name ? `, ${avail.data.room_name}` : ''}, <span className="whitespace-nowrap">{t('registrar.bk.hours', { start: avail.data.start, end: avail.data.end })}</span>{avail.data.break_start && <>, <span className="whitespace-nowrap">{t('registrar.bk.break', { start: avail.data.break_start, end: avail.data.break_end })}</span></>}</p>
                  {avail.data.branch_id && !me.branches.some((b: any) => b.id === avail.data.branch_id) && <Alert tone="red">{t('registrar.bk.noBranchAccess')}</Alert>}
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6" role="group" aria-label={t('registrar.bk.freeSlots')}>
                    {/* past slots are not shown: they can never be booked */}
                    {avail.data.slots.filter((s: any) => !s.past).map((s: any) => {
                      const label = !s.free ? t('registrar.bk.slotBusy') : t('registrar.bk.slotFree');
                      return (
                        <button key={s.time} type="button" disabled={!s.free} aria-pressed={time === s.time} aria-label={`${s.time}, ${label}`} onClick={() => { setTime(s.time); clearError('start_time'); }}
                          className={cx('min-h-9 rounded-lg border-2 text-sm font-medium tabular-nums focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300',
                            time === s.time ? 'border-brand-600 bg-brand-600 text-white' : !s.free ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500 line-through' : 'border-slate-300 bg-white text-slate-900 hover:border-brand-500 hover:bg-brand-50')}>
                          {s.time}
                        </button>
                      );
                    })}
                  </div>
                  {!avail.data.slots.some((s: any) => s.free && !s.past) && <p className="mt-2 text-sm font-medium text-amber-800">{t('registrar.bk.noFreeLeft')}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-slate-700" aria-hidden="true">
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block h-4 w-6 rounded border-2 border-slate-300 bg-white" />{t('registrar.bk.slotFree')}</span>
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block h-4 w-6 rounded border-2 border-brand-600 bg-brand-600" />{t('registrar.bk.slotChosen')}</span>
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block h-4 w-6 rounded border-2 border-slate-200 bg-slate-100 text-center text-[0.625rem] leading-3 text-slate-500 line-through">00</span>{t('registrar.bk.slotBusy')}</span>
                  </div>
                  {(service || reschedule) && (
                    <div className="mt-3 space-y-0.5 border-t border-slate-100 pt-3 text-[0.8125rem] text-slate-600">
                      {service && <p>{t('registrar.bk.priceLine', { category: t(`service.${service.category}` as MessageKey), price: formatSom(service.price) })}</p>}
                      {reschedule && <p>{t('registrar.bk.currentTime', { at: `${fmtDate(reschedule.starts_at)} ${fmtTime(reschedule.starts_at)}` })}</p>}
                    </div>
                  )}
                </>
              )}
          </div>
        </div>
      </Modal>
      <PatientFormModal open={newPatient} onClose={() => setNewPatient(false)} onSaved={async (id) => {
        const p = await api(`/patients/${id}`).then((r) => r.data);
        pickPatient(p);
      }} />
    </>
  );
}
