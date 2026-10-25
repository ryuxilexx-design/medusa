'use client';
// The incident log: append-only (an addition or a correction is a new row), the manager marks seen and closes with a
// resolution. Shared by the guard's «Hodisalar jurnali» and the manager's «Xavfsizlik → Hodisalar».
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Lock, MapPin, NotebookPen, Siren } from 'lucide-react';
import { INCIDENT_CATEGORIES, type IncidentCategory, type IncidentSeverity, type MessageKey } from '@meduza/contracts';
import { api, ApiError, newIdempotencyKey, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, Chip, cx, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, ModalCancel, Pagination, Segmented, Select, Skeleton, Textarea, useToast } from '@/components/ui';
import { ic, NameHint, SeverityPicker, SeverityBadge, useGuardedMutation, useWriteBranch } from './common';

type IncidentRow = {
  id: string; number: number; category: IncidentCategory; severity: IncidentSeverity; source: 'manual' | 'alert' | 'sos' | 'patrol'; sos_reason: string | null;
  place: string | null; description: string; reported_at: string; reported_by_name: string; branch_name: string; room_name: string | null; closed: boolean; seen: boolean; entries: number;
};
type Entry = { id: string; kind: 'note' | 'correction' | 'seen' | 'close'; text: string | null; author_name: string; author_role: string; created_at: string };
type IncidentFull = IncidentRow & { entries: Entry[]; camera_name: string | null; alert_kind: string | null; alert_at: string | null };

export function useIncidents(p: { status?: 'open'; from?: string; to?: string; page?: number }) {
  const { branchId } = useSession();
  return useQuery({
    queryKey: ['security', 'incidents', branchId, p],
    queryFn: () => api<{ data: IncidentRow[]; meta: { total: number; page: number; page_size: number } }>(`/security/incidents${qs({ branch_id: branchId, status: p.status, from: p.from, to: p.to, page: p.page, page_size: 25 })}`),
    refetchInterval: 60_000, placeholderData: (prev) => prev,
  });
}

/** The rows of the log; a click opens the incident (also reachable as ?open=<id>). */
export function IncidentList({ q, mode, emptyTitle, page, onPage }: { q: ReturnType<typeof useIncidents>; mode: 'guard' | 'manager'; emptyTitle: string; page: number; onPage: (p: number) => void }) {
  const t = useT();
  const { me, branchId } = useSession();
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('open'); if (id) setOpenId(id); }, []);
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={4} />;
  return (
    <>
      {!q.data.data.length ? <EmptyState compact icon={<CheckCircle2 />} title={emptyTitle} /> : (
        <ul className="divide-y divide-slate-100">
          {q.data.data.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpenId(r.id)} data-incident={r.number} data-no-press
                className={cx('flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus sm:px-5',
                  !r.closed && (r.severity === 'critical' || r.severity === 'high') && 'bg-red-50/40')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-small font-bold tabular-nums text-slate-600">{t('guard.inc.number', { n: r.number })}</span>
                    <span className="text-base font-bold text-slate-900">{t(`guard.cat.${r.category}` as MessageKey)}</span>
                    <SeverityBadge severity={r.severity} />
                    {r.source === 'sos' && <Badge tone="red" icon={<Siren className={ic} />}>{t('guard.src.sos')}</Badge>}
                    {r.closed ? <Badge tone="green" icon={<Lock className={ic} />}>{t('guard.inc.closed')}</Badge> : <Badge tone="yellow">{t('guard.inc.openState')}</Badge>}
                    {mode === 'manager' && !r.closed && r.seen && <Badge tone="gray">{t('guard.inc.seen')}</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-body text-slate-800">{r.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-small text-slate-600">
                    <span className="tabular-nums">{fmtDateTime(r.reported_at)}</span>
                    {(r.room_name || r.place) && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{[r.room_name, r.place].filter(Boolean).join(', ')}</span>}
                    <span>{r.reported_by_name}</span>
                    {!branchId && me.branches.length > 1 && <span>{r.branch_name}</span>}
                    {r.entries > 0 && <span>{t('guard.inc.entries')}: {r.entries}</span>}
                  </div>
                </div>
                <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.data.meta.total > q.data.meta.page_size && <Pagination page={page} pageSize={q.data.meta.page_size} total={q.data.meta.total} onPage={onPage} />}
      <IncidentModal id={openId} mode={mode} onClose={() => setOpenId(null)} />
    </>
  );
}

function IncidentModal({ id, mode, onClose }: { id: string | null; mode: 'guard' | 'manager'; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['security', 'incident', id], queryFn: () => api<{ data: IncidentFull }>(`/security/incidents/${id}`).then((r) => r.data), enabled: !!id });
  const [kind, setKind] = useState<'note' | 'correction' | 'close'>('note');
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | undefined>();
  // the text typed when the incident turned out closed meanwhile (409): shown read-only to copy, never lost silently
  const [lost, setLost] = useState<string | null>(null);
  useEffect(() => { setKind('note'); setText(''); setErr(undefined); setLost(null); }, [id]);
  const add = useGuardedMutation({
    mutationFn: () => api(`/security/incidents/${id}/entries`, { method: 'POST', body: { kind, text: text.trim() } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t(kind === 'close' ? 'guard.inc.closeDone' : 'guard.inc.entryAdded')); setText(''); setKind('note'); },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INCIDENT_CLOSED') { setLost(text.trim()); setText(''); qc.invalidateQueries({ queryKey: ['security'] }); toast.info(t('guard.inc.closedLost')); return; }
      setErr(e instanceof ApiError ? e.fields?.text : undefined); toast.error(e);
    },
  });
  const seen = useGuardedMutation({
    mutationFn: () => api(`/security/incidents/${id}/seen`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security'] }),
    onError: (e) => toast.error(e),
  });
  const i = q.data;
  const kinds = (['note', 'correction', ...(mode === 'manager' ? ['close'] as const : [])] as const).map((k) => ({ value: k, label: t(`guard.inc.entry.${k}` as MessageKey) }));
  return (
    <Modal open={!!id} onClose={onClose} dirty={!!text} width="max-w-2xl" title={i ? `${t('guard.inc.number', { n: i.number })} · ${t(`guard.cat.${i.category}` as MessageKey)}` : t('guard.inc.title')}
      footer={i && !i.closed ? (
        <>
          <ModalCancel>{t('common.close')}</ModalCancel>
          {mode === 'manager' && !i.seen && <Button loading={seen.isPending} onClick={() => seen.run()}>{t('guard.inc.markSeen')}</Button>}
          <Button variant="primary" loading={add.isPending} disabled={text.trim().length < 3} onClick={() => add.run()}>{kind === 'close' ? t('guard.inc.closeTitle') : t('guard.inc.addEntry')}</Button>
        </>
      ) : <ModalCancel>{t('common.close')}</ModalCancel>}>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !i ? <Skeleton className="h-40" /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={i.severity} />
            <Badge tone="gray">{t(`guard.src.${i.source}` as MessageKey)}</Badge>
            {i.closed ? <Badge tone="green" icon={<Lock className={ic} />}>{t('guard.inc.closed')}</Badge> : <Badge tone="yellow">{t('guard.inc.openState')}</Badge>}
          </div>
          <div className="text-small text-slate-600">
            <span className="tabular-nums">{fmtDateTime(i.reported_at)}</span> · {i.reported_by_name} · {i.branch_name}{(i.room_name || i.place) && <> · {[i.room_name, i.place].filter(Boolean).join(', ')}</>}
          </div>
          {i.camera_name && i.alert_kind && <p className="text-small text-slate-700">{t('guard.inc.fromAlert', { kind: t(`cam.kind.${i.alert_kind}` as MessageKey), camera: i.camera_name })}</p>}
          <p className="whitespace-pre-wrap rounded-field bg-slate-50 p-3 text-body text-slate-900">{i.description}</p>
          {i.entries.length > 0 && (
            <ol className="space-y-2" aria-label={t('guard.inc.entries')}>
              {i.entries.map((e) => (
                <li key={e.id} className={cx('rounded-field border px-3 py-2', e.kind === 'close' ? 'border-emerald-200 bg-emerald-50' : e.kind === 'correction' ? 'border-amber-200 bg-amber-50' : 'border-slate-200')}>
                  <div className="flex flex-wrap items-center gap-x-2 text-small text-slate-700">
                    <span className="font-bold text-slate-900">{t(`guard.inc.entry.${e.kind}` as MessageKey)}</span>
                    <span>{e.author_name}</span><span className="tabular-nums">{fmtDateTime(e.created_at)}</span>
                  </div>
                  {e.text && <p className="mt-1 whitespace-pre-wrap text-body text-slate-900">{e.text}</p>}
                </li>
              ))}
            </ol>
          )}
          {lost && (
            <div role="status" className="rounded-field border border-amber-300 bg-amber-50 p-3" data-testid="incident-lost">
              <p className="text-small font-semibold text-amber-900">{t('guard.inc.closedLost')}</p>
              <p className="mt-1 select-all whitespace-pre-wrap text-body text-slate-900">{lost}</p>
            </div>
          )}
          {!i.closed && (
            <div className="space-y-2 border-t border-slate-100 pt-4">
              <Segmented label={t('guard.inc.entries')} value={kind} onChange={setKind} options={kinds} size="compact" />
              <Field label={kind === 'close' ? t('guard.inc.resolution') : t('guard.inc.entryText')} error={err} hint={t('guard.noNames')}>{(fid) => (
                <Textarea id={fid} rows={3} maxLength={2000} value={text} invalid={!!err} onChange={(e) => setText(e.target.value)} />
              )}</Field>
              <NameHint text={text} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

type Room = { id: string; name: string; branch_id: string };

/** «Hodisa yozish»: kind (chips), how serious, where (a room and/or a place), what happened. */
export function IncidentFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const branchId = useWriteBranch();
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api<{ data: Room[] }>('/rooms').then((r) => r.data), enabled: open, staleTime: 5 * 60_000 });
  // one key per opened form: a double tap on «Saqlash» returns the first incident
  const [key, setKey] = useState(() => newIdempotencyKey());
  useEffect(() => { if (open) setKey(newIdempotencyKey()); }, [open]);
  const [category, setCategory] = useState<IncidentCategory | ''>('');
  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [roomId, setRoomId] = useState('');
  const [place, setPlace] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const reset = () => { setCategory(''); setSeverity('medium'); setRoomId(''); setPlace(''); setDescription(''); setErrors({}); };
  const m = useGuardedMutation({
    mutationFn: () => api<{ data: { number: number } }>('/security/incidents', { method: 'POST', headers: { 'Idempotency-Key': key }, body: {
      branch_id: branchId || null, category, severity, room_id: roomId || null, place: place.trim() || null, description: description.trim(),
    } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t('guard.inc.created', { n: r.data.number })); reset(); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); toast.error(e); },
  });
  const submit = () => {
    const err: Record<string, string> = {};
    if (!category) err.category = t('api.sec.pickCategory');
    if (description.trim().length < 3) err.description = t('api.sec.describe');
    setErrors(err);
    if (!Object.keys(err).length) m.run();
  };
  const branchRooms = (rooms.data ?? []).filter((r) => !branchId || r.branch_id === branchId);
  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} dirty={!!(description || place)} width="max-w-xl" title={t('guard.inc.addTitle')}
      footer={<><ModalCancel /><Button variant="primary" icon={<NotebookPen className="h-5 w-5" />} loading={m.isPending} onClick={submit}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        {!branchId && <Alert tone="yellow">{t('guard.branchPick')}</Alert>}
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-slate-800">{t('guard.inc.category')}<span className="text-red-700" aria-hidden="true"> *</span></legend>
          <div className="flex flex-wrap gap-2">
            {INCIDENT_CATEGORIES.map((c, k) => <Chip key={c} pressed={category === c} onClick={() => setCategory(c)} data-autofocus={k === 0 || undefined}>{t(`guard.cat.${c}` as MessageKey)}</Chip>)}
          </div>
          {errors.category && <p role="alert" className="mt-1 text-sm font-medium text-red-700">{errors.category}</p>}
        </fieldset>
        <div>
          <div className="mb-1 text-sm font-semibold text-slate-800">{t('guard.inc.severity')}</div>
          <SeverityPicker value={severity} onChange={setSeverity} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('guard.inc.room')} error={errors.room_id}>{(id) => (
            <Select id={id} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">{t('guard.inc.noRoom')}</option>
              {branchRooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          )}</Field>
          <Field label={t('guard.inc.place')} error={errors.place}>{(id) => <Input id={id} maxLength={120} value={place} placeholder={t('guard.inc.placeHint')} onChange={(e) => setPlace(e.target.value)} />}</Field>
        </div>
        <Field label={t('guard.inc.description')} required error={errors.description} hint={t('guard.noNames')}>{(id) => (
          <Textarea id={id} rows={4} maxLength={2000} value={description} invalid={!!errors.description} onChange={(e) => setDescription(e.target.value)} />
        )}</Field>
        <NameHint text={description} />
      </div>
    </Modal>
  );
}
