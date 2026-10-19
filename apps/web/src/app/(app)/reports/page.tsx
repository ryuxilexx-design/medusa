'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { SERVICE_CATEGORY_LABEL } from '@meduza/contracts';
import { api, qs } from '@/lib/api';
import { addDays, formatSom, fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Card, EmptyState, ErrorState, Input, LoadingRows, PageHeader, Table, Td, Th } from '@/components/ui';

export default function ReportsPage() { return <Suspense><Reports /></Suspense>; }

function Reports() {
  const { me, branchId } = useSession();
  const sp = useSearchParams();
  const initFrom = sp.get('from') ?? (sp.get('period') === '30d' ? addDays(me.today, -29) : addDays(me.today, -29));
  const [from, setFrom] = useState(initFrom);
  const [to, setTo] = useState(sp.get('to') ?? me.today);
  const f = { from, to, branch_id: branchId };
  const svc = useQuery({ queryKey: ['reports', 'services', f], queryFn: () => api(`/reports/services${qs(f)}`), enabled: me.role === 'manager' });
  const doc = useQuery({ queryKey: ['reports', 'doctors', f], queryFn: () => api(`/reports/doctors${qs(f)}`) });
  return (
    <>
      <PageHeader title={me.role === 'doctor' ? 'Mening faoliyatim' : 'Hisobotlar'} subtitle={`${fmtDate(from)} – ${fmtDate(to)} · bajarilgan xizmatlar (chegirmadan keyin)`}
        actions={<div className="flex items-center gap-2">
          <Input type="date" aria-label="Boshlanish" className="h-8 w-[145px] text-[0.8125rem]" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          <span className="text-slate-400">–</span>
          <Input type="date" aria-label="Tugash" className="h-8 w-[145px] text-[0.8125rem]" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </div>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {me.role === 'manager' && (
          <Card title="Xizmatlar kesimida" padded={false}>
            {svc.isLoading ? <LoadingRows /> : svc.isError ? <ErrorState error={svc.error} onRetry={() => svc.refetch()} /> : !svc.data.data.length ? <EmptyState title="Bu davrda bajarilgan xizmat yo‘q" /> : (
              <Table>
                <thead><tr><Th>Xizmat</Th><Th right>Soni</Th><Th right>Chegirma</Th><Th right>Xizmatlar qiymati</Th></tr></thead>
                <tbody>
                  {svc.data.data.map((r: any) => <tr key={r.service_id}><Td>{r.service_name} <Badge className="ml-1">{SERVICE_CATEGORY_LABEL[r.category]}</Badge></Td><Td right>{r.count}</Td><Td right>{Number(r.discount) ? `−${formatSom(Number(r.discount))}` : '—'}</Td><Td right className="font-medium">{formatSom(Number(r.value))}</Td></tr>)}
                  <tr className="bg-slate-50"><Td className="font-semibold">Jami</Td><Td right>{svc.data.data.reduce((a: number, b: any) => a + b.count, 0)}</Td><Td /><Td right className="font-semibold">{formatSom(svc.data.meta.total)}</Td></tr>
                </tbody>
              </Table>
            )}
          </Card>
        )}
        <Card title={me.role === 'doctor' ? 'Mening bajarilgan xizmatlarim' : 'Shifokorlar kesimida'} padded={false}>
          {doc.isLoading ? <LoadingRows /> : doc.isError ? <ErrorState error={doc.error} onRetry={() => doc.refetch()} /> : (
            <Table>
              <thead><tr><Th>Shifokor</Th><Th right>Xizmatlar</Th><Th right>Xizmatlar qiymati</Th><Th right>Hisoblangan ulush</Th></tr></thead>
              <tbody>
                {doc.data.data.map((r: any) => <tr key={r.doctor_id}><Td><div className="font-medium">{r.name}</div><div className="text-xs text-slate-500">{r.specialty}</div></Td><Td right>{r.services}</Td><Td right>{formatSom(r.value)}</Td><Td right className="font-medium">{formatSom(r.share)}</Td></tr>)}
                <tr className="bg-slate-50"><Td className="font-semibold">Jami</Td><Td right>{doc.data.data.reduce((a: number, b: any) => a + b.services, 0)}</Td><Td right className="font-semibold">{formatSom(doc.data.data.reduce((a: number, b: any) => a + b.value, 0))}</Td><Td right className="font-semibold">{formatSom(doc.data.data.reduce((a: number, b: any) => a + b.share, 0))}</Td></tr>
              </tbody>
            </Table>
          )}
          <p className="px-4 py-2 text-xs text-slate-500">«Hisoblangan ulush» = bajarilgan xizmatning chegirmadan keyingi qiymati × xizmat paytidagi foiz. Bu to‘langan maosh yoki payroll emas.</p>
        </Card>
      </div>
      <p className="mt-3 text-xs text-slate-500">«Xizmatlar qiymati», «qayd etilgan tushum» (Moliya) va «hisoblangan ulush» alohida ko‘rsatkichlar va aralashtirilmaydi.</p>
    </>
  );
}
