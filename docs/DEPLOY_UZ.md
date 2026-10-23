# Med.uz.ai — haqiqiy klinika uchun o‘rnatish (O‘zbekistondagi server)

Bu hujjat pilot klinikani **O‘zbekiston hududidagi serverga** o‘rnatish tartibi. Railway’dagi demo faqat
sintetik ma’lumot uchun.

Nega O‘zbekistonda: «Shaxsga doir ma’lumotlar to‘g‘risida»gi qonunning 27-1-moddasi 2026-yil martda
(O‘RQ-1125) toraytirildi — endi majburiy mahalliy saqlash biometrik, genetik va aloqa abonentlari
ma’lumotlariga taalluqli. Sog‘liq ma’lumotlari «maxsus toifa» (25-modda) va rozilik talab qiladi. Lekin
Ma’muriy javobgarlik kodeksi 46-2 va Jinoyat kodeksi 141-2-moddalari hamon «O‘zbekiston hududida jismonan
joylashgan texnik vositalarda saqlamaslik»ni jazolaydi. Shuning uchun xavfsiz yo‘l: **barcha bemor
ma’lumotlari va zaxira nusxalari O‘zbekistonda**. Yakuniy xulosani yurist bersin; tadqiqot va manbalar: `docs/PILOT_HOSTING_UZ.md`.

Hamma narsa bitta serverda, Docker Compose bilan ishlaydi:

| Servis | Vazifasi |
|---|---|
| `db` | PostgreSQL 16. Tashqariga port ochilmaydi — faqat ichki tarmoq. |
| `app` | Med.uz.ai (veb + API bitta konteynerda), `APP_MODE=production`, migratsiyalar ishga tushganda qo‘llanadi. |
| `caddy` | HTTPS (Let’s Encrypt sertifikati avtomatik), xavfsizlik sarlavhalari, HTTP → HTTPS. |
| `backup` | Har kuni shifrlangan zaxira nusxa (pg_dump + GPG AES-256), 14 kunlik + 8 haftalik, har yakshanba tiklash sinovi. |

Fayllar: `Dockerfile`, `deploy/docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/backup/*.sh`,
`deploy/.env.production.example`.

## 1. Server

- O‘zbekistondagi data-markaz (VPS yoki ajratilgan server). Provayder bilan shartnomada ma’lumot
  O‘zbekistonda saqlanishi yozilgan bo‘lsin.
- Kamida **2 vCPU, 4 GB RAM, 60 GB SSD** (1 klinika, 10–30 xodim uchun yetarli; o‘sish uchun
  4 vCPU / 8 GB / 100 GB). Ubuntu 24.04 LTS.
- Provayderlar (2026-oktabr narxlari, 4 vCPU / 8 GB / 100 GB, oyiga, QQS bilan aniqlashtiring):
  Uztelecom Cloud ≈ 634 000 so‘m (davlat operatori, onlayn ro‘yxatdan o‘tish, obyekt xotirasi — ikkinchi
  zaxira joyi uchun qulay), Pro-Data ≈ 788 400 so‘m (ISO 27001), Servercore ≈ 1,1 mln so‘m (boshqariladigan
  PostgreSQL bor), hostmaster.uz, TCloud. Tanlovdan oldin serverdan Let’s Encrypt sertifikati olinishini va
  klinika tarmog‘idan kechikishni (TAS-IX) sinab ko‘ring.
- Ochiq portlar: **22** (faqat SSH kalit bilan, parol bilan kirish o‘chirilgan), **80** va **443**.
  Boshqa portlar yopiq (`ufw allow 22,80,443/tcp && ufw enable`).
- Docker Engine + Compose plagini: `curl -fsSL https://get.docker.com | sh`.
- Domen: `DOMAIN` uchun DNS A-yozuvi serverning IP manziliga qaratilgan bo‘lsin (masalan `klinika.example.uz`).
- Avtomatik xavfsizlik yangilanishlari: `apt install unattended-upgrades`.

## 2. Birinchi o‘rnatish

```bash
git clone https://github.com/ryuxilexx-design/medusa.git /opt/meduzai
cd /opt/meduzai/deploy
cp .env.production.example .env
chmod 600 .env
openssl rand -base64 32   # → APP_SECRET_KEY
openssl rand -base64 24   # → POSTGRES_PASSWORD
openssl rand -base64 24   # → BACKUP_PASSPHRASE
nano .env                 # DOMAIN, ACME_EMAIL va yuqoridagi uchta qiymat; PUBLIC_URL — server tashqaridan
                          # ko‘rinadigan manzil (bo‘sh qoldirilsa https://DOMAIN; kameralar va Telegram havolalari shuni ishlatadi)
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # hammasi "running", app "healthy"
docker compose -f docker-compose.prod.yml logs app | tail -20
```

`BACKUP_PASSPHRASE` va `APP_SECRET_KEY` ni **serverdan tashqarida ham** saqlang (masalan rahbarning parol
menejerida). Parolsiz zaxira nusxalarni ochib bo‘lmaydi; `APP_SECRET_KEY` siz Telegram bot tokeni ochilmaydi.

Tekshirish: brauzerda `https://DOMAIN/login` ochiladi, qulf belgisi bor. `/demo/login` → 404 bo‘lishi kerak
(production rejimida demo kirish yo‘q). Sanalar haqiqiy bugungi kun (demo soati ishlatilmaydi).
`curl -s https://DOMAIN/api/v1/health` → `{"ok":true,"db":"ok","version":"…"}` (baza javob bermasa — 503).

## 3. Klinikani yaratish

```bash
docker compose -f docker-compose.prod.yml exec app node database/dist/src/cli.js create-clinic \
  --name "Klinika nomi" --branch "Markaziy filial" \
  --manager-name "Familiya Ism Sharif" --manager-login +998901234567 --catalog demo
```

Buyruq rahbar uchun **bir martalik vaqtinchalik parolni** chiqaradi — uni rahbarga shaxsan bering, hech qayerga
yozib qo‘ymang. Birinchi kirishda tizim parolni almashtirishni talab qiladi. Keyin rahbar «Sozlamalar»da
xodimlarni (shifokor, registrator, kassir), xonalarni va xizmatlar narxini kiritadi.

**Rahbar vaqtinchalik parolni unutdi (yoki yagona rahbar qulflanib qoldi).** Tizim ichidan o‘z parolini
tiklab bo‘lmaydi — server konsolidan yangi bir martalik parol beriladi, akkaunt qulfdan chiqadi va uning barcha
sessiyalari yopiladi (xodimlar uchun ham ishlaydi; oddiy holatda xodim parolini rahbar «Xodimlar»da tiklaydi):

```bash
docker compose -f docker-compose.prod.yml exec app node database/dist/src/cli.js reset-password \
  --login +998901234567 [--tenant "Klinika nomi"]
```

MKB-10 ro‘yxatini rasmiy fayldan yuklash:

```bash
docker compose -f docker-compose.prod.yml cp mkb10.csv app:/tmp/mkb10.csv
docker compose -f docker-compose.prod.yml exec app node database/dist/src/cli.js import-icd10 /tmp/mkb10.csv
```

## 4. Zaxira nusxa (backup)

Avtomatik: har kuni `BACKUP_HOUR` (Toshkent vaqti) da `deploy/backups/daily/meduza-YYYYMMDD-HHMM.dump.gpg`
yaratiladi, yakshanba nusxasi `weekly/` ga ham ko‘chiriladi va tiklash sinovi o‘tkaziladi. Birinchi
ishga tushishda darhol bitta nusxa va sinov qilinadi. Jurnallar: `deploy/backups/backup.log`,
`deploy/backups/restore-test.log`.

```bash
# hozir qo‘lda nusxa olish
docker compose -f docker-compose.prod.yml exec backup bash /scripts/backup.sh
# eng so‘nggi nusxani alohida bazaga tiklab tekshirish (jonli bazaga tegmaydi)
docker compose -f docker-compose.prod.yml exec backup bash /scripts/restore-test.sh
tail -5 backups/backup.log backups/restore-test.log
```

**Serverdan tashqari nusxa — majburiy.** Server yonsa yoki o‘g‘irlansa, faqat shu nusxa qoladi. Fayllar
shifrlangan, ularni ikkinchi joyga (O‘zbekistondagi boshqa server yoki klinikadagi shifrlangan disk)
har kuni ko‘chiring, masalan ikkinchi serverda cron bilan:

```bash
rsync -a --delete meduzai@SERVER:/opt/meduzai/deploy/backups/ /srv/meduzai-backups/
```

Shifrlash paroli (`BACKUP_PASSPHRASE`) nusxalar bilan bir joyda saqlanmasin.

### Tiklash (falokat holati)

Jonli bazani nusxa bilan **almashtiradi**. Avval joriy holatning xavfsizlik nusxasi olinadi.

```bash
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml exec -e CONFIRM=RESTORE backup \
  bash /scripts/restore.sh /backups/daily/meduza-YYYYMMDD-HHMM.dump.gpg
docker compose -f docker-compose.prod.yml start app
```

Yangi serverga ko‘chirish: 2-bo‘limdagi o‘rnatishni bajaring (xuddi shu `BACKUP_PASSPHRASE` bilan), nusxa
faylini `deploy/backups/daily/` ga qo‘ying va yuqoridagi tiklashni bajaring.

## 5. Yangilash

```bash
cd /opt/meduzai
docker compose -f deploy/docker-compose.prod.yml exec backup bash /scripts/backup.sh   # avval nusxa
git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build app
docker compose -f deploy/docker-compose.prod.yml logs app | tail -20                   # migratsiyalar OK
```

Yangilashni klinika ish vaqtidan tashqarida qiling (konteyner ~30 soniya qayta ishga tushadi).

## 6. Kuzatish

- `docker compose -f deploy/docker-compose.prod.yml ps` — `app` holati `healthy` bo‘lishi kerak (konteyner
  har 30 soniyada `GET /api/v1/health` ni so‘raydi: baza 2 soniyada javob bermasa — 503).
- Tashqi tekshiruv (masalan UptimeRobot) `https://DOMAIN/api/v1/health` ni har 5 daqiqada tekshirsin
  (HTTP 200 va javobda `"ok":true`). Sessiya, kirish kodi va audit talab qilinmaydi.
- Jurnallar: har bir konteyner 5 × 50 MB aylanma fayl (`logging` bo‘limi, disk to‘lmaydi). API har so‘rov uchun
  bitta qator yozadi (`HTTP`: metod, yo‘l, status, ms, `request_id`, klinika) — so‘rov tanasi, klinik matn yoki
  parol hech qachon jurnalga tushmaydi. Xato bo‘yicha qidirish: `docker compose logs app | grep <request_id>`.
- Har hafta: `backups/restore-test.log` da oxirgi qator `OK restore-test` bo‘lsin; disk joyi `df -h`.
- Sertifikat Caddy tomonidan avtomatik yangilanadi; `docker compose logs caddy` da xato bo‘lmasin.

## 6a. SMS eslatmalar (Eskiz.uz)

Telegram ulanmagan bemorlarga eslatma SMS bilan boradi. Buning uchun klinikaning o‘z Eskiz hisobi kerak:

1. <https://eskiz.uz> da hisob oching, shartnoma tuzing va balansni to‘ldiring (SMS klinika hisobidan yechiladi).
2. Shaxsiy kabinetda **jo‘natuvchi nomini** (klinika nomi, lotin, 11 belgigacha) ro‘yxatdan o‘tkazing — operatorlar tasdig‘i
   1–2 hafta oladi. Ungacha Eskiz’ning umumiy nomi `4546` ishlaydi: Med.uz.ai’da shu nom sukut bo‘yicha qo‘yilgan,
   tasdiqdan keyin Sozlamalar → SMS da o‘zgartiriladi.
3. Med.uz.ai: Sozlamalar → **SMS** → Eskiz login (elektron pochta) va parolni kiriting, «SMS yuborish yoqilgan»ni
   belgilang, saqlang (parol Eskiz’da tekshiriladi, serverda `APP_SECRET_KEY` bilan shifrlangan saqlanadi va qayta
   ko‘rsatilmaydi), keyin o‘z raqamingizga «Sinov SMS» yuboring (Eskiz tasdiqlanmagan hisobdan faqat
   «Bu Eskiz dan test» matnini qabul qiladi — sinov shu matn bilan ketadi).

Matnda faqat qabul fakti (sana, vaqt, shifokor, filial) bo‘ladi; tahlil natijasi, tashxis yuborilmaydi. Bazada SMS
matni saqlanmaydi — faqat tur, raqam va yetkazilganlik holati. Bemor «xabarnoma istamayman» desa (rozilik yozuvi),
SMS ham, Telegram ham bormaydi. Soat 21:00–08:00 da eslatma yuborilmaydi (bekor qilish/ko‘chirish bundan mustasno).
Server o‘zgaruvchilari: `ESKIZ_BASE_URL` (sukut `https://notify.eskiz.uz`, o‘zgartirish shart emas), `ESKIZ_TIMEOUT_MS`.

## 7. Xavfsizlik eslatmalari

- `deploy/.env` va `deploy/backups/` hech qachon git’ga tushmaydi (`.gitignore` da).
- Bazaga tashqaridan ulanish yo‘q. Hisobot uchun faqat o‘qish huquqli rol kerak bo‘lsa — SSH tunnel orqali.
- AI sukut bo‘yicha o‘chiq (`APP_MODE=production` da `AI_MODE` ko‘rsatilmasa — `off`). Kalit qo‘yilib `AI_MODE=live`
  qilinganda ham klinik marshrutlar (qaydni tartiblash, MKB-10 taklifi) `AI_CLINICAL_ALLOWED=1` bo‘lmaguncha rad etiladi
  (503 `AI_DISABLED_PRODUCTION`); mutaxassislik yangiliklari (ochiq maqolalar) ishlayveradi. `AI_CLINICAL_ALLOWED=1` ni
  faqat bemor rozilik matni va shartnoma AI’ga uzatishni qamrab olgach yoqing. Har klinikaning kunlik sarfi
  `AI_DAILY_LIMIT_USD` (sukut 5 $) bilan chegaralanadi — chegaradan keyin 429 `AI_BUDGET`, ertasi kuni davom etadi.
  Klinik matn faqat to‘lovli API kalit bilan yuboriladi:
  Gemini’ning bepul tarifi haqiqiy klinikaning klinik matnini olmaydi (server buni o‘zi bloklaydi).
  AI provayderiga matn yuborish chegaradan tashqariga uzatish hisoblanadi — bemor rozilik varag‘ida va
  klinika bilan shartnomada ko‘rsatilsin, matn avval `redact()` dan o‘tadi.
- Bemor ma’lumotlarini qayta ishlash uchun rozilik bemor kartasida qayd etiladi (chop etiladigan varaq bilan).
- Bu hujjat yuridik maslahat emas: rozilik matni, operator ro‘yxatdan o‘tishi va shartnomalarni yurist
  tekshirsin.
