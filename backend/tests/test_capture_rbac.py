"""Universal capture (§21) and event integrity (§11, §22.4)."""
import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.crm.models import Interaction, SyncQuarantine

from .conftest import capture_payload, client_for

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("who", ["specialist", "planmgr", "owner", "dg", "mdm", "admin"])
def test_every_event_member_can_capture_regardless_of_role(world, capture, who):
    user = getattr(world, who)
    resp = capture(user)
    assert resp.status_code == 201, resp.data
    i = Interaction.objects.get(pk=resp.data["id"])
    assert i.event_id == world.e.id
    assert i.event_code == "E"
    assert i.created_by_id == user.id
    assert resp.data["created_by"]["id"] == str(user.id)
    assert resp.data["capture_status"] == "CREATED"


def test_senior_role_without_membership_is_denied(world, capture):
    # DG is not a member of F; a global title alone never authorizes capture.
    resp = capture(world.dg, event=world.f, products=[world.z])
    assert resp.status_code == 403
    resp = capture(world.exec)
    assert resp.status_code == 403


def test_closed_event_blocks_capture_even_for_admin(world, capture):
    world.e.status = "CLOSED"
    world.e.closed_at = timezone.now()
    world.e.save()
    for user in (world.admin, world.dg, world.specialist):
        resp = capture(user)
        assert resp.status_code == 422
        assert resp.data["code"] == "event_not_active"


def test_removed_membership_denies_capture(world, capture):
    m = world.specialist.memberships.get(event=world.e)
    m.status = "REMOVED"
    m.save()
    assert capture(world.specialist).status_code == 403


def test_product_not_offered_in_event_is_rejected(world, capture):
    resp = capture(world.dg, products=[world.z])
    assert resp.status_code == 400
    assert "product_ids" in resp.data


def test_required_fields(world):
    c = client_for(world.specialist)
    resp = c.post("/api/v1/interactions", {"event_id": str(world.e.id), "product_ids": []}, format="json")
    assert resp.status_code == 400
    assert {"contact_name", "mobile", "product_ids"} <= set(resp.data)
    resp = c.post("/api/v1/interactions", capture_payload(world.e, [world.x], mobile="12345"), format="json")
    assert resp.status_code == 400 and "mobile" in resp.data


def test_email_is_an_acceptable_contact_method(world, capture):
    resp = capture(world.specialist, mobile="", email="Person@Example.com")
    assert resp.status_code == 201
    assert Interaction.objects.get(pk=resp.data["id"]).contact.email == "person@example.com"


def test_client_cannot_spoof_creator_or_event_code(world, capture):
    resp = capture(world.specialist, created_by=str(world.admin.id), event_code="HACK")
    i = Interaction.objects.get(pk=resp.data["id"])
    assert i.created_by_id == world.specialist.id and i.event_code == "E"


def test_duplicate_retries_create_only_one_interaction(world):
    c = client_for(world.specialist)
    payload = capture_payload(world.e, [world.x])
    first = c.post("/api/v1/interactions", payload, format="json")
    second = c.post("/api/v1/interactions", payload, format="json")
    assert first.status_code == 201 and second.status_code == 200
    assert second.data["capture_status"] == "DUPLICATE"
    assert first.data["id"] == second.data["id"]
    assert Interaction.objects.filter(client_record_id=payload["client_record_id"]).count() == 1


def test_offline_sync_batch_is_idempotent(world):
    c = client_for(world.specialist)
    records = [capture_payload(world.e, [world.x], captured_at=(timezone.now() - timedelta(minutes=5)).isoformat()) for _ in range(3)]
    r1 = c.post("/api/v1/interactions/sync", {"records": records}, format="json")
    r2 = c.post("/api/v1/interactions/sync", {"records": records}, format="json")
    assert [r["status"] for r in r1.data["results"]] == ["CREATED"] * 3
    assert [r["status"] for r in r2.data["results"]] == ["DUPLICATE"] * 3
    assert Interaction.objects.filter(created_by=world.specialist).count() == 3
    assert all(i.captured_offline for i in Interaction.objects.filter(created_by=world.specialist))


def test_offline_capture_keeps_original_event_never_retagged(world):
    c = client_for(world.specialist)
    rec = capture_payload(world.e, [world.x], captured_at=timezone.now().isoformat())
    res = c.post("/api/v1/interactions/sync", {"records": [rec]}, format="json").data["results"][0]
    assert Interaction.objects.get(pk=res["interaction_id"]).event_id == world.e.id


def test_offline_capture_after_close_within_grace_is_accepted(world):
    captured = timezone.now() - timedelta(hours=2)
    world.e.status, world.e.closed_at, world.e.sync_grace_hours = "CLOSED", timezone.now() - timedelta(hours=1), 24
    world.e.save()
    rec = capture_payload(world.e, [world.x], captured_at=captured.isoformat())
    res = client_for(world.specialist).post("/api/v1/interactions/sync", {"records": [rec]}, format="json").data["results"][0]
    assert res["status"] == "CREATED"


def test_offline_capture_beyond_grace_is_quarantined_not_discarded(world):
    world.e.status, world.e.closed_at, world.e.sync_grace_hours = "CLOSED", timezone.now() - timedelta(hours=30), 24
    world.e.save()
    rec = capture_payload(world.e, [world.x], captured_at=(timezone.now() - timedelta(hours=31)).isoformat())
    c = client_for(world.specialist)
    res = c.post("/api/v1/interactions/sync", {"records": [rec]}, format="json").data["results"][0]
    assert res["status"] == "QUARANTINED" and res["reason"] == "EVENT_CLOSED_BEYOND_GRACE"
    # Retry is idempotent too.
    again = c.post("/api/v1/interactions/sync", {"records": [rec]}, format="json").data["results"][0]
    assert again["status"] == "QUARANTINED"
    assert SyncQuarantine.objects.count() == 1
    # Admin approves → interaction created on the ORIGINAL event.
    q = SyncQuarantine.objects.get()
    resp = client_for(world.admin).post(f"/api/v1/sync-quarantine/{q.id}/approve", {"note": "ok"}, format="json")
    assert resp.status_code == 200
    i = Interaction.objects.get(pk=resp.data["interaction_id"])
    assert i.event_id == world.e.id and i.created_by_id == world.specialist.id


def test_offline_capture_captured_after_closure_is_quarantined(world):
    world.e.status, world.e.closed_at = "CLOSED", timezone.now() - timedelta(hours=2)
    world.e.save()
    rec = capture_payload(world.e, [world.x], captured_at=(timezone.now() - timedelta(minutes=10)).isoformat())
    res = client_for(world.specialist).post("/api/v1/interactions/sync", {"records": [rec]}, format="json").data["results"][0]
    assert res["status"] == "QUARANTINED"


def test_future_timestamp_rejected(world):
    rec = capture_payload(world.e, [world.x], captured_at=(timezone.now() + timedelta(hours=2)).isoformat())
    res = client_for(world.specialist).post("/api/v1/interactions/sync", {"records": [rec]}, format="json").data["results"][0]
    assert res["status"] == "REJECTED"


def test_non_member_offline_sync_rejected(world):
    rec = capture_payload(world.e, [world.x], captured_at=timezone.now().isoformat())
    res = client_for(world.outsider).post("/api/v1/interactions/sync", {"records": [rec]}, format="json").data["results"][0]
    assert res["status"] == "REJECTED"


def test_multi_membership_keeps_combined_capabilities_without_switching(world, capture):
    from .conftest import member

    member(world.f, world.planmgr, ["BOOTH_SPECIALIST"])
    assert capture(world.planmgr).status_code == 201
    assert capture(world.planmgr, event=world.f, products=[world.z]).status_code == 201
    me = client_for(world.planmgr).get("/api/v1/auth/me").data
    assert {e["code"] for e in me["capture_events"]} == {"E", "F"}
    caps_e = me["authz"]["events"][str(world.e.id)]["capabilities"]
    assert "lead.assign" in caps_e and "interaction.create" in caps_e
    caps_f = me["authz"]["events"][str(world.f.id)]["capabilities"]
    assert "lead.assign" not in caps_f and "interaction.create" in caps_f


def test_capture_creates_contact_and_account_with_snapshot(world, capture):
    resp = capture(world.specialist, contact_name="  علي  كريمي ", org_name="شركت نمونه")
    i = Interaction.objects.get(pk=resp.data["id"])
    assert i.contact.full_name == "علی کریمی"
    assert i.account.name == "شرکت نمونه"
    assert i.captured_contact_name == "علی کریمی"
    assert i.contact.mobile == "+989121234567"


def test_exact_org_match_reuses_account_and_shared_phone_creates_candidate(world, capture):
    a = capture(world.specialist, contact_name="رضا یک", org_name="شرکت نمونه").data
    b = capture(world.planmgr, contact_name="مینا دو", org_name="شركت  نمونه").data
    assert a["account"]["id"] == b["account"]["id"]
    assert a["contact"]["id"] != b["contact"]["id"]  # same phone, different person: never merged
    from apps.crm.models import DuplicateCandidate

    assert DuplicateCandidate.objects.filter(match_type="EXACT_PHONE", status="OPEN").count() == 1


def test_same_person_same_phone_reuses_contact_across_events(world, capture):
    from .conftest import member

    member(world.f, world.specialist)
    a = capture(world.specialist, contact_name="سارا تست").data
    b = capture(world.specialist, event=world.f, products=[world.z], contact_name="سارا  تست").data
    assert a["contact"]["id"] == b["contact"]["id"]
    assert a["event"]["id"] != b["event"]["id"]


def test_default_owner_mapping_creates_pending_referral(world, capture):
    ep = world.e.event_products.get(product=world.x)
    ep.default_owner = world.owner
    ep.save()
    resp = capture(world.specialist)
    assert resp.data["referrals"][0]["to_user"]["id"] == str(world.owner.id)
    assert resp.data["referrals"][0]["status"] == "PENDING"


def test_creator_can_correct_capture_with_version(world, capture):
    data = capture(world.specialist).data
    c = client_for(world.specialist)
    ok = c.patch(f"/api/v1/interactions/{data['id']}", {"quality": "INTRO", "version": data["version"]}, format="json")
    assert ok.status_code == 200 and ok.data["quality"] == "INTRO"
    stale = c.patch(f"/api/v1/interactions/{data['id']}", {"quality": "SERIOUS", "version": data["version"]}, format="json")
    assert stale.status_code == 409
    other = client_for(world.planmgr).patch(f"/api/v1/interactions/{data['id']}", {"quality": "SERIOUS", "version": ok.data["version"]}, format="json")
    assert other.status_code == 403


def test_invalid_client_record_id(world):
    resp = client_for(world.specialist).post("/api/v1/interactions", capture_payload(world.e, [world.x], client_record_id="nope"), format="json")
    assert resp.status_code == 400


def test_unknown_event(world):
    resp = client_for(world.specialist).post("/api/v1/interactions", capture_payload(world.e, [world.x], event_id=str(uuid.uuid4())), format="json")
    assert resp.status_code == 404
