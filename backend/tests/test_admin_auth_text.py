"""Scenario A + E (admin configuration without code changes), auth flows, normalization & bidi."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.catalog.models import Event
from apps.common.models import AuditLog
from apps.common.text import clean_display, mask_phone, normalize_mobile, normalize_search
from apps.iam.models import PasswordResetToken, User

from .conftest import PASSWORD, client_for

pytestmark = pytest.mark.django_db


def test_scenario_a_admin_configures_event_from_scratch(world, capture):
    admin = client_for(world.admin)
    plan = admin.post("/api/v1/plans", {"code": "pnew", "name_fa": "طرح جدید"}, format="json")
    assert plan.status_code == 201 and plan.data["code"] == "PNEW"
    px = admin.post("/api/v1/products", {"code": "nx", "name_fa": "محصول جدید ایکس", "name_en": "New X", "plan": plan.data["id"]}, format="json").data
    py = admin.post("/api/v1/products", {"code": "ny", "name_fa": "محصول جدید وای", "plan": plan.data["id"]}, format="json").data
    now = timezone.now()
    ev = admin.post("/api/v1/events", {"code": "g-2026", "display_name": "رویداد جی", "city": "تهران",
                                       "starts_at": now.isoformat(), "ends_at": (now + timedelta(days=3)).isoformat()}, format="json")
    assert ev.status_code == 201 and ev.data["status"] == "DRAFT"
    eid = ev.data["id"]
    # Activation needs products and a READY step.
    users = {}
    for uname, mobile in (("s1", "09121110001"), ("pm1", "۰۹۱۲۱۱۱۰۰۰۲"), ("dg1", "+98 912 111 0003")):
        r = admin.post("/api/v1/users", {"username": uname, "first_name": "نام", "last_name": uname, "mobile": mobile, "title": "سمت"}, format="json")
        assert r.status_code == 201, r.data
        assert r.data["mobile"].startswith("+98912111000")
        assert "demo_link" in r.data["activation"] and r.data["has_password"] is False
        users[uname] = r.data
    admin.patch(f"/api/v1/users/{users['dg1']['id']}", {"global_role_codes": ["DIRECTOR_GENERAL"], "version": users["dg1"]["version"]}, format="json")
    for p in (px, py):
        assert admin.post(f"/api/v1/events/{eid}/products", {"product": p["id"]}, format="json").status_code == 201
    admin.post(f"/api/v1/events/{eid}/members", {"user": users["s1"]["id"], "role_codes": ["BOOTH_SPECIALIST"]}, format="json")
    admin.post(f"/api/v1/events/{eid}/members", {"user": users["pm1"]["id"], "role_codes": ["PLAN_MANAGER"], "allowed_plan_ids": [plan.data["id"]]}, format="json")
    admin.post(f"/api/v1/events/{eid}/members", {"user": users["dg1"]["id"]}, format="json")
    detail = admin.get(f"/api/v1/events/{eid}").data
    assert admin.post(f"/api/v1/events/{eid}/transition", {"status": "ACTIVE", "version": detail["version"]}, format="json").status_code == 422
    r = admin.post(f"/api/v1/events/{eid}/transition", {"status": "READY", "version": detail["version"]}, format="json")
    r = admin.post(f"/api/v1/events/{eid}/transition", {"status": "ACTIVE", "version": r.data["version"]}, format="json")
    assert r.status_code == 200 and r.data["status"] == "ACTIVE"
    # B: each new user captures with products limited to X/Y.
    event = Event.objects.get(pk=eid)
    from apps.catalog.models import Product

    for uname in users:
        u = User.objects.get(username=uname)
        assert capture(u, event=event, products=[Product.objects.get(code="NX")], contact_name=f"لید {uname}").status_code == 201
        assert capture(u, event=event, products=[world.x]).status_code == 400
    mine = client_for(User.objects.get(username="s1")).get("/api/v1/events/mine").data
    assert [p["code"] for p in mine[0]["products"]] == ["NX", "NY"] or {p["code"] for p in mine[0]["products"]} == {"NX", "NY"}
    # E: clone to event F2 with different products; no leads copied.
    clone = admin.post(f"/api/v1/events/{eid}/clone", {"code": "h-2026", "display_name": "رویداد اچ", "include_members": True}, format="json")
    assert clone.status_code == 201 and clone.data["interaction_count"] == 0 and clone.data["member_count"] == 3
    assert clone.data["status"] == "DRAFT"


def test_event_code_immutable_and_version_conflict(world):
    admin = client_for(world.admin)
    d = admin.get(f"/api/v1/events/{world.e.id}").data
    assert admin.patch(f"/api/v1/events/{world.e.id}", {"code": "NEW", "version": d["version"]}, format="json").status_code == 400
    ok = admin.patch(f"/api/v1/events/{world.e.id}", {"display_name": "نام تازه", "version": d["version"]}, format="json")
    assert ok.status_code == 200
    assert admin.patch(f"/api/v1/events/{world.e.id}", {"display_name": "دیگر", "version": d["version"]}, format="json").status_code == 409
    assert admin.patch(f"/api/v1/events/{world.e.id}", {"display_name": "بدون نسخه"}, format="json").status_code == 400


def test_invalid_event_transition(world):
    admin = client_for(world.admin)
    d = admin.get(f"/api/v1/events/{world.e.id}").data
    assert admin.post(f"/api/v1/events/{world.e.id}/transition", {"status": "DRAFT", "version": d["version"]}, format="json").status_code == 422


def test_historical_leads_survive_archival(world, capture):
    lid = capture(world.specialist).data["id"]
    admin = client_for(world.admin)
    p = admin.get("/api/v1/products").data
    x = next(i for i in p if i["code"] == "X")
    assert admin.post(f"/api/v1/products/{x['id']}/archive", {"version": x["version"]}, format="json").status_code == 200
    u = admin.get(f"/api/v1/users/{world.specialist.id}").data
    assert admin.patch(f"/api/v1/users/{world.specialist.id}", {"status": "ARCHIVED", "version": u["version"]}, format="json").status_code == 200
    d = admin.get(f"/api/v1/events/{world.e.id}").data
    r = admin.post(f"/api/v1/events/{world.e.id}/transition", {"status": "CLOSED", "version": d["version"]}, format="json")
    admin.post(f"/api/v1/events/{world.e.id}/transition", {"status": "ARCHIVED", "version": r.data["version"]}, format="json")
    detail = client_for(world.mdm).get(f"/api/v1/interactions/{lid}").data
    assert detail["products"][0]["code"] == "X" and detail["created_by"]["id"] == str(world.specialist.id)
    # Removing membership keeps the global account and history.
    m = world.planmgr.memberships.get(event=world.e)
    admin.patch(f"/api/v1/events/{world.e.id}/members/{m.id}", {"status": "REMOVED"}, format="json")
    assert User.objects.filter(pk=world.planmgr.pk).exists()


def test_non_admin_cannot_manage_configuration(world):
    for user in (world.dg, world.specialist, world.exec):
        c = client_for(user)
        assert c.post("/api/v1/events", {"code": "X1"}, format="json").status_code == 403
        assert c.post("/api/v1/products", {"code": "X1"}, format="json").status_code == 403
        assert c.get(f"/api/v1/users/{world.admin.id}").status_code == 403
    # Event manager can manage the team of their own event only.
    em = client_for(world.mdm)
    assert em.post(f"/api/v1/events/{world.e.id}/members", {"user": str(world.outsider.id)}, format="json").status_code in (200, 201)
    from .conftest import member

    member(world.f, world.owner, ["EVENT_MANAGER"])
    own = client_for(world.owner)
    assert own.post(f"/api/v1/events/{world.f.id}/members", {"user": str(world.outsider.id)}, format="json").status_code == 201
    assert own.post(f"/api/v1/events/{world.e.id}/members", {"user": str(world.outsider.id)}, format="json").status_code == 403


def test_admin_cannot_read_passwords_and_user_payload_has_no_hash(world):
    data = client_for(world.admin).get(f"/api/v1/users/{world.specialist.id}").data
    assert "password" not in data and PASSWORD not in str(data)


def test_admin_cannot_lock_themselves_out(world):
    admin = client_for(world.admin)
    me = admin.get(f"/api/v1/users/{world.admin.id}").data
    assert admin.patch(f"/api/v1/users/{world.admin.id}", {"status": "SUSPENDED", "version": me["version"]}, format="json").status_code == 400
    assert admin.patch(f"/api/v1/users/{world.admin.id}", {"global_role_codes": [], "version": me["version"]}, format="json").status_code == 400


def test_mobile_is_mandatory_and_validated(world):
    admin = client_for(world.admin)
    r = admin.post("/api/v1/users", {"username": "nomobile", "first_name": "a", "last_name": "b"}, format="json")
    assert r.status_code == 400 and "mobile" in r.data
    r = admin.post("/api/v1/users", {"username": "badmobile", "first_name": "a", "last_name": "b", "mobile": "021-1234"}, format="json")
    assert r.status_code == 400
    r = admin.post("/api/v1/users", {"username": "Bad Name", "first_name": "a", "last_name": "b", "mobile": "09121234567"}, format="json")
    assert r.status_code == 400


def test_login_logout_and_csrf_enforced():
    from apps.iam.models import User as U

    U.objects.create_user("loginuser", PASSWORD, first_name="a", last_name="b", mobile="+989121112233")
    c = APIClient(enforce_csrf_checks=True)
    assert c.post("/api/v1/auth/login", {"username": "loginuser", "password": PASSWORD}, format="json").status_code == 403
    c.get("/api/v1/auth/csrf")
    token = c.cookies["csrftoken"].value
    bad = c.post("/api/v1/auth/login", {"username": "loginuser", "password": "nope"}, format="json", HTTP_X_CSRFTOKEN=token)
    assert bad.status_code == 400
    ok = c.post("/api/v1/auth/login", {"username": "LOGINUSER", "password": PASSWORD}, format="json", HTTP_X_CSRFTOKEN=token)
    assert ok.status_code == 200 and ok.data["user"]["username"] == "loginuser"
    assert c.get("/api/v1/auth/me").status_code == 200
    token = c.cookies["csrftoken"].value
    assert c.post("/api/v1/auth/logout", HTTP_X_CSRFTOKEN=token).status_code == 200
    assert c.get("/api/v1/auth/me").status_code == 403
    assert AuditLog.objects.filter(action="auth.login_failed").exists()


def test_suspended_user_cannot_login(world):
    world.specialist.status = "SUSPENDED"
    world.specialist.save()
    c = APIClient()
    assert c.post("/api/v1/auth/login", {"username": "spec", "password": PASSWORD}, format="json").status_code == 400


def test_activation_and_reset_flow_is_time_limited_and_single_use(world):
    token, raw = PasswordResetToken.issue(world.specialist, "RESET")
    c = APIClient()
    assert c.get(f"/api/v1/auth/password/reset?token={raw}").data["valid"] is True
    weak = c.post("/api/v1/auth/password/reset", {"token": raw, "password": "123"}, format="json")
    assert weak.status_code == 400
    assert c.post("/api/v1/auth/password/reset", {"token": raw, "password": "N3w-Secure-Pass!"}, format="json").status_code == 200
    assert c.post("/api/v1/auth/password/reset", {"token": raw, "password": "An0ther-Pass!!"}, format="json").status_code == 400
    world.specialist.refresh_from_db()
    assert world.specialist.check_password("N3w-Secure-Pass!")
    t2, raw2 = PasswordResetToken.issue(world.specialist, "RESET")
    PasswordResetToken.objects.filter(pk=t2.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
    assert c.get(f"/api/v1/auth/password/reset?token={raw2}").status_code == 400
    assert PasswordResetToken.objects.filter(token_hash=raw2).count() == 0  # only the hash is stored


def test_forgot_password_does_not_enumerate_and_never_logs_token(world):
    c = APIClient()
    a = c.post("/api/v1/auth/password/forgot", {"username": "spec"}, format="json")
    b = c.post("/api/v1/auth/password/forgot", {"username": "nobody"}, format="json")
    assert a.status_code == b.status_code == 200 and a.data == b.data
    from apps.notify.models import NotificationJob

    job = NotificationJob.objects.get(event_type="user.password_reset", channel="SMS")
    assert "[REDACTED]" in job.rendered_body and "token=" in job.rendered_body
    assert job.status == "SIMULATED"


def test_reset_link_issuance_requires_capability(world):
    assert client_for(world.mdm).post(f"/api/v1/users/{world.specialist.id}/reset-password").status_code == 403
    r = client_for(world.admin).post(f"/api/v1/users/{world.specialist.id}/reset-password")
    assert r.status_code == 200 and r.data["purpose"] == "RESET"


def test_audit_log_is_append_only(world):
    entry = AuditLog.objects.create(action="x", entity_type="y")
    with pytest.raises(ValueError):
        entry.save()
    with pytest.raises(ValueError):
        entry.delete()


# ---------------------------------------------------- Normalization ---

@pytest.mark.parametrize("raw,expected", [
    ("09121234567", "+989121234567"), ("۰۹۱۲۱۲۳۴۵۶۷", "+989121234567"), ("٠٩١٢١٢٣٤٥٦٧", "+989121234567"),
    ("+98 912 123 4567", "+989121234567"), ("00989121234567", "+989121234567"), ("9121234567", "+989121234567"),
    ("0912-123-4567", "+989121234567"), ("02112345678", None), ("12345", None), ("", None),
])
def test_iranian_mobile_normalization(raw, expected):
    assert normalize_mobile(raw) == expected


def test_persian_arabic_character_normalization():
    assert normalize_search("علي كريمي") == normalize_search("علی کریمی")
    assert normalize_search("مي‌خواهم") == normalize_search("می خواهم")
    assert normalize_search("سَلام") == "سلام"
    assert normalize_search("ABC شرکت") == "abc شرکت"
    assert clean_display("  شركت   نمونه ") == "شرکت نمونه"


def test_bidi_control_characters_are_stripped_from_display_values():
    spoofed = "شرکت‮abc‬"
    assert clean_display(spoofed) == "شرکتabc"


def test_mixed_script_names_round_trip_through_api(world, capture):
    name = "Dr. Sara Ahmadi — دکتر سارا احمدی"
    resp = capture(world.specialist, contact_name=name, org_name="MCI Labs (آزمایشگاه)")
    assert resp.data["contact"]["full_name"] == name
    assert resp.data["account"]["name"] == "MCI Labs (آزمایشگاه)"


def test_phone_masking():
    assert mask_phone("+989121234567") == "+98912••••567"
