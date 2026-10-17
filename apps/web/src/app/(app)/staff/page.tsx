'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABEL } from '@meduza/contracts';
import { api } from '@/lib/api';
import { addDays, fmtDateTime, formatSom, fullName, WEEKDAYS } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Card, cx, EmptyState, ErrorState, LoadingRows, PageHeader, Table, Td, Th, DemoTag } from '@/components/ui';
import { AppointmentStatus } from '@/components/status';

export default function StaffPage() { return <Suspense><Staff /></Suspense>; }

function Staff() {
  const sp = useSearchParams();
  const router = useRouter();
  const sel = sp.get('doctor');
  const q = useQuery({ queryKey: ['staff'], queryFn: () => api('/staff').then((r) => r.data as any[]) });
  return (
    <>
      <PageHeader title="Xodimlar" subtitle="8 shifokor va ma’muriy xodimlar · shifokorni tanlab jadval va ulushini ko‘ring" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card padded={false}>
          {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <Table>
              <thead><tr><Th>F.I.Sh.</Th><Th>Rol / mutaxassislik</Th><Th>Filial</Th><Th>Holat</Th></tr></thead>
              <tbody>{q.data!.filter((s) => s.membership_id).map((s) => (
                <tr key={s.membership_id} onClick={s.doctor_id ? () => router.replace(`/staff?doctor=${s.doctor_id}`) : undefined} className={cx(s.doctor_id && 'cursor-pointer hover:bg-slate-50', sel && sel === s.doctor_id && 'bg-brand-50')}>
                  <Td className="font-medium">{s.full_name}</Td>
                  <Td>{ROLE_LABEL[s.role as keyof typeof ROLE_LABEL]}{s.specialty ? <span className="text-slate-500"> · {s.specialty}</span> : ''}</Td>
                  <Td className="text-slate-600">{s.branch_names?.join(', ')}</Td>
                  <Td>{s.status === 'active' ? <Badge tone="green">Faol</Badge> : <Badge>Nofaol</Badge>}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
        {sel ? <DoctorDetail id={sel} /> : <Card><EmptyState title="Shifokorni tanlang" text="Jadval, bugungi qabullar va hisoblangan ulush ko‘rinadi." /></Card>}
      </div>
    </>
  );
}

function DoctorDetail({ id }: { id: string }) {
  const { me } = useSession();
  const from = addDays(me.today, -29);
  const q = useQuery({ queryKey: ['staff', 'doctor', id], queryFn: () => api(`/staff/doctors/${id}?from=${from}&to=${me.today}`).then((r) => r.data) });
  const today = useQuery({ queryKey: ['appointments', 'staff', id, me.today], queryFn: () => api(`/appointments?date=${me.today}&doctor_id=${id}`).then((r) => r.data as any[]) });
  if (q.isLoading) return <Card><LoadingRows /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const d = q.data;
  const total = d.services.reduce((a: number, s: any) => a + s.line_total, 0), share = d.services.reduce((a: number, s: any) => a + s.share, 0);
  return (
    <div className="space-y-4">
      <Card title={`${d.doctor.display_name} · ${d.doctor.specialty}`} actions={<span className="text-xs text-slate-500">Standart ulush: {d.doctor.default_share_percent}%</span>}>
        <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Ish jadvali</h3>
        <table className="w-full text-sm"><tbody>{d.schedule.map((s: any) => (
          <tr key={s.weekday} className="border-t border-slate-100"><td className="py-1 w-28">{WEEKDAYS[s.weekday]}</td><td className="tabular-nums">{s.start}–{s.end}</td><td className="text-slate-500">{s.break_start ? `tanaffus ${s.break_start}–${s.break_end}` : ''}</td><td>{s.branch_name}{s.room_name ? ` · ${s.room_name}` : ''}</td></tr>
        ))}</tbody></table>
        <p className="mt-2 text-xs text-slate-500">Bir shifokor bir vaqtda ikki filialda band bo‘la olmaydi (server tekshiruvi). Jadvalni tahrirlash keyingi relizda.</p>
      </Card>
      <Card title="Bugungi qabullar" padded={false}>
        {today.isLoading ? <LoadingRows rows={3} /> : !today.data?.length ? <EmptyState title="Bugun qabul yo‘q" /> : (
          <ul className="divide-y divide-slate-100">{today.data.map((a) => <li key={a.id} className="flex items-center gap-3 px-4 py-1.5 text-sm"><span className="w-12 tabular-nums">{fmtDateTime(a.starts_at).slice(11)}</span><span className="flex-1 truncate">{fullName(a)} · {a.service_name}</span><AppointmentStatus status={a.status} /></li>)}</ul>
        )}
      </Card>
      <Card title={<span className="flex items-center gap-2">Hisoblangan ulush · oxirgi 30 kun <DemoTag>Demo hisob-kitob</DemoTag></span>} padded={false}>
        <div className="flex gap-6 border-b border-slate-100 px-4 py-2 text-sm"><span>Xizmatlar: <b>{d.services.length}</b></span><span>Qiymat: <b className="tabular-nums">{formatSom(total)}</b></span><span>Hisoblangan ulush: <b className="tabular-nums">{formatSom(share)}</b></span></div>
        <div className="max-h-72 overflow-y-auto">
          <Table>
            <thead><tr><Th>Sana</Th><Th>Xizmat</Th><Th right>Qiymat</Th><Th right>%</Th><Th right>Ulush</Th></tr></thead>
            <tbody>{d.services.map((s: any) => <tr key={s.id}><Td className="whitespace-nowrap">{fmtDateTime(s.performed_at)}</Td><Td>{s.service_name}</Td><Td right>{formatSom(s.line_total)}</Td><Td right>{Number(s.share_percent_snapshot)}</Td><Td right>{formatSom(s.share)}</Td></tr>)}</tbody>
          </Table>
        </div>
        <p className="px-4 py-2 text-xs text-slate-500">Ulush = chegirmadan keyingi qiymat × xizmat paytidagi foiz snapshoti. To‘langan maosh emas; soliq, avans va vedomost keyingi bosqichda.</p>
      </Card>
    </div>
  );
}
