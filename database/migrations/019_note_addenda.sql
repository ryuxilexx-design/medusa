-- Addendum (qo‘shimcha yozuv) to a signed clinical note. The signed note itself stays immutable (001_core.sql);
-- a correction or a later observation is a new, separately signed row under it. Addenda are append-only:
-- no UPDATE, no DELETE — a wrong addendum is answered by another addendum.

CREATE TABLE note_addenda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  encounter_id uuid NOT NULL,
  note_id uuid NOT NULL REFERENCES clinical_notes(id),
  doctor_id uuid NOT NULL,
  author_membership_id uuid,
  author_name text NOT NULL,
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  -- the author signs the addendum at the moment it is written (same instant as created_at)
  signed_at timestamptz NOT NULL DEFAULT demo_now(),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id),
  FOREIGN KEY (tenant_id, author_membership_id) REFERENCES memberships(tenant_id, id)
);
CREATE INDEX note_addenda_note ON note_addenda (note_id, created_at);

CREATE FUNCTION forbid_note_addendum_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'note addendum is immutable' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER note_addenda_immutable BEFORE UPDATE OR DELETE ON note_addenda
  FOR EACH ROW EXECUTE FUNCTION forbid_note_addendum_change();
