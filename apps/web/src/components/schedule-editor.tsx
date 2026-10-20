'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fmtDate, weekdayName } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Alert, Button, cx, Input, Modal, Select, useToast } from '@/components/ui';
import { useT } from '@/lib/i18n';

type Row = { on: boolean; branch_id: string; room_id: string; start: string; end: string; break_start: string; break_end: string };
type Conflict = { appointment_id: string; date: string; time: string; patient_number: number; patient: string; service_name: string; reason: string };
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first, as clinics read a week

/** Weekly schedule of one doctor: one branch per day, working hours, optional room and break. */
export function ScheduleEditor({ open, onClose, doctor, schedule }: {
  open: boolean; onClose: () => void;
  doctor: { id: string; display_name: string; branch_ids: string[] | null };
  schedule: { weekday: number; branch_id: string; room_id: string | null; start: string; end: string; break_start: string | null; break_end: string | null }[];
}) {
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const branches = useMemo(() => me.branches.filter((b) => !doctor.branch_ids || doctor.branch_ids.includes(b.id)), [me.branches, doctor.branch_ids]);
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api('/rooms').then((r) => r.data as { id: string; name: string; branch_id: string }[]), enabled: open });

  const build = (): Record<number, Row> => Object.fromEntries(ORDER.map((wd) => {
    const s = schedule.find((x) => x.weekday === wd);
    return [wd, s
      ? { on: true, branch_id: s.branch_id, room_id: s.room_id ?? '', start: s.start, end: s.end, break_start: s.break_start ?? '', break_end: s.break_end ?? '' }
      : { on: false, branch_id: branches[0]?.id ?? '', room_id: '', start: '09:00', end: '17:00', break_start: '13:00', break_end: '14:00' }];
  }));
  const [rows, setRows] = useState<Record<number, Row>>(build);
  const [initial, setInitial] = useState(rows);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  useEffect(() => {
    if (!open) return;
    const r = build(); setRows(r); setInitial(r); setErrors({}); setFormError(null); setConflicts(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const set = (wd: number, k: keyof Row, v: string | boolean) => {
    setRows((x) => ({ ...x, [wd]: { ...x[wd], [k]: v, ...(k === 'branch_id' ? { room_id: '' } : {}) } }));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([key]) => !key.startsWith(`${wd}.`))));
    setConflicts(null);
  };
  const copyMonday = () => {
    const mon = rows[1];
    setRows((x) => Object.fromEntries(ORDER.map((wd) => [wd, wd >= 2 && wd <= 5 ? { ...mon } : x[wd]])) as Record<number, Row>);
    setConflicts(null);
  };

  const sent = ORDER.filter((wd) => rows[wd].on);
  const save = useMutation({
    mutationFn: (confirm: boolean) => api(`/staff/doctors/${doctor.id}/schedule`, { method: 'PUT', body: {
      days: sent.map((wd) => {
        const r = rows[wd];
        return { weekday: wd, branch_id: r.branch_id, room_id: r.room_id || null, start: r.start, end: r.end, break_start: r.break_start || null, break_end: r.break_end || null };
      }),
      confirm_conflicts: confirm || undefined,
    } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      qc.invalidateQueries({ queryKey: ['doctors'] });
      qc.invalidateQueries({ queryKey: ['availability'] });
      const n = r.data.conflicts?.length ?? 0;
      toast.success(n ? t('registrar.sched.savedConflicts', { n }) : t('registrar.sched.saved'));
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'SCHEDULE_CONFLICTS') { setConflicts(e.details?.conflicts ?? []); return; }
      if (e instanceof ApiError && e.fields) {
        // server keys are days.<index>.<field>; map the index back to the weekday row
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(e.fields)) {
          const m = k.match(/^days\.(\d+)\.(\w+)$/);
          if (m) mapped[`${sent[Number(m[1])]}.${m[2]}`] = v; else mapped._ = v;
        }
        setErrors(mapped);
      }
      setFormError(e instanceof Error ? e.message : t('registrar.notSaved'));
    },
  });

  function validate() {
    const e: Record<string, string> = {};
    for (const wd of sent) {
      const r = rows[wd];
      if (!r.branch_id) e[`${wd}.branch_id`] = t('registrar.sched.pickBranch');
      if (!r.start || !r.end || r.end <= r.start) e[`${wd}.end`] = t('registrar.sched.endAfterStart');
      if (!!r.break_start !== !!r.break_end) e[`${wd}.break_end`] = t('registrar.sched.breakBoth');
      else if (r.break_start && (r.break_end <= r.break_start || r.break_start < r.start || r.break_end > r.end)) e[`${wd}.break_start`] = t('registrar.sched.breakInside');
    }
    setErrors(e);
    return !Object.keys(e).length;
  }
  const submit = (confirm = false) => { setFormError(null); if (validate()) save.mutate(confirm); };
  const err = (wd: number) => Object.entries(errors).filter(([k]) => k.startsWith(`${wd}.`)).map(([, v]) => v)[0];

  return (
    <Modal open={open} onClose={onClose} dirty={dirty && !save.isSuccess} width="max-w-5xl" title={t('registrar.sched.title', { name: doctor.display_name })}
      footer={<>
        <Button className="mr-auto" size="sm" icon={<Copy className="h-4 w-4" />} onClick={copyMonday} disabled={!rows[1].on}>{t('registrar.sched.copyMonday')}</Button>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        {conflicts
          ? <Button variant="danger" loading={save.isPending} onClick={() => submit(true)}>{t('registrar.sched.saveAnyway')}</Button>
          : <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => submit(false)}>{t('common.save')}</Button>}
      </>}>
      <div className="space-y-3">
        {formError && !conflicts && <Alert tone="red">{formError}</Alert>}
        {conflicts && (
          <Alert tone="yellow" title={t('registrar.sched.conflictsTitle', { n: conflicts.length })}>
            <p>{t('registrar.sched.conflictsText')}</p>
            <ul className="mt-2 max-h-40 divide-y divide-amber-200 overflow-y-auto rounded border border-amber-200 bg-white/60">
              {conflicts.map((c) => (
                <li key={c.appointment_id} className="flex flex-wrap gap-x-3 px-2 py-1 text-[0.8125rem]">
                  <span className="tabular-nums">{fmtDate(c.date)} {c.time}</span><span className="font-medium">{c.patient}</span><span className="text-slate-600">{c.service_name}</span><span className="ml-auto text-amber-800">{c.reason}</span>
                </li>
              ))}
            </ul>
          </Alert>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="text-left text-[0.8125rem] font-semibold text-slate-600">
              <th className="py-1 pr-2">{t('registrar.sched.day')}</th><th className="px-1">{t('registrar.branch')}</th><th className="px-1">{t('registrar.sched.room')}</th><th className="px-1">{t('registrar.sched.hours')}</th><th className="px-1">{t('registrar.sched.breakOptional')}</th>
            </tr></thead>
            <tbody>{ORDER.map((wd) => {
              const r = rows[wd], e = err(wd), day = weekdayName(wd);
              const branchRooms = (rooms.data ?? []).filter((x) => x.branch_id === r.branch_id);
              return (
                <tr key={wd} className={cx('border-t border-slate-100 align-top', !r.on && 'text-slate-600')}>
                  <td className="py-2 pr-2">
                    <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap font-medium">
                      <input type="checkbox" className="accent-brand-600" checked={r.on} onChange={(ev) => set(wd, 'on', ev.target.checked)} aria-label={t('registrar.sched.ariaOn', { day })} />{day}
                    </label>
                    {!r.on && <span className="ml-6 text-xs">{t('registrar.sched.dayOff')}</span>}
                  </td>
                  {r.on ? <>
                    <td className="px-1 py-1.5"><Select aria-label={t('registrar.sched.ariaBranch', { day })} className="h-8 text-[0.8125rem]" value={r.branch_id} onChange={(ev) => set(wd, 'branch_id', ev.target.value)} invalid={!!errors[`${wd}.branch_id`]}>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select></td>
                    <td className="px-1 py-1.5"><Select aria-label={t('registrar.sched.ariaRoom', { day })} className="h-8 text-[0.8125rem]" value={r.room_id} onChange={(ev) => set(wd, 'room_id', ev.target.value)} invalid={!!errors[`${wd}.room_id`]}>
                      <option value="">{t('registrar.sched.noRoom')}</option>
                      {branchRooms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </Select></td>
                    <td className="px-1 py-1.5"><div className="flex items-center gap-1">
                      <Input type="time" step={300} aria-label={t('registrar.sched.ariaStart', { day })} className="h-8 w-[104px] text-[0.8125rem]" value={r.start} onChange={(ev) => set(wd, 'start', ev.target.value)} invalid={!!errors[`${wd}.start`]} />–
                      <Input type="time" step={300} aria-label={t('registrar.sched.ariaEnd', { day })} className="h-8 w-[104px] text-[0.8125rem]" value={r.end} onChange={(ev) => set(wd, 'end', ev.target.value)} invalid={!!errors[`${wd}.end`]} />
                    </div></td>
                    <td className="px-1 py-1.5"><div className="flex items-center gap-1">
                      <Input type="time" step={300} aria-label={t('registrar.sched.ariaBreakStart', { day })} className="h-8 w-[104px] text-[0.8125rem]" value={r.break_start} onChange={(ev) => set(wd, 'break_start', ev.target.value)} invalid={!!errors[`${wd}.break_start`]} />–
                      <Input type="time" step={300} aria-label={t('registrar.sched.ariaBreakEnd', { day })} className="h-8 w-[104px] text-[0.8125rem]" value={r.break_end} onChange={(ev) => set(wd, 'break_end', ev.target.value)} invalid={!!errors[`${wd}.break_end`]} />
                    </div>{e && <p className="mt-1 text-xs text-red-600" role="alert">{e}</p>}</td>
                  </> : <td colSpan={4} />}
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        {branches.length < me.branches.length && <p className="text-xs text-slate-600">{t('registrar.sched.branchesHint')}</p>}
        <p className="text-xs text-slate-600">{t('registrar.sched.effectHint')}</p>
      </div>
    </Modal>
  );
}
