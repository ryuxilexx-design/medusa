-- 034: the manager's AI (docs/AI.md). Non-clinical: the model sees a fact sheet of numbers built by SQL (revenue,
-- visits, debts, stock…) plus doctor/service/item names — never a patient name or clinical text.

-- One digest per clinic, branch scope, day and interface language. Opening the dashboard reads this row instead of
-- calling the model again; «regenerate» replaces it. `facts` is the sheet the text was written from (numbers only),
-- `digest` the checked bullets ({bullets:[{text,fact_keys}], alerts:[{text,fact_keys,severity}]}).
CREATE TABLE ai_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope_key text NOT NULL,                 -- sorted branch ids of the scope, comma-joined
  branch_ids uuid[] NOT NULL,
  day date NOT NULL,
  locale text NOT NULL CHECK (locale IN ('uz', 'uz-Cyrl', 'ru')),
  facts jsonb NOT NULL,
  digest jsonb NOT NULL,
  model text,
  dropped integer NOT NULL DEFAULT 0,      -- model bullets removed by the number/fact check
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT demo_now(),
  UNIQUE (tenant_id, scope_key, day, locale)
);

-- Regenerations per clinic and Tashkent day (rate limit). No text, only who and when.
CREATE TABLE ai_digest_runs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT demo_now()
);
CREATE INDEX ai_digest_runs_day ON ai_digest_runs (tenant_id, created_at);

-- the digest counts failed patient notices of a day
CREATE INDEX IF NOT EXISTS notifications_failed ON notifications (tenant_id, created_at) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS sms_messages_failed ON sms_messages (tenant_id, created_at) WHERE status IN ('failed', 'undelivered');
