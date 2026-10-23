"""Transactional outbox. Domain code calls emit() inside its transaction; the
event is dispatched only after commit, so notification failure can never roll
back the business change that produced it."""
import logging
import uuid

from django.conf import settings
from django.db import IntegrityError, transaction

from .models import OutboxEvent

log = logging.getLogger(__name__)

EVENT_TYPES = {
    "interaction.captured": "ثبت تعامل جدید",
    "referral.created": "ارجاع جدید",
    "referral.reassigned": "ارجاع مجدد",
    "referral.accepted": "پذیرش ارجاع",
    "referral.returned": "بازگشت ارجاع",
    "task.assigned": "تخصیص وظیفه",
    "task.due_soon": "نزدیک شدن موعد وظیفه",
    "task.overdue": "سررسید گذشته وظیفه",
    "event.member_added": "افزودن عضو به رویداد",
    "event.activated": "فعال‌سازی رویداد",
    "event.closed": "پایان رویداد",
    "opportunity.qualified": "واجد شرایط شدن فرصت",
    "opportunity.owner_changed": "تغییر مسئول پیگیری",
    "action_request.created": "درخواست اقدام",
}


def emit(event_type, aggregate_type, aggregate_id, payload, actor=None, correlation_id=None):
    correlation_id = correlation_id or f"{event_type}:{aggregate_id}:{uuid.uuid4()}"
    try:
        with transaction.atomic():
            event = OutboxEvent.objects.create(
                event_type=event_type,
                aggregate_type=aggregate_type,
                aggregate_id=str(aggregate_id),
                payload=payload,
                correlation_id=correlation_id,
                actor_id=getattr(actor, "id", None),
            )
    except IntegrityError:
        # Same correlation id already emitted: idempotent no-op.
        return None
    transaction.on_commit(_dispatch_after_commit)
    return event


def _dispatch_after_commit():
    if getattr(settings, "OUTBOX_INLINE_DISPATCH", True) is False:
        return
    try:
        if settings.CELERY_ENABLED:
            from apps.notify.tasks import process_outbox_task

            process_outbox_task.delay()
        else:
            from apps.notify.engine import process_outbox

            process_outbox()
    except Exception:  # noqa: BLE001 - dispatch must never surface to the caller
        log.exception("Outbox dispatch failed; events stay PENDING for the worker")
