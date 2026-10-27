'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Banknote, CreditCard, DoorClosed, DoorOpen, Printer, ReceiptText, RefreshCw, Wallet } from 'lucide-react';
import { EXPENSE_CATEGORIES, type MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtTime, formatSom, parseSomToTiyin } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Button, cx, Field, Input, LinkButton, Modal, ModalCancel, Money, Select, StatCard, Textarea, useToast } from '@/components/ui';
import { MoneyInput } from '@/components/money-input';

export type Shift = {
  id: string; number: number; status: 'open' | 'closed'; branch_id: string; branch_name: string; cashier_name: string; opened_at: string; opening_cash: number;
  expected_cash: number; counted_cash: number | null; difference: number | null;
  /** Opened before today (left open overnight): the server takes no payment until it is closed. Only on /cash-shifts/current. */
  stale?: boolean;
  totals: { payments: Record<'cash' | 'card' | 'transfer', { n: number; sum: number }>; refunds: Record<'cash' | 'card' | 'transfer', { n: number; sum: number }>; cash_expenses: { n: number; sum: number }; cash_in: number; cash_out: number;
    /** patient prepayments taken in / paid back from this drawer (absent on shifts closed before deposits existed) */
    deposit_in?: Record<'cash' | 'card' | 'transfer', { n: number; sum: number }>; deposit_out?: Record<'cash' | 'card' | 'transfer', { n: number; sum: number }>;
    /** cash paid to referral partners from this drawer (absent on shifts closed before migration 041) */
    partner_payouts?: { n: number; sum: number } };
  /** Payments of the shift whose fiscal (KKM) receipt is not recorded yet. Only on /cash-shifts/:id. */
  fiscal_pending?: number;
};

/** Who may run a drawer and take money: the cashier and the manager (the server allows the same two roles). */
export const canTakeMoney = (role: string) => role === 'cashier' || role === 'manager';

/** The signed-in cashier's open shift (null when the drawer is closed). */
export function useCurrentShift(enabled = true) {
  return useQuery({ queryKey: ['cash-shift', 'current'], queryFn: () => api<{ data: Shift | null }>('/cash-shifts/current').then((r) => r.data), enabled, refetchInterval: 30_000 });
}

/**
 * The shift request failed and nothing is known (no cached answer): say so and offer «Retry». Never treat it as
 * «shift closed» — that would invite the cashier to open a second shift.
 */
export function ShiftLoadError({ q }: { q: { error: unknown; refetch: () => unknown; isFetching: boolean } }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-900" role="alert" data-testid="shift-load-error">
      <span className="min-w-[12rem] flex-1"><b className="font-semibold">{t('cash.shiftLoadFailed')}</b> {(q.error as Error)?.message}</span>
      <Button size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={q.isFetching} onClick={() => q.refetch()}>{t('common.retry')}</Button>
    </div>
  );
}

type T = ReturnType<typeof useT>;
/** Expense categories are stored as these Uzbek strings (the server checks them); only the label is translated. */
const EXPENSE_CATEGORY_KEY: Record<string, MessageKey> = {
  Ijara: 'cash.expenseCategory.rent', Maosh: 'cash.expenseCategory.salary', Kommunal: 'cash.expenseCategory.utilities',
  Reagentlar: 'cash.expenseCategory.reagents', 'Tibbiy sarf materiallari': 'cash.expenseCategory.medSupplies',
  'Xo‘jalik': 'cash.expenseCategory.household', 'Ta’mirlash': 'cash.expenseCategory.repair', 'IT xizmatlari': 'cash.expenseCategory.it',
  Marketing: 'cash.expenseCategory.marketing', 'Soliq va to‘lovlar': 'cash.expenseCategory.taxes', Boshqa: 'cash.expenseCategory.other',
};
export const expenseCategoryLabel = (t: T, c: string) => (EXPENSE_CATEGORY_KEY[c] ? t(EXPENSE_CATEGORY_KEY[c]) : c);

const invalidate = (qc: ReturnType<typeof useQueryClient>) => ['cash-shift', 'cash-shifts', 'invoices', 'payments', 'expenses', 'dashboard', 'finance-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

/**
 * Cashier: the shift drives the cash page. Returns the header line (shift status), the header actions (open, or
 * expense / report / close) and the body (four key numbers of the open drawer, or a warning while it is closed).
 */
export function useShiftUi(enabled: boolean) {
  const t = useT();
  const shift = useCurrentShift(enabled);
  const [modal, setModal] = useState<'open' | 'close' | 'expense' | null>(null);
  const s = shift.data;
  if (!enabled || shift.isLoading) return { subtitle: null, actions: null, body: null };
  if (shift.isError && s === undefined) return { subtitle: null, actions: null, body: <div className="mb-5"><ShiftLoadError q={shift} /></div> };
  const tot = s?.totals;
  return {
    // a shift from an earlier day shows its date, not just the time: the cashier must see that it is yesterday's
    subtitle: s ? <span className="inline-flex items-center gap-2"><DoorOpen className={cx('h-5 w-5 shrink-0', s.stale ? 'text-red-700' : 'text-emerald-700')} /><span><b className="font-semibold text-slate-900">{t('cash.shiftOpenTitle', { n: s.number, branch: s.branch_name })}</b>, {s.stale ? <span className="font-semibold text-red-700">{t('cash.shiftOpenedOn', { date: fmtDateTime(s.opened_at) })}</span> : t('cash.shiftSinceShort', { time: fmtTime(s.opened_at) })}</span></span> : null,
    actions: s ? <>
      {!s.stale && <Button icon={<ReceiptText className="h-4 w-4" />} onClick={() => setModal('expense')}>{t('cash.cashExpense')}</Button>}
      <LinkButton href={`/print/shift/${s.id}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('cash.report')}</LinkButton>
      <Button variant={s.stale ? 'primary' : 'secondary'} icon={<DoorClosed className="h-4 w-4" />} onClick={() => setModal('close')}>{t('cash.closeShift')}</Button>
    </> : <Button variant="primary" icon={<DoorOpen className="h-5 w-5" />} onClick={() => setModal('open')}>{t('cash.openShift')}</Button>,
    body: <>
      {s?.stale && <div className="mb-5"><Alert tone="red" title={t('cash.shiftStale', { date: fmtDate(s.opened_at) })}>{t('cash.shiftStaleHint')}</Alert></div>}
      {s && tot ? (
        <div className="mb-5 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          <StatCard icon={<Banknote />} label={t('cash.colCashIncome')} value={<StatMoney tiyin={tot.payments.cash.sum} />} sub={t('cash.nPayments', { n: tot.payments.cash.n })} />
          <StatCard icon={<CreditCard />} label={t('cash.cardTransfer')} value={<StatMoney tiyin={tot.payments.card.sum + tot.payments.transfer.sum} />} sub={t('cash.nPayments', { n: tot.payments.card.n + tot.payments.transfer.n })} />
          <StatCard icon={<ArrowUpRight />} label={t('cash.cashOut')} value={<StatMoney tiyin={tot.cash_out} minus />} sub={t('cash.cashOutSub')} />
          <StatCard icon={<Wallet />} tone="success" label={t('cash.inDrawerNow')} value={<span data-testid="expected-cash"><StatMoney tiyin={s.expected_cash} /></span>} sub={t('cash.openingSub', { amount: formatSom(s.opening_cash, false) })} />
        </div>
      ) : <div className="mb-5"><Alert tone="yellow" title={t('cash.shiftClosed')}>{t('cash.shiftClosedHint')}</Alert></div>}
      {modal === 'open' && <OpenShiftModal onClose={() => setModal(null)} />}
      {modal === 'close' && s && <CloseShiftModal shift={s} onClose={() => setModal(null)} />}
      {modal === 'expense' && s && <CashExpenseModal shift={s} onClose={() => setModal(null)} />}
    </>,
  };
}

/** A so‘m amount for a StatCard: large digits, the currency word smaller (wraps under the number when the card is narrow). */
/** Kept for callers: the shared money display. */
export const StatMoney = Money;

function OpenShiftModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { me, branchId } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [branch, setBranch] = useState(branchId || me.branches[0]?.id || '');
  const [cash, setCash] = useState('0');
  const [err, setErr] = useState<string | null>(null);
  const tiyin = parseSomToTiyin(cash);
  const m = useMutation({
    mutationFn: () => api<{ data: { number: number } }>('/cash-shifts', { method: 'POST', body: { branch_id: branch, opening_cash: tiyin } }),
    onSuccess: (r) => { invalidate(qc); toast.success(t('cash.shiftOpened', { n: r.data.number })); onClose(); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Modal open onClose={onClose} title={t('cash.openShift')} footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={tiyin == null || !branch} onClick={() => m.mutate()}>{t('cash.open')}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="red">{err}</Alert>}
        {me.branches.length > 1 && <Field label={t('cash.branch')} required>{(id) => <Select id={id} value={branch} onChange={(e) => setBranch(e.target.value)}>{me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>}
        <Field label={t('cash.openingCash')} required error={tiyin == null ? t('cash.enterAmountNumber') : undefined} hint={t('cash.openingCashHint')}>
          {(id) => <MoneyInput id={id} className="w-56" value={cash} onChange={(e) => { setCash(e.target.value); setErr(null); }} invalid={tiyin == null} />}
        </Field>
      </div>
    </Modal>
  );
}

export function CloseShiftModal({ shift: initial, onClose }: { shift: Shift; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  // live numbers: a payment may arrive while the modal is open (the server recomputes on close anyway)
  const live = useQuery({ queryKey: ['cash-shift', initial.id], queryFn: () => api<{ data: Shift }>(`/cash-shifts/${initial.id}`).then((r) => r.data), refetchInterval: 10_000 });
  const shift = live.data ?? initial;
  const toast = useToast();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const tiyin = counted.trim() ? parseSomToTiyin(counted) : null;
  const diff = tiyin == null ? null : tiyin - shift.expected_cash;
  const m = useMutation({
    mutationFn: () => api<{ data: { difference: number } }>(`/cash-shifts/${shift.id}/close`, { method: 'POST', body: { counted_cash: tiyin, note: note.trim() || null } }),
    onSuccess: (r) => { invalidate(qc); toast.success(r.data.difference ? t('cash.shiftClosedDiff', { diff: formatSom(r.data.difference) }) : t('cash.shiftClosedOk')); onClose(); window.open(`/print/shift/${shift.id}`, '_blank', 'noopener'); },
    onError: (e) => {
      // a field error the form does not show (e.g. the expected cash changed meanwhile) must still be visible
      if (e instanceof ApiError && e.fields) { setErrors(e.fields); setErr(e.fields.counted_cash || e.fields.note ? null : e.message); live.refetch(); }
      else setErr((e as Error).message);
    },
  });
  const tot = shift.totals;
  const ready = tiyin != null && (diff === 0 || !!note.trim());
  return (
    <Modal open onClose={onClose} dirty={!!counted} title={t('cash.closeShiftTitle', { n: shift.number })} footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={!ready} onClick={() => m.mutate()}>{t('cash.closeShift')}</Button></>}>
      <div className="space-y-3 text-sm">
        {err && <Alert tone="red">{err}</Alert>}
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-lg border border-slate-200 p-4">
          <dt className="text-slate-600">{t('cash.openingCashShort')}</dt><dd className="text-right tabular-nums">{formatSom(shift.opening_cash)}</dd>
          <dt className="text-slate-600">{t('cash.cashPaymentsN', { n: tot.payments.cash.n })}</dt><dd className="text-right tabular-nums">{formatSom(tot.payments.cash.sum)}</dd>
          {tot.refunds.cash.sum > 0 && <><dt className="text-slate-600">{t('cash.cashRefundsN', { n: tot.refunds.cash.n })}</dt><dd className="text-right tabular-nums">{formatSom(tot.refunds.cash.sum)}</dd></>}
          {tot.cash_expenses.sum > 0 && <><dt className="text-slate-600">{t('cash.cashExpensesN', { n: tot.cash_expenses.n })}</dt><dd className="text-right tabular-nums">{formatSom(tot.cash_expenses.sum)}</dd></>}
          {(tot.partner_payouts?.sum ?? 0) > 0 && <><dt className="text-slate-600">{t('ref.shiftPayoutsN', { n: tot.partner_payouts!.n })}</dt><dd className="text-right tabular-nums">{formatSom(tot.partner_payouts!.sum)}</dd></>}
          <div aria-hidden="true" className="col-span-2 my-0.5 border-t border-slate-200" />
          <dt className="font-semibold">{t('cash.expectedCashShort')}</dt><dd className="text-right font-semibold tabular-nums">{formatSom(shift.expected_cash)}</dd>
        </dl>
        <p className="text-small text-slate-600">{t('cash.nonCashLine', { card: formatSom(tot.payments.card.sum), transfer: formatSom(tot.payments.transfer.sum) })}</p>
        {!!shift.fiscal_pending && <Alert tone="yellow" title={t('cash.fiscal.shiftPending', { n: shift.fiscal_pending })}>{t('cash.fiscal.shiftPendingHint')}</Alert>}
        <Field label={t('cash.countedCash')} required error={errors.counted_cash ?? (counted && tiyin == null ? t('cash.enterAmountNumber') : undefined)}>
          {(id) => <MoneyInput id={id} className="w-56" value={counted} onChange={(e) => { setCounted(e.target.value); setErrors({}); }} invalid={!!errors.counted_cash} autoFocus />}
        </Field>
        {diff != null && <Alert tone={diff === 0 ? 'green' : diff < 0 ? 'red' : 'yellow'} title={diff === 0 ? t('cash.cashMatches') : t('cash.diff', { diff: `${diff > 0 ? '+' : ''}${formatSom(diff)}` })}>{diff === 0 ? t('cash.diffZero') : diff > 0 ? t('cash.diffOver') : t('cash.diffShort')}</Alert>}
        {diff != null && (diff !== 0 || errors.note) && (
          <Field label={t('cash.diffReason')} required error={errors.note}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('cash.diffReasonPlaceholder')} />}</Field>
        )}
        <p className="text-small text-slate-600">{t('cash.closedShiftFooter')}</p>
        {!ready && counted.trim() !== '' && <p className="text-sm text-slate-600">{t('cash.fillRequired')}</p>}
      </div>
    </Modal>
  );
}

function CashExpenseModal({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [category, setCategory] = useState<string>('Xo‘jalik');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const tiyin = amount.trim() ? parseSomToTiyin(amount) : null;
  const m = useMutation({
    mutationFn: () => api('/expenses', { method: 'POST', body: { category, amount: tiyin, note: note.trim() || null, paid_from: 'cash_drawer' } }),
    onSuccess: () => { invalidate(qc); toast.success(t('cash.expenseSaved')); onClose(); },
    onError: (e) => setErr((e as Error).message),
  });
  const ready = !!tiyin && !!note.trim();
  return (
    <Modal open onClose={onClose} dirty={!!(amount || note)} title={t('cash.cashExpense')} footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} disabled={!ready} onClick={() => m.mutate()}>{t('cash.write')}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="red">{err}</Alert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('cash.category')} required>{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{expenseCategoryLabel(t, c)}</option>)}</Select>}</Field>
          <Field label={t('cash.amountSomComma')} required error={amount && tiyin == null ? t('cash.enterNumber') : undefined} hint={t('cash.drawerHint', { amount: formatSom(shift.expected_cash) })}>{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        </div>
        <Field label={t('cash.whatFor')} required>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('cash.whatForPlaceholder')} />}</Field>
        {!ready && <p className="text-sm text-slate-600">{t('cash.fillRequired')}</p>}
      </div>
    </Modal>
  );
}
