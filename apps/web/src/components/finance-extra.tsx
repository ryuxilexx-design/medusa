'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Banknote, DoorOpen, Download, HandCoins, PiggyBank, Printer, Scale, Undo2, Wallet } from 'lucide-react';
import { EXPENSE_CATEGORIES, EXPENSE_PAID_FROM_LABEL, type MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { addDays, fmtDate, fmtDateTime, formatSom, fullName, parseSomToTiyin, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, cx, EmptyState, ErrorState, Field, Input, LinkButton, LoadingRows, Modal, ModalCancel, Pagination, Select, SlidingPill, StatCard, Table, Td, Th, useToast } from '@/components/ui';
import { DateRange } from '@/components/date-range';
import { CloseShiftModal, expenseCategoryLabel, StatMoney, type Shift } from '@/components/cash-shift';
import { MoneyInput } from '@/components/money-input';

type T = ReturnType<typeof useT>;

/** 2–4 key numbers in one row (one column on a phone, two on a tablet). */
export function StatRow({ children, label, cols = 4 }: { children: React.ReactNode; label?: string; cols?: 2 | 4 }) {
  return <div className={cx('mb-5 grid grid-cols-2 gap-3 sm:gap-4', cols === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-2')} role={label ? 'group' : undefined} aria-label={label}>{children}</div>;
}

/** A plain download link (the browser saves the file), dressed as the other glass capsules. */
export function CsvLink({ href, label }: { href: string; label?: string }) {
  const t = useT();
  const title = label ?? t('cash.csvExport', { format: 'CSV' });
  return <a href={href} download aria-label={title} title={title} className="glass-btn inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full border-2 border-transparent px-5 text-[0.9375rem] font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"><Download className="h-4 w-4" />CSV</a>;
}

/** Period: two date fields + «Bugun / 7 kun / 30 kun» in one segmented control, all 44 px high. */
export function PeriodPicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const t = useT();
  const { me } = useSession();
  const presets = [['cash.today', 0], ['cash.days7', 6], ['cash.days30', 29]] as const;
  const presetGroup = useRef<HTMLDivElement>(null);
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <DateRange from={from} to={to} onFrom={(v) => onChange(v, to)} onTo={(v) => onChange(from, v)} />
      {/* the same capsule as the Tabs: inside a white card the segmented control is a soft pill, the chosen day white */}
      <div ref={presetGroup} className="relative grid h-11 w-full grid-cols-3 gap-0.5 rounded-full bg-slate-100 p-1 sm:inline-grid sm:w-auto" role="group" aria-label={t('cash.period')}>
        <SlidingPill container={presetGroup} active={`${from}-${to}`} className="rounded-full bg-white shadow-[0_2px_8px_rgba(15,23,42,0.12)]" />
        {presets.map(([label, d]) => {
          const on = to === me.today && from === addDays(me.today, -d);
          return (
            <button key={label} type="button" aria-pressed={on} data-active={on} onClick={() => onChange(addDays(me.today, -d), me.today)}
              className={cx('relative z-[1] whitespace-nowrap rounded-full px-3.5 text-[0.9375rem] font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300', on ? 'text-brand-800' : 'text-slate-700 hover:text-slate-900')}>
              {t(label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A «Jami» row under a table: the label cell spans the text columns, sums sit under their amount columns. */
export function FootRow({ cells }: { cells: { span?: number; value?: React.ReactNode; left?: boolean; className?: string }[] }) {
  return (
    <tr className="bg-slate-50 font-semibold text-slate-900">
      {cells.map((c, i) => <td key={i} colSpan={c.span} className={cx('border-b border-slate-100 px-3 py-3 whitespace-nowrap', c.left ? 'text-left' : 'text-right tabular-nums', c.className)}>{c.value}</td>)}
    </tr>
  );
}

type Summary = { payments: { total: number; count: number }; refunds: { total: number; count: number }; net_revenue: number; expenses: { total: number }; net_result: number; deposits: { in: number; out: number; applied: number; balance: number } };

/** Manager: cash-basis result for the period. Net revenue = payments − refunds; net result = net revenue − expenses. */
export function FinanceStats({ from, to, branchId }: { from: string; to: string; branchId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ['finance-summary', from, to, branchId], queryFn: () => api<{ data: Summary }>(`/finance/summary${qs({ from, to, branch_id: branchId })}`).then((r) => r.data) });
  const s = q.data;
  const loading = !s;
  return (
    <StatRow label={t('cash.financeResult')}>
      <StatCard icon={<Banknote />} label={t('cash.netRevenue')} loading={loading} value={s && <StatMoney tiyin={s.net_revenue} />} sub={s && t('cash.nPayments', { n: s.payments.count })} />
      <StatCard icon={<Undo2 />} label={t('cash.refunds')} loading={loading} tone={s?.refunds.total ? 'danger' : 'default'} value={s && <StatMoney tiyin={s.refunds.total} minus />} sub={t('cash.refundsSub')} />
      <StatCard icon={<Wallet />} label={t('cash.expenses')} loading={loading} value={s && <StatMoney tiyin={s.expenses.total} minus />} sub={t('cash.expensesSub')} />
      <StatCard icon={<Scale />} label={t('cash.netResult')} loading={loading} tone={s && s.net_result < 0 ? 'danger' : 'success'} value={s && <StatMoney tiyin={s.net_result} />} sub={t('cash.netResultSub')} />
    </StatRow>
  );
}

/** Manager: who owes (by age of the debt) and what the clinic holds for patients (deposits are a liability, not revenue). */
export function DebtorsDepositsRow({ from, to, branchId, onDebtors }: { from: string; to: string; branchId: string; onDebtors: () => void }) {
  const t = useT();
  const sum = useQuery({ queryKey: ['finance-summary', from, to, branchId], queryFn: () => api<{ data: Summary }>(`/finance/summary${qs({ from, to, branch_id: branchId })}`).then((r) => r.data) });
  const debt = useQuery({ queryKey: ['invoices', 'debts', 'ageing', branchId], queryFn: () => api(`/invoices${qs({ debt: 1, branch_id: branchId, page_size: 1 })}`).then((r) => r.meta) });
  const a = debt.data?.ageing;
  const d = sum.data?.deposits;
  return (
    <StatRow cols={2} label={t('cash.debtors')}>
      <button type="button" onClick={onDebtors} className="text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 rounded-[22px]">
        <StatCard icon={<HandCoins />} label={t('cash.debtors')} loading={!debt.data} tone={debt.data?.sums.due ? 'danger' : 'default'} value={debt.data && <StatMoney tiyin={debt.data.sums.due} />}
          sub={a && t('cash.debtorsSub', { a: formatSom(a['0-7'].sum, false), b: formatSom(a['8-30'].sum, false), c: formatSom(a['31+'].sum, false) })} />
      </button>
      <StatCard icon={<PiggyBank />} label={t('cash.depositsCard')} loading={!d} value={d && <StatMoney tiyin={d.balance} />} sub={d && t('cash.depositsSub', { inflow: formatSom(d.in, false), applied: formatSom(d.applied, false) })} />
    </StatRow>
  );
}

export function RefundsTab({ from, to, branchId, showBranch, page, onPage }: { from: string; to: string; branchId: string; showBranch: boolean; page: number; onPage: (p: number) => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ['refunds', from, to, branchId, page], queryFn: () => api(`/refunds${qs({ from, to, branch_id: branchId, page, page_size: 20 })}`), placeholderData: (p) => p });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.data.length) return <EmptyState compact title={t('cash.noRefundsPeriod')} />;
  return (<>
    <Table>
      <thead><tr><Th>{t('cash.colTime')}</Th><Th>{t('cash.colPatient')}</Th><Th>{t('cash.colInvoice')}</Th><Th>{t('cash.colMethodDrawer')}</Th><Th>{t('cash.colReason')}</Th><Th>{t('cash.colApprovedBy')}</Th><Th right>{t('cash.colSum')}</Th></tr></thead>
      <tbody>{q.data.data.map((r: any) => (
        <tr key={r.id} className="hover:bg-slate-50">
          <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(r.refunded_at)}<div className="text-[0.8125rem] text-slate-600">№{r.refund_number}</div></Td>
          <Td><div className="whitespace-nowrap font-medium text-slate-900">{fullName(r)}</div><div className="text-[0.8125rem] text-slate-600">{pid(r.patient_number)}</div></Td>
          <Td><Link href={`/cashier/${r.invoice_id}`} className="whitespace-nowrap text-brand-700 hover:underline">№{r.invoice_number}</Link><div className="text-[0.8125rem] text-slate-600">{r.service_name ?? t('cash.wholeInvoice')}{showBranch && ` · ${r.branch_name}`}</div></Td>
          <Td>{t(`payment.${r.method}` as MessageKey)}{r.shift_number ? <div className="whitespace-nowrap text-[0.8125rem] text-slate-600">{t('cash.shiftRef', { n: r.shift_number, cashier: r.shift_cashier })}</div> : null}</Td>
          <Td className="min-w-[12rem]">{t(`cash.refundReason.${r.reason_code}` as MessageKey)}<div className="text-[0.8125rem] text-slate-600">{r.reason}</div></Td>
          <Td className="whitespace-nowrap">{r.approved_by_name}</Td>
          <Td right className="font-medium text-red-700">−{formatSom(r.amount)}</Td>
        </tr>
      ))}</tbody>
      <tfoot><FootRow cells={[{ left: true, span: 6, value: t('cash.footRefunds', { n: q.data.meta.count }) }, { className: 'text-red-700', value: `−${formatSom(q.data.meta.total)}` }]} /></tfoot>
    </Table>
    <Pagination page={page} pageSize={20} total={q.data.meta.count} onPage={onPage} />
  </>);
}

export function ShiftsTab({ from, to, branchId }: { from: string; to: string; branchId: string }) {
  const t = useT();
  const { me } = useSession();
  const [closing, setClosing] = useState<Shift | null>(null);
  const q = useQuery({ queryKey: ['cash-shifts', 'list', from, to, branchId], queryFn: () => api<{ data: Shift[] }>(`/cash-shifts${qs({ from, to, branch_id: branchId })}`).then((r) => r.data) });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.length) return <EmptyState compact title={t('cash.noShiftsPeriod')} />;
  return (
    <>
      <Table>
        {/* phone: cashier, expected cash, difference and the actions; the other sums come back on wider screens */}
        <thead><tr><Th className="hidden sm:table-cell">№</Th><Th>{t('cash.colCashierBranch')}</Th><Th className="hidden md:table-cell">{t('cash.colOpenedClosed')}</Th><Th right className="hidden lg:table-cell">{t('cash.colCashIncome')}</Th><Th right>{t('cash.colExpected')}</Th><Th right className="hidden 2xl:table-cell">{t('cash.colCounted')}</Th><Th right className="hidden sm:table-cell">{t('cash.colDiff')}</Th><Th className="right-0 z-10" /></tr></thead>
        <tbody>{q.data!.map((s) => (
          <tr key={s.id} className="group hover:bg-slate-50">
            <Td className="hidden tabular-nums sm:table-cell">{s.number}</Td>
            <Td className="min-w-[8rem]"><div className="font-medium text-slate-900">{s.cashier_name}</div><div className="text-[0.8125rem] text-slate-600">{s.branch_name}</div>
              <div className="mt-1 text-[0.8125rem] tabular-nums text-slate-600 md:hidden">{fmtDateTime(s.opened_at)}{s.status === 'open' ? <> · <span className="font-semibold text-emerald-800">{t('cash.shiftOpenBadge')}</span></> : null}</div></Td>
            <Td className="hidden whitespace-nowrap tabular-nums md:table-cell"><div>{fmtDateTime(s.opened_at)}</div><div className="text-[0.8125rem] text-slate-600">{s.status === 'open' ? <Badge tone="green" icon={<DoorOpen className="h-3.5 w-3.5" />}>{t('cash.shiftOpenBadge')}</Badge> : fmtDateTime((s as any).closed_at)}</div></Td>
            <Td right className="hidden lg:table-cell">{formatSom(s.totals.payments.cash.sum)}</Td><Td right>{formatSom(s.expected_cash)}</Td>
            <Td right className="hidden 2xl:table-cell">{s.counted_cash == null ? '—' : formatSom(s.counted_cash)}</Td>
            <Td right className={cx('hidden font-medium sm:table-cell', s.difference ? (s.difference > 0 ? 'text-amber-700' : 'text-red-700') : 'text-slate-600')}>{s.difference == null ? '—' : `${s.difference > 0 ? '+' : ''}${formatSom(s.difference)}`}</Td>
            <Td right className="!pl-1 sm:sticky sm:right-0 sm:bg-white sm:group-hover:bg-slate-50">
              <div className="relative flex flex-wrap items-center justify-end gap-1">
                <LinkButton size="sm" variant="ghost" href={`/print/shift/${s.id}`} target="_blank" icon={<Printer className="h-4 w-4" />}><span className="sr-only md:not-sr-only">{t('cash.report')}</span></LinkButton>
                {me.role === 'manager' && s.status === 'open' && <Button size="sm" onClick={() => setClosing(s)}>{t('cash.closeShift')}</Button>}
              </div>
            </Td>
          </tr>
        ))}</tbody>
      </Table>
      {closing && <CloseShiftModal shift={closing} onClose={() => setClosing(null)} />}
    </>
  );
}

export function ExpensesTab({ from, to, branchId, showBranch, page, onPage }: { from: string; to: string; branchId: string; showBranch: boolean; page: number; onPage: (p: number) => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ['expenses', from, to, branchId, page], queryFn: () => api(`/expenses${qs({ from, to, branch_id: branchId, page, page_size: 20 })}`), placeholderData: (p) => p });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.data.length) return <EmptyState compact title={t('cash.noExpensesPeriod')} />;
  return (<>
    <Table>
      <thead><tr><Th className="hidden sm:table-cell">{t('cash.colDate')}</Th><Th>{t('cash.category')}</Th><Th className="hidden md:table-cell">{t('cash.note')}</Th><Th className="hidden lg:table-cell">{t('cash.colSource')}</Th><Th right>{t('cash.colSum')}</Th><Th className="right-0 z-10" /></tr></thead>
      <tbody>{q.data.data.map((e: any) => (
        <tr key={e.id} className={cx('group hover:bg-slate-50', e.status === 'void' && 'text-slate-600')}>
          <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{fmtDate(e.occurred_at)}</Td><Td><Badge>{expenseCategoryLabel(t, e.category)}</Badge><div className="mt-1 text-[0.8125rem] text-slate-600"><span className="tabular-nums sm:hidden">{fmtDate(e.occurred_at)}{showBranch && ' · '}</span>{showBranch && e.branch_name}</div>{e.note && <div className="mt-1 text-[0.8125rem] text-slate-700 md:hidden">{e.note}</div>}</Td>
          <Td className="hidden min-w-[10rem] md:table-cell">{e.note}</Td><Td className="hidden min-w-[9rem] lg:table-cell">{expenseStatusCell(e, t)}</Td>
          <Td right className={e.status === 'void' ? 'line-through' : 'font-medium'}>{formatSom(e.amount)}</Td>
          <Td right className="sm:sticky sm:right-0 sm:bg-white sm:group-hover:bg-slate-50"><ExpenseRowActions e={e} /></Td>
        </tr>
      ))}</tbody>
      <tfoot><FootRow cells={[{ className: 'hidden sm:table-cell' }, { left: true, value: t('cash.footExpenses') }, { className: 'hidden md:table-cell' }, { className: 'hidden lg:table-cell' }, { value: formatSom(q.data.meta.total) }, {}]} /></tfoot>
    </Table>
    <Pagination page={page} pageSize={20} total={q.data.meta.count} onPage={onPage} />
  </>);
}

export function ExpenseRowActions({ e }: { e: any }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/expenses/${e.id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => { ['expenses', 'finance-summary', 'cash-shifts', 'cash-shift'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('cash.expenseVoided')); setOpen(false); },
    onError: (err) => toast.error(err),
  });
  if (e.status !== 'active') return null;
  // a closed shift's cash expense cannot change: say so in the row instead of a tooltip on a disabled button
  if (e.shift_status === 'closed') return <span className="whitespace-nowrap text-[0.8125rem] text-slate-600">{t('cash.expenseLockedShort')}</span>;
  return (
    <>
      <Button size="sm" variant="ghost" className="!text-slate-700 hover:!bg-red-50 hover:!text-red-700" icon={<Ban className="h-4 w-4" />} title={t('cash.cancelExpense')} aria-label={t('cash.cancelExpense')} onClick={() => setOpen(true)}><span className="hidden 2xl:inline">{t('cash.cancelExpense')}</span></Button>
      <Modal open={open} onClose={() => setOpen(false)} dirty={!!reason.trim()} title={t('cash.cancelExpenseTitle', { category: expenseCategoryLabel(t, e.category), amount: formatSom(e.amount) })}
        footer={<><ModalCancel>{t('common.back')}</ModalCancel><Button variant="danger" loading={m.isPending} disabled={reason.trim().length < 3} onClick={() => m.mutate()}>{t('cash.cancelExpenseConfirm')}</Button></>}>
        <Field label={t('cash.colReason')} required>{(id) => <Input id={id} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder={t('cash.cancelExpensePlaceholder')} />}</Field>
        {reason.trim().length < 3 && <p className="mt-2 text-sm text-slate-600">{t('cash.fillRequired')}</p>}
      </Modal>
    </>
  );
}

/** Manager: any expense (bank, card, other) or cash taken from an open drawer. */
export function ExpenseModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { me, branchId } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [branch, setBranch] = useState(branchId || me.branches[0]?.id || '');
  const [category, setCategory] = useState<string>('Ijara');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(me.today);
  const [paidFrom, setPaidFrom] = useState('bank');
  const [shiftId, setShiftId] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const shifts = useQuery({ queryKey: ['cash-shifts', 'open', branch], queryFn: () => api<{ data: Shift[] }>(`/cash-shifts?status=open&branch_id=${branch}`).then((r) => r.data), enabled: paidFrom === 'cash_drawer' && !!branch });
  const chosenShift = shiftId || (shifts.data?.length === 1 ? shifts.data[0].id : '');
  const drawer = shifts.data?.find((s) => s.id === chosenShift);
  const tiyin = amount.trim() ? parseSomToTiyin(amount) : null;
  const m = useMutation({
    mutationFn: () => api('/expenses', { method: 'POST', body: { branch_id: branch, category, amount: tiyin, occurred_on: paidFrom === 'cash_drawer' ? undefined : date, paid_from: paidFrom, shift_id: paidFrom === 'cash_drawer' ? chosenShift || undefined : undefined, note: note.trim() || null } }),
    onSuccess: () => { ['expenses', 'finance-summary', 'cash-shifts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('cash.expenseAdded')); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); else setErr((e as Error).message); },
  });
  const ready = !!branch && !!tiyin && (paidFrom !== 'cash_drawer' || !!chosenShift);
  return (
    <Modal open onClose={onClose} dirty={!!(amount || note)} title={t('cash.addExpense')} footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={!ready} onClick={() => { setErr(null); setErrors({}); m.mutate(); }}>{t('cash.add')}</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="red">{err}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {me.branches.length > 1 && <Field label={t('cash.branch')} required error={errors.branch_id}>{(id) => <Select id={id} value={branch} onChange={(e) => setBranch(e.target.value)}>{me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>}
          <Field label={t('cash.category')} required>{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{expenseCategoryLabel(t, c)}</option>)}</Select>}</Field>
          <Field label={t('cash.amountSomComma')} required error={errors.amount ?? (amount && tiyin == null ? t('cash.enterNumber') : undefined)}>{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!errors.amount} />}</Field>
          <Field label={t('cash.paidFromField')} required>{(id) => <Select id={id} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>{Object.keys(EXPENSE_PAID_FROM_LABEL).map((k) => <option key={k} value={k}>{t(`cash.paidFrom.${k}` as MessageKey)}</option>)}</Select>}</Field>
          {paidFrom === 'cash_drawer'
            ? <Field className="sm:col-span-2" label={t('cash.fromDrawer')} required error={errors.shift_id} hint={drawer ? t('cash.drawerHint', { amount: formatSom(drawer.expected_cash) }) : undefined}>{(id) => shifts.data?.length === 0
                ? <p id={id} className="text-sm text-amber-800">{t('cash.noOpenDrawerDot')}</p>
                : <Select id={id} value={chosenShift} onChange={(e) => setShiftId(e.target.value)}>{(shifts.data?.length ?? 0) > 1 && <option value="">{t('cash.choose')}</option>}{(shifts.data ?? []).map((s) => <option key={s.id} value={s.id}>{t('cash.shiftOptionShort', { n: s.number, cashier: s.cashier_name })}</option>)}</Select>}</Field>
            : <Field label={t('cash.colDate')} required error={errors.occurred_on}>{(id) => <Input id={id} type="date" max={me.today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>}
        </div>
        <Field label={t('cash.note')}>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('cash.expenseNotePlaceholder')} />}</Field>
        {!ready && <p className="text-sm text-slate-600">{t('cash.fillRequired')}</p>}
      </div>
    </Modal>
  );
}

export const expenseStatusCell = (e: any, t: T) => e.status === 'void'
  ? <div><Badge icon={<Ban className="h-3.5 w-3.5" />}>{t('cash.expenseCancelled')}</Badge>{e.void_reason && <div className="mt-1 text-[0.8125rem] text-slate-600">{e.void_reason}</div>}</div>
  : <span className="text-[0.8125rem] text-slate-600">{[
      EXPENSE_PAID_FROM_LABEL[e.paid_from] ? t(`cash.paidFrom.${e.paid_from}` as MessageKey) : '',
      e.shift_number ? t('cash.shiftNo', { n: e.shift_number }) : '',
      e.created_by_name ?? '',
    ].filter(Boolean).join(', ')}</span>;
