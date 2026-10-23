# Med.uz.ai — AI: what each feature sends to the model

All model calls go through `AiClient.json()` (`apps/api/src/ai/ai-client.ts`): one provider (`AI_PROVIDER=anthropic` or
`gemini`), structured JSON validated with zod, one `ai_usage` row per call (route, model, tokens, cost, latency,
outcome — **never the prompt or the answer**), a per-clinic daily budget (`AI_DAILY_LIMIT_USD`, default 5 USD).
`AI_MODE=off | sample | live`; `sample` never calls a model and is labelled «Namunaviy». Speech-to-text is separate
(`SttClient`, `docs/VOICE_SCRIBE.md`).

| Feature (route) | Who | What leaves the server | Guards |
|---|---|---|---|
| Note draft (`note_draft`) | doctor of the visit | the doctor's own free text, de-identified by `redact()` (patient names, birth date, patient number, phones → placeholders) | clinical: production needs `AI_CLINICAL_ALLOWED=1`; Gemini free tier only for the seed demo clinics on a non-production server; output is a draft, nothing saved |
| ICD-10 suggestion (`icd10_suggest`) | doctor | the diagnosis text (de-identified) + the ICD-10 code list (cached system prompt) | clinical (as above); returned codes must exist in `icd10_codes` |
| Specialty news (`news_summary`) | doctors (job) | public PubMed titles and abstracts | public route; no clinic data; abstracts are not stored |
| Dictation (STT, not `AiClient`) | doctor | audio to the STT server (`local` on the clinic's machine, or `openai`) | `openai` gated like clinical AI; audio never stored |
| **Daily digest** (`manager_digest`) | manager | a **fact sheet**: numbers computed by SQL for one Tashkent day and branch scope (net revenue cash basis net of refunds, payments by method, refunds, visits done / no-show / cancelled, new patients, top 5 services by net revenue, visits per doctor, open debts, low-stock / expiring / expired batches, pending warehouse requests, approvals and write-offs, open camera security alerts, unverified lab results, cancelled visits with an open invoice, failed Telegram/SMS notices, missing fiscal receipts), the same weekday a week earlier, and precomputed differences — plus names of **doctors, services**. **No patient name, phone, ID or clinical text.** | non-clinical (`PUBLIC_ROUTES`): works in production without `AI_CLINICAL_ALLOWED`; never to the Gemini free tier for a real clinic (`businessBlock`); budget; regenerate ≤ 5 per clinic per day |
| **Ask the numbers** (`manager_ask`) | manager | call 1 (plan): the manager's question (through `redact()`), today's date, the manager's branch names/ids and the list of report templates. Call 2 (answer): the question and the **rows of the chosen template** as facts (numbers + names of doctors, services, items, expense categories, branches, ICD-10 *group codes*). | same as the digest; the model never writes SQL |

## The manager's AI in detail (`ai/manager-facts.ts`, `ai/manager-ask.ts`, `modules/ai-manager.controller.ts`)

- **Numbers come from SQL only.** The digest reuses the dashboard formulas (`REVENUE_SQL`, `DEBT_SQL`, `NET_LINE`,
  `STOCK_SQL`, `cameraAttention`). Money goes to the model in whole so‘m; differences and percentages are computed on
  the server — the prompt forbids arithmetic.
- **Every number is checked.** The model returns `bullets[{text, fact_keys[]}]` and `alerts[{text, fact_keys[],
  severity}]`. The server drops an item when a cited key does not exist or when any number in its text (`1 250 000`,
  `1,3 mln`, `12%`; digits inside a cited doctor/service name are ignored) differs from the cited facts. If no bullet
  survives, the deterministic template digest is shown. The answer of «ask» is checked the same way.
- **Cache:** `ai_digests` (migration 034) keeps one digest per clinic, branch scope, day and language; opening the
  dashboard reads it. «Qayta yaratish» replaces it; `ai_digest_runs` limits that to 5 per clinic per Tashkent day
  (attempts count). AI off or sample → a template digest from the same facts, labelled «AI o‘chiq» / «Namunaviy».
  A failing model on first open → the template digest with the reason (not cached).
- **Ask:** the model picks ONE template — `revenue` (day ≤ 31 days / month / branch / method / doctor / service),
  `visits` (doctor / day), `top_services`, `debts_ageing`, `refunds` (reason / method / day), `expenses`,
  `warehouse_consumption` (item / doctor / ICD group — codes only), `stock` (low / expiring in 1–180 days),
  `staff_lateness` (camera attendance vs schedule), `patient_flow` (by hour), `new_vs_returning` — and typed
  parameters. The server refuses an unknown template, an unknown parameter, a period over one year, in the future or
  reversed, a limit outside 1–20, a branch outside the session scope; the reply is «buni hali so‘ray olmayman» with
  the list of what can be asked. The dashboard's example chips send a fixed template, so they work without AI.
- **Logs:** `ai_usage` has no text; the audit records `Shablon: <id>` or the refusal reason — never the question.

Tests: `apps/api/test/ai-manager.test.mjs` (fake Claude and Gemini servers — never a real key).
