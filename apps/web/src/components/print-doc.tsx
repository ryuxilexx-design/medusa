'use client';
import { Loader2, Printer } from 'lucide-react';
import { useMeQuery } from '@/lib/session';
import { fmtDate, fmtDateTime, fullName, pid } from '@/lib/format';
import { BrandMark, BrandWordmark } from './logo';
import { ErrorState } from './ui';

/** A4 document shell: Med.uz.ai + clinic/branch, patient ID, document number, date, responsible person, status and the DEMO mark. */
export function PrintDoc({ title, number, date, branch, patient, responsible, status, draft, children }: {
  title: string; number: string; date: string | Date; branch?: string; patient: any; responsible: string; status: string; draft?: boolean; children: React.ReactNode;
}) {
  const me = useMeQuery();
  const demo = me.data?.demo !== false; // until /me answers, assume demo (never print a real-looking demo document)
  return (
    <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-3 flex max-w-[210mm] justify-between">
        <button onClick={() => window.close()} className="text-sm text-slate-600 hover:underline">Yopish</button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-brand-700"><Printer className="h-4 w-4" />Chop etish / PDF saqlash</button>
      </div>
      <article className="relative mx-auto min-h-[297mm] max-w-[210mm] overflow-hidden bg-white p-[14mm] text-[0.8125rem] leading-relaxed text-slate-900 shadow-lg print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
        {demo && <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[30deg] select-none whitespace-nowrap text-[2.625rem] font-black tracking-widest text-slate-200/60 print:text-slate-200">DEMO — SUN’IY MA’LUMOT</span>
        </div>}
        <div className="relative">
          <header className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
            <div className="flex items-center gap-3"><BrandMark compact className="h-11 w-11" /><div><div className="text-lg leading-tight"><BrandWordmark className="text-lg" /></div><div className="text-xs text-slate-600">{me.data?.clinic_name ?? '…'}{branch ? ` · ${branch}` : ''}</div></div></div>
            <div className="text-right text-xs">{demo && <div className="font-bold text-red-700">DEMO — SUN’IY MA’LUMOT</div>}<div>Hujjat № {number}</div><div>Sana: {fmtDateTime(date)}</div></div>
          </header>
          <div className="mt-4 flex items-center justify-between gap-4">
            <h1 className="text-xl font-bold">{title}</h1>
            {draft && <span className="rounded border-[3px] border-amber-500 px-3 py-1 text-xl font-black uppercase tracking-wider text-amber-600">Qoralama</span>}
          </div>
          <section className="print-avoid-break mt-3 grid grid-cols-2 gap-x-6 rounded border border-slate-300 p-3 text-[0.8125rem]">
            <div><span className="text-slate-500">Bemor:</span> <b>{fullName(patient, true)}</b></div>
            <div><span className="text-slate-500">Bemor ID:</span> <b>{pid(patient?.patient_number)}</b></div>
            <div><span className="text-slate-500">Tug‘ilgan sana:</span> {fmtDate(patient?.birth_date)}</div>
            <div><span className="text-slate-500">Holat:</span> <b>{status}</b></div>
          </section>
          <div className="mt-4">{children}</div>
          <footer className="print-avoid-break mt-10 flex items-end justify-between border-t border-slate-300 pt-3 text-xs text-slate-600">
            <div>Mas’ul: <b className="text-slate-800">{responsible}</b><div className="mt-6">Imzo: ______________________</div></div>
            <div className="max-w-[60%] text-right">«Tasdiqlangan» holati tizimdagi ish jarayoni belgisi, huquqiy elektron raqamli imzo emas.{demo && <><br />Med.uz.ai demo muhiti — barcha ma’lumotlar sun’iy.</>}</div>
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
