'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, CalendarCheck2, CheckCircle2, FlaskConical, MessageSquareText, Table2, UserCheck, Wallet, Banknote, BarChart3 } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtDate, fmtTime, formatSom, fullName, longDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';

type T = ReturnType<typeof useT>;
import { Button, Card, cx, EmptyState, ErrorState, Input, PageHeader, Skeleton } from '@/components/ui';

type Period = 'today' | '7d' | '30d' | 'custom';

export default function DashboardPage() {
  const { me, branchId, branchName } = useSession();
  const t = useT();
  const [period, setPeriod] = useState<Period>('today');
  const [from, setFrom] = useState(addDays(me.today, -6));
  const [to, setTo] = useState(me.today);
  const params = period === 'custom' ? { from, to } : { period };
  const q = useQuery({ queryKey: ['dashboard', period, from, to, branchId], queryFn: () => api(`/dashboard${qs({ ...params, branch_id: branchId })}`).then((r) => r.data), refetchInterval: 30_000 });
  const d = q.data;
  const rangeQs = d ? `from=${d.range.from}&to=${d.range.to}` : '';
  const periodLabel = d ? (d.range.from === d.range.to ? longDate(d.range.from) : `${fmtDate(d.range.from)} – ${fmtDate(d.range.to)}`) : '';

  return (
    <>
      <PageHeader title={t('clinical.dash.title')} subtitle={`${branchName}, ${periodLabel}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-slate-300 bg-white p-0.5 shadow-sm" role="group" aria-label={t('clinical.period.group')}>
              {([['today', 'clinical.period.today'], ['7d', 'clinical.period.last7'], ['30d', 'clinical.period.last30'], ['custom', 'clinical.period.custom']] as [Period, MessageKey][]).map(([v, l]) => (
                <button key={v} onClick={() => setPeriod(v)} aria-pressed={period === v} className={cx('rounded px-3 py-1 text-[0.8125rem] font-medium', period === v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>{t(l)}</button>
              ))}
            </div>
            {period === 'custom' && <><Input type="date" aria-label={t('clinical.period.from')} className="h-8 w-[145px] text-[0.8125rem]" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /><span className="text-slate-400">–</span><Input type="date" aria-label={t('clinical.period.to')} className="h-8 w-[145px] text-[0.8125rem]" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></>}
          </div>
        } />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Kpi loading={!d} icon={<CalendarCheck2 />} label={t('clinical.dash.appointments')} value={d?.kpi.appointments} sub={d && t('clinical.dash.appointmentsSub', { cancelled: d.kpi.cancelled, noShow: d.kpi.no_show })} href={d && `/schedule?date=${d.range.to}`} />
            <Kpi loading={!d} icon={<UserCheck />} label={t('clinical.dash.arrived')} value={d?.kpi.arrived_patients} sub={d && t('clinical.dash.inClinic', { n: d.kpi.in_clinic })} href="/queue" />
            <Kpi loading={!d} icon={<CheckCircle2 />} label={t('clinical.dash.completed')} value={d?.kpi.completed} sub={d && t('clinical.dash.scheduled', { n: d.kpi.scheduled })} href={d && `/schedule?date=${d.range.to}&status=completed`} />
            <Kpi loading={!d} icon={<Banknote />} label={t('clinical.dash.revenue')} value={d && formatSom(d.kpi.revenue)} sub={d && t('clinical.dash.payments', { n: d.kpi.payments })} href={`/finance?${rangeQs}`} accent />
            <Kpi loading={!d} icon={<Wallet />} label={t('clinical.dash.debt')} value={d && formatSom(d.kpi.debt)} sub={d && t('clinical.dash.openInvoices', { n: d.kpi.debt_invoices })} href="/cashier?debt=1" danger={!!d?.kpi.debt} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title={t('clinical.dash.dailyRevenue')} actions={<span className="text-xs text-slate-600">{t('clinical.dash.dailyHint')}</span>}>
              {!d ? <Skeleton className="h-56" /> : <RevenueChart data={d.daily} />}
            </Card>
            <Card title={t('clinical.dash.attention')} padded={false}>
              {!d ? <div className="p-4"><Skeleton className="h-40" /></div> : <Attention a={d.attention} />}
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title={t('clinical.dash.byService')} actions={<Link href={`/reports?${rangeQs}`} className="text-xs font-medium text-brand-700 hover:underline">{t('clinical.dash.report')}</Link>}>
              {!d ? <Skeleton className="h-48" /> : <ServiceBars rows={d.by_service} href={`/reports?${rangeQs}`} />}
              <p className="mt-2 text-xs text-slate-600">{t('clinical.dash.byServiceNote')}</p>
            </Card>
            <Card title={t('clinical.dash.utilization')} padded={false}>
              {!d ? <div className="p-4"><Skeleton className="h-48" /></div> : <Utilization rows={d.doctors} />}
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title={t('clinical.dash.recentPayments')} padded={false} actions={<Link href={`/finance?${rangeQs}`} className="text-xs font-medium text-brand-700 hover:underline">{t('clinical.dash.paymentRegister')}</Link>}>
              {!d ? <div className="p-4"><Skeleton className="h-40" /></div> : !d.recent_payments.length ? <EmptyState title={t('clinical.dash.noPayments')} /> : (
                <ul className="divide-y divide-slate-100">
                  {d.recent_payments.map((p: any) => (
                    <li key={p.id}><Link href={`/cashier/${p.invoice_id}`} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50">
                      <span className="w-24 text-xs tabular-nums text-slate-600">{fmtDate(p.paid_at).slice(0, 5)} {fmtTime(p.paid_at)}</span>
                      <span className="flex-1 truncate">{fullName(p)}<span className="text-slate-600">, {t('clinical.dash.invoiceBranch', { n: p.invoice_number, branch: p.branch_name })}</span></span>
                      <span className="text-xs text-slate-600">{t(`payment.${p.method}` as MessageKey)}</span>
                      <span className="w-32 text-right font-medium tabular-nums">{formatSom(p.amount)}</span>
                    </Link></li>
                  ))}
                </ul>
              )}
            </Card>
            <AnalyticsAssistant />
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ icon, label, value, sub, href, loading, accent, danger }: { icon: React.ReactNode; label: string; value?: React.ReactNode; sub?: React.ReactNode; href?: string; loading?: boolean; accent?: boolean; danger?: boolean }) {
  const body = (
    <div className={cx('h-full rounded-lg border bg-white p-3.5 shadow-sm transition', href && 'hover:border-brand-300 hover:shadow', accent ? 'border-brand-200' : 'border-slate-200')}>
      <div className="flex items-center gap-2 text-[0.8125rem] font-medium text-slate-600"><span className={cx('[&>svg]:h-4 [&>svg]:w-4', danger ? 'text-red-600' : 'text-brand-600')}>{icon}</span>{label}</div>
      {loading ? <Skeleton className="mt-2 h-7 w-24" /> : <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>}
      {loading ? <Skeleton className="mt-1.5 h-3 w-32" /> : <div className="mt-0.5 text-xs text-slate-600">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg">{body}</Link> : body;
}

const short = (tiyin: number, t: T) => { const s = tiyin / 100; return s >= 1e6 ? t('clinical.dash.mln', { n: (s / 1e6).toFixed(s >= 1e7 ? 0 : 1) }) : s >= 1e3 ? t('clinical.dash.thousand', { n: Math.round(s / 1e3) }) : String(s); };

function RevenueChart({ data }: { data: { date: string; revenue: number; payments: number }[] }) {
  const router = useRouter();
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  if (!data.some((x) => x.revenue > 0)) return <EmptyState title={t('clinical.dash.noRevenue')} text={t('clinical.dash.noRevenueText')} />;
  const max = Math.max(...data.map((x) => x.revenue));
  const nice = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 10 : max / Math.pow(10, Math.floor(Math.log10(max))) > 2 ? 5 : 2);
  const ticks = [0, nice / 2, nice];
  const H = 200, W = 660, pad = 52; // logical size ≈ rendered size at 1366 px, so axis text stays readable
  const bw = Math.min(36, Math.max(6, (W - pad) / data.length - 6));
  const step = (W - pad - 16) / data.length; // 16 px right gutter keeps the last date label inside
  return (
    <div>
      <div className="mb-1 flex justify-end"><button onClick={() => setTable((v) => !v)} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800" aria-pressed={table}><Table2 className="h-3.5 w-3.5" />{table ? t('clinical.dash.chart') : t('clinical.dash.tableView')}</button></div>
      {table ? (
        <div className="max-h-56 overflow-y-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[0.8125rem] font-semibold text-slate-600"><th>{t('clinical.date')}</th><th className="text-right">{t('clinical.dash.colPayments')}</th><th className="text-right">{t('clinical.dash.colRevenue')}</th></tr></thead>
          <tbody>{data.map((x) => <tr key={x.date} className="border-t border-slate-100"><td className="py-1">{fmtDate(x.date)}</td><td className="text-right tabular-nums">{x.payments}</td><td className="text-right tabular-nums">{formatSom(x.revenue)}</td></tr>)}</tbody></table></div>
      ) : (
        <div className="relative overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H + 28}`} className="h-60 w-full min-w-[320px]" role="img" aria-label={t('clinical.dash.chartLabel')}>
            {ticks.map((v) => { const y = H - (v / nice) * (H - 10); return <g key={v}><line x1={pad} x2={W} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} /><text x={pad - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#64748b">{short(v, t)}</text></g>; })}
            {data.map((x, i) => {
              const h = (x.revenue / nice) * (H - 10);
              const cxp = pad + step * i + step / 2;
              const showLabel = data.length <= 10 || i % Math.ceil(data.length / 10) === 0 || i === data.length - 1;
              return (
                <g key={x.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  onClick={() => router.push(`/finance?from=${x.date}&to=${x.date}`)} onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/finance?from=${x.date}&to=${x.date}`); }}
                  tabIndex={0} role="link" aria-label={`${fmtDate(x.date)}: ${formatSom(x.revenue)}`} className="cursor-pointer focus:outline-none">
                  <rect x={pad + step * i} y={0} width={step} height={H} fill="transparent" />
                  {x.revenue > 0 && <path d={`M${cxp - bw / 2},${H} v${-Math.max(h - 4, 0)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(h - 4, 0)} z`} fill={hover === i ? '#25519c' : '#4a86d6'} />}
                  {showLabel && <text x={cxp} y={H + 16} textAnchor="middle" fontSize={10} fill="#64748b">{x.date.slice(8)}.{x.date.slice(5, 7)}</text>}
                </g>
              );
            })}
            <line x1={pad} x2={W} y1={H} y2={H} stroke="#94a3b8" strokeWidth={1} />
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg" style={{ left: `min(calc(${((pad + step * hover + step / 2) / W) * 100}% + 8px), calc(100% - 150px))` }}>
              <div className="text-sm font-semibold tabular-nums text-slate-900">{formatSom(data[hover].revenue)}</div>
              <div className="text-slate-600">{longDate(data[hover].date)}, {t('clinical.dash.payments', { n: data[hover].payments })}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ServiceBars({ rows, href }: { rows: any[]; href: string }) {
  const t = useT();
  if (!rows.length) return <EmptyState title={t('clinical.noServicesInPeriod')} />;
  const top = rows.slice(0, 7);
  const rest = rows.slice(7);
  const list = rest.length ? [...top, { service_id: 'other', service_name: t('clinical.dash.otherServices', { n: rest.length }), value: rest.reduce((a, b) => a + b.value, 0), count: rest.reduce((a, b) => a + b.count, 0) }] : top;
  const max = Math.max(...list.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {list.map((r) => (
        <li key={r.service_id}>
          <Link href={href} className="group block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" title={`${r.service_name}: ${formatSom(r.value)}, ${t('clinical.dash.timesDone', { n: r.count })}`}>
            <div className="mb-0.5 flex justify-between gap-2 text-[0.8125rem]"><span className="truncate text-slate-700">{r.service_name}{r.category && <span className="text-slate-600">, {t(`service.${r.category}` as MessageKey)}</span>}</span><span className="shrink-0 tabular-nums font-medium text-slate-800">{formatSom(r.value)}</span></div>
            <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500 group-hover:bg-brand-700" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Utilization({ rows }: { rows: any[] }) {
  const t = useT();
  if (!rows.length) return <EmptyState title={t('clinical.dash.noSchedule')} />;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.doctor_id}><Link href={`/staff?doctor=${r.doctor_id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
          <div className="w-40 min-w-0"><div className="truncate text-[0.8125rem] font-medium">{r.name}</div><div className="truncate text-2xs text-slate-600">{r.specialty}</div></div>
          <div className="flex-1"><div className="h-2 rounded-full bg-slate-100">{r.utilization != null && <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.min(100, r.utilization)}%` }} />}</div></div>
          <div className="w-28 text-right text-[0.8125rem] tabular-nums"><b>{r.utilization == null ? '—' : `${r.utilization}%`}</b><span className="text-xs text-slate-600">, {t('clinical.dash.visits', { n: r.appointments })}</span></div>
        </Link></li>
      ))}
      <li className="px-4 py-2 text-2xs text-slate-600">{t('clinical.dash.utilizationNote')}</li>
    </ul>
  );
}

function Attention({ a }: { a: any }) {
  const t = useT();
  const items = [
    { icon: <Wallet className="h-4 w-4 text-red-600" />, label: t('clinical.dash.unpaidInvoices'), value: t('clinical.dash.invoicesSum', { n: a.unpaid_invoices, sum: formatSom(a.unpaid_sum) }), href: '/cashier?debt=1', show: a.unpaid_invoices > 0 },
    { icon: <FlaskConical className="h-4 w-4 text-amber-600" />, label: t('clinical.dash.unverified'), value: `${t('clinical.dash.drafts', { n: a.lab_draft })}, ${t('clinical.dash.waiting', { n: a.lab_waiting })}`, href: '/lab?status=draft_result', show: a.lab_draft + a.lab_waiting > 0 },
    { icon: <Boxes className="h-4 w-4 text-amber-600" />, label: t('clinical.dash.lowStock'), value: a.low_stock.length ? a.low_stock.map((x: any) => `${x.name} (${Number(x.qty)} ${x.unit})`).slice(0, 3).join(', ') + (a.low_stock.length > 3 ? '…' : '') : '', href: '/inventory?low=1', show: a.low_stock.length > 0, count: a.low_stock.length },
    { icon: <AlertTriangle className="h-4 w-4 text-amber-600" />, label: t('clinical.dash.cancelledOpen'), value: t('clinical.dash.cancelledCount', { n: a.cancelled_with_invoice }), href: '/cashier?debt=1', show: a.cancelled_with_invoice > 0 },
  ].filter((x) => x.show);
  if (!items.length) return <EmptyState title={t('clinical.dash.allClear')} icon={<CheckCircle2 className="h-8 w-8 text-emerald-400" />} />;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((it) => (
        <li key={it.label}><Link href={it.href} className="flex gap-3 px-4 py-3 hover:bg-slate-50">
          <span className="mt-0.5">{it.icon}</span>
          <div className="min-w-0"><div className="text-sm font-medium text-slate-800">{it.label}{'count' in it && it.count ? ` — ${t('clinical.dash.items', { n: it.count })}` : ''}</div><div className="text-xs text-slate-600">{it.value}</div></div>
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
    <Card title={<span className="flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-brand-600" />{t('clinical.dash.quickQuestions')}</span>}>
      <div className="flex flex-col gap-2">
        {Q.map(([k, l]) => <Button key={k} size="sm" className="justify-start" loading={m.isPending && m.variables === k} onClick={() => m.mutate(k)}>{t(l)}</Button>)}
      </div>
      {m.isError && <p className="mt-3 text-sm text-red-700">{(m.error as Error).message}</p>}
      {m.data && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <p>{m.data.text}</p>
          <Link href={m.data.link} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><BarChart3 className="h-3.5 w-3.5" />{t('clinical.dash.openSource')}</Link>
        </div>
      )}
      <p className="mt-3 text-2xs text-slate-600">{t('clinical.dash.notAi')}</p>
    </Card>
  );
}
