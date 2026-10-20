'use client';
import { Loader2, Printer } from 'lucide-react';
import { useMeQuery } from '@/lib/session';
import { fmtDate, fmtDateTime, fullName, pid } from '@/lib/format';
import { BrandMark, BrandWordmark } from './logo';
import { ErrorState } from './ui';
import { useT } from '@/lib/i18n';

/** A4 document shell: Med.uz.ai + clinic/branch, patient ID, document number, date, responsible person, status and the DEMO mark. */
export function PrintDoc({ title, number, date, branch, patient, responsible, status, draft, children }: {
  title: string; number: string; date: string | Date; branch?: string; patient: any; responsible: string; status: string; draft?: boolean; children: React.ReactNode;
}) {
  const me = useMeQuery();
  const t = useT();
  const demo = me.data?.demo !== false; // until /me answers, assume demo (never print a real-looking demo document)
  return (
    <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-3 flex max-w-[210mm] justify-between">
        <button onClick={() => window.close()} className="min-h-10 text-sm font-semibold text-slate-700 hover:underline">{t('print.close')}</button>
        <button onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-[0.9375rem] font-semibold text-white shadow hover:bg-brand-700"><Printer className="h-5 w-5" />{t('print.print')}</button>
      </div>
      <article className="relative mx-auto min-h-[297mm] max-w-[210mm] overflow-hidden bg-white p-[14mm] text-[0.8125rem] leading-relaxed text-slate-900 shadow-lg print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
        {demo && <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[30deg] select-none whitespace-nowrap text-[2.625rem] font-black tracking-widest text-slate-200/60 print:text-slate-200">{t('print.demoMark')}</span>
        </div>}
        <div className="relative">
          <header className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
            <div className="flex items-center gap-3"><BrandMark compact className="h-11 w-11" /><div><div className="text-lg leading-tight"><BrandWordmark className="text-lg" /></div><div className="text-xs text-slate-600">{me.data?.clinic_name ?? '…'}{branch ? `, ${branch}` : ''}</div></div></div>
            <div className="text-right text-xs">{demo && <div className="font-bold text-red-700">{t('print.demoMark')}</div>}<div>{t('print.docNumber', { n: number })}</div><div>{t('print.date', { date: fmtDateTime(date) })}</div></div>
          </header>
          <div className="mt-4 flex items-center justify-between gap-4">
            <h1 className="text-xl font-bold">{title}</h1>
            {draft && <span className="rounded border-[3px] border-amber-500 px-3 py-1 text-xl font-black text-amber-700">{t('print.draft')}</span>}
          </div>
          <section className="print-avoid-break mt-3 grid grid-cols-2 gap-x-6 rounded border border-slate-300 p-3 text-[0.8125rem]">
            <div><span className="text-slate-600">{t('print.patient')}</span> <b>{fullName(patient, true)}</b></div>
            <div><span className="text-slate-600">{t('print.patientId')}</span> <b>{pid(patient?.patient_number)}</b></div>
            <div><span className="text-slate-600">{t('print.birthDate')}</span> {fmtDate(patient?.birth_date)}</div>
            <div><span className="text-slate-600">{t('print.status')}</span> <b>{status}</b></div>
          </section>
          <div className="mt-4">{children}</div>
          <footer className="print-avoid-break mt-10 flex items-end justify-between border-t border-slate-300 pt-3 text-xs text-slate-600">
            <div>{t('print.responsible')} <b className="text-slate-800">{responsible}</b><div className="mt-6">{t('print.signature')}</div></div>
            <div className="max-w-[60%] text-right">{t('print.legal')}{demo && <><br />{t('print.demoFooter')}</>}</div>
          </footer>
        </div>
      </article>
    </div>
  );
}

export function PrintState({ q }: { q: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void } }) {
  if (q.isLoading) return <div className="flex h-screen items-center justify-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (q.isError) return <div className="mx-auto mt-20 max-w-md rounded-lg border bg-white"><ErrorState error={q.error} onRetry={q.refetch} /></div>;
  return null;
}
