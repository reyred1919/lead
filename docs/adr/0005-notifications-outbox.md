# ADR-0005: Provider-independent notifications through a transactional outbox

**Status:** accepted

**Decision.** Domain services write `outbox_events` in the same transaction (unique `correlation_id`). After commit, the outbox is processed either in-process (`CELERY_ENABLED=false`, the default for dev/tests) or by Celery workers + beat. The rule evaluator creates `notification_jobs` with a unique `dedup_key`; in-app notifications for referrals/tasks/action requests are built in, and admin rules add SMS/email/extra recipients with scope, delay, Tehran quiet hours, cooldown and retries. Adapters: `MOCK_SMS`, generic `HTTP_SMS` (HTTPS only, idempotency header, HMAC-signed webhook), `MOCK_EMAIL`, `SMTP` (STARTTLS/SSL only, sender-domain allowlist). No vendor is hard-coded.

Delivery honesty: mock attempts are recorded as `SIMULATED`; SMTP/HTTP acceptance is `SENT`, never `DELIVERED`; `LIVE` mode requires a successful test. Customer (lead) messaging is structurally impossible in this phase: jobs only target `users`. `ContactConsent` exists as a future extension point.
