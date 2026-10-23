from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from apps.common.audit import audit, diff
from apps.common.concurrency import bump, check_version
from apps.common.pagination import StandardPagination
from apps.common.text import normalize_digits, normalize_search

from .authz import HasCapability, authz_for, reset_authz
from .capabilities import CAPABILITIES
from .models import GlobalRoleAssignment, PasswordResetToken, Role, User
from .serializers import PasswordSetSerializer, ProfileSerializer, RoleSerializer, UserSerializer


class LoginThrottle(AnonRateThrottle):
    scope = "login"


class ResetThrottle(AnonRateThrottle):
    scope = "password_reset"


def me_payload(user):
    from apps.catalog.models import EventMembership

    az = authz_for(user)
    memberships = (
        EventMembership.objects.filter(user=user, status="ACTIVE")
        .select_related("event")
        .prefetch_related("roles")
        .order_by("-event__starts_at")
    )
    events = [
        {
            "id": str(m.event.id), "code": m.event.code, "display_name": m.event.display_name, "status": m.event.status,
            "city": m.event.city, "venue": m.event.venue, "starts_at": m.event.starts_at, "ends_at": m.event.ends_at,
            "roles": [{"code": r.code, "name_fa": r.name_fa} for r in m.roles.all()],
            "can_capture": m.event.status == "ACTIVE",
        }
        for m in memberships
    ]
    return {
        "user": ProfileSerializer(user).data,
        "authz": az.capabilities_summary(),
        "events": events,
        "capture_events": [e for e in events if e["can_capture"]],
        "demo_mode": settings.DEMO_MODE,
    }


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response({"ok": True})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    def post(self, request):
        username = normalize_digits(str(request.data.get("username", ""))).strip().lower()
        password = str(request.data.get("password", ""))
        user = authenticate(request, username=username, password=password)
        if user is None:
            audit(None, "auth.login_failed", "user", "", metadata={"username": username[:64]}, request=request)
            return Response({"detail": "نام کاربری یا رمز عبور نادرست است."}, status=status.HTTP_400_BAD_REQUEST)
        login(request, user)
        audit(user, "auth.login", "user", user.id, request=request)
        return Response(me_payload(user))


class LogoutView(APIView):
    def post(self, request):
        audit(request.user, "auth.logout", "user", request.user.id, request=request)
        logout(request)
        return Response({"ok": True})


class MeView(APIView):
    def get(self, request):
        return Response(me_payload(request.user))


class ChangePasswordView(APIView):
    def post(self, request):
        user = request.user
        if not user.check_password(str(request.data.get("current_password", ""))):
            raise ValidationError({"current_password": "رمز فعلی نادرست است."})
        ser = PasswordSetSerializer(data={"password": request.data.get("new_password", "")}, context={"user": user})
        ser.is_valid(raise_exception=True)
        user.set_password(ser.validated_data["password"])
        user.must_change_password = False
        user.save()
        update_session_auth_hash(request, user)
        audit(user, "auth.password_changed", "user", user.id, request=request)
        return Response({"ok": True})


def _deliver_reset_link(user, raw_token, purpose, actor=None):
    """Send activation/reset link via configured internal channels. Token is never stored in logs."""
    from apps.notify.models import NotificationJob
    from apps.notify.providers import adapter_for, deliver
    from apps.notify.engine import _provider_for
    from apps.notify.models import DeliveryAttempt

    link = f"{settings.APP_BASE_URL.rstrip('/')}/reset-password?token={raw_token}"
    label = "فعال‌سازی حساب" if purpose == "ACTIVATION" else "بازنشانی رمز عبور"
    text = f"{label} سامانه لیدهای نمایشگاهی:\n{link}\nاین لینک تا {settings.PASSWORD_RESET_TOKEN_HOURS} ساعت معتبر است."
    redacted = text.replace(raw_token, "[REDACTED]")
    results = []
    for channel, address in (("SMS", user.mobile), ("EMAIL", user.email)):
        if not address:
            continue
        provider = _provider_for(channel)
        job = NotificationJob.objects.create(
            source="SYSTEM", recipient=user, channel=channel, dedup_key=f"reset:{user.id}:{channel}:{timezone.now().timestamp()}",
            context={"purpose": purpose}, scheduled_at=timezone.now(), event_type="user.password_reset",
            rendered_subject=label, rendered_body=redacted, max_attempts=1, attempts=1, status="PROCESSING",
        )
        if not provider or provider.mode in ("DISABLED", "CONFIGURED"):
            job.status, job.skip_reason, job.completed_at = "SKIPPED", "NO_PROVIDER" if not provider else "PROVIDER_NOT_LIVE", timezone.now()
            job.save()
            results.append({"channel": channel, "status": job.status, "reason": job.skip_reason})
            continue
        result = deliver(adapter_for(provider), channel, address, label, text, "", job.dedup_key)
        DeliveryAttempt.objects.create(job=job, provider=provider, attempt_no=1, status=result.status, is_mock=result.is_mock,
                                       provider_message_id=result.provider_message_id, reason_code=result.reason_code,
                                       response_summary=result.summary[:500], finished_at=timezone.now())
        job.status = {"FAILED": "DEAD"}.get(result.status, result.status)
        job.completed_at = timezone.now()
        job.save()
        results.append({"channel": channel, "status": job.status, "mock": result.is_mock})
    return link, results


@method_decorator(csrf_protect, name="dispatch")
class ForgotPasswordView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ResetThrottle]

    def post(self, request):
        username = normalize_digits(str(request.data.get("username", ""))).strip().lower()
        user = User.objects.filter(username=username, status=User.Status.ACTIVE).first()
        if user:
            _, raw = PasswordResetToken.issue(user, "RESET")
            _deliver_reset_link(user, raw, "RESET")
            audit(None, "auth.password_reset_requested", "user", user.id, request=request)
        # Generic response to avoid account enumeration.
        return Response({"detail": "اگر حساب فعالی با این نام کاربری وجود داشته باشد، لینک بازنشانی به شماره موبایل/ایمیل ثبت‌شده ارسال می‌شود."})


@method_decorator(csrf_protect, name="dispatch")
class ResetPasswordView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ResetThrottle]

    def get(self, request):
        token = PasswordResetToken.lookup(request.query_params.get("token", ""))
        if not token:
            return Response({"valid": False}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"valid": True, "purpose": token.purpose, "username": token.user.username, "expires_at": token.expires_at})

    def post(self, request):
        token = PasswordResetToken.lookup(str(request.data.get("token", "")))
        if not token:
            raise ValidationError({"token": "لینک نامعتبر یا منقضی شده است."})
        ser = PasswordSetSerializer(data={"password": request.data.get("password", "")}, context={"user": token.user})
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            user = token.user
            user.set_password(ser.validated_data["password"])
            user.must_change_password = False
            user.save()
            token.used_at = timezone.now()
            token.save()
            audit(user, "auth.password_reset_completed", "user", user.id, metadata={"purpose": token.purpose}, request=request)
        return Response({"ok": True})


# ----------------------------------------------------------------- Users ----

USER_AUDIT_FIELDS = ["first_name", "last_name", "title", "mobile", "email", "status"]


class UserListView(APIView):
    permission_classes = [HasCapability.of("user.manage", "lead.assign", "notification.send", "event.team.manage", "task.manage")]

    def get(self, request):
        az = authz_for(request.user)
        qs = User.objects.all().prefetch_related("global_roles__role")
        q = request.query_params.get("q")
        if q:
            nq = normalize_search(q)
            cond = Q(username__icontains=nq) | Q(first_name__icontains=q) | Q(last_name__icontains=q) | Q(title__icontains=q)
            digits = "".join(ch for ch in normalize_digits(q) if ch.isdigit())
            if len(digits) >= 4:
                cond |= Q(mobile__contains=digits.lstrip("0"))
            qs = qs.filter(cond)
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        if request.query_params.get("event_id"):
            qs = qs.filter(memberships__event_id=request.query_params["event_id"], memberships__status="ACTIVE")
        if not az.has_global("user.manage"):
            # Pickers for assignment: active users only, brief fields.
            qs = qs.filter(status=User.Status.ACTIVE)
            page = StandardPagination()
            items = page.paginate_queryset(qs.distinct(), request)
            return page.get_paginated_response([{"id": str(u.id), "full_name": u.full_name, "title": u.title, "username": u.username} for u in items])
        page = StandardPagination()
        items = page.paginate_queryset(qs.distinct(), request)
        return page.get_paginated_response(UserSerializer(items, many=True).data)

    def post(self, request):
        authz_for(request.user).require("user.manage")
        ser = UserSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        roles = ser.validated_data.pop("global_role_codes", [])
        with transaction.atomic():
            user = User.objects.create_user(created_by=request.user, **ser.validated_data)
            for role in roles:
                GlobalRoleAssignment.objects.create(user=user, role=role, granted_by=request.user)
            _, raw = PasswordResetToken.issue(user, "ACTIVATION", issued_by=request.user)
            audit(request.user, "user.created", "user", user.id, after={**{f: getattr(user, f) for f in USER_AUDIT_FIELDS}, "roles": [r.code for r in roles]}, request=request)
        link, deliveries = _deliver_reset_link(user, raw, "ACTIVATION", request.user)
        data = UserSerializer(user).data
        data["activation"] = {"deliveries": deliveries, "expires_hours": settings.PASSWORD_RESET_TOKEN_HOURS}
        if settings.DEMO_MODE:
            data["activation"]["demo_link"] = link
        return Response(data, status=status.HTTP_201_CREATED)


class UserDetailView(APIView):
    permission_classes = [HasCapability.of("user.manage")]

    def get_object(self, pk):
        user = User.objects.filter(pk=pk).first()
        if not user:
            raise NotFound("کاربر یافت نشد.")
        return user

    def get(self, request, pk):
        user = self.get_object(pk)
        data = UserSerializer(user).data
        from apps.catalog.models import EventMembership

        data["memberships"] = [
            {
                "id": str(m.id), "event_id": str(m.event_id), "event_code": m.event.code, "event_name": m.event.display_name,
                "event_status": m.event.status, "status": m.status, "joined_at": m.joined_at, "left_at": m.left_at,
                "roles": [r.code for r in m.roles.all()],
            }
            for m in EventMembership.objects.filter(user=user).select_related("event").prefetch_related("roles").order_by("-joined_at")
        ]
        return Response(data)

    def patch(self, request, pk):
        user = self.get_object(pk)
        check_version(user, request.data)
        ser = UserSerializer(user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        roles = ser.validated_data.pop("global_role_codes", None)
        if user.id == request.user.id and ser.validated_data.get("status", user.status) != User.Status.ACTIVE:
            raise ValidationError({"status": "نمی‌توانید حساب خودتان را غیرفعال کنید."})
        before = {f: getattr(user, f) for f in USER_AUDIT_FIELDS}
        before_roles = sorted(user.global_roles.values_list("role__code", flat=True))
        with transaction.atomic():
            for key, value in ser.validated_data.items():
                setattr(user, key, value)
            if "mobile" in ser.validated_data and before["mobile"] != user.mobile:
                user.mobile_verified_at = None
            bump(user)
            user.save()
            if roles is not None:
                if user.id == request.user.id and "SYSTEM_ADMIN" in before_roles and "SYSTEM_ADMIN" not in [r.code for r in roles]:
                    raise ValidationError({"global_role_codes": "نمی‌توانید نقش مدیر سامانه را از خودتان حذف کنید."})
                user.global_roles.exclude(role__in=roles).delete()
                for role in roles:
                    GlobalRoleAssignment.objects.get_or_create(user=user, role=role, defaults={"granted_by": request.user})
            after = {f: getattr(user, f) for f in USER_AUDIT_FIELDS}
            b, a = diff(before, after)
            after_roles = sorted(user.global_roles.values_list("role__code", flat=True))
            if before_roles != after_roles:
                b["roles"], a["roles"] = before_roles, after_roles
            audit(request.user, "user.updated", "user", user.id, before=b, after=a, request=request)
            if user.status != User.Status.ACTIVE:
                from django.contrib.sessions.models import Session

                for s in Session.objects.filter(expire_date__gte=timezone.now()):
                    if s.get_decoded().get("_auth_user_id") == str(user.id):
                        s.delete()
        reset_authz(user)
        return Response(UserSerializer(user).data)


class UserResetPasswordView(APIView):
    permission_classes = [HasCapability.of("user.password_reset")]

    def post(self, request, pk):
        user = User.objects.filter(pk=pk).first()
        if not user:
            raise NotFound("کاربر یافت نشد.")
        if user.status != User.Status.ACTIVE:
            raise ValidationError("برای حساب غیرفعال نمی‌توان لینک بازنشانی صادر کرد.")
        purpose = "RESET" if user.has_usable_password() else "ACTIVATION"
        _, raw = PasswordResetToken.issue(user, purpose, issued_by=request.user)
        link, deliveries = _deliver_reset_link(user, raw, purpose, request.user)
        audit(request.user, "user.password_reset_issued", "user", user.id, metadata={"purpose": purpose, "channels": deliveries}, request=request)
        data = {"purpose": purpose, "deliveries": deliveries, "expires_hours": settings.PASSWORD_RESET_TOKEN_HOURS}
        if settings.DEMO_MODE:
            data["demo_link"] = link
        return Response(data)


# ----------------------------------------------------------------- Roles ----

class RoleListView(APIView):
    def get(self, request):
        qs = Role.objects.all()
        if request.query_params.get("scope"):
            qs = qs.filter(scope=request.query_params["scope"])
        if request.query_params.get("include_archived") != "1":
            qs = qs.filter(is_archived=False)
        return Response(RoleSerializer(qs, many=True).data)

    def post(self, request):
        authz_for(request.user).require("role.manage")
        ser = RoleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        role = ser.save(is_system=False)
        audit(request.user, "role.created", "role", role.id, after=RoleSerializer(role).data, request=request)
        return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)


class RoleDetailView(APIView):
    permission_classes = [HasCapability.of("role.manage")]

    def patch(self, request, pk):
        role = Role.objects.filter(pk=pk).first()
        if not role:
            raise NotFound()
        if role.is_system:
            raise PermissionDenied("نقش‌های سیستمی قابل ویرایش نیستند.")
        before = RoleSerializer(role).data
        ser = RoleSerializer(role, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        if "code" in ser.validated_data and ser.validated_data["code"] != role.code:
            raise ValidationError({"code": "کد نقش قابل تغییر نیست."})
        role = ser.save()
        audit(request.user, "role.updated", "role", role.id, before=before, after=RoleSerializer(role).data, request=request)
        return Response(RoleSerializer(role).data)


class CapabilityListView(APIView):
    def get(self, request):
        return Response([{"code": k, "label": v} for k, v in sorted(CAPABILITIES.items())])
