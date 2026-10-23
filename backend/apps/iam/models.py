import hashlib
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models
from django.utils import timezone

from apps.common.models import UUIDModel


class UserManager(BaseUserManager):
    def create_user(self, username, password=None, **extra):
        if not username:
            raise ValueError("username required")
        user = self.model(username=username.strip().lower(), **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "فعال"
        SUSPENDED = "SUSPENDED", "تعلیق"
        ARCHIVED = "ARCHIVED", "بایگانی"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = models.CharField(max_length=64, unique=True)
    first_name = models.CharField(max_length=80)
    last_name = models.CharField(max_length=80)
    title = models.CharField("سمت", max_length=120, blank=True)
    mobile = models.CharField(max_length=16, db_index=True, help_text="Normalized +989XXXXXXXXX; internal notifications only")
    mobile_verified_at = models.DateTimeField(null=True, blank=True)
    email = models.EmailField(blank=True)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    must_change_password = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)
    created_by = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = ["first_name", "last_name", "mobile"]
    objects = UserManager()

    class Meta:
        db_table = "users"
        ordering = ["last_name", "first_name"]

    @property
    def is_active(self):
        return self.status == self.Status.ACTIVE

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    def __str__(self):
        return self.full_name or self.username


class Role(UUIDModel):
    class Scope(models.TextChoices):
        GLOBAL = "GLOBAL", "سراسری"
        EVENT = "EVENT", "رویدادی"

    code = models.SlugField(max_length=60, unique=True)
    name_fa = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    scope = models.CharField(max_length=8, choices=Scope.choices)
    capabilities = models.JSONField(default=list)
    is_system = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)

    class Meta:
        db_table = "roles"
        ordering = ["scope", "name_fa"]

    def __str__(self):
        return self.code


class GlobalRoleAssignment(UUIDModel):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="global_roles")
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="+")
    granted_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "global_roles"
        constraints = [models.UniqueConstraint(fields=["user", "role"], name="uniq_global_role")]


class PasswordResetToken(UUIDModel):
    class Purpose(models.TextChoices):
        ACTIVATION = "ACTIVATION"
        RESET = "RESET"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="reset_tokens")
    token_hash = models.CharField(max_length=64, unique=True)
    purpose = models.CharField(max_length=12, choices=Purpose.choices)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    issued_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "password_reset_tokens"

    @staticmethod
    def hash(raw):
        return hashlib.sha256(raw.encode()).hexdigest()

    @classmethod
    def issue(cls, user, purpose, issued_by=None):
        cls.objects.filter(user=user, used_at__isnull=True).update(used_at=timezone.now())
        raw = secrets.token_urlsafe(32)
        token = cls.objects.create(
            user=user,
            token_hash=cls.hash(raw),
            purpose=purpose,
            expires_at=timezone.now() + timedelta(hours=settings.PASSWORD_RESET_TOKEN_HOURS),
            issued_by=issued_by,
        )
        return token, raw

    @classmethod
    def lookup(cls, raw):
        try:
            token = cls.objects.select_related("user").get(token_hash=cls.hash(raw or ""))
        except cls.DoesNotExist:
            return None
        if token.used_at or token.expires_at < timezone.now():
            return None
        return token
