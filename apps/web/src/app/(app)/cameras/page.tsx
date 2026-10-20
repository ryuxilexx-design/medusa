'use client';
import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, DoorOpen, Hourglass, KeyRound, Plus, ShieldAlert, Table2, TrendingUp, UserX,
} from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, duration, fmtDate, fmtDateTime, fmtTime, localMinutes } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, cx, EmptyState, ErrorState, LoadingRows, PageHeader, StatCard, Table, Tabs, Td, Th, Toolbar, useToast } from '@/components/ui';
import { PeriodPicker } from '@/components/finance-extra';
import { type Camera, CameraFormModal, type CamerasList, Devices, FaceCodes, PushAddressModal } from '@/components/camera-devices';

type Tab = 'attendance' | 'traffic' | 'security' | 'codes' | 'devices';
const TABS: Tab[] = ['attendance', 'traffic', 'security', 'codes', 'devices'];
type Period = { from: string; to: string; branchId: string };
const ic = 'h-4 w-4';
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export default function CamerasPage() { return <Suspense><Cameras /></Suspense>; }

/** Manager: Hikvision cameras — staff attendance, people flow, security events, face codes and the devices. */
function Cameras() {
  const t = useT();
  const { me, branchId } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const cams = useQuery({ queryKey: ['cameras', 'list'], queryFn: () => api<CamerasList>('/cameras') });
  const urlTab = sp.get('tab') as Tab;
  // no camera yet and no tab asked for: start where the first one is added
  const tab: Tab = TABS.includes(urlTab) ? urlTab : cams.data && !cams.data.data.length ? 'devices' : 'attendance';
  const setTab = (v: Tab) => router.replace(`${pathname}?tab=${v}`, { scroll: false });
  const [from, setFrom] = useState(addDays(me.today, -6));
  const [to, setTo] = useState(me.today);
  const [alertsOnly, setAlertsOnly] = useState(true);
  const [form, setForm] = useState<{ camera: Camera | null } | null>(null);
  const [pushPath, setPushPath] = useState<string | null>(null);
  const p: Period = { from, to, branchId };
  // loaded on every tab: the open-alerts count sits in the tab label
  const sec = useQuery({ queryKey: ['cameras', 'security', from, to, alertsOnly, branchId], queryFn: () => api<{ data: SecurityRow[]; meta: { open_alerts: number } }>(`/cameras/security${qs({ from, to, branch_id: branchId, alerts_only: alertsOnly ? 1 : 0 })}`), refetchInterval: 60_000, placeholderData: (prev) => prev });
  const openAlerts = sec.data?.meta.open_alerts ?? 0;
  const items: { value: Tab; label: React.ReactNode; count?: number }[] = [
    { value: 'attendance', label: t('cam.tab.attendance') }, { value: 'traffic', label: t('cam.tab.traffic') },
    { value: 'security', label: openAlerts ? <span className="relative inline-flex items-center gap-1.5">{t('cam.tab.security')}<span className="rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">{openAlerts}<span className="sr-only"> {t('cam.sec.alert')}</span></span></span> : t('cam.tab.security') },
    { value: 'codes', label: t('cam.tab.codes') }, { value: 'devices', label: t('cam.tab.devices') },
  ];
  const period = <PeriodPicker from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />;
  return (
    <>
      <PageHeader title={t('cam.title')} subtitle={t('cam.subtitle')}
        actions={<Button variant="primary" icon={<Plus className="h-5 w-5" />} onClick={() => setForm({ camera: null })}>{t('cam.add')}</Button>} />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} items={items} /></div>
      {tab === 'attendance' && <Attendance p={p} period={period} onCodes={() => setTab('codes')} />}
      {tab === 'traffic' && <Traffic p={p} period={period} />}
      {tab === 'security' && <Security q={sec} period={period} alertsOnly={alertsOnly} setAlertsOnly={setAlertsOnly} cameras={cams.data?.data ?? []} />}
      {tab === 'codes' && <FaceCodes />}
      {tab === 'devices' && <Devices q={cams} onEdit={(c) => setForm({ camera: c })} onAdd={() => setForm({ camera: null })} />}
      <CameraFormModal open={!!form} camera={form?.camera ?? null} onClose={() => setForm(null)} onPushPath={setPushPath} />
      <PushAddressModal path={pushPath} onClose={() => setPushPath(null)} />
    </>
  );
}

// ---------- attendance ----------

type AttRow = {
  day: string; membership_id: string; full_name: string; role: string; specialty: string | null; code: string;
  planned_start: string | null; planned_end: string | null; first_at: string | null; last_at: string | null;
  worked_min: number | null; late_min: number | null; status: 'present' | 'late' | 'absent' | 'expected';
};

function AttStatus({ r }: { r: AttRow }) {
  const t = useT();
  if (r.status === 'present') return <Badge tone="green" icon={<CheckCircle2 className={ic} />}>{t('cam.st.present')}</Badge>;
  if (r.status === 'late') return <Badge tone="yellow" icon={<Clock className={ic} />}>{t('cam.st.late', { n: r.late_min ?? 0 })}</Badge>;
  if (r.status === 'absent') return <Badge tone="red" icon={<UserX className={ic} />}>{t('cam.st.absent')}</Badge>;
  return <Badge tone="gray" icon={<Hourglass className={ic} />}>{t('cam.st.expected')}</Badge>;
}

function Attendance({ p, period, onCodes }: { p: Period; period: React.ReactNode; onCodes: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ['cameras', 'attendance', p.from, p.to, p.branchId], queryFn: () => api<{ data: AttRow[]; meta: { present: number; late: number; absent: number; staff_with_codes: number } }>(`/cameras/attendance${qs({ from: p.from, to: p.to, branch_id: p.branchId })}`) });
  const m = q.data?.meta;
  const noCodes = m?.staff_with_codes === 0;
  const [who, setWho] = useState<string | null>(null);
  useEffect(() => setWho(null), [p.from, p.to, p.branchId]);
  // a period of several days: one line per person (days, lateness, absences); a day or one person: the daily rows
  const multi = p.from !== p.to;
  const showDate = multi;
  const rows = (q.data?.data ?? []).filter((r) => !who || r.membership_id === who);
  const summary = multi && !who;
  return (
    <>
      {/* a failed load shows its error once, in the card below; the key numbers then stay away instead of loading forever */}
      {!noCodes && !(q.isError && !m) && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon={<CheckCircle2 />} tone="success" label={t('cam.att.onTime')} loading={q.isPending} value={m?.present} />
          <StatCard icon={<Clock />} label={t('cam.att.late')} loading={q.isPending} value={m?.late} />
          <StatCard icon={<UserX />} tone={m?.absent ? 'danger' : 'default'} label={t('cam.att.absent')} loading={q.isPending} value={m?.absent} />
        </div>
      )}
      <Card padded={false}>
        <Toolbar>{period}</Toolbar>
        {q.isPending ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : noCodes ? (
          <EmptyState compact icon={<KeyRound />} title={t('cam.att.noCodes')} action={<Button icon={<KeyRound className={ic} />} onClick={onCodes}>{t('cam.codes.give')}</Button>} />
        ) : !q.data.data.length ? <EmptyState compact title={t('cam.att.empty')} /> : summary ? <AttSummary rows={q.data.data} onOpen={setWho} /> : (
          <>
          {who && <div className="border-b border-slate-100 px-5 py-2.5"><Button size="sm" variant="ghost" icon={<ChevronLeft className={ic} />} onClick={() => setWho(null)}>{t('cam.sum.back')}</Button></div>}
          <Table>
            <thead><tr>
              {showDate && <Th className="hidden sm:table-cell">{t('cam.col.date')}</Th>}<Th>{t('cam.col.staff')}</Th><Th className="hidden md:table-cell">{t('cam.col.plan')}</Th>
              <Th>{t('cam.col.in')}</Th><Th className="hidden sm:table-cell">{t('cam.col.out')}</Th><Th className="hidden lg:table-cell">{t('cam.col.worked')}</Th><Th>{t('cam.col.status')}</Th>
            </tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.day + r.membership_id}>
                {showDate && <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{fmtDate(r.day)}</Td>}
                <Td className="min-w-[9rem]">{showDate && <div className="text-[0.8125rem] tabular-nums text-slate-600 sm:hidden">{fmtDate(r.day)}</div>}<div className="font-semibold text-slate-900">{r.full_name}</div><div className="text-[0.8125rem] text-slate-600">{t(`role.${r.role}` as MessageKey)}{r.specialty ? `, ${r.specialty}` : ''}</div></Td>
                <Td className="hidden whitespace-nowrap tabular-nums text-slate-700 md:table-cell">{r.planned_start ? `${r.planned_start}–${r.planned_end}` : t('cam.att.noPlan')}</Td>
                <Td className="whitespace-nowrap font-semibold tabular-nums text-slate-900">{fmtTime(r.first_at)}</Td>
                <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{r.last_at && r.last_at !== r.first_at ? fmtTime(r.last_at) : '—'}</Td>
                <Td className="hidden whitespace-nowrap tabular-nums lg:table-cell">{r.worked_min ? duration(r.worked_min * 60) : '—'}</Td>
                <Td className="whitespace-nowrap"><AttStatus r={r} /></Td>
              </tr>
            ))}</tbody>
          </Table>
          </>
        )}
      </Card>
    </>
  );
}

/** Tashkent minutes since midnight of an ISO time. */
const localMin = localMinutes;
/** Rounded first, so 539.7 min reads 09:00 (not 08:00). */
const hhmm = (min: number) => { const m = Math.round(min); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/** One line per person for a period: days at work, late days (with total minutes), absences, average arrival and hours. */
function AttSummary({ rows, onOpen }: { rows: AttRow[]; onOpen: (id: string) => void }) {
  const t = useT();
  const by = new Map<string, AttRow[]>();
  for (const r of rows) by.set(r.membership_id, [...(by.get(r.membership_id) ?? []), r]);
  const people = [...by.values()].map((rs) => {
    const seen = rs.filter((r) => r.first_at);
    const worked = seen.filter((r) => r.worked_min);
    return {
      r: rs[0], days: seen.length, late: rs.filter((r) => r.status === 'late').length, lateMin: rs.reduce((s, r) => s + (r.late_min ?? 0), 0),
      absent: rs.filter((r) => r.status === 'absent').length,
      avgIn: seen.length ? seen.reduce((s, r) => s + localMin(r.first_at!), 0) / seen.length : null,
      avgWorked: worked.length ? worked.reduce((s, r) => s + (r.worked_min ?? 0), 0) / worked.length : null,
    };
  }).sort((a, b) => b.absent - a.absent || b.late - a.late || a.r.full_name.localeCompare(b.r.full_name));
  return (
    <Table>
      <thead><tr>
        <Th>{t('cam.col.staff')}</Th><Th right>{t('cam.sum.days')}</Th><Th right>{t('cam.sum.late')}</Th><Th right>{t('cam.sum.absent')}</Th>
        <Th right className="hidden md:table-cell">{t('cam.sum.avgIn')}</Th><Th right className="hidden lg:table-cell">{t('cam.sum.avgWorked')}</Th><Th><span className="sr-only">{t('cam.col.actions')}</span></Th>
      </tr></thead>
      <tbody>{people.map((x) => (
        <tr key={x.r.membership_id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(x.r.membership_id)}>
          <Td className="min-w-[9rem]"><div className="font-semibold text-slate-900">{x.r.full_name}</div><div className="text-[0.8125rem] text-slate-600">{t(`role.${x.r.role}` as MessageKey)}{x.r.specialty ? `, ${x.r.specialty}` : ''}</div></Td>
          <Td right className="font-semibold text-slate-900">{x.days}</Td>
          <Td right className={x.late ? 'text-amber-800' : 'text-slate-600'}>{x.late}{x.late ? <div className="text-[0.8125rem]">{t('cam.sum.lateMin', { n: x.lateMin })}</div> : null}</Td>
          <Td right className={x.absent ? 'font-semibold text-red-700' : 'text-slate-600'}>{x.absent}</Td>
          <Td right className="hidden md:table-cell">{x.avgIn == null ? '—' : hhmm(x.avgIn)}</Td>
          <Td right className="hidden lg:table-cell">{x.avgWorked == null ? '—' : duration(Math.round(x.avgWorked) * 60)}</Td>
          <Td right><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpen(x.r.membership_id); }} aria-label={`${x.r.full_name}: ${t('cam.sum.open')}`}><span className="hidden sm:inline">{t('cam.sum.open')}</span><ChevronRight className={ic} /></Button></Td>
        </tr>
      ))}</tbody>
    </Table>
  );
}

// ---------- people flow ----------

type TrafficData = { data: { hourly: { hour: number; enter: number; exit: number }[]; daily: { day: string; enter: number; exit: number }[] }; meta: { total_enter: number; avg_per_day: number; busiest_hour: number | null } };

function Traffic({ p, period }: { p: Period; period: React.ReactNode }) {
  const t = useT();
  const q = useQuery({ queryKey: ['cameras', 'traffic', p.from, p.to, p.branchId], queryFn: () => api<TrafficData>(`/cameras/traffic${qs({ from: p.from, to: p.to, branch_id: p.branchId })}`) });
  const m = q.data?.meta;
  const empty = !!q.data && !q.data.data.daily.some((d) => d.enter || d.exit);
  return (
    <>
      {!(q.isError && !m) && <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={<DoorOpen />} label={t('cam.tr.total')} loading={q.isPending} value={m?.total_enter} />
        <StatCard icon={<CalendarDays />} label={t('cam.tr.avg')} loading={q.isPending} value={m?.avg_per_day} />
        <StatCard icon={<TrendingUp />} label={t('cam.tr.busiest')} loading={q.isPending} value={m && (m.busiest_hour == null ? '—' : `${hh(m.busiest_hour)}–${hh(m.busiest_hour + 1)}`)} />
      </div>}
      <Card padded={false}>
        <Toolbar>{period}</Toolbar>
        {q.isPending ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : empty ? <EmptyState compact title={t('cam.tr.empty')} /> : (
          <div className="grid grid-cols-1 xl:grid-cols-3">
            <HourlyChart rows={q.data.data.hourly} busiest={m?.busiest_hour ?? null} />
            <section aria-labelledby="tr-daily-h" className="border-t border-slate-100 xl:border-l xl:border-t-0">
              <h2 id="tr-daily-h" className="flex min-h-14 items-center px-5 text-base font-bold text-slate-900">{t('cam.tr.byDay')}</h2>
              <Table className="max-h-80 overflow-y-auto">
                <thead><tr><Th>{t('cam.col.date')}</Th><Th right>{t('cam.col.entered')}</Th><Th right>{t('cam.col.exited')}</Th></tr></thead>
                <tbody>{q.data.data.daily.map((d) => <tr key={d.day}><Td className="whitespace-nowrap tabular-nums">{fmtDate(d.day)}</Td><Td right className="font-semibold">{d.enter}</Td><Td right>{d.exit}</Td></tr>)}</tbody>
              </Table>
            </section>
          </div>
        )}
      </Card>
    </>
  );
}

/** Entries by hour as plain bars (08–20, wider when there is data outside), or a table — the default on a phone. */
function HourlyChart({ rows, busiest }: { rows: TrafficData['data']['hourly']; busiest: number | null }) {
  const t = useT();
  const [table, setTable] = useState(false);
  useEffect(() => { if (window.matchMedia('(max-width: 639px)').matches) setTable(true); }, []);
  const withData = rows.filter((r) => r.enter || r.exit).map((r) => r.hour);
  const lo = Math.min(8, ...withData), hi = Math.max(20, ...withData);
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const by = new Map(rows.map((r) => [r.hour, r]));
  const max = Math.max(1, ...rows.map((r) => r.enter));
  return (
    <section aria-labelledby="tr-hourly-h" className="px-5 pb-5 xl:col-span-2">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-2">
        <h2 id="tr-hourly-h" className="text-base font-bold text-slate-900">{t('cam.tr.byHour')}</h2>
        <Button size="sm" variant="ghost" onClick={() => setTable((v) => !v)} aria-pressed={table} icon={table ? <BarChart3 className={ic} /> : <Table2 className={ic} />}>{table ? t('clinical.dash.chart') : t('clinical.dash.tableView')}</Button>
      </div>
      {table ? (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[0.8125rem] font-semibold text-slate-600"><th className="sticky top-0 bg-white py-1.5">{t('cam.col.hour')}</th><th className="sticky top-0 bg-white py-1.5 text-right">{t('cam.col.entered')}</th><th className="sticky top-0 bg-white py-1.5 text-right">{t('cam.col.exited')}</th></tr></thead>
            <tbody>{hours.map((h) => <tr key={h} className="border-t border-slate-100"><td className="py-1.5 tabular-nums">{hh(h)}–{hh(h + 1)}</td><td className="text-right font-semibold tabular-nums">{by.get(h)?.enter ?? 0}</td><td className="text-right tabular-nums">{by.get(h)?.exit ?? 0}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div>
          <ul className="flex h-48 items-end gap-1 border-b border-slate-300 sm:gap-2" aria-label={t('cam.tr.byHour')}>
            {hours.map((h) => {
              const v = by.get(h)?.enter ?? 0;
              return (
                <li key={h} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" aria-label={t('cam.tr.bar', { hour: hh(h), n: v })}>
                  <span aria-hidden="true" className="text-[0.8125rem] font-semibold tabular-nums text-slate-700">{v || ''}</span>
                  <span aria-hidden="true" className={cx('block w-full max-w-10 rounded-t', h === busiest ? 'bg-brand-700' : 'bg-brand-400')} style={{ height: `${(v / max) * 9}rem` }} />
                </li>
              );
            })}
          </ul>
          <div aria-hidden="true" className="mt-1 flex gap-1 sm:gap-2">{hours.map((h) => <span key={h} className="min-w-0 flex-1 text-center text-[0.8125rem] tabular-nums text-slate-600">{String(h).padStart(2, '0')}</span>)}</div>
        </div>
      )}
    </section>
  );
}

// ---------- security ----------

type SecurityRow = { id: string; kind: string; occurred_at: string; target: string | null; alert: boolean; camera_id: string; security_mode: 'always' | 'after_hours'; camera_name: string; location: string | null; branch_name: string; acked_at: string | null; acked_by_name: string | null };

function Security({ q, period, alertsOnly, setAlertsOnly, cameras }: {
  q: { data?: { data: SecurityRow[] }; isError: boolean; error: unknown; refetch: () => void };
  period: React.ReactNode; alertsOnly: boolean; setAlertsOnly: (v: boolean) => void; cameras: Camera[];
}) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { me, branchId } = useSession();
  const showBranch = !branchId && me.branches.length > 1;
  const ack = useMutation({
    mutationFn: (id: string) => api(`/cameras/security/${id}/ack`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cameras', 'security'] }); toast.success(t('cam.sec.acked')); },
    onError: (e) => toast.error(e),
  });
  // «outside working hours» only when the camera alerts after hours; an «always» camera's alert is just an alert
  const always = (r: SecurityRow) => r.security_mode === 'always'
  return (
    <Card padded={false}>
      <Toolbar>
        {period}
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem] font-semibold text-slate-800">
          <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} />{t('cam.sec.alertsOnly')}
        </label>
      </Toolbar>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <LoadingRows /> : !q.data.data.length ? (
        <EmptyState compact icon={<CheckCircle2 />} title={t(alertsOnly ? 'cam.sec.emptyAlerts' : 'cam.sec.empty')} />
      ) : (
        <Table>
          <thead><tr><Th className="hidden sm:table-cell">{t('cam.col.time')}</Th><Th>{t('cam.col.event')}</Th><Th className="hidden md:table-cell">{t('cam.col.camera')}</Th><Th right><span className="sr-only">{t('cam.col.actions')}</span></Th></tr></thead>
          <tbody>{q.data.data.map((r) => {
            const open = r.alert && !r.acked_at;
            return (
              <tr key={r.id} className={open ? 'bg-red-50/40' : ''}>
                <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{fmtDateTime(r.occurred_at)}</Td>
                <Td className="min-w-[10rem]">
                  <div className="text-[0.8125rem] tabular-nums text-slate-600 sm:hidden">{fmtDateTime(r.occurred_at)}</div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-slate-900">{t(`cam.kind.${r.kind}` as MessageKey)}</span>
                    {r.alert && <Badge tone="red" icon={<ShieldAlert className={ic} />}>{t(always(r) ? 'cam.sec.alert' : 'cam.sec.afterHours')}</Badge>}
                  </div>
                  <div className="text-[0.8125rem] text-slate-600 md:hidden">{r.camera_name}</div>
                </Td>
                <Td className="hidden md:table-cell"><div className="text-slate-900">{r.camera_name}</div><div className="text-[0.8125rem] text-slate-600">{[r.location, showBranch ? r.branch_name : null].filter(Boolean).join(' · ') || '—'}</div></Td>
                <Td right className="!py-1.5">
                  {r.acked_at ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-normal text-left text-[0.8125rem] text-slate-700"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />{t('cam.sec.ackedBy', { name: r.acked_by_name ?? '—', at: fmtDateTime(r.acked_at) })}</span>
                  ) : r.alert ? (
                    <Button size="sm" icon={<Check className={ic} />} aria-label={t('cam.sec.ack')} loading={ack.isPending && ack.variables === r.id} onClick={() => ack.mutate(r.id)}><span className="hidden sm:inline">{t('cam.sec.ack')}</span></Button>
                  ) : null}
                </Td>
              </tr>
            );
          })}</tbody>
        </Table>
      )}
    </Card>
  );
}
