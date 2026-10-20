# Med.uz.ai — klinika boshqaruv platformasi (demo MVP)

Registratura, shifokor, laboratoriya, kassa va rahbariyat bitta ma’lumot bilan ishlaydigan ko‘p tarmoqli klinika uchun demo.
Barcha ma’lumotlar sun’iy. Texnik topshiriq: [`docs/MVP_TZ.md`](docs/MVP_TZ.md).

- Namoyish ssenariysi: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md)
- Funksiyalar holati va tekshiruv natijalari: [`docs/DEMO_STATUS.md`](docs/DEMO_STATUS.md)

## Texnologiyalar

| Qism | Texnologiya |
|---|---|
| `apps/web` | Next.js 15 (App Router) + TypeScript + Tailwind + TanStack Query |
| `apps/api` | NestJS 11, `/api/v1`, HttpOnly cookie sessiya, rol/tenant/filial guard, zod validatsiya |
| `packages/contracts` | Umumiy zod sxemalari, yorliqlar, pul formatlash |
| `database/` | PostgreSQL 16 SQL migratsiyalari, deterministik seed, demo reset |
| `e2e/` | Brauzer testlari: demo yo‘li, xato holatlari (oflayn, javob yo‘qolishi, saqlanmagan forma), vizual o‘tish (puppeteer-core + o‘rnatilgan Chrome) |

Brauzer faqat `http://127.0.0.1:3000` bilan gaplashadi. Next.js `/api/v1/*` ni API’ga proxy qiladi, shuning uchun sessiya cookie’si bir origin’da qoladi.

## Talablar

- Node.js 20+ va npm 10+
- Docker (PostgreSQL uchun; `pgvector/pgvector:pg16` image ishlatiladi — oddiy PostgreSQL 16 bilan ham ishlaydi)
- E2E uchun Google Chrome (macOS’da standart yo‘l; boshqa joyda bo‘lsa `CHROME_PATH`)

## O‘rnatish va ishga tushirish

```bash
cp .env.example .env          # kerak bo‘lsa qiymatlarni o‘zgartiring
npm run setup                 # npm install + PostgreSQL konteyneri + migratsiya + seed
npm run demo                  # production build va ishga tushirish (namoyish uchun shu)
```

Ilova: **http://127.0.0.1:3000** (API: http://127.0.0.1:4000/api/v1).

Ishlab chiqish rejimi (hot reload): `npm run dev`.

| Buyruq | Vazifasi |
|---|---|
| `npm run db:up` / `npm run db:down` | PostgreSQL konteynerini yoqish / o‘chirish (ma’lumot `meduza_pg` volume’da saqlanadi) |
| `npm run db:migrate` | Faqat migratsiyalar |
| `npm run db:reset` (= `db:seed`) | **Demo bazani** boshlang‘ich holatga tiklash: ma’lumot + demo vaqti birga. Ilova ishlab turganda ham mumkin |
| `npm run db:backup` | Demo bazaning tiklanadigan nusxasi → `backups/meduza-<vaqt>.dump` |
| `npm run db:restore -- backups/<fayl>.dump` | Nusxadan tiklash (avval ilovani to‘xtating) |
| `npm run build` / `npm run start` | Production build / ishga tushirish |
| `npm test` | API integratsion testlari (65 ta). **Faqat `meduza_test` bazasida** ishlaydi, demo bazaga tegmaydi |
| `npm run typecheck` | Barcha paketlar tip tekshiruvi |
| `npm run e2e` | Brauzer testlari (asosiy demo yo‘li + xato holatlari + xodim kirishi + shifokor jadvali + Telegram bot + AI/MKB-10 + hujjatlar + kassa) **alohida stekda**: web :3100, API :4100, `meduza_test`. Demo serverlar va demo baza ishlatilmaydi. Skrinshotlar `e2e/shots/` ga |
| `node e2e/run.mjs visual` | Asosiy ekranlar va modallarning 1366×768 skrinshotlari (test stekda) |
| `npm run db:create-clinic -- --name … --branch … --manager-name … --manager-login … [--catalog demo]` | Haqiqiy klinikani ochish: tenant, birinchi filial va rahbar akkaunti. Vaqtinchalik parol terminalda **bir marta** chiqadi. Real klinika uchun alohida, `APP_MODE=production` muhitida ishlating |
| `npm run db:import-icd10 -- fayl.csv [--replace]` | Rasmiy MKB-10 ro‘yxatini yuklash (ustunlar: `code;title_ru;title_uz`). `--replace` boshlang‘ich ro‘yxatdagi, faylda yo‘q kodlarni olib tashlaydi. Qaydlardagi kodlar o‘z nomi bilan saqlangan, buzilmaydi |
| `node e2e/visual.mjs` | Xuddi shu vizual o‘tish **ishlab turgan demo ilovada**, faqat o‘qish rejimida (hech narsa saqlanmaydi) → `docs/screenshots/` |

### Test va demo bazasini ajratish

- Demo baza: `meduza` (`DATABASE_URL`). Test baza: `meduza_test` (`TEST_DATABASE_URL`, standart qiymati shu). `npm test` uni avtomatik yaratadi.
- Xavfsizlik: test va E2E ishga tushishdan oldin bazaning nomi `*_test` ekanini tekshiradi. API ichida ham, `MEDUZA_TEST=1` bo‘lganda, `/demo/reset` faqat `*_test` bazada ishlaydi. Aks holda «Xavfsizlik to‘xtatdi» xatosi bilan to‘xtaydi.
- E2E alohida portlarda alohida server ko‘taradi va o‘zi to‘xtatadi. Namoyish serveri (:3000/:4000) ishlab turganda ham bemalol ishga tushiriladi.

Demo reset’ni ilova ichidan ham qilish mumkin: **Rahbar → Sozlamalar → Demo boshqaruvi → «Demo ma’lumotlarini tiklash»** (tasdiq uchun `TIKLASH` deb yoziladi). Joriy sessiya saqlanadi.

## Konfiguratsiya (`.env`)

| O‘zgaruvchi | Ma’nosi |
|---|---|
| `DATABASE_URL` | PostgreSQL ulanishi (docker compose: `127.0.0.1:5433`) |
| `APP_MODE` | `demo` / `development` — demo kirish va reset yoqilgan. `production` — ular o‘chadi (404) |
| `DEMO_DATE` | Demo «bugun» sanasi (Toshkent). Asosiy preset: `2026-10-18`. Seed va demo vaqti shu sanaga nisbatan quriladi. O‘zgartirgandan keyin `npm run db:reset` qiling (API ishga tushganda nomuvofiqlik bo‘lsa ogohlantiradi) |
| `DEMO_TIME` | Demo soatining boshlanishi (`HH:MM`, standart `11:30`). **Demo vaqti bazada saqlanadi** (`demo_clock` jadvali, `demo_now()`): oxirgi reset paytidagi `DEMO_DATE + DEMO_TIME` dan real vaqtda yuradi. API qayta ishga tushsa vaqt orqaga qaytmaydi; uni faqat demo reset boshlang‘ich nuqtaga qaytaradi. Qabul, navbat, to‘lov, audit va dashboard filtrlari shu bitta manbadan foydalanadi. 11:30 da seed’dagi barcha ertalabki yozuvlar o‘tmishda qoladi va tushdan keyingi slotlar bo‘sh bo‘ladi. Bo‘sh qoldirilsa, reset paytidagi real Toshkent soati olinadi |
| `NEWS_ENABLED`, `NCBI_API_KEY` | Shifokorlar uchun kundalik yangiliklar (PubMed). `off` — o‘chiq. NCBI kaliti ixtiyoriy (so‘rov limitini oshiradi) |
| `AI_MODE` | `sample` (standart): faqat tayyor demo matni uchun oldindan yozilgan natija, «Namunaviy AI natijasi» deb belgilangan. `live`: server orqali Claude yoki Gemini API (`AI_PROVIDER`). `off`: tugma o‘chiq va sababi ko‘rsatiladi |
| `APP_SECRET_KEY` | Saqlanadigan sirlarni (Telegram bot tokeni) shifrlash kaliti: 32 tasodifiy bayt, base64 (`openssl rand -base64 32`). Bo‘lmasa haqiqiy botni ulab bo‘lmaydi (simulyator ishlaydi). Kalit almashsa, botni qayta ulash kerak. Repozitoriyaga qo‘ymang |
| `TELEGRAM_WORKERS` | `on` (standart) / `off`. Fon jarayonlari: Telegram’dan xabarlarni o‘qish (long polling), eslatmalarni rejalashtirish va yuborish. Testlarda avtomatik o‘chadi |
| `AI_PROVIDER` | `anthropic` (standart, Claude) yoki `gemini`. Almashtirish uchun shu qator va tegishli kalit yetarli |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | Faqat `AI_MODE=live` uchun. Faqat serverda o‘qiladi, frontendga yuborilmaydi. Repozitoriyaga qo‘ymang |
| `AI_MODEL`, `GEMINI_MODEL`, `AI_TIMEOUT_MS` | Claude modeli (standart `claude-opus-5-5`), Gemini modeli (standart `gemini-3.5-flash-lite`) va timeout (20 000 ms) |
| `GEMINI_PAID` | `1` — pullik Gemini tarifi. Bepul tarifda Google so‘rovlardan mahsulotini yaxshilash uchun foydalanishi mumkin, shuning uchun qayd tartiblash va MKB-10 taklifi bepul tarifga faqat demo klinikalar (sun’iy ma’lumot, `APP_MODE≠production`) uchun yuboriladi. Haqiqiy klinika uchun ular o‘chadi, demo serverda ham (yangiliklar ishlaydi). Bepul tarifda narx 0 deb yoziladi |

## Kirish

**Xodim kirishi (parol bilan).** Kirish sahifasining o‘ng tomonidagi forma. Login — telefon (`+998 …`, istalgan yozuvda) yoki lotin harflaridagi login (`dilnoza.k`).
- Akkauntni rahbar yaratadi: **Xodimlar → Xodim qo‘shish**. Vaqtinchalik parol bir marta ko‘rsatiladi. Birinchi kirishda xodim o‘z parolini o‘rnatmaguncha boshqa sahifa ochilmaydi.
- Parol talabi: kamida 8 belgi, harf va raqam. Saqlanishi: scrypt xesh, ochiq matn hech qayerda yo‘q.
- 5 marta noto‘g‘ri parol → akkaunt 15 daqiqaga bloklanadi (audit jurnaliga yoziladi). Bitta IP’dan ko‘p urinish ham cheklanadi.
- Unutilgan parol yoki blok: rahbar xodim kartasida **«Parolni tiklash»** ni bosadi.
- Rahbar xodimni faolsizlantirsa, uning ochiq sessiyalari darhol yopiladi.
- Rahbar o‘zini va klinikadagi oxirgi faol rahbarni o‘chira olmaydi.
- Parolni o‘zgartirish: yuqori paneldagi kalit belgisi.

**Demo kartalar** (parolsiz, faqat demo rejimda va faqat demo klinikaga): Rahbar — Dilnoza Karimova, Registrator — Malika Yusupova, Shifokor (8 shifokordan tanlanadi; standart: Terapevt Akmal Rasulov), Kassir — Nodira Aliyeva, Laboratoriya — Gulnora Saidova.
- Rol almashtirish server sessiyasini almashtiradi (chiqish tugmasi → kirish sahifasi).
- Demo kartadagi xodimni o‘chirib yoki rolini o‘zgartirib bo‘lmaydi, shunda demo hamma uchun ishlaydi.
- `APP_MODE=production` da kartalar va demo yorlig‘i ko‘rinmaydi, faqat parol bilan kirish qoladi.

## AI (1-bosqich)

Barcha AI chaqiruvlari bitta joydan o‘tadi (`apps/api/src/ai/ai-client.ts`). Ikki provayder: Claude (rasmiy Anthropic SDK, `claude-opus-5-5`) va Gemini (REST `generateContent`, `gemini-3.5-flash-lite`). Ikkalasida ham javob JSON sxema bo‘yicha olinadi va zod bilan tekshiriladi.

Har bir chaqiruvda:
- javob JSON sxemasi bo‘yicha tekshiriladi;
- AI rad etsa, xato yoki noto‘liq javob bersa, foydalanuvchiga tushunarli xato chiqadi va qo‘lda ishlash davom etadi;
- `ai_usage` jadvaliga token soni, taxminiy narx ($) va natija yoziladi. So‘rov matni va javob yozilmaydi.

| Funksiya | Qayerda | AI o‘chiq yoki namunaviy rejimda |
|---|---|---|
| **Qaydni tartiblash** | Shifokor → «AI bilan tartiblash» | Faqat demo matni uchun namunaviy natija |
| **MKB-10 kodi** | Shifokor → tashxis ostida: qidiruv + «Kod taklif qilish» | Qidiruv ishlaydi; taklif so‘zlar mosligi bo‘yicha |
| **Kundalik yangiliklar** | Shifokor sahifasida «Bugun sohangizda»; Sozlamalar → AI | Asl inglizcha sarlavha va PubMed havolasi |
| **AI sarfi** | Sozlamalar → AI: 30 kunlik so‘rov, token, ~$ | — |

Qoidalar:
- **Anonimlashtirish:** AI’ga yuborishdan oldin bemorning ismi, familiyasi (qo‘shimchalari bilan), telefoni, tug‘ilgan sanasi va ID raqami olib tashlanadi.
- **MKB-10:** AI faqat klinika jadvalidagi kodlardan tanlaydi, server har bir kodni tekshiradi. Qaydga kodni shifokor o‘zi qo‘shadi. Bazada boshlang‘ich ro‘yxat bor (~130 ta ko‘p uchraydigan ambulator tashxis), rasmiy ro‘yxat `db:import-icd10` bilan yuklanadi.
- **Yangiliklar:** PubMed’dan oxirgi 30 kundagi RCT, meta-tahlil, tizimli sharh va tavsiyalar olinadi, har bir mutaxassislik uchun kuniga 5 tagacha. AI o‘zbekcha qisqa mazmunni faqat annotatsiyadan yozadi. Saqlanadi: sarlavha, AI qisqa mazmuni, havola. Annotatsiyaning o‘zi saqlanmaydi.
- **Testlar:** AI soxta Claude, soxta Gemini va soxta PubMed serverlari bilan sinaladi, haqiqiy model chaqirilmaydi va pul sarflanmaydi.

## Kassa: smena, qaytarish, xarajat

- **Smena.** Kassir **Kassa** sahifasida smenani boshlang‘ich naqd pul bilan ochadi. To‘lov faqat ochiq smenada va shu filialda qabul qilinadi (server tekshiradi). Yopishda kassadagi pul sanab kiritiladi: «kassada bo‘lishi kerak» = boshlang‘ich + naqd to‘lovlar − naqd qaytarishlar − kassadan xarajatlar. Farq bo‘lsa, izoh majburiy. Yopilgan smena o‘zgarmaydi. Hisobot chop etiladi; u ichki hujjat, fiskal Z-hisobot emas.
- **Pulni qaytarish.** Faqat rahbar qaytaradi, hisob sahifasidagi **«Pulni qaytarish»** orqali:
  - qaysi to‘lovdan, qancha, qanday usulda va qanday sabab bilan qaytarilishi tanlanadi;
  - naqd pul ochiq smena kassasidan chiqadi;
  - qaytarilgan summa hisobdan ham ayriladi, shuning uchun qarz paydo bo‘lmaydi; to‘liq qaytarilgan hisob «Qaytarilgan» holatida bo‘ladi;
  - ikki marta bosilsa, ikki marta qaytarilmaydi;
  - qaytarilgan summa shifokor ulushi va xizmatlar hisobotidan ham mutanosib ayriladi.
- **Kassada yo‘q pul berilmaydi:** naqd qaytarish yoki kassadan xarajat kassadagi summadan oshsa, rad etiladi.
- **Xarajatlar.** Rahbar **Moliya → Xarajatlar** bo‘limida qo‘shadi (bank, karta yoki kassadan; o‘tgan sana bilan ham). Kassir faqat o‘z kassasidan xarajat yozadi. Xato kiritilgan xarajat sabab bilan bekor qilinadi.
- **Sof natija.** Moliya sahifasining yuqorisida: tushum − qaytarishlar = sof tushum; − xarajatlar = sof natija. Dashboard tushumi ham qaytarishlarni ayiradi.
- **Demo:** demo reset ikkala kassirga bugungi ochiq smenani tayyorlaydi.

## Qabul hujjatlari

Shifokor qabul sahifasidagi **«Hujjatlar»** blokidan uch turdagi hujjat beradi:

| Hujjat | Nima yoziladi | Muhim |
|---|---|---|
| **Yo‘llanma** | Kimga (mutaxassis/tekshiruv/muassasa), sabab, MKB-10, shoshilinchlik | Sabab va MKB-10 qayddan oldindan to‘ldiriladi |
| **Tibbiy ma’lumotnoma** | Qabulda bo‘lganligi, qayerga taqdim etiladi, uyda davolanish tavsiyasi (0–30 kun) | Tashxis **sukut bo‘yicha yozilmaydi**. Bemor so‘rasa, faqat tasdiqlangan qayddan olinadi. Mehnatga layoqatsizlik varaqasi emas |
| **Retsept (dori tavsiyasi)** | Dori, shakli, doza, qabul tartibi, muddati, ko‘rsatma (15 tagacha) | Klinika ichki retsepti, davlat elektron retsepti (DMED) emas |

Qoidalar:
- **Raqamlash:** har bir hujjat klinika bo‘yicha ketma-ket raqam oladi (Y-/M-/R-00001).
- **Snapshot:** shifokor, filial, qabul vaqti va MKB-10 berilgan paytdagi holati bilan saqlanadi, qayta chop etilganda o‘zgarmaydi.
- **O‘zgarmaslik:** berilgan hujjatni tahrirlab yoki o‘chirib bo‘lmaydi, buni baza triggeri ham tekshiradi. Xato bo‘lsa, sabab bilan **bekor qilinadi** va yangisi beriladi; bosma nusxada «Bekor qilingan» chiqadi.
- **Ruxsat:** faqat davolovchi shifokor beradi va ko‘radi.
- **Demo belgisi:** bosma hujjatlardagi «DEMO» belgisi faqat demo rejimida chiqadi.

## Telegram bot (bemorlar uchun)

**Sozlamalar → Telegram bot.** Klinika o‘z botini ulaydi: @BotFather’da bot yaratiladi va token shu yerga qo‘yiladi. Token Telegram’da tekshiriladi va serverda AES-256-GCM bilan shifrlanib saqlanadi. U qayta ko‘rsatilmaydi va API javobida qaytmaydi.

Bemor botda nima qila oladi:
- **Telefonini ulashadi.** Faqat o‘z raqami qabul qilinadi, uni Telegram tasdiqlagan bo‘ladi. Shu raqamli bemor kartalari topiladi (oila a’zolari ham). Karta yo‘q bo‘lsa, familiya, ism va tug‘ilgan sana bilan ro‘yxatdan o‘tadi.
- **Qabulga yoziladi:** xizmat → shifokor → kun → vaqt → tasdiq. Faqat jadvali bor shifokorlarning bo‘sh vaqtlari taklif qilinadi (kamida 30 daqiqa keyingi). Qabul saytdagi bilan bir xil qoidalar bilan yoziladi va jadvalda «TG» belgisi bilan ko‘rinadi.
- **«Mening qabullarim»:** qabulni ko‘chiradi, bekor qiladi yoki so‘rovnomani to‘ldiradi.
- **Qabuldan oldingi so‘rovnoma:** shikoyat, allergiya, ichayotgan dorilar. Javoblarni faqat shu qabul shifokori ko‘radi va bir bosishda qaydga qo‘shishi mumkin.
- **Eslatmalar:** qabuldan bir kun oldin «Kelaman / Ko‘chirish / Bekor qilish» tugmalari bilan, 2 soat oldin qisqa eslatma.
- **Klinikadan xabarlar:** klinika qabulni bekor qilsa yoki ko‘chirsa, bemorga xabar boradi. Tahlil tayyor bo‘lsa ham xabar boradi, lekin **qiymatlar Telegram’ga hech qachon yuborilmaydi**.
- **Til:** o‘zbek (lotin), o‘zbek (kirill) va rus — bemor menyudagi «🌐 Til / Язык» orqali tanlaydi.

Ishonchlilik:
- Har bir Telegram xabari bir marta qayta ishlanadi. Javoblar faqat bazaga yozilgandan keyin yuboriladi.
- Bildirishnomalar outbox jadvali orqali bir martadan ko‘p yuborilmaydi va xatoda qayta urinadi.
- Bitta chat daqiqasiga 30 tadan ko‘p xabar yubora olmaydi.

Demo rejimida **simulyator** bor: haqiqiy bot mantig‘i ekranda, Telegram’siz. Uchrashuvda ko‘rsatish va sinov uchun.

## Haqiqiy klinika serveri (O‘zbekiston)

Pilot klinika Railway demo’sida emas, O‘zbekistondagi alohida serverda ishlaydi: `Dockerfile` + `deploy/docker-compose.prod.yml` (PostgreSQL, ilova `APP_MODE=production`, Caddy HTTPS, kunlik shifrlangan zaxira nusxa va haftalik tiklash sinovi). To‘liq qo‘llanma: [`docs/DEPLOY_UZ.md`](docs/DEPLOY_UZ.md). Qonun talablari va provayderlar: [`docs/PILOT_HOSTING_UZ.md`](docs/PILOT_HOSTING_UZ.md).

## Bemor roziligi (shaxsga doir ma’lumotlar, O‘RQ-547)

Haqiqiy bemorlar kiritilishidan oldin klinika bemorning **shaxsiy va sog‘liq haqidagi ma’lumotlarini qayta ishlashga roziligini** qayd etadi. **Telegram eslatmalariga rozilik** — alohida va ixtiyoriy.

- **Dalil sifatida saqlanadi:** `patient_consents` jadvali faqat qo‘shiladi (UPDATE/DELETE’ni baza triggeri rad etadi). Har bir yozuvda: tur, javob (bor/yo‘q), matn versiyasi, qanday olingani (imzolangan varaqa / og‘zaki / Telegram), kim qayd etgani (bot uchun bo‘sh) va vaqti. Qaytarib olish — yangi yozuv; joriy holat = oxirgi yozuv.
- **Bemor kartasi:** «Rozilik» bloki (holat so‘z + belgi + rang, versiya, sana, kim, tarix), «Rozilikni qayd etish» va «Rozilik varaqasini chop etish» tugmalari. Rozilik bo‘lmasa yoki qaytarib olingan bo‘lsa, kartada sariq ogohlantirish chiqadi. Qayd etish: registrator, rahbar, shifokor (o‘z bemori); kassir va laborant — yo‘q (server 403).
- **Yangi bemor formasi:** «Bemor shaxsiy ma’lumotlarni qayta ishlashga yozma rozilik berdi» + rozilik shakli, ixtiyoriy «Telegram eslatmalariga rozilik». Rozilik karta bilan bitta tranzaksiyada yoziladi. `APP_MODE=production` da roziliksiz karta ochilmaydi (422 `CONSENT_REQUIRED`); demo rejimida ixtiyoriy. Karta ochilishidan oldin bo‘sh varaqani chop etish mumkin (`/print/consent/blank`).
- **Chop etish:** `/print/consent/<bemor>` — A4, to‘liq matn interfeys tilida, bemor F.I.Sh., ID, tug‘ilgan sana, klinika, sana, bemor (yoki vakili) va xodim imzosi uchun joy.
- **Telegram bot:** yangi bemor botda ro‘yxatdan o‘tayotganda karta yaratilishidan oldin qisqa rozilik matni va «✅ Roziman» / «Yo‘q» tugmalari chiqadi (uch tilda). «Roziman» — karta + ikkala rozilik (`telegram` usuli, versiya `tg-2026-10`); «Yo‘q» — hech narsa saqlanmaydi. Klinikada kartasi bor bemorlardan bot qayta so‘ramaydi. Bemor Telegram xabarlariga «yo‘q» desa, unga eslatma va xabarnomalar navbatga qo‘yilmaydi.
- **Matn versiyasi:** `2026-10`, `packages/contracts/src/i18n/messages/consent.ts` (uch tilda). Matn o‘zgarsa — yangi versiya, eskisi o‘zgartirilmaydi.

> ⚠️ **Yurist ko‘rib chiqishi shart.** Rozilik matni (to‘liq varaqa ham, botdagi qisqa matn ham) pilot uchun yozilgan oddiy tildagi loyiha. Haqiqiy bemorlar imzolashidan oldin O‘zbekiston huquqi bo‘yicha yurist matnni, saqlash muddatini va klinika rekvizitlarini tekshirishi kerak.

## Tillar va dizayn

- **Uch til:** o‘zbek (lotin), o‘zbek (kirill), rus. Har bir xodim chap menyuning pastida tanlaydi; tanlov haqiqiy xodim akkauntida (istalgan qurilmada), demo kartada — faqat shu sessiyada saqlanadi. Kirish sahifasida ham til tanlanadi.
- **Bitta manba:** barcha interfeys matnlari `packages/contracts/src/i18n/messages/*.ts` da `[o‘zbekcha, ruscha]` juftligi. O‘zbek kirill lotindan qoidalar bo‘yicha avtomatik olinadi (o‘zlashma so‘zlar ro‘yxati bilan). Server xatolari va forma xatolari ham xodim tilida qaytadi.
- **Ma’lumot o‘girilmaydi:** bemor, xodim, xizmat nomlari va qayd matnlari qanday yozilgan bo‘lsa, shunday ko‘rinadi.
- **Dizayn:** Golos Text shrifti (ilova ichida, internetsiz), asosiy matn 18 px, katta tugmalar, sariq fokus halqasi, holat — so‘z + belgi + rang, allergiya — qizil chiziq.

## Arxitektura qisqacha

- **Tenant va rol** faqat server sessiyasidan olinadi. Client yuborgan `tenant_id` hisobga olinmaydi; boshqa tenant obyekti 404 qaytaradi.
- **Bog‘lanishlar** composite `(tenant_id, id)` foreign key bilan himoyalangan.
- **Band slot**: `appointments` jadvalidagi `EXCLUDE USING gist` constraint shifokor va xona vaqtining kesishishini baza darajasida bloklaydi. Parallel so‘rovdan bittasi 409 oladi.
- **To‘lov**: `Idempotency-Key` majburiy, hisob qatori `FOR UPDATE` bilan qulflanadi, `paid_amount <= total` CHECK constraint bor. To‘lovlar append-only (trigger).
- **Tasdiqlangan klinik qayd va lab natijasi** trigger bilan o‘zgarmas.
- **Pul** butun tiyinda (`bigint`) saqlanadi. Dashboard, registr va hisobotlar bir xil SQL agregatlaridan hisoblanadi; hardcode qilingan statistika yo‘q.
- **Vaqt** bazada UTC, ekranda Asia/Tashkent. Sana filtri `[kun boshi, keyingi kun boshi)` oralig‘iga aylantiriladi.
- localStorage faqat tanlangan filialni eslab qolish uchun ishlatiladi.
- **Demo reset** barcha jadvallarni tozalaydi, shuning uchun bazada demo bo‘lmagan klinika bo‘lsa, reset rad etiladi (`REAL_CLINIC_PRESENT`).

## Muammolar bo‘lsa

- `5433` port band bo‘lsa: `docker-compose.yml` dagi portni va `.env` dagi `DATABASE_URL` ni o‘zgartiring.
- Bugungi slotlar «o‘tgan» ko‘rinsa: demo vaqti reset’dan beri ancha yurgan. `npm run db:reset` (yoki Sozlamalar → Demo boshqaruvi) vaqtni 11:30 ga qaytaradi.
- Internet kerak emas (`AI_MODE=sample`). Shriftlar va kutubxonalar lokal, tashqi CDN’ga bog‘liqlik yo‘q.
