'use client';
import { useQueryClient } from '@tanstack/react-query';
import { Languages } from 'lucide-react';
import { LOCALES, LOCALE_TAG, type Locale } from '@meduza/contracts';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cx, Segmented, Select, useToast } from '@/components/ui';

/** Saves the interface language for the signed-in person and keeps the cached /me in step. */
function usePersist() {
  const qc = useQueryClient();
  return (body: { locale: Locale }) =>
    api('/me/preferences', { method: 'PUT', body }).then(() => qc.setQueryData(['me'], (m: any) => (m ? { ...m, ...body } : m)));
}

/** Short names (each in its own script, so everyone finds theirs) for the narrow picker. */
const SHORT: Record<Locale, string> = { uz: 'O‘z', 'uz-Cyrl': 'Ўз', ru: 'Ру' };

function useChangeLocale(signedIn: boolean) {
  const { setLocale, t } = useI18n();
  const toast = useToast();
  const persist = usePersist();
  return (l: Locale) => setLocale(l, signedIn ? (x) => persist({ locale: x }) : undefined)
    .catch((err) => toast.error(new Error(t('pref.saveFailed', { msg: (err as Error).message }))));
}

/**
 * The language choice inside the person's menu (top bar → user menu, on every screen width): three segments with the
 * language names, each in its own script. The choice is saved to the person's account/session.
 */
export function LanguageSwitch({ signedIn = false, className }: { signedIn?: boolean; className?: string }) {
  const { locale, t } = useI18n();
  const change = useChangeLocale(signedIn);
  return (
    <Segmented label={t('pref.language')} value={locale} onChange={(l) => void change(l)} size="compact" stretch testId="language-switch" className={className}
      options={LOCALES.map((l) => ({ value: l.id, label: l.label, lang: LOCALE_TAG[l.id] }))} />
  );
}

/** Interface language before sign-in (login page, forced password change): a select. `signedIn` saves the choice. */
export function LanguagePicker({ signedIn = false, className, compact = false }: { signedIn?: boolean; className?: string; compact?: boolean }) {
  const { locale, t } = useI18n();
  const change = useChangeLocale(signedIn);
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm font-medium text-slate-800', className)}>
      {!compact && <Languages className="h-5 w-5 text-slate-600" aria-hidden="true" />}
      <span className="sr-only">{t('pref.language')}</span>
      <Select value={locale} data-testid="language" onChange={(e) => void change(e.target.value as Locale)} className={cx('w-auto font-semibold', compact ? 'px-2 pr-7' : 'pr-8')}>
        {LOCALES.map((l) => <option key={l.id} value={l.id} lang={LOCALE_TAG[l.id]}>{compact ? SHORT[l.id] : l.label}</option>)}
      </Select>
    </label>
  );
}
