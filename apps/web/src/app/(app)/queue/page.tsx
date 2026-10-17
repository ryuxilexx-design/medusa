'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PlayCircle, RefreshCw, UserCheck } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { duration, fmtTime, fullName, longDate, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingRows, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { AppointmentStatus } from '@/components/status';
import { useAppointmentAction } from '@/components/appointment-dialog';

export default function QueuePage() {
  const { me, branchId, demoNow } = useSession();
  const router = useRouter();
  const [doctorId, setDoctorId] = useState('');
  const act = useAppointmentAction();
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api('/doctors').then((r) => r.data as any[]), enabled: me.role !== 'doctor' });
  const q = useQuery({ queryKey: ['queue', branchId, doctorId], queryFn: () => api(`/queue${qs({ branch_id: branchId, doctor_id: doctorId })}`).then((r) => r.data), refetchInterval: 12_000 });
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  const staff = me.role === 'manager' || me.role === 'registrar';
  // Waiting time = now − arrival; once the visit starts the stored value is final.
  const waitOf = (t: any) => t.wait_seconds ?? (t.started_at ? null : Math.max(0, Math.round((+demoNow() - +new Date(t.arrived_at)) / 1000)));
  const active = q.data?.tickets.filter((t: any) => ['arrived', 'in_progress'].includes(t.status)) ?? [];
  const done = q.data?.tickets.filter((t: any) => !['arrived', 'in_progress'].includes(t.status)) ?? [];

  return (
    <>
      <PageHeader title="Jonli navbat" subtitle={`${longDate(me.today)} · har 12 soniyada yangilanadi`}
        actions={<>
          {me.role !== 'doctor' && <Select aria-label="Shifokor" className="h-9 w-auto text-sm" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">Barcha shifokorlar</option>{doctors.data?.filter((d) => d.service_ids?.length).map((d) => <option key={d.id} value={d.id}>{d.display_name}</option>)}
          </Select>}
          <Button icon={<RefreshCw className={q.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />} onClick={() => q.refetch()}>Yangilash</Button>
        </>} />
      {q.isLoading ? <Card><LoadingRows /></Card> : q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2" padded={false} title={<>Navbatda <Badge tone="yellow" className="ml-1">{active.length}</Badge></>}>
            {!active.length ? <EmptyState title="Hozir navbatda bemor yo‘q" text={staff ? 'O‘ng tomondagi kutilayotgan bemorlar uchun «Keldi» ni bosing.' : undefined} /> : (
              <Table>
                <thead><tr><Th>№</Th><Th>Bemor</Th><Th>Shifokor / xona</Th><Th>Keldi</Th><Th>Kutish</Th><Th>Holat</Th><Th right>Amal</Th></tr></thead>
                <tbody>{active.map((t: any) => {
                  const w = waitOf(t);
                  return (
                    <tr key={t.id} className={t.status === 'in_progress' ? 'bg-violet-50/40' : ''}>
                      <Td><span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-sm font-bold tabular-nums text-white">{t.number}</span></Td>
                      <Td><div className="font-medium">{fullName(t)}</div><div className="text-xs text-slate-500">{pid(t.patient_number)} · qabul {fmtTime(t.starts_at)}</div></Td>
                      <Td><div>{t.doctor_name}</div><div className="text-xs text-slate-500">{t.room_name ?? t.branch_name}</div></Td>
                      <Td className="tabular-nums">{fmtTime(t.arrived_at)}</Td>
                      <Td className={w != null && w > 1800 && !t.started_at ? 'font-medium text-red-700' : ''}>{t.started_at ? `${duration(t.wait_seconds)} (yakuniy)` : duration(w)}</Td>
                      <Td><AppointmentStatus status={t.status} /></Td>
                      <Td right>
                        {me.role === 'doctor' && t.status === 'arrived' && <Button size="sm" variant="primary" icon={<PlayCircle className="h-3.5 w-3.5" />} onClick={() => router.push(`/doctor?appointment=${t.appointment_id}`)}>Qabulni boshlash</Button>}
                        {me.role === 'doctor' && t.status === 'in_progress' && <Button size="sm" onClick={() => router.push(`/doctor?appointment=${t.appointment_id}`)}>Ochish</Button>}
                        {me.role !== 'doctor' && <Link href={`/patients/${t.patient_id}`} className="text-[13px] font-medium text-brand-700 hover:underline">Profil</Link>}
                      </Td>
                    </tr>
                  );
                })}</tbody>
              </Table>
            )}
            {done.length > 0 && <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Bugun yakunlangan/bekor: {done.length} ta · {done.slice(-6).map((t: any) => `№${t.number}`).join(', ')}</div>}
          </Card>
          <Card padded={false} title={<>Bugun kutilmoqda <Badge tone="blue" className="ml-1">{q.data.expected.length}</Badge></>}>
            {!q.data.expected.length ? <EmptyState title="Bugun boshqa rejalashtirilgan qabul yo‘q" /> : (
              <ul className="divide-y divide-slate-100">
                {q.data.expected.map((a: any) => (
                  <li key={a.appointment_id} className="flex items-center gap-3 px-4 py-2">
                    <span className="w-11 text-sm font-semibold tabular-nums">{fmtTime(a.starts_at)}</span>
                    <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-sm font-medium">{fullName(a)}</div><div className="truncate text-xs text-slate-500">{a.doctor_name} · {a.service_name}</div></div>
                    {staff && <Button size="sm" variant="primary" icon={<UserCheck className="h-3.5 w-3.5" />} loading={act.isPending && act.variables?.id === a.appointment_id}
                      onClick={() => act.mutate({ id: a.appointment_id, action: 'check-in', body: { version: a.version } })}>Keldi</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">Ichki navbat ekrani. Navbat raqami filial va kun doirasida takrorlanmaydi; jamoat monitori keyingi relizda.</p>
    </>
  );
}
