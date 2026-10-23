from django.conf import settings
from django.db import models

from apps.common.models import UUIDModel, VersionedModel


class Plan(VersionedModel):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "فعال"
        ARCHIVED = "ARCHIVED", "بایگانی"

    code = models.SlugField(max_length=40, unique=True, help_text="Immutable stable code")
    name_fa = models.CharField(max_length=160)
    name_en = models.CharField(max_length=160, blank=True)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE, db_index=True)

    class Meta:
        db_table = "plans"
        ordering = ["name_fa"]

    def __str__(self):
        return self.name_fa


class Product(VersionedModel):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "فعال"
        ARCHIVED = "ARCHIVED", "بایگانی"

    code = models.SlugField(max_length=40, unique=True, help_text="Immutable stable code")
    name_fa = models.CharField(max_length=160)
    name_en = models.CharField(max_length=160, blank=True)
    description = models.TextField(blank=True)
    plan = models.ForeignKey(Plan, null=True, blank=True, on_delete=models.PROTECT, related_name="products")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    owners = models.ManyToManyField(settings.AUTH_USER_MODEL, through="ProductOwner", related_name="owned_products", blank=True)

    class Meta:
        db_table = "products"
        ordering = ["name_fa"]

    def __str__(self):
        return self.name_fa


class ProductOwner(UUIDModel):
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    class Meta:
        db_table = "product_owners"
        constraints = [models.UniqueConstraint(fields=["product", "user"], name="uniq_product_owner")]


class Event(VersionedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "پیش‌نویس"
        READY = "READY", "آماده"
        ACTIVE = "ACTIVE", "فعال"
        CLOSED = "CLOSED", "پایان‌یافته"
        ARCHIVED = "ARCHIVED", "بایگانی"

    # Allowed lifecycle transitions (see docs/domain-state-machines.md).
    TRANSITIONS = {
        "DRAFT": {"READY", "ARCHIVED"},
        "READY": {"DRAFT", "ACTIVE", "ARCHIVED"},
        "ACTIVE": {"CLOSED"},
        "CLOSED": {"ACTIVE", "ARCHIVED"},
        "ARCHIVED": {"CLOSED"},
    }

    code = models.SlugField(max_length=40, unique=True, help_text="Immutable event code")
    display_name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    city = models.CharField(max_length=80, blank=True)
    venue = models.CharField(max_length=160, blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    timezone = models.CharField(max_length=40, default="Asia/Tehran")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT, db_index=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="owned_events")
    sync_grace_hours = models.PositiveSmallIntegerField(default=24, help_text="Offline captures synced within this window after closure are accepted")
    referral_sla_hours = models.PositiveSmallIntegerField(null=True, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    cloned_from = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "events"
        ordering = ["-starts_at"]

    def __str__(self):
        return f"{self.display_name} ({self.code})"


class EventProduct(UUIDModel):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="event_products")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="event_links")
    default_owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "event_products"
        ordering = ["sort_order", "product__name_fa"]
        constraints = [models.UniqueConstraint(fields=["event", "product"], name="uniq_event_product")]


class EventMembership(UUIDModel):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "فعال"
        REMOVED = "REMOVED", "خارج‌شده"

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="memberships")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    roles = models.ManyToManyField("iam.Role", through="MembershipRole", related_name="+", blank=True)
    allowed_plans = models.ManyToManyField(Plan, blank=True, related_name="+", db_table="membership_allowed_plans")
    allowed_products = models.ManyToManyField(Product, blank=True, related_name="+", db_table="membership_allowed_products")
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)
    added_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "event_memberships"
        constraints = [models.UniqueConstraint(fields=["event", "user"], name="uniq_event_member")]


class MembershipRole(UUIDModel):
    membership = models.ForeignKey(EventMembership, on_delete=models.CASCADE)
    role = models.ForeignKey("iam.Role", on_delete=models.PROTECT)

    class Meta:
        db_table = "membership_roles"
        constraints = [models.UniqueConstraint(fields=["membership", "role"], name="uniq_membership_role")]
