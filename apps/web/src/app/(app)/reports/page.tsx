'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Banknote, ClipboardCheck, Percent } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, formatSom } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Card, EmptyState, Money, ErrorState, LoadingRows, PageHeader, StatCard, Table, Tabs, Td, Th } from '@/components/ui';
import { DateRange } from '@/components/date-range';

/** Sum of integer tiyin amounts, added exactly (BigInt) — never a floating-point money sum. */
const sumTiyin = (rows: any[], key: string) => Number(rows.reduce((a: bigint, b: any) => a + BigInt(b[key] ?? 0), 0n));
const sumInt = (rows: any[], key: string) => rows.reduce((a: number, b: any) => a + Number(b[key] ?? 0), 0);

export default function ReportsPage() { return <Suspense><Reports /></Suspense>; }

function Reports() {
  const { me, branchId } = useSession();
  const t = useT();
  const sp = useSearchParams();
  const manager = me.role === 'manager';
  const [from, setFrom] = useState(sp.get('from') ?? addDays(me.today, -29));
  const [to, setTo] = useState(sp.get('to') ?? me.today);
  const [tab, setTab] = useState<'services' | 'doctors'>(sp.get('view') === 'doctors' ? 'doctors' : 'services');
  const f = { from, to, branch_id: branchId };
  const svc = useQuery({ queryKey: ['reports', 'services', f], queryFn: () => api(`/reports/services${qs(f)}`), enabled: manager });
  const doc = useQuery({ queryKey: ['reports', 'doctors', f], queryFn: () => api(`/reports/doctors${qs(f)}`) });

  const docRows: any[] = doc.data?.data ?? [];
  const svcRows: any[] = svc.data?.data ?? [];
  // a manager's count and value come from the per-service report (it includes services without a performing doctor)
  const count = manager ? (svc.data ? sumInt(svcRows, 'count') : undefined) : doc.data ? sumInt(docRows, 'services') : undefined;
  const value = manager ? svc.data?.meta.total : doc.data ? sumTiyin(docRows, 'value') : undefined;
  const share = doc.data ? sumTiyin(docRows, 'share') : undefined;
  const loadingTiles = manager ? svc.isLoading || doc.isLoading : doc.isLoading;
  const working = docRows.filter((r) => r.services > 0).length;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1; // calendar dates, not a business timestamp

  return (
    <>
      <PageHeader title={manager ? t('clinical.rep.title') : t('clinical.rep.myActivity')} subtitle={t('clinical.rep.subtitle')}
        actions={<DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />} />
      <div className="space-y-5">
        {(svc.isError || doc.isError) ? <Card><ErrorState error={svc.error ?? doc.error} onRetry={() => { svc.refetch(); doc.refetch(); }} /></Card> : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-5">
            <StatCard loading={loadingTiles} icon={<ClipboardCheck />} label={t('clinical.rep.servicesDone')} value={count} sub={manager ? (doc.data ? t('clinical.rep.doctorsActive', { n: working }) : undefined) : t('clinical.rep.inDays', { n: days })} />
            <StatCard loading={loadingTiles} icon={<Banknote />} label={t('clinical.rep.value')} value={value != null && <Money tiyin={Number(value)} />} sub={t('clinical.rep.valueSub')} />
            <StatCard loading={loadingTiles} icon={<Percent />} label={t('clinical.rep.share')} value={share != null && <Money tiyin={share} />} sub={t('clinical.rep.shareSub')} />
          </div>
        )}

        {manager && !svc.isError && !doc.isError && (
          <Card className="overflow-hidden" padded={false}>
            <div className="[&_[role=tablist]]:px-3"><Tabs value={tab} onChange={setTab} items={[{ value: 'services', label: t('clinical.rep.byService') }, { value: 'doctors', label: t('clinical.rep.byDoctor') }]} /></div>
            {tab === 'services' ? <ServicesTable q={svc} /> : <DoctorsTable q={doc} />}
          </Card>
        )}
      </div>
    </>
  );
}

/** Amount with a smaller currency word that never splits from the number. */
function ServicesTable({ q }: { q: any }) {
  const t = useT();
  if (q.isLoading) return <LoadingRows />;
  const rows: any[] = q.data.data;
  if (!rows.length) return <EmptyState compact title={t('clinical.noServicesInPeriod')} />;
  return (
    <Table className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2 sm:[&_td:first-child]:pl-5 sm:[&_th:first-child]:pl-5 sm:[&_td:last-child]:pr-5 sm:[&_th:last-child]:pr-5 max-sm:[&_th:last-child]:!whitespace-normal">
      <thead><tr><Th>{t('clinical.rep.service')}</Th><Th right>{t('clinical.rep.count')}</Th><Th right className="hidden sm:table-cell">{t('clinical.rep.discount')}</Th><Th right>{t('clinical.rep.value')}</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.service_id}>
            <Td><div className="font-semibold text-slate-900">{r.service_name}</div><div className="text-[0.8125rem] text-slate-600">{t(`service.${r.category}` as MessageKey)}</div></Td>
            <Td right>{r.count}</Td>
            <Td right className="hidden text-slate-600 sm:table-cell">{Number(r.discount) ? `−${formatSom(Number(r.discount))}` : '—'}</Td>
            <Td right className="font-semibold text-slate-900">{formatSom(Number(r.value))}</Td>
          </tr>
        ))}
        <tr className="bg-slate-50"><Td className="font-bold text-slate-900">{t('clinical.rep.total')}</Td><Td right className="font-bold">{sumInt(rows, 'count')}</Td><Td className="hidden sm:table-cell" /><Td right className="font-bold text-slate-900">{formatSom(Number(q.data.meta.total))}</Td></tr>
      </tbody>
    </Table>
  );
}

function DoctorsTable({ q }: { q: any }) {
  const t = useT();
  if (q.isLoading) return <LoadingRows />;
  const rows: any[] = q.data.data;
  if (!rows.some((r) => r.services > 0)) return <EmptyState compact title={t('clinical.noServicesInPeriod')} />;
  return (
    <Table className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2 sm:[&_td:first-child]:pl-5 sm:[&_th:first-child]:pl-5 sm:[&_td:last-child]:pr-5 sm:[&_th:last-child]:pr-5 max-sm:[&_th:last-child]:!whitespace-normal">
      <thead><tr><Th>{t('role.doctor')}</Th><Th right>{t('clinical.rep.services')}</Th><Th right className="hidden sm:table-cell">{t('clinical.rep.value')}</Th><Th right>{t('clinical.rep.share')}</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.doctor_id}>
            <Td><div className="font-semibold text-slate-900">{r.name}</div><div className="text-[0.8125rem] text-slate-600">{r.specialty}</div></Td>
            <Td right>{r.services}</Td>
            <Td right className="hidden sm:table-cell">{formatSom(r.value)}</Td>
            <Td right className="font-semibold text-slate-900">{formatSom(r.share)}</Td>
          </tr>
        ))}
        <tr className="bg-slate-50"><Td className="font-bold text-slate-900">{t('clinical.rep.total')}</Td><Td right className="font-bold">{sumInt(rows, 'services')}</Td><Td right className="hidden font-bold text-slate-900 sm:table-cell">{formatSom(sumTiyin(rows, 'value'))}</Td><Td right className="font-bold text-slate-900">{formatSom(sumTiyin(rows, 'share'))}</Td></tr>
      </tbody>
    </Table>
  );
}
