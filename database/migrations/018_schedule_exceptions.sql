-- Days off, vacations, public holidays and one-day custom hours on top of the weekly schedule (schedules).
-- doctor_id NULL = the whole clinic (branch_id NULL = every branch, else that branch's doctors that day).
-- custom_hours replaces the weekly hours of one doctor for one day (no break). Rows may be deleted by a manager;
-- appointments that fall inside are never touched — the registrar reschedules them.
CREATE TABLE schedule_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  doctor_id uuid,
  branch_id uuid,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('day_off', 'vacation', 'holiday', 'custom_hours')),
  start_time time,
  end_time time,
  note text CHECK (note IS NULL OR length(note) <= 200),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT demo_now(),
  CHECK ((kind = 'custom_hours') = (start_time IS NOT NULL AND end_time IS NOT NULL)),
  CHECK (start_time IS NULL OR end_time > start_time),
  CHECK (kind <> 'custom_hours' OR doctor_id IS NOT NULL),
  -- a doctor's own exception applies wherever they work that day
  CHECK (doctor_id IS NULL OR branch_id IS NULL),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, id)
);
CREATE INDEX schedule_exceptions_tenant_date ON schedule_exceptions (tenant_id, date);
CREATE INDEX schedule_exceptions_doctor_date ON schedule_exceptions (doctor_id, date) WHERE doctor_id IS NOT NULL;
-- one row per doctor (or clinic/branch) and day: a second entry replaces the first
CREATE UNIQUE INDEX schedule_exceptions_one_per_day ON schedule_exceptions
  (tenant_id, coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'), coalesce(branch_id, '00000000-0000-0000-0000-000000000000'), date);
