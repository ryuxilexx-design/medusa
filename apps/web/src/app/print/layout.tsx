'use client';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useMeQuery } from '@/lib/session';
import { canOpen } from '@/lib/routes';
import { useT } from '@/lib/i18n';
import { NoAccess } from '@/components/no-access';

/**
 * Printouts open in their own tab without the app shell. The role is known first, so a role that may not print this
 * document gets one clean state (and its data is never requested); without a session the page's own request shows the error.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  const me = useMeQuery();
  const pathname = usePathname();
  const t = useT();
  if (!me.data && !me.isError) return <div className="flex h-screen items-center justify-center text-slate-600" aria-busy="true" aria-label={t('common.loading')}><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (me.data && !canOpen(me.data.role, pathname)) return <main className="min-h-screen bg-slate-100 px-4 pt-10"><title>Med.uz.ai</title><NoAccess role={me.data.role} /></main>;
  return children;
}
