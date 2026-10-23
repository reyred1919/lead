"""QA personas and edge-case fixtures on top of seed_demo (synthetic only, DEMO_MODE required).

Adds:
  qa_dual      booth specialist with TWO active events (tech + energy)
  qa_nomember  active user with no event membership and no global role
  qa_closed    member only of a CLOSED event and an ARCHIVED event
  qa_evmgr2    event manager of the tech event (Event Manager persona on the main event)
and leads with very long and mixed-direction (Persian/English/digits) names.
"""
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.catalog.models import Event, EventMembership, EventProduct, MembershipRole
from apps.common.text import normalize_mobile
from apps.crm import services
from apps.iam.models import Role, User

from .seed_demo import DEMO_PASSWORD

QA_USERS = [
    ("qa_dual", "دونا", "دورویدادی", "کارشناس غرفه دو رویداد", "09120000101"),
    ("qa_nomember", "نیما", "بی‌عضویت", "کارشناس بدون رویداد", "09120000102"),
    ("qa_closed", "کاوه", "رویدادبسته", "کارشناس رویداد پایان‌یافته", "09120000103"),
    ("qa_evmgr2", "الناز", "مدیررویداد", "مدیر رویداد فناوری", "09120000104"),
]


class Command(BaseCommand):
    help = "Add QA personas and edge-case fixtures (synthetic, DEMO_MODE only)."

    def handle(self, *args, **opts):
        if not settings.DEMO_MODE:
            raise CommandError("seed_qa only runs with DEMO_MODE=true")
        if User.objects.filter(username="qa_dual").exists():
            self.stdout.write("QA fixtures already present.")
            return
        users = {}
        for username, first, last, title, mobile in QA_USERS:
            users[username] = User.objects.create_user(username, DEMO_PASSWORD, first_name=first, last_name=last, title=title,
                                                       mobile=normalize_mobile(mobile), email=f"{username}@demo.invalid")
        tech = Event.objects.get(code="DEMO-TECH-1405")
        energy = Event.objects.get(code="DEMO-ENERGY-1405")
        past = Event.objects.get(code="DEMO-EXPO-1404")
        now = timezone.now()
        archived = Event.objects.create(code="DEMO-OLD-1403", display_name="رویداد بایگانی‌شده نمونه", city="شیراز",
                                        starts_at=now - timedelta(days=400), ends_at=now - timedelta(days=397), status="ARCHIVED",
                                        closed_at=now - timedelta(days=396), archived_at=now - timedelta(days=300))
        EventProduct.objects.create(event=archived, product=past.event_products.first().product)

        def member(event, user, roles=()):
            m = EventMembership.objects.create(event=event, user=user)
            for code in roles:
                MembershipRole.objects.create(membership=m, role=Role.objects.get(code=code))

        member(tech, users["qa_dual"], ["BOOTH_SPECIALIST"])
        member(energy, users["qa_dual"], ["BOOTH_SPECIALIST"])
        member(past, users["qa_closed"], ["BOOTH_SPECIALIST"])
        member(archived, users["qa_closed"], ["BOOTH_SPECIALIST"])
        member(tech, users["qa_evmgr2"], ["EVENT_MANAGER"])

        product = tech.event_products.first().product
        edge_cases = [
            ("محمدحسین عبدالرحیم‌زاده‌ی خراسانی‌نژاد اصفهانی تهرانی (نام بسیار طولانی آزمونی)",
             "شرکت سهامی خاص توسعه و پشتیبانی راهکارهای هوشمند زیرساخت‌های ارتباطی و فناوری اطلاعات نمونه پارس (آزمونی)"),
            ("Sara Ahmadi — سارا احمدی", "ACME Iran (آکمه) Co. 2026"),
            ("علی ۱۲۳ Test", "شرکت 3D-Print ایران"),
        ]
        for i, (name, org) in enumerate(edge_cases):
            services.capture(users["qa_dual"], {
                "event_id": str(tech.id), "client_record_id": str(uuid.uuid4()), "contact_name": name,
                "mobile": f"0912000{300 + i:04d}", "org_name": org, "product_ids": [str(product.id)], "quality": "SERIOUS",
                "note": "رکورد آزمون لبه‌ای QA با متن مختلط Persian/English و ارقام ۱۲۳/123.",
            })
        self.stdout.write(self.style.SUCCESS("QA fixtures seeded: qa_dual, qa_nomember, qa_closed, qa_evmgr2 + edge-case leads"))
