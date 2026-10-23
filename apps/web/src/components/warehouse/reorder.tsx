'use client';
// «Buyurtma taklifi» — the reorder suggestion: daily use, days left, lots that will expire unused, what to order.
// All numbers come from the server; the optional brief is the AI's wording of them (number-checked) or a template.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, PackageX, Printer, Sparkles } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { formatSom } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, EmptyState, ErrorState, LinkButton, LoadingRows, Select, Table, Td, Th, Toolbar, type Tone } from '@/components/ui';
import { CsvLink } from '@/components/finance-extra';
import { qty } from './common';

export const HORIZONS = [7, 14, 30, 60, 90] as const;
const STATUS: Record<string, { tone: Tone; icon: React.ReactNode }> = {
  out: { tone: 'red', icon: <PackageX className="h-3.5 w-3.5" /> },
  urgent: { tone: 'red', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  order: { tone: 'yellow', icon: <Clock className="h-3.5 w-3.5" /> },
  ok: { tone: 'green', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  idle: { tone: 'gray', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
};
export function ReorderStatus({ status }: { status: string }) {
  const t = useT();
  const s = STATUS[status] ?? STATUS.idle;
  return <Badge tone={s.tone} icon={s.icon}>{t(`wh.ro.status.${status}` as MessageKey)}</Badge>;
}

type Brief = { mode: 'live' | 'sample' | 'off'; source: 'model' | 'template'; bullets: { text: string }[]; reason: string | null };

export function ReorderTab() {
  const t = useT();
  const { branchId } = useSession();
  const [horizon, setHorizon] = useState(30);
  const [only, setOnly] = useState(true);
  const q = useQuery({ queryKey: ['warehouse', 'reorder', branchId, horizon], queryFn: () => api(`/warehouse/reorder${qs({ branch_id: branchId || undefined, horizon })}`).then((r) => r.data) });
  const brief = useMutation({ mutationFn: () => api('/warehouse/reorder/brief', { method: 'POST', body: { branch_id: branchId || null, horizon } }).then((r) => r.data as Brief) });
  const rows: any[] = (q.data?.rows ?? []).filter((r: any) => !only || Number(r.suggested) > 0);
  const total = rows.reduce((s, r) => s + Number(r.est_cost), 0); // integer tiyin from the server
  const params = { branch_id: branchId || undefined, horizon };
  return (
    <>
      <Toolbar>
        <Select aria-label={t('wh.ro.horizon')} className="sm:w-60" value={horizon} onChange={(e) => { setHorizon(Number(e.target.value)); brief.reset(); }}>
          {HORIZONS.map((h) => <option key={h} value={h}>{t('wh.ro.horizon')}: {t('wh.ro.horizonDays', { n: h })}</option>)}
        </Select>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[0.9375rem] font-medium text-slate-900"><input type="checkbox" className="h-5 w-5 accent-brand-600" checked={only} onChange={(e) => setOnly(e.target.checked)} />{t('wh.ro.onlyOrder')}</label>
        {/* the actions wrap with the filters (a shrink-0 action group would push the page sideways at 390 px) */}
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <Button icon={<Sparkles className="h-4 w-4 text-brand-600" />} loading={brief.isPending} onClick={() => brief.mutate()}>{t('wh.ro.brief')}</Button>
          <CsvLink href={`/api/v1/warehouse/reorder.csv${qs(params)}`} />
          <LinkButton href={`/print/warehouse/reorder/${branchId || 'all'}${qs({ horizon })}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('common.print')}</LinkButton>
        </div>
      </Toolbar>
      {(brief.data || brief.isError) && (
        <div className="px-3 pb-3">
          {brief.isError ? <Alert tone="red">{(brief.error as Error).message}</Alert> : (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <ul className="list-disc space-y-1 pl-5 text-[0.9375rem] text-slate-900">{brief.data!.bullets.map((b, i) => <li key={i}>{b.text}</li>)}</ul>
              <p className="mt-1.5 text-[0.8125rem] text-slate-600">{t(brief.data!.source === 'model' ? 'wh.ro.briefModel' : brief.data!.mode === 'sample' ? 'wh.ro.briefSample' : 'wh.ro.briefTemplate')}{brief.data!.reason ? ` · ${brief.data!.reason}` : ''}</p>
            </div>
          )}
        </div>
      )}
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !rows.length ? <EmptyState compact icon={<CheckCircle2 />} title={t('wh.ro.none')} /> : (
        <Table>
          <thead><tr>
            <Th>{t('wh.ro.col.item')}</Th><Th right className="hidden md:table-cell">{t('wh.ro.col.usable')}</Th><Th right className="hidden lg:table-cell">{t('wh.ro.col.rate')}</Th>
            <Th right className="hidden sm:table-cell">{t('wh.ro.col.daysLeft')}</Th><Th right className="hidden md:table-cell">{t('wh.ro.col.expiring')}</Th><Th right>{t('wh.ro.col.suggested')}</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item_id}>
                <Td className="min-w-[8rem] sm:min-w-[10rem]"><div className="font-semibold text-slate-900">{r.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-slate-600"><ReorderStatus status={r.status} />{!branchId && <span>{r.branch_name}</span>}{r.days_left !== null && <span className={r.days_left < 14 ? 'font-bold text-red-700 sm:hidden' : 'sm:hidden'}>{t('wh.ro.horizonDays', { n: r.days_left })}</span>}</div></Td>
                <Td right className="hidden whitespace-nowrap md:table-cell">{qty(r.usable)} <span className="text-[0.8125rem] text-slate-600">{r.unit}</span></Td>
                <Td right className="hidden whitespace-nowrap lg:table-cell">{r.rate_basis ? <>{qty(r.daily_rate)}<div className="text-[0.8125rem] text-slate-600">{t('wh.ro.col.rateBasis', { n: r.rate_basis })}</div></> : <span className="text-slate-600">{t('wh.ro.noRate')}</span>}</Td>
                <Td right className="hidden whitespace-nowrap sm:table-cell">{r.days_left === null ? '—' : <span className={r.days_left < 14 ? 'font-bold text-red-700' : ''}>{t('wh.ro.horizonDays', { n: r.days_left })}</span>}</Td>
                <Td right className="hidden whitespace-nowrap md:table-cell">{Number(r.expiring_unusable) > 0 ? <span className="font-semibold text-red-700">{qty(r.expiring_unusable)} {r.unit}</span> : '—'}</Td>
                <Td right className="whitespace-nowrap">{Number(r.suggested) > 0 ? <><b>{qty(r.suggested)}</b> <span className="text-[0.8125rem] text-slate-600">{r.unit}</span>{r.packs ? <div className="text-[0.8125rem] text-slate-600">{t('wh.ro.packs', { n: r.packs })}</div> : null}</> : '—'}</Td>
              </tr>
            ))}
            {total > 0 && <tr className="font-bold"><Td>{t('wh.ro.total')}</Td><Td className="hidden md:table-cell" /><Td className="hidden lg:table-cell" /><Td className="hidden sm:table-cell" /><Td className="hidden md:table-cell" /><Td right className="whitespace-nowrap">{formatSom(total)}</Td></tr>}
          </tbody>
        </Table>
      )}
    </>
  );
}
