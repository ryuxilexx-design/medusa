# Yo‘llovchi hamkorlar va reklama manbalari (migration 041)

The first pilot clinic works like MedPlus: outside doctors, med reps and other clinics send patients and earn a
percent of the services («Направительные врачи», «Отчет по врачам BONUS»), and every registration records the
advertising channel («Рекламный канал», «Отчет по источникам»). This document describes how Med.uz.ai does both.

## Data

| Table / column | What |
|---|---|
| `referral_partners` | Tenant-wide directory: name, phone (normalised like patients), kind (`doctor` / `med_rep` / `clinic` / `other`), workplace, specialty, region, note, `default_percent` (0–100, 0 = none), `active`. `code` = short numeric ID people type (per tenant, `tenants.partner_seq`, starts at 101). |
| `services.partner_percent` | Percent of this service for every partner (NULL = each partner's own default). |
| `referral_partner_services` | One partner's percent on one service (wins over both). |
| `appointments.referral_partner_id`, `appointments.lead_source_id` | The visit's partner («Yo‘llanma bor») and its lead source. |
| `service_orders.referral_partner_id`, `partner_percent_snapshot` | Snapshotted at order creation (`createBilledOrder`), like `share_percent_snapshot`. |
| `patients.lead_source_id` | The card's first known source. |
| `lead_sources` | Per-clinic directory (name, active, sort). Built-in rows: `system_key = 'telegram_bot'` and `'referral'` (cannot be switched off). |
| `partner_payouts` | Append-only payouts; correction = void once with a reason (trigger). |

## Percent resolution — `partnerPercentFor()` (billing.ts)

1. the partner's own percent for the service (`referral_partner_services`), else
2. `services.partner_percent`, else
3. `referral_partners.default_percent`.

It is evaluated once, when the order is created (check-in for the booked service, the doctor's orders later on the
same visit). Later edits of any percent never change past lines. A partner quick-added by the registrar is
`approved = false`: `partnerPercentFor()` returns 0 for it on every service (also where the service has its own
partner percent), so nobody at the desk can create a paid partner. The manager approves it in the partner dialog
(«Tasdiqlash: ulush hisoblansin»); lines created before that keep 0 %.

The visit's partner can be corrected (`PATCH /appointments/:id/referral`) only while no money was taken for the
visit (no payment, no refund): its orders are then re-snapshotted with the new partner. After a payment → 409
`REFERRAL_LOCKED`; the manager settles it with the partner.

## Partner amount

`PARTNER_LINE = round(NET_LINE × partner_percent_snapshot / 100)` — the line's value after discounts and refunds
(a line refund or a proportional one). It counts performed services (`completed` / `verified`) on non-void bills,
attributed by `performed_at` — the same rule as the doctor share. A later discount module only needs to change
`NET_LINE`.

## Payouts and the accounting choice

- `POST /referral-payouts` (manager, `Idempotency-Key`): `cash` from an open drawer (shift locked `FOR UPDATE`,
  `INSUFFICIENT_CASH` like every outflow, counted in the shift's `cash_out` / `totals.partner_payouts`, its own
  column in the shifts CSV and the printed Z-report) or `transfer` booked to a branch. Never more than the partner's
  balance (409 `PAYOUT_OVER_BALANCE`; the partner row is locked so two payouts serialise).
- Void once with a reason; a cash payout of a closed shift cannot be voided (the Z-report is final).
- **A payout is not a reduction of revenue.** «Tushum» stays cash basis: payments − refunds (dashboard, finance,
  AI digest, lead-source report). The commission is a cost of acquiring patients, shown in finance as an outflow
  next to expenses (`finance/summary.partner_payouts`, and `net_result = revenue − expenses − partner payouts`).
- Balance = all-time partner amount − all-time active payouts in the manager's branches; it ignores the report's
  period and branch filter (a debt to a partner does not restart each month).

## Lead sources

- Starter list (data, not interface text; the manager renames or switches them off): Instagram, Telegram, Facebook,
  Google/sayt, Tanish tavsiyasi, Yo‘llovchi shifokor, Banner/ko‘cha reklamasi, Radio/TV, Boshqa, Telegram bot.
  `ensureLeadSources()` adds them idempotently (create-clinic, demo reset, API start).
- Defaults on a new visit (`visitReferral()` in `modules/referrals.ts`, used by `booking.ts`):
  bot booking → «Telegram bot», never a partner; a partner → «Yo‘llovchi shifokor»; otherwise the patient's own
  source. The first source a card gets is kept (`fillPatientSource`). Bot-created cards get «Telegram bot».
- Registrar / manager may change a card's source (`PATCH /patients/:id`, audited) and a visit's source.

## Reports (manager)

- `GET /reports/referrals` (+ `export.csv`, ≤ 1 year, totals row): per partner patients, visits, services, net value,
  partner amount, paid in period, balance. `GET /reports/referrals/:id/lines` — the lines (paginated); their sum
  equals the report row.
- `GET /reports/lead-sources` (+ `export.csv`): new patients (first visit ever in the period, by the card's source),
  booked → came (conversion), revenue (payments − refunds of the period through the bill's visit; the total equals
  the dashboard), average check. The dashboard card «Yangi bemorlar manbasi» uses the same SQL.

## Privacy

Directory, percents, amounts, payouts and reports: manager. Registrar: searches the directory (no percents), quick-adds
a partner without a percent, sets partner/source on a visit. Cashier: only the partner's name on a bill and a shift's
cash payout lines. Doctor, lab, storekeeper, guard: nothing (403; partner and source fields are removed from
appointments and the patient card for doctors). Tests: `apps/api/test/referrals.test.mjs`, E2E `e2e/referrals.mjs`.

## Demo data

`database/seed/referrals.ts` — a post-pass with its own PRNG: 8 partners (codes 101–108, one inactive), ~25 % of past
visits referred, lab services 10 % for every partner, one partner-service override, bank-transfer payouts on past days
(one voided), a source on ~92 % of cards. Seeded KPIs and today's cash drawers are unchanged. Older demo databases get
it once on API start (`backfillSeedReferrals`).
