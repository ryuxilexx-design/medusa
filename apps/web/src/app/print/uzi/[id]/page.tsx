'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PrintDoc, PrintState } from '@/components/print-doc';

export default function PrintUzi({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['diagnostics', id], queryFn: () => api(`/diagnostics/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  const d = q.data;
  const signed = d.report_status === 'signed';
  return (
    <PrintDoc title={`UZI xulosasi: ${d.service_name}`} number={`U-${id.slice(0, 8).toUpperCase()}`} date={d.signed_at ?? d.updated_at ?? d.ordered_at} branch={d.branch_name} patient={d}
      responsible={d.specialist_name ?? d.performer_name ?? '—'} status={signed ? 'Tasdiqlangan' : 'Qoralama'} draft={!signed}>
      <div className="print-avoid-break mb-3"><h2 className="text-xs font-bold uppercase text-slate-500">Tekshiruv turi</h2><p>{d.exam_type ?? d.service_name}</p></div>
      <div className="print-avoid-break mb-3"><h2 className="text-xs font-bold uppercase text-slate-500">Tavsif</h2><p className="whitespace-pre-wrap">{d.description || 'Kiritilmagan'}</p></div>
      <div className="print-avoid-break mb-3"><h2 className="text-xs font-bold uppercase text-slate-500">Xulosa</h2><p className="whitespace-pre-wrap">{d.conclusion || 'Kiritilmagan'}</p></div>
    </PrintDoc>
  );
}
