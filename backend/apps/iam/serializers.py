from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.common.text import clean_display, normalize_digits, normalize_mobile

from .capabilities import CAPABILITIES, GLOBAL_ONLY
from .models import Role, User


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["id", "code", "name_fa", "description", "scope", "capabilities", "is_system", "is_archived"]
        read_only_fields = ["id", "is_system"]

    def validate_capabilities(self, value):
        unknown = [c for c in value if c not in CAPABILITIES]
        if unknown:
            raise serializers.ValidationError(f"قابلیت ناشناخته: {', '.join(unknown)}")
        return sorted(set(value))

    def validate(self, attrs):
        scope = attrs.get("scope") or getattr(self.instance, "scope", None)
        caps = attrs.get("capabilities", getattr(self.instance, "capabilities", []))
        if scope == "EVENT":
            bad = [c for c in caps if c in GLOBAL_ONLY]
            if bad:
                raise serializers.ValidationError({"capabilities": f"این قابلیت‌ها فقط سراسری هستند: {', '.join(bad)}"})
        if self.instance and self.instance.is_system:
            raise serializers.ValidationError("نقش‌های سیستمی قابل ویرایش نیستند؛ نقش سفارشی بسازید.")
        return attrs


class UserBriefSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "full_name", "title", "status"]


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    global_role_codes = serializers.ListField(child=serializers.CharField(), write_only=True, required=False)
    global_roles = serializers.SerializerMethodField()
    has_password = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "first_name", "last_name", "full_name", "title", "mobile", "email", "status",
            "mobile_verified_at", "email_verified_at", "must_change_password", "last_login", "created_at",
            "updated_at", "version", "global_roles", "global_role_codes", "has_password",
        ]
        read_only_fields = ["id", "mobile_verified_at", "email_verified_at", "must_change_password", "last_login", "created_at", "updated_at", "version"]

    def get_global_roles(self, obj):
        return [{"code": a.role.code, "name_fa": a.role.name_fa} for a in obj.global_roles.select_related("role").all()]

    def get_has_password(self, obj):
        return obj.has_usable_password()

    def validate_username(self, value):
        value = normalize_digits(value).strip().lower()
        if not value or not all(ch.isalnum() or ch in "._-" for ch in value) or not value.isascii():
            raise serializers.ValidationError("نام کاربری فقط شامل حروف لاتین، عدد، نقطه، خط تیره و زیرخط باشد.")
        qs = User.objects.filter(username=value)
        if self.instance:
            if self.instance.username != value:
                raise serializers.ValidationError("نام کاربری پس از ایجاد قابل تغییر نیست.")
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("این نام کاربری قبلاً ثبت شده است.")
        return value

    def validate_mobile(self, value):
        mobile = normalize_mobile(value)
        if not mobile:
            raise serializers.ValidationError("شماره موبایل معتبر ایرانی وارد کنید (نمونه: ۰۹۱۲۳۴۵۶۷۸۹).")
        return mobile

    def validate_first_name(self, value):
        value = clean_display(value)
        if not value:
            raise serializers.ValidationError("نام الزامی است.")
        return value

    def validate_last_name(self, value):
        value = clean_display(value)
        if not value:
            raise serializers.ValidationError("نام خانوادگی الزامی است.")
        return value

    def validate_global_role_codes(self, value):
        roles = list(Role.objects.filter(code__in=value, scope="GLOBAL", is_archived=False))
        if len(roles) != len(set(value)):
            raise serializers.ValidationError("نقش سراسری نامعتبر است.")
        return roles


class ProfileSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "full_name", "title", "mobile", "email", "must_change_password"]
        read_only_fields = fields


class PasswordSetSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True)

    def validate_password(self, value):
        user = self.context.get("user")
        try:
            validate_password(value, user=user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value
