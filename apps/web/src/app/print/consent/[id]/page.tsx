'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CONSENT_TEXT_VERSION, CONSENT_TEXTS } from '@meduza/contracts';
import { api } from '@/lib/api';
import { fullName } from '@/lib/format';
import { useMeQuery } from '@/lib/session';
import { PrintDoc, PrintState } from '@/components/print-doc';
import { useT } from '@/lib/i18n';

/**
 * Consent form (A4) for the patient to sign: the full current consent text in the interface language.
 * `/print/consent/blank` prints an empty form (before the card exists). The text needs a lawyer's review — see
 * packages/contracts/src/i18n/messages/consent.ts.
 */
export default function PrintConsent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const blank = id === 'blank';
  const me = useMeQuery();
  const q = useQuery({ queryKey: ['patient', id], queryFn: () => api(`/patients/${id}`).then((r) => r.data), enabled: !blank });
  if (!blank && !q.data) return <PrintState q={q} />;
  if (!me.data) return <PrintState q={me} />;
  const text = CONSENT_TEXTS[CONSENT_TEXT_VERSION];
  const clinic = me.data.clinic_name;
  const line = '_______________________________';
  const patient = blank ? { last_name: line } : q.data;
  // the demo clock, as everywhere else ("now" is never the browser's own clock)
  const now = new Date(Date.parse(me.data.now) + (Date.now() - me.data.fetched_at));
  const box = <span aria-hidden className="mr-1.5 inline-block h-3.5 w-3.5 translate-y-0.5 border border-slate-800" />;
  const sign = (who: string, name: string) => (
    <div className="space-y-4 text-[0.8125rem]">
      <p className="font-bold">{who}</p>
      <p>{t('consent.print.nameLine')}: {name ? <b className="underline decoration-slate-400 underline-offset-4">{name}</b> : line}</p>
      <p>{t('consent.print.signLine')}: ______________________</p>
      <p>{t('consent.print.dateLine')}: ____.____.________</p>
    </div>
  );
  return (
    <PrintDoc title={blank ? t('consent.print.blankTitle') : t(text.title)} number={blank ? '—' : `RZ-${q.data.patient_number}`} date={now} patient={patient}
      responsible={me.data.name} status={CONSENT_TEXT_VERSION} statusLabel={t('consent.print.version')}
      footer={
        <div className="border-t border-slate-300 pt-4">
          <div className="grid grid-cols-2 gap-8">
            <div>{sign(t('consent.print.patientSign'), blank ? '' : fullName(patient, true))}<p className="mt-4 text-[0.8125rem]">{t('consent.print.representative')}<br />{line}</p></div>
            {sign(t('consent.print.staffSign'), me.data.name)}
          </div>
          <p className="mt-5 text-xs text-slate-600">{t('consent.print.copy')}</p>
        </div>
      }>
      {blank && <h2 className="mb-2 text-base font-bold">{t(text.title)}</h2>}
      <p className="mb-3">{t(text.intro)}</p>
      {text.sections.map(([h, body]) => (
        <section key={h} className="print-avoid-break mb-3">
          <h2 className="text-sm font-bold">{t(h)}</h2>
          <p>{t(body, { clinic })}</p>
        </section>
      ))}
      <p className="print-avoid-break mt-4 rounded border border-slate-400 p-3 font-semibold">{box}{t(text.agree)}</p>
      <p className="print-avoid-break mt-3">{t(text.tgChoice)} &nbsp; {box}{t('consent.print.agreeBox')} &nbsp;&nbsp; {box}{t('consent.print.disagreeBox')}</p>
    </PrintDoc>
  );
}
