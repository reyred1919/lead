# Defect register

Total: 19 — P0: 0, P1: 4, P2: 12, P3: 3 (IDs QA-D-13..15 unused)

| ID | Sev | Category | Summary | Fix | Retest |
|---|---|---|---|---|---|
| QA-D-01 | P1 | Privacy / cross-event exposure | Full name, organization and masked mobile of event-E contact returned (enumeration by mobile number). | Suggestions limited to contacts reachable through visible_interactions(user); global lead.view.all unchanged; exact-match linking on capture still server-side (commit 0651019). | PASS |
| QA-D-02 | P1 | Auth / onboarding | After 5 requests/hour per IP (token GET counted) all further activations return 429; UI shows the throttle text under the password field. | Per-token throttle on submit, per-IP on forgot, coarse 300/h per-IP ceiling; GET check no longer consumes the strict budget (commit cf6c845). | PASS |
| QA-D-03 | P1 | Security / deployment | NUM_PROXIES not configured anywhere → all booth users share one login limit and audit IP is the proxy. | DJANGO_NUM_PROXIES → REST_FRAMEWORK.NUM_PROXIES; compose sets 1; audit uses same rule (commit cf6c845). | PASS |
| QA-D-04 | P2 | Auth / UX | Stays on /leads showing 'بارگذاری ناموفق بود' cards; API returns 403 indistinguishable from 'forbidden'. | SessionAuthentication401 + global session-expired event → identity cleared → Protected redirects (commits cf6c845, fa14bcf). | PASS |
| QA-D-05 | P2 | Reporting correctness | UTC day used: yesterday-evening lead counted as today; early-morning lead excluded from today's filter; daily trend buckets shifted 3.5h. | apps/common/dates.py local-day ranges + TruncDate(tzinfo=Asia/Tehran) (commit 0651019). | PASS |
| QA-D-06 | P3 | Performance | users: 21→28 queries; plans: 6→18 (one per row). | Use prefetched relation; annotate product count (commit 00fd106). | PASS |
| QA-D-07 | P2 | Functional gap | No sort control; API ordering parameter unused by the UI. | Sort select (newest/oldest/last changed) bound to ?ordering (commit fa14bcf). | PASS |
| QA-D-08 | P3 | UX / mobile | Event name truncated ('…فناوری' loses '۱۴۰۵') and lock icon clipped out of view. | Two-line clamp, lock shrink-0, code chip hidden < sm (commit fa14bcf). | PASS |
| QA-D-09 | P2 | Accessibility (WCAG 1.4.3) | Muted text #718198 at 3.5–3.97:1 on 22 routes; blue on blue-soft 4.42:1. | Muted #5d6b81 (≥4.7:1 on every surface), soft action text uses action-2 (commit fa14bcf). | see axe-summary-after.json |
| QA-D-10 | P2 | Accessibility (4.1.2) | role=option buttons wrapped in plain <li> (critical). | li role=none (commit fa14bcf). | see axe-summary-after.json |
| QA-D-11 | P2 | Accessibility (1.3.1/4.1.2) | Selects/inputs unnamed; every date picker named 'انتخاب تاریخ' (start/end indistinguishable). | Field auto-binds label → control id; picker uses label (commit fa14bcf). | see axe-summary-after.json |
| QA-D-12 | P3 | Accessibility | aria-label on a role-less span. | role=img (commit fa14bcf). | see axe-summary-after.json |
| QA-D-16 | P2 | Offline / shared device | Cached identity of A loaded indefinitely when offline; A's queued leads visible. | cachedAt + 12h max age (commit 8e43a73). | PASS |
| QA-D-17 | P2 | UX / mobile overflow | Page scrolls horizontally by 35px; heading clipped. | overflow-wrap:anywhere globally + on heading (commit 3a4da09). | pending |
| QA-D-18 | P2 | UX / mobile overflow | Export card 31px wider than the viewport; whole page scrolls sideways. | grid-cols-[minmax(0,1fr)] (commit 3a4da09). | pending |
| QA-D-19 | P2 | Offline / capture | 'شما عضو فعال هیچ رویدادی نیستید' — booth capture blocked although the user is a member. | Prefetch+cache event context at login; truthful offline/retry state (commit cef25e4); networkMode 'always' so the query falls back to the encrypted cache (commit a665d76 — the first fix alone failed TC-OFF-04/06 in the interim after-run). | pending |
| QA-D-20 | P1 | UX / mobile overflow | Page widened sideways; 'بیشتر' tab was off-screen and its tap was intercepted by list content (15 s timeout). On 375×667 the Capture page (own recent list) doubled in width and product, submit and bottom-nav taps landed outside the content (`<html> intercepts pointer events`) — booth capture blocked for that user. | overflow-wrap:anywhere on rows, nowrap timestamps, grid-cols-[minmax(0,1fr)] base (commit a4f1e7a). | pending |
| QA-D-21 | P2 | Accessibility (WCAG 2.2 2.4.11) | At 768–1023 px the end of every page (e.g. list pagination) stays under the fixed bottom tab bar even at maximum scroll; taps are intercepted by `nav[aria-label='ناوبری پایین']` and keyboard focus is obscured. | Separate top/bottom padding (`pt-5 md:pt-8 pb-28 lg:pb-10`), html scroll-padding, focus-in guard in AppShell (commits 4c81bad, e661188). | pending |
| QA-D-22 | P2 | Offline / data integrity | Each concurrent write generated its own AES key and the later put overwrote the earlier key; the earlier ciphertext became undecryptable ('اطلاعات رویداد بارگذاری نشد'). The same race could make a queued lead unreadable. | One in-flight key promise per user + add() with re-read on conflict (commit ec513af). Regression test fails on the previous code. | pending |

## QA-D-01 — Privacy / cross-event exposure (P1, priority High)

- **Scenario:** API: test_qa_contact_search_does_not_leak_other_event_contacts
- **Env:** pytest, PostgreSQL 16, commit c6a1c88
- **Steps:** 1) Booth user of event F (spec_f) logs in. 2) GET /api/v1/contacts/search?mobile=<mobile captured only in event E>. 3) Also ?q=<name fragment>.
- **Expected:** No contact from event E is disclosed to a user with no access to E.
- **Actual:** Full name, organization and masked mobile of event-E contact returned (enumeration by mobile number).
- **Evidence:** qa/baseline/pytest-qa-audit.txt
- **Code:** backend/apps/crm/services.py:suggest_contacts; backend/apps/crm/views.py:ContactSearchView
- **Root Cause:** Suggestion query searched the whole master contact table without row-level scope.
- **Fix:** Suggestions limited to contacts reachable through visible_interactions(user); global lead.view.all unchanged; exact-match linking on capture still server-side (commit 0651019).
- **Retest:** PASS

## QA-D-02 — Auth / onboarding (P1, priority High)

- **Scenario:** TC-AUTH-06; test_qa_activation_link_check_not_blocked_by_other_users
- **Env:** Chromium all viewports + pytest
- **Steps:** 1) Admin creates several users. 2) From one IP (office NAT) open/validate each activation link and set password.
- **Expected:** Each user can activate.
- **Actual:** After 5 requests/hour per IP (token GET counted) all further activations return 429; UI shows the throttle text under the password field.
- **Evidence:** qa/results/playwright-baseline-*.log (TC-AUTH-06 failed on every project); qa/baseline/pytest-qa-audit.txt
- **Code:** backend/apps/iam/views.py ResetThrottle (scope password_reset 5/hour)
- **Root Cause:** Single per-IP AnonRateThrottle shared by forgot, token check and submit.
- **Fix:** Per-token throttle on submit, per-IP on forgot, coarse 300/h per-IP ceiling; GET check no longer consumes the strict budget (commit cf6c845).
- **Retest:** PASS

## QA-D-03 — Security / deployment (P1, priority High)

- **Scenario:** test_qa_rate_limit_distinguishes_clients_behind_reverse_proxy; test_qa_deployment_declares_trusted_proxy_hop
- **Env:** pytest + infra/docker-compose.yml review
- **Steps:** Behind nginx all requests arrive with REMOTE_ADDR=proxy. 1) Client A fails login 4×. 2) Client B (different X-Forwarded-For) logs in.
- **Expected:** B is not affected by A's throttle; audit logs record the real client IP.
- **Actual:** NUM_PROXIES not configured anywhere → all booth users share one login limit and audit IP is the proxy.
- **Evidence:** qa/baseline/pytest-qa-audit.txt
- **Code:** backend/config/settings.py REST_FRAMEWORK; backend/apps/common/audit.py client_ip; infra/docker-compose.yml
- **Root Cause:** Trusted proxy hop count not declared for the documented deployment topology.
- **Fix:** DJANGO_NUM_PROXIES → REST_FRAMEWORK.NUM_PROXIES; compose sets 1; audit uses same rule (commit cf6c845).
- **Retest:** PASS

## QA-D-04 — Auth / UX (P2, priority High)

- **Scenario:** TC-AUTH-05 (all 6 viewports); test_qa_unauthenticated_api_returns_401
- **Env:** Chromium 1440/1920/768/1024/390/375
- **Steps:** 1) Log in as planmgr. 2) Session expires (cookie cleared). 3) Navigate inside the SPA (click «لیدها»).
- **Expected:** Redirect to /login?next=… so the user can sign in again.
- **Actual:** Stays on /leads showing 'بارگذاری ناموفق بود' cards; API returns 403 indistinguishable from 'forbidden'.
- **Evidence:** qa/traces/test-output/baseline-*/01-auth-context-*-o-reload-redirects-to-login-*/ (trace.zip, video.webm, test-failed-1.png)
- **Code:** backend DRF SessionAuthentication (403); frontend/src/lib/api.ts, auth.tsx
- **Root Cause:** SessionAuthentication has no authenticate_header → DRF converts NotAuthenticated to 403; SPA has no global handler.
- **Fix:** SessionAuthentication401 + global session-expired event → identity cleared → Protected redirects (commits cf6c845, fa14bcf).
- **Retest:** PASS

## QA-D-05 — Reporting correctness (P2, priority Medium)

- **Scenario:** test_qa_personal_today_metric_uses_tehran_day; test_qa_date_filter_uses_tehran_day
- **Env:** pytest with frozen time
- **Steps:** 1) Lead captured 23:30 Tehran yesterday (20:00 UTC). 2) At 01:00 Tehran today read /dashboard. 3) Filter leads date_from=date_to=today for a lead captured 01:00 Tehran.
- **Expected:** 'Today' = Tehran calendar day; Jalali date filters include 00:00–03:30 local captures.
- **Actual:** UTC day used: yesterday-evening lead counted as today; early-morning lead excluded from today's filter; daily trend buckets shifted 3.5h.
- **Evidence:** qa/baseline/pytest-qa-audit.txt
- **Code:** backend/apps/reports/views.py DashboardView; backend/apps/crm/views.py apply_lead_filters
- **Root Cause:** captured_at__date and TruncDate evaluated in TIME_ZONE=UTC.
- **Fix:** apps/common/dates.py local-day ranges + TruncDate(tzinfo=Asia/Tehran) (commit 0651019).
- **Retest:** PASS

## QA-D-06 — Performance (P3, priority Low)

- **Scenario:** test_qa_list_endpoints_have_no_n_plus_one[users|plans]
- **Env:** pytest CaptureQueriesContext
- **Steps:** Add 12 users / 12 plans and compare query counts of the list endpoints.
- **Expected:** Constant query count.
- **Actual:** users: 21→28 queries; plans: 6→18 (one per row).
- **Evidence:** qa/baseline/pytest-qa-audit.txt
- **Code:** backend/apps/iam/serializers.py get_global_roles; backend/apps/catalog/serializers.py get_product_count
- **Root Cause:** select_related inside serializer method bypassed prefetch; per-row count().
- **Fix:** Use prefetched relation; annotate product count (commit 00fd106).
- **Retest:** PASS

## QA-D-07 — Functional gap (P2, priority Medium)

- **Scenario:** TC-LST-05 (all viewports)
- **Env:** Chromium all viewports
- **Steps:** Open /leads and look for a sort control.
- **Expected:** User can sort the list (QA brief Phase B.5).
- **Actual:** No sort control; API ordering parameter unused by the UI.
- **Evidence:** qa/traces/test-output/baseline-*/04-leads-enrichment-*-ol-exists-and-changes-order-*/
- **Code:** frontend/src/pages/Leads.tsx
- **Root Cause:** Not implemented in UI.
- **Fix:** Sort select (newest/oldest/last changed) bound to ?ordering (commit fa14bcf).
- **Retest:** PASS

## QA-D-08 — UX / mobile (P3, priority Medium)

- **Scenario:** TC-CTX-01 (mobile-390, mobile-375)
- **Env:** Chromium 390×844, 375×667 touch
- **Steps:** Booth specialist with one event opens /capture on a phone.
- **Expected:** Event name and lock indicator fully visible.
- **Actual:** Event name truncated ('…فناوری' loses '۱۴۰۵') and lock icon clipped out of view.
- **Evidence:** qa/traces/test-output/baseline-mobile-390/01-auth-context-Event-cont-*-mobile-390/test-failed-1.png
- **Code:** frontend/src/pages/Capture.tsx header
- **Root Cause:** truncate on the flex row containing the lock icon; event code chip consumes width.
- **Fix:** Two-line clamp, lock shrink-0, code chip hidden < sm (commit fa14bcf).
- **Retest:** PASS

## QA-D-09 — Accessibility (WCAG 1.4.3) (P2, priority Medium)

- **Scenario:** TC-MTX axe scans
- **Env:** axe-core 4.10 on 1440/768/390
- **Steps:** Run axe on every allowed route.
- **Expected:** No color-contrast violations.
- **Actual:** Muted text #718198 at 3.5–3.97:1 on 22 routes; blue on blue-soft 4.42:1.
- **Evidence:** qa/results/axe-summary-baseline.json
- **Code:** frontend/src/styles.css --color-muted; primitives.tsx soft/action tones
- **Root Cause:** Design token below AA.
- **Fix:** Muted #5d6b81 (≥4.7:1 on every surface), soft action text uses action-2 (commit fa14bcf).
- **Retest:** see axe-summary-after.json

## QA-D-10 — Accessibility (4.1.2) (P2, priority Medium)

- **Scenario:** TC-MTX axe: aria-required-parent, listitem
- **Env:** axe-core
- **Steps:** Open any dialog with the user picker or the tag combobox.
- **Expected:** options are owned by the listbox.
- **Actual:** role=option buttons wrapped in plain <li> (critical).
- **Evidence:** qa/results/axe-summary-baseline.json
- **Code:** frontend/src/components/ui/pickers.tsx; components/tags/Tags.tsx
- **Root Cause:** Implicit listitem role between listbox and option.
- **Fix:** li role=none (commit fa14bcf).
- **Retest:** see axe-summary-after.json

## QA-D-11 — Accessibility (1.3.1/4.1.2) (P2, priority Medium)

- **Scenario:** TC-MTX axe select-name/label; TC-ADM-01 date pickers
- **Env:** axe-core + screen-reader names
- **Steps:** Reports/Messages selects and Branding inputs; two date pickers in the event form.
- **Expected:** Every control has an accessible name tied to its visible label.
- **Actual:** Selects/inputs unnamed; every date picker named 'انتخاب تاریخ' (start/end indistinguishable).
- **Evidence:** qa/results/axe-summary-baseline.json; qa/traces/.../05-admin-notify-*-activate-*/
- **Code:** frontend/src/components/ui/primitives.tsx Field; datepicker.tsx
- **Root Cause:** Field label without htmlFor; picker aria-label overrides label.
- **Fix:** Field auto-binds label → control id; picker uses label (commit fa14bcf).
- **Retest:** see axe-summary-after.json

## QA-D-12 — Accessibility (P3, priority Low)

- **Scenario:** TC-MTX axe aria-prohibited-attr
- **Env:** axe-core
- **Steps:** Any page with the placeholder logotype.
- **Expected:** Valid ARIA.
- **Actual:** aria-label on a role-less span.
- **Evidence:** qa/results/axe-summary-baseline.json
- **Code:** frontend/src/components/brand/BrandLogo.tsx
- **Root Cause:** Missing role.
- **Fix:** role=img (commit fa14bcf).
- **Retest:** see axe-summary-after.json

## QA-D-16 — Offline / shared device (P2, priority Medium)

- **Scenario:** Code review + unit test 'offline identity fallback expires'
- **Env:** Vitest + fake-indexeddb
- **Steps:** 1) User A uses booth tablet; session expires without logout. 2) Device is offline; person B opens the PWA next day.
- **Expected:** No access as A after the session lifetime.
- **Actual:** Cached identity of A loaded indefinitely when offline; A's queued leads visible.
- **Evidence:** frontend/src/lib/offline.test.ts
- **Code:** frontend/src/lib/offline.ts cachedContext; auth.tsx
- **Root Cause:** No expiry on cached context.
- **Fix:** cachedAt + 12h max age (commit 8e43a73).
- **Retest:** PASS

## QA-D-17 — UX / mobile overflow (P2, priority Medium)

- **Scenario:** TC-MTX admin /leads/:id on mobile-390
- **Env:** Chromium 390×844
- **Steps:** Open a lead whose name is a long unbroken string (e.g. pasted URL) on a phone.
- **Expected:** No horizontal scroll.
- **Actual:** Page scrolls horizontally by 35px; heading clipped.
- **Evidence:** qa/screenshots/c6a1c88/admin/mobile-390/leads_id__ready.png; qa/results/matrix-mobile-390.jsonl
- **Code:** frontend/src/pages/LeadDetail.tsx; styles.css
- **Root Cause:** No overflow-wrap for unbroken tokens.
- **Fix:** overflow-wrap:anywhere globally + on heading (commit 3a4da09).
- **Retest:** pending

## QA-D-18 — UX / mobile overflow (P2, priority Medium)

- **Scenario:** TC-MTX admin+mdm /reports on mobile-390
- **Env:** Chromium 390×844
- **Steps:** Open /reports on a phone.
- **Expected:** No horizontal scroll.
- **Actual:** Export card 31px wider than the viewport; whole page scrolls sideways.
- **Evidence:** qa/screenshots/c6a1c88/admin/mobile-390/reports__ready.png; qa/results/matrix-mobile-390.jsonl
- **Code:** frontend/src/pages/Reports.tsx (also Messages, LeadDetail, Notify grids)
- **Root Cause:** Grid item min-width:auto expands to the no-wrap format selector.
- **Fix:** grid-cols-[minmax(0,1fr)] (commit 3a4da09).
- **Retest:** pending

## QA-D-19 — Offline / capture (P2, priority High)

- **Scenario:** TC-VIS-STATES (desktop-1440) offline state; regression TC-OFF-06
- **Env:** Chromium, all projects (network offline emulation)
- **Steps:** Log in online as planmgr on Home (never open /capture), go offline, tap 'ثبت لید جدید'.
- **Expected:** Capture form with the user's event/products, queueing locally.
- **Actual:** 'شما عضو فعال هیچ رویدادی نیستید' — booth capture blocked although the user is a member.
- **Evidence:** qa/traces/test-output/baseline-desktop-1440/*TC-VIS-ST*/test-failed-1.png
- **Code:** frontend/src/pages/Capture.tsx; frontend/src/lib/auth.tsx
- **Root Cause:** Event context cached only when /capture was opened online, and React Query's default networkMode 'online' paused the events query offline with neither data nor error, which the page rendered as 'no membership'.
- **Fix:** Prefetch+cache event context at login; truthful offline/retry state (commit cef25e4); networkMode 'always' so the query falls back to the encrypted cache (commit a665d76 — the first fix alone failed TC-OFF-04/06 in the interim after-run).
- **Retest:** pending

## QA-D-20 — UX / mobile overflow (P1, priority High)

- **Scenario:** TC-MTX mdm Home on mobile-390; regression TC-LST-07; TC-CAP-01/02/06/09 and TC-AUTH-02 on mobile-375
- **Env:** Chromium 390×844 (touch emulation)
- **Steps:** A lead with an unbroken long name (e.g. formula-like string) appears in 'آخرین ثبت‌های من'; open Home on a phone and tap 'بیشتر'.
- **Expected:** Name wraps; no horizontal scroll; bottom nav tappable.
- **Actual:** Page widened sideways; 'بیشتر' tab was off-screen and its tap was intercepted by list content (15 s timeout). On 375×667 the Capture page (own recent list) doubled in width and product, submit and bottom-nav taps landed outside the content (`<html> intercepts pointer events`) — booth capture blocked for that user.
- **Evidence:** qa/traces/test-output/baseline-mobile-390/07-matrix-visual-TC-MTX-md-*/test-failed-1.png; qa/traces/test-output/baseline-mobile-375/02-capture-TC-CAP-01-*/test-failed-1.png
- **Code:** frontend/src/pages/Dashboard.tsx, Capture.tsx, admin/Events.tsx, Notify.tsx, Settings.tsx
- **Root Cause:** Implicit auto grid track + non-wrapping flex child sized to min-content of the unbroken string.
- **Fix:** overflow-wrap:anywhere on rows, nowrap timestamps, grid-cols-[minmax(0,1fr)] base (commit a4f1e7a).
- **Retest:** pending

## QA-D-21 — Accessibility (WCAG 2.2 2.4.11) (P2, priority Medium)

- **Scenario:** TC-LST-01 tablet-768 (after1 and after2 runs)
- **Env:** Chromium 768×1024 touch emulation
- **Steps:** Open /leads on a tablet/phone; move to the pagination control by keyboard focus or programmatic scroll.
- **Expected:** The focused/scrolled control is fully visible.
- **Actual:** At 768–1023 px the end of every page (e.g. list pagination) stays under the fixed bottom tab bar even at maximum scroll; taps are intercepted by `nav[aria-label='ناوبری پایین']` and keyboard focus is obscured.
- **Evidence:** qa/traces/test-output/after-tablet-768/*LST-01*/
- **Code:** frontend/src/styles.css
- **Root Cause:** `md:py-8` on <main> overrode `pb-28` (bottom padding fell to 32 px under a 64 px bar); no scroll padding for sticky/fixed bars.
- **Fix:** Separate top/bottom padding (`pt-5 md:pt-8 pb-28 lg:pb-10`), html scroll-padding, focus-in guard in AppShell (commits 4c81bad, e661188).
- **Retest:** pending

## QA-D-22 — Offline / data integrity (P2, priority High)

- **Scenario:** TC-OFF-06 desktop-1440 (after2 run); vitest 'concurrent first writes share one key'
- **Env:** Chromium; vitest + fake-indexeddb
- **Steps:** First login on a device: context and event list are encrypted concurrently; go offline; open capture.
- **Expected:** Both cached records decrypt with the user's single key.
- **Actual:** Each concurrent write generated its own AES key and the later put overwrote the earlier key; the earlier ciphertext became undecryptable ('اطلاعات رویداد بارگذاری نشد'). The same race could make a queued lead unreadable.
- **Evidence:** qa/traces/test-output/after2-desktop-1440/*login-still-allows-capture*/test-failed-1.png; frontend/src/lib/offline.test.ts
- **Code:** frontend/src/lib/offline.ts key()
- **Root Cause:** Non-atomic read→generate→put of the per-user key (pre-existing; made frequent by the login prefetch added for QA-D-19).
- **Fix:** One in-flight key promise per user + add() with re-read on conflict (commit ec513af). Regression test fails on the previous code.
- **Retest:** pending
