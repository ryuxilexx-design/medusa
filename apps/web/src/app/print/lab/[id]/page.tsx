'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { PrintDoc, PrintState } from '@/components/print-doc';
import { LabValues } from '@/components/lab-values';

export default function PrintLab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['orders', 'one', id], queryFn: () => api(`/orders/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  const o = q.data;
  const verified = o.status === 'verified';
  return (
    <PrintDoc title={`Laboratoriya natijasi: ${o.service_name}`} number={`L-${id.slice(0, 8).toUpperCase()}`} date={o.verified_at ?? o.ordered_at} branch={o.branch_name} patient={o}
      responsible={o.verified_by_name ?? o.entered_by_name ?? '—'} status={verified ? 'Tasdiqlangan' : 'Tasdiqlanmagan'} draft={!verified}>
      <p className="mb-3 text-slate-600">Buyurtma: {fmtDateTime(o.ordered_at)} · Buyurtmachi: {o.ordered_by ?? '—'} · Namuna: {fmtDateTime(o.collected_at)}</p>
      {o.values?.length ? <div className="print-avoid-break"><LabValues values={o.values} /></div> : <p>Natija kiritilmagan.</p>}
      {o.comment && <p className="mt-3"><b>Izoh:</b> {o.comment}</p>}
      <p className="mt-4 text-xs text-slate-500">Referens oraliqlar namunaviy va klinik foydalanishga tekshirilmagan. Natija o‘zi tashxis emas — shifokor talqin qiladi.</p>
    </PrintDoc>
  );
}
