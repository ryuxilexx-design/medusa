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
| `npm test` | API integratsion testlari (20 ta). **Faqat `meduza_test` bazasida** ishlaydi, demo bazaga tegmaydi |
| `npm run typecheck` | Barcha paketlar tip tekshiruvi |
| `npm run e2e` | Brauzer testlari (asosiy demo yo‘li + xato holatlari) **alohida stekda**: web :3100, API :4100, `meduza_test`. Demo serverlar va demo baza ishlatilmaydi. Skrinshotlar `e2e/shots/` ga |
| `node e2e/run.mjs visual` | Asosiy ekranlar va modallarning 1366×768 skrinshotlari (test stekda) |
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
| `AI_MODE` | `sample` (standart): faqat tayyor demo matni uchun oldindan yozilgan natija, «Namunaviy AI natijasi» deb belgilangan. `live`: server orqali Claude API. `off`: tugma o‘chiq va sababi ko‘rsatiladi |
| `ANTHROPIC_API_KEY` | Faqat `AI_MODE=live` uchun. Faqat serverda o‘qiladi, frontendga yuborilmaydi. Repozitoriyaga qo‘ymang |
| `AI_MODEL`, `AI_TIMEOUT_MS` | Model (standart `claude-opus-5-5`) va timeout (20 000 ms) |

## Demo akkauntlari

Kirish sahifasida 5 ta rol kartasi bor (parolsiz, faqat demo rejimda): Rahbar — Dilnoza Karimova, Registrator — Malika Yusupova, Shifokor (8 shifokordan tanlanadi; standart: Terapevt Akmal Rasulov), Kassir — Nodira Aliyeva, Laboratoriya — Gulnora Saidova.
Rol almashtirish server sessiyasini almashtiradi (chiqish tugmasi → kirish sahifasi).

## Arxitektura qisqacha

- **Tenant va rol** faqat server sessiyasidan olinadi. Client yuborgan `tenant_id` hisobga olinmaydi; boshqa tenant obyekti 404 qaytaradi.
- **Bog‘lanishlar** composite `(tenant_id, id)` foreign key bilan himoyalangan.
- **Band slot**: `appointments` jadvalidagi `EXCLUDE USING gist` constraint shifokor va xona vaqtining kesishishini baza darajasida bloklaydi. Parallel so‘rovdan bittasi 409 oladi.
- **To‘lov**: `Idempotency-Key` majburiy, hisob qatori `FOR UPDATE` bilan qulflanadi, `paid_amount <= total` CHECK constraint bor. To‘lovlar append-only (trigger).
- **Tasdiqlangan klinik qayd va lab natijasi** trigger bilan o‘zgarmas.
- **Pul** butun tiyinda (`bigint`) saqlanadi. Dashboard, registr va hisobotlar bir xil SQL agregatlaridan hisoblanadi; hardcode qilingan statistika yo‘q.
- **Vaqt** bazada UTC, ekranda Asia/Tashkent. Sana filtri `[kun boshi, keyingi kun boshi)` oralig‘iga aylantiriladi.
- localStorage faqat tanlangan filialni eslab qolish uchun ishlatiladi.

## Muammolar bo‘lsa

- `5433` port band bo‘lsa: `docker-compose.yml` dagi portni va `.env` dagi `DATABASE_URL` ni o‘zgartiring.
- Bugungi slotlar «o‘tgan» ko‘rinsa: demo vaqti reset’dan beri ancha yurgan. `npm run db:reset` (yoki Sozlamalar → Demo boshqaruvi) vaqtni 11:30 ga qaytaradi.
- Internet kerak emas (`AI_MODE=sample`). Shriftlar va kutubxonalar lokal, tashqi CDN’ga bog‘liqlik yo‘q.
