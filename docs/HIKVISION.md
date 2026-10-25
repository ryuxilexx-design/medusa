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

### A. Avtomatik — kamera menyusiga kirmasdan (tavsiya etiladi)

Med.uz.ai kameraga ISAPI orqali o‘zi ulanadi (`apps/api/src/cameras/isapi-client.ts`), serverda `APP_SECRET_KEY`
sozlangan bo‘lishi kerak (kamera paroli shifrlab saqlanadi).

1. **Kameralar → Qurilmalar → «Kamera qo‘shish»**: filial, nom, joy, vazifalar (Davomat / Bemor kelishi /
   Odam sanash / Xavfsizlik).
2. Kamera qatorida **«Ulanish»**: kameraning IP manzili (klinika tarmog‘ida), port (80), administrator login va parol,
   rejim:
   - **Push** (odatiy): kamera hodisalarni serverga o‘zi yuboradi — server internetda (yoki kamera serverni ko‘radigan
     tarmoqda) bo‘lsa;
   - **Pull**: server kameradan o‘qiydi (`alertStream`) — server klinika ichida, kamera uni ko‘rmasa ham ishlaydi;
     bu rejimda serverdan kameraga yo‘l bo‘lishi kerak.
   «Ulanishni tekshirish va saqlash» kameradan model, proshivka va seriya raqamini oladi; parol noto‘g‘ri bo‘lsa
   maydon ostida aytadi; 5 marta xato parol — kamera 30 daqiqaga bloklanadi (Hikvision qoidasi).
3. **«Avtomatik sozlash»** bir bosishda:
   - kameraga yangi maxfiy push manziliga ega **HTTP listening** host’ini yozadi (`/ISAPI/Event/notification/httpHosts/1`,
     JSON, token hech kimga ko‘rsatilmaydi — faqat kamerada va bazada hash), so‘ng kameraning o‘z **test** xabarini
     yuboradi (`httpHosts/1/test`) — «OK» bo‘lsa yo‘l ochiq;
   - **yuz kutubxonasi**ni yaratadi yoki topadi (`/ISAPI/Intelligent/FDLib`, nomi «Med.uz.ai»);
   - 1-kanalda **yuz taqqoslash**ni shu kutubxona bilan yoqadi (`/ISAPI/Intelligent/channels/1/faceContrast`, chegara 80 %;
     ba’zi proshivkalar buni faqat veb-sahifada beradi — unda natijada «yo‘q» chiqadi, qo‘lda yoqiladi).
4. **Yuz yuklash**: Kameralar → Kodlar → xodim qatorida **«Rasm yuklash»** (telefon kamerasi bilan ham); bemor uchun —
   bemor kartasi → Rozilik → «Rasm yuklash» (faqat imzolangan biometrik rozilik bo‘lsa). Rasm (JPEG, 20–300 KB, bitta
   yuz) serverdan to‘g‘ri kameraga ketadi (`FaceDataRecord` JSON; qabul qilmasa `pictureUpload` XML) va **serverda
   saqlanmaydi**; kod `FPID`, `certificateNumber`, `customHumanID` va `name` maydonlariga yoziladi, shunda proshivka
   qaysi maydonni qaytarsa ham tanish ishlaydi. Kod bekor qilinganda (xodim ketdi, bemor rozilikni qaytardi) server
   yuzni kameradan ham o‘chiradi (fon ishi, har 30 soniyada).
5. Kamerada baribir qo‘lda tekshirish kerak bo‘lgan 3 narsa: *System → Time* — UTC+05:00 va NTP; *Event*
   bo‘limlarida kerakli hodisalarda **«Notify Surveillance Center»** belgisi (ko‘p proshivkalarda avtomatik sozlash
   bilan yoqiladi, lekin hammasida emas); HTTPS ishlatilsa — ishonchli sertifikat (zavod self-signed sertifikati
   tasdiqlanmaydi, klinika tarmog‘ida HTTP ishlating).

### B. Qo‘lda — kamera veb-sahifasi orqali (zaxira yo‘l)

1. Med.uz.ai’da kamera qo‘shilganda **ulanish manzili bir marta** ko‘rsatiladi (`https://DOMEN/api/v1/hik/<token>`).
   Yo‘qotilsa — «Manzilni yangilash».
2. Kamera veb-sahifasi: *Configuration → Network → Advanced Settings → HTTP Listening* (yoki *Alarm Server*):
   manzil = Med.uz.ai domeni, port 443, URL = `/api/v1/hik/<token>`, HTTPS; proshivka HTTPS qabul qilmasa —
   klinika tarmog‘idagi serverga HTTP. *Event*’larda «Notify Surveillance Center». Vaqt — UTC+05:00, NTP.
3. *Face Picture Library*: kutubxona, odam, **ID No.** = Med.uz.ai kodi (`S-12`, `P-1001`); ID No. harf olmasa —
   **Name** maydoniga (`S-12 Ali`). Rasmni kamera bilan oling.
4. Tekshirish: kameraning *HTTP Listening → Test*; «Qurilmalar»da «oxirgi aloqa» yangilanadi.

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
- faqat rahbar va qorovul (o‘z filiali) ko‘radi: rahbar — `GET /api/v1/cameras/security/<id>/snapshot`, qorovul —
  `GET /api/v1/security/alerts/<id>/snapshot` (bosqinni tekshirish uning ishi); katta surat har ko‘rilganda audit
  jurnaliga yoziladi, qorovul ro‘yxatidagi xiralashtirilgan kichik kadr (`…/thumb`) har yuklanishda yozilmaydi;
  brauzer keshi «private»; Xavfsizlik jadvalida kichik kadr, bosilganda katta oyna va shu yerda «Ko‘rib chiqildi».

Kamerada buning uchun *Event → Linkage → Upload to Surveillance Center* (yoki *Notify Surveillance Center*) bilan
birga **«Capture picture»/«Upload picture»** yoqilgan bo‘lishi kerak — shunda HTTP listening xabari multipart
bo‘lib, rasm qismi bilan keladi. Haqiqiy kameradan suratlar faqat O‘zbekistondagi serverda saqlanadi; demo’da
(Railway) faqat namunaviy kadrlar bor (ochiq litsenziyali stok fotolar, yuzlar xiralashtirilgan).

### Bir oy davomida kamera nimalarni ko‘rsatadi

Hozirgi kod bilan (yuz kutubxonasi kamerada, xavfsizlik hodisalari serverda) klinika rahbari bir oyda taxminan
quyidagilarni ko‘radi. «Surat» ustuni — kadr saqlanadimi (faqat ogohlantirish, «surat saqlash» yoqilgan kamerada).

| № | Holat | Kamera hodisasi | Med.uz.ai’da | Surat | Rahbar nima qiladi | Demo’da |
|---|---|---|---|---|---|---|
| 1 | Tunda kassa xonasiga kirildi | `fielddetection` (intrusion), ish vaqtidan tashqari | qizil ogohlantirish, bosh sahifada «Kamera: xavfsizlik ogohlantirishi» | ✓ | kadrni ochadi: xodimmi, begonami; «Ko‘rib chiqildi» yoki qo‘riqchiga qo‘ng‘iroq | 12.10 02:15, kapyushonli odam peshtaxta oldida |
| 2 | Tunda dori ombori eshigi zonasiga kirish | `regionEntrance` | ogohlantirish; Ombor bo‘limida shu kecha qoldiq o‘zgarganmi — tekshiradi | ✓ | farrosh/navbatchi bo‘lsa yopadi; begona bo‘lsa inventarizatsiya | 05.10 23:40 (qutilar bilan xodim), 17.10 23:12 (siluet, **ochiq**) |
| 3 | Omborda uzoq turib qolish (sumkali odam) | `loitering` | ogohlantirish | ✓ | qaysi xodim ekanini aniqlaydi, dori hisobini solishtiradi | 08.10 00:40, 14.10 13:20 |
| 4 | Operatsiya bloki eshigida begona (kunduzi) | `regionEntrance` / `loitering`, «har doim» rejimi | ogohlantirish, begona kirgan vaqt | ✓ | hamshirani ogohlantiradi, kirish tartibini eslatadi | 16.10 14:36, 18.10 09:48 (**ochiq**) |
| 5 | Favqulodda chiqish eshigidan tunda chiqish | `linedetection` (A→B) | ogohlantirish, chiziq yo‘nalishi | ✓ | kim va nega chiqqanini surishtiradi | 04.10 23:58 |
| 6 | Kamera to‘sildi / bo‘yaldi / burildi | `shelteralarm` (tamper) | ogohlantirish, kadr qorong‘i-xira | ✓ | kamerani joyida tekshiradi; takrorlansa — texnik | 27.09 06:58 (kassa), 13.10 04:12 (ombor) |
| 7 | Asosiy kirishdan ish vaqtidan keyin kirish | `linedetection` / `fielddetection` | ogohlantirish | ✓ | kechikkan xodim yoki bemor — yopadi | 20.09, 24.09, 09.10, 11.10 tunlari |
| 8 | Xodim ish vaqtidan keyin kelib ketdi | yuz mosligi `S-n` + xavfsizlik hodisasi | Davomatda tungi «ko‘rindi», xavfsizlikda ogohlantirish | ✓ (faqat xavfsizlik hodisasiga) | kim ekani kod orqali ma’lum — tez yopadi | — |
| 9 | Bemor tunda koridorda (statsionar) | `fielddetection` | ogohlantirish | ✓ | navbatchi hamshiraga xabar | — |
| 10 | Kuryer / yetkazib beruvchi tunda eshikda | `loitering` kirishda | ogohlantirish | ✓ | qabul qilinganini tekshiradi | — |
| 11 | Bola yolg‘iz kirish oldida kunduzi | `loitering` («har doim» rejimi) | hodisa (ogohlantirish — rejimga qarab) | rejimga qarab | registratorga aytadi | — |
| 12 | Qabulxonada navbat to‘planib ketdi | `PeopleCounting` | Odam oqimi: eng band soat, kun jadvali | ✗ (hech qachon) | registrator qo‘shadi, jadvalni surishtiradi | 09:00–11:00 cho‘qqisi |
| 13 | Shifokor kechikdi / bemor kelganini kamera tanidi | yuz mosligi `S-n` / `P-n` | Davomatda kechikish, registratorga «Kamera tanidi» taklifi | ✗ (hech qachon) | hech narsa avtomatik o‘zgarmaydi, registrator tasdiqlaydi | Davomat, Navbat |
| 14 | Kamera jim qoldi (tok, tarmoq, o‘chirilgan) | hodisa yo‘q, `last_seen_at` eskiradi | bosh sahifada «Kamera javob bermayapti», Qurilmalar’da sariq | ✗ | texnikni chaqiradi | «Yunusobod kirish» kamerasi |
| 15 | Bir odam bir daqiqada bir necha hodisa yubordi | takror hodisalar | bitta yozuv (dedupe), ro‘yxat to‘lib ketmaydi | — | — | test |

Surat 30 kundan keyin o‘chadi, hodisa yozuvi qoladi. Kadrlarda yuz ko‘rinadi — shuning uchun suratni faqat rahbar va qorovul
(o‘z filiali) ko‘radi va u ogohlantirishdan boshqa hech qanday hodisada saqlanmaydi.

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
o‘zgaradigan odam oqimi va bitta «ochiq eshiklar kuni», kunduzgi oddiy va 24 ta ogohlantirish (3 tasi ko‘rib
chiqilmagan: kecha 23:12 dori ombori, 3 kun oldin Yunusobod kassasi, bugun 09:48 operatsiya bloki eshigida uzoq
turib qolgan odam), bemor kelishi tarixi (tasdiqlangan va «bu emas») hamda bugungi takliflar. Hammasi sun’iy.

Ogohlantirishlarning 23 tasida kameraning «surati» bor — `database/seed/snapshots/*.jpg`. Bular haqiqiy kameradan
emas: Wikimedia Commons’dagi ochiq litsenziyali shifoxona fotolari (`tools/snapshot-sources/`, mualliflar va
litsenziyalar `ATTRIBUTION.md` da), `tools/make-snapshots.py` ularni CCTV ko‘rinishiga keltiradi — avval har bir yuz,
ism yorlig‘i va o‘qiladigan yozuv pikselga aylantiriladi, keyin 960×540 kadr, tunda IR monoxrom, shovqin, kameraning
o‘z yozuvlari (vaqt, kanal nomi, zona, nishon ramkasi); tungi «begona» sahnalarda rasmga kapyushonli odam yoki siluet
(`tools/snapshot-sources/figures`) qo‘yilgan. Sahna o‘zgarsa skriptni qayta ishga tushiring; fayllar
repoda saqlanadi, seed ularni faqat o‘qiydi, API ishga tushganda o‘zgargan faylni bazadagi eski surat o‘rniga qo‘yadi
(`backfillSeedSnapshots`). «Sinov hodisasi» tugmasi ham xavfsizlik hodisasiga
shu kadrlardan birini qo‘shadi (faqat ogohlantirish bo‘lsa saqlanadi).

## Haqiqiy kamerada hali tekshirilmagan

Hikvision’ning to‘liq hujjatlari hamkor akkaunti (tpp.hikvision.com) bilan beriladi; integratsiya rasmiy «Face
Recognition Integration Solution», «How to get real-time event in listening mode» qo‘llanmalari va haqiqiy
qurilmalardan olingan namunalar bo‘yicha yozilgan (`docs/HIKVISION_ISAPI_RESEARCH.md`). Server tomoni soxta kamera
bilan to‘liq sinalgan (`apps/api/test/_fakecam.mjs`, `isapi.test.mjs`: digest, httpHosts, test push, FDLib JSON va
XML, FaceDataRecord/pictureUpload, o‘chirish, alertStream). Birinchi haqiqiy kamerada tasdiqlanadigan ro‘yxat
(`docs/HIKVISION_FIELD_TEST.md`): DeepinView proshivkasida `alarmResult` maydonlari va kod qaysi maydonda qaytishi;
`FaceDataRecord` yoki `pictureUpload` — qaysi biri qabul qilinishi; `faceContrast` ISAPI orqali yoqilishi;
HTTPS push; `httpHosts/1/test` natijasi; chiziq/zona/to‘silish XML’ining to‘liq ko‘rinishi.
