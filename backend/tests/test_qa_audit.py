"""Independent QA audit tests (Phase B/D). Each test is tagged with a QA case id.

The authorization matrix writes qa/results/API-AUTHZ-MATRIX.csv (persona × endpoint × expected × observed).
"""
import csv
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.crm.models import Interaction

from .conftest import PASSWORD, capture_payload, client_for, make_user

pytestmark = pytest.mark.django_db
TEHRAN = ZoneInfo("Asia/Tehran")
MATRIX_ROWS = []
MATRIX_FILE = Path(__file__).resolve().parents[2] / "qa" / "results" / "API-AUTHZ-MATRIX.csv"


@pytest.fixture
def leads(world, capture):
    e_lead = capture(world.specialist).data
    f_lead = capture(world.spec_f, event=world.f, products=[world.z], contact_name="فقط رویداد اف", mobile="09125556677").data
    return {"e": e_lead, "f": f_lead}


def _row(persona, endpoint, method, expected, status, case):
    allowed = status < 400 or status == 409  # 409 = version conflict AFTER authorization succeeded
    ok = allowed == (expected == "ALLOW")
    MATRIX_ROWS.append({"case": case, "persona": persona, "method": method, "endpoint": endpoint, "expected": expected,
                        "observed_status": status, "result": "PASS" if ok else "FAIL"})
    return ok


def _flush():
    MATRIX_FILE.parent.mkdir(parents=True, exist_ok=True)
    with MATRIX_FILE.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["case", "persona", "method", "endpoint", "expected", "observed_status", "result"])
        w.writeheader()
        w.writerows(MATRIX_ROWS)


# (case, method, path-template, body, {persona: expected}) — unspecified personas default to DENY.
SENSITIVE = [
    ("API-IDOR-01", "GET", "/api/v1/interactions/{f_id}", None, {"spec_f": "ALLOW", "admin": "ALLOW", "mdm": "ALLOW", "dg": "ALLOW", "exec": "ALLOW"}),
    ("API-IDOR-02", "GET", "/api/v1/interactions/{e_id}", None, {"specialist": "ALLOW", "planmgr": "ALLOW", "admin": "ALLOW", "mdm": "ALLOW", "dg": "ALLOW", "exec": "ALLOW", "owner": "ALLOW"}),
    ("API-IDOR-03", "PATCH", "/api/v1/interactions/{e_id}/enrichment", {"contact": {"title": "x", "version": 1}}, {"planmgr": "ALLOW", "admin": "ALLOW", "mdm": "ALLOW", "dg": "ALLOW", "owner": "ALLOW"}),
    ("API-REF-01", "POST", "/api/v1/interactions/{e_id}/refer", {"to_user_id": "{planmgr_id}"}, {"planmgr": "ALLOW", "admin": "ALLOW", "mdm": "ALLOW", "dg": "ALLOW"}),
    ("API-TAG-01", "POST", "/api/v1/tags", {"name_fa": "برچسب {persona}", "color": "blue"}, {"admin": "ALLOW", "mdm": "ALLOW"}),
    ("API-EXP-01", "POST", "/api/v1/exports", {"format": "JSON", "datasets": ["accounts"]}, {"admin": "ALLOW", "mdm": "ALLOW", "dg": "ALLOW", "planmgr": "ALLOW"}),
    ("API-EXP-02", "POST", "/api/v1/exports", {"format": "JSON", "datasets": ["accounts"], "filters": {"event_id": ["{f_event}"]}}, {"admin": "ALLOW", "mdm": "ALLOW", "dg": "ALLOW"}),
    ("API-USR-01", "POST", "/api/v1/users", {"username": "u_{persona}", "first_name": "a", "last_name": "b", "mobile": "09121110000"}, {"admin": "ALLOW"}),
    ("API-USR-02", "PATCH", "/api/v1/users/{outsider_id}", {"global_role_codes": ["EXECUTIVE_READONLY"], "version": 1}, {"admin": "ALLOW"}),
    ("API-USR-03", "POST", "/api/v1/users/{specialist_id}/reset-password", None, {"admin": "ALLOW"}),
    ("API-ROLE-01", "POST", "/api/v1/roles", {"code": "x-{persona}", "name_fa": "x", "scope": "GLOBAL", "capabilities": ["user.manage"]}, {"admin": "ALLOW"}),
    ("API-BRD-01", "PATCH", "/api/v1/branding", {"system_title": "عنوان"}, {"admin": "ALLOW", "mdm": "ALLOW"}),
    ("API-PRV-01", "GET", "/api/v1/notify/providers", None, {"admin": "ALLOW"}),
    ("API-PRV-02", "POST", "/api/v1/notify/providers", {"adapter": "MOCK_SMS", "name": "p-{persona}"}, {"admin": "ALLOW"}),
    ("API-RUL-01", "GET", "/api/v1/notify/rules", None, {"admin": "ALLOW", "mdm": "ALLOW"}),
    ("API-AUD-01", "GET", "/api/v1/audit", None, {"admin": "ALLOW", "mdm": "ALLOW"}),
    ("API-EVT-01", "POST", "/api/v1/events/{e_event}/members", {"user": "{outsider_id}"}, {"admin": "ALLOW", "mdm": "ALLOW"}),
    ("API-EVT-02", "POST", "/api/v1/events/{f_event}/members", {"user": "{outsider_id}"}, {"admin": "ALLOW", "mdm": "ALLOW"}),
    ("API-DUP-01", "GET", "/api/v1/duplicates", None, {"admin": "ALLOW", "mdm": "ALLOW"}),
    ("API-CMP-01", "POST", "/api/v1/campaigns/preview", {"kind": "INFORMATION", "subject": "s", "body": "b", "targeting": {"user_ids": ["{spec_f_id}"]}}, {"admin": "ALLOW", "mdm": "ALLOW", "dg": "ALLOW", "planmgr": "ALLOW"}),
]
PERSONAS = ["admin", "mdm", "dg", "exec", "planmgr", "owner", "specialist", "spec_f", "outsider"]


@pytest.mark.parametrize("case,method,path,body,expect", SENSITIVE, ids=[s[0] for s in SENSITIVE])
def test_api_authorization_matrix(world, leads, case, method, path, body, expect):
    ctx = {
        "e_id": leads["e"]["id"], "f_id": leads["f"]["id"], "e_event": world.e.id, "f_event": world.f.id,
        "planmgr_id": world.planmgr.id, "exec_id": world.exec.id, "specialist_id": world.specialist.id,
        "outsider_id": world.outsider.id, "spec_f_id": world.spec_f.id,
    }
    failures = []
    for persona in PERSONAS:
        user = getattr(world, persona)
        c = client_for(user)
        url = path.format(**ctx)
        data = None
        if body is not None:
            import json

            data = json.loads(json.dumps(body).replace("{persona}", persona).replace("{planmgr_id}", str(world.planmgr.id))
                              .replace("{f_event}", str(world.f.id)).replace("{outsider_id}", str(world.outsider.id))
                              .replace("{spec_f_id}", str(world.spec_f.id)))
            if case == "API-USR-02":
                data["version"] = world.outsider.__class__.objects.get(pk=world.outsider.pk).version
        resp = getattr(c, method.lower())(url, data, format="json")
        expected = expect.get(persona, "DENY")
        if not _row(persona, url.split("?")[0], method, expected, resp.status_code, case):
            failures.append(f"{persona}: expected {expected}, got {resp.status_code}")
    _flush()
    assert not failures, failures


RATES = {"login": "3/min", "password_forgot": "10/hour", "password_reset_token": "10/hour", "password_reset_ip": "300/hour"}


@pytest.fixture
def real_throttles():
    """DRF binds THROTTLE_RATES at import time, so patch the throttle base class directly."""
    from rest_framework.throttling import SimpleRateThrottle

    cache.clear()
    with mock.patch.object(SimpleRateThrottle, "THROTTLE_RATES", RATES):
        yield
    cache.clear()


def test_qa_auth_rate_limit_enforced(real_throttles):
    """TC-AUTH-03 (server): repeated failed logins from one client are throttled with HTTP 429."""
    make_user("throttled")
    c = APIClient()
    codes = [c.post("/api/v1/auth/login", {"username": "throttled", "password": "bad"}, format="json").status_code for _ in range(5)]
    assert codes[:3] == [400, 400, 400] and 429 in codes[3:]


def test_qa_rate_limit_distinguishes_clients_behind_reverse_proxy(real_throttles, settings):
    """QA-D-03: behind nginx every request has REMOTE_ADDR=proxy; clients must be told apart via X-Forwarded-For
    when the deployment declares one trusted proxy hop (NUM_PROXIES=1 as in infra/docker-compose.yml)."""
    settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "NUM_PROXIES": 1}
    make_user("proxyuser")
    a, b = APIClient(REMOTE_ADDR="172.18.0.5"), APIClient(REMOTE_ADDR="172.18.0.5")
    for _ in range(4):
        a.post("/api/v1/auth/login", {"username": "proxyuser", "password": "bad"}, format="json", HTTP_X_FORWARDED_FOR="203.0.113.10")
    r = b.post("/api/v1/auth/login", {"username": "proxyuser", "password": PASSWORD}, format="json", HTTP_X_FORWARDED_FOR="198.51.100.7")
    assert r.status_code == 200, "a different client behind the same proxy must not be locked out"


def test_qa_activation_link_check_not_blocked_by_other_users(real_throttles, world):
    """QA-D-02: opening/validating activation links of several users from one office IP must keep working."""
    from apps.iam.models import PasswordResetToken

    c = APIClient(REMOTE_ADDR="10.0.0.9")
    statuses = []
    for i in range(6):
        u = make_user(f"onboard{i}")
        _, raw = PasswordResetToken.issue(u, "ACTIVATION")
        statuses.append(c.get(f"/api/v1/auth/password/reset?token={raw}").status_code)
        statuses.append(c.post("/api/v1/auth/password/reset", {"token": raw, "password": "Onb0ard-Pass-2026!"}, format="json").status_code)
    assert 429 not in statuses, statuses


def test_qa_unauthenticated_api_returns_401(world):
    """QA-D-04: expired/missing session must be distinguishable (401) from forbidden (403) so the SPA can re-login."""
    r = APIClient().get("/api/v1/interactions")
    assert r.status_code == 401
    assert client_for(world.specialist).get("/api/v1/audit").status_code == 403


def test_qa_contact_search_does_not_leak_other_event_contacts(world, leads):
    """QA-D-01: a booth user of event F must not learn names of contacts captured only in event E."""
    from apps.crm.models import Contact

    e_contact = Contact.objects.get(pk=leads["e"]["contact"]["id"])
    c = client_for(world.spec_f)
    by_mobile = c.get(f"/api/v1/contacts/search?mobile={e_contact.mobile}").data
    by_name = c.get("/api/v1/contacts/search?q=مخاطب آزمون").data
    assert by_mobile == [] and by_name == [], (by_mobile, by_name)
    # The capturing side still gets suggestions for its own scope.
    own = client_for(world.planmgr).get(f"/api/v1/contacts/search?mobile={e_contact.mobile}").data
    assert own and own[0]["full_name"] == e_contact.full_name


def test_qa_personal_today_metric_uses_tehran_day(world, capture):
    """QA-D-05: 'my captures today' must follow the Asia/Tehran calendar day, not UTC."""
    lead = capture(world.specialist).data
    # 23:30 Tehran yesterday == 20:00 UTC; "now" is 01:00 Tehran today == 21:30 UTC (same UTC date!).
    now_tehran = datetime(2026, 10, 24, 1, 0, tzinfo=TEHRAN)
    Interaction.objects.filter(pk=lead["id"]).update(captured_at=datetime(2026, 10, 23, 23, 30, tzinfo=TEHRAN))
    with mock.patch("django.utils.timezone.now", return_value=now_tehran.astimezone(ZoneInfo("UTC"))):
        data = client_for(world.specialist).get("/api/v1/dashboard").data
    assert data["personal"]["my_captures_today"] == 0


def test_qa_date_filter_uses_tehran_day(world, capture):
    """QA-D-05b: date_from/date_to filters are Jalali/Tehran days in the UI; an 01:00 Tehran capture belongs to that day."""
    lead = capture(world.specialist).data
    Interaction.objects.filter(pk=lead["id"]).update(captured_at=datetime(2026, 10, 24, 1, 0, tzinfo=TEHRAN))  # 21:30 UTC on 23rd
    ids = [r["id"] for r in client_for(world.admin).get("/api/v1/interactions?date_from=2026-10-24&date_to=2026-10-24").data["results"]]
    assert lead["id"] in ids


def _count(client, url):
    with CaptureQueriesContext(connection) as ctx:
        assert client.get(url).status_code == 200
    return len(ctx.captured_queries)


@pytest.mark.parametrize("url,factory", [("/api/v1/users?page_size=100", "users"), ("/api/v1/interactions?page_size=100", "leads"),
                                         ("/api/v1/referrals?box=team&status=PENDING&page_size=100", "referrals"), ("/api/v1/plans", "plans")])
def test_qa_list_endpoints_have_no_n_plus_one(world, capture, url, factory):
    """QA-D-06: query count must not grow linearly with rows."""
    from apps.catalog.models import Plan

    c = client_for(world.admin)

    def grow(n):
        for i in range(n):
            if factory == "users":
                make_user(f"n1_{uuid.uuid4().hex[:6]}", ["EXECUTIVE_READONLY"])
            elif factory == "leads":
                capture(world.specialist, contact_name=f"n1 {uuid.uuid4().hex[:6]}", mobile=f"0912{uuid.uuid4().int % 10**7:07d}")
            elif factory == "referrals":
                lid = capture(world.specialist, contact_name=f"r {uuid.uuid4().hex[:6]}", mobile=f"0912{uuid.uuid4().int % 10**7:07d}").data["id"]
                client_for(world.mdm).post(f"/api/v1/interactions/{lid}/refer", {"to_user_id": str(world.planmgr.id)}, format="json")
            else:
                Plan.objects.create(code=f"P{uuid.uuid4().hex[:5]}", name_fa="طرح")

    grow(3)
    small = _count(c, url)
    grow(12)
    large = _count(c, url)
    assert large - small <= 2, f"{url}: {small} queries for small set vs {large} for +12 rows"


def test_qa_export_timestamps_and_selected_rows(world, capture):
    """TC-EXP-04: selected-row export honours ids filter and keeps UTC ISO timestamps."""
    a = capture(world.specialist).data["id"]
    capture(world.specialist, contact_name="دیگری").data
    c = client_for(world.admin)
    job = c.post("/api/v1/exports", {"format": "JSON", "datasets": ["fact_leads"], "filters": {"ids": [a]}}, format="json").data
    content = b"".join(c.get(job["download_url"]).streaming_content)
    import json

    rows = json.loads(content)["datasets"]["fact_leads"]
    assert [r["interaction_id"] for r in rows] == [a]
    assert rows[0]["captured_at"].endswith("+00:00")


def test_qa_mock_delivery_never_reported_as_delivered(world, capture):
    """TC-NTF-06 (server): the mock adapter path never yields DELIVERED/SENT in jobs or attempts."""
    from apps.notify.engine import process_outbox
    from apps.notify.models import DeliveryAttempt, NotificationJob, NotificationRule, NotificationTemplate

    t = NotificationTemplate.objects.create(code="q", name="q", channel="SMS", body="{{contact_name}}")
    NotificationRule.objects.create(name="q", trigger="referral.created", recipient_type="DIRECT_ASSIGNEE", channel="SMS", template=t)
    lid = capture(world.specialist).data["id"]
    client_for(world.mdm).post(f"/api/v1/interactions/{lid}/refer", {"to_user_id": str(world.planmgr.id)}, format="json")
    process_outbox()
    process_outbox()
    assert NotificationJob.objects.filter(channel="SMS").count() == 1
    assert not NotificationJob.objects.filter(channel="SMS", status__in=["SENT", "DELIVERED"]).exists()
    assert set(DeliveryAttempt.objects.values_list("status", flat=True)) == {"SIMULATED"}


def test_qa_password_hash_never_in_api(world):
    data = client_for(world.admin).get("/api/v1/users?page_size=100").content.decode()
    assert "pbkdf2" not in data and "md5$" not in data and "argon2" not in data and '"password"' not in data


def test_qa_csrf_enforced_for_session_clients(world):
    c = APIClient(enforce_csrf_checks=True)
    c.force_login(world.specialist)
    r = c.post("/api/v1/interactions", capture_payload(world.e, [world.x]), format="json")
    assert r.status_code == 403


def test_qa_session_cookie_flags(settings):
    assert settings.SESSION_COOKIE_HTTPONLY is True
    assert settings.SESSION_COOKIE_SAMESITE == "Lax"


def test_qa_timezone_storage_is_utc(world, capture):
    lead = capture(world.specialist).data
    assert Interaction.objects.get(pk=lead["id"]).captured_at.utcoffset() == timedelta(0)
    assert timezone.get_current_timezone_name() == "UTC"


def test_qa_deployment_declares_trusted_proxy_hop():
    """QA-D-03b: the Docker stack sits behind nginx, so the API must be told how many proxy hops to trust
    (otherwise throttling and audit IPs see only the proxy address)."""
    from django.conf import settings as dj

    compose = (Path(__file__).resolve().parents[2] / "infra" / "docker-compose.yml").read_text()
    assert "DJANGO_NUM_PROXIES" in compose, "compose must set DJANGO_NUM_PROXIES for the backend behind nginx"
    assert "NUM_PROXIES" in dj.REST_FRAMEWORK, "settings must map DJANGO_NUM_PROXIES into REST_FRAMEWORK.NUM_PROXIES"
