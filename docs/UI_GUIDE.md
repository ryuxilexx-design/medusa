# Med.uz.ai — interfeys qoidalari (UI guide)

Maqsad: har yoshdagi shifokor va xodim ekranni **birinchi qarashda** tushunsin. Chiroyli bo‘lishdan oldin sodda va
tartibli bo‘lsin. Bu qoidalar barcha sahifalarga tegishli; yangi ekran shu qoidalarga mos bo‘lmasa — tuzatiladi.

## 0. Material: Liquid Glass «Clear» (2026-10-21 dan)

Interfeys Apple’ning Liquid Glass (iOS 26) materialida, «Clear» variantida. Qoidalar (`apps/web/src/app/globals.css`):

- **Shisha faqat boshqaruv qatlamida:** chap menyu (`.glass`, suzuvchi panel), yuqori toolbar (`.glass .glass-pill`),
  telefon/planshetdagi pastki capsule tab bar, tugmalar (`Button` = `.glass-btn`, asosiy = `.glass-btn-tint`),
  segmentli tanlagichlar (`.glass-field`). Kontent — kartalar, jadvallar, formalar — **hech qachon shisha emas**:
  `.surface` (oq, 22 px radius). Shisha ustiga shisha qo‘yilmaydi.
- **Material:** fon rangli «wallpaper» (`body`), shisha uni sindiradi (`<GlassDefs/>` SVG linza, Chrome/Edge’da;
  Safari’da blur), yuqori chetida yorug‘lik chizig‘i, pastida ozgina qoraytiruvchi parda (matn o‘qilishi uchun).
  `prefers-reduced-transparency` yoki eski brauzerda — oq panellar, bir xil joylashuv.
- **Shakl:** konsentrik yumaloqlik — panel 28 px, karta 22 px, tugma va maydonlar kapsula (`rounded-full`, h ≥ 48).
- **Harakat «Prujina» (2026-10-22 dan):** butun ilovada bitta prujina (`--spring`, `--spring-soft`, `globals.css`
  «Motion»). Tugma bosilganda tez kichrayadi (`.press`, 0,94, 80 ms), qo‘yib yuborilganda ozgina «sakrab» qaytadi
  (450 ms). Yangi sahifa o‘ngdan prujinada kiradi (`(app)/template.tsx` → `.page-enter`), jadval qatorlari va
  `.divide-y`/`.stagger` ro‘yxat elementlari birin-ketin ko‘tariladi. Oyna (`.modal-panel`), xabar (`.toast-in`),
  segmentli tanlagich va tab bar kapsulasi (`SlidingPill`) ham shu prujinada. Faqat `transform`/`opacity`;
  `prefers-reduced-motion` da hammasi o‘chadi (E2E shu rejimda yuradi). Boshqa uslub (to‘lqin, shu’la) qo‘shilmaydi.
- Rang, matn o‘lchami va kontrast qoidalari (1–2-bo‘limlar) o‘z kuchida: shisha ustidagi matn `slate-900`,
  ikkinchi darajali `slate-700` (shishada `slate-600` ishlatilmaydi).

## 1. Asosiy tamoyillar

1. **Bitta ekran — bitta asosiy vazifa.** Har sahifada bitta asosiy (ko‘k, `variant="primary"`) tugma, sarlavhaning
   o‘ng tomonida. Qolgan tugmalar — oddiy (`secondary`) yoki matnli (`ghost`).
2. **Matn kam, ma’no ko‘p.** Sarlavha ostidagi izoh — bitta qisqa jumla (≤ 60 belgi) yoki umuman yo‘q. Tushuntirish,
   formula, «keyingi relizda…» kabi matnlar ekranga yozilmaydi (kerak bo‘lsa — hujjatda). Bo‘sh holatda bitta qator.
3. **Takrorlanmasin.** Bir ma’lumot ekranda bir marta: «Demo» belgisi faqat yuqori panelda; filial nomi faqat filial
   tanlagichda; sana sarlavhada bo‘lsa, kartada yana yozilmaydi.
4. **Rang — faqat ma’no uchun.** Ko‘k — asosiy harakat va tanlangan holat; yashil — bajarildi/to‘landi; sariq — e’tibor;
   qizil — xato/qarz/xavf. Holat har doim **so‘z + belgi + rang** (faqat rang emas).
5. **Kuchli kontrast.** Asosiy matn `text-slate-900`, ikkinchi darajali `text-slate-600`. `slate-400/500` matn uchun
   ishlatilmaydi (faqat belgilar uchun).

## 2. O‘lchamlar (8 px tizim)

Asosiy shrift 18 px (`html`), o‘lchamlar `rem` da. 1 rem = 18 px.

| Narsa | Klass | Taxminiy px |
|---|---|---|
| Sahifa sarlavhasi (h1) | `text-2xl font-bold` | 27 |
| Karta sarlavhasi (h2) | `text-base font-bold` | 18 |
| Oddiy matn, jadval | `text-sm` / `text-[0.9375rem]` | 16–17 |
| Kichik izoh, jadval sarlavhasi | `text-[0.8125rem]` | 15 |
| Eng kichik (faqat belgi/teg) | `text-2xs` | ≈ 13 |

- Bo‘shliqlar faqat shu qatordan: `gap-2` (8), `gap-3` (12), `gap-4` (16), `gap-5` (20), `gap-6` (24). Kartalar orasida `gap-5`.
- Tugma balandligi: oddiy `min-h-12` (≈ 48 px, kapsula), kichik `min-h-10`. Maydon (input/select) `h-11`,
  `rounded-xl`. Bitta qatordagi barcha boshqaruvlar bir xil balandlikda.
- Karta: `surface` (`Card`/`StatCard` shuni beradi), ichki chekka `p-5` (jadval kartasida 0).
- Sahifa: kenglik `max-w-[1440px]`, chekka `px-4 lg:px-8`, yuqoridan `py-6`.

## 3. Sahifa tuzilishi (yuqoridan pastga)

1. **PageHeader** — sarlavha, (ixtiyoriy) qisqa izoh, o‘ngda asosiy tugma.
2. **Asosiy raqamlar** (agar bo‘lsa) — 3–5 ta `StatCard`, bir qatorda. Raqam katta, nomi bir qatorda, izoh bitta qisqa qator.
3. **Filtrlar paneli** (`Toolbar`) — kartaning tepasida, bir qatorda: chapda qidiruv/filtrlar, o‘ngda ikkinchi darajali
   harakatlar (eksport). Davr uchun faqat `components/date-range.tsx`. Filtrlar torayganda chiroyli o‘raladi.
4. **Asosiy kontent** — jadval yoki ro‘yxat. Jadvalda: ustun sarlavhasi qisqa, raqamlar o‘ngda (`right`), amallar oxirgi
   ustunda, qatordagi harakatlar matnli tugma (belgi + fe’l).
5. **Ikkinchi darajali bloklar** — pastda yoki o‘ng ustunda (xl dan).

## 4. Qobiq (shell)

- **Chap menyu** (`w-64`): logotip; bo‘limlar guruhlangan — «Kundalik ish» va «Boshqaruv» (rolda 6 tadan kam bo‘lim
  bo‘lsa guruh nomlari yo‘q). Pastda faqat reliz yozuvi.
- **Yuqori panel** (64 px): klinika nomi + sana/vaqt (+ «Demo» belgisi), filial, bemor qidiruvi; o‘ngda foydalanuvchi
  menyusi (ism, rol → til, parolni almashtirish, chiqish).

## 5. Komponentlar (`components/ui.tsx`)

`Button`, `LinkButton`, `Field`, `Input`, `Select`, `Textarea`, `Badge`, `Card`, `PageHeader`, `StatCard`, `Toolbar`,
`EmptyState` (`compact` — karta ichida), `ErrorState`, `Alert`, `Table`/`Th`/`Td`, `Pagination`, `Tabs`, `Modal`,
`useToast`. Pul — `components/money-input.tsx`, davr — `components/date-range.tsx`. Yangi «o‘xshash» komponent yozilmaydi.

## 6. Tekshirish

Har o‘zgargan ekran 1366×768 va 390 px da, o‘zbek va rus tilida ko‘riladi: kesilgan matn, yon tomonga aylantirish,
ikki qatorga tushib qolgan tugma yo‘q. Barcha matn `t('…')` orqali.
