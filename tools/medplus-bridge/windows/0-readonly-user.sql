-- Med.uz.ai ko'prigi uchun FAQAT O'QIYDIGAN MySQL foydalanuvchisi.
-- Qayerda ishlatiladi: OSPanel -> phpMyAdmin (yoki HeidiSQL) -> root bilan kiring -> "SQL" oynasi.
-- Ishlatishdan oldin 2 ta narsani almashtiring:
--   clinic          -> MedPlus bazasining haqiqiy nomi (phpMyAdmin chap ro'yxatida ko'rinadi)
--   KUCHLI_PAROL    -> kamida 16 belgili yangi parol (uni config.json ga yozasiz, boshqa joyga emas)
-- Bu foydalanuvchi faqat SELECT qila oladi: MedPlus'dagi hech narsani o'zgartira olmaydi va o'chira olmaydi.

CREATE USER 'medplus_ro'@'127.0.0.1' IDENTIFIED BY 'KUCHLI_PAROL';
CREATE USER 'medplus_ro'@'localhost' IDENTIFIED BY 'KUCHLI_PAROL';
GRANT SELECT ON `clinic`.* TO 'medplus_ro'@'127.0.0.1';
GRANT SELECT ON `clinic`.* TO 'medplus_ro'@'localhost';
FLUSH PRIVILEGES;

-- Tekshirish: quyidagi natijada faqat "GRANT SELECT" va "USAGE" bo'lishi kerak.
SHOW GRANTS FOR 'medplus_ro'@'127.0.0.1';
