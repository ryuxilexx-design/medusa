'use client';
// The key log: every room of the branch with its key — in place, or with whom since when (red when not back by the
// end of the day). Handing out and taking back are new rows; two guards on the same key collide (409 «refresh»).
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Undo2 } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDateTime, fmtTime, localDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Button, cx, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, ModalCancel, Pagination, Table, Td, Th, useToast } from '@/components/ui';
import { ic, StaffSelect, useGuardedMutation } from './common';

export type KeyRow = {
  room_id: string; room_name: string; purpose: string | null; active: boolean; branch_name: string; out: boolean; overdue: boolean; holder_membership_id: string | null; holder_name: string | null;
  holder_inactive: boolean; at: string | null; by_name: string | null;
};

export function useKeys() {
  const { branchId } = useSession();
  return useQuery({ queryKey: ['security', 'keys', branchId], queryFn: () => api<{ data: KeyRow[] }>(`/security/keys${qs({ branch_id: branchId })}`).then((r) => r.data), refetchInterval: 60_000 });
}

export function KeysNow({ readOnly }: { readOnly?: boolean }) {
  const t = useT();
  const { me, branchId } = useSession();
  const q = useKeys();
  const [give, setGive] = useState<KeyRow | null>(null);
  const [back, setBack] = useState<KeyRow | null>(null);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={5} />;
  if (!q.data.length) return <EmptyState compact icon={<KeyRound />} title={t('guard.keys.empty')} />;
  const rows = [...q.data].sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(b.out) - Number(a.out));
  return (
    <>
      <ul className="divide-y divide-slate-100">
        {rows.map((k) => (
          <li key={k.room_id} data-room={k.room_name} className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5', k.overdue && 'bg-red-50/50')}>
            <span aria-hidden="true" className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', k.overdue ? 'bg-red-100 text-red-700' : k.out ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700')}>
              <KeyRound className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1 basis-40">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold text-slate-900">{k.room_name}</span>
                {k.purpose && <span className="text-sm text-slate-600">{k.purpose}</span>}
                {!branchId && me.branches.length > 1 && <span className="text-small text-slate-600">· {k.branch_name}</span>}
              </div>
              <div className="mt-0.5 text-sm">
                {!k.out ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-800"><CheckCircle2 className={ic} aria-hidden="true" />{t('guard.keys.inPlace')}</span> : (
                  <span className={cx('font-semibold', k.overdue ? 'text-red-700' : 'text-amber-900')}>
                    {t('guard.keys.outTo', { name: k.holder_name ?? '—', time: localDate(k.at!) === me.today ? fmtTime(k.at) : fmtDateTime(k.at) })}
                    {k.overdue && <Badge tone="red" className="ml-2">{t('guard.keys.overdue')}</Badge>}
                    {k.holder_inactive && <Badge tone="gray" className="ml-2">{t('guard.keys.holderInactive')}</Badge>}
                  </span>
                )}
              </div>
            </div>
            {!readOnly && (k.out
              ? <Button icon={<Undo2 className="h-5 w-5" />} className="w-full sm:w-auto" onClick={() => setBack(k)}>{t('guard.keys.back')}</Button>
              : <Button icon={<KeyRound className="h-5 w-5" />} className="w-full sm:w-auto" onClick={() => setGive(k)}>{t('guard.keys.give')}</Button>)}
          </li>
        ))}
      </ul>
      <KeyModal row={give} mode="out" onClose={() => setGive(null)} />
      <KeyModal row={back} mode="in" onClose={() => setBack(null)} />
    </>
  );
}

function KeyModal({ row, mode, onClose }: { row: KeyRow | null; mode: 'out' | 'in'; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [holder, setHolder] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const close = () => { setHolder(''); setNote(''); setErr(undefined); onClose(); };
  // «Qaytdi»: by default the person who took it (empty = them, even if they no longer work here); another person is a choice
  const who = holder;
  const m = useGuardedMutation({
    mutationFn: () => api(`/security/keys/${row!.room_id}/${mode}`, { method: 'POST', body: { holder_membership_id: who || null, note: note.trim() || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t(mode === 'out' ? 'guard.keys.given' : 'guard.keys.returned')); close(); },
    onError: (e) => { setErr(e instanceof ApiError ? e.fields?.holder_membership_id : undefined); toast.error(e); if (e instanceof ApiError && e.status === 409) { qc.invalidateQueries({ queryKey: ['security'] }); close(); } },
  });
  return (
    <Modal open={!!row} onClose={close} title={row ? t(mode === 'out' ? 'guard.keys.giveTitle' : 'guard.keys.backTitle', { room: row.room_name }) : ''}
      footer={<><ModalCancel /><Button variant="primary" icon={mode === 'out' ? <KeyRound className="h-5 w-5" /> : <Undo2 className="h-5 w-5" />} loading={m.isPending}
        onClick={() => { if (mode === 'out' && !who) { setErr(t('guard.staffPick')); return; } m.run(); }}>{t(mode === 'out' ? 'guard.keys.give' : 'guard.keys.back')}</Button></>}>
      <div className="space-y-4">
        <Field label={t(mode === 'out' ? 'guard.keys.who' : 'guard.keys.whoBack')} required={mode === 'out'} error={err}>{(id) => mode === 'out'
          ? <StaffSelect id={id} value={who} onChange={setHolder} invalid={!!err} />
          : <StaffSelect id={id} value={who === row?.holder_membership_id ? '' : who} onChange={setHolder} invalid={!!err} allowNone noneLabel={t('guard.keys.holderSelf', { name: row?.holder_name ?? '—' })} />}</Field>
        <Field label={t('guard.noteOptional')}>{(id) => <Input id={id} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

export function KeyLog({ from, to, page, onPage }: { from: string; to: string; page: number; onPage: (p: number) => void }) {
  const t = useT();
  const { branchId } = useSession();
  const q = useQuery({
    queryKey: ['security', 'keys', 'log', branchId, from, to, page],
    queryFn: () => api<{ data: { id: string; action: 'out' | 'in'; room_name: string; holder_name: string; note: string | null; by_name: string; at: string }[]; meta: { total: number; page_size: number } }>(`/security/keys/log${qs({ branch_id: branchId, from, to, page, page_size: 30 })}`),
    placeholderData: (prev) => prev,
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={4} />;
  if (!q.data.data.length) return <EmptyState compact icon={<KeyRound />} title={t('guard.keys.emptyLog')} />;
  return (
    <>
      <Table>
        <thead><tr><Th>{t('guard.col.time')}</Th><Th>{t('guard.col.room')}</Th><Th>{t('guard.col.action')}</Th><Th>{t('guard.col.who')}</Th><Th className="hidden md:table-cell">{t('guard.col.by')}</Th></tr></thead>
        <tbody>{q.data.data.map((k) => (
          <tr key={k.id}>
            <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(k.at)}</Td>
            <Td className="font-semibold text-slate-900">{k.room_name}</Td>
            <Td><Badge tone={k.action === 'out' ? 'yellow' : 'green'}>{t(`guard.keys.action.${k.action}` as MessageKey)}</Badge></Td>
            <Td className="min-w-[8rem]">{k.holder_name}{k.note && <div className="text-small text-slate-600">{k.note}</div>}</Td>
            <Td className="hidden md:table-cell">{k.by_name}</Td>
          </tr>
        ))}</tbody>
      </Table>
      {q.data.meta.total > q.data.meta.page_size && <Pagination page={page} pageSize={q.data.meta.page_size} total={q.data.meta.total} onPage={onPage} />}
    </>
  );
}
