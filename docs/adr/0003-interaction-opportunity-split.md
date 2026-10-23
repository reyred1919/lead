# ADR-0003: Interaction vs opportunity, creator vs owner

**Status:** accepted

**Decision.** Booth capture creates an `Interaction` (event-bound, immutable `created_by`, immutable captured snapshot) linked to shared master `Account`/`Contact`. An `Opportunity` is created only by explicit qualification (1:1 source interaction, optional extra linked interactions). Referrals always reference the interaction (and the opportunity once one exists), so triage before qualification is possible. Ownership is `interaction.triage_owner` before qualification and `opportunity.owner` after. The creator is never overwritten.

**De-duplication.** Contacts use normalized `+98` mobiles. Exact phone + exact normalized name → the same contact is reused. Same phone with a different name → a new contact plus a `DuplicateCandidate` (shared office lines exist). Accounts: an exact normalized-name match is reused. Fuzzy matches are only suggested. Merges are admin-reviewed, audited and reversible (`merge_records.moved_refs`).
