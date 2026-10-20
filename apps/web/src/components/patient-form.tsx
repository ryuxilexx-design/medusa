'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDate, formatPhone, fullName, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Alert, Button, Field, Input, Modal, ModalCancel, Select, Textarea, useToast } from './ui';
import { FileSignature, Printer } from 'lucide-react';
import { useT } from '@/lib/i18n';

export type PatientFormValue = {
  last_name: string; first_name: string; middle_name: string; birth_date: string; sex: string; phone: string;
  contact_name: string; contact_phone: string; address: string; note: string;
};
type ConsentValue = { data: boolean; method: 'signed_paper' | 'verbal'; notifications: boolean };
const NO_CONSENT: ConsentValue = { data: false, method: 'signed_paper', notifications: false };
const EMPTY: PatientFormValue = { last_name: '', first_name: '', middle_name: '', birth_date: '', sex: 'unspecified', phone: '', contact_name: '', contact_phone: '', address: '', note: '' };

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
    const digits = v.phone.replace(/[\s\-()+]/g, '');
    if (v.phone.trim() && !(digits.length === 9 || (digits.length === 12 && digits.startsWith('998')))) e.phone = t('registrar.form.phoneFormat');
    if (!patient && consentRequired && !consent.data) e.consent = t('consent.form.required');
    setErrors(e);
    return !Object.keys(e).length;
  }

  const save = useMutation({
    mutationFn: (confirm: boolean) => {
      const body: any = { ...v, confirm_duplicate: confirm || undefined };
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
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setFormError(e instanceof Error ? e.message : t('registrar.notSaved'));
    },
  });
  const submit = (confirm = false) => { setFormError(null); if (validate()) save.mutate(confirm); };

  return (
    <Modal open={open} onClose={onClose} dirty={dirty && !save.isSuccess} width="max-w-2xl" title={patient ? t('registrar.form.editTitle') : t('registrar.addPatient')}
      footer={dups ? null : <><ModalCancel /><Button variant="primary" loading={save.isPending} onClick={() => submit(false)}>{patient ? t('common.save') : t('registrar.form.savePatient')}</Button></>}>
      {dups ? (
        <div className="space-y-3">
          <Alert title={t('registrar.form.dupTitle')}>{t('registrar.form.dupText')}</Alert>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {dups.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div><span className="font-medium">{fullName(d, true)}</span> <span className="text-slate-600">{pid(d.patient_number)}, {fmtDate(d.birth_date)}, {formatPhone(d.phone)}</span>
                  <div className="text-xs text-slate-600">{d.match === 'phone' ? t('registrar.form.dupPhone') : t('registrar.form.dupNameBirth')}</div></div>
                <Link href={`/patients/${d.id}`} onClick={onClose} className="shrink-0 rounded text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">{t('registrar.form.openProfile')}</Link>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDups(null)}>{t('registrar.form.backToForm')}</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(true)}>{t('registrar.form.createAnyway')}</Button>
          </div>
        </div>
      ) : (
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); submit(false); }} noValidate>
          {formError && <div className="sm:col-span-3"><Alert tone="red">{formError}</Alert></div>}
          <Field label={t('registrar.form.lastName')} required error={errors.last_name}>{(id) => <Input id={id} value={v.last_name} onChange={set('last_name')} invalid={!!errors.last_name} autoComplete="off" />}</Field>
          <Field label={t('registrar.form.firstName')} required error={errors.first_name}>{(id) => <Input id={id} value={v.first_name} onChange={set('first_name')} invalid={!!errors.first_name} autoComplete="off" />}</Field>
          <Field label={t('registrar.form.middleName')} error={errors.middle_name}>{(id) => <Input id={id} value={v.middle_name} onChange={set('middle_name')} placeholder={t('common.optional')} />}</Field>
          <Field label={t('registrar.form.birthDate')} required error={errors.birth_date}>{(id) => <Input id={id} type="date" max={me.today} value={v.birth_date} onChange={set('birth_date')} invalid={!!errors.birth_date} />}</Field>
          <Field label={t('registrar.form.sex')} error={errors.sex}>{(id) => <Select id={id} value={v.sex} onChange={set('sex')}><option value="unspecified">{t('sex.unspecified')}</option><option value="female">{t('sex.female')}</option><option value="male">{t('sex.male')}</option></Select>}</Field>
          <Field label={t('registrar.phone')} error={errors.phone} hint={t('registrar.form.phoneHint')}>{(id) => <Input id={id} value={v.phone} onChange={set('phone')} invalid={!!errors.phone} inputMode="tel" placeholder="+998 90 123 45 67" />}</Field>
          <Field label={t('registrar.form.contactName')} className="sm:col-span-2" error={errors.contact_name} hint={t('registrar.form.contactHint')}>{(id) => <Input id={id} value={v.contact_name} onChange={set('contact_name')} />}</Field>
          <Field label={t('registrar.form.contactPhone')} error={errors.contact_phone}>{(id) => <Input id={id} value={v.contact_phone} onChange={set('contact_phone')} inputMode="tel" />}</Field>
          <Field label={t('registrar.form.address')} className="sm:col-span-3" error={errors.address}>{(id) => <Input id={id} value={v.address} onChange={set('address')} />}</Field>
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
          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 py-1.5 text-[0.9375rem] text-slate-900">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={value.data} onChange={(e) => onChange({ ...value, data: e.target.checked })}
              aria-invalid={!!error || undefined} aria-required={required || undefined} />
            <span>{t('consent.form.data')}{required && <span className="text-red-700" aria-hidden> *</span>}</span>
          </label>
          <p id="consent-hint" className="ml-[1.875rem] text-[0.8125rem] text-slate-600">{required ? t('consent.form.dataHintProd') : t('consent.form.dataHintDemo')}</p>
          {error && <p className="ml-[1.875rem] mt-1 text-[0.8125rem] font-medium text-red-700" role="alert">{error}</p>}
        </div>
        <Field label={t('consent.form.method')}>{(id) => (
          <Select id={id} value={value.method} onChange={(e) => onChange({ ...value, method: e.target.value as ConsentValue['method'] })}>
            <option value="signed_paper">{t('consent.method.signed_paper')}</option>
            <option value="verbal">{t('consent.method.verbal')}</option>
          </Select>
        )}</Field>
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem] text-slate-900">
          <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-600" checked={value.notifications} onChange={(e) => onChange({ ...value, notifications: e.target.checked })} />
          {t('consent.form.notifications')}
        </label>
        <a href="/print/consent/blank" target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded text-sm sm:col-span-2 font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">
          <Printer className="h-4 w-4" />{t('consent.printBlank')}
        </a>
      </div>
    </fieldset>
  );
}
