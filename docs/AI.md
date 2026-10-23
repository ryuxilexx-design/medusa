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
