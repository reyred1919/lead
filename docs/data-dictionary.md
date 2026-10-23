# Data dictionary

All primary keys are stable UUIDs; all timestamps are stored in PostgreSQL as UTC (`timestamptz`). Jalali dates are presentation-only. Machine status codes are uppercase English; Persian labels are presentation-only.

Privacy classes: **ID** identifier · **INTERNAL** business data · **PII** personal contact data (masked for users without `pii.view` in scope) · **FREE** free text written by staff (may contain personal data) · **SECRET** encrypted at rest, never returned by the API.

## 1. Database tables

### `users` (User)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `password` | CharField | no | SECRET |  |
| `last_login` | DateTimeField | yes | INTERNAL |  |
| `id` | UUIDField | no | ID |  |
| `username` | CharField | no | INTERNAL |  |
| `first_name` | CharField | no | INTERNAL |  |
| `last_name` | CharField | no | INTERNAL |  |
| `title` | CharField | no | INTERNAL |  |
| `mobile` | CharField | no | PII | Normalized +989XXXXXXXXX; internal notifications only |
| `mobile_verified_at` | DateTimeField | yes | INTERNAL |  |
| `email` | CharField | no | PII |  |
| `email_verified_at` | DateTimeField | yes | INTERNAL |  |
| `status` | CharField | no | INTERNAL | ACTIVE / SUSPENDED / ARCHIVED |
| `must_change_password` | BooleanField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `created_by_id` | FK → users | yes | ID |  |

### `roles` (Role)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `code` | SlugField | no | INTERNAL |  |
| `name_fa` | CharField | no | INTERNAL |  |
| `description` | TextField | no | FREE |  |
| `scope` | CharField | no | INTERNAL | GLOBAL / EVENT |
| `capabilities` | JSONField | no | INTERNAL |  |
| `is_system` | BooleanField | no | INTERNAL |  |
| `is_archived` | BooleanField | no | INTERNAL |  |

### `global_roles` (GlobalRoleAssignment)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `user_id` | FK → users | no | ID |  |
| `role_id` | FK → roles | no | ID |  |
| `granted_by_id` | FK → users | yes | ID |  |

### `password_reset_tokens` (PasswordResetToken)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `user_id` | FK → users | no | ID |  |
| `token_hash` | CharField | no | SECRET |  |
| `purpose` | CharField | no | INTERNAL | ACTIVATION / RESET |
| `expires_at` | DateTimeField | no | INTERNAL |  |
| `used_at` | DateTimeField | yes | INTERNAL |  |
| `issued_by_id` | FK → users | yes | ID |  |

### `plans` (Plan)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `code` | SlugField | no | INTERNAL | Immutable stable code |
| `name_fa` | CharField | no | INTERNAL |  |
| `name_en` | CharField | no | INTERNAL |  |
| `description` | TextField | no | FREE |  |
| `status` | CharField | no | INTERNAL | ACTIVE / ARCHIVED |

### `products` (Product)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `code` | SlugField | no | INTERNAL | Immutable stable code |
| `name_fa` | CharField | no | INTERNAL |  |
| `name_en` | CharField | no | INTERNAL |  |
| `description` | TextField | no | FREE |  |
| `plan_id` | FK → plans | yes | ID |  |
| `status` | CharField | no | INTERNAL | ACTIVE / ARCHIVED |

### `product_owners` (ProductOwner)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `product_id` | FK → products | no | ID |  |
| `user_id` | FK → users | no | ID |  |

### `events` (Event)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `code` | SlugField | no | INTERNAL | Immutable event code |
| `display_name` | CharField | no | INTERNAL |  |
| `description` | TextField | no | FREE |  |
| `city` | CharField | no | INTERNAL |  |
| `venue` | CharField | no | INTERNAL |  |
| `starts_at` | DateTimeField | no | INTERNAL |  |
| `ends_at` | DateTimeField | no | INTERNAL |  |
| `timezone` | CharField | no | INTERNAL |  |
| `status` | CharField | no | INTERNAL | DRAFT / READY / ACTIVE / CLOSED / ARCHIVED |
| `owner_id` | FK → users | yes | ID |  |
| `sync_grace_hours` | PositiveSmallIntegerField | no | INTERNAL | Offline captures synced within this window after closure are accepted |
| `referral_sla_hours` | PositiveSmallIntegerField | yes | INTERNAL |  |
| `activated_at` | DateTimeField | yes | INTERNAL |  |
| `closed_at` | DateTimeField | yes | INTERNAL |  |
| `archived_at` | DateTimeField | yes | INTERNAL |  |
| `cloned_from_id` | FK → events | yes | ID |  |
| `created_by_id` | FK → users | yes | ID |  |

### `event_products` (EventProduct)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `event_id` | FK → events | no | ID |  |
| `product_id` | FK → products | no | ID |  |
| `default_owner_id` | FK → users | yes | ID |  |
| `is_active` | BooleanField | no | INTERNAL |  |
| `sort_order` | PositiveSmallIntegerField | no | INTERNAL |  |

### `event_memberships` (EventMembership)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `event_id` | FK → events | no | ID |  |
| `user_id` | FK → users | no | ID |  |
| `status` | CharField | no | INTERNAL | ACTIVE / REMOVED |
| `joined_at` | DateTimeField | no | INTERNAL |  |
| `left_at` | DateTimeField | yes | INTERNAL |  |
| `added_by_id` | FK → users | yes | ID |  |

### `membership_roles` (MembershipRole)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `membership_id` | FK → event_memberships | no | ID |  |
| `role_id` | FK → roles | no | ID |  |

### `accounts` (Account)

Master organization record, shared across events.

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `name` | CharField | no | INTERNAL |  |
| `name_normalized` | CharField | no | PII |  |
| `official_name` | CharField | no | INTERNAL |  |
| `alt_name` | CharField | no | INTERNAL |  |
| `industry` | CharField | no | INTERNAL |  |
| `org_type` | CharField | no | INTERNAL |  |
| `city` | CharField | no | INTERNAL |  |
| `website` | CharField | no | INTERNAL |  |
| `legal_id` | CharField | no | ID |  |
| `status` | CharField | no | INTERNAL | ACTIVE / MERGED / ARCHIVED |
| `merged_into_id` | FK → accounts | yes | ID |  |
| `provenance` | JSONField | no | INTERNAL | field -> {by, at, source} |
| `created_by_id` | FK → users | yes | ID |  |
| `updated_by_id` | FK → users | yes | ID |  |

### `contacts` (Contact)

Master person record. Mobile is normalized to +98 format for de-duplication.

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `full_name` | CharField | no | PII |  |
| `name_normalized` | CharField | no | PII |  |
| `mobile` | CharField | no | PII |  |
| `mobile_raw` | CharField | no | PII |  |
| `email` | CharField | no | PII |  |
| `title` | CharField | no | INTERNAL |  |
| `alt_phone` | CharField | no | PII |  |
| `primary_account_id` | FK → accounts | yes | ID |  |
| `contact_preference` | CharField | no | INTERNAL |  |
| `status` | CharField | no | INTERNAL | ACTIVE / MERGED / ARCHIVED |
| `merged_into_id` | FK → contacts | yes | ID |  |
| `provenance` | JSONField | no | INTERNAL |  |
| `created_by_id` | FK → users | yes | ID |  |
| `updated_by_id` | FK → users | yes | ID |  |

### `contact_account_affiliations` (ContactAccountAffiliation)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `contact_id` | FK → contacts | no | ID |  |
| `account_id` | FK → accounts | no | ID |  |
| `role_title` | CharField | no | INTERNAL |  |
| `is_primary` | BooleanField | no | INTERNAL |  |
| `source` | CharField | no | INTERNAL |  |

### `contact_consents` (ContactConsent)

Future customer-messaging extension point. Customer sends are disabled in this phase.

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `contact_id` | FK → contacts | no | ID |  |
| `channel` | CharField | no | INTERNAL | SMS / EMAIL |
| `purpose` | CharField | no | INTERNAL |  |
| `status` | CharField | no | INTERNAL | GRANTED / WITHDRAWN / SUPPRESSED |
| `legal_basis` | CharField | no | INTERNAL |  |
| `source` | CharField | no | INTERNAL |  |
| `recorded_by_id` | FK → users | yes | ID |  |

### `interactions` (Interaction)

A booth conversation at a specific event. Captured fields are immutable snapshots.

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `event_id` | FK → events | no | ID |  |
| `event_code` | CharField | no | INTERNAL |  |
| `created_by_id` | FK → users | no | ID |  |
| `captured_at` | DateTimeField | no | INTERNAL |  |
| `received_at` | DateTimeField | no | INTERNAL |  |
| `client_record_id` | UUIDField | no | ID |  |
| `captured_offline` | BooleanField | no | INTERNAL |  |
| `contact_id` | FK → contacts | no | ID |  |
| `account_id` | FK → accounts | yes | ID |  |
| `captured_contact_name` | CharField | no | PII |  |
| `captured_mobile` | CharField | no | PII |  |
| `captured_email` | CharField | no | PII |  |
| `captured_org_name` | CharField | no | INTERNAL |  |
| `quality` | CharField | no | INTERNAL | SERIOUS / FOLLOW_UP / INTRO |
| `note` | TextField | no | FREE |  |
| `status` | CharField | no | INTERNAL | CAPTURED / REVIEWED / ARCHIVED |
| `triage_owner_id` | FK → users | yes | ID |  |
| `updated_by_id` | FK → users | yes | ID |  |

### `interaction_products` (InteractionProduct)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `interaction_id` | FK → interactions | no | ID |  |
| `product_id` | FK → products | no | ID |  |
| `product_code` | CharField | no | INTERNAL |  |

### `opportunities` (Opportunity)

Follow-up-worthy commercial case, created only by explicit qualification.

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `source_interaction_id` | FK → interactions | no | ID |  |
| `origin_event_id` | FK → events | no | ID |  |
| `account_id` | FK → accounts | yes | ID |  |
| `contact_id` | FK → contacts | no | ID |  |
| `stage` | CharField | no | INTERNAL | QUALIFIED / ASSIGNED / FOLLOW_UP / WON / LOST / NURTURE |
| `owner_id` | FK → users | yes | ID |  |
| `qualified_by_id` | FK → users | yes | ID |  |
| `qualified_at` | DateTimeField | yes | INTERNAL |  |
| `business_problem` | TextField | no | FREE |  |
| `use_case` | TextField | no | FREE |  |
| `urgency` | CharField | no | INTERNAL | LOW / MEDIUM / HIGH |
| `decision_role` | CharField | no | INTERNAL |  |
| `stakeholders` | TextField | no | FREE |  |
| `size_estimate` | CharField | no | INTERNAL |  |
| `readiness` | CharField | no | INTERNAL |  |
| `blockers` | TextField | no | FREE |  |
| `next_step` | CharField | no | INTERNAL |  |
| `next_step_due_at` | DateTimeField | yes | INTERNAL |  |
| `outcome_note` | TextField | no | FREE |  |
| `closed_at` | DateTimeField | yes | INTERNAL |  |
| `provenance` | JSONField | no | INTERNAL |  |
| `updated_by_id` | FK → users | yes | ID |  |

### `opportunity_products` (OpportunityProduct)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `opportunity_id` | FK → opportunities | no | ID |  |
| `product_id` | FK → products | no | ID |  |

### `opportunity_collaborators` (OpportunityCollaborator)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `opportunity_id` | FK → opportunities | no | ID |  |
| `user_id` | FK → users | no | ID |  |
| `added_by_id` | FK → users | yes | ID |  |

### `referrals` (Referral)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `interaction_id` | FK → interactions | no | ID |  |
| `opportunity_id` | FK → opportunities | yes | ID |  |
| `event_id` | FK → events | no | ID |  |
| `purpose` | CharField | no | INTERNAL | QUALIFICATION / FOLLOW_UP |
| `from_user_id` | FK → users | no | ID |  |
| `to_user_id` | FK → users | no | ID |  |
| `reason` | TextField | no | FREE |  |
| `product_codes` | JSONField | no | INTERNAL |  |
| `status` | CharField | no | INTERNAL | PENDING / ACCEPTED / RETURNED / CANCELED |
| `due_at` | DateTimeField | yes | INTERNAL |  |
| `responded_at` | DateTimeField | yes | INTERNAL |  |
| `response_note` | TextField | no | FREE |  |
| `replaced_by_id` | FK → referrals | yes | ID |  |

### `activities` (Activity)

Append-only timeline of a lead.

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `interaction_id` | FK → interactions | no | ID |  |
| `opportunity_id` | FK → opportunities | yes | ID |  |
| `type` | CharField | no | INTERNAL | CAPTURED / CORRECTED / NOTE / CALL / MEETING / QUALIFIED / ENRICHED / STAGE_CHANGED / OWNER_CHANGED / REFERRAL_CREATED / REFERRAL_ACCEPTED / REFERRAL_RETURNED / REFERRAL_CANCELED / TASK_CREATED / TASK_COMPLETED / TAG_APPLIED / TAG_REMOVED / MERGED / STATUS_CHANGED |
| `actor_id` | FK → users | yes | ID |  |
| `notes` | TextField | no | FREE |  |
| `metadata` | JSONField | no | INTERNAL |  |
| `created_at` | DateTimeField | no | INTERNAL |  |

### `tasks` (Task)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `interaction_id` | FK → interactions | no | ID |  |
| `opportunity_id` | FK → opportunities | yes | ID |  |
| `title` | CharField | no | INTERNAL |  |
| `description` | TextField | no | FREE |  |
| `owner_id` | FK → users | no | ID |  |
| `created_by_id` | FK → users | no | ID |  |
| `due_at` | DateTimeField | yes | INTERNAL |  |
| `status` | CharField | no | INTERNAL | OPEN / DONE / CANCELLED |
| `outcome` | TextField | no | FREE |  |
| `completed_at` | DateTimeField | yes | INTERNAL |  |
| `completed_by_id` | FK → users | yes | ID |  |

### `tags` (Tag)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `code` | SlugField | no | INTERNAL |  |
| `name_fa` | CharField | no | INTERNAL |  |
| `name_en` | CharField | no | INTERNAL |  |
| `name_normalized` | CharField | no | PII |  |
| `description` | CharField | no | FREE |  |
| `color` | CharField | no | INTERNAL |  |
| `status` | CharField | no | INTERNAL | ACTIVE / ARCHIVED |
| `sort_order` | PositiveSmallIntegerField | no | INTERNAL |  |
| `created_by_id` | FK → users | yes | ID |  |

### `opportunity_tags` (OpportunityTag)

Canonical tagging target is the opportunity (qualified lead). See ADR-0004.

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `opportunity_id` | FK → opportunities | no | ID |  |
| `tag_id` | FK → tags | no | ID |  |
| `created_by_id` | FK → users | yes | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |

### `duplicate_candidates` (DuplicateCandidate)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `entity_type` | CharField | no | INTERNAL | CONTACT / ACCOUNT |
| `existing_id` | UUIDField | no | ID |  |
| `candidate_id` | UUIDField | no | ID |  |
| `match_type` | CharField | no | INTERNAL | EXACT_PHONE / EXACT_EMAIL / FUZZY_NAME |
| `score` | FloatField | no | INTERNAL |  |
| `status` | CharField | no | INTERNAL | OPEN / MERGED / DISMISSED |
| `resolved_by_id` | FK → users | yes | ID |  |
| `resolved_at` | DateTimeField | yes | INTERNAL |  |

### `merge_records` (MergeRecord)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `entity_type` | CharField | no | INTERNAL |  |
| `survivor_id` | UUIDField | no | ID |  |
| `merged_id` | UUIDField | no | ID |  |
| `moved_refs` | JSONField | no | INTERNAL | table -> [ids] moved to survivor; enables revert |
| `performed_by_id` | FK → users | yes | ID |  |
| `reverted_at` | DateTimeField | yes | INTERNAL |  |
| `reverted_by_id` | FK → users | yes | ID |  |

### `sync_quarantine` (SyncQuarantine)

Offline captures that could not be accepted automatically (e.g. event closed beyond grace).

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `event_id` | FK → events | no | ID |  |
| `user_id` | FK → users | no | ID |  |
| `client_record_id` | UUIDField | no | ID |  |
| `payload` | JSONField | no | INTERNAL |  |
| `reason` | CharField | no | FREE |  |
| `status` | CharField | no | INTERNAL | PENDING / APPROVED / REJECTED |
| `resolved_by_id` | FK → users | yes | ID |  |
| `resolved_at` | DateTimeField | yes | INTERNAL |  |
| `resolution_note` | TextField | no | INTERNAL |  |
| `interaction_id` | FK → interactions | yes | ID |  |

### `notification_providers` (NotificationProvider)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `name` | CharField | no | INTERNAL |  |
| `channel` | CharField | no | INTERNAL | SMS / EMAIL |
| `adapter` | CharField | no | INTERNAL | MOCK_SMS / HTTP_SMS / MOCK_EMAIL / SMTP |
| `mode` | CharField | no | INTERNAL | DISABLED / MOCK / CONFIGURED / LIVE |
| `config` | JSONField | no | INTERNAL | Non-secret settings only |
| `secret_encrypted` | TextField | no | SECRET |  |
| `is_default` | BooleanField | no | INTERNAL |  |
| `last_test_at` | DateTimeField | yes | INTERNAL |  |
| `last_test_ok` | BooleanField | yes | INTERNAL |  |
| `last_test_message` | CharField | no | INTERNAL |  |
| `live_verified_at` | DateTimeField | yes | INTERNAL |  |

### `provider_health_checks` (ProviderHealthCheck)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `provider_id` | FK → notification_providers | no | ID |  |
| `kind` | CharField | no | INTERNAL |  |
| `ok` | BooleanField | no | INTERNAL |  |
| `code` | CharField | no | INTERNAL |  |
| `message` | CharField | no | INTERNAL |  |
| `latency_ms` | PositiveIntegerField | yes | INTERNAL |  |
| `performed_by_id` | FK → users | yes | ID |  |

### `notification_templates` (NotificationTemplate)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `code` | SlugField | no | INTERNAL |  |
| `name` | CharField | no | INTERNAL |  |
| `channel` | CharField | no | INTERNAL | IN_APP / SMS / EMAIL |
| `subject` | CharField | no | INTERNAL |  |
| `body` | TextField | no | FREE | Plain text with {{variable}} placeholders (allowlisted) |
| `body_html` | TextField | no | INTERNAL |  |
| `locale` | CharField | no | INTERNAL |  |
| `is_active` | BooleanField | no | INTERNAL |  |

### `notification_rules` (NotificationRule)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `name` | CharField | no | INTERNAL |  |
| `trigger` | CharField | no | INTERNAL |  |
| `recipient_type` | CharField | no | INTERNAL | DIRECT_ASSIGNEE / INITIATOR / EVENT_OWNER / EVENT_ROLE |
| `recipient_role_id` | FK → roles | yes | ID |  |
| `event_id` | FK → events | yes | ID |  |
| `plan_id` | FK → plans | yes | ID |  |
| `product_id` | FK → products | yes | ID |  |
| `channel` | CharField | no | INTERNAL | IN_APP / SMS / EMAIL |
| `template_id` | FK → notification_templates | no | ID |  |
| `delay_minutes` | PositiveIntegerField | no | INTERNAL |  |
| `quiet_hours_enabled` | BooleanField | no | INTERNAL |  |
| `quiet_start` | TimeField | yes | INTERNAL |  |
| `quiet_end` | TimeField | yes | INTERNAL |  |
| `cooldown_minutes` | PositiveIntegerField | no | INTERNAL |  |
| `max_attempts` | PositiveSmallIntegerField | no | INTERNAL |  |
| `priority` | CharField | no | INTERNAL | LOW / NORMAL / HIGH / URGENT |
| `enabled` | BooleanField | no | INTERNAL |  |
| `created_by_id` | FK → users | yes | ID |  |

### `notification_campaigns` (NotificationCampaign)

Manually initiated message or action request (one-off or scheduled).

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `kind` | CharField | no | INTERNAL | INFORMATION / ACTION_REQUEST |
| `subject` | CharField | no | INTERNAL |  |
| `body` | TextField | no | FREE |  |
| `priority` | CharField | no | INTERNAL | LOW / NORMAL / HIGH / URGENT |
| `targeting` | JSONField | no | INTERNAL |  |
| `channels` | JSONField | no | INTERNAL |  |
| `action_type` | CharField | no | INTERNAL |  |
| `due_at` | DateTimeField | yes | INTERNAL |  |
| `related_interaction_id` | FK → interactions | yes | ID |  |
| `scheduled_at` | DateTimeField | yes | INTERNAL |  |
| `status` | CharField | no | INTERNAL | DRAFT / SCHEDULED / SENT / CANCELLED |
| `recipient_count` | PositiveIntegerField | no | INTERNAL |  |
| `idempotency_key` | CharField | no | INTERNAL |  |
| `created_by_id` | FK → users | no | ID |  |
| `sent_at` | DateTimeField | yes | INTERNAL |  |

### `notification_recipients` (NotificationRecipient)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `campaign_id` | FK → notification_campaigns | no | ID |  |
| `user_id` | FK → users | no | ID |  |

### `action_requests` (ActionRequest)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `version` | PositiveIntegerField | no | INTERNAL |  |
| `campaign_id` | FK → notification_campaigns | yes | ID |  |
| `assignee_id` | FK → users | no | ID |  |
| `requested_by_id` | FK → users | no | ID |  |
| `action_type` | CharField | no | INTERNAL | ACKNOWLEDGE / ACCEPT_REFERRAL / REVIEW / UPDATE_LEAD / CALL_CONTACT / SCHEDULE_MEETING / UPLOAD_REPORT / CUSTOM_ALLOWED |
| `subject` | CharField | no | INTERNAL |  |
| `instructions` | TextField | no | FREE |  |
| `related_interaction_id` | FK → interactions | yes | ID |  |
| `due_at` | DateTimeField | yes | INTERNAL |  |
| `status` | CharField | no | INTERNAL | OPEN / ACKNOWLEDGED / IN_PROGRESS / DONE / RETURNED / CANCELLED |
| `status_changed_at` | DateTimeField | no | INTERNAL |  |
| `priority` | CharField | no | INTERNAL | LOW / NORMAL / HIGH / URGENT |

### `action_completions` (ActionCompletion)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `action_request_id` | FK → action_requests | no | ID |  |
| `actor_id` | FK → users | yes | ID |  |
| `from_status` | CharField | no | INTERNAL |  |
| `to_status` | CharField | no | INTERNAL |  |
| `note` | TextField | no | FREE |  |

### `notification_preferences` (NotificationPreference)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `user_id` | FK → users | no | ID |  |
| `channel` | CharField | no | INTERNAL | IN_APP / SMS / EMAIL |
| `event_type` | CharField | no | INTERNAL |  |
| `enabled` | BooleanField | no | INTERNAL |  |

### `notification_jobs` (NotificationJob)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `source` | CharField | no | INTERNAL | RULE / CAMPAIGN / SYSTEM |
| `rule_id` | FK → notification_rules | yes | ID |  |
| `campaign_id` | FK → notification_campaigns | yes | ID |  |
| `outbox_event_id` | UUIDField | yes | ID |  |
| `event_type` | CharField | no | INTERNAL |  |
| `recipient_id` | FK → users | no | ID |  |
| `channel` | CharField | no | INTERNAL | IN_APP / SMS / EMAIL |
| `priority` | CharField | no | INTERNAL | LOW / NORMAL / HIGH / URGENT |
| `context` | JSONField | no | INTERNAL |  |
| `dedup_key` | CharField | no | INTERNAL |  |
| `status` | CharField | no | INTERNAL | PENDING / PROCESSING / SENT / DELIVERED / SIMULATED / FAILED / DEAD / SKIPPED |
| `scheduled_at` | DateTimeField | no | INTERNAL |  |
| `attempts` | PositiveSmallIntegerField | no | INTERNAL |  |
| `max_attempts` | PositiveSmallIntegerField | no | INTERNAL |  |
| `last_error` | CharField | no | INTERNAL |  |
| `skip_reason` | CharField | no | INTERNAL |  |
| `rendered_subject` | CharField | no | INTERNAL |  |
| `rendered_body` | TextField | no | INTERNAL |  |
| `completed_at` | DateTimeField | yes | INTERNAL |  |

### `notification_delivery_attempts` (DeliveryAttempt)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `job_id` | FK → notification_jobs | no | ID |  |
| `provider_id` | FK → notification_providers | yes | ID |  |
| `attempt_no` | PositiveSmallIntegerField | no | INTERNAL |  |
| `status` | CharField | no | INTERNAL | PENDING / SENT / DELIVERED / FAILED / UNKNOWN / SIMULATED |
| `is_mock` | BooleanField | no | INTERNAL |  |
| `provider_message_id` | CharField | no | ID |  |
| `reason_code` | CharField | no | INTERNAL |  |
| `response_summary` | CharField | no | INTERNAL |  |
| `cost` | DecimalField | yes | INTERNAL |  |
| `finished_at` | DateTimeField | yes | INTERNAL |  |

### `notifications` (Notification)

In-app inbox item. A notification never changes the state of a task or referral.

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `recipient_id` | FK → users | no | ID |  |
| `kind` | CharField | no | INTERNAL | INFORMATION / ACTION_REQUEST / SYSTEM_EVENT |
| `title` | CharField | no | INTERNAL |  |
| `body` | TextField | no | FREE |  |
| `priority` | CharField | no | INTERNAL | LOW / NORMAL / HIGH / URGENT |
| `link` | CharField | no | INTERNAL |  |
| `source_label` | CharField | no | INTERNAL |  |
| `event_type` | CharField | no | INTERNAL |  |
| `action_request_id` | FK → action_requests | yes | ID |  |
| `job_id` | FK → notification_jobs | yes | ID |  |
| `read_at` | DateTimeField | yes | INTERNAL |  |
| `snoozed_until` | DateTimeField | yes | INTERNAL |  |
| `created_at` | DateTimeField | no | INTERNAL |  |

### `data_exports` (DataExport)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `created_by_id` | FK → users | no | ID |  |
| `format` | CharField | no | INTERNAL | XLSX / CSV / JSON |
| `datasets` | JSONField | no | INTERNAL |  |
| `filters` | JSONField | no | INTERNAL |  |
| `status` | CharField | no | INTERNAL | QUEUED / RUNNING / READY / FAILED / EXPIRED |
| `row_counts` | JSONField | no | INTERNAL |  |
| `schema_version` | CharField | no | INTERNAL |  |
| `file_key` | CharField | no | INTERNAL |  |
| `file_name` | CharField | no | INTERNAL |  |
| `file_size` | PositiveBigIntegerField | yes | INTERNAL |  |
| `download_token` | CharField | no | INTERNAL |  |
| `expires_at` | DateTimeField | yes | INTERNAL |  |
| `completed_at` | DateTimeField | yes | INTERNAL |  |
| `downloaded_count` | PositiveIntegerField | no | INTERNAL |  |
| `error` | CharField | no | INTERNAL |  |
| `pii_masked` | BooleanField | no | INTERNAL |  |

### `brand_assets` (BrandAsset)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `created_at` | DateTimeField | no | INTERNAL |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |
| `variant` | CharField | no | INTERNAL | LIGHT / DARK |
| `original_filename` | CharField | no | INTERNAL | For audit only; never used as a path |
| `storage_key` | CharField | no | INTERNAL |  |
| `thumb_key` | CharField | no | INTERNAL |  |
| `mime` | CharField | no | INTERNAL |  |
| `checksum` | CharField | no | INTERNAL |  |
| `width` | PositiveIntegerField | no | INTERNAL |  |
| `height` | PositiveIntegerField | no | INTERNAL |  |
| `size` | PositiveIntegerField | no | INTERNAL |  |
| `is_active` | BooleanField | no | INTERNAL |  |
| `archived_at` | DateTimeField | yes | INTERNAL |  |
| `created_by_id` | FK → users | yes | ID |  |

### `brand_settings` (BrandSettings)

Singleton (pk=1) brand configuration; revision increments on every change for cache busting.

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | PositiveSmallIntegerField | no | ID |  |
| `system_title` | CharField | no | INTERNAL |  |
| `footer_label` | CharField | no | INTERNAL |  |
| `brand_label` | CharField | no | INTERNAL |  |
| `logo_alt` | CharField | no | INTERNAL |  |
| `logo_scale` | FloatField | no | INTERNAL |  |
| `light_asset_id` | FK → brand_assets | yes | ID |  |
| `dark_asset_id` | FK → brand_assets | yes | ID |  |
| `show_on_exports` | BooleanField | no | INTERNAL |  |
| `revision` | PositiveIntegerField | no | INTERNAL |  |
| `updated_by_id` | FK → users | yes | ID |  |
| `updated_at` | DateTimeField | no | INTERNAL |  |

### `audit_logs` (AuditLog)

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `actor_id` | FK → users | yes | ID |  |
| `action` | CharField | no | INTERNAL |  |
| `entity_type` | CharField | no | INTERNAL |  |
| `entity_id` | CharField | no | ID |  |
| `before` | JSONField | yes | INTERNAL |  |
| `after` | JSONField | yes | INTERNAL |  |
| `metadata` | JSONField | no | INTERNAL |  |
| `ip_address` | GenericIPAddressField | yes | INTERNAL |  |
| `created_at` | DateTimeField | no | INTERNAL |  |

### `outbox_events` (OutboxEvent)

Transactional outbox: written in the same transaction as the domain change.

| Column | Type | Null | Privacy | Notes |
|---|---|---|---|---|
| `id` | UUIDField | no | ID |  |
| `event_type` | CharField | no | INTERNAL |  |
| `schema_version` | PositiveSmallIntegerField | no | INTERNAL |  |
| `aggregate_type` | CharField | no | INTERNAL |  |
| `aggregate_id` | CharField | no | ID |  |
| `payload` | JSONField | no | INTERNAL |  |
| `correlation_id` | CharField | no | ID |  |
| `actor_id` | UUIDField | yes | ID |  |
| `status` | CharField | no | INTERNAL | PENDING / PROCESSED / FAILED / DEAD |
| `attempts` | PositiveSmallIntegerField | no | INTERNAL |  |
| `last_error` | TextField | no | INTERNAL |  |
| `occurred_at` | DateTimeField | no | INTERNAL |  |
| `processed_at` | DateTimeField | yes | INTERNAL |  |

## 2. Export schema (version 1.0)

Exports (XLSX sheet / CSV file / JSON key per dataset) carry a `metadata` block (schema version, generation time UTC, generator, filters, row counts, demo flag) and this dictionary. Every text cell in CSV/XLSX that begins with `= + - @ TAB CR LF | %` is prefixed with an apostrophe (formula-injection defense). JSON is unescaped. Multi-valued columns use `|` as separator.

### `accounts`

| Column | Description | Privacy |
|---|---|---|
| `account_id` | UUID سازمان | ID |
| `name` | نام نمایشی | INTERNAL |
| `official_name` | نام رسمی | INTERNAL |
| `alt_name` | نام جایگزین | INTERNAL |
| `industry` | صنعت | INTERNAL |
| `org_type` | نوع سازمان | INTERNAL |
| `city` | شهر | INTERNAL |
| `website` | وب‌سایت | INTERNAL |
| `legal_id` | شناسه حقوقی | INTERNAL |
| `status` | وضعیت (ACTIVE/MERGED/ARCHIVED) | INTERNAL |
| `merged_into_id` | UUID سازمان جایگزین در ادغام | ID |
| `created_at` | زمان ایجاد UTC | INTERNAL |
| `updated_at` | آخرین تغییر UTC | INTERNAL |

### `contacts`

| Column | Description | Privacy |
|---|---|---|
| `contact_id` | UUID مخاطب | ID |
| `full_name` | نام کامل | PII |
| `title` | سمت | INTERNAL |
| `mobile` | موبایل نرمال‌شده +98 | PII |
| `email` | ایمیل | PII |
| `alt_phone` | تلفن جایگزین | PII |
| `primary_account_id` | UUID سازمان اصلی | ID |
| `status` | وضعیت | INTERNAL |
| `merged_into_id` | UUID مخاطب جایگزین | ID |
| `created_at` | زمان ایجاد UTC | INTERNAL |
| `updated_at` | آخرین تغییر UTC | INTERNAL |

### `interactions`

| Column | Description | Privacy |
|---|---|---|
| `interaction_id` | UUID تعامل | ID |
| `event_id` | UUID رویداد | ID |
| `event_code` | کد تغییرناپذیر رویداد | INTERNAL |
| `created_by_id` | UUID ثبت‌کننده | ID |
| `created_by_name` | نام ثبت‌کننده | INTERNAL |
| `captured_at` | زمان ثبت UTC | INTERNAL |
| `captured_offline` | ثبت آفلاین | INTERNAL |
| `client_record_id` | کلید یکتای سمت کاربر (idempotency) | ID |
| `contact_id` | UUID مخاطب | ID |
| `account_id` | UUID سازمان | ID |
| `captured_contact_name` | نام واردشده در غرفه | PII |
| `captured_org_name` | نام سازمان واردشده در غرفه | INTERNAL |
| `quality` | کیفیت گفت‌وگو SERIOUS/FOLLOW_UP/INTRO | INTERNAL |
| `status` | وضعیت CAPTURED/REVIEWED/ARCHIVED | INTERNAL |
| `triage_owner_id` | UUID مسئول بررسی اولیه | ID |
| `note` | یادداشت غرفه | FREE |
| `updated_at` | آخرین تغییر UTC | INTERNAL |

### `interaction_products`

| Column | Description | Privacy |
|---|---|---|
| `interaction_id` | UUID تعامل | ID |
| `product_id` | UUID محصول | ID |
| `product_code` | کد پایدار محصول | INTERNAL |

### `opportunities`

| Column | Description | Privacy |
|---|---|---|
| `opportunity_id` | UUID فرصت | ID |
| `source_interaction_id` | UUID تعامل مبدأ | ID |
| `origin_event_id` | UUID رویداد مبدأ | ID |
| `account_id` | UUID سازمان | ID |
| `contact_id` | UUID مخاطب | ID |
| `stage` | مرحله QUALIFIED/ASSIGNED/FOLLOW_UP/WON/LOST/NURTURE | INTERNAL |
| `owner_id` | UUID مسئول پیگیری | ID |
| `owner_name` | نام مسئول پیگیری | INTERNAL |
| `qualified_by_id` | UUID ارزیاب | ID |
| `qualified_at` | زمان ارزیابی UTC | INTERNAL |
| `urgency` | فوریت LOW/MEDIUM/HIGH | INTERNAL |
| `business_problem` | مسئله کسب‌وکار | FREE |
| `use_case` | کاربرد | FREE |
| `next_step` | اقدام بعدی | FREE |
| `next_step_due_at` | موعد اقدام بعدی UTC | INTERNAL |
| `closed_at` | زمان بستن UTC | INTERNAL |
| `tag_codes` | کدهای برچسب (جداشده با |) | INTERNAL |
| `updated_at` | آخرین تغییر UTC | INTERNAL |

### `opportunity_tags`

| Column | Description | Privacy |
|---|---|---|
| `opportunity_id` | UUID فرصت | ID |
| `tag_id` | UUID برچسب | ID |
| `tag_code` | کد برچسب | INTERNAL |
| `tag_name_fa` | نام برچسب | INTERNAL |
| `tag_color` | توکن رنگ | INTERNAL |
| `tag_status` | وضعیت برچسب | INTERNAL |
| `applied_by_id` | UUID افزودن‌کننده | ID |
| `applied_at` | زمان افزودن UTC | INTERNAL |

### `referrals`

| Column | Description | Privacy |
|---|---|---|
| `referral_id` | UUID ارجاع | ID |
| `interaction_id` | UUID تعامل | ID |
| `opportunity_id` | UUID فرصت | ID |
| `event_id` | UUID رویداد | ID |
| `purpose` | هدف QUALIFICATION/FOLLOW_UP | INTERNAL |
| `from_user_id` | UUID ارجاع‌دهنده | ID |
| `to_user_id` | UUID گیرنده | ID |
| `status` | وضعیت PENDING/ACCEPTED/RETURNED/CANCELED | INTERNAL |
| `reason` | دلیل ارجاع | FREE |
| `response_note` | پاسخ گیرنده | FREE |
| `due_at` | مهلت UTC | INTERNAL |
| `responded_at` | زمان پاسخ UTC | INTERNAL |
| `created_at` | زمان ایجاد UTC | INTERNAL |

### `tasks`

| Column | Description | Privacy |
|---|---|---|
| `task_id` | UUID وظیفه | ID |
| `interaction_id` | UUID تعامل | ID |
| `opportunity_id` | UUID فرصت | ID |
| `title` | عنوان | FREE |
| `owner_id` | UUID مسئول | ID |
| `status` | OPEN/DONE/CANCELLED | INTERNAL |
| `due_at` | موعد UTC | INTERNAL |
| `completed_at` | زمان انجام UTC | INTERNAL |
| `outcome` | نتیجه | FREE |
| `created_at` | زمان ایجاد UTC | INTERNAL |

### `activities`

| Column | Description | Privacy |
|---|---|---|
| `activity_id` | UUID فعالیت | ID |
| `interaction_id` | UUID تعامل | ID |
| `opportunity_id` | UUID فرصت | ID |
| `type` | نوع فعالیت | INTERNAL |
| `actor_id` | UUID انجام‌دهنده | ID |
| `notes` | توضیح | FREE |
| `created_at` | زمان UTC | INTERNAL |

### `fact_leads`

| Column | Description | Privacy |
|---|---|---|
| `interaction_id` | UUID تعامل (کلید) | ID |
| `event_id` | UUID رویداد | ID |
| `event_code` | کد رویداد | INTERNAL |
| `event_name` | نام رویداد | INTERNAL |
| `captured_at` | زمان ثبت UTC | INTERNAL |
| `captured_date` | تاریخ ثبت (UTC) | INTERNAL |
| `created_by_id` | UUID ثبت‌کننده | ID |
| `created_by_name` | ثبت‌کننده | INTERNAL |
| `contact_id` | UUID مخاطب | ID |
| `contact_name` | نام مخاطب | PII |
| `contact_mobile` | موبایل مخاطب | PII |
| `account_id` | UUID سازمان | ID |
| `account_name` | سازمان | INTERNAL |
| `product_codes` | کد محصولات (|) | INTERNAL |
| `product_names` | نام محصولات (|) | INTERNAL |
| `product_count` | تعداد محصولات | INTERNAL |
| `quality` | کیفیت | INTERNAL |
| `interaction_status` | وضعیت تعامل | INTERNAL |
| `opportunity_id` | UUID فرصت | ID |
| `opportunity_stage` | مرحله فرصت | INTERNAL |
| `owner_id` | UUID مسئول پیگیری | ID |
| `owner_name` | مسئول پیگیری | INTERNAL |
| `tag_codes` | کد برچسب‌ها (|) | INTERNAL |
| `tag_labels` | برچسب‌ها (|) | INTERNAL |
| `open_tasks` | وظایف باز | INTERNAL |
| `done_tasks` | پیگیری‌های انجام‌شده | INTERNAL |
| `latest_referral_status` | وضعیت آخرین ارجاع | INTERNAL |
| `contact_event_count` | تعداد رویدادهای مخاطب (در محدوده) | INTERNAL |

## 3. Lineage, provenance and retention

- **Booth snapshot**: `interactions.captured_*` columns hold exactly what was typed at the booth and are never edited. Enrichment edits the master `accounts`/`contacts`/`opportunities` rows and records per-field provenance (`provenance` JSON: `{field: {by, at, source}}`) plus an `ENRICHED` activity with before/after values and an audit-log entry.
- **Merges** never delete rows: the merged record keeps its UUID with `status=MERGED`, `merged_into` points to the survivor, and `merge_records.moved_refs` lists every moved reference so the merge can be reverted.
- **Deletion**: referenced master data (events, products, plans, users, tags) is archived, not deleted. Audit logs and activities are append-only at the ORM level.
- **Retention / redaction** (policy to be confirmed by the organization): personal data in `contacts`, `interactions.captured_*` and free-text fields is subject to the organization's privacy policy. A dedicated redaction workflow (including purging backups/exports) is **not yet implemented** — see `implementation-plan.md`.
- **Exports** are written to `EXPORT_ROOT` under random keys and purged after `EXPORT_TTL_HOURS` (default 24h) by the scheduled `purge_expired_exports_task`.

