'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
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
      <PageHeader title={t('admin.inv.title')} subtitle={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">{t('admin.inv.subtitle')} <span className="whitespace-nowrap"><DemoTag /></span></span>}
        actions={<label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1 text-[0.9375rem] focus-within:ring-4 focus-within:ring-amber-300"><input type="checkbox" className="h-5 w-5 accent-brand-600 focus:outline-none" checked={low} onChange={(e) => setLow(e.target.checked)} />{t('admin.inv.lowOnly')}</label>} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Card padded={false}>
          {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.length ? <EmptyState title={t('admin.inv.notFound')} /> : (
            <Table>
              <thead><tr><Th>{t('admin.inv.colItem')}</Th><Th right className="hidden md:table-cell">{t('admin.inv.colOpening')}</Th><Th right className="hidden md:table-cell">{t('admin.inv.colIn')}</Th><Th right className="hidden md:table-cell">{t('admin.inv.colOut')}</Th><Th right>{t('admin.inv.colQty')}</Th><Th right>{t('admin.inv.colMin')}</Th></tr></thead>
              <tbody>{q.data!.map((i) => {
                const isLow = Number(i.qty) < Number(i.minimum_qty);
                const open = () => router.replace(`/inventory?item=${i.id}${low ? '&low=1' : ''}`, { scroll: false });
                return (
                  <tr key={i.id} onClick={open} className={cx('cursor-pointer hover:bg-slate-50', sel === i.id && 'bg-brand-50')}>
                    <Td className="md:min-w-[11rem]">
                      <button type="button" onClick={(e) => { e.stopPropagation(); open(); }} aria-current={sel === i.id || undefined}
                        className="rounded text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">{i.name}</button>
                      <div className="text-[0.8125rem] text-slate-600">{i.unit}, {i.branch_name}</div>
                      {isLow && <Badge tone="red" className="mt-1" icon={<AlertTriangle className="h-3.5 w-3.5" />}>{t('admin.inv.low')}</Badge>}
                    </Td>
                    <Td right className="hidden md:table-cell">{n(i.opening_qty)}</Td><Td right className="hidden md:table-cell">{n(i.in_qty)}</Td><Td right className="hidden md:table-cell">{n(i.out_qty)}</Td>
                    <Td right className={isLow ? 'font-semibold text-red-700' : 'font-medium'}>{n(i.qty)}</Td>
                    <Td right className="text-slate-600">{n(i.minimum_qty)}</Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          )}
        </Card>
        {sel ? <ItemDetail id={sel} /> : <Card className="hidden xl:block"><EmptyState title={t('admin.inv.pick')} text={t('admin.inv.pickText')} /></Card>}
      </div>
      <p className="mt-3 text-[0.8125rem] text-slate-600">{t('admin.inv.autoNote')}</p>
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
  return (
    <div ref={top} className="scroll-mt-24">
    <Card title={it.name} actions={<><Button size="sm" icon={<ArrowDownToLine className="h-4 w-4" />} onClick={() => setForm('in')}>{t('admin.inv.in')}</Button><Button size="sm" icon={<ArrowUpFromLine className="h-4 w-4" />} onClick={() => setForm('out')}>{t('admin.inv.out')}</Button></>}>
      <p className="text-sm">{t('admin.inv.current')} <b className={cx('whitespace-nowrap', Number(it.qty) < Number(it.minimum_qty) && 'text-red-700')}>{n(it.qty)} {it.unit}</b>, {t('admin.inv.minimum', { n: n(it.minimum_qty) })}, {it.branch_name}</p>
      <h3 className="mb-1 mt-4 text-sm font-semibold text-slate-800">{t('admin.inv.history')}</h3>
      <ul className="divide-y divide-slate-100 text-sm">
        <li className="flex justify-between py-1.5 text-slate-600"><span>{t('admin.inv.opening')}</span><span className="tabular-nums">{n(it.opening_qty)}</span></li>
        {it.movements.map((mv: any) => (
          <li key={mv.id} className="flex items-start gap-3 py-2">
            <span className="w-[8.5rem] shrink-0 whitespace-nowrap text-[0.8125rem] tabular-nums text-slate-600">{fmtDateTime(mv.occurred_at)}</span>
            <span className="min-w-0 flex-1"><span className="block">{mv.reason}</span><span className="block text-[0.8125rem] text-slate-600">{mv.actor_name}</span></span>
            <span className={cx('tabular-nums font-semibold', mv.type === 'in' ? 'text-emerald-700' : 'text-slate-800')}>{mv.type === 'in' ? '+' : '−'}{n(mv.quantity)}</span>
          </li>
        ))}
      </ul>
      <Modal open={!!form} onClose={() => setForm(null)} dirty={!!(qty || reason)} title={form === 'in' ? t('admin.inv.modalIn', { name: it.name }) : t('admin.inv.modalOut', { name: it.name })}
        footer={<><Button onClick={() => setForm(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={m.isPending} onClick={save}>{t('common.save')}</Button></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('admin.inv.qty', { unit: it.unit })} required error={qtyError}>{(i) => <Input id={i} inputMode="decimal" value={qty} invalid={!!qtyError} onChange={(e) => setQty(e.target.value)} />}</Field>
          <Field label={t('admin.inv.date')} required error={err.date}>{(i) => <Input id={i} type="date" max={me.today} value={date} invalid={!!err.date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label={t('admin.inv.reason')} required className="sm:col-span-2" error={reasonError}>{(i) => <Input id={i} value={reason} invalid={!!reasonError} onChange={(e) => setReason(e.target.value)} placeholder={form === 'in' ? t('admin.inv.reasonIn') : t('admin.inv.reasonOut')} />}</Field>
          <p className="text-[0.8125rem] text-slate-600 sm:col-span-2">{t('admin.inv.responsible', { name: me.name })}</p>
        </div>
      </Modal>
    </Card>
    </div>
  );
}
