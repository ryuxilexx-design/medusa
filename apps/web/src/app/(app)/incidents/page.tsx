'use client';
import { useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { addDays } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Button, Card, PageHeader, Segmented, Toolbar } from '@/components/ui';
import { PeriodPicker } from '@/components/finance-extra';
import { IncidentFormModal, IncidentList, useIncidents } from '@/components/guard/incidents';

/** Hodisalar jurnali: open incidents first; the log of a period; «Hodisa yozish». */
export default function IncidentsPage() {
  const t = useT();
  const { me } = useSession();
  const [view, setView] = useState<'open' | 'all'>('open');
  const [from, setFrom] = useState(addDays(me.today, -6)), [to, setTo] = useState(me.today);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const q = useIncidents(view === 'open' ? { status: 'open', page } : { from, to, page });
  return (
    <>
      <PageHeader title={t('guard.inc.title')} subtitle={t('guard.inc.subtitle')}
        actions={<Button variant="primary" icon={<NotebookPen className="h-5 w-5" />} onClick={() => setAdding(true)} data-testid="incident-add">{t('guard.inc.add')}</Button>} />
      <Card padded={false}>
        <Toolbar>
          <Segmented label={t('guard.inc.title')} role="tablist" value={view} onChange={(v) => { setView(v); setPage(1); }}
            options={[{ value: 'open', label: t('guard.inc.open') }, { value: 'all', label: t('guard.inc.all') }]} />
          {view === 'all' && <PeriodPicker from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); setPage(1); }} />}
        </Toolbar>
        <IncidentList q={q} mode="guard" emptyTitle={view === 'open' ? t('guard.inc.empty') : t('guard.inc.emptyPeriod')} page={page} onPage={setPage} />
      </Card>
      <IncidentFormModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
