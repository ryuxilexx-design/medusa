'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Printer, Save, ScanLine } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ageFrom, fmtDate, fmtDateTime, fullName, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useUnsavedGuard } from '@/lib/unsaved';
import { useT } from '@/lib/i18n';
import { Alert, Button, Card, cx, EmptyState, ErrorState, Field, LinkButton, LoadingRows, Modal, PageHeader, Tabs, Textarea, useToast } from '@/components/ui';
import { NoteStatus } from '@/components/status';

export default function DiagnosticsPage() { return <Suspense><Diagnostics /></Suspense>; }

type Tab = 'todo' | 'signed';

function Diagnostics() {
  const { me } = useSession();
  const t = useT();
  const sp = useSearchParams();
  const router = useRouter();
  const sel = sp.get('order');
  const q = useQuery({ queryKey: ['diagnostics'], queryFn: () => api('/diagnostics').then((r) => r.data as any[]) });
  const isUzi = me.doctor_specialty === 'UZI mutaxassisi';
  const [tab, setTab] = useState<Tab | null>(null);
  const rows = q.data ?? [];
  const todo = rows.filter((o) => o.report_status !== 'signed');
  // the work still to do comes first; when there is none, the signed reports
  const current: Tab = tab ?? (todo.length ? 'todo' : 'signed');
  const shown = current === 'todo' ? todo : rows.filter((o) => o.report_status === 'signed');
  // a wide screen never shows an empty report beside the list: the first one opens by itself
  const first = shown[0]?.id as string | undefined;
  useEffect(() => {
    if (!sel && first && window.matchMedia('(min-width: 1280px)').matches) router.replace(`/diagnostics?order=${first}`, { scroll: false });
  }, [sel, first, router]);
  const pick = (id: string) => {
    router.replace(`/diagnostics?order=${id}`, { scroll: false });
    // below xl the report sits under the list: bring it into view so the tap visibly does something
    if (!window.matchMedia('(min-width: 1280px)').matches) setTimeout(() => document.getElementById('report-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  return (
    <>
      <PageHeader title={t('clinical.uzi.title')} subtitle={isUzi ? undefined : t('clinical.uzi.subtitleOther')} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <Card padded={false} className="self-start">
          {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !rows.length ? <EmptyState icon={<ScanLine />} title={t('clinical.uzi.noOrders')} /> : <>
            <div className="px-1 pt-1 sm:px-3"><Tabs<Tab> value={current} onChange={setTab} items={[
              { value: 'todo', label: t('clinical.uzi.tabTodo'), count: todo.length },
              { value: 'signed', label: t('clinical.uzi.tabSigned'), count: rows.length - todo.length },
            ]} /></div>
            {!shown.length ? <EmptyState compact title={t('clinical.uzi.tabEmpty')} /> : (
              <ul className="divide-y divide-slate-100">{shown.map((o) => (
                <li key={o.id}><button onClick={() => pick(o.id)} aria-current={sel === o.id || undefined}
                  className={cx('flex w-full items-start gap-3 px-4 py-3 text-left sm:px-5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300', sel === o.id && 'bg-brand-50 shadow-[inset_4px_0_0_#2d64bd] hover:bg-brand-50')}>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[0.9375rem] font-semibold leading-snug text-slate-900">{o.service_name}</span>
                    <span className="mt-0.5 block text-[0.8125rem] leading-snug text-slate-600"><span className="font-medium text-slate-800">{fullName(o)}</span> <span className="whitespace-nowrap tabular-nums">{pid(o.patient_number)}</span></span>
                    <span className="block text-[0.8125rem] tabular-nums text-slate-600">{fmtDateTime(o.ordered_at)}</span>
                  </span>
                  <span className="shrink-0"><NoteStatus status={o.report_status} /></span>
                </button></li>
              ))}</ul>
            )}
          </>}
        </Card>
        <div id="report-detail" className="min-w-0 scroll-mt-24 self-start xl:sticky xl:top-24 xl:max-h-[calc(100vh-10rem)] xl:overflow-y-auto xl:rounded-xl">
          {sel ? <Report id={sel} /> : <Card><EmptyState compact icon={<ScanLine />} title={t('clinical.pickOrder')} text={t('clinical.uzi.pickOrderText')} /></Card>}
        </div>
      </div>
    </>
  );
}

function Report({ id }: { id: string }) {
  const { me } = useSession();
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['diagnostics', id], queryFn: () => api(`/diagnostics/${id}`).then((r) => r.data) });
  const [desc, setDesc] = useState(''); const [concl, setConcl] = useState(''); const [base, setBase] = useState('');
  const [err, setErr] = useState<Record<string, string>>({}); const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (q.data) { setDesc(q.data.description ?? ''); setConcl(q.data.conclusion ?? ''); setBase(JSON.stringify([q.data.description ?? '', q.data.conclusion ?? ''])); setErr({}); } }, [q.data]);
  const dirty = JSON.stringify([desc, concl]) !== base;
  useUnsavedGuard(dirty && !!q.data?.can_edit);
  const after = () => ['diagnostics', 'encounter', 'doctor-history'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const save = useMutation({ mutationFn: () => api(`/diagnostics/${id}`, { method: 'PUT', body: { description: desc, conclusion: concl } }), onSuccess: () => { after(); toast.success(t('clinical.uzi.draftSaved')); }, onError: (e) => toast.error(e) });
  const sign = useMutation({ mutationFn: () => api(`/diagnostics/${id}/sign`, { method: 'POST', body: { description: desc, conclusion: concl } }), onSuccess: () => { setConfirm(false); after(); toast.success(t('clinical.uzi.signedToast')); }, onError: (e) => { setConfirm(false); if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); } });
  if (q.isLoading) return <Card><LoadingRows /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const d = q.data;
  const signed = d.report_status === 'signed';
  const incomplete = !desc.trim() || !concl.trim();
  return (
    <Card padded={false} title={<span className="flex flex-wrap items-center gap-2">{d.service_name}<NoteStatus status={d.report_status} /></span>}
      actions={(signed || d.report_id) && <LinkButton size="sm" variant="ghost" target="_blank" href={`/print/uzi/${d.id}`} icon={<Printer className="h-4 w-4" />}>{t('common.print')}</LinkButton>}>
      <div className="space-y-4 p-5">
        <div>
          <p className="text-base font-bold text-slate-900">{fullName(d)} <span className="font-normal text-slate-600">{pid(d.patient_number)}</span></p>
          <p className="text-[0.9375rem] text-slate-600">{ageFrom(d.birth_date, me.today)} · {fmtDate(d.birth_date)}</p>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
            <div><dt className="inline text-slate-600">{t('clinical.f.orderedBy')}</dt> <dd className="inline text-slate-900">{d.ordered_by ?? '—'}</dd></div>
            <div><dt className="inline text-slate-600">{t('clinical.f.specialist')}</dt> <dd className="inline text-slate-900">{d.performer_name ?? '—'}</dd></div>
            {signed && <div><dt className="inline text-slate-600">{t('clinical.f.signed')}</dt> <dd className="inline text-slate-900">{fmtDateTime(d.signed_at)}</dd></div>}
          </dl>
        </div>
        {!d.can_edit && !signed && <Alert tone="blue">{t('clinical.uzi.notSigned')}</Alert>}
        {signed && !d.can_edit && <>
          <section><h3 className="text-sm font-semibold text-slate-800">{t('clinical.uzi.description')}</h3><p className="mt-1 whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-slate-900">{d.description || '—'}</p></section>
          <section><h3 className="text-sm font-semibold text-slate-800">{t('clinical.uzi.conclusion')}</h3><p className="mt-1 whitespace-pre-wrap text-[0.9375rem] font-medium leading-relaxed text-slate-900">{d.conclusion || '—'}</p></section>
        </>}
        {d.can_edit && <>
          <Field label={t('clinical.uzi.description')} required error={err.description}>{(id) => <Textarea id={id} rows={6} value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field>
          <Field label={t('clinical.uzi.conclusion')} required error={err.conclusion}>{(id) => <Textarea id={id} rows={3} value={concl} onChange={(e) => setConcl(e.target.value)} />}</Field>
        </>}
      </div>
      {/* the two decisions stay visible at the bottom of the report, even when the text is long */}
      {d.can_edit && (
        <div className="sticky bottom-[var(--tabbar)] flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-[inherit] border-t border-slate-200 bg-white px-5 py-3 lg:bottom-0">
          <span id="sign-why" className="w-full text-[0.8125rem] text-slate-600 sm:w-auto sm:flex-1">{incomplete ? t('clinical.uzi.fillBoth') : ''}</span>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button className="max-sm:!whitespace-normal max-sm:!px-3 max-sm:text-sm max-sm:leading-tight" icon={<Save className="hidden h-5 w-5 sm:block" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('clinical.uzi.saveDraft')}</Button>
            <Button variant="primary" className="max-sm:!whitespace-normal max-sm:!px-3 max-sm:text-sm max-sm:leading-tight" icon={<CheckCircle2 className="hidden h-5 w-5 sm:block" />} disabled={incomplete} aria-describedby={incomplete ? 'sign-why' : undefined} onClick={() => setConfirm(true)}>{t('clinical.uzi.sign')}</Button>
          </div>
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('clinical.uzi.confirmTitle')} footer={<><Button onClick={() => setConfirm(false)}>{t('common.back')}</Button><Button variant="primary" loading={sign.isPending} onClick={() => sign.mutate()}>{t('clinical.uzi.sign')}</Button></>}>
        <p className="text-base text-slate-800">{t('clinical.uzi.confirmText')}</p>
      </Modal>
    </Card>
  );
}
