'use client';
// Staff on site today: the entrance camera's matches of staff codes (consented) and the guard's manual marks.
// Doctors are compared with their schedule. Never a patient.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, Clock, Hand, Hourglass, LogOut, Moon, UserX } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { fmtTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Button, cx, EmptyState, ErrorState, Field, LoadingRows, Modal, ModalCancel, Segmented, type Tone, useToast } from '@/components/ui';
import { ic, StaffSelect, useGuardedMutation, useWriteBranch } from './common';

export type PresenceRow = {
  membership_id: string; full_name: string; title: string | null; role: string; specialty: string | null; status: 'in' | 'left' | 'expected' | 'absent' | 'off';
  first_at: string | null; last_at: string | null; source: 'camera' | 'manual' | null; planned_start: string | null; late_min: number | null;
};
export function usePresence() {
  const { branchId } = useSession();
  return useQuery({ queryKey: ['security', 'presence', branchId], queryFn: () => api<{ data: PresenceRow[]; meta: { in: number; late: number; absent: number } }>(`/security/presence${qs({ branch_id: branchId })}`), refetchInterval: 60_000 });
}

const ST: Record<PresenceRow['status'], { tone: Tone; icon: React.ElementType }> = {
  in: { tone: 'green', icon: CheckCircle2 }, left: { tone: 'gray', icon: LogOut }, expected: { tone: 'blue', icon: Hourglass }, absent: { tone: 'red', icon: UserX }, off: { tone: 'gray', icon: Moon },
};

export function PresenceList({ q }: { q: ReturnType<typeof usePresence> }) {
  const t = useT();
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={6} />;
  if (!q.data.data.length) return <EmptyState compact title={t('guard.site.empty')} />;
  return (
    <ul className="divide-y divide-slate-100">
      {q.data.data.map((r) => {
        const s = ST[r.status], Icon = s.icon;
        return (
          <li key={r.membership_id} data-staff={r.full_name} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1 basis-48">
              <div className="font-semibold text-slate-900">{r.full_name}</div>
              <div className="text-small text-slate-600">{r.specialty ?? r.title ?? t(`role.${r.role}` as MessageKey)}</div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-slate-700">
              {r.first_at && <span className="inline-flex items-center gap-1 tabular-nums">{r.source === 'camera' ? <Camera className={ic} aria-label={t('guard.site.camera')} /> : <Hand className={ic} aria-label={t('guard.site.manual')} />}{t('guard.site.arrived', { time: fmtTime(r.first_at) })}</span>}
              {!r.first_at && r.planned_start && <span className="inline-flex items-center gap-1 tabular-nums"><Clock className={ic} aria-hidden="true" />{t('guard.site.planned', { time: r.planned_start })}</span>}
              {(r.late_min ?? 0) > 0 && <Badge tone="yellow">{t('guard.site.late', { n: r.late_min! })}</Badge>}
              <Badge tone={s.tone} icon={<Icon className={ic} />}>{t(`guard.site.st.${r.status}` as MessageKey)}</Badge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PresenceMarkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const branchId = useWriteBranch();
  const [who, setWho] = useState('');
  const [kind, setKind] = useState<'in' | 'out'>('in');
  const [err, setErr] = useState<string | undefined>();
  const close = () => { setWho(''); setKind('in'); setErr(undefined); onClose(); };
  const m = useGuardedMutation({
    mutationFn: () => api('/security/presence', { method: 'POST', body: { branch_id: branchId || null, membership_id: who, kind } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t('guard.site.marked')); close(); },
    onError: (e) => { setErr(e instanceof ApiError ? e.fields?.membership_id : undefined); toast.error(e); },
  });
  return (
    <Modal open={open} onClose={close} title={t('guard.site.markTitle')}
      footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} onClick={() => { if (!who) { setErr(t('guard.staffPick')); return; } m.run(); }}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        {!branchId && <Alert tone="yellow">{t('guard.branchPick')}</Alert>}
        <Field label={t('guard.col.who')} required error={err}>{(id) => <StaffSelect id={id} value={who} onChange={setWho} invalid={!!err} />}</Field>
        <Segmented label={t('guard.site.markTitle')} value={kind} onChange={setKind} stretch className={cx('w-full')}
          options={[{ value: 'in', label: t('guard.site.in') }, { value: 'out', label: t('guard.site.outMark') }]} />
      </div>
    </Modal>
  );
}
