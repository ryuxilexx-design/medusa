# Med.uz.ai — to‘liq audit (2026-10-20)

To‘rt yo‘nalish, har biri alohida sinov bazasi va serverda (live demo’ga tegilmagan). Batafsil hisobotlar shu
papkada: `security.md`, `negative.md`, `load.md`, `ui.md` (inglizcha, har bir topilma uchun takrorlash yo‘li,
kutilgan/haqiqiy natija va kod joyi). Qayta ishga tushiriladigan skriptlar: `audit/security`, `audit/negative`,
`audit/load`, `audit/ui`.

## Qamrov

| Yo‘nalish | Nima qilindi |
|---|---|
| Xavfsizlik | 121 API manzili × 15 foydalanuvchi turi (1 683 so‘rov): ruxsatlar, boshqa klinika ma’lumoti, kirish/sessiya, SQL va boshqa in’ektsiyalar, CSV formulasi, sirlar jurnalda, AI prompt-in’ektsiya, Docker/Caddy/backup sozlamalari, bog‘liqliklar |
| Negativ va yaxlitlik | 346 tekshiruv: noto‘g‘ri/bo‘sh/ulkan qiymatlar, holatlar ketma-ketligi, 20–50 ta parallel so‘rov poygalari, pul va vaqt chegaralari, takroriy so‘rovlar, sahifalash |
| Yuk | 100 ming bemor, ~1 mln qabul, 828 ming hisob, 2,1 mln kamera hodisasi (3 yillik klinika); 10/50/200 bir vaqtdagi foydalanuvchi; baza ulanishi uzilishi; SQL rejalari |
| Interfeys | 5 rol × barcha sahifalar, taqiqlangan manzillar, ikki marta bosish, sekin/uzilgan internet, sessiya tugashi, 4 ekran o‘lchami, axe (qulaylik), 3 til, brauzer xotirasi |

## Natija

| Yo‘nalish | Kritik | Jiddiy | O‘rta | Kichik | Tuzatildi |
|---|---|---|---|---|---|
| Xavfsizlik | 0 | 0 | 1 | 2 (+2 ma’lumot) | o‘rta va kichiklar — hammasi |
| Negativ | 0 | 4 | 5 | 9 | 16 ta; 2 tasi qaror sifatida qoldi (pastda) |
| Yuk | 3 | 6 | 7 | 3 | kritik va jiddiylarning hammasi; 4 ta keyingi bosqichga |
| Interfeys | 0 | 1 | 7 | 9 | hammasi |

### Eng muhim tuzatishlar

- **Yuk:** yetishmayotgan indekslar (hisoblar, hisob qatorlari, bemor qidiruvi trigram, shifokor ro‘yxatlari,
  bosh sahifa, kamera hodisalari) — sinovda qabul jadvali 23 s → 27–72 ms, qidiruv 50 → 570–2800 so‘rov/s;
  baza ulanishi uzilsa API endi yiqilmaydi; pool 20, ulanish va so‘rov vaqt chegaralari; `demo_now()` endi STABLE
  (indeksdan foydalanadi); CSV eksport ≤ 1 yil; jadval 500 qatorda jim kesilmaydi; kirish cheklovini soxta IP bilan
  chetlab bo‘lmaydi (proksi soni aniq), cheklov IP + login bo‘yicha; eskirgan sessiyalar tozalanadi;
  Docker’da `/dev/shm` 1 GB va Postgres sozlamalari.
- **Pul va poygalar:** parallel chiqimlar kassani minusga tushira olmaydi; ombor qoldig‘i minusga tushmaydi;
  bitta bemor parallel kiritilsa bitta karta; bitta so‘rov kaliti bilan ikki xil qabul yozilmaydi; kelib to‘lamagan
  bemorning qabuli bekor qilinsa hisobi ham bekor; to‘lov bo‘lgan hisob bekor qilinmaydi.
- **Kiritish:** mavjud bo‘lmagan sanalar (2027-02-30), ko‘rinmas belgilar, NUL, ulkan sonlar — 500 emas, 422;
  to‘liq telefon raqami bilan qidiruv ishlaydi; `%`/`_` oddiy belgi.
- **Xavfsizlik:** bir filialli xodim bemor kartasida faqat o‘z filiali pulini ko‘radi; laborant bemorlar ro‘yxatini
  ocha olmaydi; shifokor ulushi faqat rahbarga; katta so‘rov 413; AI yozgan yangilik matni tozalanadi.
- **Interfeys:** tarmoq bir lahzaga uzilsa ish yo‘qolmaydi (oldin kirish sahifasiga otib yuborardi); «Bekor qilish»
  saqlanmagan ma’lumotni so‘rab yopadi; rol uchun bo‘lmagan sahifada toza «ruxsat yo‘q» holati; «Kelmadi» faqat
  qabul vaqtidan 15 daqiqa keyin (serverda ham); ikki oynadagi qayd ziddiyatida matn yo‘qolmaydi; xato holatlari
  (smena, hujjatlar, kamera kartalari); bemor ismi manzil satrida saqlanmaydi; skip-link, ekran o‘quvchi uchun xatolar.

### Ochiq qolganlar (qaror yoki keyingi bosqich)

- **NEG-14:** qaytarishlardan keyin xizmat bo‘yicha taqsimotda 1 tiyinlik yaxlitlash farqi (hisob jami to‘g‘ri).
- **NEG-18:** foizli chegirma keyin qo‘shilgan xizmatlarga ham qo‘llanadi — klinika siyosati bo‘yicha qaror kerak.
- **Yuk F8, F11 (kesh), F15, F17:** check-in hisoblagichlari tartibi, bosh sahifa keshi va kunlik agregat jadval,
  «barchasi» ro‘yxatlarining standart davri, javoblarni siqish (production’da Caddy siqadi) — indekslardan keyin
  muammo emas, katta klinikalar uchun keyingi bosqich.
- **Xavfsizlik F4:** `postcss` (faqat build vaqtida) — Next.js yangilanganda.
- Haqiqiy server (O‘zbekistondagi) va production build’da yuk sinovini takrorlash — o‘rnatishdan keyin.

## Testlar

Har bir tuzatilgan topilma uchun doimiy regression test: `apps/api/test/audit.test.mjs` (16 ta), plus kamera,
yangiliklar va interfeys E2E to‘plamlari. Natijalar `docs/DEMO_STATUS.md` da.
