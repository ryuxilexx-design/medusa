'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, isLocale, isTextSize, LOCALE_TAG, translate, type Locale, type MessageKey, type Params, type TextSize } from '@meduza/contracts';
import { setFormatLocale } from './format';

/**
 * Interface language and text size. Signed in, they come from the server (/me) and changes are saved there
 * (staff account or this session). Before sign-in the choice lives in the `meduza_lang` cookie — a UI preference
 * only, copied into the session at login. Nothing clinical or financial is stored in the browser.
 */
type Ctx = {
  locale: Locale; textSize: TextSize;
  t: (key: MessageKey, params?: Params) => string;
  /** Change the language; `persist` saves it on the server (signed in). Rejects if the server refused. */
  setLocale: (l: Locale, persist?: (l: Locale) => Promise<unknown>) => Promise<void>;
  setTextSize: (s: TextSize, persist?: (s: TextSize) => Promise<unknown>) => Promise<void>;
  /** Adopt the server's values after /me loads. */
  sync: (l: unknown, s: unknown) => void;
};
const I18nCtx = createContext<Ctx | null>(null);

const COOKIE = 'meduza_lang';
function writeCookie(l: Locale) {
  document.cookie = `${COOKIE}=${encodeURIComponent(l)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function I18nProvider({ children, initialLocale = DEFAULT_LOCALE }: { children: React.ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [textSize, setTextSizeState] = useState<TextSize>('normal');

  // keep <html lang> (screen readers, hyphenation) and the text-size switch on the root in step
  useEffect(() => {
    setFormatLocale(locale);
    document.documentElement.lang = LOCALE_TAG[locale];
  }, [locale]);
  useEffect(() => { document.documentElement.dataset.textSize = textSize; }, [textSize]);
  setFormatLocale(locale); // formatting helpers run during this render already

  const t = useCallback((key: MessageKey, params?: Params) => translate(locale, key, params), [locale]);
  const setLocale = useCallback(async (l: Locale, persist?: (l: Locale) => Promise<unknown>) => {
    const prev = locale;
    setLocaleState(l); writeCookie(l);
    if (persist) {
      try { await persist(l); } catch (e) { setLocaleState(prev); writeCookie(prev); throw e; }
    }
  }, [locale]);
  const setTextSize = useCallback(async (s: TextSize, persist?: (s: TextSize) => Promise<unknown>) => {
    const prev = textSize;
    setTextSizeState(s);
    if (persist) {
      try { await persist(s); } catch (e) { setTextSizeState(prev); throw e; }
    }
  }, [textSize]);
  const sync = useCallback((l: unknown, s: unknown) => {
    if (isLocale(l)) { setLocaleState(l); writeCookie(l); }
    if (isTextSize(s)) setTextSizeState(s);
  }, []);

  const value = useMemo(() => ({ locale, textSize, t, setLocale, setTextSize, sync }), [locale, textSize, t, setLocale, setTextSize, sync]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const c = useContext(I18nCtx);
  if (!c) throw new Error('useI18n outside I18nProvider');
  return c;
}
/** The translator for the current language: `t('note.title')`, `t('age.years', { n: 52 })`. */
export function useT() { return useI18n().t; }
