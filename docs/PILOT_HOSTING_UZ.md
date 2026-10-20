# Med.uz.ai pilotini O‘zbekistonda joylashtirish: qonun talablari va hosting provayderlari

Tayyorlangan sana: **2026-yil 20-oktabr**. Barcha manbalar shu kuni ochib tekshirildi. Har bir manbaning e’lon sanasi «Manbalar» bo‘limida ko‘rsatilgan.
Bu hujjat yuridik xulosa emas, tadqiqot natijasi. «Ochiq savollar» bo‘limidagi masalalarni pilotdan oldin yurist va provayder bilan yozma tasdiqlatish kerak.

---

## English summary

**Law (big change in 2026).** Law ZRU-547 «On personal data» was amended by **Law O‘RQ-1125 of 26 March 2026 (in force 27 March 2026)**. The new Article 27-1 no longer requires *all* personal data of Uzbek citizens to be stored in Uzbekistan. Mandatory in-country storage now covers only (1) **biometric data**, (2) **genetic data** and (3) data on users of telecom operators working in Uzbekistan [L1, L2]. Other data, health data included, may be stored or processed abroad under one of three conditions. The destination country can be on the Cabinet of Ministers' adequacy list: Resolution No. 415 of 29.07.2026, in force 03.08.2026, names 49 countries. The **USA is listed with an asterisk, meaning only companies in the EU-US Data Privacy Framework** [L3]. The other two routes are approved standard contractual clauses / binding corporate rules (requirements were due about 3 months after 03.08.2026, and I found no publication) or approved international standards [L1, L3].

**Why we should still host in Uzbekistan.** Five reasons:
1. Health data is a *special category* (Art. 25).
2. Administrative Code Art. 46-2 and Criminal Code Art. 141-2 still use the **old wording**: storage «on technical means physically located in Uzbekistan» and in a registered database, with fines of 7 BHM for citizens and 50 BHM for officials, and criminal liability on repeat [L6, L7]. The codes and the law now conflict.
3. The US adequacy entry depends on the specific company's DPF status.
4. The project's own rule (CLAUDE.md) already keeps real patient data off the US Railway demo.
5. Clinics must connect to the Ministry of Health's «Elektron sog‘liqni saqlash» system as a **licence condition**: Tashkent from 10.12.2025, all regions by end-2026, under Cabinet Resolution No. 570 of 08.09.2025 [L9]. A May 2026 presidential decree sets 1 April 2027 for all clinics to integrate with the Digital Healthcare platform [L10].

**Other legal points.**
- **Consent:** special data needs written consent, electronic included. There is an exception for diagnosis and treatment by a medical worker bound by confidentiality [L1, Art. 21, 25].
- **Registration:** since March 2026, registration in the State register is required only for databases that *must* be stored in Uzbekistan (Art. 20). Without biometric or genetic data the duty may not apply. A lawyer must confirm this.
- **Breach notice:** the law sets no general deadline. A 24 h / 72 h notice applies only to leaks during cross-border transfer [L3].
- **Regulator:** the name is unclear. The law names the State Personalization Center [L1]. Resolution 415 points to the Interior Ministry's Migration and Personalization Department [L3]. gov.uz lists a Personalization Agency under the Ministry of Justice [L13].
- **Retention:** I found no Uzbek retention period for medical records.

**Hosting** (prices for ~4 vCPU / 8 GB / 100 GB SSD, calculated from published price lists; 1 USD = 12 044.72 so‘m, CBU, 20.10.2026 [P18]):

| Provider | Price per month |
|---|---|
| **Uztelecom Cloud** | ≈ 634 000 so‘m (≈ $53) + backup |
| **Pro-Data** | ≈ 788 400 so‘m (≈ $65), excl. VAT |
| **Servercore** (calculator) | ≈ 1.11 M so‘m (≈ $92) |
| **hostmaster.uz** (6/8/150) | 449 900 so‘m |
| **TCloud** (6/8/100) | 530 000 so‘m |
| **ahost.uz** (6/8/400) | 1 040 000 so‘m |

- **S3:** Uztelecom, Pro-Data, Servercore (Tier III Tashkent site) and Beeline Cloud offer it.
- **Managed PostgreSQL:** Servercore is the only one that publishes it.

**Recommendation:** contact **Uztelecom Cloud (UzCloud)** first. It is the state operator, sign-up is online, and it has S3 and backup. It has Tier III-certified data centres, including new sites in Bukhara and Kokand for off-site backup. Contact **Pro-Data** second: it claims ISO 27001 and compliance with ZRU-547, has several UZ zones, publishes a price list and offers Veeam backup and S3. Let’s Encrypt is used by Uzbek hosts (Uztelecom bundles it [P6]), but test ACME from the chosen VM.

---

## 1) Qonun talablari

### 1.1. Asosiy hujjat va uning o‘zgarishlari

- **«Shaxsga doir ma’lumotlar to‘g‘risida»gi Qonun, O‘RQ-547, 2019-yil 2-iyul**, 2019-yil 1-oktabrdan kuchga kirgan. lex.uz’dagi joriy tahrir 12.09.2026 gacha bo‘lgan o‘zgarishlarni o‘z ichiga oladi. O‘zgartirishlar sanalari: 15.01.2021, 21.04.2021 (O‘RQ-683), 29.11.2023 (O‘RQ-880), 27.03.2026 (O‘RQ-1125), 25.07.2026 (O‘RQ-1158), 12.09.2026 (O‘RQ-1174, 25-moddaning bolalarga oid bandi) [L1].
- **27-1-modda (lokalizatsiya) tarixi.** Modda 2021-yil yanvardagi qonun bilan qo‘shilgan va 2021-yil 15/16-apreldan kuchga kirgan. Manbalar sanani 15 yoki 16-aprel deb turlicha ko‘rsatadi [L11, L12]. O‘sha paytda modda **barcha** fuqarolar ma’lumotlarini «jisman O‘zbekiston hududida joylashgan texnik vositalarda» yig‘ish, tizimlashtirish va saqlashni hamda bazani davlat reyestrida ro‘yxatdan o‘tkazishni talab qilgan [L11].
- **2026-yil 26-martdagi O‘RQ-1125 qonuni** 27-1-moddani butunlay yangi tahrirda bayon qildi. Qonun 27.03.2026 dan kuchga kirgan [L2, L5]. 2025-yil iyulida biznes va mutaxassislar eski talabning noaniqligini tanqid qilgan edi [L15].

### 1.2. Hozir nima O‘zbekistonda saqlanishi shart (27-1-modda, 2026-yil tahriri)

Qonun matnidan iqtibos [L1]:

> «Quyidagi shaxsga doir ma’lumotlar O‘zbekiston Respublikasi hududida saqlanishi shart: jismoniy shaxslarning biometrik ma’lumotlari; jismoniy shaxslarning genetik ma’lumotlari; O‘zbekiston Respublikasi hududida o‘z faoliyatini amalga oshirayotgan telekommunikatsiyalar operatorlaridagi ularning xizmatlaridan foydalanuvchi jismoniy shaxslarning ma’lumotlari.»

Boshqa ma’lumotlarni chet elda saqlash va ularga ishlov berish uchun quyidagi shartlardan **bittasi** bajarilishi kerak [L1]:
1. Chet davlat bir xil himoya ta’minlovchi davlat sifatida tan olingan bo‘lishi.
2. Vakolatli organ tasdiqlagan standart shartnomaviy shartlar yoki majburiy korporativ qoidalar qo‘llanishi.
3. Vakolatli organ ro‘yxatini tasdiqlagan xalqaro standartlarga rioya etilishi.

- **Biometrik ma’lumot ta’rifi** (26-modda): «Subyektning anatomik va fiziologik o‘ziga xos xususiyatlarini tavsiflovchi shaxsga doir ma’lumotlar» [L1]. Med.uz.ai yuz yoki barmoq izi bilan identifikatsiya qilmaydi. Lekin bemor surati yoki rentgen tasviri biometrik hisoblanadimi, bu ochiq savol (4-bo‘lim).
- **Sog‘liq ma’lumotlari** 27-1-moddadagi majburiy ro‘yxatda **yo‘q**. Ular 25-moddada «maxsus ma’lumotlar» qatorida turadi [L1]. Demak, 2026-yil martidan boshlab qonun bo‘yicha sog‘liq ma’lumotini chet elda saqlash taqiqlanmagan, faqat 27-1-moddadagi shartlar bajarilishi kerak. Bu qonun matnidan chiqarilgan xulosa, rasmiy tushuntirish topilmadi.
- **Vazirlar Mahkamasining 2026-yil 29-iyuldagi 415-son qarori** 03.08.2026 dan kuchga kirgan va 49 ta davlat va hududni tasdiqlagan [L3, L4]:
  - Ro‘yxatda AQSH, Germaniya, Rossiya, Yevropa Ittifoqi davlatlarining ko‘pchiligi, Buyuk Britaniya, Yaponiya, Koreya, Singapur va boshqalar bor. Qozog‘iston ro‘yxatda yo‘q [L4].
  - **AQSH yulduzcha bilan berilgan.** Bu faqat EU-US Data Privacy Framework doirasida ishlaydigan kompaniyalarga taalluqli [L3].
  - Ro‘yxatga kirmagan davlatlar uchun standart shartnoma shartlari va majburiy korporativ qoidalarga talablar **3 oy ichida** tasdiqlanishi kerak edi (IIV, Raqamli texnologiyalar vazirligi, DXX, Istiqbolli loyihalar milliy agentligi) [L3]. Ular e’lon qilingani topilmadi.
- **Zaxira nusxalar (backup).** Qonunda backup alohida tilga olinmagan. Lekin «ishlov berish» ta’rifiga «saqlash» kiradi (4-modda) [L1]. Shuning uchun backup ham asosiy baza bilan bir xil rejimda. Masalan, AQShdagi backup chet elga uzatish va saqlash hisoblanadi. Bu ham qonun ta’rifidan chiqarilgan xulosa.

### 1.3. Muhim ziddiyat: kodekslar eski tahrirda qolgan

- **Ma’muriy javobgarlik to‘g‘risidagi kodeks, 46-2-modda** (O‘RQ-726 tahriri, 31.01.2022 dan) hali ham quyidagi talabga rioya etmaslikni jazolaydi: ma’lumotlarni «jisman O‘zbekiston Respublikasi hududida joylashgan texnik vositalarda hamda Shaxsga doir ma’lumotlar bazalarining davlat reyestrida belgilangan tartibda ro‘yxatdan o‘tkazilgan shaxsga doir ma’lumotlar bazalarida» yig‘ish, tizimlashtirish va saqlash. Jarima: **fuqarolarga 7 BHM, mansabdor shaxslarga 50 BHM** [L6].
- 2026-yil 21-yanvardagi O‘RQ-1115 qonuni bilan 46-2-moddaga ikkinchi qism qo‘shilgan: sun’iy intellekt yordamida ma’lumotlarga qonunga xilof ishlov berish yoki ularni tarqatish uchun **50–100 BHM** jarima va qurollarni musodara qilish [L6].
- **Jinoyat kodeksi, 141-2-modda.** Xuddi shu harakat ma’muriy jazodan keyin takrorlansa: **100–150 BHM** jarima yoki 3 yilgacha muayyan huquqdan mahrum qilish yoxud 2 yilgacha axloq tuzatish ishlari. Og‘irlashtiruvchi holatlarda 150–200 BHM yoki 3 yilgacha ozodlikdan mahrum qilish [L7].
- **BHM** 2026-yil 1-sentabrdan **440 000 so‘m** [L8]. Demak, 7 BHM = 3 080 000 so‘m, 50 BHM = 22 000 000 so‘m.
- **Xulosa:** 27-1-modda 2026-yilda yumshatildi, lekin jazo normalari eski «hamma narsa O‘zbekistonda» formulasini saqlab qolgan (lex.uz, 20.10.2026 holati). Shuning uchun eng xavfsiz yo‘l: **barcha bemor ma’lumotlarini, jumladan backup’larni ham, O‘zbekistonda saqlash**.

### 1.4. Davlat reyestri va vakolatli organ

- **20-modda (O‘RQ-1125 tahriri):** «27-1-moddaning ikkinchi qismiga muvofiq O‘zbekiston Respublikasi hududida saqlanishi shart bo‘lgan shaxsga doir ma’lumotlar bazalari» davlat reyestrida ro‘yxatdan o‘tkazilishi lozim [L1].
  - Ro‘yxatdan o‘tkazish «ariza berish prinsipi orqali xabardor qilish yo‘li bilan» amalga oshiriladi. O‘zgarishlar haqida 10 kalendar kun ichida xabar berish kerak [L1].
  - Tartibi Vazirlar Mahkamasining 2020-yil 8-fevraldagi 71-son qarori bilan tasdiqlangan [L1, L14].
  - 2020-yildagi tushuntirishga ko‘ra, ariza internet orqali, id.gov.uz identifikatsiyasi bilan beriladi [L14]. Hozirgi portal manzili tekshirilmadi.
- **Mulkdor va operator majburiyatlari (31-modda)** [L1]:
  - «o‘z mulki bo‘lgan va (yoki) ishlov berilayotgan shaxsga doir ma’lumotlar bazalarini ro‘yxatdan o‘tkazish»;
  - huquqiy, tashkiliy va texnik himoya choralarini ko‘rish;
  - ma’lumot o‘zgartirilganda, yo‘q qilinganda, uchinchi shaxsga berilganda subyektni **yozma** xabardor qilish.
- **Xulosa:** 31-moddada ro‘yxatdan o‘tkazish umumiy majburiyat sifatida qolgan, 20-modda esa uni faqat «O‘zbekistonda saqlanishi shart» bo‘lgan bazalar bilan cheklaydi. Biometrik yoki genetik ma’lumot bo‘lmasa, ro‘yxatdan o‘tkazish majburmi, buni yurist hal qilishi kerak.
- **Vakolatli organ nomi noaniq:**
  - Qonunning 8-moddasida: «Vazirlar Mahkamasi huzuridagi Davlat personallashtirish markazi» [L1].
  - Vazirlar Mahkamasining 2026-yilgi 415-son qarorida: «Ichki ishlar vazirligi huzuridagi Migratsiya va personallashtirish departamenti» [L3].
  - gov.uz’da «Adliya vazirligi huzuridagi Personallashtirish agentligi» sahifasi bor (2025–2026) [L13].
- **Ichki tashkiliy talablar.** Adliya vazirining 2023-yil 14-noyabrdagi 19-mh-son buyrug‘i operator ichidagi mas’ul bo‘linma yoki shaxs faoliyatining namunaviy tartibini belgilaydi. 20-mh-son buyruq esa ishlov berishning namunaviy tartibini belgilaydi [L1]. Himoya darajalari va texnik talablar Vazirlar Mahkamasining 2022-yil 5-oktabrdagi 570-son qarori bilan belgilangan [L1].

### 1.5. Rozilik

- **Umumiy qoida (21-modda):** rozilik «olinganligi faktini tasdiqlash imkonini beruvchi har qanday shaklda» beriladi [L1].
- **Maxsus ma’lumotlar uchun** (sog‘liq ham shular qatorida): «subyektning yozma shakldagi, shu jumladan elektron hujjat tarzidagi roziligi talab etiladi» [L1].
  - Voyaga yetmaganlar uchun rozilikni ota-ona, vasiy yoki homiy beradi. Muomalaga layoqatsiz shaxslar uchun qonuniy vakil yozma ravishda beradi [L1].
- **25-modda istisnosi.** Maxsus ma’lumotlarga quyidagi holatda ham ishlov berish mumkin: «tibbiy-ijtimoiy xizmatlar ko‘rsatilayotganda yoki tibbiy tashxis, davolash belgilanayotganda», agar ishlov berishni ma’lumotlarni himoya qilish majburiyati yuklangan tibbiyot xodimi yoki sog‘liqni saqlash muassasasining boshqa shaxsi bajarsa [L1].
  - Demak, shifokor uchun davolash maqsadidagi ishlov berish rozilikdan tashqari asosga ega.
  - Lekin ro‘yxatchi, kassir, Telegram eslatmalari va AI tahlili bu istisnoga to‘liq kirmasligi mumkin. Shuning uchun **yozma yoki elektron rozilik olish tavsiya etiladi**.
- **Uchinchi shaxsga berish (31-modda).** Ruxsat etilgan asoslar: yozma rozilik, shartnoma ijrosi yoki qonunda nazarda tutilgan hollar [L1]. Ma’lumot uchinchi shaxsga berilganda subyekt uch kun ichida yozma xabardor qilinadi (23-modda) [L1].

### 1.6. Saqlash muddati, yo‘q qilish, buzilish haqida xabar

- **Saqlash muddati (10-modda):** «yig‘ish va ularga ishlov berish maqsadiga erishish sanasi bilan belgilanadi» [L1].
- **Yo‘q qilish (17-modda):** maqsadga erishilganda, rozilik qaytarib olinganda yoki sud qarori bilan [L1].
- **Tibbiy hujjatlar uchun maxsus saqlash muddati** (ambulator karta, kasallik tarixi) O‘zbekiston manbalarida **topilmadi**. Topilgan «25 yil» ma’lumotlari Rossiya hujjatlariga tegishli va bu yerda qo‘llanmaydi. Bu ochiq savol.
- **Ma’lumotlar sizib chiqishi haqida xabar.** Qonunda umumiy muddat **yo‘q** [L1]. Vazirlar Mahkamasining 415-son qarorida faqat **transchegaraviy uzatish jarayonida** tarqalib ketish holati uchun muddat bor: vakolatli organga 24 soat ichida xabar, 72 soat ichida batafsil ma’lumot [L3].

### 1.7. Sog‘liqni saqlash sohasidagi qo‘shimcha talablar

- **Vazirlar Mahkamasining 2025-yil 8-sentabrdagi 570-son qarori**, 2-band [L9]. Toshkent shahri va 15 ta tajriba tumanida 2025-yil 10-dekabrdan, butun respublikada 2026-yil oxirigacha quyidagilar joriy qilinadi:
  > «barcha tibbiyot va farmatsevtika tashkilotlari Raqamli sog‘liqni saqlash platformasiga, ushbu platforma amaliyotga joriy etilgunga qadar Sog‘liqni saqlash vazirligining “Elektron sog‘liqni saqlash” axborot tizimiga integratsiya asosida ulanishini hamda “Elektron poliklinika”, “Elektron shifoxona”, “Elektron tibbiy karta”, “Elektron retsept” modullari bilan belgilangan ma’lumotlar real vaqt rejimida almashilishini **litsenziya talablari va shartlaridan biri** sifatida belgilash».
  - Integratsiya kaliti va texnologik yo‘riqnomani yagona integrator **«UZINFOCOM» MChJ** elektron ariza asosida bir ish kunida beradi [L9].
- **Sog‘liqni saqlash vazirligining 2025-yil 24-dekabrdagi 3758-son buyrug‘i** «Elektron tibbiy karta» va boshqa modullardan foydalanish tartibini tasdiqlagan [L17]. Buyruq matni ko‘rilmadi.
- **Prezident farmoni** «Sog‘liqni saqlash sohasida xizmatlar sifatini oshirish bo‘yicha qo‘shimcha chora-tadbirlar to‘g‘risida» (kun.uz, 06.05.2026; raqami maqolada yo‘q). Unga ko‘ra, barcha klinikalar 2027-yil 1-aprelgacha axborot tizimlarini «Raqamli sog‘liqni saqlash» platformasiga bepul, yagona standartlar asosida integratsiya qilishi kerak [L10].
- **DMED** Prezidentning PQ-415-son qarori asosida ishlaydi va xususiy hamda davlat muassasalarini yagona ekotizimga ulashni maqsad qiladi [L18].
- **Kiberxavfsizlik.** «Kiberxavfsizlik to‘g‘risida»gi Qonun (O‘RQ-764, 2022) sog‘liqni saqlashni muhim axborot infratuzilmasi sohalari qatorida sanaydi. Muhim infratuzilma obyekti deb belgilangan tizimlar majburiy ekspertizadan o‘tadi [L16]. Xususiy klinika tizimi bu toifaga kiradimi, aniqlanmadi.
- Bu talablarning hech biri hosting joyini to‘g‘ridan-to‘g‘ri belgilamaydi (topilgan matnlarda yo‘q). Lekin Med.uz.ai klinikalari uchun DMED/«Elektron sog‘liqni saqlash» bilan integratsiya **litsenziya shartiga aylanmoqda**.

### 1.8. Med.uz.ai uchun nazorat ro‘yxati (checklist)

- [ ] **Production va backup O‘zbekistonda.** Railway (AQSh) faqat sintetik demo uchun qoladi. Real bemor ma’lumotlari, loglar va dump’lar AQShga chiqmasin (1.3-band).
- [ ] **Biometrik va genetik ma’lumot yig‘ilmasin.** Yuz yoki barmoq izi bilan identifikatsiya qilinmaydi. Agar kelajakda kerak bo‘lsa, faqat O‘zbekistonda saqlanadi va baza davlat reyestrida ro‘yxatdan o‘tkaziladi (27-1, 20-moddalar).
- [ ] **Rozilik oqimi.** Bemor ro‘yxatga olinganda maxsus (sog‘liq) ma’lumotlarga ishlov berish uchun yozma yoki elektron rozilik olinadi. Kim, qachon, qaysi matn versiyasiga rozi bo‘lgani saqlanadi. Telegram eslatmalari va AI tahlili uchun alohida bandlar bo‘ladi. Rozilikni qaytarib olish imkoniyati ham kerak (21, 25-moddalar).
- [ ] **Klinika va Med.uz.ai o‘rtasida ma’lumotlarga ishlov berish shartnomasi.** Klinika bazaning mulkdori yoki operatori, Med.uz.ai esa uchinchi shaxs yoki operator. Shartnomada ishlov berish maqsadi, himoya choralari, sub-provayderlar (hosting, AI) va o‘chirish tartibi yoziladi (31-modda).
- [ ] **Maxfiylik siyosati** (o‘zbekcha). Unda maqsadlar, saqlash muddati, uchinchi shaxslar va subyekt huquqlari bayon qilinadi (10, 30-moddalar).
- [ ] **Mas’ul shaxs.** Klinika va Med.uz.ai tomonidan shaxsga doir ma’lumotlar uchun mas’ul tayinlanadi (Adliya vazirining 19-mh-son buyrug‘i, 2023).
- [ ] **Davlat reyestri.** Yurist bilan ro‘yxatdan o‘tkazish majburiyligi aniqlanadi. Majburiy bo‘lsa yoki ehtiyot uchun, har bir klinika bazasi ariza orqali ro‘yxatdan o‘tkaziladi va o‘zgarishlar haqida 10 kun ichida xabar beriladi.
- [ ] **Texnik choralar.** Kerakli choralar:
  - shifrlangan disk va backup;
  - TLS;
  - kirish nazorati va rollar (mavjud);
  - audit (mavjud);
  - backup’ni tiklashni sinash;
  - bitta tenant’ni to‘liq eksport qilish va o‘chirish imkoniyati (27-modda va 2022-yilgi 570-son qaror).
- [ ] **Incident rejasi.** Kim aniqlaydi, kim klinikaga va bemorga xabar beradi. Transchegaraviy uzatishda sizib chiqish bo‘lsa, vakolatli organga 24 soat ichida xabar va 72 soat ichida hisobot beriladi (415-son qaror).
- [ ] **AI (Claude API, AQSh).** Bemor matnini AQShga yuborish transchegaraviy uzatish hisoblanadi. AQSh faqat DPF ishtirokchisi kompaniyalar uchun «adekvat» deb tan olingan. Anthropic’ning DPF holatini tekshirish, `redact()` dan foydalanishni davom ettirish va rozilikka alohida band qo‘shish kerak. Tasdiqlanmaguncha real bemorlar uchun AI funksiyalarini o‘chirib qo‘yish tavsiya etiladi.
- [ ] **Telegram.** Bot orqali bemor telefon raqami va qabul vaqti Telegram serverlariga (chet elga) o‘tadi. Rozilik bandi kerak. Klinik ma’lumot yuborilmaydi (mavjud qoida).
- [ ] **Saqlash muddati siyosati.** Tibbiy yozuvlar uchun aniq muddat topilmadi. Yurist yoki Sog‘liqni saqlash vazirligidan tasdiq olinguncha hech narsa avtomatik o‘chirilmaydi.
- [ ] **DMED / «Elektron sog‘liqni saqlash» integratsiyasi** yo‘l xaritasiga kiritiladi: Toshkent uchun 2025-yil 10-dekabrdan litsenziya sharti, butun respublikada 2026-yil oxirigacha; farmon bo‘yicha 2027-yil 1-aprel muddati [L9, L10].

---

## 2) Provayderlar jadvali

**Hisoblash usuli.** «≈ 4/8/100 narxi» ustunidagi summa provayder e’lon qilgan birlik narxlari bo‘yicha men tomonidan hisoblangan: 4 vCPU + 8 GB RAM + 100 GB SSD + 1 ta IPv4. QQS ko‘rsatilmagan bo‘lsa, u «e’lon qilinmagan» deb yozilgan. USD: 1 $ = 12 044.72 so‘m (Markaziy bank, 20.10.2026) [P18].

| Provayder | Joylashuv | Taklif | ≈ 4 vCPU / 8 GB / 100 GB narxi (oyiga) | Managed PostgreSQL | S3 | Backup | Sertifikatlar | Buyurtma | Manba |
|---|---|---|---|---|---|---|---|---|---|
| **Uztelecom Cloud** (UzCloud, «O‘zbektelekom» AJ) | Toshkent. Yangi DC’lar: Buxoro, Qo‘qon (22.09.2026). Zangiota 2026-yil kuzida rejalashtirilgan | IaaS (VM), S3, Managed Kubernetes, App Platform, BaaS, GPU | Hisob: 4×71 000 + 8×10 000 + 100×2 200 (SSD) + 50 000 (IP) = **634 000 so‘m (≈ $53)**. Backup 600 so‘m/GB → 100 GB uchun +60 000. QQS e’lon qilinmagan. Narx sahifasida sana yo‘q | E’lon qilinmagan | Bor, 400 so‘m/GB | Bor (backup 600 so‘m/GB, snapshot 400 so‘m/GB) | Toshkent DC «Uptime Tier III darajasiga mos» deb yozilgan. Buxoro va Qo‘qon: **Tier III Design** sertifikati. ISO 27001: sertifikat e’lon qilinmagan, «talablarni hisobga olib» rivojlantirilmoqda | Onlayn: cloud.uztelecom.uz, sinov davri bor, «Pay as you GO». Yuridik shaxslar uchun shartnoma (colocation). Tel. 1155 | [P1], [P2], [P3], [P4], [P5] |
| **Pro-Data** (OOO «PRO DATA-TECH») | O‘zbekistonda 6 ta lokatsiya, zonalar UZ-3, UZ-5. Qozog‘istonda 1 ta | VPS/VDS, Managed Kubernetes, Load Balancer, S3, Veeam backup | Narxlar ro‘yxati (18.08.2025) bo‘yicha hisob: 4×95 200 + 8×12 700 + 100×2 860 (tez disk) + 20 000 (IP) = **788 400 so‘m (≈ $65)**. Standart disk bilan ≈ 581 400 so‘m. «Narxlarda QQS yo‘q, QQS hisoblanmaydi». USD sahifasida eng yaqin tarif: Generic 3, 8 vCPU / 8 GB / 100 GB, $95 | E’lon qilinmagan (faqat Kubernetes) | Bor: saqlash 350 so‘m/GB, yuklab olish 300 so‘m/GB | Diskni avtomatik backup qilish: 10 GB uchun 2 900 so‘m. Veeam: 1 VM uchun 290 000 so‘m (yillik obuna sharti bilan) | Saytda: xavfsizlik «ISO 27001 talablariga mos» (sertifikat fayli bor). DC’lar «TIER 3 bo‘yicha loyihalangan», ba’zilarida Uptime sertifikati bor. ZRU-547 ga muvofiqlikni da’vo qiladi | Konsultatsiya yoki demo so‘rovi, +998 78 555 30 22, Telegram bot. Pay-as-you-go | [P7] |
| **Servercore** | Toshkent: 3 ta joylashuv (Tier II N+1, Tier III va darajasi ko‘rsatilmagan bitta) | Cloud servers, dedicated, Managed Kubernetes, cloud DB, S3 (faqat Tier III joylashuvda) | Kalkulyator (O‘zbekiston ustuni deb taxmin qilindi): 4×124 686 + 8×45 374 + 100×2 128 + 33 614 (IP) ≈ **1 108 000 so‘m (≈ $92)**. Oyiga 3 TB trafik kiradi | **Bor** (PITR, backup bepul), lekin Tier III Toshkent joylashuvida ko‘rsatilmagan | Faqat Tier III Toshkent joylashuvida | PostgreSQL uchun avtomatik to‘liq va inkremental backup | PostgreSQL xizmati uchun umumiy da’vo: PCI DSS 3.2.1, ISO 27001/27017/27018. DC’lar uchun PCI DSS 4.0.1. Toshkentga xosligi aniq emas | Onlayn panel, savdo bo‘limi. O‘zbekistondagi yuridik shaxs nomi e’lon qilinmagan | [P8] |
| **Beeline Cloud** (fortifai.uz, MChJ «UNITEL») | Toshkent, Buxoro ko‘chasi 1 (ofis manzili). DC manzili e’lon qilinmagan. DataVolt TAS-1 DC’ga ijarachi bo‘lish rejasi bor (2026-yil oxiri) | Virtual server, Virtual DC, Managed Kubernetes, S3 (Nutanix), hosting | E’lon qilinmagan | E’lon qilinmagan | Bor (narxi e’lon qilinmagan) | E’lon qilinmagan | E’lon qilinmagan | Ommaviy oferta jismoniy shaxslar, yuridik shaxslar va YaTT uchun. **Yuridik shaxslar alohida shartnoma tuzishi shart**. cloud@beeline.uz, (90) 373-08-80 | [P10], [P11] |
| **Serverspace** (East Telecom YA DC’da) | Toshkent, East Telecom YA DC | VPS | Kalkulyatorda narx ko‘rinmadi, e’lon qilinmagan. 10 daqiqalik billing | Toshkent uchun e’lon qilinmagan | Toshkent uchun e’lon qilinmagan | Uch karrali disk replikatsiyasi. Backup e’lon qilinmagan | DC «Tier III tamoyillariga mos». Sertifikat e’lon qilinmagan. SLA 99.9% | Onlayn ro‘yxatdan o‘tish (Google/GitHub) | [P9] |
| **ahost.uz** («SUVAN NET» MChJ, ma’lumotnomalar bo‘yicha) | Toshkent, TAS-IX tarmog‘i. Germaniyada alohida hosting | VDS Cloud | VDS Cloud 200 (4 yadro / 4 GB / 200 GB): **590 000 so‘m**. VDS Cloud 400 (6 yadro / 8 GB / 400 GB): **1 040 000 so‘m (≈ $86)**. 4/8/100 tarifi yo‘q | Yo‘q (e’lon qilinmagan) | E’lon qilinmagan | E’lon qilinmagan | E’lon qilinmagan | Onlayn savatcha (clients.ahost.uz), telefon | [P12] |
| **hostmaster.uz** | Server joylashuvi e’lon qilinmagan. TAS-IX 100 Mbit/s kanali bor | VDS, dedicated, virtual DC | SSD Super (6 vCPU / 8 GB / 150 GB): **449 900 so‘m (≈ $37)**. SSD Profi (4 / 4 / 100) + 4 GB RAM (29 900/GB) ≈ 419 500 so‘m | E’lon qilinmagan | E’lon qilinmagan | Virtual DC uchun «avtomatik zaxiralash» va zaxira DC tilga olingan | Faqat Mininfokom litsenziyasi AA №0006929 | Onlayn, 3 kunlik bepul sinov | [P13] |
| **TCloud.uz** (Turon Telecom) | «Uzbekistan data center», nomi e’lon qilinmagan | VDS/VPS | VDS Pro (6 vCPU / 8 GB / 100 GB): **530 000 so‘m (≈ $44)**. Konfigurator ham bor | E’lon qilinmagan | E’lon qilinmagan | E’lon qilinmagan | E’lon qilinmagan | Onlayn. Faqat so‘mda to‘lov (Payme, karta, naqd, bank o‘tkazmasi) | [P14] |
| **Uzinfocom** | Toshkent, Navoiy ko‘chasi 28b (DC) | Davlat axborot tizimlari integratori. Tijorat VPS taklifi saytda topilmadi | E’lon qilinmagan | E’lon qilinmagan | E’lon qilinmagan | E’lon qilinmagan | E’lon qilinmagan | Saytda «Ariza qoldirish», abonent@uzinfocom.uz. DMED/«Elektron sog‘liqni saqlash» integratori sifatida muhim | [P15], [L9] |
| **East Telecom / TPS** (ETC Xpeed) | Toshkent, Yunusobod. 4 qavat, 6 000 m², 300+ stoyka | Colocation. Bulut xizmati «rejalashtirilgan» (sahifa eskirgan bo‘lishi mumkin) | E’lon qilinmagan | E’lon qilinmagan | E’lon qilinmagan | E’lon qilinmagan | «Tier III standartlari bo‘yicha qurilgan» (sertifikat ko‘rsatilmagan) | gtm@etc.uz, +998 78 150 00 00 | [P17] |
| **Sarkor Telecom** | Toshkent | Rasmiy saytda faqat «hosting» bor. Ma’lumotnomalarda colocation va VDS tilga olingan | E’lon qilinmagan | E’lon qilinmagan | E’lon qilinmagan | E’lon qilinmagan | E’lon qilinmagan | Telefon: +998 78 122-00-00 | [P16] |
| **Ucell** | — | Bulut yoki VPS taklifi topilmadi | — | — | — | — | — | — | (qidiruvda topilmadi) |

**Chet elliklar va MChJ uchun cheklovlar.** Hech bir provayder chet el fuqarosi yoki xorijiy kompaniya uchun maxsus cheklov e’lon qilmagan. Kuzatilgan amaliy shartlar:
- TCloud faqat so‘mda to‘lov qabul qiladi [P14].
- UNITEL (Beeline Cloud) yuridik shaxs bilan alohida shartnoma tuzishni talab qiladi [P10].
- Uztelecom colocation uchun «yuridik shaxslar va korxonalar» bilan shartnoma tuziladi [P2].
- O‘zbekistonda ro‘yxatdan o‘tgan MChJ va so‘mdagi bank hisobi bo‘lsa, bu amalda eng oson yo‘l (xulosa, manba yo‘q).

---

## 3) Amaliy masalalar

### 3.1. TLS sertifikatlari (Let’s Encrypt)

- **Let’s Encrypt O‘zbekistonda ishlaydi.** Uztelecom o‘zining shared hosting tariflariga «Free SSL certificate from Let’s Encrypt» ni kiritgan [P6]. Demak, mahalliy tarmoqdan sertifikat chiqarish amalda ishlaydi.
- Let’s Encrypt forumida 2018-yildagi bitta mavzu bor: sayt faqat O‘zbekistondan ochilganda SSL xatosi bergan, sababi aniqlanmagan [T1]. Bu eski holat.
- **Tavsiya:**
  - tanlangan VM’da `curl -v https://acme-v02.api.letsencrypt.org/directory` buyrug‘ini sinab ko‘rish;
  - muammo bo‘lsa, DNS-01 challenge yoki boshqa ACME CA (masalan, ZeroSSL) ishlatish;
  - Caddy yoki Traefik bilan avtomatik yangilashni sozlash va muddat tugashi haqida ogohlantirishni monitoringga qo‘shish.

### 3.2. TAS-IX va tarmoq

- **TAS-IX** O‘zbekistondagi tarmoqlar o‘rtasida trafikni xalqaro kanallarsiz to‘g‘ridan-to‘g‘ri almashish markazi [T2].
- Bir nechta provayderlar VM’ni TAS-IX’ga ulab beradi:
  - Pro-Data: UZ-3 va UZ-5 zonalarida Internet + TAS-IX, 100 Mbit/s [P7];
  - ahost: Internet va TAS-IX, 100 Mbit/s [P12];
  - hostmaster: TAS-IX, 100 Mbit/s [P13].
- Klinikalarning mahalliy internet provayderlari ham TAS-IX’da bo‘lsa, trafik mamlakat ichida qoladi va tez ishlaydi.
- **Xavf:** 2019-yil iyulida TAS-IX zonasidagi saytlar vaqtincha VPN’siz ochilmay qolgan [T3]. Monitoringni ham ichki, ham tashqi nuqtadan qilish kerak.
- **Kechikish (latency).** O‘zbekiston ichidagi va Toshkent–Yevropa kechikishi bo‘yicha ishonchli ochiq o‘lchov **topilmadi**. Tavsiya: pilotdan oldin klinika tarmog‘idan (Uztelecom, Beeline, Ucell, Sarkor, Turon) tanlangan VM’gacha `ping` va `mtr` bilan o‘lchash va natijani hujjatga kiritish.

### 3.3. Off-site backup (ikkinchi joylashuv)

- Topilgan qonun matnlarida **ikkinchi joylashuvda backup saqlash majburiyati yo‘q**. Lekin 27-modda operatordan ma’lumotlarning «yaxlitligini va but saqlanishini» ta’minlovchi choralarni talab qiladi [L1]. Bitta DC’dagi bitta disk bu talabga javob bermaydi.
- **Tavsiya:**
  - Asosiy VM Toshkentda bo‘lsin. Shifrlangan kunlik `pg_dump` va WAL arxivi S3’ga yozilsin.
  - S3 **boshqa shahardagi DC’da** bo‘lsin, masalan Uztelecom’ning Buxoro yoki Qo‘qon DC’si (Toshkentdan 300 km dan uzoq) [P3]. Muqobil variant: Pro-Data’ning boshqa zonasi yoki boshqa provayder.
  - Backup ham O‘zbekistonda qolishi kerak (1.2 va 1.3-bandlar).
  - Har oy backup’dan tiklash sinovi o‘tkazilsin.

---

## 4) Tavsiya: birinchi bo‘lib kim bilan bog‘lanish kerak

**1-o‘rin. Uztelecom Cloud (UzCloud), cloud.uztelecom.uz.** Sabablari:
- Davlat operatori. Klinikalar va tekshiruvchilar uchun «O‘zbekistonda saqlanadi» degan da’voni isbotlash eng oson.
- Ommaviy narxlar e’lon qilingan. Taxminiy hisob: 4/8/100 uchun **≈ 634 000 so‘m/oy**, backup bilan ≈ 694 000 so‘m [P1].
- Onlayn ro‘yxatdan o‘tish va sinov davri bor [P5].
- Bitta provayderda S3 va BaaS bor. Toshkentdan tashqarida Tier III Design sertifikatli DC’lar bor (Buxoro, Qo‘qon), shuning uchun off-site backup ham shu yerda hal bo‘ladi [P3, P4].

Kamchiliklari:
- Managed PostgreSQL e’lon qilinmagan, PostgreSQL’ni Docker’da o‘zimiz boshqaramiz.
- ISO 27001 sertifikati e’lon qilinmagan [P4].
- Narx sahifasida sana va QQS ko‘rsatilmagan.

**2-o‘rin. Pro-Data, pro-data.tech.** Sabablari:
- ISO 27001 ga muvofiqlikni va ZRU-547 ga muvofiqlikni ochiq da’vo qiladi [P7].
- O‘zbekistonda bir nechta zona bor (UZ-3, UZ-5).
- Narxlar ro‘yxati e’lon qilingan, sanasi bor (18.08.2025).
- Veeam backup, S3 va TAS-IX bor.

Taxminiy narx: 4/8/100 uchun ≈ 788 400 so‘m/oy (QQSsiz). Standart disk bilan ≈ 581 400 so‘m.

**Muqobil variant.** Managed PostgreSQL kerak bo‘lsa (PITR bilan), **Servercore** bilan gaplashish mumkin. Shartlar: S3 va DB qaysi Toshkent joylashuvida mavjudligini, O‘zbekistondagi yuridik shaxsni va narxni yozma tasdiqlatish. Narx yuqoriroq: ≈ 1,1 mln so‘m [P8].

**Pilot uchun minimal arxitektura:**
- 1 ta VM (4 vCPU / 8 GB / 100 GB SSD) Toshkentda: Docker’da web, API va PostgreSQL;
- shifrlangan backup boshqa shahardagi S3’ga;
- Let’s Encrypt;
- tashqi uptime monitoring;
- Railway’dagi demo alohida, faqat sintetik ma’lumot bilan.

---

## 5) Ochiq savollar

### Yurist bilan aniqlashtirish kerak

1. **Kodekslar va qonun ziddiyati.** MJtK 46-2 va JK 141-2 hali ham «jisman O‘zbekistonda» saqlashni talab qiladi, 27-1-modda esa 2026-yildan buni talab qilmaydi [L1, L6, L7]. Amalda qaysi normaga tayaniladi? Kodekslarni moslashtirish loyihasi bormi?
2. **Davlat reyestri.** Biometrik yoki genetik ma’lumot bo‘lmasa, klinika bazasini ro‘yxatdan o‘tkazish 20-modda bo‘yicha majburiymi yoki 31-moddadagi umumiy majburiyat hali amal qiladimi? Kim ro‘yxatdan o‘tkazadi: har bir klinikami (mulkdor) yoki Med.uz.ai (operator)?
3. **Vakolatli organ** hozir qaysi: Davlat personallashtirish markazi, IIV Migratsiya va personallashtirish departamenti yoki Adliya vazirligi huzuridagi Personallashtirish agentligi [L1, L3, L13]? Ariza qaysi portal orqali beriladi?
4. **Bemor surati, rentgen va boshqa tibbiy tasvirlar** 26-moddadagi «biometrik ma’lumot» hisoblanadimi? Hisoblansa, ular albatta O‘zbekistonda saqlanishi kerak.
5. **Rozilik shakli.** Davolash uchun 25-moddadagi tibbiy istisno yetarlimi? Ro‘yxatchi, kassir, Telegram va AI uchun yozma yoki elektron rozilik kerakmi? Planshetdagi «belgilash» yoki SMS-kod elektron hujjat sifatida yetarlimi?
6. **Med.uz.ai maqomi.** Uchinchi shaxs yoki operator. Klinika bilan qanday shartnoma kerak?
7. **AI va Telegram.**
   - Anthropic (AQSh) EU-US DPF ishtirokchisimi? Aks holda bemor matnini yuborishga qaysi asos qo‘llanadi?
   - Telegram serverlari qaysi davlatda va u 415-son qaror ro‘yxatiga kiradimi?
   - Standart shartnoma shartlari (SCC) tasdiqlanganmi? 415-son qarorga ko‘ra 3 oy ichida, ya’ni taxminan 2026-yil noyabrigacha tasdiqlanishi kerak edi [L3].
8. **Tibbiy hujjatlarni saqlash muddati.** Ambulator karta, kasallik tarixi va laboratoriya natijalari elektron shaklda necha yil saqlanadi? Qaysi Sog‘liqni saqlash vazirligi buyrug‘i amal qiladi? Topilmadi.
9. **Ma’lumotlar sizib chiqishi** haqida umumiy (transchegaraviy bo‘lmagan) xabar berish majburiyati bormi?
10. **DMED integratsiyasi.** Litsenziya shartining aniq matni qanday? 570-son qaror bo‘yicha Toshkent uchun 10.12.2025 dan, farmon bo‘yicha 01.04.2027 gacha [L9, L10]. Klinika qaysi ma’lumotlarni real vaqtda uzatishi kerak? Med.uz.ai qaysi API’ga ulanadi (Uzinfocom)?
11. **Kiberxavfsizlik qonuni.** Xususiy klinika tizimi «muhim axborot infratuzilmasi obyekti» bo‘lishi mumkinmi va majburiy ekspertiza kerakmi [L16]?

### Provayder bilan aniqlashtirish kerak

1. Joriy narxlar va **QQS**. Uztelecom narx sahifasida sana yo‘q. VM o‘chirilganda billing davom etadimi (manbalar bir-biriga zid)?
2. **DC manzili va sertifikatlar**: Uptime Tier III Constructed yoki faqat Design, ISO 27001 sertifikati nusxasi. VM va S3 aniq qaysi DC’da?
3. **S3 boshqa shaharda bo‘ladimi** (Buxoro yoki Qo‘qon)? S3 uchun versioning yoki object lock bormi, server tomonda shifrlash bormi?
4. **Managed PostgreSQL** bormi yoki rejalashtirilganmi?
5. **Shartnoma shartlari:** SLA, javob vaqti, ma’lumot egaligi, shartnoma tugaganda ma’lumotni o‘chirish, provayder xodimlarining kirish huquqi va ma’lumotlarga ishlov berish bo‘yicha qo‘shimcha kelishuv.
6. **Chet el ishtirokidagi MChJ** yoki xorijiy kompaniya buyurtma bera oladimi? To‘lov faqat so‘mdami?
7. **Let’s Encrypt (ACME)** va 80/443 portlar ochiqmi? Statik IPv4 beriladimi? TAS-IX va xalqaro kanal tezligi qancha?

---

## Manbalar

Barcha havolalar 2026-10-20 da ochildi. Qavs ichida manbaning e’lon sanasi yoki holati ko‘rsatilgan.

**Qonunchilik**
- [L1] «Shaxsga doir ma’lumotlar to‘g‘risida»gi Qonun O‘RQ-547, joriy tahrir (12.09.2026 gacha o‘zgartirishlar bilan), lex.uz: https://lex.uz/uz/docs/-4396419
- [L2] O‘RQ-1125, 26.03.2026, «Shaxsga doir ma’lumotlar to‘g‘risida»gi Qonunga o‘zgartirishlar (kuchga kirgan: 27.03.2026): https://lex.uz/uz/docs/-8099215
- [L3] Vazirlar Mahkamasining 29.07.2026 dagi 415-son qarori, bir xil himoya ta’minlovchi chet davlatlar ro‘yxati (kuchga kirgan: 03.08.2026): https://lex.uz/uz/docs/8369688
- [L4] Spot.uz, «O‘zbekiston shaxsiy ma’lumotlarni erkin uzatish mumkin bo‘lgan davlatlarni tasdiqladi» (04.08.2026): https://www.spot.uz/oz/2026/08/04/personal-data-abroad/
- [L5] Vakhidov & Partners, Legal 500, «Amendments and Additions Introduced to the Law “On Personal Data”» (15.05.2026): https://www.legal500.com/developments/thought-leadership/legislative-updates-in-the-field-of-artificial-intelligence-and-personal-data-regulation-uzbekistan/
- [L6] Ma’muriy javobgarlik to‘g‘risidagi kodeks, 46-2-modda (O‘RQ-726 va O‘RQ-1115 tahrirlari), lex.uz: https://lex.uz/uz/docs/-97664
- [L7] Jinoyat kodeksi, 141-2-modda (O‘RQ-726 tahriri, 31.01.2022 dan), lex.uz: https://lex.uz/uz/docs/-111453
- [L8] Buxgalter.uz, «2026 yilda O‘zbekistonda BHM, MHEKM, PHBM va MIX miqdorlari» (BHM 440 000 so‘m, 01.09.2026 dan; rasmiy hujjat tekshirilmadi): https://buxgalter.uz/oz/publish/doc/text194589_uzbekistonda_bhm_mhekm_phbm_va_mih_miqdorlari
- [L9] Vazirlar Mahkamasining 08.09.2025 dagi 570-son qarori, «Sog‘liqni saqlash tizimini raqamlashtirish jarayonlarini yanada jadallashtirish bo‘yicha qo‘shimcha chora-tadbirlar to‘g‘risida»: https://lex.uz/uz/docs/-7723519
- [L10] Kun.uz, «Uzbekistan to tighten oversight of medical clinics and introduce new accreditation requirements» (06.05.2026; farmon raqami ko‘rsatilmagan): https://kun.uz/en/68152247
- [L11] Mondaq, «The law on personal data has been amended» (2021): https://mondaq.com/data-protection/1197754/the-law-on-personal-data-has-been-amended
- [L12] Kun.uz, «Uzbekistan strengthens liability for breaching the law On Personal Data» (31.10.2021): https://kun.uz/en/news/2021/10/31/uzbekistan-strengthens-liability-for-breaching-the-law-on-personal-data
- [L13] gov.uz, Adliya vazirligi huzuridagi Personallashtirish agentligi sahifasi (2025–2026): https://gov.uz/oz/dpm/pages/about
- [L14] Kun.uz, «Shaxsga doir ma’lumotlar bazalarining davlat reyestri qanday shakllantiriladi» (10.02.2020): https://kun.uz/kr/news/2020/02/10/shaxsga-doir-malumotlar-bazalarining-davlat-reyestri-qanday-shakllantiriladi; Vazirlar Mahkamasining 71-son qarori (08.02.2020): https://lex.uz/docs/-4729730
- [L15] Kun.uz, «Experts urge Uzbekistan to revise data localization rules to support innovation» (22.07.2025): https://ad.kun.uz/en/news/2025/07/22/experts-urge-uzbekistan-to-revise-data-localization-rules-to-support-innovation
- [L16] «Kiberxavfsizlik to‘g‘risida»gi Qonun O‘RQ-764 (2022), qisqacha bayon: https://regulations.ai/regulations/RAI-UZ-NA-ZRU7640-2022; Spot.uz (18.04.2022): https://www.spot.uz/oz/2022/04/18/cyber-secu/
- [L17] GRATA International, «Electronic Prescription in Uzbekistan: Legal Regulation and Market Transformation» (07.08.2026): https://gratanet.com/publications/electronic-prescription-in-uzbekistan-legal-regulation-and-market-transformation
- [L18] DMED rasmiy sayti (sana ko‘rsatilmagan): https://dmed.uz/en

**Provayderlar**
- [P1] UZTELECOM Cloud hujjatlari, «Payment», narxlar jadvali (sana ko‘rsatilmagan): https://docs.app.uztelecom.uz/en/userguide/payment
- [P2] Uztelecom, Colocation sahifasi (sana ko‘rsatilmagan): https://uztelecom.uz/en/for-operators/colocation
- [P3] Raqamli texnologiyalar vazirligi, Uztelecom Buxoro va Qo‘qonda DC ochdi (22.09.2026): https://gov.uz/oz/digital/news/view/222857
- [P4] Spot.uz, Uztelecom UzCloud (22.09.2026): https://www.spot.uz/ru/2026/09/22/uztelecom-uzcloud/
- [P5] Spot.uz, UZTELECOM Cloud (24.04.2025, reklama materiali): https://www.spot.uz/ru/2025/04/24/uztelecom-cloud/
- [P6] Uztelecom (uzdc.uz), Web hosting: Let’s Encrypt va «Tier-III data center» (sana ko‘rsatilmagan): https://uzdc.uz/en/services/web-hosting
- [P7] Pro-Data, bosh sahifa: https://www.pro-data.tech/en; VPS sahifasi: https://www.pro-data.tech/en/virtual-server; narxlar ro‘yxati PDF (18.08.2025): https://docs.storage.pro-data.tech/Preyskurant_UZ.Pdf. Eslatma: PDF matnidan narxlarni nomlarga moslash sahifadagi tartib bo‘yicha qilingan, provayderdan tasdiqlatish kerak.
- [P8] Servercore, «About us»: https://servercore.com/about-us/; PostgreSQL: https://servercore.com/services/cloud-databases/cloud-databases-postgresql/
- [P9] Serverspace, VPS in Uzbekistan: https://serverspace.us/services/vps-server/vps-in-uzbekistan/; East Telecom YA DC: https://serverspace.io/infrastructure/data-senter-tashkent/
- [P10] Beeline Cloud (fortifai.uz), huquqiy sahifa: https://fortifai.uz/en/legal; UNITEL ommaviy ofertasi (PDF): https://fortifai.uz/media/uploads/Public_Offer_Nutanix.pdf
- [P11] Beeline Uzbekistan va DataVolt hamkorligi (17.06.2026): https://beeline.uz/en/events/news/partnerstvo-v-sfere-data-centrov
- [P12] ahost.uz, VDS: https://www.ahost.uz/vds
- [P13] hostmaster.uz: https://hostmaster.uz; VDS tariflari: https://hostmaster.uz/vds/tariffs
- [P14] TCloud.uz: https://tcloud.uz/en
- [P15] Uzinfocom: https://uzinfocom.uz; Data Center Map: https://www.datacentermap.com/uzbekistan/tashkent/datacenter-uzinfocom/
- [P16] Sarkor: https://sarkor.uz; Golden Pages: https://www.goldenpages.uz/en/company/?Id=672
- [P17] East Telecom DC (ETC Xpeed, sahifa 2023–2024 yillarga oid bo‘lishi mumkin): https://etc-xpeed.tps.uz/en/novosti/test; Data Center Map: https://www.datacentermap.com/uzbekistan/tashkent/etc-xpeed-yunusabad/
- [P18] O‘zbekiston Respublikasi Markaziy banki, USD kursi 20.10.2026 (12 044.72 so‘m): https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/

**Tarmoq va TLS**
- [T1] Let’s Encrypt Community, «SSL doesn’t resolve only in Uzbekistan» (2018): https://community.letsencrypt.org/t/ssl-doesnt-resolve-only-in-uzbekistan/60699
- [T2] Data Center Map, TAS-IX: https://www.datacentermap.com/ixp/tas-ix/
- [T3] Kun.uz, «Websites in the TAS-IX zone become temporarily inaccessible without VPN» (19.07.2019): https://kun.uz/en/news/2019/07/19/websites-in-the-tas-ix-zone-become-temporarily-inaccessible-without-vpn
