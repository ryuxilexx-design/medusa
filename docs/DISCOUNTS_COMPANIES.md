# Chegirmalar, imtiyoz toifalari va kompaniyalar (migration 043)

The pilot clinic works in MedPlus with «Скидка», «Категория льгот», «Компания», «Страхование», «Настройки скидки» and
«Отчет по услугам (с учётом скидок)». This document describes the Med.uz.ai equivalent and how it fits the money model.

## Data

| Table / column | What |
|---|---|
| `discount_rules` | Per clinic: name, `kind` `percent` (0.01–100) or `fixed` (tiyin off **each line** in scope, never more than the line), `staff_max_percent` / `staff_max_amount` (the most a registrar or cashier may give), `scope` `all` / `categories` / `services`, optional `valid_from` / `valid_to`, `active`. |
| `benefit_categories` | Nogironlar, pensionerlar, ko‘p bolali … : default rule, `requires_document` + `document_label` («Pensiya guvohnomasi №»). Text only — never a passport or PINFL. |
| `companies` | Employer / insurer / other: STIR (9 digits, unique per clinic), contract, contact, default rule (staff discount), `coverage_percent` + `coverage_categories` ('{}' = all), `payment_terms_days`, `credit_limit` (tiyin, 0 = none). |
| `patients.benefit_category_id`, `benefit_note`, `company_id`, `company_member_no` | Set by registrar / manager (audited, field names only). Anonymisation clears the note and the number. Doctors never get them. |
| `invoices.discount_*` | The applied rule snapshotted on the bill: rule id + name, kind, value, scope (+ chosen lines), source (`rule` / `benefit` / `company` / `manual`), benefit category at that moment, who granted it, `discount_over_limit`, the manager's reason (`discount_reason`, on the bill only). |
| `invoices.company_id`, `company_percent`, `company_member_no`, `company_share_amount`, `company_paid_amount` | The company split. |
| `company_payments` | A company's bank transfer: number, amount, payment order number/date; append-only, void once with a reason (trigger). |
| `company_payment_allocations` | Append-only: one row per bill, each linked to the ordinary `payments` row it created (`payments.company_payment_id`). |

## Money model

- **Line discount.** `invoice_items.discount_share` is the line's discount snapshot; `line_total = line_subtotal − discount_share`
  (CHECK `discount_share ≤ line_subtotal`). A rule is computed per line (`lineDiscount()` in `billing.ts`); the manager's older
  invoice-level discount (`POST /invoices/:id/discount`) is still spread proportionally. One discount per bill: applying one
  replaces the other.
- **`NET_LINE` = gross − discount − refunds** (line_total minus the line refund, or the proportional share of an invoice-level
  refund). It stays the single definition: service revenue, the services report, doctor share and `PARTNER_LINE` are all
  on the **discounted net** — a doctor or a partner earns on what the patient was actually charged.
- **Frozen after money.** A discount or a split changes only while the bill has no payment, refund or company payment
  (409 `DISCOUNT_LOCKED` / `COMPANY_SPLIT_LOCKED`); after that a refund is the way back. A DB trigger refuses any change of
  a line's amounts once a payment exists. Editing a rule never touches past bills (they keep name, value and scope).
- **Discounts are not an expense and not revenue.** Revenue stays cash basis (payments − refunds). Finance shows
  `discounts.total` (bills of the period) next to it; `net_result` is unchanged.
- **Company split.** `company_share_amount = round(Σ lines in the company's coverage × percent)` (recomputed while the bill is
  a draft, e.g. when a service is added). Invariants (CHECK): share ≤ total, company_paid ≤ share, company_paid ≤ paid.
  - **Patient debt** = `total − company_share − (paid − company_paid)` (`PATIENT_DUE`); the patient's payment is capped by it.
  - **Company receivable** = `company_share − company_paid` (`COMPANY_DUE`).
  - `invoiceStatus` is unchanged (paid vs total): a bill whose patient part is paid but the company's is not stays
    `partially_paid` and is **not** a patient debtor.
  - «Joriy qarz» (dashboard, debtors list and CSV, AI digest, patient card, erasure check) keeps its meaning: **patient debt
    only**. Company receivables are shown separately (dashboard attention tile, «Moliya» card + debtors switch, «Kompaniyalar»).
- **Company payments** (cashier or manager, `Idempotency-Key`): the amount must equal the sum of its allocations; each bill must
  belong to the company and owe at least that much. Every allocation is one ordinary `payments` row (method `transfer`, no
  shift / drawer), so revenue counts it **when received**, exactly once, and every report that sums payments includes it.
- **Fiscal.** Every allocation's payment row gets `recordFiscal()` like any payment (method `transfer`): `manual` → a pending
  receipt row, `none` → skipped. Whether a B2B bank transfer needs a KKM receipt is the clinic accountant's call; the
  provider setting is the switch.
- **Void** (manager, once, with a reason): each allocation's payment row is reversed by a `refunds` row with reason
  `company_payment_void` (method transfer, no drawer). The bill's `paid_amount` and `company_paid_amount` go down, `total` and
  `credit_amount` do not — the company owes that part again. Revenue goes down on the void day (cash basis). A company payment
  row cannot be refunded to the patient (409 `COMPANY_PAYMENT`).
- **Credit limit.** Setting a split that takes the company's outstanding (all branches) above its limit: cashier 403
  `COMPANY_CREDIT_LIMIT`, the manager may (the response says `over_limit`). A percent above the contract's coverage: manager only.

## Limits and roles

| | Manager | Cashier | Registrar | Doctor, lab, storekeeper, guard |
|---|---|---|---|---|
| Rules, categories, companies (edit) | ✓ | — | — | 403 |
| Pick a rule on a bill | ✓ (above the staff max with a reason) | within `staff_max` | within `staff_max` | 403 |
| Benefit category / company on the card | ✓ | — | ✓ | 403 (fields removed) |
| Company split | ✓ | ✓ (within limit and coverage) | — | 403 |
| Company payments | ✓ (+ void) | ✓ | — | 403 |
| Reports, statement, act, CSV | ✓ | — | — | 403 |

Audit keeps the rule, value and amount — never the manager's reason or the void reason (they stay on the record).

## Reports

- `GET /reports/discounts?group=rule|category|staff|service` (+ `export.csv`, ≤ 1 year, totals row): discounted lines of
  non-void bills created in the period — invoices, services, gross, discount, net. Every grouping sums the same lines.
- `GET /reports/services`: gross / discount / refunded / value per service (the reports page shows gross, discount, value).
- `GET /reports/companies` (+ CSV): per company covered (bills of the period), paid (transfers of the period), outstanding now,
  ageing 0–30 / 31–60 / 61+ days, overdue (older than the payment terms), credit-limit flag.
- `GET /companies/:id/statement` (+ `statement.csv`) and the A4 act `/print/company-act/:id?from&to`: opening balance + bills
  (debit, company part) − transfers (credit) = closing. A voided transfer is left out of the act. Bills are listed by number,
  date and policy / employee number, not by patient name.
- `GET /invoices?debt=1&payer=company` — the companies' receivables with the same ageing meta as the patient debtors.

## UI

«Chegirmalar» (manager: report, rules, benefit categories), «Kompaniyalar» (manager: receivables, directory, payments; cashier:
directory with the receivable, payments). The cashier's bill has the «Chegirma va to‘lovchi» block (rule pre-selected from the
patient's benefit category, else the company; limit hint; manager approval with a reason; company split with percent and
policy number) and the totals gross / discount / company / patient. The patient form has «Imtiyoz va kompaniya».

## Demo data

`database/seed/discounts.ts`, a post-pass with its own PRNG: 5 rules, 4 categories, 3 companies (an insurer, two employers),
24 extra past bills (invoice numbers 8001–8024) of procedures on completed visits — 12 with a benefit discount paid by the
patient, 12 with a company split (patient part paid; transfers on past days; one transfer voided). Today's KPIs and the patient
debt are unchanged (28 visits, 2 510 000 so‘m / 12 payments, debt 6 315 000 so‘m / 46 bills). Older demo databases get it once
on API start (`backfillSeedDiscounts`). Tests: `apps/api/test/discounts.test.mjs`, `companies.test.mjs`; E2E `e2e/discounts.mjs`,
visual pass `e2e/shots-discounts.mjs`.
