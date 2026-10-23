# Reproduction — exact commands and environment

Everything below was executed in the audit sandbox. Results are in `qa/baseline/` (before fixes) and `qa/results/` (runs).

## Environment (recorded at audit start)

| Item | Value |
|---|---|
| Audited commit | `c6a1c88de0c243015941a166b22211c500543d59` (branch `ccr-c989dc1b-w7didd`) |
| Audit branch | `qa/audit-c6a1c88` |
| OS / kernel | Linux 6.18 (container), 4 vCPU, 15 GiB RAM |
| Python / Django / DRF | 3.13.16 / 5.2.18 / 3.18.3 |
| Node | 22.22.0 |
| PostgreSQL | 16.15 (local, isolated database `expo_leads_qa`; pytest uses `test_expo_leads`) |
| Redis | 7.0.15 (available; used only for the Celery check) |
| Browsers | Chromium 1194 (Playwright 1.56.1) at `/opt/pw-browsers`. **WebKit and Firefox are not installed and `playwright install` is not permitted here → BLOCKED.** |
| Docker | CLI 29.9.1 present, **no daemon socket → Docker build BLOCKED** |
| Devices | Emulation only (viewport + touch + DPR). No physical phone/tablet was used. |

## 1. Isolated QA stack (never the dev database)

```bash
service postgresql start
su postgres -c "createdb -O expo expo_leads_qa"
qa/scripts/qa-stack.sh reseed     # migrate + seed_demo --reset + seed_qa  (QA database only)
qa/scripts/qa-stack.sh start      # API 127.0.0.1:8001 (LOGIN_THROTTLE=500/min) + UI :5174 proxying /api → :8001
```

`seed_qa` adds synthetic personas: `qa_dual` (two active events), `qa_nomember` (no membership), `qa_closed` (closed + archived events only), `qa_evmgr2` (event manager), and edge-case leads with very long and mixed-direction names. All demo users use the password `Demo@Expo1405`.

## 2. Baseline (before any fix)

```bash
cd backend && ../.venv/bin/python -m pytest -p no:cacheprovider            # → qa/baseline/pytest.txt
cd frontend && npx tsc -b && npx vitest run && npx vite build              # → qa/baseline/{typecheck,vitest,build}.txt
cd frontend && E2E_BASE_URL=http://localhost:5174 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test   # existing suite → qa/baseline/playwright-existing.txt
cd backend && ../.venv/bin/python -m pytest tests/test_qa_audit.py -rf     # QA backend audit → qa/baseline/pytest-qa-audit.txt
```

## 3. QA browser suite (6 Chromium projects)

```bash
cd frontend
QA_SHA=<commit> PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers QA_JSON=../qa/results/playwright-<label>.json \
  npx playwright test -c qa.config.ts > ../qa/results/playwright-<label>.log
python3 ../qa/scripts/report.py <label> <commit>
```

Projects: `desktop-1440` (1440×900), `desktop-1920` (1920×1080), `tablet-768` (768×1024, touch), `tablet-1024` (1024×768, touch), `mobile-390` (390×844, touch, DPR 2), `mobile-375` (375×667, touch, DPR 2). Locale `fa-IR`, timezone `Asia/Tehran`. Traces/videos are retained on failure under `qa/traces/`. Motion is disabled only at screenshot time (style injection), not during interaction.

## 4. Performance & background jobs

```bash
python3 qa/scripts/perf.py          # P50/P95 latency against the local dev server (NOT production numbers)
qa/scripts/celery-check.sh          # real Celery worker + Redis: outbox → job → mock delivery, no double send
```
