# Med.uz.ai — load & large-data audit (2026-10-20)

**Verdict.** With 3 years of data at the target scale (100k patients, ~1M appointments), the current build **does not survive normal clinic traffic**. A steady polling mix for 51 staff (6 req/s) gave p50 99 s and 30 % timeouts; camera pushes timed out too. Two missing indexes are most of the cause: `invoices(appointment_id)` and `invoice_items(invoice_id)`. With the suggested indexes, the same mix at **3× the target (153 staff)** ran at p95 83 ms and p99 0.68 s. Four other problems have nothing to do with indexes:
- the API process crashes when its DB connections drop;
- the pool has no timeouts, so one slow page blocks everyone;
- Docker's 64 MB `/dev/shm` turns parallel queries into HTTP 500s;
- the CSV export is unbounded and kept in memory (up to 2.2 GB RSS).

No product code was changed. Scripts are in `/Users/levi/Desktop/Meduza/audit/load/`. Raw JSONL results and logs are in `…/scratchpad/load/`.

## 1. Environment and data

| Item | Value |
|---|---|
| Host | MacBook (Apple silicon, 10 cores, 16 GB). Load generator, API and DB all ran on the same machine, so absolute numbers are optimistic for network and pessimistic for CPU contention. |
| DB | Docker `meduza-db` (pgvector/pg16, PostgreSQL 16.15). VM: 10 CPU / 7.7 GB. **`shared_buffers` 128 MB, `work_mem` 4 MB, `/dev/shm` 64 MB** (defaults). `pg_stat_statements` can't be enabled without a restart, so I used `EXPLAIN (ANALYZE, BUFFERS)` on queries copied from the controllers (`audit/load/explain.sql`). |
| API | `apps/api/dist` started with `node` on :4321, `APP_MODE=demo`, `BACKGROUND_WORKERS=off`. One process, **pg pool `max: 10`, no connection or statement timeouts**. Other agents rebuilt dist while I was testing; the SQL shapes I measured are unchanged in the current source. |
| Database | `meduza_load_test`: demo seed plus synthetic data from `audit/load/gen.sql` (generate_series, deterministic seed, all constraints kept). It has been dropped. |

| Table | Rows | Size |
|---|---:|---:|
| audit_logs | 2.60 M | 572 MB |
| camera_events (people_count every 2 min × 3 cams, 10 staff face matches/day, patient faces, 22k security) | 2.13 M | 943 MB |
| appointments (64 extra doctors, 30-min grid over 3 years + 2 weeks ahead; 909 today) | 987 k | 432 MB |
| service_orders / invoice_items | 994 k / 994 k | 446 / 247 MB |
| invoices / queue_tickets / encounters / clinical_notes | 828 k each | 230–306 MB each |
| payments | 787 k | 306 MB |
| lab_results | 166 k | 94 MB |
| patients / patient_consents / face_codes | 100 k / 120 k / 20 k | 38 / 34 / 7 MB |
| Total | | **4.2 GB** (≈1.4 GB per year of operation) |

Other setup: 3 branches, 72 doctors, 95 memberships, 7 cameras.

## 2. Read endpoints under concurrency (as-is, before any fix)

How the runs worked:
- Closed loop: `c` virtual users, 10 s per run.
- Rows marked ¹ are heavy pages: each user sends exactly one request, so `c` requests arrive at once.
- Latency is in ms. Client timeout is 120 s.
- Rows marked ‡ are shown with parallel query **off**. With the default parallel setting they mostly fail, see the next table.

| Endpoint (role) | c=1 p50 · KB | c=10 p50/p95/p99 · rps | c=50 p50/p95/p99 · rps | c=200 p50/p95/p99 · rps · err |
|---|---|---|---|---|
| patients search: name `%karim%` (registrar) | 85 · 9 | 166/259/311 · 57 | 781/916/984 · 62 | 3035/3170/3299 · 65 |
| patients search: phone digits | 129 · 0.5 | 198/370/534 · 46 | 954/1151/1237 · 50 | 3906/4045/4332 · 51 |
| patients search: ID | 94 · 9 | 186/267/305 · 51 | 965/1307/1394 · 48 | 3969/4399/4466 · 49 |
| patients list (default) | 26 · 9 | 41/61/88 · 230 | 198/226/236 · 250 | 892/1697/1760 · 196 |
| patient card | 4 · 0.7 | 4/8/13 · 2327 | 15/22/28 · 3130 | 63/85/95 · 3060 |
| patient history ¹ | 355 · 5 | 1232/1313/1313 | 2257/4013/4473 | 17075/34273/35001 |
| **schedule day, all doctors ¹** | **23 002 · 520** | 51 187/51 462/51 462 | 120 006 (60 % timeouts) | 100 % timeouts |
| availability (doctor/day) | 212 · 2 | 60/162/255 · 117 | 212/353/456 · 228 | 724/1308/1561 · 255 |
| queue (day) | 12 · 215 | 24/36/54 · 392 | 125/251/320 · 346 | 546/1248/1413 · 296 |
| **doctor today list** (50 % appointments, 50 % queue) | 31 · 9 | 29/2622/2719 · 9 | 4076/5267/5888 · 11 | 17139/18425/19259 · 11 |
| doctor's patients | 103 · 9 | 342/515/615 · 28 | 1342/1651/1794 · 36 | 6534/7571/7766 · 28 |
| dashboard today ¹‡ | 596 · 20 | 1779/1794/1794 | 4881/5520/5685 | 19529/22483/22700 |
| dashboard 30 d ¹‡ | 1274 · 23 | 3588/3590/3590 | 15281/16369/16549 | 47881/51638/51808 |
| dashboard 1 y ¹‡ | 7592 · 43 | 7583/7585/7585 | 28472/29441/29718 | 105474/108246/108823 |
| finance summary 30 d | 7 · 0.7 | 9/16/25 · 998 | 44/67/97 · 1062 | 170/249/317 · 1088 |
| finance summary 1 y ¹ | 37 | 525/555/555 | 1435/1470/1490 | 3363/3368/3369 |
| payments register 1 y ¹ | 68 · 8 | 363/447/447 | 1118/1152/1177 | 5703/5724/5725 |
| **payments CSV 1 y ¹‡** | 1235 · **31 791** | 11316/11473/11473 | 40129/48828/48889 | 50 % timeouts, API RSS 1.3 GB |
| reports services 1 y ¹‡ | 397 · 5 | 7290/7535/7535 | 11096/17155/17600 | 50308/79169/79276 |
| reports doctors 1 y ¹‡ | 373 · 11 | 1934/1990/1990 | 7218/12037/12069 | 31873/57474/57502 |
| cash desk invoices, all ¹‡ | 1535 · 9 | 4345/4441/4441 | 13292/19461/20488 | 44187/79537/82085 |
| cash desk debts ¹ | 1138 · 9 | 2480/2515/2515 | 7588/12023/12063 | 33094/53968/55230 |
| **cash desk invoices, today ¹** (the default view) | 926 · 9 | 1761/1803/1803 | 5646/9292/9434 | 19928/41803/43783 |
| lab orders, default "all" ‡ | 151 · 25 | 2039/3706/3868 · 4 | 6026/7116/7543 · 7 | 21387/31629/31974 · 6 |
| **cameras list ¹** | **5366** · 3 | 18817/18822/18822 | 29638/45766/45791 | 95318 (35 % timeouts) |
| cameras attendance 30 d | 228 · **901** | 756/1219/1322 · 12 | 3911/5251/5313 · 12 | 16479/18963/18983 · 11 (RSS 309 MB) |
| cameras attendance 92 d ¹ | 313 · **2652** | 2909/2957/2957 | 5405/5595/5607 | 18807/22630/22670 (API RSS 789 MB, CPU 212 %) |
| cameras traffic 30 d | 42 · 2 | 47/76/109 · 198 | 244/405/638 · 184 | 1086/2259/2313 · 162 |
| cameras security 30 d | 146 · 100 | 831/1742/2007 · 11 | 3215/3814/4291 · 15 | 10213/13385/13711 · 15 |
| news feed (doctor) | 9 · 1.4 | 3/5/6 · 3435 | 12/20/29 · 3658 | 51/63/78 · 3814 |
| audit log page 1 | 98 · 5 | 143/264/797 · 59 | 791/1451/1564 · 57 | 3122/3719/4802 · 61 |
| `/me` (cheapest authed call) | 4 · 0.7 | 2/4/6 · 3990 | 11/16/20 · 4211 | 49/72/88 · 3830 |

**As-is error rates with parallel query on (default settings, Docker `/dev/shm` 64 MB), at c = 10 / 50 / 200.** Every failure is HTTP 500 `could not resize shared memory segment … No space left on device`:

| Endpoint | c=10 | c=50 | c=200 |
|---|---:|---:|---:|
| dashboard 1 y | 60 % | 92 % | 97 % |
| reports services | 60 % | 92 % | 96 % |
| reports doctors | 70 % | 96 % | 95 % |
| payments CSV | 80 % | 94 % | 86 % |
| cash desk invoices | 40 % | 84 % | 56 % |
| lab orders | 59 % | 55 % | 70 % |

**Camera push `/hik`** (real ISAPI shapes: 50 % multipart face match, 30 % people-counting XML, 20 % fielddetection XML; open loop):

| Offered rate | Achieved | p50 / p95 / p99 ms | Errors | Notes |
|---|---|---|---|---|
| 100 ev/s × 60 s | 100 /s | 5 / 8 / 13 | 0 | 6000 stored, API CPU 25 % |
| 500 ev/s × 30 s | 500 /s | 2 / 84 / 430 | 0 | |
| 1500 ev/s × 20 s | **926 /s** | 7239 / 11917 / 12389 | 0 | 12.7k requests in flight, no load shedding |

Body-size limit: 5.9 MB → 200 in 28 ms; 6.5 MB → 413; 20 × 5.9 MB in parallel → all 200, 309 ms.

**Login:**

| Test | Result |
|---|---|
| Valid logins, c=20 | **84 /s**, p99 298 ms. scrypt runs on the libuv pool; API CPU 415 %. |
| Wrong-password flood from one IP | 429 after the 20-failure threshold (37 got through because of concurrency). |
| Same flood with a rotating `X-Forwarded-For` | **0 × 429 out of 1299 attempts**: the throttle is bypassed. |

## 3. Writes under contention (c=50, as-is → with the indexes from F1/F2)

| Operation | Throughput | p50 / p95 / p99 ms | Lock waits (pg_stat_activity) | Correctness |
|---|---|---|---|---|
| Book distinct free slots | 734–1040 /s | 46–56 / 61–145 / 76–198 | none | 3000/3000 created |
| 50 bookings for the same slot | — | 50 / 61 / 61 | none (exclusion constraint) | exactly 1 × 201, 49 × 409 |
| **Check-in** | **10 /s → 106 /s** | **4523 / 6965 / 10565 → 426 / 626 / 786** | 9 waiters, max wait **10.7 s → 0.5 s**, on `queue_counters` and `tenants.invoice_seq` | ok |
| Payment (distinct invoices) | 357–463 /s | 101–125 / 150–232 / 271–304 | 9 waiters on `tenants.receipt_seq`, max 0.23 s | ok |
| 50 full payments of one invoice | — | 41–55 / – / 52–124 | invoice `FOR UPDATE` | exactly 1 payment |

No deadlocks occurred.

## 4. Steady-state mix (mirrors the web app's `refetchInterval` polling)

Script: `mixed.mjs`, 120 s, open loop. Scale 1 means 30 doctors, 10 registrars, 6 cashiers, 3 managers, 2 lab staff and 3 cameras: 51 users, about 6 req/s.

| Run | req/s | p50 | p95 | p99 | Errors |
|---|---:|---:|---:|---:|---:|
| **As-is, scale 1** | 5.9 | **99 189 ms** | 120 002 ms | 120 003 ms | **30 %** timeouts, including camera pushes |
| With indexes (parallel off), scale 1 | 5.8 | 17 ms | 102 ms | 822 ms | 0 |
| With indexes (parallel off), scale 3 (153 users) | 17.5 | 12 ms | 83 ms | 679 ms | 0 |

What remains slow after the index fixes:

| Page | p50 | p95 |
|---|---:|---:|
| Manager dashboard | 0.4 s | 1–3 s |
| Lab orders, default "all" | 0.7 s | 2 s |
| Security tab | 0.4 s | 5 s |

## 5. Findings

| ID | Sev | Title |
|---|---|---|
| F1 | Critical | No index on `invoices(appointment_id)`: the schedule and the doctor's day list scan every invoice for each row |
| F2 | Critical | No index on `invoice_items(invoice_id)`: invoice lists, patient history, receipts and check-in scan the whole table |
| F3 | Critical | The API process crashes when the DB drops its connections (no pool `'error'` listener) |
| F4 | High | Pool of 10 with no connect or statement timeout, and abandoned requests keep running: one slow page blocks everyone for minutes |
| F5 | High | Docker `/dev/shm` 64 MB: parallel queries fail and return HTTP 500 |
| F6 | High | Payments CSV has no range limit, is built in memory and blocks the event loop |
| F7 | High | Patient search uses `LIKE '%…%'`, so it scans the whole table (≈50–65 req/s ceiling) |
| F8 | High | Check-in holds hot counter rows (`queue_counters`, `tenants.invoice_seq`) through slow queries |
| F9 | High | The cameras list counts every event a camera ever sent (5–95 s) |
| F10 | Medium | `demo_now()` is VOLATILE: evaluated per row and blocks index ranges (also slows the Telegram reminder planner, 1.6 s every minute) |
| F11 | Medium | Dashboard rescans the full history on every 30 s poll |
| F12 | Medium | The schedule silently cuts off at 500 rows (909 appointments today) |
| F13 | Medium | Availability reads a doctor's whole appointment history |
| F14 | Medium | Doctor-scoped lists use `EXISTS` over appointments without a (doctor, patient) index |
| F15 | Medium | All-time default lists (cash desk "all", lab orders "all", audit) count and sort the whole history |
| F16 | Medium | Login throttle can be bypassed with `X-Forwarded-For`; the per-IP lock can lock out a whole clinic; failure map is never pruned |
| F17 | Low | Large uncompressed payloads (queue 215–349 KB every 12 s, attendance 2.6 MB) |
| F18 | Low | Camera ingest: two transactions and two writes to the hot camera row per event; no backpressure |
| F19 | Low | Expired sessions are never purged |

### Evidence, root cause and fix

**F1. `invoices(appointment_id)` (Critical)**
- **Evidence:** schedule for one day takes 23 s with a single user, 51 s at c=10 and times out at c≥50. The doctor's today list has p99 2.7 s at c=10 and 17 s at c=200. `EXPLAIN`: `Seq Scan on invoices … loops=500`, 25.6 s.
- **Root cause:** the `APPT_SELECT` invoice subquery in `apps/api/src/modules/appointments.controller.ts:20`. The same lookup without an index appears in `billing.ts:36` (check-in, `FOR UPDATE`), `booking.ts` `cancelAppointment` and the dashboard's "cancelled with payments".
- **Fix:** `CREATE INDEX CONCURRENTLY invoices_appointment ON invoices (appointment_id) WHERE appointment_id IS NOT NULL;`
- **Measured after:** schedule c=1 27 ms, c=50 p99 363 ms. Doctor's day c=50 p99 69 ms (1336 rps).

**F2. `invoice_items(invoice_id)` (Critical)**
- **Evidence:**
  - "Invoices today" (the cashier's default, polled every 20 s): 926 ms → 9 ms.
  - Patient history: 355 ms → 28 ms.
  - `EXPLAIN` patient invoices: 979 ms → 1.7 ms.
  - Check-in: 10 → 106 /s, and the longest lock wait drops from 10.7 s to 0.5 s.
- **Root cause:** per-row `string_agg` / `json_agg` subqueries at `invoices.controller.ts:49`, `:207` and `patients.controller.ts:200`. Also `billing.ts:44` (`max(position)`) and `:70` (`recalcInvoice`), both of which run inside the check-in transaction.
- **Fix:** `CREATE INDEX CONCURRENTLY invoice_items_invoice ON invoice_items (invoice_id, position);`

**F3. API crashes on DB connection loss (Critical)**
- **Evidence:** `pg_terminate_backend` on the API's 10 backends during load. The process exited about 4 s later with `Unhandled 'error' event … Emitted 'error' event on BoundPool … terminating connection due to administrator command`. After that, 380k requests got `ECONNREFUSED`. A DB restart, failover, idle-timeout or proxy reset would do the same.
- **Root cause:** `database/src/index.ts:19` creates `new Pool({max: 10})` with no `pool.on('error')` listener, and `core/db.ts` doesn't add one either.
- **Fix:**
  - Add `pool.on('error', (e) => logger.warn(...))`.
  - Add a readiness check that runs `SELECT 1`.
  - Keep the process supervisor restart policy as a second line of defence.

**F4. Pool exhaustion and runaway queries (High)**
- **Evidence:**
  - 30 concurrent 1-year dashboards → a registrar's `/me` took up to 20.4 s, `/queue` 22.9 s, camera heartbeat 14 s.
  - 230 timed-out schedule requests kept running server-side and blocked **all** endpoints (including demo login and `/hik`) for more than 8 minutes, until I restarted the API.
- **Root cause:**
  - `max: 10` with no `connectionTimeoutMillis`, so the wait queue is unbounded.
  - No `statement_timeout`.
  - A client disconnect never cancels its query.
- **Fix:**
  - `new Pool({ max: 20, connectionTimeoutMillis: 5000, statement_timeout: 15000, idle_in_transaction_session_timeout: 30000 })`. Reports and exports can raise the limit with `SET LOCAL statement_timeout = '60s'`.
  - Map pool-timeout errors to 503.
  - Give camera ingest and auth a small separate pool.
  - On `req.on('close')`, cancel the running query (`pg_cancel_backend`).

**F5. Docker `/dev/shm` 64 MB (High)**
- **Evidence:** 40–97 % HTTP 500 on dashboard 1 y, reports, CSV, cash desk list and lab orders at c≥10 (log: `could not resize shared memory segment … No space left on device`). `VACUUM` failed the same way.
- **Root cause:** `docker-compose.yml` has no `shm_size`. Parallel hash joins need dynamic shared memory.
- **Fix:**
  - `shm_size: 1g` on the db service. Check the Railway Postgres shm size.
  - Or set `max_parallel_workers_per_gather` to suit the container.
  - The index fixes also remove most of the large hash joins.

**F6. Payments CSV (High)**
- **Evidence:**
  - One year is 31.8 MB; no range (or 3 years) is 93.6 MB. One export blocks the event loop for up to 1.7 s, which other users feel as a freeze.
  - 10 concurrent 1-year exports → API RSS 1.29 GB. 50 → 1.47 GB.
  - 20 clients that never read the body → **RSS 2.24 GB**, `/me` took 75 s, and 1.3 GB was still held after they disconnected. On a 1–2 GB container this means OOM.
- **Root cause:** `invoices.controller.ts:182-198` loads every row, builds `lines[]` and sends one big string. `filters()` makes the date range optional.
- **Fix:**
  - Require `from`/`to` and cap the range at 366 days.
  - Stream rows with `pg-cursor` or `COPY … TO STDOUT` through a Transform, respecting `res.write()` backpressure.
  - Allow one export per user at a time.

**F7. Patient search (High)**
- **Evidence:** about 50–65 rps total. At c=200, p50 is 3–4 s (seq scan on every keystroke search).
- **Root cause:** `patients.controller.ts:45-49`, where `%term%` `LIKE` sits on concatenated expressions and `replace(phone)`, plus a separate `count(*)`.
- **Fix:**
  ```sql
  CREATE EXTENSION pg_trgm;
  CREATE INDEX patients_fullname_trgm ON patients USING gin ((lower(last_name||' '||first_name||' '||coalesce(middle_name,''))) gin_trgm_ops);
  CREATE INDEX patients_firstlast_trgm ON patients USING gin ((lower(first_name||' '||last_name)) gin_trgm_ops);
  CREATE INDEX patients_phone_trgm ON patients USING gin ((replace(coalesce(phone,''),'+','')) gin_trgm_ops);
  CREATE INDEX patients_created ON patients (tenant_id, created_at DESC, patient_number DESC);
  ```
- **Measured after:** name search 572–686 rps (p50 15 ms); phone 1.6–2.8k rps; ID 1.7–1.9k rps.

**F8. Check-in hot rows (High)**
- **Evidence:** lock waits on `INSERT INTO queue_counters … ON CONFLICT DO UPDATE` (117 samples) and `UPDATE tenants SET invoice_seq` (89 samples). The longest wait was 10.7 s.
- **Root cause:** `appointments.controller.ts:157` and `billing.ts:14` lock a per-branch-per-day row and the tenant row early, then run the F1/F2 scans while holding them. Payments have the same pattern on `tenants.receipt_seq` (`invoices.controller.ts:118`), with waits of 0.23 s.
- **Fix:**
  - F1 and F2 first.
  - Take the number locks as the **last** statements before COMMIT.
  - Keep the tenant row free of other columns that get updated (or move the counters to a `tenant_counters` table).
  - Numbers stay gap-free.

**F9. Cameras list (High)**
- **Evidence:** 5.4 s with one user, 19–95 s concurrently, 35 % timeouts at c=200. `EXPLAIN`: 303k rows filtered per camera.
- **Root cause:** `cameras.controller.ts:58` counts `received_at >= demo_now() - 24h` per camera. The only usable index is `(camera_id, dedupe_key)`, and the VOLATILE `demo_now()` prevents an index range scan.
- **Fix:**
  - `CREATE INDEX camera_events_camera_received ON camera_events (camera_id, received_at);`
  - Use `(SELECT demo_now())` or a `$n` parameter set from `now()` in JS.
- **Measured after:** 8.7 s → 27 ms. The index alone gave 3.1 s.

**F10. VOLATILE `demo_now()` in predicates (Medium)**
- **Evidence:** the Telegram `planReminders` query (every 60 s × 2 kinds, `telegram/notifier.ts:47`) took **1.64 s**, a bitmap scan over 848k rows. With `(SELECT demo_now())` it takes **30 ms**. The same pattern affects the camera list, the patient list's `next_appointment` and `deliverDue`.
- **Root cause:** `database/migrations/002_demo_clock.sql:11` declares the function `VOLATILE`. It is evaluated once per row, with a subquery each time, and can't be used as an index bound. The same happens in production mode.
- **Fix:** wrap it as `(SELECT demo_now())` (an initplan, evaluated once) or pass the time as a parameter from `core/clock.now()`.

**F11. Dashboard rescans history (Medium)**
- **Evidence:**
  - Single user: today 0.6 s, 30 d 1.3–2.6 s, 1 y 3.8–7.6 s. Ten managers at once: today 1.8 s, 1 y 7.6 s. It is polled every 30 s.
  - Open camera alerts: a full `camera_events` scan, 1.2 s.
  - "Cancelled with payments": hash join over all 826k invoices, 1.3 s.
  - Lab pending over all history: 0.22 s. Debt over all invoices: 0.06 s.
  - `by_service` 1 y: 1.1 s, and still 1.5 s for 30 d after the indexes because the planner picks a hash join.
- **Root cause:** `dashboard.controller.ts:47-80` and `cameras.controller.ts:344` (`cameraAttention`).
- **Fix (indexes):**
  ```sql
  CREATE INDEX camera_events_open_alerts ON camera_events (tenant_id, branch_id) WHERE alert;
  CREATE INDEX invoices_open ON invoices (tenant_id, branch_id) WHERE status IN ('unpaid','partially_paid');
  CREATE INDEX service_orders_lab_open ON service_orders (tenant_id, branch_id, status) WHERE category='lab' AND status IN ('ordered','sample_collected','draft_result');
  CREATE INDEX service_orders_performed ON service_orders (tenant_id, performed_at) WHERE status IN ('completed','verified');
  CREATE INDEX service_orders_performer ON service_orders (performer_doctor_id, performed_at) WHERE status IN ('completed','verified');
  ```
- **Fix (queries and caching):**
  - Limit "cancelled with payments" to the last 90 days.
  - Cache the dashboard response per (tenant, branches, range) for 30–60 s.
  - For ranges over 31 days, use a daily aggregate table (revenue, services, visits per branch per day) and compute only today live.

**F12. Schedule capped at 500 rows (Medium)**
- **Evidence:** 909 appointments today across 3 branches, but `/appointments?date=` returns 500 and `meta.total = 500`, so the registrar silently loses the afternoon. 1–3k visits a day is the target.
- **Root cause:** `appointments.controller.ts:42`, `LIMIT 500`.
- **Fix:**
  - Default to the selected branch (or doctor).
  - Return `truncated: true` and the real count, or paginate by doctor.
  - The response is 527 KB, so trim columns.

**F13. Availability (Medium)**
- **Evidence:** 212 ms with one user, 0.4 s in `EXPLAIN`: a bitmap scan over all 13k of the doctor's rows.
- **Root cause:** `booking.ts:51-54` filters `starts_at < $3 AND ends_at > $2`, which has no lower bound.
- **Fix (either):**
  - Use `tstzrange(starts_at, ends_at, '[)') && tstzrange($2, $3, '[)')`. This uses the existing exclusion GiST index: 1.25 ms.
  - Or add `AND starts_at >= $2 - interval '1 day'` with an index on `(doctor_id, starts_at)`: 0.12 ms.

**F14. Doctor-scoped lists (Medium)**
- **Evidence:** the doctor's patient list takes 342 ms at c=10 and 6.5 s at c=200, with a ~28–36 rps ceiling.
- **Root cause:** the `EXISTS (… a.patient_id = p.id AND a.doctor_id = $)` filter (`patients.controller.ts:53`, and the same filter in `lab.controller.ts:51`) runs as a parallel seq scan of appointments.
- **Fix:**
  ```sql
  CREATE INDEX appointments_doctor_patient ON appointments (doctor_id, patient_id);
  CREATE INDEX encounters_patient ON encounters (patient_id);  -- history notes: 160 ms → 12 ms
  ```
- **Measured after:** 360–372 rps, p50 24 ms.

**F15. All-time default lists (Medium)**
- **Evidence:**
  - Cash desk "all": 1.5 s single user, 44 s p50 at c=200. Still 0.8–2.8 s after the indexes, because it does count + sum over 828k rows and an `ORDER BY CASE`.
  - Lab orders default "all" (`web lab/page.tsx:29`): 0.15–2 s, 21 s at c=200.
  - Audit page 1: `count(*)` over 2.6M rows, 0.1–0.4 s.
- **Root cause:** `invoices.controller.ts:44-50`, `lab.controller.ts:55-61`, `reports.controller.ts` (`audit`).
- **Fix:**
  - Default period of 7 days.
  - Keyset pagination.
  - Capped counts (`count(*) FROM (… LIMIT 1001)`).
  - Run "open first" as two indexed queries instead of `ORDER BY CASE`.

**F16. Login throttle (Medium)**
- **Evidence:**
  - With rotating `X-Forwarded-For`, 1299 failed logins in 15 s and not one 429. Each one costs a 32 MB scrypt run, so valid logins slowed to p50 0.55 s.
  - After the single-IP test, a legitimate login from the same IP got `429` for 15 minutes. Clinic staff behind one NAT address share that lock.
- **Root cause:**
  - `app.ts:23` sets `trust proxy = true`, so any client can set its IP.
  - `auth.controller.ts:22-29` keys failures by IP only, in a `Map` that is never pruned (unbounded memory).
- **Fix:**
  - Set `trust proxy` to the exact hop count: 1 for the Next.js proxy, 2 behind Railway.
  - Throttle on (IP, login) and add a global token bucket for scrypt calls.
  - Prune the map.
  - Rate-limit at the edge as well.

**F17. Large uncompressed payloads (Low)**
- **Evidence:**
  - `/queue` is 215 KB, growing to 349 KB after check-ins, polled every 12 s per registrar. At c=50 that kept the API CPU above 115 %.
  - Attendance for 92 days is 2.6 MB.
  - The API sends no `content-encoding`. I did not check whether the Next.js proxy compresses.
- **Fix:**
  - Add `compression()` in Nest (or confirm the proxy compresses).
  - Return only the selected branch from the queue.
  - Make attendance return a summary plus one day at a time.

**F18. Camera ingest per event (Low)**
- **Evidence:** about 900 events/s ceiling, and at 1500/s requests just queue (p50 7 s) with no shedding. That is ample for the target, which is below 10 events/s.
- **Root cause:** `hik.controller.ts:49` and `ingest.ts:98` write `cameras.last_seen_at` and `last_event_at` on every event, and each event is its own transaction.
- **Fix:**
  - Skip the `last_seen_at` write if it was updated in the last 30 s.
  - Store a multi-event push in one transaction.
  - Use a separate small pool (see F4).

**F19. Sessions never purged (Low)**
- **Evidence and root cause:** no code deletes rows where `expires_at < now()`.
- **Fix:** an hourly `DELETE … WHERE expires_at < now() - interval '1 day'`.

The full index experiment is in `audit/load/indexes.sql`. For a real migration, use `CREATE INDEX CONCURRENTLY`, one statement per migration file.

## 6. Capacity and server size

**Load model.** The web app's polling for 80 staff generates about 9–10 req/s of steady load. Measured: 51 users → 5.9 req/s, 153 users → 17.5 req/s. On top of that come interactive bursts such as morning check-ins and bookings, and camera traffic below 1 event/s.

**As-is: not viable at the target, and a bigger server won't fix it.**
- The registrar schedule (polled every 30 s) costs 23 s of DB time per request. The doctor day list (every 15 s) costs about 1 s.
- Together they need more than 10 busy connections at all times, so the pool queue grows without bound (§4).
- These are per-row correlated full scans whose cost grows with history. More CPU makes them slightly faster but still too slow.

**After F1, F2, F4, F5, F6 and F7–F11.** Measured headroom on one Node process with a 10-connection pool:

| Workload | Ceiling |
|---|---|
| Trivial authed requests | ~4k req/s (Node CPU-bound) |
| Patient card | ~3k req/s |
| Bookings | 750–1000 /s |
| Payments | 360–460 /s |
| Check-ins | ~100 /s |
| Camera events | ~900 /s |
| Logins | 84 /s |

At 3× the target the mix had p95 83 ms. That leaves more than 10× headroom on everything except the dashboard, reports and exports, which F11/F15 and caching address.

**Recommended production size** (one clinic, 2–5 branches, ≤80 staff, ≤3k visits per day, 3–5 years of history ≈ 5–8 GB):

| Component | Spec |
|---|---|
| App | 2 vCPU / 2–4 GB RAM (API and Next.js). Set Node `--max-old-space-size=1024` once CSV streaming is in. Pool max 20 plus timeouts. One instance is enough; two give availability, and need `max_connections` ≥ 2 × pool + workers. |
| PostgreSQL | 2–4 vCPU / 8 GB RAM, SSD 50–100 GB. `shared_buffers` 2 GB, `effective_cache_size` 6 GB, `work_mem` 16 MB, `random_page_cost` 1.1, `/dev/shm` ≥ 1 GB (Docker `shm_size`), `statement_timeout` as in F4, `pg_stat_statements` enabled. |
| Growth | Plan camera_events at about 1M rows per year per counting camera at a 2-min resolution. Add monthly partitioning or a retention/rollup policy (hourly aggregates after 90 days) from about 5 cameras or 3 years. |

## 7. Not tested

- The Next.js proxy in the request path (I tested the API directly), TLS, Railway hardware, and the US-region latency from Tashkent.
- Real Telegram bot traffic: polling, outbox delivery to the real Bot API, or inbound update bursts. Only the `planReminders` SQL was measured.
- AI endpoints (sample mode only) and the news fetcher.
- Encounter draft/sign, lab collect/verify, refunds, and shift close under contention.
- Many tenants. All data sat in one large tenant plus one tiny one.
- Long soak (hours or days), autovacuum and bloat, index growth, and backup/restore time for a 4–8 GB database.
- A real DB restart or failover (simulated only with `pg_terminate_backend`).
- Multiple API replicas and `max_connections` exhaustion.
- Parallel query with a larger `/dev/shm` (only 64 MB with parallel on, and parallel off, were measured).
- Browser rendering cost of the 500-row schedule and the 2.6 MB attendance payload.

The slowloris test was partial: 1431 sockets with headers sent slowly did not affect `/me` (p95 13 ms), but I didn't confirm they were reaped within 72 s.

## Files

- **Scripts** (`/Users/levi/Desktop/Meduza/audit/load/`):
  - `gen.sql`: data generator
  - `explain.sql`: query plans
  - `indexes.sql`: index experiment
  - `lib.mjs`: load tool
  - `setup.mjs`: synthetic staff passwords and cash shifts
  - `reads.mjs`, `writes.mjs`, `hik.mjs`, `failures.mjs`, `mixed.mjs`: test scenarios
  - `psql.sh`, `start-api.sh`: helpers, pinned to `meduza_load_test` and :4321
- **Raw results** (`/private/tmp/claude-501/-Users-levi-Desktop-Meduza/681f0b69-e040-4e3e-acee-1d9c17057603/scratchpad/load/`):
  - `results-*.jsonl`
  - `explain.txt`, `explain-after.txt`
  - `api*.log`, including the crash stack in `api3.log`
- **Cleanup:** the audit API is stopped, `meduza_load_test` is dropped, and the demo DB and ports 3000/4000/3100/4100 were never touched.
