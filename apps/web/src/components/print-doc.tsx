'use client';
import { Loader2, Printer, X } from 'lucide-react';
import { useMeQuery } from '@/lib/session';
import { fmtDate, fmtDateTime, fullName, pid } from '@/lib/format';
import { BrandMark, BrandWordmark } from './logo';
import { Button, cx, ErrorState } from './ui';
import { useT } from '@/lib/i18n';

/** A4 document shell: Med.uz.ai + clinic/branch, patient ID, document number, date, responsible person, status and the DEMO mark. */
/** Paper: A4 (default), A5 (slips) or a 58 mm thermal ticket (queue number, narrow single column, no footer). */
export type PaperSize = 'A4' | 'A5' | 'ticket';
const PAGE_CSS: Record<PaperSize, string> = {
  A4: '', // globals.css
  A5: '@media print { @page { size: A5; margin: 10mm; } }',
  ticket: '@media print { @page { size: 58mm auto; margin: 3mm; } }',
};

export function PrintDoc({ title, number, date, branch, patient, responsible, status, statusLabel, draft, footer, paper = 'A4', toolbar, info, children }: {
  title: string; number: string; date: string | Date; branch?: string; patient: any; responsible: string; status: string; draft?: boolean; children: React.ReactNode;
  /** Label of the fourth patient-box cell (default «Holat:»). */
  statusLabel?: string;
  /** Replaces the default footer (responsible person, signature, legal note), e.g. a form signed by the patient. */
  footer?: React.ReactNode;
  paper?: PaperSize;
  /** Extra controls in the on-screen toolbar (never printed), e.g. the paper switch. */
  toolbar?: React.ReactNode;
  /** A document that is not about one patient (warehouse acts): these label/value cells replace the patient box. */
  info?: [string, React.ReactNode][];
}) {
  const me = useMeQuery();
  const t = useT();
  const demo = me.data?.demo !== false; // until /me answers, assume demo (never print a real-looking demo document)
  const ticket = paper === 'ticket';
  const sheet = ticket ? 'max-w-[58mm] min-h-0 p-[3mm] text-[0.6875rem] leading-snug' : paper === 'A5' ? 'max-w-[148mm] min-h-[210mm] p-[10mm] text-[0.8125rem] leading-relaxed' : 'max-w-[210mm] min-h-[297mm] p-[14mm] text-[0.8125rem] leading-relaxed';
  if (ticket) return (
    <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
      <title>{`${title} ${number} — Med.uz.ai`}</title>
      <style>{PAGE_CSS.ticket}</style>
      <div className="no-print mx-auto mb-3 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4 print:hidden">
        <Button variant="ghost" icon={<X className="h-5 w-5" />} onClick={() => window.close()}>{t('print.close')}</Button>
        {toolbar}
        <Button variant="primary" className="ml-auto max-w-full !whitespace-normal text-center" icon={<Printer className="h-5 w-5 shrink-0" />} onClick={() => window.print()}>{t('print.print')}</Button>
      </div>
      <article className={cx('relative mx-auto overflow-hidden bg-white text-slate-900 shadow-lg print:max-w-none print:p-0 print:shadow-none', sheet)}>
        <header className="flex items-center gap-2 border-b border-dashed border-slate-500 pb-2">
          <BrandMark compact className="h-7 w-7" />
          <div className="min-w-0"><div className="text-xs font-bold leading-tight">{me.data?.clinic_name ?? '…'}</div>{branch && <div className="truncate text-[0.625rem] text-slate-600">{branch}</div>}</div>
        </header>
        {demo && <div className="mt-1 text-center text-[0.625rem] font-bold text-red-700">{t('print.demoMark')}</div>}
        <div className="mt-2 font-bold">{fullName(patient, true)} <span className="font-normal text-slate-600">{pid(patient?.patient_number)}</span></div>
        <div className="mt-2">{children}</div>
        <div className="mt-3 border-t border-dashed border-slate-500 pt-1 text-[0.625rem] text-slate-600">{fmtDateTime(date)} · {number}</div>
      </article>
    </div>
  );
  return (
    <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
      {/* the tab title is also the file name offered by «Save as PDF» */}
      <title>{`${title} ${number} — Med.uz.ai`}</title>
      {PAGE_CSS[paper] && <style>{PAGE_CSS[paper]}</style>}
      <div className="no-print mx-auto mb-3 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4 print:hidden">
        <Button variant="ghost" icon={<X className="h-5 w-5" />} onClick={() => window.close()}>{t('print.close')}</Button>
        {toolbar}
        <Button variant="primary" className="ml-auto max-w-full !whitespace-normal text-center" icon={<Printer className="h-5 w-5 shrink-0" />} onClick={() => window.print()}>{t('print.print')}</Button>
      </div>
      <article className={cx('relative mx-auto overflow-hidden bg-white text-slate-900 shadow-lg print:min-h-0 print:max-w-none print:p-0 print:shadow-none', sheet)}>
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
          {info ? (
            <section className="print-avoid-break mt-3 grid grid-cols-2 gap-x-6 gap-y-0.5 rounded border border-slate-300 p-3 text-[0.8125rem]">
              {info.map(([k, v]) => <div key={k}><span className="text-slate-600">{k}</span> <b>{v}</b></div>)}
            </section>
          ) : <section className="print-avoid-break mt-3 grid grid-cols-2 gap-x-6 rounded border border-slate-300 p-3 text-[0.8125rem]">
            <div><span className="text-slate-600">{t('print.patient')}</span> <b>{fullName(patient, true)}</b></div>
            <div><span className="text-slate-600">{t('print.patientId')}</span> <b>{pid(patient?.patient_number)}</b></div>
            <div><span className="text-slate-600">{t('print.birthDate')}</span> {fmtDate(patient?.birth_date)}</div>
            <div><span className="text-slate-600">{statusLabel ?? t('print.status')}</span> <b>{status}</b></div>
          </section>}
          <div className="mt-4">{children}</div>
          {footer ? <footer className="print-avoid-break mt-8">{footer}{demo && <p className="mt-3 text-right text-xs text-slate-600">{t('print.demoFooter')}</p>}</footer> : (
            <footer className="print-avoid-break mt-10 flex items-end justify-between border-t border-slate-300 pt-3 text-xs text-slate-600">
              <div>{t('print.responsible')} <b className="text-slate-800">{responsible}</b><div className="mt-6">{t('print.signature')}</div></div>
              <div className="max-w-[60%] text-right">{t('print.legal')}{demo && <><br />{t('print.demoFooter')}</>}</div>
            </footer>
          )}
        </div>
      </article>
    </div>
  );
}

export function PrintState({ q }: { q: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void } }) {
  const t = useT();
  if (q.isLoading) return <div className="flex h-screen items-center justify-center bg-slate-200 text-slate-600" aria-busy="true" aria-label={t('common.loading')}><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (q.isError) return (
    <div className="min-h-screen bg-slate-200 px-4 pt-20 sm:px-0">
    <div className="sm:mx-auto sm:max-w-md">
      <title>Med.uz.ai</title>
      <div className="rounded-lg border border-slate-200 bg-white"><ErrorState error={q.error} onRetry={q.refetch} /></div>
      {/* this tab was opened from the app: give a way back */}
      <div className="mt-3 flex justify-center"><Button variant="ghost" icon={<X className="h-5 w-5" />} onClick={() => window.close()}>{t('print.close')}</Button></div>
    </div>
    </div>
  );
  return null;
}
