'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarCheck, CheckCircle2, PlayCircle, RefreshCw, UserCheck, Users, Zap } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { duration, fmtTime, fullName, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, cx, EmptyState, LinkButton, ErrorState, LoadingRows, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { AppointmentStatus, SourceMark } from '@/components/status';
import { useAppointmentAction } from '@/components/appointment-dialog';
import { CameraArrivals } from '@/components/camera-arrivals';
import { WalkInModal } from '@/components/walk-in';
import { useT } from '@/lib/i18n';

export default function QueuePage() {
  const { me, branchId, demoNow } = useSession();
  const t = useT();
  const router = useRouter();
  const [doctorId, setDoctorId] = useState('');
  const [walkIn, setWalkIn] = useState(false);
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

  // who is next: per doctor, the first patient still waiting (the server sorts in-progress first, then by number)
  const nextIds = new Set<string>();
  const seen = new Set<string>();
  for (const x of active) if (x.status === 'arrived' && !seen.has(x.doctor_id)) { seen.add(x.doctor_id); nextIds.add(x.id); }
  // a doctor with a visit in progress continues it first: then «Ochish» is the one blue button, not «Qabulni boshlash»
  const busy = new Set(active.filter((x: any) => x.status === 'in_progress').map((x: any) => x.doctor_id));

  return (
    <>
      <PageHeader title={t('registrar.q.title')}
        actions={<>
          {me.role !== 'doctor' && <Select aria-label={t('registrar.doctor')} className="w-full min-w-0 sm:w-auto sm:max-w-[16rem]" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">{t('registrar.allDoctors')}</option>{doctors.data?.filter((d) => d.service_ids?.length).map((d) => <option key={d.id} value={d.id}>{d.display_name}</option>)}
          </Select>}
          <Button icon={<RefreshCw className={q.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />} onClick={() => q.refetch()}>{t('registrar.q.refresh')}</Button>
          {staff && <Button variant="primary" icon={<Zap className="h-4 w-4" />} onClick={() => setWalkIn(true)}>{t('registrar.wi.button')}</Button>}
        </>} />
      {staff && <WalkInModal open={walkIn} onClose={() => setWalkIn(false)} />}
      <CameraArrivals />
      {q.isLoading ? <Card><LoadingRows /></Card> : q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-3">
          <Card className="2xl:col-span-2" padded={false} title={<span className="inline-flex items-center gap-2">{t('registrar.q.inQueue')}<Badge tone={active.length ? 'yellow' : 'gray'}>{active.length}</Badge></span>}>
            {!active.length ? <EmptyState compact icon={<Users />} title={t('registrar.q.empty')} text={staff && q.data.expected.length ? t('registrar.q.emptyHint') : undefined} /> : (
              <Table>
                <thead><tr><Th>№</Th><Th>{t('registrar.patient')}</Th><Th className="hidden sm:table-cell">{t('registrar.q.doctorRoom')}</Th><Th className="hidden md:table-cell">{t('registrar.q.arrived')}</Th><Th>{t('registrar.q.wait')}</Th><Th className="hidden sm:table-cell">{t('registrar.status')}</Th><Th right><span className="sr-only">{t('registrar.action')}</span></Th></tr></thead>
                <tbody>{active.map((x: any) => {
                  const w = waitOf(x);
                  const next = nextIds.has(x.id);
                  const long = w != null && w > 1800 && !x.started_at;
                  return (
                    <tr key={x.id} className={x.status === 'in_progress' ? 'bg-violet-50/50' : next ? 'bg-amber-50/50' : ''}>
                      <Td><span className={cx('inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-1.5 text-base font-bold tabular-nums', x.status === 'in_progress' ? 'bg-violet-700 text-white' : 'bg-slate-900 text-white')}>{x.number}</span></Td>
                      <Td className="min-w-[11rem]">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{fullName(x)}</span>{next && <Badge tone="yellow" icon={<ArrowRight className="h-3.5 w-3.5" />}>{t('registrar.q.next')}</Badge>}</div>
                        <div className="whitespace-nowrap text-[0.8125rem] tabular-nums text-slate-600">{pid(x.patient_number)} · {t('registrar.q.apptAt', { time: fmtTime(x.starts_at) })}</div>
                      </Td>
                      <Td className="hidden whitespace-nowrap sm:table-cell"><div className="text-slate-900">{x.doctor_name}</div><div className="text-[0.8125rem] text-slate-600">{x.room_name ?? x.branch_name}</div></Td>
                      <Td className="hidden tabular-nums md:table-cell">{fmtTime(x.arrived_at)}</Td>
                      <Td className={cx('whitespace-nowrap tabular-nums', long ? 'font-semibold text-red-700' : 'text-slate-900')}>
                        {long && <AlertTriangle className="mr-1 inline h-4 w-4 align-[-0.15em]" aria-hidden="true" />}{x.started_at ? t('registrar.q.waitFinal', { d: duration(x.wait_seconds) }) : duration(w)}
                      </Td>
                      <Td className="hidden sm:table-cell"><AppointmentStatus status={x.status} /></Td>
                      <Td right className="whitespace-nowrap !py-1.5">
                        {me.role === 'doctor' && x.status === 'arrived' && <Button size="sm" variant={next && !busy.has(x.doctor_id) ? 'primary' : 'secondary'} icon={<PlayCircle className="h-4 w-4" />} onClick={() => router.push(`/doctor?appointment=${x.appointment_id}`)}>{t('registrar.startVisit')}</Button>}
                        {me.role === 'doctor' && x.status === 'in_progress' && <Button size="sm" variant="primary" onClick={() => router.push(`/doctor?appointment=${x.appointment_id}`)}>{t('registrar.open')}</Button>}
                        {me.role !== 'doctor' && <LinkButton size="sm" variant="ghost" className="text-slate-700 hover:bg-slate-100 hover:text-brand-800" href={`/patients/${x.patient_id}`}>{t('registrar.profile')}</LinkButton>}
                      </Td>
                    </tr>
                  );
                })}</tbody>
              </Table>
            )}
            {done.length > 0 && <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-2.5 text-[0.8125rem] text-slate-600"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" /><span>{t('registrar.q.doneToday', { n: done.length, list: doneList })}</span></div>}
          </Card>
          <Card padded={false} title={<span className="inline-flex items-center gap-2">{t('registrar.q.expected')}<Badge tone={q.data.expected.length ? 'blue' : 'gray'}>{q.data.expected.length}</Badge></span>}>
            {!q.data.expected.length ? <EmptyState compact icon={<CalendarCheck />} title={t('registrar.q.noExpected')} /> : (
              <ul className="divide-y divide-slate-100">
                {q.data.expected.map((a: any) => (
                  <li key={a.appointment_id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="w-12 shrink-0 text-[0.9375rem] font-bold tabular-nums text-slate-900">{fmtTime(a.starts_at)}</span>
                    <div className="min-w-0 flex-1 leading-snug"><div className="font-medium text-slate-900 [overflow-wrap:anywhere]">{fullName(a)}</div><div className="text-[0.8125rem] text-slate-600">{a.doctor_name}, {a.service_name}<SourceMark appt={a} /></div></div>
                    {staff && <Button size="sm" className="shrink-0" icon={<UserCheck className="h-4 w-4" />} loading={act.isPending && act.variables?.id === a.appointment_id}
                      onClick={() => act.mutate({ id: a.appointment_id, action: 'check-in', body: { version: a.version } })}><span className="hidden sm:inline">{t('registrar.checkIn')}</span><span className="sm:hidden">{t('registrar.q.arrived')}</span></Button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
