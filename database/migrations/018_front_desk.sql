-- Front desk audit (2026-10-22): a booking confirmation to the patient when the registrar books, and the branch phone
-- printed on the appointment slip.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder_day', 'reminder_soon', 'result_ready', 'cancelled_by_clinic', 'rescheduled_by_clinic', 'booked'));
ALTER TABLE branches ADD COLUMN IF NOT EXISTS phone text CHECK (phone IS NULL OR length(phone) BETWEEN 5 AND 40);
