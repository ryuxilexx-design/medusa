'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ALERT_OUTCOMES, type MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { duration, fmtDateTime, fmtTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { PrintDoc } from '@/components/print-doc';
import { ErrorState } from '@/components/ui';

type Report = {
  id: string; number: number; branch_name: string; guard_name: string; opened_at: string; closed_at: string | null; handover_note: string | null;
  alerts: { id: string; kind: string; occurred_at: string; camera_name: string; outcome: string | null; actor_name: string | null; state: string; response_sec: number | null }[];
  incidents: { id: string; number: number; category: string; severity: string; source: string; description: string; reported_at: string; reported_by_name: string; room_name: string | null; place: string | null }[];
  visitors: { full_name: string | null; organisation: string | null; purpose: string; host_name: string | null; pass_no: string | null; in_at: string; out_at: string | null }[];
  keys: { action: 'out' | 'in'; room_name: string; holder_name: string; by_name: string; at: string }[];
  rounds: { started_at: string; finished_at: string | null; checkpoints_total: number; guard_name: string; marked: number; problems: number }[];
  open_items: { alerts_open: number; incidents: { number: number; category: string }[]; keys_out: { room_name: string; holder_name: string }[]; visitors_inside: { full_name: string | null; organisation: string | null }[] };
};

/** A4 report of one guard post shift: alerts, incidents, visitors, keys, patrol rounds, what stayed open and the handover. */
export default function PrintGuardShift({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const q = useQuery({ queryKey: ['security', 'shift-report', id], queryFn: () => api<{ data: Report }>(`/security/shifts/${id}`).then((r) => r.data) });
  if (q.isLoading) return <div className="flex h-screen items-center justify-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (q.isError || !q.data) return <div className="surface mx-auto mt-20 max-w-md"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const s = q.data;
  const h2 = 'mt-5 border-b border-slate-400 pb-0.5 text-xs font-bold uppercase tracking-wide text-slate-700';
  const tbl = 'mt-1 w-full border-collapse text-[0.75rem]';
  const none = <p className="mt-1 text-slate-600">{t('guard.print.none')}</p>;
  const o = s.open_items;
  return (
    <PrintDoc title={t('guard.print.title')} number={String(s.number)} date={s.closed_at ?? s.opened_at} branch={s.branch_name} patient={null}
      responsible={s.guard_name} status={s.closed_at ? 'closed' : 'open'} legal={false}
      info={[[t('guard.print.guard'), s.guard_name], [t('guard.print.opened'), fmtDateTime(s.opened_at)], [t('guard.print.closed'), s.closed_at ? fmtDateTime(s.closed_at) : t('guard.print.stillOpen')], [t('guard.csv.branch'), s.branch_name]]}
      footer={<footer className="mt-10 grid grid-cols-2 gap-8 border-t border-slate-300 pt-3 text-xs text-slate-600"><div>{t('guard.print.signGuard')}</div><div>{t('guard.print.signNext')}</div><p className="col-span-2">{t('guard.print.notes')}</p></footer>}>
      <h2 className={h2}>{t('guard.print.handover')}</h2>
      {s.handover_note ? <p className="mt-1 whitespace-pre-wrap">{s.handover_note}</p> : none}

      <h2 className={h2}>{t('guard.print.openItems')}</h2>
      {!o.alerts_open && !o.incidents.length && !o.keys_out.length && !o.visitors_inside.length ? none : (
        <ul className="mt-1 list-disc pl-5">
          {o.alerts_open > 0 && <li>{t('guard.shift.alertsOpen', { n: o.alerts_open })}</li>}
          {o.incidents.length > 0 && <li>{t('guard.shift.incidentsOpen', { n: o.incidents.length })}: {o.incidents.map((i) => `№${i.number} ${t(`guard.cat.${i.category}` as MessageKey)}`).join(', ')}</li>}
          {o.keys_out.length > 0 && <li>{t('guard.shift.keysOut', { n: o.keys_out.length })}: {o.keys_out.map((k) => `${k.room_name} — ${k.holder_name}`).join(', ')}</li>}
          {o.visitors_inside.length > 0 && <li>{t('guard.shift.visitorsInside', { n: o.visitors_inside.length })}: {o.visitors_inside.map((v) => [v.full_name, v.organisation].filter(Boolean).join(', ')).join('; ')}</li>}
        </ul>
      )}

      <h2 className={h2}>{t('guard.print.alerts', { n: s.alerts.length })}</h2>
      {!s.alerts.length ? none : (
        <table className={tbl}><thead><tr className="text-left"><th className="py-0.5">{t('guard.col.time')}</th><th>{t('guard.col.event')}</th><th>{t('guard.col.camera')}</th><th>{t('guard.csv.outcome')}</th><th>{t('guard.csv.handledBy')}</th><th className="text-right">{t('guard.print.response')}</th></tr></thead>
          <tbody>{s.alerts.map((a) => <tr key={a.id} className="border-t border-slate-200"><td className="py-0.5 tabular-nums">{fmtTime(a.occurred_at)}</td><td>{t(`cam.kind.${a.kind}` as MessageKey)}</td><td>{a.camera_name}</td>
            <td>{a.outcome && (ALERT_OUTCOMES as readonly string[]).includes(a.outcome) ? t(`guard.outcome.short.${a.outcome}` as MessageKey) : t(`guard.state.${a.state}` as MessageKey)}</td><td>{a.actor_name ?? '—'}</td>
            <td className="text-right tabular-nums">{a.response_sec == null ? '—' : duration(a.response_sec)}</td></tr>)}</tbody></table>
      )}

      <h2 className={h2}>{t('guard.print.incidents', { n: s.incidents.length })}</h2>
      {!s.incidents.length ? none : (
        <table className={tbl}><tbody>{s.incidents.map((i) => <tr key={i.id} className="border-t border-slate-200 align-top"><td className="py-0.5 pr-2 tabular-nums">№{i.number} {fmtTime(i.reported_at)}</td>
          <td className="pr-2">{t(`guard.cat.${i.category}` as MessageKey)}, {t(`guard.sev.${i.severity}` as MessageKey)}{(i.room_name || i.place) && <> · {[i.room_name, i.place].filter(Boolean).join(', ')}</>}</td><td>{i.description}</td></tr>)}</tbody></table>
      )}

      <h2 className={h2}>{t('guard.print.visitors', { n: s.visitors.length })}</h2>
      {!s.visitors.length ? none : (
        <table className={tbl}><thead><tr className="text-left"><th className="py-0.5">{t('guard.csv.in')}</th><th>{t('guard.csv.out')}</th><th>{t('guard.csv.visitor')}</th><th>{t('guard.csv.purpose')}</th><th>{t('guard.csv.host')}</th><th>{t('guard.csv.pass')}</th></tr></thead>
          <tbody>{s.visitors.map((v, k) => <tr key={k} className="border-t border-slate-200"><td className="py-0.5 tabular-nums">{fmtTime(v.in_at)}</td><td className="tabular-nums">{v.out_at ? fmtTime(v.out_at) : '—'}</td>
            <td>{[v.full_name ?? t('guard.vis.purged'), v.organisation].filter(Boolean).join(', ')}</td><td>{t(`guard.purpose.${v.purpose}` as MessageKey)}</td><td>{v.host_name ?? '—'}</td><td>{v.pass_no ?? '—'}</td></tr>)}</tbody></table>
      )}

      <h2 className={h2}>{t('guard.print.keys', { n: s.keys.length })}</h2>
      {!s.keys.length ? none : (
        <table className={tbl}><tbody>{s.keys.map((k, n) => <tr key={n} className="border-t border-slate-200"><td className="py-0.5 tabular-nums">{fmtTime(k.at)}</td><td>{k.room_name}</td><td>{t(`guard.keys.action.${k.action}` as MessageKey)}</td><td>{k.holder_name}</td><td>{k.by_name}</td></tr>)}</tbody></table>
      )}

      <h2 className={h2}>{t('guard.print.rounds', { n: s.rounds.length })}</h2>
      {!s.rounds.length ? none : (
        <table className={tbl}><tbody>{s.rounds.map((r, n) => <tr key={n} className="border-t border-slate-200"><td className="py-0.5 tabular-nums">{fmtTime(r.started_at)}–{r.finished_at ? fmtTime(r.finished_at) : '…'}</td><td>{r.guard_name}</td>
          <td className="tabular-nums">{r.marked}/{r.checkpoints_total}</td><td>{r.problems ? t('guard.pat.problems', { n: r.problems }) : ''}</td></tr>)}</tbody></table>
      )}
    </PrintDoc>
  );
}
