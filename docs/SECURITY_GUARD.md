# Qorovul (security guard) — role `guard`

Migrations `038_guard.sql` and `040_guard_fixes.sql`, API `apps/api/src/modules/security.controller.ts` (+ `security.ts`), web: guard sections
`/guard`, `/visitors`, `/keys`, `/patrol`, `/incidents`, `/on-site`, `/post`; manager section `/security`;
A4 report `/print/guard-shift/[id]`. Tests: `apps/api/test/guard.test.mjs`, `e2e/guard.mjs`
(visual pass: `node e2e/run.mjs shots-guard`, writes to `GUARD_SHOTS`).

The guard works at the entrance on a tablet or phone (sometimes a desk PC). Every screen is mobile-first, one primary
action per screen, the phone tab bar shows Panel · Tashrif · Kalitlar (+ Obxod from `sm`) · Menyu. The top bar of every
guard page carries «Rahbarga xabar» (SOS) and the alert-sound switch; «Qo‘riqlash paneli» shows the open-alert badge.

## 1. What the guard sees — and never sees

| Sees | Never sees (server 403) |
|---|---|
| Camera **security alerts** of their branches (intrusion, line crossing, region entry/exit, loitering, tamper) with the alert snapshot | Patient list, card, phone, birth date, consents, deposits, allergies |
| A camera's face match of a **staff** code: name + position (the staff member's written consent is on file) | A face match of a **patient** code — shown only as «Bemor» (no code, no number, no name) |
| **Counts** of expected patient arrivals per hour today, the entrance people count | Appointments, the queue, visits, notes, lab/diagnostic results, documents |
| Incidents, visitors, keys, patrol rounds, post shifts, staff on site | Invoices, payments, cash shifts, finance, reports, dashboard |
| Rooms and branches of their own post (for keys and places), the branch's staff names/positions (pickers) | Warehouse, the doctors' list and their schedules as data, services/prices, clinic settings, cameras' set-up |
| On «Xodimlar binoda»: a doctor's planned start today and «Dam olishda» (needed to know who is late or off) | The schedule itself, other days, appointments |

`GET /security/overview` returns patient faces as `{at, camera_name, subject: 'patient'}` only — the test checks that
neither the code nor the name nor `patient_number`/`patient_id` appear anywhere in the guard's responses.

Branch scope: like every role, `memberships.branch_ids`; another branch of the clinic → 403, another clinic's id (also a
`branch_id` in a write) → 404. `/branches` and `/rooms` return only the guard's branches. `/ai/status` gives the sample
clinical note only to doctors.

## 2. Camera alerts

- Camera events stay append-only. Handling is `security_alert_actions` (append-only, `UNIQUE(event_id, seq)`):
  `take` («Ko‘ryapman») → `resolve` with an outcome: `false_alarm`, `checked_ok`, `incident` (files an incident linked to
  the alert), `escalated` (the manager's banner shows it; **only the manager** closes it).
- The current state is the latest row (`new / taken / escalated / resolved`); an alert the manager acknowledged on the
  cameras page counts as resolved. The client sends `seq` (steps it saw): the alert row is locked `FOR UPDATE`, a stale
  `seq` or a second «Ko‘ryapman» → **409 «Sahifani yangilang»**.
- A final resolve also writes `camera_event_acks`, so the dashboard's open-alerts count and the cameras page agree.
- Response time = first action − event time (lists, stats, CSV, shift report).
- **Open = within `SECURITY_OPEN_DAYS` (30)**: every open-alert / open-incident scan (panel counters, «Ochiq» lists, pulse,
  handover, alarms) uses the same bound; the panel counters come from the SQL function `guard_open_items()`.
- **«Kechikkan»**: an alert nobody took for `ALERT_NEW_OVERDUE_MIN` (10) or taken and not closed for
  `ALERT_TAKEN_OVERDUE_MIN` (30) is red on the panel (on top) and goes to the manager's alarm (in-app; last 24 h).
- The guard's feed shows 30 alerts and «Yana N ta ko‘rsatish» (never a silent cut-off); it polls every 30 s also in a
  background tab. `GET /security/pulse` (every 15 s) drives the menu badge and the beep (Web Audio, armed by the first
  tap; switch in the top bar, on by default — a UI preference in localStorage).
- Action buttons have a synchronous in-flight guard (`useGuardedMutation`): a double tap sends once. A save that meets
  a newer state (409) refreshes the row: the dialog keeps the typed note if the alert can still be closed, otherwise it
  closes with the reason («boshqa kishi yopdi» / «rahbarga yuborilgan»).
- **Snapshots** — policy: «rahbar va qorovul (o‘z filiali)» (verifying an intrusion is the guard's job). Only for an
  alert of a security kind, only ≤ `SNAPSHOT_DAYS` (30) old, own branches. The full picture
  (`GET /security/alerts/:id/snapshot`) is audited on every view (`security.snapshot_view`); the feed's thumbnail
  (`…/thumb`, shown small and blurred) is audited once per person and alert in 24 h (`security.snapshot_thumb`), not on every refresh. Never for a face match or a count (they never have one).

## 3. Incidents, SOS

- `security_incidents` (append-only): category (conflict, theft, damage, fire, medical at the entrance, suspicious,
  other), severity (low…critical), room and/or place, description, source (`manual`, `alert`, `sos`, `patrol`), №.
- Additions and corrections are new rows in `security_incident_entries` (like a note addendum); the manager marks
  «seen» and closes with a resolution (one `close` per incident; nothing is added after it).
- Free text (incident, notes, handover, visitor note) runs through `redact()` — phone numbers become `[telefon]`; the UI
  hint asks not to write a patient's name. Audit summaries never carry free text or a visitor's name.
- **«Rahbarga xabar» (SOS)**: preset reason → a `critical` incident (`source='sos'`); the manager's shell polls
  `GET /security/alarms` every 30 s (also in a background tab) and shows a banner until «Ko‘rdim» — compact: one row on a
  phone, three on a wide screen, the rest «Yana N ta». The same guard + branch + reason within `SOS_DEDUPE_SECONDS` (60),
  or the same `Idempotency-Key` header, returns the first incident (200, `duplicate`); `POST /security/incidents` takes
  the key too.
- Free text in every guard field is refused when it looks like an identity document (`ID_DOCUMENT_RE`: passport with
  space/dash/№, joined or spaced JShShIR); `redact()` replaces a JShShIR with `[JShShIR]` before phones. The UI shows a
  soft hint when a text looks like «Bemor Familiya Ism» (never a block). There is no staff notification channel in
  the outbox (it is patient-only), so this is in-app only by design.

## 4. Visitor log (non-patients only)

Couriers, suppliers, repair workers, inspectors, meetings, interviews. **Patients and their companions are never
written here.** Name, organisation, purpose, whom they visit (staff picker), in/out, an optional *temporary clinic pass*
number (≤ 10 letters/digits). **Never a passport or JShShIR/ПИНФЛ** — the API refuses text that looks like one.

Retention: **`VISITOR_RETENTION_DAYS` = 90**. The API's hourly purge (`purgeVisitors`, `app.ts`) first closes a visitor
still «inside» after `VISITOR_AUTO_CLOSE_HOURS` (24: `out_at` = now, `auto_closed`, no «who»; such a visitor is never
counted inside), then clears name, organisation, note and pass number; purpose, host, times stay for statistics. A
trigger allows only «out once» and this purge; nothing else in a row ever changes, rows are never deleted.

## 5. Keys, patrol, shift, staff on site

- **Keys** (`key_events`, append-only): every room of the branch, «Berish» to a staff member / «Qaytdi». The room row is
  locked `FOR UPDATE`; a key already out (or back) → 409. A key is due at `KEY_DUE_HOUR` (20:00) of the day it was taken —
  taken at or after 20:00 (an evening shift), at 20:00 the next day; still out after that it is «Qaytarilmagan» (red).
  A key of an inactive room is never handed out (422); «Qaytdi» defaults to the person who took it, even if they were
  deactivated meanwhile.
- **Patrol**: the manager keeps the checkpoints per branch (`patrol_checkpoints`, switched off, never deleted). The guard
  starts a round (only with an open post shift: 409 `SHIFT_REQUIRED`) — the active checkpoints are frozen on the round
  (`checkpoint_ids`; marks outside it → 422, progress counts the frozen list) — marks each point «Joyida» / «Muammo»
  (+ note, optionally filed as an incident), finishes. The patrol page shows when the next round is due (red when past). Rounds end
  once (trigger), marks are append-only. Compliance for the manager: one finished round expected per
  `PATROL_INTERVAL_HOURS` (3) of every post shift → expected / done / missed / incomplete / problems; «expected» stops at `GUARD_SHIFT_STALE_HOURS` (26) of a shift.
- **Post shift** (`guard_shifts`): open (one per guard), close once with a required handover note; closing ends an open
  round and stores the **open-items snapshot** (`open_items`, from `guard_open_items()`: counts, incident №/category,
  rooms and holders, visitors by purpose and time — never a visitor's name). The A4 report `/print/guard-shift/[id]`
  prints that snapshot (an open shift: «now»); shifts closed before 040 got it reconstructed from the append-only history.
  A shift open > 26 h is **stale** (red for the guard and the manager); the manager **force-closes** any open shift with a
  required reason (`POST /security/shifts/:id/force-close`; the reason is kept on the shift and printed, never in the
  audit). The next guard sees the hand-over of the latest shift of the branch closed before their own shift opened (two
  guards on one post), with who wrote it (or the manager's forced-close reason).
- **Staff on site**: today's staff face matches (codes exist only with the manager's confirmation of written consent)
  plus the guard's manual «Keldi / Ketdi» (`staff_presence_marks`). Doctors are compared with today's schedule and
  `schedule_exceptions` (late after 5 min — against a one-day `custom_hours` start when there is one, «Kelmadi»,
  «Dam olishda»): the guard sees a doctor's planned start and day off for today only, never the schedule itself.

## 6. Manager

`/security`: Umumiy (period stats: alerts handled, median/max response time, outcomes, incidents by kind, visitors,
late keys, patrol compliance per shift), Ogohlantirishlar (take/resolve incl. escalated), Hodisalar (seen/close), Tashriflar,
Kalitlar, Obxod (checkpoints + rounds), Smenalar (print, force-close, stale first). The audit view has the group
«Xavfsizlik (qorovul)» with labels for every `security.*` action. CSV `incidents.csv`, `visitors.csv`, `alerts.csv`
(`core/csv.ts`, period ≤ 1 year, totals row, audited `security.export`). Guard accounts are created in «Xodimlar» (role
«Qorovul»).

## 7. Demo data

`database/seed/guard.ts`, own PRNG (`mulberry32(20261038)`), built after the main seed: three guards of the central
branch (demo card **Bahodir Usmonov**, day; Dilshod Rahmonov, day; Anvar Karimov, night), 3 weeks of shifts with
handover notes, ~4 patrol rounds per shift over 7 checkpoints (a few missed / incomplete, rare problems), handling of
the seed's camera alerts (one filed as an incident, one escalated and closed by the manager; the newest ones stay new),
11–12 incidents (one SOS), daily visitors (two inside at the demo time — also on the seed's Sunday), doctors' room keys
(one not returned since yesterday). Yesterday's 23:12 store alert stays untouched («Kechikkan», in the manager's
alarm); this morning's 09:48 operating-block alert was taken by the day guard 8 minutes before the demo time. Existing demo databases get it on API start (`backfillSeedGuard`, idempotent). The main seed's KPIs do not move.

## 8. Not done / to decide

- Staff notifications outside the app (Telegram/SMS to the manager) — no staff channel exists; SOS is in-app only.
- Guard's own camera code (attendance of guards by camera) — guards are marked manually for now.
- Rooms that are not consulting rooms (store, server room) appear in the key log only once the manager adds them as rooms.
- Visitor retention (90 days) and the visitor/incident texts need the clinic's lawyer's review (personal data law).
