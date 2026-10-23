// Patient SMS texts: the same notices as the Telegram bot, cut to one short message. Uzbek in Latin letters only and
// without typographic apostrophes (GSM-7 alphabet: 160 characters per part; a single «‘» would force UCS-2 and
// 70 characters per part, doubling the clinic's cost), Russian in Cyrillic for a patient who is known to prefer it.
// Never a lab value, a diagnosis or clinical text — only the appointment facts the patient already knows.
import type { Card } from '../telegram/texts';
import type { NoticeKind } from '../telegram/outbox';

export type SmsLang = 'uz' | 'ru';

const uz = {
  booked: (x: Card) => `Siz qabulga yozildingiz: ${x.date}, ${x.time}, ${x.doctor}. ${x.place}.`,
  reminder_day: (x: Card) => `Eslatma: ${x.date}, soat ${x.time} da qabulingiz bor (${x.doctor}). ${x.place}.`,
  reminder_soon: (x: Card) => `Qabulingiz soat ${x.time} da: ${x.doctor}. ${x.place}.`,
  cancelled_by_clinic: (x: Card) => `Klinika ${x.date}, ${x.time} dagi qabulingizni bekor qildi. Qayta yozilish uchun klinikaga murojaat qiling.`,
  rescheduled_by_clinic: (x: Card) => `Qabulingiz yangi vaqtga: ${x.date}, ${x.time}, ${x.doctor}. ${x.place}.`,
  // SMS is not encrypted: no service name (a test's name is itself sensitive), only the first name as the addressee
  result_ready: (patient: string, _service: string) => `${patient}, tahlil natijangiz tayyor. Natijani shifokoringizdan yoki klinikadan oling.`,
  // never the summary's text and no name: only that it is ready
  patient_summary: () => 'Xulosangiz tayyor, klinikadan oling.',
};
const ru: typeof uz = {
  booked: (x) => `Вы записаны на приём: ${x.date}, ${x.time}, ${x.doctor}. ${x.place}.`,
  reminder_day: (x) => `Напоминание: приём ${x.date} в ${x.time} (${x.doctor}). ${x.place}.`,
  reminder_soon: (x) => `Ваш приём в ${x.time}: ${x.doctor}. ${x.place}.`,
  cancelled_by_clinic: (x) => `Клиника отменила ваш приём ${x.date}, ${x.time}. Чтобы записаться снова, обратитесь в клинику.`,
  rescheduled_by_clinic: (x) => `Ваш приём перенесён: ${x.date}, ${x.time}, ${x.doctor}. ${x.place}.`,
  result_ready: (patient, _service) => `${patient}, ваш результат готов. Получите его у врача или в клинике.`,
  patient_summary: () => 'Ваша памятка после приёма готова, получите её в клинике.',
};
export const SMS_T: Record<SmsLang, typeof uz> = { uz, ru };

/** Exact text Eskiz accepts from an account whose sender name is not approved yet — used for the manager's test message. */
export const ESKIZ_TEST_TEXT = 'Bu Eskiz dan test';

/** One-line place: «Branch, room, address» (the Telegram card breaks the address onto its own line). */
export const smsPlace = (place: string) => place.replace(/\s*\n\s*/g, ', ');

/** Renders a notice; `card.place` is flattened to one line and the typographic apostrophes of Uzbek data (names, addresses) become ASCII so a Latin message stays in the GSM-7 alphabet. */
export function smsText(kind: NoticeKind, lang: SmsLang, data: { card?: Card; patient?: string; service?: string }): string {
  const t = SMS_T[lang];
  const text = kind === 'result_ready' ? t.result_ready(data.patient ?? '', data.service ?? '') : kind === 'patient_summary' ? t.patient_summary()
    : t[kind]({ ...data.card!, place: smsPlace(data.card!.place) });
  return lang === 'uz' ? text.replace(/[‘’ʻʼ`´«»]/g, (ch) => ('«»'.includes(ch) ? '"' : "'")).replace(/\s+/g, ' ').trim() : text;
}

/** Message parts Eskiz will bill: GSM-7 text 160/153 per part, anything else (Cyrillic, «‘») 70/67. */
export function smsParts(text: string): number {
  // eslint-disable-next-line no-control-regex
  const gsm = /^[\x00-\x7F€£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉÄÖÑÜ§¿äöñüà]*$/.test(text);
  const n = [...text].length;
  if (gsm) return n <= 160 ? 1 : Math.ceil(n / 153);
  return n <= 70 ? 1 : Math.ceil(n / 67);
}
