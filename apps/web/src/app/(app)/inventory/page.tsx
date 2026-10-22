'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, MinusCircle, Package, Pencil, Plus } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, KeyVal, LoadingRows, Modal, ModalCancel, PageHeader, Select, Table, Tabs, Td, Th, useToast } from '@/components/ui';

export default function InventoryPage() { return <Suspense><Inventory /></Suspense>; }
const n = (v: any) => Number(v).toLocaleString('ru-RU').replace(/ /g, ' ');
const isLow = (i: any) => Number(i.qty) < Number(i.minimum_qty);

function Inventory() {
  const t = useT();
  const { branchId } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const low = sp.get('low') === '1';
  const sel = sp.get('item');
  // the whole list (a clinic has tens of items): both tab counts come from one request
  const q = useQuery({ queryKey: ['inventory', branchId], queryFn: () => api(`/inventory${qs({ branch_id: branchId })}`).then((r) => r.data as any[]) });
  const all = q.data ?? [];
  const lowCount = all.filter(isLow).length;
  const rows = low ? all.filter(isLow) : all;
  const go = (p: { low?: boolean; item?: string | null }) => {
    const l = p.low ?? low, it = p.item === undefined ? sel : p.item;
    router.replace(`/inventory${qs({ low: l ? 1 : undefined, item: it ?? undefined })}`, { scroll: false });
  };
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader title={t('admin.inv.title')} actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>{t('admin.inv.add')}</Button>} />
      {adding && <ItemModal item={null} onClose={() => setAdding(false)} onCreated={(id) => go({ item: id, low: false })} />}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card padded={false}>
          <div className="px-3 pt-1">
            <Tabs value={low ? 'low' : 'all'} onChange={(v) => go({ low: v === 'low' })}
              items={[{ value: 'all', label: t('admin.inv.tabAll'), count: q.data ? all.length : undefined }, { value: 'low', label: t('admin.inv.lowOnly'), count: q.data ? lowCount : undefined }]} />
          </div>
          {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !rows.length ? <EmptyState compact icon={<Package />} title={t(low ? 'admin.inv.noneLow' : 'admin.inv.notFound')} /> : (
            <Table>
              <thead><tr>
                <Th>{t('admin.inv.colItem')}</Th>
                <Th right>{t('admin.inv.colQty')}</Th><Th right className="hidden sm:table-cell">{t('admin.inv.colMin')}</Th><Th className="hidden sm:table-cell"><span className="sr-only">{t('admin.inv.colState')}</span></Th>
              </tr></thead>
              <tbody>{rows.map((i) => {
                const l = isLow(i);
                return (
                  <tr key={i.id} onClick={() => go({ item: i.id })} className={cx('cursor-pointer', sel === i.id ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                    <Td className="min-w-[9rem]">
                      <button type="button" onClick={(e) => { e.stopPropagation(); go({ item: i.id }); }} aria-current={sel === i.id || undefined}
                        className="rounded text-left font-semibold text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">{i.name}</button>
                      {/* the branch only when the header shows all branches */}
                      {!branchId && <div className="text-[0.8125rem] text-slate-600">{i.branch_name}</div>}
                      {!i.active && <div className="text-[0.8125rem] text-slate-600">{t('admin.inv.inactive')}</div>}
                    </Td>
                    <Td right><span className={l ? 'font-bold text-red-700' : 'font-semibold text-slate-900'}>{n(i.qty)}</span> <span className="text-[0.8125rem] text-slate-600">{i.unit}</span>
                      {l && <div className="text-[0.8125rem] font-semibold text-red-700 sm:hidden">{t('admin.inv.low')}</div>}</Td>
                    <Td right className="hidden text-slate-600 sm:table-cell">{n(i.minimum_qty)}</Td>
                    <Td className="hidden w-px whitespace-nowrap sm:table-cell">{l && <Badge tone="red" icon={<AlertTriangle className="h-3.5 w-3.5" />}>{t('admin.inv.low')}</Badge>}</Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          )}
        </Card>
        {sel ? <ItemDetail id={sel} onClose={() => go({ item: null })} /> : <Card className="hidden xl:block"><EmptyState compact title={t('admin.inv.pick')} /></Card>}
      </div>
    </>
  );
}

function ItemDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['inventory', 'item', id], queryFn: () => api(`/inventory/${id}`).then((r) => r.data) });
  const [form, setForm] = useState<null | 'in' | 'out'>(null);
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(''); const [reason, setReason] = useState(''); const [date, setDate] = useState(me.today);
  const [err, setErr] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  // below xl the card is under the list: bring it into view when an item is picked
  useEffect(() => { if (window.innerWidth < 1280) top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [id]);
  useEffect(() => { if (!form) setTried(false); }, [form]);
  const m = useMutation({
    mutationFn: () => api(`/inventory/${id}/movements`, { method: 'POST', body: { type: form, quantity: Number(qty.replace(',', '.')), reason, date } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toast.success(form === 'in' ? t('admin.inv.inDone') : t('admin.inv.outDone')); setForm(null); setQty(''); setReason(''); setErr({}); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  if (q.isLoading) return <div ref={top} className="scroll-mt-24"><Card><LoadingRows /></Card></div>;
  if (q.isError) return <div ref={top} className="scroll-mt-24"><Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card></div>;
  const it = q.data;
  const qn = Number(qty.replace(',', '.'));
  const qtyError = err.quantity ?? (form === 'out' && qn > Number(it.qty) ? t('admin.inv.tooMuch', { qty: n(it.qty) }) : (tried || qty) && !(qn > 0) ? t('admin.inv.errQty') : undefined);
  const reasonError = err.reason ?? (tried && reason.trim().length < 3 ? t('admin.inv.errReason') : undefined);
  const valid = qn > 0 && reason.trim().length >= 3 && (form !== 'out' || qn <= Number(it.qty));
  const save = () => { setTried(true); if (valid) m.mutate(); };
  const low = Number(it.qty) < Number(it.minimum_qty);
  return (
    <div ref={top} className="scroll-mt-24">
      <Card title={<span className="flex flex-wrap items-center gap-2">{it.name}{!it.active && <Badge icon={<MinusCircle className="h-3.5 w-3.5" />}>{t('admin.inv.inactive')}</Badge>}</span>} padded={false}
        actions={<><Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>{t('admin.inv.edit')}</Button><Button size="sm" variant="ghost" className="xl:hidden" onClick={onClose}>{t('common.close')}</Button></>}>
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={cx('text-[1.5rem] font-bold leading-none tabular-nums', low ? 'text-red-700' : 'text-slate-900')}>{n(it.qty)} <span className="text-base font-semibold text-slate-600">{it.unit}</span></span>
            {low && <Badge tone="red" icon={<AlertTriangle className="h-3.5 w-3.5" />}>{t('admin.inv.low')}</Badge>}
          </div>
          <div className="divide-y divide-slate-100">
            <KeyVal k={t('admin.inv.colMin')} v={n(it.minimum_qty)} />
            <KeyVal k={t('admin.inv.colBranch')} v={it.branch_name} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button icon={<ArrowDownToLine className="h-4 w-4" />} onClick={() => setForm('in')}>{t('admin.inv.in')}</Button>
            <Button icon={<ArrowUpFromLine className="h-4 w-4" />} onClick={() => setForm('out')}>{t('admin.inv.out')}</Button>
          </div>
        </div>
        <h3 className="border-t border-slate-100 px-5 pb-1 pt-4 text-[0.9375rem] font-bold text-slate-900">{t('admin.inv.history')}</h3>
        <ul className="divide-y divide-slate-100 px-5 pb-2 text-sm">
          {it.movements.map((mv: any) => (
            <li key={mv.id} className="flex items-start gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-slate-900">{mv.reason}</span>
                <span className="block text-[0.8125rem] text-slate-600">{fmtDateTime(mv.occurred_at)} · {mv.actor_name}</span>
              </span>
              <span className={cx('whitespace-nowrap font-semibold tabular-nums', mv.type === 'in' ? 'text-emerald-700' : 'text-slate-800')}>{mv.type === 'in' ? '+' : '−'}{n(mv.quantity)}</span>
            </li>
          ))}
          <li className="flex items-start gap-3 py-2.5 text-slate-600">
            <span className="min-w-0 flex-1">{t('admin.inv.opening')}</span><span className="tabular-nums">{n(it.opening_qty)}</span>
          </li>
        </ul>
      </Card>
      {editing && <ItemModal item={it} onClose={() => setEditing(false)} />}
      <Modal open={!!form} onClose={() => setForm(null)} dirty={!!(qty || reason)} title={form === 'in' ? t('admin.inv.modalIn', { name: it.name }) : t('admin.inv.modalOut', { name: it.name })}
        footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} onClick={save}>{t('common.save')}</Button></>}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('admin.inv.qty', { unit: it.unit })} required error={qtyError} hint={form === 'out' ? t('admin.inv.available', { qty: n(it.qty) }) : undefined}>{(i) => <Input id={i} inputMode="decimal" value={qty} invalid={!!qtyError} onChange={(e) => setQty(e.target.value)} />}</Field>
          <Field label={t('admin.inv.date')} required error={err.date}>{(i) => <Input id={i} type="date" max={me.today} value={date} invalid={!!err.date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label={t('admin.inv.reason')} required className="sm:col-span-2" error={reasonError}>{(i) => <Input id={i} value={reason} invalid={!!reasonError} onChange={(e) => setReason(e.target.value)} placeholder={form === 'in' ? t('admin.inv.reasonIn') : t('admin.inv.reasonOut')} />}</Field>
        </div>
      </Modal>
    </div>
  );
}

/** New stock item, or the name/unit/minimum/branch/active flag of an existing one. Movements never change here. */
function ItemModal({ item, onClose, onCreated }: { item: any | null; onClose: () => void; onCreated?: (id: string) => void }) {
  const t = useT();
  const { me, branchId: headerBranch } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [branchId, setBranchId] = useState<string>(item?.branch_id ?? headerBranch ?? (me.branches.length === 1 ? me.branches[0].id : ''));
  const [minimum, setMinimum] = useState(item ? String(Number(item.minimum_qty)) : '0');
  const [opening, setOpening] = useState('0');
  const [active, setActive] = useState<boolean>(item?.active ?? true);
  const [err, setErr] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const num = (s: string) => Number(s.replace(',', '.'));
  const okNum = (s: string) => s.trim() !== '' && num(s) >= 0;
  const show = tried || !!item;
  const local = {
    name: show && name.trim().length < 2 ? t('admin.inv.errName') : undefined,
    unit: show && !unit.trim() ? t('admin.inv.errUnit') : undefined,
    branch_id: show && !branchId ? t('settings.rooms.errBranch') : undefined,
    minimum_qty: show && !okNum(minimum) ? t('admin.inv.errNumber') : undefined,
    opening_qty: !item && show && !okNum(opening) ? t('admin.inv.errNumber') : undefined,
  };
  const invalid = Object.values(local).some(Boolean);
  const m = useMutation({
    mutationFn: () => {
      const body: any = { name: name.trim(), unit: unit.trim(), branch_id: branchId, minimum_qty: num(minimum), active };
      return item ? api(`/inventory/${item.id}`, { method: 'PATCH', body }) : api('/inventory', { method: 'POST', body: { ...body, opening_qty: num(opening) } });
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(item ? (r.data.changes.length ? t('admin.set.savedChanges', { changes: r.data.changes.join(', ') }) : t('admin.set.noChanges')) : t('admin.inv.created'));
      onClose(); if (!item) onCreated?.(r.data.id);
    },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  const e = (k: keyof typeof local) => err[k] ?? local[k];
  const save = () => { setTried(true); if (!invalid) m.mutate(); };
  const dirty = item ? name !== item.name || unit !== item.unit || branchId !== item.branch_id || num(minimum) !== Number(item.minimum_qty) || active !== item.active : !!(name || unit);
  const branches = item && !me.branches.some((b) => b.id === item.branch_id) ? [...me.branches, { id: item.branch_id, name: item.branch_name, code: '' }] : me.branches;
  return (
    <Modal open onClose={onClose} dirty={dirty} title={item ? t('admin.inv.editTitle', { name: item.name }) : t('admin.inv.addTitle')}
      footer={<><ModalCancel /><Button variant="primary" disabled={item ? !dirty : false} loading={m.isPending} onClick={save}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('admin.inv.name')} required className="sm:col-span-2" error={e('name')}>{(i) => <Input id={i} data-autofocus value={name} invalid={!!e('name')} maxLength={100} onChange={(ev) => setName(ev.target.value)} />}</Field>
        <Field label={t('admin.inv.unit')} required hint={t('admin.inv.unitHint')} error={e('unit')}>{(i) => <Input id={i} value={unit} invalid={!!e('unit')} maxLength={20} onChange={(ev) => setUnit(ev.target.value)} />}</Field>
        <Field label={t('admin.inv.branch')} required error={e('branch_id')}>{(i) => (
          <Select id={i} value={branchId} invalid={!!e('branch_id')} onChange={(ev) => setBranchId(ev.target.value)}>
            <option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>)}</Field>
        <Field label={t('admin.inv.minQty')} required error={e('minimum_qty')}>{(i) => <Input id={i} inputMode="decimal" value={minimum} invalid={!!e('minimum_qty')} onChange={(ev) => setMinimum(ev.target.value)} />}</Field>
        {!item && <Field label={t('admin.inv.openingQty')} required error={e('opening_qty')}>{(i) => <Input id={i} inputMode="decimal" value={opening} invalid={!!e('opening_qty')} onChange={(ev) => setOpening(ev.target.value)} />}</Field>}
        {item && <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem] font-medium text-slate-900 sm:col-span-2"><input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-600" checked={active} onChange={(ev) => setActive(ev.target.checked)} />{t('admin.inv.activeCheck')}</label>}
      </div>
    </Modal>
  );
}
