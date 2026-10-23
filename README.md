# MCI Expo Leads — سامانه لیدهای نمایشگاهی

An independent, multi-event, Persian RTL application for booth interaction capture, referral, follow-up, enrichment, analytics exports and internal notifications. It is built from *MCI Expo Leads Product Blueprint v1.4*.

> **Demo data is synthetic.** All names, phone numbers (`0912000xxxx`), organizations and products in the seed are fictional and marked **DEMO** in the UI. SMS and email run through **mock** providers: nothing is actually sent, and every such attempt is logged as `SIMULATED`.

## Repository layout

| Path | Contents |
|---|---|
| `backend/` | Django 5.2 + DRF API (`/api/v1`), PostgreSQL models and migrations, capability-based RBAC, outbox/notification engine, exports, branding, tests (`pytest`) |
| `frontend/` | React 19 + TypeScript + Vite + Tailwind 4 PWA (RTL), offline queue, Playwright E2E tests |
| `docs/` | implementation plan and status, state machines, permissions matrix, data dictionary, acceptance-scenario evidence, ADRs, `openapi.yaml`, screenshots |
| `infra/` | Docker Compose stack, `.env.example`, backup/restore scripts |

## Run locally

Prerequisites: Python 3.12+, Node 22, PostgreSQL 16 (Redis only if `CELERY_ENABLED=true`).

```bash
# database
createuser -P expo   # password: expo   (or set DATABASE_URL)
createdb -O expo expo_leads

# backend
python -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements.txt
cd backend
python manage.py migrate
python manage.py seed_demo --reset      # synthetic DEMO dataset
python manage.py runserver 127.0.0.1:8000

# frontend (second terminal)
cd frontend && npm ci && npm run dev    # http://localhost:5173 (proxies /api to :8000)
```

### Demo accounts (password `Demo@Expo1405`)

| Username | Role | What to try |
|---|---|---|
| `admin` | System Admin | Events, users, catalog, tags, branding, SMS/SMTP providers, audit |
| `mdm` | Market Development Manager (+ event manager of the tech event) | Dashboard, team referral queue, exports, duplicate review, messages |
| `dg` | Director General — operational, no secrets | Capture in two events, dashboard, referrals, exports |
| `planmgr` | Plan Manager (Smart City plan) | Incoming referrals, qualification, enrichment, tags |
| `owner` | Product Owner (Fleet Monitoring only) | Product-scoped view, returned referral |
| `specialist1` / `specialist2` | Booth Specialists | Mobile capture, offline queue, own leads |
| `specialist3`, `evmgr` | Energy event team | Event isolation |
| `exec` | Executive read-only | Masked phone numbers, no edit affordances |

## Tests

```bash
cd backend && pytest                    # 119 API/domain tests on PostgreSQL
cd frontend && npm test                 # offline queue unit tests (vitest)
cd frontend && npm run typecheck
# E2E: backend seeded + running on :8000 (LOGIN_THROTTLE=500/min recommended) and `npm run dev`
cd frontend && npx playwright test      # desktop 1440px + mobile 390px Chromium
```

See `docs/acceptance-scenarios.md` for how each blueprint scenario maps to a test.

## Deploy (Docker)

```bash
cd infra && cp .env.example .env   # fill in secrets; DEMO_MODE=false for production
docker compose up -d --build
docker compose exec backend python manage.py sync_roles
./backup.sh                        # pg_dump + uploaded brand assets
```

TLS terminates at your reverse proxy in front of the `web` service (nginx serves the PWA and proxies `/api`). Set `FIELD_ENCRYPTION_KEY` (Fernet) so provider secrets are encrypted at rest. Live SMS/email stays disabled until an administrator enters organization-approved credentials and a real test send succeeds.

## API

- Base path `/api/v1`, session cookie auth + CSRF header (`X-CSRFToken`).
- Contract: `GET /api/v1/schema` (OpenAPI 3) and `GET /api/v1/docs` (ReDoc); a snapshot is in `docs/openapi.yaml`. Request/response bodies are not yet fully typed — see the implementation plan.
- Pagination `?page=&page_size=`; stable UUIDs; UTC ISO-8601 timestamps; optimistic concurrency via the `version` field (`409` on conflict).

## What's implemented vs. pending

See `docs/implementation-plan.md`. In short, everything in the first deliverable works end-to-end. Pending items: live SMS/SMTP verification (no credentials supplied), typed OpenAPI bodies, a privacy redaction workflow, an automated accessibility audit, a Docker build in a real environment, and official brand assets.
