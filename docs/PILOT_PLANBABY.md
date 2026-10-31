# Planbaby pilot: MedPlus’dan Med.uz.ai’ga to‘liq o‘tish

Planbaby klinikasi (filiallar: «Центр», «Medwell») MedPlus’dan butunlay Med.uz.ai’ga o‘tadi. Ikki tizim parallel
ishlamaydi va MedPlus bilan doimiy integratsiya yo‘q. MedPlus’dagi eski ma’lumot **bir marta** ko‘chiriladi: klinika
o‘z hisobotlarini Excel’ga chiqaradi, biz faylni import qilamiz. Shundan keyin «O‘tishni yakunlash» bosiladi.
Texnik tafsilotlar: `docs/MEDPLUS_SYNC.md` («File import», «Full switch»), server: `docs/DEPLOY_UZ.md`.

## 0. Go-live’dan oldin hal bo‘lishi shart

| Masala | Kim | Holat |
|---|---|---|
| O‘zbekistondagi server va domen (tavsiya: Uztelecom Cloud, `docs/PILOT_HOSTING_UZ.md`) | Biz + klinika | |
| Shartnoma: klinika — ma’lumot egasi, Med.uz.ai — operator; sub-provayderlar | Yurist | |
| Bemor roziligi matni (`CONSENT_TEXT_VERSION`); MedPlus roziligi eski kartalarni qamraydimi | Yurist | |
| MedPlus Excel eksportidan foydalanish: ma’lumot klinikaniki, MedPlus kodi/bazasiga tegilmaydi | Yurist (bir og‘iz tasdiq) | |
| Fiskal chek: KKM bilan qo‘lda rejim (`FISCAL_PROVIDER=manual`, kassir chek raqamini kiritadi) | Buxgalter | |
| IKPU kodlari va QQS bo‘yicha xizmatlar ro‘yxati | Buxgalter | |
| Oldindan to‘lovlar (bemor balansi) MedPlus’da bormi — bo‘lsa, qanday ko‘chiriladi (pastda «Ochiq savollar») | Klinika | |

## 1. Server va klinika (T−14 … T−7)

1. Serverni `docs/DEPLOY_UZ.md` bo‘yicha o‘rnatish; zaxira nusxa va tiklash sinovi ishlashini tekshirish.
2. `npm run db:create-clinic` → klinika, birinchi filial, rahbar (vaqtinchalik parol bir marta ko‘rsatiladi).
3. Rahbar: ikkinchi filialni qo‘shadi, xodimlar hisobini ochadi (registrator, kassir, shifokorlar, laborant,
   omborchi, qorovul — kerak bo‘lganlari), shifokorlar ish jadvalini kiritadi.
4. Narxlar: MedPlus prayskurantini Excel’ga chiqarish → Sozlamalar → Xizmatlar → «Narxlar ro‘yxatini yuklash».
5. Chegirma qoidalari, imtiyoz toifalari, kompaniyalar va yo‘llovchi shifokorlar (bo‘lsa) — MedPlus’dagidek.

## 2. Ma’lumotni ko‘chirish (sinov: T−7, yakuniy: T−0 kechqurun)

Klinika MedPlus’dan chiqaradigan fayllar (barchasida **bemor ID** ustuni bo‘lsin):

| Fayl | Ustunlar | Davr |
|---|---|---|
| Bemorlar ro‘yxati | ID, FIO, tug‘ilgan sana, jinsi, telefon, manzil, (PINFL) | hammasi |
| Xizmatlar hisoboti | qator ID, bemor ID, xizmat, narx, chegirma, shifokor, sana, filial | kelishilgan sanadan (masalan 2026-01-01) |
| Kassa tarixi (to‘lovlar) | to‘lov ID, bemor ID, summa, to‘lov turi, sana, kassir, filial | o‘sha davr |

Tartib: Sozlamalar → Integratsiyalar → «MedPlus’ni ulash» (kalit kerak emas, faqat fayl) → «Fayldan import»:
bemorlar → xizmatlar → to‘lovlar; har biri avval **Tekshirish**, keyin **Import qilish**.

- **Sinov importi (T−7):** shu fayllar haqiqiy serverga yuklanadi. Yozuvlar «MedPlus» belgisi bilan faqat o‘qish
  holatida turadi, klinika esa MedPlus’da ishlashda davom etadi. «Moslashtirish» bo‘limida filiallar, to‘lov turlari,
  xizmatlar va shifokorlarni bizdagilarga bog‘lang. «Dublikatlar»ni ko‘rib chiqing.
- **Yakuniy import (T−0, klinika yopilgach):** MedPlus’da yozish to‘xtatiladi, o‘sha fayllar yangidan chiqariladi va
  yana import qilinadi. Takroriy import xavfsiz: o‘zgarmaganlar o‘tkazib yuboriladi, yangilari qo‘shiladi.

## 3. O‘tish kuni (T−0) tekshiruvi

1. Bemorlar soni — MedPlus’dagi umumiy son bilan teng.
2. Qarzdorlar: Kassa → Qarzdorlar jami — MedPlus qarzlar hisobotidagi jami bilan teng.
3. Oxirgi 7 kun tushumi (Moliya) — MedPlus kassa hisoboti bilan teng.
4. «Kutilayotganlar» = 0 (yoki har biri sababi bilan tushunilgan).
5. **«O‘tishni yakunlash»** (Integratsiyalar → O‘tishni yakunlash). Bir martalik, ortga qaytmaydi. Shundan keyin
   kartalar tahrirlanadi va eski qarzlar Med.uz.ai kassasida to‘lanadi (fiskal chek bilan).
6. Kelgusi qabullar: MedPlus jadvalidagi ertangi va keyingi qabullarni registrator Med.uz.ai’ga kiritadi.
   «O‘tishni yakunlash» oynasi MedPlus’dan kelgan kelgusi qabullar sonini ko‘rsatadi.
7. MedPlus o‘chirilmaydi: 3 oy faqat ma’lumot ko‘rish uchun qoladi (yangi yozuvsiz).

## 4. O‘qitish (T−3 … T−1)

Har bir rol uchun 30–45 daqiqa, demo’da (`docs/DEMO_SCRIPT.md`): registrator (bemor, qabul, rozilik), kassir
(smena, to‘lov, KKM chek raqami, Z-hisobot, qarzdorlar), shifokor (qabul varag‘i, retsept, xulosa), laborant,
rahbar (dashboard, moliya, hisobotlar, sozlamalar).

## 5. Birinchi 2 hafta

- Har kuni: Z-hisobot va KKM jami bir xilmi; qarzdorlar ro‘yxati; zaxira nusxa olingani (`docs/DEPLOY_UZ.md` §4).
- Kunlik qo‘ng‘iroq (10 daqiqa) rahbar bilan: nima qiyin bo‘ldi, nima yetishmayapti.
- Uptime monitor `GET /api/v1/health` ga ulangan.

**Ortga qaytish rejasi:** jiddiy muammo bo‘lsa, klinika MedPlus’ga qaytishi mumkin (u o‘chirilmagan). Lekin
Med.uz.ai’da kiritilgan yangi qabul va to‘lovlarni MedPlus’ga qo‘lda kiritish kerak bo‘ladi. Shuning uchun birinchi
3 kunda ham har kuni Med.uz.ai’dan Excel hisobot olib qo‘yiladi.

## Ochiq savollar

- **Oldindan to‘lovlar (bemor balansi):** import ularni olmaydi. Agar MedPlus’da bo‘lsa, ro‘yxat bo‘yicha
  qo‘lda kiritish yoki alohida «boshlang‘ich qoldiq» funksiyasi kerak — klinika javobidan keyin hal qilinadi.
- **Kelgusi qabullar** fayldan import qilinmaydi (yuqoridagi 6-band, qo‘lda).
- MedPlus’da bor, Med.uz.ai’da hali yo‘q bo‘limlar (statsionar, stomatologiya, probirka shtrix-kodi/LIS,
  sertifikat va kartalar): klinika qaysilaridan haqiqatan foydalanishiga qarab rejalashtiriladi.
