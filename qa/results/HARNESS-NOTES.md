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
