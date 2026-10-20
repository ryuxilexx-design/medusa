'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Printer, Save, ScanLine } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ageFrom, fmtDate, fmtDateTime, fullName, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useUnsavedGuard } from '@/lib/unsaved';
import { useT } from '@/lib/i18n';
import { Alert, Button, Card, cx, EmptyState, ErrorState, Field, LoadingRows, Modal, PageHeader, Textarea, useToast } from '@/components/ui';
import { NoteStatus } from '@/components/status';

export default function DiagnosticsPage() { return <Suspense><Diagnostics /></Suspense>; }

function Diagnostics() {
  const { me } = useSession();
  const t = useT();
  const sp = useSearchParams();
  const router = useRouter();
  const sel = sp.get('order');
  const q = useQuery({ queryKey: ['diagnostics'], queryFn: () => api('/diagnostics').then((r) => r.data as any[]) });
  const isUzi = me.doctor_specialty === 'UZI mutaxassisi';
  const pick = (id: string) => {
    router.replace(`/diagnostics?order=${id}`, { scroll: false });
    // below xl the report sits under the list: bring it into view so the tap visibly does something
    if (!window.matchMedia('(min-width: 1280px)').matches) setTimeout(() => document.getElementById('report-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  return (
    <>
      <PageHeader title={t('clinical.uzi.title')} subtitle={isUzi ? t('clinical.uzi.subtitleUzi') : t('clinical.uzi.subtitleOther')} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card padded={false} className="self-start">
          {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.length ? <EmptyState icon={<ScanLine className="h-8 w-8" />} title={t('clinical.uzi.noOrders')} /> : (
            <ul className="divide-y divide-slate-100">{q.data!.map((o) => (
              <li key={o.id}><button onClick={() => pick(o.id)} aria-current={sel === o.id || undefined} className={cx('flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-slate-50', sel === o.id && 'bg-brand-50 hover:bg-brand-50')}>
                <div className="min-w-[12rem] flex-1 basis-0"><div className="truncate text-sm font-semibold text-slate-900">{o.service_name}</div><div className="truncate text-xs text-slate-600">{fullName(o)} {pid(o.patient_number)}, {fmtDateTime(o.ordered_at)}</div></div>
                <NoteStatus status={o.report_status} />
              </button></li>
            ))}</ul>
          )}
        </Card>
        <div id="report-detail" className="min-w-0 scroll-mt-24 self-start xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:rounded-xl">
          {sel ? <Report id={sel} /> : <Card><EmptyState title={t('clinical.pickOrder')} text={t('clinical.uzi.pickOrderText')} /></Card>}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-600">{t('clinical.uzi.pacsNote', { systems: 'DICOM/PACS' })}</p>
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
    <Card title={<span className="flex items-center gap-2">{d.service_name}<NoteStatus status={d.report_status} /></span>}
      actions={(signed || d.report_id) && <Link href={`/print/uzi/${d.id}`} target="_blank" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><Printer className="h-4 w-4" />{t('common.print')}</Link>}>
      <div className="mb-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><span className="text-slate-600">{t('clinical.f.patient')}</span> <b>{fullName(d)}</b> <span className="whitespace-nowrap">{pid(d.patient_number)}</span></div><div><span className="text-slate-600">{t('clinical.f.age')}</span> {fmtDate(d.birth_date)}, {ageFrom(d.birth_date, me.today)}</div>
        <div><span className="text-slate-600">{t('clinical.f.orderedBy')}</span> {d.ordered_by ?? '—'}</div><div><span className="text-slate-600">{t('clinical.f.specialist')}</span> {d.performer_name ?? '—'}</div>
        {signed && <div><span className="text-slate-600">{t('clinical.f.signed')}</span> {fmtDateTime(d.signed_at)}</div>}
      </div>
      {!d.can_edit && !signed && <Alert tone="blue">{t('clinical.uzi.notSigned')}</Alert>}
      {signed && !d.can_edit && (
        <div className="space-y-3">
          <section><h3 className="text-sm font-semibold text-slate-800">{t('clinical.uzi.description')}</h3><p className="mt-1 whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-slate-900">{d.description || '—'}</p></section>
          <section><h3 className="text-sm font-semibold text-slate-800">{t('clinical.uzi.conclusion')}</h3><p className="mt-1 whitespace-pre-wrap text-[0.9375rem] font-medium leading-relaxed text-slate-900">{d.conclusion || '—'}</p></section>
          <p className="text-sm text-slate-600">{t('clinical.uzi.signedLocked')}</p>
        </div>
      )}
      {d.can_edit && (
        <div className="space-y-3">
          <Field label={t('clinical.uzi.description')} required error={err.description}>{(id) => <Textarea id={id} rows={6} value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field>
          <Field label={t('clinical.uzi.conclusion')} required error={err.conclusion}>{(id) => <Textarea id={id} rows={3} value={concl} onChange={(e) => setConcl(e.target.value)} />}</Field>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {incomplete && <p id="sign-why" className="mr-auto text-sm text-slate-600">{t('clinical.uzi.fillBoth')}</p>}
            <Button className="max-sm:w-full" icon={<Save className="h-4 w-4" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('clinical.uzi.saveDraft')}</Button>
            <Button className="max-sm:w-full" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} disabled={incomplete} aria-describedby={incomplete ? 'sign-why' : undefined} onClick={() => setConfirm(true)}>{t('clinical.uzi.sign')}</Button>
          </div>
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('clinical.uzi.confirmTitle')} footer={<><Button onClick={() => setConfirm(false)}>{t('common.back')}</Button><Button variant="success" loading={sign.isPending} onClick={() => sign.mutate()}>{t('clinical.uzi.sign')}</Button></>}>
        <p className="text-sm">{t('clinical.uzi.confirmText')}</p>
      </Modal>
    </Card>
  );
}
