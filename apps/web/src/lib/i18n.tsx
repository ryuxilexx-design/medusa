'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, isLocale, LOCALE_TAG, translate, type Locale, type MessageKey, type Params } from '@meduza/contracts';
import { setFormatLocale } from './format';

/**
 * Interface language. Signed in, they come from the server (/me) and changes are saved there
 * (staff account or this session). Before sign-in the choice lives in the `meduza_lang` cookie — a UI preference
 * only, copied into the session at login. Nothing clinical or financial is stored in the browser.
 */
type Ctx = {
  locale: Locale;
  t: (key: MessageKey, params?: Params) => string;
  /** Change the language; `persist` saves it on the server (signed in). Rejects if the server refused. */
  setLocale: (l: Locale, persist?: (l: Locale) => Promise<unknown>) => Promise<void>;
  /** Adopt the server's value after /me loads. */
  sync: (l: unknown) => void;
};
const I18nCtx = createContext<Ctx | null>(null);

const COOKIE = 'meduza_lang';
function writeCookie(l: Locale) {
  document.cookie = `${COOKIE}=${encodeURIComponent(l)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function I18nProvider({ children, initialLocale = DEFAULT_LOCALE }: { children: React.ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // keep <html lang> (screen readers, hyphenation) in step
  useEffect(() => {
    setFormatLocale(locale);
    document.documentElement.lang = LOCALE_TAG[locale];
  }, [locale]);
  setFormatLocale(locale); // formatting helpers run during this render already

  const t = useCallback((key: MessageKey, params?: Params) => translate(locale, key, params), [locale]);
  const setLocale = useCallback(async (l: Locale, persist?: (l: Locale) => Promise<unknown>) => {
    const prev = locale;
    setLocaleState(l); writeCookie(l);
    if (persist) {
      try { await persist(l); } catch (e) { setLocaleState(prev); writeCookie(prev); throw e; }
    }
  }, [locale]);
  const sync = useCallback((l: unknown) => {
    if (isLocale(l)) { setLocaleState(l); writeCookie(l); }
  }, []);

  const value = useMemo(() => ({ locale, t, setLocale, sync }), [locale, t, setLocale, sync]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const c = useContext(I18nCtx);
  if (!c) throw new Error('useI18n outside I18nProvider');
  return c;
}
/** The translator for the current language: `t('note.title')`, `t('age.years', { n: 52 })`. */
export function useT() { return useI18n().t; }
