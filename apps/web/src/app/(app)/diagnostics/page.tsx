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
import { Alert, Button, Card, cx, EmptyState, ErrorState, Field, LoadingRows, Modal, PageHeader, Textarea, useToast } from '@/components/ui';
import { NoteStatus } from '@/components/status';

export default function DiagnosticsPage() { return <Suspense><Diagnostics /></Suspense>; }

function Diagnostics() {
  const { me } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const sel = sp.get('order');
  const q = useQuery({ queryKey: ['diagnostics'], queryFn: () => api('/diagnostics').then((r) => r.data as any[]) });
  const isUzi = me.doctor_specialty === 'UZI mutaxassisi';
  return (
    <>
      <PageHeader title="Diagnostika (UZI)" subtitle={isUzi ? 'Buyurtmalar va xulosalar · qoralama → tasdiqlash' : 'Bemorlaringizning UZI xulosalari (faqat ko‘rish)'} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card padded={false}>
          {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.length ? <EmptyState icon={<ScanLine className="h-8 w-8" />} title="UZI buyurtmalari yo‘q" /> : (
            <ul className="divide-y divide-slate-100">{q.data!.map((o) => (
              <li key={o.id}><button onClick={() => router.replace(`/diagnostics?order=${o.id}`)} className={cx('flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50', sel === o.id && 'bg-brand-50 hover:bg-brand-50')}>
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{o.service_name}</div><div className="truncate text-xs text-slate-500">{fullName(o)} {pid(o.patient_number)} · {fmtDateTime(o.ordered_at)}</div></div>
                <NoteStatus status={o.report_status} />
              </button></li>
            ))}</ul>
          )}
        </Card>
        {sel ? <Report id={sel} /> : <Card><EmptyState title="Buyurtmani tanlang" /></Card>}
      </div>
      <p className="mt-3 text-xs text-slate-500">DICOM/PACS, tasvir yuklash va apparatdan import keyingi relizlarda; bu yerda rasm yuklash tugmasi yo‘q.</p>
    </>
  );
}

function Report({ id }: { id: string }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['diagnostics', id], queryFn: () => api(`/diagnostics/${id}`).then((r) => r.data) });
  const [desc, setDesc] = useState(''); const [concl, setConcl] = useState(''); const [base, setBase] = useState('');
  const [err, setErr] = useState<Record<string, string>>({}); const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (q.data) { setDesc(q.data.description ?? ''); setConcl(q.data.conclusion ?? ''); setBase(JSON.stringify([q.data.description ?? '', q.data.conclusion ?? ''])); setErr({}); } }, [q.data]);
  const dirty = JSON.stringify([desc, concl]) !== base;
  useUnsavedGuard(dirty && !!q.data?.can_edit);
  const after = () => ['diagnostics', 'encounter', 'doctor-history'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const save = useMutation({ mutationFn: () => api(`/diagnostics/${id}`, { method: 'PUT', body: { description: desc, conclusion: concl } }), onSuccess: () => { after(); toast.success('Qoralama saqlandi'); }, onError: (e) => toast.error(e) });
  const sign = useMutation({ mutationFn: () => api(`/diagnostics/${id}/sign`, { method: 'POST', body: { description: desc, conclusion: concl } }), onSuccess: () => { setConfirm(false); after(); toast.success('UZI xulosasi tasdiqlandi'); }, onError: (e) => { setConfirm(false); if (e instanceof ApiError && e.fields) setErr(e.fields); toast.error(e); } });
  if (q.isLoading) return <Card><LoadingRows /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const d = q.data;
  const signed = d.report_status === 'signed';
  return (
    <Card title={<span className="flex items-center gap-2">{d.service_name}<NoteStatus status={d.report_status} /></span>}
      actions={(signed || d.report_id) && <Link href={`/print/uzi/${d.id}`} target="_blank" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><Printer className="h-4 w-4" />Chop etish</Link>}>
      <div className="mb-3 grid grid-cols-2 gap-1 text-sm">
        <div><span className="text-slate-500">Bemor:</span> <b>{fullName(d)}</b> {pid(d.patient_number)}</div><div><span className="text-slate-500">Yosh:</span> {fmtDate(d.birth_date)} · {ageFrom(d.birth_date, me.today)}</div>
        <div><span className="text-slate-500">Buyurtmachi:</span> {d.ordered_by ?? '—'}</div><div><span className="text-slate-500">Mutaxassis:</span> {d.performer_name ?? '—'}</div>
        <div><span className="text-slate-500">Shablon:</span> {d.template_version ?? 'uzi-v1'}</div>{signed && <div><span className="text-slate-500">Tasdiqlandi:</span> {fmtDateTime(d.signed_at)}</div>}
      </div>
      {!d.can_edit && !signed && <Alert tone="blue">Xulosa hali tasdiqlanmagan. Uni UZI mutaxassisi yozadi.</Alert>}
      {(d.can_edit || signed) && (
        <div className="space-y-3">
          <Field label="Tekshiruv tavsifi" required error={err.description}>{(id) => <Textarea id={id} rows={6} value={desc} onChange={(e) => setDesc(e.target.value)} disabled={!d.can_edit} />}</Field>
          <Field label="Xulosa" required error={err.conclusion}>{(id) => <Textarea id={id} rows={3} value={concl} onChange={(e) => setConcl(e.target.value)} disabled={!d.can_edit} />}</Field>
          {d.can_edit && <div className="flex justify-end gap-2">
            <Button icon={<Save className="h-4 w-4" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Qoralamani saqlash</Button>
            <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} disabled={!desc.trim() || !concl.trim()} onClick={() => setConfirm(true)}>Tasdiqlash</Button>
          </div>}
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="UZI xulosasini tasdiqlash" footer={<><Button onClick={() => setConfirm(false)}>Ortga</Button><Button variant="success" loading={sign.isPending} onClick={() => sign.mutate()}>Tasdiqlash</Button></>}>
        <p className="text-sm">Tasdiqlangan xulosa o‘zgartirilmaydi va davolovchi shifokor kartasida ko‘rinadi.</p>
      </Modal>
    </Card>
  );
}
