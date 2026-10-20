'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, Wallet } from 'lucide-react';
import { INVOICE_STATUS_LABEL, type MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtDateTime, formatSom, fullName, pid } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Card, EmptyState, ErrorState, Input, LoadingRows, PageHeader, Pagination, Select, Table, Td, Th } from '@/components/ui';
import { InvoiceStatus } from '@/components/status';
import { ShiftPanel } from '@/components/cash-shift';

export default function CashierPage() { return <Suspense><Cashier /></Suspense>; }

function Cashier() {
  const t = useT();
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
      <PageHeader title={t('cash.title')} subtitle={me.role === 'cashier' ? t('cash.subtitleCashier') : t('cash.subtitleView')} />
      {me.role === 'cashier' && <ShiftPanel />}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('cash.searchPlaceholder')} aria-label={t('cash.search')} /></div>
          <Select aria-label={t('cash.status')} className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('cash.allStatuses')}</option><option value="debt">{t('cash.debtFilter')}</option>
            {Object.keys(INVOICE_STATUS_LABEL).map((k) => <option key={k} value={k}>{t(`status.invoice.${k}` as MessageKey)}</option>)}
          </Select>
          <Select aria-label={t('cash.period')} className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="today">{t('cash.today')}</option><option value="7d">{t('cash.last7')}</option><option value="30d">{t('cash.last30')}</option><option value="all">{t('cash.allTime')}</option>
          </Select>
        </div>
        {q.data?.meta.sums && <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm">
          <span>{t('cash.sumTotal')} <b className="tabular-nums">{formatSom(q.data.meta.sums.total)}</b></span>
          <span>{t('cash.sumPaid')} <b className="tabular-nums text-emerald-700">{formatSom(q.data.meta.sums.paid)}</b></span>
          <span>{t('cash.sumDue')} <b className="tabular-nums text-red-700">{formatSom(q.data.meta.sums.due)}</b></span>
        </div>}
        {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length ? <EmptyState icon={<Wallet className="h-8 w-8" />} title={t('cash.emptyTitle')} text={t('cash.emptyText')} /> : (
          <>
            <Table>
              <thead><tr><Th>{t('cash.colPatient')}</Th><Th>{t('cash.colInvoice')}</Th><Th>{t('cash.colServices')}</Th><Th right>{t('cash.colTotal')}</Th><Th right>{t('cash.colPaid')}</Th><Th right>{t('cash.colDue')}</Th><Th>{t('cash.status')}</Th><Th right>{t('cash.colAction')}</Th></tr></thead>
              <tbody>{q.data.data.map((i: any) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <Td><div className="font-medium">{fullName(i)}</div><div className="text-xs text-slate-600">{pid(i.patient_number)}, {i.branch_name}</div></Td>
                  <Td className="whitespace-nowrap"><div className="tabular-nums">№{i.invoice_number}</div><div className="text-xs text-slate-600">{fmtDateTime(i.created_at)}</div></Td>
                  <Td className="max-w-[260px]"><div className="truncate" title={i.services}>{i.services}</div></Td>
                  <Td right>{formatSom(i.total)}</Td><Td right>{formatSom(i.paid_amount)}</Td>
                  <Td right className={i.status !== 'void' && i.due > 0 ? 'font-semibold text-red-700' : ''}>{i.status === 'void' ? '—' : formatSom(i.due)}</Td>
                  <Td><InvoiceStatus status={i.status} /></Td>
                  <Td right><Link href={`/cashier/${i.id}`} className="rounded-md px-2 py-1 text-[0.8125rem] font-medium text-brand-700 hover:bg-brand-50">{me.role === 'cashier' && ['unpaid', 'partially_paid'].includes(i.status) ? t('cash.pay') : t('cash.open')}</Link></Td>
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
