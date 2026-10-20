'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PrintDoc, PrintState } from '@/components/print-doc';
import { useT } from '@/lib/i18n';

export default function PrintUzi({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const q = useQuery({ queryKey: ['diagnostics', id], queryFn: () => api(`/diagnostics/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  const d = q.data;
  const signed = d.report_status === 'signed';
  return (
    <PrintDoc title={t('print.uzi.title', { service: d.service_name })} number={`U-${id.slice(0, 8).toUpperCase()}`} date={d.signed_at ?? d.updated_at ?? d.ordered_at} branch={d.branch_name} patient={d}
      responsible={d.specialist_name ?? d.performer_name ?? '—'} status={signed ? t('print.signed') : t('print.draft')} draft={!signed}>
      <div className="print-avoid-break mb-3"><h2 className="text-xs font-bold text-slate-600">{t('print.uzi.type')}</h2><p>{d.exam_type ?? d.service_name}</p></div>
      <div className="print-avoid-break mb-3"><h2 className="text-xs font-bold text-slate-600">{t('print.uzi.description')}</h2><p className="whitespace-pre-wrap">{d.description || t('print.notEntered')}</p></div>
      <div className="print-avoid-break mb-3"><h2 className="text-xs font-bold text-slate-600">{t('print.uzi.conclusion')}</h2><p className="whitespace-pre-wrap">{d.conclusion || t('print.notEntered')}</p></div>
    </PrintDoc>
  );
}
