'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { PAYMENT_METHOD_LABEL } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtDate, fmtDateTime, formatSom, fullName, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Card, EmptyState, ErrorState, Input, LoadingRows, PageHeader, Pagination, Select, Table, Tabs, Td, Th, DemoTag } from '@/components/ui';
import { InvoiceStatus } from '@/components/status';

export default function FinancePage() { return <Suspense><Finance /></Suspense>; }

function Finance() {
  const { me, branchId } = useSession();
  const sp = useSearchParams();
  const [tab, setTab] = useState<'payments' | 'debts' | 'expenses'>((sp.get('tab') as any) ?? 'payments');
  const [from, setFrom] = useState(sp.get('from') ?? me.today);
  const [to, setTo] = useState(sp.get('to') ?? me.today);
  const [method, setMethod] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setFrom(sp.get('from') ?? me.today); setTo(sp.get('to') ?? me.today); }, [sp, me.today]);
  useEffect(() => setPage(1), [from, to, method, branchId, tab]);
  const filters = { from, to, method, branch_id: branchId };
  const pays = useQuery({ queryKey: ['payments', filters, page], queryFn: () => api(`/payments${qs({ ...filters, page, page_size: 20 })}`), enabled: tab === 'payments', placeholderData: (p) => p });
  const debts = useQuery({ queryKey: ['invoices', 'debts', branchId, page], queryFn: () => api(`/invoices${qs({ debt: 1, branch_id: branchId, page, page_size: 20 })}`), enabled: tab === 'debts', placeholderData: (p) => p });
  const expenses = useQuery({ queryKey: ['expenses', from, to, branchId], queryFn: () => api(`/expenses${qs({ from, to, branch_id: branchId })}`), enabled: tab === 'expenses' && me.role === 'manager' });
  const tabs: { value: 'payments' | 'debts' | 'expenses'; label: string }[] = [{ value: 'payments', label: me.role === 'cashier' ? 'Mening to‘lovlarim' : 'To‘lovlar registri' }];
  if (me.role === 'manager') tabs.push({ value: 'debts' as const, label: 'Qarzdor hisoblar' }, { value: 'expenses' as const, label: 'Xarajatlar' });
  const setRange = (d: number) => { setFrom(addDays(me.today, -d)); setTo(me.today); };

  return (
    <>
      <PageHeader title={me.role === 'cashier' ? 'Mening to‘lovlarim' : 'Moliya'} subtitle="Tushum to‘lov vaqti bo‘yicha hisoblanadi (xizmat sanasi bo‘yicha emas)" />
      <Card padded={false}>
        <div className="px-3 pt-1"><Tabs value={tab} onChange={setTab} items={tabs} /></div>
        {tab !== 'debts' && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <Input type="date" aria-label="Boshlanish" className="h-8 w-[145px] text-[13px]" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            <span className="text-slate-400">–</span>
            <Input type="date" aria-label="Tugash" className="h-8 w-[145px] text-[13px]" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
            <div className="flex gap-1">{[['Bugun', 0], ['7 kun', 6], ['30 kun', 29]].map(([l, d]) => <button key={l} onClick={() => setRange(d as number)} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">{l}</button>)}</div>
            {tab === 'payments' && <Select aria-label="Usul" className="h-8 w-auto text-[13px]" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">Barcha usullar</option>{Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
            {tab === 'payments' && <a href={`/api/v1/payments/export.csv${qs(filters)}`} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[13px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"><Download className="h-3.5 w-3.5" />CSV eksport</a>}
          </div>
        )}
        {tab === 'payments' && (pays.isLoading ? <LoadingRows /> : pays.isError ? <ErrorState error={pays.error} onRetry={() => pays.refetch()} /> : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm">
              <span>Jami tushum: <b className="tabular-nums">{formatSom(pays.data.meta.sum)}</b> ({pays.data.meta.total} ta)</span>
              {pays.data.meta.by_method.map((m: any) => <span key={m.method} className="text-slate-600">{PAYMENT_METHOD_LABEL[m.method]}: <b className="tabular-nums text-slate-800">{formatSom(Number(m.sum))}</b> ({m.n})</span>)}
            </div>
            {!pays.data.data.length ? <EmptyState title="Bu davrda to‘lov yo‘q" /> : (
              <>
                <Table>
                  <thead><tr><Th>Qayd №</Th><Th>Vaqt</Th><Th>Bemor</Th><Th>Hisob</Th><Th>Filial</Th><Th>Usul</Th><Th>Kassir</Th><Th right>Summa</Th></tr></thead>
                  <tbody>{pays.data.data.map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <Td className="tabular-nums"><Link href={`/print/payment/${p.id}`} target="_blank" className="text-brand-700 hover:underline">{p.receipt_number}</Link></Td>
                      <Td className="whitespace-nowrap">{fmtDateTime(p.paid_at)}</Td><Td>{fullName(p)} <span className="text-slate-500">{pid(p.patient_number)}</span></Td>
                      <Td><Link href={`/cashier/${p.invoice_id}`} className="text-brand-700 hover:underline">№{p.invoice_number}</Link></Td><Td>{p.branch_name}</Td>
                      <Td>{PAYMENT_METHOD_LABEL[p.method]}</Td><Td>{p.cashier_name}</Td><Td right className="font-medium">{formatSom(p.amount)}</Td>
                    </tr>
                  ))}</tbody>
                </Table>
                <Pagination page={page} pageSize={20} total={pays.data.meta.total} onPage={setPage} />
              </>
            )}
          </>
        ))}
        {tab === 'debts' && (debts.isLoading ? <LoadingRows /> : debts.isError ? <ErrorState error={debts.error} onRetry={() => debts.refetch()} /> : (
          <>
            <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm">Joriy qarzdorlik: <b className="tabular-nums text-red-700">{formatSom(debts.data.meta.sums.due)}</b> · {debts.data.meta.total} ta hisob (bekor qilinganlar kirmaydi)</div>
            <Table>
              <thead><tr><Th>Bemor</Th><Th>Hisob</Th><Th>Sana</Th><Th>Filial</Th><Th right>Jami</Th><Th right>To‘langan</Th><Th right>Qoldiq</Th><Th>Holat</Th></tr></thead>
              <tbody>{debts.data.data.map((i: any) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <Td>{fullName(i)} <span className="text-slate-500">{pid(i.patient_number)}</span></Td><Td><Link href={`/cashier/${i.id}`} className="text-brand-700 hover:underline">№{i.invoice_number}</Link></Td>
                  <Td>{fmtDate(i.created_at)}</Td><Td>{i.branch_name}</Td><Td right>{formatSom(i.total)}</Td><Td right>{formatSom(i.paid_amount)}</Td><Td right className="font-semibold text-red-700">{formatSom(i.due)}</Td><Td><InvoiceStatus status={i.status} /></Td>
                </tr>
              ))}</tbody>
            </Table>
            <Pagination page={page} pageSize={20} total={debts.data.meta.total} onPage={setPage} />
          </>
        ))}
        {tab === 'expenses' && (expenses.isLoading ? <LoadingRows /> : expenses.isError ? <ErrorState error={expenses.error} onRetry={() => expenses.refetch()} /> : (
          <>
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm"><span>Jami xarajat: <b className="tabular-nums">{formatSom(expenses.data.meta.total)}</b></span><DemoTag /><span className="text-xs text-slate-500">Xarajat qo‘shish formasi keyingi relizda; sof foyda ko‘rsatilmaydi.</span></div>
            {!expenses.data.data.length ? <EmptyState title="Bu davrda xarajat yo‘q" text="Sanani kengaytiring (masalan, 30 kun)." /> : (
              <Table>
                <thead><tr><Th>Sana</Th><Th>Kategoriya</Th><Th>Filial</Th><Th>Izoh</Th><Th right>Summa</Th></tr></thead>
                <tbody>{expenses.data.data.map((e: any) => <tr key={e.id}><Td>{fmtDate(e.occurred_at)}</Td><Td><Badge>{e.category}</Badge></Td><Td>{e.branch_name}</Td><Td>{e.note}</Td><Td right>{formatSom(e.amount)}</Td></tr>)}</tbody>
              </Table>
            )}
          </>
        ))}
      </Card>
    </>
  );
}
