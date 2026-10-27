'use client';
import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { fmtDate, formatSom } from '@/lib/format';
import { useMeQuery } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { PrintDoc, PrintState } from '@/components/print-doc';

/**
 * Reconciliation act («akt sverki») with one company for a period: opening balance, the company's part of the bills
 * issued (debit), its transfers received (credit), closing balance, two signature blocks. A voided transfer is left out.
 * Bills are listed by number, date and the policy / employee number — not by the patient's name.
 */
export default function CompanyActPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><CompanyAct id={id} /></Suspense>;
}

function CompanyAct({ id }: { id: string }) {
  const sp = useSearchParams();
  const me = useMeQuery();
  const t = useT();
  const today = me.data?.today ?? '';
  const from = sp.get('from') ?? (today ? today.slice(0, 8) + '01' : ''), to = sp.get('to') ?? today;
  const q = useQuery({ queryKey: ['company-statement', id, from, to], enabled: !!from && !!to, queryFn: () => api(`/companies/${id}/statement${qs({ from, to })}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={{ ...q, isLoading: q.isLoading || !from }} />;
  const s = q.data;
  type Line = { at: string; doc: string; member: string; debit: number | null; credit: number | null };
  const lines: Line[] = [
    ...s.invoices.map((x: any) => ({ at: x.created_at, doc: t('comp.act.invoice', { n: x.invoice_number }), member: x.company_member_no ?? '', debit: x.amount, credit: null })),
    ...s.payments.map((x: any) => ({ at: x.received_at, doc: `${t('comp.act.payment', { n: x.number })}${x.document_number ? ` (${x.document_number})` : ''}`, member: '', debit: null, credit: x.amount })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const cell = 'border border-slate-400 px-2 py-1';
  return (
    <PrintDoc title={t('comp.act.title')} number={`${s.company.inn ?? ''}/${s.to}`} date={me.data?.now ?? s.to} patient={null} responsible={me.data?.name ?? ''} status="" legal={false}
      info={[[t('comp.act.company'), s.company.name], [t('comp.act.inn'), s.company.inn ?? '—'], [t('comp.act.contract'), s.company.contract_number ? `${s.company.contract_number}${s.company.contract_date ? `, ${fmtDate(s.company.contract_date)}` : ''}` : '—'],
        [t('comp.act.period'), `${fmtDate(s.from)} – ${fmtDate(s.to)}`]]}
      footer={<div className="grid grid-cols-2 gap-10 text-xs">
        {[[t('comp.act.clinicSide'), s.clinic], [t('comp.act.companySide'), s.company.name]].map(([k, v]) => (
          <div key={k}><div className="font-semibold">{k}</div><div>{v}</div><div className="mt-10 border-t border-slate-500 pt-1 text-slate-600">{t('comp.act.signature')}</div></div>
        ))}
      </div>}>
      <table className="w-full border-collapse text-[0.75rem]">
        <thead><tr className="bg-slate-100 text-left"><th className={cell}>{t('comp.act.date')}</th><th className={cell}>{t('comp.act.doc')}</th><th className={cell}>{t('comp.act.member')}</th><th className={`${cell} text-right`}>{t('comp.act.debit')}</th><th className={`${cell} text-right`}>{t('comp.act.credit')}</th></tr></thead>
        <tbody>
          <tr className="font-semibold"><td className={cell} colSpan={3}>{t('comp.act.opening')}</td><td className={`${cell} text-right tabular-nums`}>{s.opening >= 0 ? formatSom(s.opening) : ''}</td><td className={`${cell} text-right tabular-nums`}>{s.opening < 0 ? formatSom(-s.opening) : ''}</td></tr>
          {lines.map((l, i) => (
            <tr key={i} className="tabular-nums"><td className={`${cell} whitespace-nowrap`}>{fmtDate(l.at)}</td><td className={cell}>{l.doc}</td><td className={cell}>{l.member}</td>
              <td className={`${cell} text-right`}>{l.debit != null ? formatSom(l.debit) : ''}</td><td className={`${cell} text-right`}>{l.credit != null ? formatSom(l.credit) : ''}</td></tr>
          ))}
          <tr className="font-semibold"><td className={cell} colSpan={3}>{t('comp.act.turnover')}</td><td className={`${cell} text-right tabular-nums`}>{formatSom(s.debit)}</td><td className={`${cell} text-right tabular-nums`}>{formatSom(s.credit)}</td></tr>
          <tr className="font-bold"><td className={cell} colSpan={3}>{t('comp.act.closing')}</td><td className={`${cell} text-right tabular-nums`}>{s.closing >= 0 ? formatSom(s.closing) : ''}</td><td className={`${cell} text-right tabular-nums`}>{s.closing < 0 ? formatSom(-s.closing) : ''}</td></tr>
        </tbody>
      </table>
      <p className="mt-4 text-[0.8125rem]">{s.closing > 0 ? t('comp.act.owes', { date: fmtDate(s.to), company: s.company.name, amount: formatSom(s.closing) }) : t('comp.act.settled', { date: fmtDate(s.to) })}</p>
    </PrintDoc>
  );
}
