'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDate, formatPhone, fullName, pid } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Alert, Button, Field, Input, Modal, Select, Textarea, useToast } from './ui';

export type PatientFormValue = {
  last_name: string; first_name: string; middle_name: string; birth_date: string; sex: string; phone: string;
  contact_name: string; contact_phone: string; address: string; note: string;
};
const EMPTY: PatientFormValue = { last_name: '', first_name: '', middle_name: '', birth_date: '', sex: 'unspecified', phone: '', contact_name: '', contact_phone: '', address: '', note: '' };

/** Create or edit basic patient data. Duplicate warning (same phone, or same name + birth date) needs explicit confirmation. */
export function PatientFormModal({ open, onClose, patient, onSaved }: { open: boolean; onClose: () => void; patient?: any; onSaved?: (id: string, created: boolean) => void }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState<PatientFormValue>(EMPTY);
  const [initial, setInitial] = useState<PatientFormValue>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dups, setDups] = useState<any[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const init = patient ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, patient[k] ?? ''])) as PatientFormValue : EMPTY;
    if (patient?.phone) init.phone = formatPhone(patient.phone);
    setV(init); setInitial(init); setErrors({}); setDups(null); setFormError(null);
  }, [open, patient]);

  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = (k: keyof PatientFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: '' })); };

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (v.last_name.trim().length < 2) e.last_name = 'Familiya kamida 2 belgi';
    if (v.first_name.trim().length < 2) e.first_name = 'Ism kamida 2 belgi';
    if (!v.birth_date) e.birth_date = 'Tug‘ilgan sana majburiy';
    else if (v.birth_date > me.today) e.birth_date = 'Kelajak sanasi bo‘lishi mumkin emas';
    const digits = v.phone.replace(/[\s\-()+]/g, '');
    if (v.phone.trim() && !(digits.length === 9 || (digits.length === 12 && digits.startsWith('998')))) e.phone = '+998 va 9 raqam, masalan +998 90 123 45 67';
    setErrors(e);
    return !Object.keys(e).length;
  }

  const save = useMutation({
    mutationFn: (confirm: boolean) => {
      const body: any = { ...v, confirm_duplicate: confirm || undefined };
      if (patient) { delete body.confirm_duplicate; return api(`/patients/${patient.id}`, { method: 'PATCH', body }); }
      return api<{ data: { id: string; patient_number: number } }>('/patients', { method: 'POST', body });
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['patient'] });
      toast.success(patient ? 'Bemor ma’lumotlari saqlandi' : `Bemor ${pid(r.data.patient_number)} yaratildi`);
      onSaved?.(patient ? patient.id : r.data.id, !patient);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'DUPLICATE_WARNING') { setDups(e.details?.candidates ?? []); return; }
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setFormError(e instanceof Error ? e.message : 'Saqlanmadi');
    },
  });
  const submit = (confirm = false) => { setFormError(null); if (validate()) save.mutate(confirm); };

  return (
    <Modal open={open} onClose={onClose} dirty={dirty && !save.isSuccess} width="max-w-2xl" title={patient ? 'Bemor ma’lumotlarini tahrirlash' : 'Bemor qo‘shish'}
      footer={dups ? null : <><Button onClick={onClose}>Bekor qilish</Button><Button variant="primary" loading={save.isPending} onClick={() => submit(false)}>{patient ? 'Saqlash' : 'Bemorni saqlash'}</Button></>}>
      {dups ? (
        <div className="space-y-3">
          <Alert title="O‘xshash bemor topildi">Telefon yoki F.I.Sh. + tug‘ilgan sana mos keladi. Oilaviy umumiy telefon bo‘lishi mumkin — mavjud profilni oching yoki alohida bemor sifatida saqlang.</Alert>
          <ul className="divide-y rounded-md border">
            {dups.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div><span className="font-medium">{fullName(d, true)}</span> <span className="text-slate-500">{pid(d.patient_number)} · {fmtDate(d.birth_date)} · {formatPhone(d.phone)}</span>
                  <div className="text-xs text-slate-500">{d.match === 'phone' ? 'Telefon mos' : 'F.I.Sh. va tug‘ilgan sana mos'}</div></div>
                <Link href={`/patients/${d.id}`} onClick={onClose} className="text-sm font-medium text-brand-700 hover:underline">Profilni ochish</Link>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDups(null)}>Formaga qaytish</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(true)}>Baribir yangi bemor yaratish</Button>
          </div>
        </div>
      ) : (
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); submit(false); }} noValidate>
          {formError && <div className="sm:col-span-3"><Alert tone="red">{formError}</Alert></div>}
          <Field label="Familiya" required error={errors.last_name}>{(id) => <Input id={id} value={v.last_name} onChange={set('last_name')} invalid={!!errors.last_name} autoComplete="off" />}</Field>
          <Field label="Ism" required error={errors.first_name}>{(id) => <Input id={id} value={v.first_name} onChange={set('first_name')} invalid={!!errors.first_name} autoComplete="off" />}</Field>
          <Field label="Otasining ismi" error={errors.middle_name}>{(id) => <Input id={id} value={v.middle_name} onChange={set('middle_name')} placeholder="ixtiyoriy" />}</Field>
          <Field label="Tug‘ilgan sana" required error={errors.birth_date}>{(id) => <Input id={id} type="date" max={me.today} value={v.birth_date} onChange={set('birth_date')} invalid={!!errors.birth_date} />}</Field>
          <Field label="Jins" error={errors.sex}>{(id) => <Select id={id} value={v.sex} onChange={set('sex')}><option value="unspecified">Ko‘rsatilmagan</option><option value="female">Ayol</option><option value="male">Erkak</option></Select>}</Field>
          <Field label="Telefon" error={errors.phone} hint="Ixtiyoriy · +998 XX XXX XX XX">{(id) => <Input id={id} value={v.phone} onChange={set('phone')} invalid={!!errors.phone} inputMode="tel" placeholder="+998 90 123 45 67" />}</Field>
          <Field label="Aloqa vakili (ism)" className="sm:col-span-2" error={errors.contact_name} hint="Voyaga yetmagan yoki alohida aloqa zarur bo‘lsa">{(id) => <Input id={id} value={v.contact_name} onChange={set('contact_name')} />}</Field>
          <Field label="Vakil telefoni" error={errors.contact_phone}>{(id) => <Input id={id} value={v.contact_phone} onChange={set('contact_phone')} inputMode="tel" />}</Field>
          <Field label="Manzil" className="sm:col-span-3" error={errors.address}>{(id) => <Input id={id} value={v.address} onChange={set('address')} />}</Field>
          <Field label="Izoh" className="sm:col-span-3" error={errors.note} hint="Ma’muriy izoh. Klinik xulosani bu yerga yozmang.">{(id) => <Textarea id={id} rows={2} value={v.note} onChange={set('note')} />}</Field>
          <button type="submit" className="hidden" />
        </form>
      )}
    </Modal>
  );
}
