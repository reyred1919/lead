from django.conf import settings
from django.db import models

from apps.common.models import UUIDModel


class BrandAsset(UUIDModel):
    class Variant(models.TextChoices):
        LIGHT = "LIGHT", "روشن"
        DARK = "DARK", "تیره"

    variant = models.CharField(max_length=5, choices=Variant.choices)
    original_filename = models.CharField(max_length=200, help_text="For audit only; never used as a path")
    storage_key = models.CharField(max_length=120, unique=True)
    thumb_key = models.CharField(max_length=120, blank=True)
    mime = models.CharField(max_length=40)
    checksum = models.CharField(max_length=64)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    size = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "brand_assets"
        ordering = ["-created_at"]


class BrandSettings(models.Model):
    """Singleton (pk=1) brand configuration; revision increments on every change for cache busting."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    system_title = models.CharField(max_length=80, default="سامانه لیدهای نمایشگاهی")
    footer_label = models.CharField(max_length=120, blank=True)
    brand_label = models.CharField(max_length=80, default="همراه اول")
    logo_alt = models.CharField(max_length=120, default="نشان سازمان")
    logo_scale = models.FloatField(default=1.0)
    light_asset = models.ForeignKey(BrandAsset, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    dark_asset = models.ForeignKey(BrandAsset, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    show_on_exports = models.BooleanField(default=True)
    revision = models.PositiveIntegerField(default=1)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "brand_settings"

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
