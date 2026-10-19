# Med.uz.ai — clinic management platform (demo MVP)

Product name in every UI text, document and export: **Med.uz.ai** (old name "Meduza" survives only in internal identifiers: `@meduza/*` packages, `meduza_session` cookie, `meduza.branch` storage key, DB/container names — do not rename those). UI language: Uzbek Latin; use the typographic apostrophe `‘` (o‘, g‘) and `’` (ma’lumot), never ASCII `'`. Spec: `docs/MVP_TZ.md`; status and limits: `docs/DEMO_STATUS.md`; meeting runbook: `docs/DEMO_SCRIPT.md`.

## Layout

- `apps/api` — NestJS 11, prefix `/api/v1`, raw SQL via `pg` (no ORM). Controllers in `src/modules/*`, cross-cutting code in `src/core/*`.
- `apps/web` — Next.js 15 App Router, all pages are client components using TanStack Query; `/api/v1/*` is proxied to the API (`next.config.mjs` rewrites), so the browser never talks to :4000.
- `packages/contracts` — zod schemas, labels, money/phone helpers shared by API and web.
- `database/` — SQL migrations (`migrations/NNN_*.sql`, applied on API start), deterministic seed (`seed/build.ts`), reset/clock helpers (`src/index.ts`).
- `e2e/` — puppeteer-core scripts with the system Chrome; `run.mjs` starts an isolated stack.

## Commands

`npm run db:up` · `npm run start` (prod build, web :3000 / API :4000) · `npm run dev` · `npm run build` · `npm run typecheck` · `npm test` (31 API tests) · `npm run e2e` · `npm run db:reset` (wipes live demo data — needs explicit user intent) · `npm run db:backup` / `db:restore -- <file>` · `npm run db:readonly-role` · `npm run db:create-clinic -- …` (onboard a real clinic; prints a one-time temp password).
Project skills: `meduza-run`, `meduza-demo-reset`, `meduza-deploy`, `meduza-verify` — use them for those tasks.

## Rules that are easy to break

- **Tenant & role come only from the server session** (`req.ctx`). Every query filters by `tenant_id`; another tenant's id must return 404, a forbidden action 403. Hiding a button is never the permission check — add the server check and a test.
- **Money is integer tiyin** (`bigint`, 1 so‘m = 100). Never sum money in floating point on the client; format with `formatSom`.
- **Time:** store UTC; display Asia/Tashkent (UTC+5, no DST). "Now" is the demo clock: SQL `demo_now()`, API `now()` from `core/clock.ts`, web `useSession().demoNow()`. Never use `now()`/`Date.now()` for business timestamps. Date filters are `[local day start, next local day start)`.
- **Writes that matter run in `db.tx`** with row locks (`FOR UPDATE`) where races are possible. Appointment overlap is enforced by a DB exclusion constraint (→ 409 `SLOT_TAKEN`); payments require `Idempotency-Key`; signed notes, verified lab results and payments are immutable via DB triggers.
- **Status changes** are validated on the server; stale client state → 409 with a "refresh" message. Audit important actions with `audit()` (no clinical text, no AI prompts in audit).
- **Clinical data is doctor-only** (managers, cashiers and registrars never read clinical notes or result values). Lab values are visible to doctors only after verification.
- **No clinical or financial data in localStorage** — only UI preferences (selected branch).
- **Errors:** API returns `{error:{code,message,fields?},request_id}`; UI keeps the user's input on failure, shows the error, and never shows a success toast for an action that did not complete.
- **Auth:** staff sign in with `/auth/login` (phone or username + scrypt-hashed password; lockout after 5 failures; temp passwords force a change — the guard returns 403 `PASSWORD_CHANGE_REQUIRED` except on routes marked `@AllowDuringPasswordChange()`). Demo role cards (`/demo/login`) only open the seed tenants. Never log, return twice, or store a password in clear text; a temp password is shown exactly once.
- **Demo reset truncates every table** and refuses to run when a non-seed tenant exists. Real clinics belong in a separate `APP_MODE=production` deployment.
- **AI:** `AI_MODE=sample` returns a pre-written result only for the exact demo text and must be labelled «Namunaviy AI natijasi»; never present it as live AI. API keys stay server-side.

## Data & environments

- Local Postgres: docker `meduza-db` on 127.0.0.1:5433 — `meduza` = live demo shown to clinics, `meduza_test` = tests/E2E only. Tests refuse non-`_test` databases; keep it that way.
- Seed is deterministic (fixed PRNG + hashed ids). Changing RNG call order shifts seeded numbers — then update the expected KPIs in `docs/DEMO_SCRIPT.md`, `meduza-demo-reset` and tests.
- Railway (`feisty-amazement`, service `meduza` + `Postgres`, region US): password-gated demo, synthetic data only. Real patient data or biometrics must not go there — Uzbek law requires biometric data to be stored in Uzbekistan.
- Never commit or print `.env`, `backups/*.dump`, `DEMO_ACCESS_CODE`, tokens or keys.

## Before saying "done"

Run `npm run typecheck` and the checks from `meduza-verify` that fit the change, look at screenshots for UI work, and report what was verified and what was not.
