'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
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
  { role: 'manager', icon: <Briefcase className="h-5 w-5" /> },
  { role: 'registrar', icon: <ClipboardList className="h-5 w-5" /> },
  { role: 'doctor', icon: <Stethoscope className="h-5 w-5" /> },
  { role: 'cashier', icon: <Banknote className="h-5 w-5" /> },
  { role: 'lab', icon: <FlaskConical className="h-5 w-5" /> },
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
      <title>{`${t('login.pageTitle')} — Med.uz.ai`}</title>
      <div className="mx-auto flex max-w-6xl flex-col px-4 py-5 sm:px-6">
        {/* phone: logo + language on one row, the demo badge on its own row; wider: logo … badge, language */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BrandLockup size="lg" />
          <div className="sm:order-2"><LanguagePicker /></div>
          {demoMode && <div className="order-3 basis-full sm:order-1 sm:ml-auto sm:basis-auto"><span className="inline-block rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[0.8125rem] font-semibold text-amber-900">{t('common.demoEnv')}</span></div>}
        </div>
        {/* wide screens: hero and demo roles on the left, staff sign-in on the right — the role cards fit on a 1366×768 screen.
            Phones: hero, sign-in, then the demo roles. */}
        <div className="mt-4 grid grid-cols-1 items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-bold leading-tight text-slate-900 sm:text-3xl">{t('login.title')}</h1>
            <p className="mt-2 text-base text-slate-700 sm:text-lg">{t('login.subtitle')}</p>
          </div>
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1"><StaffLogin /></div>
          {demoMode && <section aria-labelledby="demo-heading" className="min-w-0 lg:col-start-1">
            <h2 id="demo-heading" className="text-xl font-bold text-slate-900">{t('login.demoHeading')}</h2>
            {codeRequired && (
              <div className="mt-3 max-w-sm">
                <label htmlFor="access-code" className="text-sm font-semibold text-slate-800">{t('login.accessCode')}</label>
                <Input id="access-code" type="password" autoComplete="off" className="mt-1" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('login.accessCodePlaceholder')} />
                <p className="mt-1 text-[0.8125rem] text-slate-600">{t('login.accessCodeHint')}</p>
              </div>
            )}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {accounts.isLoading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
              {accounts.isError && <div className="col-span-full rounded-lg border bg-white"><ErrorState error={accounts.error} onRetry={() => accountsQ.refetch()} /></div>}
              {accounts.data && CARDS.map((c) => {
                const acc = c.role === 'doctor' ? null : accounts.data!.find((a) => a.role === c.role);
                return (
                  <div key={c.role} className="flex flex-col rounded-xl border border-slate-200 bg-white p-3">
                    {/* the icon sits inside the heading: the heading text stays exactly the role name */}
                    <h2 className="flex items-center gap-2.5 text-lg font-bold text-slate-900"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{c.icon}</span>{t(`role.${c.role}` as MessageKey)}</h2>
                    <p className="mt-1 flex-1 text-sm leading-snug text-slate-700">{t(`login.card.${c.role}` as MessageKey)}</p>
                    {c.role === 'doctor' ? (
                      <Select aria-label={t('login.pickDoctor')} data-testid="doctor-pick" className="mt-2 h-10 text-sm" value={doctorId || doctors.find((d) => d.specialty === 'Terapevt')?.membership_id || ''} onChange={(e) => setDoctorId(e.target.value)}>
                        {/* the name first: a narrow card cuts the end of the line, never the person */}
                        {doctors.map((d) => <option key={d.membership_id} value={d.membership_id}>{d.full_name} — {d.specialty}</option>)}
                      </Select>
                    ) : <p className="mt-2 truncate text-sm text-slate-800">{acc?.full_name}</p>}
                    <Button variant="primary" className="mt-2.5 w-full" loading={busy === c.role} disabled={!!busy} onClick={() => enter(c.role)}>{t('login.enter')}</Button>
                  </div>
                );
              })}
            </div>
          </section>}
        </div>
        {demoMode && <p className="mt-8 text-sm text-slate-600">{t('login.demoFooter')}</p>}
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
  const [missing, setMissing] = useState<{ login?: boolean; password?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const loginRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const t = useT();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // empty fields are marked next to the field itself; the cursor goes to the first one
    const miss = { login: !login.trim(), password: !password };
    setMissing(miss);
    if (miss.login || miss.password) { setError(null); (miss.login ? loginRef : passwordRef).current?.focus(); return; }
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
    <form onSubmit={submit} noValidate className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6" aria-label={t('login.staffTitle')}>
      <h2 className="text-xl font-bold text-slate-900">{t('login.staffTitle')}</h2>
      <p className="mt-1 text-sm text-slate-700">{t('login.staffHint')}</p>
      <div className="mt-4 space-y-3">
        {error && <Alert tone="red">{error}</Alert>}
        <Field label={t('login.login')} error={missing.login ? t('login.missingLogin') : undefined}>
          {(id) => <Input ref={loginRef} id={id} autoComplete="username" inputMode="text" value={login} invalid={missing.login} onChange={(e) => { setLogin(e.target.value); setChoices(null); setMembershipId(''); setMissing((m) => ({ ...m, login: false })); }} placeholder="+998 90 123 45 67" />}
        </Field>
        <Field label={t('login.password')} error={missing.password ? t('login.missingPassword') : undefined}>
          {(id) => <Input ref={passwordRef} id={id} type="password" autoComplete="current-password" value={password} invalid={missing.password} onChange={(e) => { setPassword(e.target.value); setMissing((m) => ({ ...m, password: false })); }} />}
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
