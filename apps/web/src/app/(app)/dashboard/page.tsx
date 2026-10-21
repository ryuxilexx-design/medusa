'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, BarChart3, Boxes, CalendarCheck2, Cctv, CheckCircle2, ChevronRight, FlaskConical, ShieldAlert, MessageSquareText, Table2, UserCheck, Wallet } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtDate, fmtTime, formatSom, fullName, longDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, cx, ErrorState, Money, PageHeader, Skeleton, StatCard } from '@/components/ui';
import { DateRange } from '@/components/date-range';

type T = ReturnType<typeof useT>;
type Period = 'today' | '7d' | '30d' | 'custom';

export default function DashboardPage() {
  const { me, branchId } = useSession();
  const t = useT();
  const [period, setPeriod] = useState<Period>('today');
  const [from, setFrom] = useState(addDays(me.today, -6));
  const [to, setTo] = useState(me.today);
  const params = period === 'custom' ? { from, to } : { period };
  const q = useQuery({ queryKey: ['dashboard', period, from, to, branchId], queryFn: () => api(`/dashboard${qs({ ...params, branch_id: branchId })}`).then((r) => r.data), refetchInterval: 30_000 });
  const d = q.data;
  const rangeQs = d ? `from=${d.range.from}&to=${d.range.to}` : '';
  const multiDay = !!d && d.range.from !== d.range.to;
  // «today» is already in the top bar: the subtitle names the period only when it is something else
  const periodLabel = !d || (!multiDay && d.range.from === me.today) ? undefined : multiDay ? `${fmtDate(d.range.from)} – ${fmtDate(d.range.to)}` : longDate(d.range.from);
  const showChart = multiDay && d.daily.some((x: any) => x.revenue > 0);
  const showPayments = !!d?.recent_payments.length;
  const showDoctors = !!d?.doctors.length;

  return (
    <>
      <PageHeader title={t('clinical.dash.title')} subtitle={periodLabel}
        actions={
          <div className="glass-field grid w-full grid-cols-2 gap-0.5 rounded-full p-1 sm:flex sm:w-auto" role="group" aria-label={t('clinical.period.group')}>
            {([['today', 'clinical.period.today'], ['7d', 'clinical.period.last7'], ['30d', 'clinical.period.last30'], ['custom', 'clinical.period.custom']] as [Period, MessageKey][]).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setPeriod(v)} aria-pressed={period === v} className={cx('min-h-9 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300', period === v ? 'bg-white text-brand-800 shadow-[0_4px_10px_-4px_rgba(10,30,70,0.4)]' : 'text-slate-800 hover:bg-white/50')}>{t(l)}</button>
            ))}
          </div>
        } />
      {period === 'custom' && <div className="-mt-1 mb-5 flex justify-end"><DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} /></div>}
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <div className="space-y-5">
          {/* phone: one tile per row, so labels and amounts are never cut */}
          <div className="grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-4">
            <StatCard loading={!d} icon={<CalendarCheck2 />} label={t('clinical.dash.appointments')} value={d?.kpi.appointments}
              sub={d && t('clinical.dash.appointmentsSub', { cancelled: d.kpi.cancelled, noShow: d.kpi.no_show })} href={d && `/schedule?date=${d.range.to}`} />
            <StatCard loading={!d} icon={<UserCheck />} label={t('clinical.dash.arrived')} value={d?.kpi.arrived_patients}
              sub={d && t('clinical.dash.inClinic', { n: d.kpi.in_clinic })} href="/queue" />
            <StatCard loading={!d} icon={<Banknote />} label={t('clinical.dash.revenue')} value={d && <Money tiyin={d.kpi.revenue} />}
              sub={d && t('clinical.dash.payments', { n: d.kpi.payments })} href={`/finance?${rangeQs}`} />
            <StatCard loading={!d} icon={<Wallet />} label={t('clinical.dash.debt')} value={d && <Money tiyin={d.kpi.debt} />}
              sub={d && t('clinical.dash.openInvoices', { n: d.kpi.debt_invoices })} href="/cashier?debt=1" tone={d?.kpi.debt ? 'danger' : 'default'} />
          </div>

          {!d ? <Skeleton className="h-28 w-full rounded-xl" /> : <Attention a={d.attention} />}

          {showChart && (
            <RevenueCard data={d.daily} />
          )}

          {!d ? <Skeleton className="h-72 w-full rounded-xl" /> : (showPayments || showDoctors) && (
            <div className={cx('grid grid-cols-1 gap-5', showPayments && showDoctors && 'xl:grid-cols-2')}>
              {showPayments && (
                <Card className="overflow-hidden" title={t('clinical.dash.recentPayments')} padded={false}
                  actions={<Link href={`/finance?${rangeQs}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">{t('clinical.dash.paymentRegister')}<ChevronRight className="h-4 w-4" /></Link>}>
                  <ul className="divide-y divide-slate-100">
                    {d.recent_payments.map((p: any) => (
                      <li key={p.id}><Link href={`/cashier/${p.invoice_id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300">
                        <span className="hidden w-12 shrink-0 text-[0.8125rem] leading-tight tabular-nums text-slate-600 sm:block">{multiDay && <span className="block">{fmtDate(p.paid_at).slice(0, 5)}</span>}{fmtTime(p.paid_at)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.9375rem] font-semibold text-slate-900">{fullName(p)}</span>
                          <span className="block truncate text-[0.8125rem] text-slate-600"><span className="tabular-nums sm:hidden">{multiDay && `${fmtDate(p.paid_at).slice(0, 5)} `}{fmtTime(p.paid_at)}, </span>{t(`payment.${p.method}` as MessageKey)}{!branchId && `, ${p.branch_name}`}</span>
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-right text-[0.9375rem] font-semibold tabular-nums text-slate-900">{formatSom(p.amount)}</span>
                      </Link></li>
                    ))}
                  </ul>
                </Card>
              )}
              {showDoctors && (
                <Card className="overflow-hidden" title={t('clinical.dash.utilization')} padded={false}>
                  <Utilization rows={d.doctors} wide={!showPayments} />
                </Card>
              )}
            </div>
          )}

          <AnalyticsAssistant />
        </div>
      )}
    </>
  );
}

/** Amount with a smaller currency word that never splits from the number; if the tile is too narrow the word wraps as a whole. */
/** Things the manager should act on, as small tiles in one row; one calm line when there is nothing. Debts are in the «Joriy qarz» tile above. */
function Attention({ a }: { a: any }) {
  const t = useT();
  const items = [
    { icon: <ShieldAlert className="text-red-600" />, label: t('clinical.dash.cameraAlerts'), value: t('clinical.dash.cameraAlertsCount', { n: a.camera_alerts ?? 0 }), href: '/cameras?tab=security', show: (a.camera_alerts ?? 0) > 0 },
    { icon: <Cctv className="text-amber-600" />, label: t('clinical.dash.silentCameras'), value: t('clinical.dash.silentCount', { n: a.silent_cameras ?? 0 }), href: '/cameras?tab=devices', show: (a.silent_cameras ?? 0) > 0 },
    { icon: <FlaskConical className="text-amber-600" />, label: t('clinical.dash.unverified'), value: `${t('clinical.dash.drafts', { n: a.lab_draft })}, ${t('clinical.dash.waiting', { n: a.lab_waiting })}`, href: '/lab?status=draft_result', show: a.lab_draft + a.lab_waiting > 0 },
    { icon: <Boxes className="text-amber-600" />, label: `${t('clinical.dash.lowStock')}: ${t('clinical.dash.items', { n: a.low_stock.length })}`, value: a.low_stock.map((x: any) => `${x.name} (${Number(x.qty)} ${x.unit})`).join(', '), href: '/inventory?low=1', show: a.low_stock.length > 0 },
    { icon: <AlertTriangle className="text-amber-600" />, label: t('clinical.dash.cancelledOpen'), value: t('clinical.dash.cancelledCount', { n: a.cancelled_with_invoice }), href: '/cashier?debt=1', show: a.cancelled_with_invoice > 0 },
  ].filter((x) => x.show);
  if (!items.length) return (
    <div className="flex items-center gap-2.5 surface px-5 py-3.5 text-[0.9375rem] font-semibold text-slate-900">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" />{t('clinical.dash.allClear')}
    </div>
  );
  return (
    <section className="surface" aria-labelledby="dash-attention">
      <h2 id="dash-attention" className="px-5 pt-4 text-base font-bold text-slate-900">{t('clinical.dash.attention')}</h2>
      <ul className="grid grid-cols-1 gap-3 p-5 pt-3 md:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
        {items.map((it) => (
          <li key={it.href + it.label} className="min-w-0">
            <Link href={it.href} title={it.value} className="flex h-full items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 hover:border-amber-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">
              <span className="mt-0.5 shrink-0 [&>svg]:h-5 [&>svg]:w-5">{it.icon}</span>
              <span className="min-w-0 flex-1">
                {/* titles wrap instead of being cut: Russian and Cyrillic labels are longer */}
                <span className="block text-[0.9375rem] font-semibold leading-snug text-slate-900">{it.label}</span>
                <span className="mt-0.5 line-clamp-2 text-[0.8125rem] text-slate-600">{it.value}</span>
              </span>
              <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Daily revenue: bars, or a table (the default on a phone, where bars and labels get too small to read). */
function RevenueCard({ data }: { data: { date: string; revenue: number; payments: number }[] }) {
  const t = useT();
  const [table, setTable] = useState(false);
  useEffect(() => { if (window.matchMedia('(max-width: 639px)').matches) setTable(true); }, []);
  return (
    <Card title={t('clinical.dash.dailyRevenue')}
      actions={<Button size="sm" variant="ghost" onClick={() => setTable((v) => !v)} aria-pressed={table} icon={table ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}>{table ? t('clinical.dash.chart') : t('clinical.dash.tableView')}</Button>}>
      {table ? <RevenueTable data={data} /> : <RevenueChart data={data} />}
    </Card>
  );
}

function RevenueTable({ data }: { data: { date: string; revenue: number; payments: number }[] }) {
  const t = useT();
  return (
    <div className="max-h-60 overflow-y-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[0.8125rem] font-semibold text-slate-600"><th className="sticky top-0 bg-white py-1.5">{t('clinical.date')}</th><th className="sticky top-0 bg-white py-1.5 text-right">{t('clinical.dash.colPayments')}</th><th className="sticky top-0 bg-white py-1.5 text-right">{t('clinical.dash.colRevenue')}</th></tr></thead>
        <tbody>{data.map((x) => <tr key={x.date} className="border-t border-slate-100"><td className="py-1.5"><Link href={`/finance?from=${x.date}&to=${x.date}`} className="text-brand-700 hover:underline">{fmtDate(x.date)}</Link></td><td className="text-right tabular-nums">{x.payments}</td><td className="whitespace-nowrap text-right tabular-nums">{formatSom(x.revenue)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

const short = (tiyin: number, t: T) => { const s = tiyin / 100; return s >= 1e6 ? t('clinical.dash.mln', { n: (s / 1e6).toFixed(s >= 1e7 ? 0 : 1) }) : s >= 1e3 ? t('clinical.dash.thousand', { n: Math.round(s / 1e3) }) : String(s); };

function RevenueChart({ data }: { data: { date: string; revenue: number; payments: number }[] }) {
  const router = useRouter();
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((x) => x.revenue));
  // top of the axis: the smallest «round» value ≥ max, so the tallest bar fills most of the height
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const nice = pow * ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * pow >= max) ?? 10);
  const ticks = [0, nice / 2, nice];
  const H = 180, W = 900, pad = 56; // logical size ≈ rendered size at 1366 px, so axis text stays readable
  const step = (W - pad - 16) / data.length; // 16 px right gutter keeps the last date label inside
  const bw = Math.min(36, Math.max(6, step - 6));
  return (
    <div className="relative overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 28}`} className="h-56 w-full min-w-[320px]" role="group" aria-label={t('clinical.dash.chartLabel')}>
        {ticks.map((v) => { const y = H - (v / nice) * (H - 10); return <g key={v}><line x1={pad} x2={W} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} /><text x={pad - 8} y={y + 4} textAnchor="end" fontSize={13} fill="#475569">{short(v, t)}</text></g>; })}
        {data.map((x, i) => {
          const h = (x.revenue / nice) * (H - 10);
          const cxp = pad + step * i + step / 2;
          const showLabel = data.length <= 10 || i % Math.ceil(data.length / 10) === 0 || i === data.length - 1;
          return (
            <g key={x.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              onClick={() => router.push(`/finance?from=${x.date}&to=${x.date}`)} onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/finance?from=${x.date}&to=${x.date}`); }}
              tabIndex={0} role="link" aria-label={`${fmtDate(x.date)}: ${formatSom(x.revenue)}`} className="group cursor-pointer focus:outline-none">
              <rect x={pad + step * i + 1} y={1} width={step - 2} height={H - 1} rx={4} fill="transparent" strokeWidth={3} className="stroke-transparent group-focus:stroke-amber-400" />
              {x.revenue > 0 && <path d={`M${cxp - bw / 2},${H} v${-Math.max(h - 4, 0)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(h - 4, 0)} z`} fill={hover === i ? '#25519c' : '#4a86d6'} />}
              {showLabel && <text x={cxp} y={H + 18} textAnchor="middle" fontSize={13} fill="#475569">{x.date.slice(8)}.{x.date.slice(5, 7)}</text>}
            </g>
          );
        })}
        <line x1={pad} x2={W} y1={H} y2={H} stroke="#94a3b8" strokeWidth={1} />
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[0.8125rem] shadow-lg" style={{ left: `min(calc(${((pad + step * hover + step / 2) / W) * 100}% + 8px), calc(100% - 11rem))` }}>
          <div className="text-sm font-semibold tabular-nums text-slate-900">{formatSom(data[hover].revenue)}</div>
          <div className="text-slate-600">{longDate(data[hover].date)}, {t('clinical.dash.payments', { n: data[hover].payments })}</div>
        </div>
      )}
    </div>
  );
}

/** `wide`: the card has the whole row, so the doctors go in two columns instead of very long bars. */
function Utilization({ rows, wide }: { rows: any[]; wide?: boolean }) {
  const t = useT();
  return (
    <ul className={cx('grid grid-cols-1 [&>li:last-child]:border-b-0 [&>li]:border-b [&>li]:border-slate-100', wide && 'xl:grid-cols-2 xl:[&>li:nth-child(even)]:border-l xl:[&>li:nth-last-child(2):nth-child(odd)]:border-b-0')}>
      {rows.map((r) => (
        <li key={r.doctor_id}><Link href={`/staff?doctor=${r.doctor_id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300">
          <span className="min-w-0 flex-1 sm:w-44 sm:flex-none"><span className="block truncate text-[0.9375rem] font-semibold text-slate-900">{r.name}</span><span className="block truncate text-[0.8125rem] text-slate-600">{r.specialty}</span></span>
          <span className="hidden min-w-[2.5rem] flex-1 sm:block"><span className="block h-2 rounded-full bg-slate-100">{r.utilization != null && r.utilization > 0 && <span className="block h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(2, Math.min(100, r.utilization))}%` }} />}</span></span>
          <span className="w-[4.5rem] shrink-0 text-right leading-tight sm:w-24">
            <span className="block text-[0.9375rem] font-semibold tabular-nums text-slate-900">{r.utilization == null ? '—' : `${Number(r.utilization).toLocaleString('ru-RU')}%`}</span>
            <span className="block whitespace-nowrap text-[0.8125rem] text-slate-600">{t('clinical.dash.visits', { n: r.appointments })}</span>
          </span>
        </Link></li>
      ))}
    </ul>
  );
}

function AnalyticsAssistant() {
  const { branchId } = useSession();
  const t = useT();
  const m = useMutation({ mutationFn: (question: string) => api('/ai/report-explanation', { method: 'POST', body: { question, branch_id: branchId || null } }).then((r) => r.data) });
  const Q: [string, MessageKey][] = [['revenue_today', 'clinical.dash.qRevenueToday'], ['top_services', 'clinical.dash.qTopServices'], ['debts', 'clinical.dash.qDebts']];
  return (
    <Card title={<span className="flex items-center gap-2"><MessageSquareText className="h-5 w-5 text-brand-600" />{t('clinical.dash.quickQuestions')}</span>} actions={<Badge>{t('clinical.dash.notAiBadge')}</Badge>}>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {Q.map(([k, l]) => <Button key={k} className="!justify-start !whitespace-normal text-left" loading={m.isPending && m.variables === k} onClick={() => m.mutate(k)}>{t(l)}</Button>)}
      </div>
      {m.isError && <p className="mt-3 text-sm text-red-700" role="alert">{(m.error as Error).message}</p>}
      {m.data && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[0.9375rem] text-slate-900">
          <p>{m.data.text}</p>
          <Link href={m.data.link} className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"><BarChart3 className="h-4 w-4" />{t('clinical.dash.openSource')}</Link>
        </div>
      )}
    </Card>
  );
}
