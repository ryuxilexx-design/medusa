# Med.uz.ai demo — holat va tekshiruv natijalari

Yangilangan: 19-oktabr 2026 · Demo sanasi: 18-oktabr 2026 · Reliz: 0.8 (demo MVP + xodim kirishi + shifokor jadvali + Telegram bot + AI 1-bosqich + qabul hujjatlari + kassa: smena, qaytarish, xarajat + Gemini AI provayderi + uch til va sodda dizayn)

Holat belgilari: **Ishlaydi** — yozuv yaratiladi yoki o‘zgaradi, server tekshiradi, refreshdan keyin saqlanadi. **Demo ma’lumoti** — ko‘rish va filtr ishlaydi, to‘liq jarayon avtomatlashtirilmagan. **Namunaviy AI** — oldindan yozilgan natija, ochiq belgilangan. **Rejada** — demo’da yo‘q yoki faol tugmasiz. **Qisman** — asosiy qismi bor, lekin quyida yozilgan cheklov bilan.

## 00000000000000000. 0.16: shifokor kamroq yozadi — shablonlar, tez iboralar, qayta qabul

| Nima | Holat | Tekshiruv |
|---|---|---|
| Qayd shablonlari (migratsiya 025, `note_templates`): mutaxassislik bo‘yicha guruhlangan ro‘yxat (o‘z mutaxassisligi birinchi), qidiruv; qo‘llash faqat bo‘sh maydonlarni to‘ldiradi, yozilgan maydon uchun «Qoldirish / Almashtirish / Qo‘shish» (AI bilan bir xil komponent `apply-fields.tsx`); MKB-10 kodlari qo‘shiladi (≤ 5, saqlashda serverda tekshiriladi); shablon taklif qilgan tekshiruvlar belgilash ro‘yxati — shifokor belgilagani oddiy `POST /encounters/:id/orders` orqali buyuriladi, avtomatik buyurtma yo‘q | Ishlaydi | API test `templates.test.mjs`: kod/xizmat tekshiruvi 422, konsultatsiya buyurtma qilinmaydi, bo‘sh shablon 422 |
| 12 ta boshlang‘ich shablon (`database/seed/templates.ts`, statik ro‘yxat, seed PRNG’ga tegmaydi): terapevt (O‘RVI, gipertoniya, gastrit, bel og‘rig‘i), pediatr (O‘RVI, bronxit), kardiolog, nevrolog (bosh og‘rig‘i), ginekolog, UZI (qorin — normada), LOR (otit), stomatolog; `ensureStarterTemplates` — `db:create-clinic`, demo reset va API ishga tushishida (idempotent, yashirilgani qaytmaydi) | Ishlaydi | API test: ikkala demo klinikada 12 ta; qayta chaqirish 0; yangi klinikaga 12 ta, xizmat katalogisiz tekshiruv taklifi yo‘q |
| «Shablon sifatida saqlash»: to‘ldirilgan qayd matni + MKB-10 (ko‘rsatkichlar, sana, bemor emas) → o‘z mutaxassisligi yoki barcha shifokorlar uchun. O‘zgartirish: muallif yoki rahbar; o‘chirish = `active=false`; audit faqat nom bilan | Ishlaydi | API test: boshqa shifokor 403, boshlang‘ichni shifokor o‘zgartira olmaydi, rahbar — ha; registrator va kassir 403; boshqa klinika 404 |
| Tez iboralar (`quick_phrases`): har maydon ostida chiplar (eng ko‘p ishlatilgani birinchi, 6 tadan keyin «+n»), bosilsa matn yangi qatorga qo‘shiladi; «Qo‘shish» belgilangan matnni yoki oxirgi qatorni saqlaydi; shifokorniki shaxsiy, rahbarniki — umumiy | Ishlaydi | API test: takror matn bitta qator, `use` hisoblagichi tartibni belgilaydi, boshqa shifokor ko‘rmaydi |
| Qayta qabul: tasdiqlangan qayd ostida «Qayta qabulni band qilish» → oddiy band qilish oynasi (bemor, shifokor = o‘zi, sana = tavsiya, «qayta ko‘rik» xizmati bo‘lsa — u); `booking.ts` qoidalari, `source='doctor'` (jadvalda stetoskop belgisi); shifokor faqat o‘ziga yozadi (403). Bemor kartasida (`GET /patients/:id` → `follow_up: {date, booked, …}`) registratorga «Qayta qabul tavsiya etilgan» belgisi va «Band qilish»; anonimlashtirilgan bemorda belgi yo‘q | Ishlaydi | API test: imzo → booked=false → band qilish → true, manba `doctor`, band slot 409, bekor qilinsa yana false; kassir kartasida maydon yo‘q |

Cheklovlar: brauzer E2E to‘plami yozilmagan (faqat vizual o‘tish: 1366×768 va 390 px, uz va ru, gorizontal skroll yo‘q, konsol xatosi yo‘q); boshlang‘ich shablonlar matni faqat o‘zbekcha (ma’lumot, interfeys emas — tarjima qilinmaydi) va shifokor-mutaxassis ko‘rigidan o‘tmagan; boshlang‘ich shablon mutaxassislik nomi aniq mos kelsagina «o‘z mutaxassisligi» guruhiga tushadi (klinika «Terapevt» o‘rniga boshqa nom yozsa — «Boshqa» guruhida); anonimlashtirish (026) bilan birga sinalmagan — tekshiruv ustunsiz bazada ham ishlaydigan qilib yozilgan. Testlar: `templates.test.mjs` (6 ta).

## 0000000000000000. 0.15: kassa auditi (2026-10-22) — miqdor, qator bo‘yicha qaytarish, depozit, qarzdorlar, eksport

| Nima | Holat | Tekshiruv |
|---|---|---|
| Bemorning huquqlari (O‘RQ-547, migratsiya `026_patient_erasure.sql`): bemor kartasini chop etish (`/print/patient/:id`, A4 — shaxsiy ma’lumotlar, roziliklar versiyasi bilan, qabullar ro‘yxati; MKB-10 tashxis faqat shifokor nusxasida, hisoblar xulosasi rahbar/registratorda), to‘liq ma’lumot fayli (`GET /patients/:id/export.json` — faqat rahbar, audit, daqiqada 5 ta, UI faqat «yuklab olish» — matn ko‘rsatilmaydi), anonimlashtirish (`POST /patients/:id/anonymise` — rahbar, sabab majburiy, qarz/depozit/kelgusi qabul bo‘lsa 409; ism → «Anonim bemor #n», kontaktlar va tug‘ilgan sana o‘chiriladi, roziliklar qaytarib olingan qator bilan saqlanadi, Telegram ulanishi o‘chadi; qaydlar, natijalar, hujjatlar, hisoblar anonim karta ostida qoladi; qidiruv (ism/telefon), yozish va bot kartani ko‘rmaydi; qaytarib bo‘lmaydi — DB trigger) | Ishlaydi | API test `erasure.test.mjs` (6 ta): rol bo‘yicha karta maydonlari, eksport 403/404/429 va audit, 409 tafsilotlari, anonimlashtirishdan keyin qidiruv, bot, shifokor tarixi, o‘zgarmas yozuvlar, trigger |
| Buyurtmada miqdor (muolajalar kursi × 1–50): shifokor oynasida «− n +», hisob qatorida va ro‘yxatda «× 3», qator = narx × miqdor; tahlil/UZI uchun miqdor faqat 1 | Ishlaydi | API test `billing2.test.mjs`: qator jami, buyurtmada birlik narxi, 51 → 422, laboratoriya × 2 → 422, eski `service_ids` ishlaydi |
| Qator bo‘yicha qaytarish: rahbar «Butun hisob» yoki bitta xizmatni tanlaydi; qator qaytarilsa faqat shu xizmat qiymati (shifokor ulushi, xizmatlar hisoboti, dashboard) kamayadi, qolgani mutanosib | Ishlaydi | API test: xizmatlar hisoboti qiymati aynan qaytarilgan summaga kamayadi, boshqa qator o‘zgarmaydi; qator qoldig‘idan ortig‘i 422; boshqa hisob qatori 422; `NET_LINE` yig‘indisi = hisob jami; DB CHECK |
| Bemor depoziti (oldindan to‘lov): kassir smenasida qabul qilish (Idempotency-Key), bemor kartasida balans va «Oldindan to‘lov», kassada «Depozitdan» to‘lov usuli (balans > 0 bo‘lsa), rahbar qoldiqni ochiq kassadan qaytaradi; depozit — majburiyat, tushum emas (qo‘llanganda to‘lov sifatida hisoblanadi) | Ishlaydi | API test: smena kutilgan naqd depozit bilan oshadi, qo‘llashda pul harakatlanmaydi; bir balansga ikki parallel qo‘llash → bittasi 201, biri 409 `INSUFFICIENT_DEPOSIT`; registrator 403, kassir qaytarolmaydi 403; append-only trigger; moliya xulosasi `deposits.in/out/applied/balance`, dashboard tushumi = sof tushum |
| Qarzdorlar: yoshi bo‘yicha guruhlar (0–7, 8–30, 31+ kun), filtr, «Qarzdorlar» kartasi moliya sahifasida, CSV, to‘lov va’dasi (sana + izoh) kassir/rahbar tomonidan | Ishlaydi | API test: guruhlar yig‘indisi = jami qarz; `age=` filtri; o‘tgan sana 422, qarzsiz hisob 409 `NOT_A_DEBT`, registrator 403; `debtors.csv` qatorlar soni |
| CSV eksport: qaytarishlar, xarajatlar, smenalar (jami qatori bilan), shifokor ulushi, qarzdorlar — davr ≤ 1 yil, Toshkent vaqti, formula himoyasi; tugmalar moliya va hisobot sahifalarida | Ishlaydi | API test: sarlavha ustunlari, qatorlar = ro‘yxat + jami, davrsiz/1 yildan oshgan 422, `=HYPERLINK` apostrof bilan, rol cheklovlari, kassir faqat o‘z smenalari |
| Ro‘yxat chegaralari: `GET /expenses` va `GET /refunds` sahifalanadi (meta.count, total), ombor kartasi oxirgi 100 harakat + `GET /inventory/:id/movements` sahifali | Ishlaydi | API test: page_size=1, movements ≤ 100, `movements_total` |

Cheklovlar: brauzer E2E yo‘q (faqat typecheck va API testlari); depozitdan to‘lov cheki oddiy to‘lov cheki kabi chop etiladi («Depozitdan» usuli bilan); qator bo‘yicha qaytarish faqat bitta qator uchun (bir so‘rovda bir nechta qator — rahbar ketma-ket bajaradi); eski yopilgan smenalar hisobotida depozit qatorlari 0 deb ko‘rsatiladi. Testlar: `billing2.test.mjs` (6 ta).
## 000000000000000. 0.13: Telegram’siz bemorlarga SMS (Eskiz.uz)

| Nima | Holat | Tekshiruv |
|---|---|---|
| SMS kanali (migratsiya `022_sms.sql`): `notifications.channel` (telegram / sms, takrorlanish kanal bo‘yicha), `sms_settings` (klinikaning Eskiz hisobi, parol `APP_SECRET_KEY` bilan shifrlangan, API hech qachon qaytarmaydi), `sms_messages` jurnali (tur, raqam, provayder id, holat — **matn saqlanmaydi**). Yozilish tasdig‘i, kun oldingi va 2 soat oldingi eslatma, bekor/ko‘chirish, «natija tayyor» — Telegram ulanmagan, +998 raqami bor bemorga SMS bilan boradi (Telegram ulangan bo‘lsa — faqat Telegram). Matn lotin, 160 belgigacha (GSM-7), klinik ma’lumot yo‘q; sokin soatlar (08–21) va «xabarnoma istamayman» roziligi Telegram bilan bir xil. Eskiz: login → token, 401 da qayta login, 5xx/aloqa xatosi — mavjud backoff bilan qayta urinish, 4xx — `failed`. Yetkazilganlik `status_by_id` orqali 5 daqiqada so‘raladi | Ishlaydi (soxta Eskiz bilan; **haqiqiy Eskiz hisobi bilan sinalmagan**) | API testi `sms.test.mjs` (12 ta): registrator 403, noto‘g‘ri parol 422, parol javobda yo‘q / bazada shifrlangan, SMS vs Telegram kanal tanlovi, rozilik, 401 → qayta login, 503 → qayta urinish, 400 → failed, rejalashtiruvchi, sinov SMS (429 limit), statistika, ikkinchi klinika |
| Sozlamalar → «SMS»: Eskiz login/parol, jo‘natuvchi nomi (sukut `4546`), yoqish/o‘chirish, «Sinov SMS» (daqiqada bitta), 14 kunlik jadval, oxirgi xato; bemor kartasida eslatma kanali belgisi (Telegram / SMS / yo‘q) | Ishlaydi | Typecheck; brauzer E2E yo‘q |

Cheklovlar: bemorning tili yozilmaydi — SMS doim o‘zbek lotinda (rus matn tayyor, `SMS_T.ru`); Eskiz callback (webhook) yo‘q — holat so‘rab olinadi; balans ko‘rsatilmaydi; demo klinikada SMS sukut bo‘yicha o‘chiq (seed o‘zgarmagan).

## 000000000000000. 0.14: fiskalizatsiya asosi (parallel rejim)

| Nima | Holat | Tekshiruv |
|---|---|---|
| Fiskal chek asosi (migratsiya `023_fiscal.sql`): xizmatda IKPU (17 raqam), QQS (sukut 12 % / 0 % / QQSsiz), qadoq kodi; har to‘lov va qaytarish uchun `fiscal_receipts` qatori (`manual` → kassir KKM chek raqamini kiritadi, `none` → demo klinikalarda «talab qilinmaydi»); kiritilgan chek o‘zgarmaydi; to‘lov qaydi chop etilganda chek № va havola; smena hisoboti va Moliya’da «chek kiritilmagan to‘lovlar» soni va filtri; CSV’da IKPU/QQS/chek ustunlari; Sozlamalar → Klinika’da rejim va IKPU’siz xizmatlar soni; avtomatik provayder uchun outbox-worker (haqiqiy ОФД hali ulanmagan) | Ishlaydi (parallel rejim); demo klinikalarda fiskal maydonlar ko‘rinmaydi | API testi `fiscal.test.mjs` (9 ta): pay/refund qatorlari, raqam kiritish (422, 403, 404, 409, baza trigger’i), none → skipped, CSV ustunlari, smena/moliya soni, xizmat IKPU validatsiyasi, worker (issued/failed/noma’lum provayder); `npm run typecheck`, `next build` |

## 00000000000000. 0.12: shifokorning dam olish kunlari

Haftalik jadval ustiga istisno kunlar qo‘shildi (`schedule_exceptions`, migratsiya 018): shifokorning dam olish kuni yoki ta’tili, butun klinika yoki bitta filial uchun bayram, bir kunlik maxsus ish vaqti. Rahbar ularni xodim kartasida («Dam olish kunlari») va sozlamalarda («Bayram kunlari») kiritadi va o‘chiradi; davr bir nechta kun bo‘lsa, har kun alohida yozuv. Bu kunlarda registrator ham, Telegram bot ham yozolmaydi (409 `DOCTOR_UNAVAILABLE`, bo‘sh vaqt ro‘yxati bo‘sh, botning sana tugmalarida kun chiqmaydi); maxsus ish vaqti haftalik soat o‘rnini bosadi. Istisno kiritilganda shu kunlardagi rejalashtirilgan qabullar **bekor qilinmaydi** — javobda va ekranda ro‘yxat (bemor, vaqt, jadvalga havola) chiqadi, registrator ko‘chiradi. Jadval panjarasida shunday kun kulrang ustun va sabab bilan ko‘rinadi. Testlar: `schedule-exceptions.test.mjs` (6 ta). Cheklov: bayram kunlari qo‘lda kiritiladi (rasmiy taqvim import qilinmaydi); brauzer E2E yo‘q.

## 0000000000000. 0.11: to‘liq audit, tezlik, yangiliklar 2.0

| Nima | Holat | Tekshiruv |
|---|---|---|
| To‘rt yo‘nalishli audit (xavfsizlik, negativ/poygalar, yuk 3 yillik ma’lumotda, interfeys) — `docs/audit/` | Kritik va jiddiy topilmalar tuzatildi | 16 ta regression testi (`audit.test.mjs`), audit skriptlari qayta yurgizildi |
| Indekslar va baza ulanishi (migratsiya 015): jadval 23 s → ~50 ms, qidiruv trigram, uzilishda API yiqilmaydi | Ishlaydi | Yuk auditi indeks tajribasi; API testi ulanish uzilishi |
| Shaxsiy yangiliklar: 25 mutaxassislik, 5 tagacha qo‘shimcha mavzu, saqlash, «o‘qildi», shifokor menyusida «Yangiliklar» | Ishlaydi | API testi, E2E `news` |
| Tadqiqot: O‘zbekiston shakllari va integratsiyalar, shifokor vaqti — `docs/research/` | Hujjat | — |
| Katalogni rahbar o‘zi boshqaradi, SQL kerak emas (migratsiya `020_catalog.sql`): Sozlamalar → Xizmatlar — «Xizmat qo‘shish» (nomi, turi, narx, davomiylik, ulush, faol; kod avtomatik C/L/U/P), tahrirlashda tur, ulush, natija shakli (API) va **filial narxi** (filial narxi umumiydan ustun, eski buyurtmalar narxi o‘zgarmaydi); Sozlamalar → Klinika — filial qo‘shish/tahrirlash (nomi, kod, manzil, telefon, faol; yangi filial rahbarga avtomatik biriktiriladi, nofaol filial sarlavha ro‘yxatidan yo‘qoladi, oxirgi faol filial o‘chmaydi) va xona qo‘shish/tahrirlash; Ombor — «Tovar qo‘shish» va tahrirlash (nomi, birlik, filial, minimum, faol). Hech narsa o‘chirilmaydi — nofaol qilinadi | Ishlaydi | API testi `reference.test.mjs` (9 ta): yaratish/o‘zgartirish, 403 (registrator, kassir), boshqa klinika 404, nom takrori 409, `billing.currentPrice` filial narxi, audit yozuvlari; brauzerda uz/ru 1366×768 va 390 px — yon siljish yo‘q |

## 000000000000. 0.10: Hikvision kameralari

| Imkoniyat | Holat | Qanday tekshirildi |
|---|---|---|
| Kameralar (migratsiya `012_cameras.sql`), maxfiy ulanish manzili `POST /api/v1/hik/<token>` (faqat hash saqlanadi), ISAPI XML/JSON/multipart o‘qish, rasm qismlari o‘qilmaydi | Ishlaydi | API testi `cameras.test.mjs`: Hikvision hujjatidagi namunaviy xabarlar (odam sanash davr/real vaqt, fielddetection, alarmResult), yurak urishi, takror yuborish, 413 |
| To‘g‘ridan-to‘g‘ri ISAPI ulanish (migratsiya `017_camera_isapi.sql`): Digest auth, parol shifrlangan, bir bosishda sozlash (listening host yangi token bilan, kameraning test push’i, yuz kutubxonasi, taqqoslash), yuzni ilovadan kameraga yuklash (JSON `FaceDataRecord` yoki XML `pictureUpload`; rasm serverda saqlanmaydi), bekor qilingan kod kameradan o‘chadi, `pull` rejimi (`alertStream`) | Ishlaydi (soxta kamera bilan) | API testi `isapi.test.mjs` soxta Hikvision kamerasi `_fakecam.mjs` bilan; haqiqiy qurilmada tekshirish rejasi `docs/HIKVISION_FIELD_TEST.md` |
| Xodimlar davomati (kod `S-n`, yozma rozilik tasdig‘i), shifokor jadvaliga nisbatan kechikish; davr bo‘yicha jamlangan ko‘rinish | Ishlaydi | API + E2E `cameras` |
| Bemor kelishi: kod `P-<raqam>`, alohida «biometrik» rozilik (faqat imzolangan varaqa, versiya `bio-2026-10`), registratorga «Kamera tanidi» taklifi → oddiy «Keldi» | Ishlaydi | API + E2E |
| Odam oqimi (soatlar/kunlar), xavfsizlik hodisalari (ish vaqtidan tashqari ogohlantirish, «Ko‘rib chiqildi»), bosh sahifada ogohlantirish | Ishlaydi | API + E2E |
| Demo: 6 kamera, 30 kunlik tarix (xodimlarning har xil xulqi, hafta kuniga qarab oqim, tungi va kunduzgi ogohlantirishlar, bemor kelishi tarixi), simulyator; eski demo bazalarga bir marta qo‘shiladi | Demo ma’lumoti | API testi: surunkali kechikuvchi, 3 ochiq ogohlantirish, tarix |
| Ogohlantirish surati (migratsiya `016_camera_snapshots.sql`): kamera «surat saqlash» yoqilgan bo‘lsa, faqat ogohlantirish hodisasining rasmi (≤ 1 MB, 30 kun, faqat rahbarga) — yuz tanishda hech qachon; «uzoq turib qolish» (`loitering`) hodisasi; Xavfsizlik jadvalida kadr va katta oyna; demo suratlari — yuzlari xiralashtirilgan ochiq litsenziyali fotolar (`tools/snapshot-sources/ATTRIBUTION.md`) sun’iy kadrlar (`tools/gen-snapshots.mjs`) | Ishlaydi | API testi: multipart rasm bilan saqlash/saqlamaslik holatlari, rollar, boshqa klinika 404, 31 kunlik surat tozalanadi; E2E `cameras`: kadrlar yuklanadi, katta oyna |
| `tools/hik-replay.mjs` — kamerasiz, haqiqiy ISAPI formatidagi xabarlarni serverga yuborish | Ishlaydi | API testi vositani test serveriga ishga tushiradi |

**Cheklov:** haqiqiy DeepinView kamerada hali sinalmagan (Hikvision’ning to‘liq hujjatlari hamkor paroli bilan); `docs/HIKVISION.md` oxiridagi ro‘yxat birinchi kamerada tekshiriladi. Biometrik rozilik matni — yurist tekshirmagan loyiha.

## 00000000000. 0.9.1: interfeysni qayta tartiblash (sodda va tushunarli)

| Nima o‘zgardi | Tekshiruv |
|---|---|
| Login: bitta markaziy karta, «Demo rollar» / «Login va parol» yorliqlari (production’da faqat forma) | Skrinshot 1366 va 390; E2E `auth`, `i18n` |
| Qobiq: menyu «Kundalik ish» / «Boshqaruv» guruhlarida, yuqori panelda klinika + sana + bitta «Demo» belgisi, foydalanuvchi menyusi (til, parol, chiqish) | Skrinshotlar; E2E |
| Barcha sahifalar `docs/UI_GUIDE.md` bo‘yicha: qisqa sarlavha, `StatCard` raqamlar, bir qatordagi filtrlar (`Toolbar`), ixcham bo‘sh holatlar, «keyingi relizda»/izoh paragraflari olib tashlandi | Har sahifa 1366/390, uz/ru skrinshotlari; gorizontal skroll yo‘q |
| Xizmat narxini ko‘rsatishdagi kasr bo‘lish xatosi tuzatildi (butun tiyin) | Typecheck |

## 0000000000. Pilot serveri: O‘zbekistonda o‘rnatish to‘plami (production)

| Imkoniyat | Holat | Qanday tekshirildi |
|---|---|---|
| `Dockerfile` (veb + API bitta konteynerda) va `deploy/docker-compose.prod.yml`: PostgreSQL (tashqi port yo‘q), ilova `APP_MODE=production`, Caddy (HTTPS, xavfsizlik sarlavhalari), zaxira nusxa servisi | Tayyor | Lokal sinov steki: HTTPS 200, sarlavhalar, demo yo‘llari 404, cookie `Secure` |
| Kunlik shifrlangan zaxira nusxa (pg_dump + GPG AES-256), 14 kunlik + 8 haftalik, haftalik tiklash sinovi, xavfsiz tiklash (`CONFIRM=RESTORE`, oldin xavfsizlik nusxasi) | Tayyor | Birinchi nusxa + tiklash sinovi avtomatik o‘tdi; saqlash soni `KEEP_DAILY=3` bilan tekshirildi |
| Production’da demo soati ishlatilmaydi (bazada demo soati bo‘lsa API ishga tushmaydi) | Tuzatildi (avval production demo vaqtida ishlar edi) | `/me`: haqiqiy sana; audit vaqti real |
| Production interfeysida «demo» so‘zi yo‘q: sarlavhadagi soat, reliz yozuvi, sozlamalardagi demo bo‘limi, ombor va AI eslatmalari | Tuzatildi | Brauzerda 12 sahifa + sozlamalar bo‘limlari o‘qib chiqildi, skrinshotlar |
| Klinika ochish, vaqtinchalik parol → majburiy almashtirish, bemor qo‘shish (rozilik majburiy), rozilik varaqasini chop etish | Ishlaydi | Production steki HTTPS orqali, brauzer va API |
| O‘rnatish qo‘llanmasi `docs/DEPLOY_UZ.md`; qonun va provayderlar tadqiqoti `docs/PILOT_HOSTING_UZ.md` | Yozildi | — |

**Cheklov:** haqiqiy O‘zbekiston serverida, haqiqiy domen va Let’s Encrypt bilan hali sinalmagan (lokal sinovda o‘z-o‘zidan imzolangan sertifikat). Provayder narxlari va qonun bo‘yicha ochiq savollar — `docs/PILOT_HOSTING_UZ.md` 5-bo‘lim.

## 000000000. Bemor roziligi (O‘RQ-547) — pilotdan oldin

| Imkoniyat | Holat | Qanday tekshirildi |
|---|---|---|
| Ma’lumotlarni qayta ishlashga rozilik va alohida Telegram eslatmalariga rozilik, faqat qo‘shiladigan dalil yozuvlari (`patient_consents`, migratsiya `011_consent.sql`) | Ishlaydi: tur, javob, matn versiyasi, usul (imzolangan varaqa / og‘zaki / Telegram), kim va qachon; UPDATE/DELETE’ni baza triggeri rad etadi; qaytarib olish — yangi yozuv | API testi `consent.test.mjs` (7 ta): qayd etish, tarix, audit (izohsiz), trigger, boshqa klinika 404, kassir/laborant/begona shifokor 403 |
| Bemor kartasi: holat bloki, tarix, «Rozilikni qayd etish», «Rozilik varaqasini chop etish», roziliksiz kartada sariq ogohlantirish | Ishlaydi | E2E `consent`: ogohlantirish → qayd etish (javobsiz saqlanmaydi) → «Rozilik bor» + tarix; skrinshotlar 1366×768 |
| Yangi bemor formasi: rozilik belgisi + shakli, ixtiyoriy Telegram roziligi; `APP_MODE=production` da roziliksiz karta ochilmaydi (422) | Ishlaydi (demo’da ixtiyoriy) | API testi production rejimini yoqib tekshiradi; E2E formada maydonlarni tekshiradi |
| Chop etiladigan rozilik varaqasi (A4, uch tilda, bo‘sh varaqa ham) | Ishlaydi | E2E: o‘zbek va rus tilida chop etish, bo‘sh varaqa |
| Telegram bot: yangi bemordan karta yaratilishidan oldin «✅ Roziman / Yo‘q» | Ishlaydi; «Yo‘q» bo‘lsa hech narsa saqlanmaydi; mavjud bemor qayta so‘ralmaydi; Telegram roziligi «yo‘q» bo‘lsa xabarnoma navbatga qo‘yilmaydi | API testi simulyator orqali (ha/yo‘q, kirill va rus matni) |
| Seed: bemorlarning 70% ida imzolangan rozilik (`patient_number % 10 < 7`, RNG ishlatilmaydi — KPI o‘zgarmagan) | Demo ma’lumoti; avvalgi demo bazalarga API ishga tushganda bir marta qo‘shiladi (reset kerak emas) | API testi; live demo nusxasida: 70 ta qo‘shildi, qayta ishga tushishda 0 |

**Cheklov:** rozilik matni (versiya `2026-10` va botdagi `tg-2026-10`) — yurist tekshirmagan loyiha. Haqiqiy bemorlardan oldin O‘zbekiston yuristi ko‘rib chiqishi shart (saqlash muddati, qonunga havolalar, klinika rekvizitlari). Elektron imzo yo‘q: qog‘oz varaqa imzolanadi va tizimda qayd etiladi.

## 00000000. 0.8.1: UI/UX auditi va tuzatishlar

5 ta auditor (shifokor va karkas, registratura, kassa, klinik, boshqaruv) har bir ekranni 1366, 1920 va 390 px kenglikda, uch tilda skrinshot bilan tekshirdi: ~117 topilma va mayda nuqsonlar. Hammasi tuzatildi va har bir bo‘lim «oldin/keyin» skrinshotlari bilan qayta tekshirildi. axe-core (WCAG 2.1 AA) 21 ta ekranda 3 xil xato topdi — tuzatildi.

| Asosiy tuzatishlar | |
|---|---|
| Modal oynalar | Portal orqali, ekranga sig‘adi (asosiy tugma doim ko‘rinadi), fokus oyna ichida, sarlavha ekran o‘quvchiga bog‘langan |
| 1366 px ekran | Jadvallarda amallar, holat va summa ustunlari endi kesilmaydi (kassa, bemorlar, navbat, xodimlar, hisobotlar, smenalar) |
| Telefon (390 px) | Hech bir sahifa yon tomonga toshmaydi; menyu yopish tugmasi va Esc bilan |
| Summa | «1 250 000 so‘m» hech qachon qatorga bo‘linmaydi; minus — haqiqiy «−» |
| Sana va vaqt maydonlari | Yil va daqiqa to‘liq ko‘rinadi (umumiy `DateRange`); summa maydonlari bir xil (`MoneyInput`) |
| Tugma so‘zlari | Amal va holat aralashmaydi: «Keldi deb belgilash», «Smenani yopish», «Qabulni bekor qilish», «Hisobni bekor qilish» |
| Klaviatura va o‘qilishi | MKB-10 qidiruvi strelkalar bilan, jadval katakchalari va qatorlar tugma, sariq fokus halqasi hamma joyda |

## 0000000. 0.8 relizda nima qo‘shildi: uch til va sodda dizayn

| Imkoniyat | Holat | Qanday tekshirildi |
|---|---|---|
| Interfeys tili: o‘zbek (lotin), o‘zbek (kirill), rus | Ishlaydi: barcha sahifalar (kirish, shifokor, registratura, navbat, kassa, moliya, laboratoriya, UZI, dashboard, hisobotlar, xodimlar, sozlamalar, ombor), barcha chop etiladigan hujjatlar, dashboard «Tezkor savollar» javoblari, summa so‘zi (so‘m / сўм / сум) | E2E `i18n`: rus tilida kirish → shifokor sahifasi ruscha, sana «18 октября 2026»; kirillga o‘tish yangilangandan keyin ham saqlanadi; lotin matn qolmaydi |
| Til xodimda saqlanadi | Ishlaydi | API test: xodim akkauntida saqlanadi (boshqa qurilmada ham), demo kartada faqat shu sessiyada (boshqa tashrifchiga o‘tmaydi), kirishdan oldingi til yangi sessiyaga o‘tadi, noto‘g‘ri qiymat 422 |
| O‘zbek kirill matni lotindan avtomatik | Ishlaydi | API test: har bir xabar ikkala tilda, o‘rinbosarlar mos, kirill matnda lotin harfi qolmagan; namunaviy so‘zlar (Йўқ, Консультация, Телеграмда, 18-октябрь) to‘g‘ri |
| Sodda dizayn: Golos Text shrifti (ilova ichida, internetsiz), asosiy matn 18 px (hamma uchun bitta o‘lcham), katta tugmalar, sariq fokus halqasi, katta harfli sarlavhalar yo‘q | Ishlaydi | E2E: asosiy matn 18 px; skrinshotlar 1366×768 da ko‘rildi |
| Allergiya qizil chiziq bilan, qaydning pastki panelida faqat «Saqlash» va «Tasdiqlash» | Ishlaydi | Skrinshot |
| E2E: rus tilida 5 rol bilan 26 sahifa ochiladi | Ishlaydi | Har bir sahifada lug‘atdagi o‘zbekcha interfeys jumlasi qolmaganini tekshiradi (ma’lumot — ism, xizmat, qayd matni — hisobga olinmaydi); skrinshotlar ko‘rildi |
| Telegram bot: bemor o‘zbek kirillni ham tanlay oladi | Ishlaydi | API test: «Ўзбекча» tugmasi, kirill menyu bilan yozilish, bemor ismi o‘girilmaydi (migratsiya 010) |
| Server xato xabarlari va forma xatolari xodim tilida | Ishlaydi | API test: ruscha sessiyada «Пациент: не найдено», kirishdan oldin cookie tili bilan «Неверный логин или пароль»; o‘zgaruvchi qismlar (summa, xizmat nomi) o‘girilmaydi; qamrov testi: koddagi har bir doimiy xato xabari lug‘atda bor |

Cheklovlar:
- **Chop etiladigan hujjat** xodimning joriy tilida chiqadi (bemor tilida alohida tanlov yo‘q).
- **AI javoblari** (qayd tartiblash, yangiliklar qisqa mazmuni) o‘zbekcha; rus tilida AI so‘rovi keyingi bosqichda.
- **Klinika ma’lumotlari** (xizmat, xona, mutaxassislik nomlari, MKB-10 o‘zbekcha nomlari) bazada bitta tilda; ko‘p tilli katalog keyinroq.
- **Kirill imlosi** qoidalar va istisno so‘zlar ro‘yxati bilan; ona tilida so‘zlashuvchi tekshirishi kerak.

## 000000. 0.7 relizda nima qo‘shildi: Gemini — ikkinchi AI provayderi

| Imkoniyat | Holat | Qanday tekshirildi |
|---|---|---|
| `AI_PROVIDER=gemini`: o‘sha AI funksiyalari Gemini orqali (standart `gemini-3.5-flash-lite`) | Ishlaydi | API test (soxta Gemini serveri): so‘rov shakli (`responseJsonSchema`, `thinkingLevel`), ism va telefon yuborilmaydi, token va narx hisobi (kesh va «o‘ylash» tokenlari bilan). **Haqiqiy Gemini kaliti bilan, test bazasida, sun’iy matnda:** qayd tartiblash ~1,2 s, MKB-10 taklifi ~1 s (I10, R51), 8 soha yangiliklari 52 s |
| Xatolar: rad etish, kesilgan javob, noto‘g‘ri kalit, limit, «model band» (503 — vaqt yetsa bir marta qayta so‘raladi), javob tanasi kechiksa — vaqt tugadi | Ishlaydi | API test: tushunarli xato, kalit javobda yo‘q, har biri `ai_usage`da |
| Bepul tarif himoyasi | Ishlaydi | API test: `GEMINI_PAID≠1` bo‘lsa qayd va MKB-10 so‘rovi faqat demo klinikalardan (sun’iy ma’lumot, `APP_MODE≠production`) ketadi. Haqiqiy klinika — demo serverda ham — Gemini’ga hech narsa yubormaydi: shifokor tugmasi sababi bilan o‘chadi, MKB-10 so‘z bo‘yicha qidiradi, Sozlamalar → AI’da qizil ogohlantirish. Bepul tarifda narx 0 |
| O‘zbekcha apostroflar | Ishlaydi | Model yozgan `o'`, `g'` → `o‘`, `g‘`; `ma'lumot` → `ma’lumot`; inglizcha `Hodgkin's` → `Hodgkin’s` (API test) |

Cheklovlar:
- **`gemini-3.8-flash` bepul tarifda sekin** (11–20 s) va tez-tez «band» javobini beradi, shuning uchun standart model `gemini-3.5-flash-lite`. Sifati qayd va MKB-10 uchun yetarli ko‘rindi, lekin shifokor bilan baholanmagan.
- **Claude’ga qaytish:** `AI_PROVIDER=anthropic` va `ANTHROPIC_API_KEY` — kod o‘zgarmaydi.

## 00000. 0.6 relizda nima qo‘shildi: kassa (smena, qaytarish, xarajat, sof natija)

| Imkoniyat | Holat | Qanday tekshirildi |
|---|---|---|
| Kassir smenasi: ochish (boshlang‘ich naqd), yopish (sanalgan naqd, farq, izoh), hisobot | Ishlaydi | API test: kutilgan = boshlang‘ich + naqd to‘lov − naqd qaytarish − kassadan xarajat; farq bo‘lsa izoh majburiy; yopilgan smena baza triggeri bilan o‘zgarmaydi; bir vaqtda ikki ochish — bittasi. E2E: xarajat → farq bilan yopish → hisobot |
| To‘lov faqat ochiq smenada va shu filialda | Ishlaydi | API test (SHIFT_REQUIRED, SHIFT_OTHER_BRANCH); **poyga sinovi**: smena yopilayotganda to‘lov — yoki smenaga kiradi, yoki rad etiladi, hisobot doim bazaga mos |
| Pulni qaytarish (faqat rahbar) | Ishlaydi | API test: to‘lovga bog‘lanadi, ortig‘i 422, hisob kamayadi va qarz paydo bo‘lmaydi, to‘liq qaytarilsa «Qaytarilgan», naqd — ochiq smenadan, takror so‘rov bitta (Idempotency-Key), kassir — 403. E2E: naqd qaytarish → kassir panelida chiqim |
| Xarajat kiritish va bekor qilish | Ishlaydi | API test: kassir faqat o‘z kassasidan; rahbar bank/karta, o‘tgan sana bilan; kelajak sana 422; bekor qilish sabab bilan; yopilgan smenadagi xarajat bekor qilinmaydi; baza triggeri |
| Sof natija (tushum − qaytarish − xarajat) | Ishlaydi | API test: xulosa SQL bilan teng; **dashboard tushumi sof tushumga teng** (qaytarishlar ayiriladi) |

Cheklovlar:
- **Qaytarish butun hisob darajasida** va hisobdagi xizmatlarga mutanosib taqsimlanadi (shifokor ulushi, xizmatlar hisoboti, dashboard). Qaysi xizmat aynan qaytarilganini tanlash imkoni hali yo‘q.
- **Kod tekshiruvidan keyin (0.6.1):** xarajatni bekor qilish va smena yopish poygasi, qaytarishdan keyin chegirma (500 xato), smena yopish oynasida eski summa, oraliq hisobot sanasi, kassadan ortiqcha pul chiqishi tuzatildi; har biriga test bor.
- **Fiskal emas:** smena hisoboti fiskal Z-hisobot emas, fiskal chek integratsiyasi keyingi bosqichda.
- **Haqiqiy kassada sinalmagan:** jonli demo bazasida ochiq smena yo‘q (u faqat demo reset’da yaratiladi). Shuning uchun uchrashuvda kassir avval smenani ochadi.

## 0000. 0.5 relizda nima qo‘shildi: qabul hujjatlari

| Imkoniyat | Holat | Qanday tekshirildi |
|---|---|---|
| Yo‘llanma, tibbiy ma’lumotnoma, retsept: berish, ro‘yxat, chop etish | Ishlaydi | API test (ketma-ket raqam, snapshot, MKB-10 tekshiruvi); E2E: retsept → chop etish sahifasi |
| Ma’lumotnomada tashxis faqat bemor so‘rasa va faqat tasdiqlangan qayddan | Ishlaydi | API test: sukut bo‘yicha tashxis yo‘q; tasdiqlanmagan qayd bilan 409 |
| O‘zgarmaslik va bekor qilish | Ishlaydi | API test: baza triggeri tahrir va o‘chirishni bloklaydi; bekor qilish sabab bilan, ikkinchi marta 409. E2E: bosma nusxada «Bekor qilingan» |
| Ruxsat | Ishlaydi | API test: boshqa shifokor, rahbar, registrator — 403 |
| «DEMO» belgisi faqat demo rejimida | Ishlaydi | Kodda; production rejimida vizual tekshirilmagan |

Hali yo‘q: hujjatlarni bemorga Telegram orqali yuborish, davlat elektron retsepti (DMED), mehnatga layoqatsizlik varaqasi (rasmiy shakl). Haqiqiy printerda chop etib ko‘rilmagan.

## 000. 0.4 relizda nima qo‘shildi: AI 1-bosqich (shifokor vaqtini tejash)

| Imkoniyat | Holat | Qanday tekshirildi |
|---|---|---|
| Barcha AI chaqiruvlari bitta mijoz orqali: JSON sxema, rad etish va xatolar, sarf hisobi | Ishlaydi | API test, soxta Claude serveri bilan: SDK so‘rovi (model, `fallbacks: "default"`, json_schema), rad etish → 502, buzuq javob → 502, noto‘g‘ri kalit → 503; har biri `ai_usage`da |
| Anonimlashtirish | Ishlaydi | API test: AI’ga ketgan matnda bemor ismi va telefoni yo‘q, o‘rnida `[bemor]` va `[telefon]` |
| Qaydni tartiblash (jonli) | Ishlaydi (soxta serverda) | **Haqiqiy Claude bilan hali sinalmagan.** API kaliti 26-oktabrdan keyin (Max tarifidagi kredit) |
| MKB-10: qidiruv, taklif, qaydga saqlash, chop etish | Ishlaydi | API test: to‘qilgan va takror kod olib tashlanadi, noma’lum kod 422, tasdiqlashda audit’ga kodlar yoziladi. E2E: qidiruv → tanlash → saqlash → yangilangandan keyin ham bor |
| Shifokorlar uchun kundalik yangiliklar (PubMed + AI) | Ishlaydi (soxta serverlarda) | API test: annotatsiya bazaga yozilmaydi, so‘ralmagan PMID olinmaydi, kuniga bir marta, baho. **Haqiqiy PubMed va haqiqiy AI bilan hali ishga tushirilmagan** |
| AI sarfi (rahbar) | Ishlaydi | API test; E2E: Sozlamalar → AI |

Cheklovlar:
- **MKB-10 ro‘yxati boshlang‘ich**, ~130 kod. O‘zbekcha nomlarni tibbiyot mutaxassisi tekshirishi kerak; rasmiy ro‘yxat yuklanguncha shu ro‘yxat ishlaydi.
- **Narx taxminiy:** provayderning pullik tarif narxlari jadvaliga asoslangan (Gemini bepul tarifida to‘lov yo‘q). Aniq hisob Anthropic Console yoki Google AI Studio’da.
- **Ovozli qayd va hujjatlar:** ovozli qayd keyingi bosqichda. Hujjatlarni avtomatik yaratish (yo‘llanma, ma’lumotnoma) hali yo‘q, faqat xulosada MKB-10 chiqadi.

## 00. 0.3 relizda nima qo‘shildi: bemorlar uchun Telegram bot

| Imkoniyat | Holat | Qanday tekshirildi |
|---|---|---|
| Botni ulash (token shifrlanadi, javobda qaytmaydi) | Ishlaydi | API test: soxta Telegram serveri bilan getMe, deleteWebhook; noto‘g‘ri token 422; `APP_SECRET_KEY` yo‘q bo‘lsa 409; bazada faqat shifrlangan matn |
| Long polling (Telegram’dan xabarlarni o‘qish) | Ishlaydi | API test: soxta Bot API’dan kelgan xabarga javob ketdi, offset saqlandi. **Haqiqiy Telegram bilan sinalmagan** (token yo‘q) |
| Telefon orqali bog‘lanish | Ishlaydi | Faqat o‘z kontakti (Telegram tasdiqlagan). Begona kontakt va guruh chatlari rad etiladi; +998 dan boshqa raqam — xabar |
| Yozilish: xizmat → shifokor → kun → vaqt → tasdiq | Ishlaydi | API test va brauzer E2E (simulyator). Saytdagi bilan bir xil qoidalar (umumiy `booking.ts`); audit’da «Telegram bot» |
| Ikki marta kelgan xabar, eski tugma, band bo‘lgan vaqt | Ishlaydi | API test: dublikat yo‘q; tasdiq oldidan registrator vaqtni band qilsa — «band qildi» va yangi vaqtlar |
| Yangi bemor ro‘yxatdan o‘tishi | Ishlaydi | API test: noto‘g‘ri sana rad etiladi, takroriy karta ochilmaydi, bir raqamga 6 tadan ortiq karta yo‘q |
| Qabuldan oldingi so‘rovnoma → shifokor | Ishlaydi | API test: faqat shu qabul shifokori o‘qiydi (boshqa shifokor, rahbar, registrator — 403); matn audit’ga tushmaydi. E2E: shifokor oynasida ko‘rinadi |
| Ko‘chirish / bekor qilish botdan | Ishlaydi | API test; soxta qabul ID’si bilan begona qabulga tegib bo‘lmaydi |
| Eslatmalar (1 kun va 2 soat oldin), «Kelaman» | Ishlaydi | API test: bir marta navbatga qo‘yiladi va yuboriladi; tugma bosilganda belgilanadi, jadvalda ✓ |
| Klinika bekor qilsa/ko‘chirsa, natija tayyor | Ishlaydi | API test: xabar boradi, natija qiymatlari va birliklari yo‘q |
| Bitta chatdan spam | Ishlaydi | Daqiqasiga 30 ta xabar (API test). Cheklov xotirada — server qayta ishga tushsa nolga tushadi |
| Demo reset | Ishlaydi | Ulangan bot va chatlar saqlanadi, suhbat holati tozalanadi |

Hali yo‘q yoki sinalmagan:
- haqiqiy Telegram bilan uchdan-uchgacha sinov (BotFather tokeni kerak);
- webhook (hozir long polling — bitta server uchun yetarli);
- bemor tilini profilda saqlash;
- shifokor yoki xizmat bo‘yicha qidiruv;
- to‘lov botda.

Oila bitta telefondan foydalansa, chat o‘sha raqamdagi barcha kartalarni ko‘radi. Bu ataylab qilingan: ota-ona bolalarini yozadi.

## 0. 0.2 relizda nima qo‘shildi: haqiqiy xodim kirishi

Klinikaga qo‘yish uchun birinchi qadam: demo kartalardan tashqari, har bir xodim o‘z login va paroli bilan kiradi.

| Imkoniyat | Holat | Qanday tekshirildi |
|---|---|---|
| Parol bilan kirish (telefon yoki login) | Ishlaydi | API test; brauzer E2E |
| Parol saqlanishi | Ishlaydi | scrypt (N=2¹⁵), har birida alohida salt. API test: bazada ochiq parol yo‘q, xodimlar ro‘yxatida ham yo‘q |
| Xato javobi login bor-yo‘qligini oshkor qilmaydi | Ishlaydi | API test: bor va yo‘q login uchun bir xil xabar |
| 5 xato → 15 daqiqa blok, audit yozuvi; IP bo‘yicha cheklov | Ishlaydi | API test. IP cheklovi xotirada — server qayta ishga tushsa nolga tushadi |
| Vaqtinchalik parol → birinchi kirishda majburiy almashtirish | Ishlaydi | API test (boshqa barcha so‘rov 403); E2E (menyu ochilmaydi, almashtirgach ish joyi ochiladi) |
| Rahbar: xodim qo‘shish / tahrirlash / parolni tiklash / faolsizlantirish | Ishlaydi | API test; E2E. Faolsizlantirish sessiyani darhol yopadi |
| Shifokor qo‘shish: mutaxassislik, ulush, bajaradigan xizmatlar | Ishlaydi | API test. Jadvali yo‘q shifokor ro‘yxatda «Jadval yo‘q — qabul yozilmaydi» belgisi bilan |
| Shifokorning haftalik jadvali: kun, filial, xona, ish vaqti, tanaffus | Ishlaydi | API test: jadval kiritilgach bo‘sh vaqt chiqadi va qabul yoziladi; tanaffusda slot yo‘q; noto‘g‘ri tanaffus, takroriy kun, boshqa filial xonasi, biriktirilmagan filial → 422; registrator/shifokor → 403, boshqa klinika → 404. E2E: tekshiruv, ziddiyat ro‘yxati, saqlash |
| Jadvalga sig‘magan kelgusi qabullar | Ishlaydi | Saqlashda 409 va ro‘yxat (sana, bemor, sabab). «Baribir saqlash» dan keyin qabullar **o‘chirilmaydi** — registrator ko‘chiradi; audit’da soni yoziladi. Jadvalda ishlatilgan filialni shifokordan olib tashlab bo‘lmaydi |
| Himoya: o‘zini, oxirgi rahbarni, demo kartani o‘chirib bo‘lmaydi; boshqa klinika xodimi → 404; begona filial → 422 | Ishlaydi | API test, jumladan ikki rahbar bir vaqtda bir-birini o‘chirish poygasi (bittasi qoladi) |
| Demo kartalar faqat demo klinikani ochadi | Ishlaydi | API test: demo bo‘lmagan klinika a’zosi `demo_card` bo‘lsa ham 403 |
| Demo reset haqiqiy klinika bor bazada rad etiladi | Ishlaydi | API test (409 `REAL_CLINIC_PRESENT`); CLI’da qo‘lda tekshirildi |
| `db:create-clinic` CLI: klinika + filial + rahbar (+ demo xizmatlar katalogi) | Ishlaydi | Vaqtinchalik bazada qo‘lda sinaldi: 30 xizmat narxi bilan, band login rad etildi; baza o‘chirildi |

Hali yo‘q (klinikaga qo‘yishdan oldin kerak): ta’til/kasallik kabi bir martalik istisnolar (jadval faqat haftalik), ikki bosqichli tasdiq (MFA), SMS orqali parol tiklash, sessiyalar ro‘yxati, O‘zbekistondagi hosting va zaxira nusxa rejasi.

## 1. «P0 to‘liqmi?» — TZ bilan banddan-band solishtirish

Oldingi hisobotdagi «P0 to‘liq» da’vosi qayta tekshirildi. Natija: **P0 yadrosi ishlaydi; 4 ta band qisman** — ular quyida aniq belgilangan.

### 1.1. TZ §3 «P0 tarkibi»

| P0 band | Holat | Izoh |
|---|---|---|
| Demo kirish / rollar | Ishlaydi | 5 rol kartasi + parol bilan xodim kirishi (0-bo‘lim), HttpOnly cookie sessiya, ruxsatlar serverda |
| Filial filtri | Ishlaydi | Yuqori panelda; jadval, ro‘yxat va statistika qayta yuklanadi; ruxsatsiz filial → 403 |
| Bemorlar | Ishlaydi | Ro‘yxat, qidiruv, yaratish, tahrirlash, dublikat ogohlantirishi, profil |
| Jadval | Ishlaydi | Kunlik grid va ro‘yxat; haftalik ko‘rinish P1 — **Rejada** |
| Navbat | Ishlaydi | |
| Shifokor qabuli | Ishlaydi | Tasdiqlangan qaydni tuzatish (versiya) P1 — **Rejada** |
| Bazaviy tahlil buyurtmasi va natijasi | Ishlaydi | |
| Hisob / to‘lov | Ishlaydi | 0.6: pulni qaytarish (rahbar), kassa smenasi |
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
| M-01 Kirish, rollar, reset | Ishlaydi | 0.2: parol bilan kirish, majburiy parol almashtirish, blok (0-bo‘lim) |
| M-02 Rahbar dashboardi | Ishlaydi | Har bir KPI va grafik ustuni filtrlangan ro‘yxatga olib boradi |
| M-03/M-04 Bemorlar, profil | Ishlaydi | Allergiyaning 3 holati alohida |
| M-05 Qabul jadvali | Ishlaydi | Qabul yaratish idempotent (javob yo‘qolsa qayta yuborish dublikat bermaydi). Haftalik ko‘rinish, drag-and-drop — Rejada |
| M-06 Navbat | Ishlaydi | Jamoat monitori — Rejada |
| M-07 Shifokor kabineti | Ishlaydi | Tuzatish versiyasi — Rejada |
| M-08 Laboratoriya | Ishlaydi | Apparat integratsiyasi, barcode — Rejada |
| M-09 UZI | Ishlaydi (P1) | DICOM/PACS, rasm yuklash — Rejada |
| M-10 Kassa | Ishlaydi | 0.6: smena va qaytarish; chegirma oqimi soddalashtirilgan (1.3) |
| M-11 Moliya | Ishlaydi | 0.6: xarajat kiritish/bekor qilish, smenalar, qaytarishlar, sof natija |
| M-12 Xodimlar, ulush | Ishlaydi (P1) | 0.2: xodim qo‘shish/tahrirlash/parol tiklash/faolsizlantirish. 0.2: haftalik jadvalni tahrirlash. Bir martalik istisnolar (ta’til), payroll — Rejada |
| M-13 Ombor | Ishlaydi (P1): tovar qo‘shish/tahrirlash, kirim/chiqim | Avtomatik yechish, partiya — Rejada |
| M-14 Sozlamalar | Ishlaydi: klinika nomi, filiallar, xonalar, xizmatlar (narx, filial narxi, ulush) — rahbar o‘zi kiritadi | Logotip, shablon maydonlari, modul ko‘rinishi, laboratoriya natija shaklini formada tahrirlash — Rejada |
| AI-01 qaydni tartiblash | Namunaviy AI | `AI_MODE=sample` (standart): faqat demo matni. `live` rejim kodda bor, **haqiqiy kalit bilan sinalmagan** |
| AI-02 rahbar savollari | Ishlaydi (AI emas) | SQL natijasidan shablon; ekranda «bu AI emas» deb yozilgan |
| Telegram bot (bemorlar) | Ishlaydi (0.3) | 00-bo‘lim. Haqiqiy Telegram tokeni bilan hali sinalmagan |
| Rus tili (xodimlar interfeysi), mobil workflow, SMS, DMED, Payme/Click | Rejada | Menyuda yo‘q. Bot o‘zbek va rus tilida |

## 6. Bajarilgan tekshiruvlar (oxirgi natija)

| Buyruq / tekshiruv | Natija |
|---|---|
| `npm test` (meduza_test) | 111/111 o‘tdi (16 ta audit regression, 13 ta kamera testi): 11 P0, 6 P1, 2 ta demo vaqti va xavfsizlik, 8 ta xodim kirishi, 4 ta shifokor jadvali, 13 ta Telegram bot, 9 ta AI/MKB-10/yangiliklar (Gemini bilan), 5 ta qabul hujjatlari, 8 ta kassa testi |
| `npm run e2e` (izolyatsiyalangan stek) | 150/150 (12 to‘plam, jumladan kameralar va yangiliklar); oldingi qayd 113/113: asosiy yo‘l, xato holatlari, xodim kirishi, shifokor jadvali, Telegram simulyatori, AI/MKB-10, qabul hujjatlari, kassa, uch til, rozilik (10) |
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
9. Login butun tizim bo‘yicha yagona: bitta telefon raqami bilan faqat bitta akkaunt. Bir odam ikki klinikada ishlasa, kirishda klinikani tanlash imkoni API’da bor, lekin uni yaratadigan UI hali yo‘q.
7. Seed telefon raqamlari tasodifiy generatsiya qilingan. Hech qayerga yuborilmaydi, lekin haqiqiy raqamga to‘g‘ri kelishi mumkin.
8. Bekor qilingan qabulda to‘lov bo‘lsa, pul avtomatik qaytarilmaydi: rahbar «Pulni qaytarish» orqali qaytaradi (0.6).
10. **Bemor roziligi matni** (`2026-10`, bot uchun `tg-2026-10`) — yurist tekshirmagan loyiha; haqiqiy bemorlardan oldin yurist ko‘rib chiqishi shart. Rozilikni qaytarib olgan bemor kartasi bloklanmaydi — faqat sariq ogohlantirish chiqadi (keyingi qadam klinika tartibiga bog‘liq).
