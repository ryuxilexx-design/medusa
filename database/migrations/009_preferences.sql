-- Interface language and text size. A real staff account keeps them on the user (they follow the person to any
-- device); demo role cards are shared by many visitors, so there the choice lives on the session only.
ALTER TABLE users
  ADD COLUMN locale text CHECK (locale IN ('uz', 'uz-Cyrl', 'ru')),
  ADD COLUMN text_size text CHECK (text_size IN ('normal', 'large'));

ALTER TABLE sessions
  ADD COLUMN locale text CHECK (locale IN ('uz', 'uz-Cyrl', 'ru')),
  ADD COLUMN text_size text CHECK (text_size IN ('normal', 'large'));
