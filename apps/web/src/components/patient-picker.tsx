'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { fmtDate, fullName, pid } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { Button, Field, Input, Skeleton } from './ui';
import { useT } from '@/lib/i18n';

export type PatientRef = { id: string; last_name: string; first_name: string; patient_number: number };

/** Patient field of a booking: search by name (either script), phone or ID, or open the new-card form. */
export function PatientPicker({ value, onChange, error, locked, onNew }: {
  value: PatientRef | null; onChange: (p: PatientRef | null) => void; error?: string;
  /** The patient came with the dialog (patient card): no «change». */
  locked?: boolean;
  onNew?: () => void;
}) {
  const t = useT();
  const [search, setSearch] = useState('');
  const dq = useDebounced(search, 300);
  const found = useQuery({ queryKey: ['patients', 'pick', dq], queryFn: () => api(`/patients${qs({ search: dq, page_size: 6 })}`).then((r) => r.data as any[]), enabled: !value && dq.trim().length >= 2 });
  const pick = (p: PatientRef | null) => { onChange(p); setSearch(''); };
  return (
    <Field label={t('registrar.patient')} required error={error}>{(id) => value ? (
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border-2 border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-[0.9375rem]">
        <span className="min-w-0 [overflow-wrap:anywhere]"><b>{fullName(value)}</b> <span className="text-slate-600">{pid(value.patient_number)}</span></span>
        {!locked && <Button size="sm" variant="ghost" onClick={() => pick(null)}>{t('registrar.change')}</Button>}
      </div>
    ) : (
      <div>
        <Input id={id} value={search} invalid={!!error} onChange={(e) => setSearch(e.target.value)} placeholder={t('registrar.bk.patientSearch')} autoComplete="off" />
        <div className="mt-1 overflow-hidden rounded-lg border border-slate-200">
          {dq.trim().length < 2 ? <p className="px-3 py-2 text-[0.8125rem] text-slate-600">{t('registrar.bk.min2')}</p>
            : found.isLoading ? <Skeleton className="m-2 h-6" />
            : found.data?.length ? found.data.map((p) => (
              <button key={p.id} type="button" onClick={() => pick(p)} className="block min-h-9 w-full px-3 py-1.5 text-left text-sm [overflow-wrap:anywhere] hover:bg-brand-50 focus-visible:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300">
                <b>{fullName(p)}</b> <span className="text-slate-600">{pid(p.patient_number)}, {fmtDate(p.birth_date)}</span>
              </button>
            )) : <p className="px-3 py-2 text-[0.8125rem] text-slate-600">{t('registrar.patientNotFound')}</p>}
          {onNew && <button type="button" onClick={onNew} className="block min-h-9 w-full border-t border-slate-200 px-3 py-1.5 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-300">{t('registrar.bk.newPatient')}</button>}
        </div>
      </div>
    )}</Field>
  );
}
