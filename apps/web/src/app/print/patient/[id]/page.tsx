'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MessageKey } from '@meduza/contracts';
import { api } from '@/lib/api';
import { ageFrom, fmtDate, fmtDateTime, formatPhone, formatSom } from '@/lib/format';
import { useMeQuery } from '@/lib/session';
import { PrintDoc, PrintState } from '@/components/print-doc';
import { useT } from '@/lib/i18n';

/**
 * Patient card (A4) — the printable answer to a data-subject access request (ZRU-547). The server filters the fields by
 * role: the doctor's copy carries allergy and the diagnosis of each signed visit; a manager's or registrar's copy lists
 * the visits without clinical text and adds the invoices summary.
 */
export default function PrintPatientCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const me = useMeQuery();
  const q = useQuery({ queryKey: ['patient', id, 'card'], queryFn: () => api(`/patients/${id}/card`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  if (!me.data) return <PrintState q={me} />;
  const { patient: p, consents, visits, invoices } = q.data;
  const anonymised = !!p.anonymised_at;
  const row = (k: string, v: React.ReactNode) => <div className="flex gap-3 py-1"><dt className="w-44 shrink-0 text-slate-600">{k}</dt><dd className="min-w-0 font-medium [overflow-wrap:anywhere]">{v || '—'}</dd></div>;
  const th = 'border-b border-slate-400 py-1 pr-2 text-left text-xs font-semibold text-slate-600';
  const td = 'border-b border-slate-200 py-1 pr-2 align-top';
  return (
    <PrintDoc title={t('print.card.title')} number={`BK-${p.patient_number}`} date={q.data.generated_at} patient={p} responsible={me.data.name}
      status={anonymised ? t('print.card.anonymised') : t('print.card.active')}>
      <section className="print-avoid-break">
        <h2 className="mb-1 text-sm font-bold">{t('print.card.demographics')}</h2>
        <dl className="divide-y divide-slate-100 text-[0.8125rem]">
          {row(t('print.card.sex'), t(`sex.${p.sex}` as MessageKey))}
          {!anonymised && row(t('registrar.birthDate'), `${fmtDate(p.birth_date)} (${ageFrom(p.birth_date, me.data.today)})`)}
          {row(t('print.card.phone'), p.phone ? formatPhone(p.phone) : null)}
          {row(t('print.card.contact'), p.contact_name ? `${p.contact_name}${p.contact_phone ? ', ' + formatPhone(p.contact_phone) : ''}` : null)}
          {row(t('print.card.pinfl'), p.pinfl)}
          {p.id_document && row(t('print.card.idDocument'), p.id_document)}
          {row(t('print.card.address'), p.address)}
          {row(t('print.card.note'), p.note)}
          {row(t('print.card.registered'), fmtDate(p.created_at))}
          {p.allergy_state !== undefined && row(t('print.card.allergy'), `${t(`allergy.${p.allergy_state}` as MessageKey)}${p.allergy_note ? ': ' + p.allergy_note : ''}`)}
          {anonymised && row(t('print.card.anonymised'), fmtDateTime(p.anonymised_at))}
        </dl>
      </section>

      <section className="print-avoid-break mt-4">
        <h2 className="mb-1 text-sm font-bold">{t('print.card.consents')}</h2>
        {!consents.length ? <p className="text-[0.8125rem] text-slate-600">{t('print.card.noConsents')}</p> : (
          <table className="w-full text-[0.8125rem]">
            <thead><tr><th className={th}>{t('registrar.date')}</th><th className={th}>{t('print.card.consentKind')}</th><th className={th}>{t('print.card.consentState')}</th><th className={th}>{t('print.card.consentVersion')}</th><th className={th}>{t('print.card.consentMethod')}</th><th className={th}>{t('print.card.consentBy')}</th></tr></thead>
            <tbody>{consents.map((c: any) => (
              <tr key={c.id}>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{fmtDateTime(c.recorded_at)}</td>
                <td className={td}>{t(`consent.kind.${c.kind}` as MessageKey)}</td>
                <td className={`${td} font-medium`}>{c.granted ? t('print.card.granted') : t('print.card.refused')}</td>
                <td className={`${td} tabular-nums`}>{c.text_version}</td>
                <td className={td}>{t(`consent.method.${c.method}` as MessageKey)}</td>
                <td className={td}>{c.recorded_by_name ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section className="mt-4">
        <h2 className="mb-1 text-sm font-bold">{t('print.card.visits', { n: visits.length })}</h2>
        {!visits.length ? <p className="text-[0.8125rem] text-slate-600">{t('print.card.noVisits')}</p> : (
          <table className="w-full text-[0.8125rem]">
            <thead><tr><th className={th}>{t('registrar.date')}</th><th className={th}>{t('registrar.doctor')}</th><th className={th}>{t('registrar.service')}</th>{visits[0].icd10 !== undefined && <th className={th}>{t('print.card.diagnosis')}</th>}<th className={th}>{t('registrar.status')}</th></tr></thead>
            <tbody>{visits.map((v: any) => (
              <tr key={v.id} className="print-avoid-break">
                <td className={`${td} whitespace-nowrap tabular-nums`}>{fmtDateTime(v.starts_at)}</td>
                <td className={td}>{v.doctor_name}<span className="text-slate-600">, {v.specialty}</span></td>
                <td className={td}>{v.service_name}<div className="text-xs text-slate-600">{v.branch_name}</div></td>
                {v.icd10 !== undefined && (
                  <td className={td}>
                    {v.icd10?.length ? v.icd10.map((c: any) => <div key={c.code}><b className="tabular-nums">{c.code}</b> {c.title}</div>) : null}
                    {v.diagnosis && <div className={v.icd10?.length ? 'text-xs text-slate-600' : ''}>{v.diagnosis}</div>}
                    {!v.icd10?.length && !v.diagnosis && t('print.card.noDiagnosis')}
                  </td>
                )}
                <td className={`${td} whitespace-nowrap`}>{t(`status.appointment.${v.status}` as MessageKey)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {visits.length > 0 && visits[0].icd10 === undefined && <p className="mt-1 text-xs text-slate-600">{t('print.card.clinicalNote')}</p>}
      </section>

      {invoices && (
        <section className="print-avoid-break mt-4">
          <h2 className="mb-1 text-sm font-bold">{t('print.card.invoices')}</h2>
          <dl className="grid grid-cols-2 gap-x-6 text-[0.8125rem] sm:grid-cols-4">
            <div><dt className="text-slate-600">{t('print.card.invoiceCount')}</dt><dd className="font-medium tabular-nums">{invoices.summary.count}</dd></div>
            <div><dt className="text-slate-600">{t('print.card.invoiceTotal')}</dt><dd className="font-medium tabular-nums">{formatSom(Number(invoices.summary.total))}</dd></div>
            <div><dt className="text-slate-600">{t('print.card.invoicePaid')}</dt><dd className="font-medium tabular-nums">{formatSom(Number(invoices.summary.paid))}</dd></div>
            <div><dt className="text-slate-600">{t('print.card.invoiceDue')}</dt><dd className={`font-medium tabular-nums ${Number(invoices.summary.due) > 0 ? 'text-red-700' : ''}`}>{formatSom(Number(invoices.summary.due))}</dd></div>
          </dl>
        </section>
      )}
    </PrintDoc>
  );
}
