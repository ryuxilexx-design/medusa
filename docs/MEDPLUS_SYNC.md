# MedPlus → Med.uz.ai mirror (pilot)

The pilot clinic keeps **MedPlus** as its main system. Med.uz.ai mirrors it one way: patients, visits, services with
prices, payments/refunds, doctors, services, branches. Nothing is ever written to MedPlus. Target delay: 1–2 minutes.

## Architecture

```
clinic LAN (Windows PC, OSPanel)                          Med.uz.ai server (Uzbekistan)
MedPlus PHP ── MySQL/MariaDB ◄── read-only ── bridge ──HTTPS──► POST /api/v1/integrations/<source>/batch
                                  (tools/medplus-bridge)            │  Bearer mps_… (only SHA-256 stored)
                                                                    ▼
Manager: Sozlamalar → Integratsiyalar ── file import (XLSX/CSV) ──► apps/api/src/sync/ingest.ts (one upsert path)
```

- **One upsert path** (`apps/api/src/sync/ingest.ts`) for the bridge, the manager's file import and
  `npm run db:import-medplus`. Every record is keyed by `(source, kind, external_id)` in `external_refs`; the same
  MedPlus row from two channels is applied once. An unchanged payload (hash of non-empty fields) is skipped.
- **Order-independent:** a record whose dependency is missing (patient, visit, the services a payment pays for, an
  unmapped branch or payment form) waits in `external_pending` and is retried after every batch and after a mapping
  change; after 30 days it is dropped and reported.
- **Read-only mirror:** mirrored rows carry `external_source_id`. Migration 042 refuses every write to them unless the
  transaction is marked `meduza.sync = on` (only the sync does that) → SQLSTATE `MR409` → HTTP 409 `MIRRORED_RECORD`.
  The UI shows a violet «MedPlus» badge and no edit/pay/discount/refund buttons. Allergy notes and anonymisation
  (erasure request) stay possible on a mirrored card.
- **Money:** MedPlus's own amounts (price, line discount, doctor %) are the snapshot — not our price list. Mirrored
  payments/refunds have **no Med.uz.ai cash shift** (Z-reports and drawers are untouched) and **no fiscal receipt**
  (MedPlus's KKM is the fiscal source; a DB trigger refuses one). They count in cash-basis revenue (dashboard, finance,
  manager AI) like any payment. Payments are applied to the patient's open mirrored invoices of the same branch
  (oldest first, split if needed); a payment arriving before its services waits. A payment reduced or deleted in MedPlus
  is booked as a refund («adj»); a negative cash-history row is a refund. A line changed after payment is accepted
  only while the invoice still covers what was paid, otherwise it is reported (`changed_after_payment`).
- **Patients:** matched by ref → PINFL → phone + birth date (+ same first or last name). Two existing cards are never
  merged; an ambiguous match creates a new card and a «possible duplicate» row for the manager. On linking, the card's
  own data stays and empty fields are filled; later MedPlus changes overwrite the identity fields.
- **Reference data:** an unknown service → inactive placeholder «MedPlus: <name>», an unknown doctor → inactive stub;
  both listed for the manager to map. The same service/doctor arriving under a second key (the file import keys by name,
  the bridge by MedPlus's id) follows the existing mapping of that name — the manager's choice holds for both and no
  second placeholder is made. Branches are matched by name (or the only branch); an unknown branch or payment
  form parks its records until mapped. Remapping changes future records only; mirrored rows keep their snapshot.
- Visits become appointments (completed/scheduled/cancelled), lines without a visit go to a day invoice
  (patient + branch + day). No encounters or clinical notes are created (MedPlus sends no clinical text). The
  double-booking constraint does not apply to mirrored visits; Telegram/SMS reminders are not sent for them.
- Only a manager whose branches cover **every** active branch manages the integration (the mirror is clinic-wide).

## Protocol

`POST /api/v1/integrations/<source_id>/batch`, `Authorization: Bearer mps_…`, JSON ≤ 5 MB, ≤ 1000 records,
120 batches/min per source, 20 failed key checks/min per address. 401 = bad/revoked/paused key, 409 `SYNC_BUSY` =
another batch of this source is running (retry), 429 = rate limit.

```json
{ "cursor": { "payment": "{\"id\":81234}" },
  "records": [ { "kind": "patient", "external_id": "28354", "updated_at": "2026-10-17 10:00:00", "deleted": false, "data": { … } } ] }
```

Money is integer **tiyin** (the bridge converts so‘m). Times are ISO or `YYYY-MM-DD HH:MM[:SS]` / `DD.MM.YYYY HH:MM`
— without a zone they are clinic (Tashkent) wall time.

| kind | data |
|---|---|
| patient | `full_name` or `last_name`/`first_name`/`middle_name`, `birth_date`*, `sex` (М/Ж…), `phone`, `phone2`, `pinfl`, `address` |
| visit | `patient_id`*, `branch_id`/`branch_name`, `doctor_id`/`doctor_name`, `service_id`/`service_name`, `starts_at`*, `duration_min`, `status` |
| order (service line) | `patient_id`*, `visit_id`, `branch_*`, `service_id`/`service_name`*, `category`, `doctor_*`, `price`* (unit), `quantity`, `discount` (line), `doctor_percent`, `ordered_at`* |
| payment | `patient_id`*, `visit_id`, `branch_*`, `amount`* (negative = refund), `method`* (Наличными/Терминал…), `paid_at`*, `cashier`, `cashier_id`, `comment` |
| refund | `payment_id` or `patient_id`, `amount`*, `method`, `refunded_at`*, `reason` |
| branch / doctor / service / staff / method | `name` (+ `specialty`, `percent` for a doctor; `category` for a service) |
| daily_totals | `date`*, `branch_*`, `payments_sum`* (net, tiyin), `payments_count`*, `patients_total` |

Use MedPlus's ids consistently (`branch_id`, `doctor_id`, `service_id`); a name-only reference is keyed by its name.

## Installing the bridge on the clinic PC

1. **Read-only MySQL user** (in OSPanel's MySQL console / phpMyAdmin, as root):
   ```sql
   CREATE USER 'medplus_ro'@'127.0.0.1' IDENTIFIED BY '<strong password>';
   GRANT SELECT ON clinic.* TO 'medplus_ro'@'127.0.0.1';
   GRANT SELECT ON information_schema.* TO 'medplus_ro'@'127.0.0.1';  -- usually implicit
   FLUSH PRIVILEGES;
   ```
   (`clinic` = MedPlus's database name, see `D:\OSPanel\domains\clinic` config.) The bridge also sets the session
   READ ONLY, runs each query in `START TRANSACTION READ ONLY`, a 30 s statement limit, no multi-statements, and
   refuses any query that is not a single SELECT.
2. **Offline package:** `npm run bridge:pack` → `dist/medplus-bridge-YYYYMMDD.zip` (bridge, `npm ci` node_modules,
   portable `node\node.exe` win-x64 checked against nodejs.org's SHASUMS256, and the helpers from
   `tools/medplus-bridge/windows/` at the root: `README-UZ.txt` — the step-by-step for the clinic's admin,
   `0-readonly-user.sql`, `1-probe.bat`, `2-dry-run.bat`, `probe-phpmyadmin.sql`). Unzip to `C:\medplus-bridge`;
   nothing is installed. Node 22 needs Windows 10 / Server 2016+; on older Windows use `probe-phpmyadmin.sql`
   (the same schema query, exported as CSV from phpMyAdmin). The `.bat` files use the bundled `node.exe`, else a
   system `node`. Tested against MariaDB 10.4 and MySQL 5.7 (probe, dry-run, `--once` into the API, incremental pass
   with a refund row and a patient update, reconciliation 0); the `.bat` files have not been run on real Windows yet.
3. In Med.uz.ai: **Sozlamalar → Integratsiyalar → «MedPlus’ni ulash»**. Copy *Manzil*, *Manba ID* and *Kalit* (shown
   once; «Yangi kalit» issues a new one and revokes the old) into `config.json` (from `config.example.json`). Restrict
   the file to the bridge's Windows account (or put the key in the `MEDPLUS_BRIDGE_TOKEN` environment variable).
4. `1-probe.bat` (= `node bridge.mjs --probe --out schema.json`; `--out` writes UTF-8 — PowerShell's `>` would
   write UTF-16) — tables, approximate row counts, collations and columns, **no rows**. Send it to us. With an empty
   `mysql.database` it lists the databases the user can see instead. MySQL < 5.6.5 (no `READ ONLY` transactions)
   falls back to plain SELECTs — the SELECT-only user still guards it (`read_only_tx: false` in the output).
5. Write `queries.json` (from `queries.example.json`, see below), then `node bridge.mjs --dry-run` (counts only).
6. Schedule: Task Scheduler → *Create Task* → «Run whether user is logged on or not», trigger *At startup* and
   *Daily, repeat every 1 minute indefinitely*, action `C:\Program Files\nodejs\node.exe` with arguments
   `C:\medplus-bridge\bridge.mjs --once`, start in `C:\medplus-bridge`; *Settings*: «Do not start a new instance».
   Or as one command: `schtasks /Create /TN MedPlusBridge /SC MINUTE /MO 1 /RU SYSTEM /TR "\"C:\Program Files\nodejs\node.exe\" C:\medplus-bridge\bridge.mjs --once"`.
   (Alternative: `node bridge.mjs` as a service via NSSM, one pass every `interval_sec`.) A lock file prevents overlap.
7. Logs: `logs\bridge-YYYY-MM-DD.log` (kinds, counts, cursors, error codes — never row contents), kept 14 days.

Load on MedPlus: one connection, `batch_size` (200) rows per query, `max_batches_per_run` (50), incremental cursors.

## Writing queries (after `--probe`)

One entry per kind: `sql` (single SELECT with `ORDER BY` the cursor columns and `LIMIT :limit`), `cursor` columns,
`map` (protocol field → column), `money` (fields in so‘m → tiyin), optional `updated_at`, `deleted`, `start`.

- Append-only tables (cash history, service lines): `cursor: ["id"]`, `WHERE id > :last_id ORDER BY id LIMIT :limit`.
- Editable tables (patients): `cursor: ["updated_at","id"]`,
  `WHERE (updated_at > :last_updated_at OR (updated_at = :last_updated_at AND id > :last_id)) ORDER BY updated_at, id`.
  If MedPlus has no `updated_at`, use `id` and re-send changed rows by a periodic full pass (delete `cursor.json` entry
  for that kind — unchanged rows are skipped by hash).
- Join names you need (`JOIN services sv ON …` → `service_name`), keep MedPlus ids in `*_id`.
- `daily_totals`: `SUM`/`COUNT` per day and branch with `WHERE DATE(created) >= :last_day` (today is re-sent each pass).
- Cursor state lives in `cursor.json` (atomic writes); delete a kind's entry to re-read it from `start`.

## File import (fallback, history before go-live)

Sozlamalar → Integratsiyalar → **Fayldan import**: XLSX (also HTML-table «.xls» and CSV in UTF-8/Windows-1251;
old binary .xls → save as .xlsx), ≤ 10 MB / 30 000 rows. Columns are guessed from MedPlus headers («ID», «ФИО
пациента», «Дата рож.», «Мобильный телефон», «Оплаченная сумма», «Форма оплаты», «Дата платежа», «Услуга», «Врач»,
«Филиал»…) and can be changed. **Tekshirish** = dry run of the first 1000 rows (one rolled-back transaction: exactly
what an import would do), then **Import qilish**. Order: patients → services report → cash history. The payments file
needs a patient id column or an id inside the patient cell («28354 Каримов…»). A services-report line without an ID
gets a content key (re-importing the same file is still a no-op, but the bridge's real ids will not match it — use the
file import only for periods the bridge does not read). Larger files: `npm run db:import-medplus -- --file x.xlsx --kind
patients|services|payments [--tenant …] [--dry-run] [--map "external_id=ID,…"]`.

## Daily reconciliation (pilot «mirror» plan)

1. Week 0: bridge in `--dry-run`, queries tuned; history imported from files or by the bridge from `start`.
2. Every morning the manager opens **Solishtirish**: per day and branch, MedPlus's reported net payments (from
   `daily_totals`) vs. Med.uz.ai's mirrored payments − refunds, plus total patients. Any difference → **Kutilayotganlar**
   (waiting records with the reason) and **Jurnal** (error codes per batch); map the missing branch/payment form, then
   the waiting records apply automatically.
3. Confirm the «Taxminiy»/«Vaqtinchalik» mappings (services, doctors) once; review «Dublikatlar».
4. Exit criteria for the pilot: 14 consecutive days without a reconciliation difference.

## Full switch («O‘tishni yakunlash», migration 044)

A clinic that leaves MedPlus for good (the Planbaby pilot) uses the same import once, then closes the source:
**Sozlamalar → Integratsiyalar → O‘tishni yakunlash** (manager covering every branch; `GET/POST
/integrations/sources/:id/cutover`, `apps/api/src/sync/cutover.ts`).

- The preview counts what becomes ours (cards, visits, invoices, the patient debt that carries over) and what still
  needs the manager: waiting records (block the switch unless «tashlab o‘tish» is ticked → 409 `PENDING_RECORDS`),
  unreviewed duplicates, placeholder services/doctors, future MedPlus visits (check the schedule).
- In one transaction under the source's sync lock: `external_source_id → NULL` and `imported_source_id = source` on
  patients, appointments, service_orders, invoices — they become ordinary rows (edit, book, pay in our shift with a
  fiscal receipt, discount, refund). MedPlus's **payments and refunds stay mirrored** (no shift, no Med.uz.ai fiscal
  receipt — MedPlus's KKM issued them) and keep counting in cash-basis revenue. `external_refs` keep the MedPlus ids.
- The source is closed: inactive, token removed, `cutover_at` set once (DB trigger: final), no batch (401), no file
  import / new key / resume (409 `SOURCE_CLOSED`, also checked inside `runBatch` under the lock). The log stays.
- Imported visits keep MedPlus's overlaps: the double-booking constraint skips `imported_source_id` rows (our own new
  bookings are still guarded).
- Tests: `apps/api/test/cutover.test.mjs`, E2E `e2e/sync.mjs`. Runbook for the pilot: `docs/PILOT_PLANBABY.md`.

## Privacy

Data flows clinic PC → the clinic's Med.uz.ai server in Uzbekistan only (never the Railway demo). Only the fields
listed above are mirrored (no SMS flag, ad channel, workplace, documents, insurance — data minimisation). The bridge
logs and the sync log hold no personal data; pending records hold the record until applied (≤ 30 days). Mirrored cards
are created without a Med.uz.ai consent row: the clinic's MedPlus consent covers processing — **lawyer to confirm**;
consents collected later in Med.uz.ai are recorded as usual.

## Rollback

Pause: «To‘xtatish» (the bridge gets 401) or stop the scheduled task. Revoke: «Yangi kalit». MedPlus is never
written, so it needs no rollback. Mirrored rows stay (records retention) and remain read-only; to start over on a fresh
server, restore the pre-pilot backup (`npm run db:restore`).

## Open questions for the clinic

MedPlus MySQL schema (`--probe`), DB name and a read-only account; whether tables have `updated_at` / soft-delete
flags; how refunds and prepayments (patient balance) are stored; whether services are grouped into visits; payment form
list; branch ids («Центр», «Medwell»); the clinic's consent wording in MedPlus.
