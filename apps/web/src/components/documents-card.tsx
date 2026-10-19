'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, FileText, Pill, Plus, Printer, Send, Trash2 } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, cx, Field, Input, Modal, Textarea, useToast } from '@/components/ui';
import { IcdPicker, type Icd } from '@/components/icd-picker';
import { useT } from '@/lib/i18n';

type Kind = 'referral' | 'certificate' | 'prescription';
type Doc = { id: string; kind: Kind; number: number; status: 'issued' | 'void'; issued_at: string; issued_by_name: string; void_reason: string | null };
type Note = { diagnosis: string; icd10: Icd[]; signed: boolean };
// suggestions in the doctor's language; the document keeps whatever text the doctor finally wrote
const SPECIALTIES: MessageKey[] = ['docs.sp.cardiologist', 'docs.sp.neurologist', 'docs.sp.endocrinologist', 'docs.sp.gastroenterologist', 'docs.sp.gynecologist', 'docs.sp.urologist', 'docs.sp.ent',
  'docs.sp.ophthalmologist', 'docs.sp.dermatologist', 'docs.sp.traumatologist', 'docs.sp.surgeon', 'docs.sp.pediatrician', 'docs.sp.psychiatrist', 'docs.sp.oncologist', 'docs.sp.ultrasound', 'docs.sp.xray', 'docs.sp.ctmri', 'docs.sp.inpatient'];
const PURPOSES: MessageKey[] = ['docs.purpose.work', 'docs.purpose.study', 'docs.purpose.any'];
const kindKey = (k: Kind) => `document.${k}` as MessageKey;
const ICON: Record<Kind, React.ReactNode> = { referral: <Send className="h-4 w-4" />, certificate: <FileText className="h-4 w-4" />, prescription: <Pill className="h-4 w-4" /> };

/** Documents issued from this visit: list, print, void; buttons to issue a referral, certificate or prescription. */
export function DocumentsCard({ encounterId, note }: { encounterId: string; note: Note }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const [kind, setKind] = useState<Kind | null>(null);
  const [voiding, setVoiding] = useState<Doc | null>(null);
  const [reason, setReason] = useState('');
  const docs = useQuery({ queryKey: ['documents', encounterId], queryFn: () => api<{ data: Doc[] }>(`/encounters/${encounterId}/documents`).then((r) => r.data) });
  const voidDoc = useMutation({
    mutationFn: () => api(`/documents/${voiding!.id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => { toast.success(t('docs.voided')); setVoiding(null); setReason(''); qc.invalidateQueries({ queryKey: ['documents', encounterId] }); },
    onError: (e) => toast.error(e),
  });

  return (
    <Card title={t('docs.title')} actions={
      <div className="flex flex-wrap gap-1.5">
        {(['referral', 'certificate', 'prescription'] as Kind[]).map((k) => (
          <Button key={k} size="sm" icon={ICON[k]} onClick={() => setKind(k)}>{t(k === 'prescription' ? 'document.prescriptionShort' : k === 'certificate' ? 'document.certificateShort' : 'document.referral')}</Button>
        ))}
      </div>}>
      {!docs.data?.length ? <p className="text-sm text-slate-600">{t('docs.none')}</p> : (
        <ul className="divide-y divide-slate-100">
          {docs.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className={cx('flex items-center gap-1.5 font-semibold', d.status === 'void' && 'text-slate-500 line-through')}>{ICON[d.kind]}{t('docs.numbered', { kind: t(kindKey(d.kind)), n: d.number })}</span>
              <span className="text-[0.8125rem] text-slate-600">{fmtDateTime(d.issued_at)}</span>
              {d.status === 'void' ? <Badge>{d.void_reason ? t('docs.voidWithReason', { reason: d.void_reason }) : t('docs.void')}</Badge> : <Badge tone="green">{t('docs.issued')}</Badge>}
              <span className="ml-auto flex gap-1.5">
                <a href={`/print/document/${d.id}`} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:border-slate-500"><Printer className="h-4 w-4" />{t('common.print')}</a>
                {d.status === 'issued' && <Button size="sm" variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => { setVoiding(d); setReason(''); }}>{t('docs.voidAction')}</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {kind && <DocumentModal kind={kind} encounterId={encounterId} note={note} onClose={() => setKind(null)} />}
      <Modal open={!!voiding} onClose={() => setVoiding(null)} title={voiding ? t('docs.voidTitle', { kind: t(kindKey(voiding.kind)), n: voiding.number }) : ''}
        footer={<><Button onClick={() => setVoiding(null)}>{t('common.back')}</Button><Button variant="danger" loading={voidDoc.isPending} disabled={reason.trim().length < 3} onClick={() => voidDoc.mutate()}>{t('docs.voidAction')}</Button></>}>
        <p className="mb-2 text-sm text-slate-700">{t('docs.voidText')}</p>
        <Field label={t('docs.reason')} required>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('docs.reasonPlaceholder')} />}</Field>
      </Modal>
    </Card>
  );
}

type Item = { name: string; form: string; dose: string; frequency: string; duration: string; instructions: string };
const emptyItem = (): Item => ({ name: '', form: '', dose: '', frequency: '', duration: '', instructions: '' });
const COL: Record<keyof Item, MessageKey> = { name: 'docs.drug', form: 'docs.form', dose: 'docs.dose', frequency: 'docs.frequency', duration: 'docs.duration', instructions: 'docs.instructions' };

function DocumentModal({ kind, encounterId, note, onClose }: { kind: Kind; encounterId: string; note: Note; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const [ref, setRef] = useState({ to_specialty: '', to_institution: '', reason: note.diagnosis, urgency: 'routine' as 'routine' | 'urgent', icd10: note.icd10, notes: '' });
  const [cert, setCert] = useState({ purpose: t(PURPOSES[0]), include_diagnosis: false, rest_days: '0', notes: '' });
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [rxNotes, setRxNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => { setErrors({}); setFormError(null); }, [kind]);

  const body = () => kind === 'referral'
    ? { ...ref, to_institution: ref.to_institution || null, notes: ref.notes || null, icd10: ref.icd10.map((x) => x.code) }
    : kind === 'certificate'
      ? { purpose: cert.purpose, include_diagnosis: cert.include_diagnosis, rest_days: Number(cert.rest_days) || 0, notes: cert.notes || null }
      : { items: items.filter((i) => Object.values(i).some((v) => v.trim())).map((i) => ({ ...i, form: i.form || null, instructions: i.instructions || null })), notes: rxNotes || null };

  const issue = useMutation({
    mutationFn: () => api<{ data: { id: string; number: number } }>(`/encounters/${encounterId}/documents`, { method: 'POST', body: { kind, body: body() } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['documents', encounterId] });
      toast.success(t('docs.issuedToast', { kind: t(kindKey(kind)), n: r.data.number }));
      onClose();
    },
    onError: (e) => {
      // field errors are shown next to the fields; the general message only when there is nothing more specific
      if (e instanceof ApiError && e.fields) { setErrors(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k.replace(/^body\./, ''), v]))); setFormError(null); }
      else setFormError(e instanceof Error ? e.message : t('password.notSaved'));
    },
  });
  const setItem = (i: number, k: keyof Item, v: string) => {
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
    setErrors((e) => { const { items: _, [`items.${i}.${k}`]: __, ...rest } = e; return rest; });
  };

  return (
    <Modal open onClose={onClose} width={kind === 'prescription' ? 'max-w-5xl' : 'max-w-2xl'} title={t('docs.issueTitle', { kind: t(kindKey(kind)) })}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={issue.isPending} onClick={() => { setFormError(null); issue.mutate(); }}>{t('docs.issue')}</Button></>}>
      <div className="space-y-3">
        {formError && <Alert tone="red">{formError}</Alert>}
        {kind === 'referral' && <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('docs.to')} required error={errors.to_specialty}>
              {(id) => <><Input id={id} list="ref-specialties" value={ref.to_specialty} onChange={(e) => setRef({ ...ref, to_specialty: e.target.value })} invalid={!!errors.to_specialty} placeholder={t('docs.toPlaceholder')} />
                <datalist id="ref-specialties">{SPECIALTIES.map((s) => <option key={s} value={t(s)} />)}</datalist></>}
            </Field>
            <Field label={t('docs.institution')} error={errors.to_institution}>{(id) => <Input id={id} value={ref.to_institution} onChange={(e) => setRef({ ...ref, to_institution: e.target.value })} placeholder={t('docs.institutionPlaceholder')} />}</Field>
          </div>
          <Field label={t('docs.refReason')} required error={errors.reason} hint={t('docs.refReasonHint')}>
            {(id) => <Textarea id={id} rows={3} value={ref.reason} onChange={(e) => setRef({ ...ref, reason: e.target.value })} invalid={!!errors.reason} />}
          </Field>
          <IcdPicker value={ref.icd10} diagnosis={ref.reason} encounterId={encounterId} onChange={(icd10) => setRef({ ...ref, icd10 })} />
          {errors.icd10 && <p className="text-sm font-medium text-red-700">{errors.icd10}</p>}
          <fieldset className="flex gap-5 text-[0.9375rem]"><legend className="sr-only">{t('docs.urgency')}</legend>
            {(['routine', 'urgent'] as const).map((u) => (
              <label key={u} className="flex min-h-10 items-center gap-2"><input type="radio" name="urgency" className="h-4 w-4 accent-brand-600" checked={ref.urgency === u} onChange={() => setRef({ ...ref, urgency: u })} />{t(u === 'routine' ? 'docs.routine' : 'docs.urgent')}</label>
            ))}
          </fieldset>
          <Field label={t('docs.notes')}>{(id) => <Textarea id={id} rows={2} value={ref.notes} onChange={(e) => setRef({ ...ref, notes: e.target.value })} />}</Field>
        </>}

        {kind === 'certificate' && <>
          <Field label={t('docs.purpose')} required error={errors.purpose}>
            {(id) => <><Input id={id} list="cert-purposes" value={cert.purpose} onChange={(e) => setCert({ ...cert, purpose: e.target.value })} invalid={!!errors.purpose} />
              <datalist id="cert-purposes">{PURPOSES.map((s) => <option key={s} value={t(s)} />)}</datalist></>}
          </Field>
          <label className={cx('flex items-start gap-2.5 text-[0.9375rem]', !note.signed && 'text-slate-500')}>
            <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={cert.include_diagnosis} disabled={!note.signed} onChange={(e) => setCert({ ...cert, include_diagnosis: e.target.checked })} />
            <span>{t('docs.includeDiagnosis')}<span className="block text-[0.8125rem] text-slate-600">{note.signed ? t('docs.diagnosisPrivate') : t('docs.diagnosisNeedsSign')}</span></span>
          </label>
          <Field label={t('docs.restDays')} error={errors.rest_days} hint={t('docs.restDaysHint')}>
            {(id) => <Input id={id} type="number" min={0} max={30} className="w-28" value={cert.rest_days} onChange={(e) => setCert({ ...cert, rest_days: e.target.value })} invalid={!!errors.rest_days} />}
          </Field>
          <Field label={t('docs.notes')}>{(id) => <Textarea id={id} rows={2} value={cert.notes} onChange={(e) => setCert({ ...cert, notes: e.target.value })} />}</Field>
        </>}

        {kind === 'prescription' && <>
          {errors.items && <Alert tone="red">{errors.items}</Alert>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] table-fixed text-sm">
              <colgroup><col className="w-[19%]" /><col className="w-[11%]" /><col className="w-[10%]" /><col className="w-[22%]" /><col className="w-[11%]" /><col className="w-[23%]" /><col className="w-10" /></colgroup>
              <thead><tr className="text-left text-[0.8125rem] font-semibold text-slate-600"><th className="pb-1">{t('docs.drug')}</th><th className="pb-1">{t('docs.form')}</th><th className="pb-1">{t('docs.dose')}</th><th className="pb-1">{t('docs.frequency')}</th><th className="pb-1">{t('docs.duration')}</th><th className="pb-1">{t('docs.instructions')}</th><th /></tr></thead>
              <tbody>{items.map((it, i) => (
                <tr key={i} className="align-top">
                  {(['name', 'form', 'dose', 'frequency', 'duration', 'instructions'] as (keyof Item)[]).map((k) => (
                    <td key={k} className="py-1 pr-1"><Input aria-label={t('docs.rowLabel', { i: i + 1, field: t(COL[k]) })} className="h-10 text-sm" value={it[k]} onChange={(e) => setItem(i, k, e.target.value)}
                      invalid={!!errors[`items.${i}.${k}`]} placeholder={t(`docs.ph.${k}` as MessageKey)} /></td>
                  ))}
                  <td className="py-1"><Button size="sm" variant="ghost" aria-label={t('docs.removeRow')} disabled={items.length === 1} icon={<Trash2 className="h-4 w-4" />} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={items.length >= 15} onClick={() => setItems((xs) => [...xs, emptyItem()])}>{t('docs.addDrug')}</Button>
          <Field label={t('docs.rxNotes')}>{(id) => <Textarea id={id} rows={2} value={rxNotes} onChange={(e) => setRxNotes(e.target.value)} />}</Field>
          <p className="text-[0.8125rem] text-slate-600">{t('docs.rxDisclaimer')}</p>
        </>}
      </div>
    </Modal>
  );
}
