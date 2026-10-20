import type { Catalog } from '../core';

/**
 * Patient consent (ZRU-547 «Shaxsga doir ma’lumotlar to‘g‘risida»; health data is a special category).
 *
 * LAWYER REVIEW REQUIRED: the consent text below («consent.t202610.*») is a plain-language draft written for the pilot.
 * A lawyer licensed in Uzbekistan must review it (wording, retention period, cross-references to the law, the clinic's
 * legal details) before it is signed by real patients. Changing the text means a NEW version: add new keys and a new
 * entry in CONSENT_TEXTS, bump CONSENT_TEXT_VERSION — never edit a version patients have already signed.
 */
export const CONSENT_TEXT_VERSION = '2026-10';

/** Paragraph keys of each consent text version, in print order: [heading, body] pairs. */
export const CONSENT_TEXTS = {
  '2026-10': {
    title: 'consent.t202610.title',
    intro: 'consent.t202610.intro',
    sections: [
      ['consent.t202610.whoH', 'consent.t202610.who'],
      ['consent.t202610.whatH', 'consent.t202610.what'],
      ['consent.t202610.whyH', 'consent.t202610.why'],
      ['consent.t202610.whereH', 'consent.t202610.where'],
      ['consent.t202610.rightsH', 'consent.t202610.rights'],
      ['consent.t202610.tgH', 'consent.t202610.tg'],
    ],
    agree: 'consent.t202610.agree',
    tgChoice: 'consent.t202610.tgChoice',
  },
} as const;
export type ConsentTextVersion = keyof typeof CONSENT_TEXTS;

export const consent = {
  // ---------- consent text, version 2026-10 (needs lawyer review, see above) ----------
  'consent.t202610.title': ['Shaxsga doir ma’lumotlarni qayta ishlashga rozilik', 'Согласие на обработку персональных данных'],
  'consent.t202610.intro': [
    'O‘zbekiston Respublikasining «Shaxsga doir ma’lumotlar to‘g‘risida»gi Qonuniga (O‘RQ-547) muvofiq klinika sizning roziligingiz bilan ma’lumotlaringizni qayta ishlaydi. Sog‘lig‘ingiz haqidagi ma’lumotlar alohida himoya qilinadigan ma’lumotlardir.',
    'В соответствии с Законом Республики Узбекистан «О персональных данных» (ЗРУ-547) клиника обрабатывает ваши данные с вашего согласия. Сведения о здоровье относятся к особо защищаемым данным.',
  ],
  'consent.t202610.whoH': ['Kim qayta ishlaydi', 'Кто обрабатывает'],
  'consent.t202610.who': [
    '«{clinic}» klinikasi (keyingi o‘rinlarda — klinika). Klinika ma’lumotlarni Med.uz.ai dasturida yuritadi.',
    'Клиника «{clinic}» (далее — клиника). Клиника ведёт данные в программе Med.uz.ai.',
  ],
  'consent.t202610.whatH': ['Qanday ma’lumotlar', 'Какие данные'],
  'consent.t202610.what': [
    'Familiya, ism, otasining ismi, tug‘ilgan sana, jins; telefon raqami, manzil, yaqin kishingizning aloqa ma’lumotlari; sog‘lig‘ingiz haqidagi ma’lumotlar (shikoyatlar, tashxis, tahlil va tekshiruv natijalari, allergiya, tavsiyalar); qabullar tarixi; hisoblar va to‘lovlar.',
    'Фамилия, имя, отчество, дата рождения, пол; номер телефона, адрес, контакты близкого человека; сведения о здоровье (жалобы, диагноз, результаты анализов и обследований, аллергия, рекомендации); история приёмов; счета и платежи.',
  ],
  'consent.t202610.whyH': ['Nima uchun', 'Для чего'],
  'consent.t202610.why': [
    'Sizni tekshirish va davolash; tibbiy hujjatlarni yuritish; xizmatlar uchun hisob-kitob; qabulga yozish va qabul vaqtini eslatish (Telegram eslatmalari — alohida rozilik bilan, pastga qarang).',
    'Обследование и лечение; ведение медицинской документации; расчёты за услуги; запись на приём и напоминания о нём (напоминания в Telegram — по отдельному согласию, см. ниже).',
  ],
  'consent.t202610.whereH': ['Qayerda va qancha saqlanadi', 'Где и сколько хранятся'],
  'consent.t202610.where': [
    'Ma’lumotlar O‘zbekiston Respublikasi hududidagi serverlarda saqlanadi. Tibbiy yozuvlar qonunda belgilangan muddat davomida saqlanadi, keyin yo‘q qilinadi. Ma’lumotlaringizni faqat ishi uchun kerak bo‘lgan xodimlar ko‘radi. Uchinchi shaxslarga faqat qonunda nazarda tutilgan hollarda beriladi.',
    'Данные хранятся на серверах на территории Республики Узбекистан. Медицинские записи хранятся в течение срока, установленного законом, затем уничтожаются. Ваши данные видят только сотрудники, которым они нужны для работы. Третьим лицам они передаются только в случаях, предусмотренных законом.',
  ],
  'consent.t202610.rightsH': ['Huquqlaringiz', 'Ваши права'],
  'consent.t202610.rights': [
    'Ma’lumotlaringiz bilan tanishish, noto‘g‘ri ma’lumotni tuzattirish va roziligingizni qaytarib olish huquqiga egasiz. Buning uchun klinika registraturasiga murojaat qiling. Rozilikni qaytarib olish oldin qilingan ishlarni bekor qilmaydi; qonun bo‘yicha saqlanishi shart bo‘lgan tibbiy yozuvlar saqlanib qoladi.',
    'Вы вправе ознакомиться со своими данными, исправить неверные сведения и отозвать согласие. Для этого обратитесь в регистратуру клиники. Отзыв согласия не отменяет уже совершённых действий; медицинские записи, которые закон обязывает хранить, сохраняются.',
  ],
  'consent.t202610.tgH': ['Telegram eslatmalari (ixtiyoriy)', 'Напоминания в Telegram (по желанию)'],
  'consent.t202610.tg': [
    'Telegram orqali qabul eslatmalari va xabarnomalar olish — alohida va ixtiyoriy rozilik. Bu roziliksiz ham davolanasiz. Telegram xabarlarida tahlil natijalari va tashxis yuborilmaydi. Eslatmalardan istalgan vaqtda voz kechishingiz mumkin.',
    'Получение напоминаний и уведомлений в Telegram — отдельное и добровольное согласие. Без него вы также получаете лечение. Результаты анализов и диагноз в Telegram не отправляются. От напоминаний можно отказаться в любой момент.',
  ],
  'consent.t202610.agree': [
    'Men ushbu matn bilan tanishdim va shaxsga doir ma’lumotlarimni, shu jumladan sog‘lig‘im haqidagi ma’lumotlarni yuqorida ko‘rsatilgan maqsadlarda qayta ishlashga roziman.',
    'Я ознакомился(-ась) с этим текстом и согласен(-на) на обработку моих персональных данных, включая сведения о здоровье, в указанных выше целях.',
  ],
  'consent.t202610.tgChoice': ['Telegram orqali eslatmalar olishga:', 'На получение напоминаний в Telegram:'],

  // ---------- printed form ----------
  'consent.print.version': ['Matn versiyasi:', 'Версия текста:'],
  'consent.print.agreeBox': ['roziman', 'согласен(-на)'],
  'consent.print.disagreeBox': ['rozi emasman', 'не согласен(-на)'],
  'consent.print.patientSign': ['Bemor (yoki qonuniy vakili)', 'Пациент (или законный представитель)'],
  'consent.print.staffSign': ['Rozilikni qabul qilgan xodim', 'Сотрудник, принявший согласие'],
  'consent.print.nameLine': ['F.I.Sh.', 'Ф. И. О.'],
  'consent.print.signLine': ['Imzo', 'Подпись'],
  'consent.print.dateLine': ['Sana', 'Дата'],
  'consent.print.representative': ['Vakil bo‘lsa — kimligi (ota-ona, vasiy):', 'Если представитель — кем приходится (родитель, опекун):'],
  'consent.print.copy': ['Imzolangan varaqa bemorning tibbiy hujjatlari bilan saqlanadi; nusxasi so‘rov bo‘yicha bemorga beriladi.', 'Подписанный бланк хранится вместе с медицинской документацией пациента; копия выдаётся пациенту по запросу.'],
  'consent.print.blankTitle': ['Rozilik varaqasi (bo‘sh)', 'Бланк согласия (пустой)'],

  // ---------- interface ----------
  'consent.block.title': ['Rozilik', 'Согласие'],
  'consent.kind.data_processing': ['Ma’lumotlarni qayta ishlash', 'Обработка данных'],
  'consent.kind.notifications': ['Telegram eslatmalari', 'Напоминания в Telegram'],
  'consent.status.granted': ['Rozilik bor', 'Согласие есть'],
  'consent.status.missing': ['Rozilik yo‘q', 'Согласия нет'],
  'consent.status.withdrawn': ['Rozilik qaytarib olingan', 'Согласие отозвано'],
  'consent.status.notAsked': ['Qayd etilmagan', 'Не отмечено'],
  'consent.status.refused': ['Rad etgan', 'Отказался(-ась)'],
  'consent.method.signed_paper': ['Imzolangan varaqa', 'Подписанный бланк'],
  'consent.method.verbal': ['Og‘zaki', 'Устно'],
  'consent.method.telegram': ['Telegram (bemorning o‘zi)', 'Telegram (сам пациент)'],
  'consent.recordedBy': ['{name}, {at}', '{name}, {at}'],
  'consent.bot': ['Telegram bot', 'Telegram-бот'],
  'consent.meta': ['Versiya {version} · {method} · {who}', 'Версия {version} · {method} · {who}'],
  'consent.record': ['Rozilikni qayd etish', 'Отметить согласие'],
  'consent.print': ['Rozilik varaqasini chop etish', 'Распечатать бланк согласия'],
  'consent.printBlank': ['Bo‘sh rozilik varaqasi', 'Пустой бланк согласия'],
  'consent.history': ['Tarix ({n})', 'История ({n})'],
  'consent.historyEmpty': ['Hali yozuv yo‘q', 'Записей пока нет'],
  'consent.missingTitle': ['Bemorning roziligi qayd etilmagan', 'Согласие пациента не отмечено'],
  'consent.missingText': ['Shaxsiy va sog‘liq haqidagi ma’lumotlarni qayta ishlashga rozilik varaqasini chop eting, bemorga imzolating va shu yerda qayd eting.', 'Распечатайте бланк согласия на обработку персональных и медицинских данных, дайте пациенту подписать и отметьте здесь.'],
  'consent.withdrawnTitle': ['Bemor roziligini qaytarib olgan', 'Пациент отозвал согласие'],
  'consent.withdrawnText': ['Yangi ma’lumot kiritishdan oldin bemor bilan gaplashing yoki rahbarga murojaat qiling.', 'Прежде чем вносить новые данные, поговорите с пациентом или обратитесь к руководителю.'],
  'consent.appendOnly': ['Yozuvlar o‘chirilmaydi va o‘zgartirilmaydi: qaytarib olish yangi yozuv sifatida qo‘shiladi.', 'Записи не удаляются и не изменяются: отзыв добавляется новой записью.'],

  // record modal
  'consent.modal.title': ['Rozilikni qayd etish', 'Отметить согласие'],
  'consent.modal.kind': ['Rozilik turi', 'Вид согласия'],
  'consent.modal.answer': ['Bemor javobi', 'Ответ пациента'],
  'consent.modal.granted': ['Rozilik berdi', 'Дал(а) согласие'],
  'consent.modal.denied': ['Rozilik bermadi / qaytarib oldi', 'Не дал(а) согласие / отозвал(а)'],
  'consent.modal.method': ['Qanday olindi', 'Как получено'],
  'consent.modal.note': ['Izoh', 'Комментарий'],
  'consent.modal.noteHint': ['Masalan: qonuniy vakil — onasi. Tibbiy ma’lumot yozmang.', 'Например: законный представитель — мать. Медицинские сведения не пишите.'],
  'consent.modal.version': ['Matn versiyasi: {version}', 'Версия текста: {version}'],
  'consent.modal.verbalHint': ['Og‘zaki rozilikdan keyin varaqani imzolatib, «Imzolangan varaqa» bilan qayta qayd eting.', 'После устного согласия дайте подписать бланк и отметьте ещё раз как «Подписанный бланк».'],
  'consent.modal.saved': ['Rozilik qayd etildi', 'Согласие отмечено'],

  // patient form
  'consent.form.section': ['Rozilik', 'Согласие'],
  'consent.form.data': ['Bemor shaxsiy ma’lumotlarni qayta ishlashga yozma rozilik berdi', 'Пациент дал письменное согласие на обработку персональных данных'],
  'consent.form.dataHintProd': ['Majburiy: roziliksiz bemor kartasi ochilmaydi.', 'Обязательно: без согласия карта пациента не создаётся.'],
  'consent.form.dataHintDemo': ['Haqiqiy klinikada majburiy. Demo rejimida ixtiyoriy.', 'В реальной клинике обязательно. В демо-режиме — по желанию.'],
  'consent.form.method': ['Rozilik shakli', 'Форма согласия'],
  'consent.form.notifications': ['Telegram eslatmalariga rozilik', 'Согласие на напоминания в Telegram'],
  'consent.form.required': ['Bemorning roziligini belgilang', 'Отметьте согласие пациента'],
} as const satisfies Catalog;
