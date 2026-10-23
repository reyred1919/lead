# Domain state machines

All transitions are validated on the server. A notification (in-app, SMS or email) **never** changes any of these states; only an explicit user action does.

## Event — `events.status`

```
DRAFT ──► READY ──► ACTIVE ──► CLOSED ──► ARCHIVED
  ▲  ◄──────┘                    │  ▲          │
  └─ ARCHIVED ◄── (DRAFT/READY)  └──┘ reopen   └──► CLOSED (restore)
```

| From | Allowed to | Notes |
|---|---|---|
| DRAFT | READY, ARCHIVED | |
| READY | DRAFT, ACTIVE, ARCHIVED | ACTIVE requires ≥ 1 active event product |
| ACTIVE | CLOSED | sets `closed_at`; new booth capture stops |
| CLOSED | ACTIVE, ARCHIVED | reopen is audited |
| ARCHIVED | CLOSED | restore |

Closure policy: online capture is rejected (`422 event_not_active`). Offline captures are accepted only if `captured_at ≤ closed_at` **and** the sync arrives within `sync_grace_hours` of closure; otherwise they go to `sync_quarantine` for administrator review (approve → interaction created on the *original* event; reject → kept with reason). Enrichment, referrals, tasks and stage changes continue after closure.

## Interaction — `interactions.status`

`CAPTURED → REVIEWED` (set automatically on qualification) `→ ARCHIVED`. Captured snapshot fields are immutable.

## Opportunity — `opportunities.stage`

Created only by explicit qualification of an interaction (never by capture alone). Initial stage is `ASSIGNED` if an owner is set, otherwise `QUALIFIED`.

| From | Allowed to |
|---|---|
| QUALIFIED | ASSIGNED, FOLLOW_UP, NURTURE, WON, LOST |
| ASSIGNED | QUALIFIED, FOLLOW_UP, NURTURE, WON, LOST |
| FOLLOW_UP | ASSIGNED, NURTURE, WON, LOST |
| NURTURE | ASSIGNED, FOLLOW_UP, LOST |
| WON | FOLLOW_UP (reopen) |
| LOST | FOLLOW_UP, NURTURE |

`closed_at` is set on WON/LOST and cleared otherwise. Every change requires the current `version` (optimistic concurrency, `409` on conflict). `lead_quality` (SERIOUS/FOLLOW_UP/INTRO, on the interaction) is a separate dimension from the opportunity stage.

## Referral — `referrals.status`

| From | To | Actor |
|---|---|---|
| PENDING | ACCEPTED | recipient → becomes triage owner, or opportunity owner (stage QUALIFIED→ASSIGNED) |
| PENDING | RETURNED | recipient, reason required → appears in initiator's "returned" box, re-referrable |
| PENDING | CANCELED | initiator or `lead.assign` in scope; also automatically when a new referral replaces it (`replaced_by` set, event `referral.reassigned`) |

Accepted/returned/canceled referrals remain visible in history; `referral.overdue` is emitted once per due date when a PENDING referral passes `due_at`.

## Task — `tasks.status`

`OPEN → DONE` (owner or `task.manage`, optional outcome) · `OPEN → CANCELLED`. `task.due_soon` (≤ 24h) and `task.overdue` are emitted once per due date.

## Action request — `action_requests.status`

| From | Allowed to | Actor |
|---|---|---|
| OPEN | ACKNOWLEDGED, IN_PROGRESS, DONE, RETURNED, CANCELLED | assignee (CANCELLED: requester) |
| ACKNOWLEDGED | IN_PROGRESS, DONE, RETURNED, CANCELLED | |
| IN_PROGRESS | DONE, RETURNED, CANCELLED | |
| RETURNED | OPEN, CANCELLED | requester |
| DONE | IN_PROGRESS | assignee (reopen) |
| CANCELLED | — | |

RETURNED requires a note. Every transition writes an `action_completions` row.

## Notification job — `notification_jobs.status`

```
PENDING ─► PROCESSING ─► DELIVERED   (in-app)
                      ├► SENT        (provider accepted; delivery unproven)
                      ├► SIMULATED   (mock provider — nothing was sent)
                      ├► SKIPPED     (NO_PROVIDER / PROVIDER_NOT_LIVE / NO_ADDRESS / PREFERENCE_DISABLED / COOLDOWN)
                      └► FAILED ─(backoff 2^n min)─► PENDING … ─► DEAD (max attempts)
```

`SENT → DELIVERED` only on a signed provider webhook. Delivery attempts are recorded separately (`PENDING/SENT/DELIVERED/FAILED/UNKNOWN/SIMULATED`).

## Provider — `notification_providers.mode`

`DISABLED` · `MOCK` (workflow only, attempts = SIMULATED) · `CONFIGURED` (credentials stored; jobs skipped as PROVIDER_NOT_LIVE) · `LIVE` (allowed only after a successful connection test **and** a successful non-mock test send; any config/secret change drops back to CONFIGURED).

## Outbox — `outbox_events.status`

`PENDING → PROCESSED`, or `FAILED` (retried, up to 5 attempts) `→ DEAD`. `correlation_id` is unique, so re-emitting the same domain event is a no-op.
