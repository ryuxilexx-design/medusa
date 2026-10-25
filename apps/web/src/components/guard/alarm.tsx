'use client';
// The manager's alarm banner (every screen): an unseen «Rahbarga xabar» from the guard, or an alert the guard
// escalated. Polled every 30 s; in-app only (no external channel exists for staff notices).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Siren } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { fmtTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Button, LinkButton, useToast } from '@/components/ui';

type Alarms = { data: {
  sos: { id: string; number: number; sos_reason: string; reported_at: string; reported_by_name: string; branch_name: string }[];
  escalated: { id: string; kind: string; occurred_at: string; camera_name: string; branch_name: string; actor_name: string; acted_at: string }[];
} };

export function SecurityAlarm() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['security', 'alarms'], queryFn: () => api<Alarms>('/security/alarms'), refetchInterval: 30_000, retry: false });
  const seen = useMutation({
    mutationFn: (id: string) => api(`/security/incidents/${id}/seen`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security'] }),
    onError: (e) => toast.error(e),
  });
  const sos = q.data?.data.sos ?? [], esc = q.data?.data.escalated ?? [];
  if (!sos.length && !esc.length) return null;
  return (
    <div role="alert" data-testid="security-alarm" className="sticky top-20 z-sticky mx-3 mt-3 space-y-2 print:hidden sm:mx-4 lg:mx-8">
      {sos.slice(0, 2).map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-surface border-2 border-red-600 bg-red-600 px-4 py-3 text-white shadow-popover">
          <Siren className="h-6 w-6 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold">{t('guard.alarm.sos', { reason: t(`guard.sos.reason.${s.sos_reason}` as MessageKey) })}</div>
            <div className="text-sm text-red-50">{t('guard.alarm.sosMeta', { branch: s.branch_name, time: fmtTime(s.reported_at), name: s.reported_by_name })}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/security?tab=incidents&open=${s.id}`} size="sm">{t('guard.alarm.open')}</LinkButton>
            <Button size="sm" loading={seen.isPending && seen.variables === s.id} onClick={() => seen.mutate(s.id)}>{t('guard.alarm.seen')}</Button>
          </div>
        </div>
      ))}
      {esc.slice(0, 2).map((e) => (
        <div key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-surface border-2 border-violet-300 bg-violet-50 px-4 py-3 text-violet-900 shadow-popover">
          <Siren className="h-6 w-6 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold">{t('guard.alarm.escalated', { kind: t(`cam.kind.${e.kind}` as MessageKey) })}</div>
            <div className="text-sm">{t('guard.alarm.sosMeta', { branch: `${e.camera_name}, ${e.branch_name}`, time: fmtTime(e.acted_at), name: e.actor_name })}</div>
          </div>
          <LinkButton href="/security?tab=alerts" size="sm">{t('guard.alarm.open')}</LinkButton>
        </div>
      ))}
    </div>
  );
}
