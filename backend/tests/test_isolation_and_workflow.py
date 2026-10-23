"""Event isolation, row/field-level authorization, referral + qualification + enrichment workflow (§22.8 C–F)."""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.common.models import AuditLog
from apps.crm.models import Activity, Interaction, Opportunity, Referral, Task

from .conftest import client_for

pytestmark = pytest.mark.django_db


def ids(resp):
    return {r["id"] for r in resp.data["results"]}


def test_event_a_data_never_leaks_to_event_b_users(world, capture):
    e_lead = capture(world.specialist).data["id"]
    f_lead = capture(world.spec_f, event=world.f, products=[world.z]).data["id"]
    # Event F specialist sees only their own.
    resp = client_for(world.spec_f).get("/api/v1/interactions")
    assert ids(resp) == {f_lead}
    assert client_for(world.spec_f).get(f"/api/v1/interactions/{e_lead}").status_code == 404
    # Guessing an ID or event filter does not help.
    assert ids(client_for(world.spec_f).get(f"/api/v1/interactions?event_id={world.e.id}")) == set()
    # Outsider sees nothing.
    assert ids(client_for(world.outsider).get("/api/v1/interactions")) == set()
    assert client_for(world.outsider).get(f"/api/v1/interactions/{e_lead}").status_code == 404


def test_specialist_sees_only_own_leads(world, capture):
    mine = capture(world.specialist).data["id"]
    other = capture(world.planmgr).data["id"]
    assert ids(client_for(world.specialist).get("/api/v1/interactions")) == {mine}
    assert client_for(world.specialist).get(f"/api/v1/interactions/{other}").status_code == 404


def test_product_scoped_owner_sees_only_their_products(world, capture):
    x_lead = capture(world.specialist, products=[world.x]).data["id"]
    y_lead = capture(world.specialist, products=[world.y], contact_name="دیگری").data["id"]
    visible = ids(client_for(world.owner).get("/api/v1/interactions"))
    assert x_lead in visible and y_lead not in visible


def test_global_viewers_see_all_events(world, capture):
    a = capture(world.specialist).data["id"]
    b = capture(world.spec_f, event=world.f, products=[world.z]).data["id"]
    for user in (world.dg, world.mdm, world.exec, world.admin):
        assert {a, b} <= ids(client_for(user).get("/api/v1/interactions"))


def test_executive_readonly_masked_pii_and_no_edit(world, capture):
    lead = capture(world.specialist).data
    detail = client_for(world.exec).get(f"/api/v1/interactions/{lead['id']}").data
    assert "•" in detail["contact"]["mobile"]
    assert detail["permissions"]["edit_detail"] is False
    resp = client_for(world.exec).patch(f"/api/v1/interactions/{lead['id']}/enrichment", {"contact": {"title": "x", "version": 1}}, format="json")
    assert resp.status_code == 403
    listing = client_for(world.exec).get("/api/v1/interactions").data["results"][0]
    assert "•" in listing["contact"]["mobile"]


def test_dg_sees_managerial_operations_but_not_secrets(world, capture):
    lead = capture(world.specialist).data
    c = client_for(world.dg)
    assert c.get("/api/v1/dashboard").data["aggregate"] is not None
    assert c.post(f"/api/v1/interactions/{lead['id']}/refer", {"to_user_id": str(world.planmgr.id)}, format="json").status_code == 201
    assert c.get("/api/v1/notify/providers").status_code == 403
    assert c.post("/api/v1/notify/providers", {"adapter": "MOCK_SMS"}, format="json").status_code == 403
    assert c.post(f"/api/v1/users/{world.specialist.id}/reset-password").status_code == 403
    assert c.post("/api/v1/users", {"username": "x"}, format="json").status_code == 403
    assert c.get("/api/v1/audit").status_code == 403
    assert c.post("/api/v1/exports", {"format": "JSON"}, format="json").status_code == 201


def test_scenario_c_d_referral_qualification_enrichment(world, capture):
    lead = capture(world.specialist).data
    lid = lead["id"]
    admin, pm = client_for(world.admin), client_for(world.planmgr)
    # C: admin assigns to plan manager for qualification.
    r = admin.post(f"/api/v1/interactions/{lid}/refer", {"to_user_id": str(world.planmgr.id), "purpose": "QUALIFICATION", "reason": "ارزیابی"}, format="json")
    assert r.status_code == 201
    inbox = pm.get("/api/v1/referrals?box=incoming").data["results"]
    assert [x["id"] for x in inbox] == [r.data["id"]]
    assert inbox[0]["due_at"] is not None  # event SLA applied
    # Manual action request stays open until explicit completion (notification ≠ action).
    camp = admin.post("/api/v1/campaigns", {"kind": "ACTION_REQUEST", "subject": "بررسی لید", "body": "لطفاً بررسی شود",
                                            "action_type": "REVIEW", "targeting": {"user_ids": [str(world.planmgr.id)]},
                                            "related_interaction_id": lid}, format="json")
    assert camp.status_code == 201, camp.data
    actions = pm.get("/api/v1/action-requests").data["results"]
    assert len(actions) == 1 and actions[0]["status"] == "OPEN"
    notifs = pm.get("/api/v1/notifications").data["results"]
    n = next(n for n in notifs if n["kind"] == "ACTION_REQUEST")
    pm.post(f"/api/v1/notifications/{n['id']}/read")
    assert pm.get("/api/v1/action-requests").data["results"][0]["status"] == "OPEN"
    # D: accept, qualify, enrich, assign follow-up to product owner.
    assert pm.post(f"/api/v1/referrals/{r.data['id']}/accept").status_code == 200
    q = pm.post(f"/api/v1/interactions/{lid}/qualify", {"business_problem": "نیاز پایش", "urgency": "HIGH"}, format="json")
    assert q.status_code == 201, q.data
    opp = q.data["opportunity"]
    assert opp["owner"]["id"] == str(world.planmgr.id) and opp["stage"] == "ASSIGNED"
    e = pm.patch(f"/api/v1/interactions/{lid}/enrichment", {
        "account": {"industry": "حمل‌ونقل", "city": "تهران", "website": "example.com", "version": q.data["account"]["version"]},
        "contact": {"title": "مدیر فناوری", "email": "cto@example.com", "version": q.data["contact"]["version"]},
        "qualification": {"next_step": "ارسال پیشنهاد", "version": opp["version"]},
    }, format="json")
    assert e.status_code == 200, e.data
    assert e.data["account"]["website"] == "https://example.com"
    assert e.data["account"]["provenance"]["industry"]["by"] == str(world.planmgr.id)
    t = pm.post(f"/api/v1/interactions/{lid}/tasks", {"title": "تماس پیگیری", "owner_id": str(world.owner.id),
                                                       "due_at": (timezone.now() + timedelta(days=2)).isoformat()}, format="json")
    assert t.status_code == 201
    assert client_for(world.owner).get("/api/v1/tasks").data["results"][0]["id"] == t.data["id"]
    # Attribution stays separate and audit-stable.
    i = Interaction.objects.get(pk=lid)
    assert i.created_by_id == world.specialist.id
    assert i.opportunity.owner_id == world.planmgr.id
    ref = Referral.objects.get(pk=r.data["id"])
    assert ref.from_user_id == world.admin.id and ref.to_user_id == world.planmgr.id
    types = list(Activity.objects.filter(interaction=i).values_list("type", flat=True))
    for expected in ("CAPTURED", "REFERRAL_CREATED", "REFERRAL_ACCEPTED", "QUALIFIED", "ENRICHED", "TASK_CREATED"):
        assert expected in types
    enriched = Activity.objects.get(interaction=i, type="ENRICHED")
    assert enriched.actor_id == world.planmgr.id
    assert enriched.metadata["changes"]["contact"]["title"] == {"from": "", "to": "مدیر فناوری"}
    assert AuditLog.objects.filter(action="lead.enriched", actor=world.planmgr).exists()
    # Captured snapshot unchanged by enrichment.
    assert i.captured_contact_name == "مخاطب آزمون"


def test_scenario_e_closed_event_allows_post_event_work(world, capture):
    lid = capture(world.specialist).data["id"]
    world.e.status, world.e.closed_at = "CLOSED", timezone.now()
    world.e.save()
    assert capture(world.specialist).status_code == 422
    pm = client_for(world.planmgr)
    q = pm.post(f"/api/v1/interactions/{lid}/qualify", {}, format="json")
    assert q.status_code == 201
    e = pm.patch(f"/api/v1/interactions/{lid}/enrichment", {"qualification": {"next_step": "جلسه", "version": q.data["opportunity"]["version"]}}, format="json")
    assert e.status_code == 200
    assert pm.post(f"/api/v1/interactions/{lid}/tasks", {"title": "پیگیری"}, format="json").status_code == 201
    # Booth correction is no longer allowed after closure.
    detail = client_for(world.specialist).get(f"/api/v1/interactions/{lid}").data
    assert client_for(world.specialist).patch(f"/api/v1/interactions/{lid}", {"note": "x", "version": detail["version"]}, format="json").status_code == 422


def test_returned_referral_is_visible_and_reassignable(world, capture):
    lid = capture(world.specialist).data["id"]
    mdm = client_for(world.mdm)
    r = mdm.post(f"/api/v1/interactions/{lid}/refer", {"to_user_id": str(world.owner.id)}, format="json").data
    owner = client_for(world.owner)
    assert owner.post(f"/api/v1/referrals/{r['id']}/return", {"note": ""}, format="json").status_code == 400
    assert owner.post(f"/api/v1/referrals/{r['id']}/return", {"note": "خارج از حوزه"}, format="json").status_code == 200
    returned = mdm.get("/api/v1/referrals?box=returned").data["results"]
    assert returned[0]["id"] == r["id"] and returned[0]["response_note"] == "خارج از حوزه"
    r2 = mdm.post(f"/api/v1/interactions/{lid}/refer", {"to_user_id": str(world.planmgr.id)}, format="json")
    assert r2.status_code == 201


def test_reassignment_cancels_previous_pending_and_keeps_history(world, capture):
    lid = capture(world.specialist).data["id"]
    mdm = client_for(world.mdm)
    r1 = mdm.post(f"/api/v1/interactions/{lid}/refer", {"to_user_id": str(world.owner.id)}, format="json").data
    r2 = mdm.post(f"/api/v1/interactions/{lid}/refer", {"to_user_id": str(world.planmgr.id)}, format="json").data
    assert Referral.objects.get(pk=r1["id"]).status == "CANCELED"
    assert str(Referral.objects.get(pk=r1["id"]).replaced_by_id) == r2["id"]
    assert AuditLog.objects.filter(action="referral.reassigned").exists()
    # Only the current recipient may accept.
    assert client_for(world.owner).post(f"/api/v1/referrals/{r1['id']}/accept").status_code == 422
    assert client_for(world.specialist).post(f"/api/v1/referrals/{r2['id']}/accept").status_code == 404


def test_specialist_cannot_assign_or_qualify(world, capture):
    lid = capture(world.specialist).data["id"]
    c = client_for(world.specialist)
    assert c.post(f"/api/v1/interactions/{lid}/refer", {"to_user_id": str(world.planmgr.id)}, format="json").status_code == 403
    assert c.post(f"/api/v1/interactions/{lid}/qualify", {}, format="json").status_code == 403
    assert c.patch(f"/api/v1/interactions/{lid}/enrichment", {"contact": {"title": "x", "version": 1}}, format="json").status_code == 403
    # but can add a note to their own lead
    assert c.post(f"/api/v1/interactions/{lid}/activities", {"text": "تماس گرفتم", "kind": "CALL"}, format="json").status_code == 201


def test_referral_recipient_must_be_event_member(world, capture):
    lid = capture(world.specialist).data["id"]
    resp = client_for(world.mdm).post(f"/api/v1/interactions/{lid}/refer", {"to_user_id": str(world.spec_f.id)}, format="json")
    assert resp.status_code == 400


def test_stage_transitions_validated(world, capture):
    lid = capture(world.specialist).data["id"]
    pm = client_for(world.planmgr)
    opp = pm.post(f"/api/v1/interactions/{lid}/qualify", {}, format="json").data["opportunity"]
    bad = pm.post(f"/api/v1/opportunities/{opp['id']}/stage", {"stage": "QUALIFIED", "version": opp["version"]}, format="json")
    assert bad.status_code == 422
    ok = pm.post(f"/api/v1/opportunities/{opp['id']}/stage", {"stage": "WON", "version": opp["version"]}, format="json")
    assert ok.status_code == 200 and ok.data["opportunity"]["stage"] == "WON"
    assert Opportunity.objects.get(pk=opp["id"]).closed_at is not None
    stale = pm.post(f"/api/v1/opportunities/{opp['id']}/stage", {"stage": "FOLLOW_UP", "version": opp["version"]}, format="json")
    assert stale.status_code == 409


def test_task_completion_requires_explicit_action(world, capture):
    lid = capture(world.specialist).data["id"]
    pm = client_for(world.planmgr)
    t = pm.post(f"/api/v1/interactions/{lid}/tasks", {"title": "پیگیری", "owner_id": str(world.owner.id)}, format="json").data
    assert Task.objects.get(pk=t["id"]).status == "OPEN"
    assert client_for(world.specialist).post(f"/api/v1/tasks/{t['id']}/complete").status_code in (403, 404)
    done = client_for(world.owner).post(f"/api/v1/tasks/{t['id']}/complete", {"outcome": "انجام شد"}, format="json")
    assert done.status_code == 200 and done.data["status"] == "DONE"


def test_dashboard_metrics_are_scoped(world, capture):
    capture(world.specialist)
    capture(world.spec_f, event=world.f, products=[world.z])
    pm = client_for(world.planmgr).get("/api/v1/dashboard").data["aggregate"]
    assert pm["interactions"] == 1
    dg = client_for(world.dg).get("/api/v1/dashboard").data["aggregate"]
    assert dg["interactions"] == 2 and dg["unique_contacts"] == 1
    spec = client_for(world.specialist).get("/api/v1/dashboard").data
    assert spec["aggregate"] is None and spec["personal"]["my_captures_total"] == 1


def test_bulk_refer_requires_confirmation(world, capture):
    a = capture(world.specialist).data["id"]
    b = capture(world.specialist, contact_name="دوم").data["id"]
    mdm = client_for(world.mdm)
    body = {"interaction_ids": [a, b], "to_user_id": str(world.planmgr.id)}
    assert mdm.post("/api/v1/interactions/bulk-refer", body, format="json").status_code == 422
    resp = mdm.post("/api/v1/interactions/bulk-refer", {**body, "confirm": True}, format="json")
    assert [r["status"] for r in resp.data["results"]] == ["OK", "OK"]


def test_merge_and_revert_contacts(world, capture):
    capture(world.specialist, contact_name="رضا یک")
    capture(world.planmgr, contact_name="رضا  یك")  # same phone + normalized same name → same contact
    capture(world.planmgr, contact_name="مینا دو")  # same phone → candidate
    admin = client_for(world.admin)
    cands = admin.get("/api/v1/duplicates").data["results"]
    assert len(cands) == 1
    c = cands[0]
    survivor = c["existing"]["id"]
    resp = admin.post(f"/api/v1/duplicates/{c['id']}/merge", {"survivor_id": survivor}, format="json")
    assert resp.status_code == 200
    assert Interaction.objects.filter(contact_id=survivor).count() == 3
    merge_id = resp.data["merge_id"]
    assert admin.post(f"/api/v1/merges/{merge_id}/revert").status_code == 200
    assert Interaction.objects.filter(contact_id=survivor).count() == 2
    assert client_for(world.planmgr).get("/api/v1/duplicates").status_code == 403
