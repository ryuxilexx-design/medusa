'use client';
import { useQueryClient } from '@tanstack/react-query';
import { Languages } from 'lucide-react';
import { LOCALES, type Locale, type TextSize } from '@meduza/contracts';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cx, useToast } from '@/components/ui';

/** Saves a display setting for the signed-in person and keeps the cached /me in step. */
function usePersist() {
  const qc = useQueryClient();
  return (body: { locale?: Locale; text_size?: TextSize }) =>
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

/** «Matn: Oddiy | Katta» — larger type and spacing everywhere, saved for the person. */
export function TextSizeToggle({ className, showLabel = false }: { className?: string; showLabel?: boolean }) {
  const { textSize, setTextSize, t } = useI18n();
  const toast = useToast();
  const persist = usePersist();
  const choose = (s: TextSize) => setTextSize(s, (v) => persist({ text_size: v }))
    .catch((err) => toast.error(new Error(t('pref.saveFailed', { msg: (err as Error).message }))));
  return (
    <div role="group" aria-label={t('pref.textSize')} className={cx('inline-flex items-center gap-1 rounded-lg border-2 border-slate-300 bg-white p-0.5', className)}>
      {showLabel && <span className="px-1.5 text-sm text-slate-700">{t('pref.textSize')}:</span>}
      {(['normal', 'large'] as const).map((s) => (
        <button key={s} type="button" aria-pressed={textSize === s} onClick={() => textSize !== s && choose(s)}
          className={cx('h-8 rounded-md px-2.5 font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300',
            s === 'large' ? 'text-base' : 'text-sm', textSize === s ? 'bg-slate-800 text-white' : 'text-slate-800 hover:bg-slate-100')}>
          {t(s === 'large' ? 'pref.textLarge' : 'pref.textNormal')}
        </button>
      ))}
    </div>
  );
}
