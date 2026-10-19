---
name: meduza-run
description: Start, restart, stop or check the Med.uz.ai (Meduza) clinic app on this machine — PostgreSQL in docker, NestJS API on :4000, Next.js web on :3000. Use this whenever the user asks to run/launch/open/"run qilib ber" the app, when the app or a port isn't responding, after changing code that must be seen in the running app, or before any browser check of the local demo.
---

# Run Med.uz.ai locally

The live demo that clinics see runs from this folder. Starting it never changes data; only a reset does (see `meduza-demo-reset`).

## Steps

1. **Database first.** `docker ps --filter name=meduza-db` — if it is not `Up`, run `npm run db:up` (waits until PostgreSQL is ready). Data lives in the `meduza_pg` volume, so restarting the container is safe.
2. **Is the app already up?**
   ```bash
   curl -s -o /dev/null -w "web %{http_code}\n" http://127.0.0.1:3000/login
   curl -s -o /dev/null -w "api %{http_code}\n" http://127.0.0.1:4000/api/v1/demo/accounts
   ```
   Both 200 → nothing to do unless code changed.
3. **(Re)start.** Stop old processes first, otherwise the ports stay taken:
   ```bash
   pkill -f "concurrently"; pkill -f "next start"; pkill -f "node dist/main.js"
   npm run build        # only if code changed since the last build
   nohup npm run start > /tmp/meduza-demo.log 2>&1 &
   ```
   Wait until both URLs from step 2 return 200 (poll every ~2 s, up to ~80 s). `npm run start` serves the production build; use `npm run dev` only for hot-reload development (it shows the Next.js dev badge — not for demos).
4. **Report** from the `Med.uz.ai API:` line in `/tmp/meduza-demo.log`: database name, mode and the current **demo time**. Give the user http://127.0.0.1:3000.

## Things that look like bugs but are not

- **Demo time** (top bar "Demo vaqti") comes from the `demo_clock` row in the database: it starts at `DEMO_DATE` + `DEMO_TIME` (2026-10-18 11:30) at the last reset and keeps running in real time. A restart never rewinds it. If "today" looks empty or afternoon slots are all in the past, the clock has run on — that needs a reset, not a restart.
- Locally no access code is asked for. On Railway the login page asks for `DEMO_ACCESS_CODE`.
- Node must be ≥ 20.19 (installed: Node 22 at `~/.local/node-v22.23.3-darwin-arm64`, linked from `~/.local/bin`).
