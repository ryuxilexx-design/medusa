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

const LANG_TAG: Record<Locale, string> = { uz: 'uz-Latn', 'uz-Cyrl': 'uz-Cyrl', ru: 'ru' };
/** Short names for the always-visible switch in the top bar (each in its own script, so everyone finds theirs). */
const SHORT: Record<Locale, string> = { uz: 'O‘z', 'uz-Cyrl': 'Ўз', ru: 'Ру' };

function useChangeLocale(signedIn: boolean) {
  const { setLocale, t } = useI18n();
  const toast = useToast();
  const persist = usePersist();
  return (l: Locale) => setLocale(l, signedIn ? (x) => persist({ locale: x }) : undefined)
    .catch((err) => toast.error(new Error(t('pref.saveFailed', { msg: (err as Error).message }))));
}

/**
 * Top-bar language switch: three one-click buttons (O‘z · Ўз · Ру) from tablet width up (on a phone the language is
 * at the top of the menu). The choice is saved to the person's account/session.
 */
export function LanguageSwitch({ signedIn = false }: { signedIn?: boolean }) {
  const { locale, t } = useI18n();
  const change = useChangeLocale(signedIn);
  return (
    <>
      <div role="group" aria-label={t('pref.language')} className="glass-field hidden h-11 shrink-0 items-center gap-0.5 rounded-full p-1 md:inline-flex">
        {LOCALES.map((l) => (
          <button key={l.id} type="button" lang={LANG_TAG[l.id]} aria-pressed={locale === l.id} aria-label={l.label} title={l.label}
            onClick={() => locale !== l.id && void change(l.id)}
            className={cx('h-full min-w-[2.75rem] rounded-full px-2.5 text-sm font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300',
              locale === l.id ? 'bg-white text-brand-800 shadow-[0_4px_10px_-4px_rgba(10,30,70,0.4)]' : 'text-slate-800 hover:bg-white/50')}>
            {SHORT[l.id]}
          </button>
        ))}
      </div>
    </>
  );
}

/** Interface language: Uzbek Latin, Uzbek Cyrillic, Russian. `signedIn` saves the choice to the account/session. */
export function LanguagePicker({ signedIn = false, className, compact = false }: { signedIn?: boolean; className?: string; compact?: boolean }) {
  const { locale, t } = useI18n();
  const change = useChangeLocale(signedIn);
  return (
    <label className={cx('inline-flex items-center gap-1.5 text-sm font-medium text-slate-800', className)}>
      {!compact && <Languages className="h-5 w-5 text-slate-600" aria-hidden="true" />}
      <span className="sr-only">{t('pref.language')}</span>
      <select value={locale} data-testid="language" onChange={(e) => void change(e.target.value as Locale)}
        className={cx('rounded-lg border-2 border-slate-300 bg-white text-sm font-semibold text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-amber-300', compact ? 'h-11 px-1.5' : 'h-10 px-2')}>
        {LOCALES.map((l) => <option key={l.id} value={l.id} lang={LANG_TAG[l.id]}>{compact ? SHORT[l.id] : l.label}</option>)}
      </select>
    </label>
  );
}
