# Acceptance scenarios → evidence

Backend tests live in `backend/tests/`, browser tests in `frontend/e2e/`, offline queue unit tests in `frontend/src/lib/offline.test.ts`. "Manual" means it was exercised in the running app and screenshotted (`docs/screenshots/`) but has no automated test.

| # | Scenario (blueprint §22.8 / §23.5) | Status | Evidence |
|---|---|---|---|
| A | Admin creates event, plan, products; 3 users with mobiles; assigns team and products | ✅ automated | `test_admin_auth_text.py::test_scenario_a_admin_configures_event_from_scratch` |
| B | Each role captures at E; event/code/creator auto-attached; products limited to the event | ✅ automated | `test_capture_rbac.py::test_every_event_member_can_capture_regardless_of_role` (6 roles), `test_product_not_offered_in_event_is_rejected`, `test_client_cannot_spoof_creator_or_event_code`; E2E `universal quick capture by specialist1/dg/admin` (desktop + mobile) |
| C | Admin refers to plan manager for qualification; appears in work queue; manual ACTION_REQUEST stays open until explicit completion | ✅ automated | `test_isolation_and_workflow.py::test_scenario_c_d_referral_qualification_enrichment`, `test_notifications.py::test_action_request_lifecycle_and_permissions` |
| D | Plan manager qualifies, enriches account/contact, assigns follow-up with due date; history attributes each change | ✅ automated | same test (activities, provenance, audit), E2E `referral → accept → qualify → tag` |
| E | Event closed: capture blocked, enrichment and follow-up continue; event F with a different team/products, no code change | ✅ automated | `test_scenario_e_closed_event_allows_post_event_work`, `test_closed_event_blocks_capture_even_for_admin`, clone in scenario A test |
| F | MDM exports selected E records and combined E/F analytics; cross-event history kept; unauthorized users see only their scope | ✅ automated | `test_exports_tags_branding.py::test_cross_event_contact_history_in_export`, `test_export_is_scoped_and_masks_pii`, `test_export_event_filter_outside_scope_denied` |
| G | MOCK SMS + MOCK SMTP, referral rule, logs; live sends disabled until configured | ✅ automated | `test_notifications.py` (SIMULATED never DELIVERED, CONFIGURED never sends, LIVE requires verification, secrets write-only) |
| H | Duplicate mobile, repeated submit, offline sync, unauthorized event read / export download | ✅ automated | `test_duplicate_retries_create_only_one_interaction`, `test_offline_sync_batch_is_idempotent`, quarantine tests, `test_event_a_data_never_leaks_to_event_b_users`, `test_export_download_requires_owner_and_token`; E2E `offline capture is queued and synced without duplicates`; `offline.test.ts` |
| I | Logo upload, preview, replace (old archived), malicious/invalid file rejected and audited | ✅ automated | `test_scenario_i_logo_upload_replace_reset`, `test_malicious_or_invalid_uploads_rejected_and_audited` (SVG/script, XML, executable header, corrupt PNG), `test_polyglot_payload_is_stripped_by_reencoding` |
| J | Tag created, recolored by another admin, archived tag persists on records but isn't selectable | ✅ automated | `test_tag_taxonomy_crud_and_archive`, `test_scenario_k_l_m_tag_permissions_and_history` |
| K | Plan manager adds/removes tags in scope; audited; tag filter respects scope | ✅ automated | `test_scenario_k_l_m_tag_permissions_and_history` |
| L | Booth specialist can't update tags even through the API | ✅ automated | same test |
| M | Executive viewer sees tags read-only; mobile wraps chips | ✅ automated (read-only) / manual (wrapping) | same test; E2E `mobile layout has no horizontal overflow` |
| N | Exports include tag ids/codes/labels/colors | ✅ automated | same test (`opportunity_tags` dataset, `fact_leads.tag_codes`) |
| O | Logo & tag UI keyboard/touch/focus/contrast/RTL | ⚠️ partial | Keyboard combobox, 44px targets and focus rings implemented; no automated axe/contrast audit yet |

## §21 required tests

| Requirement | Test |
|---|---|
| Parameterized capture by each role in an assigned active event | `test_every_event_member_can_capture_regardless_of_role[specialist,planmgr,owner,dg,mdm,admin]` |
| Multiple memberships keep combined capabilities without role switching | `test_multi_membership_keeps_combined_capabilities_without_switching` |
| Membership absent / event closed / product not in event denied even for senior roles | `test_senior_role_without_membership_is_denied`, `test_closed_event_blocks_capture_even_for_admin`, `test_removed_membership_denies_capture`, `test_product_not_offered_in_event_is_rejected` |
| DG sees managerial operations but no secrets / credentials | `test_dg_sees_managerial_operations_but_not_secrets` |
| Creator, owner, referral author, recipient separately attributable | assertions in `test_scenario_c_d_referral_qualification_enrichment` |

## §20.7 test themes

Permission boundaries ✅ · event isolation ✅ · notification idempotency ✅ (`test_outbox_processing_is_idempotent`, `test_campaign_idempotency_key`, `test_due_scan_is_idempotent`) · post-event edit rights ✅ · export formula injection ✅ (`test_safe_cell`, `test_export_formula_injection_defended_in_csv_and_xlsx`) · mail/SMS failure ✅ (`test_provider_failure_does_not_roll_back_referral_and_is_traced`, `test_adapter_crash_does_not_break_capture`) · text direction & mixed script ✅ (`test_bidi_control_characters_are_stripped_from_display_values`, `test_mixed_script_names_round_trip_through_api`, Persian/Arabic normalization tests, E2E `document is Persian RTL`).
