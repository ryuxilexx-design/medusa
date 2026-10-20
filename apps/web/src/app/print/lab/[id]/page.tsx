'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EyeOff, Hourglass, X } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useMeQuery } from '@/lib/session';
import { PrintDoc, PrintState } from '@/components/print-doc';
import { LabValues } from '@/components/lab-values';
import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n';

export default function PrintLab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const me = useMeQuery();
  const q = useQuery({ queryKey: ['orders', 'one', id], queryFn: () => api(`/orders/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  if (!me.data) return <PrintState q={{ isLoading: !me.isError, isError: me.isError, error: me.error, refetch: me.refetch }} />;
  const o = q.data;
  const verified = o.status === 'verified';
  const status = t(`status.lab.${o.status}` as MessageKey);
  // The server leaves out the values for roles that may not see them (same rule as lab.controller `shape`): the lab
  // always, the doctor only after verification. Without them this page must not look like a finished document that
  // says «no result» — it says why there is nothing to print.
  if (me.data.role !== 'lab' && !(me.data.role === 'doctor' && verified)) {
    const doctor = me.data.role === 'doctor';
    return (
      <main className="mx-4 mt-20 sm:mx-auto sm:max-w-md">
        <title>{`${t('print.lab.title', { service: o.service_name })} — Med.uz.ai`}</title>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-white px-6 py-10 text-center" data-testid="lab-print-unavailable">
          {doctor ? <Hourglass className="h-8 w-8 text-amber-500" aria-hidden="true" /> : <EyeOff className="h-8 w-8 text-slate-400" aria-hidden="true" />}
          <h1 className="text-lg font-bold text-slate-900">{doctor ? t('print.lab.notVerifiedTitle') : t('print.lab.hiddenTitle')}</h1>
          <p className="text-base text-slate-700">{doctor ? t('print.lab.notVerifiedText', { status }) : t('print.lab.hiddenText', { status })}</p>
        </div>
        <div className="mt-3 flex justify-center"><Button variant="ghost" icon={<X className="h-5 w-5" />} onClick={() => window.close()}>{t('print.close')}</Button></div>
      </main>
    );
  }
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
