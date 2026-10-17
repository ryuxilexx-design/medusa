'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_METHOD_LABEL, INVOICE_STATUS_LABEL } from '@meduza/contracts';
import { api } from '@/lib/api';
import { formatSom } from '@/lib/format';
import { PrintDoc, PrintState } from '@/components/print-doc';

export default function PrintPayment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['payments', 'one', id], queryFn: () => api(`/payments/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  const p = q.data;
  return (
    <PrintDoc title="Ichki to‘lov qaydi — fiskal chek emas" number={`T-${p.receipt_number}`} date={p.paid_at} branch={p.branch_name} patient={p} responsible={`${p.cashier_name}, kassir`} status="Qayd etilgan">
      <table className="print-avoid-break w-full text-[13px]">
        <thead><tr className="border-b border-slate-400 text-left text-xs uppercase text-slate-500"><th className="py-1">Xizmat (hisob №{p.invoice_number})</th><th className="py-1 text-right">Miqdor</th><th className="py-1 text-right">Summa</th></tr></thead>
        <tbody>{(p.items ?? []).map((it: any, i: number) => <tr key={i} className="border-b border-slate-200"><td className="py-1">{it.description}</td><td className="py-1 text-right">{it.quantity}</td><td className="py-1 text-right tabular-nums">{formatSom(it.line_total)}</td></tr>)}</tbody>
      </table>
      <div className="print-avoid-break ml-auto mt-4 w-72 space-y-1">
        <div className="flex justify-between"><span>Hisob jami:</span><span className="tabular-nums">{formatSom(p.total)}</span></div>
        <div className="flex justify-between text-base font-bold"><span>Ushbu to‘lov:</span><span className="tabular-nums">{formatSom(p.amount)}</span></div>
        <div className="flex justify-between"><span>To‘lov usuli:</span><span>{PAYMENT_METHOD_LABEL[p.method]}</span></div>
        <div className="flex justify-between"><span>Hisob bo‘yicha jami to‘langan (hozir):</span><span className="tabular-nums">{formatSom(p.paid_amount)}</span></div>
        <div className="flex justify-between"><span>Qoldiq (hozir):</span><span className="tabular-nums">{formatSom(p.due)}</span></div>
        <div className="flex justify-between"><span>Hisob holati:</span><span>{INVOICE_STATUS_LABEL[p.invoice_status as keyof typeof INVOICE_STATUS_LABEL]}</span></div>
      </div>
      {p.note && <p className="mt-3"><b>Izoh:</b> {p.note}</p>}
      <p className="mt-6 rounded border border-slate-300 p-2 text-xs text-slate-600">Bu hujjat klinikaning ichki to‘lov qaydi. Fiskal chek emas; soliq organlariga yuborilmaydi. Bank/fiskal integratsiya ushbu demoda yo‘q.</p>
    </PrintDoc>
  );
}
