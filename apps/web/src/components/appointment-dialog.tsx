'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarClock, PlayCircle, Printer, UserCheck, UserX } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtTime, formatPhone, formatSom, fullName, pid, localDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Alert, Button, Field, KeyVal, LinkButton, Modal, Textarea, useToast } from './ui';
import { AppointmentStatus, InvoiceStatus, SourceMark } from './status';
import { BookingModal } from './booking';
import { useT } from '@/lib/i18n';

export function useAppointmentAction() {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'check-in' | 'start' | 'cancel' | 'no-show'; body?: any }) => api(`/appointments/${id}/${action}`, { method: 'POST', body: body ?? {} }),
    onSuccess: (r: any, v) => {
      ['appointments', 'queue', 'patient', 'patients', 'dashboard', 'invoices', 'doctor-day'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (v.action === 'check-in') toast.success(r.data.already ? t('registrar.ap.alreadyQueued', { n: r.data.queue_number }) : t('registrar.ap.queued', { n: r.data.queue_number }));
      if (v.action === 'cancel') toast.success(r.data.needs_billing_review ? t('registrar.ap.cancelledReview') : t('registrar.ap.cancelled'));
      if (v.action === 'no-show') toast.success(t('registrar.ap.noShowMarked'));
    },
    onError: (e) => {
      toast.error(e);
      if (e instanceof ApiError && e.status === 409) ['appointments', 'queue'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });
}

const NO_SHOW_GRACE_MS = 15 * 60_000;

export function AppointmentDialog({ appt, onClose }: { appt: any | null; onClose: () => void }) {
  const { me, demoNow } = useSession();
  const t = useT();
  const router = useRouter();
  const act = useAppointmentAction();
  const [cancel, setCancel] = useState(false);
  const [noShow, setNoShow] = useState(false);
  const [reason, setReason] = useState('');
  const [resched, setResched] = useState(false);
  // a pending «cancel» or «no-show» question belongs to one appointment only
  useEffect(() => { setCancel(false); setNoShow(false); setReason(''); }, [appt?.id]);
  if (!appt) return null;
  const staff = me.role === 'manager' || me.role === 'registrar';
  const isToday = localDate(appt.starts_at) === me.today;
  const done = (fn?: () => void) => ({ onSuccess: () => { fn?.(); onClose(); } });
  // «Kelmadi» cannot be undone, so it is offered only once the slot has started plus a short grace (demo clock)
  const noShowOpen = staff && appt.status === 'scheduled' && demoNow().getTime() >= Date.parse(appt.starts_at) + NO_SHOW_GRACE_MS;

  return (
    <>
      <Modal open={!!appt && !resched} onClose={onClose} width="max-w-3xl" title={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">{t('registrar.ap.title', { date: fmtDate(appt.starts_at), time: fmtTime(appt.starts_at) })} <AppointmentStatus status={appt.status} /></span>}
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            {staff && !cancel && !noShow && appt.status === 'scheduled' && <Button icon={<CalendarClock className="h-4 w-4" />} onClick={() => setResched(true)}>{t('registrar.ap.reschedule')}</Button>}
            {staff && !cancel && !noShow && ['scheduled', 'arrived'].includes(appt.status) && <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => { setNoShow(false); setCancel(true); }}>{t('registrar.ap.cancel')}</Button>}
            {noShowOpen && !noShow && !cancel && <Button variant="ghost" className="text-slate-700 hover:bg-slate-100 hover:text-slate-900" icon={<UserX className="h-4 w-4" />} onClick={() => { setCancel(false); setNoShow(true); }}>{t('registrar.noShow')}</Button>}
            {staff && !cancel && !noShow && ['scheduled', 'arrived'].includes(appt.status) && <LinkButton variant="ghost" className="text-slate-700 hover:bg-slate-100 hover:text-slate-900" icon={<Printer className="h-4 w-4" />} href={`/print/appointment/${appt.id}${appt.queue_number ? '?ticket=1' : ''}`} target="_blank">{t('registrar.ap.print')}</LinkButton>}
            {/* the one primary action sits on the right and gets the first focus */}
            <div className="ml-auto flex gap-2">
              {staff && !cancel && !noShow && appt.status === 'scheduled' && isToday && <Button data-autofocus variant="primary" icon={<UserCheck className="h-4 w-4" />} loading={act.isPending && act.variables?.action === 'check-in'} onClick={() => act.mutate({ id: appt.id, action: 'check-in', body: { version: appt.version } }, done())}>{t('registrar.checkIn')}</Button>}
              {me.role === 'doctor' && appt.status === 'arrived' && <Button data-autofocus variant="primary" icon={<PlayCircle className="h-4 w-4" />} onClick={() => router.push(`/doctor?appointment=${appt.id}`)}>{t('registrar.startVisit')}</Button>}
              {me.role === 'doctor' && ['in_progress', 'completed'].includes(appt.status) && <Button data-autofocus variant="primary" onClick={() => router.push(`/doctor?appointment=${appt.id}`)}>{t('registrar.ap.openInRoom')}</Button>}
            </div>
          </div>
        }>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <div className="divide-y divide-slate-100">
            <KeyVal k={t('registrar.patient')} v={<span className="[overflow-wrap:anywhere]">{fullName(appt, true)} <span className="whitespace-nowrap text-slate-600">{pid(appt.patient_number)}</span></span>} />
            {appt.phone !== undefined && <KeyVal k={t('registrar.phone')} v={formatPhone(appt.phone)} />}
            <KeyVal k={t('registrar.service')} v={appt.service_name} />
            {(appt.source === 'telegram' || appt.patient_confirmed_at) && <KeyVal k={t('registrar.ap.telegram')} v={<span>{appt.source === 'telegram' ? t('registrar.ap.viaBot') : t('registrar.ap.byRegistry')}{appt.patient_confirmed_at ? `, ${t('registrar.ap.confirmed', { at: fmtDateTime(appt.patient_confirmed_at) })}` : ''}</span>} />}
            <KeyVal k={t('registrar.doctor')} v={`${appt.doctor_name}, ${appt.specialty}`} />
          </div>
          <div className="divide-y divide-slate-100">
            <KeyVal k={t('registrar.time')} v={`${fmtTime(appt.starts_at)}–${fmtTime(appt.ends_at)}`} />
            <KeyVal k={t('registrar.ap.branchRoom')} v={`${appt.branch_name}${appt.room_name ? ', ' + appt.room_name : ''}`} />
            {appt.queue_number && <KeyVal k={t('registrar.ap.queue')} v={t('registrar.ap.queueValue', { n: appt.queue_number, time: fmtTime(appt.arrived_at) })} />}
            {appt.invoice && <KeyVal k={t('registrar.invoice')} v={<span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1"><Link className="whitespace-nowrap rounded text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" href={`/cashier/${appt.invoice.id}`}>№{appt.invoice.invoice_number} · {formatSom(appt.invoice.total)}</Link><InvoiceStatus status={appt.invoice.status} /></span>} />}
          </div>
        </div>
        <div className="mt-2"><LinkButton size="sm" variant="ghost" className="-ml-3" href={`/patients/${appt.patient_id}`}>{t('registrar.ap.patientProfile')}</LinkButton></div>
        {appt.note && <p className="mt-3 text-sm text-slate-600"><span className="text-slate-600">{t('registrar.ap.noteLabel')}</span> {appt.note}</p>}
        {appt.cancel_reason && <p className="mt-2 text-sm text-slate-600"><span className="text-slate-600">{t('registrar.ap.cancelReasonLabel')}</span> {appt.cancel_reason}</p>}
        {staff && appt.status === 'scheduled' && !isToday && <p className="mt-3 text-xs text-slate-600">{t('registrar.ap.checkInToday')}</p>}
        {noShow && (
          <div className="mt-4 space-y-2 rounded-md border border-slate-300 bg-slate-50 p-3" role="group" aria-labelledby="no-show-q" data-testid="no-show-confirm">
            <p id="no-show-q" className="text-[0.9375rem] font-semibold text-slate-900">{t('registrar.ap.noShowConfirm', { name: fullName(appt), time: fmtTime(appt.starts_at) })}</p>
            <p className="text-sm text-slate-600">{t('registrar.ap.noShowFinal')}</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" autoFocus onClick={() => setNoShow(false)}>{t('common.back')}</Button>
              <Button size="sm" variant="danger" icon={<UserX className="h-4 w-4" />} loading={act.isPending && act.variables?.action === 'no-show'}
                onClick={() => act.mutate({ id: appt.id, action: 'no-show', body: { version: appt.version } }, done())}>{t('registrar.ap.noShowDo')}</Button>
            </div>
          </div>
        )}
        {cancel && (
          <div className="mt-4 space-y-2 rounded-md border border-red-200 bg-red-50/50 p-3">
            <Field label={t('registrar.ap.cancelReason')} required={appt.status === 'arrived'}>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('registrar.ap.cancelPlaceholder')} />}</Field>
            {appt.invoice && appt.invoice.paid_amount > 0 && <Alert>{t('registrar.ap.paidWarning')}</Alert>}
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => setCancel(false)}>{t('common.back')}</Button>
              <Button size="sm" variant="danger" disabled={appt.status === 'arrived' && reason.trim().length < 3} loading={act.isPending && act.variables?.action === 'cancel'}
                onClick={() => act.mutate({ id: appt.id, action: 'cancel', body: { version: appt.version, reason: reason || null } }, done())}>{t('registrar.ap.cancelAppt')}</Button>
            </div>
          </div>
        )}
      </Modal>
      <BookingModal open={resched} reschedule={appt} onClose={() => { setResched(false); onClose(); }} />
    </>
  );
}
