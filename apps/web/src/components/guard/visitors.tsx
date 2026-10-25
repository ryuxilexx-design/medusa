'use client';
// The visitor log for non-patients (couriers, suppliers, repair workers, inspectors): who, from where, why, to whom,
// in and out. Never a passport or ID number; names are cleared after VISITOR_RETENTION_DAYS.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, LogOut, UserPlus } from 'lucide-react';
import { VISITOR_PURPOSES, VISITOR_RETENTION_DAYS, type MessageKey, type VisitorPurpose } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDateTime, fmtTime, localDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, Chip, cx, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, ModalCancel, Pagination, Table, Td, Th, useToast } from '@/components/ui';
import { since, StaffSelect, useNow, useWriteBranch } from './common';

export type Visitor = {
  id: string; branch_name: string; full_name: string | null; organisation: string | null; purpose: VisitorPurpose; purpose_note: string | null;
  host_name: string | null; pass_no: string | null; in_at: string; out_at: string | null; recorded_by_name: string; purged_at: string | null;
};

export function useVisitorsInside() {
  const { branchId } = useSession();
  return useQuery({ queryKey: ['security', 'visitors', 'inside', branchId], queryFn: () => api<{ data: Visitor[] }>(`/security/visitors${qs({ branch_id: branchId, inside: 1 })}`).then((r) => r.data), refetchInterval: 60_000 });
}

function useOut() {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  return useMutation({
    mutationFn: (id: string) => api(`/security/visitors/${id}/out`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t('guard.vis.outDone')); },
    onError: (e) => { toast.error(e); if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: ['security'] }); },
  });
}

/** Who is inside now: big «Chiqdi» on every row. */
export function VisitorsInside() {
  const t = useT();
  const q = useVisitorsInside();
  const out = useOut();
  const now = useNow();
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={3} />;
  if (!q.data.length) return <EmptyState compact icon={<DoorOpen />} title={t('guard.vis.emptyInside')} />;
  return (
    <ul className="divide-y divide-slate-100">
      {q.data.map((v) => (
        <li key={v.id} data-visitor={v.full_name ?? ''} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:flex-nowrap sm:px-5">
          <div className="min-w-0 flex-1 basis-48">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-slate-900">{v.full_name ?? t('guard.vis.purged')}</span>
              {v.pass_no && <Badge tone="blue">{t('guard.vis.pass')} {v.pass_no}</Badge>}
            </div>
            <div className="mt-0.5 text-sm text-slate-700">{[v.organisation, t(`guard.purpose.${v.purpose}` as MessageKey), v.purpose_note].filter(Boolean).join(' · ')}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-small text-slate-600">
              <span className="tabular-nums">{t('guard.vis.inAt', { time: fmtTime(v.in_at) })}</span>
              <span>{t('guard.vis.for', { time: since(v.in_at, now) })}</span>
              {v.host_name && <span>{t('guard.vis.host')}: {v.host_name}</span>}
            </div>
          </div>
          <Button icon={<LogOut className="h-5 w-5" />} className="w-full sm:w-auto" loading={out.isPending && out.variables === v.id} onClick={() => out.mutate(v.id)}>{t('guard.vis.out')}</Button>
        </li>
      ))}
    </ul>
  );
}

/** The log of a period: in, out, who and why (purged rows show only the purpose). */
export function VisitorLog({ from, to, page, onPage }: { from: string; to: string; page: number; onPage: (p: number) => void }) {
  const t = useT();
  const { me, branchId } = useSession();
  const q = useQuery({
    queryKey: ['security', 'visitors', 'log', branchId, from, to, page],
    queryFn: () => api<{ data: Visitor[]; meta: { total: number; page_size: number } }>(`/security/visitors${qs({ branch_id: branchId, from, to, page, page_size: 25 })}`),
    placeholderData: (prev) => prev,
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={4} />;
  if (!q.data.data.length) return <EmptyState compact icon={<DoorOpen />} title={t('guard.vis.emptyLog')} />;
  const multiDay = from !== to;
  return (
    <>
      <Table>
        <thead><tr><Th>{t('guard.col.visitor')}</Th><Th className="hidden md:table-cell">{t('guard.vis.purpose')}</Th><Th className="hidden lg:table-cell">{t('guard.vis.host')}</Th><Th>{t('guard.col.in')}</Th><Th>{t('guard.col.out')}</Th></tr></thead>
        <tbody>{q.data.data.map((v) => (
          <tr key={v.id}>
            <Td className="min-w-[10rem]">
              <div className={cx('font-semibold', v.full_name ? 'text-slate-900' : 'italic text-slate-600')}>{v.full_name ?? t('guard.vis.purged')}</div>
              <div className="text-small text-slate-600">{[v.organisation, v.pass_no && `${t('guard.vis.pass')} ${v.pass_no}`].filter(Boolean).join(' · ')}</div>
              <div className="text-small text-slate-600 md:hidden">{t(`guard.purpose.${v.purpose}` as MessageKey)}</div>
            </Td>
            <Td className="hidden md:table-cell">{t(`guard.purpose.${v.purpose}` as MessageKey)}{v.purpose_note && <div className="text-small text-slate-600">{v.purpose_note}</div>}</Td>
            <Td className="hidden lg:table-cell">{v.host_name ?? '—'}</Td>
            <Td className="whitespace-nowrap tabular-nums">{multiDay || localDate(v.in_at) !== me.today ? fmtDateTime(v.in_at) : fmtTime(v.in_at)}</Td>
            <Td className="whitespace-nowrap tabular-nums">{v.out_at ? fmtTime(v.out_at) : <Badge tone="yellow">{t('guard.vis.stillInside')}</Badge>}</Td>
          </tr>
        ))}</tbody>
      </Table>
      {q.data.meta.total > q.data.meta.page_size && <Pagination page={page} pageSize={q.data.meta.page_size} total={q.data.meta.total} onPage={onPage} />}
    </>
  );
}

/** «Kirdi — yozish»: name, organisation, purpose (chips), to whom, a temporary pass. */
export function VisitorFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const branchId = useWriteBranch();
  const [v, setV] = useState({ full_name: '', organisation: '', purpose: '' as VisitorPurpose | '', purpose_note: '', host: '', pass_no: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (val: string) => setV((s) => ({ ...s, [k]: val }));
  const reset = () => { setV({ full_name: '', organisation: '', purpose: '', purpose_note: '', host: '', pass_no: '' }); setErrors({}); };
  const m = useMutation({
    mutationFn: () => api('/security/visitors', { method: 'POST', body: {
      branch_id: branchId || null, full_name: v.full_name.trim(), organisation: v.organisation.trim() || null, purpose: v.purpose,
      purpose_note: v.purpose_note.trim() || null, host_membership_id: v.host || null, pass_no: v.pass_no.trim() || null,
    } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t('guard.vis.added')); reset(); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); toast.error(e); },
  });
  const submit = () => {
    const err: Record<string, string> = {};
    if (v.full_name.trim().length < 2) err.full_name = t('api.v.min', { label: t('guard.vis.name'), min: 2 });
    if (!v.purpose) err.purpose = t('api.wh.pickPurpose');
    setErrors(err);
    if (!Object.keys(err).length) m.mutate();
  };
  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} dirty={!!(v.full_name || v.organisation || v.purpose_note)} width="max-w-xl" title={t('guard.vis.addTitle')}
      footer={<><ModalCancel /><Button variant="primary" icon={<UserPlus className="h-5 w-5" />} loading={m.isPending} onClick={submit}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        {!branchId && <Alert tone="yellow">{t('guard.branchPick')}</Alert>}
        <Field label={t('guard.vis.name')} required error={errors.full_name} hint={t('guard.vis.noPassport')}>{(id) => (
          <Input id={id} autoComplete="off" maxLength={120} value={v.full_name} invalid={!!errors.full_name} onChange={(e) => set('full_name')(e.target.value)} />
        )}</Field>
        <Field label={t('guard.vis.organisation')} error={errors.organisation}>{(id) => <Input id={id} maxLength={120} value={v.organisation} onChange={(e) => set('organisation')(e.target.value)} />}</Field>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-slate-800">{t('guard.vis.purpose')}<span className="text-red-700" aria-hidden="true"> *</span></legend>
          <div className="flex flex-wrap gap-2">
            {VISITOR_PURPOSES.map((p) => <Chip key={p} pressed={v.purpose === p} onClick={() => set('purpose')(p)}>{t(`guard.purpose.${p}` as MessageKey)}</Chip>)}
          </div>
          {errors.purpose && <p role="alert" className="mt-1 text-sm font-medium text-red-700">{errors.purpose}</p>}
        </fieldset>
        <Field label={t('guard.noteOptional')} error={errors.purpose_note}>{(id) => <Input id={id} maxLength={200} value={v.purpose_note} onChange={(e) => set('purpose_note')(e.target.value)} />}</Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem]">
          <Field label={t('guard.vis.host')} error={errors.host_membership_id}>{(id) => <StaffSelect id={id} value={v.host} onChange={set('host')} allowNone noneLabel={t('guard.vis.hostNone')} />}</Field>
          <Field label={t('guard.vis.pass')} error={errors.pass_no}>{(id) => <Input id={id} maxLength={10} value={v.pass_no} placeholder="M-01" onChange={(e) => set('pass_no')(e.target.value)} />}</Field>
        </div>
        <p className="text-small text-slate-600">{t('guard.vis.retention', { n: VISITOR_RETENTION_DAYS })}</p>
      </div>
    </Modal>
  );
}
