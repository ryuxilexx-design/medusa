-- Doctor news, personal: extra topics a doctor follows (besides their own specialty), and what they saved / read.
-- Articles stay shared (news_items); only these per-person choices are stored. No clinical data here.
CREATE TABLE news_topics (
  membership_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  specialty_key text NOT NULL CHECK (specialty_key ~ '^[a-z_]{2,32}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, specialty_key),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE news_reads (
  item_id uuid NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL,
  read_at timestamptz,
  saved_at timestamptz,
  PRIMARY KEY (item_id, membership_id)
);
CREATE INDEX news_reads_saved ON news_reads (membership_id, saved_at DESC) WHERE saved_at IS NOT NULL;
