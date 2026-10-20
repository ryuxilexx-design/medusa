/** Money is transported as integer tiyin (1 so'm = 100 tiyin). */
export const TIYIN_PER_SOM = 100;

/** The currency word in each interface language (numbers are always grouped the same way: 1 250 000). */
const SOM_WORD = { uz: 'so‘m', 'uz-Cyrl': 'сўм', ru: 'сум' } as const;

export function formatSom(tiyin: number | null | undefined, withCurrency = true, locale: keyof typeof SOM_WORD = 'uz'): string {
  if (tiyin == null || Number.isNaN(tiyin)) return '—';
  const som = tiyin / TIYIN_PER_SOM;
  const whole = Number.isInteger(som);
  const s = som.toLocaleString('ru-RU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).replace(/ /g, ' ');
  return withCurrency ? `${s} ${SOM_WORD[locale] ?? SOM_WORD.uz}` : s;
}

/** Parses a user-entered so'm amount ("150 000", "150000,50") into tiyin. Returns null when invalid. */
export function parseSomToTiyin(input: string | number): number | null {
  const s = String(input).replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return Number(w) * TIYIN_PER_SOM + Number((f + '00').slice(0, 2));
}

/** Normalizes Uzbek phone numbers to +998XXXXXXXXX. Returns null for invalid input. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (input == null) return null;
  const digits = String(input).replace(/[\s\-()+.]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 9) return '+998' + digits;
  if (digits.length === 12 && digits.startsWith('998')) return '+' + digits;
  return null;
}

export function formatPhone(p: string | null | undefined): string {
  if (!p) return '—';
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(p);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p;
}
