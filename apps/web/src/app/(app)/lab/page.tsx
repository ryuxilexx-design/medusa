'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, CheckCircle2, ChevronRight, FlaskConical, Printer, Save, Search, TestTube } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError, qs } from '@/lib/api';
import { addDays, ageFrom, fmtDate, fmtDateTime, fmtTime, fullName, localDate, pid } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useUnsavedGuard } from '@/lib/unsaved';
import { useT } from '@/lib/i18n';
import { Alert, Button, Card, cx, EmptyState, ErrorState, Input, LinkButton, LoadingRows, PageHeader, Pagination, Select, Tabs, Textarea, Toolbar, useToast } from '@/components/ui';
import { LabStatus } from '@/components/status';
import { LabValues, refText } from '@/components/lab-values';

const STATUS_TABS = ['', 'ordered', 'sample_collected', 'draft_result', 'verified'] as const;
const TAB_LABEL: Record<string, MessageKey> = { '': 'clinical.lab.tabAll', ordered: 'clinical.lab.tabNew', sample_collected: 'status.lab.sample_collected', draft_result: 'clinical.lab.tabDraft', verified: 'status.lab.verified' };

export default function LabPage() { return <Suspense><Lab /></Suspense>; }

function Lab() {
  const { me, branchId } = useSession();
  const t = useT();
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
  // keep the tab in the URL so a reload (or a link from the dashboard) shows the same list
  const nav = (st: string, order: string | null) => { const q = new URLSearchParams(); if (st) q.set('status', st); if (order) q.set('order', order); const qs2 = q.toString(); router.replace(`/lab${qs2 ? `?${qs2}` : ''}`, { scroll: false }); };
  const pick = (id: string) => { nav(status, id); revealDetail(); };
  const showBranch = !branchId && me.branches.length > 1;
  // a wide screen never shows an empty detail beside a full list: the first order opens by itself
  const first = list.data?.data?.[0]?.id as string | undefined;
  useEffect(() => {
    if (!selected && first && window.matchMedia('(min-width: 1280px)').matches) nav(status, first);
  }, [selected, first]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title={t('clinical.lab.title')} subtitle={me.role === 'lab' ? t('clinical.lab.subtitleLab') : t('clinical.lab.subtitleOther')}
        actions={<Select aria-label={t('clinical.date')} className="w-full min-w-0 sm:w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}><option value="all">{t('clinical.period.all')}</option><option value="today">{t('clinical.period.today')}</option><option value="7d">{t('clinical.period.last7')}</option></Select>} />
      <div className="mb-5"><Tabs value={status} onChange={(v) => { setStatus(v); nav(v, selected); }} items={STATUS_TABS.map((s) => ({ value: s, label: t(TAB_LABEL[s]), count: s ? counts[s] ?? 0 : total }))} /></div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card padded={false} className="self-start">
          <Toolbar>
            <div className="relative w-full"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" /><Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('clinical.lab.searchPlaceholder')} aria-label={t('clinical.lab.searchLabel')} /></div>
          </Toolbar>
          {list.isLoading ? <LoadingRows /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data.data.length ? <EmptyState compact icon={<FlaskConical />} title={t('clinical.lab.noOrders')} action={search ? <Button size="sm" onClick={() => setSearch('')}>{t('clinical.lab.clearSearch')}</Button> : undefined} /> : (
            <>
              <ul className="divide-y divide-slate-100">
                {list.data.data.map((o: any) => (
                  <li key={o.id}>
                    {/* test and time on the first line; patient (and the status, unless a status tab already says it) on the second */}
                    <button onClick={() => pick(o.id)} aria-current={selected === o.id || undefined}
                      className={cx('block w-full border-l-4 px-4 py-2.5 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300', selected === o.id ? 'border-brand-600 bg-brand-50' : 'border-transparent hover:bg-slate-50')}>
                      {/* the test and the patient are read whole (two lines at most); time and status keep the right edge */}
                      <span className="flex items-start gap-3">
                        <span className="line-clamp-2 min-w-0 flex-1 text-[0.9375rem] font-semibold leading-snug text-slate-900">{o.service_name}</span>
                        <span className="shrink-0 pt-0.5 text-[0.8125rem] tabular-nums text-slate-600">{localDate(o.ordered_at) === me.today ? fmtTime(o.ordered_at) : fmtDateTime(o.ordered_at)}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="min-w-0 flex-1 basis-[11rem] text-[0.8125rem] leading-snug text-slate-600"><span className="font-medium text-slate-800">{fullName(o)}</span> <span className="whitespace-nowrap tabular-nums">{pid(o.patient_number)}</span>{showBranch && <span className="block">{o.branch_name}</span>}</span>
                        {!status && <span className="shrink-0"><LabStatus status={o.status} /></span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <Pagination page={page} pageSize={20} total={list.data.meta.total} onPage={setPage} />
            </>
          )}
        </Card>
        <div id="order-detail" className="min-w-0 scroll-mt-24 self-start xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:rounded-xl">
          {selected ? <OrderDetail id={selected} /> : <div className="hidden xl:block"><Card><EmptyState icon={<TestTube />} title={t('clinical.pickOrder')} /></Card></div>}
        </div>
      </div>
    </>
  );
}

/** Below xl the detail sits under the list: bring it into view after a tap so the click visibly does something. */
function revealDetail() {
  if (typeof window === 'undefined' || window.matchMedia('(min-width: 1280px)').matches) return;
  setTimeout(() => document.getElementById('order-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

function OrderDetail({ id }: { id: string }) {
  const { me } = useSession();
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const o = useQuery({ queryKey: ['orders', 'one', id], queryFn: () => api(`/orders/${id}`).then((r) => r.data) });
  const [values, setValues] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [base, setBase] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  // a 409 (changed in another window) reloads the order; the explanation must survive that reload
  const afterReload = useRef<string | null>(null);
  useEffect(() => {
    if (!o.data) return;
    const v = Object.fromEntries((o.data.lab_template ?? []).map((p: any) => [p.code, (o.data.values ?? []).find((x: any) => x.code === p.code)?.value ?? '']));
    setValues(v); setComment(o.data.comment ?? ''); setBase(JSON.stringify([v, o.data.comment ?? ''])); setErrors({}); setErr(afterReload.current); afterReload.current = null;
  }, [o.data]);
  const dirty = JSON.stringify([values, comment]) !== base;
  useUnsavedGuard(dirty && me.role === 'lab');
  const refresh = () => ['orders', 'encounter', 'doctor-history', 'dashboard', 'patient'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const onErr = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) { afterReload.current = t('clinical.lab.changedElsewhere', { msg: e.message }); setErr(afterReload.current); o.refetch(); return; }
    // field errors are shown next to the table; the general line only when there is nothing more specific
    if (e instanceof ApiError && e.fields && Object.keys(e.fields).length) { setErrors(e.fields); setErr(null); return; }
    setErr((e as Error).message);
  };
  const collect = useMutation({ mutationFn: () => api(`/orders/${id}/collect`, { method: 'POST' }), onSuccess: () => { refresh(); toast.success(t('clinical.lab.collect')); }, onError: onErr });
  const save = useMutation({
    mutationFn: () => api(`/orders/${id}/result`, { method: 'PUT', body: { values: Object.entries(values).map(([code, value]) => ({ code, value })), comment: comment || null } }),
    onSuccess: () => { refresh(); setErr(null); setErrors({}); toast.success(t('clinical.lab.draftSaved')); }, onError: onErr,
  });
  // the server answers `already` when another window verified first: that is information, not this person's success
  const verify = useMutation({ mutationFn: () => api(`/orders/${id}/verify`, { method: 'POST' }), onSuccess: (r: any) => { refresh(); if (r?.data?.already) toast.info(t('clinical.lab.alreadyVerified')); else toast.success(t('clinical.lab.verifiedToast')); }, onError: onErr });

  if (o.isLoading) return <Card><LoadingRows /></Card>;
  if (o.isError) return <Card><ErrorState error={o.error} onRetry={() => o.refetch()} /></Card>;
  const d = o.data;
  const isLab = me.role === 'lab';
  const editable = isLab && ['sample_collected', 'draft_result'].includes(d.status);
  const flagOf = (p: any, v: string): 'low' | 'high' | 'normal' | null => { if (v === '' || isNaN(Number(v.replace(',', '.')))) return null; const n = Number(v.replace(',', '.')); return p.ref_low != null && n < p.ref_low ? 'low' : p.ref_high != null && n > p.ref_high ? 'high' : 'normal'; };
  // a parameter with a numeric reference range expects a number; free-text parameters (e.g. colour) are left alone
  const notNumber = (p: any, v: string) => v.trim() !== '' && (p.ref_low != null || p.ref_high != null) && isNaN(Number(v.trim().replace(',', '.')));
  const nonNumeric = (d.lab_template ?? []).filter((p: any) => notNumber(p, values[p.code] ?? '')).map((p: any) => p.name);
  const serverFieldErrors = Object.entries(errors).filter(([k, v]) => v && !(k.startsWith('values.') && notNumber(d.lab_template?.[Number(k.split('.')[1])] ?? {}, values[d.lab_template?.[Number(k.split('.')[1])]?.code] ?? ''))).map(([, v]) => v);
  const verifyBlocked = dirty ? t('clinical.lab.saveFirst') : d.status !== 'draft_result' ? t('clinical.lab.enterFirst') : null;
  const steps = ['ordered', 'sample_collected', 'draft_result', 'verified'];
  const at = steps.indexOf(d.status);

  return (
    <Card padded={false} className="self-start" title={<span className="flex flex-wrap items-center gap-2">{d.service_name}{d.status === 'cancelled' && <LabStatus status={d.status} />}</span>}
      actions={d.status === 'verified' && (isLab || me.role === 'doctor') && <LinkButton size="sm" variant="ghost" href={`/print/lab/${d.id}`} target="_blank" icon={<Printer className="h-4 w-4" />}>{t('common.print')}</LinkButton>}>
      <div className="space-y-4 p-5">
        <div>
          <p className="text-base text-slate-900"><b>{fullName(d)}</b> <span className="tabular-nums text-slate-600">{pid(d.patient_number)}</span> <span className="text-slate-400" aria-hidden="true">·</span> <span className="whitespace-nowrap tabular-nums">{ageFrom(d.birth_date, me.today)} ({fmtDate(d.birth_date)})</span></p>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.8125rem] text-slate-600">
            <div className="flex gap-1"><dt>{t('clinical.f.ordered')}</dt><dd className="tabular-nums text-slate-800">{fmtDateTime(d.ordered_at)}{d.ordered_by ? `, ${d.ordered_by}` : ''}</dd></div>
            <div className="flex gap-1"><dt>{t('clinical.f.branch')}</dt><dd className="text-slate-800">{d.branch_name}</dd></div>
            <div className="flex gap-1"><dt>{t('clinical.f.orderId')}</dt><dd className="font-mono text-slate-800">{d.id.slice(0, 8)}</dd></div>
          </dl>
        </div>
        {/* the workflow: done steps ticked, the current one blue (green once verified) */}
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[0.8125rem]">
          {steps.map((s, i) => {
            const done = i < at || (i === at && s === 'verified');
            return (
              <li key={s} className="flex items-center gap-1" aria-current={i === at ? 'step' : undefined}>
                <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 font-semibold', done ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200' : i === at ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600')}>
                  {done && <Check className="h-3.5 w-3.5" aria-hidden="true" />}{t(`status.lab.${s}` as MessageKey)}
                </span>
                {i < steps.length - 1 && <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
        {(d.collected_at || d.entered_at || d.verified_at) && (
          <div className="space-y-0.5 text-[0.8125rem] text-slate-600">
            {d.collected_at && <p>{t('clinical.lab.collectedAt', { at: fmtDateTime(d.collected_at), name: d.collected_by_name })}</p>}
            {d.entered_at && <p>{t('clinical.lab.enteredAt', { at: fmtDateTime(d.entered_at), name: d.entered_by_name })}</p>}
            {d.verified_at && <p className="font-medium text-emerald-800">{t('clinical.lab.verifiedAt', { at: fmtDateTime(d.verified_at), name: d.verified_by_name })}</p>}
          </div>
        )}
        {err && <Alert tone="red">{err}</Alert>}
        {!isLab && <Alert tone="blue">{t('clinical.lab.statusOnly')}</Alert>}
        {isLab && d.status === 'ordered' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50/60 px-4 py-3">
            <p className="min-w-0 flex-1 basis-[14rem] text-[0.9375rem] text-slate-900">{t('clinical.lab.collectHint')}</p>
            <Button variant="primary" className="max-sm:w-full" icon={<TestTube className="h-4 w-4" />} loading={collect.isPending} onClick={() => collect.mutate()}>{t('clinical.lab.collectAction')}</Button>
          </div>
        )}
        {isLab && editable && (
          <div>
            <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full text-sm sm:min-w-[26rem]">
              <thead><tr className="text-left text-[0.8125rem] font-semibold text-slate-600"><th className="py-1 pr-2">{t('lab.param')}</th><th className="w-28 py-1 pr-2 text-right">{t('clinical.lab.value')}</th><th className="py-1 pr-2">{t('lab.unit')}</th><th className="hidden py-1 pr-2 sm:table-cell">{t('lab.reference')}</th><th className="hidden py-1 sm:table-cell">{t('lab.flag')}</th></tr></thead>
              <tbody>{(d.lab_template ?? []).map((p: any, i: number) => {
                const v = values[p.code] ?? '';
                const f = flagOf(p, v);
                const out = f === 'high' || f === 'low';
                const bad = !!errors[`values.${i}`] || notNumber(p, v);
                const flag = f === 'high' ? <span className="inline-flex items-center gap-0.5 font-semibold text-red-700"><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />{t('lab.high')}</span> : f === 'low' ? <span className="inline-flex items-center gap-0.5 font-semibold text-red-700"><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />{t('lab.low')}</span> : f === 'normal' ? <span className="text-slate-600">{t('lab.normal')}</span> : null;
                return (
                  <tr key={p.code} className="border-t border-slate-100">
                    <td className="py-1.5 pr-2"><label htmlFor={`v-${p.code}`}>{p.name}</label>{/* phone: reference and flag under the name instead of two more columns */}<div className="text-xs text-slate-600 sm:hidden"><span className="whitespace-nowrap tabular-nums">{refText(p)}</span>{flag && <span className="ml-2 whitespace-nowrap">{flag}</span>}</div></td>
                    <td className="py-1.5 pr-2"><Input id={`v-${p.code}`} className={cx('h-9 text-right tabular-nums', out && !bad && '!border-red-600 !bg-red-50 font-semibold !text-red-800')} inputMode="decimal" value={v} invalid={bad}
                      onChange={(e) => setValues((x) => ({ ...x, [p.code]: e.target.value }))} /></td>
                    <td className="py-1.5 pr-2 text-slate-600">{p.unit}</td><td className="hidden whitespace-nowrap py-1.5 pr-2 tabular-nums text-slate-600 sm:table-cell">{refText(p)}</td>
                    <td className="hidden whitespace-nowrap py-1.5 text-[0.8125rem] sm:table-cell">{flag}</td>
                  </tr>
                );
              })}</tbody>
            </table>
            </div>
            {nonNumeric.length > 0 && <p className="mt-1 text-sm font-medium text-red-700" role="alert">{t('clinical.lab.needNumber', { names: nonNumeric.join(', ') })}</p>}
            {/* server field errors, except the ones the line above already explains */}
            {serverFieldErrors.length > 0 && <p className="mt-1 text-sm font-medium text-red-700" role="alert">{serverFieldErrors.join('; ')}</p>}
            <div className="mt-3"><label className="text-[0.8125rem] font-medium text-slate-700" htmlFor="lab-comment">{t('clinical.lab.comment')}</label><Textarea id="lab-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
            <p className="mt-2 text-xs text-slate-600">{t('clinical.lab.refNote')}</p>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {verifyBlocked && <p id="verify-why" className="mr-auto text-sm text-slate-600">{verifyBlocked}</p>}
              <Button className="max-sm:w-full" icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty || nonNumeric.length > 0} onClick={() => save.mutate()}>{t('clinical.lab.saveDraft')}</Button>
              <Button className="max-sm:w-full" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={verify.isPending} disabled={!!verifyBlocked} aria-describedby={verifyBlocked ? 'verify-why' : undefined} onClick={() => verify.mutate()}>{t('clinical.lab.verify')}</Button>
            </div>
          </div>
        )}
        {d.status === 'verified' && d.values && <div><div className="sm:hidden"><LabValues values={d.values} compact /></div><div className="hidden overflow-x-auto sm:block"><LabValues values={d.values} /></div>{d.comment && <p className="mt-2 text-sm"><span className="text-slate-600">{t('clinical.f.comment')}</span> {d.comment}</p>}<p className="mt-2 text-xs text-slate-600">{t('clinical.lab.verifiedLocked')}</p></div>}
      </div>
    </Card>
  );
}
