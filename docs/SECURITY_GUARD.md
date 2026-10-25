# Qorovul (security guard) — role `guard`

Migration `038_guard.sql`, API `apps/api/src/modules/security.controller.ts` (+ `security.ts`), web: guard sections
`/guard`, `/visitors`, `/keys`, `/patrol`, `/incidents`, `/on-site`, `/post`; manager section `/security`;
A4 report `/print/guard-shift/[id]`. Tests: `apps/api/test/guard.test.mjs`, `e2e/guard.mjs`
(visual pass: `node e2e/run.mjs shots-guard`, writes to `GUARD_SHOTS`).

The guard works at the entrance on a tablet or phone (sometimes a desk PC). Every screen is mobile-first, one primary
action per screen, the phone tab bar shows Panel · Tashrif · Kalitlar (+ Obxod from `sm`) · Menyu.

## 1. What the guard sees — and never sees

| Sees | Never sees (server 403) |
|---|---|
| Camera **security alerts** of their branches (intrusion, line crossing, region entry/exit, loitering, tamper) with the alert snapshot | Patient list, card, phone, birth date, consents, deposits, allergies |
| A camera's face match of a **staff** code: name + position (the staff member's written consent is on file) | A face match of a **patient** code — shown only as «Bemor» (no code, no number, no name) |
| **Counts** of expected patient arrivals per hour today, the entrance people count | Appointments, the queue, visits, notes, lab/diagnostic results, documents |
| Incidents, visitors, keys, patrol rounds, post shifts, staff on site | Invoices, payments, cash shifts, finance, reports, dashboard |
| Rooms and branches (for keys and places), the branch's staff names/positions (pickers) | Warehouse, doctors' list/schedules, services/prices, clinic settings, cameras' set-up |

`GET /security/overview` returns patient faces as `{at, camera_name, subject: 'patient'}` only — the test checks that
neither the code nor the name nor `patient_number`/`patient_id` appear anywhere in the guard's responses.

Branch scope: like every role, `memberships.branch_ids`; another branch → 403, another clinic's id → 404.

## 2. Camera alerts

- Camera events stay append-only. Handling is `security_alert_actions` (append-only, `UNIQUE(event_id, seq)`):
  `take` («Ko‘ryapman») → `resolve` with an outcome: `false_alarm`, `checked_ok`, `incident` (files an incident linked to
  the alert), `escalated` (the manager's banner shows it; **only the manager** closes it).
- The current state is the latest row (`new / taken / escalated / resolved`); an alert the manager acknowledged on the
  cameras page counts as resolved. The client sends `seq` (steps it saw): the alert row is locked `FOR UPDATE`, a stale
  `seq` or a second «Ko‘ryapman» → **409 «Sahifani yangilang»**.
- A final resolve also writes `camera_event_acks`, so the dashboard's open-alerts count and the cameras page agree.
- Response time = first action − event time (lists, stats, CSV, shift report).
- **Snapshots** (`GET /security/alerts/:id/snapshot`, guard + manager): only for an alert of a security kind, only
  ≤ `SNAPSHOT_DAYS` (30) old, own branches; every view is audited (`security.snapshot_view`). Never for a face match or
  a count (they never have one).

## 3. Incidents, SOS

- `security_incidents` (append-only): category (conflict, theft, damage, fire, medical at the entrance, suspicious,
  other), severity (low…critical), room and/or place, description, source (`manual`, `alert`, `sos`, `patrol`), №.
- Additions and corrections are new rows in `security_incident_entries` (like a note addendum); the manager marks
  «seen» and closes with a resolution (one `close` per incident; nothing is added after it).
- Free text (incident, notes, handover, visitor note) runs through `redact()` — phone numbers become `[telefon]`; the UI
  hint asks not to write a patient's name. Audit summaries never carry free text or a visitor's name.
- **«Rahbarga xabar» (SOS)**: preset reason → a `critical` incident (`source='sos'`); the manager's shell polls
  `GET /security/alarms` every 30 s and shows a red banner until «Ko‘rdim». There is no staff notification channel in
  the outbox (it is patient-only), so this is in-app only by design.

## 4. Visitor log (non-patients only)

Couriers, suppliers, repair workers, inspectors, meetings, interviews. **Patients and their companions are never
written here.** Name, organisation, purpose, whom they visit (staff picker), in/out, an optional *temporary clinic pass*
number (≤ 10 letters/digits). **Never a passport or JShShIR/ПИНФЛ** — the API refuses text that looks like one.

Retention: **`VISITOR_RETENTION_DAYS` = 90**. The API's hourly purge (`purgeVisitors`, `app.ts`) clears name,
organisation, note and pass number; purpose, host, times stay for statistics. A trigger allows only «out once» and this
purge; nothing else in a row ever changes, rows are never deleted.

## 5. Keys, patrol, shift, staff on site

- **Keys** (`key_events`, append-only): every room of the branch, «Berish» to a staff member / «Qaytdi». The room row is
  locked `FOR UPDATE`; a key already out (or back) → 409. A key still out at `KEY_DUE_HOUR` (20:00) of its day, or on a
  later day, is «Qaytarilmagan» (red).
- **Patrol**: the manager keeps the checkpoints per branch (`patrol_checkpoints`, switched off, never deleted). The guard
  starts a round, marks each point «Joyida» / «Muammo» (+ note, optionally filed as an incident), finishes. Rounds end
  once (trigger), marks are append-only. Compliance for the manager: one finished round expected per
  `PATROL_INTERVAL_HOURS` (3) of every post shift → expected / done / missed / incomplete / problems.
- **Post shift** (`guard_shifts`): open (one per guard), close once with a required handover note; closing ends an open
  round. The next guard sees the last handover note and the open items (open alerts, open incidents, keys out,
  visitors inside). A4 report `/print/guard-shift/[id]` (no patient data).
- **Staff on site**: today's staff face matches (codes exist only with the manager's confirmation of written consent)
  plus the guard's manual «Keldi / Ketdi» (`staff_presence_marks`). Doctors are compared with today's schedule and
  `schedule_exceptions` (late after 5 min, «Kelmadi», «Dam olishda»).

## 6. Manager

`/security`: Umumiy (period stats: alerts handled, median/max response time, outcomes, incidents by kind, visitors,
late keys, patrol compliance per shift), Ogohlantirishlar (take/resolve incl. escalated), Hodisalar (seen/close), Tashriflar,
Kalitlar, Obxod (checkpoints + rounds), Smenalar (print). CSV `incidents.csv`, `visitors.csv`, `alerts.csv`
(`core/csv.ts`, period ≤ 1 year, totals row, audited `security.export`). Guard accounts are created in «Xodimlar» (role
«Qorovul»).

## 7. Demo data

`database/seed/guard.ts`, own PRNG (`mulberry32(20261038)`), built after the main seed: three guards of the central
branch (demo card **Bahodir Usmonov**, day; Dilshod Rahmonov, day; Anvar Karimov, night), 3 weeks of shifts with
handover notes, ~4 patrol rounds per shift over 7 checkpoints (a few missed / incomplete, rare problems), handling of
the seed's camera alerts (one filed as an incident, one escalated and closed by the manager; the newest ones stay new),
11–12 incidents (one SOS), daily visitors (two inside at the demo time), doctors' room keys (one not returned since
yesterday). Existing demo databases get it on API start (`backfillSeedGuard`, idempotent). The main seed's KPIs do not move.

## 8. Not done / to decide

- Staff notifications outside the app (Telegram/SMS to the manager) — no staff channel exists; SOS is in-app only.
- Guard's own camera code (attendance of guards by camera) — guards are marked manually for now.
- Rooms that are not consulting rooms (store, server room) appear in the key log only once the manager adds them as rooms.
- Visitor retention (90 days) and the visitor/incident texts need the clinic's lawyer's review (personal data law).
