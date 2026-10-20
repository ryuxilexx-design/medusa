'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Pencil, UserPlus } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { addDays, fmtDateTime, formatPhone, formatSom, fullName, weekdayName } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, cx, EmptyState, ErrorState, LoadingRows, PageHeader, Table, Td, Th, DemoTag } from '@/components/ui';
import { AppointmentStatus } from '@/components/status';
import { StaffFormModal, TempPasswordModal, type StaffRow } from '@/components/staff-form';
import { ScheduleEditor } from '@/components/schedule-editor';

export default function StaffPage() { return <Suspense><Staff /></Suspense>; }

/** How the person signs in — shown so the manager sees who still has a temporary password or is locked. */
function AccessBadge({ s }: { s: StaffRow }) {
  const t = useT();
  if (s.locked) return <Badge tone="red">{t('admin.staff.locked')}</Badge>;
  if (!s.has_password) return s.demo_card ? <Badge>{t('admin.staff.demoCard')}</Badge> : <Badge>{t('admin.staff.noPassword')}</Badge>;
  if (s.must_change_password) return <Badge tone="yellow">{t('admin.staff.tempPassword')}</Badge>;
  return <span className="text-xs text-slate-600">{s.last_login_at ? t('admin.staff.lastLogin', { at: fmtDateTime(s.last_login_at) }) : t('admin.staff.neverLoggedIn')}</span>;
}

const showLogin = (l: string | null) => (l ? (l.startsWith('+998') ? formatPhone(l) : l) : '');

function Staff() {
  const t = useT();
  const sp = useSearchParams();
  const router = useRouter();
  const sel = sp.get('doctor');
  const q = useQuery({ queryKey: ['staff'], queryFn: () => api('/staff').then((r) => r.data as StaffRow[]) });
  const [editing, setEditing] = useState<StaffRow | 'new' | null>(null);
  const [issued, setIssued] = useState<{ name: string; login: string; temp_password: string } | null>(null);
  const rows = q.data?.filter((s) => s.membership_id) ?? [];
  const active = rows.filter((s) => s.status === 'active');
  return (
    <>
      <PageHeader title={t('admin.staff.title')}
        subtitle={q.data ? t('admin.staff.subtitle', { doctors: active.filter((s) => s.role === 'doctor').length, others: active.filter((s) => s.role !== 'doctor').length }) : undefined}
        actions={<Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setEditing('new')}>{t('admin.staff.add')}</Button>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card padded={false}>
          {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <Table>
              <thead><tr><Th>{t('admin.staff.colName')}</Th><Th>{t('admin.staff.colRole')}</Th><Th>{t('admin.staff.colBranch')}</Th><Th>{t('admin.staff.colAccess')}</Th><Th>{t('admin.staff.colStatus')}</Th><Th /></tr></thead>
              <tbody>{rows.map((s) => (
                <tr key={s.membership_id} onClick={s.doctor_id ? () => router.replace(`/staff?doctor=${s.doctor_id}`) : undefined} className={cx(s.doctor_id && 'cursor-pointer hover:bg-slate-50', sel && sel === s.doctor_id && 'bg-brand-50', s.status !== 'active' && 'text-slate-600')}>
                  <Td className="font-medium">{s.full_name}{s.is_self && <span className="ml-1 text-xs font-normal text-slate-600">{t('admin.staff.self')}</span>}
                    {s.login && <div className="text-xs font-normal text-slate-600">{showLogin(s.login)}</div>}</Td>
                  <Td>{t(`role.${s.role}` as MessageKey)}{s.specialty ? <span className="text-slate-600">, {s.specialty}</span> : ''}
                    {s.doctor_id && !s.has_schedule && s.status === 'active' && <div><Badge tone="yellow">{t('admin.staff.noSchedule')}</Badge></div>}</Td>
                  <Td className="text-slate-600">{s.branch_names?.join(', ')}</Td>
                  <Td><AccessBadge s={s} /></Td>
                  <Td>{s.status === 'active' ? <Badge tone="green">{t('admin.staff.active')}</Badge> : <Badge>{t('admin.staff.inactive')}</Badge>}</Td>
                  <Td right><Button size="sm" variant="ghost" aria-label={t('admin.staff.editAria', { name: s.full_name })} icon={<Pencil className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); setEditing(s); }} /></Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
        {sel ? <DoctorDetail id={sel} /> : <Card><EmptyState title={t('admin.staff.pickDoctor')} text={t('admin.staff.pickDoctorText')} /></Card>}
      </div>
      <StaffFormModal open={editing !== null} staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onIssued={setIssued} />
      <TempPasswordModal issued={issued} onClose={() => setIssued(null)} />
    </>
  );
}

function DoctorDetail({ id }: { id: string }) {
  const t = useT();
  const { me } = useSession();
  const [editSchedule, setEditSchedule] = useState(false);
  const from = addDays(me.today, -29);
  const q = useQuery({ queryKey: ['staff', 'doctor', id], queryFn: () => api(`/staff/doctors/${id}?from=${from}&to=${me.today}`).then((r) => r.data) });
  const today = useQuery({ queryKey: ['appointments', 'staff', id, me.today], queryFn: () => api(`/appointments?date=${me.today}&doctor_id=${id}`).then((r) => r.data as any[]) });
  if (q.isLoading) return <Card><LoadingRows /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const d = q.data;
  const total = d.services.reduce((a: number, s: any) => a + s.line_total, 0), share = d.services.reduce((a: number, s: any) => a + s.share, 0);
  return (
    <div className="space-y-4">
      <Card title={`${d.doctor.display_name}, ${d.doctor.specialty}`} actions={<span className="text-xs text-slate-600">{t('admin.doc.defaultShare', { p: d.doctor.default_share_percent })}</span>}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[0.8125rem] font-semibold text-slate-600">{t('admin.doc.schedule')}</h3>
          {me.role === 'manager' && <Button size="sm" icon={<CalendarClock className="h-4 w-4" />} onClick={() => setEditSchedule(true)}>{t('admin.doc.editSchedule')}</Button>}
        </div>
        {!d.schedule.length && <p className="py-2 text-sm text-amber-800">{t('admin.doc.noSchedule')}</p>}
        <table className="w-full text-sm"><tbody>{d.schedule.map((s: any) => (
          <tr key={s.weekday} className="border-t border-slate-100"><td className="py-1 w-28">{weekdayName(s.weekday)}</td><td className="tabular-nums">{s.start}–{s.end}</td><td className="text-slate-600">{s.break_start ? t('admin.doc.break', { from: s.break_start, to: s.break_end }) : ''}</td><td>{s.branch_name}{s.room_name ? `, ${s.room_name}` : ''}</td></tr>
        ))}</tbody></table>
        <p className="mt-2 text-xs text-slate-600">{t('admin.doc.scheduleRule')}</p>
        {me.role === 'manager' && <ScheduleEditor open={editSchedule} onClose={() => setEditSchedule(false)} doctor={{ id: d.doctor.id, display_name: d.doctor.display_name, branch_ids: d.doctor.branch_ids }} schedule={d.schedule} />}
      </Card>
      <Card title={t('admin.doc.today')} padded={false}>
        {today.isLoading ? <LoadingRows rows={3} /> : !today.data?.length ? <EmptyState title={t('admin.doc.noToday')} /> : (
          <ul className="divide-y divide-slate-100">{today.data.map((a) => <li key={a.id} className="flex items-center gap-3 px-4 py-1.5 text-sm"><span className="w-12 tabular-nums">{fmtDateTime(a.starts_at).slice(11)}</span><span className="flex-1 truncate">{fullName(a)}, {a.service_name}</span><AppointmentStatus status={a.status} /></li>)}</ul>
        )}
      </Card>
      <Card title={<span className="flex items-center gap-2">{t('admin.doc.shareTitle')} <DemoTag>{t('admin.doc.demoCalc')}</DemoTag></span>} padded={false}>
        <div className="flex gap-6 border-b border-slate-100 px-4 py-2 text-sm"><span>{t('admin.doc.services')} <b>{d.services.length}</b></span><span>{t('admin.doc.value')} <b className="tabular-nums">{formatSom(total)}</b></span><span>{t('admin.doc.share')} <b className="tabular-nums">{formatSom(share)}</b></span></div>
        <div className="max-h-72 overflow-y-auto">
          <Table>
            <thead><tr><Th>{t('admin.doc.colDate')}</Th><Th>{t('admin.doc.colService')}</Th><Th right>{t('admin.doc.colValue')}</Th><Th right>%</Th><Th right>{t('admin.doc.colShare')}</Th></tr></thead>
            <tbody>{d.services.map((s: any) => <tr key={s.id}><Td className="whitespace-nowrap">{fmtDateTime(s.performed_at)}</Td><Td>{s.service_name}</Td><Td right>{formatSom(s.line_total)}</Td><Td right>{Number(s.share_percent_snapshot)}</Td><Td right>{formatSom(s.share)}</Td></tr>)}</tbody>
          </Table>
        </div>
        <p className="px-4 py-2 text-xs text-slate-600">{t('admin.doc.shareNote')}</p>
      </Card>
    </div>
  );
}
