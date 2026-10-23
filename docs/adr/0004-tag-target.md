# ADR-0004: Canonical tagging target is the opportunity

**Status:** accepted

**Decision.** Global tags (`tags`) are applied via `opportunity_tags`, not to interactions. An unqualified interaction cannot be tagged; the UI explains that tagging becomes available after qualification. A qualified opportunity is never created silently just to hold a tag. Archived tags stay on existing records but can't be newly applied. Tag add/remove is fine-grained (`POST/DELETE /opportunities/{id}/tags`) and requires object-level detail-edit rights.
