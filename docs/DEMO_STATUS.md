# Med.uz.ai demo — holat va tekshiruv natijalari

Yangilangan: 19-oktabr 2026 · Demo sanasi: 18-oktabr 2026 · Reliz: 0.6 (demo MVP + xodim kirishi + shifokor jadvali + Telegram bot + AI 1-bosqich + qabul hujjatlari + kassa: smena, qaytarish, xarajat)

Holat belgilari: **Ishlaydi** — yozuv yaratiladi yoki o‘zgaradi, server tekshiradi, refreshdan keyin saqlanadi. **Demo ma’lumoti** — ko‘rish va filtr ishlaydi, to‘liq jarayon avtomatlashtirilmagan. **Namunaviy AI** — oldindan yozilgan natija, ochiq belgilangan. **Rejada** — demo’da yo‘q yoki faol tugmasiz. **Qisman** — asosiy qismi bor, lekin quyida yozilgan cheklov bilan.

## 00000. 0.6 relizda nima qo‘shildi: kassa (smena, qaytarish, xarajat, sof natija)

| Imkoniyat | Holat | Qanday tekshirildi |
|---|---|---|
| Kassir smenasi: ochish (boshlang‘ich naqd), yopish (sanalgan naqd, farq, izoh), hisobot | Ishlaydi | API test: kutilgan = boshlang‘ich + naqd to‘lov − naqd qaytarish − kassadan xarajat; farq bo‘lsa izoh majburiy; yopilgan smena baza triggeri bilan o‘zgarmaydi; bir vaqtda ikki ochish — bittasi. E2E: xarajat → farq bilan yopish → hisobot |
| To‘lov faqat ochiq smenada va shu filialda | Ishlaydi | API test (SHIFT_REQUIRED, SHIFT_OTHER_BRANCH); **poyga sinovi**: smena yopilayotganda to‘lov — yoki smenaga kiradi, yoki rad etiladi, hisobot doim bazaga mos |
| Pulni qaytarish (faqat rahbar) | Ishlaydi | API test: to‘lovga bog‘lanadi, ortig‘i 422, hisob kamayadi va qarz paydo bo‘lmaydi, to‘liq qaytarilsa «Qaytarilgan», naqd — ochiq smenadan, takror so‘rov bitta (Idempotency-Key), kassir — 403. E2E: naqd qaytarish → kassir panelida chiqim |
| Xarajat kiritish va bekor qilish | Ishlaydi | API test: kassir faqat o‘z kassasidan; rahbar bank/karta, o‘tgan sana bilan; kelajak sana 422; bekor qilish sabab bilan; yopilgan smenadagi xarajat bekor qilinmaydi; baza triggeri |
| Sof natija (tushum − qaytarish − xarajat) | Ishlaydi | API test: xulosa SQL bilan teng; **dashboard tushumi sof tushumga teng** (qaytarishlar ayiriladi) |

Cheklovlar:
- **Qaytarish butun hisob darajasida.** Xizmatlar hisobotida (accrual) qaytarilgan xizmat qiymati qolishi mumkin; kassa hisobotlari (cash) to‘g‘ri.
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
- **Narx taxminiy:** Anthropic narxlar jadvaliga asoslangan. Aniq hisob Console’da.
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
| M-13 Ombor | Ishlaydi (P1) | Avtomatik yechish, partiya — Rejada |
| M-14 Sozlamalar | Ishlaydi | Logotip, shablon maydonlari, modul ko‘rinishi — Rejada |
| AI-01 qaydni tartiblash | Namunaviy AI | `AI_MODE=sample` (standart): faqat demo matni. `live` rejim kodda bor, **haqiqiy kalit bilan sinalmagan** |
| AI-02 rahbar savollari | Ishlaydi (AI emas) | SQL natijasidan shablon; ekranda «bu AI emas» deb yozilgan |
| Telegram bot (bemorlar) | Ishlaydi (0.3) | 00-bo‘lim. Haqiqiy Telegram tokeni bilan hali sinalmagan |
| Rus tili (xodimlar interfeysi), mobil workflow, SMS, DMED, Payme/Click | Rejada | Menyuda yo‘q. Bot o‘zbek va rus tilida |

## 6. Bajarilgan tekshiruvlar (oxirgi natija)

| Buyruq / tekshiruv | Natija |
|---|---|
| `npm test` (meduza_test) | 63/63 o‘tdi: 11 P0, 6 P1, 2 ta demo vaqti va xavfsizlik, 8 ta xodim kirishi, 4 ta shifokor jadvali, 13 ta Telegram bot, 8 ta AI/MKB-10/yangiliklar, 5 ta qabul hujjatlari, 6 ta kassa testi |
| `npm run e2e` (izolyatsiyalangan stek) | 89/89: 19 asosiy yo‘l + 16 xato holati + 11 xodim kirishi + 8 shifokor jadvali + 9 Telegram simulyatori + 7 AI/MKB-10 + 7 qabul hujjatlari + 12 kassa |
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
