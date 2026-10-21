'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, Wallet } from 'lucide-react';
import { INVOICE_STATUS_LABEL, type MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtDateTime, formatSom, fullName, pid } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Button, Card, EmptyState, ErrorState, Input, LinkButton, LoadingRows, PageHeader, Pagination, Select, Table, Td, Th, Toolbar } from '@/components/ui';
import { InvoiceStatus } from '@/components/status';
import { useShiftUi } from '@/components/cash-shift';
import { FootRow } from '@/components/finance-extra';

export default function CashierPage() { return <Suspense><Cashier /></Suspense>; }

function Cashier() {
  const t = useT();
  const { me, branchId } = useSession();
  const sp = useSearchParams();
  const cashier = me.role === 'cashier';
  const shift = useShiftUi(cashier);
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
  const showBranch = !branchId;
  return (
    <>
      <PageHeader title={t('cash.title')} subtitle={cashier ? shift.subtitle : t('cash.subtitleView')} actions={shift.actions} />
      {shift.body}
      <Card padded={false}>
        <Toolbar>
          <div className="relative w-full min-w-0 sm:min-w-[16rem] sm:flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" /><Input className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('cash.searchPlaceholder')} aria-label={t('cash.search')} /></div>
          <Select aria-label={t('cash.status')} className="w-full sm:w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('cash.allStatuses')}</option><option value="debt">{t('cash.debtFilter')}</option>
            {Object.keys(INVOICE_STATUS_LABEL).map((k) => <option key={k} value={k}>{t(`status.invoice.${k}` as MessageKey)}</option>)}
          </Select>
          <Select aria-label={t('cash.period')} className="w-full sm:w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="today">{t('cash.today')}</option><option value="7d">{t('cash.last7')}</option><option value="30d">{t('cash.last30')}</option><option value="all">{t('cash.allTime')}</option>
          </Select>
        </Toolbar>
        {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.data.length
          ? <EmptyState compact icon={<Wallet />} title={t('cash.emptyTitle')} action={period !== 'all' ? <Button onClick={() => setPeriod('all')}>{t('cash.showAllTime')}</Button> : undefined} />
          : (
          <>
            <Table>
              <thead><tr><Th>{t('cash.colPatient')}</Th><Th className="hidden sm:table-cell">{t('cash.colInvoice')}</Th><Th className="hidden 2xl:table-cell">{t('cash.colServices')}</Th><Th right className="hidden md:table-cell">{t('cash.colTotal')}</Th><Th right className="hidden 2xl:table-cell">{t('cash.colPaid')}</Th><Th right>{t('cash.colDue')}</Th><Th className="hidden sm:table-cell">{t('cash.status')}</Th><Th right className="right-0 z-10">{t('cash.colAction')}</Th></tr></thead>
              <tbody>{q.data.data.map((i: any) => (
                <tr key={i.id} className="group hover:bg-slate-50">
                  <Td className="min-w-[9rem]"><div className="font-medium text-slate-900">{fullName(i)}</div><div className="text-[0.8125rem] text-slate-600">{pid(i.patient_number)}{showBranch && `, ${i.branch_name}`}</div>
                    {/* phone: the invoice number and the status move under the name (their columns are hidden) */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] tabular-nums text-slate-600 sm:hidden"><span>№{i.invoice_number}</span><InvoiceStatus status={i.status} /></div></Td>
                  <Td className="hidden whitespace-nowrap sm:table-cell"><div className="tabular-nums">№{i.invoice_number}</div><div className="text-[0.8125rem] text-slate-600">{fmtDateTime(i.created_at)}</div><div className="w-0 min-w-full truncate text-[0.8125rem] text-slate-600 2xl:hidden">{i.services}</div></Td>
                  <Td className="hidden max-w-[16rem] 2xl:table-cell"><div className="truncate">{i.services}</div></Td>
                  <Td right className="hidden md:table-cell">{formatSom(i.total)}</Td><Td right className="hidden 2xl:table-cell">{formatSom(i.paid_amount)}</Td>
                  <Td right className={i.status !== 'void' && i.due > 0 ? 'font-semibold text-red-700' : ''}>{i.status === 'void' ? '—' : formatSom(i.due)}</Td>
                  <Td className="hidden sm:table-cell"><InvoiceStatus status={i.status} /></Td>
                  <Td right className="relative !pl-1 sm:sticky sm:right-0 sm:bg-white sm:group-hover:bg-slate-50">{cashier && ['unpaid', 'partially_paid'].includes(i.status)
                    ? <LinkButton size="sm" href={`/cashier/${i.id}`} icon={<Wallet className="h-4 w-4" />} ><span className="sr-only sm:not-sr-only">{t('cash.pay')}</span></LinkButton>
                    : <LinkButton size="sm" variant="ghost" href={`/cashier/${i.id}`}>{t('cash.open')}</LinkButton>}</Td>
                </tr>
              ))}</tbody>
              <tfoot><FootRow cells={[
                { left: true, value: t('cash.totalInvoices', { n: q.data.meta.total }) }, { className: 'hidden sm:table-cell' }, { className: 'hidden 2xl:table-cell' },
                { className: 'hidden md:table-cell', value: formatSom(q.data.meta.sums.total) }, { className: 'hidden text-emerald-800 2xl:table-cell', value: formatSom(q.data.meta.sums.paid) }, { className: q.data.meta.sums.due ? 'text-red-700' : '', value: formatSom(q.data.meta.sums.due) }, { className: 'hidden sm:table-cell' }, {},
              ]} /></tfoot>
            </Table>
            <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
