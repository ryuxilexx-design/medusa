'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { PrintDoc, PrintState } from '@/components/print-doc';

export default function PrintNote({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['encounter', id], queryFn: () => api(`/encounters/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  const { note, patient, appointment: a } = q.data;
  const v = note.vitals ?? {};
  const vit = [v.bp_sys && v.bp_dia ? `AQB ${v.bp_sys}/${v.bp_dia} mm sim. ust.` : '', v.pulse ? `puls ${v.pulse} urish/daq.` : '', v.temp ? `harorat ${v.temp} °C` : ''].filter(Boolean).join(', ');
  const rows: [string, string | null][] = [['Shikoyatlar', note.complaints], ['Anamnez', note.anamnesis], ['Ko‘rik', note.examination], ['Tashxis / xulosa', note.diagnosis], ['Tavsiyalar', note.recommendations]];
  return (
    <PrintDoc title="Shifokor xulosasi" number={`X-${id.slice(0, 8).toUpperCase()}`} date={note.signed_at ?? note.saved_at} branch={a.branch_name} patient={patient}
      responsible={`${a.doctor_name}, ${a.specialty}`} status={note.status === 'signed' ? 'Tasdiqlangan' : 'Qoralama'} draft={note.status !== 'signed'}>
      <p className="mb-3 text-slate-600">Xizmat: {a.service_name} · Qabul: {fmtDate(a.starts_at)} · {a.room_name ?? ''}</p>
      {vit && <div className="print-avoid-break mb-3"><h2 className="text-xs font-bold uppercase text-slate-500">Ko‘rsatkichlar</h2><p>{vit}</p></div>}
      {rows.map(([k, t]) => (
        <div key={k} className="print-avoid-break mb-3"><h2 className="text-xs font-bold uppercase text-slate-500">{k}</h2><p className="whitespace-pre-wrap">{t || 'Kiritilmagan'}</p>
          {k === 'Tashxis / xulosa' && note.icd10?.length > 0 && <p className="mt-1">MKB-10: {note.icd10.map((x: { code: string; title: string }) => `${x.code} — ${x.title}`).join('; ')}</p>}
        </div>
      ))}
      {note.follow_up_date && <p><b>Qayta qabul:</b> {fmtDate(note.follow_up_date)}</p>}
    </PrintDoc>
  );
}
