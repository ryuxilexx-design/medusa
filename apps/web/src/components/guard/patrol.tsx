'use client';
// Patrol rounds: the guard walks the manager's checkpoints and marks each one «Joyida» or «Muammo» (a problem can be
// filed as an incident at once); the manager keeps the checkpoint list and sees the rounds and the missed ones.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Flag, Footprints, MapPin, Plus } from 'lucide-react';
import { INCIDENT_CATEGORIES, type IncidentCategory, type IncidentSeverity, type MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDateTime, fmtTime, localDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, Card, Checkbox, cx, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, ModalCancel, Pagination, Select, Table, Td, Textarea, Th, useToast } from '@/components/ui';
import { SeverityPicker, since, useNow, useWriteBranch } from './common';

type Point = { id: string; name: string; position: number; branch_id: string; result: 'ok' | 'problem' | null; note: string | null; marked_at: string | null };
type Current = { round: { id: string; branch_name: string; started_at: string; checkpoints_total: number } | null; checkpoints: Point[]; last_finished_at: string | null; interval_hours: number };

export function useCurrentRound() {
  const { branchId } = useSession();
  return useQuery({ queryKey: ['security', 'round', branchId], queryFn: () => api<{ data: Current }>(`/security/rounds/current${qs({ branch_id: branchId })}`).then((r) => r.data) });
}

/** The guard's round in progress (or the start of one): every checkpoint with two big buttons. */
export function PatrolCurrent({ q }: { q: ReturnType<typeof useCurrentRound> }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const [problem, setProblem] = useState<Point | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['security'] });
  const mark = useMutation({
    mutationFn: (p: Point) => api(`/security/rounds/${q.data!.round!.id}/marks`, { method: 'POST', body: { checkpoint_id: p.id, result: 'ok' } }),
    onSuccess: refresh,
    onError: (e) => { toast.error(e); if (e instanceof ApiError && e.status === 409) refresh(); },
  });
  const finish = useMutation({
    mutationFn: () => api<{ data: { marked: number; total: number } }>(`/security/rounds/${q.data!.round!.id}/finish`, { method: 'POST' }),
    onSuccess: (r) => { refresh(); setConfirmFinish(false); toast.success(t('guard.pat.finished', { marked: r.data.marked, total: r.data.total })); },
    onError: (e) => { toast.error(e); if (e instanceof ApiError && e.status === 409) refresh(); },
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={5} />;
  const { round, checkpoints } = q.data;
  if (!checkpoints.length) return <EmptyState compact icon={<MapPin />} title={t('guard.pat.noPoints')} />;
  const marked = checkpoints.filter((p) => p.result).length;
  if (!round) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
        <Footprints className="h-8 w-8 text-brand-600" aria-hidden="true" />
        <p className="text-base font-semibold text-slate-900">{q.data.last_finished_at ? t('guard.pat.lastDone', { time: t('guard.ago', { time: since(q.data.last_finished_at, now) }) }) : t('guard.pat.never')}</p>
        <p className="text-sm text-slate-600">{checkpoints.map((p) => p.name).join(' · ')}</p>
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div>
          <div className="text-base font-bold text-slate-900" data-testid="round-progress">{t('guard.pat.progress', { marked, total: checkpoints.length })}</div>
          <div className="text-small text-slate-600">{t('guard.since', { time: fmtTime(round.started_at) })} · {round.branch_name}</div>
        </div>
        <div className="h-2.5 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-slate-100 sm:max-w-xs" aria-hidden="true">
          <div className="h-full rounded-full bg-brand-600" style={{ width: `${(marked / checkpoints.length) * 100}%` }} />
        </div>
      </div>
      <ol className="divide-y divide-slate-100">
        {checkpoints.map((p, i) => (
          <li key={p.id} data-point={p.name} className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5', p.result === 'problem' && 'bg-amber-50/60')}>
            <span aria-hidden="true" className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold',
              p.result === 'ok' ? 'bg-emerald-100 text-emerald-800' : p.result === 'problem' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700')}>
              {p.result === 'ok' ? <CheckCircle2 className="h-5 w-5" /> : p.result === 'problem' ? <AlertTriangle className="h-5 w-5" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1 basis-40">
              <div className="text-base font-semibold text-slate-900">{p.name}</div>
              {p.marked_at && <div className="text-small text-slate-600">{t('guard.pat.marked', { time: fmtTime(p.marked_at) })}{p.note ? ` · ${p.note}` : ''}</div>}
            </div>
            {!p.result && (
              <div className="flex w-full gap-2 sm:w-auto">
                <Button variant="success" className="flex-1 sm:flex-none" icon={<CheckCircle2 className="h-5 w-5" />} loading={mark.isPending && mark.variables?.id === p.id} onClick={() => mark.mutate(p)}>{t('guard.pat.ok')}</Button>
                <Button className="flex-1 sm:flex-none" icon={<AlertTriangle className="h-5 w-5" />} onClick={() => setProblem(p)}>{t('guard.pat.problem')}</Button>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="flex justify-end border-t border-slate-100 px-5 py-3">
        <Button icon={<Flag className="h-5 w-5" />} className="w-full sm:w-auto" loading={finish.isPending} onClick={() => (marked < checkpoints.length ? setConfirmFinish(true) : finish.mutate())}>{t('guard.pat.finish')}</Button>
      </div>
      <ProblemModal point={problem} roundId={round.id} onClose={() => setProblem(null)} />
      <Modal open={confirmFinish} onClose={() => setConfirmFinish(false)} title={t('guard.pat.finish')}
        footer={<><ModalCancel /><Button variant="primary" loading={finish.isPending} onClick={() => finish.mutate()}>{t('guard.pat.finish')}</Button></>}>
        <p className="text-body text-slate-800">{t('guard.pat.finishConfirm', { n: checkpoints.length - marked })}</p>
      </Modal>
    </>
  );
}

function ProblemModal({ point, roundId, onClose }: { point: Point | null; roundId: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [asIncident, setAsIncident] = useState(false);
  const [category, setCategory] = useState<IncidentCategory>('damage');
  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [err, setErr] = useState<string | undefined>();
  const close = () => { setNote(''); setAsIncident(false); setErr(undefined); onClose(); };
  const m = useMutation({
    mutationFn: () => api<{ data: { incident: { number: number } | null } }>(`/security/rounds/${roundId}/marks`, { method: 'POST', body: {
      checkpoint_id: point!.id, result: 'problem', note: note.trim(), incident: asIncident ? { category, severity } : undefined,
    } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(r.data.incident ? t('guard.inc.created', { n: r.data.incident.number }) : t('guard.saved')); close(); },
    onError: (e) => { setErr(e instanceof ApiError ? e.fields?.note : undefined); toast.error(e); },
  });
  return (
    <Modal open={!!point} onClose={close} dirty={!!note} title={point ? t('guard.pat.problemTitle', { name: point.name }) : ''}
      footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} onClick={() => { if (note.trim().length < 3) { setErr(t('api.sec.problemNote')); return; } m.mutate(); }}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('guard.pat.problemNote')} required error={err} hint={t('guard.noNames')}>{(id) => <Textarea id={id} rows={3} maxLength={500} value={note} invalid={!!err} onChange={(e) => setNote(e.target.value)} />}</Field>
        <Checkbox checked={asIncident} onChange={(e) => setAsIncident(e.target.checked)} label={t('guard.pat.asIncident')} rowClassName="font-semibold" />
        {asIncident && (
          <div className="space-y-3">
            <Field label={t('guard.inc.category')}>{(id) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as IncidentCategory)}>
                {INCIDENT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`guard.cat.${c}` as MessageKey)}</option>)}
              </Select>
            )}</Field>
            <SeverityPicker value={severity} onChange={setSeverity} />
          </div>
        )}
      </div>
    </Modal>
  );
}

type RoundRow = { id: string; branch_name: string; guard_name: string; started_at: string; finished_at: string | null; checkpoints_total: number; marked: number; problems: number; problem_list: { name: string; note: string }[] | null };

export function RoundsHistory({ from, to, page, onPage }: { from: string; to: string; page: number; onPage: (p: number) => void }) {
  const t = useT();
  const { me, branchId } = useSession();
  const q = useQuery({
    queryKey: ['security', 'rounds', branchId, from, to, page],
    queryFn: () => api<{ data: RoundRow[]; meta: { total: number; page_size: number } }>(`/security/rounds${qs({ branch_id: branchId, from, to, page, page_size: 20 })}`),
    placeholderData: (prev) => prev,
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={4} />;
  if (!q.data.data.length) return <EmptyState compact icon={<Footprints />} title={t('guard.pat.historyEmpty')} />;
  return (
    <>
      <Table>
        <thead><tr><Th>{t('guard.col.time')}</Th><Th className="hidden sm:table-cell">{t('guard.col.by')}</Th><Th right>{t('guard.col.points')}</Th><Th className="hidden md:table-cell">{t('guard.pat.problem')}</Th></tr></thead>
        <tbody>{q.data.data.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap tabular-nums">{localDate(r.started_at) === me.today ? fmtTime(r.started_at) : fmtDateTime(r.started_at)}{r.finished_at ? `–${fmtTime(r.finished_at)}` : ''}
              <div className="text-small text-slate-600 sm:hidden">{r.guard_name}</div>
              {!r.finished_at && <div><Badge tone="blue">{t('guard.pat.inProgress')}</Badge></div>}</Td>
            <Td className="hidden sm:table-cell">{r.guard_name}</Td>
            <Td right className={cx('font-semibold', r.marked < r.checkpoints_total && r.finished_at ? 'text-amber-800' : 'text-slate-900')}>{r.marked}/{r.checkpoints_total}</Td>
            <Td className="hidden md:table-cell">{r.problems ? <span className="text-amber-900">{(r.problem_list ?? []).map((p) => `${p.name}: ${p.note}`).join('; ')}</span> : <span className="text-slate-500">—</span>}</Td>
          </tr>
        ))}</tbody>
      </Table>
      {q.data.meta.total > q.data.meta.page_size && <Pagination page={page} pageSize={q.data.meta.page_size} total={q.data.meta.total} onPage={onPage} />}
    </>
  );
}

type Checkpoint = { id: string; branch_id: string; branch_name: string; name: string; position: number; active: boolean };

/** Manager: the checkpoints of each branch — add, rename by re-adding, switch off/on (never deleted: rounds refer to them). */
export function CheckpointsManager() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { me, branchId } = useSession();
  const writeBranch = useWriteBranch();
  const q = useQuery({ queryKey: ['security', 'checkpoints', branchId], queryFn: () => api<{ data: Checkpoint[] }>(`/security/checkpoints${qs({ branch_id: branchId, all: 1 })}`).then((r) => r.data) });
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const add = useMutation({
    mutationFn: () => api('/security/checkpoints', { method: 'POST', body: { branch_id: writeBranch, name: name.trim() } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security', 'checkpoints'] }); toast.success(t('guard.pat.pointAdded')); setName(''); setErr(undefined); },
    onError: (e) => { setErr(e instanceof ApiError ? e.fields?.name : undefined); toast.error(e); },
  });
  const toggle = useMutation({
    mutationFn: (p: Checkpoint) => api(`/security/checkpoints/${p.id}`, { method: 'PATCH', body: { active: !p.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security', 'checkpoints'] }),
    onError: (e) => toast.error(e),
  });
  return (
    <Card padded={false} title={t('guard.pat.checkpoints')}>
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-5 py-3">
        {!writeBranch ? <Alert tone="yellow">{t('guard.branchPick')}</Alert> : (
          <>
            <Field label={t('guard.pat.pointName')} error={err} className="min-w-0 flex-1 basis-56">{(id) => <Input id={id} maxLength={80} value={name} placeholder={t('guard.pat.pointNameHint')} invalid={!!err} onChange={(e) => setName(e.target.value)} />}</Field>
            <Button icon={<Plus className="h-5 w-5" />} loading={add.isPending} disabled={name.trim().length < 2} onClick={() => add.mutate()}>{t('guard.pat.addPoint')}</Button>
          </>
        )}
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <LoadingRows rows={3} /> : !q.data.length ? <EmptyState compact icon={<MapPin />} title={t('guard.pat.noPoints')} /> : (
        <ul className="divide-y divide-slate-100">
          {q.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <span className="w-8 shrink-0 text-small font-bold tabular-nums text-slate-600">{p.position}</span>
              <span className="min-w-0 flex-1">
                <span className={cx('block font-semibold', p.active ? 'text-slate-900' : 'text-slate-500 line-through')}>{p.name}</span>
                {(!p.active || (!branchId && me.branches.length > 1)) && <span className="mt-0.5 flex flex-wrap items-center gap-2 text-small text-slate-600">{!branchId && me.branches.length > 1 && p.branch_name}{!p.active && <Badge tone="gray">{t('guard.pat.pointInactive')}</Badge>}</span>}
              </span>
              <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === p.id} onClick={() => toggle.mutate(p)}>{t(p.active ? 'guard.pat.pointOff' : 'guard.pat.pointOn')}</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

