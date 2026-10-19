'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, Wallet } from 'lucide-react';
import { INVOICE_STATUS_LABEL } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtDateTime, formatSom, fullName, pid } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Card, EmptyState, ErrorState, Input, LoadingRows, PageHeader, Pagination, Select, Table, Td, Th } from '@/components/ui';
import { InvoiceStatus } from '@/components/status';
import { ShiftPanel } from '@/components/cash-shift';

export default function CashierPage() { return <Suspense><Cashier /></Suspense>; }

function Cashier() {
  const { me, branchId } = useSession();
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get('debt') === '1' ? 'debt' : sp.get('status') ?? '');
  const [period, setPeriod] = useState(sp.get('debt') === '1' ? 'all' : sp.get('period') ?? 'today');
  const [search, setSearch] = useState(sp.get('search') ?? '');
  const [page, setPage] = useState(1);
  const ds = useDebounced(search.trim(), 300);
  useEffect(() => setPage(1), [ds, status, period, branchId]);
  const from = period === 'today' ? me.today : period === '7d' ? addDays(me.today, -6) : period === '30d' ? addDays(me.today, -29) : undefined;
  const q = useQuery({
    queryKey: ['invoices', status, period, ds, page, branchId],
    queryFn: () => api(`/invoices${qs({ status: status === 'debt' ? undefined : status, debt: status === 'debt' ? 1 : undefined, from, to: from ? me.today : undefined, search: ds, page, page_size: 20, branch_id: branchId })}`),
    placeholderData: (p) => p, refetchInterval: 20_000,
  });
  return (
    <>
      <PageHeader title="Kassa" subtitle={me.role === 'cashier' ? 'Hisoblar va to‘lovlarni qayd qilish' : 'Hisoblar (ko‘rish)'} />
      {me.role === 'cashier' && <ShiftPanel />}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bemor, bemor ID yoki hisob №" aria-label="Qidirish" /></div>
          <Select aria-label="Holat" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Barcha holatlar</option><option value="debt">Qarzdor (to‘lanmagan + qisman)</option>
            {Object.entries(INVOICE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select aria-label="Davr" className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="today">Bugun</option><option value="7d">Oxirgi 7 kun</option><option value="30d">Oxirgi 30 kun</option><option value="all">Barcha davr</option>
          </Select>
        </div>
        {q.data?.meta.sums && <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm">
          <span>Hisoblar jami: <b className="tabular-nums">{formatSom(q.data.meta.sums.total)}</b></span>
          <span>To‘langan: <b className="tabular-nums text-emerald-700">{formatSom(q.data.meta.sums.paid)}</b></span>
          <span>Qoldiq: <b className="tabular-nums text-red-700">{formatSom(q.data.meta.sums.due)}</b></span>
        </div>}
        {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? <EmptyState icon={<Wallet className="h-8 w-8" />} title="Hisob topilmadi" text="Filtrlarni o‘zgartiring yoki «Barcha davr» ni tanlang." /> : (
          <>
            <Table>
              <thead><tr><Th>Bemor</Th><Th>Hisob</Th><Th>Xizmatlar</Th><Th right>Jami</Th><Th right>To‘langan</Th><Th right>Qoldiq</Th><Th>Holat</Th><Th right>Amal</Th></tr></thead>
              <tbody>{q.data.data.map((i: any) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <Td><div className="font-medium">{fullName(i)}</div><div className="text-xs text-slate-500">{pid(i.patient_number)} · {i.branch_name}</div></Td>
                  <Td className="whitespace-nowrap"><div className="tabular-nums">№{i.invoice_number}</div><div className="text-xs text-slate-500">{fmtDateTime(i.created_at)}</div></Td>
                  <Td className="max-w-[260px]"><div className="truncate" title={i.services}>{i.services}</div></Td>
                  <Td right>{formatSom(i.total)}</Td><Td right>{formatSom(i.paid_amount)}</Td>
                  <Td right className={i.status !== 'void' && i.due > 0 ? 'font-semibold text-red-700' : ''}>{i.status === 'void' ? '—' : formatSom(i.due)}</Td>
                  <Td><InvoiceStatus status={i.status} /></Td>
                  <Td right><Link href={`/cashier/${i.id}`} className="rounded-md px-2 py-1 text-[13px] font-medium text-brand-700 hover:bg-brand-50">{me.role === 'cashier' && ['unpaid', 'partially_paid'].includes(i.status) ? 'To‘lash' : 'Ochish'}</Link></Td>
                </tr>
              ))}</tbody>
            </Table>
            <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
