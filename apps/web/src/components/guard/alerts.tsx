'use client';
// Camera security alerts for the guard (and the manager): unhandled first, big state and colour, the camera's picture,
// «Ko‘ryapman» → «Yopish» with an outcome. Every step is a new row on the server; a stale screen gets 409 «refresh».
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Eye, ImageOff, ShieldAlert } from 'lucide-react';
import { ALERT_OUTCOMES, INCIDENT_CATEGORIES, type AlertOutcome, type IncidentCategory, type IncidentSeverity, type MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDateTime, fmtTime, duration, localDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Button, cx, EmptyState, ErrorState, Field, LoadingRows, Modal, ModalCancel, Pagination, Radio, Select, Textarea, TextLink, useToast } from '@/components/ui';
import { alertLevel, AlertStateBadge, ic, SeverityPicker, TimeAgo, useNow, type AlertState } from './common';

export type AlertRow = {
  id: string; kind: string; occurred_at: string; branch_name: string; camera_name: string; location: string | null; security_mode: 'always' | 'after_hours';
  has_snapshot: boolean; seq: number; last_action: 'take' | 'resolve' | null; outcome: AlertOutcome | null; note: string | null; actor_name: string | null;
  acted_at: string | null; incident_id: string | null; state: AlertState; response_sec: number | null; acked_at: string | null; acked_by_name: string | null;
};
type AlertsResp = { data: AlertRow[]; meta: { total: number; page: number; page_size: number; snapshot_days: number } };

const snapshotUrl = (id: string) => `/api/v1/security/alerts/${id}/snapshot`;

/** The list query: `open` = every unhandled alert, else a period (one day by default). */
export function useAlerts(p: { state?: 'open'; from?: string; to?: string; page?: number }) {
  const { branchId } = useSession();
  return useQuery({
    queryKey: ['security', 'alerts', branchId, p],
    queryFn: () => api<AlertsResp>(`/security/alerts${qs({ branch_id: branchId, state: p.state, from: p.from, to: p.to, page: p.page, page_size: 30 })}`),
    refetchInterval: 30_000, placeholderData: (prev) => prev,
  });
}

/** The camera's frame of the alert; a grey box with a crossed picture when there is none. */
function Thumb({ row, onOpen, big }: { row: AlertRow; onOpen: () => void; big?: boolean }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const size = big ? 'h-[4.5rem] w-32' : 'h-14 w-24 sm:h-[4.5rem] sm:w-32';
  if (!row.has_snapshot || failed) return <span className={cx('flex shrink-0 items-center justify-center rounded-field bg-slate-100 text-slate-400', size)} title={t('guard.alerts.noSnapshot')}><ImageOff className="h-5 w-5" aria-hidden="true" /><span className="sr-only">{t('guard.alerts.noSnapshot')}</span></span>;
  return (
    <button type="button" onClick={onOpen} data-no-press className={cx('block shrink-0 overflow-hidden rounded-field bg-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus', size)}
      aria-label={t('guard.alerts.snapshotAlt', { kind: t(`cam.kind.${row.kind}` as MessageKey), camera: row.camera_name, at: fmtDateTime(row.occurred_at) })}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={snapshotUrl(row.id)} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} />
    </button>
  );
}

function useAlertActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const refresh = () => { qc.invalidateQueries({ queryKey: ['security'] }); };
  const take = useMutation({
    mutationFn: (r: AlertRow) => api(`/security/alerts/${r.id}/take`, { method: 'POST', body: { seq: r.seq } }),
    onSuccess: () => { refresh(); toast.success(t('guard.alerts.taken')); },
    onError: (e) => { toast.error(e); if (e instanceof ApiError && e.status === 409) refresh(); },
  });
  return { take, refresh };
}

/** One alert: colour bar by urgency, picture, what/where/when, its handling and the next step. */
function AlertItem({ r, mode, now, onResolve, onView }: { r: AlertRow; mode: 'guard' | 'manager'; now: Date; onResolve: () => void; onView: () => void }) {
  const t = useT();
  const { me, branchId } = useSession();
  const { take } = useAlertActions();
  const open = r.state !== 'resolved';
  const level = alertLevel(r.kind);
  const today = localDate(r.occurred_at) === me.today;
  const canResolve = r.state === 'new' || r.state === 'taken' || (r.state === 'escalated' && mode === 'manager');
  const incidentHref = r.incident_id ? (mode === 'guard' ? `/incidents?open=${r.incident_id}` : `/security?tab=incidents&open=${r.incident_id}`) : null;
  return (
    <li data-alert={r.id} data-state={r.state} className={cx('flex flex-wrap items-start gap-x-4 gap-y-3 border-l-4 px-4 py-4 sm:flex-nowrap sm:px-5',
      !open ? 'border-l-transparent' : level === 'high' ? 'border-l-red-600 bg-red-50/40' : 'border-l-amber-500 bg-amber-50/40')}>
      <Thumb row={r} onOpen={onView} />
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-base font-bold text-slate-900">{t(`cam.kind.${r.kind}` as MessageKey)}</span>
          {open && <Badge tone={level === 'high' ? 'red' : 'yellow'} icon={<ShieldAlert className={ic} />}>{t(`guard.sev.alert.${level}` as MessageKey)}</Badge>}
          <AlertStateBadge state={r.state} />
        </div>
        <div className="mt-0.5 text-sm text-slate-700">{[r.camera_name, r.location, !branchId && me.branches.length > 1 ? r.branch_name : null].filter(Boolean).join(' · ')}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-small text-slate-600">
          <span className="font-semibold tabular-nums text-slate-800">{today ? fmtTime(r.occurred_at) : fmtDateTime(r.occurred_at)}</span>
          {open && <TimeAgo iso={r.occurred_at} now={now} />}
          {r.response_sec != null && <span>{t('guard.alerts.response', { time: duration(r.response_sec) })}</span>}
        </div>
        {(r.actor_name || r.acked_by_name) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-slate-700">
            {r.outcome && <Badge tone={r.outcome === 'incident' ? 'red' : r.outcome === 'escalated' ? 'violet' : 'green'}>{t(`guard.outcome.short.${r.outcome}` as MessageKey)}</Badge>}
            <span>{t('guard.alerts.by', { name: r.actor_name ?? r.acked_by_name ?? '—', at: fmtTime(r.acted_at ?? r.acked_at) })}</span>
            {r.note && <span className="text-slate-600">· {r.note}</span>}
            {incidentHref && <TextLink href={incidentHref}>{t('guard.inc.openIncident')}</TextLink>}
          </div>
        )}
      </div>
      <div className="flex w-full shrink-0 flex-wrap justify-end gap-2 sm:w-auto sm:flex-col sm:items-stretch">
        {r.state === 'new' && <Button icon={<Eye className="h-5 w-5" />} loading={take.isPending && take.variables?.id === r.id} onClick={() => take.mutate(r)} className="flex-1 sm:flex-none">{t('guard.alerts.take')}</Button>}
        {canResolve && <Button variant={r.state === 'new' ? 'secondary' : 'success'} icon={<Check className="h-5 w-5" />} onClick={onResolve} className="flex-1 sm:flex-none">{t('guard.alerts.resolve')}</Button>}
        {r.state === 'escalated' && mode === 'guard' && <span className="self-center text-small font-semibold text-violet-800">{t('guard.alerts.waitManager')}</span>}
      </div>
    </li>
  );
}

/** The feed: a list of alerts with the resolve dialog and the picture viewer. */
export function AlertFeed({ q, mode, emptyTitle, page, onPage }: {
  q: ReturnType<typeof useAlerts>; mode: 'guard' | 'manager'; emptyTitle: string; page?: number; onPage?: (p: number) => void;
}) {
  const now = useNow();
  const [resolving, setResolving] = useState<AlertRow | null>(null);
  const [viewing, setViewing] = useState<AlertRow | null>(null);
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={4} />;
  const rows = q.data.data;
  return (
    <>
      {!rows.length ? <EmptyState compact icon={<CheckCircle2 />} title={emptyTitle} /> : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => <AlertItem key={r.id} r={r} mode={mode} now={now} onResolve={() => setResolving(r)} onView={() => setViewing(r)} />)}
        </ul>
      )}
      {onPage && page && q.data.meta.total > q.data.meta.page_size && <Pagination page={page} pageSize={q.data.meta.page_size} total={q.data.meta.total} onPage={onPage} />}
      <ResolveModal row={resolving} mode={mode} onClose={() => setResolving(null)} />
      <SnapshotModal row={viewing} days={q.data.meta.snapshot_days} onClose={() => setViewing(null)} onResolve={(r) => { setViewing(null); setResolving(r); }} mode={mode} />
    </>
  );
}

function SnapshotModal({ row, days, onClose, onResolve, mode }: { row: AlertRow | null; days: number; onClose: () => void; onResolve: (r: AlertRow) => void; mode: 'guard' | 'manager' }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const { take } = useAlertActions();
  const canResolve = !!row && (row.state === 'new' || row.state === 'taken' || (row.state === 'escalated' && mode === 'manager'));
  return (
    <Modal open={!!row} onClose={() => { setFailed(false); onClose(); }} width="max-w-3xl" title={row ? `${t(`cam.kind.${row.kind}` as MessageKey)} — ${row.camera_name}` : ''}
      footer={row && (
        <>
          <ModalCancel>{t('common.close')}</ModalCancel>
          {row.state === 'new' && <Button icon={<Eye className="h-5 w-5" />} loading={take.isPending} onClick={() => take.mutate(row, { onSuccess: onClose })}>{t('guard.alerts.take')}</Button>}
          {canResolve && <Button variant="primary" icon={<Check className="h-5 w-5" />} onClick={() => onResolve(row)}>{t('guard.alerts.resolve')}</Button>}
        </>
      )}>
      {row && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-slate-700">
            <span className="font-semibold tabular-nums text-slate-900">{fmtDateTime(row.occurred_at)}</span>
            <span>{[row.location, row.branch_name].filter(Boolean).join(' · ')}</span>
            <AlertStateBadge state={row.state} />
          </div>
          {failed || !row.has_snapshot ? <EmptyState compact icon={<ImageOff />} title={t('guard.alerts.noSnapshot')} /> : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={snapshotUrl(row.id)} alt={t('guard.alerts.snapshotAlt', { kind: t(`cam.kind.${row.kind}` as MessageKey), camera: row.camera_name, at: fmtDateTime(row.occurred_at) })}
              className="w-full rounded-field bg-slate-900 object-contain" onError={() => setFailed(true)} />
          )}
          <p className="text-small text-slate-600">{t('guard.alerts.snapshotKept', { n: days })}</p>
        </div>
      )}
    </Modal>
  );
}

/** «Nima bo‘ldi?»: the outcome (and, for an incident, what it was), with a short note. */
function ResolveModal({ row, mode, onClose }: { row: AlertRow | null; mode: 'guard' | 'manager'; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [outcome, setOutcome] = useState<AlertOutcome | ''>('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState<IncidentCategory>('suspicious');
  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const reset = () => { setOutcome(''); setNote(''); setDescription(''); setErrors({}); setCategory('suspicious'); setSeverity('medium'); };
  const outcomes = ALERT_OUTCOMES.filter((o) => !(o === 'escalated' && (mode === 'manager' || row?.state === 'escalated')));
  const m = useMutation({
    mutationFn: () => api<{ data: { state: string; incident: { number: number } | null } }>(`/security/alerts/${row!.id}/resolve`, { method: 'POST', body: {
      seq: row!.seq, outcome, note: note.trim() || null,
      incident: outcome === 'incident' ? { category, severity, description: description.trim() } : undefined,
    } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['security'] });
      toast.success(r.data.incident ? t('guard.inc.created', { n: r.data.incident.number }) : outcome === 'escalated' ? t('guard.alerts.escalatedToast') : t('guard.alerts.resolved'));
      reset(); onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      toast.error(e);
      if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: ['security'] });
    },
  });
  const submit = () => {
    const err: Record<string, string> = {};
    if (!outcome) err.outcome = t('api.sec.pickOutcome');
    if (outcome === 'incident' && description.trim().length < 3) err['incident.description'] = t('api.sec.describe');
    setErrors(err);
    if (!Object.keys(err).length) m.mutate();
  };
  return (
    <Modal open={!!row} onClose={() => { reset(); onClose(); }} dirty={!!(note || description)} title={row ? `${t('guard.alerts.close')}: ${t(`cam.kind.${row.kind}` as MessageKey)}` : ''}
      footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} onClick={submit}>{t('common.save')}</Button></>}>
      {row && (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">{row.camera_name}{row.location ? ` · ${row.location}` : ''} · <span className="tabular-nums">{fmtDateTime(row.occurred_at)}</span></p>
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-slate-800">{t('guard.alerts.outcomeTitle')}</legend>
            <div className="divide-y divide-slate-100 rounded-field border border-slate-200 px-3">
              {outcomes.map((o) => <Radio key={o} name="outcome" checked={outcome === o} onChange={() => setOutcome(o)} label={t(`guard.outcome.${o}` as MessageKey)} rowClassName="min-h-control font-semibold" />)}
            </div>
            {errors.outcome && <p role="alert" className="mt-1 text-sm font-medium text-red-700">{errors.outcome}</p>}
          </fieldset>
          {outcome === 'incident' && (
            <div className="space-y-3 rounded-field border border-red-200 bg-red-50/40 p-3">
              <Field label={t('guard.inc.category')} required>{(id) => (
                <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as IncidentCategory)}>
                  {INCIDENT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`guard.cat.${c}` as MessageKey)}</option>)}
                </Select>
              )}</Field>
              <div>
                <div className="mb-1 text-sm font-semibold text-slate-800">{t('guard.inc.severity')}</div>
                <SeverityPicker value={severity} onChange={setSeverity} />
              </div>
              <Field label={t('guard.inc.description')} required error={errors['incident.description']} hint={t('guard.noNames')}>{(id) => (
                <Textarea id={id} rows={3} maxLength={2000} value={description} invalid={!!errors['incident.description']} onChange={(e) => setDescription(e.target.value)} />
              )}</Field>
            </div>
          )}
          <Field label={t('guard.noteOptional')} hint={t('guard.noNames')} error={errors.note}>{(id) => (
            <Textarea id={id} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          )}</Field>
        </div>
      )}
    </Modal>
  );
}
