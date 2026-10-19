-- Telegram bot for patients: booking, reminders, pre-visit questionnaire, "result ready" notices.
-- Business timestamps use demo_now() like the rest of the schema.

ALTER TABLE appointments
  ADD COLUMN source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'telegram')),
  ADD COLUMN patient_confirmed_at timestamptz;          -- patient pressed "I will come" in a reminder

ALTER TABLE patients
  ADD COLUMN source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'telegram'));

-- One real bot and one simulator per clinic. The token is AES-256-GCM encrypted with APP_SECRET_KEY and never leaves the server.
CREATE TABLE telegram_bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('telegram', 'simulator')),
  username text,
  token_enc text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_update_id bigint NOT NULL DEFAULT 0,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  updated_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, kind),
  CHECK (kind = 'simulator' OR token_enc IS NOT NULL)
);

-- A chat is linked to patients through a phone number that Telegram verified (contact shared by its owner).
CREATE TABLE telegram_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  bot_id uuid NOT NULL,
  chat_id bigint NOT NULL,
  tg_user_id bigint,
  phone text,
  lang text NOT NULL DEFAULT 'uz' CHECK (lang IN ('uz', 'ru')),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  blocked boolean NOT NULL DEFAULT false,                 -- the user blocked the bot (Telegram 403)
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  updated_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (bot_id, chat_id),
  FOREIGN KEY (tenant_id, bot_id) REFERENCES telegram_bots(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX telegram_chats_phone ON telegram_chats (tenant_id, phone) WHERE phone IS NOT NULL;

-- Telegram may deliver an update twice; each one is processed once.
CREATE TABLE telegram_updates (
  bot_id uuid NOT NULL REFERENCES telegram_bots(id) ON DELETE CASCADE,
  update_id bigint NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (bot_id, update_id)
);

-- Outbox: written in the same transaction as the event, delivered by a worker with retries. dedupe_key makes every notice at-most-once.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('reminder_day', 'reminder_soon', 'result_ready', 'cancelled_by_clinic', 'rescheduled_by_clinic')),
  patient_id uuid NOT NULL,
  appointment_id uuid,
  order_id uuid,
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT demo_now(),
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (tenant_id, dedupe_key),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id)
);
CREATE INDEX notifications_pending ON notifications (next_attempt_at) WHERE status = 'pending';

-- Pre-visit questionnaire. Clinical content: readable by the appointment's doctor only.
CREATE TABLE intake_forms (
  appointment_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  complaints text CHECK (length(complaints) <= 1000),
  allergies text CHECK (length(allergies) <= 500),
  medications text CHECK (length(medications) <= 500),
  submitted_at timestamptz NOT NULL DEFAULT demo_now(),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id)
);

-- Simulator transcript (demo and tests only — real Telegram messages are not stored).
CREATE TABLE telegram_sim_messages (
  id bigserial PRIMARY KEY,
  bot_id uuid NOT NULL REFERENCES telegram_bots(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  text text NOT NULL,
  markup jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX telegram_sim_messages_chat ON telegram_sim_messages (bot_id, chat_id, id);
