'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { formatSom } from '@/lib/format';
import { PrintDoc, PrintState } from '@/components/print-doc';
import { useT } from '@/lib/i18n';

export default function PrintPayment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const q = useQuery({ queryKey: ['payments', 'one', id], queryFn: () => api(`/payments/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  const p = q.data;
  // a recorded fiscal receipt (parallel mode / provider): its number and QR link are printed; otherwise the slip stays an internal record
  const f = p.fiscal;
  const issued = f?.status === 'issued';
  return (
    <PrintDoc title={issued ? t('print.pay.fiscalTitle', { n: f.receipt_number }) : t('print.pay.title')} number={`T-${p.receipt_number}`} date={p.paid_at} branch={p.branch_name} patient={p} responsible={t('print.pay.cashier', { name: p.cashier_name })} status={issued ? t('print.pay.fiscalIssued') : t('print.pay.recorded')}>
      <table className="print-avoid-break w-full text-[0.8125rem]">
        <thead><tr className="border-b border-slate-400 text-left text-xs text-slate-600"><th className="py-1">{t('print.pay.service', { n: p.invoice_number })}</th><th className="py-1 text-right">{t('print.pay.qty')}</th><th className="py-1 text-right">{t('print.pay.sum')}</th></tr></thead>
        <tbody>{(p.items ?? []).map((it: any, i: number) => <tr key={i} className="border-b border-slate-200"><td className="py-1">{it.description}</td><td className="py-1 text-right tabular-nums">{it.quantity}</td><td className="whitespace-nowrap py-1 text-right tabular-nums">{formatSom(it.line_total)}</td></tr>)}</tbody>
      </table>
      <div className="print-avoid-break ml-auto mt-4 w-full max-w-[22rem] space-y-1">
        <div className="flex justify-between gap-4"><span>{t('print.pay.total')}</span><span className="shrink-0 whitespace-nowrap tabular-nums">{formatSom(p.total)}</span></div>
        <div className="flex justify-between gap-4 text-base font-bold"><span>{t('print.pay.thisPayment')}</span><span className="shrink-0 whitespace-nowrap tabular-nums">{formatSom(p.amount)}</span></div>
        <div className="flex justify-between gap-4"><span>{t('print.pay.method')}</span><span>{t(`payment.${p.method}` as MessageKey)}</span></div>
        <div className="flex justify-between gap-4"><span>{t('print.pay.paidSoFar')}</span><span className="shrink-0 whitespace-nowrap tabular-nums">{formatSom(p.paid_amount)}</span></div>
        <div className="flex justify-between gap-4"><span>{t('print.pay.due')}</span><span className="shrink-0 whitespace-nowrap tabular-nums">{formatSom(p.due)}</span></div>
        <div className="flex justify-between gap-4"><span>{t('print.pay.invoiceStatus')}</span><span>{t(`status.invoice.${p.invoice_status}` as MessageKey)}</span></div>
      </div>
      {p.note && <p className="mt-3"><b>{t('print.comment')}</b> {p.note}</p>}
      {issued && (
        <div className="print-avoid-break mt-4 rounded border-2 border-slate-800 p-3 text-[0.8125rem]">
          <div className="flex justify-between gap-4"><span>{t('print.pay.fiscalNumber')}</span><b className="tabular-nums">{f.receipt_number}</b></div>
          {f.fiscal_sign && <div className="flex justify-between gap-4"><span>{t('print.pay.fiscalSign')}</span><span className="tabular-nums">{f.fiscal_sign}</span></div>}
          {f.terminal_id && <div className="flex justify-between gap-4"><span>{t('print.pay.fiscalTerminal')}</span><span className="tabular-nums">{f.terminal_id}</span></div>}
          {f.qr_url && <div className="mt-1 break-all"><span>{t('print.pay.fiscalQr')}</span> <span className="font-mono text-xs">{f.qr_url}</span></div>}
        </div>
      )}
      <p className="mt-6 rounded border border-slate-300 p-2 text-xs text-slate-600">{issued ? t('print.pay.fiscalDisclaimer') : f && f.status !== 'skipped' ? t('print.pay.fiscalPending') : t('print.pay.disclaimer')}</p>
    </PrintDoc>
  );
}
