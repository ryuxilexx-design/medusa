# Med.uz.ai — shifokor ovozli diktovkasi (voice scribe)

Shifokor qaydni yozish o‘rniga aytib beradi (o‘zbekcha lotin yoki ruscha). Bemor ovozi va shifokor aytgan klinik
matn — **sog‘liq ma’lumoti**. Shuning uchun sukut bo‘yicha yo‘l: ovoz **klinikaning o‘z serveridan
(O‘zbekiston) chiqmaydi** — nutqni aniqlash shu serverdagi `stt` konteynerida ishlaydi.

## Qanday ishlaydi

1. Shifokor sahifasida har maydon ostida **«Aytib yozish»** tugmasi, yuqorida **«Butun qaydni aytib berish»**.
   Brauzer `MediaRecorder` bilan yozadi (webm/opus, Safari’da mp4), ekranda taymer, eng ko‘pi **3 daqiqa**
   (3:00 da o‘zi to‘xtab yuboradi), «Bekor qilish», «Yuborilmoqda…». Yozish paytida nutq tilini (O‘zbekcha /
   Ruscha) almashtirish mumkin; sukut — shifokor interfeysi tili.
2. Yozuv `POST /api/v1/dictation` ga yuboriladi (multipart: `audio`, `field`, `encounter_id`, `language`).
   Server: faqat shifokor roli, faqat **davolovchi shifokor** (boshqa shifokorning qabuli 403, boshqa klinika 404),
   hajm ≤ 20 MB (413), tur webm/ogg/mp4/wav/mp3 — e’lon qilingan tur fayl baytlariga mos bo‘lishi shart (415),
   har shifokorga soatiga 30 ta (429 `STT_RATE`).
3. API yozuvni **xotiradan** OpenAI-mos `POST /v1/audio/transcriptions` ga uzatadi (`apps/api/src/ai/stt.ts`).
   Diskka, bazaga, jurnalga yozilmaydi; javobdan keyin bufer tashlanadi.
4. Matn tozalanadi: o‘zbekcha apostroflar (o‘ g‘ ’), Whisper sukunatda «eshitadigan» subtitr iboralari
   («Продолжение следует…», «Субтитры сделал …») olib tashlanadi; bo‘sh qolsa — 422 «Nutq aniqlanmadi».
5. Maydon rejimida matn kursor turgan joyga (shifokor maydondan to‘g‘ridan-to‘g‘ri mikrofon tugmasiga o‘tgan bo‘lsa)
   yoki maydon oxiriga yangi qatordan qo‘shiladi. «Butun qayd» rejimida (`structure=1`) matn mavjud **AI qayd
   loyihasi** (`note_draft`) orqali 5 bo‘limga ajratiladi — barcha AI qoidalari amal qiladi (`clinicalMode`,
   `AI_CLINICAL_ALLOWED`, Gemini bepul tarifi, kunlik limit, `redact()`), so‘ng odatdagi «Qoldirish / Almashtirish /
   Qo‘shish» oynasi. AI o‘chiq yoki rad etsa, matn baribir qaytadi va shifokor uni bitta maydonga qo‘yadi.
6. Hech narsa avtomatik saqlanmaydi yoki imzolanmaydi: shifokor matnni tekshiradi, keyin «Qoralamani saqlash».

Hisob-kitob: har diktovka `ai_usage` da bitta qator (`route = 'dictation'`, model, `audio_seconds`, kechikish,
natija, bulut uchun narx) — **matn hech qachon yozilmaydi**. Audit: «Ovozli diktovka: N s (model)» — matnsiz.

## Provayderlar (`STT_PROVIDER`)

| Qiymat | Qayerda | Klinik ovoz uchun |
|---|---|---|
| `off` (sukut) | — | Tugmalar ko‘rinmaydi, asboblar panelida qisqa sabab |
| `local` | Klinika serveridagi `stt` (speaches / faster-whisper) yoki boshqa OpenAI-mos server, `STT_BASE_URL` | Har doim ruxsat (ovoz serverdan chiqmaydi) |
| `openai` | OpenAI bulut API, `OPENAI_API_KEY` | `APP_MODE=production` da faqat `AI_CLINICAL_ALLOWED=1` bilan (aks holda 503 `STT_DISABLED_PRODUCTION`); kunlik `AI_DAILY_LIMIT_USD` ga kiradi |

`/me` → `dictation_mode` (`off` / `local` / `cloud`) va `dictation_off_reason`.

Sozlamalar: `STT_MODEL` (sukut), `STT_MODEL_UZ`, `STT_MODEL_RU` (tilga alohida model), `STT_API_KEY` (mahalliy
server kalit so‘rasa), `STT_TIMEOUT_MS` (sukut 120 000), `STT_RATE_PER_HOUR` (sukut 30). O‘rnatish:
`docs/DEPLOY_UZ.md` § 6b.

## Aniqlik: o‘zbek tili haqida ogohlantirish

- **Standart Whisper o‘zbekchada yaroqsiz**: Whisper maqolasida large-v2 ning FLEURS o‘zbekcha WER’i **90,2 %**
  (ruscha 5,6 %). large-v3 «10–20 % kamroq xato» deydi, til bo‘yicha raqam bermaydi; BuzzASR kartasida large-v3
  ning o‘zbekcha CER’i ≈ 28 %. turbo ba’zi tillarda large-v2 dan ham yomonroq — o‘zbekcha raqam topilmadi.
- **Ruscha** uchun `Systran/faster-whisper-large-v3` yaxshi (turbo ham yetarli).
- **O‘zbekcha** uchun fine-tune kerak (CTranslate2 formatida, faster-whisper uchun): masalan
  `AlexAnoshka/fast-whisper-uz-rubaistt-v2-medium-ct2` (rubaistt v2 medium, Apache-2.0, WER ≈ 17 %) yoki
  `navai-uz/whisper-medium-uzbek` (Apache-2.0, makro-WER 9,7 %; CT2 ga o‘zingiz o‘giring:
  `ct2-transformers-converter --model navai-uz/whisper-medium-uzbek --quantization int8 --output_dir …`).
  Faqat o‘zbekchaga o‘qitilgan model ruschada yomonlashadi — shuning uchun `STT_MODEL_UZ` va `STT_MODEL_RU` alohida.
- Tibbiy atamalar, dori nomlari va raqamlar (bosim, doza) eng ko‘p xato bo‘ladigan joy. Whisper’ga til bo‘yicha
  qisqa namunaviy `prompt` beriladi (lotin yozuvi, raqamlar raqam bilan), lekin bu kafolat emas.
- Kirill yozuvidagi o‘zbekcha javob avtomatik lotinga o‘girilmaydi (ma’lumot transliteratsiya qilinmaydi).
- **Shifokor har doim tekshiradi.** Diktovka — qoralama; imzo shifokorniki. Modelni tanlashdan oldin klinikaning
  o‘z yozuvlarida (shovqin, shevalar, aralash o‘zbek-rus nutqi) sinab ko‘ring.

## Maxfiylik

- Ovoz faqat API xotirasida, bitta so‘rov davomida. Brauzerda ham faqat yuborilgunga qadar xotirada
  (localStorage/IndexedDB yo‘q).
- `local` provayder `stt` konteyneri: tashqariga port ochilmaydi, faqat `app` ulanadi; modellar yuklab olingach
  `STT_OFFLINE=1` — server internetga chiqmaydi.
- `openai` — chegaradan tashqariga uzatish: bemor rozilik matni va shartnoma buni qamrab olishi shart
  (yurist bilan); production’da `AI_CLINICAL_ALLOWED=1` siz server o‘zi rad etadi.
- Mikrofon ruxsati brauzerda; rad etilgan bo‘lsa, tugmalar yonida «mikrofonga ruxsat yo‘q» va ruxsat berish yo‘li.
  Brauzer mikrofonni faqat HTTPS (yoki localhost) da beradi.

## Tadqiqot (2026-10-23)

- Whisper maqolasi (FLEURS WER, large-v2: o‘zbek 90,2 %, rus 5,6 %): https://arxiv.org/pdf/2212.04356
- large-v3 kartasi (Apache-2.0, umumiy yaxshilanish): https://huggingface.co/openai/whisper-large-v3 ·
  turbo e’loni (ba’zi tillarda yomonlashadi): https://github.com/openai/whisper/discussions/2363
- O‘zbekcha fine-tune’lar: https://huggingface.co/navai-uz/whisper-medium-uzbek ·
  https://huggingface.co/islomov/rubaistt_v2_medium (CT2: `AlexAnoshka/fast-whisper-uz-rubaistt-v2-medium-ct2`) ·
  https://huggingface.co/BuzzASR/uzbek (large-v3 asosida, MIT). ISSAI — USC korpusi (105 soat, CC BY 4.0), tayyor
  Whisper modeli topilmadi: https://issai.nu.edu.kz/2021/08/06/issai-team-has-developed-the-uzbek-speech-corpus/
- OpenAI-mos serverlar: **speaches** (avvalgi faster-whisper-server), `ghcr.io/speaches-ai/speaches:0.8.3-cpu`,
  port 8000, `language` va `verbose_json` (`duration` bilan): https://speaches.ai/installation/ ·
  https://speaches.ai/configuration/ . **whisper.cpp server** — `--request-path /v1/audio --inference-path
  /transcriptions` bilan shu yo‘lni beradi, ggml modellar: https://github.com/ggml-org/whisper.cpp
- Tezlik (faster-whisper README, 13 daqiqalik audio): GPU RTX 3070 Ti large-v2 int8 — 59 s (2,9 GB VRAM);
  CPU i7-12700K 8 oqim, **small** int8 — 1 min 42 s (1,5 GB RAM). https://github.com/SYSTRAN/faster-whisper .
  Bizning baho (o‘lchanmagan): 1–2 daqiqalik yozuv CPU’da medium int8 ≈ 20–60 s, large-v3 int8 ≈ 1–2 min
  (3–4 GB RAM); GPU’da bir necha soniya.
- OpenAI narxi (daqiqasiga): whisper-1 va gpt-4o-transcribe 0,006 $, gpt-4o-mini-transcribe 0,003 $:
  https://developers.openai.com/api/docs/pricing

Tekshirilmagan: speaches ixtiyoriy Hugging Face CT2 repozitoriyasini (registrida yo‘q modelni) yuklay olishi,
o‘zbekcha turbo fine-tune’larning WER’i, CPU’da large-v3 ning aniq tezligi — birinchi o‘rnatishda o‘lchang.

## Testlar

`apps/api/test/dictation.test.mjs` — soxta OpenAI-mos STT server va soxta Claude bilan: shifokor 200, boshqa
rollar 403, boshqa shifokorning qabuli 403, 413/415/422, `off` → 503, production + `openai` →
`STT_DISABLED_PRODUCTION` (mahalliy ishlaydi), `ai_usage` va auditda matn yo‘q, tezlik chegarasi 429,
`structure=1` → loyiha (bemor ismi `[bemor]`), namunaviy rejimda `draft_error`. Haqiqiy nutq xizmati chaqirilmaydi.
