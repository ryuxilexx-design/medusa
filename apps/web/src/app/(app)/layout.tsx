'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, Banknote, Boxes, CalendarDays, FlaskConical, Gauge, KeyRound, ListOrdered, Loader2, LogOut, Menu, ScanLine, Search, Settings,
  Stethoscope, Users, UsersRound, Wallet, X,
} from 'lucide-react';
import type { MessageKey, Role } from '@meduza/contracts';
import { SessionProvider, useLogout, useMeQuery, useSession } from '@/lib/session';
import { fmtTime, localDate, longDate } from '@/lib/format';
import { useI18n, useT } from '@/lib/i18n';
import { Button, cx, Modal, Select } from '@/components/ui';
import { PasswordForm } from '@/components/password-form';
import { LanguagePicker } from '@/components/prefs';
import { confirmLeave, NavigationGuard } from '@/lib/unsaved';
import { BrandLockup } from '@/components/logo';

type Item = { href: string; label: MessageKey; icon: React.ElementType; roles: Role[] };
// Menu order follows the TZ; each role only sees what it can use. The server enforces the same rules.
const MENU: Item[] = [
  { href: '/dashboard', label: 'nav.dashboard', icon: Gauge, roles: ['manager'] },
  { href: '/patients', label: 'nav.patients', icon: Users, roles: ['manager', 'registrar', 'doctor', 'cashier'] },
  { href: '/schedule', label: 'nav.schedule', icon: CalendarDays, roles: ['manager', 'registrar', 'doctor'] },
  { href: '/queue', label: 'nav.queue', icon: ListOrdered, roles: ['manager', 'registrar', 'doctor', 'cashier'] },
  { href: '/doctor', label: 'nav.doctor', icon: Stethoscope, roles: ['doctor'] },
  { href: '/lab', label: 'nav.lab', icon: FlaskConical, roles: ['lab', 'manager', 'registrar'] },
  { href: '/diagnostics', label: 'nav.diagnostics', icon: ScanLine, roles: ['doctor'] },
  { href: '/cashier', label: 'nav.cashier', icon: Wallet, roles: ['cashier', 'manager', 'registrar'] },
  { href: '/finance', label: 'nav.finance', icon: Banknote, roles: ['manager', 'cashier'] },
  { href: '/staff', label: 'nav.staff', icon: UsersRound, roles: ['manager'] },
  { href: '/inventory', label: 'nav.inventory', icon: Boxes, roles: ['manager'] },
  { href: '/reports', label: 'nav.reports', icon: BarChart3, roles: ['manager', 'doctor'] },
  { href: '/settings', label: 'nav.settings', icon: Settings, roles: ['manager'] },
];
const LABEL_OVERRIDE: Partial<Record<Role, Record<string, MessageKey>>> = {
  cashier: { '/finance': 'nav.myPayments' },
  doctor: { '/reports': 'nav.myActivity', '/schedule': 'nav.mySchedule', '/patients': 'nav.myPatients' },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMeQuery();
  const { sync, t } = useI18n();
  useEffect(() => {
    const onUnauth = () => { qc.clear(); router.replace('/login'); };
    window.addEventListener('meduza:unauthorized', onUnauth);
    return () => window.removeEventListener('meduza:unauthorized', onUnauth);
  }, [qc, router]);
  useEffect(() => {
    const onChange = () => qc.invalidateQueries({ queryKey: ['me'] });
    window.addEventListener('meduza:password-change', onChange);
    return () => window.removeEventListener('meduza:password-change', onChange);
  }, [qc]);
  useEffect(() => { if (me.isError) router.replace('/login'); }, [me.isError, router]);
  // the person's saved language wins over whatever the browser had
  useEffect(() => { if (me.data) sync(me.data.locale); }, [me.data?.locale, sync]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me.data) return <div className="flex h-screen items-center justify-center gap-2 text-base text-slate-600"><title>Med.uz.ai</title><Loader2 className="h-5 w-5 animate-spin" /> {t('common.loading')}</div>;
  if (me.data.must_change_password) return <ForcedPasswordChange name={me.data.name} />;
  return <SessionProvider me={me.data}><Shell>{children}</Shell></SessionProvider>;
}

/** First sign-in with a temporary password: nothing else opens until the person sets their own password. */
function ForcedPasswordChange({ name }: { name: string }) {
  const qc = useQueryClient();
  const logout = useLogout();
  const t = useT();
  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-100 px-4 pt-[8vh]">
      <title>{`${t('password.forcedTitle')} — Med.uz.ai`}</title>
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between gap-3"><BrandLockup size="lg" /><LanguagePicker signedIn /></div>
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
          <h1 className="text-xl font-bold text-slate-900">{t('password.forcedTitle')}</h1>
          <p className="mt-1 text-base text-slate-700">{t('password.forcedText', { name })}</p>
          <PasswordForm className="mt-5" submitLabel={t('password.forcedSubmit')} onDone={() => qc.invalidateQueries({ queryKey: ['me'] })} />
          <button onClick={logout} className="mt-4 text-sm font-semibold text-brand-700 underline-offset-2 hover:underline">{t('shell.logout')}</button>
        </div>
      </div>
    </main>
  );
}

/** Shows the server's demo clock (same source as appointments, payments and audit), ticking locally. */
function DemoClock() {
  const { demoNow, me } = useSession();
  const t = useT();
  const [now, setNow] = useState(() => demoNow());
  useEffect(() => { const i = setInterval(() => setNow(demoNow()), 15_000); return () => clearInterval(i); }, [demoNow]);
  // a real clinic (production) runs on real time: no «demo» wording there
  if (!me.demo) return <span className="text-[0.8125rem] text-slate-600">{longDate(localDate(now))}, {fmtTime(now)}</span>;
  // the explanation is read out too (a tooltip alone is invisible to keyboard and touch users)
  return <span className="text-[0.8125rem] text-slate-600" title={t('shell.demoClockTitle')}>{t('shell.demoClock', { date: longDate(localDate(now)), time: fmtTime(now) })}<span className="sr-only"> {t('shell.demoClockTitle')}</span></span>;
}

/** Clinic name + demo clock: in the header on wide screens, inside the menu below xl. */
function ClinicInfo({ className }: { className?: string }) {
  const { me } = useSession();
  return (
    <div className={cx('min-w-0 flex-col leading-tight', className)}>
      <span className="truncate text-[0.9375rem] font-bold text-slate-900">{me.clinic_name}</span>
      <DemoClock />
    </div>
  );
}

/** True from the lg breakpoint up (sidebar always visible); false on phones/tablets, where it is a drawer. */
function useDesktop() {
  const [desk, setDesk] = useState(true);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)');
    const on = () => setDesk(m.matches);
    on(); m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return desk;
}

/** «<page> — Med.uz.ai» for the browser tab, from the same labels as the menu. */
function usePageTitle(items: Item[], role: Role) {
  const pathname = usePathname();
  const t = useT();
  const it = items.find((m) => pathname === m.href || pathname.startsWith(m.href + '/'));
  return it ? `${t(LABEL_OVERRIDE[role]?.[it.href] ?? it.label)} — Med.uz.ai` : 'Med.uz.ai';
}

function Shell({ children }: { children: React.ReactNode }) {
  const { me, branchId, setBranchId } = useSession();
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const [q, setQ] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const items = MENU.filter((m) => m.roles.includes(me.role));
  const canSearch = ['manager', 'registrar', 'doctor', 'cashier'].includes(me.role);
  const desktop = useDesktop();
  const burger = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const pageTitle = usePageTitle(items, me.role);
  useEffect(() => setNavOpen(false), [pathname]);
  // drawer (below lg): focus moves into it, Esc closes it, focus returns to the menu button
  useEffect(() => {
    if (!navOpen) return;
    setTimeout(() => drawer.current?.querySelector<HTMLElement>('nav a')?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNav(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  function closeNav() { setNavOpen(false); burger.current?.focus(); }
  const search = (cls: string) => (
    <form className={cls} role="search" onSubmit={(e) => { e.preventDefault(); router.push(`/patients?search=${encodeURIComponent(q.trim())}`); }}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('shell.search')} aria-label={t('shell.searchLabel')}
        className="h-10 w-full rounded-lg border-2 border-slate-300 bg-slate-50 pl-10 pr-2 text-sm placeholder:text-slate-500 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-amber-300" />
    </form>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      <title>{pageTitle}</title>
      <aside id="app-menu" ref={drawer} inert={!desktop && !navOpen} className={cx('fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-slate-200 bg-white transition-transform print:hidden lg:translate-x-0', navOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full')}>
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-100 pl-4 pr-2">
          <Link href="/" className="rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" aria-label={t('nav.home')}><BrandLockup /></Link>
          <Button variant="ghost" className="px-2.5 text-slate-700 lg:hidden" onClick={closeNav} aria-label={t('nav.close')}><X className="h-6 w-6" /></Button>
        </div>
        {canSearch && search('relative mx-2.5 mt-3 sm:hidden')}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label={t('nav.menu')}>
          {items.map((it) => {
            const active = pathname === it.href || pathname.startsWith(it.href + '/');
            const Icon = it.icon;
            return (
              <Link key={it.href} href={it.href} aria-current={active ? 'page' : undefined}
                className={cx('mb-1 flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-[0.9375rem] font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300',
                  active ? 'bg-brand-50 text-brand-800 shadow-[inset_3px_0_0_#2d64bd]' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900')}>
                <Icon className={cx('h-5 w-5 shrink-0', active ? 'text-brand-600' : 'text-slate-500')} />{t(LABEL_OVERRIDE[me.role]?.[it.href] ?? it.label)}
              </Link>
            );
          })}
        </nav>
        {/* personal display settings stay in sight on every screen, without crowding the header */}
        <div className="space-y-2.5 border-t border-slate-100 p-3">
          <ClinicInfo className="flex xl:hidden" />
          {/* on a phone the header keeps only menu, branch and logout: who is signed in is shown here */}
          <div className="leading-tight sm:hidden"><div className="text-sm font-semibold text-slate-900">{me.name}</div><div className="text-[0.8125rem] text-slate-600">{t(`role.${me.role}` as MessageKey)}{me.doctor_specialty ? `, ${me.doctor_specialty}` : ''}</div></div>
          <LanguagePicker signedIn className="w-full [&>select]:flex-1" />
          <div className="text-2xs text-slate-600">{t(me.demo ? 'shell.release' : 'shell.releaseProd')}</div>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={closeNav} />}

      <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur print:hidden">
        <Button ref={burger} variant="ghost" className="px-2.5 text-slate-700 lg:hidden" onClick={() => setNavOpen(true)} aria-label={t('nav.open')} aria-expanded={navOpen} aria-controls="app-menu"><Menu className="h-6 w-6" /></Button>
        <ClinicInfo className="hidden xl:flex" />
        {me.branches.length > 1 ? (
          <Select aria-label={t('shell.branch')} className="h-10 w-auto min-w-0 max-w-[11rem] text-sm sm:max-w-[15rem]" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{t('shell.allBranches')}</option>
            {me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        ) : <span className="min-w-0 truncate rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm text-slate-800">{me.branches[0]?.name}</span>}
        {canSearch && search('relative ml-1 hidden min-w-[10rem] max-w-[16rem] flex-1 sm:block xl:max-w-[22rem]')}
        <div className="ml-auto flex items-center gap-2.5">
          {me.demo && <span className="hidden rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-2xs font-semibold text-amber-900 2xl:inline">{t('common.demoEnv')}</span>}
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-sm font-semibold text-slate-900">{me.name}</div>
            <div className="text-[0.8125rem] text-slate-600">{t(`role.${me.role}` as MessageKey)}{me.doctor_specialty ? `, ${me.doctor_specialty}` : ''}</div>
          </div>
          {me.auth_kind === 'password' && (
            <button onClick={() => setPwOpen(true)} className="rounded-lg p-2.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" title={t('password.change')} aria-label={t('password.change')}>
              <KeyRound className="h-5 w-5" />
            </button>
          )}
          <button onClick={() => confirmLeave(logout)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" title={me.auth_kind === 'demo' ? t('shell.logoutDemo') : t('shell.logout')}>
            <LogOut className="h-5 w-5" /><span className="hidden xl:inline">{t('shell.logout')}</span><span className="sr-only xl:hidden">{t('shell.logout')}</span>
          </button>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1600px] px-4 py-5 lg:px-6">
        {me.demo && <span className="mb-2 inline-block rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-2xs font-semibold text-amber-900 2xl:hidden print:hidden">{t('common.demoEnv')}</span>}
        {children}
      </div>
      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title={t('password.change')}>
        <PasswordForm submitLabel={t('common.save')} onDone={() => setPwOpen(false)} />
      </Modal>
      <NavigationGuard />
    </div>
  );
}
