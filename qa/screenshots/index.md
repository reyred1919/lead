# Screenshot index

Every image here is a genuine Playwright full-page capture of the running application (Chromium 1194, device **emulation** —
no physical devices, no WebKit/Firefox). All people, phone numbers, e-mails and organisations are synthetic fixtures
(`*@demo.invalid`, `0912 000 …`). No credentials appear in any capture.

| Set | Commit | Captures | Contact sheets | Index |
|---|---|---|---|---|
| Before (baseline) | `c6a1c88` | 809 | `contact-sheets/c6a1c88/` (56) | [index-c6a1c88.md](index-c6a1c88.md) · [manifest](manifest-c6a1c88.json) |
| After (final) | `e661188` | 866 | `contact-sheets/e661188/` (57) | [index-e661188.md](index-e661188.md) · [manifest](manifest-e661188.json) |

Per device (before → after): desktop-1440 264 → 266 · tablet-768 242 → 267 · mobile-390 241 → 267 ·
desktop-1920 21 → 22 · tablet-1024 21 → 22 · mobile-375 20 → 22. The role × route gallery is captured on the three
reference viewports (desktop-1440, tablet-768, mobile-390); state captures (empty, validation, loading, server error,
offline banner/queue, modals, Jalali picker, conflict, export) run on all six. Baseline counts are lower where a test
aborted on a real defect before reaching later routes (e.g. QA-D-20 on mobile).

Naming: `qa/screenshots/{commit}/{role}/{device}/{route}__{state}.png` (`/` → `home`, `/leads/:id` → `leads_id`).

Failure screenshots and selected traces (baseline and interim after-runs) are under `qa/traces/` — see
[`qa/traces/README.md`](../traces/README.md).

**Interim sets not kept in the final tree** (they remain in branch history; not rewritten): `d97226a`, `4c81bad`
(interim after-runs, see `qa/results/HARNESS-NOTES.md` H-04/H-05) and `dbg` (early harness debugging, before baseline).
The targeted accessibility re-run on `d478da7` produced 734 captures that were not committed; its results are in
`qa/results/jsonl-a11y/` and `qa/results/playwright-a11y-*.json`.
