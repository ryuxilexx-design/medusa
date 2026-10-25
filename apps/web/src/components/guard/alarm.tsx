'use client';
// In-app alarms of the security section (no staff channel outside the app exists — docs/SECURITY_GUARD.md):
//  * the manager's banner (every screen): an unseen «Rahbarga xabar», an alert the guard escalated, an overdue alert.
//    Compact: one row on a phone, three on a wide screen, the rest as «+N». Polled every 30 s, also in a background tab.
//  * the guard's shell: the open-alert badge on «Qo‘riqlash paneli» and a short beep (Web Audio) when a new alert
//    arrives — the person can switch the sound off; browsers allow sound only after the first tap, so it is armed then.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hourglass, Siren, Volume2, VolumeX } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { fmtDateTime, fmtTime, localDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Button, cx, LinkButton, useToast } from '@/components/ui';

type Alarms = { data: {
  sos: { id: string; number: number; sos_reason: string; reported_at: string; reported_by_name: string; branch_name: string }[];
  escalated: { id: string; kind: string; occurred_at: string; camera_name: string; branch_name: string; actor_name: string; acted_at: string }[];
  overdue: { id: string; kind: string; occurred_at: string; camera_name: string; branch_name: string; state: 'new' | 'taken'; actor_name: string | null; acted_at: string | null }[];
} };

/** UI preferences only (allowed in browser storage): the dismissed overdue rows of this tab, the guard's sound switch. */
const DISMISSED = 'meduza.alarmDismissed', SOUND = 'meduza.guardSound';
const readSet = (k: string) => { try { return new Set<string>(JSON.parse(sessionStorage.getItem(k) ?? '[]')); } catch { return new Set<string>(); } };

export function SecurityAlarm() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useSession();
  const q = useQuery({ queryKey: ['security', 'alarms'], queryFn: () => api<Alarms>('/security/alarms'), refetchInterval: 30_000, refetchIntervalInBackground: true, retry: false });
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  useEffect(() => setDismissed(readSet(DISMISSED)), []);
  const dismiss = (id: string) => setDismissed((s) => { const n = new Set(s).add(id); try { sessionStorage.setItem(DISMISSED, JSON.stringify([...n])); } catch { /* private mode */ } return n; });
  const seen = useMutation({
    mutationFn: (id: string) => api(`/security/incidents/${id}/seen`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security'] }),
    onError: (e) => toast.error(e),
  });
  const d = q.data?.data;
  const when = (iso: string) => (localDate(iso) === me.today ? fmtTime(iso) : fmtDateTime(iso));
  const items: { key: string; node: React.ReactNode }[] = [
    ...(d?.sos ?? []).map((s) => ({ key: s.id, node: (
      <Row tone="red" title={t('guard.alarm.sos', { reason: t(`guard.sos.reason.${s.sos_reason}` as MessageKey) })} meta={t('guard.alarm.sosMeta', { branch: s.branch_name, time: when(s.reported_at), name: s.reported_by_name })}>
        <LinkButton href={`/security?tab=incidents&open=${s.id}`} size="sm">{t('guard.alarm.open')}</LinkButton>
        <Button size="sm" loading={seen.isPending && seen.variables === s.id} onClick={() => seen.mutate(s.id)}>{t('guard.alarm.seen')}</Button>
      </Row>
    ) })),
    ...(d?.escalated ?? []).map((e) => ({ key: e.id, node: (
      <Row tone="violet" title={t('guard.alarm.escalated', { kind: t(`cam.kind.${e.kind}` as MessageKey) })} meta={t('guard.alarm.sosMeta', { branch: `${e.camera_name}, ${e.branch_name}`, time: when(e.acted_at), name: e.actor_name })}>
        <LinkButton href="/security?tab=alerts" size="sm">{t('guard.alarm.open')}</LinkButton>
      </Row>
    ) })),
    ...(d?.overdue ?? []).filter((o) => !dismissed.has(o.id)).map((o) => ({ key: o.id, node: (
      <Row tone="amber" overdue title={t('guard.alarm.overdue', { kind: t(`cam.kind.${o.kind}` as MessageKey) })}
        meta={o.state === 'taken' && o.actor_name ? t('guard.alarm.overdueTaken', { camera: o.camera_name, branch: o.branch_name, time: when(o.occurred_at), name: o.actor_name })
          : t('guard.alarm.overdueNew', { camera: o.camera_name, branch: o.branch_name, time: when(o.occurred_at) })}>
        <LinkButton href="/security?tab=alerts" size="sm">{t('guard.alarm.open')}</LinkButton>
        <Button size="sm" onClick={() => dismiss(o.id)}>{t('guard.alarm.seen')}</Button>
      </Row>
    ) })),
  ];
  if (!items.length) return null;
  const restPhone = items.length - 1, restWide = items.length - 3;
  return (
    <div role="alert" data-testid="security-alarm" className="sticky top-20 z-sticky mx-3 mt-3 space-y-2 print:hidden sm:mx-4 lg:mx-8">
      {items.slice(0, 3).map((it, i) => <div key={it.key} className={i > 0 ? 'hidden sm:block' : undefined}>{it.node}</div>)}
      {(restPhone > 0 || restWide > 0) && (
        <div className="flex justify-end">
          <Link href="/security?tab=alerts" className={cx('inline-flex min-h-control-sm items-center rounded-full bg-red-600 px-4 text-small font-bold text-white shadow-popover', restWide > 0 ? '' : 'sm:hidden')}
            data-testid="alarm-more">
            <span className="sm:hidden">{t('guard.alarm.more', { n: restPhone })}</span>
            <span className="hidden sm:inline">{t('guard.alarm.more', { n: Math.max(0, restWide) })}</span>
          </Link>
        </div>
      )}
    </div>
  );
}

function Row({ tone, title, meta, overdue, children }: { tone: 'red' | 'violet' | 'amber'; title: string; meta: string; overdue?: boolean; children: React.ReactNode }) {
  const Icon = overdue ? Hourglass : Siren;
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-surface border-2 px-3 py-2 shadow-popover sm:flex-nowrap sm:px-4',
      tone === 'red' ? 'border-red-600 bg-red-600 text-white' : tone === 'violet' ? 'border-violet-300 bg-violet-50 text-violet-900' : 'border-amber-400 bg-amber-50 text-amber-950')}>
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      {/* a phone: the text keeps its own line, the buttons wrap below it */}
      <div className="min-w-0 flex-1 basis-48">
        <div className="truncate text-body font-bold">{title}</div>
        <div className={cx('truncate text-small', tone === 'red' ? 'text-red-50' : '')}>{meta}</div>
      </div>
      <div className="flex shrink-0 gap-2">{children}</div>
    </div>
  );
}

type Pulse = { data: { open: number; new: number; overdue: number; newest_at: string | null } };
/** The guard's open/new/overdue alerts, polled every 15 s on every page (also when the tab is in the background). */
export function useGuardPulse() {
  const { branchId } = useSession();
  return useQuery({ queryKey: ['security', 'pulse', branchId], queryFn: () => api<Pulse>(`/security/pulse${qs({ branch_id: branchId })}`).then((r) => r.data),
    refetchInterval: 15_000, refetchIntervalInBackground: true, retry: false });
}

/** The red count on «Qo‘riqlash paneli» (side menu and tab bar). */
export function GuardBadge({ className }: { className?: string }) {
  const t = useT();
  const q = useGuardPulse();
  const n = q.data?.open ?? 0;
  if (!n) return null;
  return (
    <span data-testid="guard-badge" aria-label={t('guard.shell.badge', { n })}
      className={cx('inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-2xs font-bold tabular-nums text-white', q.data?.overdue ? 'bg-red-600' : 'bg-amber-600', className)}>{n}</span>
  );
}

/** Two short tones; the context is created on the first tap (browsers refuse sound before a user gesture). */
function useBeep() {
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => {
    const arm = () => {
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!ctx.current && AC) ctx.current = new AC();
        void ctx.current?.resume();
      } catch { /* no audio: the badge still shows */ }
    };
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => { window.removeEventListener('pointerdown', arm); window.removeEventListener('keydown', arm); };
  }, []);
  return () => {
    const c = ctx.current;
    if (!c || c.state !== 'running') return;
    [0, 0.28].forEach((at, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = i ? 660 : 880;
      g.gain.setValueAtTime(0.0001, c.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + 0.22);
      o.connect(g).connect(c.destination); o.start(c.currentTime + at); o.stop(c.currentTime + at + 0.25);
    });
  };
}

/** The guard's top-bar switch: sound on/off (on by default), and the beep when a new alert arrives. */
export function GuardSoundToggle() {
  const t = useT();
  const q = useGuardPulse();
  const beep = useBeep();
  const [on, setOn] = useState(true);
  useEffect(() => { try { setOn(localStorage.getItem(SOUND) !== 'off'); } catch { /* storage blocked: default on */ } }, []);
  const last = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const newest = q.data?.newest_at ?? null;
    // the first reading only sets the mark: a beep means «something new since you are here»
    if (last.current !== undefined && newest && (!last.current || newest > last.current) && on) beep();
    if (q.data) last.current = newest ?? last.current ?? null;
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => setOn((v) => { try { localStorage.setItem(SOUND, v ? 'off' : 'on'); } catch { /* ignore */ } return !v; });
  return (
    <Button variant="ghost" size="icon" className="!text-slate-800" onClick={toggle} aria-pressed={on} aria-label={on ? t('guard.shell.soundOn') : t('guard.shell.soundOff')}
      title={t('guard.shell.sound')} data-testid="guard-sound">
      {on ? <Volume2 className="h-6 w-6" /> : <VolumeX className="h-6 w-6" />}
    </Button>
  );
}
