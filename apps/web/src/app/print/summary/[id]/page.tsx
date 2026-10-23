'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LOCALE_TAG } from '@meduza/contracts';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { PrintDoc, PrintState } from '@/components/print-doc';
import { useT } from '@/lib/i18n';

/** The approved plain-language summary for the patient, on A5. The text is printed exactly as the doctor approved it. */
export default function PrintSummary({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const q = useQuery({ queryKey: ['patient-summary', id], queryFn: () => api(`/patient-summaries/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  const s = q.data as { version: number; language: 'uz' | 'uz-Cyrl' | 'ru'; text: string; approved_by_name: string; approved_at: string; branch_name: string;
    doctor_name: string; specialty: string; starts_at: string; patient: any };
  return (
    <PrintDoc paper="A5" title={t('ps.print.title')} number={`X-${id.slice(0, 8).toUpperCase()}/${s.version}`} date={s.approved_at} branch={s.branch_name} patient={s.patient}
      responsible={`${s.doctor_name}, ${s.specialty}`} status={t('ps.print.status')}>
      <p className="mb-3 text-slate-600">{fmtDate(s.starts_at)} · {s.doctor_name}</p>
      {/* the patient's language, set on the block so hyphenation and screen readers follow it */}
      <div lang={LOCALE_TAG[s.language]} className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed" data-testid="ps-print">{s.text}</div>
      <p className="mt-4 text-xs text-slate-600">{t('ps.print.approved', { name: s.approved_by_name, at: fmtDateTime(s.approved_at) })}</p>
    </PrintDoc>
  );
}
