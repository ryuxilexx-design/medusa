-- EXPLAIN (ANALYZE, BUFFERS) of the heaviest queries copied from the controllers, with realistic parameters.
-- T = demo tenant, branches = all 3, today = 2026-10-18 (Asia/Tashkent).
\set T '''c04df94a-e1ae-5d29-a395-ddc2c31d6d0e'''
\set BR '''{e4b7b3a7-a1e1-5656-a30e-b5242a5ea8d9,28105494-3373-53d1-b267-b3832c1756b8,a0000000-0000-4000-8000-000000000003}'''
\set D0 '''2026-10-17 19:00Z'''
\set D1 '''2026-10-18 19:00Z'''
\set Y0 '''2025-10-18 19:00Z'''
\set M0 '''2026-09-18 19:00Z'''
\pset pager off

\echo '### Q1 patients search by name (count)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT count(*)::int AS n FROM patients p WHERE p.tenant_id = :T AND (lower(p.last_name || ' ' || p.first_name || ' ' || coalesce(p.middle_name,'')) LIKE '%karim%' OR lower(p.first_name || ' ' || p.last_name) LIKE '%karim%');

\echo '### Q2 patients search by phone digits (rows)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT p.id, (SELECT max(a.starts_at) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'completed') AS last_visit,
  (SELECT min(a.starts_at) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'scheduled' AND a.starts_at > demo_now() - interval '12 hours') AS next_appointment
  FROM patients p WHERE p.tenant_id = :T AND (lower(p.last_name || ' ' || p.first_name || ' ' || coalesce(p.middle_name,'')) LIKE '%4512345%' OR lower(p.first_name || ' ' || p.last_name) LIKE '%4512345%'
   OR replace(coalesce(p.phone,''),'+','') LIKE '%4512345%' OR p.patient_number = 4512345) ORDER BY p.last_name, p.first_name LIMIT 20;

\echo '### Q3 patients default list page 1 (ORDER BY created_at DESC)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT p.id, EXISTS (SELECT 1 FROM telegram_chats tc JOIN telegram_bots b ON b.id = tc.bot_id WHERE tc.tenant_id = p.tenant_id AND tc.phone = p.phone AND NOT tc.blocked AND b.status = 'active') AS tl,
  (SELECT max(a.starts_at) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'completed') AS last_visit
  FROM patients p WHERE p.tenant_id = :T ORDER BY p.created_at DESC, p.patient_number DESC LIMIT 20 OFFSET 0;

\echo '### Q4 doctor patient list (EXISTS appointment with this doctor)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT count(*) FROM patients p WHERE p.tenant_id = :T AND EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.doctor_id = (SELECT id FROM doctors WHERE display_name = 'Sintetik Shifokor 1'));

\echo '### Q5 schedule day, all branches (APPT_SELECT incl. invoice subquery)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
  SELECT a.id, (SELECT json_build_object('id', i.id, 'status', i.status) FROM invoices i WHERE i.appointment_id = a.id AND i.status <> 'void' ORDER BY i.created_at LIMIT 1) AS invoice
    FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id JOIN services s ON s.id = a.service_id
    JOIN branches b ON b.id = a.branch_id LEFT JOIN rooms r ON r.id = a.room_id LEFT JOIN queue_tickets qt ON qt.appointment_id = a.id LEFT JOIN encounters e ON e.appointment_id = a.id
   WHERE a.tenant_id = :T AND a.branch_id = ANY(:BR) AND a.starts_at >= :D0 AND a.starts_at < :D1 ORDER BY a.starts_at, d.display_name LIMIT 500;

\echo '### Q6 availability busy list for one doctor/day'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT id, starts_at, ends_at FROM appointments WHERE doctor_id = (SELECT id FROM doctors WHERE display_name = 'Sintetik Shifokor 1') AND status NOT IN ('cancelled','no_show')
  AND starts_at < '2026-10-20 19:00Z' AND ends_at > '2026-10-19 19:00Z';

\echo '### Q7 dashboard: debt (all open invoices)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT coalesce(sum(total - paid_amount),0)::bigint, count(*)::int FROM invoices WHERE tenant_id = :T AND branch_id = ANY(:BR) AND status IN ('unpaid','partially_paid') AND total > paid_amount;

\echo '### Q8 dashboard: cancelled with payments'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT count(DISTINCT a.id)::int FROM appointments a JOIN invoices i ON i.appointment_id = a.id
  WHERE a.tenant_id = :T AND a.branch_id = ANY(:BR) AND a.status = 'cancelled' AND i.status <> 'void' AND (i.paid_amount > 0 OR i.status = 'unpaid');

\echo '### Q9 dashboard: lab pending (all history)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT count(*) FILTER (WHERE status = 'draft_result'), count(*) FILTER (WHERE status IN ('ordered','sample_collected')) FROM service_orders WHERE tenant_id = :T AND branch_id = ANY(:BR) AND category = 'lab';

\echo '### Q10 dashboard/reports: by service 1 year'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT o.service_id, o.service_name, o.category, count(*)::int, sum(CASE WHEN i.credit_amount = 0 THEN it.line_total ELSE 0 END)::bigint AS value
  FROM service_orders o JOIN invoice_items it ON it.order_id = o.id JOIN invoices i ON i.id = it.invoice_id
 WHERE o.tenant_id = :T AND o.branch_id = ANY(:BR) AND o.performed_at >= :Y0 AND o.performed_at < :D1 AND o.status IN ('completed','verified') AND i.status <> 'void' GROUP BY 1,2,3 ORDER BY value DESC;

\echo '### Q11 dashboard: camera open alerts'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT count(*)::int FROM camera_events e LEFT JOIN camera_event_acks k ON k.event_id = e.id WHERE e.tenant_id = :T AND e.alert AND k.event_id IS NULL AND e.branch_id = ANY(:BR);

\echo '### Q12 reports/doctors 1 year'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT d.id, count(o.id)::int, coalesce(sum(it.line_total),0)::bigint FROM doctors d
  LEFT JOIN service_orders o ON o.performer_doctor_id = d.id AND o.branch_id = ANY(:BR) AND o.performed_at >= :Y0 AND o.performed_at < :D1 AND o.status IN ('completed','verified')
  LEFT JOIN invoice_items it ON it.order_id = o.id LEFT JOIN invoices i ON i.id = it.invoice_id
 WHERE d.tenant_id = :T AND (o.id IS NULL OR i.status <> 'void') GROUP BY d.id;

\echo '### Q13 cash desk invoice list, no filter: aggregate + page (services via string_agg per row)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT count(*)::int, coalesce(sum(i.total) FILTER (WHERE i.status <> 'void'),0)::bigint FROM invoices i JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = i.branch_id
 WHERE i.tenant_id = :T AND i.branch_id = ANY(:BR);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT i.id, (SELECT string_agg(it.description, ', ' ORDER BY it.position) FROM invoice_items it WHERE it.invoice_id = i.id) AS services
  FROM invoices i JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = i.branch_id WHERE i.tenant_id = :T AND i.branch_id = ANY(:BR)
 ORDER BY CASE WHEN i.status IN ('unpaid','partially_paid') THEN 0 ELSE 1 END, i.created_at DESC LIMIT 20;

\echo '### Q14 check-in: open invoice of the visit (FOR UPDATE) and next item position'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT id FROM invoices WHERE appointment_id = (SELECT id FROM appointments WHERE status = 'scheduled' AND starts_at > :D0 LIMIT 1) AND tenant_id = :T AND status = 'unpaid' AND paid_amount = 0 AND credit_amount = 0 ORDER BY created_at DESC LIMIT 1;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT coalesce(max(position), -1) + 1 AS p FROM invoice_items WHERE invoice_id = (SELECT id FROM invoices ORDER BY created_at DESC LIMIT 1);

\echo '### Q15 payments CSV, 1 year'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT pm.receipt_number, pm.paid_at, b.name, p.patient_number, p.last_name || ' ' || p.first_name, i.invoice_number, pm.method, pm.amount, pm.cashier_name, pm.note
  FROM payments pm JOIN invoices i ON i.id = pm.invoice_id JOIN patients p ON p.id = i.patient_id JOIN branches b ON b.id = pm.branch_id
 WHERE pm.tenant_id = :T AND pm.branch_id = ANY(:BR) AND pm.paid_at >= :Y0 AND pm.paid_at < :D1 ORDER BY pm.paid_at;

\echo '### Q16 cameras list: events in last 24h per camera'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT c.id, (SELECT count(*)::int FROM camera_events e WHERE e.camera_id = c.id AND e.received_at >= demo_now() - interval '24 hours') FROM cameras c WHERE c.tenant_id = :T;

\echo '### Q17 attendance 30 days (seen per staff/day)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT fc.membership_id, to_char(e.occurred_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD'), min(e.occurred_at), max(e.occurred_at), count(*)::int
  FROM camera_events e JOIN face_codes fc ON fc.id = e.face_code_id AND fc.subject_type = 'staff'
 WHERE e.tenant_id = :T AND e.kind = 'face_match' AND e.branch_id = ANY(:BR) AND e.occurred_at >= :M0 AND e.occurred_at < :D1 GROUP BY 1, 2;

\echo '### Q18 security list 30 days'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT e.id FROM camera_events e JOIN cameras c ON c.id = e.camera_id LEFT JOIN camera_event_acks k ON k.event_id = e.id
 WHERE e.tenant_id = :T AND e.kind NOT IN ('face_match', 'people_count') AND e.branch_id = ANY(:BR) AND ((e.occurred_at >= :M0 AND e.occurred_at < :D1) OR (e.alert AND k.event_id IS NULL))
 ORDER BY e.occurred_at DESC LIMIT 300;

\echo '### Q19 patient history: clinical notes of a patient (encounters by patient_id)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT n.id FROM clinical_notes n JOIN encounters e ON e.id = n.encounter_id JOIN doctors d ON d.id = e.doctor_id JOIN appointments a ON a.id = e.appointment_id
 WHERE e.patient_id = (SELECT id FROM patients WHERE patient_number = 5000) AND n.tenant_id = :T ORDER BY a.starts_at DESC;

\echo '### Q20 patient history: invoices with services'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT i.id, (SELECT string_agg(it.description, ', ' ORDER BY it.position) FROM invoice_items it WHERE it.invoice_id = i.id) FROM invoices i JOIN branches b ON b.id = i.branch_id
 WHERE i.patient_id = (SELECT id FROM patients WHERE patient_number = 5000) AND i.tenant_id = :T ORDER BY i.created_at DESC;

\echo '### Q21 audit page 1 (count)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT count(*)::int FROM audit_logs WHERE tenant_id = :T;

\echo '### Q22 dashboard utilization booked minutes, 1 year'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT doctor_id, sum(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60)::int, count(*)::int FROM appointments
 WHERE tenant_id = :T AND branch_id = ANY(:BR) AND starts_at >= :Y0 AND starts_at < :D1 AND status NOT IN ('cancelled','no_show') GROUP BY 1;

\echo '### Q23 ingest: arrival match for a patient face'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT a.id FROM appointments a WHERE a.tenant_id = :T AND a.branch_id = 'e4b7b3a7-a1e1-5656-a30e-b5242a5ea8d9' AND a.patient_id = (SELECT id FROM patients WHERE patient_number = 5000) AND a.status = 'scheduled'
   AND a.starts_at BETWEEN '2026-10-18 06:00Z'::timestamptz - make_interval(mins => 60) AND '2026-10-18 06:00Z'::timestamptz + make_interval(mins => 120) ORDER BY abs(extract(epoch FROM a.starts_at - '2026-10-18 06:00Z'::timestamptz)) LIMIT 1;
