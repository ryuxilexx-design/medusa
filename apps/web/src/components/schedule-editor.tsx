'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fmtDate, WEEKDAYS } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Alert, Button, cx, Input, Modal, Select, useToast } from '@/components/ui';

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
      toast.success(n ? `Jadval saqlandi. ${n} ta qabulni registrator ko‘chirishi kerak` : 'Ish jadvali saqlandi');
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
      setFormError(e instanceof Error ? e.message : 'Saqlanmadi');
    },
  });

  function validate() {
    const e: Record<string, string> = {};
    for (const wd of sent) {
      const r = rows[wd];
      if (!r.branch_id) e[`${wd}.branch_id`] = 'Filialni tanlang';
      if (!r.start || !r.end || r.end <= r.start) e[`${wd}.end`] = 'Tugash boshlanishdan keyin';
      if (!!r.break_start !== !!r.break_end) e[`${wd}.break_end`] = 'Tanaffus boshi va oxiri';
      else if (r.break_start && (r.break_end <= r.break_start || r.break_start < r.start || r.break_end > r.end)) e[`${wd}.break_start`] = 'Tanaffus ish vaqti ichida';
    }
    setErrors(e);
    return !Object.keys(e).length;
  }
  const submit = (confirm = false) => { setFormError(null); if (validate()) save.mutate(confirm); };
  const err = (wd: number) => Object.entries(errors).filter(([k]) => k.startsWith(`${wd}.`)).map(([, v]) => v)[0];

  return (
    <Modal open={open} onClose={onClose} dirty={dirty && !save.isSuccess} width="max-w-5xl" title={`${doctor.display_name} · ish jadvali`}
      footer={<>
        <Button className="mr-auto" size="sm" icon={<Copy className="h-4 w-4" />} onClick={copyMonday} disabled={!rows[1].on}>Dushanbani Se–Ju ga nusxalash</Button>
        <Button onClick={onClose}>Bekor qilish</Button>
        {conflicts
          ? <Button variant="danger" loading={save.isPending} onClick={() => submit(true)}>Baribir saqlash</Button>
          : <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => submit(false)}>Saqlash</Button>}
      </>}>
      <div className="space-y-3">
        {formError && !conflicts && <Alert tone="red">{formError}</Alert>}
        {conflicts && (
          <Alert tone="yellow" title={`${conflicts.length} ta kelgusi qabul yangi jadvalga sig‘maydi`}>
            <p>Qabullar o‘chirilmaydi va bekor qilinmaydi. Saqlasangiz, registrator ularni boshqa vaqtga ko‘chiradi yoki bemor bilan kelishib bekor qiladi.</p>
            <ul className="mt-2 max-h-40 divide-y divide-amber-200 overflow-y-auto rounded border border-amber-200 bg-white/60">
              {conflicts.map((c) => (
                <li key={c.appointment_id} className="flex flex-wrap gap-x-3 px-2 py-1 text-[13px]">
                  <span className="tabular-nums">{fmtDate(c.date)} {c.time}</span><span className="font-medium">{c.patient}</span><span className="text-slate-600">{c.service_name}</span><span className="ml-auto text-amber-800">{c.reason}</span>
                </li>
              ))}
            </ul>
          </Alert>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="py-1 pr-2">Kun</th><th className="px-1">Filial</th><th className="px-1">Xona</th><th className="px-1">Ish vaqti</th><th className="px-1">Tanaffus (ixtiyoriy)</th>
            </tr></thead>
            <tbody>{ORDER.map((wd) => {
              const r = rows[wd], e = err(wd);
              const branchRooms = (rooms.data ?? []).filter((x) => x.branch_id === r.branch_id);
              return (
                <tr key={wd} className={cx('border-t border-slate-100 align-top', !r.on && 'text-slate-400')}>
                  <td className="py-2 pr-2">
                    <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap font-medium">
                      <input type="checkbox" className="accent-brand-600" checked={r.on} onChange={(ev) => set(wd, 'on', ev.target.checked)} aria-label={`${WEEKDAYS[wd]}: ishlaydi`} />{WEEKDAYS[wd]}
                    </label>
                    {!r.on && <span className="ml-6 text-xs">Dam olish</span>}
                  </td>
                  {r.on ? <>
                    <td className="px-1 py-1.5"><Select aria-label={`${WEEKDAYS[wd]}: filial`} className="h-8 text-[13px]" value={r.branch_id} onChange={(ev) => set(wd, 'branch_id', ev.target.value)} invalid={!!errors[`${wd}.branch_id`]}>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select></td>
                    <td className="px-1 py-1.5"><Select aria-label={`${WEEKDAYS[wd]}: xona`} className="h-8 text-[13px]" value={r.room_id} onChange={(ev) => set(wd, 'room_id', ev.target.value)} invalid={!!errors[`${wd}.room_id`]}>
                      <option value="">— xonasiz —</option>
                      {branchRooms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </Select></td>
                    <td className="px-1 py-1.5"><div className="flex items-center gap-1">
                      <Input type="time" step={300} aria-label={`${WEEKDAYS[wd]}: boshlanish`} className="h-8 w-[104px] text-[13px]" value={r.start} onChange={(ev) => set(wd, 'start', ev.target.value)} invalid={!!errors[`${wd}.start`]} />–
                      <Input type="time" step={300} aria-label={`${WEEKDAYS[wd]}: tugash`} className="h-8 w-[104px] text-[13px]" value={r.end} onChange={(ev) => set(wd, 'end', ev.target.value)} invalid={!!errors[`${wd}.end`]} />
                    </div></td>
                    <td className="px-1 py-1.5"><div className="flex items-center gap-1">
                      <Input type="time" step={300} aria-label={`${WEEKDAYS[wd]}: tanaffus boshi`} className="h-8 w-[104px] text-[13px]" value={r.break_start} onChange={(ev) => set(wd, 'break_start', ev.target.value)} invalid={!!errors[`${wd}.break_start`]} />–
                      <Input type="time" step={300} aria-label={`${WEEKDAYS[wd]}: tanaffus oxiri`} className="h-8 w-[104px] text-[13px]" value={r.break_end} onChange={(ev) => set(wd, 'break_end', ev.target.value)} invalid={!!errors[`${wd}.break_end`]} />
                    </div>{e && <p className="mt-1 text-xs text-red-600" role="alert">{e}</p>}</td>
                  </> : <td colSpan={4} />}
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        {branches.length < me.branches.length && <p className="text-xs text-slate-500">Faqat shifokor biriktirilgan filiallar ko‘rsatilgan. Boshqa filial kerak bo‘lsa — xodim kartasida filialni qo‘shing.</p>}
        <p className="text-xs text-slate-500">Yangi jadval keyingi yozuvlarga darhol ta’sir qiladi. Bir kunda shifokor bitta filialda ishlaydi.</p>
      </div>
    </Modal>
  );
}
