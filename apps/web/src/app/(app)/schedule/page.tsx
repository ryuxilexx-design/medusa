'use client';
import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight, LayoutGrid, List } from 'lucide-react';
import { APPOINTMENT_STATUS_LABEL } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtTime, fullName, localDate, longDate, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, cx, EmptyState, ErrorState, Input, LoadingRows, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { AppointmentStatus, SourceMark } from '@/components/status';
import { AppointmentDialog } from '@/components/appointment-dialog';
import { BookingInit, BookingModal } from '@/components/booking';

const START = 8 * 60, END = 18 * 60, ROW = 30, PX = 48; // 30-min rows
const CARD_STYLE: Record<string, string> = {
  scheduled: 'border-sky-300 bg-sky-50', arrived: 'border-amber-300 bg-amber-50', in_progress: 'border-violet-300 bg-violet-50',
  completed: 'border-emerald-300 bg-emerald-50', cancelled: 'border-slate-200 bg-slate-50 opacity-60', no_show: 'border-red-200 bg-red-50 opacity-70',
};
const mins = (d: string) => { const t = fmtTime(d); return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); };

export default function SchedulePage() { return <Suspense><Schedule /></Suspense>; }

function Schedule() {
  const { me, branchId, demoNow } = useSession();
  const sp = useSearchParams();
  const [date, setDate] = useState(sp.get('date') ?? me.today);
  const [doctorId, setDoctorId] = useState(me.role === 'doctor' ? me.doctor_id! : '');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<any>(null);
  const [booking, setBooking] = useState<BookingInit | null>(null);
  const staff = me.role === 'manager' || me.role === 'registrar';

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api('/doctors').then((r) => r.data as any[]) });
  const appts = useQuery({ queryKey: ['appointments', date, branchId, doctorId], queryFn: () => api(`/appointments${qs({ date, branch_id: branchId, doctor_id: doctorId })}`).then((r) => r.data as any[]), refetchInterval: 30_000 });
  const wd = new Date(date + 'T00:00:00Z').getUTCDay();
  const columns = useMemo(() => {
    const list = (doctors.data ?? []).filter((d) => {
      if (doctorId && d.id !== doctorId) return false;
      const s = d.schedule?.find((x: any) => x.weekday === wd);
      const hasAppts = appts.data?.some((a) => a.doctor_id === d.id);
      return hasAppts || (s && (!branchId || s.branch_id === branchId) && me.branches.some((b) => b.id === s.branch_id) && d.service_ids?.length && d.specialty !== 'Laboratoriya mutaxassisi');
    });
    return list.map((d) => ({ ...d, day: d.schedule?.find((x: any) => x.weekday === wd) }));
  }, [doctors.data, appts.data, doctorId, branchId, wd, me.branches]);
  const visible = (a: any) => !status || a.status === status;
  const nowMin = date === me.today ? mins(demoNow().toISOString()) : -1;
  const counts = (appts.data ?? []).reduce((acc: Record<string, number>, a) => { acc[a.status] = (acc[a.status] ?? 0) + 1; return acc; }, {});

  return (
    <>
      <PageHeader title={me.role === 'doctor' ? 'Mening jadvalim' : 'Qabul jadvali'} subtitle={longDate(date)}
        actions={staff && <Button variant="primary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setBooking({ date })}>Qabulga yozish</Button>} />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2.5">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Oldingi kun" onClick={() => setDate(addDays(date, -1))}><ChevronLeft className="h-4 w-4" /></Button>
            <Input type="date" aria-label="Sana" className="h-8 w-[150px] text-[13px]" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Button size="sm" variant="ghost" aria-label="Keyingi kun" onClick={() => setDate(addDays(date, 1))}><ChevronRight className="h-4 w-4" /></Button>
            {date !== me.today && <Button size="sm" onClick={() => setDate(me.today)}>Bugun</Button>}
          </div>
          {me.role !== 'doctor' && (
            <Select aria-label="Shifokor" className="h-8 w-auto text-[13px]" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">Barcha shifokorlar</option>
              {doctors.data?.filter((d) => d.service_ids?.length).map((d) => <option key={d.id} value={d.id}>{d.display_name} — {d.specialty}</option>)}
            </Select>
          )}
          <Select aria-label="Holat" className="h-8 w-auto text-[13px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Barcha holatlar ({appts.data?.length ?? 0})</option>
            {Object.entries(APPOINTMENT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v} ({counts[k] ?? 0})</option>)}
          </Select>
          <div className="ml-auto flex rounded-md border border-slate-300 p-0.5">
            <button className={cx('rounded px-2 py-1 text-[13px]', view === 'grid' ? 'bg-slate-100 font-medium' : 'text-slate-500')} onClick={() => setView('grid')} aria-pressed={view === 'grid'}><LayoutGrid className="mr-1 inline h-3.5 w-3.5" />Kunlik</button>
            <button className={cx('rounded px-2 py-1 text-[13px]', view === 'list' ? 'bg-slate-100 font-medium' : 'text-slate-500')} onClick={() => setView('list')} aria-pressed={view === 'list'}><List className="mr-1 inline h-3.5 w-3.5" />Ro‘yxat</button>
          </div>
        </div>
        {appts.isLoading || doctors.isLoading ? <LoadingRows rows={8} /> : appts.isError ? <ErrorState error={appts.error} onRetry={() => appts.refetch()} /> : view === 'list' ? (
          !appts.data!.filter(visible).length ? <EmptyState title="Bu kunda qabul yo‘q" action={staff && <Button variant="primary" onClick={() => setBooking({ date })}>Qabulga yozish</Button>} /> : (
            <Table>
              <thead><tr><Th>Vaqt</Th><Th>Bemor</Th><Th>Shifokor</Th><Th>Xizmat</Th><Th>Filial</Th><Th>Holat</Th><Th right>Amal</Th></tr></thead>
              <tbody>{appts.data!.filter(visible).map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <Td className="whitespace-nowrap tabular-nums font-medium">{fmtTime(a.starts_at)}–{fmtTime(a.ends_at)}</Td>
                  <Td>{fullName(a)} <span className="text-slate-500">{pid(a.patient_number)}</span></Td>
                  <Td>{a.doctor_name}</Td><Td>{a.service_name}</Td><Td>{a.branch_name}</Td><Td><AppointmentStatus status={a.status} /><SourceMark appt={a} /></Td>
                  <Td right><Button size="sm" variant="ghost" onClick={() => setSelected(a)}>Ochish</Button></Td>
                </tr>
              ))}</tbody>
            </Table>
          )
        ) : !columns.length ? <EmptyState title="Bu kunda tanlangan filialda ishlaydigan shifokor yo‘q" /> : (
          <div className="overflow-x-auto">
            <div className="flex min-w-full">
              <div className="sticky left-0 z-10 w-14 shrink-0 border-r border-slate-100 bg-white">
                <div className="h-12 border-b border-slate-100" />
                {Array.from({ length: (END - START) / ROW }).map((_, i) => <div key={i} style={{ height: PX }} className="border-b border-slate-50 pr-1.5 pt-0.5 text-right text-2xs tabular-nums text-slate-400">{String(Math.floor((START + i * ROW) / 60)).padStart(2, '0')}:{String((START + i * ROW) % 60).padStart(2, '0')}</div>)}
              </div>
              {columns.map((d) => {
                const s = d.day; const ws = s ? Number(s.start.slice(0, 2)) * 60 + Number(s.start.slice(3)) : END; const we = s ? Number(s.end.slice(0, 2)) * 60 + Number(s.end.slice(3)) : END;
                const bs = s?.break_start ? Number(s.break_start.slice(0, 2)) * 60 + Number(s.break_start.slice(3)) : -1; const be = s?.break_end ? Number(s.break_end.slice(0, 2)) * 60 + Number(s.break_end.slice(3)) : -1;
                const list = appts.data!.filter((a) => a.doctor_id === d.id);
                return (
                  <div key={d.id} className="min-w-[138px] flex-1 basis-0 border-r border-slate-100">
                    <div className="h-12 border-b border-slate-100 px-2 py-1.5 leading-tight">
                      <div className="truncate text-[13px] font-semibold text-slate-800">{d.display_name}</div>
                      <div className="truncate text-2xs text-slate-500">{d.specialty}{s ? ` · ${s.room ?? ''}` : ' · ishlamaydi'}</div>
                    </div>
                    <div className="relative" style={{ height: ((END - START) / ROW) * PX }}>
                      {Array.from({ length: (END - START) / ROW }).map((_, i) => {
                        const t = START + i * ROW;
                        const off = t < ws || t >= we; const brk = t >= bs && t < be;
                        const hh = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
                        const clickable = staff && !off && !brk && (date > me.today || (date === me.today && t + ROW > nowMin));
                        return <div key={i} style={{ height: PX }} onClick={clickable ? () => setBooking({ doctorId: d.id, date, time: hh }) : undefined}
                          className={cx('border-b border-slate-50', off ? 'bg-slate-100/70' : brk ? 'bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_4px,#fff_4px,#fff_8px)]' : clickable ? 'cursor-pointer hover:bg-brand-50/60' : '')}
                          title={off ? 'Ish vaqtidan tashqari' : brk ? 'Tanaffus' : clickable ? `${hh} — qabulga yozish` : undefined} />;
                      })}
                      {nowMin > START && nowMin < END && <div className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-red-400" style={{ top: ((nowMin - START) / ROW) * PX }} />}
                      {list.map((a) => {
                        const st = mins(a.starts_at), en = mins(a.ends_at);
                        return (
                          <button key={a.id} onClick={() => setSelected(a)}
                            className={cx('absolute left-1 right-1 z-[5] overflow-hidden rounded border-l-4 border px-1.5 py-0.5 text-left text-2xs leading-tight shadow-sm transition hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500', CARD_STYLE[a.status], !visible(a) && 'opacity-20')}
                            style={{ top: ((st - START) / ROW) * PX + 1, height: Math.max(((en - st) / ROW) * PX - 2, 22) }}>
                            <div className="flex items-center justify-between gap-1"><span className="font-semibold tabular-nums">{fmtTime(a.starts_at)}</span><span className="truncate text-slate-600">{APPOINTMENT_STATUS_LABEL[a.status as keyof typeof APPOINTMENT_STATUS_LABEL]}</span></div>
                            <div className="truncate font-medium text-slate-800">{fullName(a)}</div>
                            <div className="truncate text-slate-500">{a.service_name}<SourceMark appt={a} /></div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
      {staff && <p className="mt-2 text-xs text-slate-500">Bo‘sh katakni bosib qabulga yozing. Yo‘l-yo‘l — tanaffus, kulrang — ish vaqtidan tashqari. Ko‘chirish qabul kartasi orqali (drag-and-drop keyingi relizda).</p>}
      <AppointmentDialog appt={selected} onClose={() => setSelected(null)} />
      <BookingModal open={!!booking} init={booking ?? undefined} onClose={() => setBooking(null)} />
    </>
  );
}
