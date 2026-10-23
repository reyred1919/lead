# ADR-0006: Offline booth capture

**Status:** accepted

**Decision.** A PWA (workbox app-shell cache; API responses are never cached by the service worker) plus an IndexedDB queue (`frontend/src/lib/offline.ts`). Payloads and cached identity/event context are encrypted with a per-user, non-extractable AES-GCM key. Each record carries `client_record_id` (idempotency key), `event_id`, product UUIDs, `captured_at` and the actor (via session). Sync uses `POST /interactions/sync`, which is idempotent on `(created_by, client_record_id)`, re-checks membership and closure policy, and returns CREATED / DUPLICATE / QUARANTINED / REJECTED per record. After a successful sync the payload is wiped locally. Logout clears the queue and keys after warning about unsynced records.

**Limitations.** Encryption at rest protects against casual reading of browser storage, not against malware running in the browser profile. Offline capture requires the user to have opened the app online at least once on that device so event/product context is cached.
