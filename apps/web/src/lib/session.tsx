'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { translate, type Locale, type Role, type TextSize } from '@meduza/contracts';
import { api } from './api';
import { formatLocale } from './format';

export interface Me {
  membership_id: string; name: string; title: string | null; role: Role; tenant_id: string; clinic_name: string;
  doctor_id: string | null; doctor_specialty: string | null; branches: { id: string; name: string; code: string }[];
  today: string; now: string; demo: boolean; ai_mode: 'off' | 'sample' | 'live'; ai_off_reason: string | null;
  /** Interface language and text size saved for this person (staff account) or this session (demo card). */
  locale: Locale; text_size: TextSize;
  /** 'demo' = role card, 'password' = real staff account */
  auth_kind: 'demo' | 'password'; must_change_password: boolean;
  /** browser Date.now() when `now` was received — used to keep the demo clock offset exact even from cache */
  fetched_at: number;
}

interface SessionCtx { me: Me; branchId: string; setBranchId: (id: string) => void; branchName: string; demoNow: () => Date }
const Ctx = createContext<SessionCtx | null>(null);

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside provider');
  return c;
}

export function useMeQuery() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<{ data: Me }>('/me').then((r) => ({ ...r.data, fetched_at: Date.now() })), retry: false, staleTime: 60_000 });
}

const BRANCH_KEY = 'meduza.branch';
export function SessionProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  const [branchId, setBranchState] = useState<string>('');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`${BRANCH_KEY}.${me.membership_id}`) ?? '';
      if (saved === '' || me.branches.some((b) => b.id === saved)) setBranchState(saved);
    } catch { /* storage unavailable */ }
  }, [me.membership_id, me.branches]);
  const qc = useQueryClient();
  // The server runs a demo clock (DEMO_DATE + time of day); mirror it so waiting times and "now" lines match server data.
  const offset = useMemo(() => Date.parse(me.now) - me.fetched_at, [me.now, me.fetched_at]);
  const value = useMemo<SessionCtx>(() => ({
    me,
    demoNow: () => new Date(Date.now() + offset),
    branchId: me.branches.length === 1 ? me.branches[0].id : branchId,
    branchName: me.branches.length === 1 ? me.branches[0].name : me.branches.find((b) => b.id === branchId)?.name ?? translate(formatLocale(), 'shell.allBranches'),
    setBranchId: (id: string) => {
      setBranchState(id);
      try { localStorage.setItem(`${BRANCH_KEY}.${me.membership_id}`, id); } catch { /* ignore */ }
      // Branch change: drop every cached list so values from the old branch never mix in.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
  }), [me, branchId, qc, offset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return async () => {
    await api('/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };
}

export const HOME_BY_ROLE: Record<Role, string> = { manager: '/dashboard', registrar: '/schedule', doctor: '/doctor', cashier: '/cashier', lab: '/lab' };
