'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Alert, Button, cx, Field, Input, Modal, ModalCancel, Radio, Select, useToast } from '@/components/ui';
import { parseQty, qty, useCatalog } from './common';

type Purpose = 'patient' | 'procedure' | 'department';
type Line = { item_id: string; qty: string };
export type VisitContext = { encounter_id: string; icd_codes: string[]; procedures: { id: string; service_name: string }[]; label?: string; doctor_membership_id?: string };

/**
 * A material request (talabnoma) or — for the storekeeper — a direct issue. Always says who takes the items and for
 * what: a patient visit (ICD-10 codes come from the visit), a procedure order, or a department.
 */
export function RequestModal({ open, onClose, branchId, visit, direct = false, allowPatient = true, presetItem, icdDraft, onDone }: {
  open: boolean; onClose: () => void; branchId: string; visit?: VisitContext | null; direct?: boolean; allowPatient?: boolean; presetItem?: string;
  /** codes the doctor has typed into the note but not saved yet: a starting value when the visit has none */
  icdDraft?: string[]; onDone?: (id: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useSession();
  // «all branches» in the header: the request names its branch here (items are kept per branch)
  const [br, setBr] = useState(branchId || (me.branches.length === 1 ? me.branches[0].id : ''));
  const catalog = useCatalog(open && br ? br : undefined);
  const [picked, setPicked] = useState<VisitContext | null>(visit ?? null);
  const ctx = visit ?? picked;
  const [purpose, setPurpose] = useState<Purpose>(ctx && allowPatient ? 'patient' : 'department');
  const [department, setDepartment] = useState('');
  const [orderId, setOrderId] = useState('');
  const [icd, setIcd] = useState((icdDraft ?? []).join(', '));
  const [note, setNote] = useState('');
  const [receiver, setReceiver] = useState('');
  const [lines, setLines] = useState<Line[]>([{ item_id: presetItem ?? '', qty: '' }]);
  const [err, setErr] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  useEffect(() => { if (ctx?.doctor_membership_id && !receiver) setReceiver(ctx.doctor_membership_id); }, [ctx?.doctor_membership_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const staff = useQuery({ queryKey: ['warehouse', 'staff', br], enabled: open && direct && !!br, queryFn: () => api(`/warehouse/staff?branch_id=${br}`).then((r) => r.data as any[]) });
  const items = catalog.data ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const needIcd = purpose !== 'department' && !(ctx?.icd_codes?.length);
  const codes = icd.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
  // `show` = after the first «send»; the send itself always checks everything (state updates land on the next render)
  const check = (show: boolean): Record<string, string | undefined> => ({
    department: show && department.trim().length < 2 ? t('wh.err.department') : undefined,
    order_id: show && purpose === 'procedure' && !orderId ? t('wh.err.order') : undefined,
    icd_codes: show && needIcd && !codes.length ? t('wh.err.icd') : undefined,
    receiver_membership_id: show && direct && !receiver ? t('wh.err.receiver') : undefined,
    encounter_id: show && purpose !== 'department' && !ctx ? t('wh.err.visit') : undefined,
  });
  const local = check(tried);
  const lineCheck = (l: Line, i: number, show: boolean) => {
    const fromServer = err[`lines.${i}.item_id`] ?? err[`lines.${i}.qty`];
    if (fromServer) return fromServer;
    if (!show) return undefined;
    if (!l.item_id) return t('wh.err.item');
    const q = parseQty(l.qty);
    if (!(q > 0)) return t('admin.inv.errQty');
    const it = byId.get(l.item_id);
    if (it && q > Number(it.available)) return t('wh.err.moreThanStock', { qty: qty(it.available) });
    return undefined;
  };
  const lineErr = (l: Line, i: number) => lineCheck(l, i, tried);
  const valid = () => !!br && !Object.values(check(true)).some(Boolean) && lines.every((l, i) => !lineCheck(l, i, true));
  const m = useMutation({
    mutationFn: () => {
      const body: any = {
        branch_id: br, purpose, department: department.trim(), note: note.trim() || null,
        encounter_id: purpose === 'department' ? null : ctx?.encounter_id, order_id: purpose === 'procedure' ? orderId : null,
        icd_codes: needIcd ? codes : [], lines: lines.map((l) => ({ item_id: l.item_id, qty: parseQty(l.qty) })),
      };
      if (direct) body.receiver_membership_id = receiver;
      return api(direct ? '/warehouse/issues' : '/warehouse/requests', { method: 'POST', body });
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['warehouse'] }); qc.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(direct ? t('wh.req.issuedDirect', { n: r.data.number }) : r.data.needs_approval ? t('wh.req.sentApproval', { n: r.data.number }) : t('wh.req.sent', { n: r.data.number }));
      onDone?.(r.data.id); onClose();
    },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  const submit = () => { setTried(true); setErr({}); if (valid()) m.mutate(); };
  const set = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const purposes: Purpose[] = allowPatient && (ctx || direct) ? ['patient', 'procedure', 'department'] : ['department'];
  const controlled = lines.some((l) => byId.get(l.item_id)?.controlled);
  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" dirty={lines.some((l) => l.item_id || l.qty) || !!department}
      title={direct ? t('wh.req.directTitle') : t('wh.req.title')}
      footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} onClick={submit}>{direct ? t('wh.req.issueNow') : t('wh.req.send')}</Button></>}>
      <div className="space-y-4">
        {purposes.length > 1 && (
          <div role="radiogroup" aria-label={t('wh.req.purpose')} className="flex flex-wrap gap-2">
            {purposes.map((p) => (
              <Radio key={p} name="wh-purpose" checked={purpose === p} onChange={() => setPurpose(p)} disabled={p === 'procedure' && !!ctx && !ctx.procedures.length}
                label={t(`wh.purpose.${p}` as MessageKey)}
                rowClassName={cx('rounded-full border-2 pl-3 pr-4 font-semibold', purpose === p ? 'border-brand-600 bg-brand-50 !text-brand-800' : 'border-slate-300 hover:border-slate-500')} />
            ))}
          </div>
        )}
        {!branchId && !visit && me.branches.length > 1 && <Field label={t('admin.inv.branch')} required error={tried && !br ? t('settings.rooms.errBranch') : undefined}>{(id) => (
          <Select id={id} value={br} invalid={tried && !br} onChange={(e) => { setBr(e.target.value); setLines([{ item_id: '', qty: '' }]); setPicked(null); }}>
            <option value="">—</option>{me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>)}</Field>}
        {direct && br && purpose !== 'department' && !visit && <VisitPicker branchId={br} value={picked} onChange={(v) => { setPicked(v); setReceiver(v?.doctor_membership_id ?? ''); }} error={local.encounter_id ?? err.encounter_id} />}
        {ctx && purpose !== 'department' && ctx.label && <p className="text-body text-slate-800">{ctx.label}</p>}
        {purpose === 'procedure' && ctx && (
          <Field label={t('wh.req.procedure')} required error={local.order_id ?? err.order_id}>{(id) => (
            <Select id={id} value={orderId} invalid={!!(local.order_id ?? err.order_id)} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">—</option>{ctx.procedures.map((o) => <option key={o.id} value={o.id}>{o.service_name}</option>)}
            </Select>)}</Field>
        )}
        {purpose !== 'department' && ctx && (needIcd
          ? <Field label={t('wh.req.icd')} required hint={t('wh.req.icdHint')} error={local.icd_codes ?? err.icd_codes}>{(id) => <Input id={id} value={icd} invalid={!!(local.icd_codes ?? err.icd_codes)} onChange={(e) => setIcd(e.target.value)} placeholder="I10" />}</Field>
          : <p className="text-body text-slate-700">{t('wh.req.icdFromVisit', { codes: ctx.icd_codes.join(', ') })}</p>)}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('wh.req.department')} required error={local.department ?? err.department}>{(id) => <Input id={id} value={department} maxLength={80} invalid={!!(local.department ?? err.department)} onChange={(e) => setDepartment(e.target.value)} placeholder={t('wh.req.departmentPh')} />}</Field>
          {direct && <Field label={t('wh.req.receiver')} required error={local.receiver_membership_id ?? err.receiver_membership_id}>{(id) => (
            <Select id={id} value={receiver} invalid={!!(local.receiver_membership_id ?? err.receiver_membership_id)} onChange={(e) => setReceiver(e.target.value)}>
              <option value="">—</option>{(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} — {t(`role.${s.role}` as MessageKey)}</option>)}
            </Select>)}</Field>}
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-body font-semibold text-slate-900">{t('wh.req.lines')}</legend>
          {lines.map((l, i) => {
            const e = lineErr(l, i);
            const it = byId.get(l.item_id);
            return (
              <div key={i} className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                <Select aria-label={t('wh.col.item')} className="min-w-0 flex-1 basis-full sm:basis-0" value={l.item_id} invalid={!!e && !l.item_id} onChange={(ev) => set(i, { item_id: ev.target.value })}>
                  <option value="">{catalog.isLoading ? t('common.loading') : '—'}</option>
                  {items.map((c) => <option key={c.id} value={c.id} disabled={Number(c.available) <= 0}>{c.name} · {qty(c.available)} {c.unit}</option>)}
                </Select>
                <Input aria-label={t('admin.inv.qty', { unit: it?.unit ?? '' })} inputMode="decimal" className="w-28" value={l.qty} invalid={!!e && !!l.item_id} onChange={(ev) => set(i, { qty: ev.target.value })} placeholder={it?.unit ?? ''} />
                <Button variant="ghost" className="!px-3" aria-label={t('wh.req.removeLine')} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-5 w-5" /></Button>
                {e && <p className="basis-full text-sm font-medium text-red-700" role="alert">{e}</p>}
              </div>
            );
          })}
          {err.lines && <p className="text-sm font-medium text-red-700" role="alert">{err.lines}</p>}
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} disabled={lines.length >= 50} onClick={() => setLines((ls) => [...ls, { item_id: '', qty: '' }])}>{t('wh.req.addLine')}</Button>
        </fieldset>
        {!direct && <Field label={t('wh.req.note')}>{(id) => <Input id={id} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}</Field>}
        {controlled && <Alert tone="blue">{direct ? t('wh.req.controlledDirect') : t('wh.req.controlledNote')}</Alert>}
      </div>
    </Modal>
  );
}

/** Storekeeper: find a recent visit of the branch (patient surname or number) — the visit carries the doctor and ICD-10 codes. */
function VisitPicker({ branchId, value, onChange, error }: { branchId: string; value: VisitContext | null; onChange: (v: VisitContext | null) => void; error?: string }) {
  const t = useT();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const visits = useQuery({ queryKey: ['warehouse', 'visits', branchId, dq], queryFn: () => api(`/warehouse/visits${qs({ branch_id: branchId, q: dq || undefined })}`).then((r) => r.data as any[]) });
  return (
    <Field label={t('wh.req.visit')} required error={error}>{(id) => (
      <div className="space-y-2">
        <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('wh.req.visitSearch')} />
        <Select aria-label={t('wh.req.visit')} value={value?.encounter_id ?? ''} invalid={!!error} onChange={(e) => {
          const v = (visits.data ?? []).find((x) => x.encounter_id === e.target.value);
          onChange(v ? { encounter_id: v.encounter_id, icd_codes: v.icd_codes, procedures: v.procedures, doctor_membership_id: v.doctor_membership_id,
            label: `${v.last_name} ${v.first_name} #${v.patient_number} · ${v.doctor_name}` } : null);
        }}>
          <option value="">—</option>
          {(visits.data ?? []).map((v) => <option key={v.encounter_id} value={v.encounter_id}>{fmtDateTime(v.started_at)} · {v.last_name} {v.first_name} #{v.patient_number} · {v.doctor_name}</option>)}
        </Select>
      </div>
    )}</Field>
  );
}
