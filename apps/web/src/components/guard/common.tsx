'use client';
// Shared pieces of the security guard's screens (docs/SECURITY_GUARD.md): the write branch, the staff picker, badges.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, type MutateOptions, type UseMutationOptions } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Eye, Flame, ShieldAlert, Siren } from 'lucide-react';
import { INCIDENT_SEVERITIES, type IncidentSeverity, type MessageKey } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { duration, fmtDateTime, fmtTime, localDate } from '@/lib/format';
import { Badge, Chip, Select, type Tone } from '@/components/ui';

export const ic = 'h-4 w-4';

/**
 * A mutation with a synchronous in-flight guard: a second tap while the first request is on its way does nothing —
 * no duplicate row, no «already done» error toast. Guard action buttons call `run(vars)` instead of `mutate`.
 */
export function useGuardedMutation<TData = unknown, TVars = void>(opts: UseMutationOptions<TData, Error, TVars>) {
  const m = useMutation(opts);
  const busy = useRef(false);
  const { mutateAsync } = m;
  const run = useCallback((vars: TVars, callOpts?: MutateOptions<TData, Error, TVars>) => {
    if (busy.current) return;
    busy.current = true;
    mutateAsync(vars, callOpts).catch(() => undefined).finally(() => { busy.current = false; });
  }, [mutateAsync]);
  return { ...m, run };
}

/** «Bemor Aliyev Vali», «пациент Иванова Анна»: free text that seems to name a patient (a soft hint, never a block). */
const PATIENT_NAME_RE = /(?:^|[^\p{L}])(?:[Bb]emor|[Бб]емор|[Пп]ациент(?:ка)?)\s+\p{Lu}[\p{L}‘’'ʻ-]+\s+\p{Lu}[\p{L}‘’'ʻ-]+/u;
export const looksLikePatientName = (s: string) => PATIENT_NAME_RE.test(s);
/** The soft warning under a guard's text field when it seems to name a patient. */
export function NameHint({ text }: { text: string }) {
  const t = useT();
  if (!looksLikePatientName(text)) return null;
  return <p role="status" data-testid="name-hint" className="mt-1 text-small font-semibold text-amber-800">{t('guard.nameWarn')}</p>;
}

/** A time next to another one: the clock only when both fall on the same local day, else the date too (night shifts). */
export const fmtWhen = (iso: string | null | undefined, ref: string | null | undefined) =>
  !iso ? '—' : ref && localDate(iso) === localDate(ref) ? fmtTime(iso) : fmtDateTime(iso);

/** The branch a guard's entry lands in: the selected one, or the person's only branch ('' = ask to pick one). */
export function useWriteBranch() {
  const { me, branchId } = useSession();
  return branchId || (me.branches.length === 1 ? me.branches[0].id : '');
}

/** «Business now» from the demo clock, ticking every 30 s (durations since an event, overdue marks). */
export function useNow(every = 30_000) {
  const { demoNow } = useSession();
  const [now, setNow] = useState(() => demoNow());
  useEffect(() => { const i = setInterval(() => setNow(demoNow()), every); return () => clearInterval(i); }, [demoNow, every]);
  return now;
}
/** «12 daq.» / «1 soat 5 daq.» since an instant. */
export const since = (iso: string, now: Date) => duration(Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000)));

export type StaffOption = { membership_id: string; full_name: string; role: string; title: string | null };
export function useStaff() {
  const { branchId } = useSession();
  return useQuery({ queryKey: ['security', 'staff', branchId], queryFn: () => api<{ data: StaffOption[] }>(`/security/staff${qs({ branch_id: branchId })}`).then((r) => r.data), staleTime: 5 * 60_000 });
}
/** A native select of the branch's staff: name — position. */
export function StaffSelect({ id, value, onChange, invalid, allowNone, noneLabel }: { id: string; value: string; onChange: (v: string) => void; invalid?: boolean; allowNone?: boolean; noneLabel?: string }) {
  const t = useT();
  const q = useStaff();
  return (
    <Select id={id} value={value} invalid={invalid} onChange={(e) => onChange(e.target.value)} disabled={q.isPending}>
      <option value="">{allowNone ? noneLabel ?? '—' : t('guard.staffPick')}</option>
      {(q.data ?? []).map((s) => <option key={s.membership_id} value={s.membership_id}>{s.full_name} — {s.title ?? t(`role.${s.role}` as MessageKey)}</option>)}
    </Select>
  );
}

const SEV_TONE: Record<IncidentSeverity, Tone> = { low: 'gray', medium: 'yellow', high: 'red', critical: 'red' };
export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const t = useT();
  const Icon = severity === 'critical' ? Siren : severity === 'high' ? ShieldAlert : severity === 'medium' ? AlertTriangle : Eye;
  return <Badge tone={SEV_TONE[severity]} icon={<Icon className={ic} />} className={severity === 'critical' ? '!bg-red-600 !text-white !ring-red-600' : undefined}>{t(`guard.sev.${severity}` as MessageKey)}</Badge>;
}

/** Camera alert kinds by how urgent they are at the entrance: an intrusion or a covered lens first. */
export const alertLevel = (kind: string): 'high' | 'medium' => (kind === 'intrusion' || kind === 'tamper' ? 'high' : 'medium');

export type AlertState = 'new' | 'taken' | 'escalated' | 'resolved';
export function AlertStateBadge({ state }: { state: AlertState }) {
  const t = useT();
  const tone: Tone = state === 'new' ? 'red' : state === 'taken' ? 'yellow' : state === 'escalated' ? 'violet' : 'green';
  const Icon = state === 'new' ? Siren : state === 'taken' ? Eye : state === 'escalated' ? Flame : CheckCircle2;
  return <Badge tone={tone} icon={<Icon className={ic} />}>{t(`guard.state.${state}` as MessageKey)}</Badge>;
}

/** «How serious»: four chips that wrap on a phone (a segmented strip would clip «Juda jiddiy»). */
export function SeverityPicker({ value, onChange }: { value: IncidentSeverity; onChange: (v: IncidentSeverity) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t('guard.inc.severity')} className="flex flex-wrap gap-2">
      {INCIDENT_SEVERITIES.map((s) => <Chip key={s} role="radio" aria-checked={value === s} pressed={value === s} onClick={() => onChange(s)}>{t(`guard.sev.${s}` as MessageKey)}</Chip>)}
    </div>
  );
}

export function TimeAgo({ iso, now }: { iso: string; now: Date }) {
  const t = useT();
  return <span className="inline-flex items-center gap-1 tabular-nums"><Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />{t('guard.ago', { time: since(iso, now) })}</span>;
}
