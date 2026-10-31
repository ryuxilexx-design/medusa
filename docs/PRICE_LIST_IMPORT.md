# Price-list import (Sozlamalar → Xizmatlar → «Narxlar ro‘yxatini yuklash»)

A clinic moving from MedPlus (or any other program) brings its price list as a spreadsheet instead of typing
hundreds of services one by one. Code: `apps/api/src/modules/price-import.ts` (parsing + plan + apply),
`price-import.controller.ts` (routes), `apps/web/src/components/price-import.tsx` (dialog). Tests:
`apps/api/test/services-import.test.mjs`, browser check `e2e/price-import.mjs`.

## Routes (manager only — every other role 403; everything is scoped to the session's clinic)

| Route | Body (multipart) | Does |
|---|---|---|
| `POST /services/import/preview` | `file`, optional `mapping` (JSON `{field: column index}`) | reads the file, guesses the columns, plans every row; **stores nothing** |
| `POST /services/import` | `file`, `mapping` (required — the columns the person confirmed) | the same plan again inside one `db.tx`, applied; one `audit()` row with counts only |

Response: `counts {total, created, price_changed, updated, unchanged, error}`, `rows` (first 50 row outcomes),
`errors` (up to 200 error rows: sheet row number + reason code), plus `headers`, `guess`, `mapping`, `header_row`,
`fields` on the preview. Error rows are skipped by the import; the rest is applied.

## File

- XLSX, an HTML table saved as `.xls` (MedPlus «Экспорт в Excel»), CSV in UTF-8 or Windows-1251 (`;` `,` or tab) —
  the shared reader `core/xlsx.ts#readTable`; an old binary `.xls` → 422 `XLS_OLD` («save as XLSX»).
- ≤ 10 MB (413 `FILE_TOO_LARGE`), ≤ 5 000 data rows (413 `TOO_MANY_ROWS`); empty rows are ignored.
- Header row: the first of the top 15 rows where two known headers are found (a title row above is fine).

## Columns (guessed, the person can change every one)

| Field | Headers recognised (after lower-casing, punctuation dropped) |
|---|---|
| name * | Наименование, Наименование услуги, Название, Услуга, Xizmat, Nomi … |
| price * | Цена, Цена, сум, Стоимость, Сумма, Narx … — so‘m: `150 000`, `150 000,00`, `150000.5`, `150,000.00`, `1.250.000`, a number cell → integer tiyin; `150.000` is ambiguous and refused |
| category | Категория, Отделение, Группа, Раздел, Bo‘lim, Turi — mapped to consultation / lab / ultrasound / procedure by keywords; a text that names none of them (e.g. «Гинекология») counts as not given |
| code | Код, Код услуги, Артикул, Kod |
| ikpu | ИКПУ, MXIK — 17 digits in a **text** cell (a number cell loses digits) |
| vat | НДС, QQS — `12`, `12%`, a percent cell (0.12), «Без НДС» / «QQSsiz» = exempt |
| duration | Длительность, Davomiylik — 5–240 minutes |

## Rules

- **Match**: by the file's `code` when it names one of the clinic's services, otherwise by name (case-insensitive).
  A match by code never renames the service.
- **Existing**: the general price gets a new `service_prices` row (valid from now) only when it differs; category,
  IKPU, VAT and duration change only when the file gives them. Orders keep `price_snapshot`, so past visits and
  invoices never change. A service with a lab result template stays `lab` (row error otherwise). Branch prices and an
  inactive service's status are left as they are.
- **New**: an active service, the file's code when free (else our `C01`/`L07`… numbering), category from the file or
  guessed from the name (`sync/normalize.ts#guessCategory`), default duration 30/15/20/30 min, doctor share 0.
- **MedPlus placeholders** (inactive «MedPlus: …» services made by the mirror for unmapped MedPlus services) are never
  matched: the real service is created/updated normally; a row whose name equals a placeholder's is an error.
- **Row errors**: missing/long name, missing / non-numeric / negative price, bad code, IKPU, VAT or duration, the
  same service twice in the file, a code already used by another service.
- Re-importing the same file changes nothing (`unchanged`).
