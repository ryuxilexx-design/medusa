# MEDUZA — ertangi namoyish MVP’si uchun texnik topshiriq

**Versiya:** 1.0 · **Tuzilgan sana:** 17-oktabr 2026 · **Namoyish:** 18-oktabr 2026, Asia/Tashkent  
**Maqsad:** ko‘p tarmoqli xususiy klinika vakillariga Meduza’ning qiymatini ishlaydigan, o‘zaro bog‘langan demo orqali ko‘rsatish.  
**Hujjat holati:** ishlab chiqish uchun boshlang‘ich TZ. Klinikaga xos noma’lum talablar quyida taxmin sifatida belgilangan. Bu hajmning bir kunda to‘liq bajarilishi mavjud kod va jamoaga bog‘liq; bajarish navbati va qisqartirish qoidalari 20-bo‘limda.

## 1. Mahsulot va uchrashuv natijasi

**Meduza — bemor, xodim, xizmat va moliyani bir jarayonda boshqaradigan, klinikaga mos sozlanadigan platforma.**

Uzoq muddatli yo‘nalish — turli hajm va mutaxassislikdagi klinikalar uchun modulli SaaS. Ertangi namoyish nishoni — ambulator qabul, laboratoriya va UZI xizmatlari bor ko‘p tarmoqli xususiy klinika. Stomatologiya odontogrammasi, statsionar, operatsion blok kabi maxsus jarayonlar ushbu demo bilan qoplangan hisoblanmaydi.

Uchrashuvdan keyin klinika rahbari quyidagilarni tushunishi kerak:

1. Registrator, shifokor, laboratoriya va kassir bitta ma’lumot bilan ishlaydi.
2. Xodimning ekrani uning vazifasiga mos; keraksiz bo‘limlar ishini murakkablashtirmaydi.
3. Bemorning tashriflari, xizmatlari, natijalari va hisoblari bir joyda bog‘lanadi.
4. Rahbar ko‘rsatkichdan uning asosidagi yozuvlargacha kirib tekshira oladi.
5. Xizmat, narx, jadval va hujjat shablonlari klinikaga moslanadi.
6. AI aniq takroriy vazifada yordam beradi; uning loyihasini inson tekshiradi.

**Raqobatdagi pozitsiya:** MedPlus va DMED’dan ustunlik haqidagi tekshirilmagan da’volar ishlatilmaydi. Sotuvda Meduza’ning o‘zida ko‘rsatilgan qulaylik, jarayonlar bog‘liqligi, shaffof hisobot va moslashuvchanlik dalil bo‘ladi. Oldingi chatda tilga olingan MedPlus videolarining asl fayllari bu TZ tuzilayotganda ko‘rilmagan; avvalgi tahlil mustaqil tasdiqlangan fakt emas.

## 2. Qabul qilingan taxminlar va demo chegarasi

| Masala | Ushbu TZ uchun qaror |
|---|---|
| Mahsulot nomi | Barcha ekran, sarlavha va eksportlarda Meduza; Clinic OS eski nom sifatida qolmaydi |
| Klinikaga oid ma’lumot | Haqiqiy nom va xizmatlar berilmaguncha «Meduza Demo Clinic» |
| Biznes modeli | Multi-tenant SaaS; klinikaning obuna to‘lovi bemorning xizmat to‘lovidan alohida |
| Filiallar | Bitta demo klinika, 2 filial; izolyatsiya tekshiruvi uchun ikkinchi kichik tenant |
| Asosiy til | O‘zbek lotin; to‘liq ruscha tarjima keyingi bosqich. Ishlamaydigan til tugmasi bo‘lmaydi |
| Valyuta | UZS; demo narxlari tijorat taklifi yoki haqiqiy klinika tarifi emas |
| Vaqt | Bazada UTC, ekranda Asia/Tashkent; 24 soatlik format |
| Platforma | Desktop-first web, asosiy namoyish 1366×768 va 1440×900 |
| Ma’lumot | Faqat sintetik; haqiqiy bemor ma’lumoti kiritilmaydi |
| To‘lov | Naqd/karta/o‘tkazma usulini tizimda qayd qilish; bank tranzaksiyasi va fiskal chek integratsiyasi yo‘q |
| Tashqi integratsiyalar | DMED, laboratoriya apparatlari, SMS, Telegram, Payme/Click — ushbu relizga kirmaydi |
| AI | Haqiqiy ulanish bo‘lsa ishlatiladi; bo‘lmasa «Namunaviy natija» deb ochiq belgilangan ssenariy |
| Hosting | Namoyish noutbukda lokal ishlay oladi; internet AI uchun zarur bo‘lishi mumkin |
| Klinikaning ochilish muddati | Noma’lum; ertangi demo sanasi production ishga tushirish sanasi emas |

## 3. Ustuvorlik va bajarilganlik belgilari

- **P0 — namoyishning majburiy ishlaydigan yadrosi.** Yangi yozuvlar yaratiladi, holatlar o‘zgaradi, bog‘langan ekranlar yangilanadi va ma’lumot refreshdan keyin saqlanadi.
- **P1 — keng mahsulot ko‘lamini ko‘rsatadigan modullar.** Izchil seed data, ishlaydigan ro‘yxat/filtr/tafsilotlar va quyida ko‘rsatilgan kichik amallar. Bu modullarning to‘liq ishlab chiqarish darajasidagi avtomatlashtirishi va’da qilinmaydi.
- **P2 — keyingi reliz.** Demo menyusida ishlaydigan funksiya kabi ko‘rsatilmaydi; roadmapda beriladi.

Har bir ekran va imkoniyat release ro‘yxatida `Ishlaydi`, `Demo ma’lumoti`, `Namunaviy AI`, `Rejada` holatlaridan biriga ega. Seed data mavjudligi funksiyani avtomatik ravishda «Ishlaydi» qilmaydi.

**P0 tarkibi:** demo kirish/rollar, filial filtri, bemorlar, jadval, navbat, shifokor qabuli, bazaviy tahlil buyurtmasi va natijasi, hisob/to‘lov, bog‘langan dashboard, print, seed/reset, auditning minimal qismi.

**P1 tarkibi:** UZI shabloni, ombor, shifokor ulushi, kengroq analitika, hujjat shablonini sozlash, AI, ikkinchi filial tafsilotlari. AI namoyishdagi muhim qism, lekin uning nosozligi P0 jarayonini to‘xtatmasligi kerak.

## 4. Rollar va kirish huquqlari

Demo kirish sahifasida 5 ta rol kartasi bo‘ladi: **Rahbar**, **Registrator**, **Shifokor**, **Kassir**, **Laboratoriya**. Kartalar faqat lokal yoki yopiq demo muhitida serverdagi seed akkauntga kiradi. Rol almashtirish server sessiyasini almashtiradi; faqat menyuni yashirish ruxsat himoyasi hisoblanmaydi.

| Amal | Rahbar | Registrator | Shifokor | Kassir | Laboratoriya |
|---|---|---|---|---|---|
| Bemorning asosiy ma’lumotlari | Ha | Yaratish/tahrirlash | Biriktirilgan bemorlar | To‘lov uchun minimum | Buyurtma uchun minimum |
| Qabul va navbat | Ko‘rish | Boshqarish | O‘z qabullari | Zarur holatni ko‘rish | Yo‘q |
| Klinik yozuv | Odatiy kirish yo‘q | Yo‘q | O‘z qabulida yaratish/tasdiqlash | Yo‘q | Yo‘q |
| Laboratoriya natijasi | Agregat holatlar | Tayyor/tayyor emas | Tegishli bemorda ko‘rish | Yo‘q | Kiritish/tasdiqlash |
| Hisob yaratish | Ha | Xizmatlardan yaratish | Xizmat buyurtmasi | Ha | Yo‘q |
| To‘lov qayd qilish | Kuzatish | Yo‘q | Yo‘q | Ha | Yo‘q |
| Chegirma | Tasdiqlash | So‘rash | Yo‘q | Tasdiqlanganini qo‘llash | Yo‘q |
| Moliya va hisobot | Barcha ruxsatli filiallar | Yo‘q | Faqat o‘z faoliyati | O‘z smenasi | Yo‘q |
| Sozlamalar/xodimlar | Ha | Yo‘q | Yo‘q | Yo‘q | Yo‘q |
| Audit | Ruxsatli klinika doirasida | Yo‘q | Yo‘q | Yo‘q | Yo‘q |

Demo laboratoriya akkaunti natijani tasdiqlash vakolatiga ham ega. Kelgusida texnik va tasdiqlovchi mutaxassis alohida ajratilishi mumkin. Rahbarlikning o‘zi tibbiy yozuvlarni o‘qish huquqini bermaydi.

## 5. Navigatsiya va umumiy interfeys

### 5.1. Tuzilma

Chap menyu rolga qarab: **Umumiy ko‘rinish · Bemorlar · Qabul jadvali · Navbat · Shifokor kabineti · Laboratoriya · Diagnostika · Kassa · Moliya · Xodimlar · Ombor · Hisobotlar · Sozlamalar**.

Yuqori panel: Meduza belgisi, klinika nomi, ruxsatli filial tanlovi, joriy sana, qidiruv, foydalanuvchi/rol. Doimiy kichik belgi: **«Demo muhit · Sun’iy ma’lumotlar»**. AI tugmasi faqat tegishli ish joyida ko‘rsatiladi.

### 5.2. Vizual va xulqiy qoidalar

- Oq/och fon, to‘q matn, bitta asosiy teal/ko‘k rang; qizil xato, sariq kutilmoqda, yashil yakunlangan holat uchun.
- Status faqat rang bilan ifodalanmaydi; matn va kerak bo‘lsa ikonka ham bo‘ladi.
- Jadvalda muhim ustunlar birinchi: bemor, vaqt, mas’ul, xizmat, status, amal. 1366 px’da asosiy amal ko‘rinadi.
- Ro‘yxatlar: 20 tadan sahifalash; qidiruv/filtrdan keyin birinchi sahifaga qaytish; topilgan son ko‘rinadi.
- Qidiruv yozishda 250–350 ms kechikish; bo‘sh qidiruv ro‘yxatni tiklaydi. Telefon qidiruvida bo‘sh joy va `+` normallashtiriladi.
- Asosiy amal tugmasi saqlash paytida bloklanadi. Muvaffaqiyat/xato xabari beriladi; texnik stack trace foydalanuvchiga chiqmaydi.
- Modal Esc bilan yopiladi; saqlanmagan o‘zgarishlar bo‘lsa chiqish tasdiqlanadi. Tab orqali boshqarish, maydon label va ko‘rinadigan fokus bo‘ladi.
- Loading skeleti, bo‘sh holat va qayta urinish tugmali xato holati har bir ma’lumotli ekranda bor.
- Grafik yoki raqam ustiga bosish tegishli filtrlangan ro‘yxatni ochadi. Bog‘lanmagan grafik interaktiv deb ko‘rsatilmaydi.
- Tugma ishlamasa yashiriladi yoki «Keyingi reliz» izohi bilan disabled bo‘ladi; hech narsa qilmaydigan aktiv tugma bo‘lmaydi.
- Matnlar: «Bemor qo‘shish», «Qabulga yozish», «Qabulni boshlash», «Natijani tasdiqlash», «To‘lovni qayd qilish» kabi aniq fe’llar.
- Mobil qurilmada kamida menyu, KPI va bemor profili buzilmasdan ochiladi; to‘liq mobil workflow ertangi qabul sharti emas.

## 6. Ekranlar va funksional talablar

### M-01. Kirish va demo boshqaruvi — P0

Rol kartasidan kirish, joriy foydalanuvchini ko‘rish, chiqish. Demo boshqaruvi faqat vakolatli foydalanuvchida: **«Demo ma’lumotlarini tiklash»**. Resetdan oldin «Joriy demo o‘zgarishlari o‘chadi» tasdig‘i; muvaffaqiyatdan keyin ro‘yxatlar va sessiya konteksti yangilanadi. Production muhitda demo kirish va reset endpointlari yoqilmaydi.

### M-02. Rahbar dashboardi — P0

Filtrlar: Bugun / Oxirgi 7 kun / Oxirgi 30 kun / sana oralig‘i; filial. KPI: qabullar, kelgan bemorlar, yakunlangan qabullar, qayd etilgan tushum, qarzdorlik. Pastki qism: kunlik tushum grafigi, xizmatlar bo‘yicha summa, shifokor bandligi, so‘nggi to‘lovlar, e’tibor talab qiladigan holatlar.

E’tibor holatlari: to‘lanmagan hisob, tasdiqlanmagan natija, kam qolgan material (P1). Har biri tegishli ro‘yxatga olib boradi. Bo‘sh davr uchun grafikda sun’iy raqam chizilmaydi. Xarajat va sof natija faqat xarajat registri ishlaganda P1 sifatida ko‘rsatiladi; tushum «sof foyda» deb nomlanmaydi.

### M-03. Bemorlar ro‘yxati va yaratish — P0

Ustunlar: ID, F.I.Sh., tug‘ilgan sana/yosh, telefon, oxirgi tashrif, keyingi qabul. Amallar: profil, qabulga yozish, asosiy ma’lumotni tahrirlash.

Forma:

| Maydon | Qoida |
|---|---|
| Familiya va ism | Majburiy, trim, har biri 2–80 belgi; faqat lotin harflari bilan cheklanmaydi |
| Otasining ismi | Ixtiyoriy |
| Tug‘ilgan sana | Majburiy; kelajak sanasi mumkin emas; yosh dinamik hisoblanadi |
| Jins | Tanlov, «Ko‘rsatilmagan» mumkin |
| Telefon | Ixtiyoriy; kiritilsa +998 va 9 raqamga normallashtirish; telefon yo‘qligi bemorni yaratishni to‘xtatmaydi |
| Aloqa vakili | Voyaga yetmagan yoki alohida aloqa zarur holatda ism/telefon; ixtiyoriy |
| Manzil | Ixtiyoriy |
| Izoh | Ixtiyoriy; bu maydonga klinik xulosa yozish tavsiya qilinmaydi |
| Bemor raqami | Server tomonidan avtomatik; tenant ichida unikal |

Bir xil telefon yoki F.I.Sh. + tug‘ilgan sana bo‘lsa dublikat ogohlantirishi va mavjud profilga o‘tish. Oilaviy umumiy telefon mumkin; telefon global unique emas. Baribir yaratish alohida tasdiq bilan. Yaratilgan bemorga yangi qabul oynasi ochilishi mumkin. Demo yangi yozuvlar auditga tushadi.

### M-04. Bemor profili — P0

Yuqori qism: F.I.Sh., ID, yosh, aloqa, yangi qabul tugmasi. Tablar rolga mos: **Umumiy · Tashriflar · Klinik yozuvlar · Tahlillar/diagnostika · Hisoblar · Hujjatlar**.

Timeline sanaga teskari tartibda; yozuvdan o‘sha qabul/natija/hisobga o‘tish. Shifokor uchun allergiya holati: «Ma’lum allergiya qayd etilgan», «Bemor inkor etadi», «Ma’lumot kiritilmagan» farqlanadi. Bo‘sh qiymat «Allergiyasi yo‘q»ga aylantirilmaydi. Klinika hisoblari va klinik hujjatlar alohida huquqlar bilan ko‘rinadi.

### M-05. Qabul jadvali — P0

Kunlik jadval, shifokor/filial/status filtri; haftalik ko‘rinish P1. Qabul kartasida vaqt, bemor, xizmat va holat. Bo‘sh slotdan yoki «Qabulga yozish» orqali forma ochiladi.

Forma: mavjud/yangi bemor, filial, shifokor, xizmat, sana, boshlanish vaqti, davomiylik, xona (mavjud bo‘lsa), qisqa izoh. Davomiylik xizmatdan olinadi; o‘zgartirish vakolatli rolda. Shifokor shu filial va xizmat bilan bog‘langan bo‘lishi kerak.

Saqlashda server jadval, tanaffus, ish vaqti va vaqt to‘qnashuvini tekshiradi. Band slotga ikki parallel so‘rovdan faqat bittasi o‘tadi. Xona biriktirilgan bo‘lsa uning bandligi ham tekshiriladi. Ko‘chirish mavjud yozuvni yangilaydi; yangi dublikat yaratmaydi. Drag-and-drop P2; ertaga forma orqali ko‘chirish yetarli.

### M-06. Jonli navbat — P0

Filial va shifokor kesimi; bemor, navbat raqami, kelgan vaqt, kutish davomiyligi, holat. Registrator «Keldi», shifokor «Qabulni boshlash» va «Yakunlash» amallarini bajaradi. Navbat raqami filial + mahalliy kun doirasida takrorlanmaydi. «Keldi» ikki marta bosilsa ikkinchi navbat yaratilmaydi. Sana almashsa raqamlash yangilanadi.

Navbat 10–15 soniyalik polling yoki amal yakunida qayta yuklash orqali yangilanadi; WebSocket shart emas. Jamoat monitori P2; ichki navbat ekranidagi ma’lumotni ommaviy ekranga avtomatik chiqarilmaydi.

### M-07. Shifokor kabineti va qabul — P0

Chapda bugungi bemorlar; markazda tanlangan qabul; yon panelda tarix. «Qabulni boshlash» mavjud yoki yangi encounter ochadi. Bemor, sana, shifokor va xizmat avtomatik olinadi.

Maydonlar: shikoyatlar, anamnez, ko‘rik, tashxis matni, tavsiyalar, qayta qabul sanasi. Bosim/puls/harorat kabi ko‘rsatkichlar ixtiyoriy, birliklari ko‘rinadi. Bo‘sh klinik qiymatlar avtomatik to‘ldirilmaydi.

Amallar: **Qoralamani saqlash · AI bilan tartiblash (P1) · Tekshiruv buyurish · Ko‘rib chiqish · Tasdiqlash va yakunlash · Chop etish**.

- Qoralama saqlanganda vaqt ko‘rinadi. Autosave bo‘lmasa «Avtomatik saqlanadi» yozilmaydi.
- Yakunlash uchun shikoyat, ko‘rik, tashxis/xulosa va tavsiya maydonlari to‘ldiriladi; bu demo forma qoidasi, universal klinik standart emas.
- Tasdiqlangan yozuv oddiy tahrirlanmaydi. P1 tuzatish alohida versiya, sabab, muallif va vaqt bilan; vaqt yetmasa tuzatish tugmasi berilmaydi.
- Oldingi qabul matni yangi qabulga yashirin ko‘chirilmaydi.
- To‘lov yo‘qligi ruxsatli shifokorning klinik tarixni o‘qishini bloklamaydi.
- Tekshiruv buyurtmasi qabul tugagandan keyin ham alohida statusda davom etishi mumkin.

### M-08. Laboratoriya — bazaviy P0

Shifokor katalogdan tahlil tanlaydi. Buyurtmada bemor, encounter, shifokor, tahlil, narx snapshoti va vaqt saqlanadi. U laboratoriya ro‘yxati va hisobdagi tegishli xizmat bilan bog‘lanadi; bir buyurtma ikki marta hisoblanmaydi.

Ro‘yxat filtrlari: sana, filial, status, bemor. Amallar: **Namuna olindi → Natijani kiritish → Qoralama saqlash → Tasdiqlash**. Bir demo tahlil shabloni yetarli: parametr, qiymat, birlik, namuna uchun referens oralig‘i. Referenslar klinik foydalanishga tekshirilgan deb taqdim etilmaydi.

Faqat tasdiqlangan natija shifokor kartasida «Tasdiqlangan» sifatida ko‘rinadi. Tasdiqlovchi va vaqt saqlanadi. Natija o‘zi tashxis chiqarmaydi. Printda bemor ID, buyurtma, parametrlar va tasdiq holati bo‘ladi. Apparat integratsiyasi va barcode printer P2.

### M-09. UZI / diagnostika — P1

Seed buyurtmalar ro‘yxati va tafsiloti. Bitta UZI shabloni: tekshiruv turi, tavsif, xulosa, mutaxassis, sana. Qoralama/tasdiqlangan statuslar; brauzer printi. DICOM/PACS, tasvir tahlili va apparatdan import P2. Rasmlar yuklash amalga oshirilmasa aktiv upload tugmasi bo‘lmaydi.

### M-10. Kassa — P0

Hisoblar ro‘yxati: bemor, hisob ID, xizmatlar, jami, to‘langan, qoldiq, holat. Filtrlar: sana, filial, holat, bemor. Tafsilotda har bir xizmat miqdori va narxi ko‘rinadi.

Hisobga qabul xizmati avtomatik bir marta kiritiladi; qo‘shimcha buyurtma tegishli ochiq hisobga qo‘shiladi. Hisob allaqachon to‘langan bo‘lsa yangi xizmat uchun alohida hisob ochiladi. Eski narxlar katalog o‘zgarganda o‘zgarmaydi.

To‘lov formasi: hisob, qoldiq, summa, usul, izoh; kassir va vaqt serverdan. To‘liq yoki qisman to‘lash mumkin; ikki usulda to‘lash ketma-ket ikki yozuv bilan. Summa > 0 va qoldiqdan oshmasligi shart; ortiqcha to‘lov/depozit bu relizga kirmaydi.

Chegirma: P0’da rahbar ruxsati va majburiy sabab; 0–100% yoki aniq summa, bir vaqtda bittasi. To‘lov qayd etilgandan keyin ushbu demoda hisob narxi/chegirmasi tahrirlanmaydi. To‘lovni qayta yuborish bir xil idempotency kalitida bitta natija beradi.

To‘lovdan keyin hisob, bemor profili va rahbar KPI yangilanadi. Chop etiladigan hujjat **«Ichki to‘lov qaydi — fiskal chek emas»** deb nomlanadi. To‘lovni o‘chirish yo‘q. Qaytarish P1: rahbar tasdig‘i, asl to‘lovga bog‘liqlik, sabab, qaytarish mumkin bo‘lgan qoldiq tekshiruvi; amalga oshirilmasa faol tugma yo‘q.

### M-11. Moliya va hisobotlar — P0/P1

P0: to‘lovlar registri, qarzdor hisoblar, xizmatlar va shifokorlar kesimida ro‘yxat; sana/filial filtrlari. Qarzdorlik summasidan tegishli hisoblar ochiladi. P1: xarajatlar registri, CSV eksport, to‘lov usullari kesimi, smena ochish/yopish va kutilgan/amalda sanalgan naqd farqi.

Hisobotlarda «xizmatlar qiymati», «qayd etilgan tushum» va «hisoblangan shifokor ulushi» aralashtirilmaydi. CSV bo‘lsa jadvaldagi faol filtrga mos eksport; foydalanuvchi kiritgan `=`, `+`, `-`, `@` bilan boshlanuvchi matnlar formula sifatida ishga tushmasligi ta’minlanadi.

### M-12. Xodimlar va shifokor ulushi — P1

8 shifokor va ma’muriy xodimlar: F.I.Sh., mutaxassislik, filial, rol, jadval, faol/nofaol. Tafsilotda bugungi qabullar, bajarilgan xizmatlar va demo hisoblangan ulush. Bir xil shifokor ikki filialda bir vaqtda band bo‘la olmaydi.

Demo ulushi: bajarilgan xizmatning chegirmadan keyingi qiymati × xizmat bajarilgan vaqtdagi foiz snapshoti. «Hisoblangan ulush» deb belgilanadi; to‘langan maosh yoki to‘liq payroll emas. Soliq, avans, murakkab bonus va ish haqi vedomosti P2.

### M-13. Ombor — P1

20 ta sintetik material: nom, birlik, boshlang‘ich qoldiq, kirim, chiqim, joriy qoldiq, minimum. Qoldiq = boshlang‘ich + kirim − chiqim. Kam qolganlar alohida filtr bilan. Tafsilotda harakatlar tarixi.

Vaqt yetganda «Kirim» va «Chiqim» kichik formasi: miqdor > 0, sabab, mas’ul, sana; mavjud qoldiqdan ko‘p chiqim bloklanadi. Xizmat bajarilganda material avtomatik yechilishi P2; seed harakatlar bunday integratsiya ishlayotgandek taqdim etilmaydi. Partiya, yaroqlilik, inventarizatsiya P2.

### M-14. Sozlamalar — bazaviy P0, qolgan P1

P0: klinika nomi, filiallar va xizmat katalogini ko‘rish; xizmat nomi/narxi/davomiyligini rahbar tomonidan tahrirlash. Narx o‘zgarishi kelgusi buyurtmalarga ta’sir qiladi. Tarixiy hisobda snapshot saqlanadi. Foydalanilgan xizmatni o‘chirish o‘rniga nofaol qilish.

P1: shifokor jadvali, xona biriktirish, klinika logotipi, shablon maydonlari va modul ko‘rinishi. Modulni yashirish eski ma’lumotni o‘chirmaydi. Erkin no-code form builder, custom permission editor va tariflar billing’i P2.

## 7. AI — aniq chegaralangan ikki ssenariy

### AI-01. Shifokor qaydini tartiblash — P1, asosiy AI namoyishi

Kirish: shifokor kiritgan matn. Chiqish: shikoyat, anamnez, ko‘rik, xulosa/tashxis va tavsiyalar uchun loyiha. AI faqat berilgan ma’lumotni qayta tartiblaydi; yangi tashxis, dori, doza yoki yo‘q klinik faktni qo‘shmaydi. Yetishmayotgan bo‘lim «Kiritilmagan» bo‘lib qoladi.

UI: asl matn va loyiha yonma-yon; **«Loyihani formaga qo‘llash»**, **«Bekor qilish»**. Qo‘llash faqat qoralamani yangilaydi, qabulni yakunlamaydi. Yorliq: **«AI loyihasi — shifokor tekshirishi kerak»**.

Ishlash rejimlari:

- `live`: server orqali haqiqiy model chaqiriladi; timeout, xato va qayta urinish bor.
- `sample`: faqat tayyor demo matni uchun oldindan yozilgan natija; «Namunaviy AI natijasi» belgisi. Ixtiyoriy yangi matnga tayyor javobni sun’iy moslashtirib qaytarmaydi.
- `off`: tugma disabled va sabab ko‘rinadi.

API kaliti frontendga yuborilmaydi. Demo chaqiruvga F.I.Sh./telefon kabi identifikatorlar kerak emas. AI javobi HTML sifatida bajarilmaydi. Xato yoki 20 soniyalik timeoutda asl qoralama saqlanadi, qo‘lda davom etish mumkin.

### AI-02. Rahbar analitik yordamchisi — P1, vaqt qolsa

3 ta tayyor savol: «Bugungi tushum qancha?», «Qaysi xizmatlar ko‘proq summa berdi?», «Qarzdor hisoblar nechta?». Javobdagi raqamlar backend hisob-kitobidan olinadi; AI faqat izohlaydi. Sana, filial va tegishli hisobot havolasi ko‘rsatiladi. Ma’lumot yo‘q bo‘lsa raqam uydirilmaydi. Erkin SQL yaratish, barcha bazaga model kirishi va avtomatik moliyaviy amal bajarish yo‘q.

**P2 AI:** ovozdan matn, bemor chatbot’i, avtomatik tashxis, dori tavsiyasi, tasvir diagnostikasi. Oxirgi uchta klinik imkoniyat alohida asoslash va validatsiyasiz roadmap va’dasiga ham aylantirilmaydi.

## 8. Holatlar va biznes qoidalari

| Obyekt | Holatlar va ruxsatli oqim |
|---|---|
| Qabul | `scheduled → arrived → in_progress → completed`; scheduled’dan cancelled/no_show; arrived’dan sabab bilan cancelled |
| Qabulni ko‘chirish | Faqat scheduled; bandlik qayta tekshiriladi; audit yoziladi |
| Klinik yozuv | `draft → signed`; signed qayta yozilmaydi |
| Laboratoriya | `ordered → sample_collected → draft_result → verified`; verified natija oddiy tahrirlanmaydi |
| Hisob | `unpaid → partially_paid → paid`; to‘lovsiz hisob sabab bilan void qilinishi mumkin |
| To‘lov | Append-only qayd; qaytarish bo‘lsa alohida obyekt |
| Xizmat | Faol/nofaol; tarixiy buyurtma va narx snapshoti saqlanadi |

Qabulni bekor qilish pulni avtomatik qaytarmaydi. Bekor qilingan qabulning hisob holati alohida ko‘rib chiqiladi. Natija va klinik hujjatning ochiqligi to‘lov statusi bilan avtomatik bog‘lanmaydi.

Har bir status o‘zgarishi serverda tekshiriladi. Bir ekrandagi eski holatdan amal yuborilsa 409 va yangilash taklifi qaytadi. Client tugmani yashirishi serverdagi tekshiruv o‘rnini bosmaydi.

## 9. Hisoblashlar — barcha ekranlar uchun yagona manba

- **Hisob subtotal:** Σ(miqdor × saqlangan birlik narxi).
- **Yakuniy hisob:** subtotal − ruxsatli chegirma; manfiy bo‘lishi mumkin emas.
- **Sof to‘langan:** qayd etilgan to‘lovlar − tasdiqlangan qaytarishlar (qaytarish moduli bo‘lsa).
- **Qarzdorlik:** max(yakuniy hisob − sof to‘langan, 0), void hisoblar kiritilmaydi.
- **Davr tushumi:** mahalliy sana oralig‘ida qayd etilgan to‘lovlar − shu davrdagi qaytarishlar. Xizmat sanasi bo‘yicha emas, to‘lov vaqti bo‘yicha.
- **Bugungi qabullar:** mahalliy kunda boshlanadigan qabullar; cancelled/no_show holatlari alohida ko‘rsatiladi.
- **Yakunlangan xizmatlar qiymati:** bajarilgan xizmatlar bo‘yicha chegirmadan keyingi summa; naqd tushum bilan teng bo‘lishi shart emas.
- **Bandlik:** bekor qilinmagan band qabul daqiqalari / shifokorning tanaffuslardan tashqari ish daqiqalari. Ish vaqti 0 bo‘lsa «—».
- **Kutish:** hozirgi vaqt − kelgan vaqt; qabul boshlangach kutish qiymati yakuniy saqlanadi.
- **Hisob chegirmasi taqsimoti:** qatorlar subtotaliga proporsional; yaxlitlash qoldig‘i deterministik oxirgi qatorga qo‘shiladi. Xizmat kesimi hisob jamiga teng bo‘lishi kerak.

Pul bazada butun tiyin yoki `NUMERIC(18,2)`; JavaScript floating-point yig‘indisi asosiy moliyaviy haqiqat bo‘lmaydi. Sana filtri boshlanishni qo‘shadigan, keyingi kun boshlanishini chiqaradigan intervalga aylantiriladi. Tushum grafiklari va to‘lovlar registri bir xil filtr va agregatsiya manbasidan foydalanadi.

## 10. Seed data spetsifikatsiyasi

### 10.1. Hajm va tarkib

Seed deterministik bo‘lsin (`seed` qiymati yoki barqaror fixture ID’lari), takror ishga tushganda dublikat yaratmasin. Demo sanasi konfiguratsiya orqali beriladi; ertangi preset: **2026-10-18**. Bugungi ko‘rinishda ma’lumotlar bo‘sh chiqib qolmasligi uchun tarix va kelgusi qabullar shu sanaga nisbatan yaratiladi.

| Obyekt | Asosiy demo klinikadagi son/tarkib |
|---|---|
| Tenant | 1 asosiy klinika; izolyatsiya tekshiruvi uchun yana 1 kichik tenant |
| Filial | Markaziy va Yunusobod, aniq demo yorlig‘i bilan |
| Shifokor | 8; terapevt, kardiolog, nevrolog, pediatr, ginekolog, endokrinolog, UZI, laboratoriya mutaxassisi |
| Boshqa xodimlar | 1 rahbar, 2 registrator, 2 kassir, 1 laboratoriya operatori |
| Xonalar | 8 ta; filial va yo‘nalishga biriktirilgan |
| Xizmat | 30 ta: konsultatsiya, laboratoriya, UZI, muolaja; narx/davomiylik bilan |
| Bemor | 100; turli yosh, qayta keluvchi va yangi; barchasi sun’iy |
| Qabul | 240: demo kunidan oldingi 29 kunda 190, demo kunida 30, keyingi kunlarda 20 |
| Bugungi 30 qabul | 8 scheduled, 7 arrived, 3 in_progress, 10 completed, 1 cancelled, 1 no_show |
| Klinik tarix | Kamida 120 signed yozuv; completed qabullarga mos; davom etayotganlar uchun draft |
| Hisob | 180: 130 paid, 20 partially_paid, 25 unpaid, 5 void; yangi demo amallari bundan tashqari qo‘shiladi |
| To‘lov | Paid/partial hisoblarni aniq qoplaydigan yozuvlar; 3 usul va bir nechta split payment |
| Laboratoriya | 24 buyurtma: 6 ordered, 4 sample_collected, 4 draft_result, 10 verified |
| UZI | 12 buyurtma/xulosa; laboratoriya buyurtmalaridan alohida |
| Ombor | 20 material, kamida 40 harakat, 4 material minimumdan past |
| Xarajatlar — P1 | 12 sintetik yozuv; kategoriya, filial, sana, summa |
| Audit | Kamida 50 bog‘langan voqea; yangi demo amallari ham qo‘shiladi |

Seed telefonlari haqiqiy shaxslar bilan aloqaga chiqish uchun ishlatilmaydi; barcha tashqi xabar jo‘natish o‘chirilgan. Email kerak bo‘lsa `example.test` ishlatiladi. Uchrashuvga tayyorlanayotgan haqiqiy klinika nomi keyin berilsa, demo tashkilot nomi sozlamadan almashtiriladi.

### 10.2. Majburiy demo vaziyatlari

1. Yangi bemor: hali kartasi yo‘q, namoyish davomida yaratiladi.
2. Qayta kelgan bemor: 3 oldingi tashrif, 1 tasdiqlangan tahlil, 1 eski hisob.
3. Bir telefon ishlatadigan ota-ona va bola: dublikat ogohlantirishi ko‘rsatiladi, yaratish asossiz bloklanmaydi.
4. Qisman to‘langan hisob: qoldiq to‘lanadi va KPI o‘zgaradi.
5. Band vaqt: boshqa qabul yaratishga urinishda tushunarli xato.
6. Tahlili kutilayotgan bemor: natija tasdiqlangach shifokor kartasida paydo bo‘ladi.
7. Kam qolgan material: ombor filtri va dashboard ogohlantirishi bir xil qoldiqni ko‘rsatadi.
8. Ruxsatsiz rol: kassir klinik yozuv URL/API’siga kirganda rad etiladi.
9. Ikkinchi filial: filtrlashda tegishli qabul va to‘lovlargina ko‘rinadi.
10. Ikkinchi tenant: boshqa tenant ID’sini yuborib ham uning bemori ochilmaydi.

### 10.3. Seed yaxlitligi

Har bir qabul tegishli tenant, filial, bemor, shifokor va xizmatga bog‘langan. Shifokor jadvallari, yakshanba ish vaqti va tanaffuslar 18-oktabr demo qabullariga mos. In-progress qabulda encounter bor, completed qabulda signed qayd bor. Paid hisobda qarzdorlik 0; partial hisobda 0 < to‘langan < jami; void hisobda demo to‘lovi yo‘q. Verified natijada tasdiqlovchi/vaqt bor. Dashboard uchun alohida hardcoded statistika saqlanmaydi.

## 11. Texnik arxitektura va kod tuzilishi

Oldingi suhbatdagi asos: **Next.js + TypeScript frontend, NestJS backend, PostgreSQL**, modular monolith. Ertangi relizda Redis, mikroservislar, Kubernetes va alohida event bus shart emas. Mavjud kod bo‘lsa avval uning mosligi tekshiriladi; ushbu TZ mavjud ilova allaqachon shu stackda deb hisoblamaydi.

Tavsiya etilgan tuzilma:

```text
meduza/
  apps/web/               # rolga mos interfeyslar
  apps/api/               # server modullari va authorization
  packages/contracts/    # request/response tiplari va validatsiya
  database/migrations/
  database/seed/
  docs/MVP_TZ.md
  docs/DEMO_SCRIPT.md
  docs/DEMO_STATUS.md
  .env.example
  README.md
```

Frontend serverdagi ma’lumotdan ishlaydi. LocalStorage faqat filtr/tema kabi UI afzalliklari uchun; bemor, to‘lov va klinik yozuvning asosiy ombori emas. Mutationdan keyin tegishli cache invalidation qilinadi. Demo rol almashtirilganda oldingi rolning cache ma’lumotlari tozalanadi.

Autentifikatsiya sessiyasi HttpOnly cookie’da; server tenant va rolni ishonchli sessiyadan oladi. Client yuborgan tenant_id vakolat manbai emas. Demo port tashqi tarmoqqa ochilsa autentifikatsiyasiz seed/reset yoki rolga kirish qoldirilmaydi.

## 12. Minimal database modeli

Tenantga tegishli barcha jadvallarda `tenant_id`; UUID ID, yaratilgan/yangilangan vaqt. Bog‘lanishlarda tenant chegarasi composite foreign key yoki ekvivalent yaxlitlik nazorati bilan saqlanadi.

| Jadval | Asosiy maydonlar |
|---|---|
| tenants | id, name, status |
| branches | id, tenant_id, name, timezone |
| users / memberships | global user, tenant membership, role, branch scope, status |
| staff / doctors | membership_id, display_name, specialty, default_share_percent |
| rooms | branch_id, name |
| schedules | doctor_id, branch_id, weekday, start/end, break intervals |
| services | name, category, duration, active |
| service_prices | service_id, branch_id, amount, valid_from |
| patients | patient_number, names, birth_date, sex, phone, contact_person, address |
| appointments | patient_id, doctor_id, branch_id, room_id, service_id, starts/ends_at, status, version |
| queue_tickets | appointment_id, branch_id, local_date, number, arrived_at, started_at |
| encounters | appointment_id, patient_id, doctor_id, status |
| clinical_notes | encounter_id, structured_fields, status, version, signed_by/at |
| allergies | patient_id, recorded_state, substance, note |
| service_orders | encounter_id, patient_id, service_id, price_snapshot, status, ordered_by |
| lab_results | order_id, values_json, status, verified_by/at |
| diagnostic_reports | order_id, template_version, content, status, signed_by/at |
| invoices / invoice_items | patient, branch, status; order_id, quantity, price_snapshot, discount |
| payments | invoice_id, amount, method, cashier_id, paid_at, idempotency_key |
| refunds — P1 | payment_id, amount, reason, approved_by, created_at |
| expenses — P1 | branch_id, category, amount, occurred_at, note |
| inventory_items/movements — P1 | unit, minimum; item_id, type, quantity, reason, actor |
| audit_logs | actor, tenant, branch, action, resource_type/id, occurred_at, request_id |

Constraintlar: `(tenant_id, patient_number)` unique; appointment uchun interval bandligi nazorati; appointment’ga bitta faol queue ticket; order’ga bitta invoice item; payment idempotency kaliti scope ichida unique. Pul/miqdor manfiy bo‘lmasligi CHECK bilan. Qabul/to‘lov yozish tranzaksiyada. Auditga to‘liq klinik matn yoki AI prompt tashlanmaydi.

## 13. Demo API kontrakti

Prefix `/api/v1`. Ro‘yxatlarda `page`, `page_size` (maksimum 100), `search` va modul filtrlari. Javob: `{data, meta}`; xato: `{error: {code, message, fields?}, request_id}`. Mutatsiyalar schema bilan validatsiya qilinadi.

| Modul | Endpointlar |
|---|---|
| Sessiya | `POST /demo/login`, `GET /me`, `POST /logout` |
| Bemor | `GET/POST /patients`, `GET/PATCH /patients/:id`, `GET /patients/:id/history` |
| Jadval | `GET /availability`, `GET/POST /appointments`, `PATCH /appointments/:id` |
| Qabul holati | `POST /appointments/:id/check-in`, `/start`, `/complete`, `/cancel`, `/no-show` |
| Navbat | `GET /queue` |
| Klinik qayd | `GET /encounters/:id`, `PUT /encounters/:id/draft`, `POST /encounters/:id/sign` |
| Buyurtmalar | `POST /encounters/:id/orders`, `GET /orders` |
| Laboratoriya | `POST /orders/:id/collect`, `PUT /orders/:id/result`, `POST /orders/:id/verify` |
| Hisob | `GET /invoices`, `GET /invoices/:id`, `POST /invoices/:id/discount`, `POST /invoices/:id/payments` |
| Dashboard | `GET /dashboard?branch_id=&from=&to=` |
| Sozlamalar | `GET /branches`, `GET /doctors`, `GET /services`, `PATCH /services/:id` |
| AI — P1 | `POST /ai/note-draft`, `POST /ai/report-explanation` |
| Demo reset | `POST /demo/reset`, faqat demo rejimida va vakolatli sessiyada |

`/complete` imzolanmagan qayd bo‘lsa rad etiladi; `/sign` va qabulni yakunlash UI’da bitta oqim bo‘lishi mumkin, serverda izchil tranzaksiya zarur. 201 — yaratildi, 401 — sessiya yo‘q, 403 — amal taqiqlangan, 404 — obyekt mavjud emas yoki boshqa tenantga tegishli, 409 — bandlik/versiya konflikti, 422 — maydon xatosi. To‘lov so‘rovida `Idempotency-Key` majburiy. Ikki kassir bir hisobni to‘layotganda lock/recheck orqali ortiqcha qoplash bloklanadi.

## 14. Chop etish va hujjatlar

P0’da brauzerning print/PDF saqlash imkoniyati yetarli; alohida PDF generator shart emas. Hujjatlar: shifokor xulosasi, tasdiqlangan laboratoriya natijasi, ichki to‘lov qaydi. Printda menyu/tugmalar yo‘q, A4 chetlari va matn uzilishi tekshiriladi.

Majburiy rekvizitlar: Meduza, demo klinika/filial, bemor ID va ism, hujjat raqami, sana, shifokor yoki mas’ul, status, **«DEMO — SUN’IY MA’LUMOT»** belgisi. Qoralama hujjatda «Qoralama» katta yorliq. «Tasdiqlangan» statusi huquqiy elektron raqamli imzo deb ko‘rsatilmaydi.

## 15. Xatolik va chekka holatlar

| Holat | Kutiladigan xatti-harakat |
|---|---|
| Bir tugma ikki marta bosildi | Dublikat qabul/to‘lov yaratilmaydi |
| Ikki foydalanuvchi bir slotni band qildi | Bittasi saqlanadi, ikkinchisiga bandlik xabari |
| Internet/API uzildi | «Saqlanmadi» aniq chiqadi; foydalanuvchi matni yo‘qolmaydi |
| To‘lov yuborilgach javob uzildi | Xuddi shu kalit bilan qayta urinish; yangi to‘lovga aylantirilmaydi |
| Sessiya tugadi | Qayta kirish taklifi; himoyalangan ma’lumot ko‘rinishi to‘xtaydi |
| Filial o‘zgardi | Jadval, ro‘yxat va statistika qayta yuklanadi; eski filial qiymati aralashmaydi |
| Noto‘g‘ri sana/telefon/summa | Maydon yonida o‘zbekcha izoh |
| Qidiruv natijasi yo‘q | «Bemor topilmadi» va ruxsat bo‘lsa «Bemor qo‘shish» |
| Signed hujjatni o‘zgartirish | Server rad etadi; zarur bo‘lsa alohida tuzatish jarayoni |
| AI ishlamadi | Asl matn va qo‘lda davom etish saqlanadi |
| Xizmat narxi o‘zgardi | Eski hisoblar o‘zgarmaydi |
| Qabul bekor qilindi, lekin to‘lov bor | Pul yashirin qaytarilmaydi; alohida ko‘rib chiqish ko‘rsatiladi |
| Kunni kesib o‘tuvchi UTC sana | Mahalliy Asia/Tashkent kunida to‘g‘ri guruhlanadi |
| Keraksiz tibbiy tabga kassir URL orqali kirdi | Server ruxsat bermaydi |
| Reset ikki marta bosildi | Parallel reset bloklanadi; ma’lumot yarim holatda qolmaydi |

## 16. Demo uchun xavfsizlik va ishonchlilik minimumi

Sintetik ma’lumot, server tarafidagi rol/tenant nazorati, input validation, maxfiy kalitlarning serverda turishi, to‘lov tranzaksiyalari, imzolangan yozuvning o‘zgarmasligi, muhim amallar auditi — demo yadrosiga kiradi. Audit: bemor yaratish/tahrirlash, qabul yaratish/ko‘chirish/status, qayd tasdiqlash, natija tasdiqlash, to‘lov/chegirma, sozlama, reset.

Lokal server qayta ishga tushganda saqlangan ma’lumot qoladi. Demo bazasining tekshirilgan nusxasi va reset mexanizmi tayyorlanadi. Ommaviy deployment bo‘lsa HTTPS va yopiq demo kirishi talab etiladi.

Haqiqiy klinikada ishga tushirishdan oldingi alohida bosqich: to‘liq tenant isolation/RLS strategiyasi va sinovlari, MFA, sessiya xavfsizligi, tiklash sinovi, maxfiylik/rozilik/server joylashuvi bo‘yicha amaldagi talablarni tekshirish, klinik shablonlarni mutaxassis tasdig‘i, monitoring, ekspluatatsiya va yordam tartibi. Bular ertangi namoyishda tayyor deb e’lon qilinmaydi.

## 17. Qabul mezonlari va tekshiruv ro‘yxati

Quyidagi P0 tekshiruvlar o‘tmasdan demo yadrosi tayyor hisoblanmaydi:

- [ ] Barcha ko‘rinadigan mahsulot nomlari Meduza; eski Clinic OS yozuvi yo‘q.
- [ ] 5 rol o‘z menyusi bilan kiradi; sessiya serverda rolga mos.
- [ ] 100 seed bemor va bog‘langan ro‘yxatlar mavjud; demo kunida jadval/navbat bo‘sh emas.
- [ ] Yangi bemor yaratilib, qidiruvdan topiladi va refreshdan keyin qoladi.
- [ ] Bir telefonli oila dublikat ogohlantirishidan keyin alohida bemor sifatida saqlanadi.
- [ ] Qabul yaratish shifokor va filial jadvalida bir marta ko‘rinadi.
- [ ] Band vaqtga parallel yozilishdan bittasi 409 oladi.
- [ ] Check-in navbatni yaratadi; qayta bosish raqamni ko‘paytirmaydi.
- [ ] Shifokor qoralama saqlaydi, qayta ochadi, tasdiqlaydi va qabulni yakunlaydi.
- [ ] Signed qaydni oddiy tahrirlash serverda bloklangan.
- [ ] Tahlil buyurtmasi laboratoriya va hisobda bir marta paydo bo‘ladi.
- [ ] Natija kiritish/tasdiqlashdan keyin shifokor kartasida to‘g‘ri statusda ko‘rinadi.
- [ ] Qisman va to‘liq to‘lovda qoldiq to‘g‘ri; qayta so‘rov dublikat yaratmaydi.
- [ ] Ikki parallel to‘lov qoldiqdan ortiq qoplamaydi.
- [ ] Dashboard tushumi filtrlangan to‘lovlar yig‘indisiga teng.
- [ ] Filial va tenant chegaralaridan ma’lumot chiqmaydi; kassir klinik yozuvni o‘qiy olmaydi.
- [ ] Xulosa, natija va ichki to‘lov qaydi A4 printda kesilmaydi.
- [ ] API xatosida forma mazmuni qoladi va xato ko‘rinadi.
- [ ] Resetdan keyin boshlang‘ich seed izchil tiklanadi.
- [ ] Lokal qayta ishga tushirishdan keyin demo ochiladi; internet yo‘qligida asosiy jarayon ishlaydi.

P1 namoyishdan oldingi tekshiruvlar: AI rejimi aniq, API kaliti frontendda yo‘q, kiritilmagan klinik fakt qo‘shilmaydi; ombor qoldig‘i harakatlarga teng; shifokor ulushi formulaga mos; UZI printi to‘g‘ri; ishlamaydigan amallar yashirilgan.

Avtomatlashtirish ustuvorligi: to‘lov/idempotency/parallel qoplash, booking konflikti, tenant/rol izolatsiyasi, dashboard agregatsiyasi uchun integration test; bitta bemor yo‘li uchun E2E yoki takrorlanadigan manual ssenariy. Faqat dizayn ko‘rinishini tasdiqlovchi ko‘p mayda test yozish ertangi ishni siqib chiqarmaydi.

## 18. Uchrashuv uchun 8–10 daqiqalik namoyish

| Vaqt | Amal | Yetkaziladigan fikr |
|---|---|---|
| 0:00–1:00 | Rahbar dashboardi, filial filtri, qarzdorlikdan hisobga o‘tish | Rahbar raqamning asosini ko‘ra oladi |
| 1:00–2:30 | Registrator: yangi bemor, xizmat va bo‘sh slot | Qabul jarayoni sodda va tartibli |
| 2:30–3:00 | «Keldi», navbatda paydo bo‘lish | Registratura va shifokor bog‘langan |
| 3:00–5:00 | Shifokor: tarix, qayd, AI loyihasi (mavjud rejim bilan), tekshiruv buyurtmasi | Bir ish joyida klinik jarayon |
| 5:00–6:00 | Laboratoriya: natijani tasdiqlash, kartaga qaytish | Natija qayta ko‘chirilmaydi |
| 6:00–7:00 | Kassir: hisob, qisman/to‘liq to‘lov, ichki qayd | Pul va xizmatlar o‘zaro bog‘langan |
| 7:00–8:00 | Rahbar: yangi tushum va to‘lov tafsiloti | Hisobot tirik ma’lumotdan hisoblanadi |
| 8:00–9:00 | P1 tayyor bo‘lsa ombor, xodim ulushi, sozlamalar | Klinikaga mos kengayish |
| 9:00–10:00 | Keyingi bosqich va klinikaning ehtiyojlari | Aniq joriy etish ko‘lami kelishiladi |

Ochish gapi: **«Meduza’da bemor bir marta ro‘yxatdan o‘tadi. Registratura, shifokor, laboratoriya va kassa uning xizmatlari ustida bir tizimda ishlaydi. Siz esa natijani rahbar panelida kuzatasiz.»**

Yakuniy savdo nuqtalari: xodimga sodda ish joyi, ma’lumotni takror kiritishning kamayishi, nazorat qilinadigan to‘lovlar, klinikaga mos sozlama, bosqichma-bosqich kengayish. Tejaladigan foiz/soat, raqobatchidan necha baravar tezlik yoki daromad o‘sishi o‘lchanmasdan va’da qilinmaydi.

## 19. Namoyishdan oldingi tayyorgarlik

1. Klinikaga xos nom/logotip/xizmatlar berilgan bo‘lsa kiritish; berilmasa demo belgisini saqlash.
2. Namoyish qurilmasida lokal bazani va ilovani ishga tushirish; README’dagi buyruqlarni tekshirish.
3. Seed sanasini 18-oktabr 2026 ga sozlash, yakshanba shifokor jadvallarini tekshirish.
4. 8–10 daqiqalik ssenariyni boshidan oxirigacha kamida ikki marta bajarish; keyin reset.
5. Print preview, shriftlar va 1366×768 ekran holatini tekshirish; tashqi CDN’ga majburiy bog‘liqlikni olib tashlash.
6. AI ulanishini tekshirish; internet uzilgandagi rejim oldindan belgilangan bo‘lsin.
7. P1’da tayyor bo‘lmagan tugmalarni yopish va `DEMO_STATUS.md`da aniq yozish.
8. Tekshirilgan demo bazasi nusxasini saqlash; favqulodda holat uchun qisqa ekran yozuvi yoki skrinshotlar tayyorlash va ularni yozib olingan namoyish deb belgilash.
9. Uchrashuv davomida tasodifiy reset bo‘lmasligi uchun boshqaruvni oddiy navigatsiyadan ajratish.

## 20. Bajarish navbati va vaqt qisqargandagi qarorlar

**A bosqich:** mavjud kodni tekshirish, Meduza shell, DB, sessiya/rollar, seed.  
**B bosqich:** bemor → qabul → navbat → shifokor qaydi.  
**C bosqich:** buyurtma → laboratoriya natijasi → hisob → to‘lov → dashboard.  
**D bosqich:** print, xatolar, ruxsatlar, demo reset va P0 tekshiruvlar.  
**E bosqich:** AI hujjat loyihasi; keyin UZI, ombor, ulush va qo‘shimcha analitika.  
**F bosqich:** namoyish mashqi, ko‘rinish tekshiruvi, tuzatish va relizni muzlatish.

Vaqt yetmasa avval haftalik kalendar, erkin AI chat, grafiklar xilma-xilligi, xarajat formasi, ombor mutationlari va murakkab shablon sozlamalari qisqartiriladi. P1 modullari izchil seed tafsilotlari bilan qolishi mumkin; ishlaydigan funksiya sifatida ko‘rsatilmaydi.

**Qisqartirilmaydiganlar:** P0 bemor yo‘li, saqlanish, hisob/to‘lov to‘g‘riligi, bog‘langan statistika, rol/tenant chegarasi va halol demo belgilari. P0 to‘liq chiqmasa uni shu TZ’ga mos tayyor MVP deb e’lon qilmaslik; namoyish ko‘lami aniq qayta belgilanadi.

Bu TZ butun hajmni bir kunda noldan kafolatlamaydi. Eng birinchi texnik tekshiruv mavjud ishlaydigan kodni va jamoa imkoniyatini aniqlaydi. Keng, ammo bo‘sh ekranlardan oldin B–D bosqichlari tugatiladi.

## 21. Topshiriladigan natijalar

- Ishlaydigan Meduza demo ilovasi va manba kodi.
- Database migratsiyalari, deterministik seed va demo reset.
- `.env.example`; haqiqiy API kalitlari repository’da bo‘lmaydi.
- Lokal ishga tushirish, seed, reset va test buyruqlari yozilgan README.
- Rol akkauntlari va namoyish yo‘li ko‘rsatilgan `DEMO_SCRIPT.md`.
- Har modulning ishlaydigan/demo/rejadagi holati yozilgan `DEMO_STATUS.md`.
- P0 qabul mezonlarining o‘tgan/o‘tmagan ro‘yxati va ma’lum cheklovlar.
- Print namunalarining tekshirilgan natijasi va kerak bo‘lsa zaxira ekran yozuvi.

Ushbu hujjat talablarni belgilaydi; yuqoridagi ilova va yordamchi fayllar hali yaratilgan yoki tekshiruvdan o‘tgan degani emas.

## 22. Klinikaga aniqlashtiriladigan savollar

Bu savollar demo tayyorlashni to‘xtatmaydi; hozirgi taxminlarni haqiqiy joriy etish ko‘lamiga aylantiradi:

1. Klinikadagi yo‘nalishlar, shifokorlar, filiallar va xonalar soni qanday?
2. Laboratoriya ichkimi yoki tashqi hamkormi; UZI/rentgen bormi?
3. To‘lov qabuldan oldinmi, keyinmi yoki har ikkisi mumkinmi?
4. Xizmat narxlari, chegirma vakolati va shifokor ulushi qanday belgilanadi?
5. Klinikada foydalaniladigan hujjat blankalari va majburiy maydonlar qanday?
6. Ochilish sanasi va birinchi kun uchun majburiy modullar qaysilar?
7. Internet, kompyuter, printer va tarmoq holati qanday?
8. Zarur davlat, to‘lov va laboratoriya integratsiyalari qaysilar?
9. Klinik tomondan talablarni va pilotni tasdiqlaydigan mas’ul kim?
10. SaaS narxi, joriy etish, hosting, AI sarfi va yordam xizmati alohida qanday kelishiladi?

**Ertangi asosiy va’da:** Meduza’da bemorning asosiy yo‘li va uning moliyaviy natijasi yagona tizimda ko‘rsatiladi; klinikaga joriy etish hajmi esa ularning real jarayonlari bilan kelishiladi.
