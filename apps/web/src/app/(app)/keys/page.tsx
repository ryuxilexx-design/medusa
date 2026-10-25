'use client';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Card, PageHeader, Segmented, Toolbar } from '@/components/ui';
import { PeriodPicker } from '@/components/finance-extra';
import { KeyLog, KeysNow, useKeys } from '@/components/guard/keys';

/** Kalitlar: every room's key now (give / take back), and the log of a period. */
export default function KeysPage() {
  const t = useT();
  const { me } = useSession();
  const [view, setView] = useState<'now' | 'log'>('now');
  const [from, setFrom] = useState(me.today), [to, setTo] = useState(me.today);
  const [page, setPage] = useState(1);
  const keys = useKeys();
  const out = keys.data?.filter((k) => k.out).length ?? 0, overdue = keys.data?.filter((k) => k.overdue).length ?? 0;
  return (
    <>
      <PageHeader title={t('guard.keys.title')} subtitle={t('guard.keys.subtitle')} />
      <Card padded={false}>
        <Toolbar actions={view === 'now' && keys.data ? <div className="flex flex-wrap gap-2"><Badge tone={out ? 'yellow' : 'gray'}>{t('guard.keys.outCount', { n: out })}</Badge>{overdue > 0 && <Badge tone="red">{t('guard.keys.overdueCount', { n: overdue })}</Badge>}</div> : undefined}>
          <Segmented label={t('guard.keys.title')} role="tablist" value={view} onChange={setView} options={[{ value: 'now', label: t('guard.keys.now') }, { value: 'log', label: t('guard.keys.log') }]} />
          {view === 'log' && <PeriodPicker from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); setPage(1); }} />}
        </Toolbar>
        {view === 'now' ? <KeysNow /> : <KeyLog from={from} to={to} page={page} onPage={setPage} />}
      </Card>
    </>
  );
}
