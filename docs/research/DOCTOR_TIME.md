# Shifokor vaqti qayerga ketadi va uni qanday qaytarish mumkin — Med.uz.ai uchun tadqiqot

Sana: 2026-10-20. Manbalar raqam bilan `[n]` ko‘rsatilgan, ro‘yxat oxirida. Tekshira olmagan raqamlarim alohida «Tasdiqlanmagan» bo‘limida.

---

## English summary

**Where the time goes.** Ambulatory physicians spend about half their working day on the EHR and desk work: 49.2% vs 27.0% face time (Sinsky 2016, 57 physicians, time-motion) [1]. EHR audit logs show 5.9 h of an 11.4 h day in the EHR, 1.4 h of it after clinic, with 44.2% of EHR time on clerical/administrative tasks and 23.7% on the inbox (Arndt 2017) [2]. Across ~100 M Cerner encounters the EHR took ~16 min per encounter: chart review 33%, documentation 24%, orders 17% (Overhage 2020) [4]. At MGB/BWH, primary-care physicians spent a median of 36.2 EHR minutes per visit, including 6.2 min of «pajama time» and 7.8 min of inbox (Rotenstein 2023) [5]. Quality-measure reporting cost 785 h per physician per year in the US (Casalino 2016) [6]. In Russia a federal photo-timing study of district therapists found that **47.31% of an outpatient visit goes to medical records** (Liutsko 2019, 39 doctors, 6,474 measurements) [9]. A 2020 draft Minzdrav order capped documentation at 40% of visit time [10]. In 2026 Putin ordered a cut in doctors' paperwork, with a report due 1 Aug 2026 [12]. Kazakhstan's government says that merging systems so data is entered once and documents are generated automatically cut doctors' data-entry time by 40% (10 Sep 2026, official, method not published) [16]. Uzbekistan has MED-ID records for 36 M+ citizens and has moved 28 certificate types to electronic form (Nov 2025), but has published no figures on time saved [20].

**What works.** Ambient AI scribes have the strongest evidence, but the effect is moderate:
- TPMG/Kaiser: 2.58 M encounters, 7,260 physicians, an estimated 15,791 h saved in 63 weeks [21].
- UCLA RCT (NEJM AI, 238 physicians): Nabla cut time-in-note 9.5% more than control (4:30 → 3:49 min); DAX was not significant [22].
- Atrium (NEJM AI): no significant group-level efficiency gain [23].
- Burnout fell in pre-post studies: from 51.9% to 38.8% at 6 systems (Olson 2025) [25], and by 21.2 points absolute at MGB [26].
- Penn: 20% less EHR time per visit and 30% less after-hours time [27].
- The best-measured error rates were 1.47% of sentences hallucinated and 3.45% omitted (CREOLA, npj Digit Med 2025) [33].
- NHS England says scribes that summarise with generative AI are likely medical devices [28].

AI-drafted patient replies **reduce cognitive load but do not save time**: Stanford drafts were used in 20% of replies with no change in time [34]; at UCSD, read time rose 21.8% and replies got 17.9% longer [35]. LLMs alone are poor coders (GPT-4 exact match on ICD-10-CM: 33.9%) [41], so codes must be retrieved and validated. Pre-visit summaries are being adopted (Moscow: 23 M+ AI pre-visit summaries) [15], but the evidence on time saved is mostly self-reported [36]. Discharge summaries drafted by LLMs were of equivalent overall quality but had more errors per summary (2.91 vs 1.82) [37]. Keeping up with the literature in primary care would take 627.5 h/month [48]. Personalised alerts raised use of an evidence service by 57% in a cluster RCT (McMaster PLUS) [49], and the leaders (Doximity, Medscape, OpenEvidence, UpToDate) personalise by specialty and reading history and use licensed sources [44–47].

**Uzbek speech-to-text** is the main risk for voice features:
- Whisper large-v3 zero-shot on Uzbek is very poor: 86–97% WER in third-party tests [50c][50d].
- ElevenLabs reports, as a vendor, Scribe v1 at 15.9% and Gemini Flash 2 at 32% on FLEURS [50c].
- UZINFOCOM reports Muxlisa (self-reported, Apr 2026) at 11.39% on call-centre audio and 13.42% on YouTube audio [50a].
- Google Chirp 3 supports uz-UZ only in Preview and without diarization [50e]. Yandex SpeechKit supports Uzbek [50f].
- No medical-domain Uzbek WER is published anywhere I could find.

**Recommendation (10 features, ranked).**
- Stage 1, buildable now with text-only AI on our stack: (1) auto-drafted document pack from the signed note; (2) pre-visit summary; (3) specialty templates and one-click order/repeat sets; (4) automatic monthly/statistical reports; (5) specialty news 2.0 (subspecialty, follow topics, weekly Telegram digest for the doctor, «practice-changing» flag).
- Stage 2: (6) push-to-talk dictation in Uzbek/Russian → structured note; (7) retrieval-based ICD-10 and service coding; (8) triage of patient Telegram messages (admin answers only, clinical questions routed to the doctor as a task).
- Stage 3: (9) a full ambient scribe with consent; (10) integration with DMED / e-prescription / electronic certificates to remove double entry.

Every AI output stays a draft that the doctor must sign. We should also measure our own «time-in-note» and «after-hours» metrics from audit timestamps, so that we can prove any time saved.

---

## 1. Shifokor vaqti qayerga ketadi (xalqaro dalillar)

### 1.1. Asosiy raqamlar

| Tadqiqot | Usul | Asosiy natija |
|---|---|---|
| Sinsky va boshq., *Annals of Internal Medicine*, 2016 [1] | Kuzatuv (time-motion), 57 shifokor, 4 mutaxassislik, 430 soat | Ish kunining **49,2%** EHR va stol ishiga, **27,0%** bemor bilan yuzma-yuz ishga ketadi. Bemor bilan har 1 soatga ~2 soat stol ishi to‘g‘ri keladi. Kechqurun 1–2 soat qo‘shimcha (asosan EHR). |
| Arndt va boshq., *Annals of Family Medicine*, 2017 [2] | EHR audit log + kuzatuv, birlamchi bo‘g‘in | 11,4 soatlik ish kunidan **5,9 soat** (355 daq) EHR’da. Shundan 4,5 soat qabul vaqtida, **1,4 soat qabuldan keyin**. EHR vaqtining **44,2%** kotiblik/ma’muriy ish, **23,7%** inbox (xabarlar qutisi). |
| Tai-Seale va boshq., *Health Affairs*, 2017 [3] | 31 mln EHR yozuvi, 471 shifokor, 2011–2014 | Kuniga o‘rtacha 3,08 soat qabul va **3,17 soat «stol tibbiyoti»**: xabarlar, retsept uzaytirish, buyurtmalar, natijalarni ko‘rish. Bu ishlarning aksariyatiga haq to‘lanmaydi. |
| Overhage, McCallie, *Annals of Internal Medicine*, 2020 [4] | ~100 mln qabul, ~155 ming shifokor (Cerner) | Bir qabulga o‘rtacha **16 daq 14 s** EHR. Taqsimot: kartani ko‘rish **33%**, hujjat yozish **24%**, buyurtma **17%**. EHR vaqtining 11% ish vaqtidan tashqarida. Mualliflar Cerner bilan bog‘liq. |
| Rotenstein va boshq., *JAMA Network Open*, 2023 [5] | 307 birlamchi bo‘g‘in shifokori, MGB/BWH, 2021 | Bir tashrifga mediana **36,2 daq EHR**. Shundan **6,2 daq «pijama vaqti»** (ish kunlari 17:30–07:00 oralig‘i va dam olish kunlari) va **7,8 daq inbox**. Klinikalar orasida 23,5–47,9 daq. |
| Casalino va boshq., *Health Affairs*, 2016 [6] | AQSh amaliyotlari so‘rovi | Sifat ko‘rsatkichlari hisobotiga yiliga **785 soat/shifokor** va **15,4 mlrd $** ketadi. Haftasiga 12,5 soat faqat hisobot uchun ma’lumot kiritishga sarflanadi. |

### 1.2. Boshqa yuklamalar

- **Oldindan ruxsat (prior authorization, AQSh):** AMA 2017 so‘rovi bo‘yicha haftasiga 37 so‘rov, shifokor va xodimlarning 16,4 soati [7]. So‘nggi (2025-dekabr) so‘rov bo‘yicha ~40 so‘rov va ~13 soat (CMA keltirgan qisqacha mazmun) [7b]. O‘zbekistonda sug‘urta tizimi boshqacha, shuning uchun bu bizga bevosita taalluqli emas.
- **Charchash (burnout):** Medscape 2024 hisobotida shifokorlarning 49% charchaganini aytgan. Asosiy sabab «ortiqcha byurokratik vazifalar» (**62%**) [8].
- **Bemor xabarlari:** pandemiyadan keyin portal xabarlari keskin oshgan. Stanford mualliflari pandemiya davrida +157% o‘sishni keltiradi [34].
- **Adabiyotni kuzatish:** birlamchi bo‘g‘in uchun oyiga ~7 287 dolzarb maqola chiqadi. Ularning hammasini baholash uchun oyiga **627,5 soat** kerak bo‘ladi (Alper 2004) [48]. Ya’ni hamma narsani «o‘zim o‘qiyman» degan yondashuv amalda imkonsiz, saralash va qisqacha xulosa zarur.

**Xulosa:** vaqt asosan uch joyga ketadi: (a) hujjat yozish va eski kartani o‘qish, (b) buyurtma, xat, ma’lumotnoma kabi «qog‘oz» ishlari, (c) xabarlar va hisobotlar. Har bir qabulda takrorlanadigan va bir xil ma’lumotni qayta kiritishni talab qiladigan ishlar avtomatlashtirish uchun eng yaxshi nishondir.

---

## 2. MDH mamlakatlari

### 2.1. Rossiya

- **Eng ishonchli o‘lchov.** Lyutsko V.V., Son I.M., Ivanova M.A. va boshq., *Терапевтический архив*, 2019 [9]. Fotoxronometraj usuli, 17 hududda 39 uchastka terapevti, 6 474 o‘lchov. Poliklinikadagi bir tashrif o‘rtacha 15,3 daq davom etadi. Shundan **47,31% tibbiy hujjatlar bilan ishlashga**, 45,54% asosiy (klinik) faoliyatga ketadi.
- **Me’yor loyihasi.** Minzdrav 2020-yilgi buyruq loyihasida «hujjat to‘ldirish qabul vaqtining 40% dan oshmasligi kerak» deb yozgan (Snob, 2020-06-08) [10]. Loyiha qabul qilinganini tasdiqlay olmadim.
- **Hisob palatasi.** Shifokorlar ish vaqtining «yarmigacha» qismini tibbiy bo‘lmagan vazifalarga sarflaydi (dp.ru 2026-04-13 keltirgan; yil va metodika ko‘rsatilmagan) [11]. Xuddi shu maqolaga ko‘ra, 2023-yildagi Minzdrav pilot loyihasi qog‘oz shakllarni bekor qilishi kerak edi. Amalda esa «ikki kontur» paydo bo‘ldi: shifokor ham qog‘oz, ham elektron hujjat yuritadi [11].
- **Siyosiy qaror.** Putin RSPP s’yezdi yakunlari bo‘yicha shifokor va o‘qituvchilarning «qog‘oz yuklamasini» kamaytirishni topshirgan, hisobot muddati 2026-08-01 [12]. Sog‘liqni saqlash vaziri Murashko buni AI yordamida qilishni rejalashtirgan [12b].
- **Avtomatlashtirish natijalari:**
  - *Voice2Med* (ЦРТ/Speech Technology Center): rus tilida ovoz orqali protokol to‘ldirish, 62 hududda ishlatiladi. ITMO o‘quv materialida hujjat tayyorlash vaqti **~20%** qisqargani aytilgan, metodika ko‘rsatilmagan [13].
  - *Yandex* AI-assistenti (2026-06): shifokor–bemor suhbatidan qabul protokolini to‘ldiradi. Ishlab chiquvchi protokol 35 soniyagacha tayyor bo‘lishini va aniqlik >90% ekanini aytadi. Shifokor qoralamani tekshirib, MISga saqlaydi [14].
  - *Moskva, EMIAS* (Moskva sog‘liqni saqlash departamenti rahbari o‘rinbosari maqolasi, 2026-06-21): **23 mln dan ortiq AI qabulgacha xulosa** tayyorlangan, 20 ta generativ AI xizmati ishlaydi, «Aqlli qabul» 2025-yilda ishga tushgan. Shifokor vaqti necha daqiqaga tejalgani **e’lon qilinmagan** [15].

### 2.2. Qozog‘iston

- **Damumed** milliy MIS bo‘lib, 2 500 tashkilotda 160 mingdan ortiq tibbiyot xodimi ishlatadi [18b]. ISSAI (Nazarboyev universiteti) va Damumed 2026-06-16 da ovozli AI-assistent prototipini taqdim etdi. U suhbatdan tuzilgan qabul yozuvini yaratadi. Raqamlar va qo‘llab-quvvatlanadigan tillar e’lon qilinmagan [18].
- **Hukumat (2026-09-10)** 12 ta vazirlik tizimidan 7 tasi birlashtirilganini e’lon qildi: ma’lumot bir marta kiritiladi, hujjatlar avtomatik yaratiladi. Natijada «shifokorlarning ma’lumot kiritishga sarflaydigan vaqti 40% ga qisqargan» [16]. Bu rasmiy da’vo, metodika e’lon qilinmagan. Xuddi shu xabarda AI teleradiologiya tashxis vaqtini 4 baravardan ko‘proq qisqartirgani, AKYLMED.AI esa kelmay qolishlarni ~3 baravar kamaytirgani aytilgan [16].
- 2025-08-20 dagi rasmiy xabarda «MIS optimallashtirilishi yuklamani ~40% ga kamaytirdi» va 8 turdagi eng ko‘p so‘raladigan ma’lumotnoma raqamlashtirildi, deyilgan [17].
- **Saboq:** Qozog‘istondagi eng katta yutuq AI’dan emas, **takroriy kiritishni yo‘qotishdan** kelgan («bir marta kirit — hamma shakl o‘zi to‘lsin»).

### 2.3. Belarus

Ochiq manbalarda shifokor vaqti bo‘yicha o‘lchov topilmadi. Elektron tibbiy karta to‘g‘risidagi Minzdrav qarori 2021-yilda qabul qilingan. Bemor rozilik bermasa, hujjatlar qog‘ozda yuritiladi [19]. Natijalar haqida ishonchli raqam yo‘q.

### 2.4. O‘zbekiston (kontekst)

- DMED tizimida **36 mln dan ortiq** fuqaroning yagona elektron tibbiy kartasi (MED-ID) bor. **28 turdagi ma’lumotnoma** elektron shaklga o‘tgan. 560 mingdan ortiq xodim faoliyati tizimda hisobga olinadi. Laboratoriya natijasi 3–5 daqiqada avtomatik shakllanadi (yuz.uz, 2025-11-13) [20a].
- Prezident farmonida tibbiyot xodimlari yuklamasini raqamlashtirish va qog‘oz aylanmasini kamaytirish orqali **30% ga** pasaytirish ko‘zda tutilgan (podrobno.uz, 2025-05-22). 30% nimaga nisbatan hisoblangani aytilmagan [20b].
- 2025-yil aprelida DMED 2 571 ta birlamchi muassasadan 2 475 tasida o‘rnatilgan edi. Elektron retsept Toshkentning Yunusobod tumanida sinovdan o‘tgan [20c].
- **Bizga ma’nosi:** davlat yo‘nalishi «qog‘ozsiz»likka qarab ketyapti. Xususiy klinikada esa shifokor hali ham bir ma’lumotni ham klinika tizimiga, ham davlat tizimiga, ham qog‘ozga yozadi. Bu farqni yopish (3-bosqich, 10-funksiya) eng katta tejamni beradi, ammo davlat API’siga bog‘liq.

---

## 3. Natija bergan avtomatlashtirish (2023–2026)

### 3.1. Ambient AI-kotib (suhbatni tinglab qayd yozish)

| Tadqiqot / manba | Dizayn | Natija |
|---|---|---|
| The Permanente Medical Group (Kaiser), *NEJM Catalyst* 2024 va 2025 [21] | 63 hafta (2023-10 → 2024-12), 7 260 shifokor, 2 576 627 qabul | Taxminan **15 791 soat** hujjat vaqti tejalgan (1 794 ish kuni). Shifokorlarning 84% muloqotga, 82% ish qoniqishiga ijobiy ta’sir qayd etgan. Bemorlarning 47% shifokor kompyuterga kamroq qaraganini aytgan. |
| UCLA, Lukac/Mafi, *NEJM AI* 2025 [22] | **RCT**, 238 shifokor, 14 mutaxassislik: DAX va Nabla nazorat guruhiga qarshi | Nabla bir qaydga ketadigan vaqtni 4:30 → 3:49 daq ga qisqartirdi, bu nazoratdan **9,5%** ko‘proq (statistik ahamiyatli). DAX ahamiyatli emas. Charchash ikkalasida kamaygan. «Klinik ahamiyatli noaniqlik» vaqti-vaqti bilan uchragan. |
| Atrium Health, *NEJM AI* 2024 [23] | 112 DAX foydalanuvchisi va 103 nazorat, 180 kun | **Guruh darajasida samaradorlik va moliyaviy ko‘rsatkichlarda farq yo‘q.** Faqat ko‘p ishlatganlarda kichik kamayish bor. |
| Haberle va boshq., *JAMIA* 2024 [24] | DAX, 99 foydalanuvchi va 76 nazorat | Mahsuldorlik va hujjat vaqtida amaliy o‘zgarish yo‘q. Ish vaqtidan tashqari EHR vaqti hatto oshgan. |
| Olson va boshq., *JAMA Network Open* 2025 [25] | 6 tizim, 263 klinitsist, 30 kun, oldin/keyin | Charchash **51,9% → 38,8%**. Ish vaqtidan tashqari hujjat vaqti kamaygan. Ma’lumot yig‘ishga Abridge yordam bergan. |
| Mass General Brigham / Emory, *JAMA Network Open* 2025 [26] | 1 430 klinitsist | MGB’da 84-kunda charchash **21,2 foiz punktga** kamaygan. So‘rovga javob berganlar kam (22–30%). |
| Penn Medicine, *JAMA Network Open* 2025 [27] | 46 klinitsist, DAX Copilot | Tashrifga EHR vaqti **−20%**, ish vaqtidan tashqari vaqt **−30%** (50,6 → 35,4 daq/kun). Qaydga ketadigan vaqt 10,3 → 8,2 daq. |
| GOSH / NHS England, TORTUS [29] | 7 000+ bemor, ko‘p sohalar, oraliq natijalar | Ishlab chiquvchi keltirgan raqamlar: bevosita bemor vaqti **+23,5%**, ambulator qabulda ~5 daq tejash. Tez yordam bo‘yicha preprintda baholash 17 → 15 daq. To‘liq hisobot mustaqil tekshirilmagan. |
| Microsoft Dragon Copilot, 2025-03-03 press-relizi [30] | 879 klinitsist so‘rovi (2024-07) | O‘zi bildirgan baho: qabulga **~5 daq** tejash, 70% charchash kamayganini aytgan. Ishlab chiquvchi ma’lumoti. |

**Muhim xulosalar:**
- Samara bor, ammo mo‘tadil. Qat’iy RCTlarda qaydga ketadigan vaqt bir necha foizdan ~10–20% gacha kamaygan. Charchash va kognitiv yuk sezilarli kamaygan. Vaqtdan ko‘ra «miya yuki» kamayishi kuchliroq ko‘rinadi.
- Natija mahsulotga qarab farq qiladi: UCLA’da Nabla ahamiyatli bo‘ldi, DAX esa yo‘q [22]. Foydalanish darajasiga ham bog‘liq: Kaiser’da eng faol uchdan bir qism ishga tushirishlarning 89% ini bergan [21].
- **Xavfsizlik:** TORTUS jamoasining CREOLA tadqiqotida (Asgari va boshq., *npj Digital Medicine* 2025) 12 999 gapdan **1,47%** to‘qima (hallucination) chiqqan. Ularning 44% «jiddiy» deb baholangan. Transkript gaplarining **3,45%** tushib qolgan (omission) [33]. Demak, shifokor qoralamani o‘qib imzolashi shart.
- **Tartibga solish:** NHS England qo‘llanmasiga ko‘ra (2025-aprel, keyin yangilangan), oddiy transkripsiya tibbiy buyum bo‘lmasligi mumkin. Generativ AI bilan xulosa qiladigan kotib esa **tibbiy buyum sifatida ro‘yxatdan o‘tishi kerak bo‘lishi ehtimoli katta**. Qo‘llanma DPIA, xavf tahlili va baholashni talab qiladi [28].
- Bozor: Abridge 2025-yilda «Best in KLAS — Ambient Speech» bo‘lgan (95,1 ball) [31]. Heidi Health (Avstraliya) 2025-oktabrda 65 mln $ Series B oldi va NHS GP’larining 60% dan ortig‘i undan yo‘llanma va xatlar uchun foydalanishini aytadi (ishlab chiquvchi da’vosi) [32].

### 3.2. Bemor xabarlariga AI qoralama javob va inbox

- **Stanford** (Garcia va boshq., *JAMA Netw Open* 2024): 162 klinitsist, 5 hafta. Qoralamalarning o‘rtacha **20%** ishlatilgan. Javob, yozish va o‘qish vaqtida **o‘zgarish yo‘q**, lekin kognitiv yuk va charchoq kamaygan [34].
- **UC San Diego** (Tai-Seale va boshq., *JAMA Netw Open* 2024-04-15): randomizatsiya qilingan sifat loyihasi, 52 shifokor va 70 nazorat. O‘qish vaqti **+21,8%**, javob vaqti o‘zgarmagan (−5,9%, ahamiyatsiz), javob uzunligi **+17,9%** [35].
- **Xulosa:** bu funksiya vaqtni tejamaydi, faqat «yaxshiroq va hamdardroq javob» beradi. Bizning qoidaga ko‘ra Telegram’ga klinik matn yuborilmaydi, shuning uchun bu bizda past ustuvorlikka ega.

### 3.3. Qabulgacha karta xulosasi (pre-charting)

- Overhage tadqiqotida kartani ko‘rish EHR vaqtining eng katta qismi (33%) [4].
- **Navina** (AAFP Innovation Lab, 2022, 10 shifokor, 30 kun): shifokorlar tayyorgarlik vaqti **61%** kamayganini aytgan (o‘zi bildirgan, kichik pilot) [36]. Navina’ning 30–40% lik boshqa raqamlari ishlab chiquvchi yoki homiylik materiallaridan olingan.
- **Moskva EMIAS:** 23 mln dan ortiq AI qabulgacha xulosa [15]. Bu keng qo‘llanish dalili, vaqt tejash dalili emas.

### 3.4. Avtomatik xatlar: yo‘llanma, chiqish epikrizi, ma’lumotnoma

- **Chiqish epikrizi (UCSF, Williams va boshq., *JAMA Intern Med* 2025; preprint 2024):** 100 ta yotib davolanish holati, 22 ta shifokor ko‘r-ko‘rona baholagan. LLM epikrizi umumiy sifatda shifokornikiga **teng**, qisqaroq va izchilroq, lekin to‘liqligi kamroq. Xatolar ko‘proq: bir epikrizga **2,91 va 1,82**, zarar ehtimolidagi farq esa ahamiyatsiz [37].
- **Imperial College (2026, JMIR AI):** 1 294 haqiqiy yotib davolanish holati, GPT-4o-mini qoralamasi. Shifokorlar AI yordamidagi epikrizni ko‘proq tasdiqlagan. Ba’zan noto‘g‘ri ma’lumot chiqqani uchun ko‘rib chiqish shart [38].
- **Buyuk Britaniya hukumati (2025-08):** Chelsea & Westminster’da AI chiqish hujjatlarini qoralama qiladi, klinitsist tekshiradi. Natija raqamlari hali e’lon qilinmagan [39].
- **Klinika xatlari:** Ali va boshq., *Lancet Digital Health* 2023 pilotida xatlar yuqori to‘g‘rilik va «insoniylik» bahosini olgan [40a]. Ortopediya bo‘yicha *BMJ Open* 2024 tadqiqotida xatlar o‘qishli va asosan to‘g‘ri, ammo **izchil emas, ba’zan ortiqcha qo‘shimcha yoki tushib qolish bor** [40b].
- **Xulosa:** xat va hujjat qoralamasi qisqa vaqtda foyda beradigan, xavfi boshqariladigan yo‘nalish. Shart: manba allaqachon tasdiqlangan qayd bo‘lsin va shifokor imzolasin.

### 3.5. Avtomatik kodlash (MKB-10/CPT)

- Soroush va boshq., *NEJM AI* 2024-04-19 (Mount Sinai): GPT-4 ning aniq moslik darajasi ICD-10-CM bo‘yicha **33,9%**, CPT bo‘yicha 49,8%. Hamma model 50% dan past [41].
- Qidiruv vositasi berilganda (retrieval) natija ancha yaxshilanishini da’vo qiluvchi preprint bor [41b].
- **Bizga ma’nosi:** biz to‘g‘ri yo‘ldamiz. Kod faqat `icd10_codes` jadvalidan olinadi va server tekshiradi. Keyingi qadam: avval qidiruv bilan nomzod kodlarni topish, keyin LLM ulardan tanlaydi.

### 3.6. Avtomatik sifat va statistik hisobotlar

- Casalino [6]: AQSh’da sifat hisobotining asosiy xarajati faqat hisobot uchun ma’lumotni qo‘lda kiritish (haftasiga 12,5 soat/shifokor).
- Qozog‘iston [16]: ma’lumot bir marta kiritilib, hujjat avtomatik yaratilganda kiritish vaqti 40% ga kamaygan (rasmiy).
- **Bizga ma’nosi:** hisobotni AI emas, **tuzilgan ma’lumotdan oddiy SQL bilan** yaratish kerak. Biz allaqachon xizmat, shifokor, kassa hisobotlarini shunday qilamiz. Rasmiy statistik shakllarga kengaytirsa bo‘ladi.

### 3.7. Startaplar va tanlov g‘oliblari (faqat manbasi borlari)

- **VA AI Tech Sprint (AQSh Faxriylar ishlari vazirligi), 2024-05-21:** 150 dan ortiq kompaniya qatnashgan. «Ambient» yo‘nalishida Microsoft DAX Copilot g‘olib bo‘lgan. Vazifa klinitsist ma’muriy yukini kamaytirish edi: suhbatdan hujjat, qabuldan keyingi xulosa va **yo‘llanma xatlari** [42].
- **Y Combinator:** W23 to‘plamida Glass Health (klinik qaror va ambient kotib), Hippo Scribe (reabilitatsiya uchun hujjat) bor [43a]. Ularning vaqt tejash bo‘yicha mustaqil natijalari topilmadi.
- **AMSA Innovation Fest 2025** g‘olibi «Eden»: jadval, sug‘urta tekshiruvi, billing va kartani avtomatlashtiradi (talabalar tanlovi) [43b].
- MIT Hacking Medicine, Health 2.0, HLTH, Slush: shifokor vaqtini tejash g‘oyasi bilan g‘olib bo‘lgan, manbasi tasdiqlangan loyiha **topilmadi**. Slush 100 2024 g‘olibi OASYS NOW bemor ma’lumotlari platformasi, hujjat vositasi emas [43c].

### 3.8. Shaxsiylashtirilgan mutaxassislik yangiliklari va uzluksiz ta’lim

| Platforma | Qanday shaxsiylashtiradi | Dalil / ko‘lam |
|---|---|---|
| **Doximity** | Lenta mashinaviy o‘rganish bilan shifokorning amaliyoti, nashrlari va **o‘qish tarixiga** qarab moslashtiriladi | AQSh shifokorlarining 80% dan ortig‘i a’zo. Lentani 1 mln dan ortiq noyob provayder o‘qigan (FY2025 Q3) [45] |
| **Medscape** | Profildagi mutaxassislik bo‘yicha sarlavhalar, sozlamada o‘zgartiriladi. **Kichik mutaxassislik (subspecialty) yo‘q** | Yordam markazi [46] |
| **OpenEvidence** | Savol-javob, manba ko‘rsatiladi. NEJM (2025-02) va JAMA Network (2025-06) bilan litsenziya shartnomasi | 2025-12 da oyiga ~18 mln konsultatsiya, 2026-03-10 da bir kunda 1 mln (ishlab chiquvchi ma’lumoti) [44] |
| **UpToDate Expert AI** (2025-09-24) | Javoblar faqat UpToDate’ning ekspertlar yozgan kontentidan, manba havolasi bilan | Ishlab chiquvchi ma’lumoti [47] |
| **McMaster PLUS** (Haynes va boshq., JAMIA 2006, klaster RCT, 203 shifokor) | Mutaxassisligiga mos maqolalar haqida **faol ogohlantirish**. Maqolalarni klinitsistlar dolzarblik va yangilik bo‘yicha baholaydi | Ogohlantirish olgan guruhda xizmatdan oylik foydalanuvchilar ulushi **+57%** [49] |

**Nima ishlaydi:** (1) mutaxassislik va kichik mutaxassislik bo‘yicha saralash; (2) «mavzuni kuzatish»; (3) o‘qish tarixidan o‘rganish; (4) «itarish» (push) shaklidagi dayjest, passiv sahifadan ko‘ra yaxshi (McMaster RCT); (5) ishonchli manba va havola; (6) qisqa, amaliy xulosa: «amaliyotni o‘zgartiradimi?».

---

## 4. Med.uz.ai uchun tavsiya: 10 funksiya (ustuvorlik bo‘yicha)

Hamma funksiyalar uchun umumiy qoidalar (CLAUDE.md bilan mos):
- AI faqat `AiClient.json()` orqali chaqiriladi, bemor matni avval `redact()` dan o‘tadi.
- AI natijasi doim **qoralama**. Shifokor ko‘rib chiqmaguncha hech narsa saqlanmaydi, imzolanmaydi va bemorga ketmaydi.
- MKB-10 kodlari faqat jadvaldan olinadi. Klinik ma’lumot faqat shifokorga ko‘rinadi.
- Gemini bepul tarifiga haqiqiy klinik matn yuborilmaydi.

### 1-bosqich — hozir qura olamiz (matnli AI, mavjud stek)

**1. Qabul yakunida «hujjatlar paketi» qoralamasi**
- *Nima qiladi:* imzolangan qayd va MKB-10 dan bir bosishda yo‘llanma, ma’lumotnoma, ko‘chirma va bemorga tavsiyalar varaqasining qoralamasini to‘ldiradi. Shifokor tahrir qilib «Berish» ni bosadi, hujjat mavjud o‘zgarmas hujjatlar oqimiga tushadi.
- *Dalil:* xat va epikriz qoralamalari umumiy sifatda shifokornikiga teng, ammo ko‘proq xato qiladi [37][38][40]. Heidi bu ishni asosiy funksiya qilib olgan [32]. VA tanlovi yo‘llanma xatini aniq talab qilgan [42]. Hujjat ishlari Rossiyadagi tashrif vaqtining 47% ini oladi [9].
- *Ma’lumot:* imzolangan qayd, tashxis va kodlar, bemor demografiyasi, klinika rekvizitlari. Tasdiqlangan laboratoriya natijalari faqat shifokor tanlasa qo‘shiladi.
- *Qiyinligi:* **past–o‘rta**. Hujjat jadvallari, chop etish va ICD validatsiyasi tayyor. Kerak bo‘ladiganlari: zod sxemasi va har hujjat turi uchun prompt. Uzbek va rus tilidagi rasmiy uslub namunalari shifokor tomonidan tekshirilishi kerak.
- *Xavf:* to‘qima yoki tushib qolish. Qoralama faqat qayddagi faktlardan tuziladi va har bir maydon qaysi jumladan olinganini ko‘rsatadi (manba-izoh). Hujjatdagi tashxis faqat imzolangan qayddan olinadi (mavjud qoida).

**2. Qabulgacha xulosa (pre-visit summary)**
- *Nima qiladi:* navbatdagi bemor uchun bitta ekran: oldingi tashriflar, faol tashxislar, retseptlar, tasdiqlangan tahlillar dinamikasi, ochiq yo‘llanmalar va «bugungi shikoyat» (registratsiyadan). Avval qoidaga asoslangan qism (SQL), ixtiyoriy ravishda LLM bilan 5 qatorlik matn.
- *Dalil:* kartani ko‘rish EHR vaqtining 33% ini oladi [4]. Navina pilotida tayyorgarlik vaqti −61% (o‘zi bildirgan) [36]. Moskvada 23 mln dan ortiq xulosa tayyorlangan [15].
- *Ma’lumot:* encounters, imzolangan qaydlar, lab (faqat tasdiqlangan), hujjatlar.
- *Qiyinligi:* **past** (SQL qismi), LLM qismi o‘rta.
- *Xavf:* eskirgan yoki noto‘g‘ri xulosa. Har bir band manba yozuvga havola qilinadi. Faqat shifokor ko‘radi. Registrator va kassir ko‘rmaydi.

**3. Mutaxassislik shablonlari va «bir bosishda» buyurtmalar**
- *Nima qiladi:* har mutaxassislik uchun qayd shablonlari, sevimli tahlil va xizmat to‘plamlari (order set), «oldingi retseptni takrorlash», odatiy tavsiyalar kutubxonasi. AI kerak emas.
- *Dalil:* buyurtma EHR vaqtining 17% ini oladi [4]. To‘plamlar bu ulushni qanchaga kamaytirishi haqida ishonchli raqam topilmadi (Tasdiqlanmagan).
- *Ma’lumot:* xizmatlar katalogi, lab panellari, shifokorning tarixi (eng ko‘p ishlatgani).
- *Qiyinligi:* **past**. *Xavf:* deyarli yo‘q, faqat «nusxa ko‘chirish» xatosi bo‘lishi mumkin. Shuning uchun takrorlangan matn ajratib ko‘rsatiladi.

**4. Avtomatik hisobotlar (shifokor, rahbar, statistika)**
- *Nima qiladi:* oylik shifokor hisoboti (qabullar, tashxislar bo‘yicha taqsimot, qaytgan bemorlar), rahbar uchun sifat ko‘rsatkichlari (imzolanmagan qaydlar, kechikkan natijalar) va rasmiy statistik shakllar uchun eksport, bir tugma bilan. AI faqat izoh beradi («hisobotni tushuntir» bor). Raqamlar SQL’dan olinadi.
- *Dalil:* AQSh’da faqat hisobot uchun ma’lumot kiritishga 785 soat/yil sarflanadi [6]. Qozog‘istonda «bir marta kiritish» yondashuvi 40% tejagan [16].
- *Ma’lumot:* mavjud jadvallar. Pul qoidalari: tiyin, `NET_LINE`, sof daromad.
- *Qiyinligi:* **past–o‘rta**. O‘zbekiston rasmiy shakllarining aniq ro‘yxati va formati alohida aniqlanishi kerak (Tasdiqlanmagan).
- *Xavf:* noto‘g‘ri yig‘indi. Hisobot testlar bilan qoplanadi. AI raqam o‘ylab topmaydi, faqat tayyor raqamlarni so‘z bilan izohlaydi.

**5. Mutaxassislik yangiliklari 2.0**
- *Nima qiladi:* mavjud PubMed va AI dayjestiga qo‘shimchalar:
  - kichik mutaxassislik va «mavzuni kuzatish» (masalan, «yurak yetishmovchiligi», «GLP-1»);
  - jurnal va dalil darajasi filtri (RCT, meta-tahlil, klinik qo‘llanma);
  - «amaliyotni o‘zgartiradimi?» belgisi va 3 qatorlik xulosa (o‘zbek/rus), PubMed havolasi bilan;
  - haftalik dayjest shifokorning **o‘z** Telegram chatiga. Bu bemor ma’lumoti emas, faqat ochiq adabiyot, shuning uchun klinik matn qoidasiga zid emas;
  - baho va o‘qish tarixidan o‘rganish (bizda «o‘qildi», «saqlash», «baho» bor);
  - ixtiyoriy: «bu maqola bo‘yicha savol ber», javob faqat maqola annotatsiyasidan.
- *Dalil:* hamma narsani o‘qish uchun oyiga 627,5 soat kerak [48]. Faol ogohlantirish foydalanishni +57% oshirgan [49]. Doximity o‘qish tarixidan shaxsiylashtiradi [45]. Medscape’da kichik mutaxassislik yo‘q, bu bizga farqlanish imkonini beradi [46].
- *Ma’lumot:* PubMed E-utilities (annotatsiya), shifokor profili, o‘qish signallari. Bemor ma’lumoti kerak emas.
- *Qiyinligi:* **past–o‘rta**. *Xavf:* annotatsiyani noto‘g‘ri tarjima qilish yoki xulosani bo‘rttirish. Doim asl sarlavha va havola ko‘rsatiladi va «AI xulosasi» deb belgilanadi. To‘liq matn qayta tarqatilmaydi (litsenziya).

### 2-bosqich — tayyorgarlik bilan (3–6 oy)

**6. Ovozli diktovka (tugmani bosib gapirish) → tuzilgan qayd**
- *Nima qiladi:* qabuldan keyin shifokor o‘zbek yoki rus tilida 30–90 soniya gapiradi. STT matnga aylantiradi, mavjud «qaydni tartiblash» uni maydonlarga ajratadi. Bu ambient emas: bemor suhbati yozilmaydi, faqat shifokor ovozi.
- *Dalil:* Voice2Med Rossiyada ~20% tejagan (metodika noma’lum) [13]. Ambient tizimlarning RCT natijalari pastki chegara sifatida qaralishi mumkin [22].
- *O‘zbek STT holati:*
  - Whisper large-v3 o‘zbek tilida tayyor holda **juda yomon**: FLEURS’da WER 86–97% [50c][50d].
  - ElevenLabs Scribe v1 FLEURS’da 15,9%, Gemini Flash 2 esa 32% (ElevenLabs o‘lchagan) [50c].
  - Muxlisa (UZINFOCOM, 2026-04-24) WER 11,39% (call-markaz) va 13,42% (YouTube), o‘zi bildirgan [50a].
  - Aisha «90–95% aniqlik» deydi, metodikasiz [50b].
  - Google Chirp 3 da uz-UZ faqat **Preview**, diarizatsiya yo‘q [50e]. Yandex SpeechKit o‘zbek tilini qo‘llab-quvvatlaydi va 2025-yilda sifatni yaxshilagan [50f].
  - Ochiq fine-tune modellar (Whisper asosida) FLEURS’da ~10–26% WER deydi (model kartalari, o‘zaro solishtirib bo‘lmaydi) [50g].
  - **Tibbiy lug‘at va o‘zbek–rus aralash nutq bo‘yicha e’lon qilingan WER yo‘q.**
- *Tavsiya:* 2–3 ta provayderni (Muxlisa, Yandex, ElevenLabs/Google) o‘zimizning 50–100 ta sintetik tibbiy diktovkamizda (o‘zbek, rus va aralash) sinab, WER’ni o‘zimiz o‘lchaymiz. Transkript ekranda tahrir qilinadi. Audio saqlanmaydi.
- *Qiyinligi:* **o‘rta**. *Xavf:* ovoz shaxsiy ma’lumot, biometrik deb qaralishi mumkin. Audio O‘zbekistondan tashqariga chiqishi huquqiy jihatdan tekshirilishi kerak (Tasdiqlanmagan). Dori nomlari va dozalarni noto‘g‘ri tanish xavfi bor: raqam va dozalar alohida ajratib ko‘rsatiladi.

**7. Kodlash yordamchisi: MKB-10 va xizmatlar (qidiruv + LLM)**
- *Nima qiladi:* qayddan avval qidiruv bilan nomzod MKB-10 kodlari va hisob-fakturaga tushadigan xizmatlar topiladi, LLM ulardan tanlaydi va asosini ko‘rsatadi. Shifokor tasdiqlaydi.
- *Dalil:* yolg‘iz LLM yomon koder: ICD-10-CM bo‘yicha aniq moslik 33,9% [41]. Qidiruv bilan yaxshilanadi [41b].
- *Ma’lumot:* rasmiy MKB-10 ro‘yxati (`db:import-icd10`), xizmatlar katalogi.
- *Qiyinligi:* **o‘rta**. *Xavf:* hisob-fakturaga noto‘g‘ri xizmat tushishi. Faqat taklif qilinadi, kassaga avtomatik yozilmaydi.

**8. Bemor Telegram xabarlari triaji**
- *Nima qiladi:* kelgan xabarni turlarga ajratadi: ma’muriy (vaqt, narx, tayyorgarlik) savollarga bot qoidalar asosida javob beradi. Klinik savol esa shifokorga «qo‘ng‘iroq qilish yoki qabulga yozish» vazifasi bo‘lib boradi. Telegram’ga klinik matn yuborilmaydi.
- *Dalil:* AI qoralama javoblar vaqt tejamagan, faqat kognitiv yukni kamaytirgan [34][35]. Shuning uchun biz qoralama emas, **yo‘naltirish**ni avtomatlashtiramiz.
- *Qiyinligi:* **o‘rta**. Booking qoidalari `booking.ts` da, bildirishnomalar outbox orqali. *Xavf:* shoshilinch holatni o‘tkazib yuborish. «Shoshilinch» kalit so‘zlarida doim «103 ga qo‘ng‘iroq qiling» shablonini yuborish kerak.

### 3-bosqich — katta loyiha yoki tashqi bog‘liqlik

**9. To‘liq ambient AI-kotib (rozilik bilan)**
- *Nima qiladi:* qabul suhbatini (bemor roziligi bilan) tinglaydi va qayd, hujjat paketi hamda kodlarni qoralama qiladi.
- *Dalil:* eng kuchli xalqaro dalil shu yo‘nalishda. Kaiser 15 791 soat tejagan [21], UCLA RCT −9,5% [22], charchash kamaygan [25][26], Penn −20%/−30% [27]. Shu bilan birga Atrium va Haberle’da guruh darajasida samara yo‘q [23][24].
- *Ma’lumot:* audio, ikki nutqni ajratish (diarizatsiya), o‘zbek–rus aralash nutq.
- *Qiyinligi:* **yuqori**. O‘zbek STT va diarizatsiya yetuk emas [50e]. Shovqinli kabinetlar. Rozilik oqimi kerak (bizda O‘RQ-547 rozilik moduli bor). Tibbiy buyum maqomi bo‘lishi mumkin [28].
- *Xavf:* hallucination 1,47% va omission 3,45% [33]. Audio maxfiyligi va saqlash joyi (O‘zbekiston). Shifokor «o‘qimay imzolash» odatiga tushib qolishi mumkin.

**10. DMED, e-retsept va elektron ma’lumotnomalar bilan integratsiya**
- *Nima qiladi:* bizda yozilgan qayd, retsept va ma’lumotnoma davlat tizimiga bir marta kiritish bilan ketadi. Takroriy kiritish yo‘qoladi.
- *Dalil:* Qozog‘istonda «ma’lumot bir marta kiritiladi, hujjat avtomatik» yondashuvi 40% tejagan (rasmiy) [16]. Rossiyada esa «ikki kontur» muammosi bor [11]. O‘zbekistonda 28 turdagi ma’lumotnoma allaqachon elektron [20a].
- *Qiyinligi:* **yuqori, tashqi bog‘liq**. DMED API’siga xususiy klinika kirishi va uning shartlari ochiq manbalarda topilmadi (Tasdiqlanmagan).
- *Xavf:* davlat tizimining o‘zgarishi, sertifikatlash, shaxsiy ma’lumotlarni lokalizatsiya qilish.

### Qo‘shimcha (har bosqichda): o‘z o‘lchovimiz

Tejalgan vaqtni isbotlash uchun Epic Signal’dagiga o‘xshash ko‘rsatkichlarni o‘zimiz yig‘amiz. Ma’lumot audit va vaqt belgilaridan olinadi, klinik matnsiz:
- qayd ochilganidan imzolanguncha o‘tgan vaqt;
- ish vaqtidan keyin (Toshkent vaqti bilan 18:00 dan keyin) imzolangan qaydlar ulushi;
- AI qoralamasi qancha tahrir qilingani (tahrir masofasi);
- qoralamadan foydalanish ulushi.

Rotenstein [5] va Arndt [2] aynan shu usul bilan o‘lchagan. Har bir funksiyani pilotda «oldin–keyin» qilib o‘lchash kerak.

### Til bo‘yicha muhim eslatmalar

- O‘zbek (lotin) matnni LLM yaxshi tushunadi, ammo **rasmiy tibbiy uslubni** (yo‘llanma, ma’lumotnoma) shifokor tekshirishi kerak. Apostroflarni normallashtirish allaqachon `AiClient` da bor.
- Klinikada o‘zbek va rus tili aralash ishlatiladi, termin ko‘pincha ruscha yoki lotincha. STT sinovida aralash nutq albatta bo‘lishi kerak.
- Bemor nomi, dori nomi va xizmat nomi kabi ma’lumotlar transliteratsiya qilinmaydi (CLAUDE.md qoidasi). Hujjat qoralamasida ham shunday.

---

## 5. Tasdiqlanmagan

Quyidagilarni birlamchi manbadan tekshira olmadim yoki raqamlar manbalar orasida farq qiladi:

1. Hisob palatasining «yarmigacha vaqt tibbiy bo‘lmagan ishga ketadi» degan bahosi: yil va metodika noma’lum, faqat dp.ru keltirgan [11].
2. Rossiya ommaviy axborot vositalaridagi «hujjatga 30–50% vaqt ketadi» degan baho: birlamchi manbasi topilmadi.
3. Minzdravning 2020-yilgi «hujjat ≤40%» me’yori yakuniy qabul qilinganmi: faqat loyiha sifatida ko‘rildi [10].
4. Putin topshirig‘i bo‘yicha 2026-08-01 dagi hisobot natijalari topilmadi [12].
5. Qozog‘istondagi «40% tejash» (2025-08 va 2026-09): metodika e’lon qilinmagan [16][17]. Finratings.kz keltirgan «pilot AI hujjat vaqtini 40% gacha qisqartiradi» degan da’vo ham tekshirilmagan.
6. Damumed va ISSAI ovozli assistentining tillari, aniqligi va pilot natijalari e’lon qilinmagan [18].
7. Yandex AI-assistentidagi «>90% aniqlik» va «35 soniya» ishlab chiquvchi ma’lumoti. Moskva amaldorlarining «hujjatga vaqt kamaydi» degan gapi raqamsiz [14][15].
8. Voice2Med «~20%» (ITMO o‘quv materiali, metodikasiz) va «97–98% aniqlik» ishlab chiquvchi da’vosi [13].
9. TORTUS va GOSH bo‘yicha «+23,5% bemor vaqti» va «5 daq/qabul»: ishlab chiquvchi saytidan olingan, to‘liq NHS hisobotini o‘qimadim [29].
10. Microsoft «5 daq/qabul»: o‘zi bildirgan so‘rov [30]. Navina «30–40%»: ishlab chiquvchi yoki homiylik materiali [36].
11. Heidi «NHS GP’larining 60% dan ortig‘i» ishlab chiquvchi da’vosi. 2026-yilgi Series C haqidagi raqamlar bir-biriga zid [32].
12. OpenEvidence «AQSh shifokorlarining 40% dan ortig‘i har kuni» va konsultatsiyalar soni: kompaniya press-relizi [44].
13. O‘zbek STT raqamlari: Muxlisa (benchmark nomi yo‘q), Aisha (metodikasiz), ElevenLabs (raqobatchi marketingi, sahifada 3,1% va 15,9% bir-biriga zid). Tibbiy diktovkada hech biri sinalmagan [50].
14. Whisper large-v3 ning rasmiy FLEURS o‘zbek WER raqami: Whisper maqolasidagi jadvalni o‘zim ko‘rmadim [50d].
15. Order set va shablonlar qancha vaqt tejashi haqida ishonchli zamonaviy raqam topilmadi.
16. O‘zbekistonda xususiy klinikaning DMED, e-retsept va elektron ma’lumotnoma API’siga ulanish shartlari topilmadi. Rasmiy statistik shakllar ro‘yxati aniqlanmagan.
17. Ovoz yozuvi O‘zbekiston qonunchiligida biometrik ma’lumot hisoblanadimi: yuristdan so‘rash kerak.
18. Belarus bo‘yicha shifokor vaqti haqida hech qanday o‘lchov topilmadi.
19. MIT Hacking Medicine, Health 2.0, HLTH va Slush’da shifokor vaqtini tejash g‘oyasi bilan g‘olib bo‘lgan, manbasi tasdiqlangan loyiha topilmadi.
20. Haynes 2006 McMaster PLUS RCT raqamlari (+57%, 203 shifokor) qidiruv natijasidan olingan, to‘liq matnni ochmadim [49].
21. Yale Daily News’dagi «charchash 74% kamaydi» degan gap noto‘g‘ri talqin ko‘rinadi. Haqiqiy natija 51,9% → 38,8% [25].
22. Overhage va McCallie (2020) mualliflari Cerner bilan bog‘liq. «16 daqiqa» raqami tanqid qilingan (PNHP) [4].

---

## 6. Manbalar

**Vaqt taqsimoti (xalqaro)**
- [1] Sinsky CA va boshq. Allocation of Physician Time in Ambulatory Practice. *Ann Intern Med* 2016. https://doi.org/10.7326/M16-0961 ; qisqacha mazmun: https://pnhp.org/?p=8603
- [2] Arndt BG va boshq. Tethered to the EHR. *Ann Fam Med* 2017;15(5):419–426. https://www.annfammed.org/content/15/5/419
- [3] Tai-Seale M va boshq. *Health Affairs* 2017;36(4):655–662. https://www.natap.org/2018/HIV/hlthaff.2016.0811.pdf ; https://vitals.sutterhealth.org/electronic-health-record-logs-indicate-that-physicians-split-time-evenly-between-seeing-patients-and-desktop-medicine/
- [4] Overhage JM, McCallie D. *Ann Intern Med* 2020. https://www.fiercehealthcare.com/practices/for-each-patient-visit-physicians-spend-about-16-minutes-ehrs-study-finds ; tanqid: https://pnhp.org/news/16-minutes-ehr-time-per-ambulatory-patient-get-real/
- [5] Rotenstein LS va boshq. *JAMA Netw Open* 2023. https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2812258 ; https://www.ama-assn.org/practice-management/digital-health/primary-care-visits-run-half-hour-time-ehr-36-minutes
- [6] Casalino LP va boshq. *Health Affairs* 2016;35(3):401–406. https://pnhp.org/news/burden-of-reporting-quality-measures/
- [7] AMA prior authorization survey (2017). https://www.ama-assn.org/practice-management/prior-authorization/survey-quantifies-time-burdens-prior-authorization ; [7b] https://cmadocs.org/newsroom/news/view/ArticleId/51200/AMA-survey-highlights-ongoing-prior-auth-burdens-as-CMA-continues-reform-efforts
- [8] Medscape Physician Burnout & Depression Report 2024. https://www.webmd.com/corporate/press/20240124/medscape-physician-burnout-depression

**MDH va O‘zbekiston**
- [9] Люцко В.В., Сон И.М., Иванова М.А. и др. Затраты рабочего времени врачей-терапевтов участковых при посещении одним пациентом. *Терапевтический архив* 2019;91(1):8–23. DOI 10.26442/00403660.2019.01.000023. https://omnidoctor.ru/library/izdaniya-dlya-vrachey/terapevticheskiy-arkhiv/ta2019/ta2019_1_pp/zatraty-rabochego-vremeni-vrachey-terapevtov-uchastkovykh-pri-poseshchenii-odnim-patsientom
- [10] Snob, 2020-06-08. https://snob.ru/news/193848/
- [11] Деловой Петербург, 2026-04-13. https://www.dp.ru/a/2026/04/13/utonuli-v-otchjotah-pochemu
- [12] Profile.ru: Putin topshirig‘i. https://profile.ru/news/society/putin-poruchil-snizit-bumazhnuju-nagruzku-na-vrachej-i-uchitelej-1852570/amp/ ; [12b] RTVI, Murashko. https://rtvi.com/news/murashko-nagruzku-na-medikov-snizyat-s-pomoshhyu-ii/
- [13] Voice2Med: ITMO materiali https://kmu.itmo.ru/file/download/application/37569 ; ComNews 2023-05-31 https://www.comnews.ru/digital-economy/content/226489/2023-05-31/2023-w22/gruppa-crt-sdelala-dostupnym-golosovoy-vvod-dlya-vrachey-devyati-specialnostey
- [14] ComNews, 2026-06-25, Yandex AI-assistenti. https://www.comnews.ru/digital-economy/content/246021/2026-06-25/2026-w26/1012/yandeks-zapustil-ii-assistenta-dlya-medicinskikh-uchrezhdeniy
- [15] Kod.ru, 2026-06-21, I. Tyrov (Moskva DZM). https://kod.ru/ai-v-moskovskih-poliklinikah-cifrovaya-medicina
- [16] Qozog‘iston Bosh vaziri matbuot xizmati, 2026-09-10. https://primeminister.kz/en/news/olzhas-bektenov-reviews-implementation-of-presidential-directives-to-unify-fragmented-medical-information-systems-and-learns-about-ai-solutions-in-healthcare-31867
- [17] 24.kz, 2025-08-20. https://24.kz/ru/news/social/725501-ii-assistent-poyavitsya-u-vrachej-v-kazakhstane
- [18] ISSAI, 2026-06-16. https://issai.nu.edu.kz/2026/06/16/issai-and-damumed-presented-an-ai-powered-voice-assistant-to-help-physicians-reduce-administrative-burden/ ; [18b] Kazpravda «Помощник врача» https://kazpravda.kz/n/pomoshchnik-vracha/
- [19] Zerkalo (Belarus, elektron karta). https://news.zerkalo.io/life/35346.html
- [20a] yuz.uz, 2025-11-13. https://yuz.uz/ru/news/v-uzbekistane-sozdana-edinaya-elektronnaya-meditsinskaya-karta-naseleniya ; [20b] podrobno.uz, 2025-05-22. https://podrobno.uz/cat/obchestvo/nagruzka-snizitsya-pochti-na-tret-vracham-v-uzbekistane-poobeshchali-sokratit-byurokratiyu/ ; [20c] kun.uz, 2025-04-19. https://kun.uz/en/news/2025/04/19/uzbekistan-enhances-healthcare-system-with-new-digital-prescription-and-mobile-app-features

**Ambient AI-kotib**
- [21] AMA, 2025-06-11 (TPMG, *NEJM Catalyst*, DOI 10.1056/CAT.25.0040). https://www.ama-assn.org/practice-management/digital-health/ai-scribes-save-15000-hours-and-restore-human-side-medicine ; Kaiser DOR: https://divisionofresearch.kaiserpermanente.org/ai-assisted-notetaking-gains-steady-support-from-kaiser-permanente-physicians/
- [22] UCLA Health press-relizi (*NEJM AI* RCT). https://www.uclahealth.org/news/release/ucla-study-finds-ai-scribes-may-reduce-documentation-time
- [23] Atrium Health (*NEJM AI*). https://www.healthcareitnews.com/news/ambient-ai-doesnt-improve-efficiency-across-board-study-finds ; https://www.beckershospitalreview.com/healthcare-information-technology/ai/does-ai-make-clinicians-more-efficient-not-really-study-says-2/
- [24] Haberle T va boshq. *JAMIA* 2024. https://pubmed.ncbi.nlm.nih.gov/38345343/
- [25] Olson KD va boshq. *JAMA Netw Open* 2025;8(10):e2534976. https://www.healthday.com/healthpro-news/health-technology/ambient-artificial-intelligence-scribe-linked-to-reduction-in-burnout ; https://www.newswise.com/articles/study-ai-scribes-lower-physician-burnout-lend-patients-more-undivided-attention
- [26] Mass General Brigham press-relizi, 2025. https://www.massgeneralbrigham.org/en/about/newsroom/press-releases/ambient-documentation-technologies-reduce-physician-burnout ; Emory: https://news.emory.edu/stories/2025/08/study-finds-ambient-documentation-technology-reduces-burnout-and-increases-well
- [27] Penn Medicine, 2025-02. https://www.pennmedicine.org/news/ai-scribe-increases-face-to-face-time-with-patients ; https://www.beckershospitalreview.com/ai/ai-scribes-helping-with-clinician-efficiency-study
- [28] NHS England. Guidance on the use of AI-enabled ambient scribing products. https://www.england.nhs.uk/long-read/guidance-on-the-use-of-ai-enabled-ambient-scribing-products-in-health-and-care-settings/
- [29] GOSH: https://gosh.nhs.uk/news/gosh-pilots-ai-tool-to-give-clinicians-more-quality-time-with-patients ; TORTUS: https://tortus.ai/ ; tez yordam preprinti: https://www.medrxiv.org/content/10.64898/2025.11.27.25340564
- [30] Microsoft, 2025-03-03. https://news.microsoft.com/source/2025/03/03/microsoft-dragon-copilot-provides-the-healthcare-industrys-first-unified-voice-ai-assistant-that-enables-clinicians-to-streamline-clinical-documentation-surface-information-and-automate-task/
- [31] KLAS, Best in KLAS 2025 Ambient Speech. https://klasresearch.com/best-in-klas-ranking/ambient-speech/2025/487
- [32] Digital Health, 2025-10, Heidi Series B. https://www.digitalhealth.net/2025/10/heidi-health-raises-48m-in-series-b-funding-to-expand-globally/
- [33] Asgari E va boshq. *npj Digital Medicine* 2025;8:274, DOI 10.1038/s41746-025-01670-7. https://pmc.ncbi.nlm.nih.gov/articles/12075489/ ; preprint: https://www.medrxiv.org/content/10.1101/2024.09.12.24313556.full.pdf

**Xabarlar, karta xulosasi, xatlar, kodlash**
- [34] Stanford Medicine, 2024-03 (Garcia va boshq., *JAMA Netw Open*). https://med.stanford.edu/news/all-news/2024/03/ai-patient-messages.html
- [35] Tai-Seale M va boshq. *JAMA Netw Open* 2024;7(4):e246565. https://pmc.ncbi.nlm.nih.gov/articles/PMC11019394
- [36] AAFP Innovation Lab, Navina Phase 1. https://www.aafp.org/content/dam/AAFP/documents/practice_management/innovation_lab/report-navina-ai-clinical-review-phase-1.pdf
- [37] Williams CYK va boshq. (UCSF), *JAMA Intern Med* 2025; preprint: https://www.medrxiv.org/content/10.1101/2024.09.29.24314562.full.pdf ; https://www.the-hospitalist.org/hospitalist/article/40519/in-the-literature/llms-and-physicians-generate-comparable-hospital-discharge-summaries/
- [38] Imperial College London, iCARE. https://www.imperial.ac.uk/medicine/research-and-impact/groups/icare/research-and-analytics/icare-impact-stories-/could-ai-improve-discharge-summaries/
- [39] GOV.UK, 2025-08. https://www.gov.uk/government/news/ai-to-cut-paperwork-to-free-up-doctors-time-for-patients ; https://www.digitalhealth.net/2025/08/ai-assisted-tool-on-fdp-will-help-write-hospital-discharge-letters/
- [40a] Ali SR va boshq. *Lancet Digital Health* 2023, DOI 10.1016/S2589-7500(23)00048-1 ; [40b] *BMJ Open* 2024. https://bmjopen.bmj.com/content/14/3/e076484
- [41] Soroush A va boshq. *NEJM AI* 2024. https://sciencedaily.com/releases/2024/04/240422120603.htm ; [41b] arXiv 2407.12849. https://arxiv.org/pdf/2407.12849

**Tanlovlar va startaplar**
- [42] Microsoft blog, 2024-06-17 (VA AI Tech Sprint). https://www.microsoft.com/en-us/industry/blog/healthcare/2024/06/17/dax-copilot-ai-powered-solution-wins-ai-tech-sprint-to-reduce-clinician-burnout
- [43a] Y Combinator Healthcare IT kompaniyalari. https://www.ycombinator.com/companies/industry/healthcare-it ; [43b] AMSA Innovation Fest. https://www.amsa.org/innovation-fest-winner/ ; [43c] Slush 100. https://slush.org/slush-100/

**Yangiliklar va uzluksiz ta’lim**
- [44] OpenEvidence: NEJM bitimi https://openevidence.com/announcements/openevidence-and-nejm ; JAMA bitimi https://media.jamanetwork.com/announcement/openevidence-and-the-jama-network-sign-strategic-content-agreement/ ; Series D (2026-01-21) https://www.businesswire.com/news/home/20260121029132/en/OpenEvidence-Raises-%24250-Million-to-Build-Medical-... ; Series B (2025) https://www.healthcareittoday.com/2025/08/04/openevidence-the-fastest-growing-application-for-physicians-in-history-announces-210-million-round-at-3-5-billion-valuation/
- [45] Doximity FY2025 natijalari (SEC). https://www.sec.gov/Archives/edgar/data/1516513/000151651325000044/doximity-2025331xex991.htm ; Q1 2025 qo‘ng‘irog‘i: https://www.insidermonkey.com/blog/doximity-inc-nysedocs-q1-2025-earnings-call-transcript-1332482/
- [46] Medscape Help Center. https://help.medscape.com/hc/en-us/articles/360028865991-How-can-I-update-my-App-content-preference
- [47] Wolters Kluwer, 2025-09-24. https://www.wolterskluwer.com/en/news/uptodate-expert-ai-genai-clinical-decision-support
- [48] Alper BS va boshq. *J Med Libr Assoc* 2004;92(4):429–437. https://pmc.ncbi.nlm.nih.gov/articles/PMC521514
- [49] Haynes RB va boshq. McMaster PLUS klaster RCT, *JAMIA* 2006 (to‘liq matn ochilmadi). Qidiruv: https://pubmed.ncbi.nlm.nih.gov/?term=Haynes+McMaster+PLUS+cluster+randomized+2006

**O‘zbek nutqini tanish (STT)**
- [50a] UZINFOCOM, Muxlisa STT, 2026-04-24. https://uzinfocom.uz/en/news/522
- [50b] Aisha AI. https://aisha.group/en/speech-to-text ; https://aisha.group/en/blog/aisha-stt-ovozni-matnga
- [50c] ElevenLabs, Uzbek STT (raqobatchi benchmarki). https://elevenlabs.io/speech-to-text/uzbek
- [50d] Dolphin ASR, arXiv 2503.20212 (Whisper large-v3 o‘zbekcha WER 86,3, o‘z test to‘plamida). https://arxiv.org/pdf/2503.20212
- [50e] Google Cloud, Chirp 3. https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3
- [50f] Yandex SpeechKit release notes. https://yandex.cloud/en/docs/speechkit/release-notes-stt
- [50g] Ochiq modellar: BuzzASR https://huggingface.co/BuzzASR/uzbek ; piyola-v2 https://huggingface.co/idrock/piyola-v2 ; FeruzaSpeech korpusi https://arxiv.org/pdf/2410.00035
