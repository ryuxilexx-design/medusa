# Med.uz.ai ↔ Raqamli sog‘liqni saqlash platformasi (DHP / DMED)

Holat: **integratsiyaga tayyor qatlam** (migratsiya `029_dhp.sql`, kod `apps/api/src/dhp/*`). Ma’lumot bugundan
FHIR to‘plamlari sifatida yig‘iladi va faylga eksport qilinadi; vazirlik/integrator kirish ma’lumotini bergach, jonli
yuborish sxemani o‘zgartirmasdan yoqiladi. Haqiqiy DMED/UZINFOCOM bilan **hech qachon sinalmagan** — testlar soxta
FHIR server bilan (`apps/api/test/dhp.test.mjs`).

Belgilar: **[tasdiqlangan]** — manbada ko‘rildi (2026-10-23); **[tasdiqlanmagan]** — topilmadi yoki faqat ikkinchi
qo‘l manbada.

## 1. Huquqiy asos

- **PQ-170, 05.05.2026** «Tibbiyot sohasida ko‘rsatilayotgan xizmatlar sifatini oshirish bo‘yicha qo‘shimcha chora-tadbirlar
  to‘g‘risida» — https://www.lex.uz/docs/8180707 [tasdiqlangan]. 07.05.2026 dan kuchda. Ikkinchi qo‘l manbalarda «ПП-170».
  - 4(a): **2027-yil 1-apreldan** tibbiy faoliyatni litsenziyalashda Raqamli sog‘liqni saqlash platformasiga
    **majburiy va bepul integratsiya**, Sog‘liqni saqlash vazirligining yagona talablari asosida [tasdiqlangan].
  - 5(a): Sog‘liqni saqlash vazirligi va Raqamli texnologiyalar vazirligi 3 oy ichida barcha tibbiy tashkilotlar axborot
    tizimlariga yagona talablarni tasdiqlaydi [tasdiqlangan]. Talablar matni 2026-10-23 holatida **topilmadi**.
  - 4(b): litsenziya va sifat talablariga rioya axborot tizimi orqali masofadan kuzatiladi [tasdiqlangan].
  - 5-ilova (2)(a): barcha tibbiy tashkilotlar tizimlarini integratsiya qilish muddati — 2026-yil dekabr [tasdiqlangan].
  - 3(b): 2028-yil 1-apreldan akkreditatsiyasiz nodavlat klinikalar davlat tibbiy sug‘urta fondi bilan shartnoma tuza
    olmaydi [tasdiqlangan].
  - Hujjatda «DMED» va «UZINFOCOM» nomi operator sifatida keltirilmagan; «klinika vazirlikka xat yozadi» degan tartib
    ham topilmadi [tasdiqlanmagan].
- **PQ-415, 28.12.2023** — https://lex.uz/docs/-6719038 [tasdiqlangan]: IT-Med tugatilib, vazifalari yagona integrator
  **UZINFOCOM** MChJga o‘tgan; UZINFOCOM platformani yuritadi (KfW loyihasi); sog‘liqni saqlash dasturiy ta’minotini
  yaratish UZINFOCOM bilan kelishiladi; barcha tibbiy va farmatsevtik tashkilotlar bosqichma-bosqich ulanadi.
- **VMQ №570 (2025-sentyabr)** — https://uza.uz/oz/posts/dori-vositalarini-elektron-retsept-asosida-tayinlash-tartibi-belgilandi_758532
  [tasdiqlangan]: retsept dorilari «Elektron retsept» moduli orqali; Toshkent va pilot tumanlarda 10.12.2025 dan,
  2026-yil oxirigacha butun respublikada.

## 2. Platforma va standart

- FHIR qo‘llanmasi (IG): https://build.fhir.org/ig/uzinfocom-org/digital-health-ig/en/ (manba
  github.com/uzinfocom-org/digital-health-ig). Paket `uz.dhp.core#0.11.1`, canonical
  `https://dhp.uz/fhir/core/ImplementationGuide/uz.dhp.core`, profillar `uz-core-*` [tasdiqlangan].
  **Qoralama**, «hali production uchun tayyor emas» deb belgilangan [tasdiqlangan].
  Eski havola `build.fhir.org/ig/vadi2/DHP-temp` — 404 [tasdiqlangan].
- **Muhim farq: IG FHIR R5 (5.0.0) da**, Med.uz.ai mapperlari hozir **R4** chiqaradi (vazifa talabi). Jonli ulanishdan
  oldin R5 ga o‘tkazish kerak (bitta fayl `apps/api/src/dhp/fhir.ts`): `Encounter.class` → CodeableConcept massivi,
  `Encounter.period` → `actualPeriod`, `participant.individual` → `participant.actor`, `MedicationRequest.medication` →
  CodeableReference, `DocumentReference.context` → `context` massivi; IG ning milliy slice’lari
  (`Encounter.class:dhpClass`, `Encounter.type:nationalType`) qo‘shiladi.
- Uchinchi tomon tizimlari uchun alohida «Integrations» IG bor (`https://dhp.uz/fhir/integrations/ImplementationGuide/uz.dhp.integrations`,
  https://build.fhir.org/ig/uzinfocom-org/digital-health-integration/) — mazmuni o‘qib bo‘lmadi [tasdiqlanmagan].
- API (IG «API access» sahifasi) [tasdiqlangan]:
  - Bazaviy manzillar: sinov `https://playground.dhp.uz/fhir`, ishchi `https://fhir.dhp.uz`.
  - Yozish: `POST [base]` ga `transaction` turidagi Bundle, ichki havolalar `urn:uuid:` — hammasi yoki hech narsa;
    xato bo‘lsa OperationOutcome. `PUT` uchun `If-Match` (ETag), eskirgan versiya → 412.
  - Avtorizatsiya: markaziy SSO orqali **OAuth 2.0** (`https://sso.dhp.uz/docs/uz/`): backend tizimlar uchun
    `client_credentials`, frontend uchun PKCE’li authorization code; token 3600 s; `/.well-known/jwks.json`.
    mTLS va OneID hujjatlarda yo‘q. Klient ma’lumotini kim berishi yozilmagan [tasdiqlanmagan].
  - Playground’da hali yo‘q: AuditEvent, Consent, Provenance, **DocumentReference**, `$validate-code`/`$expand`.
- Identifikator tizimlari (IG) [tasdiqlangan]:
  - PINFL: `https://dhp.uz/fhir/core/sid/pid/uz/ni` (turi NI, 14 raqam) — Med.uz.ai shu tizimni ishlatadi.
  - Mahalliy pasport: `https://dhp.uz/fhir/core/sid/pid/uz/ppn/local` (turi PPN) — ishlatiladi.
  - Tug‘ilganlik guvohnomasi `…/pid/uz/bct`, sog‘liq kartasi `…/pid/uz/hc`, chet el pasporti `…/pid/{country}/ppn`.
  - Shifokor: `https://dhp.uz/fhir/core/sid/pro/uz/argos` (HRM Argos), mutaxassis sertifikati `…/pro/uz/specialist-certificate`.
  - Tashkilot: STIR `https://dhp.uz/fhir/core/sid/org/uz/soliq`, sug‘urta fondi kodi `…/org/uz/shif` (`^[A-Z]{3}[0-9]{6}$`).
  - Condition kodlari: ICD-10 `http://hl7.org/fhir/sid/icd-10` (versiya «2019-covid-expanded») va SNOMED CT.
  - Dorilar: INN `https://terminology.dhp.uz/fhir/core/CodeSystem/inn-medication-name-cs`, ATC `http://www.whocc.no/atc`,
    ro‘yxat guvohnomasi `https://uzpharminfo.uz/registration_number`, Asl Belgisi `…/marking`, GTIN `…/gtin`.
- DMED: https://dmed.uz — «raqamli sog‘liqni saqlashning yagona operatori», futerda UZINFOCOM [tasdiqlangan].
  Xususiy klinikalar uchun eHealth: https://gov.dmed.uz (DMED ID bilan kirish → tashkilot qo‘shish, STIR va litsenziya
  tekshiriladi → xodimlar → moderatsiya) [tasdiqlangan]. «Dasturchilarga» bo‘limi bo‘sh: API hujjati, sandbox, token
  olish tartibi yo‘q [tasdiqlangan]. Elektron retsept: https://dmed.uz/products/recepts. Aloqa: info@dmed.uz,
  +998 71 202 50 00.

## 3. Med.uz.ai’da nima tayyor

| Qism | Tafsilot |
|---|---|
| Bemor kartasi | `patients.pinfl` (14 raqam, CHECK, klinika ichida noyob), `patients.id_document` (AA1234567). Registrator/rahbar kiritadi, 422 format, 409 `PINFL_TAKEN`; chop etiladigan kartada; anonimlashtirishda o‘chiriladi (trigger qaytarishga yo‘l qo‘ymaydi) |
| FHIR mapperlar | `dhp/fhir.ts`: Patient, Practitioner, Encounter, Condition (ICD-10), Observation (birlik, me’yor, H/L/N), MedicationRequest (dori nomi erkin matn, doza), DocumentReference (qo‘shimcha yozuv). Har resurs zod bilan tekshiriladi; Bundle `transaction`, har yozuv `ifNoneExist` (qayta yuborish takrorlamaydi) |
| Ma’lumotni minimallashtirish | Shikoyat, anamnez, ko‘rik, tavsiya matni yuborilmaydi. Condition — MKB-10 kodi va katalog nomi. Faqat qo‘shimcha yozuv matni (u hujjatning o‘zi) |
| Outbox | `dhp_outbox`: voqea tranzaksiyasi ichida (qayd imzosi, tahlil tasdig‘i, retsept berilishi va bekor qilinishi — 2-versiya `cancelled`, qo‘shimcha yozuv). Rejim `off` bo‘lsa hech narsa yozilmaydi. Mapper xatosi klinik amalni to‘xtatmaydi (savepoint → `failed` qator) |
| Worker | `dhp/worker.ts`: `export` → `ready`; `live` → `POST [endpoint]` Bearer token bilan: 2xx `sent`; 401/403 `failed` + sozlamada xato; boshqa 4xx `failed` (OperationOutcome matni, ≤200 belgi); 408/429/5xx/tarmoq → 1, 2, 4 … daqiqa (≤6 soat), 8 urinishdan keyin `failed`. PINFL’siz bemor → so‘rovsiz `failed` |
| API (rahbar) | `GET/PUT /dhp/settings` (token faqat yoziladi, `APP_SECRET_KEY` bilan shifrlanadi, http faqat localhost/demo), `GET /dhp/outbox?status=` (sanoq + 100 qator, FHIR yuksiz), `GET /dhp/export.ndjson?from&to` (≤31 kun, yopiq yuklab olish, audit, daqiqada 3 ta), `POST /dhp/outbox/:id/retry` (faqat `failed`, hozirgi ma’lumotdan qayta tuzadi) |
| UI | Sozlamalar → «DMED»: rejim, manzil, token, holatlar soni, PINFL’siz bemorlar soni, oxirgi xato, eksport fayli, oxirgi yozuvlar va «Qayta yuborish». Bemor formasida JShShIR va pasport maydonlari |

## 4. Jonli ulanishdan oldin nima kerak

1. **IG versiyasini tasdiqlash** va mapperlarni R5 + `uz-core-*` profillariga moslash (2-bo‘limdagi ro‘yxat);
   playground’da `$validate` bilan tekshirish.
2. **Avtorizatsiya**: SSO `client_credentials` — `token_enc` ustunida statik token o‘rniga `client_id`/`client_secret`
   (JSON, shifrlangan) saqlab, worker har soatda `/token` dan access token oladi. Sxema o‘zgarmaydi; kod `worker.ts` da.
3. Shifokorning HRM Argos identifikatori va klinikaning STIR/SHIF kodi (Practitioner/Organization) — hozir yo‘q.
4. Laboratoriya kodlari (LOINC yoki milliy) va dori INN kodlari — hozir mahalliy kod / erkin matn.
5. DocumentReference playground’da hali yo‘q — qo‘shimcha yozuvlar `ready` bo‘lib turadi.
6. Bemor roziligi: platformaga uzatish qonun talabi (PQ-170); rozilik matnida bu bandni yurist tekshirsin
   (`CONSENT_TEXT_VERSION`).

## 5. Klinika uchun qadamlar

1. https://gov.dmed.uz da DMED ID bilan kirib, tashkilotni (STIR, litsenziya) va xodimlarni ro‘yxatdan o‘tkazish.
2. UZINFOCOM (yagona integrator, PQ-415) ga Med.uz.ai integratsiyasi uchun ariza: sinov (playground) va ishchi
   kirish ma’lumoti (OAuth client). Aloqa: info@dmed.uz, +998 71 202 50 00. Kerak bo‘lsa Sog‘liqni saqlash vazirligiga
   xat — tartib rasmiy manbada topilmadi [tasdiqlanmagan].
3. Hozir: Sozlamalar → DMED → «Faqat eksport». Bemorlarga JShShIR kiritish (soni sozlamada ko‘rinadi).
4. Kirish ma’lumoti kelgach: manzil `https://playground.dhp.uz/fhir`, token, rejim «Jonli yuborish»; xatolarni ko‘rib,
   keyin ishchi manzil `https://fhir.dhp.uz`.
5. Haqiqiy bemor ma’lumoti faqat O‘zbekistondagi serverdan (`docs/DEPLOY_UZ.md`) yuboriladi — Railway demo’dan emas.
