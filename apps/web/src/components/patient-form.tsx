'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDate, formatPhone, fullName, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Alert, Button, Checkbox, Field, Input, Modal, ModalCancel, Select, Textarea, TextLink, useToast } from './ui';
import { FileSignature, Printer } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { canRefer, LeadSourceSelect } from './referrals';
import { PayerFields } from './discounts';

export type PatientFormValue = {
  last_name: string; first_name: string; middle_name: string; birth_date: string; sex: string; phone: string;
  contact_name: string; contact_phone: string; address: string; note: string; pinfl: string; id_document: string;
  /** where the patient heard of the clinic (docs/REFERRALS.md); '' = not asked */
  lead_source_id: string;
  /** benefit category and company (docs/DISCOUNTS_COMPANIES.md); '' = none */
  benefit_category_id: string; benefit_note: string; company_id: string; company_member_no: string;
};
type ConsentValue = { data: boolean; method: 'signed_paper' | 'verbal'; notifications: boolean };
const NO_CONSENT: ConsentValue = { data: false, method: 'signed_paper', notifications: false };
const EMPTY: PatientFormValue = { last_name: '', first_name: '', middle_name: '', birth_date: '', sex: 'unspecified', phone: '', contact_name: '', contact_phone: '', address: '', note: '', pinfl: '', id_document: '', lead_source_id: '',
  benefit_category_id: '', benefit_note: '', company_id: '', company_member_no: '' };
const PAYER_KEYS = ['benefit_category_id', 'benefit_note', 'company_id', 'company_member_no'] as const;

/** Create or edit basic patient data. Duplicate warning (same phone, or same name + birth date) needs explicit confirmation. */
export function PatientFormModal({ open, onClose, patient, onSaved }: { open: boolean; onClose: () => void; patient?: any; onSaved?: (id: string, created: boolean) => void }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const [v, setV] = useState<PatientFormValue>(EMPTY);
  const [initial, setInitial] = useState<PatientFormValue>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dups, setDups] = useState<any[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // consent at registration (new cards only); required on a real clinic's server (production), optional in the demo
  const [consent, setConsent] = useState<ConsentValue>(NO_CONSENT);
  const consentRequired = !me.demo;
  const form = useRef<HTMLFormElement>(null);
  // after a failed check the first field with an error gets the focus (and scrolls into view in the long form)
  const focusFirstError = () => setTimeout(() => { const el = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]'); el?.focus(); el?.scrollIntoView?.({ block: 'center' }); }, 30);

  useEffect(() => {
    if (!open) return;
    const init = patient ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, patient[k] ?? ''])) as PatientFormValue : EMPTY;
    if (patient?.phone) init.phone = formatPhone(patient.phone);
    setV(init); setInitial(init); setErrors({}); setDups(null); setFormError(null); setConsent(NO_CONSENT);
  }, [open, patient]);

  const dirty = JSON.stringify(v) !== JSON.stringify(initial) || (!patient && JSON.stringify(consent) !== JSON.stringify(NO_CONSENT));
  const set = (k: keyof PatientFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: '' })); };

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (v.last_name.trim().length < 2) e.last_name = t('registrar.form.lastNameMin');
    if (v.first_name.trim().length < 2) e.first_name = t('registrar.form.firstNameMin');
    if (!v.birth_date) e.birth_date = t('registrar.form.birthRequired');
    else if (v.birth_date > me.today) e.birth_date = t('registrar.form.birthFuture');
    else if (v.birth_date < '1900-01-01') e.birth_date = t('registrar.form.birthTooOld');
    const digits = v.phone.replace(/[\s\-()+]/g, '');
    if (v.phone.trim() && !(digits.length === 9 || (digits.length === 12 && digits.startsWith('998')))) e.phone = t('registrar.form.phoneFormat');
    const pinfl = v.pinfl.replace(/[\s-]/g, '');
    if (pinfl && !/^\d{14}$/.test(pinfl)) e.pinfl = t('registrar.form.pinflFormat');
    const doc = v.id_document.replace(/[\s-]/g, '');
    if (doc && !/^[A-Za-z]{2}\d{7}$/.test(doc)) e.id_document = t('registrar.form.idDocumentFormat');
    if (!patient && consentRequired && !consent.data) e.consent = t('consent.form.required');
    setErrors(e);
    if (Object.keys(e).length) { focusFirstError(); return false; }
    return true;
  }

  const save = useMutation({
    mutationFn: (confirm: boolean) => {
      const body: any = { ...v, confirm_duplicate: confirm || undefined, lead_source_id: v.lead_source_id || null };
      // an unchanged source is not sent (it may be one the manager has since switched off)
      if (!canRefer(me.role) || (patient && v.lead_source_id === initial.lead_source_id)) delete body.lead_source_id;
      // payer fields: '' = none; unchanged ones are not sent (a category the manager has since switched off stays as it is)
      for (const k of PAYER_KEYS) body[k] = v[k] || null;
      if (!v.benefit_category_id) body.benefit_note = null;
      if (!v.company_id) body.company_member_no = null;
      if (!canRefer(me.role) || (patient && PAYER_KEYS.every((k) => v[k] === initial[k]))) for (const k of PAYER_KEYS) delete body[k];
      if (patient) { delete body.confirm_duplicate; return api(`/patients/${patient.id}`, { method: 'PATCH', body }); }
      if (consent.data || consent.notifications) body.consent = { data_processing: consent.data, notifications: consent.notifications, method: consent.method };
      return api<{ data: { id: string; patient_number: number } }>('/patients', { method: 'POST', body });
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['patient'] });
      toast.success(patient ? t('registrar.form.savedToast') : t('registrar.form.createdToast', { id: pid(r.data.patient_number) }));
      onSaved?.(patient ? patient.id : r.data.id, !patient);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'DUPLICATE_WARNING') { setDups(e.details?.candidates ?? []); return; }
      if (e instanceof ApiError && e.fields) { setErrors(e.fields); focusFirstError(); }
      setFormError(e instanceof Error ? e.message : t('registrar.notSaved'));
    },
  });
  // a second click while the first request is on its way never sends a second patient
  const submit = (confirm = false) => { if (save.isPending) return; setFormError(null); if (validate()) save.mutate(confirm); };

  return (
    <Modal open={open} onClose={onClose} dirty={dirty && !save.isSuccess} width="max-w-2xl" title={patient ? t('registrar.form.editTitle') : t('registrar.addPatient')}
      footer={dups ? null : <><ModalCancel /><Button variant="primary" loading={save.isPending} onClick={() => submit(false)}>{patient ? t('common.save') : t('registrar.form.savePatient')}</Button></>}>
      {dups ? (
        <div className="space-y-3">
          <Alert title={t('registrar.form.dupTitle')}>{t('registrar.form.dupText')}</Alert>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {dups.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 [overflow-wrap:anywhere]"><span className="font-medium">{fullName(d, true)}</span> <span className="text-slate-600">{pid(d.patient_number)}, {fmtDate(d.birth_date)}, {formatPhone(d.phone)}</span>
                  <div className="text-xs text-slate-600">{d.match === 'phone' ? t('registrar.form.dupPhone') : t('registrar.form.dupNameBirth')}</div></div>
                <Link href={`/patients/${d.id}`} onClick={onClose} className="relative shrink-0 rounded text-sm font-semibold text-brand-700 hover:underline after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-[''] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">{t('registrar.form.openProfile')}</Link>
              </li>
            ))}
          </ul>
          {/* two wide buttons: on a phone they stack instead of pushing the first one off the screen */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => setDups(null)}>{t('registrar.form.backToForm')}</Button>
            <Button variant="primary" className="!whitespace-normal" loading={save.isPending} onClick={() => save.mutate(true)}>{t('registrar.form.createAnyway')}</Button>
          </div>
        </div>
      ) : (
        <form ref={form} className="grid grid-cols-1 gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); submit(false); }} noValidate>
          {formError && <div className="sm:col-span-3"><Alert tone="red">{formError}</Alert></div>}
          <Field label={t('registrar.form.lastName')} required error={errors.last_name}>{(id) => <Input id={id} value={v.last_name} onChange={set('last_name')} invalid={!!errors.last_name} autoComplete="off" />}</Field>
          <Field label={t('registrar.form.firstName')} required error={errors.first_name}>{(id) => <Input id={id} value={v.first_name} onChange={set('first_name')} invalid={!!errors.first_name} autoComplete="off" />}</Field>
          <Field label={t('registrar.form.middleName')} error={errors.middle_name}>{(id) => <Input id={id} value={v.middle_name} onChange={set('middle_name')} placeholder={t('common.optional')} />}</Field>
          <Field label={t('registrar.form.birthDate')} required error={errors.birth_date}>{(id) => <Input id={id} type="date" max={me.today} value={v.birth_date} onChange={set('birth_date')} invalid={!!errors.birth_date} />}</Field>
          <Field label={t('registrar.form.sex')} error={errors.sex}>{(id) => <Select id={id} value={v.sex} onChange={set('sex')}><option value="unspecified">{t('sex.unspecified')}</option><option value="female">{t('sex.female')}</option><option value="male">{t('sex.male')}</option></Select>}</Field>
          <Field label={t('registrar.phone')} error={errors.phone} hint={t('registrar.form.phoneHint')}>{(id) => <Input id={id} value={v.phone} onChange={set('phone')} invalid={!!errors.phone} inputMode="tel" placeholder="+998 90 123 45 67" />}</Field>
          <Field label={t('registrar.form.contactName')} className="sm:col-span-2" error={errors.contact_name} hint={t('registrar.form.contactHint')}>{(id) => <Input id={id} value={v.contact_name} onChange={set('contact_name')} />}</Field>
          <Field label={t('registrar.form.contactPhone')} error={errors.contact_phone}>{(id) => <Input id={id} value={v.contact_phone} onChange={set('contact_phone')} invalid={!!errors.contact_phone} inputMode="tel" />}</Field>
          <Field label={t('registrar.form.pinfl')} className="sm:col-span-2" error={errors.pinfl} hint={t('registrar.form.pinflHint')}>{(id) => <Input id={id} value={v.pinfl} onChange={set('pinfl')} invalid={!!errors.pinfl} inputMode="numeric" maxLength={20} autoComplete="off" placeholder="12345678901234" />}</Field>
          <Field label={t('registrar.form.idDocument')} error={errors.id_document}>{(id) => <Input id={id} value={v.id_document} onChange={set('id_document')} invalid={!!errors.id_document} maxLength={12} autoComplete="off" placeholder="AA1234567" />}</Field>
          <Field label={t('registrar.form.address')} className={canRefer(me.role) ? 'sm:col-span-2' : 'sm:col-span-3'} error={errors.address}>{(id) => <Input id={id} value={v.address} onChange={set('address')} />}</Field>
          {canRefer(me.role) && <LeadSourceSelect value={v.lead_source_id} onChange={(id) => { setV((x) => ({ ...x, lead_source_id: id })); setErrors((x) => ({ ...x, lead_source_id: '' })); }} error={errors.lead_source_id} />}
          {canRefer(me.role) && <PayerFields value={{ benefit_category_id: v.benefit_category_id, benefit_note: v.benefit_note, company_id: v.company_id, company_member_no: v.company_member_no }}
            errors={errors} onChange={(p) => { setV((x) => ({ ...x, ...p })); setErrors((x) => ({ ...x, benefit_category_id: '', benefit_note: '', company_id: '', company_member_no: '' })); }} />}
          <Field label={t('registrar.note')} className="sm:col-span-3" error={errors.note} hint={t('registrar.form.noteHint')}>{(id) => <Textarea id={id} rows={2} value={v.note} onChange={set('note')} />}</Field>
          {!patient && <ConsentFields value={consent} required={consentRequired} error={errors.consent} onChange={(c) => { setConsent(c); setErrors((x) => ({ ...x, consent: '' })); }} />}
          <button type="submit" className="hidden" />
        </form>
      )}
    </Modal>
  );
}

/** Consent at registration: data processing (required in production) + how it was given, and optional Telegram reminders. */
function ConsentFields({ value, onChange, required, error }: { value: ConsentValue; onChange: (v: ConsentValue) => void; required: boolean; error?: string }) {
  const t = useT();
  return (
    <fieldset className={'sm:col-span-3 rounded-lg border px-3 pb-3 pt-1 ' + (error ? 'border-red-300 bg-red-50/40' : 'border-slate-200')} aria-describedby="consent-hint">
      <legend className="inline-flex items-center gap-1.5 px-1 text-sm font-semibold text-slate-800"><FileSignature className="h-4 w-4" />{t('consent.form.section')}</legend>
      <div className="grid grid-cols-1 items-end gap-x-4 gap-y-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Checkbox checked={value.data} onChange={(e) => onChange({ ...value, data: e.target.checked })} aria-invalid={!!error || undefined} aria-required={required || undefined}
            label={<>{t('consent.form.data')}{required && <span className="text-red-700" aria-hidden> *</span>}</>} />
          <p id="consent-hint" className="ml-8 text-small text-slate-600">{required ? t('consent.form.dataHintProd') : t('consent.form.dataHintDemo')}</p>
          {error && <p className="ml-8 mt-1 text-small font-medium text-red-700" role="alert">{error}</p>}
        </div>
        <Field label={t('consent.form.method')}>{(id) => (
          <Select id={id} value={value.method} onChange={(e) => onChange({ ...value, method: e.target.value as ConsentValue['method'] })}>
            <option value="signed_paper">{t('consent.method.signed_paper')}</option>
            <option value="verbal">{t('consent.method.verbal')}</option>
          </Select>
        )}</Field>
        <Checkbox rowClassName="min-h-control" checked={value.notifications} onChange={(e) => onChange({ ...value, notifications: e.target.checked })} label={t('consent.form.notifications')} />
        <TextLink href="/print/consent/blank" target="_blank" className="min-h-control-sm justify-self-start text-sm sm:col-span-2" icon={<Printer className="h-4 w-4" />}>{t('consent.printBlank')}</TextLink>
      </div>
    </fieldset>
  );
}
