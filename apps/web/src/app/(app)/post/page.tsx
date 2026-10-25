'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, Contact, KeyRound, NotebookPen, Printer, ShieldAlert } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { addDays, fmtDateTime, fmtTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, LinkButton, LoadingRows, Modal, ModalCancel, PageHeader, Skeleton, Table, Td, Textarea, TextLink, Th, useToast } from '@/components/ui';
import { useWriteBranch } from '@/components/guard/common';

type OpenItems = {
  alerts_open: number;
  incidents: { id: string; number: number; category: string; severity: string; reported_at: string }[];
  keys_out: { room_id: string; room_name: string; holder_name: string; at: string; overdue: boolean }[];
  visitors_inside: { id: string; full_name: string | null; organisation: string | null; purpose: string; in_at: string }[];
};
type Current = { shift: { id: string; number: number; branch_name: string; opened_at: string } | null; previous: { number: number; guard_name: string; closed_at: string; handover_note: string } | null; open_items: OpenItems };
type ShiftRow = { id: string; number: number; branch_name: string; guard_name: string; opened_at: string; closed_at: string | null; rounds: number };

/** Smena: open the post, see the previous guard's note and what is still open, close with a handover note, print. */
export default function PostPage() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { me, branchId } = useSession();
  const writeBranch = useWriteBranch();
  const q = useQuery({ queryKey: ['security', 'shift', branchId], queryFn: () => api<{ data: Current }>(`/security/shifts/current${qs({ branch_id: branchId })}`).then((r) => r.data), refetchInterval: 60_000 });
  const history = useQuery({ queryKey: ['security', 'shifts', branchId], queryFn: () => api<{ data: ShiftRow[] }>(`/security/shifts${qs({ branch_id: branchId, from: addDays(me.today, -6), to: me.today, page_size: 10 })}`).then((r) => r.data) });
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const open = useMutation({
    mutationFn: () => api<{ data: { number: number } }>('/security/shifts', { method: 'POST', body: { branch_id: writeBranch || null } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t('guard.shift.opened', { n: r.data.number })); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['security'] }); },
  });
  const close = useMutation({
    mutationFn: () => api(`/security/shifts/${q.data!.shift!.id}/close`, { method: 'POST', body: { handover_note: note.trim() } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t('guard.shift.closed')); setClosing(false); setNote(''); },
    onError: (e) => { setErr(e instanceof ApiError ? e.fields?.handover_note : undefined); toast.error(e); },
  });
  const s = q.data?.shift;
  return (
    <>
      <PageHeader title={t('guard.shift.title')} subtitle={t('guard.shift.subtitle')}
        actions={q.data && (s
          ? <Button variant="primary" icon={<ClipboardCheck className="h-5 w-5" />} onClick={() => setClosing(true)} data-testid="shift-close">{t('guard.shift.close')}</Button>
          : <Button variant="primary" icon={<ClipboardCheck className="h-5 w-5" />} loading={open.isPending} disabled={!writeBranch} onClick={() => open.mutate()}>{t('guard.shift.open')}</Button>)} />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !q.data ? <Skeleton className="h-48" /> : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <Card title={s ? t('guard.shift.current', { n: s.number }) : t('guard.shift.none')}
              actions={s && <LinkButton href={`/print/guard-shift/${s.id}`} target="_blank" size="sm" icon={<Printer className="h-4 w-4" />}>{t('guard.shift.report')}</LinkButton>}>
              {s ? <p className="text-body text-slate-800">{t('guard.shift.since', { time: fmtTime(s.opened_at), branch: s.branch_name })}</p>
                : !writeBranch ? <Alert tone="yellow">{t('guard.branchPick')}</Alert> : <p className="text-body text-slate-700">{t('guard.panel.noShift')}</p>}
            </Card>
            <Card title={t('guard.shift.previous')}>
              {q.data.previous ? (
                <>
                  <p className="text-small text-slate-600">{t('guard.shift.previousBy', { name: q.data.previous.guard_name, at: fmtDateTime(q.data.previous.closed_at) })}</p>
                  <p className="mt-2 whitespace-pre-wrap rounded-field bg-amber-50 p-3 text-body text-slate-900" data-testid="handover-note">{q.data.previous.handover_note}</p>
                </>
              ) : <p className="text-body text-slate-600">{t('guard.shift.noPrevious')}</p>}
            </Card>
          </div>
          <Card padded={false} title={t('guard.shift.openItems')}><OpenItemsList items={q.data.open_items} /></Card>
        </div>
      )}
      <Card padded={false} title={t('guard.shift.history')} className="mt-5">
        {history.isError ? <ErrorState error={history.error} onRetry={() => history.refetch()} /> : !history.data ? <LoadingRows rows={3} /> : !history.data.length ? <EmptyState compact title={t('guard.shift.historyEmpty')} /> : (
          <Table>
            <thead><tr><Th>{t('guard.col.number')}</Th><Th>{t('guard.sec.guard')}</Th><Th>{t('guard.col.opened')}</Th><Th>{t('guard.col.closed')}</Th><Th className="hidden sm:table-cell">{t('guard.col.round')}</Th><Th right><span className="sr-only">{t('guard.col.actions')}</span></Th></tr></thead>
            <tbody>{history.data.map((r) => (
              <tr key={r.id}>
                <Td className="tabular-nums">{r.number}</Td><Td>{r.guard_name}</Td>
                <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(r.opened_at)}</Td>
                <Td className="whitespace-nowrap tabular-nums">{r.closed_at ? fmtDateTime(r.closed_at) : <Badge tone="blue">{t('guard.shift.openNow')}</Badge>}</Td>
                <Td className="hidden sm:table-cell">{t('guard.shift.rounds', { n: r.rounds })}</Td>
                <Td right><TextLink href={`/print/guard-shift/${r.id}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('guard.shift.report')}</TextLink></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      <Modal open={closing} onClose={() => setClosing(false)} dirty={!!note} width="max-w-xl" title={t('guard.shift.closeTitle')}
        footer={<><ModalCancel /><Button variant="primary" loading={close.isPending} onClick={() => { if (note.trim().length < 3) { setErr(t('api.v.min', { label: t('api.noun.handover'), min: 3 })); return; } close.mutate(); }}>{t('guard.shift.close')}</Button></>}>
        <div className="space-y-4">
          {q.data && <div className="rounded-field border border-slate-200"><OpenItemsList items={q.data.open_items} compact /></div>}
          <Field label={t('guard.shift.handover')} required error={err} hint={t('guard.shift.handoverHint')}>{(id) => (
            <Textarea id={id} rows={4} maxLength={2000} value={note} invalid={!!err} onChange={(e) => setNote(e.target.value)} data-autofocus />
          )}</Field>
        </div>
      </Modal>
    </>
  );
}

/** The handover checklist: open alerts, open incidents, keys out, visitors inside. */
function OpenItemsList({ items, compact }: { items: OpenItems; compact?: boolean }) {
  const t = useT();
  const clear = !items.alerts_open && !items.incidents.length && !items.keys_out.length && !items.visitors_inside.length;
  if (clear) return <EmptyState compact icon={<CheckCircle2 />} title={t('guard.shift.allClear')} />;
  const row = 'flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3';
  return (
    <ul className="divide-y divide-slate-100">
      {items.alerts_open > 0 && <li className={row}><ShieldAlert className="h-5 w-5 text-red-600" aria-hidden="true" /><span className="flex-1 font-semibold text-slate-900">{t('guard.shift.alertsOpen', { n: items.alerts_open })}</span>{!compact && <TextLink href="/guard">{t('nav.guard')}</TextLink>}</li>}
      {items.incidents.length > 0 && (
        <li className={row}>
          <NotebookPen className="h-5 w-5 text-amber-700" aria-hidden="true" />
          <span className="flex-1 font-semibold text-slate-900">{t('guard.shift.incidentsOpen', { n: items.incidents.length })}</span>
          {!compact && <TextLink href="/incidents">{t('nav.incidents')}</TextLink>}
          <div className="basis-full text-small text-slate-600">{items.incidents.slice(0, 4).map((i) => `№${i.number} ${t(`guard.cat.${i.category}` as MessageKey)}`).join(' · ')}</div>
        </li>
      )}
      {items.keys_out.length > 0 && (
        <li className={row}>
          <KeyRound className="h-5 w-5 text-amber-700" aria-hidden="true" />
          <span className="flex-1 font-semibold text-slate-900">{t('guard.shift.keysOut', { n: items.keys_out.length })}</span>
          {!compact && <TextLink href="/keys">{t('nav.keys')}</TextLink>}
          <div className="basis-full text-small text-slate-600">{items.keys_out.map((k) => `${k.room_name} — ${k.holder_name}${k.overdue ? ` (${t('guard.keys.overdue')})` : ''}`).join(' · ')}</div>
        </li>
      )}
      {items.visitors_inside.length > 0 && (
        <li className={row}>
          <Contact className="h-5 w-5 text-amber-700" aria-hidden="true" />
          <span className="flex-1 font-semibold text-slate-900">{t('guard.shift.visitorsInside', { n: items.visitors_inside.length })}</span>
          {!compact && <TextLink href="/visitors">{t('nav.visitors')}</TextLink>}
          <div className="basis-full text-small text-slate-600">{items.visitors_inside.map((v) => [v.full_name, v.organisation].filter(Boolean).join(', ')).join(' · ')}</div>
        </li>
      )}
    </ul>
  );
}
