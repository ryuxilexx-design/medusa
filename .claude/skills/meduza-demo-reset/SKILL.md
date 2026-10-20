---
name: meduza-demo-reset
description: Safely reset the Med.uz.ai demo data and demo clock back to the seeded start (2026-10-18 11:30), locally or on the Railway deployment. Use this whenever the user asks to reset/tiklash/clear the demo, prepare for a meeting or presentation, or when the demo clock has run into the next day and "today" looks empty. Always check for real user activity before wiping anything.
---

# Reset the Med.uz.ai demo — safely

A reset deletes everything people entered since the last reset (patients, visits, payments, notes) and puts the demo clock back to `DEMO_DATE` + `DEMO_TIME`. It cannot be undone except from a backup, and clinics or teammates may have been using the demo. So the order is: **look → back up → ask if needed → reset → verify**.

## 1. Look at what would be lost

- Local: `node .claude/skills/meduza-demo-reset/scripts/check-activity.mjs local`
- Railway: `DEMO_ACCESS_CODE=<code> node .claude/skills/meduza-demo-reset/scripts/check-activity.mjs remote https://meduza-production-9bfb.up.railway.app`
  (the code is the `DEMO_ACCESS_CODE` Railway variable; reading variables prompts the user — that is intended. Never print the code in chat unless the user asks for it.)

Exit code 0 / `user_actions: 0` → only seed data and logins, safe to reset.
Exit code 2 → people did real work. Show the user the `by_action` counts and latest entries and ask before continuing — unless they already said explicitly to reset despite activity.

## 2. Back up (local)

`npm run db:backup` → `backups/meduza-<time>.dump` (restore: `npm run db:restore -- <file>`, app stopped). There is no automated backup for Railway; if its activity matters, say so before resetting.

## 3. Reset

- Local: `npm run db:reset` (works while the app runs; sessions survive).
- Railway: log in as Rahbar through the API with the access code and `POST /api/v1/demo/reset` — or ask the user to use Rahbar → Sozlamalar → Demo → «Demo ma’lumotlarini tiklash».
- Never point a test or E2E run at the demo database to "reset" it; tests use `meduza_test` and refuse other databases on purpose.

## 4. Verify and report

After a reset the Rahbar dashboard for "Bugun" must show: 28 qabul, tushum 2 510 000 so‘m (12 to‘lov), qarzdorlik 6 205 000 so‘m (45 hisob), demo time 18.10.2026 ~11:30, clinic name «Med.uz.ai Demo Clinic». Check via `GET /api/v1/dashboard` and `/me` (or the browser) and report these numbers.

## Timing advice for meetings

The clock keeps running after a reset, so reset 10–30 minutes before a meeting. Akmal Rasulov (Terapevt) then has free slots 11:45–13:00 and 13:30–17:00 for the live booking in `docs/DEMO_SCRIPT.md`.
