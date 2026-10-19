-- Real staff authentication (login + password) next to the demo role cards.
-- Passwords are stored only as scrypt hashes; temporary passwords force a change on first login.

ALTER TABLE users
  ADD COLUMN login text,                                   -- normalised phone (+998XXXXXXXXX) or lowercase username
  ADD COLUMN password_hash text,                           -- 'scrypt$N$r$p$salt$hash'; NULL = password login disabled
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN failed_logins integer NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN last_login_at timestamptz;

CREATE UNIQUE INDEX users_login_unique ON users (login) WHERE login IS NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_login_lower CHECK (login = lower(login));
-- Staff created by a clinic manager sign in by phone/username; e-mail becomes optional.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

ALTER TABLE memberships
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE sessions
  ADD COLUMN kind text NOT NULL DEFAULT 'demo' CHECK (kind IN ('demo', 'password')),
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX sessions_membership ON sessions (membership_id);
