/**
 * Starter note templates shipped with the product (Uzbek Latin, concise, clinically neutral, no drugs).
 * A static list, independent of the demo seed and its PRNG: `ensureStarterTemplates(tenantId)` inserts them once per
 * clinic (`db:create-clinic`, the demo reset and the API start for existing demo databases). The clinic edits or hides
 * them afterwards; a hidden starter stays hidden (`starter_key` is unique per clinic).
 *
 * `order_service_codes` are the seed catalogue's service codes (L01 = UQT, P01 = EKG …); a clinic without that code
 * simply gets the template without that proposed order. ICD codes come from the starter MKB-10 list (migration 006).
 */
export interface StarterTemplate {
  key: string;
  specialty: string | null;
  name: string;
  fields: { complaints?: string; anamnesis?: string; examination?: string; diagnosis?: string; recommendations?: string };
  icd_codes: string[];
  order_service_codes: string[];
  sort: number;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'therapist-arvi', specialty: 'Terapevt', name: 'O‘RVI (shamollash)', sort: 10,
    fields: {
      complaints: 'Harorat ko‘tarilishi, tomoq og‘rig‘i, burun bitishi, umumiy holsizlik.',
      anamnesis: 'Kasallik 2–3 kun oldin o‘tkir boshlangan. Oilada shunga o‘xshash bemor bor/yo‘q. Surunkali kasalliklar: yo‘q.',
      examination: 'Umumiy ahvoli qoniqarli. Halqum shilliq qavati giperemiyalangan, bodomcha bezlari kattalashmagan. O‘pkada vezikulyar nafas, xirillash yo‘q. Yurak tonlari ritmik.',
      diagnosis: 'O‘tkir respirator virusli infeksiya, yengil kechishi.',
      recommendations: 'Uy rejimi 3–5 kun, ko‘p suyuqlik ichish, xonani shamollatish. Harorat 38,5 °C dan oshsa yoki 3 kundan keyin yaxshilanmasa — qayta ko‘rik.',
    },
    icd_codes: ['J06.9'], order_service_codes: ['L01'],
  },
  {
    key: 'therapist-hypertension', specialty: 'Terapevt', name: 'Gipertoniya — nazorat ko‘rigi', sort: 20,
    fields: {
      complaints: 'Vaqti-vaqti bilan bosh og‘rig‘i, bosh aylanishi. Qon bosimi ko‘tarilishi epizodlari.',
      anamnesis: 'Arterial gipertoniya bir necha yildan beri. Doimiy davolanishni oladi/olmaydi. Uyda qon bosimini o‘lchaydi.',
      examination: 'Umumiy ahvoli qoniqarli. Yurak tonlari ritmik, aorta ustida II ton aksenti. O‘pkada o‘zgarish yo‘q. Shish yo‘q.',
      diagnosis: 'Arterial gipertoniya, nazorat ko‘rigi.',
      recommendations: 'Qon bosimini kuniga 2 marta o‘lchab, kundalik yuritish. Tuzni cheklash, vazn nazorati, kuniga 30 daqiqa yurish. Qayta ko‘rik — 1 oydan keyin natijalar bilan.',
    },
    icd_codes: ['I10'], order_service_codes: ['P01', 'L02', 'L05'],
  },
  {
    key: 'therapist-gastritis', specialty: 'Terapevt', name: 'Gastrit', sort: 30,
    fields: {
      complaints: 'Epigastral sohada og‘riq va og‘irlik, ovqatdan keyin kuchayadi. Jig‘ildon qaynashi, ko‘ngil aynishi.',
      anamnesis: 'Shikoyatlar bir necha haftadan beri. Ovqatlanish tartibi buzilgan. Dori qabul qilish bilan bog‘liqlik: yo‘q.',
      examination: 'Til oq karash bilan qoplangan. Qorin yumshoq, epigastriyda palpatsiyada og‘riqli. Jigar va taloq kattalashmagan.',
      diagnosis: 'Surunkali gastrit, zo‘rayish davri.',
      recommendations: 'Parhez: kam-kam va tez-tez ovqatlanish, achchiq, yog‘li va qovurilgan ovqatlardan tiyilish. Chekish va spirtli ichimliklarni cheklash. Qayta ko‘rik — tekshiruv natijalari bilan.',
    },
    icd_codes: ['K29.7'], order_service_codes: ['U01'],
  },
  {
    key: 'therapist-back-pain', specialty: 'Terapevt', name: 'Bel og‘rig‘i', sort: 40,
    fields: {
      complaints: 'Bel sohasida og‘riq, harakatda kuchayadi. Oyoqqa tarqalish: yo‘q.',
      anamnesis: 'Og‘riq jismoniy zo‘riqishdan/noqulay harakatdan keyin boshlangan. Ilgari shunga o‘xshash epizodlar bo‘lgan.',
      examination: 'Bel-dumg‘aza sohasida paravertebral mushaklar tarang, palpatsiyada og‘riqli. Harakat hajmi cheklangan. Lasseg simptomi manfiy. Sezuvchanlik buzilmagan.',
      diagnosis: 'Bel sohasidagi og‘riq (lyumbalgiya).',
      recommendations: 'Og‘ir yuk ko‘tarmaslik, qattiq o‘rinda yotish. Og‘riq kamaygach — bel mushaklari uchun mashqlar. Oyoqda uvishish yoki kuchsizlik paydo bo‘lsa — darhol murojaat.',
    },
    icd_codes: ['M54.5'], order_service_codes: [],
  },
  {
    key: 'paediatrics-arvi', specialty: 'Pediatr', name: 'O‘RVI (bola)', sort: 10,
    fields: {
      complaints: 'Ota-onasi so‘zidan: harorat ko‘tarilishi, burun oqishi, yo‘tal, ishtaha pasayishi.',
      anamnesis: 'Kasallik 1–2 kun oldin boshlangan. Bog‘chaga/maktabga qatnaydi. Emlashlar yosh bo‘yicha. Allergiya: yo‘q.',
      examination: 'Umumiy ahvoli qoniqarli, faol. Teri toza. Halqum giperemiyalangan. Burun nafasi qiyinlashgan. O‘pkada puerilli nafas, xirillash yo‘q. Qorin yumshoq.',
      diagnosis: 'O‘tkir respirator virusli infeksiya.',
      recommendations: 'Uy rejimi, ko‘p suyuqlik, burunni tuzli eritma bilan yuvish. Harorat 38,5 °C dan oshsa, nafas qiyinlashsa yoki bola juda lanj bo‘lsa — darhol murojaat. Qayta ko‘rik — 3 kundan keyin.',
    },
    icd_codes: ['J06.9'], order_service_codes: ['L01'],
  },
  {
    key: 'paediatrics-bronchitis', specialty: 'Pediatr', name: 'O‘tkir bronxit (bola)', sort: 20,
    fields: {
      complaints: 'Ota-onasi so‘zidan: yo‘tal (avval quruq, keyin balg‘amli), harorat, holsizlik.',
      anamnesis: 'O‘RVI fonida 3–5-kuni yo‘tal kuchaygan. Ilgari bronxit: yo‘q. Allergiya: yo‘q.',
      examination: 'Umumiy ahvoli o‘rtacha og‘irlikda. Nafas tezligi yoshiga mos. O‘pkada qattiq nafas, ikki tomonlama tarqoq quruq va nam xirillashlar. Yurak tonlari ritmik.',
      diagnosis: 'O‘tkir bronxit.',
      recommendations: 'Ko‘p iliq suyuqlik, xona havosini namlash, chekilgan tutundan saqlash. Nafas qiyinlashsa, hushtaksimon nafas yoki harorat 3 kundan ortiq davom etsa — qayta ko‘rik.',
    },
    icd_codes: ['J20.9'], order_service_codes: ['L01'],
  },
  {
    key: 'cardiology-consult', specialty: 'Kardiolog', name: 'Kardiolog konsultatsiyasi', sort: 10,
    fields: {
      complaints: 'Yurak sohasida noqulaylik, yurak urishi tezlashishi, jismoniy yuklamada hansirash.',
      anamnesis: 'Shikoyatlar bir necha oydan beri. Arterial gipertoniya: bor/yo‘q. Chekish: yo‘q. Oilada yurak-qon tomir kasalliklari: bor/yo‘q.',
      examination: 'Umumiy ahvoli qoniqarli. Yurak chegaralari normada, tonlari ritmik, shovqin yo‘q. O‘pkada vezikulyar nafas. Periferik shish yo‘q. Oyoq arteriyalarida puls simmetrik.',
      diagnosis: 'Kardiolog ko‘rigi: xulosa tekshiruvlardan keyin aniqlashtiriladi.',
      recommendations: 'Tekshiruvlar: EKG, EXO-KG, lipid profil. Jismoniy faollik o‘rtacha, tuz va yog‘ni cheklash. Qayta ko‘rik — natijalar bilan.',
    },
    icd_codes: [], order_service_codes: ['P01', 'U05', 'L05'],
  },
  {
    key: 'neurology-headache', specialty: 'Nevrolog', name: 'Bosh og‘rig‘i', sort: 10,
    fields: {
      complaints: 'Ikki tomonlama, siquvchi xarakterdagi bosh og‘rig‘i, kun oxirida kuchayadi. Ko‘ngil aynishi, yorug‘likdan qo‘rqish: yo‘q.',
      anamnesis: 'Og‘riq epizodlari bir necha oydan beri, haftada 1–3 marta. Stress va uyqu buzilishi bilan bog‘liq. Bosh jarohati: yo‘q.',
      examination: 'Hushi aniq. Kalla-miya nervlari funksiyasi buzilmagan. Pay reflekslari simmetrik. Meningeal belgilar yo‘q. Bo‘yin va ensa mushaklari tarang, palpatsiyada og‘riqli.',
      diagnosis: 'Taranglik tipidagi bosh og‘rig‘i.',
      recommendations: 'Uyqu tartibini yo‘lga qo‘yish, ekran oldida tanaffuslar, bo‘yin mushaklari uchun mashqlar, bosh og‘rig‘i kundaligi. Og‘riq xarakteri o‘zgarsa yoki birdan kuchli og‘riq bo‘lsa — darhol murojaat.',
    },
    icd_codes: ['G44.2'], order_service_codes: [],
  },
  {
    key: 'gynaecology-consult', specialty: 'Ginekolog', name: 'Ginekolog konsultatsiyasi', sort: 10,
    fields: {
      complaints: 'Profilaktik ko‘rik. Qorin pastida og‘riq, hayz buzilishi: yo‘q.',
      anamnesis: 'Hayz sikli muntazam. Homiladorlik va tug‘ruqlar soni: ___. Ginekologik operatsiyalar: yo‘q. Oxirgi ko‘rik: ___.',
      examination: 'Tashqi jinsiy a’zolar to‘g‘ri rivojlangan. Oynada: bachadon bo‘yni toza. Bimanual: bachadon normal o‘lchamda, harakatchan, og‘riqsiz; ortiqlar aniqlanmaydi.',
      diagnosis: 'Ginekologik profilaktik ko‘rik.',
      recommendations: 'Kichik chanoq a’zolari UZI. Yillik profilaktik ko‘rik. Shikoyat paydo bo‘lsa — vaqtidan oldin murojaat.',
    },
    icd_codes: ['Z01.4'], order_service_codes: ['U04'],
  },
  {
    key: 'ultrasound-abdomen-normal', specialty: 'UZI mutaxassisi', name: 'Qorin bo‘shlig‘i UZI — normada', sort: 10,
    fields: {
      complaints: 'Qorin bo‘shlig‘i a’zolarini tekshirish uchun yo‘naltirilgan.',
      examination: 'Jigar: o‘lchamlari normada, konturlari tekis, parenximasi bir xil, o‘rtacha exogenlikda, o‘t yo‘llari kengaymagan. O‘t pufagi: shakli odatiy, devori qalinlashmagan, bo‘shlig‘ida konkrement yo‘q. Me’da osti bezi: o‘lchamlari normada, konturlari tekis. Taloq: o‘lchamlari normada, strukturasi bir xil. Buyraklar: joylashuvi odatiy, o‘lchamlari normada, kosacha-jom tizimi kengaymagan, konkrement yo‘q. Erkin suyuqlik yo‘q.',
      diagnosis: 'Qorin bo‘shlig‘i a’zolarida exografik patologiya aniqlanmadi.',
      recommendations: 'Yo‘naltirgan shifokor ko‘rigi.',
    },
    icd_codes: [], order_service_codes: [],
  },
  {
    key: 'ent-otitis', specialty: 'LOR', name: 'O‘tkir o‘rta otit', sort: 10,
    fields: {
      complaints: 'Quloqda og‘riq, eshitish pasayishi, harorat ko‘tarilishi.',
      anamnesis: 'Shikoyatlar o‘tkir boshlangan, O‘RVI dan keyin. Ilgari quloq kasalliklari: yo‘q.',
      examination: 'Otoskopiya: nog‘ora parda giperemiyalangan, bo‘rtgan, yorug‘lik refleksi yo‘q. Tashqi eshituv yo‘li toza. Burun nafasi qiyinlashgan. Halqum giperemiyalangan.',
      diagnosis: 'O‘tkir o‘rta otit.',
      recommendations: 'Quloqni issiq saqlash, suv tushirmaslik, burun nafasini tiklash. Og‘riq kuchaysa, quloqdan ajralma chiqsa yoki harorat saqlansa — darhol qayta ko‘rik. Nazorat ko‘rigi — 5–7 kundan keyin.',
    },
    icd_codes: ['H66.9'], order_service_codes: ['L01'],
  },
  {
    key: 'dentistry-consult', specialty: 'Stomatolog', name: 'Stomatolog konsultatsiyasi', sort: 10,
    fields: {
      complaints: 'Profilaktik ko‘rik. Tish og‘rig‘i, milk qonashi: yo‘q.',
      anamnesis: 'Oxirgi stomatolog ko‘rigi: ___. Tishlarni kuniga 2 marta tozalaydi. Allergiya (anestetiklarga): yo‘q.',
      examination: 'Yuz simmetrik. Og‘iz shilliq qavati och pushti, nam. Milk shishmagan. Tish qatori: tish toshlari oz miqdorda, kariyes bo‘shliqlari: ___. Tishlam: ortognatik.',
      diagnosis: 'Stomatologik profilaktik ko‘rik.',
      recommendations: 'Professional gigiena. Kuniga 2 marta tozalash, tish ipi. Profilaktik ko‘rik — 6 oyda bir.',
    },
    icd_codes: [], order_service_codes: [],
  },
];
