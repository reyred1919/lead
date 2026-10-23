"""Notification pipeline:

domain event → outbox → rule evaluator → NotificationJob → channel → adapter → DeliveryAttempt

Everything here runs AFTER the business transaction committed. Failures are
recorded on the job and retried with backoff; they never touch lead state.
"""
import logging
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.catalog.models import Event, EventMembership, Product
from apps.common.models import OutboxEvent
from apps.iam.models import User

from .models import (
    DeliveryAttempt,
    Notification,
    NotificationJob,
    NotificationPreference,
    NotificationProvider,
    NotificationRule,
)
from .providers import adapter_for, deliver
from .templating import render

log = logging.getLogger(__name__)

# Built-in in-app notifications (mandatory channel). Rules add SMS/EMAIL or extra recipients.
SYSTEM_IN_APP = {
    "referral.created": ("to_user_id", "ارجاع جدید: {contact_name}", "یک لید از رویداد {event_code} به شما ارجاع شد. {reason}", "HIGH"),
    "referral.reassigned": ("to_user_id", "ارجاع مجدد: {contact_name}", "یک لید از رویداد {event_code} به شما ارجاع شد. {reason}", "HIGH"),
    "referral.accepted": ("from_user_id", "ارجاع پذیرفته شد: {contact_name}", "گیرنده، ارجاع شما را پذیرفت.", "NORMAL"),
    "referral.returned": ("from_user_id", "ارجاع بازگشت داده شد: {contact_name}", "دلیل: {note}", "HIGH"),
    "referral.overdue": ("to_user_id", "ارجاع معوق: {contact_name}", "مهلت پذیرش این ارجاع گذشته است.", "HIGH"),
    "task.assigned": ("to_user_id", "وظیفه جدید: {title}", "برای لید {contact_name}", "NORMAL"),
    "task.due_soon": ("to_user_id", "موعد نزدیک: {title}", "موعد این وظیفه به‌زودی فرامی‌رسد.", "NORMAL"),
    "task.overdue": ("to_user_id", "وظیفه معوق: {title}", "موعد این وظیفه گذشته است.", "HIGH"),
    "opportunity.owner_changed": ("to_user_id", "مسئول پیگیری شدید: {contact_name}", "پیگیری این فرصت به شما سپرده شد.", "NORMAL"),
    "event.member_added": ("user_id", "عضویت در رویداد {event_name}", "شما به تیم رویداد {event_code} افزوده شدید.", "NORMAL"),
    "action_request.overdue": ("to_user_id", "درخواست اقدام معوق: {title}", "موعد این درخواست گذشته است.", "HIGH"),
}


def _fmt(template, payload):
    class _Safe(dict):
        def __missing__(self, key):
            return ""

    return template.format_map(_Safe({k: (v if v is not None else "") for k, v in payload.items()}))


def _link_for(payload):
    if payload.get("interaction_id"):
        return f"/leads/{payload['interaction_id']}"
    if payload.get("action_request_id"):
        return "/inbox?tab=actions"
    if payload.get("event_id"):
        return "/"
    return ""


def _user(uid):
    if not uid:
        return None
    return User.objects.filter(pk=uid, status=User.Status.ACTIVE).first()


def _rule_matches_scope(rule, payload):
    if rule.event_id and str(rule.event_id) != str(payload.get("event_id")):
        return False
    product_ids = {str(p) for p in payload.get("product_ids", [])}
    if rule.product_id and str(rule.product_id) not in product_ids:
        return False
    if rule.plan_id:
        plan_products = {str(p) for p in Product.objects.filter(plan_id=rule.plan_id).values_list("id", flat=True)}
        if not (plan_products & product_ids):
            return False
    return True


def _rule_recipients(rule, payload):
    if rule.recipient_type == NotificationRule.Recipient.DIRECT_ASSIGNEE:
        return [u for u in [_user(payload.get("to_user_id") or payload.get("user_id"))] if u]
    if rule.recipient_type == NotificationRule.Recipient.INITIATOR:
        return [u for u in [_user(payload.get("from_user_id"))] if u]
    event = Event.objects.filter(pk=payload.get("event_id")).first() if payload.get("event_id") else None
    if not event:
        return []
    if rule.recipient_type == NotificationRule.Recipient.EVENT_OWNER:
        return [event.owner] if event.owner and event.owner.is_active else []
    if rule.recipient_type == NotificationRule.Recipient.EVENT_ROLE and rule.recipient_role_id:
        ids = EventMembership.objects.filter(event=event, status="ACTIVE", roles=rule.recipient_role_id).values_list("user_id", flat=True)
        return list(User.objects.filter(pk__in=ids, status=User.Status.ACTIVE))
    return []


def _quiet_adjust(rule, when):
    if not (rule.quiet_hours_enabled and rule.quiet_start and rule.quiet_end):
        return when
    tz = ZoneInfo(settings.DISPLAY_TIME_ZONE)
    local = when.astimezone(tz)
    t = local.time()
    start, end = rule.quiet_start, rule.quiet_end
    in_quiet = (start <= t < end) if start < end else (t >= start or t < end)
    if not in_quiet:
        return when
    target = local.replace(hour=end.hour, minute=end.minute, second=0, microsecond=0)
    if target <= local:
        target += timedelta(days=1)
    return target.astimezone(ZoneInfo("UTC"))


def _context(payload, recipient):
    ctx = {k: v for k, v in payload.items() if isinstance(v, (str, int, float)) or v is None}
    ctx["recipient_name"] = recipient.full_name
    sender = _user(payload.get("from_user_id"))
    ctx["sender_name"] = sender.full_name if sender else ""
    if payload.get("event_id") and "event_name" not in ctx:
        event = Event.objects.filter(pk=payload["event_id"]).only("display_name", "code").first()
        if event:
            ctx["event_name"] = event.display_name
            ctx.setdefault("event_code", event.code)
    ctx["link"] = settings.APP_BASE_URL.rstrip("/") + _link_for(payload)
    # Never carry customer phone numbers or credentials into message context.
    for key in list(ctx):
        if any(s in key for s in ("mobile", "phone", "email", "password", "token", "secret")):
            ctx.pop(key)
    return ctx


def create_job(*, source, recipient, channel, dedup_key, context, scheduled_at=None, rule=None, campaign=None,
               outbox_event=None, event_type="", priority="NORMAL", max_attempts=3, subject="", body=""):
    try:
        with transaction.atomic():
            return NotificationJob.objects.create(
                source=source, recipient=recipient, channel=channel, dedup_key=dedup_key[:255], context=context,
                scheduled_at=scheduled_at or timezone.now(), rule=rule, campaign=campaign,
                outbox_event_id=getattr(outbox_event, "id", None), event_type=event_type, priority=priority,
                max_attempts=max_attempts, rendered_subject=subject[:200], rendered_body=body,
            )
    except IntegrityError:
        return None  # duplicate (idempotent)


def handle_event(event: OutboxEvent):
    payload = event.payload or {}
    jobs = []
    system = SYSTEM_IN_APP.get(event.event_type)
    if system:
        key, title_t, body_t, priority = system
        recipient = _user(payload.get(key))
        actor_is_recipient = recipient and event.actor_id and str(recipient.id) == str(event.actor_id)
        if recipient and not actor_is_recipient:
            ctx = _context(payload, recipient)
            job = create_job(
                source="SYSTEM", recipient=recipient, channel="IN_APP", dedup_key=f"sys:{event.correlation_id}:{recipient.id}",
                context=ctx, outbox_event=event, event_type=event.event_type, priority=priority,
                subject=_fmt(title_t, ctx), body=_fmt(body_t, ctx),
            )
            if job:
                jobs.append(job)

    for rule in NotificationRule.objects.filter(trigger=event.event_type, enabled=True).select_related("template"):
        if not _rule_matches_scope(rule, payload):
            continue
        for recipient in _rule_recipients(rule, payload):
            if event.actor_id and str(recipient.id) == str(event.actor_id) and rule.recipient_type != "EVENT_OWNER":
                continue
            ctx = _context(payload, recipient)
            when = _quiet_adjust(rule, timezone.now() + timedelta(minutes=rule.delay_minutes))
            dedup = f"rule:{rule.id}:{event.correlation_id}:{recipient.id}:{rule.channel}"
            if rule.cooldown_minutes:
                recent = NotificationJob.objects.filter(
                    rule=rule, recipient=recipient, created_at__gte=timezone.now() - timedelta(minutes=rule.cooldown_minutes),
                    context__interaction_id=payload.get("interaction_id"),
                ).exclude(status="SKIPPED").exists()
                if recent:
                    job = create_job(source="RULE", rule=rule, recipient=recipient, channel=rule.channel, dedup_key=dedup,
                                     context=ctx, outbox_event=event, event_type=event.event_type)
                    if job:
                        job.status = "SKIPPED"
                        job.skip_reason = "COOLDOWN"
                        job.save(update_fields=["status", "skip_reason"])
                    continue
            job = create_job(
                source="RULE", rule=rule, recipient=recipient, channel=rule.channel, dedup_key=dedup, context=ctx,
                scheduled_at=when, outbox_event=event, event_type=event.event_type, priority=rule.priority,
                max_attempts=rule.max_attempts,
                subject=render(rule.template.subject, ctx), body=render(rule.template.body, ctx),
            )
            if job:
                jobs.append(job)
    return jobs


def process_outbox(limit=200):
    processed = 0
    while processed < limit:
        with transaction.atomic():
            batch = list(
                OutboxEvent.objects.select_for_update(skip_locked=True)
                .filter(status__in=["PENDING", "FAILED"], attempts__lt=5)
                .order_by("occurred_at")[:50]
            )
            if not batch:
                break
            for event in batch:
                try:
                    with transaction.atomic():
                        handle_event(event)
                    event.status = "PROCESSED"
                    event.processed_at = timezone.now()
                except Exception as exc:  # noqa: BLE001
                    log.exception("outbox event %s failed", event.id)
                    event.attempts += 1
                    event.status = "DEAD" if event.attempts >= 5 else "FAILED"
                    event.last_error = str(exc)[:500]
                event.save()
                processed += 1
    process_jobs()
    return processed


def _provider_for(channel):
    qs = NotificationProvider.objects.filter(channel=channel).exclude(mode="DISABLED")
    return qs.filter(is_default=True).first() or qs.first()


def _pref_enabled(user, channel, event_type):
    prefs = NotificationPreference.objects.filter(user=user, channel=channel, event_type__in=[event_type, "*"])
    explicit = {p.event_type: p.enabled for p in prefs}
    if event_type in explicit:
        return explicit[event_type]
    return explicit.get("*", True)


def _finish(job, status, error="", skip_reason=""):
    job.status = status
    job.last_error = error[:500]
    job.skip_reason = skip_reason
    if status in ("SENT", "DELIVERED", "SIMULATED", "DEAD", "SKIPPED"):
        job.completed_at = timezone.now()
    job.save()


def run_job(job):
    job.attempts += 1
    if job.channel == "IN_APP":
        kind = "ACTION_REQUEST" if job.context.get("action_request_id") else ("INFORMATION" if job.source == "CAMPAIGN" else "SYSTEM_EVENT")
        Notification.objects.get_or_create(job=job, defaults={
            "recipient": job.recipient, "kind": kind, "title": job.rendered_subject or job.event_type,
            "body": job.rendered_body, "priority": job.priority, "link": _link_for(job.context),
            "event_type": job.event_type, "action_request_id": job.context.get("action_request_id"),
            "source_label": job.context.get("sender_name", "") or "سامانه",
        })
        _finish(job, "DELIVERED")
        return job

    if not _pref_enabled(job.recipient, job.channel, job.event_type):
        return _finish(job, "SKIPPED", skip_reason="PREFERENCE_DISABLED") or job
    address = job.recipient.mobile if job.channel == "SMS" else job.recipient.email
    if not address:
        return _finish(job, "SKIPPED", skip_reason="NO_ADDRESS") or job
    provider = _provider_for(job.channel)
    if not provider:
        return _finish(job, "SKIPPED", skip_reason="NO_PROVIDER") or job
    if provider.mode == "CONFIGURED":
        return _finish(job, "SKIPPED", skip_reason="PROVIDER_NOT_LIVE") or job

    rate = int((provider.config or {}).get("rate_limit_per_minute") or 0)
    if rate and DeliveryAttempt.objects.filter(provider=provider, created_at__gte=timezone.now() - timedelta(minutes=1)).count() >= rate:
        job.attempts -= 1
        job.scheduled_at = timezone.now() + timedelta(minutes=1)
        job.status = "PENDING"
        job.save()
        return job

    adapter = adapter_for(provider)
    attempt = DeliveryAttempt.objects.create(job=job, provider=provider, attempt_no=job.attempts, status="PENDING")
    html = render(job.rule.template.body_html, job.context, html=True) if job.rule_id and job.rule.template.body_html else ""
    try:
        result = deliver(adapter, job.channel, address, job.rendered_subject, job.rendered_body, html, job.dedup_key)
    except Exception as exc:  # noqa: BLE001 - adapter bugs must not break the worker
        log.exception("adapter crashed for job %s", job.id)
        from .providers import SendResult

        result = SendResult("FAILED", reason_code="ADAPTER_ERROR", summary=str(exc)[:200])
    attempt.status = result.status
    attempt.is_mock = result.is_mock
    attempt.provider_message_id = result.provider_message_id
    attempt.reason_code = result.reason_code
    attempt.response_summary = result.summary[:500]
    attempt.cost = result.cost if isinstance(result.cost, (int, float)) else None
    attempt.finished_at = timezone.now()
    attempt.save()
    if result.status in ("SENT", "SIMULATED", "UNKNOWN"):
        _finish(job, "SENT" if result.status == "UNKNOWN" else result.status)
    elif job.attempts >= job.max_attempts:
        _finish(job, "DEAD", error=f"{result.reason_code}: {result.summary}")
    else:
        job.status = "FAILED"
        job.last_error = f"{result.reason_code}: {result.summary}"[:500]
        job.scheduled_at = timezone.now() + timedelta(minutes=2 ** job.attempts)
        job.save()
    return job


def process_jobs(limit=200):
    done = 0
    while done < limit:
        with transaction.atomic():
            jobs = list(
                NotificationJob.objects.select_for_update(skip_locked=True, of=("self",))
                .filter(status__in=["PENDING", "FAILED"], scheduled_at__lte=timezone.now())
                .select_related("recipient", "rule__template")
                .order_by("scheduled_at")[:50]
            )
            if not jobs:
                break
            for job in jobs:
                job.status = "PROCESSING"
                job.save(update_fields=["status"])
        for job in jobs:
            try:
                run_job(job)
            except Exception as exc:  # noqa: BLE001
                log.exception("job %s failed", job.id)
                job.status = "FAILED"
                job.last_error = str(exc)[:500]
                job.scheduled_at = timezone.now() + timedelta(minutes=5)
                job.save()
            done += 1
    return done


def scan_due(now=None):
    """Emit idempotent due-soon / overdue events for tasks, referrals and action requests."""
    from apps.common.outbox import emit
    from apps.crm.models import Referral, Task

    from .models import ActionRequest

    now = now or timezone.now()
    count = 0
    with transaction.atomic():
        for task in Task.objects.filter(status="OPEN", due_at__isnull=False, due_at__lte=now + timedelta(hours=24)).select_related("interaction__contact"):
            kind = "task.overdue" if task.due_at <= now else "task.due_soon"
            if emit(kind, "task", task.id, {
                "task_id": str(task.id), "interaction_id": str(task.interaction_id), "event_id": str(task.interaction.event_id),
                "to_user_id": str(task.owner_id), "from_user_id": str(task.created_by_id), "title": task.title,
                "due_at": task.due_at.isoformat(), "contact_name": task.interaction.contact.full_name,
            }, correlation_id=f"{kind}:{task.id}:{task.due_at.isoformat()}"):
                count += 1
        for ref in Referral.objects.filter(status="PENDING", due_at__isnull=False, due_at__lte=now).select_related("interaction__contact"):
            if emit("referral.overdue", "referral", ref.id, {
                "referral_id": str(ref.id), "interaction_id": str(ref.interaction_id), "event_id": str(ref.event_id),
                "to_user_id": str(ref.to_user_id), "from_user_id": str(ref.from_user_id),
                "contact_name": ref.interaction.contact.full_name,
            }, correlation_id=f"referral.overdue:{ref.id}:{ref.due_at.isoformat()}"):
                count += 1
        for ar in ActionRequest.objects.filter(status__in=["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"], due_at__isnull=False, due_at__lte=now):
            if emit("action_request.overdue", "action_request", ar.id, {
                "action_request_id": str(ar.id), "to_user_id": str(ar.assignee_id), "from_user_id": str(ar.requested_by_id),
                "title": ar.subject,
            }, correlation_id=f"action_request.overdue:{ar.id}:{ar.due_at.isoformat()}"):
                count += 1
    return count


def provider_mode_label(provider):
    return dict(NotificationProvider.Mode.choices)[provider.mode]
