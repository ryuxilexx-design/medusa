'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { PrintDoc, PrintState } from '@/components/print-doc';
import { useT } from '@/lib/i18n';

const PREFIX = { referral: 'Y', certificate: 'M', prescription: 'R' } as const;
const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="print-avoid-break mb-3"><h2 className="text-xs font-bold text-slate-600">{title}</h2><div className="whitespace-pre-wrap">{children}</div></div>
);

/** Referral, certificate of visit or prescription — printed from the immutable snapshot taken at issue. */
export default function PrintDocument({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const q = useQuery({ queryKey: ['document', id], queryFn: () => api(`/documents/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  const d = q.data as { kind: keyof typeof PREFIX; number: number; status: string; issued_at: string; body: any; patient: any; void_reason: string | null; voided_at: string | null };
  const b = d.body, m = b.meta ?? {};
  const icd = (b.icd10 ?? []) as { code: string; title: string }[];
  const voided = d.status === 'void';
  return (
    <PrintDoc title={t(`document.${d.kind}` as MessageKey)} number={`${PREFIX[d.kind]}-${String(d.number).padStart(5, '0')}`} date={d.issued_at} branch={m.branch_name} patient={d.patient}
      responsible={`${m.doctor_name}, ${m.specialty}`} status={voided ? t('print.doc.voided') : t('print.doc.issued')}>
      {voided && <p className="mb-3 rounded border-2 border-red-500 px-3 py-2 font-bold text-red-700">{t('print.doc.voidBanner', { at: d.voided_at ? fmtDateTime(d.voided_at) : '', reason: d.void_reason })}</p>}
      <p className="mb-3 text-slate-600">{t('print.doc.visit', { date: fmtDate(m.visit_date), time: m.visit_time, service: m.service_name })}</p>

      {d.kind === 'referral' && <>
        <Block title={t('print.doc.to')}>{b.to_specialty}{b.to_institution ? ` — ${b.to_institution}` : ''}</Block>
        <Block title={t('print.doc.urgency')}>{b.urgency === 'urgent' ? t('print.doc.urgent') : t('print.doc.routine')}</Block>
        <Block title={t('print.doc.reason')}>{b.reason}</Block>
        {icd.length > 0 && <Block title={t('icd.label')}>{icd.map((x) => `${x.code} — ${x.title}`).join('\n')}</Block>}
        {b.notes && <Block title={t('print.doc.note')}>{b.notes}</Block>}
      </>}

      {d.kind === 'certificate' && <>
        <p className="mb-3">{t('print.doc.certText', { date: fmtDate(m.visit_date), time: m.visit_time, service: m.service_name })}</p>
        <Block title={t('print.doc.purpose')}>{b.purpose}</Block>
        {b.include_diagnosis && b.diagnosis && <Block title={t('print.doc.diagnosis')}>{b.diagnosis}{icd.length ? `\n${t('icd.label')}: ${icd.map((x) => `${x.code} — ${x.title}`).join('; ')}` : ''}</Block>}
        {b.rest_days > 0 && <Block title={t('print.doc.advice')}>{t('print.doc.rest', { from: fmtDate(b.rest_from), until: fmtDate(b.rest_until), n: b.rest_days })}</Block>}
        {b.notes && <Block title={t('print.doc.note')}>{b.notes}</Block>}
        <p className="mt-4 text-xs text-slate-600">{t('print.doc.notSickLeave')}</p>
      </>}

      {d.kind === 'prescription' && <>
        <table className="print-avoid-break mb-3 w-full border-collapse text-[0.8125rem]">
          <thead><tr className="border-b border-slate-400 text-left"><th className="py-1 pr-2">№</th><th className="py-1 pr-2">{t('docs.drug')}</th><th className="py-1 pr-2">{t('docs.dose')}</th><th className="py-1 pr-2">{t('docs.frequency')}</th><th className="py-1 pr-2">{t('docs.duration')}</th><th className="py-1">{t('docs.instructions')}</th></tr></thead>
          <tbody>{(b.items as any[]).map((it, i) => (
            <tr key={i} className="border-b border-slate-200 align-top"><td className="py-1 pr-2">{i + 1}</td><td className="py-1 pr-2"><b>{it.name}</b>{it.prescription_only ? <b title={t('print.doc.dmed')}>*</b> : null}{it.form ? `, ${it.form}` : ''}</td><td className="py-1 pr-2">{it.dose}</td><td className="py-1 pr-2">{it.frequency}</td><td className="py-1 pr-2">{it.duration}</td><td className="py-1">{it.instructions ?? ''}</td></tr>
          ))}</tbody>
        </table>
        {b.notes && <Block title={t('print.doc.rxGeneral')}>{b.notes}</Block>}
        {(b.items as any[]).some((it) => it.prescription_only) && <p className="mb-2 text-xs font-semibold text-slate-800" data-testid="rx-dmed">{t('print.doc.dmedNote')}</p>}
        {b.allergy_check?.override_reason && <p className="mb-2 rounded border border-red-500 px-2 py-1 text-xs text-red-800">{t('print.doc.allergyOverride', { reason: b.allergy_check.override_reason })}</p>}
        <p className="mt-4 text-xs text-slate-600">{t('print.doc.rxDisclaimer')}</p>
      </>}
    </PrintDoc>
  );
}
