import { latinToCyrillic } from './translit';

/** Interface languages. Uzbek Latin is the source text; Uzbek Cyrillic is derived from it; Russian is translated. */
export type Locale = 'uz' | 'uz-Cyrl' | 'ru';
export const DEFAULT_LOCALE: Locale = 'uz';
export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'uz', label: 'O‘zbekcha' },
  { id: 'uz-Cyrl', label: 'Ўзбекча' },
  { id: 'ru', label: 'Русский' },
];
export const isLocale = (x: unknown): x is Locale => x === 'uz' || x === 'uz-Cyrl' || x === 'ru';
/** BCP 47 tag for <html lang> and Intl. */
export const LOCALE_TAG: Record<Locale, string> = { uz: 'uz-Latn', 'uz-Cyrl': 'uz-Cyrl', ru: 'ru' };

export type TextSize = 'normal' | 'large';
export const isTextSize = (x: unknown): x is TextSize => x === 'normal' || x === 'large';

/** A Russian message that agrees with a number: {n} пациент / пациента / пациентов. */
export type Plural = { one: string; few: string; many: string };
export type Msg = string | Plural;
/**
 * One interface message: [Uzbek Latin, Russian] or [Uzbek Latin, Russian, Uzbek Cyrillic] when the automatic
 * Cyrillic would be wrong (a Russian loanword the rules cannot see). Uzbek needs no plural forms («5 ta bemor»).
 */
export type Entry = readonly [string, Msg] | readonly [string, Msg, string];
export type Catalog = Record<string, Entry>;

export type Params = Record<string, string | number | null | undefined>;

const ruPlural = new Intl.PluralRules('ru-RU');
function pick(m: Msg, params?: Params): string {
  if (typeof m === 'string') return m;
  // the number the sentence agrees with: {n}, else the first numeric placeholder (… через {min} минут)
  const numeric = params && Object.values(params).find((v) => typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)));
  const n = Number(params?.n ?? numeric ?? 0);
  const cat = ruPlural.select(n);
  return cat === 'one' ? m.one : cat === 'few' ? m.few : m.many;
}
const fill = (s: string, params?: Params) =>
  params ? s.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (all, k) => (params[k] == null ? all : String(params[k]))) : s;

/**
 * A translator over one catalog. Cyrillic strings are derived once per message and cached. Placeholders are
 * filled after conversion, so names and numbers inside them are never transliterated.
 */
export function createTranslator<C extends Catalog>(catalog: C) {
  const cyrl = new Map<string, string>();
  const cyrillicOf = (key: string, e: Entry) => {
    let s = cyrl.get(key);
    if (s === undefined) { s = e[2] ?? latinToCyrillic(e[0]); cyrl.set(key, s); }
    return s;
  };
  function t(locale: Locale, key: keyof C & string, params?: Params): string {
    const e = catalog[key];
    if (!e) return key;
    const s = locale === 'ru' ? pick(e[1], params) : locale === 'uz-Cyrl' ? cyrillicOf(key, e) : e[0];
    return fill(s, params);
  }
  return t;
}
