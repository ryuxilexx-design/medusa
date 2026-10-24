'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, BarChart3, Boxes, CalendarCheck2, Cctv, CheckCircle2, ChevronRight, FlaskConical, ShieldAlert, Table2, UserCheck, Wallet } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtDate, fmtTime, formatSom, fullName, longDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Button, Card, cx, ErrorState, FOCUS_RING, FOCUS_RING_INSET, Money, PageHeader, Segmented, Skeleton, StatCard, TextLink } from '@/components/ui';
import { DateRange } from '@/components/date-range';
import { AskNumbers, DayDigest } from '@/components/manager-ai';

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
          // short labels, so the four choices fit one row on a phone too
          <Segmented variant="glass" stretch label={t('clinical.period.group')} value={period} onChange={setPeriod} className="sm:w-auto"
            options={([['today', 'clinical.period.today'], ['7d', 'clinical.period.last7'], ['30d', 'clinical.period.last30'], ['custom', 'clinical.period.custom']] as [Period, MessageKey][]).map(([v, l]) => ({ value: v, label: t(l) }))} />
        } />
      {period === 'custom' && <div className="-mt-1 mb-5 flex justify-end"><DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} /></div>}
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <div className="space-y-5">
          {/* the key numbers first; under 360 px one tile per row (the labels are short), so labels and amounts are never cut */}
          <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-5 xl:grid-cols-4">
            <StatCard loading={!d} icon={<CalendarCheck2 />} label={t('clinical.dash.appointments')} value={d?.kpi.appointments}
              sub={d && t('clinical.dash.appointmentsSub', { cancelled: d.kpi.cancelled, noShow: d.kpi.no_show })} href={d && `/schedule?date=${d.range.to}`} />
            <StatCard loading={!d} icon={<UserCheck />} label={t('clinical.dash.arrived')} value={d?.kpi.arrived_patients}
              sub={d && t('clinical.dash.inClinic', { n: d.kpi.in_clinic })} href="/queue" />
            <StatCard loading={!d} icon={<Banknote />} label={t('clinical.dash.revenue')} value={d && <Money tiyin={d.kpi.revenue} />}
              sub={d && t('clinical.dash.payments', { n: d.kpi.payments })} href={`/finance?${rangeQs}`} />
            <StatCard loading={!d} icon={<Wallet />} label={t('clinical.dash.debt')} value={d && <Money tiyin={d.kpi.debt} />}
              sub={d && t('clinical.dash.openInvoices', { n: d.kpi.debt_invoices })} href="/cashier?debt=1" tone={d?.kpi.debt ? 'danger' : 'default'} />
          </div>

          {!d ? <Skeleton className="h-28 w-full rounded-surface" /> : <Attention a={d.attention} />}

          <DayDigest />

          {showChart && (
            <RevenueCard data={d.daily} />
          )}

          {!d ? <Skeleton className="h-72 w-full rounded-surface" /> : (showPayments || showDoctors) && (
            <div className={cx('grid grid-cols-1 gap-5', showPayments && showDoctors && 'xl:grid-cols-2')}>
              {showPayments && (
                <Card className="overflow-hidden" title={t('clinical.dash.recentPayments')} padded={false}
                  actions={<TextLink href={`/finance?${rangeQs}`} className="text-sm">{t('clinical.dash.paymentRegister')}<ChevronRight className="h-4 w-4" /></TextLink>}>
                  <ul className="divide-y divide-slate-100">
                    {d.recent_payments.map((p: any) => (
                      <li key={p.id}><Link href={`/cashier/${p.invoice_id}`} className={cx('flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50', FOCUS_RING_INSET)}>
                        <span className="hidden w-12 shrink-0 text-small leading-tight tabular-nums text-slate-600 sm:block">{multiDay && <span className="block">{fmtDate(p.paid_at).slice(0, 5)}</span>}{fmtTime(p.paid_at)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-semibold text-slate-900">{fullName(p)}</span>
                          <span className="block text-small text-slate-600 sm:truncate"><span className="tabular-nums sm:hidden">{multiDay && `${fmtDate(p.paid_at).slice(0, 5)} `}{fmtTime(p.paid_at)}, </span>{t(`payment.${p.method}` as MessageKey)}{!branchId && `, ${p.branch_name}`}</span>
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-right text-body font-semibold tabular-nums text-slate-900">{formatSom(p.amount)}</span>
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

          <AskNumbers />
        </div>
      )}
    </>
  );
}

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
    <div className="flex items-center gap-2.5 surface px-5 py-3.5 text-body font-semibold text-slate-900">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" />{t('clinical.dash.allClear')}
    </div>
  );
  return (
    <section className="surface" aria-labelledby="dash-attention">
      <h2 id="dash-attention" className="px-5 pt-4 text-base font-bold text-slate-900">{t('clinical.dash.attention')}</h2>
      <ul className="grid grid-cols-1 gap-3 p-5 pt-3 md:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
        {items.map((it) => (
          <li key={it.href + it.label} className="min-w-0">
            <Link href={it.href} title={it.value} className={cx('flex h-full items-start gap-3 rounded-field border border-amber-200 bg-amber-50/60 px-4 py-3 hover:border-amber-400', FOCUS_RING)}>
              <span className="mt-0.5 shrink-0 [&>svg]:h-5 [&>svg]:w-5">{it.icon}</span>
              <span className="min-w-0 flex-1">
                {/* titles wrap instead of being cut: Russian and Cyrillic labels are longer */}
                <span className="block text-body font-semibold leading-snug text-slate-900">{it.label}</span>
                <span className="mt-0.5 line-clamp-2 text-small text-slate-600">{it.value}</span>
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
        <thead><tr className="text-left text-small font-semibold text-slate-600"><th className="sticky top-0 bg-white py-1.5">{t('clinical.date')}</th><th className="sticky top-0 bg-white py-1.5 text-right">{t('clinical.dash.colPayments')}</th><th className="sticky top-0 bg-white py-1.5 text-right">{t('clinical.dash.colRevenue')}</th></tr></thead>
        <tbody>{data.map((x) => <tr key={x.date} className="border-t border-slate-100"><td className="py-1.5"><TextLink href={`/finance?from=${x.date}&to=${x.date}`}>{fmtDate(x.date)}</TextLink></td><td className="text-right tabular-nums">{x.payments}</td><td className="whitespace-nowrap text-right tabular-nums">{formatSom(x.revenue)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

const short = (tiyin: number, t: T) => { const s = tiyin / 100; return s >= 1e6 ? t('clinical.dash.mln', { n: (s / 1e6).toFixed(s >= 1e7 ? 0 : 1) }) : s >= 1e3 ? t('clinical.dash.thousand', { n: Math.round(s / 1e3) }) : String(s); };

function RevenueChart({ data }: { data: { date: string; revenue: number; payments: number }[] }) {
  const router = useRouter();
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  // the drawing's logical width = its rendered width (1 unit = 1 px), so the axis text is text-small on every screen
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.round(el.clientWidth))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const max = Math.max(...data.map((x) => x.revenue));
  // top of the axis: the smallest «round» value ≥ max, so the tallest bar fills most of the height
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const nice = pow * ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * pow >= max) ?? 10);
  const ticks = [0, nice / 2, nice];
  const FS = 14.6; // = text-small at the 18 px root
  const H = 180, pad = W < 480 ? 52 : 60;
  const step = (W - pad - 16) / data.length; // 16 px right gutter keeps the last date label inside
  const bw = Math.min(36, Math.max(4, step - 4));
  // a date label every ~56 px (so «24.10» never overlaps its neighbour), always the last one
  const every = Math.max(1, Math.ceil(56 / step));
  return (
    <div ref={box} className="relative">
      <svg viewBox={`0 0 ${W} ${H + 28}`} width={W} height={H + 28} className="block w-full text-slate-600" role="group" aria-label={t('clinical.dash.chartLabel')}>
        {ticks.map((v) => { const y = H - (v / nice) * (H - 10); return <g key={v}><line x1={pad} x2={W} y1={y} y2={y} className="stroke-slate-200" strokeWidth={1} /><text x={pad - 8} y={y + 5} textAnchor="end" fontSize={FS} fill="currentColor">{short(v, t)}</text></g>; })}
        {data.map((x, i) => {
          const h = (x.revenue / nice) * (H - 10);
          const cxp = pad + step * i + step / 2;
          const showLabel = i % every === 0 || i === data.length - 1;
          return (
            <g key={x.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              onClick={() => router.push(`/finance?from=${x.date}&to=${x.date}`)} onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/finance?from=${x.date}&to=${x.date}`); }}
              tabIndex={0} role="link" aria-label={`${fmtDate(x.date)}: ${formatSom(x.revenue)}`} className="group cursor-pointer focus:outline-none">
              <rect x={pad + step * i + 1} y={1} width={Math.max(step - 2, 1)} height={H - 1} rx={4} fill="transparent" strokeWidth={3} className="stroke-transparent group-focus:stroke-focus" />
              {x.revenue > 0 && <path d={`M${cxp - bw / 2},${H} v${-Math.max(h - 4, 0)} q0,-4 4,-4 h${Math.max(bw - 8, 0)} q4,0 4,4 v${Math.max(h - 4, 0)} z`} className={hover === i ? 'fill-brand-700' : 'fill-brand-500'} />}
              {showLabel && <text x={Math.min(cxp, W - 20)} y={H + 20} textAnchor="middle" fontSize={FS} fill="currentColor">{x.date.slice(8)}.{x.date.slice(5, 7)}</text>}
            </g>
          );
        })}
        <line x1={pad} x2={W} y1={H} y2={H} className="stroke-slate-400" strokeWidth={1} />
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-1 rounded-field border border-slate-200 bg-white px-2.5 py-1.5 text-small shadow-popover" style={{ left: `min(calc(${((pad + step * hover + step / 2) / W) * 100}% + 8px), calc(100% - 11rem))` }}>
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
        <li key={r.doctor_id}><Link href={`/staff?doctor=${r.doctor_id}`} className={cx('flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50', FOCUS_RING_INSET)}>
          <span className="min-w-0 flex-1 sm:w-44 sm:flex-none"><span className="block truncate text-body font-semibold text-slate-900">{r.name}</span><span className="block truncate text-small text-slate-600">{r.specialty}</span></span>
          <span className="hidden min-w-[2.5rem] flex-1 sm:block"><span className="block h-2 rounded-full bg-slate-100">{r.utilization != null && r.utilization > 0 && <span className="block h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(2, Math.min(100, r.utilization))}%` }} />}</span></span>
          <span className="w-[4.5rem] shrink-0 text-right leading-tight sm:w-24">
            <span className="block text-body font-semibold tabular-nums text-slate-900">{r.utilization == null ? '—' : `${Number(r.utilization).toLocaleString('ru-RU')}%`}</span>
            <span className="block whitespace-nowrap text-small text-slate-600">{t('clinical.dash.visits', { n: r.appointments })}</span>
          </span>
        </Link></li>
      ))}
    </ul>
  );
}
