'use client';
import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Button, Card, PageHeader, Segmented, Toolbar } from '@/components/ui';
import { PeriodPicker } from '@/components/finance-extra';
import { VisitorFormModal, VisitorLog, VisitorsInside, useVisitorsInside } from '@/components/guard/visitors';

/** Tashrif buyuruvchilar: who is inside now (with «Chiqdi»), and the log of a period. */
export default function VisitorsPage() {
  const t = useT();
  const { me } = useSession();
  const [view, setView] = useState<'inside' | 'log'>('inside');
  const [from, setFrom] = useState(me.today), [to, setTo] = useState(me.today);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const inside = useVisitorsInside();
  return (
    <>
      <PageHeader title={t('guard.vis.title')} subtitle={t('guard.vis.subtitle')}
        actions={<Button variant="primary" icon={<UserPlus className="h-5 w-5" />} onClick={() => setAdding(true)} data-testid="visitor-add">{t('guard.vis.add')}</Button>} />
      <Card padded={false}>
        <Toolbar>
          <Segmented label={t('guard.vis.title')} role="tablist" value={view} onChange={setView}
            options={[{ value: 'inside', label: `${t('guard.vis.inside')}${inside.data ? ` (${inside.data.length})` : ''}` }, { value: 'log', label: t('guard.vis.log') }]} />
          {view === 'log' && <PeriodPicker from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); setPage(1); }} />}
        </Toolbar>
        {view === 'inside' ? <VisitorsInside /> : <VisitorLog from={from} to={to} page={page} onPage={setPage} />}
      </Card>
      <VisitorFormModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
