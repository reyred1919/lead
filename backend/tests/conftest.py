"""Shared fixtures: builds acceptance scenario A (admin creates event E, plan P,
products X/Y; specialist, plan manager and Director General are assigned)."""
import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.catalog.models import Event, EventMembership, EventProduct, MembershipRole, Plan, Product
from apps.iam.models import GlobalRoleAssignment, Role, User
from apps.notify.models import NotificationProvider

PASSWORD = "Str0ng-Test-Pass!"


@pytest.fixture(autouse=True)
def _settings(settings, tmp_path):
    settings.CELERY_ENABLED = False
    settings.EXPORT_ROOT = tmp_path / "exports"
    settings.MEDIA_ROOT = tmp_path / "media"
    settings.DEMO_MODE = True
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
    settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": {"login": "1000/min", "password_reset": "1000/min"}}


def make_user(username, roles=(), **extra):
    defaults = {"first_name": username.title(), "last_name": "Test", "mobile": f"+98912{abs(hash(username)) % 10_000_000:07d}", "title": "tester"}
    defaults.update(extra)
    user = User.objects.create_user(username, PASSWORD, **defaults)
    for code in roles:
        GlobalRoleAssignment.objects.create(user=user, role=Role.objects.get(code=code))
    return user


def member(event, user, roles=(), products=(), plans=()):
    m = EventMembership.objects.create(event=event, user=user)
    for code in roles:
        MembershipRole.objects.create(membership=m, role=Role.objects.get(code=code))
    if products:
        m.allowed_products.set(products)
    if plans:
        m.allowed_plans.set(plans)
    return m


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class World:
    pass


@pytest.fixture
def world(db):
    w = World()
    now = timezone.now()
    w.admin = make_user("admin", ["SYSTEM_ADMIN"])
    w.mdm = make_user("mdm", ["MARKET_DEV_MANAGER"])
    w.dg = make_user("dg", ["DIRECTOR_GENERAL"])
    w.exec = make_user("execro", ["EXECUTIVE_READONLY"])
    w.specialist = make_user("spec")
    w.planmgr = make_user("planmgr")
    w.owner = make_user("powner")
    w.outsider = make_user("outsider")
    w.spec_f = make_user("specf")

    w.plan = Plan.objects.create(code="P", name_fa="طرح پی")
    w.plan2 = Plan.objects.create(code="P2", name_fa="طرح دو")
    w.x = Product.objects.create(code="X", name_fa="محصول ایکس", plan=w.plan)
    w.y = Product.objects.create(code="Y", name_fa="محصول وای", plan=w.plan)
    w.z = Product.objects.create(code="Z", name_fa="محصول زد", plan=w.plan2)

    w.e = Event.objects.create(code="E", display_name="رویداد ای", starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1),
                               status="ACTIVE", owner=w.mdm, referral_sla_hours=24)
    w.f = Event.objects.create(code="F", display_name="رویداد اف", starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1),
                               status="ACTIVE", owner=w.mdm)
    for p in (w.x, w.y):
        EventProduct.objects.create(event=w.e, product=p)
    EventProduct.objects.create(event=w.f, product=w.z)

    member(w.e, w.specialist, ["BOOTH_SPECIALIST"])
    member(w.e, w.planmgr, ["PLAN_MANAGER"], plans=[w.plan])
    member(w.e, w.owner, ["PRODUCT_OWNER"], products=[w.x])
    member(w.e, w.dg)
    member(w.e, w.mdm, ["EVENT_MANAGER"])
    member(w.e, w.admin)
    member(w.f, w.spec_f, ["BOOTH_SPECIALIST"])
    NotificationProvider.objects.create(name="mock sms", channel="SMS", adapter="MOCK_SMS", mode="MOCK", is_default=True)
    return w


def capture_payload(event, products, **extra):
    data = {
        "event_id": str(event.id),
        "client_record_id": str(uuid.uuid4()),
        "contact_name": "مخاطب آزمون",
        "mobile": "09121234567",
        "product_ids": [str(p.id) for p in products],
        "org_name": "شرکت آزمون",
        "quality": "SERIOUS",
        "note": "یادداشت",
    }
    data.update(extra)
    return data


@pytest.fixture
def capture(world):
    def _capture(user, event=None, products=None, **extra):
        event = event or world.e
        products = products if products is not None else [world.x]
        return client_for(user).post("/api/v1/interactions", capture_payload(event, products, **extra), format="json")

    return _capture
