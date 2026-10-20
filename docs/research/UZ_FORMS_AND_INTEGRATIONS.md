# O‘zbekistonda shifokor to‘ldiradigan tibbiy hujjatlar, hisobotlar, DMED va to‘lovlar — tadqiqot

Tayyorlangan sana: 2026-10-20. Tadqiqot faqat internetdagi ochiq manbalar asosida (lex.uz, gov.uz, dmed.uz, dhp.uz, GitHub, OAV). Har bir fakt yonida manba va sana bor. Tasdiqlanmagan narsalar **TASDIQLANMAGAN** deb belgilangan va oxirida alohida ro‘yxatda.

---

## English summary

- **The forms list exists, but the full official list is not public.** The Ministry of Health (SSV) approves the forms by internal orders that are not on lex.uz:
  - Order **No. 363 of 31.12.2020**, "Sog‘liqni saqlash muassasalarida birlamchi tibbiy hujjatlar shakllarini tasdiqlash haqida", cut the forms from 408 to 252.
  - Order **No. 16 of 17.01.2022** covers forms of ambulatory-polyclinic facilities.
  - The FHIR guide of the state Digital Health Platform (DHP) says its form catalogue is "based on **Ministry of Health Order 399**". The date of order 399 is **UNVERIFIED**.

  Uzbek numbering follows the Soviet scheme but has its own suffix "h/sh" (*hisob shakli*, accounting form) instead of "/у". Some numbers mean different things than in Russia. For example, the doctor's daily log is **024-1** in Uzbekistan, not 039/у.
- **Confirmed list of primary-care journals and cards.** SSV Order **No. 70 of 19.03.2025** abolished paper keeping of these forms and moved them into the "Yagona tibbiyot axborot tizimi" (unified medical information system, part of DMED) between April and July 2025:
  - 024 registration journal; 024-1 doctor's daily appointments; 024-2 OB/GYN appointments;
  - **025 outpatient card**; 030 "D" (dispensary) follow-up; 036 / 036-1 / 036-2 / 036-3 sick-leave registers; 064 vaccinations; 106 death certificates; 060 infectious diseases; 034 lab;
  - 035 medical advisory commission (VMK); 017 X-ray; 024-3 ECG; 025-4 dentist-orthodontist; 059 drugs; 069 ambulatory surgery, and others.

  DHP code lists add the certificate numbers:
  - 086 (applicants, athletes, job seekers), 086-1 (judge candidates), 086-2 (care homes), 053 (conscripts);
  - **094 / 095 / 138**: incapacity certificates for intoxication, for students, and for caring for a sick child;
  - the sick-leave certificate; 106 / 106-2 death certificates; **130 lab results**; 066 hospital discharge.
- **Sick leave is electronic-only since 01.01.2024.** Since the amendment of 15.09.2025 (MoJ reg. 2667-4), a **private** facility may issue sick leave only if it has qualified expert staff **and works as an inpatient facility**. An outpatient-only private clinic cannot issue sick leave.
- **E-prescriptions.** The rules come from Cabinet of Ministers (CM) Resolution **570 of 08.09.2025**:
  - created in the clinic's information system, signed with the doctor's e-signature (ERI), with a QR code;
  - required fields include ICD-10, the INN (international non-proprietary drug name), and for private clinics the licence number and tax ID (STIR).
- **Private clinics must connect to the state e-health system.**
  - Res. 570 makes real-time exchange with the "Elektron poliklinika / shifoxona / tibbiy karta / retsept" modules a **licence condition**: pilot areas from 10.12.2025, all regions from **01.01.2027**.
  - Presidential resolution **PQ-170 of 05.05.2026** adds that from **01.04.2027** medical licensing requires **mandatory, free integration of the clinic's own information system with the Digital Health Platform** under unified MoH standards. The standards were due about August 2026; **not found**.
  - SSV Order **No. 19 of 24.12.2025** (MoJ reg. 3758, 19.01.2026) is the user instruction for these modules: OneID or e-signature login, real-time entry, and PINFL (*JSHSHIR*, personal ID number) as the patient key.
- **The public API exists.** Uzinfocom publishes an **HL7 FHIR R5** implementation guide (`uz.dhp.core`, v0.11.1, 2026-10-14, *draft*), plus an Integrations guide with a sick-leave model and mappings for forms 011, 066, 066-1 and 130.
  - Playground: `playground.dhp.uz/fhir`; production: `fhir.dhp.uz`.
  - Auth: OAuth2 through `sso.dhp.uz` (client_credentials for backends, auth-code with PKCE via OneID for front-ends).
  - Identifiers: PINFL system `https://dhp.uz/fhir/core/sid/pid/uz/ni`; diagnoses in ICD-10.
  - How a vendor obtains client credentials is **not documented**.
- **Payments (§5):**
  - **Payme Merchant API:** JSON-RPC 2.0, Basic auth `Paycom:KEY`, amounts in tiyin, 7 methods including `SetFiscalData`, 12-hour timeout. The sandbox at test.paycom.uz needs a merchant cabinet.
  - **Click SHOP API:** Prepare/Complete with MD5 `sign_string`, amounts in so‘m. Click's public Playground and Postman generator let us test **without a contract**. The Merchant API and fiscalisation need real credentials.
  - **Fiscal receipts are mandatory, with no exemption found for clinics.** Payme or Click can fiscalise for us if we send the items with an IKPU (MXIK) code: group 109 "Medical services", e.g. 10902001027000000 for a neurologist consultation.
  - **VAT on medical services is contradictory** (reportedly 12% since 01.04.2024, while the classifier still shows an exemption), so it must stay configurable per service and per clinic.
- **Paperwork burden:** no Uzbek time-and-motion study exists. What exists:
  - SSV statements: 26 journals and 33 report forms (2021); about 15 minutes per visit, "part of it on paperwork".
  - **PF-88 (19.05.2025)** targets a cut of up to 30% in staff workload through less paperwork.
  - The ministry claims 70+ paper forms were dropped and workload cut by 30% (Nov 2025).
  - A deputy minister admitted parallel paper and electronic keeping (May 2026).
  - Closest benchmark: Russian district therapists spend 47% of a roughly 15-minute visit on documentation.
- **Top automation targets** (§7):
  1. Daily appointment log 024-1
  2. Outpatient card 025 / electronic medical record entry
  3. Lab result form 130
  4. Visit certificate (free-form)
  5. Prescription / e-prescription
  6. Referral
  7. Extract / epicrisis
  8. Periodic occupational exam package
  9. "D" follow-up 030
  10. Infectious disease register 060 and emergency notice

  Our biggest data gaps: patient **PINFL (JSHSHIR)**, the clinic's licence number and STIR, doctors' PINFL and e-signature, and an INN drug catalogue.

---

## 1. Asosiy normativ hujjatlar (shakllar va raqamlashtirish)

| Hujjat | Sana | Nima haqida | Manba |
|---|---|---|---|
| SSV buyrug‘i **363-son**, «Sog‘liqni saqlash muassasalarida birlamchi tibbiy hujjatlar shakllarini tasdiqlash haqida» | 31.12.2020 | 408 ta shakl 252 tagacha qisqartirildi; birlamchi tibbiy-sanitariya yordami (BTSY) va qon xizmatida 25 tur shakl qoldi (matnda noaniq). Matni lex.uz’da **yo‘q** (ichki buyruq). | Raqam va nom: SSV 23.06.2025 dagi 180-son buyrug‘iga ilova (autopsiya bo‘yicha milliy klinik protokol), 45-bet: https://api-portal.gov.uz/uploads/10/2026/03/02/900f305a-01e2-5e0a-1b54-a23f9f6f54bd_media_.pdf ; yangilik: https://www.uzreport.news/society/tibbiyot-muassasalarida-yuritiladigan-408ta-tibbiy-hujjat-shakllari-252tagacha-qisqartiril (05.01.2021) |
| SSV buyrug‘i **16-son**, «… ambulatoriya-poliklinika muassasalarida yuritiladigan tibbiy hisob hujjat shakllarini takomillashtirish to‘g‘risida» | 17.01.2022 | Ambulator shakllar; 01.02.2022 dan BTSY jurnallari 26 tadan 14 taga, 33 ta karta va blanka 14 tagacha qisqardi. | Olmaliq JSTI ichki ro‘yxati (PDF, ochilmadi), https://www.gazeta.uz/uz/2022/02/01/medicine/ (01.02.2022) |
| SSV buyrug‘i **399-son** | **sana TASDIQLANMAGAN** | Raqamli sog‘liqni saqlash platformasi (DHP) hujjat toifalari «Ministry of Health Order 399» asosida tuzilgan. Ehtimol, amaldagi shakllar katalogi shu buyruqda. | https://github.com/uzinfocom-org/digital-health-integration — `input/fsh/terminology/DocumentCategoryCS.fsh`, `docs/new-form.ru.md` («Источник данных — формы Приказа МЗ № 399»), 2026-10 holati |
| SSV buyrug‘i **70-son**, «Birlamchi tibbiy-sanitariya yordami muassasalarida tibbiy hisob hujjatlarini bosqichma-bosqich raqamlashtirish to‘g‘risida» | 19.03.2025 | Jurnal va blankalarni qog‘ozda yuritish bekor qilindi; ular «Yagona tibbiyot axborot tizimi»ga o‘tkazildi (01.04–01.07.2025, hududlar bo‘yicha). 2023-yil 28-apreldagi 92-son buyruq kuchini yo‘qotdi. SSV ning 17.12.2024 dagi 384-son buyrug‘iga (BTSY avtomatlashtirish talablari) havola bor. | Asl skan PDF (biz o‘qidik): https://my.tipme.uz/cabinet/uploads/library/1777615809_2025_%D0%B9%D0%B8%D0%BB_19_%D0%BC%D0%B0%D1%80%D1%82_%D0%A1%D0%A1%D0%92_%E2%84%9670_%D0%BE%D1%82%D0%BC%D0%B5%D0%BD%D0%B0_%D0%B6%D1%83%D1%80%D0%BD%D0%B0%D0%BB%D0%BE%D0%B2_.pdf |
| SSV buyrug‘i **19-son** (Adliya vazirligida ro‘yxat **3758**, 19.01.2026), «Elektron poliklinika», «Elektron shifoxona», «Elektron tibbiy karta» va «Elektron retsept» modullaridan foydalanish tartibi to‘g‘risidagi yo‘riqnoma | 24.12.2025; rasmiy e’londan 3 oy o‘tib kuchga kiradi (~20.04.2026) | **Barcha** tibbiyot tashkilotlari va dorixonalar uchun. Modulni o‘rnatish uchun SSV ga so‘rovnoma beriladi; UZINFOCOM 15 ish kunida bepul o‘rnatadi. Kirish OneID yoki elektron raqamli imzo (ERI) orqali. EMK’ga real vaqtda kiritiladi: JSHSHIR, F.I.Sh., tug‘ilgan sana, tashxis va ko‘rsatkichlar, lab/instrumental natijalar, e-retseptlar, ambulator va statsionar yozuvlar. Bemor bularni DMED ilovasida ko‘radi. | https://lex.uz/pdffile/-8007015 , https://lex.uz/docs/8007015 |
| Vazirlar Mahkamasi qarori **570-son**, «Sog‘liqni saqlash tizimini raqamlashtirish jarayonlarini yanada jadallashtirish bo‘yicha qo‘shimcha chora-tadbirlar to‘g‘risida» | 08.09.2025 (kuchga kirgan: 12.12.2025) | Barcha tibbiyot va farmatsevtika tashkilotlari DHP ga (u tayyor bo‘lguncha «Elektron sog‘liqni saqlash» tizimiga) ulanadi. 4 modul bilan real vaqtli almashuv **litsenziya sharti**: pilot hududlarda 10.12.2025 dan, butun respublikada 01.01.2027 dan. 1-ilova — e-retsept nizomi. | https://lex.uz/docs/7723519 (ru: https://lex.uz/ru/docs/7723519) |
| Prezident qarori **PQ-170**, «Tibbiyot sohasida ko‘rsatilayotgan xizmatlar sifatini oshirish bo‘yicha qo‘shimcha chora-tadbirlar to‘g‘risida» | 05.05.2026 (kuchga kirgan: 07.05.2026) | **4(a)-band:** «2027-yil 1-apreldan boshlab: tibbiy faoliyatni litsenziyalashda tibbiyot tashkilotlarining axborot tizimlarini … yagona talablarga (standartlarga) moslashtirgan holda Raqamli sog‘liqni saqlash platformasiga majburiy tartibda bepul integratsiya qilish orqali ma’lumot almashinuvini ta’minlash shartlari kiritiladi». 5(a): axborot tizimlariga yagona talablar 3 oyda tasdiqlanishi kerak edi (topilmadi). Yo‘l xaritasi 13.1: nodavlat tashkilotlarning birlamchi tibbiy hujjatlarini tasdiqlash va SSV ga statistika topshirish tartibi (muddat 2026-yil oktabr; topilmadi). | https://lex.uz/docs/8180707 , https://president.uz/oz/lists/view/9179 |
| Prezident qarori **PQ-415** | 28.12.2023 | UZINFOCOM yagona integrator. DHP KfW loyihasi (FHIR asosida). 7-band: barcha tibbiyot va farmatsevtika tashkilotlari platformaga bosqichma-bosqich **majburiy** ulanadi. Sohada axborot tizimlarini yaratish va joriy etish «majburiy tarzda Yagona integrator bilan kelishilgan holda» amalga oshiriladi (xususiy dasturga qo‘llanishi **TASDIQLANMAGAN**). | https://lex.uz/docs/-6719038 |
| Prezident farmoni **PF-88** | 19.05.2025 | 1(g): «tibbiyotda qogʻozbozlikni kamaytirish orqali tibbiyot xodimlari ish yuklamasini 30 foizgacha kamaytirish». 12-band: qabul jurnallari va statistik shakllar elektronga o‘tadi, «qogʻoz shaklidagi barcha tibbiy hisobotlar bekor qilinadi». | https://lex.uz/uz/docs/-7534275 |
| VM qarori **384-son** | 20.06.2025 | BTSY pilot (15 tuman, Samarqand viloyati 01.01.2026 dan). Ambulator karta elektron yuritiladi. | https://lex.uz/acts/-7595721 |

---

## 2. Ambulator shifokor (poliklinika / xususiy klinika) to‘ldiradigan birlamchi hujjatlar

**Raqamlash haqida.** O‘zbekistonda shakl raqami odatda «025 h/sh» (hisob shakli), «025-u» yoki «083/h» ko‘rinishida yoziladi. Masalan, lex.uz’da «ambulator bemorning tibbiy kartasi (025 h.sh.)» (IIV litseylari nizomi, ro‘yxat 2982) va «ambulator tibbiy karta (025-u shakli)» (xodimlarni tibbiy ko‘rikdan o‘tkazish nizomi, ro‘yxat 2387). Raqamlar sovet tizimidan kelgan, lekin ba’zilari Rossiyanikidan farq qiladi: shifokorning kundalik qabul jurnali O‘zbekistonda **024-1**, sovet/rus 039/у emas.

### 2.1. SSV 70-son buyrug‘ida (19.03.2025) nomi va raqami bilan ko‘rsatilgan jurnal va blankalar — TASDIQLANGAN

Barchasi BTSY muassasalarida qog‘ozda yuritilardi. 70-son buyruq bilan «Yagona tibbiyot axborot tizimi»ga (Elektron poliklinika / DMED) o‘tkazildi. Qog‘ozga faqat elektr yoki internet uzilganda vaqtincha ruxsat bor.

Manba (hammasi uchun): SSV 70-son buyrug‘i, 19.03.2025 (yuqoridagi PDF).

«ru» ustuni: buyruqda ruscha nom yo‘q. Ruscha nomlar **bizning tarjimamiz** (rasmiy emas).

| № | Nomi (uz, buyruqdagidek) | Nomi (ru, tarjima) | Kim / qachon | Elektronmi? |
|---|---|---|---|---|
| 024 | Ambulatoriya-poliklinika muassasasiga kelganlarni qayd etish jurnali | Журнал регистрации обратившихся в АПУ | Registratura, har bir murojaatda | Ha, 1-bosqich (01.04.2025 dan) |
| **024-1** | **Shifokorning kundalik qabul jurnali** | Журнал ежедневного приёма врача | Har bir shifokor, har bir qabulda | Ha, 1-bosqich |
| 024-2 | Akusher-ginekologning (doya) kundalik qabul jurnali | Журнал ежедневного приёма акушера-гинеколога (акушерки) | Akusher-ginekolog, har qabulda | Ha, 1-bosqich |
| 024-3 | EKG tekshiruvlarini qayd etish jurnali | Журнал регистрации ЭКГ | EKG xonasi | Ha, 2-bosqich (01.05.2025 dan) |
| 024-5 | Sog‘lom turmush tarzini shakllantirish jurnali | Журнал по формированию ЗОЖ | BTSY xodimlari | Ha, 2-bosqich |
| 023 | Chaqiruvlarni qayd etish jurnali | Журнал регистрации вызовов (на дом) | Registratura / shifokor | Ha, 2-bosqich |
| **025** | **Bemorning ambulator kartasi** | Медицинская карта амбулаторного больного | Har bir shifokor, har tashrifda | Ha, 2-bosqich (DMED «Elektron tibbiy karta») |
| 025-4 | Stomatolog ortoped va ortodontning qabul jurnali | Журнал приёма стоматолога-ортопеда и ортодонта | Stomatolog | Ha, 2-bosqich |
| 029 | Muolaja xonasida qon namunalari olishni qayd etish jurnali | Журнал забора крови в процедурном кабинете | Muolaja hamshirasi | Ha, 2-bosqich |
| 030 | Bemorlarni «D» nazoratiga olish jurnali | Журнал взятия на диспансерный («Д») учёт | Shifokor (surunkali kasalliklar) | Ha, 1-bosqich |
| 031 | Fizioterapiya hamshirasining kundalik qabul jurnali | Журнал ежедневного приёма медсестры ФТО | Fizioterapiya hamshirasi | Ha, 1-bosqich |
| 032 | Tibbiy jihoz va asboblarni zararsizlantirish va markaziy sterilizatsiyaga topshirish jurnali | Журнал дезинфекции и сдачи в ЦСО | Hamshira | Ha, 2-bosqich |
| 033 | Asbob-uskunalarni qabul qilish va zararsizlantirish jurnali | Журнал приёма и дезинфекции инструментов | Hamshira | Ha, 2-bosqich |
| 034 | Laborator tahlillarni qayd etish jurnali | Журнал регистрации лабораторных анализов | Laboratoriya | Ha, 2-bosqich |
| 035 | Shifokor maslahat komissiyasi (VMK) xulosalarini qayd etish jurnali | Журнал заключений ВКК | VMK | Ha, 2-bosqich |
| 036 | Mehnatga layoqatsizlik varaqasini qayd etish jurnali | Журнал регистрации листков нетрудоспособности | Shifokor / VMK | Ha, 1-bosqich |
| 036-1 | Ta’lim olayotgan shaxslar uchun mehnatga layoqatsizlik varog‘ini qayd etish jurnali | Журнал регистрации справок нетрудоспособности учащихся | Shifokor | Ha, 1-bosqich |
| 036-2 | Bemor bolani parvarishlash uchun layoqatsizlik varog‘ini qayd etish jurnali | Журнал … по уходу за больным ребёнком | Shifokor | Ha, 2-bosqich |
| 036-3 | Mastlik holati bo‘yicha mehnatga layoqatsizlik varog‘ini qayd etish jurnali | Журнал … вследствие опьянения | Shifokor | Ha, 2-bosqich |
| 051 | Oila hamshirasining kundalik faoliyat jurnali | Журнал ежедневной деятельности семейной медсестры | Oila hamshirasi | Ha, 1-bosqich |
| 059 | Dori vositalari, diagnostikum, reaktiv va tibbiy buyumlarni miqdoriy hisobga olish jurnali | Журнал количественного учёта лекарств, реактивов и изделий | Mas’ul hamshira | Ha, 2-bosqich |
| 059-1 | Muolajalarni qayd etish jurnali | Журнал регистрации процедур | Muolaja hamshirasi | Ha, 2-bosqich |
| 059-2 | Ambulatoriya-poliklinika va shoshilinch (tez) tibbiy yordam postidan foydalanilgan byudjet dori vositalari va tibbiy buyumlarni hisobga olish jurnali | Журнал учёта бюджетных лекарств поста неотложной помощи | Hamshira | Ha, 2-bosqich |
| 060 | Yuqumli kasalliklarni qayd etish jurnali | Журнал регистрации инфекционных заболеваний | Shifokor / epidemiolog | Ha, 2-bosqich |
| 064 | Emlashni qayd etish jurnali | Журнал регистрации прививок | Emlash xonasi hamshirasi | Ha, 1-bosqich (har bir emlangan shaxs Yagona tibbiy axborot tizimiga kiritiladi — anhor.uz / norma.uz, 2026) |
| 069 | Ambulator operatsiyalarni qayd etish jurnali | Журнал регистрации амбулаторных операций | Jarroh | Ha, 2-bosqich |
| 017 | Rentgen tekshiruvlarini qayd etish jurnali (rentgenoskopiya, rentgenografiya) | Журнал регистрации рентгенисследований | Rentgen xonasi | Ha, 2-bosqich |
| 106 | O‘lim guvohnomasini qayd etish jurnali | Журнал регистрации свидетельств о смерти | Shifokor (ambulator holatlar) | Ha, 1-bosqich |

**Muhim:** 70-son buyruq **davlat BTSY muassasalari** uchun. Xususiy klinikalarga to‘g‘ridan-to‘g‘ri ta’siri yo‘q. Lekin VM 570-son qarori va SSV 19-son buyrug‘i orqali xususiy klinikalar ham shu modullarga ma’lumot uzatishi shart (§4).

### 2.2. Davlat raqamli platformasining (DHP) rasmiy hujjat toifalari («Order 399» asosida) — TASDIQLANGAN (manba: Uzinfocom FHIR qo‘llanmasi)

Manba: https://github.com/uzinfocom-org/digital-health-integration/blob/HEAD/input/fsh/terminology/DocumentCategoryCS.fsh (2026-10 holati; IG v0.11.1, 2026-10-14). Uz/ru nomlari fayldagidek.

| № | Nomi (uz) | Nomi (ru) | Kim / qachon | Elektronmi? |
|---|---|---|---|---|
| 003 | Bemorning tibbiy kartasi (statsionar) | Медицинская карта больного | Statsionar shifokori | DHP toifasi bor |
| 066 | Shifoxonadan chiqarilganlarning statistik kartasi | Статистическая карта выписанного из стационара | Statsionar, chiqarishda | DHP’da FHIR xaritasi (mapping) tayyor |
| 066-1 | Psixiatrik/narkologik chiqarish statistik kartasi | Психиатрическая/наркологическая статистическая карта выписки | Psixiatriya / narkologiya | FHIR xaritasi tayyor |
| 011 | Gemodializ seansi yozuvi | Запись сеанса гемодиализа | Dializ markazi | FHIR xaritasi tayyor |
| **130** | **Laboratoriya tahlil natijalari** | Результаты лабораторных анализов | Laboratoriya | **FHIR xaritasi tayyor** (form-130 mapping). Diqqat: SSV 180-son buyrug‘ida «130 h/sh» boshqa jurnal (patogistologiya) — raqam ziddiyati, quyida §8 ga qarang. |
| 053 | Harbiy xizmatga chaqiriluvchilarning tibbiy kartasi | Медицинская карта призывника | Chaqiruv komissiyasi | DHP toifasi |
| **086** | Abituriyentlar, sportchilar va ish izlovchilar uchun tibbiy ma’lumotnoma | Медицинская справка для абитуриентов, спортсменов и соискателей | Shifokorlar komissiyasi | **Ha:** 2026-yil may oyidan my.gov.uz’da bepul yuklab olinadi (xizmat #1366). Shifokor xulosasi elektron bazaga kiritilgandan keyin hosil bo‘ladi (gazeta.uz, 04.05.2026: https://www.gazeta.uz/oz/2026/05/04/086-forma/) |
| 086-1 | Sudyalik lavozimiga nomzodlar uchun tibbiy ma’lumotnoma | Медицинская справка для соискателей на должность судьи | Komissiya | DHP toifasi |
| 086-2 | Keksa yoshdagi va nogironlarni parvarish uylariga yo‘naltirish uchun tibbiy ma’lumotnoma | Медицинская справка для направления в пансионат | Komissiya | DHP toifasi |
| 094 | Mast holati sababli mehnatga layoqatsizlik to‘g‘risida ma’lumotnoma | Справка о нетрудоспособности вследствие опьянения | Davolovchi shifokor | Ha (e-varaqa tizimi) |
| 095 | Ta’lim oluvchilar uchun mehnatga layoqatsizlik ma’lumotnomasi | Справка нетрудоспособности для лиц, получающих образование | Davolovchi shifokor | Ha |
| 138 | Kasal bolaga parvarish bo‘yicha mehnatga layoqatsizlik ma’lumotnomasi | Справка нетрудоспособности по уходу за больным ребёнком | Davolovchi shifokor | Ha |
| — | Mehnatga layoqatsizlik varaqasi | Лист нетрудоспособности | Davolovchi shifokor + bo‘lim boshlig‘i | Ha, faqat elektron (01.01.2024 dan) |
| 103 | Tug‘ilganlik haqida ma’lumotnomani qayd etish | Регистрация справки о рождении | Tug‘ruqxona | DHP toifasi |
| 106 / 106-2 | O‘lim / perinatal o‘lim ma’lumotnomasini qayd etish | Регистрация свидетельства о (перинатальной) смерти | Shifokor | DHP toifasi; tartibi — SSV yo‘riqnomasi, ro‘yxat 2089 (23.03.2010, so‘nggi tahrir 23.02.2026): https://lex.uz/docs/-1604474 — **ambulator emas, faqat qayd uchun** |
| 001–010, 096, 097 | Statsionar va tug‘ruq shakllari (qabul jurnali, narkoz varaqasi, qon quyish, tug‘ruq kartasi va boshq.) | — | Statsionar | DHP toifasi — **ambulator emas** |

### 2.3. Ambulator shifokorning boshqa asosiy hujjatlari

| № | Nomi (uz) | Nomi (ru) | Kim / qachon | Elektronmi? | Manba |
|---|---|---|---|---|---|
| **Mehnatga layoqatsizlik varaqasi** | Mehnatga layoqatsizlik varaqasi (+ 094/095/138 ma’lumotnomalari) | Листок нетрудоспособности | Davolovchi shifokor. Ambulator holatda yakka o‘zi **5 kalendar kunigacha** (10-band); keyin bo‘lim boshlig‘i bilan 10 kundan uzaytiriladi; uzoq muddatda VMK, keyin TIEK (tibbiy-ijtimoiy ekspertiza). | **Faqat elektron**, «Yagona tibbiy axborot tizimi»da. Real vaqtda my.gov.uz’ga uzatiladi (5¹-band); rahbar ERI bilan tasdiqlaydi. **Xususiy klinika** faqat ekspertiza bo‘yicha malakali xodimi bo‘lsa **va statsionar sharoitda faoliyat yuritsa** bera oladi (5-band, 15.09.2025 tahriri). | SSV yo‘riqnomasi, ro‘yxat **2667** (17.04.2015), 2667-4 tahriri (08.10.2025): https://lex.uz/docs/-2625878 ; kun.uz, 09.02.2024: https://kun.uz/news/2024/02/09/ssv-mehnatga-layoqatsizlik-varaqalarini-berish-elektron-shaklga-otkazildi |
| Varaqa majburiy maydonlari | Muassasa, ro‘yxat sanasi va raqami; bemorning F.I.Sh., jinsi, **JSHSHIR**, yoshi; bola uchun guvohnoma seriyasi; manzil; ish/o‘qish joyi; biriktirilgan muassasa; sabab; **XKT-10 tashxisi** (dastlabki va yakuniy); shifokor va bo‘lim boshlig‘i; VMK/TIEK ma’lumotlari; rejim va uning buzilishi; ozod qilingan kunlar | — | — | DHP FHIR modeli: CarePlan (SickLeave) + Observation + RelatedPerson; tashxis ICD-10 bilan | lex.uz 2625878, 1-ilova; https://dhp.uz/fhir/integrations/sick-leave.html (manba fayl: GitHub `input/pagecontent/sick-leave.md`) |
| Retsept (qog‘oz) | Retsept blankasi (105×148 mm, yirtma koreshogi bilan); bitta retseptda bitta dori; XPN (xalqaro patentlanmagan nom) bo‘yicha; lotincha; 30 kun amal qiladi (surunkalilar uchun 60/90 kun, «maxsus maqsadlar uchun» belgisi bilan). Xususiy muassasa o‘ng yuqorida litsenziya raqami, sanasi va muddatini ko‘rsatadi. Ilova 3: retsept blankalarini berishni qayd qilish jurnali. | Рецептурный бланк | Davolovchi shifokor | Qisman. Qog‘oz faqat istisno holatlarda va uzilishda. | SSV buyrug‘i 121-son (01.07.2020), ro‘yxat **3277**, so‘nggi tahrirlar 16.12.2025 (3725) va 10.08.2026 (3919): https://lex.uz/docs/-4880063 |
| **E-retsept** | Elektron retsept | Электронный рецепт | Shifokor klinika axborot tizimida yaratadi, ERI bilan imzolaydi, QR-kod beriladi; bitta retseptda ≤5 XPN. Majburiy maydonlar: muassasa nomi; retsept raqami va sanasi; bemorning F.I.Sh., tug‘ilgan sanasi, yoshi, jinsi; **XKT-10 tashxisi**; XPN; dori shakli, dozasi va qabul tartibi; shifokor F.I.Sh. va telefoni; tasdiqlovchi katta shifokor; xususiy klinika uchun **litsenziya raqami va STIR** | — | **Ha.** Pilot 10.12.2025 dan (Toshkent + 15 tuman). SSV 25-son buyrug‘i (15.12.2025, ro‘yxat 3725) bosqichlarni belgiladi; 2026-yil may oyida uni bekor qilish loyihasi chiqdi, lekin SSV «tizim bekor qilinmaydi» dedi. | VM 570, 1-ilova: https://lex.uz/docs/7723519 ; https://lex.uz/explanation/977 ; https://lex.uz/docs/7920485 ; https://www.spot.uz/ru/2026/05/01/prescriptions-stop/ (01.05.2026); https://anhor.uz/uzl/news/ssv-elektron-retsept-tizimi-bekor-qilinmagan/ |
| Giyohvand va psixotrop dorilar retsepti | Maxsus blanka | Специальный рецептурный бланк | Shifokor | E-retseptdan **istisno** (spot.uz, 01.05.2026) | VM nizomi, ro‘yxat 3604 (27.01.2025): https://lex.uz/uz/docs/-7349574 |
| Yo‘llanma (tekshiruv, konsultatsiya, gospitalizatsiya) | Yo‘llanma | Направление | Shifokor | Ha: «yo‘naltirish va qayta bog‘lanish» Yagona tizimda (70-son, 3-band). DHP’da ServiceRequest/Task. Imtiyozli gospitalizatsiya yo‘llanmasi DMED ilovasida. | 70-son buyruq; DHP core IG. Ambulator yo‘llanma shakl raqami (sovetda 057/у) — **TASDIQLANMAGAN** |
| 083/h | Haydovchilik uchun tibbiy ma’lumotnoma | Медсправка водителя (083/у) | Haydovchilar tibbiy komissiyasi (terapevt, narkolog, psixiatr, oftalmolog va boshq.) | Ha: my.gov.uz xizmati #1002, 2024-yildan onlayn | https://oldmy.gov.uz/oz/service/1002 ; https://www.spot.uz/oz/2024/02/26/medical-certificate/ (26.02.2024). Tasdiqlagan buyruq — **TASDIQLANMAGAN** |
| — | Qurolga egalik qilish ruxsatnomasi uchun tibbiy xulosa | Медзаключение на оружие | Belgilangan muassasalar | — | daryo.uz, 14.11.2023: https://daryo.uz/2023/11/14/ozbekistonda-qanday-muassasalar-qurolga-egalik-qilish-ruxsatnomasi-uchun-tibbiy-xulosa-beradi (shakl raqami TASDIQLANMAGAN) |
| — | Haj va Umra uchun tibbiy ma’lumotnoma; OIV yo‘qligi haqida ma’lumotnoma; narkologik va ruhiy dispanser ma’lumotnomalari | — | Tegishli muassasa | Ha, my.gov.uz (#1380, #1452, #338/#1039, #334/#1040) | https://oldmy.gov.uz/oz/all-services?id=23 |
| Xodimlarni tibbiy ko‘rikdan o‘tkazish | Dastlabki va davriy tibbiy ko‘rik: kalendar reja (5-ilova), yo‘llanma (6-ilova), ambulator karta (025-u), xulosa, yakuniy dalolatnoma (8-ilova, 4 nusxa) | Предварительные и периодические медосмотры | Ko‘rik o‘tkazuvchi muassasa komissiyasi (xususiy klinikalar ham) | Elektron talab topilmadi | SSV buyrug‘i 200-son, ro‘yxat **2387** (29.08.2012): https://lex.uz/acts/-2046010 |
| Ko‘chirma / epikriz (sovetda 027/у) | Tibbiy kartadan ko‘chirma | Выписка из медкарты | Shifokor, bemor boshqa muassasaga yuborilganda yoki so‘raganda | DHP’da 066 (chiqarish) bor; ambulator ko‘chirma raqami — **TASDIQLANMAGAN** | — |
| Shoshilinch xabarnoma (sovetda 058/у) | Yuqumli kasallik haqida shoshilinch xabarnoma | Экстренное извещение | Kasallikni aniqlagan shifokor | 060-jurnal elektron (70-son). Xabarnoma shakli va muddati (Rossiyada 12 soat) — **TASDIQLANMAGAN** | Kun.uz, 06.08.2019 (DSENMga xabarnoma tizimi yaxshi yo‘lga qo‘yilmagani haqida) |
| Emlash kartasi (sovetda 063/у) | Profilaktik emlashlar kartasi | Карта профилактических прививок | Emlash hamshirasi | Har bir emlash Yagona tibbiy axborot tizimiga kiritiladi; my.gov.uz «Profilaktik emlanganlikni tekshirish» #1001 | Shakl raqami **TASDIQLANMAGAN** |
| Bolaning rivojlanish tarixi (sovetda 112/у) | Bolaning rivojlanish tarixi | История развития ребёнка | Pediatr / oilaviy shifokor | Atama 2667 yo‘riqnomasining 53-bandida bor; raqami **TASDIQLANMAGAN**. DHP’da 097 «Chaqaloqning rivojlanish tibbiy kartasi» | lex.uz 2625878 |
| Homilador ayolning individual kartasi (sovetda 111/у) | — | Индивидуальная карта беременной | Akusher-ginekolog | 024-2 jurnali elektron; karta raqami **TASDIQLANMAGAN** | — |
| TIEK (MSEK) ga yo‘llanma (sovetda 088/у) | Tibbiy-ijtimoiy ekspertizaga yo‘llanma | Направление на МСЭ | VMK | 01.01.2024 dan nogironlik guruhini belgilash elektron (SSV xabari, 2025). Shakl raqami **TASDIQLANMAGAN** | lex.uz 2625878 (22–24-bandlar) |

---

## 3. Statistik va davriy hisobotlar

- **PF-88 (19.05.2025), 12-band:** qabul jurnallari va tibbiy statistik shakllar elektronga o‘tadi, «qogʻoz shaklidagi barcha tibbiy hisobotlar bekor qilinadi» (https://lex.uz/uz/docs/-7534275). Davlat muassasalarida hisobotlar «Elektron poliklinika» modulida avtomatik shakllanadi. VM 570 va SSV 19-son buyrug‘ida modullar «tegishli hisobotlarni shakllantirish» funksiyasi bilan ta’riflangan.
- **Xususiy klinikalar uchun:** nodavlat tashkilotlarning birlamchi tibbiy hujjatlarini tasdiqlash va SSV ga statistika topshirish tartibi PQ-170 yo‘l xaritasining 13.1-bandida (muddat 2026-yil oktabr, idoraviy hujjat) — **hali topilmadi**. Hozircha amalda xususiy klinika statistikasi DMED/«Elektron sog‘liqni saqlash» modullariga real vaqtli ma’lumot uzatish orqali yig‘iladi (VM 570, 2-band).
- **Statistika agentligi:** 2026-yil uchun statistik hisobot shakllari ro‘yxati (11.12.2025, ro‘yxat 3723, 47 ta shakl) ichida «1-тиб (аҳоли)» ijtimoiy-statistik shakli bor. Mazmuni va kim topshirishi **TASDIQLANMAGAN** (https://buxgalter.uz/publish/doc/text212387_2026_yil_uchun_statistika_hisobotining_qanday_shakllari_tasdiqlangan).
- **SSV statistik shakllari** («12-son shakl», «30-son», «47-son», «1-SSV» va boshq.): rasmiy manbadan **TASDIQLANMAGAN** (SSV shakl buyruqlari lex.uz’da e’lon qilinmaydi).
- **Litsenziya:** VM 80-son qarori (21.02.2022), 27-ilova «Tibbiy faoliyatni litsenziyalash pasporti» (https://lex.uz/docs/-5870213). VM 570 4-ilovasi bilan 9-bandga «DHP / Elektron sog‘liqni saqlash tizimiga ulanish va 4 modul bilan real vaqtli almashuv» sharti qo‘shilgan (pilotda 10.12.2025 dan, hammasiga 01.01.2027 dan). 01.07.2026 dan litsenziyalash Litsenziyalash va akkreditatsiya markaziga o‘tdi; ichki sifat nazorati bo‘linmasi litsenziya talabi (PQ-170, 2-band). 01.04.2028 dan Davlat tibbiy sug‘urta jamg‘armasi akkreditatsiyasiz nodavlat tashkilot bilan shartnoma tuzmaydi (PQ-170, 3(b)).
- **Soliq / fiskal:** §5 ga qarang.

---

## 4. Nimalar allaqachon elektron (2025–2026) — DMED va Raqamli sog‘liqni saqlash platformasi

### 4.1. DMED nimani qamraydi

| Funksiya | Holati | Manba |
|---|---|---|
| Elektron tibbiy karta (MED-ID) | 36 mln+ aholi ma’lumoti; 20+ modul (2025); 70+ qog‘oz jurnal/blanka bekor; 28 ta ma’lumotnoma elektronlashtirildi; «shifokorlar ish yuklamasi 30 foizga yengillashdi» (SSV da’vosi) | kun.uz, 13.11.2025: https://kun.uz/news/2025/11/13/ozbekistonda-aholining-yagona-elektron-tibbiy-kartasi-yaratildi |
| Mehnatga layoqatsizlik varaqasi | Faqat elektron, 01.01.2024 dan. DMED eHealth sahifasida xususiy klinikalar uchun «Уже доступно» | kun.uz, 09.02.2024; https://dmed.uz/products/e-health (2026-10-20 da o‘qildi) |
| E-retsept | Pilot 10.12.2025 dan; Yunusobodda ~200 xususiy klinika ulangan (kun.uz, 13.11.2025); dorixonalar 9 439 / 9 525 (UzA) | VM 570; https://uza.uz/ar/posts/elektron-retsept-tizimi-kutilgan-natijani-beryaptimi_922493 |
| Elektron ma’lumotnomalar (xususiy klinikalar uchun) | DMED eHealth: «В разработке» | https://dmed.uz/products/e-health |
| 086 va 083/h | my.gov.uz orqali (086 — 2026-yil maydan, 083/h — 2024-yildan) | yuqorida |
| Bemor ilovasi DMED | Poliklinikaga biriktirilish, oilaviy shifokorga yozilish, «Mening tibbiy kartam», lab natijalari, e-retseptlar, imtiyozli gospitalizatsiya yo‘llanmalari; v2.11.0 dan xususiy klinikalarga yozilish; OneID/MyID | https://apps.apple.com/us/app/dmed/id6468250285 |
| DMED o‘zining klinika MIS mahsuloti | Navbat, moliya (Paynet, Payme), lab, ombor, EDO, e-retsept, «DMED AI» (suhbatdan ko‘rik kartasini avtomatik to‘ldirish, top-3 tashxis). **Bizga bevosita raqobatchi.** | https://dmed.uz/products/polyclinics , https://dmed.uz/uz/products/dmed-ai |
| Xususiy klinikani ulash | DMED ID bilan kirish → tashkilotni ulash (INN, litsenziya tekshiriladi) → xodimlarni qo‘shish (faqat rasmiy ishlaydiganlar) → moderatsiya → rolli ish joylari | https://dmed.uz/products/e-health |

### 4.2. Xususiy klinika majburiyatlari va muddatlar

1. **Hozir (pilot hududlarda 10.12.2025 dan):** DHP / «Elektron sog‘liqni saqlash»ga ulanish va 4 modul bilan real vaqtli almashuv — litsenziya sharti (VM 570).
2. **01.01.2027 dan butun respublikada** — xuddi shu shart (VM 570, 4-ilova izohi). VM 570 2-bandida «2026 yilning yakuniga qadar» deyilgan.
3. **01.04.2027 dan** — klinikaning **o‘z axborot tizimini** SSV yagona standartlariga moslab DHP ga majburiy bepul integratsiya qilish litsenziya sharti bo‘ladi (PQ-170, 4(a)). Standartlar hali topilmadi.
4. Modullarni o‘rnatish: SSV ga so‘rovnoma (xodimlarning F.I.Sh., lavozimi, pasport, JSHSHIR, email) → UZINFOCOM 15 ish kunida bepul (SSV 19-son, 2–3-bandlar). Integratsiya kaliti va texnik qo‘llanma arizadan keyin **1 ish kunida** elektron beriladi (VM 570, 1-ilova, 5-band). Modullarga xizmat ko‘rsatish to‘lovi SSV tariflari bo‘yicha (tarif **TASDIQLANMAGAN**).
5. Xodim ishdan ketsa yoki lavozimi o‘zgarsa — 3 ish kunida SSV ga yozma xabar (SSV 19-son, 10-band).

### 4.3. Ochiq integratsiya ma’lumotlari (API)

- **FHIR IG «Uzbekistan Digital Health Platform» (UZ Core):** `uz.dhp.core`, canonical https://dhp.uz/fhir/core. HL7 **FHIR R5**, holati *draft* (hali produksiyaga tayyor emas). v0.11.1 — 2026-10-14. Litsenziya CC BY-SA 4.0. GitHub: https://github.com/uzinfocom-org/digital-health-ig
- **Profillar:** Patient, Practitioner, PractitionerRole, Organization, Location, Encounter, EpisodeOfCare, Condition, Observation (vital signs), Procedure, AllergyIntolerance, ServiceRequest, Task, Specimen, DiagnosticReport, Immunization, Medication, MedicationRequest/Dispense (ishlanmoqda), Composition, Consent, Provenance, AuditEvent, Claim, Questionnaire va boshqalar.
- **Identifikatorlar:** JSHSHIR — `https://dhp.uz/fhir/core/sid/pid/uz/ni`; pasportlar — `.../pid/uz/ppn/...`; tashkilot STIR — `.../org/uz/soliq`; hujjat shakl raqami — `https://dhp.uz/fhir/core/sid/doc/uz/form-number`.
- **Terminologiya:** tashxis ICD-10 (`http://hl7.org/fhir/sid/icd-10`) yoki SNOMED CT; LOINC, ATC, UCUM.
- **Operatsiyalar:** `$populate` (davlat reyestridan bemorni to‘ldirish), `$attach` (biriktirish).
- **API:** playground `playground.dhp.uz/fhir`, produksiya `fhir.dhp.uz`. OAuth 2.0 `sso.dhp.uz` orqali (backend — client_credentials; frontend — auth code + PKCE OneID orqali). Yozishda `If-Match` majburiy; transaction Bundle qo‘llab-quvvatlanadi; o‘chirish yo‘q, faqat status.
- **Integrations IG:** https://dhp.uz/fhir/integrations/en/ (manba: https://github.com/uzinfocom-org/digital-health-integration). «Gibrid model»: klinika o‘z ma’lumotini saqlaydi, asosiy ma’lumotni DHP ga yuboradi. Hujjatlar FHIR document Bundle sifatida (`Composition.category` = `form-0XX`). Xaritalar: 011, 066, 066-1, 130; integratsiyalar: Sick Leave, skrining, sil (DHIS), narkologiya, psixiatriya, onkologiya, gepatit.
- **SSO hujjati:** https://sso.dhp.uz/docs/ru/ — vendor client credentials qanday olishi yozilmagan.
- **Kontaktlar:** info@dmed.uz, +998 71 202 50 00, Telegram https://t.me/dmedcc_bot ; IG nashriyotchisi info@ssv.uz.
- **MIS sertifikatsiyasi yoki akkreditatsiyasi tartibi topilmadi.** PQ-170 5(a) bo‘yicha yagona standartlar kutilmoqda.

---

## 5. To‘lovlar: Payme, Click va fiskallashtirish

Manbalar 2026-10-20 da o‘qildi. Payme va Click hujjatlarida sahifa sanasi ko‘rsatilmaydi (Click: © 2026).

### 5.1. Payme Business — Merchant API (https://developer.help.paycom.uz/ , ruscha)

- **Protokol:** JSON-RPC 2.0, HTTPS orqali POST. **Payme bizning serverimizni chaqiradi** (kassa sozlamasidagi «Endpoint URL»). Javob doim HTTP 200 bo‘lishi kerak, aks holda -32400.
- **Auth:** `Authorization: Basic base64(Paycom:KEY)`. Login doim `Paycom` — rasmiy PHP shablonida shunday (https://github.com/PaycomUZ/paycom-integration-php-template). Kalit: kabinet → Kassalar → Sozlamalar → Dasturchi vositalari. Ikki kalit bor: «Ключ» (produksiya) va «Тестовый ключ» (sandbox).
- **Metodlar:**
  - `CheckPerformTransaction`, `CreateTransaction`, `PerformTransaction`, `CancelTransaction`, `CheckTransaction`;
  - `GetStatement` (`from`/`to`, ikkalasi ham kiradi);
  - `SetFiscalData` (ixtiyoriy).
  - `ChangePassword` hozirgi hujjatlarda **yo‘q**.
  - Diqqat: menyuda CheckPerformTransaction va CheckTransaction havolalari almashib qolgan.
- **Turlar:** ID — 24 belgili satr; vaqt — 13 xonali millisekund; summa — butun son, **tiyinda**; `account` — maydonlarini o‘zimiz belgilaymiz (masalan `invoice_id`).
- **Holatlar:** 1 — yaratilgan; 2 — bajarilgan; -1 — 1-holatdan bekor; -2 — bajarilgandan keyin bekor.
  - Bekor qilish sabablari: 1, 2, 3, 4 (timeout), 5 (refund), 10.
  - 1-holatdagi tranzaksiya **12 soatdan** (43 200 000 ms) keyin avtomatik bekor bo‘ladi.
- **Xato kodlari:**
  - umumiy: -32300 (POST emas), -32700 (JSON), -32600 (maydonlar), -32601 (metod yo‘q), -32504 (auth), -32400 (tizim xatosi);
  - savdogar xatolari: -31001 (summa noto‘g‘ri), -31003 (tranzaksiya topilmadi), -31007 (bekor qilib bo‘lmaydi), -31008 (holatda ruxsat yo‘q), -31050…-31099 (`account` xatosi; lokallashtirilgan `message`, `data` = maydon nomi).
  - Takroriy so‘rovlar bir xil javob olishi shart.
- **Fiskal ma’lumot:**
  - `CheckPerformTransaction` javobida `detail` qaytarish mumkin: `receipt_type`, `items[]`. Har bir item: `title`, `price` (tiyin), `count`, `code` = **IKPU (MXIK)**, `package_code`, `vat_percent`, ixtiyoriy `units` va `discount`.
  - Shunda Payme chekni o‘zi fiskallashtiradi va natijani `SetFiscalData` orqali yuboradi: `receipt_id`, `fiscal_sign`, `terminal_id`, `qr_code_url`, `date`.
- **Checkout:**
  - GET: `https://checkout.paycom.uz/` + base64(`m=<merchant_id>;ac.invoice_id=…;a=<tiyin>;l=uz;c=<return_url>`).
  - POST forma: `merchant`, `amount`, `account[...]`, `lang`, `callback`, `detail` (base64 JSON).
  - POST misolida test host `https://test.paycom.uz`. Produksiya POST hosti **TASDIQLANMAGAN**.
- **Sandbox:** https://test.paycom.uz — **merchant kabineti kerak** (veb-kassa → Merchant ID + TEST_KEY + Endpoint URL). Sinov ssenariylari:
  - noto‘g‘ri auth → -32504;
  - noto‘g‘ri summa → -31001;
  - mavjud bo‘lmagan account → -31050…-31099;
  - yaratish → bekor qilish;
  - yaratish → bajarish → bekor qilish;
  - takroriy so‘rovlar.
- **Subscribe API (kartani tokenlash):**
  - `https://checkout.test.paycom.uz/api` (test) va `https://checkout.paycom.uz/api` (produksiya); `X-Auth` sarlavhasi.
  - Metodlar: `cards.create/get_verify_code/verify/check/remove`, `receipts.create/pay/send/cancel/check/get/get_all/set_fiscal_data`.
  - Test kartalar: muddat 03/99, SMS 666666; masalan 8600 0691 9540 6311.
  - Karta faqat token sifatida saqlanadi.

### 5.2. Click (https://docs.click.uz)

- **SHOP API (Click bizni chaqiradi):** POST `x-www-form-urlencoded`, javob JSON. Summa **so‘mda (float)**, tiyinda emas.
  - **Prepare (`action=0`)** imzosi: `md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time)`. Javob: `merchant_prepare_id`.
  - **Complete (`action=1`)** imzosi: `md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + merchant_prepare_id + amount + action + sign_time)`. Javob: `merchant_confirm_id`.
  - Bizning xato kodlarimiz: 0 (muvaffaqiyat), -1 (imzo), -2 (summa), -3 (action), -4 (allaqachon to‘langan), -5 (buyurtma topilmadi), -6 (tranzaksiya topilmadi), -7, -8, -9 (bekor qilingan).
  - Click manfiy `error` yuborsa (masalan -5017), biz to‘lovni bekor qilib -9 qaytaramiz.
- **Merchant API:** `https://api.click.uz/v2/merchant/`; sarlavha `Auth: merchant_user_id:sha1(timestamp+secret_key):timestamp`.
  - `invoice/create`, `invoice/status`, `payment/status`, `payment/status_by_mti`;
  - `payment/reversal` (faqat joriy oy, online karta);
  - `card_token/*`.
- **Fiskallashtirish:** `POST /v2/merchant/payment/ofd_data/submit_items`.
  - Item maydonlari: `Name`, `SPIC` (IKPU, 17 belgi), `PackageCode`, `Price` (tiyin), `Amount`, `VAT`, `VATPercent`, `CommissionInfo{TIN|PINFL}` (klinikaning STIR’i).
  - Tegishli endpointlar: `ofd_data/submit_qrcode`; `GET ofd_data/:service_id/:payment_id` → `qrCodeURL` (ofd.soliq.uz).
- **To‘lov havolasi:** `https://my.click.uz/services/pay?service_id=…&merchant_id=…&amount=…&transaction_param=…&return_url=…`
- **Sinov:**
  - Click’da ochiq **Playground** (https://docs.click.uz/testing/playground) bor. U bizning URL’imizga to‘g‘ri imzolangan Prepare/Complete so‘rovlarini yuboradi; service_id va secret key’ni o‘zimiz kiritamiz, serverda CORS kerak.
  - **Postman generator** (https://docs.click.uz/en/testing/postman) 15 ssenariy beradi.
  - Merchant API va fiskallashtirish uchun ochiq sandbox **yo‘q** — haqiqiy credentials kerak.

### 5.3. Uzum, Paynet, Apelsin

- **Uzum Bank** (https://developer.uzumbank.uz):
  - **Merchant API:** webhooklar `/check`, `/create`, `/confirm`, `/reverse`, `/status`; Basic auth; summa tiyinda; 30 daqiqada confirm bo‘lmasa FAILED; xato kodlari 10001–10018, 99999.
  - **Checkout:** `X-Terminal-Id`, `X-API-Key`; IKPU bilan avtomatik fiskallashtirish.
  - **Fiscalisation API:** test host `test-ofd.ipt-merch.com`; kalit menejerdan olinadi.
- **Paynet, Apelsin:** ochiq hujjat topilmadi (**TASDIQLANMAGAN**).

### 5.4. Fiskallashtirish (tibbiy xizmatlar)

- **Majburiy.** Aholidan naqd yoki karta orqali to‘lov oladigan har bir yuridik shaxs va YaTT onlayn-NKM, virtual kassa yoki «marketpleys» (ro‘yxatdan o‘tgan to‘lov ilovasi) orqali fiskal chek beradi. Tibbiy xizmatlar yoki xususiy klinikalar uchun **istisno topilmadi**. Manbalar: PF-5813 (06.09.2019), VM 943-son qarori (23.11.2019): https://lex.uz/docs/4603329 ; https://buxgalter.uz/publish/doc/text199847_kto_i_kakie_modeli_onlayn-kkt_obyazan_ispolzovat_v_uzbekistane (14.05.2024).
- **Payme/Click orqali to‘lovda chekni kim beradi:**
  - to‘lov tizimi chekni **klinikaning STIR’i (principal) bilan** bergan bo‘lsa, klinika qo‘shimcha chek bermaydi;
  - aks holda klinika o‘zi beradi, STIR ko‘rsatilmasa tushum to‘lov tizimiga yoziladi;
  - manba: https://buxgalter.uz/publish/doc/text183145_nujno_li_vydavat_chek_onlayn-kkt_esli_klienty_oplachivayut_cherez_platejnye_sistemy1 (25.07.2022).
  - Amalda: Payme `detail.items`, Click `submit_items` (`CommissionInfo` = klinika STIR) yoki Uzum avtofiskal.
- **Naqd kassada** klinikaga ro‘yxatdan o‘tgan virtual kassa yoki onlayn-NKM provayderi kerak (masalan REGOS, Rahmat POS). Soliq qo‘mitasi fiskal operatorining biz to‘g‘ridan-to‘g‘ri chaqiradigan ochiq API’si topilmadi.
- **IKPU (MXIK) kodlari** (https://tasnif.soliq.uz , 2026-10-20 dagi jonli qidiruv): guruh **109 «МЕДИЦИНСКИЕ УСЛУГИ»**, sinf 10902.
  - `10902001xxx000000` — mutaxassis konsultatsiyalari: 10902001027000000 nevrolog, …036… pediatr, …053… jarroh; 10902001098000000 telemeditsina.
  - `10902002…` — laboratoriya diagnostikasi: 10902002003000001, …0004, …0999.
  - `10902003xxx000000` — mutaxassislar bo‘yicha davolash va muolajalar: …021… kardiolog, …099… boshqalar.
  - `10902004001000001` — fizioterapiya; `…003` — massaj.
  - Birlik «услуга (раз)»; package code namunasi 1321920.
  - tasnif qidiruv endpointlari login talab qilmaydi, lekin **hujjatlashtirilmagan** API.
- **QQS (ziddiyatli — buxgalter bilan tekshirish kerak):**
  - ZRU-891 (28.12.2023) bo‘yicha tibbiy xizmatlar QQS imtiyozi **01.04.2024** dan bekor qilingani, ya’ni 12%, xabar qilingan (https://buxgalter.uz/publish/doc/text198567_kakie_ozdorovitelnye_uslugi_po-prejnemu_ne_oblagayutsya_nds , 13.04.2024).
  - 2026-yildan xususiy klinikalarga QQS qisman qaytariladi. Qaytariladigan ulush cheklardagi **IKPU kodlari** bo‘yicha hisoblanadi (spot.uz, 10.11.2025 va 10.04.2026).
  - Shu bilan birga, tasnif katalogida 109-guruhga hamon «ст.243 НК п.11» imtiyoz belgisi turibdi.
  - **Tavsiya:** `vat_percent`ni xizmat va klinika bo‘yicha sozlanadigan qiling. Aylanmadan soliq to‘lovchilar uchun 0% — **TASDIQLANMAGAN**.
- **Jarimalar** (buxgalter.uz, 23.12.2020; 2026 uchun **TASDIQLANMAGAN**): SK 221-modda (5/7/20 mln so‘m); MJtK 164, 175-moddalar (10–15 BHM); SK 227-1 (chekda QR yoki fiskal belgi yo‘qligi).

### 5.5. Merchant hisobisiz nimani qurish va sinash mumkin

1. **Payme Merchant API’ning 7 metodi**: holatlar mashinasi, idempotentlik, 12 soatlik timeout, `GetStatement`. Bizning fake Payme klientimiz bilan sandbox ssenariylari bo‘yicha test qilinadi. Rasmiy sandbox uchun kabinet kerak.
2. **Click Prepare/Complete**: hozirning o‘zida rasmiy Playground va Postman generator bilan sinash mumkin (secret key’ni o‘zimiz tanlaymiz).
3. **Uzum webhooklari**: ochiq tavsif bo‘yicha lokal fake bilan.
4. **Xizmatlar katalogiga IKPU va package code tanlash** (109-guruh) va chek `items[]`ni invoice qatorlaridan avtomatik yig‘ish. Bizdagi `invoice_items` (tiyinda) bunga to‘g‘ridan-to‘g‘ri mos.
5. **Checkout havola generatori** (Payme base64, Click URL) va fiskal javobni (`qr_code_url`) invoice’ga bog‘lash.
6. **Kutubxonalar:**
   - Python: `paytechuz` (Payme, Click, Uzum, Paynet; MIT);
   - rasmiy PHP/Java Payme shablonlari;
   - Click’ning Django moduli.
   - Node uchun faqat kichik community paketlar bor. Loyiha qoidalariga ko‘ra o‘z modulimiz va testlardagi fake serverlar xavfsizroq.

**To‘lov tizimlaridan so‘rash kerak bo‘lgan savollar:**
- kabinet yoki test akkaunt ochish shartlari (shartnoma, yuridik shaxs);
- Payme produksiya POST hosti;
- IP manzillar;
- fiskal chekda klinika STIR’i avtomatik principal bo‘ladimi.

---

## 6. Vaqt yuki: shifokorlar hujjatga qancha vaqt sarflaydi

- **O‘lchangan o‘zbek tadqiqoti yo‘q.** Vaqt va harakat tadqiqoti yoki so‘rovnoma topilmadi. Bor narsalar — SSV bayonotlari.
- **SSV, 30.11.2021:** shifokor va hamshiralar «26 turdagi jurnallar, 33 turdagi hisobot shakllari» to‘ldiradi. «Har bir bemorga o‘rtacha 15 daqiqa vaqt ajratishi kerak… Biroq amalda shundan ma’lum qismi hujjat to‘ldirishga sarflanmoqda».
  - Misollar: jarohat jurnaliga har kuni «Bugun ko‘ngilsiz holatlar sodir bo‘lmadi» deb yozish; bemorni ikki marta ro‘yxatga olish; 024 jurnali tufayli navbat.
  - Manbalar: https://www.gazeta.uz/oz/2021/11/30/ssv/ ; https://kun.uz/news/2021/11/30/ssv-tibbiyot-muassasalaridagi-ortiqcha-qogozbozlikni-qisqartirish-choralarini-kormoqda
  - Ruscha versiyada «15 минут тратится именно на заполнение бумаг» deyilgan. Bu o‘zbekcha asldan kuchliroq ifoda, shuning uchun o‘zbekcha matnga tayaning.
- **2022-yil 1-fevral:** BTSY jurnallari 26 tadan 14 taga (10 tasi soddalashtirildi), 33 ta karta va shakl 14 tagacha qisqardi. Tasdiqlanmagan shakllardan foydalanish taqiqlandi (https://www.gazeta.uz/uz/2022/02/01/medicine/).
- **2024-yil mart:** Toshkentda yangilangan «Elektron poliklinika» bilan 28 tur blanka bekor qilindi, hisobotlar avtomatik shakllanadi (https://podrobno.uz/cat/obchestvo/v-uzbekistane-problemu-ocheredey-v-poliklinikakh-reshat-s-pomoshchyu-obnovlennoy-elektronnoy-sistemy/ , 13.03.2024).
- **PF-88 (19.05.2025):** qog‘ozbozlikni kamaytirib ish yuklamasini 30 foizgacha kamaytirish maqsadi.
- **Milliy sog‘liqni saqlash kompakti (06.12.2025):** JSST baholashi bo‘yicha jarayonlarning «70 percent» i qog‘ozda. 2030-yilgacha ma’muriy ishga ketadigan vaqtni 30% qisqartirish maqsadi (https://thedocs.worldbank.org/en/doc/0273f33ab6ee48c5d842108b9b55c789-0140022025/related/National-Health-Compact-Uzbekistan.pdf).
- **Qog‘oz va elektron parallel:** SSV o‘rinbosari O. Omonov, 22.05.2026: «медицинский персонал был вынужден параллельно вести как бумажную, так и электронную документацию» (https://yuz.uz/ru/news/tsifrovaya-meditsina-uzbekistana-ot-pilotnx-resheniy-k-intellektualnoy-sisteme-upravleniya--).
- **Texnika yetishmasligi:** poliklinikalarda «75 mingdan ortiq kompyuter yetishmaydi», ko‘p xodimlar qo‘lda yozishni afzal ko‘rgan (Uzinfocom, gazeta.uz, 15.10.2025: https://www.gazeta.uz/oz/2025/10/15/digitalization-of-healthcare/). «Qo‘l yozuviga o‘rgangan shifokorlar elektron tizimga qiynalib moslashyapti» (xabar.uz, 07.07.2025: https://www.xabar.uz/uz/insayder/dmed-tizimlilik-va-inson-haq-huquqi-kafolati).
- **Kadr tanqisligi:** 112 ming shifokor shtatidan 12,6 mingi bo‘sh; ~3 ming oilaviy shifokor yetishmaydi (vazir Xudayarov, gazeta.uz, 24.12.2025: https://www.gazeta.uz/oz/2025/12/24/medical-worker/).
- **E-retsept haqida shifokor fikri:** avval bir nechta jurnal, muhr va bo‘lim boshlig‘i imzosi kerak edi; endi bitta ID va kod (59-oilaviy poliklinika bosh shifokori, uzdaily.uz, 07.09.2026: https://www.uzdaily.uz/ru/elektronnye-retsepty-sokratili-chislo-lishnikh-lekarstv/).
- **AI yordamchi rejasi:** VM 425-son qarori (10.07.2025) — «sunʼiy intellektga asoslangan raqamli tibbiy yordamchi». Pilot Olmazor tuman ko‘p tarmoqli poliklinikasi va «Shox saroy» xususiy klinikasida, 2026-yil oktabr (https://lex.uz/uz/docs/-7621993). Boshlangani tasdiqlanmagan.
- **Xalqaro taqqoslash:**
  - **Rossiya** (Lyutsko va boshq., *Терапевтический архив*, 2019): uchastka terapevti qabul vaqtining **47,31%** ini hujjatga sarflaydi; o‘rtacha qabul 15,3 daqiqa (https://omnidoctor.ru/library/izdaniya-dlya-vrachey/terapevticheskiy-arkhiv/ta2019/ta2019_1_pp/zatraty-rabochego-vremeni-vrachey-terapevtov-uchastkovykh-pri-poseshchenii-odnim-patsientom). Bizga eng yaqin taqqoslash.
  - **AQSh:** Sinsky va boshq., *Annals of Internal Medicine* (2016) — kunning **49,2%** EHR va stol ishiga, 27% bemor bilan yuzma-yuz. Arndt va boshq., *Annals of Family Medicine* (2017) — 11,4 soatlik kundan 5,9 soati EHR’da.

---

## 7. Avtomatlashtirish uchun eng foydali 10 ta shakl

**Baholash usuli:** **Chastota (Ch)**, 1–5 — xususiy klinika shifokori uni qanchalik tez-tez to‘ldiradi. **Avto (A)**, 1–5 — bizdagi ma’lumotlar uni qanchalik avtomatik to‘ldira oladi. **Ball = Ch × A.**

Bizdagi ma’lumotlar (kod bazasidan):
- `patients`: F.I.Sh., tug‘ilgan sana, jins, telefon, manzil, allergiya;
- `encounters`; `clinical_notes`: shikoyat, anamnez, ko‘rik, tashxis, tavsiyalar, nazorat sanasi, vitals, ICD-10, imzolangan;
- `service_orders`, `lab_results` (verifikatsiyadan o‘tgan), `diagnostic_reports`;
- `invoices` / `payments`;
- `medical_documents`: yo‘llanma, ma’lumotnoma, retsept.

**Asosiy bo‘shliqlar:**
- bemorning **JSHSHIR**i va pasporti;
- shifokorning JSHSHIRi va ERI;
- klinikaning litsenziya raqami va STIR;
- XPN dori katalogi;
- DHP (FHIR) integratsiyasi.

| O‘rin | Shakl | Ch | A | Ball | Nimadan to‘ladi | Nima yetishmaydi |
|---|---|---|---|---|---|---|
| 1 | **024-1 Shifokorning kundalik qabul jurnali** (+024 registratsiya) | 5 | 5 | 25 | `appointments`, `encounters`, ICD-10, birinchi yoki takroriy tashrif — 100% avtomatik | Birinchi/takroriy belgisi; tuman/manzil kodi |
| 2 | **025 Ambulator karta yozuvi / EMK tashrif yozuvi** | 5 | 5 | 25 | Imzolangan `clinical_notes` + vitals + ICD-10 + lab natijalari. 025 ko‘rinishida chop etish va DHP ga Encounter/Condition/Observation sifatida yuborish | JSHSHIR; DHP ulanishi (01.01.2027 / 01.04.2027 dan majburiy) |
| 3 | **130 Laboratoriya tahlil natijalari** (+034 jurnal) | 4 | 5 | 20 | `lab_results`, `service_orders`. DHP’da FHIR xaritasi **allaqachon bor** — eng oson integratsiya | LOINC kodlari; JSHSHIR |
| 4 | **Tibbiy ma’lumotnoma (erkin shakl: murojaat, tashxis, tavsiya)** | 4 | 5 | 20 | `clinical_notes` + `medical_documents.certificate` (bizda bor) | Muhr/QR; standart shablonlar |
| 5 | **Retsept / e-retsept** | 4 | 4 | 16 | Tavsiyalar + ICD-10 + bemor ma’lumoti. AI tavsiyadan XPN ro‘yxatini ajratishi mumkin | XPN katalogi; ERI; litsenziya raqami va STIR; DMED e-retsept moduli (VM 570) |
| 6 | **Yo‘llanma** (tahlil, konsultatsiya, gospitalizatsiya) | 4 | 4 | 16 | `service_orders`, `medical_documents.referral`, ICD-10 | DHP ServiceRequest; qabul qiluvchi muassasa kodi |
| 7 | **Ko‘chirma / epikriz** (tibbiy kartadan) | 3 | 5 | 15 | Bir nechta imzolangan yozuv + lab natijalari → AI qisqacha xulosa (shifokor tasdiqlaydi) | Rasmiy ambulator shakl raqami (TASDIQLANMAGAN) |
| 8 | **Xodimlarni dastlabki va davriy tibbiy ko‘rik paketi** (ro‘yxat 2387: kalendar reja, yo‘llanma, xulosa, yakuniy dalolatnoma) | 3 | 4 | 12 | Ko‘p bemor va ko‘p mutaxassis ko‘riklari, lab va xulosalar. Xususiy klinikalar uchun B2B daromad manbai | Korxona (to‘lovchi) kartochkasi; zararli omillar ro‘yxati (1–3-ilovalar) |
| 9 | **030 «D» nazorati (dispanser kuzatuv)** | 3 | 4 | 12 | Surunkali ICD-10 kodlar + `follow_up_date` → kuzatuv ro‘yxati va eslatma (Telegram) | Dispanser guruhlari qoidalari (milliy protokollar) |
| 10 | **060 Yuqumli kasalliklar jurnali + shoshilinch xabarnoma** | 2 | 5 | 10 | ICD-10 A00–B99 va boshqa xabar qilinadigan kodlar imzolanganda avtomatik bayroq va xabarnoma qoralamasi | Xabarnoma rasmiy shakli va muddati (TASDIQLANMAGAN); Sanepid qo‘mitasiga kanal |

**Keyingi o‘rinlar:**
- **086 tibbiy ma’lumotnoma** (Ch 3 × A 3 = 9): ko‘p mutaxassisli komissiya; endi my.gov.uz’ga DMED orqali chiqadi, shuning uchun DHP integratsiyasisiz qiymati past.
- **Mehnatga layoqatsizlik varaqasi va 094/095/138** (Ch 4, lekin **faqat statsionarli xususiy klinikalar** bera oladi): ambulator klinika uchun huquqiy jihatdan yopiq.
- **Davriy statistik hisobot** (oylik qabul va tashxislar): 100% avtomatik, lekin xususiy klinikalar uchun majburiy shakli hali tasdiqlanmagan (PQ-170, 13.1).
- **Hisob-faktura va fiskal chek**: §5.

---

## 8. Tasdiqlanmagan

1. SSV **399-son** buyrug‘ining sanasi va to‘liq nomi. Faqat DHP FHIR qo‘llanmasida «Ministry of Health Order 399» deb tilga olingan. 363-son buyruqni almashtirganmi — noma’lum.
2. 363-son (31.12.2020) va 16-son (17.01.2022) buyruqlarning to‘liq shakllar ro‘yxati — ochiq manbada yo‘q. «BTSY uchun 25 tur shakl» raqami noaniq (uzreport matnida qon xizmati bilan birga).
3. Ambulator shakl raqamlari (O‘zbekiston varianti):
   - statistik talon (sovetda 025-2/у yoki 025-12/у);
   - ko‘chirma (027/у);
   - yo‘llanma (057/у);
   - shoshilinch xabarnoma (058/у);
   - emlash kartasi (063/у);
   - homilador kartasi (111/у);
   - bolaning rivojlanish tarixi (112/у);
   - TIEK yo‘llanmasi (088/у);
   - kontrol karta 030 (jurnal 030 tasdiqlangan, karta emas).
4. 086/h ni tasdiqlagan buyruq: «SSV 25.12.2017 dagi 777-son» — faqat 2018-yilgi yangilik asosida.
5. 083/h ni tasdiqlagan buyruq raqami va sanasi.
6. «130» raqami ziddiyati: DHP’da «Laboratoriya tahlil natijalari», SSV 180-son buyrug‘ida «130 h/sh — seksion materiallarni patogistologik tekshirish jurnali».
7. Yuqumli kasallik haqida shoshilinch xabar berish muddati (O‘zbekistonda 12 soat ekanligi).
8. SSV statistik hisobot shakllari («12-son», «30-son», «47-son», «1-SSV») va «1-тиб (аҳоли)» mazmuni; xususiy klinikalar qaysi hisobotni qachon topshirishi.
9. PQ-170 5(a) bo‘yicha axborot tizimlariga yagona talablar (standartlar) — 2026-yil avgustgacha qabul qilinishi kerak edi, topilmadi.
10. PQ-170 13.1 — nodavlat tashkilotlar birlamchi hujjatlari va statistikasi tartibi (2026-yil oktabr muddati) — topilmadi.
11. DHP SSO client credentials’ni vendor qanday oladi; xususiy MIS uchun Uzinfocom bilan kelishuv yoki akkreditatsiya kerakmi (PQ-415, 7-band talqini).
12. «Elektron sog‘liqni saqlash» modullari uchun xizmat ko‘rsatish tarifi.
13. E-retseptni bosqichma-bosqich joriy etish (SSV 25-son, 15.12.2025) bekor qilinganmi — loyiha 01.05.2026 da e’lon qilingan, ro‘yxatdan o‘tgani topilmadi.
14. 2023-yil 28-fevraldagi farmon raqami (01.01.2024 dan qog‘oz varaqa taqiqi).
15. Litsenziya 27-ilova 9-bandining to‘liq matni (o‘qilmadi).
16. DMED ilovasida xususiy klinikaga yozilish (v2.11.0) qaysi yilda chiqqani (taxminan 2026).
17. «Raqamli sog‘liqni saqlash markazi»ning ta’sis hujjati.
18. Shifokor hujjatga sarflaydigan vaqtning O‘zbekiston uchun o‘lchangan ulushi — mavjud emas. 15 daqiqa — SSV bayonoti, rasmiy norma emas.
19. **To‘lovlar:**
    - Payme produksiya POST checkout hosti va test GET hosti;
    - Payme va Click IP manzillari;
    - kabinet yoki test service_id’ni shartnomasiz olish mumkinmi;
    - Paynet va Apelsin API;
    - fiskal operator nomi («NIC Yangi texnologiyalar») va fiskal modul narxi;
    - tibbiy xizmatlar QQS holati (12% yoki imtiyoz) va aylanmadan soliq to‘lovchi klinika uchun `vat_percent` 0;
    - 2026-yilgi jarima summalari;
    - PF-5813 4-bandi 2-xatboshidagi istisnolar matni.
20. Tibbiy xizmatlar QQS’ini qaytarish bo‘yicha 2026-yil apreldagi hukumat qarori raqami.

---

## 9. Usul haqida qisqa izoh

- SSV ichki buyruqlari (shakllarni tasdiqlaydiganlari) Adliya vazirligida ro‘yxatdan o‘tmaydi va lex.uz’da yo‘q. Shuning uchun shakl raqamlari quyidagi manbalardan olindi:
  - SSV buyruqlarining asl PDF nusxalari (70-son, 180-son);
  - lex.uz’dagi ro‘yxatdan o‘tgan yo‘riqnomalar (2667, 3277, 2387, 2089, 3758);
  - Uzinfocom’ning ochiq FHIR qo‘llanmasidagi rasmiy hujjat toifalari.
- Sovet yoki Rossiya raqamlari faqat taqqoslash uchun berildi. Ular O‘zbekistonda tasdiqlangan deb hisoblanmaydi.
- Shakllar uchun ishlatilgan asl hujjatlar (PDF va lex.uz matnlari) shu papkada saqlangan: `/private/tmp/claude-501/-Users-levi-Desktop-Meduza/681f0b69-e040-4e3e-acee-1d9c17057603/scratchpad/pdfs/` va `/private/tmp/claude-501/-Users-levi-Desktop-Meduza/681f0b69-e040-4e3e-acee-1d9c17057603/scratchpad/lex/`.
