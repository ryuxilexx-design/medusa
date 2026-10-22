# Instagram videolari (Reels, 1080×1920)

Beshta 20–30 soniyalik video: `navbat`, `shifokor`, `kassa`, `kamera`, `nega`. Har biri — birinchi 2 soniyada savol
(hook), ilovaning haqiqiy ekranlari (`public/shots`, puppeteer bilan lokal demodan olinadi), jumla-jumla subtitr,
ayol ovozi, oxirida logotip va «Bepul demo → med.uz.ai».

## Qayta yasash

```bash
cd marketing/videos
npm install                              # Remotion 4 (node_modules va chrome-headless-shell)
python3 -m pip install --user edge-tts   # ovoz: Microsoft neyro ovozi uz-UZ-MadinaNeural (bepul, kalitsiz)
python3 scripts/voice.py                 # public/audio/*.mp3 + *.json (jumla vaqtlari)
npx remotion studio                      # jonli ko‘rish va tahrir
npx remotion render src/index.ts navbat out/navbat.mp4   # bitta video
```

Matnlar `scripts/voice.py` (ovoz) va `src/data.ts` (hook, ekran sarlavhalari, solishtirish) da. Ekranlar
(`public/shots/*.png`) ilova o‘zgarganda `e2e` uslubidagi puppeteer skripti bilan qayta olinadi (390×844 @3x va
1366×768 @2x, `prefers-reduced-motion`).

Remotion yuklab olgan headless Chrome bu Mac’da root komponentni yuklay olmadi — `remotion.config.ts` tizimdagi
Chrome’ni ko‘rsatadi.

## Litsenziya eslatmalari

- **Remotion**: 4 va undan ko‘p xodimli kompaniya uchun kompaniya litsenziyasi kerak (remotion.pro). Hozir sinov.
- **Ovoz**: edge-tts Microsoft Edge’ning «Read Aloud» xizmatidan foydalanadi — rasmiy API emas. Reklama uchun
  Azure Speech (xuddi shu Madina ovozi, pullik) orqali qayta yozdirish to‘g‘riroq.
- **Raqobatchilar**: `nega` videosida DMED va Med Plus nomi bilan, faqat ularning o‘z sahifalaridagi tavsif
  (DMED — davlatning yagona elektron tibbiy kartasi; Med Plus — klinika hisob-kitob tizimi) aytiladi, kamsituvchi
  da’vo yo‘q. O‘zbekiston «Reklama to‘g‘risida»gi qonuni raqobatchini nomlab solishtirishga ehtiyotkorlik talab
  qiladi — e’lon qilishdan oldin yuristga ko‘rsating; xohlasangiz nomlarsiz variantini ham qilamiz.
- Musiqa qo‘shilmagan (litsenziyali trek yo‘q); Instagram’ning o‘z kutubxonasidan qo‘shish mumkin.
