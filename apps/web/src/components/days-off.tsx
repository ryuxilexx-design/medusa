'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { MessageKey, ScheduleExceptionKind } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { addDays, fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Button, cx, EmptyState, ErrorState, Field, Input, LinkButton, LoadingRows, Select, useToast } from '@/components/ui';

export type ScheduleException = {
  id: string; doctor_id: string | null; doctor_name: string | null; branch_id: string | null; branch_name: string | null;
  date: string; kind: ScheduleExceptionKind; start_time: string | null; end_time: string | null; note: string | null;
};
type Affected = { appointment_id: string; date: string; time: string; doctor_id: string; doctor_name: string; patient_number: number; patient: string; service_name: string };
/** Consecutive days with the same kind, note and scope collapse into one line (a two-week vacation is one row). */
type Group = { ids: string[]; from: string; to: string; e: ScheduleException };

export function groupExceptions(rows: ScheduleException[]): Group[] {
  const out: Group[] = [];
  for (const e of rows) {
    const last = out[out.length - 1];
    const same = last && last.e.doctor_id === e.doctor_id && last.e.branch_id === e.branch_id && last.e.kind === e.kind && last.e.note === e.note
      && last.e.start_time === e.start_time && last.e.end_time === e.end_time && addDays(last.to, 1) === e.date;
    if (same) { last.ids.push(e.id); last.to = e.date; } else out.push({ ids: [e.id], from: e.date, to: e.date, e });
  }
  return out;
}

const DOCTOR_KINDS: ScheduleExceptionKind[] = ['day_off', 'vacation', 'custom_hours'];
const CLINIC_KINDS: ScheduleExceptionKind[] = ['holiday', 'day_off'];

/**
 * Days off of one doctor (doctorId) or the clinic's holidays (clinic). Lists the upcoming entries, lets a manager add a
 * period (one row per day on the server) and delete one; after adding, the bookings that fall inside are listed with
 * a link to that day of the schedule — they are never cancelled here.
 */
export function DaysOff({ doctorId, clinic = false, canEdit }: { doctorId?: string; clinic?: boolean; canEdit: boolean }) {
  const t = useT();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const from = me.today, to = addDays(me.today, 180);
  const q = useQuery({
    queryKey: ['schedule-exceptions', doctorId ?? 'clinic', from],
    queryFn: () => api(`/schedule-exceptions${qs({ from, to, doctor_id: doctorId })}`).then((r) => (r.data as ScheduleException[]).filter((e) => (clinic ? !e.doctor_id : true))),
  });
  const kinds = clinic ? CLINIC_KINDS : DOCTOR_KINDS;
  const blank = { from: me.today, to: me.today, kind: kinds[0], start_time: '09:00', end_time: '13:00', note: '', branch_id: '' };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [affected, setAffected] = useState<Affected[] | null>(null);
  const set = (k: keyof typeof blank, v: string) => { setF((x) => ({ ...x, [k]: v, ...(k === 'from' && v > x.to ? { to: v } : {}) })); setErrors((e) => ({ ...e, [k]: '' })); };
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['schedule-exceptions'] }); qc.invalidateQueries({ queryKey: ['availability'] }); };

  const add = useMutation({
    mutationFn: () => api('/schedule-exceptions', { method: 'POST', body: {
      doctor_id: doctorId ?? null, branch_id: clinic && f.branch_id ? f.branch_id : null, from: f.from, to: f.to, kind: f.kind,
      start_time: f.kind === 'custom_hours' ? f.start_time : null, end_time: f.kind === 'custom_hours' ? f.end_time : null, note: f.note || null,
    } }),
    onSuccess: (r: any) => {
      invalidate();
      toast.success(t('admin.off.saved', { n: r.data.days }));
      setAffected(r.data.affected?.length ? r.data.affected : null);
      setF({ ...blank, kind: f.kind });
    },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); else toast.error(e); },
  });
  const del = useMutation({
    mutationFn: (g: Group) => Promise.all(g.ids.map((id) => api(`/schedule-exceptions/${id}`, { method: 'DELETE' }))),
    onSuccess: () => { invalidate(); toast.success(t('admin.off.deleted')); },
    onError: (e) => { invalidate(); toast.error(e); },
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (f.to < f.from) e.to = t('admin.off.endAfterStart');
    if (f.kind === 'custom_hours') {
      if (!f.start_time || !f.end_time) e.end_time = t('admin.off.hoursBoth');
      else if (f.end_time <= f.start_time) e.end_time = t('admin.off.endAfterStart');
    }
    setErrors(e);
    if (!Object.keys(e).length) { setAffected(null); add.mutate(); }
  };
  const kindLabel = (k: ScheduleExceptionKind) => t(`admin.off.kind.${k}` as MessageKey);
  const scope = (e: ScheduleException) => (e.doctor_id ? null : e.branch_name ?? t('admin.off.clinicWide'));
  const groups = groupExceptions(q.data ?? []);

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
          <Field label={t('admin.off.from')} error={errors.from} className="w-[9.75rem]">{(id) => <Input id={id} type="date" min={me.today} value={f.from} onChange={(ev) => ev.target.value && set('from', ev.target.value)} invalid={!!errors.from} />}</Field>
          <Field label={t('admin.off.to')} error={errors.to} className="w-[9.75rem]">{(id) => <Input id={id} type="date" min={f.from} value={f.to} onChange={(ev) => ev.target.value && set('to', ev.target.value)} invalid={!!errors.to} />}</Field>
          <Field label={t('admin.off.kind')} error={errors.kind} className="w-[11rem]">{(id) => (
            <Select id={id} value={f.kind} onChange={(ev) => set('kind', ev.target.value)}>{kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}</Select>
          )}</Field>
          {f.kind === 'custom_hours' && <>
            <Field label={t('admin.off.start')} error={errors.start_time} className="w-[7.5rem]">{(id) => <Input id={id} type="time" step={300} className="tabular-nums" value={f.start_time} onChange={(ev) => set('start_time', ev.target.value)} invalid={!!errors.start_time} />}</Field>
            <Field label={t('admin.off.end')} error={errors.end_time} className="w-[7.5rem]">{(id) => <Input id={id} type="time" step={300} className="tabular-nums" value={f.end_time} onChange={(ev) => set('end_time', ev.target.value)} invalid={!!errors.end_time} />}</Field>
          </>}
          {clinic && me.branches.length > 1 && (
            <Field label={t('admin.off.branch')} error={errors.branch_id} className="w-[11rem]">{(id) => (
              <Select id={id} value={f.branch_id} onChange={(ev) => set('branch_id', ev.target.value)}>
                <option value="">{t('admin.off.allBranches')}</option>
                {me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}</Field>
          )}
          <Field label={t('admin.off.note')} error={errors.note} className="min-w-[10rem] flex-1">{(id) => <Input id={id} maxLength={200} value={f.note} onChange={(ev) => set('note', ev.target.value)} invalid={!!errors.note} />}</Field>
          <Button type="submit" icon={<Plus className="h-4 w-4" />} loading={add.isPending}>{t('admin.off.add')}</Button>
        </form>
      )}
      {affected && (
        <Alert tone="yellow" title={t('admin.off.affectedTitle', { n: affected.length })}>
          <p>{t('admin.off.affectedText')}</p>
          <ul className="mt-2 max-h-48 divide-y divide-amber-200 overflow-y-auto rounded border border-amber-200 bg-white/60">
            {affected.map((a) => (
              <li key={a.appointment_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-[0.8125rem]">
                <span className="tabular-nums">{fmtDate(a.date)} {a.time}</span><span className="font-medium">{a.patient}</span><span className="text-slate-600">{a.service_name}</span>
                {!doctorId && <span className="text-slate-600">{a.doctor_name}</span>}
                <LinkButton size="sm" variant="ghost" className="ml-auto !min-h-8" href={`/schedule?date=${a.date}`}>{t('admin.off.openDay')}</LinkButton>
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {q.isLoading ? <LoadingRows rows={2} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !groups.length ? (
        <EmptyState compact title={t(clinic ? 'admin.off.emptyHolidays' : 'admin.off.empty')} />
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-200">
          {groups.map((g) => {
            const when = g.from === g.to ? fmtDate(g.from) : `${fmtDate(g.from)}–${fmtDate(g.to)}`;
            const what = g.e.kind === 'custom_hours' ? `${kindLabel(g.e.kind)} ${g.e.start_time}–${g.e.end_time}` : kindLabel(g.e.kind);
            return (
              <li key={g.ids[0]} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="w-[11.5rem] shrink-0 font-medium tabular-nums text-slate-900">{when}</span>
                <span className={cx('font-medium', g.e.kind === 'custom_hours' ? 'text-sky-800' : 'text-amber-800')}>{what}</span>
                {scope(g.e) && <span className="text-slate-600">{scope(g.e)}</span>}
                {g.e.note && <span className="min-w-0 flex-1 truncate text-slate-600">{g.e.note}</span>}
                {canEdit && (clinic ? !g.e.doctor_id : !!g.e.doctor_id) && (
                  <Button size="sm" variant="ghost" className="ml-auto text-slate-700 hover:text-red-700" icon={<Trash2 className="h-4 w-4" />} aria-label={t('admin.off.deleteAria', { what: `${when}, ${what}` })}
                    loading={del.isPending && del.variables === g} onClick={() => del.mutate(g)}><span className="hidden sm:inline">{t('admin.off.delete')}</span></Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
