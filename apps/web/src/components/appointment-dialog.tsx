'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarClock, PlayCircle, UserCheck, UserX } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtTime, formatPhone, formatSom, fullName, pid, localDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Alert, Button, Field, KeyVal, Modal, Textarea, useToast } from './ui';
import { AppointmentStatus, InvoiceStatus } from './status';
import { BookingModal } from './booking';

export function useAppointmentAction() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'check-in' | 'start' | 'cancel' | 'no-show'; body?: any }) => api(`/appointments/${id}/${action}`, { method: 'POST', body: body ?? {} }),
    onSuccess: (r: any, v) => {
      ['appointments', 'queue', 'patient', 'patients', 'dashboard', 'invoices', 'doctor-day'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (v.action === 'check-in') toast.success(r.data.already ? `Bemor allaqachon navbatda: №${r.data.queue_number}` : `Navbatga qo‘shildi: №${r.data.queue_number}. Hisob ochildi.`);
      if (v.action === 'cancel') toast.success(r.data.needs_billing_review ? 'Qabul bekor qilindi. Diqqat: hisobda to‘lov bor — kassada alohida ko‘rib chiqing.' : 'Qabul bekor qilindi');
      if (v.action === 'no-show') toast.success('«Kelmadi» deb belgilandi');
    },
    onError: (e) => {
      toast.error(e);
      if (e instanceof ApiError && e.status === 409) ['appointments', 'queue'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });
}

export function AppointmentDialog({ appt, onClose }: { appt: any | null; onClose: () => void }) {
  const { me } = useSession();
  const router = useRouter();
  const act = useAppointmentAction();
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [resched, setResched] = useState(false);
  if (!appt) return null;
  const staff = me.role === 'manager' || me.role === 'registrar';
  const isToday = localDate(appt.starts_at) === me.today;
  const done = (fn?: () => void) => ({ onSuccess: () => { fn?.(); onClose(); } });

  return (
    <>
      <Modal open={!!appt && !resched} onClose={onClose} title={<span className="flex items-center gap-2">Qabul · {fmtDate(appt.starts_at)} {fmtTime(appt.starts_at)} <AppointmentStatus status={appt.status} /></span>}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Link href={`/patients/${appt.patient_id}`} className="text-sm font-medium text-brand-700 hover:underline">Bemor profili</Link>
            <div className="flex flex-wrap gap-2">
              {staff && appt.status === 'scheduled' && <Button icon={<CalendarClock className="h-4 w-4" />} onClick={() => setResched(true)}>Ko‘chirish</Button>}
              {staff && ['scheduled', 'arrived'].includes(appt.status) && <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setCancel(true)}>Bekor qilish</Button>}
              {staff && appt.status === 'scheduled' && localDate(appt.starts_at) <= me.today && <Button variant="danger" icon={<UserX className="h-4 w-4" />} loading={act.isPending && act.variables?.action === 'no-show'} onClick={() => act.mutate({ id: appt.id, action: 'no-show', body: { version: appt.version } }, done())}>Kelmadi</Button>}
              {staff && appt.status === 'scheduled' && isToday && <Button variant="primary" icon={<UserCheck className="h-4 w-4" />} loading={act.isPending && act.variables?.action === 'check-in'} onClick={() => act.mutate({ id: appt.id, action: 'check-in', body: { version: appt.version } }, done())}>Keldi</Button>}
              {me.role === 'doctor' && appt.status === 'arrived' && <Button variant="primary" icon={<PlayCircle className="h-4 w-4" />} onClick={() => router.push(`/doctor?appointment=${appt.id}`)}>Qabulni boshlash</Button>}
              {me.role === 'doctor' && ['in_progress', 'completed'].includes(appt.status) && <Button variant="primary" onClick={() => router.push(`/doctor?appointment=${appt.id}`)}>Kabinetda ochish</Button>}
            </div>
          </div>
        }>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <div className="divide-y divide-slate-100">
            <KeyVal k="Bemor" v={<span>{fullName(appt, true)} <span className="text-slate-500">{pid(appt.patient_number)}</span></span>} />
            {appt.phone !== undefined && <KeyVal k="Telefon" v={formatPhone(appt.phone)} />}
            <KeyVal k="Xizmat" v={appt.service_name} />
            <KeyVal k="Shifokor" v={`${appt.doctor_name} · ${appt.specialty}`} />
          </div>
          <div className="divide-y divide-slate-100">
            <KeyVal k="Vaqt" v={`${fmtTime(appt.starts_at)}–${fmtTime(appt.ends_at)}`} />
            <KeyVal k="Filial / xona" v={`${appt.branch_name}${appt.room_name ? ' · ' + appt.room_name : ''}`} />
            {appt.queue_number && <KeyVal k="Navbat" v={`№${appt.queue_number}, keldi ${fmtTime(appt.arrived_at)}`} />}
            {appt.invoice && <KeyVal k="Hisob" v={<span className="inline-flex items-center gap-2"><Link className="text-brand-700 hover:underline" href={`/cashier/${appt.invoice.id}`}>№{appt.invoice.invoice_number} · {formatSom(appt.invoice.total)}</Link><InvoiceStatus status={appt.invoice.status} /></span>} />}
          </div>
        </div>
        {appt.note && <p className="mt-3 text-sm text-slate-600"><span className="text-slate-500">Izoh:</span> {appt.note}</p>}
        {appt.cancel_reason && <p className="mt-2 text-sm text-slate-600"><span className="text-slate-500">Bekor qilish sababi:</span> {appt.cancel_reason}</p>}
        {staff && appt.status === 'scheduled' && !isToday && <p className="mt-3 text-xs text-slate-500">«Keldi» faqat qabul kuni belgilanadi.</p>}
        {cancel && (
          <div className="mt-4 space-y-2 rounded-md border border-red-200 bg-red-50/50 p-3">
            <Field label="Bekor qilish sababi" required={appt.status === 'arrived'}>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: bemor iltimosi bilan" />}</Field>
            {appt.invoice && appt.invoice.paid_amount > 0 && <Alert>Bu qabul hisobida to‘lov bor. Pul avtomatik qaytarilmaydi — kassada alohida ko‘rib chiqiladi.</Alert>}
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => setCancel(false)}>Ortga</Button>
              <Button size="sm" variant="danger" disabled={appt.status === 'arrived' && reason.trim().length < 3} loading={act.isPending && act.variables?.action === 'cancel'}
                onClick={() => act.mutate({ id: appt.id, action: 'cancel', body: { version: appt.version, reason: reason || null } }, done())}>Qabulni bekor qilish</Button>
            </div>
          </div>
        )}
      </Modal>
      <BookingModal open={resched} reschedule={appt} onClose={() => { setResched(false); onClose(); }} />
    </>
  );
}
