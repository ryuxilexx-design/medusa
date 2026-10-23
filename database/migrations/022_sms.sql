-- SMS channel (Eskiz.uz) for patients without Telegram (audit 2026-10-22: they got no notices at all).
-- The same outbox carries both channels; a notice is at-most-once per channel.
ALTER TABLE notifications ADD COLUMN channel text NOT NULL DEFAULT 'telegram' CHECK (channel IN ('telegram', 'sms'));
ALTER TABLE notifications DROP CONSTRAINT notifications_tenant_id_dedupe_key_key;
ALTER TABLE notifications ADD CONSTRAINT notifications_tenant_channel_dedupe_key UNIQUE (tenant_id, channel, dedupe_key);

-- One Eskiz account per clinic. The password is AES-256-GCM encrypted with APP_SECRET_KEY and never returned by the API.
CREATE TABLE sms_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  eskiz_email text CHECK (eskiz_email IS NULL OR length(eskiz_email) BETWEEN 3 AND 120),
  password_enc text,
  sender text NOT NULL DEFAULT '4546' CHECK (length(sender) BETWEEN 1 AND 20),
  enabled boolean NOT NULL DEFAULT false,
  last_error text,
  last_error_at timestamptz,
  balance_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  updated_at timestamptz NOT NULL DEFAULT demo_now(),
  CHECK (NOT enabled OR (eskiz_email IS NOT NULL AND password_enc IS NOT NULL))
);

-- Delivery log. Privacy: only the notice kind, the phone and the provider's status — never the message text.
CREATE TABLE sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  notification_id uuid REFERENCES notifications(id) ON DELETE SET NULL,   -- NULL for a manager's test message
  kind text NOT NULL,
  phone text NOT NULL,
  provider_id text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'undelivered', 'failed')),
  error text,
  parts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  updated_at timestamptz NOT NULL DEFAULT demo_now()
);
CREATE INDEX sms_messages_tenant_day ON sms_messages (tenant_id, created_at DESC);
CREATE INDEX sms_messages_pending_status ON sms_messages (tenant_id, created_at) WHERE status = 'sent' AND provider_id IS NOT NULL;
