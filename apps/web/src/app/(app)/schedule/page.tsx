'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Ban, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, Clock, LayoutGrid, List, PlayCircle, Plus, UserCheck, UserX } from 'lucide-react';
import { APPOINTMENT_STATUS_LABEL, type MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtTime, fullName, longDate, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, cx, EmptyState, ErrorState, FOCUS_RING, FOCUS_RING_INSET, Input, LoadingRows, PageHeader, Segmented, Select, Table, Td, Th, Toolbar } from '@/components/ui';
import { AppointmentStatus, SourceMark } from '@/components/status';
import { AppointmentDialog } from '@/components/appointment-dialog';
import { CameraArrivals } from '@/components/camera-arrivals';
import { BookingInit, BookingModal } from '@/components/booking';
import type { ScheduleException } from '@/components/days-off';
import { useT } from '@/lib/i18n';

// 30-minute rows, 3.5rem each (rem, so the «Katta» text size scales the grid with the text)
const ROW = 30, R = 3.5;
// column header: the doctor's name on up to two lines, specialty, room — the same height in every column and the time rail
const HEAD = 'h-[5.5rem]';
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
  // a phone shows two or three doctor columns at most: the list is the readable default there
  useEffect(() => { if (window.matchMedia('(max-width: 639px)').matches) setView('list'); }, []);
  const [selected, setSelected] = useState<any>(null);
  const [booking, setBooking] = useState<BookingInit | null>(null);
  const staff = me.role === 'manager' || me.role === 'registrar';

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api('/doctors').then((r) => r.data as any[]) });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api('/services').then((r) => r.data as any[]) });
  const appts = useQuery({ queryKey: ['appointments', date, branchId, doctorId], queryFn: () => api(`/appointments${qs({ date, branch_id: branchId, doctor_id: doctorId })}`).then((r) => r.data as any[]), refetchInterval: 30_000 });
  // days off, vacations, clinic holidays and custom hours of this day (the booking rules on the server use the same rows)
  const exceptions = useQuery({ queryKey: ['schedule-exceptions', 'day', date], queryFn: () => api(`/schedule-exceptions?from=${date}&to=${date}`).then((r) => r.data as ScheduleException[]) });
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
    return list.map((d) => {
      const s = d.schedule?.find((x: any) => x.weekday === wd);
      // the doctor's own entry wins over a clinic-wide one; a branch holiday applies only where the doctor works that day
      const exc = (exceptions.data ?? []).find((e) => e.doctor_id === d.id) ?? (exceptions.data ?? []).find((e) => !e.doctor_id && (!e.branch_id || e.branch_id === s?.branch_id));
      const off = exc && exc.kind !== 'custom_hours' ? exc : null;
      const day = s && exc?.kind === 'custom_hours' ? { ...s, start: exc.start_time, end: exc.end_time, break_start: null, break_end: null, custom: true } : s;
      return { ...d, day: off ? null : day, off };
    });
  }, [doctors.data, services.data, appts.data, exceptions.data, doctorId, branchId, wd, me.branches]);
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
        actions={<>
          {/* day grid / list: a glass segmented control in the control layer, the height of the primary button */}
          <Segmented variant="glass" role="tablist" label={t('registrar.view')} value={view} onChange={setView}
            options={[{ value: 'grid', icon: <LayoutGrid className="h-4 w-4" aria-hidden="true" />, label: t('registrar.viewDay') }, { value: 'list', icon: <List className="h-4 w-4" aria-hidden="true" />, label: t('registrar.viewList') }]} />
          {staff && <Button variant="primary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setBooking({ date })}>{t('registrar.book')}</Button>}
        </>} />
      <CameraArrivals />
      <Card padded={false}>
        <Toolbar>
          <div className="flex items-center gap-1">
            <Button size="icon" aria-label={t('registrar.prevDay')} title={t('registrar.prevDay')} onClick={() => setDate(addDays(date, -1))}><ChevronLeft className="h-5 w-5" /></Button>
            <Input type="date" aria-label={t('registrar.date')} className="w-[9.75rem]" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Button size="icon" aria-label={t('registrar.nextDay')} title={t('registrar.nextDay')} onClick={() => setDate(addDays(date, 1))}><ChevronRight className="h-5 w-5" /></Button>
          </div>
          {date !== me.today && <Button onClick={() => setDate(me.today)}>{t('registrar.today')}</Button>}
          {me.role !== 'doctor' && (
            <Select aria-label={t('registrar.doctor')} className="w-full min-w-0 sm:w-auto sm:max-w-[13rem]" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">{t('registrar.allDoctors')}</option>
              {doctors.data?.filter((d) => d.service_ids?.length).map((d) => <option key={d.id} value={d.id}>{d.display_name} — {d.specialty}</option>)}
            </Select>
          )}
          <Select aria-label={t('registrar.status')} className="w-full min-w-0 sm:w-auto sm:max-w-[15rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('registrar.allStatuses', { n: appts.data?.length ?? 0 })}</option>
            {Object.keys(APPOINTMENT_STATUS_LABEL).map((k) => <option key={k} value={k}>{statusWord(k)} ({counts[k] ?? 0})</option>)}
          </Select>
        </Toolbar>
        {appts.isLoading || doctors.isLoading ? <LoadingRows rows={8} /> : appts.isError ? <ErrorState error={appts.error} onRetry={() => appts.refetch()} /> : view === 'list' ? (
          !appts.data!.filter(visible).length ? <EmptyState title={t('registrar.noApptsDay')} action={staff && <Button variant="primary" onClick={() => setBooking({ date })}>{t('registrar.book')}</Button>} /> : (
            <Table>
              <thead><tr><Th>{t('registrar.time')}</Th><Th>{t('registrar.patient')}</Th><Th className="hidden sm:table-cell">{t('registrar.doctor')}</Th><Th className="hidden lg:table-cell">{t('registrar.service')}</Th>{showBranch && <Th className="hidden 2xl:table-cell">{t('registrar.branch')}</Th>}<Th className="hidden sm:table-cell">{t('registrar.status')}</Th><Th right className="hidden sm:table-cell"><span className="sr-only">{t('registrar.action')}</span></Th></tr></thead>
              <tbody>{appts.data!.filter(visible).map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={(e) => { if (!(e.target as HTMLElement).closest('button,a')) setSelected(a); }}>
                  <Td className="whitespace-nowrap align-top font-semibold tabular-nums sm:align-middle">{fmtTime(a.starts_at)}<span className="hidden sm:inline">–{fmtTime(a.ends_at)}</span></Td>
                  <Td className="min-w-[10rem] [overflow-wrap:anywhere]"><span className="font-medium text-slate-900">{fullName(a)}</span> <span className="whitespace-nowrap tabular-nums text-slate-600">{pid(a.patient_number)}</span>
                    {/* phone: the doctor and the status under the name (the row opens the visit) */}
                    <div className="text-small text-slate-600 sm:hidden">{a.doctor_name}</div><div className="mt-1 sm:hidden"><AppointmentStatus status={a.status} /><SourceMark appt={a} /></div></Td>
                  <Td className="hidden whitespace-nowrap sm:table-cell">{a.doctor_name}</Td>
                  <Td className="hidden text-slate-700 lg:table-cell">{a.service_name}</Td>
                  {showBranch && <Td className="hidden whitespace-nowrap text-slate-700 2xl:table-cell">{a.branch_name}</Td>}
                  <Td className="hidden whitespace-nowrap sm:table-cell"><AppointmentStatus status={a.status} /><SourceMark appt={a} /></Td>
                  <Td right className="hidden !py-1.5 sm:table-cell"><Button size="sm" variant="ghost" className="text-slate-700 hover:bg-slate-100 hover:text-brand-800" onClick={() => setSelected(a)}>{t('registrar.open')}</Button></Td>
                </tr>
              ))}</tbody>
            </Table>
          )
        ) : !columns.length ? <EmptyState title={t('registrar.noDoctorsDay')} /> : (
          <>
            <div className="overflow-x-auto">
              <div className="flex min-w-full">
                <div className="sticky left-0 z-sticky w-14 shrink-0 border-r border-slate-100 bg-white">
                  <div className={cx(HEAD, 'border-b border-slate-200')} />
                  {Array.from({ length: rows }).map((_, i) => <div key={i} style={{ height: `${R}rem` }} className="border-b border-slate-50 pr-1.5 pt-0.5 text-right text-xs tabular-nums text-slate-600">{hhmm(START + i * ROW)}</div>)}
                </div>
                {columns.map((d) => {
                  const s = d.day; const ws = s ? hm(s.start) : END; const we = s ? hm(s.end) : END;
                  const bs = s?.break_start ? hm(s.break_start) : -1; const be = s?.break_end ? hm(s.break_end) : -1;
                  const list = appts.data!.filter((a) => a.doctor_id === d.id);
                  // a day off shows its reason (and note) in the header instead of the room; the whole column is grey
                  const offReason = d.off ? `${t(`admin.off.kind.${d.off.kind}` as MessageKey)}${d.off.note ? ` · ${d.off.note}` : ''}` : null;
                  const room = offReason ?? (s ? [s.room, s.custom ? t('registrar.customHours') : null].filter(Boolean).join(', ') : t('registrar.notWorking'));
                  return (
                    <div key={d.id} className="min-w-[8rem] flex-1 basis-0 border-r border-slate-100 last:border-r-0">
                      <div className={cx(HEAD, 'border-b border-slate-200 px-2 py-2 text-small leading-tight', d.off && 'bg-slate-100/70')} title={[d.display_name, d.specialty, room].filter(Boolean).join(', ')}>
                        <div className="line-clamp-2 break-words font-bold text-slate-900">{d.display_name}</div>
                        <div className="mt-0.5 truncate text-slate-600">{d.specialty}</div>
                        {room && <div className={cx('truncate', s ? 'text-slate-600' : 'font-medium text-amber-800')}>{room}</div>}
                      </div>
                      <div className="relative" style={{ height: `${rows * R}rem` }}>
                        {Array.from({ length: rows }).map((_, i) => {
                          const m = START + i * ROW;
                          const off = m < ws || m >= we; const brk = m >= bs && m < be;
                          // an empty slot is a button only where no visit card lies over it (never a button under a card);
                          // a slot under a cancelled/missed card is booked with «Qabulga yozish»
                          const over = list.filter((a) => mins(a.starts_at) < m + ROW && Math.max(mins(a.ends_at), mins(a.starts_at) + 5) > m);
                          const clickable = staff && !off && !brk && !over.length && (date > me.today || (date === me.today && m + ROW > nowMin));
                          const cell = cx('block border-b border-slate-50', off ? 'bg-slate-100/70' : brk ? 'hatch' : '');
                          return clickable
                            ? <div key={i} style={{ height: `${R}rem` }} className={cell}>
                                <button type="button" onClick={() => setBooking({ doctorId: d.id, date, time: hhmm(m) })}
                                  aria-label={`${d.display_name}, ${t('registrar.slotTitle', { time: hhmm(m) })}`} title={t('registrar.slotTitle', { time: hhmm(m) })}
                                  className={cx('group flex h-full cursor-pointer items-start px-1.5 pt-0.5 text-left hover:bg-brand-50 focus-visible:relative focus-visible:z-sticky', FOCUS_RING_INSET, 'w-full')}>
                                  <span className="hidden items-center gap-1 text-small font-semibold text-brand-700 group-hover:inline-flex group-focus-visible:inline-flex" aria-hidden="true"><Plus className="h-3.5 w-3.5" />{hhmm(m)}</span>
                                </button>
                              </div>
                            : <div key={i} style={{ height: `${R}rem` }} className={cx(cell, 'w-full')} title={offReason ?? (off ? t('registrar.offHours') : brk ? t('registrar.break') : undefined)} />;
                        })}
                        {nowMin > START && nowMin < END && <div className="pointer-events-none absolute left-0 right-0 z-sticky border-t-2 border-red-500" style={{ top: `${((nowMin - START) / ROW) * R}rem` }} />}
                        {list.map((a) => {
                          const st = mins(a.starts_at), en = mins(a.ends_at), dur = Math.max(en - st, 5);
                          const [Icon, iconColor] = STATUS_ICON[a.status] ?? [Clock, 'text-slate-600'];
                          const label = `${fmtTime(a.starts_at)}–${fmtTime(a.ends_at)}, ${fullName(a)}, ${a.service_name}, ${statusWord(a.status)}`;
                          // as many lines as the card height holds: from 30 min the name may take two lines (+ the service
                          // from 45 min), from 15 min one line, else time + name on one line; the whole text is in the tooltip
                          const lines = dur >= 30 ? 3 : dur >= 15 ? 2 : 1;
                          return (
                            <button key={a.id} type="button" onClick={() => setSelected(a)} title={label} aria-label={label}
                              className={cx('absolute right-1 z-raised overflow-hidden rounded border border-l-4 px-1.5 py-0.5 text-left text-xs leading-[0.9375rem] text-slate-900 shadow-sm hover:border-slate-500', FOCUS_RING, 'left-1', CARD_STYLE[a.status], !visible(a) && 'opacity-20')}
                              style={{ top: `calc(${((st - START) / ROW) * R}rem + 1px)`, height: `calc(${(dur / ROW) * R}rem - 2px)` }}>
                              <div className="flex items-center gap-1">
                                <span className="font-semibold tabular-nums">{fmtTime(a.starts_at)}</span>
                                {lines === 1 && <span className="min-w-0 flex-1 truncate font-medium">{fullName(a)}</span>}
                                <SourceMark appt={a} />
                                <Icon className={cx('ml-auto h-3.5 w-3.5 shrink-0', iconColor)} aria-hidden="true" />
                              </div>
                              {lines >= 2 && <div className={cx('font-medium', lines >= 3 ? 'line-clamp-2' : 'truncate', a.status === 'cancelled' && 'line-through')}>{fullName(a)}</div>}
                              {lines >= 3 && dur >= 45 && <div className="truncate text-slate-600">{a.service_name}</div>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 px-5 py-3 text-small text-slate-700" aria-label={t('registrar.legend')}>
              {Object.keys(APPOINTMENT_STATUS_LABEL).map((k) => {
                const [Icon, color] = STATUS_ICON[k];
                return <li key={k} className="inline-flex items-center gap-1.5"><span className={cx('inline-flex h-5 w-6 items-center justify-center rounded border border-l-4', CARD_STYLE[k])} aria-hidden="true"><Icon className={cx('h-3 w-3', color)} /></span>{statusWord(k)}</li>;
              })}
              <li className="inline-flex items-center gap-1.5"><span className="hatch inline-block h-5 w-6 rounded border border-slate-200" aria-hidden="true" />{t('registrar.break')}</li>
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
