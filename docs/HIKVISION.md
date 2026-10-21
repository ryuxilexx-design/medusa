# Med.uz.ai + Hikvision DeepinView kameralari

Kameralar to‘rt vazifada ishlaydi: **xodimlar davomati**, **bemor kelganini tanish**, **odam oqimi (sanash)** va
**xavfsizlik hodisalari**. Rahbar «Kameralar» bo‘limida ko‘radi, registrator «Navbat» va «Qabul jadvali»da
«Kamera tanidi» taklifini bir bosishda tasdiqlaydi.

## Asosiy qoida: yuz kamerada qoladi

- Yuz rasmi va yuz shabloni **faqat kameraning o‘z yuz kutubxonasida** (klinikada, O‘zbekistonda) saqlanadi.
- Med.uz.ai faqat **bizning kodni** (xodim `S-12`, bemor `P-1001`), vaqtni va o‘xshashlik foizini saqlaydi.
  Kamera hodisa bilan rasm yuborsa ham, server rasmni o‘qimaydi va saqlamaydi.
- Xodimga kod berishdan oldin rahbar xodimning **yozma roziligini** tasdiqlaydi. Bemor uchun alohida rozilik:
  «Kamerada yuzni tanish» — faqat **imzolangan varaqa** bilan (bemor kartasi → Rozilik). Rozilik qaytarib
  olinsa, kod darhol o‘chadi va kamera hodisalari qabul qilinmaydi; klinika yuzni kamera kutubxonasidan ham o‘chiradi.
- Biometriya O‘zbekistonda saqlanishi shart: kameralar faqat O‘zbekistondagi Med.uz.ai serveriga ulanadi
  (`docs/DEPLOY_UZ.md`). Railway demo’siga haqiqiy kamera ulanmaydi — u yerda simulyator bor.
- Bu hujjat yuridik maslahat emas: rozilik matnini (versiya `bio-2026-10`) yurist tekshirsin.

## O‘rnatish (har bir kamera uchun)

1. **Med.uz.ai:** Kameralar → Qurilmalar → «Kamera qo‘shish». Filial, nom, joy va vazifalarni belgilang:
   - Davomat — kirish eshigi kamerasi (xodimlarni taniydi);
   - Bemor kelishi — qabulxona kamerasi (rozilik bergan bemorlarni taniydi);
   - Odam sanash — kirish eshigi (People Counting);
   - Xavfsizlik — kassa, dori ombori (hududga kirish, chiziqni kesish, kamera to‘silishi).
   Saqlagach **ulanish manzili bir marta** ko‘rsatiladi (`https://DOMEN/api/v1/hik/<maxfiy-token>`). Uni nusxalang.
   Yo‘qotilsa — «Manzilni yangilash» (eski manzil darhol ishlamay qoladi).
2. **Kamera veb-sahifasi** (brauzerda kamera IP manzili, administrator):
   - *Configuration → Network → Advanced Settings → HTTP Listening* (ba’zi proshivkalarda *Alarm Server*):
     manzil = Med.uz.ai domeni, port 443, URL = `/api/v1/hik/<token>`, protokol HTTPS.
     Agar proshivka HTTPS qabul qilmasa — klinika tarmog‘idagi serverga HTTP (port 80) bilan ulang.
     Rasm yuborishni o‘chiring (yuborilsa ham server uni tashlab yuboradi).
   - *Event → Smart Event / Face Picture Comparison / People Counting*: kerakli hodisalarni yoqing va har birida
     **«Notify Surveillance Center»** belgisini qo‘ying — usiz kamera hech narsa yubormaydi.
   - Kamera vaqti: *System → Time Settings* → vaqt mintaqasi **UTC+05:00 (Toshkent)**, NTP yoqilgan.
   - Odam sanash: hisobot rejimi **davr bo‘yicha (time range)** tavsiya etiladi; real vaqt rejimi ham ishlaydi.
3. **Yuz kutubxonasi** (*Picture → Face Picture Library*): kutubxona yarating, odamni qo‘shing, **ID No.** maydoniga
   Med.uz.ai kodini yozing (`S-12` yoki `P-1001`). Agar ID No. harf qabul qilmasa — kodni **Name** maydoniga yozing
   (masalan `S-12 Ali`). Rasmni shu yerda kamera bilan oling. Kod Med.uz.ai’da: Kameralar → Kodlar (xodim),
   bemor kartasi → Rozilik (bemor).
4. **Tekshirish:** kameraning *HTTP Listening → Test* tugmasi; Med.uz.ai «Qurilmalar»da «oxirgi aloqa» vaqti
   yangilanadi. Kamera 24 soat jim qolsa, rahbarning bosh sahifasida ogohlantirish chiqadi.

## Qanday ishlaydi

| Vazifa | Kameradan keladigan hodisa | Med.uz.ai’da |
|---|---|---|
| Davomat | yuz kutubxonasi bilan moslik (`alarmResult` / `faceContrast`), kod `S-…` | kun bo‘yicha birinchi va oxirgi ko‘rinish; shifokor jadvaliga nisbatan kechikish (5 daqiqadan ortiq) |
| Bemor kelishi | xuddi shu, kod `P-…` | bugungi qabuldan 2 soat oldin – 1 soat keyin ko‘rilsa, registratorga «Kamera tanidi» taklifi; «Keldi deb belgilash» oddiy «Keldi» bilan bir xil (navbat raqami, hisob). Hech narsa odamsiz o‘zgarmaydi |
| Odam oqimi | `PeopleCounting` (davr yoki real vaqt) | soatlar va kunlar bo‘yicha kirgan/chiqqanlar, eng band soat |
| Xavfsizlik | `fielddetection`, `linedetection`, `regionEntrance`, `regionExiting`, `loitering`, `shelteralarm` | hodisalar ro‘yxati; ish vaqtidan tashqari (yoki «har doim» rejimida) — ogohlantirish, rahbar «Ko‘rib chiqildi» deydi |

- O‘xshashlik **80 %** dan past moslik hisobga olinmaydi.
- Takror yuborilgan hodisa bir marta saqlanadi; bir daqiqa ichidagi bir xil xavfsizlik hodisasi — bitta yozuv.
- Hodisalar faqat qo‘shiladi (o‘zgartirib yoki o‘chirib bo‘lmaydi — baza triggeri).

### Ogohlantirish surati

Kamera xavfsizlik hodisasi bilan birga o‘z suratini (alarm picture) yuboradi. Odatda server rasmni o‘qimaydi.
Rahbar kamera sozlamasida **«Ogohlantirish suratini saqlash»** ni yoqsa, bu kameraning *ogohlantirish* hodisalari
(begona odam operatsiya xonasi eshigida, tunda omborga kirish, uzoq turib qolish, kamera to‘silishi) bilan kelgan
rasm dalil sifatida saqlanadi:

- faqat ogohlantirish bo‘lgan hodisaga — kunduzgi oddiy hodisaga emas; **yuz tanish va odam sanash hodisalariga hech
  qachon** (tanilgan odam — biometrik ma’lumot);
- bitta hodisaga bitta rasm, 1 MB gacha (JPEG/PNG/WebP; haqiqiy rasm ekani bayt belgilaridan tekshiriladi);
- **30 kun** saqlanadi, keyin server o‘zi o‘chiradi; o‘zgartirib bo‘lmaydi;
- faqat rahbar, o‘z filiallari doirasida ko‘radi (`GET /api/v1/cameras/security/<id>/snapshot`, brauzer keshi
  «private»); Xavfsizlik jadvalida kichik kadr, bosilganda katta oyna va shu yerda «Ko‘rib chiqildi».

Kamerada buning uchun *Event → Linkage → Upload to Surveillance Center* (yoki *Notify Surveillance Center*) bilan
birga **«Capture picture»/«Upload picture»** yoqilgan bo‘lishi kerak — shunda HTTP listening xabari multipart
bo‘lib, rasm qismi bilan keladi. Haqiqiy kameradan suratlar faqat O‘zbekistondagi serverda saqlanadi; demo’da
(Railway) faqat chizilgan sun’iy kadrlar bor.

Texnik tafsilotlar, namunaviy ISAPI xabarlari va manbalar: `docs/HIKVISION_ISAPI_RESEARCH.md`.
Kod: `apps/api/src/cameras/` (`isapi.ts` — xabarni o‘qish, `ingest.ts` — qoidalar, `cameras.controller.ts` — API,
`hik.controller.ts` — kamera manzili). Testlar: `apps/api/test/cameras.test.mjs`.

## Telefonni sinov kamerasi qilish (faqat demo / sinov serveri)

1. Rahbar: Kameralar → Qurilmalar → **Kamera qo‘shish** (barcha vazifalar; xavfsizlik — «Har doim»).
2. Chiqgan oynadagi **«Telefonda sinash»** havolasini telefonda oching (HTTPS kerak — Railway demo’si mos).
3. **Kamerani yoqish** → kodni yozing (xodim `S-…` — Kameralar → Kodlar; bemor `P-…` — bemor kartasida biometrik
   rozilik qayd etilgach) → **Yuzni olish**. Endi kameraga qarasangiz, telefon yuzni taniydi va serverga xuddi
   Hikvision kabi faqat kod va foizni yuboradi (bir odam — daqiqasiga bir marta).
4. «Odam kirdi», «Hududga kirish», «Aloqani tekshirish» tugmalari — odam sanash, xavfsizlik va yurak urishi.

Yuz rasmi va yuz izi faqat telefon xotirasida (sahifa yopilsa o‘chadi), serverga yuborilmaydi. Yuz tanish
`@vladmandic/face-api` 1.7.15 bilan brauzerda bajariladi (model CDN’dan yuklanadi). Bu sinov vositasi: aniqligi
Hikvision kamerasidan past, haqiqiy klinikada ishlatilmaydi (sahifa production serverda ochilmaydi).

## Kamerasiz sinash: `tools/hik-replay.mjs`

Kamera yuboradigan aynan shu formatdagi xabarlarni (XML, JSON, multipart) serverga yuboradi — o‘rnatilgan serverni
kamera kelmasdan oxirigacha tekshirish uchun. Avval Med.uz.ai’da sinov kamerasi qo‘shing va manzilni oling.

```bash
node tools/hik-replay.mjs https://DOMEN/api/v1/hik/<token> all --codes S-1,S-2 --code P-1010
node tools/hik-replay.mjs <manzil> staff --codes S-3 --time 2026-10-21T08:47:00+05:00   # ertalabki kelish
node tools/hik-replay.mjs <manzil> night        # tungi kirish, chiziq, zona → ogohlantirishlar
node tools/hik-replay.mjs <manzil> counting     # 3 soatlik odam sanash (davr rejimi)
node tools/hik-replay.mjs <manzil> heartbeat --dry   # yubormasdan, xabarni ko‘rsatadi
```

Ssenariylar: `heartbeat`, `staff`, `patient`, `counting`, `counting-rt` (jamlangan), `night`, `all`. Yuz xabarida
rasm o‘rniga kichik belgi yuboriladi; `night` ssenariysi esa xavfsizlik xabarlarini kameradagidek multipart qilib,
rasm bilan yuboradi (`--picture fayl.jpg`, sukut bo‘yicha demo kadri). Faqat sinov serveri va sun’iy kodlar bilan
ishlating.

## Demo ma’lumotlari

Demo’da 6 ta kamera va 30 kunlik tarix bor: xodimlar davomati (Bekzod Ergashev tez-tez kechikadi, Lola Abdullayeva
3 kun ta’tilda, Sardor Nazarov ko‘pincha kech qoladi, Yunusobod kassiri ba’zan erta ketadi), hafta kuniga qarab
o‘zgaradigan odam oqimi va bitta «ochiq eshiklar kuni», kunduzgi oddiy va 11 ta ogohlantirish (3 tasi ko‘rib
chiqilmagan: kecha 23:12 dori ombori, 3 kun oldin Yunusobod kassasi, bugun 09:48 operatsiya bloki eshigida uzoq
turib qolgan odam), bemor kelishi tarixi (tasdiqlangan va «bu emas») hamda bugungi takliflar. Hammasi sun’iy.

Ogohlantirishlarning 10 tasida kameraning «surati» bor — `database/seed/snapshots/*.jpg`. Bular haqiqiy kadrlar
emas: `tools/gen-snapshots.mjs` chizadigan sun’iy sahnalar (koridor, operatsiya bloki eshigi, kassa, qabulxona,
odam siluleti, kameraning o‘z yozuvlari — zona, «Human» ramkasi, vaqt). Sahna o‘zgarsa skriptni qayta ishga
tushiring; fayllar repoda saqlanadi, seed ularni faqat o‘qiydi. «Sinov hodisasi» tugmasi ham xavfsizlik hodisasiga
shu kadrlardan birini qo‘shadi (faqat ogohlantirish bo‘lsa saqlanadi).

## Haqiqiy kamerada hali tekshirilmagan

Hikvision’ning to‘liq hujjatlari hamkor parolini talab qiladi, shuning uchun quyidagilar birinchi kamerada
sinab ko‘rilishi kerak: DeepinView proshivkasida `alarmResult` JSON aniq ko‘rinishi; ID No. maydoni `S-12`
kabi kodni qabul qilishi; HTTPS orqali yuborish; chiziq/zona/to‘silish hodisalarining to‘liq XML namunasi.
