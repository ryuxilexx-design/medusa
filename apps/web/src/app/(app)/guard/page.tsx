'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, CameraOff, Cctv, CheckCircle2, Contact, KeyRound, NotebookPen, ShieldAlert, UserCheck, Users } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { fmtDateTime, fmtTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Badge, Card, cx, EmptyState, ErrorState, LinkButton, LoadingRows, PageHeader, Segmented, StatCard, TextLink } from '@/components/ui';
import { AlertFeed, useAlertsFeed } from '@/components/guard/alerts';
import { ic, useNow } from '@/components/guard/common';

type Overview = { data: {
  counters: { open_alerts: number; overdue_alerts: number; handled_today: number; people_today: number; visitors_inside: number; keys_out: number; open_incidents: number; staff_on_site: number; expected_today: number };
  arrivals_by_hour: { hour: number; n: number; came: number }[];
  cameras: { id: string; name: string; location: string | null; branch_name: string; last_seen_at: string | null; tamper: boolean; health: 'online' | 'silent' | 'off' | 'never' }[];
  recent_faces: { at: string; camera_name: string; subject: 'staff' | 'patient'; name?: string; title?: string | null; role?: string }[];
} };
type Shift = { data: { shift: { id: string; number: number; opened_at: string } | null } };

/**
 * The guard's home: what needs attention now (alerts first, overdue on top, «Yana N ta» — never a silent cut-off), the
 * post's numbers, cameras and today's flow (counts only). «Rahbarga xabar» lives in the top bar of every guard page.
 */
export default function GuardPanel() {
  const t = useT();
  const { me, branchId } = useSession();
  const ov = useQuery({ queryKey: ['security', 'overview', branchId], queryFn: () => api<Overview>(`/security/overview${qs({ branch_id: branchId })}`).then((r) => r.data), refetchInterval: 30_000 });
  const shift = useQuery({ queryKey: ['security', 'shift', branchId], queryFn: () => api<Shift>(`/security/shifts/current${qs({ branch_id: branchId })}`).then((r) => r.data) });
  const [view, setView] = useState<'open' | 'today'>('open');
  const alerts = useAlertsFeed(view === 'open' ? { state: 'open' } : { from: me.today, to: me.today });
  const c = ov.data?.counters;
  const s = shift.data?.shift;
  return (
    <>
      <PageHeader title={t('guard.panel.title')} subtitle={s ? t('guard.panel.shiftOpen', { n: s.number, time: fmtTime(s.opened_at) }) : t('guard.panel.subtitle')} />
      {shift.data && !s && (
        <div className="mb-5">
          <Alert tone="yellow" title={t('guard.panel.noShift')}>
            <LinkButton href="/post" size="sm" className="mt-2">{t('guard.panel.openShift')}</LinkButton>
          </Alert>
        </div>
      )}
      {!(ov.isError && !c) && (
        <div className="mb-5 grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<ShieldAlert />} tone={c?.open_alerts ? 'danger' : 'success'} label={t('guard.stat.openAlerts')} loading={!c} value={c?.open_alerts}
            sub={c && (c.overdue_alerts ? <span className="font-bold text-red-700">{t('guard.stat.overdue', { n: c.overdue_alerts })}</span> : `${t('guard.stat.handledToday')}: ${c.handled_today}`)} />
          <StatCard icon={<UserCheck />} label={t('guard.stat.onSite')} loading={!c} value={c?.staff_on_site} href="/on-site" />
          <StatCard icon={<Contact />} label={t('guard.stat.visitors')} loading={!c} value={c?.visitors_inside} href="/visitors" />
          <StatCard icon={<KeyRound />} label={t('guard.stat.keysOut')} loading={!c} value={c?.keys_out} href="/keys" />
        </div>
      )}
      {/* open incidents: their own line next to the alerts, a link to the log (not a footnote under «keys») */}
      {!!c?.open_incidents && (
        <p className="-mt-2 mb-4 flex flex-wrap items-center gap-x-2 text-body font-semibold text-amber-900" data-testid="open-incidents">
          <NotebookPen className="h-5 w-5 shrink-0" aria-hidden="true" />{t('guard.shift.incidentsOpen', { n: c.open_incidents })}
          <TextLink href="/incidents">{t('nav.incidents')}</TextLink>
        </p>
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card padded={false} className="min-w-0 self-start xl:col-span-2" title={t('guard.alerts.title')}
          actions={<Segmented label={t('guard.alerts.title')} size="compact" value={view} onChange={setView}
            options={[{ value: 'open', label: t('guard.alerts.open') }, { value: 'today', label: t('guard.alerts.today') }]} />}>
          <AlertFeed q={alerts.feed} more={alerts.more} mode="guard" emptyTitle={view === 'open' ? t('guard.alerts.empty') : t('guard.alerts.emptyPeriod')} />
        </Card>
        <div className="min-w-0 space-y-5">
          <Cameras q={ov} />
          <Arrivals q={ov} />
          <Faces q={ov} />
        </div>
      </div>
    </>
  );
}

function Cameras({ q }: { q: { data?: Overview['data']; isError: boolean; error: unknown; refetch: () => void } }) {
  const t = useT();
  const tone = { online: 'green', silent: 'yellow', off: 'gray', never: 'gray' } as const;
  return (
    <Card padded={false} title={t('guard.cams.title')}>
      {q.isError && !q.data ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <LoadingRows rows={3} /> : !q.data.cameras.length ? <EmptyState compact icon={<Cctv />} title={t('guard.cams.empty')} /> : (
        <ul className="divide-y divide-slate-100">
          {q.data.cameras.map((cam) => (
            <li key={cam.id} className="flex items-center gap-3 px-5 py-2.5">
              {cam.health === 'online' ? <Camera className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" /> : <CameraOff className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-900">{cam.name}</div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  <Badge tone={tone[cam.health]}>{t(`guard.cams.${cam.health}` as MessageKey)}</Badge>
                  {cam.tamper && <Badge tone="red" icon={<ShieldAlert className={ic} />}>{t('guard.cams.tamper')}</Badge>}
                </div>
                <div className="mt-0.5 text-small text-slate-600">{cam.last_seen_at ? t('guard.cams.lastSeen', { at: fmtDateTime(cam.last_seen_at) }) : cam.location}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Expected patients per hour today: bars with counts, never a name. */
function Arrivals({ q }: { q: { data?: Overview['data'] } }) {
  const t = useT();
  const now = useNow();
  const hourNow = Number(fmtTime(now).slice(0, 2));
  const rows = q.data?.arrivals_by_hour ?? [];
  const by = new Map(rows.map((r) => [r.hour, r]));
  const lo = Math.min(8, ...rows.map((r) => r.hour)), hi = Math.max(19, ...rows.map((r) => r.hour));
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const max = Math.max(1, ...rows.map((r) => r.n));
  const total = rows.reduce((s, r) => s + r.n, 0), came = rows.reduce((s, r) => s + r.came, 0);
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return (
    <Card title={t('guard.arrivals.title')}>
      {!q.data ? <LoadingRows rows={2} /> : !total ? <EmptyState compact icon={<Users />} title={t('guard.arrivals.empty')} /> : (
        <>
          <p className="text-body font-semibold text-slate-900">{t('guard.arrivals.total', { n: total, came })}</p>
          <p className="text-small text-slate-600">{t('guard.stat.people')}: <span className="font-semibold tabular-nums text-slate-900">{q.data.counters.people_today}</span></p>
          <ul className="mt-3 flex h-28 items-end gap-1 border-b border-slate-300" aria-label={t('guard.arrivals.title')}>
            {hours.map((h) => {
              const v = by.get(h)?.n ?? 0;
              return (
                <li key={h} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-0.5" aria-label={t('guard.arrivals.bar', { hour: hh(h), n: v })}>
                  <span aria-hidden="true" className="text-2xs font-semibold tabular-nums text-slate-700">{v || ''}</span>
                  <span aria-hidden="true" className={cx('block w-full max-w-6 rounded-t', h === hourNow ? 'bg-brand-700' : h < hourNow ? 'bg-slate-300' : 'bg-brand-400')} style={{ height: `${(v / max) * 5}rem` }} />
                </li>
              );
            })}
          </ul>
          <div aria-hidden="true" className="mt-1 flex gap-1">{hours.map((h) => <span key={h} className="min-w-0 flex-1 text-center text-2xs tabular-nums text-slate-600">{h % 2 === 0 ? String(h).padStart(2, '0') : ''}</span>)}</div>
          <p className="mt-2 text-small text-slate-600">{t('guard.arrivals.countsOnly')}</p>
        </>
      )}
    </Card>
  );
}

/** The entrance camera's latest recognitions: staff by name, a patient only as «Bemor». */
function Faces({ q }: { q: { data?: Overview['data'] } }) {
  const t = useT();
  const rows = q.data?.recent_faces ?? [];
  return (
    <Card padded={false} title={t('guard.faces.title')}>
      {!q.data ? <LoadingRows rows={3} /> : !rows.length ? <EmptyState compact icon={<CheckCircle2 />} title={t('guard.faces.empty')} /> : (
        <ul className="divide-y divide-slate-100" data-testid="recent-faces">
          {rows.map((f, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-2.5">
              <span className="w-12 shrink-0 text-small font-semibold tabular-nums text-slate-700">{fmtTime(f.at)}</span>
              <div className="min-w-0 flex-1">
                {f.subject === 'staff'
                  ? <><div className="font-semibold text-slate-900">{f.name}</div><div className="text-small text-slate-600">{f.title ?? t(`role.${f.role}` as MessageKey)} · {f.camera_name}</div></>
                  : <><div className="font-semibold text-slate-700">{t('guard.faces.patient')}</div><div className="text-small text-slate-600">{f.camera_name}</div></>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
