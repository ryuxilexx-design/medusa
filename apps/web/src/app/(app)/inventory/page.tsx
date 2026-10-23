'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CalendarClock, ClipboardList, MinusCircle, Package, Pencil, Plus, Wallet } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDateTime, formatSom, parseSomToTiyin } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, KeyVal, LoadingRows, Modal, ModalCancel, Money, PageHeader, Select, StatCard, Table, Tabs, Td, Th, Toolbar, useToast } from '@/components/ui';
import { MoneyInput } from '@/components/money-input';
import { CATEGORIES, ControlledBadge, Expiry, qty, STORAGE } from '@/components/warehouse/common';
import { RequestModal } from '@/components/warehouse/request-modal';
import { RequestsList } from '@/components/warehouse/requests';
import { CountsTab, CountStartModal, ReceiptModal, ReceiptsTab, useDocBranch, WriteoffModal, WriteoffsTab } from '@/components/warehouse/docs';
import { ControlledTab, ExpiringTab, FridgeModal, FridgeTab, MovementsTab, ReportsTab } from '@/components/warehouse/ledger';
import { ReorderTab } from '@/components/warehouse/reorder';

export default function WarehousePage() { return <Suspense><Warehouse /></Suspense>; }
const TABS = ['stock', 'requests', 'receipts', 'movements', 'writeoffs', 'counts', 'controlled', 'expiring', 'reorder', 'fridge', 'reports'] as const;
type Tab = (typeof TABS)[number];
type Dialog = null | 'item' | 'receipt' | 'issue' | 'writeoff' | 'count' | 'fridge';
const isLow = (i: any) => i.active && Number(i.qty) < Number(i.minimum_qty);

function Warehouse() {
  const t = useT();
  const { branchId } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const tab = (TABS as readonly string[]).includes(sp.get('tab') ?? '') ? (sp.get('tab') as Tab) : 'stock';
  const go = (p: Record<string, string | undefined>) => router.replace(`/inventory${qs({ tab: tab === 'stock' ? undefined : tab, item: sp.get('item') ?? undefined, ...p })}`, { scroll: false });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [preset, setPreset] = useState<any>(null);
  const docBranch = useDocBranch();
  const s = useQuery({ queryKey: ['warehouse', 'summary', branchId], queryFn: () => api(`/warehouse/summary${qs({ branch_id: branchId || undefined })}`).then((r) => r.data) });
  // the one primary action of each tab
  const PRIMARY: Partial<Record<Tab, [MessageKey, Dialog]>> = {
    stock: ['wh.rc.title', 'receipt'], receipts: ['wh.rc.title', 'receipt'], requests: ['wh.req.directTitle', 'issue'], movements: ['wh.req.directTitle', 'issue'],
    writeoffs: ['wh.wo.title', 'writeoff'], counts: ['wh.cnt.start', 'count'], fridge: ['wh.fr.add', 'fridge'],
  };
  const primary = PRIMARY[tab];
  const open = (d: Dialog, p: any = null) => { setPreset(p); setDialog(d); };
  return (
    <>
      <PageHeader title={t('admin.inv.title')}
        actions={<>
          {tab === 'stock' && <Button icon={<Plus className="h-4 w-4" />} onClick={() => open('item')}>{t('admin.inv.add')}</Button>}
          {primary && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => open(primary[1])}>{t(primary[0])}</Button>}
        </>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Wallet />} label={t('wh.sum.value')} loading={s.isLoading} value={s.data && <Money tiyin={s.data.value} />} />
        <StatCard icon={<ClipboardList />} label={t('wh.sum.requests')} loading={s.isLoading} value={s.data?.requests} tone={s.data?.requests ? 'danger' : 'default'} href="/inventory?tab=requests" />
        <StatCard icon={<CalendarClock />} label={t('wh.sum.expiring')} loading={s.isLoading} value={s.data && `${s.data.expiring} / ${s.data.expired}`} sub={t('wh.sum.expiringSub')} tone={s.data?.expired ? 'danger' : 'default'} href="/inventory?tab=expiring" />
        <StatCard icon={<AlertTriangle />} label={t('admin.inv.lowOnly')} loading={s.isLoading} value={s.data?.low} tone={s.data?.low ? 'danger' : 'default'} href="/inventory?low=1" />
      </div>
      <Card padded={false}>
        <div className="px-3 pt-3"><Tabs value={tab} onChange={(v) => go({ tab: v === 'stock' ? undefined : v, item: undefined })} items={TABS.map((k) => ({ value: k, label: t(`wh.tab.${k}` as MessageKey),
          count: k === 'requests' ? s.data?.requests || undefined : k === 'writeoffs' ? s.data?.writeoffs || undefined : undefined }))} /></div>
        <div className="pt-2">
          {tab === 'stock' && <StockTab onReceipt={(id) => open('receipt', id)} onIssue={(id) => open('issue', id)} />}
          {tab === 'requests' && <RequestsList />}
          {tab === 'receipts' && <ReceiptsTab />}
          {tab === 'movements' && <MovementsTab />}
          {tab === 'writeoffs' && <WriteoffsTab />}
          {tab === 'counts' && <CountsTab />}
          {tab === 'controlled' && <ControlledTab />}
          {tab === 'expiring' && <ExpiringTab onWriteoff={(b) => open('writeoff', b)} />}
          {tab === 'reorder' && <ReorderTab />}
          {tab === 'fridge' && <FridgeTab />}
          {tab === 'reports' && <ReportsTab />}
        </div>
      </Card>
      {dialog === 'item' && <ItemModal item={null} onClose={() => setDialog(null)} onCreated={(id) => go({ tab: undefined, item: id })} />}
      {dialog === 'receipt' && <ReceiptModal presetItem={preset ?? undefined} onClose={() => setDialog(null)} />}
      {dialog === 'issue' && <RequestModal open direct branchId={docBranch} presetItem={preset ?? undefined} onClose={() => setDialog(null)} />}
      {dialog === 'writeoff' && <WriteoffModal presetBatch={preset ?? undefined} onClose={() => setDialog(null)} />}
      {dialog === 'count' && <CountStartModal onClose={() => setDialog(null)} onStarted={() => undefined} />}
      {dialog === 'fridge' && <FridgeModal onClose={() => setDialog(null)} />}
    </>
  );
}

function StockTab({ onReceipt, onIssue }: { onReceipt: (id: string) => void; onIssue: (id: string) => void }) {
  const t = useT();
  const { branchId } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const low = sp.get('low') === '1';
  const sel = sp.get('item');
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['warehouse', 'stock', branchId, cat], queryFn: () => api(`/warehouse/stock${qs({ branch_id: branchId || undefined, category: cat || undefined })}`).then((r) => r.data as any[]) });
  const all = (q.data ?? []).filter((i) => !search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase()));
  const rows = low ? all.filter(isLow) : all;
  const go = (p: { low?: boolean; item?: string | null }) => {
    const l = p.low ?? low, it = p.item === undefined ? sel : p.item;
    router.replace(`/inventory${qs({ low: l ? 1 : undefined, item: it ?? undefined })}`, { scroll: false });
  };
  return (
    <div className="grid grid-cols-1 items-start 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <Toolbar>
          <Input aria-label={t('wh.stock.search')} placeholder={t('wh.stock.search')} className="sm:w-56" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select aria-label={t('wh.item.category')} className="sm:w-48" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{t('wh.cat.all')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`wh.cat.${c}` as MessageKey)}</option>)}
          </Select>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[0.9375rem] font-medium text-slate-900"><input type="checkbox" className="h-5 w-5 accent-brand-600" checked={low} onChange={(e) => go({ low: e.target.checked })} />{t('admin.inv.lowOnly')}</label>
        </Toolbar>
        {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !rows.length ? <EmptyState compact icon={<Package />} title={t(low ? 'admin.inv.noneLow' : 'admin.inv.notFound')} /> : (
          <Table>
            <thead><tr><Th>{t('admin.inv.colItem')}</Th><Th right>{t('admin.inv.colQty')}</Th><Th className="hidden md:table-cell">{t('wh.col.nextExpiry')}</Th><Th right className="hidden sm:table-cell">{t('wh.col.sum')}</Th></tr></thead>
            <tbody>{rows.map((i) => {
              const l = isLow(i);
              return (
                <tr key={i.id} onClick={() => go({ item: i.id })} className={cx('cursor-pointer', sel === i.id ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                  <Td className="min-w-[9rem]">
                    <button type="button" onClick={(e) => { e.stopPropagation(); go({ item: i.id }); }} aria-current={sel === i.id || undefined}
                      className="rounded text-left font-semibold text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">{i.name}</button>
                    <div className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-slate-600">{t(`wh.cat.${i.category}` as MessageKey)}{i.storage !== 'room' && ` · ${t(`wh.storage.${i.storage}` as MessageKey)}`}{!branchId && ` · ${i.branch_name}`}{i.controlled && <ControlledBadge />}{!i.active && ` · ${t('admin.inv.inactive')}`}</div>
                  </Td>
                  <Td right><span className={l ? 'font-bold text-red-700' : 'font-semibold text-slate-900'}>{qty(i.qty)}</span> <span className="text-[0.8125rem] text-slate-600">{i.unit}</span>
                    {l && <div className="text-[0.8125rem] font-semibold text-red-700">{t('admin.inv.low')}</div>}
                    {Number(i.usable_qty) < Number(i.qty) && <div className="text-[0.8125rem] text-red-700">{t('wh.stock.usable', { qty: qty(i.usable_qty) })}</div>}</Td>
                  <Td className="hidden whitespace-nowrap md:table-cell"><ExpiryCell date={i.next_expiry} /></Td>
                  <Td right className="hidden sm:table-cell">{formatSom(i.value)}</Td>
                </tr>
              );
            })}</tbody>
          </Table>
        )}
      </div>
      {sel ? <ItemDetail id={sel} onClose={() => go({ item: null })} onReceipt={onReceipt} onIssue={onIssue} /> : <div className="hidden border-l border-slate-100 2xl:block"><EmptyState compact title={t('admin.inv.pick')} /></div>}
    </div>
  );
}
function ExpiryCell({ date }: { date: string | null }) {
  const { me } = useSession();
  return <Expiry date={date} today={me.today} />;
}

function ItemDetail({ id, onClose, onReceipt, onIssue }: { id: string; onClose: () => void; onReceipt: (id: string) => void; onIssue: (id: string) => void }) {
  const t = useT();
  const { me } = useSession();
  const q = useQuery({ queryKey: ['inventory', 'item', id], queryFn: () => api(`/inventory/${id}`).then((r) => r.data) });
  const [editing, setEditing] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { if (window.innerWidth < 1536) top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [id]);
  if (q.isLoading) return <div ref={top} className="scroll-mt-24 border-t border-slate-100 2xl:border-l 2xl:border-t-0"><LoadingRows /></div>;
  if (q.isError) return <div ref={top} className="scroll-mt-24 border-t border-slate-100 2xl:border-l 2xl:border-t-0"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const it = q.data;
  const low = Number(it.qty) < Number(it.minimum_qty);
  return (
    <div ref={top} className="min-w-0 scroll-mt-24 border-t border-slate-100 2xl:border-l 2xl:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <h2 className="flex flex-wrap items-center gap-2 text-base font-bold text-slate-900">{it.name}{it.controlled && <ControlledBadge />}{!it.active && <Badge icon={<MinusCircle className="h-3.5 w-3.5" />}>{t('admin.inv.inactive')}</Badge>}</h2>
        <div className="flex gap-2"><Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>{t('admin.inv.edit')}</Button><Button size="sm" variant="ghost" className="2xl:hidden" onClick={onClose}>{t('common.close')}</Button></div>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={cx('text-[1.5rem] font-bold leading-none tabular-nums', low ? 'text-red-700' : 'text-slate-900')}>{qty(it.qty)} <span className="text-base font-semibold text-slate-600">{it.unit}</span></span>
          {low && <Badge tone="red" icon={<AlertTriangle className="h-3.5 w-3.5" />}>{t('admin.inv.low')}</Badge>}
        </div>
        <div className="divide-y divide-slate-100">
          <KeyVal k={t('admin.inv.colMin')} v={qty(it.minimum_qty)} />
          <KeyVal k={t('wh.item.category')} v={`${t(`wh.cat.${it.category}` as MessageKey)} · ${t(`wh.storage.${it.storage}` as MessageKey)}`} />
          <KeyVal k={t('wh.item.price')} v={formatSom(it.purchase_price)} />
          <KeyVal k={t('admin.inv.colBranch')} v={it.branch_name} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button icon={<ArrowDownToLine className="h-4 w-4" />} onClick={() => onReceipt(it.id)}>{t('admin.inv.in')}</Button>
          <Button icon={<ArrowUpFromLine className="h-4 w-4" />} disabled={it.controlled} onClick={() => onIssue(it.id)}>{t('wh.item.issue')}</Button>
        </div>
        {it.controlled && <p className="text-[0.8125rem] text-slate-700">{t('wh.req.controlledDirect')}</p>}
      </div>
      <h3 className="border-t border-slate-100 px-5 pb-1 pt-4 text-[0.9375rem] font-bold text-slate-900">{t('wh.item.batches')}</h3>
      {!it.batches.length ? <p className="px-5 pb-3 text-[0.9375rem] text-slate-600">{t('wh.item.noBatches')}</p> : (
        <ul className="divide-y divide-slate-100 px-5 pb-2 text-sm">
          {it.batches.map((b: any) => (
            <li key={b.id} className="flex items-start gap-3 py-2.5">
              <span className="min-w-0 flex-1"><span className="block font-semibold text-slate-900">{b.batch_no ?? t('wh.item.noSeries')}</span>
                <span className="block text-[0.8125rem] text-slate-600"><Expiry date={b.expiry_date} today={me.today} />{b.supplier ? ` · ${b.supplier}` : ''}</span></span>
              <span className="whitespace-nowrap font-semibold tabular-nums">{qty(b.qty)}</span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="border-t border-slate-100 px-5 pb-1 pt-4 text-[0.9375rem] font-bold text-slate-900">{t('admin.inv.history')}</h3>
      <ul className="divide-y divide-slate-100 px-5 pb-2 text-sm">
        {it.movements.map((mv: any) => (
          <li key={mv.id} className={cx('flex items-start gap-3 py-2.5', mv.voided_at && 'text-slate-500 line-through')}>
            <span className="min-w-0 flex-1">
              <span className="block text-slate-900">{t(`wh.kind.${mv.kind}` as MessageKey)}{mv.doc_no ? ` ${mv.doc_no}` : ''}{mv.receiver_name ? ` → ${mv.receiver_name}` : ''}</span>
              <span className="block text-[0.8125rem] text-slate-600">{fmtDateTime(mv.occurred_at)} · {mv.actor_name}</span>
            </span>
            <span className={cx('whitespace-nowrap font-semibold tabular-nums', mv.type === 'in' ? 'text-emerald-700' : 'text-slate-800')}>{mv.type === 'in' ? '+' : '−'}{qty(mv.quantity)}</span>
          </li>
        ))}
        {it.movements_total > it.movements.length && <li className="py-2.5 text-[0.8125rem] text-slate-600">{t('admin.inv.movementsShown', { n: it.movements.length, total: it.movements_total })}</li>}
        <li className="flex items-start gap-3 py-2.5 text-slate-600"><span className="min-w-0 flex-1">{t('admin.inv.opening')}</span><span className="tabular-nums">{qty(it.opening_qty)}</span></li>
      </ul>
      {editing && <ItemModal item={it} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** New stock item, or its card data (name, unit, category, storage, control, price, minimum, branch, active). Stock never changes here. */
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
  const [category, setCategory] = useState<string>(item?.category ?? 'consumable');
  const [storage, setStorage] = useState<string>(item?.storage ?? 'room');
  const [controlled, setControlled] = useState<boolean>(item?.controlled ?? false);
  const [price, setPrice] = useState(item ? String(Number(item.purchase_price) / 100) : '');
  const [pack, setPack] = useState(item?.pack_size != null ? String(Number(item.pack_size)) : '');
  const [err, setErr] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const num = (s: string) => Number(s.replace(',', '.'));
  const okNum = (s: string) => s.trim() !== '' && num(s) >= 0;
  const show = tried || !!item;
  const priceT = price.trim() ? parseSomToTiyin(price) : 0;
  const local = {
    name: show && name.trim().length < 2 ? t('admin.inv.errName') : undefined,
    unit: show && !unit.trim() ? t('admin.inv.errUnit') : undefined,
    branch_id: show && !branchId ? t('settings.rooms.errBranch') : undefined,
    minimum_qty: show && !okNum(minimum) ? t('admin.inv.errNumber') : undefined,
    opening_qty: !item && show && !okNum(opening) ? t('admin.inv.errNumber') : undefined,
    purchase_price: priceT == null ? t('wh.err.cost') : undefined,
    pack_size: pack.trim() && !(num(pack) > 0) ? t('admin.inv.errNumber') : undefined,
  };
  const invalid = Object.values(local).some(Boolean);
  const m = useMutation({
    mutationFn: () => {
      const body: any = { name: name.trim(), unit: unit.trim(), branch_id: branchId, minimum_qty: num(minimum), active, category, storage, controlled, purchase_price: priceT ?? 0, pack_size: pack.trim() ? num(pack) : null };
      return item ? api(`/inventory/${item.id}`, { method: 'PATCH', body }) : api('/inventory', { method: 'POST', body: { ...body, opening_qty: num(opening) } });
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['warehouse'] }); qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(item ? (r.data.changes.length ? t('admin.set.savedChanges', { changes: r.data.changes.join(', ') }) : t('admin.set.noChanges')) : t('admin.inv.created'));
      onClose(); if (!item) onCreated?.(r.data.id);
    },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  const e = (k: keyof typeof local) => err[k] ?? local[k];
  const save = () => { setTried(true); if (!invalid) m.mutate(); };
  const dirty = item ? name !== item.name || unit !== item.unit || branchId !== item.branch_id || num(minimum) !== Number(item.minimum_qty) || active !== item.active
    || category !== item.category || storage !== item.storage || controlled !== item.controlled || priceT !== Number(item.purchase_price) || (pack.trim() ? num(pack) : null) !== (item.pack_size == null ? null : Number(item.pack_size)) : !!(name || unit);
  const branches = item && !me.branches.some((b) => b.id === item.branch_id) ? [...me.branches, { id: item.branch_id, name: item.branch_name, code: '' }] : me.branches;
  return (
    <Modal open onClose={onClose} dirty={dirty} width="max-w-2xl" title={item ? t('admin.inv.editTitle', { name: item.name }) : t('admin.inv.addTitle')}
      footer={<><ModalCancel /><Button variant="primary" disabled={item ? !dirty : false} loading={m.isPending} onClick={save}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('admin.inv.name')} required className="sm:col-span-2" error={e('name')}>{(i) => <Input id={i} data-autofocus value={name} invalid={!!e('name')} maxLength={100} onChange={(ev) => setName(ev.target.value)} />}</Field>
        <Field label={t('wh.item.category')} required>{(i) => <Select id={i} value={category} onChange={(ev) => setCategory(ev.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`wh.cat.${c}` as MessageKey)}</option>)}</Select>}</Field>
        <Field label={t('wh.item.storage')} required>{(i) => <Select id={i} value={storage} onChange={(ev) => setStorage(ev.target.value)}>{STORAGE.map((c) => <option key={c} value={c}>{t(`wh.storage.${c}` as MessageKey)}</option>)}</Select>}</Field>
        <Field label={t('admin.inv.unit')} required hint={t('admin.inv.unitHint')} error={e('unit')}>{(i) => <Input id={i} value={unit} invalid={!!e('unit')} maxLength={20} onChange={(ev) => setUnit(ev.target.value)} />}</Field>
        <Field label={t('admin.inv.branch')} required error={e('branch_id')}>{(i) => (
          <Select id={i} value={branchId} invalid={!!e('branch_id')} onChange={(ev) => setBranchId(ev.target.value)}>
            <option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>)}</Field>
        <Field label={t('admin.inv.minQty')} required error={e('minimum_qty')}>{(i) => <Input id={i} inputMode="decimal" value={minimum} invalid={!!e('minimum_qty')} onChange={(ev) => setMinimum(ev.target.value)} />}</Field>
        <Field label={t('wh.item.price')} error={e('purchase_price')}>{(i) => <MoneyInput id={i} value={price} invalid={!!e('purchase_price')} onChange={(ev) => setPrice(ev.target.value)} />}</Field>
        <Field label={t('wh.item.packSize')} error={e('pack_size')}>{(i) => <Input id={i} inputMode="decimal" value={pack} invalid={!!e('pack_size')} onChange={(ev) => setPack(ev.target.value)} />}</Field>
        {!item && <Field label={t('admin.inv.openingQty')} required error={e('opening_qty')}>{(i) => <Input id={i} inputMode="decimal" value={opening} invalid={!!e('opening_qty')} onChange={(ev) => setOpening(ev.target.value)} />}</Field>}
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem] font-medium text-slate-900 sm:col-span-2"><input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-600" checked={controlled} onChange={(ev) => setControlled(ev.target.checked)} />{t('wh.item.controlledCheck')}</label>
        {item && <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem] font-medium text-slate-900 sm:col-span-2"><input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-600" checked={active} onChange={(ev) => setActive(ev.target.checked)} />{t('admin.inv.activeCheck')}</label>}
      </div>
    </Modal>
  );
}
