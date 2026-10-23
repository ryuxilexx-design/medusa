# Mahsulot rejasi (2026-10-22 auditidan keyin)

Maqsad: birinchi haqiqiy kichik klinikaga o‘rnatish, keyin «mahsulot» darajasiga chiqarish. To‘liq audit:
https://claude.ai/artifact/Pyc7KKvHgFiXQzbZf7RgNR (xulosa: bu hafta — yozuv + navbat + ichki kassa, AI o‘chiq,
fiskal kassa va DMED retsept yonma-yon).

## 1-bosqich — blokerlar (bu hafta)

| № | Ish | Holat |
|---|---|---|
| 1 | Xizmat / filial / xona / ombor tovarini UI’dan yaratish (manager), narx filial bo‘yicha | bajarildi (2026-10-23) |
| 2 | Shifokor dam olish kuni / ta’til / bayram (`schedule_exceptions`, bot ham hurmat qiladi) | bajarildi (2026-10-23) |
| 3 | Imzolangan qaydga qo‘shimcha yozuv (addendum, append-only) | bajarildi (2026-10-23) |
| 4 | AI «Qo‘llash» yozilganini o‘chirmaydi; production’da AI sukut o‘chiq, kunlik byudjet; AI xatolari 3 tilda | bajarildi (2026-10-23) |
| 5 | `db:reset-password`, `GET /health`, log chegarasi, `PUBLIC_URL`, sliding sessiya | bajarildi (2026-10-23) |
| 6 | Rahbar to‘lov qabul qiladi/smena ochadi; shifokor ulushi % ishlaydi; tungi ochiq smena ogohlantirishi | bajarildi (2026-10-23) |
| 7 | Registrator yozganda bemorga Telegram tasdiq; farzand kartasi; navbatsiz qabul; lotin↔kirill qidiruv; qabul taloni chopi | bajarildi (2026-10-23) |
| 8 | CI (GitHub Actions: typecheck + testlar + build) | yashil (6b9fbee): typecheck, 157 test, build |

Natija: API testlari 157/157, E2E 152 ✓ (13 suite), typecheck toza; lokal demo yangi build bilan ishlayapti.

## 2-bosqich — qonuniy va integratsiya (2–6 hafta)

- **Bajarildi (2026-10-23):** fiskal asos — parallel rejim (kassir KKM chekining raqamini kiritadi), IKPU/QQS maydonlari,
  `fiscal_receipts` outbox va provayder interfeysi (haqiqiy ОФД provayderi hali yo‘q); SMS (Eskiz) kanali — Telegram’siz
  bemorlarga eslatma, Sozlamalar → SMS; kassa: xizmat miqdori, qator bo‘yicha qaytarish, oldindan to‘lov/depozit,
  qarzdorlar (yosh bo‘yicha), CSV eksportlar (to‘lovlar, qaytarishlar, xarajatlar, smenalar, shifokor ulushi).
- Qoldi: haqiqiy ОФД provayderi (klinika qaysi virtual kassani ishlatishini aniqlash), Eskiz haqiqiy hisob bilan sinov,
  jo‘natuvchi nomini operatorlarda ro‘yxatdan o‘tkazish.
- DMED: shifokor hisoblari (hozir), keyin token orqali integratsiya; e-retsept; PQ-170 bo‘yicha DHP/FHIR almashinuv
  2027-04-01 gacha.
- Shaxsiy ma’lumotlar: bazani reestrga olish (VM-71), rozilik matni (yurist). **Bajarildi:** bemor kartasi chopi, to‘liq ma’lumot eksporti (rahbar, muhrlangan fayl), anonimlashtirish (qaytarib bo‘lmaydi, tibbiy yozuvlar saqlanadi).
- Qarz/oldindan to‘lov, xizmat miqdori, qator bo‘yicha qaytarish, eksportlar (CSV/XLSX), ESF (yuridik shaxslar).

## 3-bosqich — «shifokor faqat tasdiqlaydi» (4–6 hafta)

**Bajarildi (2026-10-23):** 12 ta boshlang‘ich qayd shabloni (mutaxassislik bo‘yicha, shifokor tekshiruvidan o‘tmagan), tez iboralar, shablondan buyurtma *taklifi*, qayta qabulni imzodan bir bosishda band qilish. **Bajarildi (2026-10-23):** ovozdan matn (o‘z serverdagi Whisper, o‘zbekcha uchun fine-tune model kerak — `docs/VOICE_SCRIBE.md`), dori lug‘ati (417 INN, klinik tekshiruv kutilmoqda) va allergiya tekshiruvi (og‘ir allergiyada sababsiz berilmaydi), DMED/DHP uchun FHIR qatlam (eksport rejimi; jonli yuborish uchun R5 va OAuth2 — `docs/DMED_INTEGRATION.md`). Qoldi: avto-kodlash, haqiqiy ovoz/Uzbek model sinovi, SSV bilan ulanish.


Ovozdan matn (o‘zbek/rus), mutaxassislik shablonlari va tez iboralar, yuqori ishonchli avto-kodlash (bir bosish),
tashxisdan buyurtma to‘plami taklifi, imzodan hujjat va qayta qabul avto-to‘ldirish, dori lug‘ati + allergiya
tekshiruvi. Odamda qoladi: tashxis, dori va doza, tahlil tanlovi, mehnatga layoqatsizlik, imzo.
