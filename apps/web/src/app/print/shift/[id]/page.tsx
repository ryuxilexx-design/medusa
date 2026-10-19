'use client';
import { Fragment, use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Printer } from 'lucide-react';
import { PAYMENT_METHOD_LABEL, REFUND_REASON_LABEL } from '@meduza/contracts';
import { api } from '@/lib/api';
import { fmtDateTime, fmtTime, formatSom, fullName, pid } from '@/lib/format';
import { useMeQuery } from '@/lib/session';
import { BrandMark, BrandWordmark } from '@/components/logo';
import { ErrorState } from '@/components/ui';

/** Shift report (X-report while open, final Z-like report after close). Internal document, not a fiscal report. */
export default function PrintShift({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMeQuery();
  const q = useQuery({ queryKey: ['cash-shift', id], queryFn: () => api(`/cash-shifts/${id}`).then((r) => r.data) });
  if (q.isLoading) return <div className="flex h-screen items-center justify-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (q.isError) return <div className="mx-auto mt-20 max-w-md rounded-lg border bg-white"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const s = q.data, t = s.totals;
  // business time is the demo clock (server "now" + time elapsed since /me was fetched), never the browser date
  const demoNow = me.data ? new Date(Date.parse(me.data.now) + (Date.now() - me.data.fetched_at)) : new Date(s.opened_at);
  const closed = s.status === 'closed';
  const row = (k: string, v: string, strong = false) => <tr className={strong ? 'border-t border-slate-400 font-semibold' : ''}><td className="py-0.5 pr-4">{k}</td><td className="py-0.5 text-right tabular-nums">{v}</td></tr>;
  return (
    <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-3 flex max-w-[210mm] justify-between">
        <button onClick={() => window.close()} className="text-sm text-slate-600 hover:underline">Yopish</button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-brand-700"><Printer className="h-4 w-4" />Chop etish / PDF saqlash</button>
      </div>
      <article className="mx-auto max-w-[210mm] bg-white p-[14mm] text-[0.8125rem] leading-relaxed text-slate-900 shadow-lg print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
          <div className="flex items-center gap-3"><BrandMark compact className="h-10 w-10" /><div><BrandWordmark className="text-lg" /><div className="text-xs text-slate-600">{me.data?.clinic_name} · {s.branch_name}</div></div></div>
          <div className="text-right text-xs">{me.data?.demo && <div className="font-bold text-red-700">DEMO — SUN’IY MA’LUMOT</div>}<div>Smena №{s.number}</div><div>{closed ? 'Yakuniy hisobot' : `Oraliq hisobot · ${fmtDateTime(demoNow.toISOString())}`}</div></div>
        </header>
        <h1 className="mt-4 text-xl font-bold">Kassa smenasi hisoboti {closed ? '' : <span className="ml-2 rounded border-2 border-amber-500 px-2 text-base uppercase text-amber-600">Smena ochiq</span>}</h1>
        <p className="mt-1 text-slate-600">Kassir: <b className="text-slate-900">{s.cashier_name}</b> · Ochildi: {fmtDateTime(s.opened_at)}{closed && <> · Yopildi: {fmtDateTime(s.closed_at)} ({s.closed_by_name})</>}</p>
        <div className="mt-4 grid grid-cols-2 gap-8">
          <section><h2 className="mb-1 text-xs font-bold uppercase text-slate-500">Naqd pul (kassa)</h2>
            <table className="w-full"><tbody>
              {row('Boshlang‘ich naqd', formatSom(s.opening_cash))}
              {row(`+ Naqd to‘lovlar (${t.payments.cash.n})`, formatSom(t.payments.cash.sum))}
              {row(`− Naqd qaytarishlar (${t.refunds.cash.n})`, formatSom(t.refunds.cash.sum))}
              {row(`− Kassadan xarajatlar (${t.cash_expenses.n})`, formatSom(t.cash_expenses.sum))}
              {row('Kassada bo‘lishi kerak', formatSom(s.expected_cash), true)}
              {closed && row('Sanalgan', formatSom(s.counted_cash))}
              {closed && row('Farq', `${s.difference > 0 ? '+' : ''}${formatSom(s.difference)}`, true)}
            </tbody></table>
            {closed && s.close_note && <p className="mt-1 text-xs">Izoh: {s.close_note}</p>}
          </section>
          <section><h2 className="mb-1 text-xs font-bold uppercase text-slate-500">Barcha to‘lovlar</h2>
            <table className="w-full"><tbody>
              {(['cash', 'card', 'transfer'] as const).map((m) => <Fragment key={m}>{row(`${PAYMENT_METHOD_LABEL[m]} (${t.payments[m].n})`, formatSom(t.payments[m].sum))}</Fragment>)}
              {row('Jami qabul qilingan', formatSom(t.payments.cash.sum + t.payments.card.sum + t.payments.transfer.sum), true)}
              {(t.refunds.card.sum + t.refunds.transfer.sum) > 0 && row('Karta/o‘tkazma qaytarishlar', formatSom(t.refunds.card.sum + t.refunds.transfer.sum))}
            </tbody></table>
          </section>
        </div>
        <h2 className="mt-6 text-xs font-bold uppercase text-slate-500">To‘lovlar ({s.payments.length})</h2>
        <table className="mt-1 w-full border-collapse text-[0.75rem]">
          <thead><tr className="border-b border-slate-400 text-left"><th className="py-0.5">Vaqt</th><th>Qayd №</th><th>Hisob</th><th>Bemor</th><th>Usul</th><th className="text-right">Summa</th></tr></thead>
          <tbody>{s.payments.map((p: any) => <tr key={p.id} className="border-b border-slate-100"><td className="py-0.5">{fmtTime(p.paid_at)}</td><td>{p.receipt_number}</td><td>№{p.invoice_number}</td><td>{fullName(p)} {pid(p.patient_number)}</td><td>{PAYMENT_METHOD_LABEL[p.method]}</td><td className="text-right tabular-nums">{formatSom(p.amount)}</td></tr>)}</tbody>
        </table>
        {s.refunds.length > 0 && <>
          <h2 className="mt-4 text-xs font-bold uppercase text-slate-500">Qaytarishlar ({s.refunds.length})</h2>
          <table className="mt-1 w-full border-collapse text-[0.75rem]"><tbody>{s.refunds.map((r: any) => <tr key={r.id} className="border-b border-slate-100"><td className="py-0.5">{fmtTime(r.refunded_at)}</td><td>№{r.refund_number}</td><td>Hisob №{r.invoice_number}</td><td>{REFUND_REASON_LABEL[r.reason_code]} ({r.approved_by_name})</td><td className="text-right tabular-nums">−{formatSom(r.amount)}</td></tr>)}</tbody></table>
        </>}
        {s.expenses.length > 0 && <>
          <h2 className="mt-4 text-xs font-bold uppercase text-slate-500">Kassadan xarajatlar</h2>
          <table className="mt-1 w-full border-collapse text-[0.75rem]"><tbody>{s.expenses.map((e: any) => <tr key={e.id} className={e.status === 'void' ? 'text-slate-400 line-through' : 'border-b border-slate-100'}><td className="py-0.5">{fmtTime(e.occurred_at)}</td><td>{e.category}</td><td>{e.note}</td><td>{e.created_by_name}</td><td className="text-right tabular-nums">−{formatSom(e.amount)}</td></tr>)}</tbody></table>
        </>}
        <footer className="mt-10 grid grid-cols-2 gap-8 border-t border-slate-300 pt-3 text-xs text-slate-600">
          <div>Kassir: ______________________</div><div>Qabul qildi (rahbar): ______________________</div>
          <p className="col-span-2">Ichki hisobot — fiskal Z-hisobot emas.</p>
        </footer>
      </article>
    </div>
  );
}
