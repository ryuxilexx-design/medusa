'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, Banknote, Boxes, CalendarDays, Cctv, ChevronDown, FlaskConical, Gauge, KeyRound, ListOrdered, Loader2, LogOut, Menu, Newspaper, ScanLine, Search, Settings,
  Stethoscope, Users, UsersRound, Wallet, X,
} from 'lucide-react';
import type { MessageKey, Role } from '@meduza/contracts';
import { meReconnecting, SessionProvider, useLogout, useMeQuery, useSession } from '@/lib/session';
import { fmtTime, localDate, longDate } from '@/lib/format';
import { useI18n, useT } from '@/lib/i18n';
import { Button, cx, Modal, Select, SlidingPill } from '@/components/ui';
import { PasswordForm } from '@/components/password-form';
import { LanguagePicker, LanguageSwitch } from '@/components/prefs';
import { confirmLeave, hasUnsaved, NavigationGuard } from '@/lib/unsaved';
import { canOpen, SECTION_ROLES, type Section } from '@/lib/routes';
import { handPatientSearch } from '@/lib/patient-search';
import { NoAccess } from '@/components/no-access';
import { BrandLockup } from '@/components/logo';

type Item = { href: Section; label: MessageKey; icon: React.ElementType; roles: readonly Role[]; group: 'work' | 'manage' };
const entry = (href: Section, label: MessageKey, icon: React.ElementType, group: Item['group']): Item => ({ href, label, icon, roles: SECTION_ROLES[href], group });
// Menu order follows the TZ; each role only sees what it can use (role lists in lib/routes.ts, also the route guard).
// The server enforces the same rules. Daily work first, management below (two labelled groups when a role has many sections).
const MENU: Item[] = [
  entry('/dashboard', 'nav.dashboard', Gauge, 'work'),
  entry('/patients', 'nav.patients', Users, 'work'),
  entry('/schedule', 'nav.schedule', CalendarDays, 'work'),
  entry('/queue', 'nav.queue', ListOrdered, 'work'),
  entry('/doctor', 'nav.doctor', Stethoscope, 'work'),
  entry('/lab', 'nav.lab', FlaskConical, 'work'),
  entry('/diagnostics', 'nav.diagnostics', ScanLine, 'work'),
  entry('/news', 'nav.news', Newspaper, 'work'),
  entry('/cashier', 'nav.cashier', Wallet, 'work'),
  entry('/finance', 'nav.finance', Banknote, 'manage'),
  entry('/staff', 'nav.staff', UsersRound, 'manage'),
  entry('/inventory', 'nav.inventory', Boxes, 'manage'),
  entry('/cameras', 'nav.cameras', Cctv, 'manage'),
  entry('/reports', 'nav.reports', BarChart3, 'manage'),
  entry('/settings', 'nav.settings', Settings, 'manage'),
];
const LABEL_OVERRIDE: Partial<Record<Role, Record<string, MessageKey>>> = {
  cashier: { '/finance': 'nav.myPayments' },
  doctor: { '/reports': 'nav.myActivity', '/schedule': 'nav.mySchedule', '/patients': 'nav.myPatients' },
};
// the phone tab bar has room for one short word under each icon («Umumiy ko‘rinish» does not fit)
const TAB_SHORT: Partial<Record<MessageKey, MessageKey>> = {
  'nav.dashboard': 'nav.tab.dashboard', 'nav.schedule': 'nav.tab.schedule', 'nav.doctor': 'nav.tab.doctor',
  'nav.myPatients': 'nav.tab.myPatients', 'nav.mySchedule': 'nav.tab.mySchedule', 'nav.myPayments': 'nav.tab.myPayments',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMeQuery();
  const { sync, t } = useI18n();
  // Only a real 401 (the session is gone) leads to the sign-in page. With unsaved input on screen the person first
  // gets the chance to copy it: saving cannot work any more, but the text must not vanish without a word.
  // 'ask' = dialog open; 'stay' = the person chose to copy their text first (a banner keeps the way to sign in)
  const [sessionLost, setSessionLost] = useState<'no' | 'ask' | 'stay'>('no');
  const toLogin = useCallback(() => { setSessionLost('no'); qc.clear(); router.replace('/login'); }, [qc, router]);
  useEffect(() => {
    const onUnauth = () => { if (hasUnsaved()) setSessionLost((s) => (s === 'no' ? 'ask' : s)); else toLogin(); };
    window.addEventListener('meduza:unauthorized', onUnauth);
    return () => window.removeEventListener('meduza:unauthorized', onUnauth);
  }, [toLogin]);
  useEffect(() => {
    const onChange = () => qc.invalidateQueries({ queryKey: ['me'] });
    window.addEventListener('meduza:password-change', onChange);
    return () => window.removeEventListener('meduza:password-change', onChange);
  }, [qc]);
  // A failed first load with a final answer (4xx) means there is no usable session. A failed background refetch never
  // signs out: network errors and 5xx keep the cached session and retry (see useMeQuery), with a banner meanwhile.
  const noSession = me.isError && !me.data;
  useEffect(() => { if (noSession) router.replace('/login'); }, [noSession, router]);
  const reconnecting = meReconnecting(me);
  // the person's saved language wins over whatever the browser had
  useEffect(() => { if (me.data) sync(me.data.locale); }, [me.data?.locale, sync]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me.data) return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 px-4 text-center text-base text-slate-600"><title>Med.uz.ai</title>
      <span className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> {t('common.loading')}</span>
      {reconnecting && <span role="status" className="text-sm text-amber-900">{t('net.reconnectingShort')}</span>}
    </div>
  );
  if (me.data.must_change_password) return <ForcedPasswordChange name={me.data.name} />;
  return (
    <SessionProvider me={me.data}>
      <Shell reconnecting={reconnecting} sessionEnded={sessionLost === 'stay' ? toLogin : undefined}>{children}</Shell>
      <Modal open={sessionLost === 'ask'} onClose={() => setSessionLost('stay')} title={t('session.lostTitle')}
        footer={<><Button onClick={() => setSessionLost('stay')}>{t('session.lostStay')}</Button><Button variant="primary" data-autofocus onClick={toLogin}>{t('session.lostGo')}</Button></>}>
        <p className="text-base text-slate-800">{t('session.lostText')}</p>
      </Modal>
    </SessionProvider>
  );
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

/** Today's date and time from the server clock (the demo clock in a demo), ticking locally. */
function Clock() {
  const { demoNow } = useSession();
  const [now, setNow] = useState(() => demoNow());
  useEffect(() => { const i = setInterval(() => setNow(demoNow()), 15_000); return () => clearInterval(i); }, [demoNow]);
  return <span className="truncate text-[0.8125rem] text-slate-600">{longDate(localDate(now))}, {fmtTime(now)}</span>;
}

/** Clinic name, date/time and — only in a demo — one «Demo» mark (the single place it is shown inside the app). */
function ClinicInfo({ className }: { className?: string }) {
  const { me } = useSession();
  const t = useT();
  return (
    <div className={cx('min-w-0 flex-col leading-tight', className)}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[0.9375rem] font-bold text-slate-900" title={me.clinic_name}>{me.clinic_name}</span>
        {me.demo && <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-px text-2xs font-semibold text-amber-900" title={t('shell.demoClockTitle')}>{t('shell.demoMark')}</span>}
      </span>
      <Clock />
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

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** The person's menu in the top bar: who is signed in, interface language, password, sign out. */
function UserMenu({ onPassword }: { onPassword: () => void }) {
  const { me } = useSession();
  const t = useT();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const role = `${t(`role.${me.role}` as MessageKey)}${me.doctor_specialty ? `, ${me.doctor_specialty}` : ''}`;
  const item = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[0.9375rem] font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300';
  return (
    <div ref={box} className="relative">
      <button ref={btn} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" data-testid="user-menu"
        className="flex min-h-11 items-center gap-2.5 rounded-full py-1 pl-1 pr-2 hover:bg-white/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{initials(me.name)}</span>
        {/* the name only from 2xl: at 1366 px the patient search needs the room (the name is in the menu anyway) */}
        <span className="hidden max-w-[12rem] text-left leading-tight 2xl:block">
          <span className="block truncate text-sm font-semibold text-slate-900">{me.name}</span>
          <span className="block truncate text-[0.8125rem] text-slate-600">{role}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        {/* the name stays readable (screen readers, narrow screens) even while the visible label is hidden */}
        <span className="sr-only 2xl:hidden">{me.name}, {role}. </span><span className="sr-only">{t('shell.userMenu')}</span>
      </button>
      {/* kept in the DOM while closed (hidden) */}
      <div hidden={!open} className="surface absolute right-0 top-full z-30 mt-3 w-72 p-2 !shadow-[0_24px_48px_-16px_rgba(10,30,70,0.4)]">
        <div className="border-b border-slate-100 px-3 pb-3 pt-1.5 leading-tight">
          <div className="text-[0.9375rem] font-bold text-slate-900">{me.name}</div>
          <div className="mt-0.5 text-[0.8125rem] text-slate-600">{role}</div>
        </div>
        <div className="pt-1.5">
          {me.auth_kind === 'password' && <button className={item} onClick={() => { setOpen(false); onPassword(); }}><KeyRound className="h-5 w-5 text-slate-600" />{t('password.change')}</button>}
          <button className={item} onClick={() => confirmLeave(logout)}><LogOut className="h-5 w-5 text-slate-600" />{me.auth_kind === 'demo' ? t('shell.logoutDemo') : t('shell.logout')}</button>
        </div>
      </div>
    </div>
  );
}

function Shell({ children, reconnecting, sessionEnded }: { children: React.ReactNode; reconnecting: boolean; sessionEnded?: () => void }) {
  const { me, branchId, setBranchId } = useSession();
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const items = MENU.filter((m) => m.roles.includes(me.role));
  const allowed = canOpen(me.role, pathname);
  // group headings only help when the list is long; a short menu stays one plain list
  const groups: { key: 'work' | 'manage'; items: Item[] }[] = items.length >= 7
    ? [{ key: 'work', items: items.filter((i) => i.group === 'work') }, { key: 'manage', items: items.filter((i) => i.group === 'manage') }]
    : [{ key: 'work', items }];
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
  // a short screen (1366×768) cannot show all 15 sections: a fade at the bottom says the list goes on
  const navEl = useRef<HTMLElement>(null);
  const tabbar = useRef<HTMLElement>(null);
  const [navMore, setNavMore] = useState(false);
  useEffect(() => {
    const el = navEl.current; if (!el) return;
    const measure = () => setNavMore(el.scrollHeight - el.clientHeight - el.scrollTop > 4);
    measure(); el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => { el.removeEventListener('scroll', measure); ro.disconnect(); };
  }, [items.length]);
  const search = (cls: string) => (
    <form className={cls} role="search" onSubmit={(e) => {
      e.preventDefault();
      // the text is handed over in memory, never in the URL (a patient's name must not land in history or logs)
      const term = q.trim();
      confirmLeave(() => { handPatientSearch(term); if (pathname !== '/patients') router.push('/patients'); });
    }}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('shell.search')} aria-label={t('shell.searchLabel')}
        className="glass-field h-11 w-full rounded-full border-0 pl-10 pr-4 text-[0.9375rem] text-slate-900 placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-amber-300" />
    </form>
  );

  return (
    <div className="min-h-screen pb-28 lg:pb-0 lg:pl-[18.5rem]">
      <title>{pageTitle}</title>
      <a href="#main" className="sr-only z-[70] rounded-lg bg-white px-4 py-3 font-semibold text-brand-800 shadow-lg focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:outline-none focus:ring-4 focus:ring-amber-300">{t('shell.skipToContent')}</a>
      {/* Liquid Glass: the menu is a floating glass panel, detached from the edges; a drawer below lg */}
      <aside id="app-menu" ref={drawer} inert={!desktop && !navOpen} className={cx('glass drawer fixed bottom-4 left-4 top-4 z-40 flex w-[16.5rem] flex-col print:hidden lg:translate-x-0', navOpen ? 'translate-x-0' : '-translate-x-[calc(100%+1.5rem)]')}>
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 pl-5 pr-2">
          <Link href="/" className="rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300" aria-label={t('nav.home')}><BrandLockup /></Link>
          <Button variant="ghost" className="!px-2.5 text-slate-700 lg:hidden" onClick={closeNav} aria-label={t('nav.close')}><X className="h-6 w-6" /></Button>
        </div>
        {/* below xl the clinic and date leave the top bar and are shown here */}
        <ClinicInfo className="flex px-5 pb-3 xl:hidden" />
        {/* phone: the language is at the top of the menu (the top bar has no room for it) */}
        <div className="px-5 pb-2.5 md:hidden"><LanguagePicker signedIn className="w-full [&>select]:flex-1" /></div>
        {canSearch && search('relative mx-3 mt-3 sm:hidden')}
        <nav ref={navEl} className="flex-1 overflow-y-auto px-3 py-3" aria-label={t('nav.menu')}>
          {groups.map((g, gi) => (
            <div key={g.key} className={gi ? 'mt-4' : ''}>
              {groups.length > 1 && <div className="px-4 pb-1.5 text-[0.75rem] font-bold uppercase tracking-wider text-slate-600">{t(`nav.group.${g.key}` as MessageKey)}</div>}
              {g.items.map((it) => {
                const active = pathname === it.href || pathname.startsWith(it.href + '/');
                const Icon = it.icon;
                return (
                  <Link key={it.href} href={it.href} aria-current={active ? 'page' : undefined}
                    className={cx('press mb-1 flex min-h-12 items-center gap-3 rounded-full px-4 text-[1rem] font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 [@media(max-height:820px)]:mb-0.5 [@media(max-height:820px)]:min-h-11',
                      active ? 'glass-on text-brand-800' : 'text-slate-900 hover:bg-white/45')}>
                    <Icon className={cx('h-[1.375rem] w-[1.375rem] shrink-0', active ? 'text-brand-700' : 'text-slate-700')} />{t(LABEL_OVERRIDE[me.role]?.[it.href] ?? it.label)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="relative px-5 py-3 text-2xs text-slate-700">
          {navMore && <div aria-hidden="true" className="pointer-events-none !absolute inset-x-0 bottom-full h-12 bg-gradient-to-t from-white/80 to-transparent" />}
          {t(me.demo ? 'shell.release' : 'shell.releaseProd')}
        </div>
      </aside>
      {/* above the tab bar (z-30), so the drawer's backdrop also covers «Menyu» */}
      {navOpen && <div className="fixed inset-0 z-[35] bg-slate-900/30 backdrop-blur-sm lg:hidden" onClick={closeNav} />}

      {/* the toolbar: a floating glass capsule; the content scrolls under it */}
      <header className="glass glass-pill sticky top-3 z-20 mx-3 flex min-h-[3.75rem] items-center gap-2.5 px-3 py-1.5 print:hidden sm:mx-4 lg:top-4 lg:mx-8 lg:gap-3 lg:px-4">
        <Button ref={burger} variant="ghost" className="-ml-1 !px-2.5 text-slate-700 lg:hidden" onClick={() => setNavOpen(true)} aria-label={t('nav.open')} aria-expanded={navOpen} aria-controls="app-menu"><Menu className="h-6 w-6" /></Button>
        <ClinicInfo className="hidden max-w-[14rem] shrink xl:flex" />
        {me.branches.length > 1 ? (
          <Select aria-label={t('shell.branch')} className="glass-field min-w-0 flex-1 !rounded-full !border-0 !bg-transparent pr-7 text-sm font-semibold sm:w-auto sm:max-w-[12.5rem] sm:flex-none sm:text-[0.9375rem]" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{t('shell.allBranches')}</option>
            {me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        ) : <span className="glass-field min-w-0 truncate rounded-full px-4 py-2.5 text-[0.9375rem] font-semibold text-slate-900">{me.branches[0]?.name}</span>}
        {canSearch && search('relative hidden min-w-[5rem] max-w-[18rem] flex-1 sm:block')}
        {/* the language is one click away, in plain sight (not inside the person's menu) */}
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2"><LanguageSwitch signedIn /><UserMenu onPassword={() => setPwOpen(true)} /></div>
      </header>
      {sessionEnded ? (
        <div role="alert" className="sticky top-20 z-10 mx-4 flex rounded-2xl lg:mx-8 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-900 print:hidden">
          {t('session.lostTitle')}
          <Button size="sm" onClick={sessionEnded}>{t('session.lostGo')}</Button>
        </div>
      ) : reconnecting && (
        <div role="status" className="sticky top-20 z-10 mx-4 flex items-center rounded-2xl lg:mx-8 justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 print:hidden">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />{t('net.reconnecting')}
        </div>
      )}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] px-4 py-6 focus:outline-none lg:px-8">{allowed ? children : <NoAccess role={me.role} />}</main>
      {/* phone and tablet: a floating capsule tab bar with the first sections; «Menyu» opens the full list */}
      <nav ref={tabbar} aria-label={t('nav.menu')} className="glass glass-pill fixed bottom-3 left-1/2 z-30 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-0.5 p-1.5 print:hidden lg:hidden">
        <SlidingPill container={tabbar} active={pathname} className="glass-on rounded-full" />
        {items.slice(0, 4).map((it, i) => {
          const active = pathname === it.href || pathname.startsWith(it.href + '/');
          const Icon = it.icon;
          return (
            <Link key={it.href} href={it.href} aria-current={active ? 'page' : undefined} data-active={active}
              className={cx('press relative z-[1] min-h-12 min-w-[4rem] flex-col items-center justify-center gap-0.5 rounded-full px-3 text-[0.6875rem] font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 sm:min-w-0 sm:flex-row sm:gap-2 sm:px-4 sm:text-[0.9375rem] sm:font-semibold', i === 3 ? 'hidden sm:flex' : 'flex', active ? 'text-brand-800' : 'text-slate-900')}>
              <Icon className="h-5 w-5 shrink-0" /><span className="max-w-[5.5rem] truncate sm:max-w-none">{t(TAB_SHORT[LABEL_OVERRIDE[me.role]?.[it.href] ?? it.label] ?? LABEL_OVERRIDE[me.role]?.[it.href] ?? it.label)}</span>
            </Link>
          );
        })}
        <button type="button" onClick={() => setNavOpen(true)} aria-expanded={navOpen} aria-controls="app-menu"
          className="press relative z-[1] flex min-h-12 min-w-[4rem] flex-col items-center justify-center gap-0.5 rounded-full px-3 text-[0.6875rem] font-bold text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 sm:min-w-0 sm:flex-row sm:gap-2 sm:px-4 sm:text-[0.9375rem] sm:font-semibold">
          <Menu className="h-5 w-5" /><span>{t('nav.more')}</span>
        </button>
      </nav>
      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title={t('password.change')}>
        <PasswordForm submitLabel={t('common.save')} onDone={() => setPwOpen(false)} />
      </Modal>
      <NavigationGuard />
    </div>
  );
}
