'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, cx, DemoTag, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, PageHeader, Table, Td, Th, useToast } from '@/components/ui';

export default function InventoryPage() { return <Suspense><Inventory /></Suspense>; }
const n = (v: any) => Number(v).toLocaleString('ru-RU').replace(/ /g, ' ');

function Inventory() {
  const t = useT();
  const { branchId } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const [low, setLow] = useState(sp.get('low') === '1');
  const sel = sp.get('item');
  const q = useQuery({ queryKey: ['inventory', low, branchId], queryFn: () => api(`/inventory${qs({ low: low ? 1 : undefined, branch_id: branchId })}`).then((r) => r.data as any[]) });
  return (
    <>
      <PageHeader title={t('admin.inv.title')} subtitle={<span className="flex items-center gap-2">{t('admin.inv.subtitle')} <DemoTag /></span>}
        actions={<label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={low} onChange={(e) => setLow(e.target.checked)} />{t('admin.inv.lowOnly')}</label>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Card padded={false}>
          {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.length ? <EmptyState title={t('admin.inv.notFound')} /> : (
            <Table>
              <thead><tr><Th>{t('admin.inv.colItem')}</Th><Th right>{t('admin.inv.colOpening')}</Th><Th right>{t('admin.inv.colIn')}</Th><Th right>{t('admin.inv.colOut')}</Th><Th right>{t('admin.inv.colQty')}</Th><Th right>{t('admin.inv.colMin')}</Th></tr></thead>
              <tbody>{q.data!.map((i) => {
                const isLow = Number(i.qty) < Number(i.minimum_qty);
                return (
                  <tr key={i.id} onClick={() => router.replace(`/inventory?item=${i.id}${low ? '&low=1' : ''}`)} className={cx('cursor-pointer hover:bg-slate-50', sel === i.id && 'bg-brand-50')}>
                    <Td><div className="font-medium">{i.name}</div><div className="text-xs text-slate-600">{i.unit}, {i.branch_name}</div></Td>
                    <Td right>{n(i.opening_qty)}</Td><Td right>{n(i.in_qty)}</Td><Td right>{n(i.out_qty)}</Td>
                    <Td right className={isLow ? 'font-semibold text-red-700' : 'font-medium'}><span className="inline-flex items-center gap-1.5">{isLow && <Badge tone="red" icon={<AlertTriangle className="h-3 w-3" />}>{t('admin.inv.low')}</Badge>}{n(i.qty)}</span></Td>
                    <Td right className="text-slate-600">{n(i.minimum_qty)}</Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          )}
        </Card>
        {sel ? <ItemDetail id={sel} /> : <Card><EmptyState title={t('admin.inv.pick')} text={t('admin.inv.pickText')} /></Card>}
      </div>
      <p className="mt-3 text-xs text-slate-600">{t('admin.inv.autoNote')}</p>
    </>
  );
}

function ItemDetail({ id }: { id: string }) {
  const t = useT();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['inventory', 'item', id], queryFn: () => api(`/inventory/${id}`).then((r) => r.data) });
  const [form, setForm] = useState<null | 'in' | 'out'>(null);
  const [qty, setQty] = useState(''); const [reason, setReason] = useState(''); const [date, setDate] = useState(me.today);
  const [err, setErr] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api(`/inventory/${id}/movements`, { method: 'POST', body: { type: form, quantity: Number(qty.replace(',', '.')), reason, date } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toast.success(form === 'in' ? t('admin.inv.inDone') : t('admin.inv.outDone')); setForm(null); setQty(''); setReason(''); setErr({}); },
    onError: (e) => { if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); },
  });
  if (q.isLoading) return <Card><LoadingRows /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const it = q.data;
  const qn = Number(qty.replace(',', '.'));
  const valid = qn > 0 && reason.trim().length >= 3 && (form !== 'out' || qn <= Number(it.qty));
  return (
    <Card title={it.name} actions={<><Button size="sm" icon={<ArrowDownToLine className="h-3.5 w-3.5" />} onClick={() => setForm('in')}>{t('admin.inv.in')}</Button><Button size="sm" icon={<ArrowUpFromLine className="h-3.5 w-3.5" />} onClick={() => setForm('out')}>{t('admin.inv.out')}</Button></>}>
      <p className="text-sm">{t('admin.inv.current')} <b className={Number(it.qty) < Number(it.minimum_qty) ? 'text-red-700' : ''}>{n(it.qty)} {it.unit}</b>, {t('admin.inv.minimum', { n: n(it.minimum_qty) })}, {it.branch_name}</p>
      <h3 className="mb-1 mt-4 text-[0.8125rem] font-semibold text-slate-600">{t('admin.inv.history')}</h3>
      <ul className="divide-y divide-slate-100 text-sm">
        <li className="flex justify-between py-1.5 text-slate-600"><span>{t('admin.inv.opening')}</span><span className="tabular-nums">{n(it.opening_qty)}</span></li>
        {it.movements.map((mv: any) => <li key={mv.id} className="flex items-center gap-3 py-1.5"><span className="w-32 text-xs text-slate-600">{fmtDateTime(mv.occurred_at)}</span><span className="flex-1">{mv.reason}, <span className="text-xs text-slate-600">{mv.actor_name}</span></span><span className={cx('tabular-nums font-medium', mv.type === 'in' ? 'text-emerald-700' : 'text-slate-700')}>{mv.type === 'in' ? '+' : '−'}{n(mv.quantity)}</span></li>)}
      </ul>
      <Modal open={!!form} onClose={() => setForm(null)} dirty={!!(qty || reason)} title={form === 'in' ? t('admin.inv.modalIn', { name: it.name }) : t('admin.inv.modalOut', { name: it.name })}
        footer={<><Button onClick={() => setForm(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>{t('common.save')}</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('admin.inv.qty', { unit: it.unit })} required error={err.quantity ?? (form === 'out' && qn > Number(it.qty) ? t('admin.inv.tooMuch', { qty: n(it.qty) }) : undefined)}>{(i) => <Input id={i} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />}</Field>
          <Field label={t('admin.inv.date')} required error={err.date}>{(i) => <Input id={i} type="date" max={me.today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label={t('admin.inv.reason')} required className="col-span-2" error={err.reason}>{(i) => <Input id={i} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={form === 'in' ? t('admin.inv.reasonIn') : t('admin.inv.reasonOut')} />}</Field>
          <p className="col-span-2 text-xs text-slate-600">{t('admin.inv.responsible', { name: me.name })}</p>
        </div>
      </Modal>
    </Card>
  );
}
