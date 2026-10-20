-- Patients may read the bot in Uzbek Cyrillic too (older patients often do); texts are derived from the Latin ones.
ALTER TABLE telegram_chats DROP CONSTRAINT IF EXISTS telegram_chats_lang_check;
ALTER TABLE telegram_chats ADD CONSTRAINT telegram_chats_lang_check CHECK (lang IN ('uz', 'uz-Cyrl', 'ru'));
