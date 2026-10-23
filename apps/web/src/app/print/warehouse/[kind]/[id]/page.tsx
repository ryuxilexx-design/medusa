'use client';
import { use } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, formatSom } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { PrintDoc, PrintState } from '@/components/print-doc';
import { useMeQuery } from '@/lib/session';
import { JournalTable } from '@/components/warehouse/ledger';
import { PurposeText, qty } from '@/components/warehouse/common';

const URL: Record<string, (id: string, q: string) => string> = {
  receipt: (id) => `/warehouse/receipts/${id}`,
  request: (id) => `/warehouse/requests/${id}`,
  writeoff: (id) => `/warehouse/writeoffs/${id}`,
  count: (id) => `/warehouse/counts/${id}`,
  controlled: (id, q) => `/warehouse/controlled/${id}${q}`,
  reorder: (id, q) => `/warehouse/reorder${q}${q ? '&' : '?'}only=order${id === 'all' ? '' : `&branch_id=${id}`}`,
};
const cell = 'border border-slate-400 px-1.5 py-1 align-top';

/** Printable warehouse documents: receipt act, request/issue slip, write-off act, count sheet, controlled-substance register. */
export default function PrintWarehouse({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = use(params);
  const sp = useSearchParams();
  const t = useT();
  const me = useMeQuery();
  const q = useQuery({ queryKey: ['print', 'warehouse', kind, id, sp.toString()], enabled: !!URL[kind],
    queryFn: () => api(URL[kind](id, qs(kind === 'reorder' ? { horizon: sp.get('horizon') ?? undefined } : { from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined }))).then((r) => r.data) });
  if (!URL[kind]) return null;
  if (!q.data) return <PrintState q={q} />;
  const d = q.data;
  const Sign = ({ label, name }: { label: string; name?: string }) => <div className="min-w-[14rem]">{label} <b>{name ?? ''}</b><div className="mt-6 border-t border-slate-400 pt-0.5 text-[0.6875rem] text-slate-600">{t('print.signature')}</div></div>;
  const footer = (signs: { label: string; name?: string }[]) => <div className="flex flex-wrap gap-x-10 gap-y-6 border-t border-slate-300 pt-3 text-xs">{signs.map((s, i) => <Sign key={i} {...s} />)}</div>;
  if (kind === 'reorder') {
    const total = d.rows.reduce((s: number, r: any) => s + Number(r.est_cost), 0);
    return (
      <PrintDoc title={t('wh.ro.print')} number="" date={me.data?.now ?? d.today} branch={id === 'all' ? '' : d.rows[0]?.branch_name ?? ''} patient={null} responsible={me.data?.name ?? ''} status="" draft
        info={[[t('wh.ro.printHorizon'), t('wh.ro.horizonDays', { n: d.horizon })], [t('admin.inv.colState'), t('wh.ro.printDraft')], [t('wh.ro.total'), formatSom(total)]]}
        footer={footer([{ label: t('wh.print.keeperSign'), name: me.data?.name }, { label: t('wh.print.approvedHead') }])}>
        <table className="w-full border-collapse text-[0.75rem]">
          <thead><tr><th className={cell}>№</th><th className={`${cell} text-left`}>{t('wh.col.item')}</th><th className={`${cell} text-right`}>{t('wh.ro.col.usable')}</th><th className={`${cell} text-right`}>{t('wh.ro.col.rate')}</th><th className={`${cell} text-right`}>{t('wh.ro.col.daysLeft')}</th><th className={`${cell} text-right`}>{t('wh.ro.col.suggested')}</th><th className={`${cell} text-right`}>{t('wh.col.unitCost')}</th><th className={`${cell} text-right`}>{t('wh.col.sum')}</th></tr></thead>
          <tbody>{d.rows.map((r: any, i: number) => <tr key={r.item_id}><td className={cell}>{i + 1}</td><td className={cell}>{r.name}{id === 'all' ? ` (${r.branch_name})` : ''}</td><td className={`${cell} text-right`}>{qty(r.usable)} {r.unit}</td><td className={`${cell} text-right`}>{qty(r.daily_rate)}</td><td className={`${cell} text-right`}>{r.days_left ?? '—'}</td>
            <td className={`${cell} text-right`}><b>{qty(r.suggested)}</b> {r.unit}{r.packs ? ` (${t('wh.ro.packs', { n: r.packs })})` : ''}</td><td className={`${cell} text-right`}>{formatSom(r.purchase_price)}</td><td className={`${cell} text-right`}>{formatSom(r.est_cost)}</td></tr>)}</tbody>
        </table>
      </PrintDoc>
    );
  }
  if (kind === 'receipt') return (
    <PrintDoc title={t('wh.print.receipt')} number={`K-${d.number}`} date={d.received_at} branch={d.branch_name} patient={null} responsible={d.received_by_name} status=""
      info={[[t('wh.rc.supplier'), d.supplier], [t('wh.rc.invoice'), `${d.invoice_no}, ${fmtDate(d.invoice_date)}`], [t('wh.print.receivedBy'), d.received_by_name], [t('wh.col.sum'), formatSom(d.total)]]}
      footer={footer([{ label: t('wh.print.handedOver') }, { label: t('wh.print.receivedBy'), name: d.received_by_name }])}>
      <table className="w-full border-collapse text-[0.75rem]">
        <thead><tr><th className={cell}>№</th><th className={`${cell} text-left`}>{t('wh.col.item')}</th><th className={cell}>{t('wh.col.batch')}</th><th className={cell}>{t('wh.col.expiry')}</th><th className={`${cell} text-right`}>{t('wh.col.qty')}</th><th className={`${cell} text-right`}>{t('wh.col.unitCost')}</th><th className={`${cell} text-right`}>{t('wh.col.sum')}</th></tr></thead>
        <tbody>{d.lines.map((l: any, i: number) => <tr key={l.id}><td className={cell}>{i + 1}</td><td className={cell}>{l.name}</td><td className={cell}>{l.batch_no}</td><td className={cell}>{fmtDate(l.expiry_date)}</td><td className={`${cell} text-right`}>{qty(l.qty)} {l.unit}</td><td className={`${cell} text-right`}>{formatSom(l.unit_cost)}</td><td className={`${cell} text-right`}>{formatSom(l.sum)}</td></tr>)}</tbody>
      </table>
    </PrintDoc>
  );
  if (kind === 'request') return (
    <PrintDoc title={t('wh.print.request')} number={`T-${d.number}`} date={d.created_at} branch={d.branch_name} patient={null} responsible={d.closed_by_name ?? ''} status=""
      info={[[t('wh.col.requester'), d.requester_name], [t('wh.req.department'), d.department], [t('wh.col.purpose'), <PurposeText key="p" r={d} />], [t('admin.inv.colState'), t(`wh.status.${d.status}` as MessageKey)],
        ...(d.approved_by_name ? [[t('wh.req.approvedBy'), `${d.approved_by_name}, ${fmtDateTime(d.approved_at)}`] as [string, string]] : [])]}
      footer={footer([{ label: t('wh.print.issuedBy'), name: d.movements[0]?.actor_name }, { label: t('wh.print.takenBy'), name: d.requester_name }, ...(d.approved_by_name ? [{ label: t('wh.req.approvedBy'), name: d.approved_by_name }] : [])])}>
      <table className="w-full border-collapse text-[0.75rem]">
        <thead><tr><th className={cell}>№</th><th className={`${cell} text-left`}>{t('wh.col.item')}</th><th className={`${cell} text-right`}>{t('wh.col.asked')}</th><th className={`${cell} text-right`}>{t('wh.col.issued')}</th><th className={`${cell} text-left`}>{t('wh.req.issuedFrom')}</th></tr></thead>
        <tbody>{d.lines.map((l: any, i: number) => (
          <tr key={l.id}><td className={cell}>{i + 1}</td><td className={cell}>{l.name}</td><td className={`${cell} text-right`}>{qty(l.qty)} {l.unit}</td><td className={`${cell} text-right`}>{qty(l.issued_qty)}</td>
            <td className={cell}>{d.movements.filter((m: any) => m.item_id === l.item_id && m.kind === 'issue').map((m: any) => `${m.batch_no ?? '—'}${m.expiry_date ? ` (${fmtDate(m.expiry_date)})` : ''} × ${qty(m.quantity)}`).join('; ')}</td></tr>
        ))}</tbody>
      </table>
    </PrintDoc>
  );
  if (kind === 'writeoff') return (
    <PrintDoc title={t('wh.print.writeoff')} number={`A-${d.number}`} date={d.created_at} branch={d.branch_name} patient={null} responsible={d.created_by_name} status="" draft={d.status === 'pending'}
      info={[[t('admin.inv.reason'), `${t(`wh.wo.reason.${d.reason}` as MessageKey)} — ${d.note}`], [t('admin.inv.colState'), t(`wh.status.${d.status}` as MessageKey)], [t('wh.col.sum'), formatSom(d.total)],
        [t('wh.wo.decided'), d.decided_by_name ? `${d.decided_by_name}, ${fmtDateTime(d.decided_at)}` : '—']]}
      footer={footer([...d.commission.map((name: string) => ({ label: t('wh.print.member'), name })), { label: t('wh.print.approvedHead'), name: d.decided_by_name ?? '' }])}>
      <table className="w-full border-collapse text-[0.75rem]">
        <thead><tr><th className={cell}>№</th><th className={`${cell} text-left`}>{t('wh.col.item')}</th><th className={cell}>{t('wh.col.batch')}</th><th className={cell}>{t('wh.col.expiry')}</th><th className={`${cell} text-right`}>{t('wh.col.qty')}</th><th className={`${cell} text-right`}>{t('wh.col.sum')}</th></tr></thead>
        <tbody>{d.lines.map((l: any, i: number) => <tr key={l.id}><td className={cell}>{i + 1}</td><td className={cell}>{l.name}</td><td className={cell}>{l.batch_no ?? '—'}</td><td className={cell}>{fmtDate(l.expiry_date)}</td><td className={`${cell} text-right`}>{qty(l.qty)} {l.unit}</td><td className={`${cell} text-right`}>{formatSom(l.sum)}</td></tr>)}</tbody>
      </table>
    </PrintDoc>
  );
  if (kind === 'count') return (
    <PrintDoc title={t('wh.print.count')} number={`I-${d.number}`} date={d.started_at} branch={d.branch_name} patient={null} responsible={d.started_by_name} status="" draft={d.status !== 'approved'}
      info={[[t('wh.cnt.scope'), t(`wh.cnt.scope.${d.scope}` as MessageKey)], [t('admin.inv.colState'), t(`wh.status.${d.status}` as MessageKey)], [t('wh.print.startedBy'), d.started_by_name], [t('wh.wo.decided'), d.decided_by_name ?? '—']]}
      footer={footer([...(d.commission.length ? d.commission : [d.started_by_name]).map((name: string) => ({ label: t('wh.print.member'), name })), { label: t('wh.print.approvedHead'), name: d.decided_by_name ?? '' }])}>
      <table className="w-full border-collapse text-[0.75rem]">
        <thead><tr><th className={cell}>№</th><th className={`${cell} text-left`}>{t('wh.col.item')}</th><th className={cell}>{t('wh.col.batch')}</th><th className={`${cell} text-right`}>{t('wh.cnt.expected')}</th><th className={`${cell} text-right`}>{t('wh.cnt.counted')}</th><th className={`${cell} text-right`}>{t('wh.cnt.diff')}</th><th className={`${cell} text-left`}>{t('admin.inv.reason')}</th></tr></thead>
        <tbody>{d.lines.map((l: any, i: number) => <tr key={l.id}><td className={cell}>{i + 1}</td><td className={cell}>{l.name}</td><td className={cell}>{l.batch_no ?? '—'}</td><td className={`${cell} text-right`}>{qty(l.expected_qty)} {l.unit}</td>
          <td className={`${cell} text-right`}>{l.counted_qty == null ? '' : qty(l.counted_qty)}</td><td className={`${cell} text-right`}>{l.counted_qty == null ? '' : qty(Number(l.counted_qty) - Number(l.expected_qty))}</td><td className={cell}>{l.reason ?? ''}</td></tr>)}</tbody>
      </table>
    </PrintDoc>
  );
  return (
    <PrintDoc title={t('wh.print.controlled')} number={`${fmtDate(d.from)}–${fmtDate(d.to)}`} date={me.data?.now ?? d.to} branch={d.item.branch_name} patient={null} responsible="" status=""
      info={[[t('wh.col.item'), `${d.item.name}, ${d.item.unit}`], [t('wh.print.period'), `${fmtDate(d.from)} — ${fmtDate(d.to)}`], [t('wh.ctl.balance'), qty(d.item.qty)], [t('wh.print.opening'), qty(d.item.opening_qty)]]}
      footer={footer([{ label: t('wh.print.keeperSign') }, { label: t('wh.print.approvedHead') }])}>
      <JournalTable entries={d.entries} print />
    </PrintDoc>
  );
}
