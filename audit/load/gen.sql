-- Synthetic bulk data for the load audit. Runs ONLY against meduza_load_test (see psql.sh).
-- Scale: +1 branch, +64 doctors, +16 registrars/cashiers, 100k patients, ~1M appointments over 3 years,
-- invoices/payments/orders/lab results for visits, ~2.4M camera events, ~2.7M audit rows.
-- Demo "now" = 2026-10-18 06:30Z (11:30 Asia/Tashkent).
\set ON_ERROR_STOP 1
\timing on
SET synchronous_commit = off;
SET work_mem = '256MB';
SET maintenance_work_mem = '512MB';
SELECT setseed(0.42);
DO $$ BEGIN IF current_database() <> 'meduza_load_test' THEN RAISE EXCEPTION 'wrong database %', current_database(); END IF; END $$;

-- constants
CREATE TEMP TABLE k AS SELECT
  'c04df94a-e1ae-5d29-a395-ddc2c31d6d0e'::uuid AS t,
  'e4b7b3a7-a1e1-5656-a30e-b5242a5ea8d9'::uuid AS b1,
  '28105494-3373-53d1-b267-b3832c1756b8'::uuid AS b2,
  'a0000000-0000-4000-8000-000000000003'::uuid AS b3,
  '96806128-c685-515d-beb8-a777eb562a19'::uuid AS mgr,
  '2026-10-18 06:30:00+00'::timestamptz AS now_ts,
  '2026-10-17 19:00:00+00'::timestamptz AS today_start;

BEGIN;
INSERT INTO branches (id, tenant_id, name, code, address) SELECT b3, t, 'Chilonzor filiali', 'CHL', 'Toshkent, Chilonzor' FROM k;
UPDATE memberships SET branch_ids = branch_ids || (SELECT b3 FROM k)
 WHERE id IN ('96806128-c685-515d-beb8-a777eb562a19','c8b9bc9d-e4d6-5c9c-b672-2ccfed7505d1','50e885ae-58e6-52f3-8f5b-d0e96bb2c63c','ec87596e-f96f-5d56-aac8-438fcf72450c');

-- price list (latest general price per service)
CREATE TABLE lt_price AS SELECT DISTINCT ON (service_id) s.id AS service_id, s.category, s.name, s.duration_min, s.share_percent, sp.amount
  FROM services s JOIN service_prices sp ON sp.service_id = s.id WHERE s.tenant_id = (SELECT t FROM k) ORDER BY service_id, sp.branch_id NULLS FIRST, sp.valid_from DESC;
CREATE TABLE lt_cons AS SELECT row_number() OVER (ORDER BY service_id) - 1 AS i, * FROM lt_price WHERE category = 'consultation';
CREATE TABLE lt_lab AS SELECT row_number() OVER (ORDER BY service_id) - 1 AS i, * FROM lt_price WHERE category = 'lab';

-- 64 synthetic doctors (users + memberships + doctors + weekly schedule, one day off each)
CREATE TABLE lt_doc AS
SELECT n, gen_random_uuid() AS id, gen_random_uuid() AS membership_id, gen_random_uuid() AS user_id,
       (ARRAY[(SELECT b1 FROM k),(SELECT b2 FROM k),(SELECT b3 FROM k)])[1 + n % 3] AS branch_id,
       (SELECT service_id FROM lt_cons WHERE i = n % 8) AS service_id, n % 7 AS off_wd,
       (ARRAY['Terapevt','Kardiolog','Nevrolog','Pediatr','Ginekolog','Endokrinolog','LOR','Urolog'])[1 + n % 8] AS specialty
  FROM generate_series(1, 64) n;
INSERT INTO users (id, full_name, login) SELECT user_id, 'Sintetik Shifokor ' || n, 'lt-doc-' || n FROM lt_doc;
INSERT INTO memberships (id, tenant_id, user_id, role, branch_ids, title) SELECT membership_id, (SELECT t FROM k), user_id, 'doctor', ARRAY[branch_id], specialty FROM lt_doc;
INSERT INTO doctors (id, tenant_id, membership_id, display_name, specialty, default_share_percent) SELECT id, (SELECT t FROM k), membership_id, 'Sintetik Shifokor ' || n, specialty, 30 FROM lt_doc;
INSERT INTO doctor_services (tenant_id, doctor_id, service_id) SELECT (SELECT t FROM k), id, service_id FROM lt_doc;
INSERT INTO schedules (id, tenant_id, doctor_id, branch_id, weekday, start_time, end_time, break_start, break_end)
SELECT gen_random_uuid(), (SELECT t FROM k), d.id, d.branch_id, wd, '08:00', '18:00', '13:00', '14:00' FROM lt_doc d, generate_series(0, 6) wd WHERE wd <> d.off_wd;

-- 16 synthetic registrars/cashiers (passwords are set later by setup.mjs)
CREATE TABLE lt_staff AS
SELECT n, gen_random_uuid() AS membership_id, gen_random_uuid() AS user_id, CASE WHEN n <= 8 THEN 'registrar' ELSE 'cashier' END AS role,
       (ARRAY[(SELECT b1 FROM k),(SELECT b2 FROM k),(SELECT b3 FROM k)])[1 + n % 3] AS branch_id
  FROM generate_series(1, 16) n;
INSERT INTO users (id, full_name, login) SELECT user_id, 'Sintetik ' || role || ' ' || n, 'lt-' || role || '-' || n FROM lt_staff;
INSERT INTO memberships (id, tenant_id, user_id, role, branch_ids) SELECT membership_id, (SELECT t FROM k), user_id, role, ARRAY[branch_id] FROM lt_staff;
COMMIT;

-- 100k patients
BEGIN;
CREATE TABLE lt_pat AS SELECT n, gen_random_uuid() AS id FROM generate_series(1, 100000) n;
INSERT INTO patients (id, tenant_id, patient_number, last_name, first_name, middle_name, birth_date, sex, phone, address, allergy_state, created_at, updated_at)
SELECT p.id, (SELECT t FROM k), 1100 + n,
       (ARRAY['Karimov','Rasulov','Yusupov','Aliyev','Toshmatov','Saidov','Ergashev','Nazarov','Ismoilov','Qodirov','Mirzayev','Abdullayev','Xolmatov','Rahimov','Sobirov',
              'Umarov','Tursunov','Hasanov','Jo‘rayev','Nurmatov','Usmonov','Sharipov','Fayzullayev','Bakirov','Islomov','Normatov','Haydarov','Ochilov','Valiyev','Zokirov'])[1 + (n::bigint * 7919) % 30]
         || CASE WHEN n % 2 = 0 THEN '' ELSE 'a' END,
       CASE WHEN n % 2 = 0 THEN (ARRAY['Akmal','Bekzod','Sardor','Otabek','Jasur','Shahzod','Dilshod','Aziz','Bobur','Javohir','Rustam','Sherzod','Ulug‘bek','Farrux','Doniyor','Islom','Kamol','Laziz','Murod','Nodir'])[1 + (n::bigint * 104729) % 20]
            ELSE (ARRAY['Dilnoza','Malika','Nodira','Feruza','Zarina','Lola','Kamola','Gulnora','Madina','Sevara','Shahnoza','Nigora','Mohira','Dildora','Umida','Barno','Ozoda','Gulchehra','Iroda','Yulduz'])[1 + (n::bigint * 104729) % 20] END,
       NULL, date '1940-01-01' + ((n::bigint * 2654435761) % 30000)::int, CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
       '+99890' || lpad(((n::bigint * 7907) % 10000000)::text, 7, '0'), 'Toshkent', 'unknown',
       timestamptz '2023-10-18 05:00Z' + (n::float / 100000) * interval '1095 days', timestamptz '2023-10-18 05:00Z' + (n::float / 100000) * interval '1095 days'
  FROM lt_pat p;
UPDATE tenants SET patient_seq = 101100 WHERE id = (SELECT t FROM k);
CREATE INDEX ON lt_pat (n);
COMMIT;

-- slot grid: 30-min slots 08:00..17:30 local, minus 13:00–14:00 break, 90% booked, 2023-10-18 .. 2026-11-01
CREATE TABLE lt_appt AS
SELECT gen_random_uuid() AS id, d.id AS doctor_id, d.membership_id AS doctor_mid, d.branch_id, d.service_id,
       ((day + time '08:00' + s * interval '30 min') AT TIME ZONE 'Asia/Tashkent') AS starts_at,
       1 + floor(random() * 100000)::int AS pn, random() AS r, random() AS r2, random() AS r3
  FROM lt_doc d, generate_series(date '2023-10-18', date '2026-11-01', interval '1 day') day, generate_series(0, 19) s
 WHERE extract(dow FROM day) <> d.off_wd AND s NOT IN (10, 11) AND random() < 0.9;
ALTER TABLE lt_appt ADD COLUMN ends_at timestamptz, ADD COLUMN status text, ADD COLUMN patient_id uuid;
UPDATE lt_appt a SET ends_at = a.starts_at + make_interval(mins => c.duration_min),
  patient_id = p.id,
  status = CASE
    WHEN a.starts_at < (SELECT today_start FROM k) THEN CASE WHEN r < 0.85 THEN 'completed' WHEN r < 0.92 THEN 'cancelled' ELSE 'no_show' END
    WHEN a.starts_at < (SELECT today_start FROM k) + interval '1 day' THEN
      CASE WHEN a.starts_at + interval '30 min' <= (SELECT now_ts FROM k) THEN CASE WHEN r < 0.85 THEN 'completed' WHEN r < 0.95 THEN 'no_show' ELSE 'cancelled' END
           WHEN a.starts_at <= (SELECT now_ts FROM k) THEN 'in_progress'
           WHEN a.starts_at <= (SELECT now_ts FROM k) + interval '1 hour' AND r < 0.5 THEN 'arrived'
           ELSE 'scheduled' END
    ELSE CASE WHEN r < 0.05 THEN 'cancelled' ELSE 'scheduled' END END
  FROM lt_cons c, lt_pat p WHERE c.service_id = a.service_id AND p.n = a.pn;
ALTER TABLE lt_appt ADD COLUMN has_lab boolean, ADD COLUMN lab_service uuid, ADD COLUMN paid boolean, ADD COLUMN refunded boolean, ADD COLUMN inv_id uuid, ADD COLUMN enc_id uuid,
  ADD COLUMN order_id uuid, ADD COLUMN lab_order_id uuid, ADD COLUMN pay_id uuid, ADD COLUMN inv_no int, ADD COLUMN method text;
UPDATE lt_appt SET
  has_lab = status = 'completed' AND r2 < 0.2,
  lab_service = (SELECT service_id FROM lt_lab WHERE i = floor(r3 * 10)::int),
  paid = status = 'completed' AND r2 < 0.95,
  refunded = status = 'completed' AND r2 < 0.003,
  inv_id = CASE WHEN status IN ('completed','in_progress','arrived') THEN gen_random_uuid() END,
  enc_id = CASE WHEN status IN ('completed','in_progress') THEN gen_random_uuid() END,
  order_id = CASE WHEN status IN ('completed','in_progress','arrived') THEN gen_random_uuid() END,
  method = CASE WHEN r3 < 0.6 THEN 'cash' WHEN r3 < 0.9 THEN 'card' ELSE 'transfer' END;
UPDATE lt_appt SET lab_order_id = gen_random_uuid() WHERE has_lab;
UPDATE lt_appt SET pay_id = gen_random_uuid() WHERE paid;
CREATE TEMP TABLE lt_invno AS SELECT id, 10180 + row_number() OVER (ORDER BY starts_at, id) AS no FROM lt_appt WHERE inv_id IS NOT NULL;
UPDATE lt_appt a SET inv_no = x.no FROM lt_invno x WHERE x.id = a.id;
SELECT status, count(*) FROM lt_appt GROUP BY 1 ORDER BY 2 DESC;

BEGIN;
INSERT INTO appointments (id, tenant_id, branch_id, patient_id, doctor_id, service_id, starts_at, ends_at, status, version, created_by, created_at, updated_at, source)
SELECT id, (SELECT t FROM k), branch_id, patient_id, doctor_id, service_id, starts_at, ends_at, status, 1, NULL, starts_at - interval '3 days', starts_at, 'staff' FROM lt_appt;
COMMIT;

BEGIN;
-- queue tickets (numbers offset by 500 so they never collide with the seed's tickets)
INSERT INTO queue_tickets (tenant_id, branch_id, appointment_id, local_date, number, arrived_at, started_at, finished_at, wait_seconds)
SELECT (SELECT t FROM k), branch_id, id, (starts_at AT TIME ZONE 'Asia/Tashkent')::date,
       500 + row_number() OVER (PARTITION BY branch_id, (starts_at AT TIME ZONE 'Asia/Tashkent')::date ORDER BY starts_at, id),
       starts_at - interval '10 min', CASE WHEN status <> 'arrived' THEN starts_at END, CASE WHEN status = 'completed' THEN starts_at + interval '25 min' END,
       CASE WHEN status <> 'arrived' THEN 600 END
  FROM lt_appt WHERE inv_id IS NOT NULL;
INSERT INTO queue_counters (branch_id, local_date, last_number)
SELECT branch_id, local_date, max(number) FROM queue_tickets GROUP BY 1, 2
ON CONFLICT (branch_id, local_date) DO UPDATE SET last_number = GREATEST(queue_counters.last_number, EXCLUDED.last_number);

INSERT INTO encounters (id, tenant_id, branch_id, appointment_id, patient_id, doctor_id, status, started_at, closed_at)
SELECT enc_id, (SELECT t FROM k), branch_id, id, patient_id, doctor_id, CASE WHEN status = 'completed' THEN 'closed' ELSE 'open' END, starts_at,
       CASE WHEN status = 'completed' THEN starts_at + interval '25 min' END FROM lt_appt WHERE enc_id IS NOT NULL;
INSERT INTO clinical_notes (id, tenant_id, encounter_id, complaints, anamnesis, examination, diagnosis, recommendations, status, version, saved_at, signed_by, signed_by_name, signed_at)
SELECT gen_random_uuid(), (SELECT t FROM k), enc_id, 'Sintetik shikoyat', 'Sintetik anamnez', 'Sintetik ko‘rik', 'Sintetik tashxis', 'Sintetik tavsiya',
       CASE WHEN status = 'completed' THEN 'signed' ELSE 'draft' END, 1, starts_at + interval '20 min',
       CASE WHEN status = 'completed' THEN doctor_mid END, CASE WHEN status = 'completed' THEN 'Sintetik Shifokor' END, CASE WHEN status = 'completed' THEN starts_at + interval '24 min' END
  FROM lt_appt WHERE enc_id IS NOT NULL;
COMMIT;

BEGIN;
INSERT INTO service_orders (id, tenant_id, branch_id, patient_id, appointment_id, encounter_id, service_id, category, service_name, is_primary, price_snapshot, share_percent_snapshot,
                            doctor_id, performer_doctor_id, status, ordered_at, performed_at, created_by)
SELECT a.order_id, (SELECT t FROM k), a.branch_id, a.patient_id, a.id, a.enc_id, a.service_id, 'consultation', c.name, true, c.amount, 30, a.doctor_id, a.doctor_id,
       CASE WHEN a.status = 'completed' THEN 'completed' ELSE 'ordered' END, a.starts_at - interval '10 min', CASE WHEN a.status = 'completed' THEN a.starts_at + interval '25 min' END, NULL
  FROM lt_appt a JOIN lt_cons c ON c.service_id = a.service_id WHERE a.order_id IS NOT NULL;
INSERT INTO service_orders (id, tenant_id, branch_id, patient_id, appointment_id, encounter_id, service_id, category, service_name, is_primary, price_snapshot, share_percent_snapshot,
                            doctor_id, performer_doctor_id, status, ordered_at, performed_at, created_by)
SELECT a.lab_order_id, (SELECT t FROM k), a.branch_id, a.patient_id, a.id, a.enc_id, l.service_id, 'lab', l.name, false, l.amount, 0, a.doctor_id, NULL,
       'verified', a.starts_at + interval '20 min', a.starts_at + interval '3 hours', NULL
  FROM lt_appt a JOIN lt_lab l ON l.service_id = a.lab_service WHERE a.has_lab;
INSERT INTO lab_results (tenant_id, order_id, values, status, collected_at, collected_by_name, entered_by_name, entered_at, verified_by, verified_by_name, verified_at)
SELECT (SELECT t FROM k), lab_order_id,
       jsonb_build_array(jsonb_build_object('code','HGB','name','Gemoglobin','unit','g/L','value', (110 + floor(r3*60))::text,'ref_low',120,'ref_high',160,'flag','normal'),
                         jsonb_build_object('code','WBC','name','Leykotsitlar','unit','×10⁹/L','value','5.1','ref_low',4,'ref_high',9,'flag','normal')),
       'verified', starts_at + interval '30 min', 'Gulnora Saidova', 'Gulnora Saidova', starts_at + interval '2 hours',
       'ec87596e-f96f-5d56-aac8-438fcf72450c', 'Gulnora Saidova', starts_at + interval '3 hours'
  FROM lt_appt WHERE has_lab;
COMMIT;

BEGIN;
INSERT INTO invoices (id, tenant_id, branch_id, patient_id, appointment_id, invoice_number, status, subtotal, total, paid_amount, credit_amount, refunded_amount, created_at, updated_at)
SELECT a.inv_id, (SELECT t FROM k), a.branch_id, a.patient_id, a.id, a.inv_no,
       CASE WHEN a.refunded THEN 'refunded' WHEN a.paid THEN 'paid' ELSE 'unpaid' END,
       c.amount + coalesce(l.amount, 0),
       CASE WHEN a.refunded THEN 0 ELSE c.amount + coalesce(l.amount, 0) END,
       CASE WHEN a.refunded THEN 0 WHEN a.paid THEN c.amount + coalesce(l.amount, 0) ELSE 0 END,
       CASE WHEN a.refunded THEN c.amount + coalesce(l.amount, 0) ELSE 0 END,
       CASE WHEN a.refunded THEN c.amount + coalesce(l.amount, 0) ELSE 0 END,
       a.starts_at - interval '10 min', a.starts_at + interval '40 min'
  FROM lt_appt a JOIN lt_cons c ON c.service_id = a.service_id LEFT JOIN lt_lab l ON l.service_id = a.lab_service AND a.has_lab WHERE a.inv_id IS NOT NULL;
INSERT INTO invoice_items (tenant_id, invoice_id, order_id, service_id, description, quantity, unit_price, line_subtotal, discount_share, line_total, position)
SELECT (SELECT t FROM k), a.inv_id, a.order_id, a.service_id, c.name, 1, c.amount, c.amount, 0, c.amount, 0 FROM lt_appt a JOIN lt_cons c ON c.service_id = a.service_id WHERE a.inv_id IS NOT NULL;
INSERT INTO invoice_items (tenant_id, invoice_id, order_id, service_id, description, quantity, unit_price, line_subtotal, discount_share, line_total, position)
SELECT (SELECT t FROM k), a.inv_id, a.lab_order_id, l.service_id, l.name, 1, l.amount, l.amount, 0, l.amount, 1 FROM lt_appt a JOIN lt_lab l ON l.service_id = a.lab_service WHERE a.has_lab;
CREATE TEMP TABLE lt_cashier AS SELECT row_number() OVER (ORDER BY membership_id) - 1 AS i, membership_id, 'Sintetik kassir' AS name FROM lt_staff WHERE role = 'cashier';
INSERT INTO payments (id, tenant_id, branch_id, invoice_id, receipt_number, amount, method, cashier_membership_id, cashier_name, paid_at, idempotency_key)
SELECT a.pay_id, (SELECT t FROM k), a.branch_id, a.inv_id, 50163 + row_number() OVER (ORDER BY a.starts_at, a.id), c.amount + coalesce(l.amount, 0), a.method,
       (SELECT membership_id FROM lt_cashier WHERE i = floor(a.r * 8)::int), 'Sintetik kassir', a.starts_at + interval '40 min', 'lt-' || a.pay_id
  FROM lt_appt a JOIN lt_cons c ON c.service_id = a.service_id LEFT JOIN lt_lab l ON l.service_id = a.lab_service AND a.has_lab WHERE a.paid;
INSERT INTO refunds (tenant_id, branch_id, invoice_id, payment_id, refund_number, amount, method, reason_code, reason, approved_by, approved_by_name, refunded_at, idempotency_key)
SELECT (SELECT t FROM k), a.branch_id, a.inv_id, a.pay_id, row_number() OVER (ORDER BY a.starts_at), c.amount + coalesce(l.amount, 0), 'card', 'patient_complaint', 'Sintetik qaytarish',
       (SELECT mgr FROM k), 'Dilnoza Karimova', a.starts_at + interval '2 days', 'lt-ref-' || a.pay_id
  FROM lt_appt a JOIN lt_cons c ON c.service_id = a.service_id LEFT JOIN lt_lab l ON l.service_id = a.lab_service AND a.has_lab WHERE a.refunded;
UPDATE tenants SET invoice_seq = (SELECT max(invoice_number) FROM invoices WHERE tenant_id = (SELECT t FROM k)),
                   receipt_seq = (SELECT max(receipt_number) FROM payments WHERE tenant_id = (SELECT t FROM k)),
                   refund_seq = (SELECT coalesce(max(refund_number), 0) FROM refunds WHERE tenant_id = (SELECT t FROM k))
 WHERE id = (SELECT t FROM k);
COMMIT;

-- consents: data processing for every synthetic patient; biometric for 20k of them (they get a P- face code)
BEGIN;
INSERT INTO patient_consents (tenant_id, patient_id, kind, granted, text_version, method, recorded_by, recorded_by_name, recorded_at)
SELECT (SELECT t FROM k), id, 'data_processing', true, 'v1', 'verbal', (SELECT mgr FROM k), 'Dilnoza Karimova', timestamptz '2023-10-18 05:00Z' + (n::float / 100000) * interval '1095 days' FROM lt_pat;
INSERT INTO patient_consents (tenant_id, patient_id, kind, granted, text_version, method, recorded_by, recorded_by_name, recorded_at)
SELECT (SELECT t FROM k), id, 'biometric', true, 'bio-v1', 'signed_paper', (SELECT mgr FROM k), 'Dilnoza Karimova', timestamptz '2023-10-18 05:00Z' + (n::float / 100000) * interval '1095 days' FROM lt_pat WHERE n % 5 = 0;
COMMIT;

-- cameras for the new branch + face codes for the synthetic staff and 20k patients
BEGIN;
INSERT INTO cameras (id, tenant_id, branch_id, name, purposes, security_mode, token_hash, token_hint, status, created_at)
SELECT 'a0000000-0000-4000-8000-0000000000c1', t, b3, 'Kirish (Chilonzor)', ARRAY['attendance','patient_arrival','counting'], 'after_hours', encode(sha256('lt-load-camera-token-c1'::bytea), 'hex'), 'lt-c1', 'active', '2023-10-01' FROM k;
INSERT INTO cameras (id, tenant_id, branch_id, name, purposes, security_mode, token_hash, token_hint, status, created_at)
SELECT 'a0000000-0000-4000-8000-0000000000c2', t, b3, 'Kassa (Chilonzor)', ARRAY['security'], 'after_hours', encode(sha256('lt-load-camera-token-c2'::bytea), 'hex'), 'lt-c2', 'active', '2023-10-01' FROM k;
UPDATE cameras SET created_at = '2023-10-01' WHERE tenant_id = (SELECT t FROM k);
CREATE TABLE lt_fc AS
SELECT gen_random_uuid() AS id, membership_id, branch_id, row_number() OVER (ORDER BY membership_id) + 100 AS no FROM
  (SELECT membership_id, branch_id FROM lt_doc UNION ALL SELECT membership_id, branch_id FROM lt_staff) s;
INSERT INTO face_codes (id, tenant_id, code, subject_type, membership_id, consent_confirmed_by, created_at)
SELECT id, (SELECT t FROM k), 'S-' || no, 'staff', membership_id, (SELECT mgr FROM k), '2023-10-01' FROM lt_fc;
UPDATE face_codes SET created_at = '2023-10-01' WHERE tenant_id = (SELECT t FROM k) AND subject_type = 'staff';
CREATE TABLE lt_pfc AS SELECT gen_random_uuid() AS id, p.id AS patient_id, p.n FROM lt_pat p WHERE n % 5 = 0;
INSERT INTO face_codes (id, tenant_id, code, subject_type, patient_id, created_at)
SELECT id, (SELECT t FROM k), 'P-' || (1100 + n), 'patient', patient_id, '2023-10-01' FROM lt_pfc;
COMMIT;

-- camera events
CREATE TEMP TABLE lt_cam AS SELECT * FROM (VALUES
  ('fc40b394-935f-5938-a434-d31f992f1b42'::uuid, 'e4b7b3a7-a1e1-5656-a30e-b5242a5ea8d9'::uuid),
  ('06359448-b8cd-5eae-b29b-8db01617b799'::uuid, '28105494-3373-53d1-b267-b3832c1756b8'::uuid),
  ('a0000000-0000-4000-8000-0000000000c1'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid)) v(cam, branch);
BEGIN;
-- people counting every 2 minutes 08:00–20:00 local, 3 counting cameras, 3 years (~1.18M)
INSERT INTO camera_events (tenant_id, camera_id, branch_id, kind, occurred_at, received_at, enter_count, exit_count, dedupe_key)
SELECT (SELECT t FROM k), c.cam, c.branch, 'people_count', ts, ts, floor(random() * 4)::int, floor(random() * 4)::int, 'lt-pc-' || extract(epoch FROM ts)::bigint
  FROM lt_cam c, generate_series(timestamptz '2023-10-18 03:00Z', timestamptz '2026-10-18 06:28Z', interval '2 min') ts
 WHERE ((ts AT TIME ZONE 'Asia/Tashkent')::time BETWEEN '08:00' AND '20:00');
COMMIT;
BEGIN;
-- staff face matches: ~10 per working day per synthetic staff member at their branch camera (~0.85M)
INSERT INTO camera_events (tenant_id, camera_id, branch_id, kind, occurred_at, received_at, face_code_id, similarity, dedupe_key)
SELECT (SELECT t FROM k), c.cam, f.branch_id, 'face_match', ts, ts, f.id, 90 + floor(random() * 9), 'lt-fm-' || f.no || '-' || extract(epoch FROM ts)::bigint
  FROM lt_fc f JOIN lt_cam c ON c.branch = f.branch_id,
       generate_series(date '2023-10-18', date '2026-10-18', interval '1 day') day,
       LATERAL (SELECT ((day + time '07:40' + (i * 50 + floor(random() * 20)) * interval '1 min') AT TIME ZONE 'Asia/Tashkent') AS ts FROM generate_series(0, 9) i) x
 WHERE extract(dow FROM day) <> f.no % 7 AND ts < (SELECT now_ts FROM k);
COMMIT;
BEGIN;
-- patient face matches: one per visit for patients with a face code (~0.2M)
INSERT INTO camera_events (tenant_id, camera_id, branch_id, kind, occurred_at, received_at, face_code_id, similarity, dedupe_key)
SELECT (SELECT t FROM k), c.cam, a.branch_id, 'face_match', a.starts_at - interval '12 min', a.starts_at - interval '12 min', f.id, 92, 'lt-pf-' || a.id
  FROM lt_appt a JOIN lt_pfc f ON f.n = a.pn JOIN lt_cam c ON c.branch = a.branch_id WHERE a.status IN ('completed','in_progress','arrived');
-- security events: ~20/day across the security cameras (~22k), ~3% after hours alerts
INSERT INTO camera_events (tenant_id, camera_id, branch_id, kind, occurred_at, received_at, target, alert, dedupe_key)
SELECT (SELECT t FROM k), cam.id, cam.branch_id, (ARRAY['line_crossing','intrusion','region_entrance','region_exit','tamper'])[1 + floor(random() * 5)::int], ts, ts, 'human', random() < 0.03,
       'lt-sec-' || g
  FROM generate_series(1, 22000) g, LATERAL (SELECT timestamptz '2023-10-18 00:00Z' + random() * interval '1095 days' + g * interval '0 s' AS ts) x,
       LATERAL (SELECT id, branch_id FROM cameras WHERE 'security' = ANY(purposes) AND tenant_id = (SELECT t FROM k) ORDER BY id OFFSET (g % 4) LIMIT 1) cam;
COMMIT;

-- audit log: 3 rows per visit (create / check-in / payment) ~2.7M
BEGIN;
INSERT INTO audit_logs (tenant_id, branch_id, actor_membership_id, actor_name, actor_role, action, resource_type, resource_id, summary, request_id, occurred_at)
SELECT (SELECT t FROM k), a.branch_id, 'c8b9bc9d-e4d6-5c9c-b672-2ccfed7505d1', 'Malika Yusupova', 'registrar', 'appointment.create', 'appointment', a.id::text, 'Sintetik qabul', 'lt', a.starts_at - interval '3 days' FROM lt_appt a;
INSERT INTO audit_logs (tenant_id, branch_id, actor_membership_id, actor_name, actor_role, action, resource_type, resource_id, summary, request_id, occurred_at)
SELECT (SELECT t FROM k), a.branch_id, 'c8b9bc9d-e4d6-5c9c-b672-2ccfed7505d1', 'Malika Yusupova', 'registrar', 'appointment.check_in', 'appointment', a.id::text, 'Keldi', 'lt', a.starts_at - interval '10 min' FROM lt_appt a WHERE a.inv_id IS NOT NULL;
INSERT INTO audit_logs (tenant_id, branch_id, actor_membership_id, actor_name, actor_role, action, resource_type, resource_id, summary, request_id, occurred_at)
SELECT (SELECT t FROM k), a.branch_id, NULL, 'Sintetik kassir', 'cashier', 'payment.create', 'invoice', a.inv_id::text, 'To‘lov', 'lt', a.starts_at + interval '40 min' FROM lt_appt a WHERE a.paid;
COMMIT;

VACUUM ANALYZE;
SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) AS total_size FROM pg_stat_user_tables WHERE n_live_tup > 1000 ORDER BY n_live_tup DESC;
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;
