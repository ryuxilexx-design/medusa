// Patient-facing bot texts in Uzbek (Latin), Uzbek (Cyrillic, derived) and Russian. Keep them short: read on a phone.
import { latinToCyrillic } from '@meduza/contracts';
export type Lang = 'uz' | 'uz-Cyrl' | 'ru';

const uz = {
  welcome: (clinic: string) => `Assalomu alaykum! Bu «${clinic}» klinikasining boti.\n\nBu yerda qabulga yozilasiz, qabullaringizni ko‘rasiz va eslatmalar olasiz.\n\nDavom etish uchun pastdagi tugma orqali telefon raqamingizni ulashing — shu raqam bo‘yicha klinikadagi kartangizni topamiz.`,
  shareContact: '📱 Telefon raqamni ulashish',
  needContact: 'Davom etish uchun pastdagi «📱 Telefon raqamni ulashish» tugmasini bosing.',
  contactNotOwn: 'Iltimos, boshqa odamning emas, o‘zingizning raqamingizni pastdagi tugma orqali ulashing.',
  onlyUz: 'Hozircha faqat O‘zbekiston raqamlari (+998) qo‘llab-quvvatlanadi. Registraturaga qo‘ng‘iroq qiling.',
  linkedFound: (names: string) => `Rahmat! Raqamingiz bo‘yicha topildi: ${names}.`,
  linkedNew: 'Rahmat! Bu raqam bilan klinikada karta topilmadi. Qabulga yozilayotganda qisqa ro‘yxatdan o‘tasiz.',
  menuBook: '📅 Qabulga yozilish', menuMine: '🗓 Mening qabullarim', menuAddress: '📍 Manzillar', menuLang: '🌐 Til / Язык',
  menu: 'Kerakli bo‘limni tanlang 👇',
  pickPatient: 'Kim uchun yozilamiz?', newPerson: '➕ Boshqa odam (yangi karta)',
  regLast: 'Familiyani yozing (masalan: Karimov):', regFirst: 'Ismni yozing:',
  regBirth: 'Tug‘ilgan sanani yozing (KK.OO.YYYY, masalan 14.05.1990):',
  regBirthBad: 'Sana noto‘g‘ri. Masalan: 14.05.1990', regNameBad: 'Iltimos, 2–40 ta harf yozing.',
  regDone: (name: string) => `Karta yaratildi: ${name}.`, regLimit: 'Bu raqam bilan juda ko‘p karta ochilgan. Registraturaga murojaat qiling.',
  pickService: 'Xizmatni tanlang:', noServices: 'Hozircha onlayn yozilish mumkin bo‘lgan xizmat yo‘q. Registraturaga murojaat qiling.',
  pickDoctor: (s: string) => `${s}\nShifokorni tanlang:`, pickDate: (d: string) => `${d}\nKunni tanlang:`,
  noDates: 'Yaqin 14 kunda bo‘sh vaqt topilmadi. Boshqa shifokorni tanlang yoki registraturaga murojaat qiling.',
  pickTime: (d: string) => `${d}\nVaqtni tanlang:`,
  confirm: (x: Card) => `Ma’lumotlarni tekshiring:\n\n👤 ${x.patient}\n🩺 ${x.service}\n👨‍⚕️ ${x.doctor}\n📅 ${x.date}, ${x.time}\n🏥 ${x.place}\n\nTasdiqlaysizmi?`,
  btnConfirm: '✅ Tasdiqlash', btnCancel: '✖️ Bekor qilish', btnBack: '⬅️ Orqaga', btnYes: 'Ha', btnNo: 'Yo‘q',
  booked: (x: Card) => `✅ Qabulga yozildingiz!\n\n📅 ${x.date}, ${x.time}\n👨‍⚕️ ${x.doctor}\n🏥 ${x.place}\n\nQabuldan bir kun va 2 soat oldin eslatma yuboramiz.`,
  slotTaken: 'Afsus, bu vaqtni hozirgina boshqa bemor band qildi. Boshqa vaqtni tanlang:',
  bookLimit: 'Telegram orqali bitta bemorga 3 tadan ortiq faol yozuv qilib bo‘lmaydi. Registraturaga murojaat qiling.',
  flowCancelled: 'Bekor qilindi.',
  intakeOffer: 'Shifokor vaqtini tejash uchun qabuldan oldin 3 ta savolga javob berasizmi? (1 daqiqa)',
  intakeYes: '📝 Ha, to‘ldiraman', intakeLater: 'Keyinroq',
  intake1: '1/3. Sizni nima bezovta qilyapti? Qisqacha yozing.',
  intake2: '2/3. Biror dori yoki ovqatga allergiyangiz bormi? Bo‘lsa, yozing.', intakeNone: 'Yo‘q',
  intake3: '3/3. Hozir qanday dorilar ichyapsiz?', intakeNoMeds: 'Hech qanday',
  intakeDone: 'Rahmat! Javoblaringiz shifokoringizga yetkaziladi. Bu tashxis emas — shifokor qabulda batafsil so‘raydi.',
  intakeTooLong: 'Iltimos, qisqaroq yozing (1000 belgigacha).', intakeClosed: 'Bu qabul uchun so‘rovnoma yopilgan.',
  mineNone: 'Sizda rejalashtirilgan qabul yo‘q.',
  mineItem: (x: Card, confirmed: boolean) => `📅 ${x.date}, ${x.time}\n🩺 ${x.service} — ${x.doctor}\n👤 ${x.patient}\n🏥 ${x.place}${confirmed ? '\n✅ Kelishingizni tasdiqlagansiz' : ''}`,
  btnReschedule: '🔁 Ko‘chirish', btnCancelAppt: '❌ Bekor qilish', btnIntake: '📝 So‘rovnoma', btnWillCome: '✅ Kelaman',
  cancelAsk: (x: Card) => `${x.date}, ${x.time} dagi qabulni (${x.service}) bekor qilasizmi?`, btnCancelYes: 'Ha, bekor qilish',
  cancelled: 'Qabul bekor qilindi. Qayta yozilish uchun «📅 Qabulga yozilish»ni bosing.',
  rescheduled: (x: Card) => `✅ Qabul ko‘chirildi: ${x.date}, ${x.time} — ${x.doctor}.`,
  notFound: 'Bu qabul topilmadi yoki o‘zgartirib bo‘lmaydi.', willCome: 'Rahmat! Sizni kutamiz.',
  reminderDay: (x: Card) => `🔔 Eslatma: ${x.date}, ${x.time} da qabulingiz bor.\n\n🩺 ${x.service} — ${x.doctor}\n👤 ${x.patient}\n🏥 ${x.place}\n\nKelasizmi?`,
  reminderSoon: (x: Card) => `⏰ Qabulingiz soat ${x.time} da: ${x.doctor}.\n🏥 ${x.place}`,
  resultReady: (patient: string, service: string) => `🧪 ${patient}: «${service}» tahlili natijasi tayyor. Natijani shifokoringizdan yoki klinikadan oling.`,
  patientSummary: (doctor: string, date: string) => `📝 Shifokor ${doctor} tasdiqlagan xulosangiz (${date}):`,
  patientSummaryFoot: 'Savol bo‘lsa, klinikaga qo‘ng‘iroq qiling.',
  cancelledByClinic: (x: Card) => `ℹ️ Klinika ${x.date}, ${x.time} dagi qabulingizni bekor qildi (${x.service}). Qayta yozilish uchun «📅 Qabulga yozilish»ni bosing.`,
  rescheduledByClinic: (x: Card) => `ℹ️ Qabulingiz ko‘chirildi: ${x.date}, ${x.time} — ${x.doctor}.\n🏥 ${x.place}`,
  bookedByClinic: (x: Card) => `✅ Klinika sizni qabulga yozdi.\n\n👤 ${x.patient}\n📅 ${x.date}, ${x.time}\n👨‍⚕️ ${x.doctor}\n🩺 ${x.service}\n🏥 ${x.place}\n\nQabuldan bir kun va 2 soat oldin eslatma yuboramiz.`,
  addresses: (list: string) => `📍 Filiallarimiz:\n\n${list}`,
  stale: 'Bu tugma eskirgan. Menyudan qayta tanlang.', useButtons: 'Iltimos, tugmalardan birini tanlang 👇',
  unknown: 'Tushunmadim. Pastdagi menyudan tanlang 👇', error: 'Xatolik yuz berdi. Birozdan keyin qayta urinib ko‘ring.',
  langPick: 'Tilni tanlang / Тилни танланг / Выберите язык:', langSet: 'Til: o‘zbekcha ✅',
  // consent before a NEW card is created (ZRU-547) — short version of the clinic's consent text; see BOT_CONSENT_VERSION
  consentAsk: (clinic: string) => `Karta ochishdan oldin roziligingiz kerak.\n\n«${clinic}» klinikasi ism-familiya, tug‘ilgan sana, telefon raqami va sog‘lig‘ingiz haqidagi ma’lumotlarni davolash, tibbiy hujjatlar, hisob-kitob va qabul eslatmalari uchun qayta ishlaydi. Ma’lumotlar O‘zbekistonda saqlanadi.\n\nIstalgan vaqtda registratura orqali ma’lumotlaringizni ko‘rishingiz, tuzattirishingiz yoki roziligingizni qaytarib olishingiz mumkin. Telegram’da tahlil natijalari va tashxis yuborilmaydi.\n\n«✅ Roziman» — ma’lumotlarimni qayta ishlashga va shu botda eslatmalar olishga roziman.`,
  consentYes: '✅ Roziman', consentNo: 'Yo‘q',
  consentDeclined: 'Tushunarli. Roziliksiz karta ochilmaydi va ma’lumotlaringiz saqlanmadi. Qabulga yozilish uchun registraturaga qo‘ng‘iroq qiling yoki klinikaga keling.',
  // questions about the clinic (faq.ts) — never medicine
  faqMedical: 'Tibbiy savolga javob bera olmayman — buni faqat shifokor aytadi. Shifokorga yoziling 👇',
  faqAskRegistrar: (phone: string) => `Buni aniq ayta olmayman. Buni registratordan so‘rang: ${phone}`,
  faqAskRegistrarNoPhone: 'Buni aniq ayta olmayman. Buni registraturadan so‘rang.',
  faqUnknown: 'Savolingizni tushunmadim. Narxlar, manzil, ish vaqti yoki shifokorlar haqida so‘rashingiz mumkin 👇',
  faqLimited: 'Savollar juda ko‘p bo‘ldi. Bir soatdan keyin yozing yoki registraturaga qo‘ng‘iroq qiling.',
  faqAuto: 'ℹ️ Avtomatik javob. Aniqlashtirish uchun registraturaga murojaat qiling.',
  faqPrices: (list: string) => `💳 Xizmatlar narxi:\n\n${list}`,
  faqPricesMore: 'Boshqa xizmatlar narxini registraturadan so‘rang.',
  faqHours: (list: string) => `🕘 Ish vaqti:\n\n${list}`,
  faqClosed: 'dam olish kuni',
  faqDoctors: (list: string) => `👨‍⚕️ Shifokorlarimiz:\n\n${list}`,
  faqContacts: (list: string) => `📞 Registratura:\n\n${list}`,
  faqNoPhone: 'Telefon raqami ko‘rsatilmagan.',
  faqPay: (list: string) => `To‘lov usullari: ${list}.`,
  payCash: 'naqd', payCard: 'bank kartasi', payTransfer: 'o‘tkazma',
  btnRegistrar: '📞 Registrator bilan bog‘lanish', btnPrices: '💳 Narxlar',
};
type Texts = typeof uz;

const ru: Texts = {
  welcome: (clinic) => `Здравствуйте! Это бот клиники «${clinic}».\n\nЗдесь можно записаться на приём, посмотреть свои записи и получать напоминания.\n\nЧтобы продолжить, поделитесь номером телефона кнопкой ниже — по нему мы найдём вашу карту в клинике.`,
  shareContact: '📱 Поделиться номером',
  needContact: 'Чтобы продолжить, нажмите кнопку «📱 Поделиться номером» ниже.',
  contactNotOwn: 'Пожалуйста, поделитесь своим номером (а не чужим) кнопкой ниже.',
  onlyUz: 'Пока поддерживаются только номера Узбекистана (+998). Позвоните в регистратуру.',
  linkedFound: (names) => `Спасибо! По вашему номеру найдено: ${names}.`,
  linkedNew: 'Спасибо! Карты с этим номером в клинике нет. При записи пройдёте короткую регистрацию.',
  menuBook: '📅 Записаться на приём', menuMine: '🗓 Мои записи', menuAddress: '📍 Адреса', menuLang: '🌐 Til / Язык',
  menu: 'Выберите раздел 👇',
  pickPatient: 'Кого записываем?', newPerson: '➕ Другой человек (новая карта)',
  regLast: 'Напишите фамилию (например: Каримов):', regFirst: 'Напишите имя:',
  regBirth: 'Напишите дату рождения (ДД.ММ.ГГГГ, например 14.05.1990):',
  regBirthBad: 'Неверная дата. Например: 14.05.1990', regNameBad: 'Пожалуйста, 2–40 букв.',
  regDone: (name) => `Карта создана: ${name}.`, regLimit: 'С этим номером открыто слишком много карт. Обратитесь в регистратуру.',
  pickService: 'Выберите услугу:', noServices: 'Сейчас нет услуг для онлайн-записи. Обратитесь в регистратуру.',
  pickDoctor: (s) => `${s}\nВыберите врача:`, pickDate: (d) => `${d}\nВыберите день:`,
  noDates: 'В ближайшие 14 дней свободного времени нет. Выберите другого врача или обратитесь в регистратуру.',
  pickTime: (d) => `${d}\nВыберите время:`,
  confirm: (x) => `Проверьте данные:\n\n👤 ${x.patient}\n🩺 ${x.service}\n👨‍⚕️ ${x.doctor}\n📅 ${x.date}, ${x.time}\n🏥 ${x.place}\n\nПодтверждаете?`,
  btnConfirm: '✅ Подтвердить', btnCancel: '✖️ Отмена', btnBack: '⬅️ Назад', btnYes: 'Да', btnNo: 'Нет',
  booked: (x) => `✅ Вы записаны!\n\n📅 ${x.date}, ${x.time}\n👨‍⚕️ ${x.doctor}\n🏥 ${x.place}\n\nНапомним за день и за 2 часа до приёма.`,
  slotTaken: 'К сожалению, это время только что занял другой пациент. Выберите другое время:',
  bookLimit: 'Через Telegram нельзя иметь больше 3 активных записей на одного пациента. Обратитесь в регистратуру.',
  flowCancelled: 'Отменено.',
  intakeOffer: 'Чтобы сэкономить время врача, ответите до приёма на 3 вопроса? (1 минута)',
  intakeYes: '📝 Да, заполню', intakeLater: 'Позже',
  intake1: '1/3. Что вас беспокоит? Опишите коротко.',
  intake2: '2/3. Есть ли аллергия на лекарства или продукты? Если да, напишите.', intakeNone: 'Нет',
  intake3: '3/3. Какие лекарства вы сейчас принимаете?', intakeNoMeds: 'Никаких',
  intakeDone: 'Спасибо! Ответы получит ваш врач. Это не диагноз — врач подробно расспросит на приёме.',
  intakeTooLong: 'Пожалуйста, короче (до 1000 символов).', intakeClosed: 'Анкета для этой записи закрыта.',
  mineNone: 'У вас нет запланированных приёмов.',
  mineItem: (x, confirmed) => `📅 ${x.date}, ${x.time}\n🩺 ${x.service} — ${x.doctor}\n👤 ${x.patient}\n🏥 ${x.place}${confirmed ? '\n✅ Вы подтвердили визит' : ''}`,
  btnReschedule: '🔁 Перенести', btnCancelAppt: '❌ Отменить', btnIntake: '📝 Анкета', btnWillCome: '✅ Приду',
  cancelAsk: (x) => `Отменить приём ${x.date}, ${x.time} (${x.service})?`, btnCancelYes: 'Да, отменить',
  cancelled: 'Приём отменён. Чтобы записаться снова, нажмите «📅 Записаться на приём».',
  rescheduled: (x) => `✅ Приём перенесён: ${x.date}, ${x.time} — ${x.doctor}.`,
  notFound: 'Запись не найдена или её нельзя изменить.', willCome: 'Спасибо! Ждём вас.',
  reminderDay: (x) => `🔔 Напоминание: приём ${x.date}, ${x.time}.\n\n🩺 ${x.service} — ${x.doctor}\n👤 ${x.patient}\n🏥 ${x.place}\n\nВы придёте?`,
  reminderSoon: (x) => `⏰ Ваш приём в ${x.time}: ${x.doctor}.\n🏥 ${x.place}`,
  resultReady: (patient, service) => `🧪 ${patient}: результат анализа «${service}» готов. Получите его у врача или в клинике.`,
  patientSummary: (doctor, date) => `📝 Памятка после приёма (${date}), подтверждённая врачом ${doctor}:`,
  patientSummaryFoot: 'Если есть вопросы, позвоните в клинику.',
  cancelledByClinic: (x) => `ℹ️ Клиника отменила ваш приём ${x.date}, ${x.time} (${x.service}). Чтобы записаться снова, нажмите «📅 Записаться на приём».`,
  rescheduledByClinic: (x) => `ℹ️ Ваш приём перенесён: ${x.date}, ${x.time} — ${x.doctor}.\n🏥 ${x.place}`,
  bookedByClinic: (x) => `✅ Клиника записала вас на приём.\n\n👤 ${x.patient}\n📅 ${x.date}, ${x.time}\n👨‍⚕️ ${x.doctor}\n🩺 ${x.service}\n🏥 ${x.place}\n\nНапомним за день и за 2 часа до приёма.`,
  addresses: (list) => `📍 Наши филиалы:\n\n${list}`,
  stale: 'Эта кнопка устарела. Выберите заново в меню.', useButtons: 'Пожалуйста, выберите одну из кнопок 👇',
  unknown: 'Не понял. Выберите в меню ниже 👇', error: 'Произошла ошибка. Попробуйте чуть позже.',
  langPick: 'Tilni tanlang / Тилни танланг / Выберите язык:', langSet: 'Язык: русский ✅',
  consentAsk: (clinic) => `Чтобы открыть карту, нужно ваше согласие.\n\nКлиника «${clinic}» обрабатывает ФИО, дату рождения, номер телефона и сведения о вашем здоровье для лечения, ведения медицинских документов, расчётов и напоминаний о приёме. Данные хранятся в Узбекистане.\n\nВ любое время через регистратуру можно посмотреть и исправить свои данные или отозвать согласие. Результаты анализов и диагноз в Telegram не отправляются.\n\n«✅ Согласен(-на)» — согласие на обработку моих данных и на напоминания в этом боте.`,
  consentYes: '✅ Согласен(-на)', consentNo: 'Нет',
  consentDeclined: 'Понятно. Без согласия карта не создаётся, ваши данные не сохранены. Чтобы записаться, позвоните в регистратуру или приходите в клинику.',
  faqMedical: 'Я не могу отвечать на медицинские вопросы — это может сделать только врач. Запишитесь к врачу 👇',
  faqAskRegistrar: (phone) => `Точно ответить не могу. Уточните у регистратора: ${phone}`,
  faqAskRegistrarNoPhone: 'Точно ответить не могу. Уточните в регистратуре.',
  faqUnknown: 'Не понял вопрос. Можно спросить о ценах, адресе, часах работы или врачах 👇',
  faqLimited: 'Слишком много вопросов. Напишите через час или позвоните в регистратуру.',
  faqAuto: 'ℹ️ Автоматический ответ. Уточнить можно в регистратуре.',
  faqPrices: (list) => `💳 Цены на услуги:\n\n${list}`,
  faqPricesMore: 'Цены на другие услуги уточните в регистратуре.',
  faqHours: (list) => `🕘 Часы работы:\n\n${list}`,
  faqClosed: 'выходной',
  faqDoctors: (list) => `👨‍⚕️ Наши врачи:\n\n${list}`,
  faqContacts: (list) => `📞 Регистратура:\n\n${list}`,
  faqNoPhone: 'Телефон не указан.',
  faqPay: (list) => `Способы оплаты: ${list}.`,
  payCash: 'наличные', payCard: 'банковская карта', payTransfer: 'перевод',
  btnRegistrar: '📞 Связаться с регистратором', btnPrices: '💳 Цены',
};

/**
 * Uzbek Cyrillic from the Latin texts. A template is converted with its arguments replaced by markers, then the real
 * arguments (patient, doctor, service, clinic names — data) are put back unconverted.
 */
const M = '\u0001';
function cyrillicOf<F>(v: F): F {
  if (typeof v === 'string') return latinToCyrillic(v) as F;
  if (typeof v !== 'function') return v;
  return ((...args: unknown[]) => {
    const kept: unknown[] = [];
    const mark = (x: unknown) => { kept.push(x); return `${M}${kept.length - 1}${M}`; };
    const masked = args.map((a) => (a && typeof a === 'object' ? new Proxy({}, { get: (_o, k) => mark((a as Record<string | symbol, unknown>)[k]) }) : typeof a === 'boolean' ? a : mark(a)));
    const tpl = String((v as (...x: unknown[]) => unknown)(...masked));
    return latinToCyrillic(tpl).replace(new RegExp(`${M}(\\d+)${M}`, 'g'), (_m, i) => String(kept[Number(i)]));
  }) as F;
}
const cyrl = Object.fromEntries(Object.entries(uz).map(([k, v]) => [k, cyrillicOf(v)])) as Texts;
cyrl.langSet = 'Тил: ўзбекча (кирилл) ✅';

export const T: Record<Lang, Texts> = { uz, 'uz-Cyrl': cyrl, ru };

/**
 * Version id of the consent the bot shows (consentAsk above), stored with every consent the bot records.
 * Change the wording → bump this id. Like the full form (CONSENT_TEXT_VERSION), it needs a lawyer's review.
 */
export const BOT_CONSENT_VERSION = 'tg-2026-10';
export type Card = { patient: string; service: string; doctor: string; date: string; time: string; place: string };

const MONTHS: Record<'uz' | 'ru', string[]> = {
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
};
const DAYS: Record<'uz' | 'ru', string[]> = {
  uz: ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'],
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
};
/** 'YYYY-MM-DD' → «19-oktabr, dushanba» / «19 октября, понедельник». */
export function humanDate(date: string, lang: Lang, withDay = true): string {
  const [, m, d] = date.split('-').map(Number);
  const wd = new Date(date + 'T00:00:00Z').getUTCDay();
  if (lang === 'uz-Cyrl') return latinToCyrillic(humanDate(date, 'uz', withDay));
  const base = lang === 'uz' ? `${d}-${MONTHS.uz[m - 1]}` : `${d} ${MONTHS.ru[m - 1]}`;
  return withDay ? `${base}, ${DAYS[lang][wd]}` : base;
}
/** Short button label: «19.10 Du» / «19.10 Пн». */
export function shortDate(date: string, lang: Lang) {
  const [, m, d] = date.split('-');
  const wd = new Date(date + 'T00:00:00Z').getUTCDay();
  const short = lang === 'uz' ? ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'] : lang === 'uz-Cyrl' ? ['Як', 'Ду', 'Се', 'Чо', 'Па', 'Жу', 'Ша'] : ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  return `${d}.${m} ${short[wd]}`;
}
