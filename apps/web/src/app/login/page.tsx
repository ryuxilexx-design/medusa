'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Banknote, Briefcase, ClipboardList, FlaskConical, Stethoscope } from 'lucide-react';
import type { Role } from '@meduza/contracts';
import { api } from '@/lib/api';
import { HOME_BY_ROLE } from '@/lib/session';
import { Button, ErrorState, Input, Select, Skeleton, useToast } from '@/components/ui';
import { MeduzaWordmark } from '@/components/logo';

type Account = { membership_id: string; role: Role; title: string; full_name: string; specialty: string | null };
const CARDS: { role: Role; label: string; text: string; icon: React.ReactNode }[] = [
  { role: 'manager', label: 'Rahbar', text: 'Ko‘rsatkichlar, moliya, xodimlar va sozlamalar', icon: <Briefcase className="h-5 w-5" /> },
  { role: 'registrar', label: 'Registrator', text: 'Bemorlar, qabul jadvali va navbat', icon: <ClipboardList className="h-5 w-5" /> },
  { role: 'doctor', label: 'Shifokor', text: 'Bugungi bemorlar, ko‘rik va buyurtmalar', icon: <Stethoscope className="h-5 w-5" /> },
  { role: 'cashier', label: 'Kassir', text: 'Hisoblar va to‘lovlarni qayd qilish', icon: <Banknote className="h-5 w-5" /> },
  { role: 'lab', label: 'Laboratoriya', text: 'Namuna, natija kiritish va tasdiqlash', icon: <FlaskConical className="h-5 w-5" /> },
];

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const accountsQ = useQuery({ queryKey: ['demo-accounts'], queryFn: () => api<{ data: Account[]; meta?: { access_code_required?: boolean } }>('/demo/accounts') });
  const accounts = { ...accountsQ, data: accountsQ.data?.data };
  const codeRequired = !!accountsQ.data?.meta?.access_code_required;
  const [code, setCode] = useState('');
  const doctors = accounts.data?.filter((a) => a.role === 'doctor') ?? [];
  const [doctorId, setDoctorId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function enter(role: Role) {
    const acc = role === 'doctor' ? doctors.find((d) => d.membership_id === doctorId) ?? doctors.find((d) => d.specialty === 'Terapevt') ?? doctors[0] : accounts.data?.find((a) => a.role === role);
    if (!acc) return;
    if (codeRequired && !code.trim()) { toast.error(new Error('Kirish kodini kiriting')); return; }
    setBusy(role);
    try {
      await api('/demo/login', { method: 'POST', body: { membership_id: acc.membership_id, access_code: code.trim() || undefined } });
      qc.clear(); // never reuse the previous role's cached data
      router.replace(HOME_BY_ROLE[role]);
    } catch (e) { toast.error(e); setBusy(null); }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-100">
      <div className="mx-auto flex max-w-5xl flex-col px-6 py-10">
        <div className="flex items-center justify-between">
          <MeduzaWordmark />
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Demo muhit · Sun’iy ma’lumotlar</span>
        </div>
        <div className="mt-12 max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Klinikaning bemor, xizmat va moliya jarayoni — bitta tizimda</h1>
          <p className="mt-3 text-slate-600">Rolni tanlang. Har bir xodim o‘z vazifasiga mos ish joyini ko‘radi; ruxsatlar serverda tekshiriladi.</p>
        </div>
        {codeRequired && (
          <div className="mt-8 max-w-sm">
            <label htmlFor="access-code" className="text-[13px] font-medium text-slate-700">Demo kirish kodi</label>
            <Input id="access-code" type="password" autoComplete="off" className="mt-1" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Tashkilotchidan olingan kod" />
            <p className="mt-1 text-xs text-slate-500">Demo internetda ochiq, shuning uchun kirish kod bilan yopilgan.</p>
          </div>
        )}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {accounts.isLoading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
          {accounts.isError && <div className="col-span-full rounded-lg border bg-white"><ErrorState error={accounts.error} onRetry={() => accountsQ.refetch()} /></div>}
          {accounts.data && CARDS.map((c) => {
            const acc = c.role === 'doctor' ? null : accounts.data!.find((a) => a.role === c.role);
            return (
              <div key={c.role} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{c.icon}</div>
                <h2 className="mt-3 font-semibold text-slate-900">{c.label}</h2>
                <p className="mt-1 flex-1 text-[13px] leading-snug text-slate-500">{c.text}</p>
                {c.role === 'doctor' ? (
                  <Select aria-label="Shifokorni tanlang" className="mt-3 h-8 text-[13px]" value={doctorId || doctors.find((d) => d.specialty === 'Terapevt')?.membership_id || ''} onChange={(e) => setDoctorId(e.target.value)}>
                    {doctors.map((d) => <option key={d.membership_id} value={d.membership_id}>{d.specialty} · {d.full_name}</option>)}
                  </Select>
                ) : <p className="mt-3 truncate text-[13px] text-slate-700">{acc?.full_name}</p>}
                <Button variant="primary" className="mt-3 w-full" loading={busy === c.role} disabled={!!busy} onClick={() => enter(c.role)}>Kirish</Button>
              </div>
            );
          })}
        </div>
        <p className="mt-10 text-xs text-slate-500">Barcha bemorlar, telefonlar va summalar sun’iy. Tashqi xabar yuborish o‘chirilgan. Bu sahifa faqat lokal/yopiq demo muhitida ishlaydi.</p>
      </div>
    </main>
  );
}
