# QA changelog — audit of `c6a1c88`

Branch `qa/audit-c6a1c88` (base `ccr-c989dc1b-w7didd`). Baseline evidence was recorded **before** any fix was
loaded: the QA API process (`runserver --noreload`, started 13:14:27 UTC) predates the first backend fix edit
(13:19:38 UTC) and still answered unauthenticated requests with 403 during all baseline runs; the baseline UI
dev server served `c6a1c88` frontend sources (fixes were developed in a separate worktree, `qa/frontend-fixes`).

## Product fixes (each with a regression test)
| Commit | Defects | Change | Regression test |
|---|---|---|---|
| `cf6c845` | QA-D-02, D-03, D-04 | 401 + `WWW-Authenticate` for missing session; reset throttles per token / forgot per IP / IP ceiling; `DJANGO_NUM_PROXIES` for throttling and audit IP | `test_qa_audit.py` (throttle, proxy, 401), TC-AUTH-05/06 |
| `0651019` | QA-D-01, D-05 | Contact suggestions limited to the caller's visible leads; dashboard and date filters use Asia/Tehran calendar days | `test_qa_contact_search_*`, `test_qa_tehran_*` |
| `00fd106` | QA-D-06 | Removed N+1 on users and plans lists | `test_qa_list_endpoints_have_no_n_plus_one` |
| `7c2273c` | QA-D-04 (UI), D-07, D-08, D-09, D-10, D-11, D-12 | Session-expiry redirect; list sort control; capture header on narrow screens; label/control binding; listbox roles; contrast tokens | TC-AUTH-05, TC-LST-05, TC-CTX-01, axe in TC-MTX |
| `6e1a3d6` | QA-D-16 | Cached offline identity expires after 12 h | vitest `offline.test.ts` |
| `dd4735c` | QA-D-17, D-18 | `minmax(0,1fr)` grids; long words wrap | TC-MTX overflow, TC-LST-04 |
| `0ab3cf7` | QA-D-19 | Event context prefetched at login; truthful offline/error state | TC-OFF-06 |
| `3af511f` | QA-D-20 | Long unbroken names cannot widen Home/Dashboard/admin grids | TC-LST-07 |
| `5e65018` | QA-D-09 | Select chevron uses accessible muted colour | axe |

## QA tooling (no product behaviour)
- `95f380f`, `885eac6`, `abf1f05` and later `qa:` commits: isolated QA stack (`qa/scripts/qa-stack.sh`), synthetic
  personas (`seed_qa`), Playwright QA suite (`frontend/qa-e2e/`, `frontend/qa.config.ts`), backend audit suite,
  report generators, baseline/after evidence.
- Harness incidents and test-only corrections are listed in `qa/results/HARNESS-NOTES.md` (H-01..H-03).

## Not changed (residual risks, see SECURITY-RELIABILITY-REPORT.fa.md §4)
QA-R-01..R-06.
