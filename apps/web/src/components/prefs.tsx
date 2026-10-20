'use client';
import { useQueryClient } from '@tanstack/react-query';
import { Languages } from 'lucide-react';
import { LOCALES, type Locale } from '@meduza/contracts';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cx, useToast } from '@/components/ui';

/** Saves the interface language for the signed-in person and keeps the cached /me in step. */
function usePersist() {
  const qc = useQueryClient();
  return (body: { locale: Locale }) =>
    api('/me/preferences', { method: 'PUT', body }).then(() => qc.setQueryData(['me'], (m: any) => (m ? { ...m, ...body } : m)));
}

/** Interface language: Uzbek Latin, Uzbek Cyrillic, Russian. `signedIn` saves the choice to the account/session. */
export function LanguagePicker({ signedIn = false, className }: { signedIn?: boolean; className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const toast = useToast();
  const persist = usePersist();
  return (
    <label className={cx('inline-flex items-center gap-1.5 text-sm font-medium text-slate-800', className)}>
      <Languages className="h-5 w-5 text-slate-600" aria-hidden="true" />
      <span className="sr-only">{t('pref.language')}</span>
      <select value={locale} data-testid="language"
        onChange={(e) => setLocale(e.target.value as Locale, signedIn ? (l) => persist({ locale: l }) : undefined)
          .catch((err) => toast.error(new Error(t('pref.saveFailed', { msg: (err as Error).message }))))}
        className="h-10 rounded-lg border-2 border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-amber-300">
        {LOCALES.map((l) => <option key={l.id} value={l.id} lang={l.id === 'ru' ? 'ru' : l.id === 'uz-Cyrl' ? 'uz-Cyrl' : 'uz-Latn'}>{l.label}</option>)}
      </select>
    </label>
  );
}
