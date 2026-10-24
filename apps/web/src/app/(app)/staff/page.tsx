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
import { Badge, Button, Card, cx, EmptyState, ErrorState, LoadingRows, PageHeader, scrollBehavior, Table, Td, TextLink, Th } from '@/components/ui';
import { AppointmentStatus } from '@/components/status';
import { StaffFormModal, TempPasswordModal, type StaffRow } from '@/components/staff-form';
import { ScheduleEditor } from '@/components/schedule-editor';
import { DaysOff } from '@/components/days-off';

export default function StaffPage() { return <Suspense><Staff /></Suspense>; }

/** How the person signs in. Only what needs attention is a coloured badge (locked, temporary password); the rest is plain text. */
function Access({ s }: { s: StaffRow }) {
  const t = useT();
  if (s.locked) return <Badge tone="red">{t('admin.staff.locked')}</Badge>;
  if (s.has_password && s.must_change_password) return <Badge tone="yellow">{t('admin.staff.tempPassword')}</Badge>;
  const text = !s.has_password ? t(s.demo_card ? 'admin.staff.demoCard' : 'admin.staff.noPassword')
    : s.last_login_at ? fmtDateTime(s.last_login_at) : t('admin.staff.neverLoggedIn');
  return <span className="whitespace-nowrap text-small text-slate-600">{text}</span>;
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
  const { me } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const sel = sp.get('doctor');
  const q = useQuery({ queryKey: ['staff'], queryFn: () => api('/staff').then((r) => r.data as StaffRow[]) });
  const [editing, setEditing] = useState<StaffRow | 'new' | null>(null);
  const [issued, setIssued] = useState<{ name: string; login: string; temp_password: string } | null>(null);
  const rows = q.data?.filter((s) => s.membership_id) ?? [];
  const active = rows.filter((s) => s.status === 'active');
  const pick = (id: string) => router.replace(`/staff?doctor=${id}`, { scroll: false });
  // a person working in every branch: one short word instead of a list of names
  const branches = (s: StaffRow) => (s.branch_names?.length && me.branches.length > 1 && s.branch_names.length >= me.branches.length ? t('admin.staff.allBranches') : s.branch_names?.join(', ') ?? '—');
  return (
    <>
      <PageHeader title={t('admin.staff.title')}
        subtitle={q.data ? t('admin.staff.subtitle', { doctors: active.filter((s) => s.role === 'doctor').length, others: active.filter((s) => s.role !== 'doctor').length }) : undefined}
        actions={<Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setEditing('new')}>{t('admin.staff.add')}</Button>} />
      <div className="flex flex-col gap-5">
        {sel && <DoctorDetail id={sel} onClose={() => router.replace('/staff', { scroll: false })} />}
        <Card padded={false}>
          {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <Table>
              <thead><tr>
                <Th>{t('admin.staff.colName')}</Th><Th className="hidden sm:table-cell">{t('admin.staff.colRole')}</Th><Th className="hidden md:table-cell">{t('admin.staff.colBranch')}</Th>
                <Th className="hidden lg:table-cell">{t('admin.staff.colAccess')}</Th><Th className="hidden sm:table-cell">{t('admin.staff.colStatus')}</Th><Th right><span className="sr-only">{t('admin.staff.colActions')}</span></Th>
              </tr></thead>
              <tbody>{rows.map((s) => (
                <tr key={s.membership_id} onClick={s.doctor_id ? () => pick(s.doctor_id!) : undefined}
                  className={cx(s.doctor_id && 'cursor-pointer hover:bg-slate-50', sel && sel === s.doctor_id && 'bg-brand-50 hover:bg-brand-50 [&>td:first-child]:shadow-selected')}>
                  <Td className="min-w-[11rem]">
                    <div className="flex items-baseline gap-1.5">
                      {s.doctor_id
                        ? <TextLink onClick={(e) => { e.stopPropagation(); pick(s.doctor_id!); }} aria-current={sel === s.doctor_id || undefined} className="text-left">{s.full_name}</TextLink>
                        : <span className="font-semibold text-slate-900">{s.full_name}</span>}
                      {s.is_self && <span className="text-small text-slate-600">{t('admin.staff.self')}</span>}
                    </div>
                    {/* second line: login on wide screens, role on a phone (the role column is hidden there) */}
                    {s.login && <div className="hidden truncate text-small text-slate-600 sm:block">{showLogin(s.login)}</div>}
                    <div className="truncate text-small text-slate-600 sm:hidden">{t(`role.${s.role}` as MessageKey)}{s.specialty ? `, ${s.specialty}` : ''}</div>
                    {s.status !== 'active' && <div className="mt-1 sm:hidden"><StaffStatus active={false} /></div>}
                  </Td>
                  <Td className="hidden sm:table-cell">
                    <div className="text-slate-900">{t(`role.${s.role}` as MessageKey)}{s.specialty && <span className="text-slate-600">, {s.specialty}</span>}</div>
                    {s.doctor_id && !s.has_schedule && s.status === 'active' && <div className="text-small font-semibold text-amber-800">{t('admin.staff.noSchedule')}</div>}
                  </Td>
                  <Td className="hidden max-w-[14rem] truncate text-slate-700 md:table-cell">{branches(s)}</Td>
                  <Td className="hidden lg:table-cell"><Access s={s} /></Td>
                  <Td className="hidden sm:table-cell"><StaffStatus active={s.status === 'active'} /></Td>
                  <Td right>
                    <Button size="sm" variant="ghost" aria-label={t('admin.staff.editAria', { name: s.full_name })} icon={<Pencil className="h-4 w-4" />} onClick={(e) => { e.stopPropagation(); setEditing(s); }}>
                      <span className="hidden xl:inline">{t('admin.set.edit')}</span>
                    </Button>
                  </Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      </div>
      <StaffFormModal open={editing !== null} staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onIssued={setIssued} />
      <TempPasswordModal issued={issued} onClose={() => setIssued(null)} />
    </>
  );
}

/** Doctor card above the list: weekly schedule, today's patients, share for the last 30 days. */
function DoctorDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { me } = useSession();
  const [editSchedule, setEditSchedule] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const from = addDays(me.today, -29);
  const q = useQuery({ queryKey: ['staff', 'doctor', id], queryFn: () => api(`/staff/doctors/${id}?from=${from}&to=${me.today}`).then((r) => r.data) });
  const today = useQuery({ queryKey: ['appointments', 'staff', id, me.today], queryFn: () => api(`/appointments?date=${me.today}&doctor_id=${id}`).then((r) => r.data as any[]) });
  // the card opens above the list: bring it into view when another doctor is picked further down
  useEffect(() => { if ((top.current?.getBoundingClientRect().top ?? 0) < 0 || window.scrollY > 200) top.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }); }, [id]);
  if (q.isLoading) return <div ref={top} className="scroll-mt-24"><Card><LoadingRows rows={4} /></Card></div>;
  if (q.isError) return <div ref={top} className="scroll-mt-24"><Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card></div>;
  const d = q.data;
  const total = d.services.reduce((a: number, s: any) => a + s.line_total, 0), share = d.services.reduce((a: number, s: any) => a + s.share, 0);
  return (
    <div ref={top} className="flex scroll-mt-24 flex-col gap-5">
      <Card
        title={<span className="flex flex-wrap items-baseline gap-x-2">{d.doctor.display_name}<span className="text-body font-normal text-slate-600">{d.doctor.specialty} · {t('admin.doc.defaultShare', { p: Number(d.doctor.default_share_percent) })}</span></span>}
        actions={<Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} onClick={onClose}>{t('admin.staff.closeDetail')}</Button>}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <section className="min-w-0">
            <div className="mb-2 flex min-h-9 flex-wrap items-center justify-between gap-2">
              <h3 className="text-body font-bold text-slate-900">{t('admin.doc.schedule')}</h3>
              {me.role === 'manager' && <Button size="sm" icon={<CalendarClock className="h-4 w-4" />} onClick={() => setEditSchedule(true)}>{t('admin.doc.editSchedule')}</Button>}
            </div>
            {!d.schedule.length ? <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900">{t('admin.doc.noSchedule')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-slate-200 text-small text-slate-600">
                    <th scope="col" className="py-2 pr-3 font-semibold">{t('admin.doc.colDay')}</th><th scope="col" className="py-2 pr-3 font-semibold">{t('admin.doc.colHours')}</th>
                    <th scope="col" className="hidden py-2 pr-3 font-semibold sm:table-cell">{t('admin.doc.colBreak')}</th><th scope="col" className="py-2 font-semibold">{t('admin.doc.colPlace')}</th>
                  </tr></thead>
                  <tbody>{d.schedule.map((s: any) => (
                    <tr key={s.weekday} className="border-b border-slate-100 last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 font-medium text-slate-900">{weekdayName(s.weekday)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{s.start}–{s.end}</td>
                      <td className="hidden whitespace-nowrap py-2 pr-3 tabular-nums text-slate-600 sm:table-cell">{s.break_start ? `${s.break_start}–${s.break_end}` : '—'}</td>
                      <td className="py-2 text-slate-700">{s.branch_name}{s.room_name && <span className="text-slate-600">, {s.room_name}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <h3 className="mb-2 mt-5 flex min-h-9 items-center text-body font-bold text-slate-900">{t('admin.off.title')}</h3>
            <DaysOff doctorId={d.doctor.id} canEdit={me.role === 'manager'} />
          </section>
          <section className="min-w-0">
            <h3 className="mb-2 flex min-h-9 items-center text-body font-bold text-slate-900">{t('admin.doc.today')}</h3>
            {today.isLoading ? <LoadingRows rows={3} /> : !today.data?.length ? <p className="py-2 text-sm text-slate-600">{t('admin.doc.noToday')}</p> : (
              <ul className="divide-y divide-slate-100 border-t border-slate-200">{today.data.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="w-12 shrink-0 font-medium tabular-nums">{fmtTime(a.starts_at)}</span>
                  <span className="min-w-[9rem] flex-1"><span className="block truncate font-medium text-slate-900">{fullName(a)}</span><span className="block truncate text-small text-slate-600">{a.service_name}</span></span>
                  <AppointmentStatus status={a.status} />
                </li>
              ))}</ul>
            )}
          </section>
        </div>
        {me.role === 'manager' && <ScheduleEditor open={editSchedule} onClose={() => setEditSchedule(false)} doctor={{ id: d.doctor.id, display_name: d.doctor.display_name, branch_ids: d.doctor.branch_ids }} schedule={d.schedule} />}
      </Card>

      <Card title={t('admin.doc.shareTitle')} padded={false}>
        <dl className="grid grid-cols-1 divide-y divide-slate-100 border-b border-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {([[t('admin.doc.services'), d.services.length], [t('admin.doc.value'), formatSom(total)], [t('admin.doc.share'), formatSom(share)]] as const).map(([k, v]) => (
            <div key={k} className="flex min-w-0 items-baseline justify-between gap-3 px-5 py-2.5 sm:block sm:py-3">
              <dt className="truncate text-small font-semibold text-slate-600">{k}</dt>
              <dd className="whitespace-nowrap text-lg font-bold tabular-nums text-slate-900 sm:mt-1">{v}</dd>
            </div>
          ))}
        </dl>
        {!d.services.length ? <EmptyState compact title={t('admin.doc.noServices')} /> : (
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <thead><tr><Th>{t('admin.doc.colDate')}</Th><Th>{t('admin.doc.colService')}</Th><Th right className="hidden sm:table-cell">{t('admin.doc.colValue')}</Th><Th right className="hidden sm:table-cell">%</Th><Th right>{t('admin.doc.colShare')}</Th></tr></thead>
              <tbody>{d.services.map((s: any) => (
                <tr key={s.id}>
                  <Td className="whitespace-nowrap tabular-nums text-slate-700">{fmtDateTime(s.performed_at)}</Td><Td className="min-w-[10rem]">{s.service_name}</Td>
                  <Td right className="hidden sm:table-cell">{formatSom(s.line_total)}</Td><Td right className="hidden text-slate-600 sm:table-cell">{Number(s.share_percent_snapshot)}</Td><Td right className="font-medium">{formatSom(s.share)}</Td>
                </tr>
              ))}</tbody>
            </Table>
          </div>
        )}
        <p className="border-t border-slate-100 px-5 py-3 text-small text-slate-600">{t('admin.doc.shareNote')}</p>
      </Card>
    </div>
  );
}
