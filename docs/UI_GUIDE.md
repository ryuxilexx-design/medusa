# Med.uz.ai — interfeys qoidalari (UI guide)

Maqsad: har yoshdagi shifokor va xodim ekranni **birinchi qarashda** tushunsin. Chiroyli bo‘lishdan oldin sodda va
tartibli bo‘lsin. Bu qoidalar barcha sahifalarga tegishli; yangi ekran shu qoidalarga mos bo‘lmasa — tuzatiladi.

**O‘lchov birligi.** Asosiy shrift 18 px (`html { font-size: 112.5% }`), shuning uchun **1 rem = 18 px** va Tailwind’ning
bitta qadami (`p-1`, `h-1`) = 4,5 px. Quyidagi barcha px qiymatlar — ekranda chiqadigan haqiqiy px.

## 0. Material: Liquid Glass «Clear» (2026-10-21 dan)

Interfeys Apple’ning Liquid Glass (iOS 26) materialida, «Clear» variantida. Qoidalar (`apps/web/src/app/globals.css`):

- **Shisha faqat boshqaruv qatlamida:** chap menyu (`.glass`, suzuvchi panel), yuqori toolbar (`.glass .glass-pill`),
  telefon/planshetdagi pastki capsule tab bar, asosiy tugma (`.glass-btn-tint`), shishadagi segmentlar va maydonlar
  (`.glass-field`). Kontent — kartalar, jadvallar, formalar — **hech qachon shisha emas**: `.surface` (oq,
  `rounded-surface` = 24,75 px). Shisha ustiga shisha qo‘yilmaydi.
- **Ikkinchi darajali tugma** (`Button` default) — deyarli shaffof bo‘lmagan oq kapsula, ingichka chegarali: devor
  qog‘ozida ham, oq kartada ham, oyna pastida ham bir xil ko‘rinadi va hech qachon ikkinchi «asosiy» bo‘lib ko‘rinmaydi.
- **Material:** fon rangli «wallpaper» (`body`), shisha uni sindiradi (`<GlassDefs/>` SVG linza, Chrome/Edge’da;
  Safari’da blur). `prefers-reduced-transparency` yoki eski brauzerda — oq panellar, bir xil joylashuv.
- **Shakl:** konsentrik — panel/oyna `rounded-panel` (31,5 px), karta `rounded-surface` (24,75 px); **tugma, segment,
  chip — kapsula** (`rounded-full`); **kiritish maydoni (Input/Select/Textarea) va ogohlantirish — yumaloq to‘rtburchak**
  `rounded-field` (13,5 px). Istisno: shisha ichidagi maydon (qobiqdagi qidiruv, filial) — kapsula `.glass-field`.
- **Harakat «Prujina» (2026-10-22 dan):** butun ilovada bitta prujina (`--spring`, `--spring-soft`, `globals.css`
  «Motion»). Tugma/havola bosilganda kichrayadi va «sakrab» qaytadi (`components/motion.tsx`, `PressMotion`; o‘z
  `transform`i bor element yoki `data-no-press` ichidagilar chetlab o‘tiladi). Sahifa (`.page-enter`), qatorlar
  (`.grid`/`tbody tr`/`.divide-y`/`.stagger`), oyna (`.modal-panel`), xabar (`.toast-in`), menyu va `SlidingPill` ham shu
  prujinada. Faqat `transform`/`opacity`. `prefers-reduced-motion` da hammasi o‘chadi — `animate-pulse`/`animate-spin`
  ham to‘xtaydi, silliq aylantirish uchun `scrollBehavior()` (`ui.tsx`) ishlatiladi. Boshqa uslub qo‘shilmaydi.
- Shisha ustidagi matn `slate-900`, ikkinchi darajali `slate-700` (shishada `slate-600` ishlatilmaydi).

## 1. Asosiy tamoyillar

1. **Bitta ekran — bitta asosiy vazifa.** Har sahifada bitta asosiy (`variant="primary"`) tugma, sarlavhaning
   o‘ng tomonida. Qolgan tugmalar — oddiy (`secondary`) yoki matnli (`ghost`, `TextLink`).
2. **Matn kam, ma’no ko‘p.** Sarlavha ostidagi izoh — bitta qisqa jumla (≤ 60 belgi) yoki umuman yo‘q. Tushuntirish,
   formula, «keyingi relizda…» kabi matnlar ekranga yozilmaydi. Bo‘sh holatda bitta qator (`EmptyState`).
3. **Takrorlanmasin.** Bir ma’lumot ekranda bir marta.
4. **Rang — faqat ma’no uchun.** Ko‘k (`brand-600` = `accent`, bitta ko‘k) — asosiy harakat va tanlangan holat;
   yashil — bajarildi/to‘landi; sariq — e’tibor; qizil — xato/qarz/xavf. Holat har doim **so‘z + belgi + rang**.
5. **Kuchli kontrast.** Matn `text-slate-900` (= `ink`), oq fonda ikkinchi darajali `text-slate-600`. `slate-400/500`
   matn uchun ishlatilmaydi (faqat belgilar). O‘chirilgan asosiy tugma — kulrang, matni o‘qiladi (≥ 4,5:1).
6. **Klaviatura fokusi** — bitta sariq halqa (`focus` tokeni, `FOCUS_RING`; tasma ichida `FOCUS_RING_INSET`). Tanlangan
   holat hech qachon sariq emas (oq kapsula yoki ko‘k fon), shuning uchun fokus va tanlov chalkashmaydi. Oyna ochilganda
   fokus birinchi maydonga tushadi (`data-autofocus` bilan aniq ko‘rsatish mumkin), hech qachon «Bekor qilish»ga emas.

## 2. Tokenlar va o‘lchamlar

Tokenlar `apps/web/tailwind.config.ts` da nomlangan, qiymatlari `globals.css :root` da. Ixtiyoriy qiymat
(`text-[…]`, `shadow-[…]`, `z-[…]`, rang hex) yozilmaydi — kerakli token bo‘lmasa, avval token qo‘shiladi. Istisnolar:
qog‘oz uchun o‘lchamlar (`app/print/**`, `print-doc.tsx`), logotip ranglari (`logo.tsx`), Telegram simulyatori va
telefon kamerasi chizmasi. Grafik (SVG) ranglari — `fill-brand-*`/`stroke-slate-*` klasslari yoki `currentColor`; SVG
matni ekranda ham `text-small` o‘lchamida qolishi uchun chizma kengligi o‘lchab olinadi (1 birlik = 1 px).

**Matn o‘lchami**

| Token | px | Qayerda |
|---|---|---|
| `text-title` | 31,5 | sahifa sarlavhasi (h1, `PageHeader`) |
| `text-2xl` / `text-stat` | 27 / 24,75 | katta raqam (`StatCard`) |
| `text-lg` | 20,25 | oyna sarlavhasi |
| `text-base` | 18 | karta sarlavhasi (h2), asosiy matn |
| `text-body` | 16,9 | tugma, maydon, tab, ro‘yxat qatori, karta matni |
| `text-sm` | 15,75 | jadval, kichik tugma, label, ogohlantirish |
| `text-small` | 14,6 | izoh, jadval sarlavhasi, ikkinchi qator |
| `text-xs` | 13,5 | eng kichik matn (telefon tab bar yozuvi) |
| `text-2xs` | 12,4 | faqat teg/belgi («Demo»), jumla emas |

**Boshqaruv balandligi — bitta qoida.** Bir qatordagi barcha boshqaruvlar (tugma, maydon, select, segment, sana)
bir xil balandlikda:

| Token | rem | px | Nima |
|---|---|---|---|
| `h-control` / `min-h-control` | 2,75 | 49,5 | `Button` md, `Input`, `Select`, `Segmented` md, `Tabs` — standart |
| `h-control-sm` / `min-h-control-sm` | 2,5 | 45 | `Button size="sm"`, `Input size="sm"`, `Segmented size="compact"`, `Chip`, jadval/zich toolbar |

**Bosish maydoni ≥ 44 px (ekranda)** — telefonda ham, kompyuterda ham. Faqat belgili tugma — `Button size="icon"`
(49,5 px) yoki `"icon-sm"` (45 px), `aria-label` majburiy (tiplar talab qiladi). Matn ichidagi havola (`TextLink`)
ko‘rinmas `::after` bilan ≥ 44 px balandlikda bosiladi. `min-h-9`, `h-8`, `p-1` belgili tugma — ishlatilmaydi.

**Bo‘shliq:** `gap-2` (9), `gap-3` (13,5), `gap-4` (18), `gap-5` (22,5), `gap-6` (27). Kartalar orasida `gap-5`.
Karta ichki chekkasi `p-5`, sarlavha/toolbar `px-5`; jadvalning birinchi va oxirgi ustuni ham `px-5` dan boshlanadi
(`Th`/`Td` o‘zi qiladi), shuning uchun ustunlar karta sarlavhasi bilan bir chiziqda.

**Radius:** `rounded-field` (13,5), `rounded-surface` (24,75), `rounded-panel` (31,5), `rounded-full` (kapsula).
**Soya:** `shadow-card`, `shadow-popover`, `shadow-modal`, `shadow-pill`, `shadow-primary`, `shadow-selected`
(tanlangan qatorning chap ko‘k chizig‘i). **Qatlam (z):** `z-raised` 1 · `z-sticky` 10 · `z-dropdown` 20 ·
`z-tabbar` 30 · `z-header` 32 · `z-overlay` 35 · `z-drawer` 40 · `z-modal` 50 · `z-toast` 60 · `z-skip` 70.

**Sahifa:** kenglik `max-w-[80rem]` (1440 px), chekka `px-4 lg:px-8`, yuqoridan `py-6`.

## 3. Sahifa tuzilishi (yuqoridan pastga)

1. **PageHeader** — sarlavha, (ixtiyoriy) qisqa izoh, o‘ngda asosiy tugma.
2. **Asosiy raqamlar** (agar bo‘lsa) — 3–5 ta `StatCard`. Nomi uchun doim 2 qatorlik joy (raqamlar bir chiziqda),
   uzun nom o‘raladi — kesilmaydi. 360 px dan tor ekranda — bitta ustun
   (`grid-cols-1 min-[360px]:grid-cols-2`); 390 px telefonda ikki ustun, uzun nom bo‘g‘in bo‘yicha o‘raladi.
3. **Filtrlar paneli** (`Toolbar`) — kartaning tepasida: chapda qidiruv/filtrlar, o‘ngda ikkinchi darajali harakatlar.
   Davr uchun faqat `components/date-range.tsx` (moliya: `PeriodPicker` — sana + «Bugun / 7 kun / 30 kun» `Segmented`).
   Hammasi bir balandlikda (§2). Filtrlar ikkinchi qatorga o‘tsa, o‘ngdagi harakat (CSV) birinchi qatorda qoladi.
   Sana maydoni bosilgan joyidan kalendarni ochadi; telefonda sana kalendar belgisi ostiga kirmaydi.
4. **Asosiy kontent** — jadval (`Card padded={false}` + `Table`: sarlavha qatori kartaning yumaloq burchagidan
   chiqmaydi) yoki ro‘yxat. Raqamlar o‘ngda (`right`), qatordagi harakat — belgi + fe’l.
5. **Ikkinchi darajali bloklar** — pastda yoki o‘ng ustunda (xl dan).

## 4. Qobiq (shell)

- **Chap menyu:** logotip; bo‘limlar guruhlangan — «Kundalik ish» va «Boshqaruv» (rolda 7 tadan kam bo‘lim bo‘lsa
  guruh nomlari yo‘q). Past ekranda (≤ 820 px balandlik, masalan 1366×768) qatorlar ixcham (45 px) — rahbarning 12
  bo‘limi aylantirmasdan sig‘adi; ochiq bo‘lim doim ko‘rinadi. Pastda faqat reliz yozuvi.
- **Yuqori panel:** klinika nomi + sana/vaqt (+ «Demo»), filial, bemor qidiruvi (to‘liq yozuvi bilan); o‘ngda
  foydalanuvchi menyusi: ism, rol → **til (O‘zbekcha · Ўзбекча · Русский)**, parolni almashtirish, chiqish. Til
  tanlash har qanday ekran kengligida shu menyuda; kirish sahifasida — alohida tanlagich.
- **Telefon tab bar:** pastda suzuvchi kapsula, yozuvlar `text-xs`; iPhone’ning pastki chizig‘i ustida
  (`env(safe-area-inset-bottom)`, `--tabbar`). Pastga yopishgan harakat panellari `bottom: var(--tabbar)` da turadi.

## 5. Komponentlar (`components/ui.tsx`)

Yangi «o‘xshash» komponent yozilmaydi — bor narsadan foydalaning:

| Komponent | Qachon |
|---|---|
| `Button` (`variant` primary/secondary/ghost/danger/success, `size` md/sm/compact/icon/icon-sm, `loading`, `icon`) | har qanday harakat |
| `LinkButton` | tugma ko‘rinishidagi ichki havola; `buttonClass()` — tashqi `<a download>` uchun |
| `TextLink` (`href` yoki `onClick`; `tone` brand/ink/danger/muted) | matn ichidagi yoki jadval qatoridagi havola/harakat |
| `RowButton` (`selected`) | butun qator bosiladigan ro‘yxat (tanlangani chap ko‘k chiziq bilan) |
| `Segmented` (`size` md/compact, `variant` plain/glass, `role` radiogroup/tablist, `stretch`) | 2–5 qisqa variantdan bittasi (davr, ko‘rinish, til, kirish usuli); strelka tugmalari ishlaydi |
| `Tabs` | karta ustidagi bo‘limlar; sig‘masa yon tomonga aylanadi, chetida soya |
| `Chip` (`pressed`) | filtr/mavzu/vaqt chiplari, o‘raladi |
| `Checkbox` / `Radio` (`label`, `hint`, `rowClassName`, `rowProps`) | belgilash; 22,5 px quti, butun qator bosiladi |
| `Field` + `Input`/`Select`/`Textarea` (`size` md/sm), `FieldError` | forma; `MoneyInput` — so‘m |
| `Card` (`padded={false}` jadval uchun), `PageHeader`, `StatCard`, `Toolbar`, `SectionTitle` | sahifa tuzilishi |
| `Alert`, `EmptyState` (`compact`), `ErrorState`, `LoadingRows`, `Skeleton`, `Badge`, `Money`, `KeyVal` | holatlar |
| `Table`/`Th`/`Td`, `Pagination` | jadval |
| `Modal` (+ `ModalCancel`), `useToast` | oyna, xabar |

## 6. Tekshirish

Har o‘zgargan ekran 1366×768 va 390 px da, o‘zbek va rus tilida ko‘riladi: kesilgan matn, yon tomonga aylantirish,
ikki qatorga tushib qolgan tugma, qatorda har xil balandlikdagi boshqaruv, 44 px dan kichik bosish maydoni yo‘q.
Barcha matn `t('…')` orqali.
