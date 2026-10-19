'use client';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, CornerDownLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Button } from '@/components/ui';

type Intake = { complaints: string | null; allergies: string | null; medications: string | null; submitted_at: string };

/**
 * What the patient wrote in Telegram before the visit. It is the patient's own words, not a clinical record:
 * the doctor decides what goes into the note (one click copies the complaint into an empty/existing field).
 */
export function IntakePanel({ appointmentId, onUseComplaints }: { appointmentId: string; onUseComplaints?: (text: string) => void }) {
  const q = useQuery({ queryKey: ['intake', appointmentId], queryFn: () => api<{ data: Intake | null }>(`/appointments/${appointmentId}/intake`).then((r) => r.data), retry: false });
  if (!q.data) return null;
  const f = q.data;
  return (
    <section aria-label="Bemorning qabuldan oldingi javoblari" className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-medium text-sky-900"><ClipboardList className="h-4 w-4" />Bemor Telegram’da yozgan (qabuldan oldin)</h2>
        <span className="text-xs text-sky-800/80">{fmtDateTime(f.submitted_at)} · bemorning o‘z so‘zlari, tekshirilmagan</span>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[150px_minmax(0,1fr)]">
        <dt className="text-slate-500">Shikoyati</dt><dd className="whitespace-pre-wrap text-slate-900">{f.complaints || '—'}</dd>
        <dt className="text-slate-500">Allergiya</dt><dd className="text-slate-900">{f.allergies || 'Yo‘q deb belgiladi'}</dd>
        <dt className="text-slate-500">Ichayotgan dorilari</dt><dd className="text-slate-900">{f.medications || 'Hech qanday deb belgiladi'}</dd>
      </dl>
      {f.allergies && <p className="mt-2 text-xs text-amber-800">Allergiya haqida yozgan — bemor kartasidagi allergiya holatini tekshiring.</p>}
      {onUseComplaints && f.complaints && (
        <Button size="sm" className="mt-2" icon={<CornerDownLeft className="h-3.5 w-3.5" />} onClick={() => onUseComplaints(f.complaints!)}>Shikoyatni qaydga qo‘shish</Button>
      )}
    </section>
  );
}
