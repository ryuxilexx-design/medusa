# Birinchi haqiqiy Hikvision kamerasida sinov rejasi

Maqsad: soxta kamerada tasdiqlangan integratsiyani (`apps/api/test/isapi.test.mjs`) haqiqiy DeepinView kamerada bir
kunda tekshirish. Kerak: bitta yuz tanish kamerasi (masalan iDS-2CD7146G0-IZS yoki iDS-2CD7A46G0-IZHS), Med.uz.ai
serveri shu tarmoqda (yoki internetda, `PUBLIC_URL` bilan), `APP_SECRET_KEY` sozlangan, administrator paroli.
Natijalarni shu jadvalga yozing; «Kutilgan» ustuni kodda nimaga tayanganimizni ko‘rsatadi.

| № | Qadam | Qayerda | Kutilgan natija | Natija |
|---|---|---|---|---|
| 1 | Kamera veb-sahifasida vaqt: UTC+05:00, NTP | kamera | vaqt Toshkent bilan bir xil | |
| 2 | Med.uz.ai: Kameralar → Qurilmalar → kamera qo‘shish (Davomat + Xavfsizlik) | ilova | kamera ro‘yxatda | |
| 3 | «Ulanish»: IP, 80, admin, parol → «Tekshirish va saqlash» | ilova | model va proshivka ko‘rinadi (`/ISAPI/System/deviceInfo`) | |
| 3a | Ataylab noto‘g‘ri parol | ilova | «Kamera login yoki parolni qabul qilmadi» maydon ostida; 5 martadan keyin «bloklangan» matni | |
| 4 | «Avtomatik sozlash» | ilova | kutubxona id, taqqoslash «yoq», listening test «OK»; «Qurilmalar»da «oxirgi aloqa» yangilandi | |
| 4a | Kamera veb-sahifasi: *HTTP Listening* | kamera | host 1 = bizning domen/IP, URL `/api/v1/hik/…`, JSON | |
| 4b | Kamera: *Face Picture Library* | kamera | «Med.uz.ai» kutubxonasi bor | |
| 4c | Kamera: *Face Picture Comparison* | kamera | yoqilgan, kutubxona = Med.uz.ai, chegara 80. Yoqilmagan bo‘lsa — qo‘lda yoqing va natijani yozing (ISAPI `faceContrast` qabul qilinmagan) | |
| 5 | Kodlar → xodim → «Rasm yuklash» (telefon bilan to‘g‘ridan, 20–300 KB) | ilova | «Kameraga yuborildi», qatorda «1 kamerada» | |
| 5a | Kamera: kutubxonada odam | kamera | Name = `S-n …`, ID No. = `S-n` (qaysi maydon to‘lganini yozing) | |
| 5b | Kamera rasmni rad etsa | ilova | xabar: yuz aniqlanmadi / hajm; boshqa rasm bilan qaytaring | |
| 6 | Xodim kamera oldidan o‘tadi | kamera → ilova | 10 soniya ichida Davomat’da «keldi» vaqti; o‘xshashlik ≥ 80 % | |
| 6a | Serverda `apps/api` logi | server | `tanilmagan hodisa turi` ogohlantirishi yo‘q; bo‘lsa — turini yozing | |
| 6b | Baza: `camera_events` oxirgi qatori | server | `kind=face_match`, `face_code_id` to‘lgan, `similarity` 80–100 | |
| 7 | Begona odam (kutubxonada yo‘q) o‘tadi | ilova | hech narsa yozilmaydi (yoki `low_similarity`/`no_code` bilan tashlanadi) | |
| 8 | Xavfsizlik: *Intrusion Detection* zonasi, ish vaqtidan tashqari yoki «har doim» rejimi | kamera → ilova | Xavfsizlik jadvalida «Hududga kirish», ogohlantirish; «surat saqlash» yoqilgan bo‘lsa — kadr | |
| 8a | Kadr kelmasa | kamera | *Event → Linkage → Upload to Surveillance Center / Capture* yoqilganini tekshiring | |
| 9 | Chiziq kesish, zonaga kirish/chiqish, uzoq turish (loitering), kamera to‘silishi | kamera → ilova | har biri o‘z nomi bilan; XML namunasini (server logidan) `docs/HIKVISION_ISAPI_RESEARCH.md` ga qo‘shing | |
| 10 | Kodlar → xodim → «Bekor qilish» | ilova → kamera | 30 soniya ichida kutubxonadan odam o‘chadi | |
| 11 | Pull rejimi: ulanishni «Pull» qilib saqlang | ilova | «oxirgi aloqa» yangilanib turadi; 6-qadam takror — hodisa keladi | |
| 12 | Kamera tarmoqdan 2 daqiqa uziladi, qayta ulanadi | ilova | hodisalar davom etadi; kamera avval yuborolmagan hodisani qayta yuborsa — bir marta saqlanadi | |
| 13 | HTTPS push (server domenida haqiqiy sertifikat) | kamera | listening test «OK»; bo‘lmasa — HTTP (klinika tarmog‘i) | |
| 14 | Server qayta ishga tushadi | server | push: kamera o‘zi davom etadi; pull: 30 soniyada oqim qayta ochiladi | |

Nimani yozib olish kerak (keyin kodga kiritamiz): 6b dagi hodisaning to‘liq JSON’i (rasmsiz), 9 dagi XML’lar, 5a da
kod qaysi maydonda saqlangani, 4c natijasi. Hammasi `S-n` kodlar bilan, haqiqiy bemor rasmlarisiz.
