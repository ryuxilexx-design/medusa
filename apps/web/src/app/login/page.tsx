'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Banknote, Briefcase, ClipboardList, FlaskConical, Stethoscope } from 'lucide-react';
import type { MessageKey, Role } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { HOME_BY_ROLE } from '@/lib/session';
import { Alert, Button, ErrorState, Field, Input, Select, Skeleton, useToast } from '@/components/ui';
import { BrandLockup } from '@/components/logo';
import { LanguagePicker } from '@/components/prefs';
import { useT } from '@/lib/i18n';

type Account = { membership_id: string; role: Role; title: string; full_name: string; specialty: string | null };
const CARDS: { role: Role; icon: React.ReactNode }[] = [
  { role: 'manager', icon: <Briefcase className="h-6 w-6" /> },
  { role: 'registrar', icon: <ClipboardList className="h-6 w-6" /> },
  { role: 'doctor', icon: <Stethoscope className="h-6 w-6" /> },
  { role: 'cashier', icon: <Banknote className="h-6 w-6" /> },
  { role: 'lab', icon: <FlaskConical className="h-6 w-6" /> },
];

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
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
    if (codeRequired && !code.trim()) { toast.error(new Error(t('login.accessCodeMissing'))); return; }
    setBusy(role);
    try {
      await api('/demo/login', { method: 'POST', body: { membership_id: acc.membership_id, access_code: code.trim() || undefined } });
      qc.clear(); // never reuse the previous role's cached data
      router.replace(HOME_BY_ROLE[role]);
    } catch (e) { toast.error(e); setBusy(null); }
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BrandLockup size="lg" />
          <div className="flex flex-wrap items-center gap-3">
            {demoMode && <span className="whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[0.8125rem] font-semibold text-amber-900">{t('common.demoEnv')}</span>}
            <LanguagePicker />
          </div>
        </div>
        <div className="mt-10 grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-bold leading-tight text-slate-900">{t('login.title')}</h1>
            <p className="mt-3 text-lg text-slate-700">{t('login.subtitle')}</p>
          </div>
          <StaffLogin />
        </div>
        {demoMode && <h2 className="mt-12 text-xl font-bold text-slate-900">{t('login.demoHeading')}</h2>}
        {demoMode && codeRequired && (
          <div className="mt-4 max-w-sm">
            <label htmlFor="access-code" className="text-sm font-semibold text-slate-800">{t('login.accessCode')}</label>
            <Input id="access-code" type="password" autoComplete="off" className="mt-1" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('login.accessCodePlaceholder')} />
            <p className="mt-1 text-[0.8125rem] text-slate-600">{t('login.accessCodeHint')}</p>
          </div>
        )}
        {demoMode && <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {accounts.isLoading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
          {accounts.isError && <div className="col-span-full rounded-lg border bg-white"><ErrorState error={accounts.error} onRetry={() => accountsQ.refetch()} /></div>}
          {accounts.data && CARDS.map((c) => {
            const acc = c.role === 'doctor' ? null : accounts.data!.find((a) => a.role === c.role);
            return (
              <div key={c.role} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{c.icon}</div>
                <h2 className="mt-3 text-lg font-bold text-slate-900">{t(`role.${c.role}` as MessageKey)}</h2>
                <p className="mt-1 flex-1 text-sm leading-snug text-slate-700">{t(`login.card.${c.role}` as MessageKey)}</p>
                {c.role === 'doctor' ? (
                  <Select aria-label={t('login.pickDoctor')} data-testid="doctor-pick" className="mt-3 h-10 text-sm" value={doctorId || doctors.find((d) => d.specialty === 'Terapevt')?.membership_id || ''} onChange={(e) => setDoctorId(e.target.value)}>
                    {doctors.map((d) => <option key={d.membership_id} value={d.membership_id}>{d.specialty} · {d.full_name}</option>)}
                  </Select>
                ) : <p className="mt-3 truncate text-sm text-slate-800">{acc?.full_name}</p>}
                <Button variant="primary" className="mt-3 w-full" loading={busy === c.role} disabled={!!busy} onClick={() => enter(c.role)}>{t('login.enter')}</Button>
              </div>
            );
          })}
        </div>}
        {demoMode && <p className="mt-10 text-sm text-slate-600">{t('login.demoFooter')}</p>}
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
  const t = useT();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!login.trim() || !password) { setError(t('login.missing')); return; }
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
      } else setError(err instanceof Error ? err.message : t('login.failed'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border border-slate-200 bg-white p-6" aria-label={t('login.staffTitle')}>
      <h2 className="text-xl font-bold text-slate-900">{t('login.staffTitle')}</h2>
      <p className="mt-1 text-sm text-slate-700">{t('login.staffHint')}</p>
      <div className="mt-4 space-y-3">
        {error && <Alert tone="red">{error}</Alert>}
        <Field label={t('login.login')}>
          {(id) => <Input id={id} autoComplete="username" inputMode="text" value={login} onChange={(e) => { setLogin(e.target.value); setChoices(null); setMembershipId(''); }} placeholder="+998 90 123 45 67" />}
        </Field>
        <Field label={t('login.password')}>
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        {choices && (
          <Field label={t('login.membership')} hint={t('login.membershipHint')}>
            {(id) => <Select id={id} value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
              {choices.map((c) => <option key={c.membership_id} value={c.membership_id}>{c.clinic_name}, {t(`role.${c.role}` as MessageKey)}</option>)}
            </Select>}
          </Field>
        )}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>{t('login.enter')}</Button>
        <p className="text-[0.8125rem] text-slate-600">{t('login.forgot')}</p>
      </div>
    </form>
  );
}
