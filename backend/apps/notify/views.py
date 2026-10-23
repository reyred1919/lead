import time
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime, parse_time
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.audit import audit, diff
from apps.common.concurrency import bump, check_version
from apps.common.crypto import encrypt_secret
from apps.common.exceptions import BusinessRuleViolation
from apps.common.outbox import EVENT_TYPES
from apps.common.pagination import StandardPagination
from apps.common.text import normalize_email, normalize_mobile
from apps.iam.authz import HasCapability, authz_for

from . import campaigns as campaign_service
from .engine import SYSTEM_IN_APP
from .models import (
    ActionRequest,
    DeliveryAttempt,
    Notification,
    NotificationCampaign,
    NotificationJob,
    NotificationPreference,
    NotificationProvider,
    NotificationRule,
    NotificationTemplate,
    ProviderHealthCheck,
)
from .providers import ADAPTERS, adapter_for, deliver
from .templating import ALLOWED_VARS, render, unknown_variables


def _ref(u):
    return {"id": str(u.id), "full_name": u.full_name, "title": u.title} if u else None


def _nf():
    raise NotFound("یافت نشد.")


# ------------------------------------------------------------ Inbox ------

def notification_data(n):
    return {
        "id": str(n.id), "kind": n.kind, "kind_label": n.get_kind_display(), "title": n.title, "body": n.body,
        "priority": n.priority, "link": n.link, "source_label": n.source_label, "event_type": n.event_type,
        "action_request_id": str(n.action_request_id) if n.action_request_id else None,
        "action_status": n.action_request.status if n.action_request_id else None,
        "read_at": n.read_at, "snoozed_until": n.snoozed_until, "created_at": n.created_at,
    }


class NotificationListView(APIView):
    def get(self, request):
        qs = Notification.objects.filter(recipient=request.user).select_related("action_request")
        f = request.query_params.get("filter", "all")
        now = timezone.now()
        if f == "unread":
            qs = qs.filter(read_at__isnull=True)
        elif f == "actions":
            qs = qs.filter(kind="ACTION_REQUEST")
        if f != "snoozed":
            qs = qs.filter(Q(snoozed_until__isnull=True) | Q(snoozed_until__lte=now))
        else:
            qs = qs.filter(snoozed_until__gt=now)
        page = StandardPagination()
        items = page.paginate_queryset(qs, request)
        return page.get_paginated_response([notification_data(n) for n in items])


class NotificationActionView(APIView):
    def post(self, request, pk, action):
        n = Notification.objects.filter(pk=pk, recipient=request.user).first() or _nf()
        if action == "read":
            n.read_at = n.read_at or timezone.now()
        elif action == "unread":
            n.read_at = None
        elif action == "snooze":
            hours = int(request.data.get("hours", 4))
            if not 1 <= hours <= 168:
                raise ValidationError({"hours": "۱ تا ۱۶۸ ساعت"})
            n.snoozed_until = timezone.now() + timedelta(hours=hours)
        else:
            raise NotFound()
        n.save()
        return Response(notification_data(n))


class NotificationReadAllView(APIView):
    def post(self, request):
        count = Notification.objects.filter(recipient=request.user, read_at__isnull=True).update(read_at=timezone.now())
        return Response({"updated": count})


class PreferenceView(APIView):
    def get(self, request):
        prefs = {(p.channel, p.event_type): p.enabled for p in NotificationPreference.objects.filter(user=request.user)}
        return Response({
            "channels": [
                {"channel": c, "enabled": prefs.get((c, "*"), True)} for c in ("SMS", "EMAIL")
            ],
            "note": "اعلان‌های درون‌برنامه همیشه فعال‌اند.",
        })

    def put(self, request):
        for item in request.data.get("channels", []):
            if item.get("channel") not in ("SMS", "EMAIL"):
                continue
            NotificationPreference.objects.update_or_create(
                user=request.user, channel=item["channel"], event_type="*", defaults={"enabled": bool(item.get("enabled"))}
            )
        audit(request.user, "preferences.updated", "user", request.user.id, metadata=request.data, request=request)
        return self.get(request)


# --------------------------------------------------- Action requests ----

def action_data(a):
    return {
        "id": str(a.id), "action_type": a.action_type, "action_type_label": a.get_action_type_display(), "subject": a.subject,
        "instructions": a.instructions, "assignee": _ref(a.assignee), "requested_by": _ref(a.requested_by),
        "related_interaction_id": str(a.related_interaction_id) if a.related_interaction_id else None,
        "due_at": a.due_at, "status": a.status, "status_label": a.get_status_display(), "priority": a.priority,
        "status_changed_at": a.status_changed_at, "created_at": a.created_at, "version": a.version,
        "allowed_transitions": sorted(ActionRequest.TRANSITIONS.get(a.status, [])),
        "overdue": bool(a.due_at and a.due_at < timezone.now() and a.status in ("OPEN", "ACKNOWLEDGED", "IN_PROGRESS")),
        "history": [{"from": h.from_status, "to": h.to_status, "actor": _ref(h.actor), "note": h.note, "at": h.created_at} for h in a.history.all()],
    }


class ActionRequestListView(APIView):
    def get(self, request):
        scope = request.query_params.get("scope", "mine")
        qs = ActionRequest.objects.select_related("assignee", "requested_by").prefetch_related("history__actor")
        if scope == "mine":
            qs = qs.filter(assignee=request.user)
        elif scope == "requested":
            qs = qs.filter(requested_by=request.user)
        elif scope == "all":
            authz_for(request.user).require("notification.configure")
        else:
            raise ValidationError({"scope": "نامعتبر"})
        st = request.query_params.get("status", "OPEN,ACKNOWLEDGED,IN_PROGRESS,RETURNED")
        if st != "ALL":
            qs = qs.filter(status__in=st.split(","))
        if request.query_params.get("overdue") == "1":
            qs = qs.filter(due_at__lt=timezone.now())
        page = StandardPagination()
        items = page.paginate_queryset(qs.order_by("due_at", "-created_at"), request)
        return page.get_paginated_response([action_data(a) for a in items])


class ActionRequestTransitionView(APIView):
    def post(self, request, pk):
        action = ActionRequest.objects.filter(pk=pk).filter(Q(assignee=request.user) | Q(requested_by=request.user)).first() or _nf()
        campaign_service.transition_action(request.user, action, request.data.get("status"), request.data.get("note", ""), request=request)
        return Response(action_data(action))


# -------------------------------------------------------- Campaigns -----

def campaign_data(c):
    actions = c.action_requests.all() if c.kind == "ACTION_REQUEST" else []
    by_status = {}
    for a in actions:
        by_status[a.status] = by_status.get(a.status, 0) + 1
    jobs = {}
    for j in c.jobs.all():
        jobs.setdefault(j.channel, {}).setdefault(j.status, 0)
        jobs[j.channel][j.status] += 1
    return {
        "id": str(c.id), "kind": c.kind, "kind_label": c.get_kind_display(), "subject": c.subject, "body": c.body,
        "priority": c.priority, "targeting": c.targeting, "channels": c.channels, "action_type": c.action_type,
        "due_at": c.due_at, "scheduled_at": c.scheduled_at, "status": c.status, "status_label": c.get_status_display(),
        "recipient_count": c.recipient_count, "created_by": _ref(c.created_by), "created_at": c.created_at, "sent_at": c.sent_at,
        "action_status_counts": by_status, "delivery_counts": jobs,
    }


class CampaignListView(APIView):
    permission_classes = [HasCapability.of("notification.send")]

    def get(self, request):
        qs = NotificationCampaign.objects.select_related("created_by").prefetch_related("action_requests", "jobs")
        if not authz_for(request.user).has_global("notification.configure"):
            qs = qs.filter(created_by=request.user)
        page = StandardPagination()
        items = page.paginate_queryset(qs, request)
        return page.get_paginated_response([campaign_data(c) for c in items])

    def post(self, request):
        campaign = campaign_service.create_campaign(request.user, request.data, request=request)
        return Response(campaign_data(campaign), status=status.HTTP_201_CREATED)


class CampaignPreviewView(APIView):
    permission_classes = [HasCapability.of("notification.send")]

    def post(self, request):
        return Response(campaign_service.preview(request.user, request.data))


class CampaignCancelView(APIView):
    permission_classes = [HasCapability.of("notification.send")]

    def post(self, request, pk):
        c = NotificationCampaign.objects.filter(pk=pk).first() or _nf()
        campaign_service.cancel_campaign(request.user, c, request=request)
        return Response(campaign_data(c))


# --------------------------------------------------------- Providers ----

PROVIDER_CONFIG_KEYS = {
    "MOCK_SMS": ["simulate_failure", "test_recipient", "rate_limit_per_minute"],
    "MOCK_EMAIL": ["simulate_failure", "test_recipient", "rate_limit_per_minute", "from_address"],
    "HTTP_SMS": ["endpoint", "sender", "pattern_id", "to_field", "text_field", "sender_field", "auth_header", "auth_scheme",
                 "message_id_field", "cost_field", "timeout", "rate_limit_per_minute", "max_retries", "test_recipient"],
    "SMTP": ["host", "port", "security", "username", "from_address", "from_name", "reply_to", "allowed_sender_domains",
             "allowed_recipient_domains", "timeout", "rate_limit_per_minute", "test_recipient", "environment"],
}


def provider_data(p):
    return {
        "id": str(p.id), "name": p.name, "channel": p.channel, "adapter": p.adapter, "adapter_label": p.get_adapter_display(),
        "mode": p.mode, "mode_label": p.get_mode_display(), "config": p.config, "is_default": p.is_default,
        # Secrets are write-only: only presence is reported, never the value.
        "secret_set": bool(p.secret_encrypted), "last_test_at": p.last_test_at, "last_test_ok": p.last_test_ok,
        "last_test_message": p.last_test_message, "live_verified_at": p.live_verified_at, "version": p.version,
        "is_mock": p.mode == "MOCK" or p.adapter.startswith("MOCK"),
        "health": [{"ok": h.ok, "code": h.code, "message": h.message, "kind": h.kind, "latency_ms": h.latency_ms, "at": h.created_at}
                   for h in p.health_checks.all()[:5]],
    }


def _clean_config(adapter, config):
    allowed = PROVIDER_CONFIG_KEYS[adapter]
    out = {k: v for k, v in (config or {}).items() if k in allowed}
    for key in ("allowed_sender_domains", "allowed_recipient_domains"):
        if key in out and isinstance(out[key], str):
            out[key] = [d.strip() for d in out[key].split(",") if d.strip()]
    if adapter == "SMTP" and out.get("security") and out["security"] not in ("STARTTLS", "SSL_TLS"):
        raise ValidationError({"config": {"security": "فقط STARTTLS یا SSL_TLS مجاز است."}})
    if adapter == "HTTP_SMS" and out.get("endpoint") and not str(out["endpoint"]).startswith("https://"):
        raise ValidationError({"config": {"endpoint": "نشانی سرویس باید https باشد."}})
    return out


class ProviderListView(APIView):
    permission_classes = [HasCapability.of("provider.manage")]

    def get(self, request):
        return Response([provider_data(p) for p in NotificationProvider.objects.prefetch_related("health_checks")])

    def post(self, request):
        d = request.data
        adapter = d.get("adapter")
        if adapter not in ADAPTERS:
            raise ValidationError({"adapter": "نوع اتصال نامعتبر است."})
        channel = "SMS" if adapter.endswith("SMS") else "EMAIL"
        mode = d.get("mode", "MOCK" if adapter.startswith("MOCK") else "DISABLED")
        if mode == "LIVE":
            raise BusinessRuleViolation("حالت ارسال واقعی فقط پس از آزمون موفق اتصال قابل فعال‌سازی است.")
        if adapter.startswith("MOCK") and mode not in ("MOCK", "DISABLED"):
            raise ValidationError({"mode": "سرویس شبیه‌سازی فقط در حالت شبیه‌سازی یا غیرفعال قابل استفاده است."})
        with transaction.atomic():
            p = NotificationProvider.objects.create(
                name=(d.get("name") or adapter)[:120], channel=channel, adapter=adapter, mode=mode,
                config=_clean_config(adapter, d.get("config")), secret_encrypted=encrypt_secret(d.get("secret") or ""),
                is_default=bool(d.get("is_default")),
            )
            if p.is_default:
                NotificationProvider.objects.filter(channel=channel).exclude(pk=p.pk).update(is_default=False)
            audit(request.user, "provider.created", "provider", p.id, after={"name": p.name, "adapter": adapter, "mode": mode, "config": p.config, "secret_set": bool(p.secret_encrypted)}, request=request)
        return Response(provider_data(p), status=status.HTTP_201_CREATED)


class ProviderDetailView(APIView):
    permission_classes = [HasCapability.of("provider.manage")]

    def patch(self, request, pk):
        p = NotificationProvider.objects.filter(pk=pk).first() or _nf()
        check_version(p, request.data)
        d = request.data
        before = {"name": p.name, "mode": p.mode, "config": p.config, "is_default": p.is_default, "secret_set": bool(p.secret_encrypted)}
        if "mode" in d:
            mode = d["mode"]
            if mode not in NotificationProvider.Mode.values:
                raise ValidationError({"mode": "نامعتبر"})
            if p.adapter.startswith("MOCK") and mode not in ("MOCK", "DISABLED"):
                raise ValidationError({"mode": "سرویس شبیه‌سازی فقط در حالت شبیه‌سازی یا غیرفعال قابل استفاده است."})
            if mode == "LIVE" and not (p.last_test_ok and p.live_verified_at):
                raise BusinessRuleViolation("پیش از فعال‌سازی ارسال واقعی، آزمون اتصال و ارسال آزمایشی باید موفق باشد.", code="live_not_verified")
            p.mode = mode
        if "config" in d:
            p.config = _clean_config(p.adapter, {**p.config, **(d["config"] or {})})
            if p.mode == "LIVE":
                p.mode = "CONFIGURED"  # config change requires re-verification
            p.live_verified_at = None
        if d.get("secret"):
            p.secret_encrypted = encrypt_secret(d["secret"])
            p.live_verified_at = None
            if p.mode == "LIVE":
                p.mode = "CONFIGURED"
        if d.get("clear_secret"):
            p.secret_encrypted = ""
        if "name" in d:
            p.name = d["name"][:120]
        if "is_default" in d:
            p.is_default = bool(d["is_default"])
        with transaction.atomic():
            bump(p)
            p.save()
            if p.is_default:
                NotificationProvider.objects.filter(channel=p.channel).exclude(pk=p.pk).update(is_default=False)
            after = {"name": p.name, "mode": p.mode, "config": p.config, "is_default": p.is_default, "secret_set": bool(p.secret_encrypted)}
            b, a = diff(before, after)
            if d.get("secret"):
                a["secret_rotated"] = True
            audit(request.user, "provider.updated", "provider", p.id, before=b, after=a, request=request)
        return Response(provider_data(p))


class ProviderTestView(APIView):
    permission_classes = [HasCapability.of("provider.manage")]

    def post(self, request, pk, kind):
        p = NotificationProvider.objects.filter(pk=pk).first() or _nf()
        adapter = adapter_for(p)
        if kind == "connection":
            result = adapter.test_connection()
            ProviderHealthCheck.objects.create(provider=p, kind="CONNECTION", ok=result.ok, code=result.code, message=result.message[:500],
                                               latency_ms=result.latency_ms, performed_by=request.user)
            p.last_test_at, p.last_test_ok, p.last_test_message = timezone.now(), result.ok, result.message[:500]
            if not result.ok:
                p.live_verified_at = None
            p.save()
            audit(request.user, "provider.tested", "provider", p.id, metadata={"ok": result.ok, "code": result.code}, request=request)
            return Response({"ok": result.ok, "code": result.code, "message": result.message, "latency_ms": result.latency_ms, "mock": p.mode == "MOCK"})
        if kind != "send":
            raise NotFound()
        # Test send to a verified internal address only (the admin's own, or the configured test recipient).
        if p.channel == "SMS":
            to = normalize_mobile(request.data.get("to") or p.config.get("test_recipient") or request.user.mobile)
            if not to or to not in {request.user.mobile, normalize_mobile(p.config.get("test_recipient") or "")}:
                raise ValidationError({"to": "ارسال آزمایشی فقط به موبایل خودتان یا شماره آزمون تأییدشده مجاز است."})
        else:
            to = normalize_email(request.data.get("to") or p.config.get("test_recipient") or request.user.email)
            if not to or to not in {(request.user.email or "").lower(), (p.config.get("test_recipient") or "").lower()}:
                raise ValidationError({"to": "ارسال آزمایشی فقط به ایمیل خودتان یا نشانی آزمون تأییدشده مجاز است."})
        if p.mode == "DISABLED":
            raise BusinessRuleViolation("سرویس غیرفعال است.")
        start = time.monotonic()
        subject = "پیام آزمایشی سامانه لیدهای نمایشگاهی"
        body = "این یک پیام آزمایشی برای بررسی اتصال سرویس اعلان داخلی است."
        result = deliver(adapter, p.channel, to, subject, body, f"<p dir='rtl'>{body}</p>", f"test:{p.id}:{time.time()}")
        ok = result.status in ("SENT", "SIMULATED")
        ProviderHealthCheck.objects.create(provider=p, kind="TEST_SEND", ok=ok, code=result.reason_code or result.status,
                                           message=result.summary[:500], latency_ms=int((time.monotonic() - start) * 1000), performed_by=request.user)
        if ok and result.status == "SENT" and not result.is_mock:
            p.live_verified_at = timezone.now()
            p.last_test_ok = True
            p.last_test_at = timezone.now()
            p.save()
        audit(request.user, "provider.test_send", "provider", p.id, metadata={"status": result.status, "mock": result.is_mock, "code": result.reason_code}, request=request)
        return Response({"status": result.status, "mock": result.is_mock, "code": result.reason_code, "message": result.summary,
                         "provider_message_id": result.provider_message_id, "live_verified": bool(p.live_verified_at)})


class SmsWebhookView(APIView):
    """Delivery-status callback. Accepted only with a valid HMAC-SHA256 signature."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, pk):
        p = NotificationProvider.objects.filter(pk=pk, adapter="HTTP_SMS").first() or _nf()
        adapter = adapter_for(p)
        if p.mode == "MOCK" or not hasattr(adapter, "verify_webhook") or not adapter.verify_webhook(request.body, request.headers.get("X-Signature", "")):
            audit(None, "provider.webhook_rejected", "provider", p.id, request=request)
            return Response({"detail": "invalid signature"}, status=status.HTTP_401_UNAUTHORIZED)
        message_id = str(request.data.get("message_id") or request.data.get("id") or "")
        state = str(request.data.get("status", "")).upper()
        mapped = {"DELIVERED": "DELIVERED", "FAILED": "FAILED", "UNDELIVERED": "FAILED", "SENT": "SENT"}.get(state, "UNKNOWN")
        attempt = DeliveryAttempt.objects.filter(provider=p, provider_message_id=message_id).select_related("job").first()
        if attempt:
            attempt.status = mapped
            attempt.reason_code = state[:60]
            attempt.save()
            if mapped == "DELIVERED":
                attempt.job.status = "DELIVERED"
                attempt.job.save(update_fields=["status"])
        return Response({"ok": True})


# --------------------------------------------------- Templates / rules --

def template_data(t):
    return {"id": str(t.id), "code": t.code, "name": t.name, "channel": t.channel, "subject": t.subject, "body": t.body,
            "body_html": t.body_html, "locale": t.locale, "is_active": t.is_active, "version": t.version,
            "unknown_variables": unknown_variables(t.subject + t.body + t.body_html)}


class TemplateListView(APIView):
    permission_classes = [HasCapability.of("notification.configure")]

    def get(self, request):
        return Response({"templates": [template_data(t) for t in NotificationTemplate.objects.all()],
                         "variables": [{"name": k, "label": v} for k, v in ALLOWED_VARS.items()]})

    def post(self, request):
        d = request.data
        if d.get("channel") not in ("IN_APP", "SMS", "EMAIL"):
            raise ValidationError({"channel": "نامعتبر"})
        if not (d.get("body") or "").strip() or not (d.get("code") or "").strip():
            raise ValidationError({"body": "کد و متن قالب الزامی است."})
        unknown = unknown_variables((d.get("subject") or "") + d["body"] + (d.get("body_html") or ""))
        if unknown:
            raise ValidationError({"body": f"متغیر غیرمجاز: {', '.join(unknown)}"})
        if NotificationTemplate.objects.filter(code=d["code"]).exists():
            raise ValidationError({"code": "کد تکراری است."})
        t = NotificationTemplate.objects.create(code=d["code"][:60], name=(d.get("name") or d["code"])[:120], channel=d["channel"],
                                                subject=(d.get("subject") or "")[:200], body=d["body"], body_html=d.get("body_html") or "")
        audit(request.user, "template.created", "template", t.id, after=template_data(t), request=request)
        return Response(template_data(t), status=status.HTTP_201_CREATED)


class TemplateDetailView(APIView):
    permission_classes = [HasCapability.of("notification.configure")]

    def patch(self, request, pk):
        t = NotificationTemplate.objects.filter(pk=pk).first() or _nf()
        check_version(t, request.data)
        before = template_data(t)
        for f in ("name", "subject", "body", "body_html", "is_active"):
            if f in request.data:
                setattr(t, f, request.data[f])
        unknown = unknown_variables(t.subject + t.body + t.body_html)
        if unknown:
            raise ValidationError({"body": f"متغیر غیرمجاز: {', '.join(unknown)}"})
        bump(t)
        t.save()
        b, a = diff(before, template_data(t))
        audit(request.user, "template.updated", "template", t.id, before=b, after=a, request=request)
        return Response(template_data(t))


class TemplatePreviewView(APIView):
    permission_classes = [HasCapability.of("notification.configure")]

    def post(self, request):
        sample = {"recipient_name": "سارا نمونه", "sender_name": "مدیر توسعه بازار", "contact_name": "مخاطب نمونه",
                  "event_code": "DEMO-2026", "event_name": "نمایشگاه نمونه", "title": "پیگیری لید", "subject": "موضوع نمونه",
                  "body": "متن نمونه", "reason": "دلیل نمونه", "due_at": "۱۴۰۵/۰۸/۱۵", "link": "https://app.example/leads/…"}
        return Response({
            "subject": render(request.data.get("subject", ""), sample),
            "body": render(request.data.get("body", ""), sample),
            "body_html": render(request.data.get("body_html", ""), sample, html=True),
            "unknown_variables": unknown_variables((request.data.get("subject") or "") + (request.data.get("body") or "")),
            "sms_length": len(render(request.data.get("body", ""), sample)),
        })


def rule_data(r):
    return {
        "id": str(r.id), "name": r.name, "trigger": r.trigger, "trigger_label": EVENT_TYPES.get(r.trigger, r.trigger),
        "recipient_type": r.recipient_type, "recipient_role": r.recipient_role.code if r.recipient_role_id else None,
        "event": str(r.event_id) if r.event_id else None, "plan": str(r.plan_id) if r.plan_id else None,
        "product": str(r.product_id) if r.product_id else None, "channel": r.channel, "template": str(r.template_id),
        "template_name": r.template.name, "delay_minutes": r.delay_minutes, "quiet_hours_enabled": r.quiet_hours_enabled,
        "quiet_start": r.quiet_start.strftime("%H:%M") if r.quiet_start else None, "quiet_end": r.quiet_end.strftime("%H:%M") if r.quiet_end else None,
        "cooldown_minutes": r.cooldown_minutes, "max_attempts": r.max_attempts, "priority": r.priority, "enabled": r.enabled, "version": r.version,
    }


RULE_FIELDS = ["name", "trigger", "recipient_type", "channel", "delay_minutes", "quiet_hours_enabled", "cooldown_minutes", "max_attempts", "priority", "enabled"]


def _apply_rule(r, d):
    from apps.catalog.models import Event, Plan, Product
    from apps.iam.models import Role

    for f in RULE_FIELDS:
        if f in d:
            setattr(r, f, d[f])
    if r.trigger not in EVENT_TYPES and r.trigger not in SYSTEM_IN_APP:
        raise ValidationError({"trigger": "رویداد سیستمی نامعتبر است."})
    if r.channel not in ("IN_APP", "SMS", "EMAIL"):
        raise ValidationError({"channel": "نامعتبر"})
    if "template" in d:
        r.template = NotificationTemplate.objects.filter(pk=d["template"]).first() or _nf()
    if r.template_id and r.template.channel != r.channel:
        raise ValidationError({"template": "کانال قالب با کانال قاعده یکسان نیست."})
    if "recipient_role" in d:
        r.recipient_role = Role.objects.filter(code=d["recipient_role"]).first() if d["recipient_role"] else None
    for key, model in (("event", Event), ("plan", Plan), ("product", Product)):
        if key in d:
            setattr(r, key, model.objects.filter(pk=d[key]).first() if d[key] else None)
    for key in ("quiet_start", "quiet_end"):
        if key in d:
            setattr(r, key, parse_time(d[key]) if d[key] else None)
    if r.quiet_hours_enabled and not (r.quiet_start and r.quiet_end):
        raise ValidationError({"quiet_start": "بازه سکوت را کامل کنید."})


class RuleListView(APIView):
    permission_classes = [HasCapability.of("notification.configure")]

    def get(self, request):
        return Response({
            "rules": [rule_data(r) for r in NotificationRule.objects.select_related("template", "recipient_role")],
            "triggers": [{"code": k, "label": v} for k, v in {**EVENT_TYPES, "referral.overdue": "ارجاع معوق", "action_request.overdue": "درخواست اقدام معوق"}.items()],
        })

    def post(self, request):
        r = NotificationRule(created_by=request.user)
        _apply_rule(r, request.data)
        if not r.template_id:
            raise ValidationError({"template": "قالب الزامی است."})
        r.save()
        audit(request.user, "rule.created", "rule", r.id, after=rule_data(r), request=request)
        return Response(rule_data(r), status=status.HTTP_201_CREATED)


class RuleDetailView(APIView):
    permission_classes = [HasCapability.of("notification.configure")]

    def patch(self, request, pk):
        r = NotificationRule.objects.select_related("template").filter(pk=pk).first() or _nf()
        check_version(r, request.data)
        before = rule_data(r)
        _apply_rule(r, request.data)
        bump(r)
        r.save()
        b, a = diff(before, rule_data(r))
        audit(request.user, "rule.updated", "rule", r.id, before=b, after=a, request=request)
        return Response(rule_data(r))


# ---------------------------------------------------------------- Logs --

class JobLogView(APIView):
    permission_classes = [HasCapability.of("notification.configure", "provider.manage")]

    def get(self, request):
        qs = NotificationJob.objects.select_related("recipient", "rule", "campaign").prefetch_related("attempts_log__provider")
        p = request.query_params
        if p.get("channel"):
            qs = qs.filter(channel=p["channel"])
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        if p.get("since"):
            since = parse_datetime(p["since"])
            if since:
                qs = qs.filter(created_at__gte=since)
        page = StandardPagination()
        items = page.paginate_queryset(qs, request)
        return page.get_paginated_response([{
            "id": str(j.id), "source": j.source, "channel": j.channel, "status": j.status, "status_label": j.get_status_display(),
            "event_type": j.event_type, "recipient": _ref(j.recipient), "rule": j.rule.name if j.rule_id else None,
            "campaign": j.campaign.subject if j.campaign_id else None, "subject": j.rendered_subject,
            "body": j.rendered_body[:300], "attempts": j.attempts, "max_attempts": j.max_attempts,
            "last_error": j.last_error, "skip_reason": j.skip_reason, "scheduled_at": j.scheduled_at,
            "created_at": j.created_at, "completed_at": j.completed_at,
            "delivery": [{"attempt_no": a.attempt_no, "status": a.status, "is_mock": a.is_mock, "provider": a.provider.name if a.provider_id else None,
                          "provider_message_id": a.provider_message_id, "reason_code": a.reason_code, "summary": a.response_summary,
                          "cost": a.cost, "at": a.created_at} for a in j.attempts_log.all()],
        } for j in items])


class JobRetryView(APIView):
    permission_classes = [HasCapability.of("notification.configure", "provider.manage")]

    def post(self, request, pk):
        job = NotificationJob.objects.filter(pk=pk).first() or _nf()
        if job.status not in ("DEAD", "FAILED", "SKIPPED"):
            raise BusinessRuleViolation("فقط کارهای ناموفق یا ردشده قابل ارسال مجدد هستند.")
        job.status, job.scheduled_at, job.max_attempts = "PENDING", timezone.now(), job.attempts + 1
        job.skip_reason = ""
        job.save()
        audit(request.user, "notification_job.retried", "notification_job", job.id, request=request)
        from .engine import process_jobs

        process_jobs()
        job.refresh_from_db()
        return Response({"status": job.status})
