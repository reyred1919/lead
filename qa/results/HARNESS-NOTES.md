# Harness incidents (recorded, not hidden)

## H-01 — Vite dev server full-reloads open pages when a spec file changes
- Evidence: `/tmp/qa-logs/ui.log` (copied to `qa/results/ui-vite.log`):
  `page reload qa.config.ts` 13:24:19, `qa-e2e/05-admin-notify.spec.ts` 13:28:01,
  `qa-e2e/06-export-offline-security.spec.ts` 13:35:29, `qa-e2e/04-leads-enrichment.spec.ts` 13:38:56.
- Impact: TC-REF-03/04 on desktop-1920 baseline — the owner's return dialog vanished mid-test; the trace
  (`qa/traces/test-output/baseline-desktop-1920/*REF-03*/trace.zip`, context 1) shows a second document
  request for `/inbox` right after the reason was typed. Classified as a **harness failure, not a product defect**;
  the case is re-run in isolation and both results are reported.
- Mitigation: no edits under `frontend/` while a run is in progress; for the "after" runs the Vite dev server
  ignores `qa-e2e/**`, `e2e/**` and `*.config.ts` changes (`server.watch.ignored`).

## H-02 — TC-OFF-06 locator ambiguous on tablet-768 (test defect)
- At 768px Home shows both the hero CTA and the bottom-nav button named "ثبت لید جدید"; the test chose by
  width ≥1024 only and hit a strict-mode violation. Fixed in the test (scope to the bottom navigation on
  touch layouts) after the baseline runs; not a product defect.

## H-03 — TC-SEC-01 used `events/mine[0]` (test defect, inconclusive result on tablet-1024)
- After TC-ENR-01 created temporary (then closed) events, `events/mine[0]` for specialist1 could be a closed
  event; the API correctly refused the capture (422 `event_not_active`) and the test then looked for a lead page
  that did not exist. No script execution was observed, but the run is **inconclusive**, not a PASS.
- Fix: the test selects the active demo event and asserts 201 before checking rendering; re-run on all projects.

## H-04 — Interim after-run (`after1`, code `d97226a`) — test selector corrections
- Date-picker triggers are now named by their field label (accessibility fix in `fa14bcf`); tests that looked
  for the placeholder name "انتخاب تاریخ" (TC-REF-01..05, TC-ADM-01, TC-VIS-STATES, TC-VIS-JALALI) now locate the
  trigger by its calendar icon. Not a product regression: the accessible name is now the visible label.
- TC-AUTH-05 picked a hidden sidebar link on 375 px (now `visible=true`); TC-CAP-01 `getByText` matched a lead
  named "… سازمان موجود …" once the list fit the screen (now `exact`).
- Real findings from `after1`, fixed and re-run: QA-D-19 still reproduced (React Query paused offline → fixed in
  `a665d76`); QA-D-21 (focus/scroll target under the mobile tab bar → `4c81bad`).
- `after1` evidence is kept under `qa/results/playwright-after1-*`, `qa/results/jsonl-after1/`,
  `qa/traces/test-output/after1-*`; final numbers come from the `after` run on `4c81bad`.
