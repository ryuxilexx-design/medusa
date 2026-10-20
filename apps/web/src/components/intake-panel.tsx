'use client';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, CornerDownLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n';

type Intake = { complaints: string | null; allergies: string | null; medications: string | null; submitted_at: string };

/**
 * What the patient wrote in Telegram before the visit. It is the patient's own words, not a clinical record:
 * the doctor decides what goes into the note (one click copies the complaint into an empty/existing field).
 */
export function IntakePanel({ appointmentId, onUseComplaints }: { appointmentId: string; onUseComplaints?: (text: string) => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ['intake', appointmentId], queryFn: () => api<{ data: Intake | null }>(`/appointments/${appointmentId}/intake`).then((r) => r.data), retry: false });
  if (!q.data) return null;
  const f = q.data;
  return (
    <section aria-label={t('intake.label')} className="rounded-xl border border-sky-200 bg-sky-50/70 p-3.5 text-[0.9375rem]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold text-sky-950"><ClipboardList className="h-5 w-5" />{t('intake.title')}</h2>
        <span className="text-[0.8125rem] text-sky-900">{t('intake.meta', { at: fmtDateTime(f.submitted_at) })}</span>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-slate-600">{t('intake.complaints')}</dt><dd className="whitespace-pre-wrap text-slate-900">{f.complaints || '—'}</dd>
        <dt className="text-slate-600">{t('intake.allergies')}</dt><dd className="text-slate-900">{f.allergies || t('intake.noAllergies')}</dd>
        <dt className="text-slate-600">{t('intake.medications')}</dt><dd className="text-slate-900">{f.medications || t('intake.noMedications')}</dd>
      </dl>
      {f.allergies && <p className="mt-2 text-sm font-medium text-amber-900">{t('intake.checkAllergy')}</p>}
      {onUseComplaints && f.complaints && (
        <Button size="sm" className="mt-2" icon={<CornerDownLeft className="h-4 w-4" />} onClick={() => onUseComplaints(f.complaints!)}>{t('intake.use')}</Button>
      )}
    </section>
  );
}
