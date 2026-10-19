---
name: meduza-verify
description: Verify Med.uz.ai changes end-to-end — typecheck, API integration tests, browser E2E (happy path + error states), read-only visual pass at 1366×768 — without touching the live demo database. Use this before saying any Med.uz.ai change is done, before commits/deploys, when the user asks to test/check/tekshir something, or when a bug fix needs proof.
---

# Verify Med.uz.ai

Proof means commands that ran and passed, not "it should work". Report exactly what ran, what passed, and what was not checked.

## Pick the checks that match the change

| Changed | Run |
|---|---|
| Any TypeScript | `npm run typecheck` |
| API, database, money/time logic, permissions | `npm test` (52 tests: P0, P1, demo clock, safety, staff auth, doctor schedule, Telegram bot, AI/ICD-10/news) |
| UI flows, forms, error handling | `npm run e2e` (isolated stack: web :3100, API :4100, DB `meduza_test`) — 19 happy-path + 16 error-state + 11 staff-login + 8 doctor-schedule + 9 Telegram-simulator + 7 AI/ICD-10 checks |
| Layout / visuals | `node e2e/run.mjs visual` (test stack) → screenshots in `e2e/shots/visual/`; open the PNGs and actually look |
| Print documents | `node e2e/print.mjs` against a running app → A4 PDFs in `e2e/shots/` (a PDF check is not a printer check — say so) |

## Database safety (why tests can't hurt the demo)

- Tests and E2E run only on `meduza_test`; helpers refuse any database whose name doesn't end in `_test`, and the API refuses `/demo/reset` on a non-test DB when `MEDUZA_TEST=1`.
- The read-only visual pass against the live demo (`E2E_BASE_URL=http://127.0.0.1:3000 node e2e/visual.mjs`) is the only E2E script meant for the demo stack; it opens screens and dialogs but saves nothing. Take a data fingerprint before/after if in doubt.
- The `postgres` MCP server connects as `meduza_readonly` (SELECT-only, sessions table hidden) — use it to inspect data, never to "fix" data.

## When something fails

Read the failing assertion and the screenshot in `e2e/shots/`, reproduce with the smallest command, fix the cause, and rerun the whole relevant suite — not only the failing line. Never weaken a test to make it pass; if a test itself is wrong (e.g. counts shifted after an intentional seed change), fix it and explain why in the report.
