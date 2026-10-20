'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ArrowRight, Banknote, Briefcase, ClipboardList, FlaskConical, Stethoscope } from 'lucide-react';
import type { MessageKey, Role } from '@meduza/contracts';
import { api, ApiError } from '@/lib/api';
import { HOME_BY_ROLE } from '@/lib/session';
import { Alert, Button, cx, ErrorState, Field, Input, Select, Skeleton, useToast } from '@/components/ui';
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
  const [tab, setTab] = useState<'demo' | 'password'>('demo');
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

  const tabBtn = (v: 'demo' | 'password', label: string) => (
    <button type="button" role="tab" aria-selected={tab === v} aria-controls={`login-${v}`} id={`login-tab-${v}`} onClick={() => setTab(v)}
      className={cx('min-h-11 flex-1 rounded-lg px-3 text-[0.9375rem] font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300',
        tab === v ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900')}>{label}</button>
  );

  return (
    <main className="min-h-screen bg-slate-100">
      <title>{`${t('login.pageTitle')} — Med.uz.ai`}</title>
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <BrandLockup size="lg" />
        <LanguagePicker />
      </div>
      {/* one centred card: one way in at a time (demo roles or login + password), nothing competing beside it */}
      <div className="mx-auto w-full max-w-[30rem] px-4 pb-10 pt-4 sm:pt-[6vh]">
        <h1 className="text-2xl font-bold text-slate-900">{t('login.heading')}</h1>
        <p className="mt-1 text-[0.9375rem] text-slate-600">{t('login.tagline')}{demoMode && <> · <span className="font-semibold text-amber-800">{t('common.demoEnv')}</span></>}</p>
        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {demoMode && (
            <div role="tablist" aria-label={t('login.heading')} className="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1">
              {tabBtn('demo', t('login.tabDemo'))}{tabBtn('password', t('login.tabPassword'))}
            </div>
          )}
          {demoMode && tab === 'demo' ? (
            <section id="login-demo" role="tabpanel" aria-labelledby="login-tab-demo">
              {codeRequired && (
                <div className="mb-4">
                  <Field label={t('login.accessCode')} hint={t('login.accessCodeHint')}>
                    {(id) => <Input id={id} type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('login.accessCodePlaceholder')} />}
                  </Field>
                </div>
              )}
              <p className="mb-3 text-[0.9375rem] text-slate-700">{t('login.demoPick')}</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {accounts.isLoading && Array.from({ length: 5 }).map((_, i) => <li key={i} className="p-3"><Skeleton className="h-11" /></li>)}
                {accounts.isError && <li><ErrorState error={accounts.error} onRetry={() => accountsQ.refetch()} /></li>}
                {accounts.data && CARDS.map((c) => {
                  const acc = c.role === 'doctor' ? null : accounts.data!.find((a) => a.role === c.role);
                  return (
                    <li key={c.role} data-demo-role={c.role} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
                      <span aria-hidden="true" className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 min-[400px]:flex">{c.icon}</span>
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-base font-bold leading-tight text-slate-900">{t(`role.${c.role}` as MessageKey)}</h2>
                        <p className="mt-0.5 truncate text-sm text-slate-600">{c.role === 'doctor' ? t('login.pickDoctor') : acc?.full_name}</p>
                      </div>
                      <Button className="shrink-0 px-3 sm:px-4" loading={busy === c.role} disabled={!!busy} onClick={() => enter(c.role)}>{t('login.enter')}<ArrowRight className="hidden h-4 w-4 sm:block" /></Button>
                      {c.role === 'doctor' && (
                        <Select aria-label={t('login.pickDoctor')} data-testid="doctor-pick" className="basis-full text-[0.9375rem] min-[400px]:ml-[3.25rem] min-[400px]:basis-[calc(100%-3.25rem)]" value={doctorId || doctors.find((d) => d.specialty === 'Terapevt')?.membership_id || ''} onChange={(e) => setDoctorId(e.target.value)}>
                          {/* the name first: a narrow screen cuts the end of the line, never the person */}
                          {doctors.map((d) => <option key={d.membership_id} value={d.membership_id}>{d.full_name} — {d.specialty}</option>)}
                        </Select>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <section id="login-password" role={demoMode ? 'tabpanel' : undefined} aria-labelledby={demoMode ? 'login-tab-password' : undefined}><StaffLogin /></section>
          )}
        </div>
        {demoMode && <p className="mt-4 text-[0.8125rem] text-slate-600">{t('login.demoFooter')}</p>}
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
    <form onSubmit={submit} noValidate aria-label={t('login.staffTitle')}>
      <div className="space-y-4">
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
        <Button type="submit" variant="primary" className="min-h-12 w-full text-base" loading={busy}>{t('login.enter')}</Button>
        <p className="text-[0.8125rem] text-slate-600">{t('login.staffHint')} {t('login.forgot')}</p>
      </div>
    </form>
  );
}
