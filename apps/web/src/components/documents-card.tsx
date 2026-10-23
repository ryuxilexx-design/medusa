'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, FileText, Pill, Plus, Printer, Send, ShieldAlert, Trash2 } from 'lucide-react';
import type { MessageKey } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, cx, ErrorState, Field, Input, LinkButton, LoadingRows, Modal, ModalCancel, Textarea, useToast } from '@/components/ui';
import { IcdPicker, type Icd } from '@/components/icd-picker';
import { DrugCombobox, drugName } from '@/components/drug-picker';
import { useClassName } from '@/components/allergies';
import { useDebounced } from '@/lib/hooks';
import { useI18n, useT } from '@/lib/i18n';

type Kind = 'referral' | 'certificate' | 'prescription';
type Doc = { id: string; kind: Kind; number: number; status: 'issued' | 'void'; issued_at: string; issued_by_name: string; void_reason: string | null };
type Note = { diagnosis: string; icd10: Icd[]; signed: boolean };
/** What is known about the patient's allergies: the card (doctor-confirmed) and the intake answer (the patient's own words). */
type Allergy = { state: string | null; note: string | null; intake: string | null };
// suggestions in the doctor's language; the document keeps whatever text the doctor finally wrote
const SPECIALTIES: MessageKey[] = ['docs.sp.cardiologist', 'docs.sp.neurologist', 'docs.sp.endocrinologist', 'docs.sp.gastroenterologist', 'docs.sp.gynecologist', 'docs.sp.urologist', 'docs.sp.ent',
  'docs.sp.ophthalmologist', 'docs.sp.dermatologist', 'docs.sp.traumatologist', 'docs.sp.surgeon', 'docs.sp.pediatrician', 'docs.sp.psychiatrist', 'docs.sp.oncologist', 'docs.sp.ultrasound', 'docs.sp.xray', 'docs.sp.ctmri', 'docs.sp.inpatient'];
const PURPOSES: MessageKey[] = ['docs.purpose.work', 'docs.purpose.study', 'docs.purpose.any'];
const kindKey = (k: Kind) => `document.${k}` as MessageKey;
const ICON: Record<Kind, React.ReactNode> = { referral: <Send className="h-4 w-4" />, certificate: <FileText className="h-4 w-4" />, prescription: <Pill className="h-4 w-4" /> };

/** Documents issued from this visit: list, print, void; buttons to issue a referral, certificate or prescription. */
export function DocumentsCard({ encounterId, note, allergy }: { encounterId: string; note: Note; allergy?: Allergy }) {
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
      {/* a failed load is never shown as «no documents» (the doctor could issue a duplicate) */}
      {docs.isLoading ? <LoadingRows rows={2} /> : docs.isError ? <ErrorState error={docs.error} onRetry={() => docs.refetch()} /> : !docs.data?.length ? <p className="text-sm text-slate-600">{t('docs.none')}</p> : (
        <ul className="divide-y divide-slate-100">
          {docs.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className={cx('flex items-center gap-1.5 font-semibold', d.status === 'void' && 'text-slate-500 line-through')}>{ICON[d.kind]}{t('docs.numbered', { kind: t(kindKey(d.kind)), n: d.number })}</span>
              <span className="text-[0.8125rem] text-slate-600">{fmtDateTime(d.issued_at)}</span>
              {d.status === 'void' ? <Badge>{d.void_reason ? t('docs.voidWithReason', { reason: d.void_reason }) : t('docs.void')}</Badge> : <Badge tone="green">{t('docs.issued')}</Badge>}
              <span className="ml-auto flex gap-1.5">
                <LinkButton size="sm" target="_blank" href={`/print/document/${d.id}`} icon={<Printer className="h-4 w-4" />}>{t('common.print')}</LinkButton>
                {d.status === 'issued' && <Button size="sm" variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => { setVoiding(d); setReason(''); }}>{t('docs.voidAction')}</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {kind && <DocumentModal key={kind} kind={kind} encounterId={encounterId} note={note} allergy={allergy} onClose={() => setKind(null)} />}
      <Modal open={!!voiding} onClose={() => { setVoiding(null); setReason(''); }} dirty={!!reason.trim() && !voidDoc.isPending} title={voiding ? t('docs.voidTitle', { kind: t(kindKey(voiding.kind)), n: voiding.number }) : ''}
        footer={<><ModalCancel>{t('common.back')}</ModalCancel><Button variant="danger" loading={voidDoc.isPending} disabled={reason.trim().length < 3} onClick={() => voidDoc.mutate()}>{t('docs.voidAction')}</Button></>}>
        <p className="mb-2 text-sm text-slate-700">{t('docs.voidText')}</p>
        <Field label={t('docs.reason')} required>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('docs.reasonPlaceholder')} />}</Field>
      </Modal>
    </Card>
  );
}

type Item = { name: string; form: string; dose: string; frequency: string; duration: string; instructions: string };
type Row = Item & { drug_id: string | null; rx: boolean };
const emptyItem = (): Row => ({ name: '', form: '', dose: '', frequency: '', duration: '', instructions: '', drug_id: null, rx: false });
const TEXT_KEYS: (keyof Item)[] = ['name', 'form', 'dose', 'frequency', 'duration', 'instructions'];
const COL: Record<keyof Item, MessageKey> = { name: 'docs.drug', form: 'docs.form', dose: 'docs.dose', frequency: 'docs.frequency', duration: 'docs.duration', instructions: 'docs.instructions' };
/** One allergy hit from the server check (apps/api/src/modules/allergy-check.ts). */
export type RxWarning = { item: number; drug: string; match: 'drug' | 'class' | 'cross'; class_code: string | null; class_name_uz: string | null; class_name_ru: string | null;
  allergen: string; allergen_ru: string; allergen_is_class: boolean; reaction: string | null; severity: string; blocking: boolean };

function DocumentModal({ kind, encounterId, note, allergy, onClose }: { kind: Kind; encounterId: string; note: Note; allergy?: Allergy; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t, locale } = useI18n();
  const className = useClassName();
  const [ref, setRef] = useState({ to_specialty: '', to_institution: '', reason: note.diagnosis, urgency: 'routine' as 'routine' | 'urgent', icd10: note.icd10, notes: '' });
  const [cert, setCert] = useState({ purpose: t(PURPOSES[0]), include_diagnosis: false, rest_days: '0', notes: '' });
  const [items, setItems] = useState<Row[]>([emptyItem()]);
  const [rxNotes, setRxNotes] = useState('');
  const [override, setOverride] = useState('');
  // the allergy check runs while the doctor picks drugs (same rules as on issue); a 409 on issue brings the same list
  const checkBody = useDebounced(JSON.stringify(items.filter((i) => i.name.trim().length >= 2).map((i) => ({ drug_id: i.drug_id, name: i.name.trim() }))), 400);
  const check = useQuery({
    queryKey: ['rx-check', encounterId, checkBody],
    queryFn: () => api<{ data: { warnings: RxWarning[] } }>(`/encounters/${encounterId}/prescription-check`, { method: 'POST', body: { items: JSON.parse(checkBody) } }).then((r) => r.data),
    enabled: kind === 'prescription' && checkBody !== '[]', retry: false,
  });
  const [conflict, setConflict] = useState<RxWarning[] | null>(null);
  // warnings refer to the checked (non-empty) rows: map them back to the rows on screen
  const filled = useMemo(() => items.map((it, i) => (it.name.trim().length >= 2 ? i : -1)).filter((i) => i >= 0), [items]);
  const warnings = (check.data?.warnings ?? conflict ?? []).map((w) => ({ ...w, row: filled[w.item] ?? -1 }));
  const blocking = warnings.some((w) => w.blocking);
  // what the form looked like when it opened: closing with anything typed asks first (like every other form)
  const snapshot = () => JSON.stringify(kind === 'referral' ? ref : kind === 'certificate' ? cert : { items, rxNotes, override });
  const [initial] = useState(snapshot);
  const dirty = snapshot() !== initial;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => { setErrors({}); setFormError(null); }, [kind]);

  const body = () => kind === 'referral'
    ? { ...ref, to_institution: ref.to_institution || null, notes: ref.notes || null, icd10: ref.icd10.map((x) => x.code) }
    : kind === 'certificate'
      ? { purpose: cert.purpose, include_diagnosis: cert.include_diagnosis, rest_days: Number(cert.rest_days) || 0, notes: cert.notes || null }
      : { items: items.filter((i) => TEXT_KEYS.some((k) => i[k].trim())).map(({ rx: _, ...i }) => ({ ...i, form: i.form || null, instructions: i.instructions || null })),
          notes: rxNotes || null, override_reason: blocking && override.trim() ? override : null };

  const issue = useMutation({
    mutationFn: () => api<{ data: { id: string; number: number } }>(`/encounters/${encounterId}/documents`, { method: 'POST', body: { kind, body: body() } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['documents', encounterId] });
      toast.success(t('docs.issuedToast', { kind: t(kindKey(kind)), n: r.data.number }));
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'ALLERGY_CONFLICT') { setConflict(e.details?.warnings ?? null); check.refetch(); }
      // field errors are shown next to the fields; the general message only when there is nothing more specific
      if (e instanceof ApiError && e.fields) { setErrors(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k.replace(/^body\./, ''), v]))); setFormError(null); }
      else setFormError(e instanceof Error ? e.message : t('password.notSaved'));
    },
  });
  const setItem = (i: number, k: keyof Item, v: string) => {
    // typing over a picked drug name makes it free text again
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v, ...(k === 'name' ? { drug_id: null, rx: false } : {}) } : x)));
    setErrors((e) => { const { items: _, [`items.${i}.${k}`]: __, [`items.${i}.drug_id`]: ___, ...rest } = e; return rest; });
  };
  const pickDrug = (i: number, d: { id: string; inn: string; inn_ru: string; forms: string[]; prescription_only: boolean }) => {
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, name: drugName(d, locale), drug_id: d.id, rx: d.prescription_only,
      form: x.form || (d.forms[0] ? t(`drugForm.${d.forms[0]}` as MessageKey) : '') } : x)));
    setErrors((e) => { const { [`items.${i}.name`]: _, ...rest } = e; return rest; });
  };
  const warnText = (w: RxWarning & { row: number }) => {
    const cls = className(w.class_name_uz, w.class_name_ru);
    // a class allergy's name is reference data in uz + ru; a drug or free text is shown as recorded
    const allergen = w.allergen_is_class ? className(w.allergen, w.allergen_ru) : locale === 'ru' ? w.allergen_ru : w.allergen;
    // a class allergy hit by a drug of that class: the class name once is enough
    const key = w.match === 'class' && w.allergen_is_class ? 'rx.warn.classOnly' : `rx.warn.${w.match}`;
    // the drug as the doctor sees it in the row (Russian name in a Russian interface), the server's INN otherwise
    return t(key as MessageKey, { drug: items[w.row]?.name.trim() || w.drug, cls, allergen });
  };

  return (
    <Modal open onClose={onClose} dirty={dirty && !issue.isPending} width={kind === 'prescription' ? 'max-w-5xl' : 'max-w-2xl'} title={t('docs.issueTitle', { kind: t(kindKey(kind)) })}
      footer={<><ModalCancel /><Button variant="primary" loading={issue.isPending} onClick={() => { setFormError(null); issue.mutate(); }}>{t('docs.issue')}</Button></>}>
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
          {/* the allergy is repeated right where the drugs are chosen; a known allergy is red, the patient's own answer amber */}
          {allergy?.state === 'known' && <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-700 px-3.5 py-2.5 text-[0.9375rem] font-bold text-white" data-testid="rx-allergy"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /><span>{allergy.note ? t('docs.rxAllergyKnown', { note: allergy.note }) : t('docs.rxAllergyKnownNoNote')}</span></div>}
          {allergy?.state !== 'known' && allergy?.intake && <Alert tone="yellow">{t('docs.rxAllergyIntake', { text: allergy.intake })}</Alert>}
          {errors.items && <Alert tone="red">{errors.items}</Alert>}
          {check.isError && <Alert tone="yellow">{t('rx.checkFailed', { msg: (check.error as Error).message })}</Alert>}
          <ol className="space-y-2">{items.map((it, i) => {
            const hits = warnings.filter((w) => w.row === i);
            const err = (k: string) => errors[`items.${i}.${k}`];
            const field = (k: keyof Item, cls: string) => (
              <label className={cx('flex min-w-0 flex-col gap-1', cls)}>
                <span className="text-[0.8125rem] font-semibold text-slate-700">{t(COL[k])}</span>
                <Input aria-label={t('docs.rowLabel', { i: i + 1, field: t(COL[k]) })} className="h-10 text-sm" value={it[k]} onChange={(e) => setItem(i, k, e.target.value)}
                  invalid={!!err(k)} placeholder={t(`docs.ph.${k}` as MessageKey)} />
                {err(k) && <span className="text-[0.8125rem] font-medium text-red-700">{err(k)}</span>}
              </label>
            );
            return (
              <li key={i} className={cx('rounded-xl border p-3', hits.some((w) => w.blocking) ? 'border-red-600' : hits.length ? 'border-amber-400' : 'border-slate-200')} data-testid={`rx-item-${i}`}>
                <div className="grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-12">
                  <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] font-semibold text-slate-700">{i + 1}. {t('docs.drug')}
                      {it.drug_id && <Badge tone="teal">{t('rx.fromList')}</Badge>}{it.rx && <Badge tone="blue">{t('rx.dmed')}</Badge>}</span>
                    <DrugCombobox value={it.name} drugId={it.drug_id} ariaLabel={t('docs.rowLabel', { i: i + 1, field: t('docs.drug') })} placeholder={t('rx.search')}
                      invalid={!!err('name') || !!err('drug_id')} onText={(v) => setItem(i, 'name', v)} onPick={(d) => pickDrug(i, d)} />
                    {(err('name') || err('drug_id')) && <span className="text-[0.8125rem] font-medium text-red-700">{err('name') || err('drug_id')}</span>}
                  </div>
                  {field('form', 'sm:col-span-3')}
                  {field('dose', 'sm:col-span-4')}
                  {field('frequency', 'col-span-2 sm:col-span-5')}
                  {field('duration', 'col-span-2 sm:col-span-3')}
                  <div className="col-span-2 flex items-end gap-1 sm:col-span-4">
                    {field('instructions', 'flex-1')}
                    <Button size="sm" variant="ghost" aria-label={t('docs.removeRow')} disabled={items.length === 1} icon={<Trash2 className="h-4 w-4" />} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} />
                  </div>
                </div>
                {hits.map((w, k) => (
                  <div key={k} role="alert" data-testid="rx-allergy-hit" className={cx('mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[0.9375rem]', w.blocking ? 'bg-red-700 font-bold text-white' : 'border border-amber-300 bg-amber-50 font-medium text-amber-950')}>
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                    <span>{w.blocking && <>{t('rx.warn.severe')}: </>}{warnText(w)}{w.reaction && <span className="block font-normal">{t('rx.warn.reaction', { r: w.reaction })}</span>}</span>
                  </div>
                ))}
              </li>
            );
          })}</ol>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={items.length >= 15} onClick={() => setItems((xs) => [...xs, emptyItem()])}>{t('docs.addDrug')}</Button>
          {blocking && (
            <Field label={t('rx.override')} required error={errors.override_reason} hint={t('rx.overrideHint')}>
              {(id) => <Textarea id={id} rows={2} maxLength={300} value={override} onChange={(e) => setOverride(e.target.value)} invalid={!!errors.override_reason} placeholder={t('rx.overridePh')} />}
            </Field>
          )}
          <Field label={t('docs.rxNotes')}>{(id) => <Textarea id={id} rows={2} value={rxNotes} onChange={(e) => setRxNotes(e.target.value)} />}</Field>
          <p className="text-[0.8125rem] text-slate-600">{t('docs.rxDisclaimer')}</p>
        </>}
      </div>
    </Modal>
  );
}
