'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DOCUMENT_KIND_LABEL } from '@meduza/contracts';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { PrintDoc, PrintState } from '@/components/print-doc';

const PREFIX = { referral: 'Y', certificate: 'M', prescription: 'R' } as const;
const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="print-avoid-break mb-3"><h2 className="text-xs font-bold uppercase text-slate-500">{title}</h2><div className="whitespace-pre-wrap">{children}</div></div>
);

/** Referral, certificate of visit or prescription — printed from the immutable snapshot taken at issue. */
export default function PrintDocument({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['document', id], queryFn: () => api(`/documents/${id}`).then((r) => r.data) });
  if (!q.data) return <PrintState q={q} />;
  const d = q.data as { kind: keyof typeof PREFIX; number: number; status: string; issued_at: string; body: any; patient: any; void_reason: string | null; voided_at: string | null };
  const b = d.body, m = b.meta ?? {};
  const icd = (b.icd10 ?? []) as { code: string; title: string }[];
  const voided = d.status === 'void';
  return (
    <PrintDoc title={DOCUMENT_KIND_LABEL[d.kind]} number={`${PREFIX[d.kind]}-${String(d.number).padStart(5, '0')}`} date={d.issued_at} branch={m.branch_name} patient={d.patient}
      responsible={`${m.doctor_name}, ${m.specialty}`} status={voided ? 'Bekor qilingan' : 'Berilgan'}>
      {voided && <p className="mb-3 rounded border-2 border-red-500 px-3 py-2 font-bold uppercase text-red-700">Bekor qilingan {d.voided_at ? fmtDateTime(d.voided_at) : ''}: {d.void_reason}</p>}
      <p className="mb-3 text-slate-600">Qabul: {fmtDate(m.visit_date)}, {m.visit_time} · {m.service_name}</p>

      {d.kind === 'referral' && <>
        <Block title="Kimga">{b.to_specialty}{b.to_institution ? ` — ${b.to_institution}` : ''}</Block>
        <Block title="Shoshilinchlik">{b.urgency === 'urgent' ? 'SHOSHILINCH' : 'Rejali'}</Block>
        <Block title="Yo‘llanma sababi">{b.reason}</Block>
        {icd.length > 0 && <Block title="MKB-10">{icd.map((x) => `${x.code} — ${x.title}`).join('\n')}</Block>}
        {b.notes && <Block title="Izoh">{b.notes}</Block>}
      </>}

      {d.kind === 'certificate' && <>
        <p className="mb-3">Ushbu ma’lumotnoma bemor {fmtDate(m.visit_date)} kuni soat {m.visit_time} da «{m.service_name}» bo‘yicha qabulda bo‘lganini tasdiqlaydi.</p>
        <Block title="Taqdim etiladi">{b.purpose}</Block>
        {b.include_diagnosis && b.diagnosis && <Block title="Tashxis (bemor iltimosiga ko‘ra)">{b.diagnosis}{icd.length ? `\nMKB-10: ${icd.map((x) => `${x.code} — ${x.title}`).join('; ')}` : ''}</Block>}
        {b.rest_days > 0 && <Block title="Tavsiya">{`${fmtDate(b.rest_from)} – ${fmtDate(b.rest_until)} (${b.rest_days} kun) uyda davolanish tavsiya etiladi.`}</Block>}
        {b.notes && <Block title="Izoh">{b.notes}</Block>}
        <p className="mt-4 text-xs text-slate-500">Bu ma’lumotnoma mehnatga layoqatsizlik varaqasi emas.</p>
      </>}

      {d.kind === 'prescription' && <>
        <table className="print-avoid-break mb-3 w-full border-collapse text-[13px]">
          <thead><tr className="border-b border-slate-400 text-left"><th className="py-1 pr-2">№</th><th className="py-1 pr-2">Dori</th><th className="py-1 pr-2">Doza</th><th className="py-1 pr-2">Qabul tartibi</th><th className="py-1 pr-2">Muddati</th><th className="py-1">Ko‘rsatma</th></tr></thead>
          <tbody>{(b.items as any[]).map((it, i) => (
            <tr key={i} className="border-b border-slate-200 align-top"><td className="py-1 pr-2">{i + 1}</td><td className="py-1 pr-2"><b>{it.name}</b>{it.form ? `, ${it.form}` : ''}</td><td className="py-1 pr-2">{it.dose}</td><td className="py-1 pr-2">{it.frequency}</td><td className="py-1 pr-2">{it.duration}</td><td className="py-1">{it.instructions ?? ''}</td></tr>
          ))}</tbody>
        </table>
        {b.notes && <Block title="Umumiy tavsiya">{b.notes}</Block>}
        <p className="mt-4 text-xs text-slate-500">Klinika ichki retsepti (dori tavsiyasi). Davlat elektron retsepti (DMED) emas.</p>
      </>}
    </PrintDoc>
  );
}
