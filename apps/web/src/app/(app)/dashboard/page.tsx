'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, CalendarCheck2, CheckCircle2, FlaskConical, MessageSquareText, Table2, UserCheck, Wallet, Banknote, BarChart3 } from 'lucide-react';
import { PAYMENT_METHOD_LABEL, SERVICE_CATEGORY_LABEL } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtDate, fmtTime, formatSom, fullName, longDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, cx, EmptyState, ErrorState, Input, PageHeader, Skeleton } from '@/components/ui';

type Period = 'today' | '7d' | '30d' | 'custom';

export default function DashboardPage() {
  const { me, branchId, branchName } = useSession();
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
      <PageHeader title="Umumiy ko‘rinish" subtitle={`${branchName} · ${periodLabel}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-slate-300 bg-white p-0.5 shadow-sm" role="group" aria-label="Davr">
              {([['today', 'Bugun'], ['7d', 'Oxirgi 7 kun'], ['30d', 'Oxirgi 30 kun'], ['custom', 'Oraliq']] as [Period, string][]).map(([v, l]) => (
                <button key={v} onClick={() => setPeriod(v)} aria-pressed={period === v} className={cx('rounded px-3 py-1 text-[13px] font-medium', period === v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
              ))}
            </div>
            {period === 'custom' && <><Input type="date" aria-label="Boshlanish" className="h-8 w-[145px] text-[13px]" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /><span className="text-slate-400">–</span><Input type="date" aria-label="Tugash" className="h-8 w-[145px] text-[13px]" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></>}
          </div>
        } />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Kpi loading={!d} icon={<CalendarCheck2 />} label="Qabullar" value={d?.kpi.appointments} sub={d && `bekor: ${d.kpi.cancelled} · kelmadi: ${d.kpi.no_show}`} href={d && `/schedule?date=${d.range.to}`} />
            <Kpi loading={!d} icon={<UserCheck />} label="Kelgan bemorlar" value={d?.kpi.arrived_patients} sub={d && `hozir klinikada: ${d.kpi.in_clinic}`} href="/queue" />
            <Kpi loading={!d} icon={<CheckCircle2 />} label="Yakunlangan qabullar" value={d?.kpi.completed} sub={d && `rejalashtirilgan: ${d.kpi.scheduled}`} href={d && `/schedule?date=${d.range.to}&status=completed`} />
            <Kpi loading={!d} icon={<Banknote />} label="Qayd etilgan tushum" value={d && formatSom(d.kpi.revenue)} sub={d && `${d.kpi.payments} ta to‘lov`} href={`/finance?${rangeQs}`} accent />
            <Kpi loading={!d} icon={<Wallet />} label="Qarzdorlik (joriy)" value={d && formatSom(d.kpi.debt)} sub={d && `${d.kpi.debt_invoices} ta ochiq hisob`} href="/cashier?debt=1" danger={!!d?.kpi.debt} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Kunlik tushum" actions={<span className="text-xs text-slate-500">To‘lov vaqti bo‘yicha · ustunni bosing — to‘lovlar ro‘yxati</span>}>
              {!d ? <Skeleton className="h-56" /> : <RevenueChart data={d.daily} />}
            </Card>
            <Card title="E’tibor talab qiladi" padded={false}>
              {!d ? <div className="p-4"><Skeleton className="h-40" /></div> : <Attention a={d.attention} />}
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="Xizmatlar bo‘yicha summa" actions={<Link href={`/reports?${rangeQs}`} className="text-xs font-medium text-brand-700 hover:underline">Hisobot</Link>}>
              {!d ? <Skeleton className="h-48" /> : <ServiceBars rows={d.by_service} href={`/reports?${rangeQs}`} />}
              <p className="mt-2 text-xs text-slate-500">Bajarilgan xizmatlar qiymati (chegirmadan keyin). Qayd etilgan tushumga teng bo‘lishi shart emas.</p>
            </Card>
            <Card title="Shifokorlar bandligi" padded={false}>
              {!d ? <div className="p-4"><Skeleton className="h-48" /></div> : <Utilization rows={d.doctors} />}
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="So‘nggi to‘lovlar" padded={false} actions={<Link href={`/finance?${rangeQs}`} className="text-xs font-medium text-brand-700 hover:underline">To‘lovlar registri</Link>}>
              {!d ? <div className="p-4"><Skeleton className="h-40" /></div> : !d.recent_payments.length ? <EmptyState title="Bu davrda to‘lov yo‘q" /> : (
                <ul className="divide-y divide-slate-100">
                  {d.recent_payments.map((p: any) => (
                    <li key={p.id}><Link href={`/cashier/${p.invoice_id}`} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50">
                      <span className="w-24 text-xs tabular-nums text-slate-500">{fmtDate(p.paid_at).slice(0, 5)} {fmtTime(p.paid_at)}</span>
                      <span className="flex-1 truncate">{fullName(p)} <span className="text-slate-500">· hisob №{p.invoice_number} · {p.branch_name}</span></span>
                      <span className="text-xs text-slate-500">{PAYMENT_METHOD_LABEL[p.method]}</span>
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
      <div className="flex items-center gap-2 text-[13px] font-medium text-slate-600"><span className={cx('[&>svg]:h-4 [&>svg]:w-4', danger ? 'text-red-600' : 'text-brand-600')}>{icon}</span>{label}</div>
      {loading ? <Skeleton className="mt-2 h-7 w-24" /> : <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>}
      {loading ? <Skeleton className="mt-1.5 h-3 w-32" /> : <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg">{body}</Link> : body;
}

const short = (tiyin: number) => { const s = tiyin / 100; return s >= 1e6 ? `${(s / 1e6).toFixed(s >= 1e7 ? 0 : 1)} mln` : s >= 1e3 ? `${Math.round(s / 1e3)} ming` : String(s); };

function RevenueChart({ data }: { data: { date: string; revenue: number; payments: number }[] }) {
  const router = useRouter();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  if (!data.some((x) => x.revenue > 0)) return <EmptyState title="Bu davrda to‘lov qayd etilmagan" text="Grafik sun’iy raqam bilan to‘ldirilmaydi." />;
  const max = Math.max(...data.map((x) => x.revenue));
  const nice = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 10 : max / Math.pow(10, Math.floor(Math.log10(max))) > 2 ? 5 : 2);
  const ticks = [0, nice / 2, nice];
  const H = 200, W = 660, pad = 52; // logical size ≈ rendered size at 1366 px, so axis text stays readable
  const bw = Math.min(36, Math.max(6, (W - pad) / data.length - 6));
  const step = (W - pad - 16) / data.length; // 16 px right gutter keeps the last date label inside
  return (
    <div>
      <div className="mb-1 flex justify-end"><button onClick={() => setTable((t) => !t)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800" aria-pressed={table}><Table2 className="h-3.5 w-3.5" />{table ? 'Grafik' : 'Jadval ko‘rinishi'}</button></div>
      {table ? (
        <div className="max-h-56 overflow-y-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th>Sana</th><th className="text-right">To‘lovlar</th><th className="text-right">Tushum</th></tr></thead>
          <tbody>{data.map((x) => <tr key={x.date} className="border-t border-slate-100"><td className="py-1">{fmtDate(x.date)}</td><td className="text-right tabular-nums">{x.payments}</td><td className="text-right tabular-nums">{formatSom(x.revenue)}</td></tr>)}</tbody></table></div>
      ) : (
        <div className="relative overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H + 28}`} className="h-60 w-full min-w-[320px]" role="img" aria-label="Kunlik tushum grafigi">
            {ticks.map((t) => { const y = H - (t / nice) * (H - 10); return <g key={t}><line x1={pad} x2={W} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} /><text x={pad - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#64748b">{short(t)}</text></g>; })}
            {data.map((x, i) => {
              const h = (x.revenue / nice) * (H - 10);
              const cxp = pad + step * i + step / 2;
              const showLabel = data.length <= 10 || i % Math.ceil(data.length / 10) === 0 || i === data.length - 1;
              return (
                <g key={x.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  onClick={() => router.push(`/finance?from=${x.date}&to=${x.date}`)} onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/finance?from=${x.date}&to=${x.date}`); }}
                  tabIndex={0} role="link" aria-label={`${fmtDate(x.date)}: ${formatSom(x.revenue)}`} className="cursor-pointer focus:outline-none">
                  <rect x={pad + step * i} y={0} width={step} height={H} fill="transparent" />
                  {x.revenue > 0 && <path d={`M${cxp - bw / 2},${H} v${-Math.max(h - 4, 0)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(h - 4, 0)} z`} fill={hover === i ? '#11605c' : '#17958c'} />}
                  {showLabel && <text x={cxp} y={H + 16} textAnchor="middle" fontSize={10} fill="#64748b">{x.date.slice(8)}.{x.date.slice(5, 7)}</text>}
                </g>
              );
            })}
            <line x1={pad} x2={W} y1={H} y2={H} stroke="#94a3b8" strokeWidth={1} />
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg" style={{ left: `min(calc(${((pad + step * hover + step / 2) / W) * 100}% + 8px), calc(100% - 150px))` }}>
              <div className="text-sm font-semibold tabular-nums text-slate-900">{formatSom(data[hover].revenue)}</div>
              <div className="text-slate-500">{longDate(data[hover].date)} · {data[hover].payments} ta to‘lov</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ServiceBars({ rows, href }: { rows: any[]; href: string }) {
  if (!rows.length) return <EmptyState title="Bu davrda bajarilgan xizmat yo‘q" />;
  const top = rows.slice(0, 7);
  const rest = rows.slice(7);
  const list = rest.length ? [...top, { service_id: 'other', service_name: `Boshqa (${rest.length} xizmat)`, value: rest.reduce((a, b) => a + b.value, 0), count: rest.reduce((a, b) => a + b.count, 0) }] : top;
  const max = Math.max(...list.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {list.map((r) => (
        <li key={r.service_id}>
          <Link href={href} className="group block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" title={`${r.service_name}: ${formatSom(r.value)}, ${r.count} ta`}>
            <div className="mb-0.5 flex justify-between gap-2 text-[13px]"><span className="truncate text-slate-700">{r.service_name} {r.category && <span className="text-slate-400">· {SERVICE_CATEGORY_LABEL[r.category]}</span>}</span><span className="shrink-0 tabular-nums font-medium text-slate-800">{formatSom(r.value)}</span></div>
            <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500 group-hover:bg-brand-700" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Utilization({ rows }: { rows: any[] }) {
  if (!rows.length) return <EmptyState title="Bu davrda ish jadvali yo‘q" />;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.doctor_id}><Link href={`/staff?doctor=${r.doctor_id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
          <div className="w-40 min-w-0"><div className="truncate text-[13px] font-medium">{r.name}</div><div className="truncate text-2xs text-slate-500">{r.specialty}</div></div>
          <div className="flex-1"><div className="h-2 rounded-full bg-slate-100">{r.utilization != null && <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.min(100, r.utilization)}%` }} />}</div></div>
          <div className="w-28 text-right text-[13px] tabular-nums"><b>{r.utilization == null ? '—' : `${r.utilization}%`}</b> <span className="text-xs text-slate-500">· {r.appointments} qabul</span></div>
        </Link></li>
      ))}
      <li className="px-4 py-2 text-2xs text-slate-500">Bandlik = band qabul daqiqalari / tanaffussiz ish daqiqalari. Ish vaqti 0 bo‘lsa «—».</li>
    </ul>
  );
}

function Attention({ a }: { a: any }) {
  const items = [
    { icon: <Wallet className="h-4 w-4 text-red-600" />, label: 'To‘lanmagan / qisman hisoblar', value: `${a.unpaid_invoices} ta · ${formatSom(a.unpaid_sum)}`, href: '/cashier?debt=1', show: a.unpaid_invoices > 0 },
    { icon: <FlaskConical className="h-4 w-4 text-amber-600" />, label: 'Tasdiqlanmagan natijalar', value: `${a.lab_draft} ta qoralama · ${a.lab_waiting} ta kutilmoqda`, href: '/lab?status=draft_result', show: a.lab_draft + a.lab_waiting > 0 },
    { icon: <Boxes className="h-4 w-4 text-amber-600" />, label: 'Kam qolgan materiallar', value: a.low_stock.length ? a.low_stock.map((x: any) => `${x.name} (${Number(x.qty)} ${x.unit})`).slice(0, 3).join(', ') + (a.low_stock.length > 3 ? '…' : '') : '', href: '/inventory?low=1', show: a.low_stock.length > 0, count: a.low_stock.length },
    { icon: <AlertTriangle className="h-4 w-4 text-amber-600" />, label: 'Bekor qilingan qabul, hisob ochiq', value: `${a.cancelled_with_invoice} ta`, href: '/cashier?debt=1', show: a.cancelled_with_invoice > 0 },
  ].filter((x) => x.show);
  if (!items.length) return <EmptyState title="Diqqat talab qiladigan holat yo‘q" icon={<CheckCircle2 className="h-8 w-8 text-emerald-400" />} />;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((it) => (
        <li key={it.label}><Link href={it.href} className="flex gap-3 px-4 py-3 hover:bg-slate-50">
          <span className="mt-0.5">{it.icon}</span>
          <div className="min-w-0"><div className="text-sm font-medium text-slate-800">{it.label}{'count' in it && it.count ? ` — ${it.count} ta` : ''}</div><div className="text-xs text-slate-500">{it.value}</div></div>
        </Link></li>
      ))}
    </ul>
  );
}

function AnalyticsAssistant() {
  const { branchId } = useSession();
  const m = useMutation({ mutationFn: (question: string) => api('/ai/report-explanation', { method: 'POST', body: { question, branch_id: branchId || null } }).then((r) => r.data) });
  const Q = [['revenue_today', 'Bugungi tushum qancha?'], ['top_services', 'Qaysi xizmatlar ko‘proq summa berdi?'], ['debts', 'Qarzdor hisoblar nechta?']];
  return (
    <Card title={<span className="flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-brand-600" />Tezkor savollar</span>}>
      <div className="flex flex-col gap-2">
        {Q.map(([k, l]) => <Button key={k} size="sm" className="justify-start" loading={m.isPending && m.variables === k} onClick={() => m.mutate(k)}>{l}</Button>)}
      </div>
      {m.isError && <p className="mt-3 text-sm text-red-700">{(m.error as Error).message}</p>}
      {m.data && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <p>{m.data.text}</p>
          <Link href={m.data.link} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><BarChart3 className="h-3.5 w-3.5" />Asos bo‘lgan ro‘yxatni ochish</Link>
        </div>
      )}
      <p className="mt-3 text-2xs text-slate-500">Javoblar bazadagi hisob-kitobdan avtomatik shablon bilan tuziladi — bu AI emas. Raqam uydirilmaydi.</p>
    </Card>
  );
}
