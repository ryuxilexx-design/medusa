'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { PAYMENT_METHOD_LABEL, type MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, fmtDate, fmtDateTime, formatSom, fullName, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingRows, PageHeader, Pagination, Select, Table, Tabs, Td, Th } from '@/components/ui';
import { InvoiceStatus } from '@/components/status';
import { expenseCategoryLabel } from '@/components/cash-shift';
import { ExpenseActions, ExpenseModal, ExpenseRowActions, expenseStatusCell, FinanceSummary, RefundsTab, ShiftsTab } from '@/components/finance-extra';

type Tab = 'payments' | 'refunds' | 'debts' | 'expenses' | 'shifts';
export default function FinancePage() { return <Suspense><Finance /></Suspense>; }

function Finance() {
  const t = useT();
  const { me, branchId } = useSession();
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>((sp.get('tab') as any) ?? 'payments');
  const [adding, setAdding] = useState(false);
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
  const cashier = me.role === 'cashier';
  // the cashier's page is already titled «Mening to‘lovlarim», so the tabs just say what they hold
  const tabs: { value: Tab; label: string }[] = [{ value: 'payments', label: cashier ? t('cash.payments') : t('cash.paymentRegister') }];
  if (me.role === 'manager') tabs.push({ value: 'refunds', label: t('cash.refunds') }, { value: 'debts', label: t('cash.debtInvoices') }, { value: 'expenses', label: t('cash.expenses') });
  tabs.push({ value: 'shifts', label: cashier ? t('cash.shiftsTab') : t('cash.cashShifts') });
  const setRange = (d: number) => { setFrom(addDays(me.today, -d)); setTo(me.today); };
  const rangeActive = (d: number) => to === me.today && from === addDays(me.today, -d);

  return (
    <>
      <PageHeader title={cashier ? t('cash.myPayments') : t('cash.finance')} subtitle={cashier ? t('cash.financeSubtitleCashier') : t('cash.financeSubtitle')} />
      <Card padded={false}>
        {me.role === 'manager' && <FinanceSummary from={from} to={to} branchId={branchId} />}
        <div className="px-3 pt-1"><Tabs value={tab} onChange={setTab} items={tabs} /></div>
        {/* the period also drives the summary above, so it stays visible on every tab */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Input type="date" aria-label={t('cash.from')} className="min-w-0 flex-1 tabular-nums sm:w-auto sm:min-w-[10.5rem] sm:flex-none" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            <span className="text-slate-500" aria-hidden="true">–</span>
            <Input type="date" aria-label={t('cash.to')} className="min-w-0 flex-1 tabular-nums sm:w-auto sm:min-w-[10.5rem] sm:flex-none" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1.5">{([['cash.today', 0], ['cash.days7', 6], ['cash.days30', 29]] as const).map(([l, d]) => <Button key={l} type="button" size="sm" variant={rangeActive(d) ? 'primary' : 'secondary'} aria-pressed={rangeActive(d)} onClick={() => setRange(d)}>{t(l)}</Button>)}</div>
          {tab === 'payments' && <Select aria-label={t('cash.colMethod')} className="w-auto" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">{t('cash.allMethods')}</option>{Object.keys(PAYMENT_METHOD_LABEL).map((k) => <option key={k} value={k}>{t(`payment.${k}` as MessageKey)}</option>)}</Select>}
          {tab === 'payments' && <a href={`/api/v1/payments/export.csv${qs(filters)}`} download className="ml-auto inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"><Download className="h-4 w-4" />{t('cash.csvExport', { format: 'CSV' })}</a>}
        </div>
        {tab === 'payments' && (pays.isLoading ? <LoadingRows /> : pays.isError ? <ErrorState error={pays.error} onRetry={() => pays.refetch()} /> : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm">
              <span>{t('cash.totalIncome')} <b className="tabular-nums">{formatSom(pays.data.meta.sum)}</b> {t('cash.countPayments', { n: pays.data.meta.total })}</span>
              {pays.data.meta.by_method.map((m: any) => <span key={m.method} className="text-slate-600">{t(`payment.${m.method}` as MessageKey)}: <b className="tabular-nums text-slate-800">{formatSom(Number(m.sum))}</b> ({m.n})</span>)}
            </div>
            {!pays.data.data.length ? <EmptyState title={t('cash.noPaymentsPeriod')} /> : (
              <>
                <Table>
                  <thead><tr><Th>{t('cash.colReceipt')}</Th><Th>{t('cash.colTime')}</Th><Th>{t('cash.colPatient')}</Th><Th>{t('cash.colInvoice')}</Th><Th>{t('cash.branch')}</Th><Th>{t('cash.colMethod')}</Th>{!cashier && <Th>{t('role.cashier')}</Th>}<Th right>{t('cash.colSum')}</Th></tr></thead>
                  <tbody>{pays.data.data.map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <Td className="tabular-nums"><Link href={`/print/payment/${p.id}`} target="_blank" className="text-brand-700 hover:underline">{p.receipt_number}</Link></Td>
                      <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(p.paid_at)}</Td><Td>{fullName(p)} <span className="text-slate-600">{pid(p.patient_number)}</span></Td>
                      <Td><Link href={`/cashier/${p.invoice_id}`} className="text-brand-700 hover:underline">№{p.invoice_number}</Link></Td><Td>{p.branch_name}</Td>
                      <Td>{t(`payment.${p.method}` as MessageKey)}</Td>{!cashier && <Td>{p.cashier_name}</Td>}<Td right className="font-medium">{formatSom(p.amount)}</Td>
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
            <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm">{t('cash.currentDebt')} <b className="tabular-nums text-red-700">{formatSom(debts.data.meta.sums.due)}</b>, {t('cash.debtCount', { n: debts.data.meta.total })}</div>
            {!debts.data.data.length ? <EmptyState title={t('cash.noDebts')} /> : <>
            <Table>
              <thead><tr><Th>{t('cash.colPatient')}</Th><Th>{t('cash.colInvoice')}</Th><Th>{t('cash.colDate')}</Th><Th>{t('cash.branch')}</Th><Th right>{t('cash.colTotal')}</Th><Th right>{t('cash.colPaid')}</Th><Th right>{t('cash.colDue')}</Th><Th>{t('cash.status')}</Th></tr></thead>
              <tbody>{debts.data.data.map((i: any) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <Td>{fullName(i)} <span className="text-slate-600">{pid(i.patient_number)}</span></Td><Td><Link href={`/cashier/${i.id}`} className="text-brand-700 hover:underline">№{i.invoice_number}</Link></Td>
                  <Td className="whitespace-nowrap tabular-nums">{fmtDate(i.created_at)}</Td><Td>{i.branch_name}</Td><Td right>{formatSom(i.total)}</Td><Td right>{formatSom(i.paid_amount)}</Td><Td right className="font-semibold text-red-700">{formatSom(i.due)}</Td><Td><InvoiceStatus status={i.status} /></Td>
                </tr>
              ))}</tbody>
            </Table>
            <Pagination page={page} pageSize={20} total={debts.data.meta.total} onPage={setPage} />
            </>}
          </>
        ))}
        {tab === 'expenses' && (expenses.isLoading ? <LoadingRows /> : expenses.isError ? <ErrorState error={expenses.error} onRetry={() => expenses.refetch()} /> : (
          <>
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm"><span>{t('cash.expenseTotal')} <b className="tabular-nums">{formatSom(expenses.data.meta.total)}</b></span><ExpenseActions onAdd={() => setAdding(true)} /></div>
            {!expenses.data.data.length ? <EmptyState title={t('cash.noExpensesPeriod')} text={t('cash.noExpensesHint')} /> : (
              <Table>
                <thead><tr><Th>{t('cash.colDate')}</Th><Th>{t('cash.category')}</Th><Th>{t('cash.branch')}</Th><Th>{t('cash.note')}</Th><Th>{t('cash.colSource')}</Th><Th right>{t('cash.colSum')}</Th><Th /></tr></thead>
                <tbody>{expenses.data.data.map((e: any) => (
                  <tr key={e.id} className={e.status === 'void' ? 'text-slate-600' : undefined}>
                    <Td className="whitespace-nowrap tabular-nums">{fmtDate(e.occurred_at)}</Td><Td><Badge>{expenseCategoryLabel(t, e.category)}</Badge></Td><Td>{e.branch_name}</Td><Td>{e.note}</Td><Td>{expenseStatusCell(e, t)}</Td>
                    <Td right className={e.status === 'void' ? 'line-through' : undefined}>{formatSom(e.amount)}</Td><Td right><ExpenseRowActions e={e} /></Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
          </>
        ))}
        {tab === 'refunds' && <RefundsTab from={from} to={to} branchId={branchId} />}
        {tab === 'shifts' && <ShiftsTab from={from} to={to} branchId={branchId} />}
      </Card>
      {adding && <ExpenseModal onClose={() => setAdding(false)} />}
    </>
  );
}
