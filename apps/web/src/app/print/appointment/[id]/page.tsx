'use client';
import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtTime, formatPhone, localDate, longDate } from '@/lib/format';
import { useMeQuery } from '@/lib/session';
import { PrintDoc, PrintState } from '@/components/print-doc';
import { LinkButton } from '@/components/ui';
import { useT } from '@/lib/i18n';

/** Appointment slip for the patient: A5 by default, a 58 mm queue ticket with `?ticket=1`. */
export default function PrintAppointment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><Slip id={id} /></Suspense>;
}

function Slip({ id }: { id: string }) {
  const t = useT();
  const me = useMeQuery();
  const ticket = useSearchParams().get('ticket') === '1';
  const q = useQuery({ queryKey: ['appointments', 'one', id], queryFn: () => api(`/appointments/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  const a = q.data;
  const status = a.queue_number ? t('print.appt.arrived') : t('print.appt.scheduled');
  const number = a.queue_number ? `Q-${a.queue_number}` : a.id.slice(0, 8).toUpperCase();
  const place = `${a.branch_name}${a.room_name ? ', ' + a.room_name : ''}`;
  // the other paper size, one click away (the chosen one is shown pressed)
  // a quiet choice, not a second blue button next to «Chop etish»: the chosen size is a white capsule with a tick
  const size = (on: boolean, href: string, label: string) => (
    <LinkButton variant={on ? 'secondary' : 'ghost'} className={on ? 'ring-2 ring-inset ring-brand-600 !text-brand-800' : '!text-slate-700'} href={href} icon={on ? <Check className="h-4 w-4" /> : undefined}>{label}</LinkButton>
  );
  const toolbar = (
    <div className="flex gap-2" role="group" aria-label={t('print.appt.paper')}>
      {size(!ticket, `/print/appointment/${id}`, t('print.appt.a5'))}
      {size(ticket, `/print/appointment/${id}?ticket=1`, t('print.appt.ticket'))}
    </div>
  );
  if (ticket) return (
    <PrintDoc paper="ticket" toolbar={toolbar} title={t('print.appt.title')} number={number} date={a.arrived_at ?? a.starts_at} branch={a.branch_name} patient={a} responsible={me.data?.name ?? ''} status={status}>
      {a.queue_number && (
        <div className="my-2 text-center">
          <div className="text-[0.625rem] uppercase tracking-wide text-slate-600">{t('print.appt.queue')}</div>
          <div className="text-[2.25rem] font-black leading-none tabular-nums">№{a.queue_number}</div>
          <div className="mt-1 text-[0.625rem] text-slate-600">{t('print.appt.arrivedAt', { time: fmtTime(a.arrived_at) })}</div>
        </div>
      )}
      <div className="space-y-0.5">
        <div><b>{fmtDate(a.starts_at)}, {fmtTime(a.starts_at)}</b></div>
        <div>{a.doctor_name}, {a.specialty}</div>
        <div>{a.service_name}</div>
        <div>{place}</div>
        {a.branch_address && <div className="text-slate-600">{a.branch_address}</div>}
        {a.branch_phone && <div className="tabular-nums">{formatPhone(a.branch_phone)}</div>}
      </div>
    </PrintDoc>
  );
  return (
    <PrintDoc paper="A5" legal={false} toolbar={toolbar} title={t('print.appt.title')} number={number} date={a.arrived_at ?? a.starts_at} branch={a.branch_name} patient={a} responsible={me.data?.name ?? ''} status={status}>
      {a.queue_number && (
        <div className="print-avoid-break mb-4 flex items-center justify-between rounded border-2 border-slate-800 px-4 py-3">
          <div><div className="text-xs uppercase tracking-wide text-slate-600">{t('print.appt.queue')}</div><div className="text-xs text-slate-600">{t('print.appt.arrivedAt', { time: fmtTime(a.arrived_at) })}</div></div>
          <div className="text-[2.5rem] font-black leading-none tabular-nums">№{a.queue_number}</div>
        </div>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.9375rem]">
        <dt className="text-slate-600">{t('print.appt.when')}</dt><dd className="font-bold">{longDate(localDate(a.starts_at))}, {fmtTime(a.starts_at)}–{fmtTime(a.ends_at)}</dd>
        <dt className="text-slate-600">{t('print.appt.doctor')}</dt><dd className="font-bold">{a.doctor_name}, {a.specialty}</dd>
        <dt className="text-slate-600">{t('print.appt.service')}</dt><dd>{a.service_name}</dd>
        <dt className="text-slate-600">{t('print.appt.branch')}</dt><dd>{a.branch_name}</dd>
        {a.room_name && <><dt className="text-slate-600">{t('print.appt.room')}</dt><dd>{a.room_name}</dd></>}
        {a.branch_address && <><dt className="text-slate-600">{t('print.appt.address')}</dt><dd>{a.branch_address}</dd></>}
        {a.branch_phone && <><dt className="text-slate-600">{t('print.appt.phone')}</dt><dd className="tabular-nums">{formatPhone(a.branch_phone)}</dd></>}
      </dl>
      {!a.queue_number && <p className="mt-4 text-sm text-slate-600">{t('print.appt.comeEarly')}</p>}
    </PrintDoc>
  );
}
