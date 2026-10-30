MED.UZ.AI <- MEDPLUS KO'PRIGI: KLINIKADA BIRINCHI QADAM
=======================================================

Bugungi maqsad: MedPlus bazasining TUZILISHINI (jadval va ustun nomlarini) olish.
Bugun hech narsa Med.uz.ai'ga yuborilmaydi va MedPlus'da hech narsa o'zgarmaydi.
schema.json faylida bemor ismi, telefon yoki summa BO'LMAYDI - faqat jadval/ustun nomlari va qatorlar soni.

Kerak bo'ladi:
  - MedPlus o'rnatilgan server kompyuter (OSPanel turgan kompyuter, MedPlus manzili 192.168.0.249)
  - MySQL root paroli (klinika IT xodimida). Root parolini bizga BERMANG - u faqat 2-qadamda kerak.
  - 20-30 daqiqa

1-QADAM. Papkani joylash
  Zip'ni server kompyuterda C:\medplus-bridge ga oching (ichida bridge.mjs, node\, node_modules\ bo'ladi).

2-QADAM. Faqat o'qiydigan MySQL foydalanuvchisi
  a) MedPlus bazasi nomini toping: phpMyAdmin chap ro'yxatida yoki
     D:\OSPanel\domains\clinic ichidagi sozlama faylida (config.php / db.php / .env - "dbname" yoki "database").
  b) OSPanel -> Дополнительно -> phpMyAdmin -> root bilan kiring -> yuqorida "SQL".
  c) 0-readonly-user.sql ni Notepad'da oching. "clinic" ni baza nomiga, KUCHLI_PAROL ni yangi parolga almashtiring,
     hammasini phpMyAdmin'ga qo'yib "Вперёд" bosing. Oxirida faqat "GRANT SELECT" va "USAGE" chiqishi kerak.
  Bu foydalanuvchi MedPlus'da hech narsani o'zgartira olmaydi va o'chira olmaydi.

3-QADAM (A). Tuzilishni olish - asosiy yo'l
  1-probe.bat ni ikki marta bosing.
  - Birinchi safar config.json yaratiladi va Notepad ochiladi. "mysql" bo'limiga yozing:
        "user": "medplus_ro", "password": "<2-qadamdagi parol>", "database": "<baza nomi>"
    ("server", "source_id", "token" ga bugun TEGMANG.) Saqlang, Notepad'ni yoping.
  - 1-probe.bat ni yana bosing. "Tayyor: ...\schema.json" chiqadi.

3-QADAM (B). Zaxira yo'l (1-probe.bat xato bersa yoki Windows 7/8 bo'lsa)
  phpMyAdmin -> chapda MedPlus bazasi -> SQL -> probe-phpmyadmin.sql matnini qo'ying -> "Вперёд"
  -> pastda "Экспорт" -> CSV -> faylni saqlang.

4-QADAM. Yuborish
  schema.json (yoki CSV) ni oching va ko'zdan kechiring: faqat jadval/ustun nomlari va sonlar bo'lishi kerak.
  Keyin uni Med.uz.ai jamoasiga yuboring. Biz 1-2 kunda queries.json tayyorlab beramiz.

KEYINGI SAFAR (biz queries.json yuborganimizdan keyin)
  2-dry-run.bat - sinov o'qish: faqat sonlar chiqadi, hech narsa yuborilmaydi. dry-run.txt ni yuboring.
  Haqiqiy ulanish (token, rejalashtirilgan vazifa) faqat O'zbekistondagi Med.uz.ai serveri tayyor bo'lgandan keyin.

QILMANG
  - root parolini config.json ga yozmang (faqat medplus_ro).
  - config.json ni hech kimga yubormang (ichida parol bor).
  - Bugun "server"/"token" ni to'ldirmang va Task Scheduler'ga qo'shmang.

Muammo bo'lsa: qora oynadagi xabarni suratga olib yuboring.
