'use client';
// Post shifts as a list (the guard's «Oxirgi smenalar», the manager's «Smenalar»): a table from `sm`, stacked rows on a
// phone (no hidden columns). An abandoned («stale») shift is marked; the manager closes it with a reason.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, Printer } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Badge, Button, Field, Modal, ModalCancel, Table, Td, Textarea, TextLink, Th, useToast } from '@/components/ui';
import { fmtWhen, NameHint, useGuardedMutation } from './common';

export type ShiftRow = { id: string; number: number; branch_name: string; guard_name: string; opened_at: string; closed_at: string | null; rounds: number; stale: boolean; forced: boolean };

function State({ r }: { r: ShiftRow }) {
  const t = useT();
  if (r.closed_at) return <>{fmtWhen(r.closed_at, r.opened_at)}{r.forced && <Badge tone="violet" className="ml-2" icon={<Lock className="h-4 w-4" />}>{t('guard.shift.forced')}</Badge>}</>;
  return r.stale ? <Badge tone="red">{t('guard.shift.staleBadge')}</Badge> : <Badge tone="blue">{t('guard.shift.openNow')}</Badge>;
}

export function ShiftList({ rows, manager }: { rows: ShiftRow[]; manager?: boolean }) {
  const t = useT();
  const [closing, setClosing] = useState<ShiftRow | null>(null);
  const report = (r: ShiftRow) => <TextLink href={`/print/guard-shift/${r.id}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('guard.shift.report')}</TextLink>;
  const force = (r: ShiftRow) => manager && !r.closed_at
    ? <Button size="sm" variant={r.stale ? 'danger' : 'secondary'} onClick={() => setClosing(r)} data-testid="shift-force">{t('guard.shift.forceClose')}</Button> : null;
  return (
    <>
      <ul className="divide-y divide-slate-100 sm:hidden" data-testid="shifts-stacked">
        {rows.map((r) => (
          <li key={r.id} className={r.stale ? 'bg-red-50/50 px-4 py-3' : 'px-4 py-3'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-slate-900">№{r.number} · {r.guard_name}</span>
              <span className="text-small tabular-nums text-slate-700"><State r={r} /></span>
            </div>
            <div className="mt-0.5 text-small tabular-nums text-slate-600">{t('guard.col.opened')}: {fmtDateTime(r.opened_at)} · {t('guard.shift.rounds', { n: r.rounds })}</div>
            <div className="mt-1 flex flex-wrap items-center gap-3">{report(r)}{force(r)}</div>
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table>
          <thead><tr><Th>{t('guard.col.number')}</Th><Th>{t('guard.sec.guard')}</Th><Th>{t('guard.col.opened')}</Th><Th>{t('guard.col.closed')}</Th><Th>{t('guard.col.round')}</Th><Th right><span className="sr-only">{t('guard.col.actions')}</span></Th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={r.stale ? 'bg-red-50/50' : undefined}>
              <Td className="tabular-nums">{r.number}</Td><Td>{r.guard_name}</Td>
              <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(r.opened_at)}</Td>
              <Td className="whitespace-nowrap tabular-nums"><State r={r} /></Td>
              <Td>{t('guard.shift.rounds', { n: r.rounds })}</Td>
              <Td right><div className="flex flex-wrap items-center justify-end gap-3">{force(r)}{report(r)}</div></Td>
            </tr>
          ))}</tbody>
        </Table>
      </div>
      <ForceCloseModal row={closing} onClose={() => setClosing(null)} />
    </>
  );
}

/** The manager closes a shift the guard left open: the reason is required (kept on the shift, not in the audit). */
function ForceCloseModal({ row, onClose }: { row: ShiftRow | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const close = () => { setReason(''); setErr(undefined); onClose(); };
  const m = useGuardedMutation({
    mutationFn: () => api(`/security/shifts/${row!.id}/force-close`, { method: 'POST', body: { reason: reason.trim() } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t('guard.shift.forceDone')); close(); },
    onError: (e) => {
      setErr(e instanceof ApiError ? e.fields?.reason : undefined); toast.error(e);
      if (e instanceof ApiError && e.status === 409) { qc.invalidateQueries({ queryKey: ['security'] }); close(); }
    },
  });
  return (
    <Modal open={!!row} onClose={close} dirty={!!reason} title={row ? t('guard.shift.forceTitle', { n: row.number }) : ''}
      footer={<><ModalCancel /><Button variant="danger" loading={m.isPending} onClick={() => { if (reason.trim().length < 3) { setErr(t('api.v.min', { label: t('guard.shift.forceReason'), min: 3 })); return; } m.run(); }}>{t('guard.shift.forceClose')}</Button></>}>
      {row && (
        <div className="space-y-4">
          <p className="text-body text-slate-800">{t('guard.shift.forceText', { name: row.guard_name, time: fmtDateTime(row.opened_at) })}</p>
          <div>
            <Field label={t('guard.shift.forceReason')} required error={err} hint={t('guard.shift.forceHint')}>{(id) => (
              <Textarea id={id} rows={3} maxLength={500} value={reason} invalid={!!err} onChange={(e) => setReason(e.target.value)} data-autofocus />
            )}</Field>
            <NameHint text={reason} />
          </div>
        </div>
      )}
    </Modal>
  );
}
