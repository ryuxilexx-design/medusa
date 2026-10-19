'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Banknote, Briefcase, ClipboardList, FlaskConical, Stethoscope } from 'lucide-react';
import { ROLE_LABEL, type Role } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { HOME_BY_ROLE } from '@/lib/session';
import { Alert, Button, ErrorState, Field, Input, Select, Skeleton, useToast } from '@/components/ui';
import { BrandLockup } from '@/components/logo';

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
  // In production mode the server answers 404 here: then only the staff password form is shown.
  const accountsQ = useQuery({ queryKey: ['demo-accounts'], retry: false,
    queryFn: () => api<{ data: Account[]; meta?: { access_code_required?: boolean } }>('/demo/accounts').catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }) });
  const demoMode = accountsQ.data !== null;
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BrandLockup size="lg" />
          {demoMode && <span className="whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Demo muhit · Sun’iy ma’lumotlar</span>}
        </div>
        <div className="mt-12 grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Klinikaning bemor, xizmat va moliya jarayoni — bitta tizimda</h1>
            <p className="mt-3 text-slate-600">Har bir xodim o‘z vazifasiga mos ish joyini ko‘radi; ruxsatlar serverda tekshiriladi.</p>
          </div>
          <StaffLogin />
        </div>
        {demoMode && <h2 className="mt-12 text-sm font-semibold uppercase tracking-wide text-slate-500">Demo: rolni tanlab kirish</h2>}
        {demoMode && codeRequired && (
          <div className="mt-4 max-w-sm">
            <label htmlFor="access-code" className="text-[13px] font-medium text-slate-700">Demo kirish kodi</label>
            <Input id="access-code" type="password" autoComplete="off" className="mt-1" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Tashkilotchidan olingan kod" />
            <p className="mt-1 text-xs text-slate-500">Demo internetda ochiq, shuning uchun kirish kod bilan yopilgan.</p>
          </div>
        )}
        {demoMode && <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
        </div>}
        {demoMode && <p className="mt-10 text-xs text-slate-500">Demo klinikadagi barcha bemorlar, telefonlar va summalar sun’iy. Tashqi xabar yuborish o‘chirilgan.</p>}
      </div>
    </main>
  );
}

type Choice = { membership_id: string; clinic_name: string; role: Role; title: string | null };

/** Staff sign-in: phone or login + password. A person working in several clinics/roles picks one. */
function StaffLogin() {
  const router = useRouter();
  const qc = useQueryClient();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [membershipId, setMembershipId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!login.trim() || !password) { setError('Telefon yoki login va parolni kiriting'); return; }
    setError(null); setBusy(true);
    try {
      await api('/auth/login', { method: 'POST', body: { login: login.trim(), password, membership_id: membershipId || undefined } });
      qc.clear();
      const me = await api<{ data: { role: Role } }>('/me');
      router.replace(HOME_BY_ROLE[me.data.role]);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CHOOSE_MEMBERSHIP') {
        const opts = (err.details?.options ?? []) as Choice[];
        setChoices(opts); setMembershipId(opts[0]?.membership_id ?? '');
        setError(null);
      } else setError(err instanceof Error ? err.message : 'Kirib bo‘lmadi');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Xodim kirishi">
      <h2 className="font-semibold text-slate-900">Xodim kirishi</h2>
      <p className="mt-0.5 text-[13px] text-slate-500">Login va parolni klinika rahbari beradi.</p>
      <div className="mt-4 space-y-3">
        {error && <Alert tone="red">{error}</Alert>}
        <Field label="Telefon yoki login">
          {(id) => <Input id={id} autoComplete="username" inputMode="text" value={login} onChange={(e) => { setLogin(e.target.value); setChoices(null); setMembershipId(''); }} placeholder="+998 90 123 45 67" />}
        </Field>
        <Field label="Parol">
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        {choices && (
          <Field label="Klinika va rol" hint="Siz bir nechta klinika yoki rolda ishlaysiz">
            {(id) => <Select id={id} value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
              {choices.map((c) => <option key={c.membership_id} value={c.membership_id}>{c.clinic_name} · {ROLE_LABEL[c.role]}</option>)}
            </Select>}
          </Field>
        )}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Kirish</Button>
        <p className="text-xs text-slate-500">Parolni unutdingizmi? Klinika rahbari yangi vaqtinchalik parol beradi.</p>
      </div>
    </form>
  );
}
