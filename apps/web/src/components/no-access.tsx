'use client';
import { ShieldAlert } from 'lucide-react';
import type { Role } from '@meduza/contracts';
import { HOME_BY_ROLE } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { LinkButton } from './ui';

/** One calm state for a page this role cannot use (direct URL, old bookmark): no page shell, no data, one way home. */
export function NoAccess({ role, className }: { role: Role; className?: string }) {
  const t = useT();
  return (
    <div className={className ?? 'mx-auto mt-10 max-w-lg surface'} data-testid="no-access">
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <ShieldAlert className="h-8 w-8 text-slate-400" aria-hidden="true" />
        <h1 className="text-lg font-bold text-slate-900">{t('state.notForRole')}</h1>
        <p className="text-[0.9375rem] text-slate-600">{t('state.notForRoleHint')}</p>
        <LinkButton variant="primary" href={HOME_BY_ROLE[role]}>{t('state.toHome')}</LinkButton>
      </div>
    </div>
  );
}
