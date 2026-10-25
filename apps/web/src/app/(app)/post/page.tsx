'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, Contact, KeyRound, NotebookPen, Printer, ShieldAlert } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { addDays, fmtDateTime, fmtTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Button, Card, EmptyState, ErrorState, Field, LinkButton, LoadingRows, Modal, ModalCancel, PageHeader, Skeleton, Textarea, TextLink, useToast } from '@/components/ui';
import { fmtWhen, NameHint, useGuardedMutation, useWriteBranch } from '@/components/guard/common';
import { ShiftList, type ShiftRow } from '@/components/guard/shifts';

type OpenItems = {
  at: string; alerts_open: number; incidents_open: number;
  incidents: { id: string; number: number; category: string; severity: string; reported_at: string }[];
  keys_out: { room_id: string; room_name: string; holder_name: string; at: string; overdue: boolean }[];
  visitors_inside_count: number;
  visitors_inside: { id: string; full_name?: string | null; organisation?: string | null; purpose: string; in_at: string }[];
};
type Previous = { id: string; number: number; guard_name: string; closed_at: string; handover_note: string | null; forced: boolean; force_reason: string | null; closed_by_name: string | null };
type Current = { shift: { id: string; number: number; branch_name: string; opened_at: string; stale: boolean } | null; previous: Previous | null; open_items: OpenItems; stale_hours: number };

/** Smena: open the post, see the previous guard's note and what is still open, close with a handover note, print. */
export default function PostPage() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { me, branchId, demoNow } = useSession();
  const writeBranch = useWriteBranch();
  const q = useQuery({ queryKey: ['security', 'shift', branchId], queryFn: () => api<{ data: Current }>(`/security/shifts/current${qs({ branch_id: branchId })}`).then((r) => r.data), refetchInterval: 60_000 });
  const history = useQuery({ queryKey: ['security', 'shifts', branchId], queryFn: () => api<{ data: ShiftRow[] }>(`/security/shifts${qs({ branch_id: branchId, from: addDays(me.today, -6), to: me.today, page_size: 10 })}`).then((r) => r.data) });
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const open = useGuardedMutation({
    mutationFn: () => api<{ data: { number: number } }>('/security/shifts', { method: 'POST', body: { branch_id: writeBranch || null } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t('guard.shift.opened', { n: r.data.number })); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['security'] }); },
  });
  const close = useGuardedMutation({
    mutationFn: () => api(`/security/shifts/${q.data!.shift!.id}/close`, { method: 'POST', body: { handover_note: note.trim() } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t('guard.shift.closed')); setClosing(false); setNote(''); },
    onError: (e) => {
      setErr(e instanceof ApiError ? e.fields?.handover_note : undefined); toast.error(e);
      // the manager closed it meanwhile (or another tab did): refresh, keep the typed note
      if (e instanceof ApiError && e.status === 409) { qc.invalidateQueries({ queryKey: ['security'] }); setClosing(false); }
    },
  });
  const s = q.data?.shift;
  const prev = q.data?.previous;
  return (
    <>
      <PageHeader title={t('guard.shift.title')} subtitle={t('guard.shift.subtitle')}
        actions={q.data && (s
          ? <Button variant="primary" icon={<ClipboardCheck className="h-5 w-5" />} onClick={() => setClosing(true)} data-testid="shift-close">{t('guard.shift.close')}</Button>
          : <Button variant="primary" icon={<ClipboardCheck className="h-5 w-5" />} loading={open.isPending} disabled={!writeBranch} onClick={() => open.run()}>{t('guard.shift.open')}</Button>)} />
      {s?.stale && <div className="mb-5" data-testid="shift-stale"><Alert tone="red">{t('guard.shift.stale', { n: q.data!.stale_hours })}</Alert></div>}
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !q.data ? <Skeleton className="h-48" /> : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <Card title={s ? t('guard.shift.current', { n: s.number }) : t('guard.shift.none')}
              actions={s && <LinkButton href={`/print/guard-shift/${s.id}`} target="_blank" size="sm" icon={<Printer className="h-4 w-4" />}>{t('guard.shift.report')}</LinkButton>}>
              {s ? <p className="text-body text-slate-800">{t('guard.shift.since', { time: fmtWhen(s.opened_at, demoNow().toISOString()), branch: s.branch_name })}</p>
                : !writeBranch ? <Alert tone="yellow">{t('guard.branchPick')}</Alert> : <p className="text-body text-slate-700">{t('guard.panel.noShift')}</p>}
            </Card>
            <Card title={t('guard.shift.previous')}>
              {prev ? (
                <>
                  <p className="text-small text-slate-600">{t('guard.shift.previousBy', { name: prev.guard_name, at: fmtDateTime(prev.closed_at) })}</p>
                  {prev.forced
                    ? <p className="mt-2 rounded-field bg-violet-50 p-3 text-body text-violet-950" data-testid="handover-note">{t('guard.shift.previousForced', { name: prev.closed_by_name ?? '—', at: fmtDateTime(prev.closed_at), reason: prev.force_reason ?? '' })}</p>
                    : <p className="mt-2 whitespace-pre-wrap rounded-field bg-amber-50 p-3 text-body text-slate-900" data-testid="handover-note">{prev.handover_note}</p>}
                </>
              ) : <p className="text-body text-slate-600">{t('guard.shift.noPrevious')}</p>}
            </Card>
          </div>
          <Card padded={false} title={t('guard.shift.openItems')}><OpenItemsList items={q.data.open_items} /></Card>
        </div>
      )}
      <Card padded={false} title={t('guard.shift.history')} className="mt-5">
        {history.isError ? <ErrorState error={history.error} onRetry={() => history.refetch()} /> : !history.data ? <LoadingRows rows={3} /> : !history.data.length ? <EmptyState compact title={t('guard.shift.historyEmpty')} /> : (
          <ShiftList rows={history.data} />
        )}
      </Card>
      <Modal open={closing} onClose={() => setClosing(false)} dirty={!!note} width="max-w-xl" title={t('guard.shift.closeTitle')}
        footer={<><ModalCancel /><Button variant="primary" loading={close.isPending} onClick={() => { if (note.trim().length < 3) { setErr(t('api.v.min', { label: t('api.noun.handover'), min: 3 })); return; } close.run(); }}>{t('guard.shift.close')}</Button></>}>
        <div className="space-y-4">
          {q.data && <div className="rounded-field border border-slate-200"><OpenItemsList items={q.data.open_items} compact /></div>}
          <div>
            <Field label={t('guard.shift.handover')} required error={err} hint={t('guard.shift.handoverHint')}>{(id) => (
              <Textarea id={id} rows={4} maxLength={2000} value={note} invalid={!!err} onChange={(e) => setNote(e.target.value)} data-autofocus />
            )}</Field>
            <NameHint text={note} />
          </div>
        </div>
      </Modal>
    </>
  );
}

/** A visitor in the checklist: the name and organisation when known (the live screen), else the purpose and the time. */
const visitorLabel = (v: OpenItems['visitors_inside'][number], t: ReturnType<typeof useT>) =>
  [v.full_name, v.organisation].filter(Boolean).join(', ') || `${t(`guard.purpose.${v.purpose}` as MessageKey)} ${fmtTime(v.in_at)}`;

/** The handover checklist: open alerts, open incidents, keys out, visitors inside. */
function OpenItemsList({ items, compact }: { items: OpenItems; compact?: boolean }) {
  const t = useT();
  const clear = !items.alerts_open && !items.incidents_open && !items.keys_out.length && !items.visitors_inside_count;
  if (clear) return <EmptyState compact icon={<CheckCircle2 />} title={t('guard.shift.allClear')} />;
  const row = 'flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3';
  return (
    <ul className="divide-y divide-slate-100">
      {items.alerts_open > 0 && <li className={row}><ShieldAlert className="h-5 w-5 text-red-600" aria-hidden="true" /><span className="flex-1 font-semibold text-slate-900">{t('guard.shift.alertsOpen', { n: items.alerts_open })}</span>{!compact && <TextLink href="/guard">{t('nav.guard')}</TextLink>}</li>}
      {items.incidents_open > 0 && (
        <li className={row}>
          <NotebookPen className="h-5 w-5 text-amber-700" aria-hidden="true" />
          <span className="flex-1 font-semibold text-slate-900">{t('guard.shift.incidentsOpen', { n: items.incidents_open })}</span>
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
      {items.visitors_inside_count > 0 && (
        <li className={row}>
          <Contact className="h-5 w-5 text-amber-700" aria-hidden="true" />
          <span className="flex-1 font-semibold text-slate-900">{t('guard.shift.visitorsInside', { n: items.visitors_inside_count })}</span>
          {!compact && <TextLink href="/visitors">{t('nav.visitors')}</TextLink>}
          <div className="basis-full text-small text-slate-600">{items.visitors_inside.map((v) => visitorLabel(v, t)).join(' · ')}</div>
        </li>
      )}
    </ul>
  );
}
