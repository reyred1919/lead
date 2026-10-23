# Implementation plan and status

Baseline: *MCI Expo Leads Product Blueprint v1.4* (sections 22–23 take precedence). The approved Apple-inspired premium RTL direction was implemented directly, with no competing themes.

Legend: ✅ done end-to-end (UI + API + DB + permissions + tests) · 🟡 working but partial (gap stated) · ⛔ not implemented.

## Vertical slices (delivery order)

| Slice | Status | Notes |
|---|---|---|
| A. Auth, users, roles, events, plans, products, teams | ✅ | Session auth + CSRF, login throttling, activation/reset links (hashed, time-limited, single-use), mandatory normalized staff mobile, optimistic locking, archival instead of deletion, event lifecycle + clone |
| B. Universal quick capture + persistence | ✅ | One-page form with 6 fields, search-first organization/contact suggestions, event auto-attached and locked, idempotent `client_record_id`, last-3 captures, save-next loop |
| C. Triage / referral / work queue | ✅ | Referral inbox (incoming/accepted/outgoing/returned/overdue/team), accept/return with reason, reassignment history, event SLA, default owner from event-product mapping, bulk assignment with confirmation |
| D. Enrichment, qualification, tasks | ✅ | Sectioned progressive enrichment with per-field provenance and conflict handling, completeness indicator, explicit qualification, stage state machine, tasks |
| E. Reporting & exports | ✅ | Role-scoped dashboard with defined metrics; XLSX/CSV(BOM, ZIP)/JSON; normalized datasets + `fact_leads`; versioned dictionary; formula-injection defense; PII masking; owner-only expiring audited downloads |
| F. Notification & action center | ✅ | Outbox, rules (scope, delay, quiet hours, cooldown, retries/backoff, dead-letter), templates with allowlisted variables and preview, manual INFORMATION/ACTION_REQUEST with preview/recipient count/broad-send confirmation/scheduling, in-app inbox (read/unread/snooze/deep links), delivery logs, retry |
| G. SMS + SMTP adapters | 🟡 | MOCK adapters fully working. Generic HTTPS SMS adapter and SMTP adapter are implemented with connection tests, but **no live provider has been verified** — no credentials or organizational endpoints were supplied. Live mode stays locked until a real test send succeeds |
| H. Offline | ✅ | PWA app shell, encrypted IndexedDB queue, auto-sync, closure grace window, quarantine review, logout clearing; unit + browser tests |
| I. Branding & tags | ✅ | Logo upload with content validation, SVG rejection, re-encoding, history, placeholder logotype; tag taxonomy + price-label chip UI + combobox |
| J. Deployment | 🟡 | Dockerfiles, compose (Postgres, Redis, gunicorn, Celery worker + beat, nginx with CSP), backup/restore scripts. DB dump/restore round trip was verified locally; **the compose stack itself was not built in this environment (no Docker daemon)** |

## Remaining work (transparent list)

1. **OpenAPI fidelity.** `docs/openapi.yaml` lists all 113 operations and paths, but most request/response bodies are untyped because views are plain `APIView`s. Next step: add `@extend_schema` serializers per endpoint and validate the contract in CI.
2. **Live SMS/SMTP.** Needs an IT-approved provider, credentials, sender line/pattern and network allowlisting. Then: test connection → real test send → switch to LIVE. Provider-specific delivery-status mapping may need tuning.
3. **Privacy redaction workflow.** Authorized redaction/deletion of personal data (including old exports and backups) and a documented retention policy are not built yet; archival and export expiry are.
4. **Accessibility audit.** Labels, focus rings, 44px targets, keyboard comboboxes and status text + badges are implemented; no automated axe/contrast run or screen-reader pass yet.
5. **Saved filtered views, undo for recoverable actions, keyboard command palette** (§19 cross-cutting) are not implemented.
6. **Scheduled report e-mail** (§16, optional) is not implemented; exports are on-demand.
7. **Staff mobile/email verification** (OTP) before transactional SMS is not implemented; fields `mobile_verified_at` / `email_verified_at` exist.
8. **Celery path** is configured (`CELERY_ENABLED=true`) but tests and the demo run the in-process dispatcher; run a soak test with Redis before production.
9. **Official brand assets** (MCI logo, palette, Peyda font license) have not been supplied; a neutral, labeled placeholder is shown.
10. **Load / large-export testing** (async export path above `EXPORT_SYNC_ROW_LIMIT`) is not yet exercised at volume.
