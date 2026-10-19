# Med.uz.ai demo — holat va tekshiruv natijalari

Yangilangan: 17-oktabr 2026 (kechqurun) · Demo sanasi: 18-oktabr 2026 · Reliz: 0.1 (demo MVP)

Holat belgilari: **Ishlaydi** — yozuv yaratiladi yoki o‘zgaradi, server tekshiradi, refreshdan keyin saqlanadi. **Demo ma’lumoti** — ko‘rish va filtr ishlaydi, to‘liq jarayon avtomatlashtirilmagan. **Namunaviy AI** — oldindan yozilgan natija, ochiq belgilangan. **Rejada** — demo’da yo‘q yoki faol tugmasiz. **Qisman** — asosiy qismi bor, lekin quyida yozilgan cheklov bilan.

## 1. «P0 to‘liqmi?» — TZ bilan banddan-band solishtirish

Oldingi hisobotdagi «P0 to‘liq» da’vosi qayta tekshirildi. Natija: **P0 yadrosi ishlaydi; 4 ta band qisman** — ular quyida aniq belgilangan.

### 1.1. TZ §3 «P0 tarkibi»

| P0 band | Holat | Izoh |
|---|---|---|
| Demo kirish / rollar | Ishlaydi | 5 rol kartasi, HttpOnly cookie sessiya, ruxsatlar serverda |
| Filial filtri | Ishlaydi | Yuqori panelda; jadval, ro‘yxat va statistika qayta yuklanadi; ruxsatsiz filial → 403 |
| Bemorlar | Ishlaydi | Ro‘yxat, qidiruv, yaratish, tahrirlash, dublikat ogohlantirishi, profil |
| Jadval | Ishlaydi | Kunlik grid va ro‘yxat; haftalik ko‘rinish P1 — **Rejada** |
| Navbat | Ishlaydi | |
| Shifokor qabuli | Ishlaydi | Tasdiqlangan qaydni tuzatish (versiya) P1 — **Rejada** |
| Bazaviy tahlil buyurtmasi va natijasi | Ishlaydi | |
| Hisob / to‘lov | Ishlaydi | Pulni qaytarish P1 — **Rejada** (faol tugma yo‘q) |
| Bog‘langan dashboard | Ishlaydi | |
| Print | **Qisman** | Brauzer print/PDF ishlaydi; A4 sig‘ishi headless Chrome PDF’da tekshirilgan. **Haqiqiy printerda chop etib ko‘rilmagan** |
| Seed / reset | Ishlaydi | Deterministik; reset ma’lumot va demo vaqtini birga tiklaydi |
| Auditning minimal qismi | Ishlaydi | Bemor, qabul (yaratish/ko‘chirish/status), qayd va natija tasdig‘i, to‘lov/chegirma, sozlama, reset |

### 1.2. TZ §17 P0 qabul mezonlari

| Mezon | Natija | Qanday tekshirildi |
|---|---|---|
| Barcha mahsulot nomlari Med.uz.ai, «Clinic OS» yo‘q | O‘tdi | Manba kodi va hujjatlarda «clinic os» qidiruvi — topilmadi |
| 5 rol o‘z menyusi bilan kiradi, sessiya serverda | O‘tdi | API test; brauzer o‘tishi (5 rol) |
| 100 seed bemor, demo kunida jadval/navbat bo‘sh emas | O‘tdi | API test; demo bazada SQL: bugun 30 qabul, navbatda 20 ta |
| Yangi bemor qidiruvda topiladi va refreshdan keyin qoladi | O‘tdi | API test; brauzer E2E; DB va API restartidan keyin |
| Bir telefonli oila ogohlantirishdan keyin alohida saqlanadi | O‘tdi | API test |
| Qabul shifokor va filial jadvalida bir marta ko‘rinadi | O‘tdi | API test |
| Band vaqtga parallel yozilishdan bittasi 409 | O‘tdi | API test (ikki sessiya bir vaqtda) + DB exclusion constraint |
| Check-in navbatni yaratadi, qayta bosish ko‘paytirmaydi | O‘tdi | API test (parallel); E2E (refreshdan keyin bitta qator) |
| Shifokor qoralama saqlaydi, qayta ochadi, tasdiqlaydi va yakunlaydi | O‘tdi | API test; E2E |
| Signed qaydni oddiy tahrirlash serverda bloklangan | O‘tdi | API test (409) + DB trigger |
| Tahlil buyurtmasi laboratoriya va hisobda bir marta | O‘tdi | API test (`invoice_items.order_id UNIQUE`) |
| Natija tasdiqlangach shifokor kartasida to‘g‘ri statusda | O‘tdi | API test (tasdiqgacha qiymat yashirin); E2E |
| Qisman va to‘liq to‘lovda qoldiq to‘g‘ri; qayta so‘rov dublikat yaratmaydi | O‘tdi | API test; E2E; **brauzerda javob yo‘qolishi bilan sinaldi** (2-bo‘lim) |
| Ikki parallel to‘lov qoldiqdan ortiq qoplamaydi | O‘tdi | API test (ikki kassir sessiyasi → `[201, 409]`) |
| Dashboard tushumi filtrlangan to‘lovlar yig‘indisiga teng | O‘tdi | API test: bugun/7/30 kun × barcha/Yunusobod; qarzdorlik = qarzdor hisoblar summasi |
| Filial va tenant chegaralaridan ma’lumot chiqmaydi; kassir klinik yozuvni o‘qiy olmaydi | O‘tdi | API test (2-tenant ID → 404, filial → 403, kassir/rahbar/boshqa shifokor → 403); E2E (print URL rad etildi) |
| Xulosa, natija va ichki to‘lov qaydi A4 printda kesilmaydi | **Qisman** | PDF (A4, print CSS): xulosa, tahlil, UZI va to‘lov qaydining har biri bitta sahifa, kesilmagan. **Haqiqiy printer sinalmagan** — PDF tekshiruvi printer tekshiruvi emas |
| API xatosida forma mazmuni qoladi va xato ko‘rinadi | O‘tdi | Brauzerda: oflayn holatda qoralama saqlash → «Saqlanmadi», matn joyida, muvaffaqiyat xabari yo‘q (2-bo‘lim) |
| Resetdan keyin boshlang‘ich seed izchil tiklanadi | O‘tdi | API test; ikki reset orasida md5 bir xil |
| Lokal qayta ishga tushirishdan keyin demo ochiladi; internet yo‘qligida asosiy jarayon ishlaydi | **Qisman** | Restart: Postgres va API qayta ishga tushirildi — ma’lumot va sessiya saqlandi, demo vaqti orqaga qaytmadi (11:30:00 → 11:30:24). Internet: asosiy ekranlarda brauzer `127.0.0.1` dan tashqariga birorta ham so‘rov yubormaydi (tekshirildi). **Noutbuk internetdan haqiqatan uzilgan holda sinalmagan** |

### 1.3. P0 modullaridagi boshqa talablar — soddalashtirilgan joylar

| Talab (TZ) | Holat |
|---|---|
| M-10 chegirma oqimi: registrator so‘raydi → rahbar tasdiqlaydi → kassir qo‘llaydi (§4 jadvali) | **Qisman** — chegirmani rahbar sabab bilan to‘g‘ridan-to‘g‘ri qo‘llaydi; so‘rov/tasdiq bosqichlari yo‘q. TZ M-10 dagi P0 minimumi («rahbar ruxsati va majburiy sabab») bajarilgan |
| §5.2 to‘liq klaviatura bilan boshqarish | **Qisman** — label’lar, ko‘rinadigan fokus, Esc bilan modal yopish bor; to‘liq klaviatura auditi o‘tkazilmagan |
| §15 «Sessiya tugadi → qayta kirish taklifi» | Ishlaydi (soddaroq) — 401 da himoyalangan ma’lumot yashiriladi va kirish sahifasiga yo‘naltiriladi, alohida xabar oynasi yo‘q |
| M-01 production’da demo kirish/reset yoqilmaydi | Ishlaydi — `APP_MODE=production` da `/demo/accounts` va `/demo/login` → 404, sessiyasiz `/demo/reset` → 401 (tekshirildi) |

## 2. Brauzerdagi xato holatlari (real headless Chrome, izolyatsiyalangan test stekida)

`npm run e2e` → `e2e/errors.mjs`, 16 tekshiruv, hammasi o‘tdi:

| Holat | Natija |
|---|---|
| Qoralama yozilayotganda aloqa uzildi | «Saqlanmadi…» xatosi, matn formada qoldi, muvaffaqiyat xabari chiqmadi |
| Aloqa tiklangach qayta saqlash | Serverga yozildi |
| Qoralama saqlandi, lekin javob yo‘qoldi | Interfeys xato ko‘rsatdi (muvaffaqiyat emas); keyingi saqlash versiya konfliktisiz o‘tdi (avtomatik tiklash) |
| Tasdiqlash javobi yo‘qoldi | Xato ko‘rsatildi; qayta urinishda «allaqachon tasdiqlangan» — haqiqiy holat |
| To‘lov yuborildi, javob yo‘qoldi | «Server javobi olinmadi» holati, summa/usul qulflanadi, muvaffaqiyat xabari yo‘q; «Shu to‘lovni qayta yuborish» → xuddi shu kalit → hisobda **faqat 1 to‘lov**, «avvalroq qayd etilgan — ikkinchi marta yozilmadi» |
| Saqlanmagan qayd bilan menyu orqali chiqish | «Saqlanmagan o‘zgarishlar bor» oynasi, sahifa almashmaydi; «Sahifada qolish» — matn joyida. Sahifani yopish/yangilashda brauzer ogohlantiradi |
| Saqlanmagan formani Esc bilan yopish | Tasdiq so‘raladi |

Sinov paytida topilgan va tuzatilgan xatolar:
1. Oflayn holatda TanStack Query mutatsiyani jim «pauza»ga qo‘yardi: foydalanuvchi hech qanday xabar ko‘rmasdi.
2. Javobi yo‘qolgan saqlashdan keyin keyingi saqlash 409 bilan bloklanardi.
3. Javob yo‘qolgandan keyin kassir summani o‘zgartirib ikkinchi to‘lov yaratishi mumkin edi.
4. Menyu havolalari saqlanmagan matnni ogohlantirmasdan tashlab ketardi.

## 3. Demo vaqti

- Yagona manba: PostgreSQL’dagi `demo_clock` + `demo_now()`. API har so‘rovda o‘z soatini shu manbadan sinxronlaydi. Qabul, navbatdagi kutish, to‘lov, audit va DB’dagi vaqt ustunlarining standart qiymatlari, dashboard filtrlari — hammasi bir xil soatdan foydalanadi.
- API restarti vaqtni orqaga qaytarmaydi (avtomatik test + demo stekda qo‘lda tekshirildi). Faqat demo reset ma’lumot va vaqtni birga 18.10.2026 11:30 ga qaytaradi.
- Yuqori panelda «Demo vaqti · 18-oktabr 2026, yakshanba, hh:mm» ko‘rsatiladi.
- Seed’da 11:30 dan keyingi birorta «yaratilgan/to‘langan/kelgan» vaqt yo‘q (kelajak qabullarning `created_at` qiymati tuzatildi).

## 4. Test va demo bazasi

- `npm test` va `npm run e2e` faqat `meduza_test` bazasida ishlaydi. E2E alohida portlarda (3100/4100) o‘z serverini ko‘taradi.
- Ikki qatlamli xavfsizlik: test helperi bazaning `*_test` nomini tekshiradi; API `MEDUZA_TEST=1` bo‘lganda resetni faqat `*_test` bazada bajaradi. Demo bazaga yo‘naltirilgan test «Xavfsizlik to‘xtatdi» bilan to‘xtaydi (avtomatik test bor).
- O‘zgartirishlardan oldin demo baza nusxasi olingan: `backups/meduza-20261017-181447-pre-final.dump` (tiklash: `npm run db:restore -- <fayl>`).

## 5. Modullar holati

| Modul | Holat | Izoh |
|---|---|---|
| M-01 Kirish, rollar, reset | Ishlaydi | |
| M-02 Rahbar dashboardi | Ishlaydi | Har bir KPI va grafik ustuni filtrlangan ro‘yxatga olib boradi |
| M-03/M-04 Bemorlar, profil | Ishlaydi | Allergiyaning 3 holati alohida |
| M-05 Qabul jadvali | Ishlaydi | Qabul yaratish idempotent (javob yo‘qolsa qayta yuborish dublikat bermaydi). Haftalik ko‘rinish, drag-and-drop — Rejada |
| M-06 Navbat | Ishlaydi | Jamoat monitori — Rejada |
| M-07 Shifokor kabineti | Ishlaydi | Tuzatish versiyasi — Rejada |
| M-08 Laboratoriya | Ishlaydi | Apparat integratsiyasi, barcode — Rejada |
| M-09 UZI | Ishlaydi (P1) | DICOM/PACS, rasm yuklash — Rejada |
| M-10 Kassa | Ishlaydi | Qaytarish — Rejada; chegirma oqimi soddalashtirilgan (1.3) |
| M-11 Moliya | Ishlaydi | Xarajatlar — Demo ma’lumoti (faqat ko‘rish); smena, sof natija — Rejada |
| M-12 Xodimlar, ulush | Ishlaydi (P1) | Jadvalni tahrirlash, payroll — Rejada |
| M-13 Ombor | Ishlaydi (P1) | Avtomatik yechish, partiya — Rejada |
| M-14 Sozlamalar | Ishlaydi | Logotip, shablon maydonlari, modul ko‘rinishi — Rejada |
| AI-01 qaydni tartiblash | Namunaviy AI | `AI_MODE=sample` (standart): faqat demo matni. `live` rejim kodda bor, **haqiqiy kalit bilan sinalmagan** |
| AI-02 rahbar savollari | Ishlaydi (AI emas) | SQL natijasidan shablon; ekranda «bu AI emas» deb yozilgan |
| Rus tili, mobil workflow, SMS/Telegram, DMED, Payme/Click | Rejada | Menyuda yo‘q |

## 6. Bajarilgan tekshiruvlar (oxirgi natija)

| Buyruq / tekshiruv | Natija |
|---|---|
| `npm test` (meduza_test) | 19/19 o‘tdi: 11 P0, 6 P1, 2 ta demo vaqti va xavfsizlik testi |
| `npm run e2e` (izolyatsiyalangan stek) | 35/35: 19 asosiy yo‘l + 16 xato holati |
| Vizual o‘tish, demo ilovada, faqat o‘qish | 18 skrinshot (`docs/screenshots/`), gorizontal skroll yo‘q, sig‘magan modal yo‘q, konsol xatosi yo‘q; o‘tishdan oldin va keyin demo ma’lumotlari fingerprint’i bir xil |
| `npm run typecheck`, `npm run build` | Xatosiz |
| Tashqi so‘rovlar | Asosiy ekranlarda yo‘q |
| Print → PDF (A4) | 4 hujjat × 1 sahifa |

## 7. Tekshirilmagan / ma’lum cheklovlar

1. **Haqiqiy printer** — sinalmagan (faqat PDF).
2. **Internet jismonan uzilgan holat** — sinalmagan; tashqi so‘rov yo‘qligi tekshirilgan.
3. **AI live rejim** — haqiqiy kalit bilan sinalmagan. Namoyish uchun `sample`.
4. **Bir brauzer = bitta sessiya** — bir nechta rol uchun alohida brauzer profillari kerak.
5. **Demo vaqti reset’dan keyin real vaqtda yuradi.** Reset juda erta qilinsa (masalan 6 soat oldin), tushdan keyingi bo‘sh slotlar ham «o‘tgan» bo‘lib qoladi. Reset uchrashuvdan 10–30 daqiqa oldin qilinadi.
6. Tenant izolyatsiyasi ilova darajasida (`tenant_id` + composite FK); PostgreSQL RLS, MFA, monitoring — production oldidan alohida bosqich (TZ §16).
7. Seed telefon raqamlari tasodifiy generatsiya qilingan. Hech qayerga yuborilmaydi, lekin haqiqiy raqamga to‘g‘ri kelishi mumkin.
8. Bekor qilingan qabulda to‘lov bo‘lsa, pulni qaytarish moduli yo‘q. Ogohlantirish chiqadi va hisob qo‘lda ko‘rib chiqiladi.
