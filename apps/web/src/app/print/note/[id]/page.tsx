'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { PrintDoc, PrintState } from '@/components/print-doc';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@meduza/contracts';

export default function PrintNote({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const q = useQuery({ queryKey: ['encounter', id], queryFn: () => api(`/encounters/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  const { note, patient, appointment: a } = q.data;
  const v = note.vitals ?? {};
  const vit = [v.bp_sys && v.bp_dia ? t('note.vitalsBp', { sys: v.bp_sys, dia: v.bp_dia }) : '', v.pulse ? t('note.vitalsPulse', { n: v.pulse }) : '', v.temp ? t('note.vitalsTemp', { n: v.temp }) : ''].filter(Boolean).join(', ');
  const rows: [MessageKey, string | null][] = [['note.complaints', note.complaints], ['note.anamnesis', note.anamnesis], ['note.examination', note.examination], ['note.diagnosis', note.diagnosis], ['note.recommendations', note.recommendations]];
  return (
    <PrintDoc title={t('print.note.title')} number={`X-${id.slice(0, 8).toUpperCase()}`} date={note.signed_at ?? note.saved_at} branch={a.branch_name} patient={patient}
      responsible={`${a.doctor_name}, ${a.specialty}`} status={note.status === 'signed' ? t('print.signed') : t('print.draft')} draft={note.status !== 'signed'}>
      <p className="mb-3 text-slate-600">{t('print.note.meta', { service: a.service_name, date: fmtDate(a.starts_at), room: a.room_name ?? '' })}</p>
      {vit && <div className="print-avoid-break mb-3"><h2 className="text-xs font-bold text-slate-600">{t('note.vitals')}</h2><p>{vit}</p></div>}
      {rows.map(([k, text]) => (
        <div key={k} className="print-avoid-break mb-3"><h2 className="text-xs font-bold text-slate-600">{t(k)}</h2><p className="whitespace-pre-wrap">{text || t('print.notEntered')}</p>
          {k === 'note.diagnosis' && note.icd10?.length > 0 && <p className="mt-1">{t('icd.label')}: {note.icd10.map((x: { code: string; title: string }) => `${x.code} — ${x.title}`).join('; ')}</p>}
        </div>
      ))}
      {note.follow_up_date && <p><b>{t('print.note.followUp')}</b> {fmtDate(note.follow_up_date)}</p>}
    </PrintDoc>
  );
}
