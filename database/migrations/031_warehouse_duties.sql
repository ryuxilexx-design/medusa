-- Separation of duties in the warehouse (security review 2026-10-23), enforced in the database as well as the API:
-- a controlled-drug request is approved by someone other than the requester, and an inventory count is decided by
-- someone other than the person who started it (the write-off act already has the same CHECK).
ALTER TABLE inventory_requests ADD CONSTRAINT inventory_requests_approver_not_requester
  CHECK (approved_by IS NULL OR approved_by <> requester_membership_id) NOT VALID;
ALTER TABLE inventory_counts ADD CONSTRAINT inventory_counts_decider_not_starter
  CHECK (decided_by IS NULL OR decided_by <> started_by) NOT VALID;
