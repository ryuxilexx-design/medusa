# Med.uz.ai — namoyish ssenariysi (8–10 daqiqa)

## Uchrashuvdan oldin

**Kechasi yoki ertalab (bir marta):**
```bash
cd /Users/levi/Desktop/Meduza
npm run db:up          # PostgreSQL konteyneri
npm run demo           # production build + ishga tushirish (web :3000, API :4000)
```
Ilova: **http://127.0.0.1:3000**. Terminal oynasini yopmang.

**Uchrashuvdan 10–30 daqiqa oldin — reset (majburiy):**
Rahbar → **Sozlamalar** → **Demo boshqaruvi** → **Demo ma’lumotlarini tiklash** → `TIKLASH` deb yozing → **Tiklash**.
(yoki terminalda: `npm run db:reset` — ilova ishlab turganda ham bo‘ladi).

Reset ma’lumotni ham, **demo vaqti**ni ham birga boshlang‘ich holatga qaytaradi: sana 18-oktabr 2026 (yakshanba), soat **11:30**. Soat real vaqtda yuradi; API qayta ishga tushsa ham orqaga qaytmaydi. Yuqori panelda «Demo vaqti · 18-oktabr 2026, yakshanba, 11:3x» ko‘rinadi.

**Brauzer:** 1366×768 yoki kattaroq. Har rol uchun alohida oyna kerak (bitta brauzerda bitta sessiya): Chrome’da 4 ta alohida profil yoki oddiy oyna + inkognito + boshqa brauzer. Tavsiya:
- Oyna 1 — **Rahbar** (Dilnoza Karimova)
- Oyna 2 — **Registrator** (Malika Yusupova)
- Oyna 3 — **Shifokor** (kartada tanlang: «Terapevt · Akmal Rasulov») → keyin shu oynada **Laboratoriya**
- Oyna 4 — **Kassir** (Nodira Aliyeva)

Kirish: http://127.0.0.1:3000 → kerakli kartadagi **Kirish**.

## Foydalaniladigan ma’lumotlar

| Nima | Qiymat |
|---|---|
| Yangi bemor (namoyishda yaratiladi) | **Abdullayev Jamshid**, tug‘ilgan sana **14.05.1990**, Jins: Erkak, telefon **93 555 12 34** |
| Shifokor va xizmat | **Akmal Rasulov — Terapevt**, «Terapevt konsultatsiyasi» — 150 000 so‘m, 30 daqiqa |
| Bo‘sh vaqt | Akmal Rasulovda bugun **11:45 dan 13:00 gacha** va **13:30 dan 17:00 gacha** bo‘sh. Tavsiya: **14:00** (reset uchrashuvdan 2,5 soatdan ko‘p oldin qilinmagan bo‘lsa, bu vaqt hali o‘tmagan bo‘ladi) |
| Band vaqt misoli | Akmal Rasulov **10:00** (Hasanova Barno, «Qabulda») — slot chizilgan, tanlanmaydi |
| Buyuriladigan tahlil | **Umumiy qon tahlili (UQT)** — 60 000 so‘m → hisob jami **210 000 so‘m** |
| Qayta kelgan bemor | **Karimov Aziz** (#1001) — 3 ta oldingi tashrif, tasdiqlangan UQT, allergiya «Penitsillin», eski qarz |
| Bir telefonli oila | **Tursunova Nilufar** (ona) va **Tursunova Madina** (qizi), telefon **90 111 22 33** |
| Tasdiqni kutayotgan natija | **Nurmatova Gulchehra** (#1005) — UQT, holati «Natija qoralama» |
| Qisman to‘langan hisob | **Umarov Sherzod** (#1004) — 210 000 dan 100 000 to‘langan, qoldiq **110 000 so‘m** |
| Boshlang‘ich KPI (Bugun, barcha filiallar) | Qabullar 28 · Kelgan bemorlar 20 · Yakunlangan 10 · Tushum **2 510 000 so‘m** (12 to‘lov) · Qarzdorlik **6 205 000 so‘m** (45 hisob) |

## Ochilish (0:00)

> «Med.uz.ai’da bemor bir marta ro‘yxatdan o‘tadi. Registratura, shifokor, laboratoriya va kassa uning xizmatlari ustida bir tizimda ishlaydi. Siz esa natijani rahbar panelida kuzatasiz.»

## Qadamlar

### 1. Rahbar — raqamning asosi (0:00–1:00) · Oyna 1
1. **Umumiy ko‘rinish** ochiq. KPI kartalarini ko‘rsating: tushum 2 510 000 so‘m, qarzdorlik 6 205 000 so‘m.
2. Yuqoridagi filial tanlovida **Yunusobod filiali** → raqamlar qayta hisoblanadi. So‘ng **Barcha filiallar** ga qaytaring.
3. **Oxirgi 30 kun** → kunlik tushum grafigi; ustun ustiga kursorni olib boring (kun summasi chiqadi).
4. **Bugun** ga qaytaring → **Qarzdorlik (joriy)** kartasini bosing → qarzdor hisoblar ro‘yxati → istalgan **To‘lash/Ochish** → xizmatlar va to‘lovlar.
> «Rahbar har bir raqamning ortidagi aniq hisob va to‘lovni ko‘ra oladi.»

### 2. Registrator — yangi bemor va qabul (1:00–2:30) · Oyna 2
1. Chap menyu **Bemorlar** → **Bemor qo‘shish**.
2. Familiya `Abdullayev`, Ism `Jamshid`, Tug‘ilgan sana `14.05.1990`, Jins **Erkak**, Telefon `93 555 12 34` → **Bemorni saqlash**.
3. «Qabulga yozish» oynasi o‘zi ochiladi (bemor tanlangan). **Shifokor**: *Akmal Rasulov — Terapevt*. Xizmat avtomatik: *Terapevt konsultatsiyasi*.
4. O‘ngdagi bo‘sh vaqtlardan **14:00** → **Qabulga yozish**. Chiziqli kataklar band (masalan 10:00).
5. *(Ixtiyoriy, 20 soniya)* **Bemorlar** → **Bemor qo‘shish** → `Tursunov`, `Amir`, `02.02.2020`, telefon `90 111 22 33` → **Bemorni saqlash** → «O‘xshash bemor topildi» (ona va singlisi) → **Baribir yangi bemor yaratish**.
> «Bo‘sh vaqtni server hisoblaydi. Bir slotga ikki kishi yozilolmaydi — bu baza darajasida himoyalangan.»

### 3. Registrator — kelish va navbat (2:30–3:00) · Oyna 2
1. Menyu **Navbat** → o‘ngda «Bugun kutilmoqda» → *Abdullayev Jamshid* qatorida **Keldi**.
2. Chap jadvalda navbat raqami (№15) paydo bo‘ladi. **Keldi** ni qayta bosish yangi raqam bermaydi.
> «Kelish belgilanishi bilan shifokor navbatida paydo bo‘ladi va hisob avtomatik ochiladi.»

### 4. Shifokor — ko‘rik, AI loyihasi, tahlil (3:00–5:00) · Oyna 3
1. **Shifokor kabineti** → chap ro‘yxatda *Abdullayev Jamshid* (Keldi) → **Qabulni boshlash**.
2. **AI bilan tartiblash** → **Demo matnni qo‘yish** → **Tartiblash** → yonma-yon loyiha.
3. AI’ni shunday tushuntiring (quyidagi bo‘limga qarang) → **Loyihani formaga qo‘llash**.
4. Sistolik `125`, Diastolik `80`, Harorat `37.6` → **Qoralamani saqlash** (o‘ng yuqorida «Qoralama saqlangan: hh:mm»).
5. **Tekshiruv buyurish** → *Umumiy qon tahlili (UQT)* belgilang → **Buyurtma berish**.
6. **Tasdiqlash va yakunlash** → **Tasdiqlash**. Qayd bloklanadi, qabul «Yakunlangan».
7. *(Ixtiyoriy)* Chap ro‘yxatda *Karimov Aziz* → o‘ng panel «Bemor tarixi»: oldingi qabullar, tasdiqlangan UQT; yuqorida qizil «Allergiya: Penitsillin».
> «Klinik jarayon bitta ish joyida. AI faqat loyiha beradi; qarorni va tasdiqni shifokor qiladi.»

### 5. Laboratoriya — natija (5:00–6:00) · Oyna 3
1. Yuqori o‘ngdagi chiqish belgisi → kirish sahifasida **Laboratoriya** → **Kirish**.
2. Qidiruvga `Abdullayev` → *Umumiy qon tahlili (UQT)* → **Namuna olindi**.
3. Qiymatlar: Gemoglobin `138`, Eritrotsitlar `4.6`, Leykotsitlar `11.2` (avtomatik «Yuqori»), Trombotsitlar `250`, EChT `9` → **Qoralama saqlash** → **Natijani tasdiqlash**.
4. Natijani shifokor kartasida ko‘rsatish: chiqish → **Shifokor** (Akmal Rasulov) → *Abdullayev Jamshid* → «Buyurtmalar va natijalar»da «Tasdiqlangan» va qiymatlar.
*Vaqtni tejash uchun:* 2–3-qadamlar o‘rniga «Qoralama» tabidagi *Nurmatova Gulchehra* buyurtmasida faqat **Natijani tasdiqlash** ni bosing.
> «Natija qayta ko‘chirib yozilmaydi; kim va qachon tasdiqlagani saqlanadi.»

### 6. Kassir — to‘lov (6:00–7:00) · Oyna 4
1. **Kassa** → qidiruvga `Abdullayev` → **To‘lash**. Hisobda 2 xizmat: konsultatsiya 150 000 + UQT 60 000 = **210 000 so‘m**.
2. Summa `100000`, usul **Naqd** → **To‘lovni qayd qilish** → «Qisman to‘langan», qoldiq 110 000.
3. *(Ko‘rsatish uchun)* Summa `999999999` → **To‘lovni qayd qilish** → maydon yonida «qoldiqdan oshmasligi kerak».
4. **To‘liq** tugmasi → usul **Karta** → **To‘lovni qayd qilish** → «To‘langan».
5. To‘lovlar jadvalida **Ichki qayd** → yangi oynada hujjat («Ichki to‘lov qaydi — fiskal chek emas»).
*Alternativ:* *Umarov Sherzod* hisobida qoldiq 110 000 ni to‘lash.
> «Pul va xizmatlar bog‘langan. Bir to‘lov ikki marta yozilmaydi, ortiqcha to‘lov qabul qilinmaydi.»

### 7. Rahbar — natija (7:00–8:00) · Oyna 1
1. **Umumiy ko‘rinish** ni yangilang (F5): tushum **2 720 000 so‘m** (+210 000), to‘lovlar soni 14, kelgan bemorlar va yakunlanganlar +1.
2. **Qayd etilgan tushum** kartasini bosing → **Moliya**: Abdullayev Jamshidning ikki to‘lovi (Naqd + Karta) → **CSV eksport**.
> «Hisobot tirik ma’lumotdan hisoblanadi — alohida kiritilgan raqam yo‘q.»

### 8. Kengayish (8:00–9:00) · Oyna 1
- **Ombor** → «Faqat kam qolganlar» (4 ta; dashboard ogohlantirishi bilan bir xil).
- **Xodimlar** → *Akmal Rasulov* → ish jadvali, bugungi qabullar, hisoblangan ulush.
- **Sozlamalar** → **Xizmatlar katalogi** → narxni o‘zgartirish mumkin (eski hisoblar o‘zgarmaydi) → **Audit jurnali**: namoyishdagi barcha amallar.

### 9. Yakun (9:00–10:00)
Keyingi bosqich: klinikaning haqiqiy xizmatlari, narxlari, blankalari va integratsiyalari (TZ §22 savollari).

## AI namunaviy rejimini qanday tushuntiramiz

Oynada sariq **«Namunaviy rejim»** belgisi va «Namunaviy AI natijasi — haqiqiy model chaqirilmagan» yozuvi bor. Shunday ayting:

> «Hozir internetsiz, namunaviy rejimdamiz. Bu tayyor demo matni uchun oldindan yozilgan natija — jonli model ishlamayapti. Haqiqiy ulanishda xuddi shu oyna serverdagi AI’ga matnni yuboradi. AI faqat shifokor yozganini bo‘limlarga ajratadi; yangi tashxis yoki dori qo‘shmaydi, yo‘q bo‘lim «Kiritilmagan» bo‘lib qoladi. Natija faqat qoralamaga tushadi — tasdiqlashni shifokor qiladi.»

Agar mehmon boshqa matn yozib ko‘rmoqchi bo‘lsa, tizim «Namunaviy rejimda faqat tayyor demo matni tartiblanadi» deb javob beradi. Bu ataylab shunday: namunaviy javob boshqa matnga moslashtirilib, AI ishlayotgandek ko‘rsatilmaydi.

## Internet uzilsa

- Ilova to‘liq lokal: brauzer → `127.0.0.1:3000` → API → lokal PostgreSQL. Tashqi CDN, shrift yoki API yo‘q, `AI_MODE=sample` internetsiz ishlaydi. **Internet uzilishi namoyishni to‘xtatmaydi** — davom eting.
- Agar `AI_MODE=live` qo‘yilgan bo‘lsa va internet uzilsa: AI oynasida «AI javob bermadi… qo‘lda davom ettiring» chiqadi, qoralama o‘zgarmaydi. Qaydni qo‘lda to‘ldirib davom eting yoki serverda `AI_MODE=sample` qilib API’ni qayta ishga tushiring (demo vaqti orqaga qaytmaydi).
- Agar ilova umuman ochilmasa (noutbuk qayta yoqilgan bo‘lsa): `npm run db:up` → `npm run start` (build qayta kerak emas).
- Favqulodda zaxira: `docs/screenshots/` dagi skrinshotlar — ularni «oldindan olingan ekranlar» deb ko‘rsating.

## Savol bo‘lsa ko‘rsatish mumkin

- Kassir oynasida klinik qayd hujjatini ochishga urinish (`/print/note/...`) → «ruxsat yo‘q». Rahbar ham klinik qaydni o‘qimaydi.
- Shifokor qaydga yozib turib, menyudan boshqa bo‘limga o‘tmoqchi bo‘lsa → «Saqlanmagan o‘zgarishlar bor» ogohlantirishi.

## Aytilmaydigan narsalar

MedPlus/DMED bilan tekshirilmagan solishtirish; tejaladigan soat yoki foiz va’dalari; namunaviy AI’ni «ishlayotgan AI» deb taqdim etish; «Tasdiqlangan»ni elektron raqamli imzo deb atash; PDF tekshiruvini printer tekshiruvi deb aytish.

## Namoyishdan keyin

Rahbar → Sozlamalar → Demo boshqaruvi → reset. `npm test` va `npm run e2e` demo bazaga tegmaydi (alohida `meduza_test` bazasida ishlaydi).
