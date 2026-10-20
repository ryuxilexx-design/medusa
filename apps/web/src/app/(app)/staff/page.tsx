'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, MinusCircle, Pencil, UserPlus, X } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { addDays, fmtDateTime, fmtTime, formatPhone, formatSom, fullName, weekdayName } from '@/lib/format';
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
  return <span className="text-[0.8125rem] text-slate-600">{s.last_login_at ? t('admin.staff.lastLogin', { at: fmtDateTime(s.last_login_at) }) : t('admin.staff.neverLoggedIn')}</span>;
}

function StaffStatus({ active }: { active: boolean }) {
  const t = useT();
  return active
    ? <Badge tone="green" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>{t('admin.staff.active')}</Badge>
    : <Badge icon={<MinusCircle className="h-3.5 w-3.5" />}>{t('admin.staff.inactive')}</Badge>;
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
  const pick = (id: string) => router.replace(`/staff?doctor=${id}`, { scroll: false });
  return (
    <>
      <PageHeader title={t('admin.staff.title')}
        subtitle={q.data ? t('admin.staff.subtitle', { doctors: active.filter((s) => s.role === 'doctor').length, others: active.filter((s) => s.role !== 'doctor').length }) : undefined}
        actions={<Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setEditing('new')}>{t('admin.staff.add')}</Button>} />
      {/* side by side only on wide screens; on a laptop the doctor card opens above the full-width list */}
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card padded={false} className="order-2 2xl:order-1">
          {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <Table>
              <thead><tr>
                <Th>{t('admin.staff.colName')}</Th><Th className="hidden sm:table-cell">{t('admin.staff.colRole')}</Th><Th className="hidden md:table-cell">{t('admin.staff.colBranch')}</Th>
                <Th className="hidden lg:table-cell">{t('admin.staff.colAccess')}</Th><Th>{t('admin.staff.colStatus')}</Th><Th><span className="sr-only">{t('admin.set.edit')}</span></Th>
              </tr></thead>
              <tbody>{rows.map((s) => (
                <tr key={s.membership_id} onClick={s.doctor_id ? () => pick(s.doctor_id!) : undefined} className={cx(s.doctor_id && 'cursor-pointer hover:bg-slate-50', sel && sel === s.doctor_id && 'bg-brand-50', s.status !== 'active' && 'text-slate-600')}>
                  <Td className="font-medium">
                    {s.doctor_id
                      ? <button type="button" onClick={(e) => { e.stopPropagation(); pick(s.doctor_id!); }} aria-current={sel === s.doctor_id || undefined}
                          className="rounded text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">{s.full_name}</button>
                      : s.full_name}
                    {s.is_self && <span className="ml-1 text-xs font-normal text-slate-600">{t('admin.staff.self')}</span>}
                    {s.login && <div className="text-[0.8125rem] font-normal text-slate-600">{showLogin(s.login)}</div>}
                    <div className="text-[0.8125rem] font-normal text-slate-700 sm:hidden">{t(`role.${s.role}` as MessageKey)}{s.specialty ? `, ${s.specialty}` : ''}</div>
                  </Td>
                  <Td className="hidden sm:table-cell">{t(`role.${s.role}` as MessageKey)}{s.specialty ? <span className="text-slate-600">, {s.specialty}</span> : ''}
                    {s.doctor_id && !s.has_schedule && s.status === 'active' && <div><Badge tone="yellow">{t('admin.staff.noSchedule')}</Badge></div>}</Td>
                  <Td className="hidden text-slate-600 md:table-cell">{s.branch_names?.map((b) => <div key={b} className="whitespace-nowrap">{b}</div>)}</Td>
                  <Td className="hidden lg:table-cell"><AccessBadge s={s} /></Td>
                  <Td><StaffStatus active={s.status === 'active'} /></Td>
                  <Td right><Button size="sm" variant="ghost" aria-label={t('admin.staff.editAria', { name: s.full_name })} icon={<Pencil className="h-4 w-4" />} onClick={(e) => { e.stopPropagation(); setEditing(s); }} /></Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
        {sel
          ? <div className="order-1 2xl:order-2"><DoctorDetail id={sel} onClose={() => router.replace('/staff', { scroll: false })} /></div>
          : <Card className="order-1 hidden 2xl:order-2 2xl:block"><EmptyState title={t('admin.staff.pickDoctor')} text={t('admin.staff.pickDoctorText')} /></Card>}
      </div>
      <StaffFormModal open={editing !== null} staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onIssued={setIssued} />
      <TempPasswordModal issued={issued} onClose={() => setIssued(null)} />
    </>
  );
}

function DoctorDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { me } = useSession();
  const [editSchedule, setEditSchedule] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const from = addDays(me.today, -29);
  const q = useQuery({ queryKey: ['staff', 'doctor', id], queryFn: () => api(`/staff/doctors/${id}?from=${from}&to=${me.today}`).then((r) => r.data) });
  const today = useQuery({ queryKey: ['appointments', 'staff', id, me.today], queryFn: () => api(`/appointments?date=${me.today}&doctor_id=${id}`).then((r) => r.data as any[]) });
  // below 2xl the card sits above the list: bring it into view when another doctor is picked
  useEffect(() => { if (window.innerWidth < 1536) top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [id]);
  if (q.isLoading) return <div ref={top} className="scroll-mt-24"><Card><LoadingRows /></Card></div>;
  if (q.isError) return <div ref={top} className="scroll-mt-24"><Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card></div>;
  const d = q.data;
  const total = d.services.reduce((a: number, s: any) => a + s.line_total, 0), share = d.services.reduce((a: number, s: any) => a + s.share, 0);
  return (
    <div ref={top} className="grid scroll-mt-24 grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-1">
      <Card title={`${d.doctor.display_name}, ${d.doctor.specialty}`}
        actions={<>
          <span className="whitespace-nowrap text-[0.8125rem] text-slate-600">{t('admin.doc.defaultShare', { p: d.doctor.default_share_percent })}</span>
          <Button size="sm" variant="ghost" className="2xl:hidden" aria-label={t('admin.staff.closeDetail')} icon={<X className="h-4 w-4" />} onClick={onClose} />
        </>}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">{t('admin.doc.schedule')}</h3>
          {me.role === 'manager' && <Button size="sm" icon={<CalendarClock className="h-4 w-4" />} onClick={() => setEditSchedule(true)}>{t('admin.doc.editSchedule')}</Button>}
        </div>
        {!d.schedule.length ? <p className="py-2 text-sm text-amber-800">{t('admin.doc.noSchedule')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="text-[0.8125rem] text-slate-600">
                <th scope="col" className="py-1 pr-3 font-semibold">{t('admin.doc.colDay')}</th><th scope="col" className="py-1 pr-3 font-semibold">{t('admin.doc.colHours')}</th>
                <th scope="col" className="py-1 pr-3 font-semibold">{t('admin.doc.colBreak')}</th><th scope="col" className="py-1 font-semibold">{t('admin.doc.colPlace')}</th>
              </tr></thead>
              <tbody>{d.schedule.map((s: any) => (
                <tr key={s.weekday} className="border-t border-slate-100">
                  <td className="whitespace-nowrap py-1.5 pr-3">{weekdayName(s.weekday)}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{s.start}–{s.end}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums text-slate-600">{s.break_start ? `${s.break_start}–${s.break_end}` : '—'}</td>
                  <td className="py-1.5"><span className="whitespace-nowrap">{s.branch_name}</span>{s.room_name && <>, <span className="whitespace-nowrap">{s.room_name}</span></>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[0.8125rem] text-slate-600">{t('admin.doc.scheduleRule')}</p>
        {me.role === 'manager' && <ScheduleEditor open={editSchedule} onClose={() => setEditSchedule(false)} doctor={{ id: d.doctor.id, display_name: d.doctor.display_name, branch_ids: d.doctor.branch_ids }} schedule={d.schedule} />}
      </Card>
      <Card title={t('admin.doc.today')} padded={false}>
        {today.isLoading ? <LoadingRows rows={3} /> : !today.data?.length ? <EmptyState title={t('admin.doc.noToday')} /> : (
          <ul className="divide-y divide-slate-100">{today.data.map((a) => <li key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm"><span className="w-12 shrink-0 tabular-nums">{fmtTime(a.starts_at)}</span><span className="min-w-0 flex-1 truncate">{fullName(a)}, {a.service_name}</span><AppointmentStatus status={a.status} /></li>)}</ul>
        )}
      </Card>
      <Card className="lg:col-span-2 2xl:col-span-1" title={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">{t('admin.doc.shareTitle')} <span className="whitespace-nowrap"><DemoTag>{t(me.demo ? 'admin.doc.demoCalc' : 'admin.doc.estimateCalc')}</DemoTag></span></span>} padded={false}>
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-100 px-4 py-2 text-sm">
          <span>{t('admin.doc.services')} <b className="tabular-nums">{d.services.length}</b></span>
          <span>{t('admin.doc.value')} <b className="whitespace-nowrap tabular-nums">{formatSom(total)}</b></span>
          <span>{t('admin.doc.share')} <b className="whitespace-nowrap tabular-nums">{formatSom(share)}</b></span>
        </div>
        <div className="max-h-72 overflow-y-auto">
          <Table>
            <thead><tr><Th>{t('admin.doc.colDate')}</Th><Th>{t('admin.doc.colService')}</Th><Th right>{t('admin.doc.colValue')}</Th><Th right>%</Th><Th right>{t('admin.doc.colShare')}</Th></tr></thead>
            <tbody>{d.services.map((s: any) => <tr key={s.id}><Td className="whitespace-nowrap tabular-nums">{fmtDateTime(s.performed_at)}</Td><Td className="min-w-[10rem]">{s.service_name}</Td><Td right>{formatSom(s.line_total)}</Td><Td right>{Number(s.share_percent_snapshot)}</Td><Td right>{formatSom(s.share)}</Td></tr>)}</tbody>
          </Table>
        </div>
        <p className="px-4 py-2 text-[0.8125rem] text-slate-600">{t('admin.doc.shareNote')}</p>
      </Card>
    </div>
  );
}
