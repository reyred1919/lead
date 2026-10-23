# ADR-0002: Capability-based, additive, scoped authorization

**Status:** accepted

**Decision.** Authorization is expressed as capabilities (`apps/iam/capabilities.py`). Roles are bundles stored in the DB. A user's effective rights = global roles ∪ roles of each ACTIVE event membership (event-scoped, optionally limited to plans/products). `interaction.create` comes from any ACTIVE membership of an ACTIVE event and is never granted globally. Row-level visibility goes through one function (`crm/scoping.visible_interactions`) used by lists, details, dashboards and exports, so the same scope applies everywhere. Object-level grants (creator, assignee, owner, referral recipient, task owner) are evaluated per record. The UI's `can()` only hides buttons.

**Consequences.** The Director General is operational without being a superuser, and senior roles can't silently capture into unassigned or closed events. Adding a role requires no code change.
