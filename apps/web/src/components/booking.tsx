'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, newIdempotencyKey, qs } from '@/lib/api';
import { fmtDate, formatSom, fullName, localDate, fmtTime, pid, longDate } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Alert, Button, cx, Field, Input, Modal, Select, Skeleton, Textarea, useToast } from './ui';
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
    if (!Object.keys(e).length) save.mutate();
  }

  const dirty = !!(time || note || (!init?.patient && patient));
  const canEditDuration = me.role === 'manager' || me.role === 'registrar';
  return (
    <>
      <Modal open={open && !newPatient} onClose={onClose} dirty={dirty && !save.isSuccess} width="max-w-3xl" title={reschedule ? t('registrar.bk.rescheduleTitle') : t('registrar.book')}
        footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{reschedule ? t('registrar.bk.saveReschedule') : t('registrar.book')}</Button></>}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="space-y-3 md:col-span-2">
            {formError && <Alert tone="red">{formError}</Alert>}
            <Field label={t('registrar.patient')} required error={errors.patient_id}>{(id) => patient ? (
              <div className="flex items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm">
                <span><b>{fullName(patient)}</b> <span className="text-slate-600">{pid(patient.patient_number)}</span></span>
                {!reschedule && !init?.patient && <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setPatient(null)}>{t('registrar.change')}</button>}
              </div>
            ) : (
              <div>
                <Input id={id} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('registrar.bk.patientSearch')} autoComplete="off" />
                <div className="mt-1 rounded-md border border-slate-200">
                  {dq.trim().length < 2 ? <p className="px-3 py-2 text-xs text-slate-600">{t('registrar.bk.min2')}</p>
                    : found.isLoading ? <Skeleton className="m-2 h-6" />
                    : found.data?.length ? found.data.map((p) => (
                      <button key={p.id} type="button" onClick={() => setPatient(p)} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-brand-50 focus:bg-brand-50 focus:outline-none">
                        <b>{fullName(p)}</b> <span className="text-slate-600">{pid(p.patient_number)}, {fmtDate(p.birth_date)}</span>
                      </button>
                    )) : <p className="px-3 py-2 text-xs text-slate-600">{t('registrar.patientNotFound')}</p>}
                  <button type="button" onClick={() => setNewPatient(true)} className="block w-full border-t px-3 py-1.5 text-left text-sm font-medium text-brand-700 hover:bg-brand-50">{t('registrar.bk.newPatient')}</button>
                </div>
              </div>
            )}</Field>
            <Field label={t('registrar.doctor')} required error={errors.doctor_id}>{(id) => (
              <Select id={id} value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setTime(''); }}>
                <option value="">{t('registrar.bk.choose')}</option>
                {doctors.data?.filter((d) => d.service_ids?.length).map((d) => <option key={d.id} value={d.id}>{d.display_name} — {d.specialty}</option>)}
              </Select>
            )}</Field>
            <Field label={t('registrar.service')} required error={errors.service_id}>{(id) => (
              <Select id={id} value={serviceId} onChange={(e) => { setServiceId(e.target.value); setDuration(''); setTime(''); }} disabled={!doctor}>
                {!doctor && <option>{t('registrar.bk.doctorFirst')}</option>}
                {doctorServices.map((s) => <option key={s.id} value={s.id}>{s.name}, {formatSom(s.price)}, {t('duration.min', { n: s.duration_min })}</option>)}
              </Select>
            )}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('registrar.date')} required error={errors.date}>{(id) => <Input id={id} type="date" min={me.today} value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />}</Field>
              <Field label={t('registrar.bk.duration')} error={errors.duration_min} hint={canEditDuration ? t('registrar.bk.durationHint') : undefined}>{(id) => <Input id={id} type="number" min={5} max={240} step={5} disabled={!canEditDuration} value={duration === '' ? service?.duration_min ?? '' : duration} onChange={(e) => { setDuration(e.target.value ? Number(e.target.value) : ''); setTime(''); }} />}</Field>
            </div>
            <Field label={t('registrar.bk.shortNote')} error={errors.note}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('common.optional')} />}</Field>
          </div>
          <div className="md:col-span-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[0.8125rem] font-medium text-slate-700">{t('registrar.bk.freeSlots')} <span className="text-red-600">*</span></span>
              <span className="text-xs text-slate-600">{longDate(date)}</span>
            </div>
            {!doctorId ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-slate-600">{t('registrar.bk.pickDoctorDate')}</p>
              : avail.isLoading ? <div className="grid grid-cols-5 gap-1.5">{Array.from({ length: 20 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
              : avail.isError ? <Alert tone="red">{(avail.error as Error).message}</Alert>
              : !avail.data?.working ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-slate-600">{t('registrar.bk.doctorOff')}</p>
              : (
                <>
                  <p className="mb-2 text-xs text-slate-600">{t('registrar.bk.branchLabel')} <b>{avail.data.branch_name}</b>{avail.data.room_name ? `, ${avail.data.room_name}` : ''}, {t('registrar.bk.hours', { start: avail.data.start, end: avail.data.end })}{avail.data.break_start ? `, ${t('registrar.bk.break', { start: avail.data.break_start, end: avail.data.break_end })}` : ''}</p>
                  {avail.data.branch_id && !me.branches.some((b: any) => b.id === avail.data.branch_id) && <Alert tone="red">{t('registrar.bk.noBranchAccess')}</Alert>}
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                    {avail.data.slots.map((s: any) => {
                      const disabled = !s.free || s.past;
                      return (
                        <button key={s.time} type="button" disabled={disabled} onClick={() => { setTime(s.time); setErrors((x) => ({ ...x, start_time: '' })); }}
                          title={!s.free ? t('registrar.bk.slotBusy') : s.past ? t('registrar.bk.slotPast') : t('registrar.bk.slotFree')}
                          className={cx('h-8 rounded-md border text-[0.8125rem] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                            time === s.time ? 'border-brand-600 bg-brand-600 text-white' : !s.free ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through' : s.past ? 'cursor-not-allowed border-slate-100 text-slate-300' : 'border-slate-300 bg-white hover:border-brand-500 hover:bg-brand-50')}>
                          {s.time}
                        </button>
                      );
                    })}
                  </div>
                  {!avail.data.slots.some((s: any) => s.free && !s.past) && <p className="mt-2 text-xs text-amber-700">{t('registrar.bk.noFreeLeft')}</p>}
                  {errors.start_time && <p className="mt-2 text-xs text-red-600">{errors.start_time}</p>}
                  <p className="mt-3 text-xs text-slate-600">{t('registrar.bk.slotsHint')}</p>
                  {service && <p className="mt-1 text-xs text-slate-600">{t('registrar.bk.priceLine', { category: t(`service.${service.category}` as MessageKey), price: formatSom(service.price) })}</p>}
                  {reschedule && <p className="mt-1 text-xs text-slate-600">{t('registrar.bk.currentTime', { at: `${fmtDate(reschedule.starts_at)} ${fmtTime(reschedule.starts_at)}` })}</p>}
                </>
              )}
          </div>
        </div>
      </Modal>
      <PatientFormModal open={newPatient} onClose={() => setNewPatient(false)} onSaved={async (id) => {
        const p = await api(`/patients/${id}`).then((r) => r.data);
        setPatient(p);
      }} />
    </>
  );
}
