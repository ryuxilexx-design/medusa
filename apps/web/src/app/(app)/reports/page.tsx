'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, formatSom, fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Card, EmptyState, ErrorState, LoadingRows, PageHeader, Table, Td, Th } from '@/components/ui';
import { DateRange } from '@/components/date-range';

export default function ReportsPage() { return <Suspense><Reports /></Suspense>; }

function Reports() {
  const { me, branchId } = useSession();
  const t = useT();
  const sp = useSearchParams();
  const initFrom = sp.get('from') ?? (sp.get('period') === '30d' ? addDays(me.today, -29) : addDays(me.today, -29));
  const [from, setFrom] = useState(initFrom);
  const [to, setTo] = useState(sp.get('to') ?? me.today);
  const f = { from, to, branch_id: branchId };
  const svc = useQuery({ queryKey: ['reports', 'services', f], queryFn: () => api(`/reports/services${qs(f)}`), enabled: me.role === 'manager' });
  const doc = useQuery({ queryKey: ['reports', 'doctors', f], queryFn: () => api(`/reports/doctors${qs(f)}`) });
  return (
    <>
      <PageHeader title={me.role === 'doctor' ? t('clinical.rep.myActivity') : t('clinical.rep.title')} subtitle={t('clinical.rep.subtitle', { from: fmtDate(from), to: fmtDate(to) })}
        actions={<DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />} />
      {me.role === 'doctor' ? <MyActivity q={doc} /> : (
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        {me.role === 'manager' && (
          <Card title={t('clinical.rep.byService')} padded={false}>
            {svc.isLoading ? <LoadingRows /> : svc.isError ? <ErrorState error={svc.error} onRetry={() => svc.refetch()} /> : !svc.data.data.length ? <EmptyState title={t('clinical.noServicesInPeriod')} /> : (
              <Table className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
                <thead><tr><Th>{t('clinical.rep.service')}</Th><Th right>{t('clinical.rep.count')}</Th><Th right className="hidden sm:table-cell">{t('clinical.rep.discount')}</Th><Th right className="max-sm:!whitespace-normal">{t('clinical.rep.value')}</Th></tr></thead>
                <tbody>
                  {svc.data.data.map((r: any) => <tr key={r.service_id}><Td><div className="font-medium text-slate-900">{r.service_name}</div><div className="text-xs text-slate-600">{t(`service.${r.category}` as MessageKey)}</div></Td><Td right>{r.count}</Td><Td right className="hidden sm:table-cell">{Number(r.discount) ? `−${formatSom(Number(r.discount))}` : '—'}</Td><Td right className="font-medium max-sm:!whitespace-normal">{formatSom(Number(r.value))}</Td></tr>)}
                  <tr className="bg-slate-50"><Td className="font-semibold">{t('clinical.rep.total')}</Td><Td right>{svc.data.data.reduce((a: number, b: any) => a + b.count, 0)}</Td><Td className="hidden sm:table-cell" /><Td right className="font-semibold max-sm:!whitespace-normal">{formatSom(svc.data.meta.total)}</Td></tr>
                </tbody>
              </Table>
            )}
          </Card>
        )}
        <Card title={t('clinical.rep.byDoctor')} padded={false}>
          {doc.isLoading ? <LoadingRows /> : doc.isError ? <ErrorState error={doc.error} onRetry={() => doc.refetch()} /> : !doc.data.data.some((r: any) => r.services > 0) ? <EmptyState title={t('clinical.noServicesInPeriod')} /> : (
            <Table>
              <thead><tr><Th>{t('role.doctor')}</Th><Th right>{t('clinical.rep.services')}</Th><Th right>{t('clinical.rep.value')}</Th><Th right>{t('clinical.rep.share')}</Th></tr></thead>
              <tbody>
                {doc.data.data.map((r: any) => <tr key={r.doctor_id}><Td><div className="whitespace-nowrap font-medium">{r.name}</div><div className="text-xs text-slate-600">{r.specialty}</div></Td><Td right>{r.services}</Td><Td right>{formatSom(r.value)}</Td><Td right className="font-medium">{formatSom(r.share)}</Td></tr>)}
                <tr className="bg-slate-50"><Td className="font-semibold">{t('clinical.rep.total')}</Td><Td right>{doc.data.data.reduce((a: number, b: any) => a + b.services, 0)}</Td><Td right className="font-semibold">{formatSom(doc.data.data.reduce((a: number, b: any) => a + b.value, 0))}</Td><Td right className="font-semibold">{formatSom(doc.data.data.reduce((a: number, b: any) => a + b.share, 0))}</Td></tr>
              </tbody>
            </Table>
          )}
          <p className="px-4 py-2 text-xs text-slate-600">{t('clinical.rep.shareNote')}</p>
        </Card>
      </div>
      )}
      <p className="mt-3 text-xs text-slate-600">{t('clinical.rep.metricsNote')}</p>
    </>
  );
}

/** A doctor sees only their own row: three plain figures instead of a one-row table whose last column hides on a phone. */
function MyActivity({ q }: { q: any }) {
  const t = useT();
  if (q.isLoading) return <Card><LoadingRows rows={2} /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const rows: any[] = q.data.data;
  const sum = (k: string) => rows.reduce((a, b) => a + Number(b[k] ?? 0), 0);
  const tiles: [string, string][] = [[t('clinical.rep.services'), String(sum('services'))], [t('clinical.rep.value'), formatSom(sum('value'))], [t('clinical.rep.share'), formatSom(sum('share'))]];
  return (
    <Card title={t('clinical.rep.myServices')}>
      {sum('services') === 0 ? <EmptyState title={t('clinical.noServicesInPeriod')} /> : (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {tiles.map(([k, v], i) => (
            <div key={k} className={i === 2 ? 'rounded-lg border border-brand-200 bg-brand-50 p-4' : 'rounded-lg border border-slate-200 p-4'}>
              <dt className="text-sm font-medium text-slate-600">{k}</dt>
              <dd className="mt-1 whitespace-nowrap text-2xl font-bold tabular-nums text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-3 text-xs text-slate-600">{t('clinical.rep.shareNote')}</p>
    </Card>
  );
}
