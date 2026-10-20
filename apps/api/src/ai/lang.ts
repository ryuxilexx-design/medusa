import type { Locale } from '@meduza/contracts';

/**
 * The language the model answers in: the doctor's interface language. The empty-section marker stays the literal
 * «Kiritilmagan» in every language — the web shows it as «Не указано» / «Киритилмаган».
 */
export function answerLanguage(locale: Locale | undefined): string {
  if (locale === 'ru') return 'Javob matnini rus tilida yoz (на русском языке).';
  if (locale === 'uz-Cyrl') return 'Javob matnini o‘zbek tilida, kirill yozuvida yoz.';
  return 'Javob matnini o‘zbek tilida, lotin yozuvida yoz.';
}
