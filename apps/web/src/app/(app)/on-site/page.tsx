'use client';
import { useState } from 'react';
import { Clock, Hand, UserCheck, UserX } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Button, Card, PageHeader, StatCard } from '@/components/ui';
import { PresenceList, PresenceMarkModal, usePresence } from '@/components/guard/presence';

/** Xodimlar binoda: who is in today (camera + manual marks), late against the schedule, not yet arrived. */
export default function OnSitePage() {
  const t = useT();
  const q = usePresence();
  const [marking, setMarking] = useState(false);
  const m = q.data?.meta;
  return (
    <>
      <PageHeader title={t('guard.site.title')} subtitle={t('guard.site.subtitle')}
        actions={<Button variant="primary" icon={<Hand className="h-5 w-5" />} onClick={() => setMarking(true)}>{t('guard.site.mark')}</Button>} />
      {!(q.isError && !m) && (
        <div className="mb-5 grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 sm:grid-cols-3">
          <StatCard icon={<UserCheck />} tone="success" label={t('guard.site.statIn')} loading={!m} value={m?.in} />
          <StatCard icon={<Clock />} label={t('guard.site.statLate')} loading={!m} value={m?.late} />
          <StatCard icon={<UserX />} tone={m?.absent ? 'danger' : 'default'} label={t('guard.site.statAbsent')} loading={!m} value={m?.absent} />
        </div>
      )}
      <Card padded={false}><PresenceList q={q} /></Card>
      <PresenceMarkModal open={marking} onClose={() => setMarking(false)} />
    </>
  );
}
