"""Manual INFORMATION / ACTION_REQUEST messages, scoped to the sender's authority."""
import uuid

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.catalog.models import EventMembership, Product, ProductOwner
from apps.common.audit import audit
from apps.common.exceptions import BusinessRuleViolation
from apps.iam.authz import authz_for
from apps.iam.models import User

from .engine import create_job, process_jobs
from .models import ActionCompletion, ActionRequest, NotificationCampaign, NotificationRecipient

BROAD_SEND_THRESHOLD = 20


def sender_scope(sender):
    """Queryset of users the sender may address."""
    az = authz_for(sender)
    active = User.objects.filter(status=User.Status.ACTIVE)
    if az.has_global("notification.send"):
        return active
    event_ids = [g.event_id for g in az.event_grants("notification.send")]
    if not event_ids:
        return active.none()
    member_ids = EventMembership.objects.filter(event_id__in=event_ids, status="ACTIVE").values_list("user_id", flat=True)
    return active.filter(pk__in=member_ids)


def resolve_recipients(sender, targeting):
    targeting = targeting or {}
    scope = sender_scope(sender)
    user_ids = targeting.get("user_ids") or []
    filters = any(targeting.get(k) for k in ("event_id", "role_codes", "plan_id", "product_id"))
    if not user_ids and not filters:
        raise ValidationError({"targeting": "حداقل یک گیرنده یا فیلتر مخاطبان را مشخص کنید."})
    q = Q(pk__in=[])
    if filters:
        fq = Q()
        memberships = EventMembership.objects.filter(status="ACTIVE")
        if targeting.get("event_id"):
            memberships = memberships.filter(event_id=targeting["event_id"])
            fq &= Q(pk__in=memberships.values("user_id"))
        if targeting.get("role_codes"):
            codes = targeting["role_codes"]
            fq &= Q(global_roles__role__code__in=codes) | Q(pk__in=memberships.filter(roles__code__in=codes).values("user_id"))
        if targeting.get("plan_id") or targeting.get("product_id"):
            product_ids = []
            if targeting.get("product_id"):
                product_ids.append(targeting["product_id"])
            if targeting.get("plan_id"):
                product_ids += list(Product.objects.filter(plan_id=targeting["plan_id"]).values_list("id", flat=True))
            pq = Q(pk__in=ProductOwner.objects.filter(product_id__in=product_ids).values("user_id"))
            pq |= Q(pk__in=memberships.filter(allowed_products__in=product_ids).values("user_id"))
            if targeting.get("plan_id"):
                pq |= Q(pk__in=memberships.filter(allowed_plans=targeting["plan_id"]).values("user_id"))
            fq &= pq
        q |= fq
    if user_ids:
        q |= Q(pk__in=user_ids)
    recipients = scope.filter(q).distinct()
    out_of_scope = 0
    if user_ids:
        allowed = set(scope.filter(pk__in=user_ids).values_list("id", flat=True))
        out_of_scope = len({str(u) for u in user_ids} - {str(a) for a in allowed})
    return recipients, out_of_scope


def _validate(data):
    errors = {}
    kind = data.get("kind")
    if kind not in NotificationCampaign.Kind.values:
        errors["kind"] = "نوع پیام نامعتبر است."
    if not (data.get("subject") or "").strip():
        errors["subject"] = "موضوع الزامی است."
    if not (data.get("body") or "").strip():
        errors["body"] = "متن پیام الزامی است."
    channels = data.get("channels") or ["IN_APP"]
    if "IN_APP" not in channels:
        channels = ["IN_APP", *channels]
    if any(c not in ("IN_APP", "SMS", "EMAIL") for c in channels):
        errors["channels"] = "کانال نامعتبر است."
    if kind == "ACTION_REQUEST" and data.get("action_type") not in ActionRequest.Type.values:
        errors["action_type"] = "نوع اقدام را انتخاب کنید."
    if errors:
        raise ValidationError(errors)
    return channels


def preview(sender, data):
    authz_for(sender).require("notification.send")
    channels = _validate(data)
    recipients, out_of_scope = resolve_recipients(sender, data.get("targeting"))
    count = recipients.count()
    sms_reachable = recipients.exclude(mobile="").count() if "SMS" in channels else 0
    email_reachable = recipients.exclude(email="").count() if "EMAIL" in channels else 0
    return {
        "recipient_count": count,
        "out_of_scope_ignored": out_of_scope,
        "channels": channels,
        "sms_reachable": sms_reachable,
        "email_reachable": email_reachable,
        "requires_confirmation": count > BROAD_SEND_THRESHOLD,
        "sample": [{"id": str(u.id), "name": u.full_name, "title": u.title} for u in recipients[:8]],
        "estimated_cost": None,
    }


def create_campaign(sender, data, request=None):
    authz_for(sender).require("notification.send")
    channels = _validate(data)
    recipients, _ = resolve_recipients(sender, data.get("targeting"))
    count = recipients.count()
    if count == 0:
        raise BusinessRuleViolation("هیچ گیرنده‌ای در محدوده مجاز شما یافت نشد.")
    if count > BROAD_SEND_THRESHOLD and not data.get("confirm_broad"):
        raise BusinessRuleViolation(f"ارسال گسترده به {count} نفر نیاز به تأیید صریح دارد.", code="confirmation_required")
    scheduled_at = parse_datetime(data["scheduled_at"]) if data.get("scheduled_at") else None
    due_at = parse_datetime(data["due_at"]) if data.get("due_at") else None
    key = data.get("idempotency_key") or str(uuid.uuid4())
    existing = NotificationCampaign.objects.filter(idempotency_key=key, created_by=sender).first()
    if existing:
        return existing
    from apps.crm.models import Interaction
    from apps.crm.scoping import visible_interactions

    related = None
    if data.get("related_interaction_id"):
        related = visible_interactions(sender, Interaction.objects.filter(pk=data["related_interaction_id"])).first()
        if not related:
            raise ValidationError({"related_interaction_id": "لید مرتبط یافت نشد یا در محدوده شما نیست."})
    with transaction.atomic():
        campaign = NotificationCampaign.objects.create(
            kind=data["kind"], subject=data["subject"].strip()[:200], body=data["body"].strip(),
            priority=data.get("priority") or "NORMAL", targeting=data.get("targeting") or {}, channels=channels,
            action_type=data.get("action_type") or "", due_at=due_at, related_interaction=related,
            scheduled_at=scheduled_at, status="SCHEDULED" if scheduled_at and scheduled_at > timezone.now() else "DRAFT",
            recipient_count=count, idempotency_key=key, created_by=sender,
        )
        NotificationRecipient.objects.bulk_create([NotificationRecipient(campaign=campaign, user=u) for u in recipients])
        audit(sender, "campaign.created", "campaign", campaign.id, after={"kind": campaign.kind, "recipients": count, "channels": channels, "scheduled_at": scheduled_at}, request=request)
        if campaign.status == "DRAFT":
            _dispatch(campaign)
    if campaign.status == "SENT":
        transaction.on_commit(lambda: process_jobs())
    return campaign


def _dispatch(campaign):
    """Create action requests and jobs for every recipient. Idempotent by dedup keys."""
    sender = campaign.created_by
    for rec in campaign.recipients.select_related("user"):
        user = rec.user
        ctx = {"subject": campaign.subject, "body": campaign.body, "recipient_name": user.full_name, "sender_name": sender.full_name}
        action = None
        if campaign.kind == "ACTION_REQUEST":
            action, created = ActionRequest.objects.get_or_create(
                campaign=campaign, assignee=user,
                defaults={
                    "requested_by": sender, "action_type": campaign.action_type, "subject": campaign.subject,
                    "instructions": campaign.body, "related_interaction": campaign.related_interaction,
                    "due_at": campaign.due_at, "priority": campaign.priority,
                },
            )
            if created:
                ActionCompletion.objects.create(action_request=action, actor=sender, from_status="", to_status="OPEN")
            ctx["action_request_id"] = str(action.id)
        if campaign.related_interaction_id:
            ctx["interaction_id"] = str(campaign.related_interaction_id)
        from django.conf import settings

        ctx["link"] = settings.APP_BASE_URL.rstrip("/") + ("/inbox?tab=actions" if action else "/notifications")
        for channel in campaign.channels:
            body = campaign.body if channel != "SMS" else f"{campaign.subject}\n{ctx['link']}"
            create_job(
                source="CAMPAIGN", campaign=campaign, recipient=user, channel=channel,
                dedup_key=f"campaign:{campaign.id}:{user.id}:{channel}", context=ctx,
                event_type="action_request.created" if action else "information",
                priority=campaign.priority, subject=campaign.subject, body=body,
            )
    campaign.status = "SENT"
    campaign.sent_at = timezone.now()
    campaign.save(update_fields=["status", "sent_at", "updated_at"])


def dispatch_due_campaigns():
    count = 0
    for campaign in NotificationCampaign.objects.filter(status="SCHEDULED", scheduled_at__lte=timezone.now()):
        with transaction.atomic():
            locked = NotificationCampaign.objects.select_for_update().get(pk=campaign.pk)
            if locked.status != "SCHEDULED":
                continue
            _dispatch(locked)
            count += 1
    if count:
        process_jobs()
    return count


def cancel_campaign(user, campaign, request=None):
    if campaign.created_by_id != user.id and not authz_for(user).has_global("notification.configure"):
        raise PermissionDenied("مجوز لغو این پیام را ندارید.")
    if campaign.status != "SCHEDULED":
        raise BusinessRuleViolation("فقط پیام زمان‌بندی‌شده قابل لغو است.")
    campaign.status = "CANCELLED"
    campaign.save(update_fields=["status", "updated_at"])
    audit(user, "campaign.cancelled", "campaign", campaign.id, request=request)
    return campaign


def transition_action(user, action, to_status, note="", request=None):
    is_assignee = action.assignee_id == user.id
    is_requester = action.requested_by_id == user.id
    if to_status == "CANCELLED":
        if not is_requester:
            raise PermissionDenied("فقط درخواست‌کننده می‌تواند درخواست را لغو کند.")
    elif to_status == "OPEN":
        if not is_requester:
            raise PermissionDenied("فقط درخواست‌کننده می‌تواند درخواست بازگشتی را دوباره باز کند.")
    elif not is_assignee:
        raise PermissionDenied("فقط مسئول اقدام می‌تواند وضعیت را تغییر دهد.")
    if to_status not in ActionRequest.TRANSITIONS.get(action.status, set()):
        raise BusinessRuleViolation("این تغییر وضعیت مجاز نیست.", code="invalid_transition")
    if to_status == "RETURNED" and not note.strip():
        raise ValidationError({"note": "دلیل بازگشت الزامی است."})
    with transaction.atomic():
        ActionCompletion.objects.create(action_request=action, actor=user, from_status=action.status, to_status=to_status, note=note.strip())
        action.status = to_status
        action.status_changed_at = timezone.now()
        action.version += 1
        action.save()
        audit(user, "action_request." + to_status.lower(), "action_request", action.id, metadata={"note": note}, request=request)
    return action
