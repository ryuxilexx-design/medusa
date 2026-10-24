'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Printer } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatSom } from '@/lib/format';
import { Alert, Button, Field, LinkButton, Modal, ModalCancel, Select, useToast } from './ui';
import { PatientFormModal } from './patient-form';
import { PatientPicker, PatientRef } from './patient-picker';
import { useT } from '@/lib/i18n';

/**
 * «Hozir qabul qilish»: the patient is at the desk. The server picks the nearest free time of the chosen doctor and
 * checks the patient in (queue number) in one step; the ticket can be printed right away.
 */
export function WalkInModal({ open, onClose, patient: given }: { open: boolean; onClose: () => void; patient?: PatientRef }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const [patient, setPatient] = useState<PatientRef | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [newPatient, setNewPatient] = useState(false);
  const [done, setDone] = useState<{ id: string; queue_number: number; start_time: string } | null>(null);

  useEffect(() => { if (open) { setPatient(given ?? null); setDoctorId(''); setServiceId(''); setErrors({}); setFormError(null); setDone(null); } }, [open, given]);

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api('/doctors').then((r) => r.data as any[]), enabled: open });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api('/services').then((r) => r.data as any[]), enabled: open });
  const doctor = doctors.data?.find((d) => d.id === doctorId);
  const doctorServices = useMemo(() => (services.data ?? []).filter((s) => doctor?.service_ids?.includes(s.id)), [services.data, doctor]);
  useEffect(() => {
    if (!doctor) return;
    if (!doctorServices.some((s) => s.id === serviceId)) setServiceId(doctorServices.find((s) => s.category === 'consultation')?.id ?? doctorServices[0]?.id ?? '');
  }, [doctor, doctorServices, serviceId]);

  const save = useMutation({
    mutationFn: () => api('/appointments/walk-in', { method: 'POST', body: { patient_id: patient!.id, doctor_id: doctorId, service_id: serviceId || undefined } }),
    onSuccess: (r: any) => {
      ['appointments', 'queue', 'patient', 'patients', 'availability', 'dashboard', 'invoices'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(t('registrar.ap.queued', { n: r.data.queue_number }));
      setDone(r.data);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setFormError(e instanceof Error ? e.message : t('registrar.notSaved'));
    },
  });

  function submit() {
    const e: Record<string, string> = {};
    if (!patient) e.patient_id = t('registrar.bk.pickPatient');
    if (!doctorId) e.doctor_id = t('registrar.bk.pickDoctor');
    setErrors(e); setFormError(null);
    if (!Object.keys(e).length && !save.isPending) save.mutate();
  }

  return (
    <>
      <Modal open={open && !newPatient} onClose={onClose} dirty={!done && !!(doctorId || (!given && patient))} title={t('registrar.wi.title')}
        footer={done
          ? <><ModalCancel>{t('print.close')}</ModalCancel><LinkButton variant="primary" icon={<Printer className="h-4 w-4" />} href={`/print/appointment/${done.id}?ticket=1`} target="_blank">{t('registrar.wi.print')}</LinkButton></>
          : <><ModalCancel /><Button variant="primary" loading={save.isPending} onClick={submit}>{t('registrar.wi.button')}</Button></>}>
        {done ? (
          <div className="flex items-start gap-3 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4" role="status">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" aria-hidden="true" />
            <div>
              <p className="text-base font-bold text-slate-900">{t('registrar.wi.doneTitle')}</p>
              <p className="text-body text-slate-700">{t('registrar.wi.done', { n: done.queue_number, time: done.start_time, doctor: doctor?.display_name })}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {formError && <Alert tone="red">{formError}</Alert>}
            <PatientPicker value={patient} onChange={(p) => { setPatient(p); if (p) setErrors((x) => ({ ...x, patient_id: '' })); }} error={errors.patient_id} locked={!!given} onNew={() => setNewPatient(true)} />
            <Field label={t('registrar.doctor')} required error={errors.doctor_id}>{(id) => (
              <Select id={id} value={doctorId} invalid={!!errors.doctor_id} onChange={(e) => { setDoctorId(e.target.value); setErrors((x) => ({ ...x, doctor_id: '' })); }}>
                <option value="">{t('registrar.bk.choose')}</option>
                {doctors.data?.filter((d) => d.service_ids?.length).map((d) => <option key={d.id} value={d.id}>{d.display_name} — {d.specialty}</option>)}
              </Select>
            )}</Field>
            <Field label={t('registrar.service')} required error={errors.service_id}>{(id) => (
              <Select id={id} value={serviceId} invalid={!!errors.service_id} onChange={(e) => setServiceId(e.target.value)} disabled={!doctor}>
                {!doctor && <option>{t('registrar.bk.doctorFirst')}</option>}
                {doctorServices.map((s) => <option key={s.id} value={s.id}>{s.name}, {formatSom(s.price)}, {t('duration.min', { n: s.duration_min })}</option>)}
              </Select>
            )}</Field>
            <p className="text-small text-slate-600">{t('registrar.wi.hint')}</p>
          </div>
        )}
      </Modal>
      <PatientFormModal open={newPatient} onClose={() => setNewPatient(false)} onSaved={async (id) => { setPatient(await api(`/patients/${id}`).then((r) => r.data)); }} />
    </>
  );
}
