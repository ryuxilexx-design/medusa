'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, Banknote, Boxes, CalendarDays, FlaskConical, Gauge, KeyRound, ListOrdered, Loader2, LogOut, Menu, ScanLine, Search, Settings,
  Stethoscope, Users, UsersRound, Wallet,
} from 'lucide-react';
import { ROLE_LABEL, type Role } from '@meduza/contracts';
import { SessionProvider, useLogout, useMeQuery, useSession } from '@/lib/session';
import { fmtTime, localDate, longDate } from '@/lib/format';
import { cx, Modal, Select } from '@/components/ui';
import { PasswordForm } from '@/components/password-form';
import { confirmLeave, NavigationGuard } from '@/lib/unsaved';
import { BrandLockup } from '@/components/logo';

type Item = { href: string; label: string; icon: React.ElementType; roles: Role[] };
// Menu order follows the TZ; each role only sees what it can use. The server enforces the same rules.
const MENU: Item[] = [
  { href: '/dashboard', label: 'Umumiy ko‘rinish', icon: Gauge, roles: ['manager'] },
  { href: '/patients', label: 'Bemorlar', icon: Users, roles: ['manager', 'registrar', 'doctor', 'cashier'] },
  { href: '/schedule', label: 'Qabul jadvali', icon: CalendarDays, roles: ['manager', 'registrar', 'doctor'] },
  { href: '/queue', label: 'Navbat', icon: ListOrdered, roles: ['manager', 'registrar', 'doctor', 'cashier'] },
  { href: '/doctor', label: 'Shifokor kabineti', icon: Stethoscope, roles: ['doctor'] },
  { href: '/lab', label: 'Laboratoriya', icon: FlaskConical, roles: ['lab', 'manager', 'registrar'] },
  { href: '/diagnostics', label: 'Diagnostika (UZI)', icon: ScanLine, roles: ['doctor'] },
  { href: '/cashier', label: 'Kassa', icon: Wallet, roles: ['cashier', 'manager', 'registrar'] },
  { href: '/finance', label: 'Moliya', icon: Banknote, roles: ['manager', 'cashier'] },
  { href: '/staff', label: 'Xodimlar', icon: UsersRound, roles: ['manager'] },
  { href: '/inventory', label: 'Ombor', icon: Boxes, roles: ['manager'] },
  { href: '/reports', label: 'Hisobotlar', icon: BarChart3, roles: ['manager', 'doctor'] },
  { href: '/settings', label: 'Sozlamalar', icon: Settings, roles: ['manager'] },
];
const LABEL_OVERRIDE: Partial<Record<Role, Record<string, string>>> = {
  cashier: { '/finance': 'Mening to‘lovlarim' },
  doctor: { '/reports': 'Mening faoliyatim', '/schedule': 'Mening jadvalim', '/patients': 'Mening bemorlarim' },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMeQuery();
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
  if (!me.data) return <div className="flex h-screen items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Yuklanmoqda…</div>;
  if (me.data.must_change_password) return <ForcedPasswordChange name={me.data.name} />;
  return <SessionProvider me={me.data}><Shell>{children}</Shell></SessionProvider>;
}

/** First sign-in with a temporary password: nothing else opens until the person sets their own password. */
function ForcedPasswordChange({ name }: { name: string }) {
  const qc = useQueryClient();
  const logout = useLogout();
  return (
    <main className="flex min-h-screen items-start justify-center bg-gradient-to-b from-white to-slate-100 px-4 pt-[10vh]">
      <div className="w-full max-w-md">
        <BrandLockup size="lg" />
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Yangi parol o‘rnating</h1>
          <p className="mt-1 text-sm text-slate-600">{name}, siz vaqtinchalik parol bilan kirdingiz. Davom etish uchun faqat o‘zingiz biladigan parol o‘rnating.</p>
          <PasswordForm className="mt-5" submitLabel="Parolni saqlash va davom etish" onDone={() => qc.invalidateQueries({ queryKey: ['me'] })} />
          <button onClick={logout} className="mt-4 text-[13px] text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">Chiqish</button>
        </div>
      </div>
    </main>
  );
}

/** Shows the server's demo clock (same source as appointments, payments and audit), ticking locally. */
function DemoClock() {
  const { demoNow } = useSession();
  const [t, setT] = useState(() => demoNow());
  useEffect(() => { const i = setInterval(() => setT(demoNow()), 15_000); return () => clearInterval(i); }, [demoNow]);
  return <span className="text-2xs text-slate-500" title="Demo vaqti: demo sanasi va soati. Faqat «Demo ma’lumotlarini tiklash» uni boshlang‘ich nuqtaga qaytaradi.">Demo vaqti · {longDate(localDate(t))}, {fmtTime(t)}</span>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { me, branchId, setBranchId } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const [q, setQ] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const items = MENU.filter((m) => m.roles.includes(me.role));
  const canSearch = ['manager', 'registrar', 'doctor', 'cashier'].includes(me.role);
  useEffect(() => setNavOpen(false), [pathname]);

  return (
    <div className="min-h-screen lg:pl-56">
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-slate-200 bg-white transition-transform print:hidden lg:translate-x-0', navOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full')}>
        <Link href="/" className="flex h-14 items-center border-b border-slate-100 px-4" aria-label="Med.uz.ai — bosh sahifa"><BrandLockup /></Link>
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Asosiy menyu">
          {items.map((it) => {
            const active = pathname === it.href || pathname.startsWith(it.href + '/');
            const Icon = it.icon;
            return (
              <Link key={it.href} href={it.href} aria-current={active ? 'page' : undefined}
                className={cx('mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500', active ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
                <Icon className={cx('h-4 w-4', active ? 'text-brand-600' : 'text-slate-400')} />{LABEL_OVERRIDE[me.role]?.[it.href] ?? it.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-100 p-3 text-2xs text-slate-400">Med.uz.ai · demo reliz 0.1</div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setNavOpen(false)} />}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur print:hidden">
        <button className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Menyuni ochish"><Menu className="h-5 w-5" /></button>
        <div className="hidden min-w-0 flex-col leading-tight md:flex">
          <span className="truncate text-sm font-semibold text-slate-800">{me.clinic_name}</span>
          <DemoClock />
        </div>
        {me.branches.length > 1 ? (
          <Select aria-label="Filial" className="h-8 w-auto max-w-[180px] text-[13px]" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Barcha filiallar</option>
            {me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        ) : <span className="rounded-md bg-slate-100 px-2 py-1 text-[13px] text-slate-700">{me.branches[0]?.name}</span>}
        {canSearch && (
          <form className="relative ml-1 hidden max-w-xs flex-1 sm:block" role="search" onSubmit={(e) => { e.preventDefault(); router.push(`/patients?search=${encodeURIComponent(q.trim())}`); }}>
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bemor: ism, telefon yoki ID" aria-label="Bemor qidirish"
              className="h-8 w-full rounded-md border border-slate-300 bg-slate-50 pl-8 pr-2 text-[13px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </form>
        )}
        <div className="ml-auto flex items-center gap-3">
          {me.demo && <span className="hidden rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-2xs font-semibold text-amber-800 xl:inline">Demo muhit · Sun’iy ma’lumotlar</span>}
          <div className="text-right leading-tight">
            <div className="text-[13px] font-medium text-slate-800">{me.name}</div>
            <div className="text-2xs text-slate-500">{ROLE_LABEL[me.role]}{me.doctor_specialty ? ` · ${me.doctor_specialty}` : ''}</div>
          </div>
          {me.auth_kind === 'password' && (
            <button onClick={() => setPwOpen(true)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" title="Parolni o‘zgartirish" aria-label="Parolni o‘zgartirish">
              <KeyRound className="h-4 w-4" />
            </button>
          )}
          <button onClick={() => confirmLeave(logout)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" title={me.auth_kind === 'demo' ? 'Chiqish / rolni almashtirish' : 'Chiqish'} aria-label="Chiqish">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1500px] px-4 py-4 lg:px-5">
        {me.demo && <span className="mb-2 inline-block rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-2xs font-semibold text-amber-800 xl:hidden print:hidden">Demo muhit · Sun’iy ma’lumotlar</span>}
        {children}
      </div>
      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="Parolni o‘zgartirish">
        <PasswordForm submitLabel="Saqlash" onDone={() => setPwOpen(false)} />
      </Modal>
      <NavigationGuard />
    </div>
  );
}

