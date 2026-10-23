'use client';
// Warehouse documents: receipts (kirim), write-off acts (spisaniye), inventory counts — lists, forms and decisions.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, FileMinus, PackagePlus, Plus, Printer, Trash2 } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, formatSom, parseSomToTiyin } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Alert, Button, EmptyState, ErrorState, Field, Input, KeyVal, LinkButton, LoadingRows, Modal, ModalCancel, Pagination, Select, Table, Td, Th, useToast } from '@/components/ui';
import { MoneyInput } from '@/components/money-input';
import { ControlledBadge, Expiry, parseQty, qty, StatusBadge } from './common';

const invalidate = (qc: ReturnType<typeof useQueryClient>) => { qc.invalidateQueries({ queryKey: ['warehouse'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); };
/** The branch a new document belongs to: the header's branch, or the only one. */
export function useDocBranch() {
  const { me, branchId } = useSession();
  return branchId || (me.branches.length === 1 ? me.branches[0].id : '');
}
function BranchField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const t = useT();
  const { me } = useSession();
  if (me.branches.length === 1) return null;
  return <Field label={t('admin.inv.branch')} required error={error}>{(id) => (
    <Select id={id} value={value} invalid={!!error} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>)}</Field>;
}

// ------------------------------------------------------------------ receipts
export function ReceiptsTab() {
  const t = useT();
  const { branchId } = useSession();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['warehouse', 'receipts', branchId, page], queryFn: () => api(`/warehouse/receipts${qs({ branch_id: branchId || undefined, page, page_size: 20 })}`) });
  const rows: any[] = q.data?.data ?? [];
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!rows.length) return <EmptyState compact icon={<PackagePlus />} title={t('wh.rc.none')} />;
  return (
    <>
      <Table>
        <thead><tr><Th>{t('wh.col.doc')}</Th><Th>{t('wh.rc.supplier')}</Th><Th className="hidden sm:table-cell">{t('wh.rc.invoice')}</Th><Th right>{t('wh.col.sum')}</Th><Th><span className="sr-only">{t('common.print')}</span></Th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap font-semibold">K-{r.number}<div className="text-[0.8125rem] font-normal text-slate-600">{fmtDateTime(r.received_at)}</div></Td>
            <Td className="min-w-[9rem]">{r.supplier}<div className="text-[0.8125rem] text-slate-600">{t('wh.rc.lines', { n: r.lines })} · {r.received_by_name}</div></Td>
            <Td className="hidden sm:table-cell">{r.invoice_no}<div className="text-[0.8125rem] text-slate-600">{fmtDate(r.invoice_date)}</div></Td>
            <Td right>{formatSom(r.total)}</Td>
            <Td className="w-px"><LinkButton size="sm" variant="ghost" href={`/print/warehouse/receipt/${r.id}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('common.print')}</LinkButton></Td>
          </tr>
        ))}</tbody>
      </Table>
      <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={setPage} />
    </>
  );
}

type RcLine = { item_id: string; batch_no: string; expiry_date: string; qty: string; cost: string };
export function ReceiptModal({ onClose, presetItem }: { onClose: () => void; presetItem?: string }) {
  const t = useT();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [branch, setBranch] = useState(useDocBranch());
  const items = useQuery({ queryKey: ['inventory', branch], enabled: !!branch, queryFn: () => api(`/inventory${qs({ branch_id: branch })}`).then((r) => (r.data as any[]).filter((i) => i.active)) });
  const [supplier, setSupplier] = useState(''); const [invoice, setInvoice] = useState(''); const [date, setDate] = useState(me.today);
  const [lines, setLines] = useState<RcLine[]>([{ item_id: presetItem ?? '', batch_no: '', expiry_date: '', qty: '', cost: '' }]);
  const [err, setErr] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const set = (i: number, p: Partial<RcLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const lineCheck = (l: RcLine, i: number, show: boolean) => err[`lines.${i}.expiry_date`] ?? err[`lines.${i}.item_id`] ?? err[`lines.${i}.qty`] ?? (!show ? undefined
    : !l.item_id ? t('wh.err.item') : !l.batch_no.trim() ? t('wh.err.series') : !(parseQty(l.qty) > 0) ? t('admin.inv.errQty')
    : parseSomToTiyin(l.cost) == null ? t('wh.err.cost') : l.expiry_date && l.expiry_date < me.today ? t('wh.err.expired') : undefined);
  const lineErr = (l: RcLine, i: number) => lineCheck(l, i, tried);
  const total = lines.reduce((s, l) => s + Math.round((parseQty(l.qty) || 0) * (parseSomToTiyin(l.cost) ?? 0)), 0);
  const m = useMutation({
    mutationFn: () => api('/warehouse/receipts', { method: 'POST', body: { branch_id: branch, supplier: supplier.trim(), invoice_no: invoice.trim(), invoice_date: date,
      lines: lines.map((l) => ({ item_id: l.item_id, batch_no: l.batch_no.trim(), expiry_date: l.expiry_date || null, qty: parseQty(l.qty), unit_cost: parseSomToTiyin(l.cost) })) } }),
    onSuccess: (r: any) => { invalidate(qc); toast.success(t('wh.rc.done', { n: r.data.number })); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  const save = () => { setTried(true); setErr({}); if (branch && supplier.trim().length >= 2 && invoice.trim() && lines.every((l, i) => !lineCheck(l, i, true))) m.mutate(); };
  return (
    <Modal open onClose={onClose} width="max-w-4xl" dirty={!!supplier || lines.some((l) => l.item_id)} title={t('wh.rc.title')}
      footer={<><span className="mr-auto text-sm text-slate-700">{t('wh.rc.total', { sum: formatSom(total) })}</span><ModalCancel /><Button variant="primary" loading={m.isPending} onClick={save}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <BranchField value={branch} onChange={setBranch} error={tried && !branch ? t('settings.rooms.errBranch') : err.branch_id} />
          <Field label={t('wh.rc.supplier')} required error={err.supplier ?? (tried && supplier.trim().length < 2 ? t('wh.err.supplier') : undefined)}>{(id) => <Input id={id} data-autofocus value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} />}</Field>
          <Field label={t('wh.rc.invoice')} required error={err.invoice_no ?? (tried && !invoice.trim() ? t('wh.err.invoice') : undefined)}>{(id) => <Input id={id} value={invoice} maxLength={40} onChange={(e) => setInvoice(e.target.value)} />}</Field>
          <Field label={t('wh.rc.invoiceDate')} required error={err.invoice_date}>{(id) => <Input id={id} type="date" max={me.today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <fieldset className="space-y-3">
          <legend className="mb-1 text-[0.9375rem] font-semibold text-slate-900">{t('wh.req.lines')}</legend>
          {lines.map((l, i) => {
            const e = lineErr(l, i);
            const it = (items.data ?? []).find((x) => x.id === l.item_id);
            return (
              <div key={i} className="rounded-2xl border border-slate-200 p-3">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
                  <Select aria-label={t('wh.col.item')} className="col-span-2 lg:col-span-1" value={l.item_id} onChange={(ev) => set(i, { item_id: ev.target.value, cost: l.cost || String(((items.data ?? []).find((x) => x.id === ev.target.value)?.purchase_price ?? 0) / 100 || '') })}>
                    <option value="">—</option>{(items.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}, {x.unit}</option>)}
                  </Select>
                  <Input aria-label={t('wh.col.batch')} placeholder={t('wh.col.batch')} value={l.batch_no} maxLength={40} onChange={(ev) => set(i, { batch_no: ev.target.value })} />
                  <Input aria-label={t('wh.col.expiry')} type="date" min={me.today} value={l.expiry_date} onChange={(ev) => set(i, { expiry_date: ev.target.value })} />
                  <Input aria-label={t('admin.inv.qty', { unit: it?.unit ?? '' })} placeholder={it?.unit ?? t('wh.col.qty')} inputMode="decimal" value={l.qty} onChange={(ev) => set(i, { qty: ev.target.value })} />
                  <MoneyInput aria-label={t('wh.col.unitCost')} placeholder={t('wh.col.unitCost')} value={l.cost} onChange={(ev) => set(i, { cost: ev.target.value })} />
                  <Button variant="ghost" className="!px-3" aria-label={t('wh.req.removeLine')} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-5 w-5" /></Button>
                </div>
                {e && <p className="mt-1 text-sm font-medium text-red-700" role="alert">{e}</p>}
              </div>
            );
          })}
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} disabled={lines.length >= 100} onClick={() => setLines((ls) => [...ls, { item_id: '', batch_no: '', expiry_date: '', qty: '', cost: '' }])}>{t('wh.req.addLine')}</Button>
        </fieldset>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ write-off acts
export function WriteoffsTab() {
  const t = useT();
  const { branchId } = useSession();
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['warehouse', 'writeoffs', branchId, page], queryFn: () => api(`/warehouse/writeoffs${qs({ branch_id: branchId || undefined, page, page_size: 20 })}`) });
  const rows: any[] = q.data?.data ?? [];
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      {!rows.length ? <EmptyState compact icon={<FileMinus />} title={t('wh.wo.none')} /> : (
        <>
          <Table>
            <thead><tr><Th>{t('wh.col.doc')}</Th><Th>{t('admin.inv.reason')}</Th><Th right>{t('wh.col.sum')}</Th><Th>{t('admin.inv.colState')}</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSel(r.id)}>
                <Td className="whitespace-nowrap"><button type="button" className="font-semibold hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" onClick={(e) => { e.stopPropagation(); setSel(r.id); }}>A-{r.number}</button>
                  <div className="text-[0.8125rem] text-slate-600">{fmtDateTime(r.created_at)}</div></Td>
                <Td className="min-w-[10rem]">{t(`wh.wo.reason.${r.reason}` as MessageKey)}{r.controlled && <> <ControlledBadge /></>}<div className="text-[0.8125rem] text-slate-600">{r.note}</div></Td>
                <Td right>{formatSom(r.total)}</Td>
                <Td className="whitespace-nowrap"><StatusBadge status={r.status} /></Td>
              </tr>
            ))}</tbody>
          </Table>
          <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={setPage} />
        </>
      )}
      {sel && <WriteoffDetail id={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function WriteoffDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['warehouse', 'writeoff', id], queryFn: () => api(`/warehouse/writeoffs/${id}`).then((r) => r.data) });
  const m = useMutation({
    mutationFn: (approve: boolean) => api(`/warehouse/writeoffs/${id}/decide`, { method: 'POST', body: { approve } }),
    onSuccess: (_r, approve) => { invalidate(qc); toast.success(t(approve ? 'wh.wo.approved' : 'wh.wo.rejected')); onClose(); },
    onError: (e) => toast.error(e),
  });
  const w = q.data;
  const canDecide = w && me.role === 'manager' && w.status === 'pending' && w.created_by !== me.membership_id;
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={w ? <span className="flex flex-wrap items-center gap-2">{t('wh.wo.docTitle', { n: w.number })}<StatusBadge status={w.status} /></span> : '…'}
      footer={w && <>
        <LinkButton href={`/print/warehouse/writeoff/${id}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('common.print')}</LinkButton>
        <span className="mr-auto" />
        {canDecide && <Button loading={m.isPending} onClick={() => m.mutate(false)}>{t('wh.req.reject')}</Button>}
        {canDecide && <Button variant="primary" loading={m.isPending} onClick={() => m.mutate(true)}>{t('wh.wo.approve')}</Button>}
      </>}>
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="space-y-4">
          <div className="divide-y divide-slate-100">
            <KeyVal k={t('admin.inv.reason')} v={`${t(`wh.wo.reason.${w.reason}` as MessageKey)} — ${w.note}`} />
            <KeyVal k={t('wh.wo.commission')} v={w.commission.join(', ')} />
            <KeyVal k={t('wh.wo.drawnUp')} v={`${w.created_by_name}, ${fmtDateTime(w.created_at)}`} />
            {w.decided_by_name && <KeyVal k={t('wh.wo.decided')} v={`${w.decided_by_name}, ${fmtDateTime(w.decided_at)}`} />}
          </div>
          {me.role === 'manager' && w.status === 'pending' && !canDecide && <Alert tone="blue">{t('wh.wo.ownAct')}</Alert>}
          <Table>
            <thead><tr><Th>{t('wh.col.item')}</Th><Th>{t('wh.col.batch')}</Th><Th right>{t('wh.col.qty')}</Th><Th right>{t('wh.col.sum')}</Th></tr></thead>
            <tbody>{w.lines.map((l: any) => <tr key={l.id}><Td>{l.name}</Td><Td className="whitespace-nowrap">{l.batch_no ?? '—'}{l.expiry_date && <div className="text-[0.8125rem]"><Expiry date={l.expiry_date} today={me.today} /></div>}</Td><Td right>{qty(l.qty)} {l.unit}</Td><Td right>{formatSom(l.sum)}</Td></tr>)}</tbody>
          </Table>
        </div>
      )}
    </Modal>
  );
}

export function WriteoffModal({ onClose, presetBatch }: { onClose: () => void; presetBatch?: any }) {
  const t = useT();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [branch, setBranch] = useState(useDocBranch());
  const batches = useQuery({ queryKey: ['warehouse', 'batches', branch], enabled: !!branch, queryFn: () => api(`/warehouse/batches${qs({ branch_id: branch })}`).then((r) => r.data as any[]) });
  const [reason, setReason] = useState<string>(presetBatch?.expired ? 'expired' : '');
  const [note, setNote] = useState('');
  const [members, setMembers] = useState<string[]>([me.name, '', '']);
  const [lines, setLines] = useState<{ batch_id: string; qty: string }[]>([{ batch_id: presetBatch?.id ?? '', qty: presetBatch ? String(Number(presetBatch.qty)) : '' }]);
  const [err, setErr] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const commission = members.map((s) => s.trim()).filter(Boolean);
  const local = {
    reason: tried && !reason ? t('wh.err.reason') : undefined,
    note: tried && note.trim().length < 3 ? t('admin.inv.errReason') : undefined,
    commission: tried && commission.length < 3 ? t('wh.err.commission') : undefined,
  };
  const lineCheck = (l: { batch_id: string; qty: string }, i: number, show: boolean) => err[`lines.${i}.qty`] ?? err[`lines.${i}.batch_id`] ?? (!show ? undefined : !l.batch_id ? t('wh.err.batch') : !(parseQty(l.qty) > 0) ? t('admin.inv.errQty') : undefined);
  const lineErr = (l: { batch_id: string; qty: string }, i: number) => lineCheck(l, i, tried);
  const m = useMutation({
    mutationFn: () => api('/warehouse/writeoffs', { method: 'POST', body: { branch_id: branch, reason, note: note.trim(), commission, lines: lines.map((l) => ({ batch_id: l.batch_id, qty: parseQty(l.qty) })) } }),
    onSuccess: (r: any) => { invalidate(qc); toast.success(t('wh.wo.done', { n: r.data.number })); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  const save = () => { setTried(true); setErr({}); if (branch && reason && note.trim().length >= 3 && commission.length >= 3 && lines.every((l, i) => !lineCheck(l, i, true))) m.mutate(); };
  return (
    <Modal open onClose={onClose} width="max-w-3xl" dirty={!!note || lines.some((l) => l.batch_id)} title={t('wh.wo.title')}
      footer={<><ModalCancel /><Button variant="primary" loading={m.isPending} onClick={save}>{t('wh.wo.create')}</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <BranchField value={branch} onChange={setBranch} error={tried && !branch ? t('settings.rooms.errBranch') : undefined} />
          <Field label={t('admin.inv.reason')} required error={local.reason ?? err.reason}>{(id) => (
            <Select id={id} value={reason} invalid={!!(local.reason ?? err.reason)} onChange={(e) => setReason(e.target.value)}>
              <option value="">—</option>{['expired', 'damaged', 'lost', 'other'].map((r) => <option key={r} value={r}>{t(`wh.wo.reason.${r}` as MessageKey)}</option>)}
            </Select>)}</Field>
          <Field label={t('wh.wo.note')} required className="sm:col-span-2" error={local.note ?? err.note}>{(id) => <Input id={id} value={note} maxLength={300} invalid={!!(local.note ?? err.note)} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-[0.9375rem] font-semibold text-slate-900">{t('wh.wo.commission')}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {members.map((v, i) => <Input key={i} aria-label={t('wh.wo.member', { n: i + 1 })} placeholder={t('wh.wo.member', { n: i + 1 })} value={v} maxLength={120} onChange={(e) => setMembers((ms) => ms.map((x, j) => (j === i ? e.target.value : x)))} />)}
          </div>
          {(local.commission ?? err.commission) && <p className="mt-1 text-sm font-medium text-red-700" role="alert">{local.commission ?? err.commission}</p>}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[0.9375rem] font-semibold text-slate-900">{t('wh.req.lines')}</legend>
          {lines.map((l, i) => {
            const e = lineErr(l, i);
            return (
              <div key={i} className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                <Select aria-label={t('wh.col.batch')} className="min-w-0 flex-1 basis-full sm:basis-0" value={l.batch_id} onChange={(ev) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, batch_id: ev.target.value } : x)))}>
                  <option value="">—</option>
                  {(batches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name} · {b.batch_no ?? '—'}{b.expiry_date ? ` · ${fmtDate(b.expiry_date)}` : ''}{b.expired ? ` · ${t('wh.expired')}` : ''} · {qty(b.qty)} {b.unit}</option>)}
                </Select>
                <Input aria-label={t('wh.col.qty')} inputMode="decimal" className="w-28" value={l.qty} onChange={(ev) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: ev.target.value } : x)))} />
                <Button variant="ghost" className="!px-3" aria-label={t('wh.req.removeLine')} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-5 w-5" /></Button>
                {e && <p className="basis-full text-sm font-medium text-red-700" role="alert">{e}</p>}
              </div>
            );
          })}
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setLines((ls) => [...ls, { batch_id: '', qty: '' }])}>{t('wh.req.addLine')}</Button>
        </fieldset>
        <Alert tone="blue">{t('wh.wo.hint')}</Alert>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ inventory counts
export function CountsTab() {
  const t = useT();
  const { branchId } = useSession();
  const [sel, setSel] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['warehouse', 'counts', branchId], queryFn: () => api(`/warehouse/counts${qs({ branch_id: branchId || undefined })}`).then((r) => r.data as any[]) });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      {!q.data!.length ? <EmptyState compact icon={<ClipboardCheck />} title={t('wh.cnt.none')} /> : (
        <Table>
          <thead><tr><Th>{t('wh.col.doc')}</Th><Th>{t('wh.cnt.scope')}</Th><Th right>{t('wh.cnt.diffs')}</Th><Th>{t('admin.inv.colState')}</Th></tr></thead>
          <tbody>{q.data!.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSel(c.id)}>
              <Td className="whitespace-nowrap"><button type="button" className="font-semibold hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" onClick={(e) => { e.stopPropagation(); setSel(c.id); }}>I-{c.number}</button>
                <div className="text-[0.8125rem] text-slate-600">{fmtDateTime(c.started_at)} · {c.branch_name}</div></Td>
              <Td>{t(`wh.cnt.scope.${c.scope}` as MessageKey)}<div className="text-[0.8125rem] text-slate-600">{t('wh.cnt.batches', { n: c.lines })}</div></Td>
              <Td right>{c.differences}</Td>
              <Td className="whitespace-nowrap"><StatusBadge status={c.status} /></Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      {sel && <CountDetail id={sel} onClose={() => setSel(null)} />}
    </>
  );
}

export function CountStartModal({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [branch, setBranch] = useState(useDocBranch());
  const [scope, setScope] = useState<'all' | 'controlled'>('all');
  const [members, setMembers] = useState('');
  const m = useMutation({
    mutationFn: () => api('/warehouse/counts', { method: 'POST', body: { branch_id: branch, scope, commission: members.split(',').map((s) => s.trim()).filter((s) => s.length >= 3).slice(0, 5) } }),
    onSuccess: (r: any) => { invalidate(qc); toast.success(t('wh.cnt.started', { n: r.data.number })); onClose(); onStarted(r.data.id); },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open onClose={onClose} title={t('wh.cnt.start')} footer={<><ModalCancel /><Button variant="primary" disabled={!branch} loading={m.isPending} onClick={() => m.mutate()}>{t('wh.cnt.start')}</Button></>}>
      <div className="space-y-4">
        <BranchField value={branch} onChange={setBranch} />
        <Field label={t('wh.cnt.scope')} required>{(id) => (
          <Select id={id} value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'controlled')}>
            <option value="all">{t('wh.cnt.scope.all')}</option><option value="controlled">{t('wh.cnt.scope.controlled')}</option>
          </Select>)}</Field>
        <Field label={t('wh.wo.commission')} hint={t('wh.cnt.membersHint')}>{(id) => <Input id={id} value={members} maxLength={400} onChange={(e) => setMembers(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function CountDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['warehouse', 'count', id], queryFn: () => api(`/warehouse/counts/${id}`).then((r) => r.data) });
  const [edit, setEdit] = useState<Record<string, { counted: string; reason: string }>>({});
  const c = q.data;
  const val = (l: any) => edit[l.id] ?? { counted: l.counted_qty == null ? '' : String(Number(l.counted_qty)), reason: l.reason ?? '' };
  const save = useMutation({
    mutationFn: () => api(`/warehouse/counts/${id}/lines`, { method: 'PUT', body: { lines: c.lines.map((l: any) => { const v = val(l); const n = parseQty(v.counted); return { line_id: l.id, counted_qty: Number.isNaN(n) ? null : n, reason: v.reason.trim() || null }; }) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouse', 'count', id] }); setEdit({}); toast.success(t('wh.cnt.saved')); },
    onError: (e) => toast.error(e),
  });
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: any }) => api(`/warehouse/counts/${id}/${path}`, { method: 'POST', body: body ?? {} }),
    onSuccess: () => { invalidate(qc); toast.success(t('wh.cnt.done')); onClose(); },
    onError: (e) => toast.error(e),
  });
  const open = c?.status === 'open';
  const dirty = Object.keys(edit).length > 0;
  return (
    <Modal open onClose={onClose} width="max-w-4xl" dirty={dirty} title={c ? <span className="flex flex-wrap items-center gap-2">{t('wh.cnt.docTitle', { n: c.number })}<StatusBadge status={c.status} /></span> : '…'}
      footer={c && <>
        <LinkButton href={`/print/warehouse/count/${id}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('common.print')}</LinkButton>
        <span className="mr-auto" />
        {open && <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{t('common.save')}</Button>}
        {open && <Button variant="primary" disabled={dirty} loading={act.isPending} onClick={() => act.mutate({ path: 'submit' })}>{t('wh.cnt.submit')}</Button>}
        {c.status === 'submitted' && me.role === 'manager' && <><Button loading={act.isPending} onClick={() => act.mutate({ path: 'decide', body: { approve: false } })}>{t('wh.req.reject')}</Button>
          <Button variant="primary" loading={act.isPending} onClick={() => act.mutate({ path: 'decide', body: { approve: true } })}>{t('wh.cnt.approve')}</Button></>}
      </>}>
      {q.isLoading ? <LoadingRows rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <Table>
          <thead><tr><Th>{t('wh.col.item')}</Th><Th>{t('wh.col.batch')}</Th><Th right>{t('wh.cnt.expected')}</Th><Th right>{t('wh.cnt.counted')}</Th><Th>{t('admin.inv.reason')}</Th></tr></thead>
          <tbody>{c.lines.map((l: any) => {
            const v = val(l);
            const diff = v.counted !== '' && parseQty(v.counted) !== Number(l.expected_qty);
            return (
              <tr key={l.id} className={diff ? 'bg-amber-50' : ''}>
                <Td className="min-w-[9rem]">{l.name}{l.controlled && <> <ControlledBadge /></>}</Td>
                <Td className="whitespace-nowrap">{l.batch_no ?? '—'}{l.expiry_date && <div className="text-[0.8125rem]"><Expiry date={l.expiry_date} today={me.today} /></div>}</Td>
                <Td right>{qty(l.expected_qty)} {l.unit}</Td>
                <Td right>{open ? <Input aria-label={t('wh.cnt.counted')} inputMode="decimal" className="ml-auto w-24" value={v.counted} onChange={(e) => setEdit((x) => ({ ...x, [l.id]: { ...v, counted: e.target.value } }))} /> : qty(l.counted_qty)}</Td>
                <Td className="min-w-[10rem]">{open ? (diff ? <Input aria-label={t('admin.inv.reason')} value={v.reason} maxLength={200} onChange={(e) => setEdit((x) => ({ ...x, [l.id]: { ...v, reason: e.target.value } }))} /> : null) : l.reason}</Td>
              </tr>
            );
          })}</tbody>
        </Table>
      )}
    </Modal>
  );
}
