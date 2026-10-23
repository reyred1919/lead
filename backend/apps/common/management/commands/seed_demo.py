"""Seed a SYNTHETIC demo dataset. All names, phones and organizations are fictional.

    python manage.py seed_demo            # idempotent: skips if demo users exist
    python manage.py seed_demo --reset    # wipe business data first (DEMO_MODE only)
"""
import random
import uuid
from datetime import time, timedelta

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from apps.catalog.models import Event, EventMembership, EventProduct, MembershipRole, Plan, Product, ProductOwner
from apps.crm import services
from apps.crm.models import Interaction, Tag
from apps.iam.models import GlobalRoleAssignment, Role, User
from apps.notify.models import NotificationProvider, NotificationRule, NotificationTemplate

DEMO_PASSWORD = "Demo@Expo1405"

USERS = [
    # username, first, last, title, mobile, global roles
    ("admin", "مدیر", "سامانه", "مدیر سامانه — اداره توسعه بازار", "09120000001", ["SYSTEM_ADMIN"]),
    ("mdm", "مریم", "توسعه‌بازار", "مدیر توسعه بازار", "09120000002", ["MARKET_DEV_MANAGER"]),
    ("dg", "داود", "مدیرکل", "مدیرکل", "09120000003", ["DIRECTOR_GENERAL"]),
    ("exec", "الهام", "ناظر", "ناظر اجرایی (فقط‌خواندنی)", "09120000004", ["EXECUTIVE_READONLY"]),
    ("planmgr", "پرهام", "برنامه‌ریز", "مدیر طرح شهر هوشمند", "09120000005", []),
    ("owner", "اوستا", "محصول‌محور", "مالک محصول پایش ناوگان", "09120000006", []),
    ("specialist1", "سینا", "غرفه‌دار", "کارشناس غرفه", "09120000007", []),
    ("specialist2", "سمیرا", "غرفه‌دار", "کارشناس غرفه", "09120000008", []),
    ("specialist3", "سهیل", "انرژی‌پور", "کارشناس غرفه انرژی", "09120000009", []),
    ("evmgr", "ارغوان", "رویدادی", "مدیر رویداد انرژی", "09120000010", []),
]

PLANS = [("SMART-CITY", "شهر هوشمند", "Smart City"), ("SMART-ENERGY", "انرژی هوشمند", "Smart Energy"), ("IIOT", "اینترنت اشیای صنعتی", "Industrial IoT")]
PRODUCTS = [
    ("FLEET-MON", "پایش هوشمند ناوگان", "Fleet Monitoring", "SMART-CITY"),
    ("SMART-PARK", "پارکینگ هوشمند", "Smart Parking", "SMART-CITY"),
    ("CITY-LIGHT", "روشنایی هوشمند معابر", "Smart Street Lighting", "SMART-CITY"),
    ("AMI-METER", "کنتور هوشمند AMI", "AMI Smart Metering", "SMART-ENERGY"),
    ("EMS-CLOUD", "سامانه مدیریت انرژی ابری", "Cloud EMS", "SMART-ENERGY"),
    ("IIOT-GW", "دروازه IoT صنعتی", "Industrial IoT Gateway", "IIOT"),
    ("PRED-MAINT", "نگهداری پیش‌بینانه", "Predictive Maintenance", "IIOT"),
]
TAGS = [("strategic", "مشتری راهبردی", "Strategic account", "violet"), ("needs-demo", "نیازمند دمو", "Needs demo", "blue"),
        ("schedule-meeting", "جلسه هماهنگ شود", "Schedule meeting", "amber"), ("partnership", "فرصت مشارکت", "Partnership", "teal"),
        ("urgent-follow-up", "پیگیری فوری", "Urgent follow-up", "rose")]

FIRST = ["علی", "زهرا", "محمد", "فاطمه", "حسین", "مریم", "رضا", "نرگس", "امیر", "لیلا", "کاوه", "شیما", "بهرام", "نیلوفر", "آرش", "یاسمن"]
LAST = ["نمونه‌زاده", "آزمایشی", "فرضی‌پور", "مثالی", "نمونه‌وند", "تستی", "خیالی‌نژاد", "ساختگی", "الگویی", "پیش‌نمونه"]
ORGS = ["شرکت نمونه آلفا", "هلدینگ فرضی بتا", "شهرداری نمونه منطقه ۲", "گروه صنعتی گاما (نمونه)", "شرکت توزیع برق نمونه",
        "Delta Demo Industries", "پتروشیمی فرضی امگا", "بیمارستان نمونه سینا", "دانشگاه آزمایشی", "شرکت حمل‌ونقل نمونه"]
NOTES = ["به راهکار علاقه‌مند بود و درخواست ارائه داشت.", "نیاز به برآورد هزینه پایلوت دارد.", "در حال بررسی رقبا هستند.",
         "Interested in an API integration (demo note).", "پیگیری پس از نمایشگاه با واحد فنی.", ""]


class Command(BaseCommand):
    help = "Seed synthetic demo data (DEMO)."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true")

    def handle(self, *args, **opts):
        if not settings.DEMO_MODE:
            raise CommandError("seed_demo only runs with DEMO_MODE=true")
        call_command("sync_roles", verbosity=0)
        if opts["reset"]:
            self._reset()
        elif User.objects.filter(username="admin").exists():
            self.stdout.write("Demo data already present (use --reset to rebuild).")
            return
        rnd = random.Random(1405)
        with transaction.atomic():
            users = self._users()
            plans, products = self._catalog(users)
            events = self._events(users, products)
            self._tags(users["admin"])
            self._notify(users["admin"])
        self._leads(rnd, users, events, products)
        # Close the past event after its leads exist (capture is blocked after closure).
        past = events["past"]
        past.status, past.closed_at = "CLOSED", timezone.now() - timedelta(days=20)
        past.save()
        self.stdout.write(self.style.SUCCESS(
            f"DEMO seeded: {User.objects.count()} users, {Event.objects.count()} events, {Interaction.objects.count()} interactions. "
            f"Password for all demo users: {DEMO_PASSWORD}"
        ))

    def _reset(self):
        tables = [
            "notifications", "notification_delivery_attempts", "notification_jobs", "action_completions", "action_requests",
            "notification_recipients", "notification_campaigns", "notification_rules", "notification_templates", "provider_health_checks",
            "notification_providers", "notification_preferences", "opportunity_tags", "tags", "activities", "tasks", "referrals",
            "opportunity_collaborators", "opportunity_products", "opportunity_interactions", "opportunities", "interaction_products",
            "interactions", "sync_quarantine", "merge_records", "duplicate_candidates", "contact_consents", "contact_account_affiliations",
            "contacts", "accounts", "membership_roles", "membership_allowed_plans", "membership_allowed_products", "event_memberships",
            "event_products", "events", "product_owners", "products", "plans", "data_exports", "outbox_events", "audit_logs",
            "password_reset_tokens", "global_roles", "brand_settings", "brand_assets", "django_session", "users",
        ]
        with connection.cursor() as cur:
            cur.execute("TRUNCATE " + ", ".join(tables) + " CASCADE")

    def _users(self):
        out = {}
        for username, first, last, title, mobile, roles in USERS:
            from apps.common.text import normalize_mobile

            u = User.objects.create_user(username, DEMO_PASSWORD, first_name=first, last_name=last, title=title, mobile=normalize_mobile(mobile),
                                         email=f"{username}@demo.invalid")
            for code in roles:
                GlobalRoleAssignment.objects.create(user=u, role=Role.objects.get(code=code))
            out[username] = u
        return out

    def _catalog(self, users):
        plans = {code: Plan.objects.create(code=code, name_fa=fa, name_en=en, description="داده نمونه (DEMO)") for code, fa, en in PLANS}
        products = {}
        for code, fa, en, plan in PRODUCTS:
            products[code] = Product.objects.create(code=code, name_fa=fa, name_en=en, plan=plans[plan], description="محصول نمونه (DEMO)")
        ProductOwner.objects.create(product=products["FLEET-MON"], user=users["owner"])
        return plans, products

    def _member(self, event, user, roles=(), products=(), plans=()):
        m = EventMembership.objects.create(event=event, user=user)
        for code in roles:
            MembershipRole.objects.create(membership=m, role=Role.objects.get(code=code))
        if products:
            m.allowed_products.set(products)
        if plans:
            m.allowed_plans.set(plans)
        return m

    def _events(self, users, p):
        now = timezone.now()
        tech = Event.objects.create(code="DEMO-TECH-1405", display_name="نمایشگاه نمونه فناوری ۱۴۰۵", city="تهران", venue="سالن نمونه ۳۸",
                                    starts_at=now - timedelta(days=2), ends_at=now + timedelta(days=2), status="ACTIVE", activated_at=now - timedelta(days=2),
                                    owner=users["mdm"], referral_sla_hours=48, created_by=users["admin"], description="رویداد نمونه برای نمایش (DEMO)")
        energy = Event.objects.create(code="DEMO-ENERGY-1405", display_name="همایش نمونه انرژی هوشمند", city="اصفهان", venue="مرکز همایش نمونه",
                                      starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1), status="ACTIVE", activated_at=now - timedelta(days=1),
                                      owner=users["evmgr"], created_by=users["admin"])
        past = Event.objects.create(code="DEMO-EXPO-1404", display_name="نمایشگاه نمونه ۱۴۰۴", city="تهران", venue="سالن نمونه ۳۱",
                                    starts_at=now - timedelta(days=40), ends_at=now - timedelta(days=37), status="ACTIVE", activated_at=now - timedelta(days=40),
                                    owner=users["mdm"], created_by=users["admin"])
        draft = Event.objects.create(code="DEMO-NEXT-1406", display_name="رویداد آینده (پیش‌نویس)", city="مشهد", starts_at=now + timedelta(days=60),
                                     ends_at=now + timedelta(days=63), status="DRAFT", owner=users["mdm"], created_by=users["admin"])
        for code in ("FLEET-MON", "SMART-PARK", "CITY-LIGHT", "IIOT-GW"):
            EventProduct.objects.create(event=tech, product=p[code], default_owner=users["owner"] if code == "FLEET-MON" else None)
        for code in ("AMI-METER", "EMS-CLOUD", "PRED-MAINT"):
            EventProduct.objects.create(event=energy, product=p[code])
        for code in ("FLEET-MON", "AMI-METER", "IIOT-GW"):
            EventProduct.objects.create(event=past, product=p[code])
        EventProduct.objects.create(event=draft, product=p["SMART-PARK"])
        smart_city = Plan.objects.get(code="SMART-CITY")
        # Tech event team: universal capture for every role incl. admin/DG/MDM.
        self._member(tech, users["specialist1"], ["BOOTH_SPECIALIST"])
        self._member(tech, users["specialist2"], ["BOOTH_SPECIALIST"])
        self._member(tech, users["planmgr"], ["PLAN_MANAGER"], plans=[smart_city])
        self._member(tech, users["owner"], ["PRODUCT_OWNER"], products=[p["FLEET-MON"]])
        self._member(tech, users["dg"])
        self._member(tech, users["mdm"], ["EVENT_MANAGER"])
        self._member(tech, users["admin"])
        self._member(energy, users["specialist3"], ["BOOTH_SPECIALIST"])
        self._member(energy, users["evmgr"], ["EVENT_MANAGER"])
        self._member(energy, users["dg"])
        self._member(past, users["specialist1"], ["BOOTH_SPECIALIST"])
        self._member(past, users["planmgr"], ["PLAN_MANAGER"])
        return {"tech": tech, "energy": energy, "past": past, "draft": draft}

    def _tags(self, admin):
        for i, (code, fa, en, color) in enumerate(TAGS):
            from apps.common.text import normalize_search

            Tag.objects.create(code=code, name_fa=fa, name_en=en, name_normalized=normalize_search(fa), color=color, sort_order=i,
                               description="برچسب نمونه (DEMO)", created_by=admin)
        archived = Tag.objects.create(code="old-campaign", name_fa="کمپین قدیمی", name_en="Old campaign", name_normalized="کمپین قدیمی",
                                      color="slate", sort_order=9, created_by=admin, description="برچسب بایگانی‌شده نمونه")
        archived.status = "ARCHIVED"
        archived.save()

    def _notify(self, admin):
        NotificationProvider.objects.create(name="پیامک شبیه‌سازی (DEMO)", channel="SMS", adapter="MOCK_SMS", mode="MOCK", is_default=True,
                                            config={"test_recipient": "+989120000001", "rate_limit_per_minute": 60})
        NotificationProvider.objects.create(name="ایمیل شبیه‌سازی (DEMO)", channel="EMAIL", adapter="MOCK_EMAIL", mode="MOCK", is_default=True,
                                            config={"test_recipient": "admin@demo.invalid"})
        NotificationProvider.objects.create(name="سرور ایمیل سازمانی (در انتظار اطلاعات اتصال)", channel="EMAIL", adapter="SMTP", mode="DISABLED",
                                            config={"security": "STARTTLS", "port": 587, "environment": "production"})
        sms = NotificationTemplate.objects.create(code="referral-sms", name="پیامک ارجاع جدید", channel="SMS",
                                                  body="{{recipient_name}} عزیز، یک لید از رویداد {{event_code}} به شما ارجاع شد. مشاهده در سامانه: {{link}}")
        email = NotificationTemplate.objects.create(code="task-email", name="ایمیل وظیفه جدید", channel="EMAIL", subject="وظیفه جدید: {{title}}",
                                                    body="{{recipient_name}} عزیز،\nوظیفه «{{title}}» به شما سپرده شد.\n{{link}}",
                                                    body_html="<p dir='rtl'>{{recipient_name}} عزیز، وظیفه «{{title}}» به شما سپرده شد.</p><p><a href='{{link}}'>مشاهده</a></p>")
        overdue = NotificationTemplate.objects.create(code="task-overdue-sms", name="پیامک وظیفه معوق", channel="SMS",
                                                      body="یادآوری: موعد وظیفه «{{title}}» گذشته است. {{link}}")
        NotificationRule.objects.create(name="پیامک به گیرنده ارجاع", trigger="referral.created", recipient_type="DIRECT_ASSIGNEE", channel="SMS",
                                        template=sms, cooldown_minutes=30, quiet_hours_enabled=True, quiet_start=time(22, 0), quiet_end=time(7, 30), created_by=admin)
        NotificationRule.objects.create(name="پیامک ارجاع مجدد", trigger="referral.reassigned", recipient_type="DIRECT_ASSIGNEE", channel="SMS",
                                        template=sms, created_by=admin)
        NotificationRule.objects.create(name="ایمیل وظیفه جدید", trigger="task.assigned", recipient_type="DIRECT_ASSIGNEE", channel="EMAIL",
                                        template=email, created_by=admin)
        NotificationRule.objects.create(name="یادآوری پیامکی وظیفه معوق", trigger="task.overdue", recipient_type="DIRECT_ASSIGNEE", channel="SMS",
                                        template=overdue, cooldown_minutes=720, created_by=admin)

    def _leads(self, rnd, users, events, p):
        plan = [
            (events["tech"], ["specialist1", "specialist2", "dg", "mdm", "planmgr", "admin", "owner"], ["FLEET-MON", "SMART-PARK", "CITY-LIGHT", "IIOT-GW"], 26),
            (events["energy"], ["specialist3", "evmgr", "dg"], ["AMI-METER", "EMS-CLOUD", "PRED-MAINT"], 10),
            (events["past"], ["specialist1", "planmgr"], ["FLEET-MON", "AMI-METER", "IIOT-GW"], 9),
        ]
        tags = list(Tag.objects.filter(status="ACTIVE"))
        phone_n = 100
        created = []
        shared_contacts = []
        for event, creators, codes, count in plan:
            for n in range(count):
                creator = users[rnd.choice(creators)]
                phone_n += 1
                reuse = shared_contacts and rnd.random() < 0.15
                if reuse:
                    name, mobile, org = rnd.choice(shared_contacts)
                else:
                    name = f"{rnd.choice(FIRST)} {rnd.choice(LAST)}"
                    mobile = f"0912000{phone_n:04d}"
                    org = rnd.choice(ORGS + [""])
                    shared_contacts.append((name, mobile, org))
                chosen = rnd.sample(codes, k=1 if rnd.random() < 0.7 else 2)
                result = services.capture(creator, {
                    "event_id": str(event.id), "client_record_id": str(uuid.uuid4()), "contact_name": name, "mobile": mobile,
                    "org_name": org, "product_ids": [str(p[c].id) for c in chosen],
                    "quality": rnd.choice(["SERIOUS", "FOLLOW_UP", "FOLLOW_UP", "INTRO"]), "note": rnd.choice(NOTES),
                })
                i = result.interaction
                hours_ago = rnd.randint(1, 40) if event.code != "DEMO-EXPO-1404" else rnd.randint(40 * 24 - 72, 40 * 24 - 2)
                Interaction.objects.filter(pk=i.pk).update(captured_at=timezone.now() - timedelta(hours=hours_ago))
                created.append((event, i))

        # Duplicate-number scenario: same mobile, different person (shared office line).
        services.capture(users["specialist2"], {
            "event_id": str(events["tech"].id), "client_record_id": str(uuid.uuid4()), "contact_name": "مهدی هم‌شماره",
            "mobile": shared_contacts[0][1], "product_ids": [str(p["SMART-PARK"].id)], "note": "شماره مشترک دفتر (نمونه تکراری)",
        })

        # Triage / qualification / referrals / tasks / tags on a subset.
        mdm, planmgr, owner = users["mdm"], users["planmgr"], users["owner"]
        for idx, (event, i) in enumerate(created):
            i.refresh_from_db()
            if event.code == "DEMO-TECH-1405" and idx % 3 == 0:
                if not i.referrals.filter(status="PENDING").exists():
                    services.refer(mdm, i, planmgr.id, "لطفاً ارزیابی شود (نمونه)", purpose="QUALIFICATION")
                ref = i.referrals.filter(status="PENDING").first()
                if idx % 2 == 0 and ref and ref.to_user_id == planmgr.id:
                    services.accept_referral(planmgr, ref)
                    i.refresh_from_db()
                    opp = services.qualify(planmgr, i, {"business_problem": "نیاز به پایش لحظه‌ای ناوگان (نمونه)", "urgency": rnd.choice(["LOW", "MEDIUM", "HIGH"]),
                                                        "next_step": "ارسال پیشنهاد فنی", "next_step_due_at": (timezone.now() + timedelta(days=rnd.randint(-3, 10))).isoformat()})
                    for t in rnd.sample(tags, k=rnd.randint(0, 2)):
                        services.add_tag(planmgr, opp, t.id)
                    services.create_task(planmgr, i, {"title": "تماس پیگیری با مخاطب", "owner_id": str(planmgr.id),
                                                      "due_at": (timezone.now() + timedelta(days=rnd.randint(-2, 6))).isoformat()})
            if event.code == "DEMO-EXPO-1404" and idx % 2 == 0:
                services.refer(users["admin"], i, planmgr.id, "پیگیری پس از رویداد", purpose="FOLLOW_UP")
                ref = i.referrals.filter(status="PENDING").first()
                services.accept_referral(planmgr, ref)
                opp = services.qualify(planmgr, i, {"urgency": "MEDIUM", "next_step": "جلسه معرفی"})
                if idx % 4 == 0:
                    services.change_stage(planmgr, opp, "FOLLOW_UP", version=opp.version)
                    opp.refresh_from_db()
                    services.change_stage(planmgr, opp, "WON" if idx % 8 == 0 else "NURTURE", version=opp.version)
        # One returned referral for the inbox.
        sample = next(i for e, i in created if e.code == "DEMO-TECH-1405" and not i.referrals.exists())
        r = services.refer(mdm, sample, owner.id, "بررسی امکان اتصال API", purpose="FOLLOW_UP")
        services.return_referral(owner, r, "خارج از حوزه محصول من است؛ به مدیر طرح ارجاع شود.")
