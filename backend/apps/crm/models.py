import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.common.models import UUIDModel, VersionedModel

USER = settings.AUTH_USER_MODEL


class RecordStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "فعال"
    MERGED = "MERGED", "ادغام‌شده"
    ARCHIVED = "ARCHIVED", "بایگانی"


class Account(VersionedModel):
    """Master organization record, shared across events."""

    name = models.CharField(max_length=255)
    name_normalized = models.CharField(max_length=255, db_index=True)
    official_name = models.CharField(max_length=255, blank=True)
    alt_name = models.CharField(max_length=255, blank=True)
    industry = models.CharField(max_length=120, blank=True)
    org_type = models.CharField(max_length=60, blank=True)
    city = models.CharField(max_length=80, blank=True)
    website = models.CharField(max_length=255, blank=True)
    legal_id = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=10, choices=RecordStatus.choices, default=RecordStatus.ACTIVE, db_index=True)
    merged_into = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    provenance = models.JSONField(default=dict, blank=True, help_text="field -> {by, at, source}")
    created_by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")
    updated_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "accounts"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Contact(VersionedModel):
    """Master person record. Mobile is normalized to +98 format for de-duplication."""

    full_name = models.CharField(max_length=200)
    name_normalized = models.CharField(max_length=200, db_index=True)
    mobile = models.CharField(max_length=20, blank=True, db_index=True)
    mobile_raw = models.CharField(max_length=40, blank=True)
    email = models.CharField(max_length=254, blank=True, db_index=True)
    title = models.CharField(max_length=120, blank=True)
    alt_phone = models.CharField(max_length=30, blank=True)
    primary_account = models.ForeignKey(Account, null=True, blank=True, on_delete=models.SET_NULL, related_name="contacts")
    contact_preference = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=10, choices=RecordStatus.choices, default=RecordStatus.ACTIVE, db_index=True)
    merged_into = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    provenance = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")
    updated_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "contacts"
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name


class ContactAccountAffiliation(UUIDModel):
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE, related_name="affiliations")
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="affiliations")
    role_title = models.CharField(max_length=120, blank=True)
    is_primary = models.BooleanField(default=False)
    source = models.CharField(max_length=40, default="CAPTURE")

    class Meta:
        db_table = "contact_account_affiliations"
        constraints = [models.UniqueConstraint(fields=["contact", "account"], name="uniq_affiliation")]


class ContactConsent(UUIDModel):
    """Future customer-messaging extension point. Customer sends are disabled in this phase."""

    contact = models.ForeignKey(Contact, on_delete=models.CASCADE, related_name="consents")
    channel = models.CharField(max_length=10, choices=[("SMS", "SMS"), ("EMAIL", "EMAIL")])
    purpose = models.CharField(max_length=40, default="CATALOG")
    status = models.CharField(max_length=12, choices=[("GRANTED", "GRANTED"), ("WITHDRAWN", "WITHDRAWN"), ("SUPPRESSED", "SUPPRESSED")])
    legal_basis = models.CharField(max_length=60, blank=True)
    source = models.CharField(max_length=60, blank=True)
    recorded_by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "contact_consents"


class Quality(models.TextChoices):
    SERIOUS = "SERIOUS", "جدی"
    FOLLOW_UP = "FOLLOW_UP", "قابل‌پیگیری"
    INTRO = "INTRO", "آشنایی"


class Interaction(VersionedModel):
    """A booth conversation at a specific event. Captured fields are immutable snapshots."""

    class Status(models.TextChoices):
        CAPTURED = "CAPTURED", "ثبت‌شده"
        REVIEWED = "REVIEWED", "بررسی‌شده"
        ARCHIVED = "ARCHIVED", "بایگانی"

    event = models.ForeignKey("catalog.Event", on_delete=models.PROTECT, related_name="interactions")
    event_code = models.CharField(max_length=40, editable=False)
    created_by = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="captured_interactions")
    captured_at = models.DateTimeField(db_index=True)
    received_at = models.DateTimeField(auto_now_add=True)
    client_record_id = models.UUIDField(default=uuid.uuid4)
    captured_offline = models.BooleanField(default=False)
    contact = models.ForeignKey(Contact, on_delete=models.PROTECT, related_name="interactions")
    account = models.ForeignKey(Account, null=True, blank=True, on_delete=models.PROTECT, related_name="interactions")
    # Immutable snapshot of what was typed at the booth (provenance).
    captured_contact_name = models.CharField(max_length=200)
    captured_mobile = models.CharField(max_length=40, blank=True)
    captured_email = models.CharField(max_length=254, blank=True)
    captured_org_name = models.CharField(max_length=255, blank=True)
    quality = models.CharField(max_length=10, choices=Quality.choices, default=Quality.FOLLOW_UP, db_index=True)
    note = models.TextField(blank=True, max_length=2000)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.CAPTURED, db_index=True)
    triage_owner = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="triage_interactions")
    products = models.ManyToManyField("catalog.Product", through="InteractionProduct", related_name="interactions")
    updated_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "interactions"
        ordering = ["-captured_at"]
        constraints = [models.UniqueConstraint(fields=["created_by", "client_record_id"], name="uniq_interaction_idempotency")]
        indexes = [models.Index(fields=["event", "captured_at"])]


class InteractionProduct(UUIDModel):
    interaction = models.ForeignKey(Interaction, on_delete=models.CASCADE, related_name="product_links")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT)
    product_code = models.CharField(max_length=40)

    class Meta:
        db_table = "interaction_products"
        constraints = [models.UniqueConstraint(fields=["interaction", "product"], name="uniq_interaction_product")]


class Opportunity(VersionedModel):
    """Follow-up-worthy commercial case, created only by explicit qualification."""

    class Stage(models.TextChoices):
        QUALIFIED = "QUALIFIED", "واجد شرایط"
        ASSIGNED = "ASSIGNED", "تخصیص‌یافته"
        FOLLOW_UP = "FOLLOW_UP", "در حال پیگیری"
        WON = "WON", "موفق"
        LOST = "LOST", "ناموفق"
        NURTURE = "NURTURE", "پرورش"

    TRANSITIONS = {
        "QUALIFIED": {"ASSIGNED", "FOLLOW_UP", "NURTURE", "WON", "LOST"},
        "ASSIGNED": {"QUALIFIED", "FOLLOW_UP", "NURTURE", "WON", "LOST"},
        "FOLLOW_UP": {"ASSIGNED", "NURTURE", "WON", "LOST"},
        "NURTURE": {"ASSIGNED", "FOLLOW_UP", "LOST"},
        "WON": {"FOLLOW_UP"},
        "LOST": {"FOLLOW_UP", "NURTURE"},
    }

    class Urgency(models.TextChoices):
        LOW = "LOW", "کم"
        MEDIUM = "MEDIUM", "متوسط"
        HIGH = "HIGH", "زیاد"

    source_interaction = models.OneToOneField(Interaction, on_delete=models.PROTECT, related_name="opportunity")
    origin_event = models.ForeignKey("catalog.Event", on_delete=models.PROTECT, related_name="opportunities")
    account = models.ForeignKey(Account, null=True, blank=True, on_delete=models.PROTECT, related_name="opportunities")
    contact = models.ForeignKey(Contact, on_delete=models.PROTECT, related_name="opportunities")
    stage = models.CharField(max_length=10, choices=Stage.choices, default=Stage.QUALIFIED, db_index=True)
    owner = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="owned_opportunities")
    qualified_by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")
    qualified_at = models.DateTimeField(null=True)
    business_problem = models.TextField(blank=True)
    use_case = models.TextField(blank=True)
    urgency = models.CharField(max_length=8, choices=Urgency.choices, blank=True)
    decision_role = models.CharField(max_length=120, blank=True)
    stakeholders = models.TextField(blank=True)
    size_estimate = models.CharField(max_length=120, blank=True)
    readiness = models.CharField(max_length=120, blank=True)
    blockers = models.TextField(blank=True)
    next_step = models.CharField(max_length=255, blank=True)
    next_step_due_at = models.DateTimeField(null=True, blank=True)
    outcome_note = models.TextField(blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    products = models.ManyToManyField("catalog.Product", through="OpportunityProduct", related_name="opportunities")
    linked_interactions = models.ManyToManyField(Interaction, blank=True, related_name="linked_opportunities", db_table="opportunity_interactions")
    provenance = models.JSONField(default=dict, blank=True)
    updated_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "opportunities"
        ordering = ["-created_at"]


class OpportunityProduct(UUIDModel):
    opportunity = models.ForeignKey(Opportunity, on_delete=models.CASCADE, related_name="product_links")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT)

    class Meta:
        db_table = "opportunity_products"
        constraints = [models.UniqueConstraint(fields=["opportunity", "product"], name="uniq_opportunity_product")]


class OpportunityCollaborator(UUIDModel):
    opportunity = models.ForeignKey(Opportunity, on_delete=models.CASCADE, related_name="collaborators")
    user = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="+")
    added_by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "opportunity_collaborators"
        constraints = [models.UniqueConstraint(fields=["opportunity", "user"], name="uniq_collaborator")]


class Referral(UUIDModel):
    class Status(models.TextChoices):
        PENDING = "PENDING", "در انتظار پذیرش"
        ACCEPTED = "ACCEPTED", "پذیرفته‌شده"
        RETURNED = "RETURNED", "بازگشتی"
        CANCELED = "CANCELED", "لغوشده"

    class Purpose(models.TextChoices):
        QUALIFICATION = "QUALIFICATION", "ارزیابی"
        FOLLOW_UP = "FOLLOW_UP", "پیگیری"

    interaction = models.ForeignKey(Interaction, on_delete=models.PROTECT, related_name="referrals")
    opportunity = models.ForeignKey(Opportunity, null=True, blank=True, on_delete=models.PROTECT, related_name="referrals")
    event = models.ForeignKey("catalog.Event", on_delete=models.PROTECT, related_name="referrals")
    purpose = models.CharField(max_length=14, choices=Purpose.choices, default=Purpose.FOLLOW_UP)
    from_user = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="referrals_sent")
    to_user = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="referrals_received")
    reason = models.TextField(blank=True)
    product_codes = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    due_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    response_note = models.TextField(blank=True)
    replaced_by = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "referrals"
        ordering = ["-created_at"]


class Activity(models.Model):
    """Append-only timeline of a lead."""

    class Type(models.TextChoices):
        CAPTURED = "CAPTURED", "ثبت در غرفه"
        CORRECTED = "CORRECTED", "اصلاح ثبت"
        NOTE = "NOTE", "یادداشت"
        CALL = "CALL", "تماس"
        MEETING = "MEETING", "جلسه"
        QUALIFIED = "QUALIFIED", "ارزیابی و ایجاد فرصت"
        ENRICHED = "ENRICHED", "تکمیل اطلاعات"
        STAGE_CHANGED = "STAGE_CHANGED", "تغییر مرحله"
        OWNER_CHANGED = "OWNER_CHANGED", "تغییر مسئول پیگیری"
        REFERRAL_CREATED = "REFERRAL_CREATED", "ارجاع"
        REFERRAL_ACCEPTED = "REFERRAL_ACCEPTED", "پذیرش ارجاع"
        REFERRAL_RETURNED = "REFERRAL_RETURNED", "بازگشت ارجاع"
        REFERRAL_CANCELED = "REFERRAL_CANCELED", "لغو ارجاع"
        TASK_CREATED = "TASK_CREATED", "تعریف وظیفه"
        TASK_COMPLETED = "TASK_COMPLETED", "انجام وظیفه"
        TAG_APPLIED = "TAG_APPLIED", "افزودن برچسب"
        TAG_REMOVED = "TAG_REMOVED", "حذف برچسب"
        MERGED = "MERGED", "ادغام مخاطب"
        STATUS_CHANGED = "STATUS_CHANGED", "تغییر وضعیت"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    interaction = models.ForeignKey(Interaction, on_delete=models.CASCADE, related_name="activities")
    opportunity = models.ForeignKey(Opportunity, null=True, blank=True, on_delete=models.CASCADE, related_name="activities")
    type = models.CharField(max_length=20, choices=Type.choices, db_index=True)
    actor = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")
    notes = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "activities"
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("Activities are append-only")
        super().save(*args, **kwargs)


class Task(VersionedModel):
    class Status(models.TextChoices):
        OPEN = "OPEN", "باز"
        DONE = "DONE", "انجام‌شده"
        CANCELLED = "CANCELLED", "لغوشده"

    interaction = models.ForeignKey(Interaction, on_delete=models.CASCADE, related_name="tasks")
    opportunity = models.ForeignKey(Opportunity, null=True, blank=True, on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="tasks")
    created_by = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="+")
    due_at = models.DateTimeField(null=True, blank=True, db_index=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN, db_index=True)
    outcome = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "tasks"
        ordering = ["due_at", "-created_at"]


class Tag(VersionedModel):
    COLORS = ["slate", "indigo", "violet", "blue", "teal", "green", "amber", "rose"]

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "فعال"
        ARCHIVED = "ARCHIVED", "بایگانی"

    code = models.SlugField(max_length=60, unique=True)
    name_fa = models.CharField(max_length=60)
    name_en = models.CharField(max_length=60, blank=True)
    name_normalized = models.CharField(max_length=60)
    description = models.CharField(max_length=255, blank=True)
    color = models.CharField(max_length=12, default="slate")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    created_by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "tags"
        ordering = ["sort_order", "name_fa"]
        constraints = [
            models.UniqueConstraint(fields=["name_normalized"], condition=Q(status="ACTIVE"), name="uniq_active_tag_name"),
        ]


class OpportunityTag(models.Model):
    """Canonical tagging target is the opportunity (qualified lead). See ADR-0004."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    opportunity = models.ForeignKey(Opportunity, on_delete=models.CASCADE, related_name="tag_links")
    tag = models.ForeignKey(Tag, on_delete=models.PROTECT, related_name="opportunity_links")
    created_by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "opportunity_tags"
        constraints = [models.UniqueConstraint(fields=["opportunity", "tag"], name="uniq_opportunity_tag")]


class DuplicateCandidate(UUIDModel):
    class MatchType(models.TextChoices):
        EXACT_PHONE = "EXACT_PHONE", "شماره یکسان"
        EXACT_EMAIL = "EXACT_EMAIL", "ایمیل یکسان"
        FUZZY_NAME = "FUZZY_NAME", "نام مشابه"

    class Status(models.TextChoices):
        OPEN = "OPEN", "باز"
        MERGED = "MERGED", "ادغام‌شده"
        DISMISSED = "DISMISSED", "رد شده"

    entity_type = models.CharField(max_length=10, choices=[("CONTACT", "CONTACT"), ("ACCOUNT", "ACCOUNT")])
    existing_id = models.UUIDField()
    candidate_id = models.UUIDField()
    match_type = models.CharField(max_length=12, choices=MatchType.choices)
    score = models.FloatField(default=1.0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN, db_index=True)
    resolved_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "duplicate_candidates"
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["entity_type", "existing_id", "candidate_id"], name="uniq_duplicate_pair")]


class MergeRecord(UUIDModel):
    entity_type = models.CharField(max_length=10)
    survivor_id = models.UUIDField()
    merged_id = models.UUIDField()
    moved_refs = models.JSONField(default=dict, help_text="table -> [ids] moved to survivor; enables revert")
    performed_by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")
    reverted_at = models.DateTimeField(null=True, blank=True)
    reverted_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "merge_records"
        ordering = ["-created_at"]


class SyncQuarantine(UUIDModel):
    """Offline captures that could not be accepted automatically (e.g. event closed beyond grace)."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "در انتظار بازبینی"
        APPROVED = "APPROVED", "تأییدشده"
        REJECTED = "REJECTED", "ردشده"

    event = models.ForeignKey("catalog.Event", on_delete=models.PROTECT, related_name="+")
    user = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="+")
    client_record_id = models.UUIDField()
    payload = models.JSONField()
    reason = models.CharField(max_length=60)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    resolved_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.TextField(blank=True)
    interaction = models.ForeignKey(Interaction, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "sync_quarantine"
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["user", "client_record_id"], name="uniq_quarantine_record")]
