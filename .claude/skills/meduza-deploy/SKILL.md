---
name: meduza-deploy
description: Deploy the current Med.uz.ai code to Railway (project 228e174f-…, service "meduza" + Postgres) and prove it works. Use this whenever the user asks to deploy, publish, update the live/online demo, "Railwayga chiqar", or after changes that should appear on https://meduza-production-9bfb.up.railway.app.
---

# Deploy Med.uz.ai to Railway

The Railway environment is called `production`, but it is a password-gated demo with synthetic data. One service `meduza` runs web (public, $PORT=8080) and API (internal 127.0.0.1:4000) via `npm run start`; build/start/healthcheck come from `.railway/railway.ts` (Railway Infrastructure as Code; variables are unmanaged there, so no secrets in the file). To change them: edit the file, `railway config plan`, then the user runs `railway config apply --yes` (applying is blocked for the agent). Database schema migrates itself on API start; an empty database seeds itself (`AUTO_SEED=1`); existing data is kept.

## Steps

1. **Local proof first** — never ship something that has not passed here:
   `npm run typecheck && npm test` (tests use `meduza_test`, not the demo DB). For UI changes also run `npm run e2e`.
2. **Commit and push** to GitHub (`git push origin main`; SSH key is configured for this repo). Railway does not deploy from git here — this keeps GitHub and Railway in sync.
3. **Check the link:** `railway status` must show project `feisty-amazement`, environment `production`. If not linked: `railway link --project 228e174f-3bbc-45e0-b951-6d934712b7d6`. If the CLI is logged into another account (`railway whoami` ≠ ryuxilexx@gmail.com), stop and ask the user to log in — do not deploy into another project.
4. **Deploy:** `railway up --service meduza --detach`, then poll `railway status --json` (`latestDeployment.status` of service `meduza`) every ~15 s until `SUCCESS` / `FAILED` / `CRASHED`. Builds take ~2 min.
5. **Verify for real** (a green build is not proof):
   - `curl https://meduza-production-9bfb.up.railway.app/login` → 200; `/api/v1/demo/accounts` → JSON with `meta.access_code_required: true`.
   - `railway logs --service meduza` contains `Med.uz.ai API: … demo vaqti: …` and no stack traces.
   - Log in as Rahbar with the access code (API or browser) and confirm `/api/v1/dashboard` returns KPIs.
6. **Report:** URL, commit hash, what changed, and anything not verified.

## Do not, without the user asking explicitly

Reset Railway data (that is `meduza-demo-reset`), delete services/volumes, change `DEMO_ACCESS_CODE`, or print variable values. Project permission rules block `railway delete`/`railway down` and ask before variable or service changes.
