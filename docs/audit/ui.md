# Med.uz.ai — UI audit (all pages × all roles)

Date: 2026-10-20 · Build: web `next dev` (apps/web, current working tree) on :3331, API `apps/api/dist` on :4331, DB `meduza_ui_test` (isolated, dropped afterwards), `AI_MODE=sample`, demo clock 2026-10-18 11:30.
Method: puppeteer-core + system Chrome; axe-core 4.12.1 (WCAG 2.0/2.1 A+AA + best-practice); scripts in `/Users/levi/Desktop/Meduza/audit/ui/`. No product code was changed.
Screenshots: `/private/tmp/claude-501/-Users-levi-Desktop-Meduza/681f0b69-e040-4e3e-acee-1d9c17057603/scratchpad/audit/ui-shots/` (below: `shots/<name>`). Raw JSON results sit next to this file (`sweep-*.json`, `detail.json`, `i18n.json`, `keyboard.json`, `storage.json`, `flows-*.json`).

## Summary

| ID | Sev | Page / role | Title |
|---|---|---|---|
| UI-01 | **High** | All pages / all roles (seen on /doctor) | One failed background refetch of `/me` (network blip, 5xx) signs the user out to /login and throws away unsaved work (doctor's note) with no warning |
| UI-02 | Medium | /doctor / doctor | If loading the visit (`GET /encounters/:id`) fails, the note card shows a skeleton forever; the error state and «Retry» can never appear |
| UI-03 | Medium | Many modals / all roles | The footer «Bekor qilish» button closes a modal with typed data straight away, while Esc and X ask first; the input is lost |
| UI-04 | Medium | /print/lab/:id / manager, registrar (and doctor before verification) | The printed lab result says «Natija kiritilmagan» (no result entered) when values are only hidden for the role, and it looks like a finished, verified document |
| UI-05 | Medium | Every page a role may not use / registrar, doctor, cashier, lab, manager | No route guard: direct URLs render the page shell with its main actions (Add staff, Add camera, Reset demo, Start visit…) and partial data, plus endless skeletons or a raw i18n key |
| UI-06 | Medium | /cashier, /cashier/:id / cashier | If the request for the current shift fails, the page says «Smena yopiq» and offers «Smenani ochish» instead of showing an error |
| UI-07 | Medium | Schedule → appointment dialog / registrar, manager | «Kelmadi» (no-show) is offered for appointments later today, sits next to the primary button, takes one click and cannot be undone |
| UI-08 | Medium | /doctor / doctor | After a version conflict the save message says both «refresh the page» and «save again»; saving again always fails and refreshing loses the text, with no way to keep both |
| UI-09 | Low | Settings → Audit journal / manager, ru + uz-Cyrl | The «Details» column is stored Uzbek text («Qabul boshlandi», «To‘lov … (Naqd)») on Russian and Cyrillic pages; tooltips show raw action codes |
| UI-10 | Low | Doctor's visit «Documents» card; Cameras stat cards | A failed load is shown as «no documents» or as a skeleton that never ends |
| UI-11 | Low | Booking dialog / registrar | Empty submit marks patient, doctor and service as missing, but not the time slot; the slot error only appears after a doctor is picked |
| UI-12 | Low | /dashboard «Attention» cards / manager, uz-Cyrl/ru at 1366 | Card titles and subtitles are cut off with an ellipsis («Камера: хавфсизлик …», «Тасдиқланмаган нати…») |
| UI-13 | Low | Global a11y | Error toasts use `aria-live="polite"` (not alert); no skip-to-content link (13 Tab stops before the manager's content); empty `<th>` on /cameras (axe); password show/hide toggle has no focus ring |
| UI-14 | Low | /patients?search=… / all | Patient names typed in the search box end up in the URL (browser history, proxy/server logs) |
| UI-15 | Low | /patients / lab | The lab role can open the full patient directory (names, birth dates, next visit) by URL, although the menu hides it |
| UI-16 | Low | /reports, /schedule, /settings headings | A non-doctor sent to /reports sees «Mening faoliyatim»; a registrar sees doctor commission shares («Ulush 30%») in Settings → Services |
| UI-17 | Low (test) | e2e/errors.mjs, e2e/consent.mjs | Both suites failed once against the dev server and passed on rerun: their waits (900 ms / 10 s) are too tight |

No Critical issues were found. No other tenant's data appeared anywhere, and nothing clinical or financial was found in browser storage.

---

## Findings

### UI-01 (High): a `/me` blip signs the user out and loses unsaved work
- **Steps:** sign in as Shifokor, open /doctor and type in «Anamnez» (do not save). Then `/me` fails once: in the test a single request was aborted (`internetdisconnected`), but a 502/503 from a deploy or proxy has the same effect. Leave the tab for over 60 s and come back (window focus refetches the stale `me` query). Script: `audit/ui/me-blip.mjs`.
- **Expected:** the session is still valid, so the app keeps the page, retries, and at most shows a connection error. The unsaved-changes guard protects the text.
- **Actual:** it does `router.replace('/login')` at once. There is no beforeunload prompt (it is a client-side navigation) and no NavigationGuard dialog, so the typed note text is gone. The session cookie is still valid. The same happens to any half-filled form on any page.
- **Shot:** `shots/me-blip-abort.png` (login page right after the blip).
- **Cause:** `apps/web/src/lib/session.tsx:31` gives `useMeQuery` the setting `retry: false`. `apps/web/src/app/(app)/layout.tsx:60` then runs `if (me.isError) router.replace('/login')`. React Query sets `isError` on a failed **background** refetch even though `data` is still there. Only a 401 (`meduza:unauthorized`) should lead to /login. Other errors should keep the cached `me`, retry, and show a banner.

### UI-02 (Medium): the visit's error state can never render
- **Steps:** as the doctor, click a completed visit while `GET /api/v1/encounters/:id` answers 500 (`audit/ui/flows-doctor2.mjs`; 403 or 404 behave the same).
- **Expected:** «Server xatosi» with a «Qayta urinish» (retry) button.
- **Actual:** 8 skeleton rows stay forever, with no message and no retry. Seen for real when a manager, registrar or cashier opens /doctor (403).
- **Shots:** `shots/doc-encounter-500.png`, `shots/sweep-d-manager-doctor.png`.
- **Cause:** `apps/web/src/app/(app)/doctor/page.tsx:211-212`. `if (enc.isLoading || !form) return <LoadingRows/>` runs before `if (enc.isError)`. On an error `form` stays null, so the error branch is never reached. Swap the two checks.

### UI-03 (Medium): «Bekor qilish» discards typed input without asking
- **Steps:** /patients → «Bemor qo‘shish» → type a surname → click «Bekor qilish». The same happens in the order dialog after ticking a test, and in the refund dialog after typing a reason (`flows-registrar.mjs`, `flows-doctor2.mjs`, `flows-cash.mjs`).
- **Expected:** the same «unsaved changes will be lost» bar that Esc, X and backdrop clicks show (`Modal dirty`).
- **Actual:** the dialog closes immediately and the input is gone. Esc on the same form does ask (`shots/reg-patient-esc-dirty.png`).
- **Cause:** footers call `onClose` directly instead of the Modal's `tryClose`. Affected: `components/patient-form.tsx:82`, `components/booking.tsx:103`, `components/refund-modal.tsx:63`, `components/cash-shift.tsx:126,168`, `components/finance-extra.tsx:206`, `app/(app)/cashier/[id]/page.tsx:226` (discount) and `:253` (void), `app/(app)/settings/page.tsx:154`, `app/(app)/doctor/page.tsx:383-384` (AI) and `:425` (orders), and others. Suggested fix: let `Modal` expose its guarded close for footers, or make Cancel buttons use it.

### UI-04 (Medium): lab print says «result not entered» to roles that only lack permission
- **Steps:** as Rahbar or Registrator, open `/print/lab/<verified order id>` (for example from history or a shared link). As Shifokor, open the print of a `draft_result` order.
- **Expected:** a clear «Natija faqat shifokor/laboratoriya uchun» (result only for doctor/lab) state, or a 403. A document with patient data, «Holat: Tasdiqlangan», signature line and footer must not state something false.
- **Actual:** a full A4 document headed «Laboratoriya natijasi … Holat: Tasdiqlangan» with the body «Natija kiritilmagan.» (`shots/detail-manager-print-lab-f1836571-…png`, `shots/detail-doctor-print-lab-1b3b18ac-…png`). Handed to a patient, it says no result exists.
- **Cause:** `apps/web/src/app/print/lab/[id]/page.tsx:21`: `o.values?.length ? … : t('print.lab.noResult')`. The API leaves out `values` for roles without access, so the page cannot tell «hidden» from «empty». The in-app links are already limited to doctor and lab (`lab/page.tsx:137`, `patients/[id]/page.tsx:246`), so the print page should check the role or a flag such as `values_hidden`.

### UI-05 (Medium): no client route guard, so forbidden pages render half-working shells
- **Steps:** sign in as each role and open every route by URL (`audit/ui/sweep.mjs`, 75 combinations, `sweep-d.json`).
- **Expected:** one clean «Bu bo‘limni ko‘rish uchun ruxsatingiz yo‘q» (no access) page, with no actions and no data.
- **Actual:** the server correctly answers 403, but the pages show their header, tabs and primary buttons around a small error box. Examples:
  - Registrar /staff shows «Xodim qo‘shish».
  - Registrar, doctor, cashier and lab on /cameras: «Kamera qo‘shish» plus stat cards that skeleton forever (`shots/sweep-d-registrar-cameras.png`).
  - Registrar, doctor, cashier and lab on /settings: the clinic-name form with «Saqlash» (save gives a 403 toast), the Services table, and the Demo tab with a «Demo ma’lumotlarini tiklash» (reset demo) button (`shots/sweep-d-registrar-settings.png`, `shots/reg-settings-Demo.png`).
  - Manager, registrar and cashier on /doctor: today's list of all doctors' patients, the doctor workspace, «Allergiya: allergy.undefined» (raw i18n key) and an endless skeleton (`shots/sweep-d-manager-doctor.png`).
  - Registrar, cashier and lab on /reports are titled «Mening faoliyatim» (the doctor's «My activity»).
- **Cause:** `app/(app)/layout.tsx` only filters the menu (`MENU`, line 187). The pages never check `me.role`. The «allergy.undefined» key comes from `doctor/page.tsx:127`: the API returns `allergy_state` only to doctors. Suggested fix: reuse the `MENU` role table as a route guard in `Shell` that renders one «no access» state.

### UI-06 (Medium): a failed shift request is shown as «shift closed»
- **Steps:** as Kassir, open an unpaid invoice while `GET /cash-shifts/current` answers 500 (`flows-cash.mjs`, step 3).
- **Expected:** an error with «Retry». The cashier's shift is in fact open.
- **Actual:** an amber «Smena yopiq — Kassa sahifasida smenani oching» (`shots/cash-shift-500.png`). On /cashier the same hook shows «Smenani ochish», inviting a second opening attempt.
- **Cause:** `app/(app)/cashier/[id]/page.tsx:123` (`if (!shift.data)`) and `components/cash-shift.tsx:45`: both treat `isError` like «no shift».

### UI-07 (Medium): one-click, irreversible «Kelmadi» hours before the slot
- **Steps:** at 11:30, as Registrator, open the 15:00 appointment on /schedule.
- **Actual:** «Kelmadi» (danger style) sits right next to «Keldi deb belgilash». One click marks no-show, with no confirmation and no undo (the server only allows no-show from `scheduled`). The server allows it for any time today (`appointments.controller.ts:119` compares only the date). `shots/appt-dialog-noshow.png`.
- **Expected:** offered only after the appointment start (or end) time, with a confirmation like the «Cancel» flow.
- **Cause:** `components/appointment-dialog.tsx:54` (`localDate(appt.starts_at) <= me.today`).

### UI-08 (Medium): stale-note conflict leaves the doctor no way out
- **Steps:** open the same visit in two tabs. Save in tab B, then edit and save in tab A (`flows-doctor.mjs`).
- **What works:** tab A's text is kept, there is no false success, and the server keeps tab B's version. The 409 is handled correctly.
- **Problem:** the message reads «Saqlanmadi: Qayd boshqa oynada o‘zgartirilgan. Sahifani yangilang (matningiz nusxasini saqlab qo‘ying). Matningiz formada qoldi — qayta saqlang.» It says both «refresh» and «save again». Saving again always returns 409, because the version never changes, and refreshing triggers the beforeunload prompt and then drops the text. A doctor has to copy every field by hand. `shots/doc-stale-save.png`.
- **Suggestion:** one clear action, such as «Load the other tab's version» while keeping this text in a side panel, or a «Copy my text» button.

### UI-09 (Low): audit journal not translated
`/settings → Журнал аудита` (ru) and «Аудит журнали» (uz-Cyrl): the «Подробности» column shows server-stored Uzbek Latin («Qabul boshlandi», «Klinik qayd tasdiqlandi», «To‘lov: 50 000 so‘m (Naqd)…») (`shots/i18n-ru-manager-settings-Журналаудита.png`). The Action cell's `title` shows raw codes (`payment.create`). Cause: free-text `audit()` summaries (`apps/api/src/modules/*.controller.ts`), rendered as is at `settings/page.tsx:193-194`. No other leftover interface Uzbek and no raw message keys were found on any of the 29 role × page combinations (plus their tabs) in ru and uz-Cyrl (`i18n.json`). Everything else flagged was data: names, services, branch names, specialties.

### UI-10 (Low): load errors shown as empty or as endless loading
- `components/documents-card.tsx:44`: a failed `GET /encounters/:id/documents` renders «docs.none» (no documents), so a doctor may issue a duplicate prescription.
- `app/(app)/cameras/page.tsx:100-102`: `StatCard loading={!m}` stays a skeleton when the query fails.
- A static scan found other queries with no error branch: `consent.tsx:60`, `intake-panel.tsx:17`, `refund-modal.tsx:32`, `schedule-editor.tsx:26`, `staff-form.tsx:52`, `news-card.tsx`.

### UI-11 (Low): booking empty submit
Before a doctor is chosen, «Vaqtni tanlang» (`errors.start_time`) is set but never shown, because it only renders inside the slot grid (`components/booking.tsx`). `shots/reg-booking-empty.png`.

### UI-12 (Low): truncated attention cards
On /dashboard at 1366×768 the three «Diqqat talab qiladi» (attention) cards cut their titles and subtitles with an ellipsis in uz-Cyrl and ru (`shots/i18n-uz-Cyrl-manager-dashboard.png`). Uzbek Latin was not checked separately.

### UI-13 (Low): accessibility details
- axe found **0 violations** on every allowed page at 1366 for all roles, except /cameras: `empty-table-header` (the 7th `<th>`, the actions column, has no text).
- The toast region is `aria-live="polite"` for errors too (`components/ui.tsx:276`). Errors should use `role="alert"`/assertive.
- There is no skip-to-content link; a manager tabs through 13 menu and header stops before the page content.
- The password form's «Ko‘rsatish/Yashirish» (show/hide) button has no `focus-visible` ring (`components/password-form.tsx:50`).

### UI-14 (Low): patient names in URLs
The top-bar search navigates to `/patients?search=<name>` (`layout.tsx`, `search()`). It is not clinical text, but it is personal data that ends up in history and access logs. Consider keeping the term in component state or using a POST search.

### UI-15 (Low): lab can open the patient directory
`/patients` as Laboratoriya lists every patient (ID, name, birth date, next visit) using the minimal columns (`patients.controller.ts`, `minimal`). The menu hides it, so this is probably not intended. Restrict lab to patients with orders, or answer 403.

### UI-16 (Low): role labels and shares
- /reports title uses the doctor wording for every non-manager (`reports/page.tsx:44`).
- A registrar on Settings → Services sees the doctor share column (financial terms of doctors). The page should not be reachable by that role at all (see UI-05).

### UI-17 (Low, tests)
Against the dev server, `e2e/errors.mjs` (lost payment response, `sleep(900)`) and `e2e/consent.mjs` (`waitForFunction` 10 s) each failed once and passed on rerun. All other suites passed first time: demo, auth, schedule, telegram, ai, documents, cash, i18n, cameras, news. My own offline and lost-payment test (`flows-cash.mjs`) confirmed the behaviour is correct, so these are test timing issues, not product bugs.

---

## Verified OK (coverage matrix)

Legend: L = loads without console or 5xx errors · A = axe 0 violations · V = no horizontal scroll at 1366/1920/390/360 · I = ru + uz-Cyrl without leftover interface Uzbek · F = flows/negative checks done · X = forbidden for the role; the server returns 403 for data (shell problems are UI-05).

| Page | Manager | Registrar | Doctor | Cashier | Lab |
|---|---|---|---|---|---|
| /dashboard | L A V I | X | X | X | X |
| /patients (+ add modal) | L A V I | L A V I F (empty submit, dirty Esc, double-click → 1 row, offline → error kept input, retry → 1 row) | L A V I | L A V I (minimal) | data visible (UI-15) |
| /patients/:id (all tabs) | L (no clinical text, lab status only) | L (no clinical) | L (notes, allergy) | L (minimal + invoices) | L (minimal) |
| /schedule (+ booking, appointment dialog) | L A V I | L A V I F (stale check-in → «already in queue №7», no duplicate) | L A V I | partial read | X |
| /queue | L A V I | L A V I | L A V I | L A V I | X |
| /doctor | X (UI-02, UI-05) | X | L A V I F (sign validation focuses the first empty field, offline save keeps text and shows no success, lost-response retry, two-tab 409, AI sample labelled «Namunaviy rejim», orders modal) | X | X |
| /lab | L A V I | L A V I | status page | X | L A V I F (collect → result → verify via e2e) |
| /diagnostics | X | X | L A V I | X | X |
| /news (+ topics) | X | X | L A V I (e2e news) | X | X |
| /cashier, /cashier/:id | L A V I F (refund: double-click → 1 refund, toast correct) | L A V I (view only) | X | L A V I F (pay double-click → 1 payment, offline → «javob olinmadi» + same-key resend → 1 payment, overpay blocked) | X |
| /finance (all tabs) | L A V I | X | X | L A V I | X |
| /staff (+ add/deactivate, temp password once) | L A V I (e2e auth) | X | X | X | X |
| /inventory | L A V I | X | X | X | X |
| /cameras (all tabs, simulate, arrivals accept) | L V I, A except UI-13 (e2e cameras) | X | X | X | X |
| /reports | L A V I | X | L A V I | X | X |
| /settings (all tabs, Telegram simulator) | L A V I (e2e telegram) | X (UI-05) | X | X | X |
| /print/payment | OK | 403 state | 403 state | OK | 403 state |
| /print/shift | OK | 403 | 403 | OK | 403 |
| /print/lab | UI-04 | UI-04 | own/verified only | 403 | OK |
| /print/note | 403 | 403 | own patients only | 403 | 403 |
| /print/uzi | 403 | 403 | OK | 403 | 403 |
| /print/consent (+ blank) | OK | OK | OK | OK | OK (demographics only) |

Also verified:
- **Unknown ids and bad uuids:** a clean «Ma’lumot topilmadi» card (no crash). Unknown route: Next 404.
- **Session expiry:** after logging out in tab A, tab B's next action lands cleanly on /login.
- **Password change:** forced change for temp passwords, via e2e auth.
- **Unsaved-changes guard:** the menu-link confirm and beforeunload both work.
- **Keyboard:** logical Tab order with a visible ring everywhere. Modals open with Enter, first focus goes to the first field, focus stays trapped (30 Tabs), Esc closes, and focus returns to the trigger (/patients, /staff, /finance). The user menu works with Enter/Esc, and the mobile drawer focuses its first link and Esc returns to the burger.
- **Slow 3G:** the booking dialog shows its loading state, no duplicates.
- **API responses:** largest 32 KB (`/appointments`), polling normal.
- **Browser storage after a full session per role:** localStorage only has `meduza.branch.<membership>` (branch id). sessionStorage, IndexedDB, Cache Storage and service workers are all empty. Cookies are `meduza_session` (HttpOnly, SameSite=Lax) and `meduza_lang`. No clinical text in URLs; only ids and the search term (UI-14).
- **Layout:** no page-level horizontal scroll on any allowed page at 1366×768, 1920×1080, 390×844 or 360×740. The schedule timeline and tables scroll inside their cards.

## Not tested
- The production build (`next start`). Everything ran on `next dev`, so the Next dev overlay and indicator appear in the screenshots.
- Real Telegram, real AI (only `AI_MODE=sample`), real Hikvision devices, and `/phone-camera` (needs a camera).
- `APP_MODE=production` login (password tab) beyond e2e auth, and lockout after 5 failures in the UI.
- axe inside open modals and at mobile widths (axe ran only on full pages at 1366). Screen-reader behaviour (VoiceOver/NVDA).
- Uzbek Latin text clipping at 390/360 was checked by script (overflow) and by sample screenshots only, not one by one. ru/uz-Cyrl were checked at 1366 only.
- Printing to paper/PDF pagination (covered by the existing `e2e/print.mjs`, not rerun).
- Demo reset button in the UI (only called through the API between suites), inventory movements, the staff schedule editor, and the discount/void modals beyond static review.
- Stopping the API process outright. Equivalent failures were injected per request (abort/500/offline) instead.
