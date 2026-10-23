'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Banknote, CreditCard, Download, Landmark, Plus, Search, Wallet } from 'lucide-react';
import { PAYMENT_METHOD_LABEL, type MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, formatSom, fullName, pid } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Button, Card, cx, EmptyState, ErrorState, Input, LoadingRows, PageHeader, Pagination, Select, StatCard, Table, Tabs, Td, Th, Toolbar } from '@/components/ui';
import { InvoiceStatus } from '@/components/status';
import { ExpenseModal, ExpensesTab, FinanceStats, FootRow, PeriodPicker, RefundsTab, ShiftsTab, StatRow } from '@/components/finance-extra';
import { StatMoney } from '@/components/cash-shift';
import { FiscalBadge, useFiscalEnabled } from '@/components/fiscal';

type Tab = 'payments' | 'refunds' | 'debts' | 'expenses' | 'shifts';
const TABS: Tab[] = ['payments', 'refunds', 'debts', 'expenses', 'shifts'];
const METHOD_ICON: Record<string, React.ReactNode> = { cash: <Banknote />, card: <CreditCard />, transfer: <Landmark /> };
export default function FinancePage() { return <Suspense><Finance /></Suspense>; }

function Finance() {
  const t = useT();
  const { me, branchId } = useSession();
  const sp = useSearchParams();
  const cashier = me.role === 'cashier';
  const manager = me.role === 'manager';
  const tabFromUrl = (): Tab => { const v = sp.get('tab') as Tab; return TABS.includes(v) && (manager || v === 'payments' || v === 'shifts') ? v : 'payments'; };
  const [tab, setTab] = useState<Tab>(tabFromUrl);
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState(sp.get('from') ?? me.today);
  const [to, setTo] = useState(sp.get('to') ?? me.today);
  const [method, setMethod] = useState('');
  // «chek kiritilmagan to‘lovlar»: payments whose fiscal receipt is still owed (parallel mode)
  const [fiscalFilter, setFiscalFilter] = useState(sp.get('fiscal') === 'missing' ? 'missing' : '');
  const fiscal = useFiscalEnabled();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const ds = useDebounced(search.trim(), 300);
  useEffect(() => { setFrom(sp.get('from') ?? me.today); setTo(sp.get('to') ?? me.today); setTab(tabFromUrl()); setFiscalFilter(sp.get('fiscal') === 'missing' ? 'missing' : ''); }, [sp, me.today]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPage(1), [from, to, method, branchId, tab, ds, fiscalFilter]);
  // one branch chosen in the top bar (or only one exists): the branch column would repeat it on every row
  const showBranch = !branchId;
  const filters = { from, to, method, branch_id: branchId, fiscal: fiscal ? fiscalFilter : '' };
  // the cashier's key numbers come from the register itself, so it loads on every tab for them
  const pays = useQuery({ queryKey: ['payments', filters, page], queryFn: () => api(`/payments${qs({ ...filters, page, page_size: 20 })}`), enabled: tab === 'payments' || cashier, placeholderData: (p) => p });
  const debts = useQuery({ queryKey: ['invoices', 'debts', branchId, ds, page], queryFn: () => api(`/invoices${qs({ debt: 1, branch_id: branchId, search: ds, page, page_size: 20 })}`), enabled: tab === 'debts', placeholderData: (p) => p });

  const tabs: { value: Tab; label: string }[] = [{ value: 'payments', label: cashier ? t('cash.payments') : t('cash.paymentRegister') }];
  if (manager) tabs.push({ value: 'refunds', label: t('cash.refunds') }, { value: 'debts', label: t('cash.debtInvoices') }, { value: 'expenses', label: t('cash.expenses') });
  tabs.push({ value: 'shifts', label: cashier ? t('cash.shiftsTab') : t('cash.cashShifts') });
  const period = <PeriodPicker from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />;
  const byMethod = (m: string) => pays.data?.meta.by_method.find((x: any) => x.method === m);

  return (
    <>
      <PageHeader title={cashier ? t('cash.myPayments') : t('cash.finance')} subtitle={cashier ? t('cash.financeSubtitleCashier') : t('cash.financeSubtitle')}
        actions={manager && <Button variant="primary" icon={<Plus className="h-5 w-5" />} onClick={() => setAdding(true)}>{t('cash.addExpense')}</Button>} />

      {manager && <FinanceStats from={from} to={to} branchId={branchId} />}
      {cashier && !(pays.isError && !pays.data) && (
        <StatRow label={t('cash.financeResult')}>
          <StatCard icon={<Wallet />} label={t('cash.paymentsTotal')} loading={pays.isPending} value={pays.data && <StatMoney tiyin={pays.data.meta.sum} />} sub={pays.data && t('cash.nPayments', { n: pays.data.meta.total })} />
          {Object.keys(PAYMENT_METHOD_LABEL).map((m) => (
            <StatCard key={m} icon={METHOD_ICON[m]} label={t(`payment.${m}` as MessageKey)} loading={pays.isPending} value={pays.data && <StatMoney tiyin={Number(byMethod(m)?.sum ?? 0)} />} sub={pays.data && t('cash.nPayments', { n: byMethod(m)?.n ?? 0 })} />
          ))}
        </StatRow>
      )}

      <Card padded={false}>
        <div className="px-3 pt-1"><Tabs value={tab} onChange={setTab} items={tabs} /></div>

        {tab === 'payments' && <>
          <Toolbar actions={
            // a plain download link (the browser saves the file), dressed as the other glass capsules
            <a href={`/api/v1/payments/export.csv${qs(filters)}`} download aria-label={t('cash.csvExport', { format: 'CSV' })} title={t('cash.csvExport', { format: 'CSV' })} className="glass-btn inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full border-2 border-transparent px-5 text-[0.9375rem] font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"><Download className="h-4 w-4" />CSV</a>
          }>
            {period}
            <Select aria-label={t('cash.colMethod')} className="w-full sm:w-auto sm:min-w-[11.5rem]" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">{t('cash.allMethods')}</option>{Object.keys(PAYMENT_METHOD_LABEL).map((k) => <option key={k} value={k}>{t(`payment.${k}` as MessageKey)}</option>)}</Select>
            {fiscal && <Select aria-label={t('cash.fiscal.title')} className="w-full sm:w-auto sm:min-w-[13rem]" value={fiscalFilter} onChange={(e) => setFiscalFilter(e.target.value)}><option value="">{t('cash.fiscal.filterAll')}</option><option value="missing">{t('cash.fiscal.filterMissing')}{pays.data ? ` (${pays.data.meta.fiscal_missing ?? 0})` : ''}</option></Select>}
          </Toolbar>
          {pays.isLoading ? <LoadingRows /> : pays.isError ? <ErrorState error={pays.error} onRetry={() => pays.refetch()} /> : !pays.data.data.length ? <EmptyState compact title={t('cash.noPaymentsPeriod')} /> : (() => {
            // phone: receipt (with the time under it), patient (with invoice and method under it) and the amount — the amount is never off-screen
            const gap = [{ className: 'hidden sm:table-cell' }, {}, { className: 'hidden md:table-cell' }, { className: 'hidden md:table-cell' }]; // columns between the first and «Summa»
            return <>
              <Table>
                <thead><tr><Th className="hidden sm:table-cell">{t('cash.colReceipt')}</Th><Th className="hidden sm:table-cell">{t('cash.colTime')}</Th><Th>{t('cash.colPatient')}</Th><Th className="hidden md:table-cell">{t('cash.colInvoice')}</Th><Th className="hidden md:table-cell">{t('cash.colMethod')}</Th><Th right>{t('cash.colSum')}</Th></tr></thead>
                <tbody>{pays.data.data.map((p: any) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td className="hidden tabular-nums sm:table-cell"><Link href={`/print/payment/${p.id}`} target="_blank" className="text-brand-700 hover:underline">{p.receipt_number}</Link></Td>
                    <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{fmtDateTime(p.paid_at)}</Td>
                    <Td className="min-w-[9rem]"><div className="font-medium text-slate-900">{fullName(p)}</div><div className="text-[0.8125rem] text-slate-600">{pid(p.patient_number)}</div><div className="text-[0.8125rem] tabular-nums text-slate-600 sm:hidden"><Link href={`/print/payment/${p.id}`} target="_blank" className="text-brand-700 hover:underline">{p.receipt_number}</Link> · {fmtDateTime(p.paid_at)}</div><div className="text-[0.8125rem] text-slate-600 md:hidden">№{p.invoice_number} · {t(`payment.${p.method}` as MessageKey)}</div></Td>
                    <Td className="hidden md:table-cell"><Link href={`/cashier/${p.invoice_id}`} className="whitespace-nowrap text-brand-700 hover:underline">№{p.invoice_number}</Link>{showBranch && <div className="whitespace-nowrap text-[0.8125rem] text-slate-600">{p.branch_name}</div>}</Td>
                    <Td className="hidden md:table-cell"><div className="whitespace-nowrap">{t(`payment.${p.method}` as MessageKey)}</div>{!cashier && <div className="whitespace-nowrap text-[0.8125rem] text-slate-600">{p.cashier_name}</div>}{fiscal && <div className="mt-1"><FiscalBadge f={p.fiscal} /></div>}</Td>
                    <Td right className="font-medium">{formatSom(p.amount)}</Td>
                  </tr>
                ))}</tbody>
                <tfoot>
                  {!cashier && pays.data.meta.by_method.length > 1 && pays.data.meta.by_method.map((m: any) => (
                    <tr key={m.method} className="bg-slate-50 text-slate-700">
                      <td className="hidden border-b border-slate-100 sm:table-cell" />
                      <td className="hidden border-b border-slate-100 sm:table-cell" />
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2">{t(`payment.${m.method}` as MessageKey)} <span className="text-slate-600">({t('cash.nPayments', { n: m.n })})</span></td>
                      {gap.slice(2).map((g, i) => <td key={i} className={cx('border-b border-slate-100', g.className)} />)}
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-right tabular-nums">{formatSom(Number(m.sum))}</td>
                    </tr>
                  ))}
                  <FootRow cells={[{ className: 'hidden sm:table-cell' }, { className: 'hidden sm:table-cell' }, { left: true, value: t('cash.footPayments', { n: pays.data.meta.total }) }, ...gap.slice(2), { value: formatSom(pays.data.meta.sum) }]} />
                </tfoot>
              </Table>
              <Pagination page={page} pageSize={20} total={pays.data.meta.total} onPage={setPage} />
            </>;
          })()}
        </>}

        {tab === 'debts' && <>
          <Toolbar>
            <div className="relative w-full sm:w-[22rem]"><Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" /><Input className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('cash.searchPlaceholder')} aria-label={t('cash.search')} /></div>
          </Toolbar>
          {debts.isLoading ? <LoadingRows /> : debts.isError ? <ErrorState error={debts.error} onRetry={() => debts.refetch()} /> : !debts.data.data.length ? <EmptyState compact title={t('cash.noDebts')} /> : <>
            <Table>
              <thead><tr><Th>{t('cash.colPatient')}</Th><Th className="hidden sm:table-cell">{t('cash.colInvoice')}</Th><Th right className="hidden sm:table-cell">{t('cash.colTotal')}</Th><Th right className="hidden sm:table-cell">{t('cash.colPaid')}</Th><Th right>{t('cash.colDue')}</Th><Th className="hidden md:table-cell">{t('cash.status')}</Th></tr></thead>
              <tbody>{debts.data.data.map((i: any) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <Td className="min-w-[8rem]"><div className="font-medium text-slate-900">{fullName(i)}</div><div className="text-[0.8125rem] text-slate-600">{pid(i.patient_number)}</div><div className="text-[0.8125rem] tabular-nums text-slate-600 sm:hidden"><Link href={`/cashier/${i.id}`} className="text-brand-700 hover:underline">№{i.invoice_number}</Link> · {fmtDate(i.created_at)}</div></Td>
                  <Td className="hidden sm:table-cell"><Link href={`/cashier/${i.id}`} className="whitespace-nowrap text-brand-700 hover:underline">№{i.invoice_number}</Link><div className="whitespace-nowrap text-[0.8125rem] tabular-nums text-slate-600">{fmtDate(i.created_at)}{showBranch && `, ${i.branch_name}`}</div></Td>
                  <Td right className="hidden sm:table-cell">{formatSom(i.total)}</Td><Td right className="hidden sm:table-cell">{formatSom(i.paid_amount)}</Td><Td right className="font-semibold text-red-700">{formatSom(i.due)}</Td><Td className="hidden md:table-cell"><InvoiceStatus status={i.status} /></Td>
                </tr>
              ))}</tbody>
              <tfoot><FootRow cells={[{ left: true, value: t('cash.totalInvoices', { n: debts.data.meta.total }) }, { className: 'hidden sm:table-cell' }, { className: 'hidden sm:table-cell', value: formatSom(debts.data.meta.sums.total) }, { className: 'hidden sm:table-cell', value: formatSom(debts.data.meta.sums.paid) }, { className: 'text-red-700', value: formatSom(debts.data.meta.sums.due) }, { className: 'hidden md:table-cell' }]} /></tfoot>
            </Table>
            <Pagination page={page} pageSize={20} total={debts.data.meta.total} onPage={setPage} />
          </>}
        </>}

        {tab === 'refunds' && <><Toolbar>{period}</Toolbar><RefundsTab from={from} to={to} branchId={branchId} showBranch={showBranch} /></>}
        {tab === 'expenses' && <><Toolbar>{period}</Toolbar><ExpensesTab from={from} to={to} branchId={branchId} showBranch={showBranch} /></>}
        {tab === 'shifts' && <><Toolbar>{period}</Toolbar><ShiftsTab from={from} to={to} branchId={branchId} /></>}
      </Card>
      {adding && <ExpenseModal onClose={() => setAdding(false)} />}
    </>
  );
}
