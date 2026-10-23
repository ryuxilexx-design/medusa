# Med.uz.ai — AI funksiyalari

Umumiy qoida (`CLAUDE.md`): har bir model chaqiruvi faqat `AiClient.json()` orqali (zod bilan tekshirilgan JSON, `ai_usage`’da bitta qator — tokenlar va narx, hech qachon matn), bemor matni avval `redact()` dan o‘tadi, testlarda faqat soxta AI serverlari.

## Telegram bot savol-javob

**Nima uchun:** bemor botga «Konsultatsiya qancha?», «Manzilingiz?», «Yakshanba ishlaysizmi?» deb yozadi — registraturaga qo‘ng‘iroqlar kamayadi. Faqat **klinika haqida**; tibbiy savolga hech qachon javob berilmaydi.

**Kod:** `apps/api/src/telegram/faq.ts` (`BotFaq`), chaqiruvchi — `telegram/engine.ts` (menyu holatida buyruq yoki tugma bo‘lmagan matn). Model chaqiruvi chatning qulflangan tranzaksiyasidan **keyin** (COMMIT’dan so‘ng) ishlaydi. Ish vaqti `modules/booking.ts` → `workingDays()` dan (jadval + `schedule_exceptions`, `dayException` bilan bir xil ustuvorlik). Migratsiya `035_bot_faq.sql`: `telegram_faq_settings` (AI kaliti, qo‘shimcha matn ≤ 2000) va `telegram_faq_stats` (kunlik hisoblar). Demo reset sozlamani saqlaydi, hisoblarni nolga tushiradi.

**Javob tartibi:**
1. Chatga soatiga 20 ta savol (xotirada) — oshsa «juda ko‘p savol» (`limited`).
2. Tibbiy savol (uz lotin/kirill, ru kalit so‘zlar: dori, doza, og‘riq, tashxis, harorat…) — **modelsiz** qat’iy matn «Tibbiy savolga javob bera olmayman… shifokorga yoziling» + «Qabulga yozilish» tugmasi (`medical`).
3. Bilim (`knowledge()`) faqat klinikaning ma’lumotnomasidan: klinika nomi, faol filiallar (manzil, telefon), 14 kunlik ish vaqti, faol xizmatlar (umumiy narx, farq qilsa filial narxi, davomiylik), shifokorlar (mutaxassislik, hafta kunlari, filial, yo‘q kunlari), to‘lov usullari, botda yozilish/bekor qilish, rahbarning «Qo‘shimcha ma’lumot»i. **Bemor kartasi, qabullari, tahlillari o‘qilmaydi.**
4. AI route `bot_faq` (`PUBLIC_ROUTES`da — klinik matn emas): system = qoidalar + KNOWLEDGE JSON (prompt cache), user = `redact()` qilingan savol (≤ 500 belgi). Javob tili — chat tili (`answerLanguage`). Strukturali javob: `{answer, answerable, medical, suggest: book|prices|contacts|none, facts_used[]}`.
5. Server tekshiruvi: `medical=true` → 2-banddagi matn; `answerable=false` → «Buni registratordan so‘rang: <birinchi filial telefoni>»; javobdagi **har bir son** (telefon — oxirgi 9 raqam, vaqt HH:MM, narx «150 000» / «150.000» / «150 ming», sana, boshqa sonlar; 0–10 ruxsat) bilimda bo‘lmasa ham shu matn (`fallbacks`). O‘tsa — javob + «ℹ️ Avtomatik javob…» + tugmalar (`ai_answered`).
6. Modelsiz yo‘l (AI `off`/`sample`, kalit yo‘q, rahbar o‘chirgan, byudjet tugagan, model xatosi, production’da Gemini bepul tarifi): kalit so‘zlar bo‘yicha narx / manzil / ish vaqti / shifokorlar / telefon / to‘lov bo‘limlari o‘sha bilimdan (`keyword_answered`); tushunilmasa — «tushunmadim» + «Narxlar» tugmasi (`fallbacks`).

Har javob ostida «📞 Registrator bilan bog‘lanish» (`faq:reg` — filiallar telefoni). `faq:book` — oddiy yozilish oqimi, `faq:prices` — narxlar ro‘yxati. Bu tugmalar modelni chaqirmaydi.

**Rahbar:** Sozlamalar → Telegram → «Savollarga javob»: «AI javoblari» (NULL = standart: demo’da yoqilgan, production’da klinika yoqmaguncha o‘chiq), «Qo‘shimcha ma’lumot», bugun va 7 kun hisoblari. API: `GET/PUT /telegram/faq` (faqat rahbar; auditda matnning o‘zi yo‘q, faqat uzunligi).

**Saqlanmaydi:** savol va javob matni (na bazada, na `ai_usage`’da, na auditda, na logda). Faqat kunlik sonlar.

**Cheklovlar:** tibbiy kalit so‘zlar ro‘yxati to‘liq emas — model ham `medical` bayrog‘i bilan ushlaydi; sonlar tekshiruvi sonning *bilimda borligini* tekshiradi, uning to‘g‘ri xizmat/kunga tegishliligini emas; soatlik cheklov bitta API jarayoni xotirasida (bir nechta instansda har biri o‘zicha).

**Testlar:** `apps/api/test/bot-faq.test.mjs` — soxta Claude serveri + simulyator transporti.

# Med.uz.ai — AI: what each feature sends to the model

All model calls go through `AiClient.json()` (`apps/api/src/ai/ai-client.ts`): one provider (`AI_PROVIDER=anthropic` or
`gemini`), structured JSON validated with zod, one `ai_usage` row per call (route, model, tokens, cost, latency,
outcome — **never the prompt or the answer**), a per-clinic daily budget (`AI_DAILY_LIMIT_USD`, default 5 USD).
`AI_MODE=off | sample | live`; `sample` never calls a model and is labelled «Namunaviy». Speech-to-text is separate
(`SttClient`, `docs/VOICE_SCRIBE.md`).

| Feature (route) | Who | What leaves the server | Guards |
|---|---|---|---|
| Note draft (`note_draft`) | doctor of the visit | the doctor's own free text, de-identified by `redact()` (patient names, birth date, patient number, phones → placeholders) | clinical: production needs `AI_CLINICAL_ALLOWED=1`; Gemini free tier only for the seed demo clinics on a non-production server; output is a draft, nothing saved |
| ICD-10 suggestion (`icd10_suggest`) | doctor | the diagnosis text (de-identified) + the ICD-10 code list (cached system prompt) | clinical (as above); returned codes must exist in `icd10_codes` |
| Specialty news (`news_summary`) | doctors (job) | public PubMed titles and abstracts | public route; no clinic data; abstracts are not stored |
| Dictation (STT, not `AiClient`) | doctor | audio to the STT server (`local` on the clinic's machine, or `openai`) | `openai` gated like clinical AI; audio never stored |
| **Daily digest** (`manager_digest`) | manager | a **fact sheet**: numbers computed by SQL for one Tashkent day and branch scope (net revenue cash basis net of refunds, payments by method, refunds, visits done / no-show / cancelled, new patients, top 5 services by net revenue, visits per doctor, open debts, low-stock / expiring / expired batches, pending warehouse requests, approvals and write-offs, open camera security alerts, unverified lab results, cancelled visits with an open invoice, failed Telegram/SMS notices, missing fiscal receipts), the same weekday a week earlier, and precomputed differences — plus names of **doctors, services**. **No patient name, phone, ID or clinical text.** | non-clinical (`PUBLIC_ROUTES`): works in production without `AI_CLINICAL_ALLOWED`; never to the Gemini free tier for a real clinic (`businessBlock`); budget; regenerate ≤ 5 per clinic per day |
| **Ask the numbers** (`manager_ask`) | manager | call 1 (plan): the manager's question (through `redact()`), today's date, the manager's branch names/ids and the list of report templates. Call 2 (answer): the question and the **rows of the chosen template** as facts (numbers + names of doctors, services, items, expense categories, branches, ICD-10 *group codes*). | same as the digest; the model never writes SQL |

## The manager's AI in detail (`ai/manager-facts.ts`, `ai/manager-ask.ts`, `modules/ai-manager.controller.ts`)

- **Numbers come from SQL only.** The digest reuses the dashboard formulas (`REVENUE_SQL`, `DEBT_SQL`, `NET_LINE`,
  `STOCK_SQL`, `cameraAttention`). Money goes to the model in whole so‘m; differences and percentages are computed on
  the server — the prompt forbids arithmetic.
- **Every number is checked.** The model returns `bullets[{text, fact_keys[]}]` and `alerts[{text, fact_keys[],
  severity}]`. The server drops an item when a cited key does not exist or when any number in its text (`1 250 000`,
  `1,3 mln`, `12%`; digits inside a cited doctor/service name are ignored) differs from the cited facts. If no bullet
  survives, the deterministic template digest is shown. The answer of «ask» is checked the same way.
- **Cache:** `ai_digests` (migration 034) keeps one digest per clinic, branch scope, day and language; opening the
  dashboard reads it. «Qayta yaratish» replaces it; `ai_digest_runs` limits that to 5 per clinic per Tashkent day
  (attempts count). AI off or sample → a template digest from the same facts, labelled «AI o‘chiq» / «Namunaviy».
  A failing model on first open → the template digest with the reason (not cached).
- **Ask:** the model picks ONE template — `revenue` (day ≤ 31 days / month / branch / method / doctor / service),
  `visits` (doctor / day), `top_services`, `debts_ageing`, `refunds` (reason / method / day), `expenses`,
  `warehouse_consumption` (item / doctor / ICD group — codes only), `stock` (low / expiring in 1–180 days),
  `staff_lateness` (camera attendance vs schedule), `patient_flow` (by hour), `new_vs_returning` — and typed
  parameters. The server refuses an unknown template, an unknown parameter, a period over one year, in the future or
  reversed, a limit outside 1–20, a branch outside the session scope; the reply is «buni hali so‘ray olmayman» with
  the list of what can be asked. The dashboard's example chips send a fixed template, so they work without AI.
- **Logs:** `ai_usage` has no text; the audit records `Shablon: <id>` or the refusal reason — never the question.

Tests: `apps/api/test/ai-manager.test.mjs` (fake Claude and Gemini servers — never a real key).
