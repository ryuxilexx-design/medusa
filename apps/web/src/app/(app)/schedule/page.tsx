'use client';
import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Ban, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, Clock, LayoutGrid, List, PlayCircle, Plus, UserCheck, UserX } from 'lucide-react';
import { APPOINTMENT_STATUS_LABEL, type MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtTime, fullName, longDate, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, cx, EmptyState, ErrorState, Input, LoadingRows, PageHeader, Select, Table, Td, Th, Toolbar } from '@/components/ui';
import { AppointmentStatus, SourceMark } from '@/components/status';
import { AppointmentDialog } from '@/components/appointment-dialog';
import { CameraArrivals } from '@/components/camera-arrivals';
import { BookingInit, BookingModal } from '@/components/booking';
import { useT } from '@/lib/i18n';

// 30-minute rows, 3.5rem each (rem, so the «Katta» text size scales the grid with the text)
const ROW = 30, R = 3.5;
const CARD_STYLE: Record<string, string> = {
  scheduled: 'border-sky-300 bg-sky-50', arrived: 'border-amber-300 bg-amber-50', in_progress: 'border-violet-300 bg-violet-50',
  completed: 'border-emerald-300 bg-emerald-50', cancelled: 'border-slate-300 bg-slate-100', no_show: 'border-red-300 bg-red-50',
};
// status on a narrow card = colour + icon (the same icons as the status badges); the word is in the legend, the title and aria-label
const STATUS_ICON: Record<string, [React.ComponentType<{ className?: string }>, string]> = {
  scheduled: [Clock, 'text-sky-700'], arrived: [UserCheck, 'text-amber-700'], in_progress: [PlayCircle, 'text-violet-700'],
  completed: [CheckCircle2, 'text-emerald-700'], cancelled: [Ban, 'text-slate-600'], no_show: [UserX, 'text-red-700'],
};
const mins = (d: string) => { const t = fmtTime(d); return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); };
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function SchedulePage() { return <Suspense><Schedule /></Suspense>; }

function Schedule() {
  const { me, branchId, demoNow } = useSession();
  const t = useT();
  const sp = useSearchParams();
  const [date, setDate] = useState(sp.get('date') ?? me.today);
  const [doctorId, setDoctorId] = useState(me.role === 'doctor' ? me.doctor_id! : '');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<any>(null);
  const [booking, setBooking] = useState<BookingInit | null>(null);
  const staff = me.role === 'manager' || me.role === 'registrar';

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api('/doctors').then((r) => r.data as any[]) });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api('/services').then((r) => r.data as any[]) });
  const appts = useQuery({ queryKey: ['appointments', date, branchId, doctorId], queryFn: () => api(`/appointments${qs({ date, branch_id: branchId, doctor_id: doctorId })}`).then((r) => r.data as any[]), refetchInterval: 30_000 });
  const wd = new Date(date + 'T00:00:00Z').getUTCDay();
  const columns = useMemo(() => {
    const category = new Map((services.data ?? []).map((s) => [s.id, s.category]));
    // staff who only run lab tests have no visits to book: they are not a column (unless they already have appointments)
    const labOnly = (d: any) => category.size > 0 && d.service_ids.every((id: string) => category.get(id) === 'lab');
    const list = (doctors.data ?? []).filter((d) => {
      if (doctorId && d.id !== doctorId) return false;
      const s = d.schedule?.find((x: any) => x.weekday === wd);
      const hasAppts = appts.data?.some((a) => a.doctor_id === d.id);
      return hasAppts || (s && (!branchId || s.branch_id === branchId) && me.branches.some((b) => b.id === s.branch_id) && d.service_ids?.length && !labOnly(d));
    });
    return list.map((d) => ({ ...d, day: d.schedule?.find((x: any) => x.weekday === wd) }));
  }, [doctors.data, services.data, appts.data, doctorId, branchId, wd, me.branches]);
  // the grid spans every working hour and every appointment of the day (never cuts a 07:30 or 19:00 visit off)
  const [START, END] = useMemo(() => {
    let lo = 8 * 60, hi = 18 * 60;
    for (const c of columns) if (c.day) { lo = Math.min(lo, hm(c.day.start)); hi = Math.max(hi, hm(c.day.end)); }
    for (const a of appts.data ?? []) { const st = mins(a.starts_at), en = mins(a.ends_at); lo = Math.min(lo, st); if (en > st) hi = Math.max(hi, en); }
    return [Math.floor(lo / ROW) * ROW, Math.ceil(hi / ROW) * ROW];
  }, [columns, appts.data]);
  const rows = (END - START) / ROW;
  const statusWord = (s: string) => t(`status.appointment.${s}` as MessageKey);
  const visible = (a: any) => !status || a.status === status;
  const nowMin = date === me.today ? mins(demoNow().toISOString()) : -1;
  // the branch column only says something when several branches are shown together
  const showBranch = !branchId && me.branches.length > 1;
  const counts = (appts.data ?? []).reduce((acc: Record<string, number>, a) => { acc[a.status] = (acc[a.status] ?? 0) + 1; return acc; }, {});

  return (
    <>
      <PageHeader title={me.role === 'doctor' ? t('registrar.mySchedule') : t('registrar.schedule')} subtitle={longDate(date)}
        actions={staff && <Button variant="primary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setBooking({ date })}>{t('registrar.book')}</Button>} />
      <CameraArrivals />
      <Card padded={false}>
        <Toolbar>
          <div className="flex items-center gap-1">
            <Button className="!px-2.5" aria-label={t('registrar.prevDay')} title={t('registrar.prevDay')} onClick={() => setDate(addDays(date, -1))}><ChevronLeft className="h-5 w-5" /></Button>
            <Input type="date" aria-label={t('registrar.date')} className="w-[9.75rem]" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Button className="!px-2.5" aria-label={t('registrar.nextDay')} title={t('registrar.nextDay')} onClick={() => setDate(addDays(date, 1))}><ChevronRight className="h-5 w-5" /></Button>
          </div>
          {date !== me.today && <Button onClick={() => setDate(me.today)}>{t('registrar.today')}</Button>}
          {me.role !== 'doctor' && (
            <Select aria-label={t('registrar.doctor')} className="w-full min-w-0 sm:w-auto sm:max-w-[13rem]" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">{t('registrar.allDoctors')}</option>
              {doctors.data?.filter((d) => d.service_ids?.length).map((d) => <option key={d.id} value={d.id}>{d.display_name} — {d.specialty}</option>)}
            </Select>
          )}
          <Select aria-label={t('registrar.status')} className="w-full min-w-0 sm:w-auto sm:max-w-[11rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('registrar.allStatuses', { n: appts.data?.length ?? 0 })}</option>
            {Object.keys(APPOINTMENT_STATUS_LABEL).map((k) => <option key={k} value={k}>{statusWord(k)} ({counts[k] ?? 0})</option>)}
          </Select>
          <div role="group" aria-label={t('registrar.view')} className="inline-flex rounded-lg sm:ml-auto border-2 border-slate-300 bg-slate-50 p-0.5">
            {([['grid', LayoutGrid, t('registrar.viewDay')], ['list', List, t('registrar.viewList')]] as const).map(([v, Icon, label]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                className={cx('inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-[0.9375rem] font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300',
                  view === v ? 'bg-white text-brand-800 shadow-sm ring-1 ring-brand-200' : 'text-slate-600 hover:text-slate-900')}>
                <Icon className="hidden h-4 w-4 2xl:block" aria-hidden="true" />{label}
              </button>
            ))}
          </div>
        </Toolbar>
        {appts.isLoading || doctors.isLoading ? <LoadingRows rows={8} /> : appts.isError ? <ErrorState error={appts.error} onRetry={() => appts.refetch()} /> : view === 'list' ? (
          !appts.data!.filter(visible).length ? <EmptyState title={t('registrar.noApptsDay')} action={staff && <Button variant="primary" onClick={() => setBooking({ date })}>{t('registrar.book')}</Button>} /> : (
            <Table>
              <thead><tr><Th>{t('registrar.time')}</Th><Th>{t('registrar.patient')}</Th><Th>{t('registrar.doctor')}</Th><Th className="hidden lg:table-cell">{t('registrar.service')}</Th>{showBranch && <Th className="hidden 2xl:table-cell">{t('registrar.branch')}</Th>}<Th>{t('registrar.status')}</Th><Th right><span className="sr-only">{t('registrar.action')}</span></Th></tr></thead>
              <tbody>{appts.data!.filter(visible).map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={(e) => { if (!(e.target as HTMLElement).closest('button,a')) setSelected(a); }}>
                  <Td className="whitespace-nowrap font-semibold tabular-nums">{fmtTime(a.starts_at)}–{fmtTime(a.ends_at)}</Td>
                  <Td className="whitespace-nowrap"><span className="font-medium text-slate-900">{fullName(a)}</span> <span className="tabular-nums text-slate-600">{pid(a.patient_number)}</span></Td>
                  <Td className="whitespace-nowrap">{a.doctor_name}</Td>
                  <Td className="hidden text-slate-700 lg:table-cell">{a.service_name}</Td>
                  {showBranch && <Td className="hidden whitespace-nowrap text-slate-700 2xl:table-cell">{a.branch_name}</Td>}
                  <Td className="whitespace-nowrap"><AppointmentStatus status={a.status} /><SourceMark appt={a} /></Td>
                  <Td right className="!py-1.5"><Button size="sm" variant="ghost" className="text-slate-700 hover:bg-slate-100 hover:text-brand-800" onClick={() => setSelected(a)}>{t('registrar.open')}</Button></Td>
                </tr>
              ))}</tbody>
            </Table>
          )
        ) : !columns.length ? <EmptyState title={t('registrar.noDoctorsDay')} /> : (
          <>
            <div className="overflow-x-auto">
              <div className="flex min-w-full">
                <div className="sticky left-0 z-10 w-14 shrink-0 border-r border-slate-100 bg-white">
                  <div className="h-[4.5rem] border-b border-slate-200" />
                  {Array.from({ length: rows }).map((_, i) => <div key={i} style={{ height: `${R}rem` }} className="border-b border-slate-50 pr-1.5 pt-0.5 text-right text-xs tabular-nums text-slate-600">{hhmm(START + i * ROW)}</div>)}
                </div>
                {columns.map((d) => {
                  const s = d.day; const ws = s ? hm(s.start) : END; const we = s ? hm(s.end) : END;
                  const bs = s?.break_start ? hm(s.break_start) : -1; const be = s?.break_end ? hm(s.break_end) : -1;
                  const list = appts.data!.filter((a) => a.doctor_id === d.id);
                  const room = s ? s.room : t('registrar.notWorking');
                  return (
                    <div key={d.id} className="min-w-[7.25rem] flex-1 basis-0 border-r border-slate-100 last:border-r-0">
                      <div className="h-[4.5rem] border-b border-slate-200 px-2 py-2 leading-tight" title={[d.display_name, d.specialty, room].filter(Boolean).join(', ')}>
                        <div className="truncate text-[0.8125rem] font-bold text-slate-900">{d.display_name}</div>
                        <div className="mt-0.5 truncate text-[0.8125rem] text-slate-600">{d.specialty}</div>
                        {room && <div className={cx('truncate text-[0.8125rem]', s ? 'text-slate-600' : 'font-medium text-amber-800')}>{room}</div>}
                      </div>
                      <div className="relative" style={{ height: `${rows * R}rem` }}>
                        {Array.from({ length: rows }).map((_, i) => {
                          const m = START + i * ROW;
                          const off = m < ws || m >= we; const brk = m >= bs && m < be;
                          const clickable = staff && !off && !brk && (date > me.today || (date === me.today && m + ROW > nowMin));
                          const cell = cx('block w-full border-b border-slate-50', off ? 'bg-slate-100/70' : brk ? 'bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_4px,#fff_4px,#fff_8px)]' : '');
                          return clickable
                            ? <button key={i} type="button" style={{ height: `${R}rem` }} onClick={() => setBooking({ doctorId: d.id, date, time: hhmm(m) })}
                                aria-label={`${d.display_name}, ${t('registrar.slotTitle', { time: hhmm(m) })}`} title={t('registrar.slotTitle', { time: hhmm(m) })}
                                className={cx(cell, 'group cursor-pointer px-1.5 text-left hover:bg-brand-50 focus-visible:relative focus-visible:z-[6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300')}>
                                <span className="hidden items-center gap-1 text-[0.8125rem] font-semibold text-brand-700 group-hover:inline-flex group-focus-visible:inline-flex" aria-hidden="true"><Plus className="h-3.5 w-3.5" />{hhmm(m)}</span>
                              </button>
                            : <div key={i} style={{ height: `${R}rem` }} className={cell} title={off ? t('registrar.offHours') : brk ? t('registrar.break') : undefined} />;
                        })}
                        {nowMin > START && nowMin < END && <div className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-red-500" style={{ top: `${((nowMin - START) / ROW) * R}rem` }} />}
                        {list.map((a) => {
                          const st = mins(a.starts_at), en = mins(a.ends_at), dur = Math.max(en - st, 5);
                          const [Icon, iconColor] = STATUS_ICON[a.status] ?? [Clock, 'text-slate-600'];
                          const label = `${fmtTime(a.starts_at)}–${fmtTime(a.ends_at)}, ${fullName(a)}, ${a.service_name}, ${statusWord(a.status)}`;
                          // as many lines as the card height holds: 3 from 30 min, 2 from 15 min, else time + name on one line
                          const lines = dur >= 30 ? 3 : dur >= 15 ? 2 : 1;
                          return (
                            <button key={a.id} type="button" onClick={() => setSelected(a)} title={label} aria-label={label}
                              className={cx('absolute left-1 right-1 z-[5] overflow-hidden rounded border border-l-4 px-1.5 py-0.5 text-left text-xs leading-[0.9375rem] text-slate-900 shadow-sm transition hover:shadow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300', CARD_STYLE[a.status], !visible(a) && 'opacity-20')}
                              style={{ top: `calc(${((st - START) / ROW) * R}rem + 1px)`, height: `calc(${(dur / ROW) * R}rem - 2px)` }}>
                              <div className="flex items-center gap-1">
                                <span className="font-semibold tabular-nums">{fmtTime(a.starts_at)}</span>
                                {lines === 1 && <span className="min-w-0 flex-1 truncate font-medium">{fullName(a)}</span>}
                                {lines < 3 && <SourceMark appt={a} />}
                                <Icon className={cx('ml-auto h-3.5 w-3.5 shrink-0', iconColor)} aria-hidden="true" />
                              </div>
                              {lines >= 2 && <div className={cx('truncate font-medium', a.status === 'cancelled' && 'line-through')}>{fullName(a)}</div>}
                              {lines >= 3 && <div className="truncate text-slate-600">{a.service_name}<SourceMark appt={a} /></div>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 px-5 py-3 text-[0.8125rem] text-slate-700" aria-label={t('registrar.legend')}>
              {Object.keys(APPOINTMENT_STATUS_LABEL).map((k) => {
                const [Icon, color] = STATUS_ICON[k];
                return <li key={k} className="inline-flex items-center gap-1.5"><span className={cx('inline-flex h-5 w-6 items-center justify-center rounded border border-l-4', CARD_STYLE[k])} aria-hidden="true"><Icon className={cx('h-3 w-3', color)} /></span>{statusWord(k)}</li>;
              })}
              <li className="inline-flex items-center gap-1.5"><span className="inline-block h-5 w-6 rounded border border-slate-200 bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_4px,#fff_4px,#fff_8px)]" aria-hidden="true" />{t('registrar.break')}</li>
              <li className="inline-flex items-center gap-1.5"><span className="inline-block h-5 w-6 rounded border border-slate-200 bg-slate-100" aria-hidden="true" />{t('registrar.legendOff')}</li>
            </ul>
          </>
        )}
      </Card>
      <AppointmentDialog appt={selected} onClose={() => setSelected(null)} />
      <BookingModal open={!!booking} init={booking ?? undefined} onClose={() => setBooking(null)} />
    </>
  );
}
