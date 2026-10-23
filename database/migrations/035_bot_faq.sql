-- Telegram bot answers patients' questions about the clinic (prices, addresses, hours, doctors) — never medicine.
-- Per clinic: the AI switch (NULL = the deployment's default: on in the demo, off in production until the manager
-- turns it on) and the manager's own extra text (parking, documents, test preparation). Daily counters only:
-- question texts are never stored.
CREATE TABLE telegram_faq_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  ai_enabled boolean,
  extra_text text NOT NULL DEFAULT '' CHECK (length(extra_text) <= 2000),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT demo_now()
);

CREATE TABLE telegram_faq_stats (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  day date NOT NULL,                                  -- Asia/Tashkent day
  ai_answered integer NOT NULL DEFAULT 0,             -- the model answered and every number checked out
  keyword_answered integer NOT NULL DEFAULT 0,        -- answered without a model (AI off / sample / switched off)
  fallbacks integer NOT NULL DEFAULT 0,               -- «ask the registrar»: unanswerable, unverified number, AI error
  medical integer NOT NULL DEFAULT 0,                 -- medical question deflected to a doctor
  limited integer NOT NULL DEFAULT 0,                 -- over the per-chat hourly limit
  PRIMARY KEY (tenant_id, day)
);
