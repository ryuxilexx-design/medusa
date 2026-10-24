/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Clinical realism of the demo seed: note templates with ICD-10 codes per specialty, ultrasound findings, and
 * physiologically plausible lab values (per parameter, sex, age and the visit's diagnosis). All text is fictional.
 * Every ICD-10 code used here is in the starter list of migration 006 (the import of the official list keeps them).
 */
import { createHash } from 'crypto';

type Row = Record<string, any>;

/** Uzbek titles of the starter ICD-10 codes the seed uses (the note keeps a title snapshot, like the API does). */
export const ICD_TITLE: Record<string, string> = {
  'A09': 'Taxminan infeksion kelib chiqishli diareya va gastroenterit',
  'D25.9': 'Bachadon leyomiomasi (miomasi), aniqlanmagan',
  'D50.9': 'Temir tanqisligi anemiyasi, aniqlanmagan',
  'E03.9': 'Gipotireoz, aniqlanmagan',
  'E04.9': 'Notoksik buqoq, aniqlanmagan',
  'E06.3': 'Autoimmun tireoidit',
  'E11.9': '2-tip qandli diabet, asoratsiz',
  'E55.9': 'D vitamini yetishmovchiligi',
  'E66.9': 'Semizlik, aniqlanmagan',
  'E78.0': 'Sof giperxolesterinemiya',
  'G43.9': 'Migren, aniqlanmagan',
  'G44.2': 'Zo‘riqish tipidagi bosh og‘rig‘i',
  'G47.0': 'Uyqusizlik (insomniya)',
  'I10': 'Essensial (birlamchi) gipertenziya',
  'I11.9': 'Yurak zararlanishi ustun gipertoniya kasalligi, yurak yetishmovchiligisiz',
  'I20.8': 'Stenokardiyaning boshqa shakllari',
  'I48': 'Bo‘lmachalar fibrillyatsiyasi va titrashi',
  'I49.9': 'Yurak ritmi buzilishi, aniqlanmagan',
  'J03.9': 'O‘tkir tonzillit (angina), aniqlanmagan',
  'J06.9': 'Yuqori nafas yo‘llarining o‘tkir infeksiyasi, aniqlanmagan',
  'J20.9': 'O‘tkir bronxit, aniqlanmagan',
  'K29.5': 'Surunkali gastrit, aniqlanmagan',
  'K76.0': 'Jigar yog‘li distrofiyasi',
  'K80.2': 'O‘t pufagi toshlari, xoletsistitsiz',
  'L20.9': 'Atopik dermatit, aniqlanmagan',
  'M42.1': 'Kattalarda umurtqa pog‘onasi osteoxondrozi',
  'M54.2': 'Servikalgiya (bo‘yin og‘rig‘i)',
  'M54.4': 'Ishias bilan lyumbago',
  'N20.0': 'Buyrak toshlari',
  'N40': 'Prostata bezi giperplaziyasi',
  'N60.1': 'Diffuz kistoz mastopatiya',
  'N70.1': 'Surunkali salpingit va ooforit',
  'N76.0': 'O‘tkir vaginit',
  'N83.2': 'Tuxumdon kistalari (boshqa va aniqlanmagan)',
  'N92.0': 'Muntazam siklda ko‘p va tez-tez hayz',
  'N94.6': 'Dismenoreya, aniqlanmagan',
  'N95.1': 'Ayollarda menopauza va klimakterik holat',
  'R53': 'Holsizlik va charchoq',
  'Z00.0': 'Umumiy tibbiy ko‘rik',
  'Z00.1': 'Bolaning muntazam sog‘liq ko‘rigi',
  'Z01.4': 'Ginekologik ko‘rik (umumiy, muntazam)',
  'Z34.9': 'Normal homiladorlik kuzatuvi',
};
export const icdSnap = (codes: string[]) => codes.map((code) => {
  const title = ICD_TITLE[code];
  if (!title) throw new Error(`seed: ICD-10 code ${code} is not in the starter list`);
  return { code, title };
});

/** Stable 0…n-1 choice from a key (no PRNG: a choice here never shifts the seeded numbers). */
export function hashIdx(key: string, n: number): number {
  return parseInt(createHash('sha1').update('meduza-demo-pick:' + key).digest('hex').slice(0, 8), 16) % n;
}

type Range = [number, number];
export type NoteTpl = {
  c: string; a: string; e: string; d: string; r: string; icd: string[];
  /** vitals for this picture (the doctor measured them): systolic, diastolic, pulse, temperature */
  v?: { sys?: Range; dia?: Range; pulse?: Range; temp?: Range };
  age?: Range; sex?: 'male' | 'female';
};

/** Note templates per doctor index (0 terapevt … 5 endokrinolog). The ultrasound doctor's notes follow the report (UZI_VARIANTS). */
export const NOTE_TEMPLATES: Record<number, NoteTpl[]> = {
  0: [
    { c: 'Tomoq og‘rig‘i, burun bitishi, harorat 37,6 °C gacha, 2 kundan beri.', a: 'Kasallik o‘tkir boshlangan, oilada shamollash holatlari bor. Surunkali kasalliklari yo‘q.',
      e: 'Tomoq shilliq qavati giperemiyalangan, bodomcha bezlar kattalashmagan. O‘pkada vezikulyar nafas, xirillash yo‘q.', d: 'O‘tkir respirator virusli infeksiya', icd: ['J06.9'],
      r: 'Ko‘p iliq suyuqlik, uy rejimi 3–5 kun. Harorat 38,5 °C dan oshsa — paratsetamol 500 mg. 5 kun ichida yaxshilanmasa qayta ko‘rik.', v: { temp: [37.2, 37.9] } },
    { c: 'Umumiy holsizlik, tez charchash, bosh aylanishi.', a: '1–2 oydan beri, ish yuklamasi oshgan, ovqatlanish tartibsiz.',
      e: 'Teri va shilliq qavatlar rangpar. Yurak tonlari ritmik, cho‘qqida yumshoq sistolik shovqin.', d: 'Holsizlik va charchoq, anemiya istisno qilinmoqda', icd: ['R53'],
      r: 'Umumiy qon tahlili va ferritin. Natija bilan qayta ko‘rik.', v: { temp: [36.4, 36.8] } },
    { c: 'Ensa sohasida bosh og‘rig‘i, ertalab kuchayadi.', a: 'Uyda o‘lchaganda AQB ko‘tarilgan, dori ichmaydi. Otasida gipertoniya.',
      e: 'Yurak tonlari aniq, ritmik, aortada II ton aksenti. Oyoqlarda shish yo‘q.', d: 'Arterial gipertenziya, 1-daraja', icd: ['I10'],
      r: 'Tuz kuniga 5 g gacha, AQB kundaligi 2 hafta. EKG, lipid profil, kardiolog konsultatsiyasi.', v: { sys: [144, 158], dia: [90, 98], temp: [36.4, 36.8] } },
    { c: 'Quruq yo‘tal, kechasi kuchayadi, 6 kundan beri.', a: 'Avval shamollash bo‘lgan, chekmaydi.',
      e: 'O‘pkada dag‘al nafas, tarqoq quruq xirillashlar. Hansirash yo‘q.', d: 'O‘tkir bronxit', icd: ['J20.9'],
      r: 'Ko‘p suyuqlik, xonani namlash. 7 kundan keyin nazorat; harorat ko‘tarilsa yoki hansirash paydo bo‘lsa — darhol murojaat.', v: { temp: [36.8, 37.4] } },
    { c: 'Och qoringa epigastriyda og‘riq, kekirish, ko‘ngil aynishi.', a: 'Yarim yildan beri vaqti-vaqti bilan, ovqatlanish tartibsiz, achchiq ovqat yeydi.',
      e: 'Til oq karash bilan qoplangan. Qorin yumshoq, epigastriyda paypaslaganda og‘riq.', d: 'Surunkali gastrit, zo‘riqish davri', icd: ['K29.5'],
      r: 'Parhez: achchiq, yog‘li va qovurilgan ovqatdan saqlanish, kam-kamdan tez-tez ovqatlanish. Qorin bo‘shlig‘i UZI. 2 haftadan keyin nazorat.', v: { temp: [36.4, 36.8] } },
    { c: 'Ish joyi uchun profilaktik ko‘rik.', a: 'Shikoyat yo‘q. Surunkali kasalliklari yo‘q.',
      e: 'Umumiy ahvoli qoniqarli. A’zolar va tizimlar bo‘yicha o‘zgarish aniqlanmadi.', d: 'Umumiy tibbiy ko‘rik: sog‘lom', icd: ['Z00.0'],
      r: 'Yiliga bir marta profilaktik ko‘rik.', v: { sys: [112, 128], dia: [70, 82], pulse: [64, 80], temp: [36.4, 36.8] } },
  ],
  1: [
    { c: 'Yurak sohasida siqiluvchi og‘riq, yuklamada hansirash.', a: '2 haftadan beri, zinadan ko‘tarilganda paydo bo‘ladi, dam olganda 3–5 daqiqada o‘tadi.',
      e: 'Yurak tonlari bo‘g‘iqroq, ritmik. O‘pkada xirillash yo‘q. Oyoqlarda shish yo‘q.', d: 'Yurak ishemik kasalligi: zo‘riqish stenokardiyasi, FS II', icd: ['I20.8'],
      r: 'EKG, exokardiografiya, lipid profil. Jismoniy yuklamani cheklash. Og‘riq 15 daqiqadan uzoq davom etsa — 103 ga qo‘ng‘iroq.', v: { sys: [130, 146], dia: [80, 90] }, age: [40, 90] },
    { c: 'Yurak urishi tezlashishi, xavotir.', a: 'Stress fonida, kuniga 4–5 piyola kofe ichadi.',
      e: 'Yurak tonlari aniq, ritmik, taxikardiya.', d: 'Yurak ritmi buzilishi: sinusli taxikardiya', icd: ['I49.9'],
      r: 'Kofeinni kamaytirish, uyqu rejimi. TTG tahlili. 2 haftadan keyin nazorat.', v: { pulse: [96, 108] } },
    { c: 'Bosh og‘rig‘i, AQB 160/100 gacha ko‘tariladi.', a: '5 yildan beri gipertoniya, dorini muntazam ichmaydi.',
      e: 'Yurak chegarasi chapga 1 sm kengaygan, aortada II ton aksenti.', d: 'Gipertoniya kasalligi, II bosqich, 2-daraja', icd: ['I11.9'],
      r: 'Dori-darmonni muntazam qabul qilish, AQB kundaligi. Lipid profil, kreatinin. 1 oydan keyin nazorat.', v: { sys: [154, 170], dia: [95, 104] }, age: [35, 90] },
    { c: 'Profilaktik ko‘rik, xolesterin yuqori chiqqan.', a: 'Shikoyat yo‘q. Onasi 58 yoshida infarkt o‘tkazgan.',
      e: 'Yurak tonlari aniq, ritmik. Periferik pulsatsiya saqlangan.', d: 'Sof giperxolesterinemiya', icd: ['E78.0'],
      r: 'Parhez: hayvon yog‘larini cheklash, haftasiga 150 daqiqa yurish. 3 oydan keyin lipid profil.', age: [30, 90] },
    { c: 'Vaqti-vaqti bilan yurak notekis urishi, bosh aylanishi.', a: 'Bir oydan beri, xurujlar 1–2 soat davom etadi.',
      e: 'Ko‘rik paytida yurak ritmi to‘g‘ri, tonlar aniq.', d: 'Bo‘lmachalar fibrillyatsiyasi, paroksizmal shakl', icd: ['I48'],
      r: 'EKG, exokardiografiya, koagulogramma. Xuruj paytida EKG yozdirish.', age: [45, 90] },
  ],
  2: [
    { c: 'Bo‘yin va yelkada og‘riq, boshni burganda kuchayadi.', a: 'Kompyuterda uzoq ishlaydi, 3 haftadan beri.',
      e: 'Bo‘yin paravertebral mushaklari taranglashgan, harakat cheklangan. Nevrologik defitsit yo‘q.', d: 'Bo‘yin umurtqasi osteoxondrozi, servikalgiya', icd: ['M42.1', 'M54.2'],
      r: 'Ish joyi ergonomikasi, har soatda tanaffus va mashqlar. Fizioterapiya. 2 haftadan keyin nazorat.' },
    { c: 'Peshona va chakkada siquvchi bosh og‘rig‘i, kun oxirida kuchayadi.', a: 'Bir oydan beri, uyqu yetishmaydi.',
      e: 'Nevrologik status o‘zgarishsiz. Perikranial mushaklar paypaslaganda og‘riqli.', d: 'Zo‘riqish tipidagi bosh og‘rig‘i', icd: ['G44.2'],
      r: 'Uyqu gigiyenasi, kuniga 30 daqiqa yurish. Og‘riq kundaligi. 1 oydan keyin nazorat.' },
    { c: 'Bir tomonlama pulsatsiyalanuvchi bosh og‘rig‘i, ko‘ngil aynishi, yorug‘likdan bezovtalik.', a: 'Oyiga 2–3 marta xurujlar, 4–12 soat davom etadi.',
      e: 'Xurujlararo davrda nevrologik status o‘zgarishsiz.', d: 'Migren, aurasiz', icd: ['G43.9'],
      r: 'Xuruj kundaligi, qo‘zg‘atuvchilardan saqlanish (uyqusizlik, och qolish). 1 oydan keyin nazorat.', age: [14, 70] },
    { c: 'Belda og‘riq, chap oyoqqa tarqaladi.', a: 'Og‘ir yuk ko‘targandan keyin, 5 kundan beri.',
      e: 'Bel mushaklari taranglashgan, Lasseg simptomi chapda 45°. Reflekslar saqlangan.', d: 'Ishias bilan lyumbago', icd: ['M54.4'],
      r: 'Og‘ir yuk ko‘tarmaslik, qattiq to‘shak. 10 kundan keyin nazorat; oyoqda holsizlik paydo bo‘lsa — darhol murojaat.' },
    { c: 'Uyquga keta olmaslik, tunda tez-tez uyg‘onish.', a: '2 oydan beri, ishdagi stress.',
      e: 'Nevrologik status o‘zgarishsiz. Xavotir belgilari bor.', d: 'Uyqusizlik (insomniya)', icd: ['G47.0'],
      r: 'Uyqu gigiyenasi: bir vaqtda yotish, kechqurun ekran va kofeinsiz. 1 oydan keyin nazorat.' },
  ],
  3: [
    { c: 'Yo‘tal, burundan suyuqlik oqishi, harorat 38 °C.', a: '2 kundan beri, bog‘chada shamollash holatlari.',
      e: 'Tomoq giperemiyalangan. O‘pkada pueril nafas, xirillash yo‘q.', d: 'O‘tkir respirator virusli infeksiya', icd: ['J06.9'],
      r: 'Ko‘p iliq suyuqlik, burunni tuzli eritma bilan yuvish. Harorat 38,5 °C dan oshsa — yoshiga mos dozada paratsetamol. 3 kundan keyin ko‘rik.', v: { temp: [37.6, 38.3] } },
    { c: 'Rejali profilaktik ko‘rik.', a: 'Shikoyat yo‘q. Emlashlar kalendar bo‘yicha.',
      e: 'Bo‘yi va vazni yoshiga mos. A’zolar bo‘yicha o‘zgarish yo‘q.', d: 'Sog‘lom bola, muntazam ko‘rik', icd: ['Z00.1'],
      r: 'Keyingi profilaktik ko‘rik 6 oydan keyin.', v: { temp: [36.5, 36.8] } },
    { c: 'Tomoq og‘rig‘i, yutishda og‘riq, harorat 38,6 °C.', a: '1 kundan beri.',
      e: 'Bodomcha bezlar kattalashgan, giperemiyalangan, yiringli karash. Jag‘ osti limfa tugunlari kattalashgan.', d: 'O‘tkir tonzillit', icd: ['J03.9'],
      r: 'Uy rejimi, iliq ichimlik. Umumiy qon tahlili. 2 kundan keyin ko‘rik.', v: { temp: [38.1, 38.7] }, age: [3, 17] },
    { c: 'Ich ketishi kuniga 4–5 marta, bir marta qusish.', a: 'Kecha boshlangan, oilada boshqalar sog‘.',
      e: 'Til biroz quruq, qorin yumshoq, ichak bo‘ylab shovqin kuchaygan. Suvsizlanish belgilari yengil.', d: 'Taxminan infeksion kelib chiqishli gastroenterit', icd: ['A09'],
      r: 'Og‘iz orqali regidratatsiya eritmasi kam-kamdan tez-tez, parhez. Siydik kamaysa yoki qusish takrorlansa — darhol murojaat.', v: { temp: [37.2, 37.8] } },
    { c: 'Terida quruqlik va qichishish, tirsak va tizza bukilmalarida toshma.', a: 'Qishda kuchayadi, onasida allergik rinit.',
      e: 'Tirsak bukilmalarida quruq, po‘st tashlovchi eritematoz toshmalar.', d: 'Atopik dermatit', icd: ['L20.9'],
      r: 'Teri namlovchi kremlar kuniga 2 marta, sintetik kiyimdan saqlanish. 2 haftadan keyin nazorat.', v: { temp: [36.5, 36.8] } },
  ],
  4: [
    { c: 'Profilaktik ko‘rik.', a: 'Shikoyat yo‘q. Hayz sikli muntazam.',
      e: 'Ko‘zgularda bachadon bo‘yni o‘zgarmagan. Bimanual: bachadon va ortiqlari o‘zgarishsiz.', d: 'Ginekologik profilaktik ko‘rik, patologiya aniqlanmadi', icd: ['Z01.4'],
      r: 'Yillik ko‘rik, PAP-test 3 yilda bir marta.' },
    { c: 'Qichishish, ajralma ko‘payishi.', a: '5 kundan beri.',
      e: 'Qin shilliq qavati giperemiyalangan, ajralma ko‘p.', d: 'O‘tkir vaginit', icd: ['N76.0'],
      r: 'Surtma tahlili, natija bilan davo. Shaxsiy gigiyena. 7 kundan keyin nazorat.' },
    { c: 'Qorin pastida simillovchi og‘riq.', a: 'Bir haftadan beri, ilgari ham bo‘lgan.',
      e: 'Bimanual: ortiqlar sohasi paypaslaganda og‘riqli.', d: 'Surunkali salpingit va ooforit, zo‘riqish', icd: ['N70.1'],
      r: 'Kichik chanoq UZI, umumiy qon tahlili. Natija bilan qayta ko‘rik.', age: [18, 55] },
    { c: 'Hayz paytida kuchli og‘riq.', a: 'Bir yildan beri, hayzning 1–2-kunlari.',
      e: 'Bimanual: patologik o‘zgarish aniqlanmadi.', d: 'Dismenoreya', icd: ['N94.6'],
      r: 'Kichik chanoq UZI. Og‘riq kundaligi. Keyingi sikldan keyin nazorat.', age: [14, 42] },
    { c: 'Homiladorlik bo‘yicha kuzatuv, 12 hafta.', a: 'Birinchi homiladorlik, shikoyat yo‘q.',
      e: 'Umumiy ahvoli qoniqarli. Bachadon homiladorlik muddatiga mos kattalashgan.', d: 'Normal homiladorlik kuzatuvi', icd: ['Z34.9'],
      r: 'Homiladorlik UZI, umumiy qon va siydik tahlili. Foliy kislotasi. 4 haftadan keyin ko‘rik.', age: [19, 40] },
    { c: 'Issiqlik toshishi, terlash, uyqu buzilishi.', a: 'Hayz 1 yildan beri tartibsiz.',
      e: 'Bimanual: yoshga mos o‘zgarishlar.', d: 'Klimakterik holat', icd: ['N95.1'],
      r: 'Turmush tarzi bo‘yicha tavsiyalar, sut bezlari UZI, D vitamini tahlili. 3 oydan keyin nazorat.', age: [45, 69] },
  ],
  5: [
    { c: 'Chanqash, tez-tez siyish, og‘izda quruqlik.', a: '2 oydan beri, oilada qandli diabet bor.',
      e: 'Tana vazni indeksi 31 kg/m². Oyoq panjalarida sezuvchanlik saqlangan.', d: 'Qandli diabet, 2-tip, birinchi aniqlangan', icd: ['E11.9'],
      r: 'Och qoringa glyukoza, HbA1c. Ovqatlanish kundaligi, uglevodlarni cheklash. Natija bilan qayta ko‘rik.', age: [35, 90] },
    { c: 'Holsizlik, vazn ortishi, sovuqqa chidamsizlik.', a: '6 oy davomida 5 kg ortgan.',
      e: 'Teri quruq, qalqonsimon bez paypaslanmaydi.', d: 'Gipotireoz', icd: ['E03.9'],
      r: 'TTG tahlili, qalqonsimon bez UZI. Natija bilan qayta ko‘rik.' },
    { c: 'Bo‘yinda noqulaylik, holsizlik.', a: 'Opasida qalqonsimon bez kasalligi bor.',
      e: 'Qalqonsimon bez I darajada kattalashgan, zich, og‘riqsiz.', d: 'Autoimmun tireoidit', icd: ['E06.3'],
      r: 'TTG, qalqonsimon bez UZI. 3 oydan keyin nazorat.' },
    { c: 'Vazn ortishi, yuklamada hansirash.', a: 'Oxirgi 2 yilda 12 kg ortgan, kam harakat qiladi.',
      e: 'TVI 34 kg/m², bel aylanasi 104 sm.', d: 'Semizlik, I daraja', icd: ['E66.9'],
      r: 'Ovqatlanish rejimi, kuniga 8 000 qadam. Glyukoza, lipid profil, TTG. 1 oydan keyin nazorat.', age: [18, 90] },
    { c: 'Suyak va mushaklarda og‘riq, holsizlik.', a: 'Quyoshda kam bo‘ladi, ofisda ishlaydi.',
      e: 'Somatik status o‘zgarishsiz.', d: 'D vitamini yetishmovchiligi', icd: ['E55.9'],
      r: 'D vitamini (25-OH) tahlili, natija bilan doza tanlash. Kunduzi ochiq havoda sayr.' },
    { c: 'Bo‘yin oldida kattalashish sezadi.', a: 'Bir yildan beri, yodlangan tuz ishlatmaydi.',
      e: 'Qalqonsimon bez II darajada diffuz kattalashgan, og‘riqsiz.', d: 'Notoksik diffuz buqoq', icd: ['E04.9'],
      r: 'Qalqonsimon bez UZI, TTG. Yodlangan tuz. 3 oydan keyin nazorat.' },
  ],
};

/** The template a pick lands on, or (if the patient's age or sex does not fit it) the first one that fits. No PRNG. */
export function fitTemplate(list: NoteTpl[], picked: NoteTpl, age: number, sex: string): NoteTpl {
  const fits = (t: NoteTpl) => (!t.age || (age >= t.age[0] && age <= t.age[1])) && (!t.sex || t.sex === sex);
  return fits(picked) ? picked : list.find(fits) ?? picked;
}

type UziVariant = { d: string; c: string; icd: string[]; sex?: 'male' | 'female'; minAge?: number };
/** Ultrasound findings per service: the report and the ultrasound doctor's note always tell the same story. */
export const UZI_VARIANTS: Record<string, UziVariant[]> = {
  U01: [
    { d: 'Jigar o‘lchami me’yorda (o‘ng bo‘lak 138 mm), exostruktura bir xil. O‘t pufagi devori yupqa, toshlar aniqlanmadi. Oshqozon osti bezi va taloq o‘zgarishsiz.', c: 'Qorin bo‘shlig‘i a’zolarida exografik patologiya aniqlanmadi.', icd: ['Z00.0'] },
    { d: 'Jigar kattalashgan (o‘ng bo‘lak 162 mm), exogenligi diffuz oshgan, distal so‘nish bor. O‘t pufagi, oshqozon osti bezi va taloq o‘zgarishsiz.', c: 'Jigar yog‘li gepatozi exobelgilari.', icd: ['K76.0'], minAge: 25 },
    { d: 'Jigar o‘lchami me’yorda. O‘t pufagi bo‘shlig‘ida 8 mm gacha bir nechta giperexogen tosh, akustik soya bilan; devori 2 mm.', c: 'O‘t pufagi toshlari (xoletsistitsiz) exobelgilari.', icd: ['K80.2'], minAge: 30 },
  ],
  U02: [
    { d: 'O‘ng bo‘lak 15×16×45 mm, chap bo‘lak 14×15×44 mm, umumiy hajmi 11 ml. Exostruktura bir xil, tugunlar aniqlanmadi.', c: 'Qalqonsimon bez exografik me’yorda.', icd: ['Z00.0'] },
    { d: 'O‘ng bo‘lak 17×18×48 mm, chap bo‘lak 16×17×46 mm. Exostruktura notekis, exogenligi pasaygan, mayda gipoexogen sohalar.', c: 'Autoimmun tireoidit exobelgilari.', icd: ['E06.3'] },
    { d: 'Umumiy hajmi 24 ml (me’yor 18 ml gacha), exostruktura bir xil, tugunlar aniqlanmadi.', c: 'Qalqonsimon bezning diffuz kattalashishi.', icd: ['E04.9'] },
  ],
  U03: [
    { d: 'Buyraklar odatiy joylashgan: o‘ng 106×46 mm, chap 109×48 mm, parenximasi 16 mm. Kosacha-jom tizimi kengaymagan. Siydik pufagi o‘zgarishsiz.', c: 'Buyraklarda exografik patologiya aniqlanmadi.', icd: ['Z00.0'] },
    { d: 'O‘ng buyrak 108×48 mm, chap 110×50 mm. O‘ng buyrak pastki kosachasida 5 mm giperexogen konkrement. Kosacha-jom tizimi kengaymagan.', c: 'O‘ng buyrak toshi (5 mm) exobelgilari.', icd: ['N20.0'] },
  ],
  U04: [
    { d: 'Bachadon 52×40×48 mm, endometriy 8 mm, sikl fazasiga mos. Tuxumdonlar o‘lchami me’yorda, follikulalar bor.', c: 'Kichik chanoq a’zolarida exografik patologiya aniqlanmadi.', icd: ['Z00.0'], sex: 'female' },
    { d: 'Bachadon o‘lchamlari me’yorda. O‘ng tuxumdonda 32×28 mm anexogen, yupqa devorli hosila.', c: 'O‘ng tuxumdon follikulyar kistasi exobelgilari.', icd: ['N83.2'], sex: 'female' },
    { d: 'Bachadon 58×52×60 mm, orqa devorida 18 mm intramural gipoexogen tugun. Tuxumdonlar odatiy.', c: 'Bachadon miomasi (intramural tugun) exobelgilari.', icd: ['D25.9'], sex: 'female', minAge: 30 },
    { d: 'Siydik pufagi devori tekis, qoldiq siydik yo‘q. Prostata 38×30×32 mm (hajmi 19 ml), exostruktura bir xil.', c: 'Kichik chanoq a’zolarida exografik patologiya aniqlanmadi.', icd: ['Z00.0'], sex: 'male' },
    { d: 'Prostata 48×41×44 mm (hajmi 45 ml), exostruktura notekis. Qoldiq siydik 40 ml.', c: 'Prostata bezi giperplaziyasi exobelgilari.', icd: ['N40'], sex: 'male', minAge: 50 },
  ],
  U05: [
    { d: 'Yurak bo‘shliqlari kengaymagan. Chap qorincha qisqaruvchanligi saqlangan, EF 62%. Klapanlar o‘zgarishsiz.', c: 'Exokardiografik ko‘rsatkichlar me’yor doirasida.', icd: ['Z00.0'] },
    { d: 'Chap qorincha devorlari qalinlashgan (QAD 12 mm, ChQOD 12 mm), EF 58%. Diastolik disfunksiya, I tip.', c: 'Chap qorincha konsentrik gipertrofiyasi, diastolik disfunksiya I tip.', icd: ['I11.9'], minAge: 40 },
  ],
  U06: [
    { d: 'Sut bezlari to‘qimasi yoshga mos. Hajmli hosilalar aniqlanmadi, regional limfa tugunlari kattalashmagan.', c: 'Sut bezlarida exografik patologiya aniqlanmadi.', icd: ['Z00.0'] },
    { d: 'Ikkala sut bezida mayda kistalar (4–6 mm gacha), fibroz to‘qima ko‘paygan. Limfa tugunlari kattalashmagan.', c: 'Diffuz kistoz mastopatiya exobelgilari.', icd: ['N60.1'], sex: 'female' },
  ],
  U07: [
    { d: 'Bachadonda bitta tirik homila, yurak urishi 152/daq. KTR 62 mm, 12 hafta 3 kunga mos. Yo‘ldosh oldingi devorda.', c: 'Bachadon ichi homiladorligi, 12–13 hafta, muddatiga mos.', icd: ['Z34.9'], sex: 'female' },
  ],
};
/** The finding of one ultrasound order, chosen by the order id among the variants that fit the patient. */
export function uziVariant(code: string, key: string, sex: string, age: number): UziVariant {
  const all = UZI_VARIANTS[code];
  const fit = all.filter((v) => (!v.sex || v.sex === sex) && (!v.minAge || age >= v.minAge));
  const list = fit.length ? fit : all;
  return list[hashIdx(key, list.length)];
}

// ---------- lab values ----------
type Gen = { mean: number; sd: number; dec: number; min?: number; max?: number };
const NORMAL: Record<string, (sex: string, age: number) => Gen> = {
  HGB: (s, a) => (a < 12 ? { mean: 124, sd: 7, dec: 0 } : s === 'male' ? { mean: 146, sd: 8, dec: 0 } : { mean: 131, sd: 7, dec: 0 }),
  RBC: (s, a) => (a < 12 ? { mean: 4.5, sd: 0.25, dec: 2 } : s === 'male' ? { mean: 4.9, sd: 0.28, dec: 2 } : { mean: 4.4, sd: 0.25, dec: 2 }),
  WBC: () => ({ mean: 6.4, sd: 1.2, dec: 1, min: 4.2, max: 8.8 }),
  PLT: () => ({ mean: 255, sd: 45, dec: 0, min: 160, max: 390 }),
  ESR: (s, a) => (s === 'female' && a >= 18 ? { mean: 9, sd: 3, dec: 0, min: 3, max: 15 } : { mean: 6, sd: 2.5, dec: 0, min: 2, max: 14 }),
  ALT: (s) => (s === 'male' ? { mean: 24, sd: 7, dec: 0, min: 9, max: 38 } : { mean: 18, sd: 6, dec: 0, min: 7, max: 36 }),
  AST: () => ({ mean: 22, sd: 5, dec: 0, min: 12, max: 37 }),
  CREA: (s, a) => (a < 12 ? { mean: 64, sd: 4, dec: 0, min: 62, max: 75 } : s === 'male' ? { mean: 90, sd: 10, dec: 0, min: 66, max: 112 } : { mean: 74, sd: 6, dec: 0, min: 63, max: 92 }),
  UREA: () => ({ mean: 5.2, sd: 1, dec: 1, min: 2.8, max: 7.9 }),
  GLU: () => ({ mean: 5, sd: 0.4, dec: 1, min: 4, max: 6 }),
  HBA1C: () => ({ mean: 5.3, sd: 0.3, dec: 1, min: 4.4, max: 5.9 }),
  HDL: (s) => (s === 'male' ? { mean: 1.25, sd: 0.15, dec: 2, min: 1.02, max: 1.7 } : { mean: 1.5, sd: 0.2, dec: 2, min: 1.1, max: 2.1 }),
  TG: () => ({ mean: 1.15, sd: 0.3, dec: 2, min: 0.5, max: 1.68 }),
  TSH: () => ({ mean: 1.9, sd: 0.65, dec: 2, min: 0.6, max: 3.8 }),
  SG: () => ({ mean: 1.017, sd: 0.005, dec: 3, min: 1.008, max: 1.028 }),
  PH: () => ({ mean: 6, sd: 0.4, dec: 1, min: 5.2, max: 6.9 }),
  PT: () => ({ mean: 12.8, sd: 0.7, dec: 1, min: 11.2, max: 14.6 }),
  FER: (s) => (s === 'male' ? { mean: 105, sd: 25, dec: 0, min: 40, max: 148 } : { mean: 48, sd: 18, dec: 0, min: 18, max: 120 }),
  VITD: () => ({ mean: 24, sd: 7, dec: 0, min: 9, max: 48 }), // most people in Uzbekistan are below 30 ng/mL
};
/** Deviations a diagnosis explains: profile -> parameter -> [low, high] value range. */
const PROFILE: Record<string, Record<string, Range>> = {
  anemia: { HGB: [94, 112], RBC: [3.5, 3.9], FER: [5, 12], ESR: [16, 26] },
  infection: { WBC: [10.2, 13.8], ESR: [18, 32] },
  diabetes: { GLU: [7.4, 10.6], HBA1C: [7.1, 9.2] },
  lipids: { CHOL: [5.7, 7], TG: [1.8, 2.7] },
  hypothyroid: { TSH: [5.6, 11.5] },
  liver: { ALT: [52, 88], AST: [41, 58] },
  vitd: { VITD: [8, 18] },
};
export function profilesOf(icd: string[]): string[] {
  const p = new Set<string>();
  for (const c of icd) {
    if (/^(D50|D64|N92)/.test(c)) p.add('anemia');
    if (/^(J0|J20|J03|A09|N30|N10|N39|N70|N76)/.test(c)) p.add('infection');
    if (/^E1[01]/.test(c)) p.add('diabetes');
    if (/^(E78|I10|I11|I20|I25|E66)/.test(c)) p.add('lipids');
    if (/^(E03|E06)/.test(c)) p.add('hypothyroid');
    if (/^K76/.test(c)) p.add('liver');
    if (/^E55/.test(c)) p.add('vitd');
  }
  return [...p];
}

/** Parameters that are often a little above the range without a diagnosis behind it (diet, a cold, a hard day). */
const MILD = new Set(['WBC', 'ESR', 'ALT', 'AST', 'GLU', 'TG', 'UREA', 'TSH']);
const round = (v: number, dec: number) => Number(v.toFixed(dec));
/**
 * Values for one lab template: normal (sex/age aware) unless the diagnosis explains a deviation, plus a small share of
 * random mild deviations. `fixed` pins parameters (trend series, planted critical values). CHOL is derived so that
 * LDL = CHOL − HDL − TG/2.2 (Friedewald) and the lipid panel stays internally consistent.
 */
export function labValues(template: any[], sex: string, age: number, profiles: string[], rnd: () => number, fixed: Record<string, number> = {}): Row[] {
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const inRange = ([a, b]: Range) => a + (b - a) * rnd();
  const out: Record<string, number> = {};
  const draw = (code: string): number => {
    if (fixed[code] !== undefined) return fixed[code];
    for (const p of profiles) { const r = PROFILE[p]?.[code]; if (r) return inRange(r); }
    const g = NORMAL[code]?.(sex, age);
    if (!g) return NaN;
    let v = g.mean + g.sd * gauss();
    if (g.min !== undefined) v = Math.max(g.min, v);
    if (g.max !== undefined) v = Math.min(g.max, v);
    // a few mild, unexplained deviations, as in real life
    if (MILD.has(code) && rnd() < 0.05) { const t = template.find((x) => x.code === code); if (t?.ref_high != null) v = t.ref_high * (1.04 + rnd() * 0.12); }
    return v;
  };
  for (const p of template) {
    const code = p.code;
    if (code === 'PRO') { out.PRO = fixed.PRO ?? (rnd() < 0.85 ? 0 : round(0.033 + rnd() * 0.06, 3)); continue; }
    if (code === 'INR') continue;
    if (['CHOL', 'LDL'].includes(code)) continue;
    out[code] = draw(code);
  }
  if (template.some((p) => p.code === 'CHOL')) {
    const hdl = out.HDL, tg = out.TG;
    const ldl = fixed.LDL ?? (profiles.includes('lipids') ? 3.6 + rnd() * 1.2 : 1.9 + rnd() * 1.05);
    out.LDL = ldl;
    out.CHOL = fixed.CHOL ?? ldl + hdl + tg / 2.2;
  }
  if (template.some((p) => p.code === 'INR')) out.INR = fixed.INR ?? Math.pow((out.PT ?? 12.8) / 12.6, 1.05);
  if (out.RBC !== undefined && out.HGB !== undefined && fixed.RBC === undefined) out.RBC = Math.max(2.4, out.HGB / (age < 12 ? 27.5 : 30.5) + gauss() * 0.12); // MCH ≈ 30 pg (≈ 27 pg in children)
  const DEC: Record<string, number> = { HGB: 0, RBC: 2, WBC: 1, PLT: 0, ESR: 0, ALT: 0, AST: 0, CREA: 0, UREA: 1, GLU: 1, HBA1C: 1, CHOL: 2, LDL: 2, HDL: 2, TG: 2, TSH: 2, SG: 3, PH: 1, PRO: 3, PT: 1, INR: 2, FER: 0, VITD: 0 };
  return template.map((p) => {
    const v = round(out[p.code], DEC[p.code] ?? 1);
    const lo = p.ref_low, hi = p.ref_high;
    const flag = lo != null && v < lo ? 'low' : hi != null && v > hi ? 'high' : 'normal';
    return { code: p.code, name: p.name, unit: p.unit, ref_low: lo, ref_high: hi, value: String(v), flag };
  });
}
