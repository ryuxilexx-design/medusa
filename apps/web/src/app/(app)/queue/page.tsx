'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PlayCircle, RefreshCw, UserCheck } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { duration, fmtTime, fullName, longDate, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, cx, EmptyState, LinkButton, ErrorState, LoadingRows, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { AppointmentStatus, SourceMark } from '@/components/status';
import { useAppointmentAction } from '@/components/appointment-dialog';
import { useT } from '@/lib/i18n';

export default function QueuePage() {
  const { me, branchId, demoNow } = useSession();
  const t = useT();
  const router = useRouter();
  const [doctorId, setDoctorId] = useState('');
  const act = useAppointmentAction();
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api('/doctors').then((r) => r.data as any[]), enabled: me.role !== 'doctor' });
  const q = useQuery({ queryKey: ['queue', branchId, doctorId], queryFn: () => api(`/queue${qs({ branch_id: branchId, doctor_id: doctorId })}`).then((r) => r.data), refetchInterval: 12_000 });
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(id); }, []);
  const staff = me.role === 'manager' || me.role === 'registrar';
  // Waiting time = now − arrival; once the visit starts the stored value is final.
  const waitOf = (x: any) => x.wait_seconds ?? (x.started_at ? null : Math.max(0, Math.round((+demoNow() - +new Date(x.arrived_at)) / 1000)));
  const active = q.data?.tickets.filter((x: any) => ['arrived', 'in_progress'].includes(x.status)) ?? [];
  const done = q.data?.tickets.filter((x: any) => !['arrived', 'in_progress'].includes(x.status)) ?? [];
  // numbers restart per branch: with all branches shown, «№3» needs its branch code to be unambiguous
  const branchCode = (id: string) => (!branchId && me.branches.length > 1 ? `${me.branches.find((b) => b.id === id)?.code ?? ''} ` : '');
  const doneList = done.slice(-6).map((x: any) => `${branchCode(x.branch_id)}№${x.number}`).join(', ') + (done.length > 6 ? ', …' : '');

  return (
    <>
      <PageHeader title={t('registrar.q.title')} subtitle={t('registrar.q.sub', { date: longDate(me.today) })}
        actions={<>
          {me.role !== 'doctor' && <Select aria-label={t('registrar.doctor')} className="h-11 w-full min-w-0 sm:w-auto sm:max-w-[16rem]" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">{t('registrar.allDoctors')}</option>{doctors.data?.filter((d) => d.service_ids?.length).map((d) => <option key={d.id} value={d.id}>{d.display_name}</option>)}
          </Select>}
          <Button icon={<RefreshCw className={q.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />} onClick={() => q.refetch()}>{t('registrar.q.refresh')}</Button>
        </>} />
      {q.isLoading ? <Card><LoadingRows /></Card> : q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3">
          <Card className="2xl:col-span-2" padded={false} title={<>{t('registrar.q.inQueue')} <Badge tone="yellow" className="ml-1">{active.length}</Badge></>}>
            {!active.length ? <EmptyState title={t('registrar.q.empty')} text={staff ? t('registrar.q.emptyHint') : undefined} /> : (
              <Table>
                <thead><tr><Th>№</Th><Th>{t('registrar.patient')}</Th><Th>{t('registrar.q.doctorRoom')}</Th><Th>{t('registrar.q.arrived')}</Th><Th>{t('registrar.q.wait')}</Th><Th>{t('registrar.status')}</Th><Th right>{t('registrar.action')}</Th></tr></thead>
                <tbody>{active.map((x: any) => {
                  const w = waitOf(x);
                  return (
                    <tr key={x.id} className={x.status === 'in_progress' ? 'bg-violet-50/40' : ''}>
                      <Td><span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-sm font-bold tabular-nums text-white">{x.number}</span></Td>
                      <Td className="min-w-[12rem]"><div className="font-medium">{fullName(x)}</div><div className="whitespace-nowrap text-[0.8125rem] text-slate-600">{pid(x.patient_number)}, {t('registrar.q.apptAt', { time: fmtTime(x.starts_at) })}</div></Td>
                      <Td className="whitespace-nowrap"><div>{x.doctor_name}</div><div className="text-[0.8125rem] text-slate-600">{x.room_name ?? x.branch_name}</div></Td>
                      <Td className="tabular-nums">{fmtTime(x.arrived_at)}</Td>
                      <Td className={cx('whitespace-nowrap', w != null && w > 1800 && !x.started_at && 'font-medium text-red-700')}>{x.started_at ? t('registrar.q.waitFinal', { d: duration(x.wait_seconds) }) : duration(w)}</Td>
                      <Td><AppointmentStatus status={x.status} /></Td>
                      <Td right className="whitespace-nowrap">
                        {me.role === 'doctor' && x.status === 'arrived' && <Button size="sm" variant="primary" icon={<PlayCircle className="h-3.5 w-3.5" />} onClick={() => router.push(`/doctor?appointment=${x.appointment_id}`)}>{t('registrar.startVisit')}</Button>}
                        {me.role === 'doctor' && x.status === 'in_progress' && <Button size="sm" onClick={() => router.push(`/doctor?appointment=${x.appointment_id}`)}>{t('registrar.open')}</Button>}
                        {me.role !== 'doctor' && <LinkButton size="sm" variant="ghost" href={`/patients/${x.patient_id}`}>{t('registrar.profile')}</LinkButton>}
                      </Td>
                    </tr>
                  );
                })}</tbody>
              </Table>
            )}
            {done.length > 0 && <div className="border-t border-slate-100 px-4 py-2 text-[0.8125rem] text-slate-600">{t('registrar.q.doneToday', { n: done.length, list: doneList })}</div>}
          </Card>
          <Card padded={false} title={<>{t('registrar.q.expected')} <Badge tone="blue" className="ml-1">{q.data.expected.length}</Badge></>}>
            {!q.data.expected.length ? <EmptyState title={t('registrar.q.noExpected')} /> : (
              <ul className="divide-y divide-slate-100">
                {q.data.expected.map((a: any) => (
                  <li key={a.appointment_id} className="flex items-center gap-3 px-4 py-2">
                    <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">{fmtTime(a.starts_at)}</span>
                    <div className="min-w-0 flex-1 leading-tight"><div className="text-sm font-medium">{fullName(a)}</div><div className="text-[0.8125rem] text-slate-600">{a.doctor_name}, {a.service_name}<SourceMark appt={a} /></div></div>
                    {staff && <Button size="sm" className="shrink-0" icon={<UserCheck className="h-4 w-4" />} loading={act.isPending && act.variables?.id === a.appointment_id}
                      onClick={() => act.mutate({ id: a.appointment_id, action: 'check-in', body: { version: a.version } })}>{t('registrar.checkIn')}</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-600">{t('registrar.q.footer')}</p>
    </>
  );
}
