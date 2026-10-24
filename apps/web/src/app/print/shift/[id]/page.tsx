'use client';
import { Fragment, use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Printer, X } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { fmtDateTime, fmtTime, formatSom, fullName, pid } from '@/lib/format';
import { useMeQuery } from '@/lib/session';
import { BrandMark, BrandWordmark } from '@/components/logo';
import { Button, ErrorState } from '@/components/ui';
import { expenseCategoryLabel } from '@/components/cash-shift';
import { useT } from '@/lib/i18n';

/** Shift report (X-report while open, final Z-like report after close). Internal document, not a fiscal report. */
export default function PrintShift({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMeQuery();
  const t = useT();
  const q = useQuery({ queryKey: ['cash-shift', id], queryFn: () => api(`/cash-shifts/${id}`).then((r) => r.data) });
  if (q.isLoading) return <div className="flex h-screen items-center justify-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (q.isError) return <div className="surface mx-auto mt-20 max-w-md"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const s = q.data, tot = s.totals;
  const pm = (m: string) => t(`payment.${m}` as MessageKey);
  // business time is the demo clock (server "now" + time elapsed since /me was fetched), never the browser date
  const demoNow = me.data ? new Date(Date.parse(me.data.now) + (Date.now() - me.data.fetched_at)) : new Date(s.opened_at);
  const closed = s.status === 'closed';
  const demo = me.data?.demo !== false; // as PrintDoc: until /me answers, assume demo
  const fiscal = me.data ? me.data.fiscal_provider !== 'none' : false; // parallel mode: show which payments still lack the KKM receipt
  const row = (k: string, v: string, strong = false) => <tr className={strong ? 'border-t border-slate-400 font-semibold' : ''}><td className="py-0.5 pr-4">{k}</td><td className="whitespace-nowrap py-0.5 text-right tabular-nums">{v}</td></tr>;
  return (
    <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
      {/* the same toolbar as every other print page (components/print-doc.tsx) */}
      <div className="no-print mx-auto mb-3 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4 print:hidden">
        <Button variant="ghost" icon={<X className="h-5 w-5" />} onClick={() => window.close()}>{t('print.close')}</Button>
        <Button variant="primary" className="ml-auto" icon={<Printer className="h-5 w-5 shrink-0" />} onClick={() => window.print()}>{t('print.print')}</Button>
      </div>
      <article className="relative mx-auto max-w-[210mm] overflow-hidden bg-white p-[14mm] text-[0.8125rem] leading-relaxed text-slate-900 shadow-lg print:max-w-none print:p-0 print:shadow-none">
        {demo && <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[24deg] select-none whitespace-nowrap text-[2rem] font-black tracking-widest text-slate-200/60 print:text-slate-200">{t('print.demoMark')}</span>
        </div>}
        <div className="relative">
        <header className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
          <div className="flex items-center gap-3"><BrandMark compact className="h-10 w-10" /><div><BrandWordmark className="text-lg" /><div className="text-xs text-slate-600">{me.data?.clinic_name}, {s.branch_name}</div></div></div>
          <div className="text-right text-xs">{demo && <div className="font-bold text-red-700">{t('print.demoMark')}</div>}<div>{t('print.shift.number', { n: s.number })}</div><div>{closed ? t('print.shift.final') : t('print.shift.interim', { at: fmtDateTime(demoNow.toISOString()) })}</div></div>
        </header>
        <h1 className="mt-4 text-xl font-bold">{t('print.shift.title')} {closed ? '' : <span className="ml-2 rounded border-2 border-amber-500 px-2 text-base text-amber-700">{t('print.shift.open')}</span>}</h1>
        <p className="mt-1 text-slate-600">{t('print.shift.cashier')} <b className="text-slate-900">{s.cashier_name}</b>, {t('print.shift.opened', { at: fmtDateTime(s.opened_at) })}{closed && <>, {t('print.shift.closed', { at: fmtDateTime(s.closed_at), name: s.closed_by_name })}</>}</p>
        <div className="mt-4 grid grid-cols-2 gap-8">
          <section><h2 className="mb-1 text-xs font-bold text-slate-600">{t('print.shift.cashSection')}</h2>
            <table className="w-full"><tbody>
              {row(t('print.shift.opening'), formatSom(s.opening_cash))}
              {row(t('print.shift.cashPayments', { n: tot.payments.cash.n }), formatSom(tot.payments.cash.sum))}
              {row(t('print.shift.cashRefunds', { n: tot.refunds.cash.n }), formatSom(tot.refunds.cash.sum))}
              {row(t('print.shift.cashExpenses', { n: tot.cash_expenses.n }), formatSom(tot.cash_expenses.sum))}
              {(tot.deposit_in?.cash.sum ?? 0) > 0 && row(t('print.shift.depositIn', { n: tot.deposit_in!.cash.n }), formatSom(tot.deposit_in!.cash.sum))}
              {(tot.deposit_out?.cash.sum ?? 0) > 0 && row(t('print.shift.depositOut', { n: tot.deposit_out!.cash.n }), formatSom(tot.deposit_out!.cash.sum))}
              {row(t('print.shift.expected'), formatSom(s.expected_cash), true)}
              {closed && row(t('print.shift.counted'), formatSom(s.counted_cash))}
              {closed && row(t('print.shift.difference'), `${s.difference > 0 ? '+' : ''}${formatSom(s.difference)}`, true)}
            </tbody></table>
            {fiscal && <p className={`mt-1 text-xs ${s.fiscal_pending ? 'font-semibold text-red-700' : 'text-slate-600'}`}>{t('print.shift.fiscalPending', { n: s.fiscal_pending ?? 0 })}</p>}
            {closed && s.close_note && <p className="mt-1 text-xs">{t('print.shift.note', { text: s.close_note })}</p>}
          </section>
          <section><h2 className="mb-1 text-xs font-bold text-slate-600">{t('print.shift.allPayments')}</h2>
            <table className="w-full"><tbody>
              {(['cash', 'card', 'transfer'] as const).map((m) => <Fragment key={m}>{row(t('print.shift.methodCount', { method: pm(m), n: tot.payments[m].n }), formatSom(tot.payments[m].sum))}</Fragment>)}
              {row(t('print.shift.totalReceived'), formatSom(tot.payments.cash.sum + tot.payments.card.sum + tot.payments.transfer.sum), true)}
              {(tot.refunds.card.sum + tot.refunds.transfer.sum) > 0 && row(t('print.shift.otherRefunds'), formatSom(tot.refunds.card.sum + tot.refunds.transfer.sum))}
            </tbody></table>
          </section>
        </div>
        <h2 className="mt-6 text-xs font-bold text-slate-600">{t('print.shift.payments', { n: s.payments.length })}</h2>
        <table className="mt-1 w-full border-collapse text-[0.75rem]">
          <thead><tr className="border-b border-slate-400 text-left"><th className="py-0.5">{t('print.shift.time')}</th><th>{t('print.shift.receipt')}</th><th>{t('print.shift.invoice')}</th><th>{t('print.shift.patient')}</th><th>{t('print.shift.method')}</th>{fiscal && <th>{t('print.shift.fiscalCol')}</th>}<th className="text-right">{t('print.shift.amount')}</th></tr></thead>
          <tbody>{s.payments.map((p: any) => <tr key={p.id} className="border-b border-slate-100 tabular-nums"><td className="py-0.5">{fmtTime(p.paid_at)}</td><td>{p.receipt_number}</td><td>№{p.invoice_number}</td><td>{fullName(p)} {pid(p.patient_number)}</td><td>{pm(p.method)}</td>
            {fiscal && <td>{p.fiscal?.status === 'issued' ? p.fiscal.receipt_number : p.fiscal && p.fiscal.status !== 'skipped' ? <span className="font-semibold text-red-700">{t('print.shift.fiscalNo')}</span> : '—'}</td>}
            <td className="whitespace-nowrap text-right tabular-nums">{formatSom(p.amount)}</td></tr>)}</tbody>
        </table>
        {s.refunds.length > 0 && <>
          <h2 className="mt-4 text-xs font-bold text-slate-600">{t('print.shift.refunds', { n: s.refunds.length })}</h2>
          <table className="mt-1 w-full border-collapse text-[0.75rem]"><tbody>{s.refunds.map((r: any) => <tr key={r.id} className="border-b border-slate-100"><td className="py-0.5">{fmtTime(r.refunded_at)}</td><td>№{r.refund_number}</td><td>{t('print.shift.invoiceNo', { n: r.invoice_number })}</td><td>{t(`print.refund.${r.reason_code}` as MessageKey)} ({r.approved_by_name})</td><td className="whitespace-nowrap text-right tabular-nums">−{formatSom(r.amount)}</td></tr>)}</tbody></table>
        </>}
        {s.expenses.length > 0 && <>
          <h2 className="mt-4 text-xs font-bold text-slate-600">{t('print.shift.expenses')}</h2>
          <table className="mt-1 w-full border-collapse text-[0.75rem]"><tbody>{s.expenses.map((e: any) => <tr key={e.id} className={e.status === 'void' ? 'text-slate-400 line-through' : 'border-b border-slate-100'}><td className="py-0.5">{fmtTime(e.occurred_at)}</td><td>{expenseCategoryLabel(t, e.category)}</td><td>{e.note}</td><td>{e.created_by_name}</td><td className="whitespace-nowrap text-right tabular-nums">−{formatSom(e.amount)}</td></tr>)}</tbody></table>
        </>}
        <footer className="mt-10 grid grid-cols-2 gap-8 border-t border-slate-300 pt-3 text-xs text-slate-600">
          <div>{t('print.shift.signCashier')}</div><div>{t('print.shift.signManager')}</div>
          <p className="col-span-2">{t('print.shift.notFiscal')}</p>
        </footer>
        </div>
      </article>
    </div>
  );
}
