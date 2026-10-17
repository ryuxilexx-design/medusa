'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FlaskConical, Printer, Save, Search, TestTube } from 'lucide-react';
import { LAB_STATUS_LABEL } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { addDays, ageFrom, fmtDate, fmtDateTime, fullName, pid } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useUnsavedGuard } from '@/lib/unsaved';
import { Alert, Button, Card, cx, EmptyState, ErrorState, Input, LoadingRows, PageHeader, Pagination, Select, Tabs, Textarea, useToast } from '@/components/ui';
import { LabStatus } from '@/components/status';
import { LabValues, refText } from '@/components/lab-values';

const STATUS_TABS = ['', 'ordered', 'sample_collected', 'draft_result', 'verified'] as const;

export default function LabPage() { return <Suspense><Lab /></Suspense>; }

function Lab() {
  const { me, branchId } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const selected = sp.get('order');
  const [status, setStatus] = useState<string>(sp.get('status') ?? '');
  const [period, setPeriod] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const ds = useDebounced(search.trim(), 300);
  useEffect(() => setPage(1), [ds, status, period, branchId]);
  const from = period === 'today' ? me.today : period === '7d' ? addDays(me.today, -6) : undefined;
  const list = useQuery({
    queryKey: ['orders', 'lab', status, period, ds, page, branchId],
    queryFn: () => api(`/orders${qs({ status, from, to: from ? me.today : undefined, search: ds, page, page_size: 20, branch_id: branchId })}`),
    placeholderData: (p) => p, refetchInterval: 20_000,
  });
  const counts: Record<string, number> = Object.fromEntries((list.data?.meta.counts ?? []).map((c: any) => [c.status, c.n]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader title="Laboratoriya" subtitle={me.role === 'lab' ? 'Namuna → natija → tasdiqlash' : 'Buyurtmalar holati (natija qiymatlari faqat laboratoriya va shifokorga ko‘rinadi)'} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card padded={false}>
          <div className="px-3 pt-1"><Tabs value={status} onChange={setStatus} items={STATUS_TABS.map((s) => ({ value: s, label: s ? ({ ordered: 'Yangi', sample_collected: 'Namuna olindi', draft_result: 'Qoralama', verified: 'Tasdiqlangan' } as Record<string, string>)[s] : 'Barchasi', count: s ? counts[s] ?? 0 : total }))} /></div>
          <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
            <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bemor ismi yoki ID" aria-label="Bemor bo‘yicha qidirish" /></div>
            <Select aria-label="Sana" className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}><option value="all">Barcha sanalar</option><option value="today">Bugun</option><option value="7d">Oxirgi 7 kun</option></Select>
          </div>
          {list.isLoading ? <LoadingRows /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data.data.length ? <EmptyState icon={<FlaskConical className="h-8 w-8" />} title="Buyurtma topilmadi" /> : (
            <>
              <ul className="divide-y divide-slate-100">
                {list.data.data.map((o: any) => (
                  <li key={o.id}>
                    <button onClick={() => router.replace(`/lab?order=${o.id}`)} className={cx('flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50', selected === o.id && 'bg-brand-50 hover:bg-brand-50')}>
                      <TestTube className="h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{o.service_name}</div><div className="truncate text-xs text-slate-500">{fullName(o)} {pid(o.patient_number)} · {fmtDateTime(o.ordered_at)} · {o.branch_name}</div></div>
                      <LabStatus status={o.status} />
                    </button>
                  </li>
                ))}
              </ul>
              <Pagination page={page} pageSize={20} total={list.data.meta.total} onPage={setPage} />
            </>
          )}
        </Card>
        {selected ? <OrderDetail id={selected} /> : <Card><EmptyState title="Buyurtmani tanlang" text="Chapdagi ro‘yxatdan buyurtmani tanlang." /></Card>}
      </div>
    </>
  );
}

function OrderDetail({ id }: { id: string }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const o = useQuery({ queryKey: ['orders', 'one', id], queryFn: () => api(`/orders/${id}`).then((r) => r.data) });
  const [values, setValues] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [base, setBase] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!o.data) return;
    const v = Object.fromEntries((o.data.lab_template ?? []).map((p: any) => [p.code, (o.data.values ?? []).find((x: any) => x.code === p.code)?.value ?? '']));
    setValues(v); setComment(o.data.comment ?? ''); setBase(JSON.stringify([v, o.data.comment ?? ''])); setErrors({}); setErr(null);
  }, [o.data]);
  const dirty = JSON.stringify([values, comment]) !== base;
  useUnsavedGuard(dirty && me.role === 'lab');
  const refresh = () => ['orders', 'encounter', 'doctor-history', 'dashboard', 'patient'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const onErr = (e: unknown) => { setErr((e as Error).message); if (e instanceof ApiError && e.fields) setErrors(e.fields); if (e instanceof ApiError && e.status === 409) o.refetch(); };
  const collect = useMutation({ mutationFn: () => api(`/orders/${id}/collect`, { method: 'POST' }), onSuccess: () => { refresh(); toast.success('Namuna olindi'); }, onError: onErr });
  const save = useMutation({
    mutationFn: () => api(`/orders/${id}/result`, { method: 'PUT', body: { values: Object.entries(values).map(([code, value]) => ({ code, value })), comment: comment || null } }),
    onSuccess: () => { refresh(); setErr(null); setErrors({}); toast.success('Natija qoralamasi saqlandi'); }, onError: onErr,
  });
  const verify = useMutation({ mutationFn: () => api(`/orders/${id}/verify`, { method: 'POST' }), onSuccess: () => { refresh(); toast.success('Natija tasdiqlandi — shifokor kartasida ko‘rinadi'); }, onError: onErr });

  if (o.isLoading) return <Card><LoadingRows /></Card>;
  if (o.isError) return <Card><ErrorState error={o.error} onRetry={() => o.refetch()} /></Card>;
  const d = o.data;
  const isLab = me.role === 'lab';
  const editable = isLab && ['sample_collected', 'draft_result'].includes(d.status);
  const flagOf = (p: any, v: string) => { if (v === '' || isNaN(Number(v.replace(',', '.')))) return null; const n = Number(v.replace(',', '.')); return p.ref_low != null && n < p.ref_low ? 'Past' : p.ref_high != null && n > p.ref_high ? 'Yuqori' : 'Me’yorda'; };
  const steps = ['ordered', 'sample_collected', 'draft_result', 'verified'];
  const at = steps.indexOf(d.status);

  return (
    <Card padded={false} className="self-start" title={<span className="flex items-center gap-2">{d.service_name}<LabStatus status={d.status} /></span>}
      actions={d.status === 'verified' && (isLab || me.role === 'doctor') && <Link href={`/print/lab/${d.id}`} target="_blank" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><Printer className="h-4 w-4" />Chop etish</Link>}>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div><span className="text-slate-500">Bemor:</span> <b>{fullName(d)}</b> {pid(d.patient_number)}</div>
          <div><span className="text-slate-500">Yosh:</span> {fmtDate(d.birth_date)} · {ageFrom(d.birth_date, me.today)}</div>
          <div><span className="text-slate-500">Buyurtma:</span> {fmtDateTime(d.ordered_at)}</div>
          <div><span className="text-slate-500">Buyurtmachi:</span> {d.ordered_by ?? '—'}</div>
          <div><span className="text-slate-500">Filial:</span> {d.branch_name}</div>
          <div><span className="text-slate-500">Buyurtma ID:</span> <span className="font-mono text-xs">{d.id.slice(0, 8)}</span></div>
        </div>
        <ol className="flex items-center gap-1 text-xs">
          {steps.map((s, i) => <li key={s} className="flex items-center gap-1"><span className={cx('rounded-full px-2 py-0.5', i <= at ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500')}>{LAB_STATUS_LABEL[s]}</span>{i < steps.length - 1 && <span className="text-slate-300">→</span>}</li>)}
        </ol>
        <div className="space-y-0.5 text-xs text-slate-500">
          {d.collected_at && <p>Namuna olindi: {fmtDateTime(d.collected_at)} · {d.collected_by_name}</p>}
          {d.entered_at && <p>Natija kiritildi: {fmtDateTime(d.entered_at)} · {d.entered_by_name}</p>}
          {d.verified_at && <p className="font-medium text-emerald-700">Tasdiqlandi: {fmtDateTime(d.verified_at)} · {d.verified_by_name}</p>}
        </div>
        {err && <Alert tone="red">{err}</Alert>}
        {!isLab && <Alert tone="blue">Sizning rolingiz uchun faqat buyurtma holati ko‘rsatiladi.</Alert>}
        {isLab && d.status === 'ordered' && (
          <div className="rounded-md border border-dashed border-slate-300 p-4 text-center">
            <p className="mb-3 text-sm text-slate-600">Namuna olingach belgilang. Keyin natija kiritish ochiladi.</p>
            <Button variant="primary" icon={<TestTube className="h-4 w-4" />} loading={collect.isPending} onClick={() => collect.mutate()}>Namuna olindi</Button>
          </div>
        )}
        {isLab && editable && (
          <div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1">Parametr</th><th className="w-28 py-1">Qiymat</th><th className="py-1">Birlik</th><th className="py-1">Namunaviy referens</th><th className="py-1">Belgi</th></tr></thead>
              <tbody>{(d.lab_template ?? []).map((p: any, i: number) => {
                const f = flagOf(p, values[p.code] ?? '');
                return (
                  <tr key={p.code} className="border-t border-slate-100">
                    <td className="py-1.5 pr-2"><label htmlFor={`v-${p.code}`}>{p.name}</label></td>
                    <td className="py-1.5 pr-2"><Input id={`v-${p.code}`} className="h-8 text-right tabular-nums" inputMode="decimal" value={values[p.code] ?? ''} invalid={!!errors[`values.${i}`]}
                      onChange={(e) => setValues((x) => ({ ...x, [p.code]: e.target.value }))} /></td>
                    <td className="py-1.5 pr-2 text-slate-500">{p.unit}</td><td className="py-1.5 pr-2 tabular-nums text-slate-500">{refText(p)}</td>
                    <td className={cx('py-1.5 text-xs font-medium', f === 'Yuqori' || f === 'Past' ? 'text-red-700' : 'text-slate-500')}>{f ?? ''}</td>
                  </tr>
                );
              })}</tbody>
            </table>
            {Object.values(errors).filter(Boolean).length > 0 && <p className="mt-1 text-xs text-red-600">{Object.values(errors).join('; ')}</p>}
            <div className="mt-3"><label className="text-[13px] font-medium text-slate-700" htmlFor="lab-comment">Izoh</label><Textarea id="lab-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
            <p className="mt-2 text-xs text-slate-500">Referens oraliqlar namunaviy — klinik foydalanishga tekshirilmagan. Natija o‘zi tashxis chiqarmaydi.</p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Qoralama saqlash</Button>
              <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={verify.isPending} disabled={d.status !== 'draft_result' || dirty} title={dirty ? 'Avval qoralamani saqlang' : d.status !== 'draft_result' ? 'Avval natijani kiriting va saqlang' : undefined} onClick={() => verify.mutate()}>Natijani tasdiqlash</Button>
            </div>
          </div>
        )}
        {d.status === 'verified' && d.values && <div><LabValues values={d.values} />{d.comment && <p className="mt-2 text-sm"><span className="text-slate-500">Izoh:</span> {d.comment}</p>}<p className="mt-2 text-xs text-slate-500">Tasdiqlangan natija oddiy tahrirlanmaydi.</p></div>}
      </div>
    </Card>
  );
}
