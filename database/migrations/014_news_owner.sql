-- Per-person news marks belong to the person: when a membership goes (a demo reset truncates memberships with
-- CASCADE), their read/saved marks and article ratings go too. NOT VALID: old rows are kept as they are.
ALTER TABLE news_reads ADD CONSTRAINT news_reads_membership_fkey
  FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE news_feedback ADD CONSTRAINT news_feedback_membership_fkey
  FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE NOT VALID;
