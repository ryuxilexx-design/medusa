'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { PrintDoc, PrintState } from '@/components/print-doc';
import { LabValues } from '@/components/lab-values';
import { useT } from '@/lib/i18n';

export default function PrintLab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const q = useQuery({ queryKey: ['orders', 'one', id], queryFn: () => api(`/orders/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  const o = q.data;
  const verified = o.status === 'verified';
  return (
    <PrintDoc title={t('print.lab.title', { service: o.service_name })} number={`L-${id.slice(0, 8).toUpperCase()}`} date={o.verified_at ?? o.ordered_at} branch={o.branch_name} patient={o}
      responsible={o.verified_by_name ?? o.entered_by_name ?? '—'} status={verified ? t('print.signed') : t('print.notSigned')} draft={!verified}>
      <p className="mb-3 text-slate-600">{t('print.lab.meta', { ordered: fmtDateTime(o.ordered_at), by: o.ordered_by ?? '—', collected: fmtDateTime(o.collected_at) })}</p>
      {o.values?.length ? <div className="print-avoid-break"><LabValues values={o.values} /></div> : <p>{t('print.lab.noResult')}</p>}
      {o.comment && <p className="mt-3"><b>{t('print.comment')}</b> {o.comment}</p>}
      <p className="mt-4 text-xs text-slate-600">{t('print.lab.disclaimer')}</p>
    </PrintDoc>
  );
}
