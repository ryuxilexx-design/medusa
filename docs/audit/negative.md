# Med.uz.ai API: negative, edge-case, concurrency and data-integrity audit

**Environment.** I ran the API from the existing `apps/api/dist` on port 4311 (`APP_MODE=demo`, `AI_MODE=sample`, `BACKGROUND_WORKERS=off`). It used the isolated database `meduza_neg_test`, which was reset through `POST /demo/reset` before each scenario. The live demo database and ports 3000/4000/3100/4100 were not touched. I did not change any product code.

**Scripts.** All scripts are in `/Users/levi/Desktop/Meduza/audit/negative/`:
- `lib.mjs` refuses to run against anything except `meduza_neg_test`.
- The test scripts are `validation`, `statemachine`, `concurrency`, `concurrency2`, `extra`, `money`, `timeboundary`, `telegram_race`, `hik`, `misc` and `dos_availability`.

**Results.** 346 checks ran: 305 passed and 41 failed. The failures cover 18 distinct findings, listed below. The same root cause can produce several failed checks.

## Summary

| ID | Severity | Module | Title |
|---|---|---|---|
| NEG-01 | High | Cash desk | Parallel cash-outs push a drawer below zero (the `INSUFFICIENT_CASH` check is bypassed) |
| NEG-02 | High | Inventory | Parallel stock-outs oversell (stock 7 → −26) |
| NEG-03 | High | Patients | Searching a patient by full phone number returns 500 |
| NEG-04 | High | Booking / availability | Negative `duration_min` on `/availability` blocks the event loop (DoS) |
| NEG-05 | Medium | Cross-cutting | Several database errors are returned as 500 instead of 422 |
| NEG-06 | Medium | Booking | Reusing an Idempotency-Key with a different body silently returns the first booking |
| NEG-07 | Medium | Appointments / billing | Cancelling an arrived, unpaid visit leaves its invoice as patient debt |
| NEG-08 | Medium | Patients | Parallel registration of the same person skips the duplicate warning (10 cards created) |
| NEG-09 | Medium | Validation (dates) | Impossible dates roll over silently (`2027-02-30` is booked on 2027-03-02); year 0001 is stored as 1901; year 9999 is accepted |
| NEG-10 | Low | Invoices | Discounts smaller than a tiyin are accepted and stored as a 0 discount, and still audited |
| NEG-11 | Low | Patients | Names made only of zero-width characters are accepted |
| NEG-12 | Low | Patients | `PATCH` accepts a birth date of 1800 (create rejects dates before 1900) |
| NEG-13 | Low | Invoices | A fully refunded invoice that had payments can be voided |
| NEG-14 | Low | Reports | Pro-rated line values after refunds drift 1 tiyin from the invoice total |
| NEG-15 | Low | Search | LIKE wildcards are not escaped (`%` and `_` match every row) |
| NEG-16 | Low | Cameras | Camera timestamps are not sanity-checked (a year-9999 event is stored; `last_event_at` stays at 9999) |
| NEG-17 | Low | Telegram | A callback carrying 36 hex characters that are not a UUID aborts the update with a logged ERROR |
| NEG-18 | Low | Invoices | A manager-approved percent discount silently extends to services added later |

---

## Findings

### NEG-01 (High): parallel cash-outs push a drawer below zero
**Reproduction** (`concurrency.mjs` C6 and C7):
- **C6.** The cashier's drawer expected 1,520,000 so‘m. I sent 10 × `POST /expenses {category:'Boshqa', amount: 91200000}` (60% of the drawer each) with `Promise.all`.
  - Actual: all 10 returned `201`. `GET /cash-shifts/current` then showed `expected_cash = -760000000` (−7,600,000 so‘m).
- **C7.** The Yunusobod drawer held 460,000 so‘m. I made card payments on 8 invoices, then sent 8 parallel `POST /invoices/:id/refunds {method:'cash', amount:15000000, shift_id}`.
  - Actual: all 8 returned `201`, and `expected_cash = -74000000`.
- Global invariant INV-G: 2 shifts have negative expected cash.

**Expected:** the first requests succeed and the rest get 409 `INSUFFICIENT_CASH`. A drawer is never negative. CLAUDE.md: "Cash may leave a drawer only if it is there".

**Cause:**
- The refund and expense paths lock the shift with `FOR SHARE` (`apps/api/src/modules/cash.controller.ts:184`, `:229`, `:237`).
- Shared locks do not block each other, so every transaction runs `assertCashAvailable` (`:45`) against the same pre-race totals.

**Fix:** take `FOR UPDATE` on the shift row in the cash-out paths (refund with method cash, cashier expense, manager drawer expense) before `assertCashAvailable`. Payments add cash, so they can keep `FOR SHARE`.

### NEG-02 (High): parallel stock-outs oversell inventory
**Reproduction** (`concurrency.mjs` C9): the item "Glyukoza test-polosalari" had qty 7. I sent 20 × `POST /inventory/:id/movements {type:'out', quantity:3, reason:'race out'}` in parallel.
- Actual: 11 returned `201` and 9 returned `422`. The final qty is **−26**. INV-H confirms negative stock.
- Expected: at most 2 succeed and qty stays ≥ 0.

**Cause:**
- `inventory.controller.ts:46` computes `qty` with a subquery inside `SELECT … FOR UPDATE`.
- Movements never update the item row. The lock therefore only serialises the requests, and the subquery result comes from the snapshot taken when the statement started. That snapshot is stale for every waiter.

**Fix:** lock the item first (`SELECT id FROM inventory_items … FOR UPDATE`), then compute qty in a new statement. Alternatively, keep a stored `qty` column updated with a `CHECK (qty >= 0)`.

### NEG-03 (High): patient search by full phone number returns 500
**Reproduction:** as registrar:
- `GET /patients?search=%2B998%2090%20123%2045%2067` → `500 INTERNAL`
- `GET /patients?search=998901234567` → `500`
- `GET /patients?search=12345678901` → `500`

Log: `value "998901234567" is out of range for type integer`.

**Expected:** `200` with matches. Searching by phone is the registrar's main lookup.

**Cause:** `patients.controller.ts:46` pushes `Number(digits)` as a `patient_number` (int4) parameter for any digit-only search. Any search of 10 or more digits overflows.

**Fix:** add the `patient_number` condition only when `digits.length <= 9`, or compare `p.patient_number::text = $n`.

### NEG-04 (High): negative `duration_min` on `/availability` blocks the API
**Reproduction** (`dos_availability.mjs`): as registrar, `GET /availability?doctor_id=<Akmal>&date=2026-10-19&duration_min=<d>`.

| `duration_min` | Status | Slots | Response size | Time | Concurrent `/me` |
|---|---|---|---|---|---|
| 30 | 200 | 34 | 1.7 KB | 40 ms | 8 ms |
| −10,000,000 | 200 | 666,707 | 30 MB | 0.43 s | 142 ms |
| −100,000,000 | 200 | 6,666,707 | **309 MB** | **5.0 s** | **1.7 s** |

**From reading the code (not executed):** `duration_min=-Infinity` gives `Number('-Infinity') = -Infinity`. The loop condition `t + duration <= e0` is then always true, so the loop never ends and the process grows until it runs out of memory. Any doctor, registrar or manager can trigger this.

**Expected:** 422 for values outside 5–240.

**Cause:** `reference.controller.ts:105` uses `Number(q.duration_min) || 30` with no range check. The loop in `booking.ts` `availability()` has no guard.

**Fix:** validate an integer in 5–240, and add `if (duration < 5 || duration > 240) return …` in `availability()`.

### NEG-05 (Medium): several database errors are returned as 500
`ErrorFilter` (`core/errors.ts:38`) maps only `22P02`, `22007` and `22008` to 422. These cases reproduce as `500 INTERNAL`:

| Request | PG error |
|---|---|
| `POST /patients {…, note:'abc\u0000def'}` | 22021 invalid byte sequence (NUL) |
| `POST /appointments {…, note:'a\u0000b'}` | 22021 |
| `POST /invoices/:id/payments {amount:100, method:'cash', note:'x\u0000'}` | 22021 |
| `POST /telegram/sim/send {chat_id:-5, text:'a\u0000b'}` | 22021 |
| `POST /hik/<token>` with XML containing `\u0000` in `channelID` | 22021 (the camera gets a 500, and the rest of the body is lost) |
| `POST /inventory/:id/movements {type:'in', quantity:0.001}` | 23514 (rounds to 0.00, then the CHECK fails) |
| `POST /inventory/:id/movements {type:'in', quantity:1e11}` | 22003 numeric field overflow |
| `PATCH /services/:id {price:1e20}` | 22003 bigint out of range |
| `GET /patients?page=5000000000000000000` (also `/invoices`, `/payments`, `/orders`, `/audit`) | 22003 (OFFSET 1e20) |

**Expected:** 422 with a field error.

**Fix:**
- Map `22003`, `22021` and `23514` to 422 in the filter.
- Reject `\u0000` in `trimmed`/`optionalText` (`schemas.ts:5`).
- Cap `page` in `pageParams` (`validate.ts:15-18`).
- `inventoryMovementSchema.quantity`: `.multipleOf(0.01).max(9_999_999_999.99)`.
- `servicePatchSchema.price`: add a `.max()`.

### NEG-06 (Medium): booking Idempotency-Key reuse with a different body is silently replayed
**Reproduction** (`statemachine.mjs` IDK-1), with header `Idempotency-Key: booking-key-123456`:
1. `POST /appointments {patient: P10, date: 2026-10-21, 10:00}` → `201 {id: fd4a…}`
2. `POST /appointments {patient: P11, date: 2026-10-21, 11:00}` with the same key → `201 {id: fd4a…, replayed: true}`

**Actual:** patient P11 is not booked, yet the response is 2xx. A UI that ignores `replayed` shows success.

**Expected:** 422 `IDEMPOTENCY_MISMATCH`, as payments (IV-3) and refunds (IV-11) already do.

**Cause:** `booking.ts:72-76` returns `prev` without comparing the request.

**Fix:** store a fingerprint (patient, doctor, service, date, time, duration) next to `request_key` and compare it on replay.

### NEG-07 (Medium): a cancelled arrived visit leaves an unpaid invoice as debt
**Reproduction** (`extra.mjs` E1):
1. Book today → check in. Invoice 150,000 so‘m `unpaid`; dashboard debt +150,000.
2. Cancel: `POST /appointments/:id/cancel {version, reason:'Bemor ketib qoldi'}` → `200 {needs_billing_review:false}`.

**Actual:** the service order becomes `cancelled`, but the invoice stays `unpaid` with total 15,000,000 tiyin. Dashboard debt and the patient's `balance_due` still include 150,000 so‘m for a service that was never provided. The API also tells the UI that no billing review is needed.

**Expected:** void the invoice (or drop the line) when nothing was paid, or at least return `needs_billing_review:true`.

**Location:** `booking.ts:127` (`cancelAppointment`) touches only `service_orders`.

### NEG-08 (Medium): parallel registration of the same person creates duplicate cards
**Reproduction** (`concurrency2.mjs` C12): 10 parallel `POST /patients {last_name:'Parallelov', first_name:'Ikkinchi', birth_date:'1991-05-05', phone:'+998937770011'}` with no `confirm_duplicate`.
- Actual: **10 × 201, 10 cards**. A sequential repeat correctly returns 409 `DUPLICATE_WARNING`.
- Expected: 1 × 201 and 9 × 409 `DUPLICATE_WARNING`.

**Cause:** `findDuplicates` (`patients.controller.ts:95`) runs before any lock. The `tenants.patient_seq` row lock comes later (`:99`).

**Fix:** run the `patient_seq` UPDATE (row lock) before `findDuplicates`, or take `pg_advisory_xact_lock(hashtext(tenant||phone))`.

### NEG-09 (Medium): impossible and far-out dates are accepted and silently changed
Both `isoDate` (`schemas.ts:12-13`) and `isDate` (`validate.ts:21`) rely on `Date.parse`, which accepts day 30 and 31 in any month and rolls the date forward. `localToUtc` uses `Date.UTC`, which maps years 0–99 to 1900–1999.

| Request | Actual |
|---|---|
| `POST /appointments {date:'2027-02-30', start_time:'10:00', branch:YUN}` (via `PATCH` in RS-7) | `200`; stored `starts_at = 2027-03-02T05:00Z`. Booking the same request again gives 409 `SLOT_TAKEN`, which proves the date rolled over. On the central branch the error says "doctor works in Yunusobod **that day**", i.e. the weekday of March 2. |
| `POST /appointments {date:'9999-12-27'}` | `201`; booking horizon unbounded |
| `POST /expenses {occurred_on:'2026-02-30'}` | `201`; stored `2026-03-02` |
| `POST /expenses {occurred_on:'0001-01-01'}` | `201`; stored `1901-01-01` |
| `POST /inventory/:id/movements {date:'0001-01-01'}` | `201` |
| `GET /finance/summary?from=2026-02-30`, `GET /dashboard?from=2026-02-30&to=2026-03-01`, `GET /cameras/attendance?from=2026-02-30…` | `200`, echoing `"from":"2026-02-30"` |
| `GET /appointments?from=2026-10-20&to=2026-10-01` | `200 []`. The dashboard returns 422 for the same inverted range. |

**Expected:** 422 with a field error.

**Fix:**
- Validate dates with a round trip: `new Date(s+'T00:00:00Z').toISOString().slice(0,10) === s`.
- Bound years (for example 1900 to today + 1 year for bookings).
- Use `setUTCFullYear` in `localToUtc`.

### NEG-10 (Low): sub-tiyin discounts are accepted and stored as zero
**Reproduction:**
- `POST /invoices/:id/discount {type:'amount', value:0.4, reason:'fractional tiyin'}` → `200 {discount_amount:0}`.
- `{type:'percent', value:0.001}` → `200 {discount_amount:0}`.

Both write an `invoice.discount` audit row ("Chegirma 0 so‘m").

**Cause:** `discountSchema.value` (`schemas.ts:124`) is any positive number, and `invoices.controller.ts:83` rounds it.

**Expected:** 422. An amount must be integer tiyin; a percent should be a multiple of 0.01 that produces a non-zero discount.

### NEG-11 (Low): names made only of zero-width characters are accepted
**Reproduction:** `POST /patients {last_name:'​​​', first_name:'​​', birth_date:'1990-01-01'}` → `201`, patient #1101 with an invisible name. It also appears first in search results for `%`.

**Fix:** strip `\p{Cf}` and `\p{Cc}` characters in `trimmed()` (`schemas.ts:5`) before the length check.

### NEG-12 (Low): `PATCH /patients/:id` skips the 1900 lower bound
**Reproduction:** `PATCH /patients/:id {birth_date:'1800-01-01'}` → `200`. `POST` rejects any date before 1900.

**Fix:** add the same check in `update()` (`patients.controller.ts`).

### NEG-13 (Low): a fully refunded invoice that had payments can be voided
**Reproduction** (`statemachine.mjs` IV-17): pay in full → refund everything (status `refunded`, `paid_amount` 0) → `POST /invoices/:id/void {reason}` → `200`.
- Actual: the invoice is `void` while payment and refund rows still point at it.
- Expected: 409 `INVOICE_HAS_PAYMENTS`, which the error message itself promises.

**Cause:** `invoices.controller.ts:142` checks only the net `paid_amount`.

**Fix:** also refuse when `credit_amount > 0` or when any payment exists.

### NEG-14 (Low): pro-rated line values drift 1 tiyin from the invoice total after refunds
**Reproduction** (`money.mjs` MON-4): a 3-line invoice (33,000,000 tiyin), paid, then four refunds of 1, 7, 33 and 101 tiyin.
- Invoice total: 32,999,858.
- Σ`NET_LINE` = 32,999,857 (lines 14,999,935 / 5,999,974 / 11,999,948).

The services report and doctor shares therefore drift from the cash figures by rounding.

**Cause:** `billing.ts:58` rounds each line independently.

**Fix:** allocate the credit to lines with largest-remainder, or put the remainder on the last line, as `recalcInvoice` already does for discounts.

### NEG-15 (Low): LIKE wildcards are not escaped in search
**Reproduction:** `GET /patients?search=%` and `?search=_` → `total=103` (every patient). `GET /invoices?search=%` returns everything. `/orders` uses the same pattern.

There is no injection: values are bound parameters.

**Fix:** escape `\`, `%` and `_` and add `ESCAPE '\'`.

### NEG-16 (Low): camera timestamps are not sanity-checked
**Reproduction** (`hik.mjs`): `POST /hik/<token>` with `<eventType>linedetection</eventType><dateTime>9999-12-31T23:59:00+05:00</dateTime>` → `200 {stored:1}`.
- An event dated 9999-12-31 is stored.
- `cameras.last_event_at` becomes 9999-12-31 and can never move back (`ingest.ts:94` uses `GREATEST`).

**Fix:** reject or clamp device times more than about 1 day in the future (or very old) to `now()` in `parseCameraTime` (`isapi.ts:28`).

### NEG-17 (Low): a 36-hex non-UUID Telegram callback aborts the update
**Reproduction:** `POST /telegram/sim/send {chat_id, callback_data:'a:cy:ffffffffffffffffffffffffffffffffffff'}` → `200`, but the API logs `ERROR [TelegramBot] … invalid input syntax for type uuid` and the user gets the generic error text.

**Cause:** `engine.ts:303` uses `/^[0-9a-f-]{36}$/` instead of `isUuid()`.

### NEG-18 (Low): an approved percent discount extends to services added later
**Reproduction** (`extra.mjs` E6):
1. The manager applies 50% with the reason "Only the consultation".
2. The doctor then orders a lab test, which is added to the same unpaid invoice.
3. The lab line is also discounted 50% (`6000000 → discount_share 3000000`), with no new approval or audit entry.

**Fix:** decide the policy. Either freeze the discount to the lines that existed when it was approved, or open a separate invoice once a discount exists.

---

## Verified OK

All counts below are from parallel `Promise.all` runs against the isolated stack.

**Bookings and appointments**
- Same slot booked by 30 registrar requests: exactly 1 × 201 and 29 × 409 `SLOT_TAKEN`; 1 row.
- Same booking key × 30: all 2xx, 1 appointment.
- Reschedule × 10 with one version: 1 × 200, the rest 409 `STALE_STATE`.
- Check-in ∥ cancel ∥ doctor start: consistent final state.
- Validation and slot rules: `24:00`, `9:00`, duration 4 / 30.5, before or after the schedule, over the break (including exactly 13:00), past dates, wrong branch for the weekday, unknown or other-tenant patient/branch, bad UUID → all 422/403.
- Reschedule rules: into the past, over the break, outside the schedule, stale version → 422/409. A registrar of another branch gets 404. Moving to a weekday in another branch moves the branch.

**Check-in and queue**
- Check-in × 30 on one appointment: 1 ticket, 1 invoice, 1 number.
- Simultaneous check-ins: no duplicate `(branch, local_date, number)`.
- Check-in stale version → 409; check-in tomorrow → 409 `NOT_TODAY`; no-show of a future, arrived or completed visit → 409.
- Cancel arrived without a reason → 422; cancel / no-show / reschedule of a completed visit → 409.
- At local midnight `today` flips and the queue restarts at №1.

**Encounters and notes**
- Start before arrive → 409; another doctor → 403; complete without a signed note → 409 `NOTE_NOT_SIGNED`.
- Sign with a whitespace-only field → 422; stale version → 409; unknown ICD → 422.
- Sign twice → 409; sign × 15 in parallel → exactly 1 × 200.
- Edit after sign → 409; direct SQL `UPDATE` of a signed note is rejected by the trigger.
- Vitals out of range, bad ICD format and version type → 422.
- The same order × 15 in parallel → 1 order and 14 × 409 `DUPLICATE_ORDER`.

**Lab**
- Verify before result → 409; result before collect → 409; doctor collect → 403; collect twice → idempotent.
- Values `1e5` / `Infinity` → 422; partial result saved as a draft; verify with an empty parameter → 422.
- Doctors cannot see unverified values. Verify twice → `already`. Edit after verify → 409. The DB trigger blocks direct `UPDATE`.

**Payments**
- Missing or short key, amount 0, −1, 100.5, `"100"`, 1e20, more than due, bad method → 422. Manager paying → 403.
- Same key × 30 → 1 payment and 29 replays. Different keys × 30 → 1 × 201 and 29 × 409 `INVOICE_PAID`.
- 30 partial payments that together exceed the due → paid = total = Σpayments.
- Same key with a different amount → 422 `IDEMPOTENCY_MISMATCH`. Same key on two invoices concurrently → 201 + 409.
- Pay a void or paid invoice → 409. The payment `UPDATE` trigger works.

**Discounts, void and refunds**
- Discount of 101% / 0 / blank reason / more than the subtotal / by a cashier → 422/403. Discount after payment or on a void invoice → 409.
- Void a paid invoice → 409; void twice → idempotent.
- Refund more than paid → 422. Refund by a cashier → 403. Refund key reuse with a different amount → 422; an exact replay → 200.
- Refunds × 30 of ¼ of a payment → exactly 4 succeed; Σrefunds = payment.
- Cash refund into a closed shift → 409. A refund reduces paid and total equally.

**Cash shifts and expenses**
- Shift open × 10 → 1 open shift. Close twice → 409. Closing another cashier's shift → 404.
- Close racing 8 cash payments → frozen totals = live payments in the shift.
- Close or open with decimal, negative or more than the maximum → 422.
- Expense void × 10 → 1 × 200.

**Money and time**
- 33.33% and odd fixed discounts spread over 3 lines: Σ shares = discount, Σ lines = total, no negative line.
- These figures agree: dashboard revenue = finance net = Σ daily (today and 30 days); debt (dashboard = AI report = `invoices?debt=1`); `by_service` = services report = AI top-3.
- **Tashkent midnight:** a payment at 23:59:25 counts on the 18th. A payment and a refund at 00:00:02 count on the 19th. Dashboard, finance, the payments register, the daily series and the AI `revenue_today` all agree. The invoice day filter uses the local day.
- Global invariants after all races (except NEG-01 and NEG-02): `paid ≤ total`, no paid void invoice, `paid_amount = Σpayments − Σrefunds`, `subtotal = Σline_subtotal`, `discount = Σdiscount_share`, Σrefunds ≤ payment, unique receipt numbers.

**Patients and consent**
- Empty, whitespace-only, 10k-character, numeric or malformed-JSON input (→ 400 `BAD_JSON`), 1899, future dates, ISO-with-offset birth dates, bad phone or sex → 422.
- Cyrillic, RTL and emoji names are stored as data. Extra fields are ignored. An unknown or bad UUID → 404.
- Consent: biometric with a verbal method → 422; staff using the `telegram` method → 422; cashier → 403; a note longer than 500 characters → 422.
- Biometric grant/withdraw × 20 interleaved: the live face code always matches the latest consent.

**Staff, schedule, settings, auth**
- Short name, bad role, short login, other-tenant branch, doctor without a specialty, share 101%, empty branches → 422.
- Registrar → 403. Self-deactivation → 403. Same login × 10 → 1 × 201 and 9 × 409 `LOGIN_TAKEN`.
- Schedule weekday 7, less than 30 minutes, break outside hours, duplicate weekday → 422.
- Service price −1 / 1.5, duration 0 → 422. Blank clinic name and bad preferences → 422. Empty or 65-character login → 422.

**Cameras**
- No purposes, an 81-character name, a face code without consent, simulator count −1 or a long code → 422.
- Face code × 20 → 1 live code.
- Arrival accept × 20 → 1 × 200 and 19 × 409, with 1 ticket and 1 invoice.
- `/hik`: bad or unknown token → 404. Empty, non-XML, broken XML or JSON, JSON array or null, 50k-deep JSON, a huge or negative count, multipart without a boundary → 200 with nothing stored. 7 MB → 413.
- Attendance ranges longer than 92 days or inverted → 422.

**Telegram simulator**
- Confirm pressed × 10 in parallel → exactly 1 booking.
- Garbage callbacks (`:`, `a:cy:`, a huge version number, 64 × `x`) are handled.
- A forged `a:cy:<foreign appointment>` is refused.
- Positive `chat_id` and 10k text → 422. `after=1e30` → 422.

**AI (sample mode)**
- Text shorter than 10 or longer than 6000 characters → 422. A non-sample text → 422 `AI_SAMPLE_ONLY`. The exact demo text → `mode:'sample'`.
- No `ai_usage` rows are written. An unknown encounter → 404. A registrar → 403.
- Bad report question → 422. Invalid news topics or more than 5 → 422.

**Other**
- Pagination: `page=0`, `-1`, `abc` and `1e3` fall back to page 1. `page_size=1000` is capped at 100. `page=99999999` → empty.
- Receipt of another branch → 404 for the cashier.
- Queue `?date=2026-02-30` / `9999-12-31` → 422; another tenant's branch → 403.
- Document validation: `rest_days` 31, no items, 16 items, unknown ICD, bad kind → 422. Void a document twice → 409.

## Not tested
- **Telegram:** the real Bot API, webhook secret handling and the outbox delivery workers (`BACKGROUND_WORKERS=off`); only `sim/run-workers` exists and I did not exercise it.
- **AI:** live mode (Anthropic/Gemini), redaction quality and the news fetcher.
- **Concurrency:** a schedule `PUT` racing new bookings (the booking path does not lock the doctor row; not proven); patient merge.
- **Auth:** lockout and IP throttle timing under parallel load, and the `production`-mode consent requirement.
- **Documents:** permissions on print data (no document existed after the reset in `misc.mjs`; `documents.test.mjs` already covers it).
- **Other:** the web UI, CSV export content beyond formula escaping, multi-tenant isolation beyond the other-tenant branch/patient probes above, and memory or latency under sustained load.
- **By design (not reported):** a doctor can add orders to a completed visit with a signed note (`POST /encounters/:id/orders` → 201). The spec says an order "may continue after the visit", so I have not reported this as a bug.
