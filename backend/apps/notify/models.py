import uuid

from django.conf import settings
from django.db import models

from apps.common.models import UUIDModel, VersionedModel

USER = settings.AUTH_USER_MODEL


class Channel(models.TextChoices):
    IN_APP = "IN_APP", "درون‌برنامه"
    SMS = "SMS", "پیامک"
    EMAIL = "EMAIL", "ایمیل"


class Priority(models.TextChoices):
    LOW = "LOW", "کم"
    NORMAL = "NORMAL", "عادی"
    HIGH = "HIGH", "زیاد"
    URGENT = "URGENT", "فوری"


class NotificationProvider(VersionedModel):
    class Adapter(models.TextChoices):
        MOCK_SMS = "MOCK_SMS", "پیامک شبیه‌سازی (Mock)"
        HTTP_SMS = "HTTP_SMS", "درگاه پیامک HTTP عمومی"
        MOCK_EMAIL = "MOCK_EMAIL", "ایمیل شبیه‌سازی (Mock)"
        SMTP = "SMTP", "سرور ایمیل سازمانی (SMTP)"

    class Mode(models.TextChoices):
        DISABLED = "DISABLED", "غیرفعال"
        MOCK = "MOCK", "شبیه‌سازی"
        CONFIGURED = "CONFIGURED", "پیکربندی‌شده (بدون ارسال واقعی)"
        LIVE = "LIVE", "ارسال واقعی"

    name = models.CharField(max_length=120)
    channel = models.CharField(max_length=6, choices=[("SMS", "SMS"), ("EMAIL", "EMAIL")])
    adapter = models.CharField(max_length=12, choices=Adapter.choices)
    mode = models.CharField(max_length=10, choices=Mode.choices, default=Mode.DISABLED)
    config = models.JSONField(default=dict, blank=True, help_text="Non-secret settings only")
    secret_encrypted = models.TextField(blank=True)
    is_default = models.BooleanField(default=False)
    last_test_at = models.DateTimeField(null=True, blank=True)
    last_test_ok = models.BooleanField(null=True)
    last_test_message = models.CharField(max_length=500, blank=True)
    live_verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notification_providers"
        ordering = ["channel", "name"]


class ProviderHealthCheck(UUIDModel):
    provider = models.ForeignKey(NotificationProvider, on_delete=models.CASCADE, related_name="health_checks")
    kind = models.CharField(max_length=20, default="CONNECTION")
    ok = models.BooleanField()
    code = models.CharField(max_length=40)
    message = models.CharField(max_length=500, blank=True)
    latency_ms = models.PositiveIntegerField(null=True)
    performed_by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "provider_health_checks"
        ordering = ["-created_at"]


class NotificationTemplate(VersionedModel):
    code = models.SlugField(max_length=60, unique=True)
    name = models.CharField(max_length=120)
    channel = models.CharField(max_length=6, choices=Channel.choices)
    subject = models.CharField(max_length=200, blank=True)
    body = models.TextField(help_text="Plain text with {{variable}} placeholders (allowlisted)")
    body_html = models.TextField(blank=True)
    locale = models.CharField(max_length=5, default="fa")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "notification_templates"
        ordering = ["channel", "name"]


class NotificationRule(VersionedModel):
    class Recipient(models.TextChoices):
        DIRECT_ASSIGNEE = "DIRECT_ASSIGNEE", "گیرنده مستقیم"
        INITIATOR = "INITIATOR", "آغازگر"
        EVENT_OWNER = "EVENT_OWNER", "مسئول رویداد"
        EVENT_ROLE = "EVENT_ROLE", "نقش در رویداد"

    name = models.CharField(max_length=160)
    trigger = models.CharField(max_length=80, db_index=True)
    recipient_type = models.CharField(max_length=16, choices=Recipient.choices, default=Recipient.DIRECT_ASSIGNEE)
    recipient_role = models.ForeignKey("iam.Role", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    event = models.ForeignKey("catalog.Event", null=True, blank=True, on_delete=models.CASCADE, related_name="+")
    plan = models.ForeignKey("catalog.Plan", null=True, blank=True, on_delete=models.CASCADE, related_name="+")
    product = models.ForeignKey("catalog.Product", null=True, blank=True, on_delete=models.CASCADE, related_name="+")
    channel = models.CharField(max_length=6, choices=Channel.choices)
    template = models.ForeignKey(NotificationTemplate, on_delete=models.PROTECT, related_name="rules")
    delay_minutes = models.PositiveIntegerField(default=0)
    quiet_hours_enabled = models.BooleanField(default=False)
    quiet_start = models.TimeField(null=True, blank=True)
    quiet_end = models.TimeField(null=True, blank=True)
    cooldown_minutes = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=3)
    priority = models.CharField(max_length=6, choices=Priority.choices, default=Priority.NORMAL)
    enabled = models.BooleanField(default=True)
    created_by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "notification_rules"
        ordering = ["trigger", "name"]


class NotificationCampaign(UUIDModel):
    """Manually initiated message or action request (one-off or scheduled)."""

    class Kind(models.TextChoices):
        INFORMATION = "INFORMATION", "اطلاع‌رسانی"
        ACTION_REQUEST = "ACTION_REQUEST", "درخواست اقدام"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "پیش‌نویس"
        SCHEDULED = "SCHEDULED", "زمان‌بندی‌شده"
        SENT = "SENT", "ارسال‌شده"
        CANCELLED = "CANCELLED", "لغوشده"

    kind = models.CharField(max_length=16, choices=Kind.choices)
    subject = models.CharField(max_length=200)
    body = models.TextField()
    priority = models.CharField(max_length=6, choices=Priority.choices, default=Priority.NORMAL)
    targeting = models.JSONField(default=dict)
    channels = models.JSONField(default=list)
    action_type = models.CharField(max_length=20, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    related_interaction = models.ForeignKey("crm.Interaction", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    scheduled_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT, db_index=True)
    recipient_count = models.PositiveIntegerField(default=0)
    idempotency_key = models.CharField(max_length=80, unique=True)
    created_by = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="+")
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notification_campaigns"
        ordering = ["-created_at"]


class NotificationRecipient(UUIDModel):
    campaign = models.ForeignKey(NotificationCampaign, on_delete=models.CASCADE, related_name="recipients")
    user = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="+")

    class Meta:
        db_table = "notification_recipients"
        constraints = [models.UniqueConstraint(fields=["campaign", "user"], name="uniq_campaign_recipient")]


class ActionRequest(VersionedModel):
    class Type(models.TextChoices):
        ACKNOWLEDGE = "ACKNOWLEDGE", "تأیید دریافت"
        ACCEPT_REFERRAL = "ACCEPT_REFERRAL", "پذیرش ارجاع"
        REVIEW = "REVIEW", "بازبینی"
        UPDATE_LEAD = "UPDATE_LEAD", "به‌روزرسانی لید"
        CALL_CONTACT = "CALL_CONTACT", "تماس با مخاطب"
        SCHEDULE_MEETING = "SCHEDULE_MEETING", "هماهنگی جلسه"
        UPLOAD_REPORT = "UPLOAD_REPORT", "ارائه گزارش"
        CUSTOM_ALLOWED = "CUSTOM_ALLOWED", "سایر"

    class Status(models.TextChoices):
        OPEN = "OPEN", "باز"
        ACKNOWLEDGED = "ACKNOWLEDGED", "دیده‌شده"
        IN_PROGRESS = "IN_PROGRESS", "در حال انجام"
        DONE = "DONE", "انجام‌شده"
        RETURNED = "RETURNED", "بازگشتی"
        CANCELLED = "CANCELLED", "لغوشده"

    TRANSITIONS = {
        "OPEN": {"ACKNOWLEDGED", "IN_PROGRESS", "DONE", "RETURNED", "CANCELLED"},
        "ACKNOWLEDGED": {"IN_PROGRESS", "DONE", "RETURNED", "CANCELLED"},
        "IN_PROGRESS": {"DONE", "RETURNED", "CANCELLED"},
        "RETURNED": {"OPEN", "CANCELLED"},
        "DONE": {"IN_PROGRESS"},
        "CANCELLED": set(),
    }

    campaign = models.ForeignKey(NotificationCampaign, null=True, blank=True, on_delete=models.SET_NULL, related_name="action_requests")
    assignee = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="action_requests")
    requested_by = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="+")
    action_type = models.CharField(max_length=20, choices=Type.choices)
    subject = models.CharField(max_length=200)
    instructions = models.TextField(blank=True)
    related_interaction = models.ForeignKey("crm.Interaction", null=True, blank=True, on_delete=models.SET_NULL, related_name="action_requests")
    due_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.OPEN, db_index=True)
    status_changed_at = models.DateTimeField(auto_now_add=True)
    priority = models.CharField(max_length=6, choices=Priority.choices, default=Priority.NORMAL)

    class Meta:
        db_table = "action_requests"
        ordering = ["status", "due_at", "-created_at"]


class ActionCompletion(UUIDModel):
    action_request = models.ForeignKey(ActionRequest, on_delete=models.CASCADE, related_name="history")
    actor = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")
    from_status = models.CharField(max_length=12)
    to_status = models.CharField(max_length=12)
    note = models.TextField(blank=True)

    class Meta:
        db_table = "action_completions"
        ordering = ["created_at"]


class NotificationPreference(UUIDModel):
    user = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="notification_preferences")
    channel = models.CharField(max_length=6, choices=Channel.choices)
    event_type = models.CharField(max_length=80, default="*")
    enabled = models.BooleanField(default=True)

    class Meta:
        db_table = "notification_preferences"
        constraints = [models.UniqueConstraint(fields=["user", "channel", "event_type"], name="uniq_pref")]


class NotificationJob(UUIDModel):
    class Source(models.TextChoices):
        RULE = "RULE", "قاعده"
        CAMPAIGN = "CAMPAIGN", "پیام دستی"
        SYSTEM = "SYSTEM", "سیستمی"

    class Status(models.TextChoices):
        PENDING = "PENDING", "در صف"
        PROCESSING = "PROCESSING", "در حال پردازش"
        SENT = "SENT", "ارسال‌شده"
        DELIVERED = "DELIVERED", "تحویل‌شده"
        SIMULATED = "SIMULATED", "شبیه‌سازی‌شده (بدون ارسال واقعی)"
        FAILED = "FAILED", "ناموفق (تلاش مجدد)"
        DEAD = "DEAD", "ناموفق نهایی"
        SKIPPED = "SKIPPED", "رد شده"

    source = models.CharField(max_length=10, choices=Source.choices)
    rule = models.ForeignKey(NotificationRule, null=True, blank=True, on_delete=models.SET_NULL, related_name="jobs")
    campaign = models.ForeignKey(NotificationCampaign, null=True, blank=True, on_delete=models.SET_NULL, related_name="jobs")
    outbox_event_id = models.UUIDField(null=True, blank=True)
    event_type = models.CharField(max_length=80, blank=True)
    recipient = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="+")
    channel = models.CharField(max_length=6, choices=Channel.choices)
    priority = models.CharField(max_length=6, choices=Priority.choices, default=Priority.NORMAL)
    context = models.JSONField(default=dict)
    dedup_key = models.CharField(max_length=255, unique=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING, db_index=True)
    scheduled_at = models.DateTimeField(db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=3)
    last_error = models.CharField(max_length=500, blank=True)
    skip_reason = models.CharField(max_length=60, blank=True)
    rendered_subject = models.CharField(max_length=200, blank=True)
    rendered_body = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notification_jobs"
        ordering = ["-created_at"]


class DeliveryAttempt(UUIDModel):
    class Status(models.TextChoices):
        PENDING = "PENDING"
        SENT = "SENT"
        DELIVERED = "DELIVERED"
        FAILED = "FAILED"
        UNKNOWN = "UNKNOWN"
        SIMULATED = "SIMULATED"

    job = models.ForeignKey(NotificationJob, on_delete=models.CASCADE, related_name="attempts_log")
    provider = models.ForeignKey(NotificationProvider, null=True, on_delete=models.SET_NULL, related_name="attempts")
    attempt_no = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=10, choices=Status.choices)
    is_mock = models.BooleanField(default=False)
    provider_message_id = models.CharField(max_length=120, blank=True)
    reason_code = models.CharField(max_length=60, blank=True)
    response_summary = models.CharField(max_length=500, blank=True)
    cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notification_delivery_attempts"
        ordering = ["-created_at"]


class Notification(models.Model):
    """In-app inbox item. A notification never changes the state of a task or referral."""

    class Kind(models.TextChoices):
        INFORMATION = "INFORMATION", "اطلاع‌رسانی"
        ACTION_REQUEST = "ACTION_REQUEST", "درخواست اقدام"
        SYSTEM_EVENT = "SYSTEM_EVENT", "رویداد سیستمی"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="notifications")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    priority = models.CharField(max_length=6, choices=Priority.choices, default=Priority.NORMAL)
    link = models.CharField(max_length=300, blank=True)
    source_label = models.CharField(max_length=120, blank=True)
    event_type = models.CharField(max_length=80, blank=True)
    action_request = models.ForeignKey(ActionRequest, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    job = models.OneToOneField(NotificationJob, null=True, blank=True, on_delete=models.SET_NULL, related_name="in_app")
    read_at = models.DateTimeField(null=True, blank=True)
    snoozed_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "notifications"
        ordering = ["-created_at"]
