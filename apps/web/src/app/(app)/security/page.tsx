'use client';
import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Contact, Footprints, KeyRound, NotebookPen, Printer, ShieldAlert, Timer } from 'lucide-react';
import { INCIDENT_CATEGORIES, type MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, duration, fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Card, cx, EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, Segmented, StatCard, Table, Tabs, Td, TextLink, Th, Toolbar } from '@/components/ui';
import { CsvLink, PeriodPicker } from '@/components/finance-extra';
import { AlertFeed, useAlerts } from '@/components/guard/alerts';
import { IncidentList, useIncidents } from '@/components/guard/incidents';
import { VisitorLog } from '@/components/guard/visitors';
import { KeyLog, KeysNow } from '@/components/guard/keys';
import { CheckpointsManager, RoundsHistory } from '@/components/guard/patrol';

type Tab = 'overview' | 'alerts' | 'incidents' | 'visitors' | 'keys' | 'patrol' | 'shifts';
const TABS: Tab[] = ['overview', 'alerts', 'incidents', 'visitors', 'keys', 'patrol', 'shifts'];

export default function SecurityPage() { return <Suspense><Security /></Suspense>; }

/** Manager: everything the guard records — alert response times, incidents, visitors, keys, patrol compliance, shifts. */
function Security() {
  const t = useT();
  const { me, branchId } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = TABS.includes(sp.get('tab') as Tab) ? (sp.get('tab') as Tab) : 'overview';
  const setTab = (v: Tab) => { setPage(1); router.replace(`${pathname}?tab=${v}`, { scroll: false }); };
  const [from, setFrom] = useState(addDays(me.today, -6)), [to, setTo] = useState(me.today);
  const [page, setPage] = useState(1);
  const [incView, setIncView] = useState<'open' | 'all'>('all');
  const period = <PeriodPicker from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); setPage(1); }} />;
  const csv = (what: string) => <CsvLink href={`/api/v1/security/${what}.csv${qs({ from, to, branch_id: branchId })}`} />;
  const alerts = useAlerts({ from, to, page });
  const incidents = useIncidents(incView === 'open' ? { status: 'open', page } : { from, to, page });
  return (
    <>
      <PageHeader title={t('guard.sec.title')} subtitle={t('guard.sec.subtitle')} />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} label={t('guard.sec.title')} items={TABS.map((v) => ({ value: v, label: t(`guard.sec.tab.${v}` as MessageKey) }))} /></div>
      {tab === 'overview' && <Overview from={from} to={to} period={period} />}
      {tab === 'alerts' && (
        <Card padded={false}>
          <Toolbar actions={csv('alerts')}>{period}</Toolbar>
          <AlertFeed q={alerts} mode="manager" emptyTitle={t('guard.alerts.emptyPeriod')} page={page} onPage={setPage} />
        </Card>
      )}
      {tab === 'incidents' && (
        <Card padded={false}>
          <Toolbar actions={csv('incidents')}>
            <Segmented label={t('guard.inc.title')} role="tablist" value={incView} onChange={(v) => { setIncView(v); setPage(1); }} options={[{ value: 'all', label: t('guard.inc.all') }, { value: 'open', label: t('guard.inc.open') }]} />
            {incView === 'all' && period}
          </Toolbar>
          <IncidentList q={incidents} mode="manager" emptyTitle={incView === 'open' ? t('guard.inc.empty') : t('guard.inc.emptyPeriod')} page={page} onPage={setPage} />
        </Card>
      )}
      {tab === 'visitors' && <Card padded={false}><Toolbar actions={csv('visitors')}>{period}</Toolbar><VisitorLog from={from} to={to} page={page} onPage={setPage} /></Card>}
      {tab === 'keys' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card padded={false} title={t('guard.keys.now')}><KeysNow readOnly /></Card>
          <Card padded={false} title={t('guard.keys.log')}><Toolbar>{period}</Toolbar><KeyLog from={from} to={to} page={page} onPage={setPage} /></Card>
        </div>
      )}
      {tab === 'patrol' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
          <div className="min-w-0 xl:col-span-2"><CheckpointsManager /></div>
          <Card padded={false} title={t('guard.pat.history')} className="min-w-0 xl:col-span-3"><Toolbar>{period}</Toolbar><RoundsHistory from={from} to={to} page={page} onPage={setPage} /></Card>
        </div>
      )}
      {tab === 'shifts' && <Shifts from={from} to={to} period={period} page={page} onPage={setPage} />}
    </>
  );
}

type Stats = { data: {
  alerts: { total: number; handled: number; open: number; avg_response_sec: number | null; median_response_sec: number | null; max_response_sec: number | null; false_alarm: number; checked_ok: number; incident: number; escalated: number };
  incidents: { category: string; severity: string; source: string; n: number; open: number }[];
  visitors: { total: number; avg_minutes: number | null };
  keys: { issued: number; late: number; out_now: number };
  patrol: { shifts: { id: string; number: number; guard_name: string; opened_at: string; closed_at: string | null; hours: number; expected: number; done: number; missed: number; incomplete: number; problems: number }[]; expected: number; done: number; missed: number; incomplete: number; problems: number };
} };

function Overview({ from, to, period }: { from: string; to: string; period: React.ReactNode }) {
  const t = useT();
  const { branchId } = useSession();
  const q = useQuery({ queryKey: ['security', 'stats', branchId, from, to], queryFn: () => api<Stats>(`/security/stats${qs({ from, to, branch_id: branchId })}`).then((r) => r.data), placeholderData: (p) => p });
  const s = q.data;
  const incTotal = s?.incidents.reduce((a, r) => a + r.n, 0) ?? 0, incOpen = s?.incidents.reduce((a, r) => a + r.open, 0) ?? 0;
  const byCat = INCIDENT_CATEGORIES.map((c) => ({ c, n: s?.incidents.filter((r) => r.category === c).reduce((a, r) => a + r.n, 0) ?? 0 })).filter((x) => x.n);
  const outcomes = s ? (['false_alarm', 'checked_ok', 'incident', 'escalated'] as const).map((o) => ({ o, n: s.alerts[o] })) : [];
  const maxOut = Math.max(1, ...outcomes.map((x) => x.n)), maxCat = Math.max(1, ...byCat.map((x) => x.n));
  return (
    <>
      <Card padded={false} className="mb-5"><Toolbar>{period}</Toolbar></Card>
      {q.isError && !s ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 lg:grid-cols-5">
            <StatCard icon={<ShieldAlert />} tone={s?.alerts.open ? 'danger' : 'default'} label={t('guard.sec.alerts')} loading={!s} value={s?.alerts.total} sub={s && t('guard.sec.alertsSub', { handled: s.alerts.handled, total: s.alerts.total })} />
            <StatCard icon={<Timer />} label={t('guard.sec.median')} loading={!s} value={s && (s.alerts.median_response_sec == null ? '—' : duration(s.alerts.median_response_sec))}
              sub={s?.alerts.max_response_sec != null ? t('guard.sec.medianSub', { time: duration(s.alerts.max_response_sec) }) : undefined} />
            <StatCard icon={<NotebookPen />} tone={incOpen ? 'danger' : 'default'} label={t('guard.sec.incidents')} loading={!s} value={incTotal} sub={s && t('guard.sec.incidentsSub', { n: incOpen })} />
            <StatCard icon={<Contact />} label={t('guard.sec.visitors')} loading={!s} value={s?.visitors.total} sub={s?.visitors.avg_minutes != null ? t('guard.sec.visitorsSub', { time: duration(s.visitors.avg_minutes * 60) }) : undefined} />
            <StatCard icon={<Footprints />} tone={s?.patrol.missed ? 'danger' : 'success'} label={t('guard.sec.patrolMissed')} loading={!s} value={s?.patrol.missed} sub={s && t('guard.sec.patrolSub', { done: s.patrol.done, expected: s.patrol.expected })} />
          </div>
          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card title={t('guard.sec.outcomes')}>
              {!s ? <LoadingRows rows={3} /> : <Bars rows={outcomes.map((x) => ({ label: t(`guard.outcome.short.${x.o}` as MessageKey), n: x.n }))} max={maxOut} />}
            </Card>
            <Card title={t('guard.sec.byCategory')}>
              {!s ? <LoadingRows rows={3} /> : !byCat.length ? <p className="text-body text-slate-600">{t('guard.sec.none')}</p> : <Bars rows={byCat.map((x) => ({ label: t(`guard.cat.${x.c}` as MessageKey), n: x.n }))} max={maxCat} />}
            </Card>
            <Card title={t('guard.sec.keysLate')}>
              {!s ? <LoadingRows rows={2} /> : (
                <div className="flex items-end gap-3"><span className={cx('text-stat font-bold tabular-nums', s.keys.late ? 'text-red-700' : 'text-slate-900')}>{s.keys.late}</span>
                  <span className="pb-1 text-small text-slate-600">{t('guard.sec.keysSub', { n: s.keys.issued })}</span><KeyRound className="ml-auto h-6 w-6 text-slate-400" aria-hidden="true" /></div>
              )}
            </Card>
          </div>
          <Card padded={false} title={t('guard.pat.compliance')}>
            {!s ? <LoadingRows rows={4} /> : !s.patrol.shifts.length ? <EmptyState compact title={t('guard.shift.historyEmpty')} /> : (
              <Table>
                <thead><tr><Th>{t('guard.sec.shift')}</Th><Th className="hidden sm:table-cell">{t('guard.sec.guard')}</Th><Th right className="hidden sm:table-cell">{t('guard.pat.expected')}</Th><Th right>{t('guard.pat.done')}</Th><Th right>{t('guard.pat.missed')}</Th><Th right className="hidden md:table-cell">{t('guard.pat.incomplete')}</Th><Th right className="hidden md:table-cell">{t('guard.pat.problem')}</Th></tr></thead>
                <tbody>{s.patrol.shifts.map((r) => (
                  <tr key={r.id} className={r.missed ? 'bg-red-50/40' : ''}>
                    <Td className="tabular-nums"><span className="whitespace-nowrap">№{r.number} · {fmtDateTime(r.opened_at)}</span><div className="text-small text-slate-600">{t('guard.sec.hours', { n: r.hours })}<span className="sm:hidden"> · {r.guard_name}</span></div></Td>
                    <Td className="hidden sm:table-cell">{r.guard_name}</Td>
                    <Td right className="hidden sm:table-cell">{r.expected}</Td><Td right className="font-semibold">{r.done}</Td>
                    <Td right className={r.missed ? 'font-bold text-red-700' : 'text-slate-600'}>{r.missed}</Td>
                    <Td right className="hidden md:table-cell">{r.incomplete}</Td><Td right className="hidden md:table-cell">{r.problems}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function Bars({ rows, max }: { rows: { label: string; n: number }[]; max: number }) {
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between gap-2 text-sm"><span className="text-slate-800">{r.label}</span><span className="font-bold tabular-nums text-slate-900">{r.n}</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.n / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Shifts({ from, to, period, page, onPage }: { from: string; to: string; period: React.ReactNode; page: number; onPage: (p: number) => void }) {
  const t = useT();
  const { branchId } = useSession();
  const q = useQuery({
    queryKey: ['security', 'shifts', 'list', branchId, from, to, page],
    queryFn: () => api<{ data: { id: string; number: number; branch_name: string; guard_name: string; opened_at: string; closed_at: string | null; rounds: number }[]; meta: { total: number; page_size: number } }>(`/security/shifts${qs({ branch_id: branchId, from, to, page, page_size: 25 })}`),
    placeholderData: (p) => p,
  });
  return (
    <Card padded={false}>
      <Toolbar>{period}</Toolbar>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <LoadingRows rows={4} /> : !q.data.data.length ? <EmptyState compact title={t('guard.shift.historyEmpty')} /> : (
        <>
          <Table>
            <thead><tr><Th>{t('guard.col.number')}</Th><Th>{t('guard.sec.guard')}</Th><Th>{t('guard.col.opened')}</Th><Th>{t('guard.col.closed')}</Th><Th className="hidden sm:table-cell">{t('guard.col.round')}</Th><Th right><span className="sr-only">{t('guard.col.actions')}</span></Th></tr></thead>
            <tbody>{q.data.data.map((r) => (
              <tr key={r.id}>
                <Td className="tabular-nums">{r.number}</Td><Td>{r.guard_name}</Td>
                <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(r.opened_at)}</Td>
                <Td className="whitespace-nowrap tabular-nums">{r.closed_at ? fmtDateTime(r.closed_at) : <Badge tone="blue">{t('guard.shift.openNow')}</Badge>}</Td>
                <Td className="hidden sm:table-cell">{t('guard.shift.rounds', { n: r.rounds })}</Td>
                <Td right><TextLink href={`/print/guard-shift/${r.id}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('guard.shift.report')}</TextLink></Td>
              </tr>
            ))}</tbody>
          </Table>
          {q.data.meta.total > q.data.meta.page_size && <Pagination page={page} pageSize={q.data.meta.page_size} total={q.data.meta.total} onPage={onPage} />}
        </>
      )}
    </Card>
  );
}
