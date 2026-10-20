/**
 * Uzbek Latin → Uzbek Cyrillic, by the official correspondence (o‘ → ў, g‘ → ғ, sh → ш, ch → ч, yo → ё, ’ → ъ …).
 * Used to derive the Cyrillic UI from the Latin source text, so the two Uzbek scripts can never drift apart.
 *
 * Left untouched: {placeholders}, URLs and e-mails, numbers and ICD-style codes (I10, K29.5, 09:40, 37,8),
 * and brand or technical names that are written in Latin in Cyrillic text too (Med.uz.ai, AI, Telegram links …).
 * Patient and staff data are never passed through this: only interface text is.
 */

const PROTECTED_WORDS = ['Med.uz.ai', 'Med.uz', 'AI', 'ID', 'PDF', 'PubMed', 'Payme', 'Click', 'Uzum', 'Excel', 'Claude', 'Gemini', 'Google', 'Anthropic', 'DMED', 'QR', 'CSV', 'URL', 'Wi-Fi', '°C', 'Idempotency-Key', 'YYYY-MM-DD', 'HH:MM'];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PROTECT = new RegExp(
  [
    '\\{[A-Za-z_][A-Za-z0-9_]*\\}', // {n}
    'https?:\\/\\/\\S+',
    '[\\w.+-]+@[\\w-]+\\.[\\w.]+',
    '[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:=[a-z]+)?', // environment settings: APP_SECRET_KEY, NEWS_ENABLED=off
    ...PROTECTED_WORDS.map((w) => `(?<![A-Za-z])${escapeRe(w)}(?![A-Za-z])`),
    '(?<![A-Za-z])[A-Za-z]?\\d[0-9.,:/]*', // numbers and ICD-style codes: I10, K29.5, 09:40, 160/100; «18-oktabr» keeps only 18
  ].join('|'),
  'g',
);

/**
 * Russian loanwords keep their Russian spelling in Uzbek Cyrillic (soft sign, я after a consonant), which the Latin
 * text no longer shows. Whole words; a stem marked with «*» also takes Uzbek suffixes (Telegram’da → Телеграмда).
 */
const LOANWORDS: Record<string, string> = {
  yanvar: 'январь', fevral: 'февраль', aprel: 'апрель', iyun: 'июнь', iyul: 'июль',
  sentabr: 'сентябрь', oktabr: 'октябрь', noyabr: 'ноябрь', dekabr: 'декабрь',
  'puls*': 'пульс', 'konsultatsiya*': 'консультация', 'telegram*': 'телеграм', 'profil*': 'профиль', 'model*': 'модель',
  'kompyuter*': 'компьютер', 'filtr*': 'фильтр', 'kalendar*': 'календарь',
};
const LOAN_EXACT = new Map(Object.entries(LOANWORDS).filter(([k]) => !k.endsWith('*')));
const LOAN_STEMS = Object.entries(LOANWORDS).filter(([k]) => k.endsWith('*')).map(([k, v]) => [k.slice(0, -1), v] as const)
  .sort((a, b) => b[0].length - a[0].length);
const capFirst = (src: string, out: string) => (src[0] !== src[0].toLowerCase() ? out[0].toUpperCase() + out.slice(1) : out);

function convertWord(word: string): string {
  const lower = word.toLowerCase();
  const exact = LOAN_EXACT.get(lower);
  if (exact) return capFirst(word, exact);
  for (const [stem, cyr] of LOAN_STEMS) {
    if (lower.startsWith(stem)) {
      const rest = word.slice(stem.length).replace(/^[‘ʻ'`’ʼ]/, ''); // the apostrophe before a suffix is Latin-only
      // the soft sign goes before a vowel suffix: profil + i → профили, model + ini → моделини
      const base = rest && /^[aeiouy]/i.test(rest) && cyr.endsWith('ь') ? cyr.slice(0, -1) : cyr;
      return capFirst(word, base) + (rest ? convert(rest) : '');
    }
  }
  return convert(word);
}

const SINGLE: Record<string, string> = {
  a: 'а', b: 'б', d: 'д', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п',
  q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з', c: 'ц', w: 'в',
};
const APOS = '‘ʻ\'`’ʼ';
const isLetter = (ch: string | undefined) => !!ch && /\p{L}/u.test(ch);
const isVowel = (ch: string | undefined) => !!ch && /[aeiouаеиоуўэюяё]/i.test(ch);

function convert(word: string): string {
  let out = '';
  const lower = word.toLowerCase();
  for (let i = 0; i < word.length; i++) {
    const c = lower[i], next = lower[i + 1], orig = word[i];
    const upper = orig !== c; // this letter is a capital
    // whole-word capitals (UZI, AQB) keep every output letter upper-case; a capital at the start gives a capital
    const cap = (s: string) => (upper ? s.toUpperCase() : s);
    if ((c === 'o' || c === 'g') && next && APOS.includes(next)) { out += cap(c === 'o' ? 'ў' : 'ғ'); i++; continue; }
    if (c === 's' && next === 'h') { out += cap('ш'); i++; continue; }
    if (c === 'c' && next === 'h') { out += cap('ч'); i++; continue; }
    // yo‘q → йўқ: «y» before «o‘» is й, the o‘ is handled on the next step
    if (c === 'y' && next === 'o' && lower[i + 2] && APOS.includes(lower[i + 2])) { out += cap('й'); continue; }
    if (c === 'y' && next && 'oaue'.includes(next)) {
      const map: Record<string, string> = { o: 'ё', a: 'я', u: 'ю', e: 'е' };
      out += cap(map[next]); i++; continue;
    }
    // Russian loanwords: -tsiya, -tsion, -tsent → ц; Uzbek verb forms (ketsa, ketsin) keep т + с
    if (c === 't' && next === 's' && ((lower[i + 2] === 'i' && (isVowel(lower[i + 3]) || lower[i + 3] === 'y')) || lower[i + 2] === 'e')) { out += cap('ц'); i++; continue; }
    if (c === 'e') { out += cap(i === 0 || !isLetter(lower[i - 1]) || isVowel(lower[i - 1]) ? 'э' : 'е'); continue; }
    if (APOS.includes(c)) { out += isLetter(lower[i - 1]) && isLetter(lower[i + 1]) ? 'ъ' : orig; continue; }
    out += SINGLE[c] !== undefined ? cap(SINGLE[c]) : orig;
  }
  return out;
}

/** Converts every Latin word of an interface string; protected tokens and non-Latin characters pass through. */
export function latinToCyrillic(text: string): string {
  let result = '';
  let last = 0;
  for (const m of text.matchAll(PROTECT)) {
    result += convertRun(text.slice(last, m.index));
    result += m[0];
    last = m.index! + m[0].length;
  }
  return result + convertRun(text.slice(last));
}

function convertRun(s: string): string {
  // words include their inner apostrophes (o‘zbek, ma’lumot) so the letter rules see them
  return s.replace(new RegExp(`[A-Za-z](?:[A-Za-z${APOS}]*[A-Za-z])?[${APOS}]?`, 'g'), (w) => {
    // an apostrophe at the very end belongs to the word only after o/g (bog‘, tog‘); otherwise it is a quote
    if (APOS.includes(w[w.length - 1]) && !/[oOgG]$/.test(w.slice(0, -1))) return convertWord(w.slice(0, -1)) + w[w.length - 1];
    return convertWord(w);
  });
}
