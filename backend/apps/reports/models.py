import secrets

from django.conf import settings
from django.db import models

from apps.common.models import UUIDModel


class DataExport(UUIDModel):
    class Format(models.TextChoices):
        XLSX = "XLSX"
        CSV = "CSV"
        JSON = "JSON"

    class Status(models.TextChoices):
        QUEUED = "QUEUED", "در صف"
        RUNNING = "RUNNING", "در حال تولید"
        READY = "READY", "آماده دریافت"
        FAILED = "FAILED", "ناموفق"
        EXPIRED = "EXPIRED", "منقضی"

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    format = models.CharField(max_length=5, choices=Format.choices)
    datasets = models.JSONField(default=list)
    filters = models.JSONField(default=dict)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.QUEUED, db_index=True)
    row_counts = models.JSONField(default=dict)
    schema_version = models.CharField(max_length=10, default="1.0")
    file_key = models.CharField(max_length=120, blank=True)
    file_name = models.CharField(max_length=160, blank=True)
    file_size = models.PositiveBigIntegerField(null=True)
    download_token = models.CharField(max_length=64, default=secrets.token_urlsafe, unique=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    downloaded_count = models.PositiveIntegerField(default=0)
    error = models.CharField(max_length=500, blank=True)
    pii_masked = models.BooleanField(default=False)

    class Meta:
        db_table = "data_exports"
        ordering = ["-created_at"]
