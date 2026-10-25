'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Footprints } from 'lucide-react';
import { PATROL_INTERVAL_HOURS } from '@meduza/contracts';
import { api } from '@/lib/api';
import { addDays } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Button, Card, PageHeader, useToast } from '@/components/ui';
import { PatrolCurrent, RoundsHistory, useCurrentRound } from '@/components/guard/patrol';
import { useGuardedMutation, useWriteBranch } from '@/components/guard/common';

/** Obxod: start a round, mark every checkpoint, finish; the last rounds below. */
export default function PatrolPage() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useSession();
  const branchId = useWriteBranch();
  const q = useCurrentRound();
  const [page, setPage] = useState(1);
  const start = useGuardedMutation({
    mutationFn: () => api('/security/rounds', { method: 'POST', body: { branch_id: branchId || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security'] }); toast.success(t('guard.pat.started')); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['security'] }); },
  });
  // a round belongs to the guard's open post shift (the server answers 409 SHIFT_REQUIRED otherwise)
  const canStart = !!q.data && !q.data.round && q.data.checkpoints.length > 0 && q.data.shift_open;
  return (
    <>
      <PageHeader title={t('guard.pat.title')} subtitle={t('guard.pat.subtitle', { n: PATROL_INTERVAL_HOURS })}
        actions={canStart ? <Button variant="primary" icon={<Footprints className="h-5 w-5" />} loading={start.isPending} onClick={() => start.run()}>{t('guard.pat.start')}</Button> : undefined} />
      <Card padded={false} className="mb-5"><PatrolCurrent q={q} /></Card>
      <Card padded={false} title={t('guard.pat.history')}>
        <RoundsHistory from={addDays(me.today, -1)} to={me.today} page={page} onPage={setPage} />
      </Card>
    </>
  );
}
