from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.audit import audit, diff
from apps.common.concurrency import bump, check_version
from apps.common.exceptions import BusinessRuleViolation
from apps.common.outbox import emit
from apps.common.pagination import StandardPagination
from apps.iam.authz import HasCapability, authz_for, reset_authz
from apps.iam.models import Role, User

from .models import Event, EventMembership, EventProduct, MembershipRole, Plan, Product, ProductOwner
from .serializers import EventProductSerializer, EventSerializer, MembershipSerializer, PlanSerializer, ProductSerializer


def _archive_toggle(request, obj, kind, archive):
    check_version(obj, request.data)
    target = "ARCHIVED" if archive else "ACTIVE"
    if obj.status == target:
        raise BusinessRuleViolation("وضعیت از قبل همین است.")
    before = obj.status
    obj.status = target
    bump(obj)
    obj.save()
    audit(request.user, f"{kind}.{'archived' if archive else 'restored'}", kind, obj.id, before={"status": before}, after={"status": target}, request=request)


# ------------------------------------------------------------------ Plans --

class PlanListView(APIView):
    def get(self, request):
        qs = Plan.objects.all()
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        return Response(PlanSerializer(qs, many=True).data)

    def post(self, request):
        authz_for(request.user).require("catalog.manage")
        ser = PlanSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        plan = ser.save()
        audit(request.user, "plan.created", "plan", plan.id, after=ser.data, request=request)
        return Response(PlanSerializer(plan).data, status=status.HTTP_201_CREATED)


class PlanDetailView(APIView):
    permission_classes = [HasCapability.of("catalog.manage")]

    def patch(self, request, pk):
        plan = Plan.objects.filter(pk=pk).first() or _404()
        check_version(plan, request.data)
        before = PlanSerializer(plan).data
        ser = PlanSerializer(plan, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            ser.save()
            bump(plan)
            plan.save()
        b, a = diff(before, PlanSerializer(plan).data)
        audit(request.user, "plan.updated", "plan", plan.id, before=b, after=a, request=request)
        return Response(PlanSerializer(plan).data)


class PlanArchiveView(APIView):
    permission_classes = [HasCapability.of("catalog.manage")]

    def post(self, request, pk, action):
        plan = Plan.objects.filter(pk=pk).first() or _404()
        _archive_toggle(request, plan, "plan", action == "archive")
        return Response(PlanSerializer(plan).data)


# --------------------------------------------------------------- Products --

class ProductListView(APIView):
    def get(self, request):
        qs = Product.objects.select_related("plan").prefetch_related("owners")
        p = request.query_params
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("plan_id"):
            qs = qs.filter(plan_id=p["plan_id"])
        if p.get("q"):
            nq = p["q"]
            qs = qs.filter(Q(name_fa__icontains=nq) | Q(name_en__icontains=nq) | Q(code__icontains=nq))
        return Response(ProductSerializer(qs, many=True).data)

    def post(self, request):
        authz_for(request.user).require("catalog.manage")
        ser = ProductSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            product = ser.save()
            _set_owners(product, request.data.get("owner_ids"))
            audit(request.user, "product.created", "product", product.id, after=ProductSerializer(product).data, request=request)
        return Response(ProductSerializer(product).data, status=status.HTTP_201_CREATED)


def _set_owners(product, owner_ids):
    if owner_ids is None:
        return
    users = list(User.objects.filter(pk__in=owner_ids))
    if len(users) != len(set(owner_ids)):
        raise ValidationError({"owner_ids": "کاربر نامعتبر"})
    ProductOwner.objects.filter(product=product).exclude(user__in=users).delete()
    for u in users:
        ProductOwner.objects.get_or_create(product=product, user=u)


class ProductDetailView(APIView):
    permission_classes = [HasCapability.of("catalog.manage")]

    def patch(self, request, pk):
        product = Product.objects.filter(pk=pk).first() or _404()
        check_version(product, request.data)
        before = ProductSerializer(product).data
        ser = ProductSerializer(product, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            ser.save()
            _set_owners(product, request.data.get("owner_ids"))
            bump(product)
            product.save()
        after = ProductSerializer(product).data
        b, a = diff(before, after)
        audit(request.user, "product.updated", "product", product.id, before=b, after=a, request=request)
        return Response(after)


class ProductArchiveView(APIView):
    permission_classes = [HasCapability.of("catalog.manage")]

    def post(self, request, pk, action):
        product = Product.objects.filter(pk=pk).first() or _404()
        _archive_toggle(request, product, "product", action == "archive")
        return Response(ProductSerializer(product).data)


# ----------------------------------------------------------------- Events --

def _404(msg="یافت نشد."):
    raise NotFound(msg)


def _annotated_events():
    return Event.objects.select_related("owner").annotate(
        product_count=Count("event_products", filter=Q(event_products__is_active=True), distinct=True),
        member_count=Count("memberships", filter=Q(memberships__status="ACTIVE"), distinct=True),
        interaction_count=Count("interactions", distinct=True),
    )


def visible_events(user):
    az = authz_for(user)
    qs = _annotated_events()
    if az.has_global("event.manage") or az.has_global("lead.view.all"):
        return qs
    return qs.filter(pk__in=list(az.events.keys()))


def can_manage_team(user, event):
    az = authz_for(user)
    return az.has_global("event.manage") or az.has("event.team.manage", event.id)


class EventListView(APIView):
    def get(self, request):
        qs = visible_events(request.user)
        p = request.query_params
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        if p.get("q"):
            qs = qs.filter(Q(display_name__icontains=p["q"]) | Q(code__icontains=p["q"]) | Q(city__icontains=p["q"]))
        page = StandardPagination()
        items = page.paginate_queryset(qs.order_by("-starts_at"), request)
        return page.get_paginated_response(EventSerializer(items, many=True).data)

    def post(self, request):
        authz_for(request.user).require("event.manage")
        ser = EventSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        if Event.objects.filter(code=ser.validated_data["code"]).exists():
            raise ValidationError({"code": "این کد رویداد قبلاً استفاده شده است."})
        event = ser.save(created_by=request.user, owner=ser.validated_data.get("owner") or request.user)
        audit(request.user, "event.created", "event", event.id, after=EventSerializer(event).data, request=request)
        return Response(EventSerializer(_annotated_events().get(pk=event.pk)).data, status=status.HTTP_201_CREATED)


class EventDetailView(APIView):
    def get_object(self, request, pk):
        event = visible_events(request.user).filter(pk=pk).first()
        if not event:
            raise NotFound("رویداد یافت نشد یا در محدوده دسترسی شما نیست.")
        return event

    def get(self, request, pk):
        event = self.get_object(request, pk)
        data = EventSerializer(event).data
        data["can_manage"] = authz_for(request.user).has_global("event.manage")
        data["can_manage_team"] = can_manage_team(request.user, event)
        data["allowed_transitions"] = sorted(Event.TRANSITIONS.get(event.status, []))
        return Response(data)

    def patch(self, request, pk):
        authz_for(request.user).require("event.manage")
        event = self.get_object(request, pk)
        check_version(event, request.data)
        before = EventSerializer(event).data
        ser = EventSerializer(event, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            ser.save()
            bump(event)
            event.save()
        event = _annotated_events().get(pk=pk)
        b, a = diff(before, EventSerializer(event).data)
        audit(request.user, "event.updated", "event", event.id, before=b, after=a, request=request)
        return Response(EventSerializer(event).data)


class EventTransitionView(APIView):
    permission_classes = [HasCapability.of("event.manage")]

    def post(self, request, pk):
        event = Event.objects.filter(pk=pk).first() or _404()
        check_version(event, request.data)
        target = request.data.get("status")
        if target not in Event.TRANSITIONS.get(event.status, set()):
            raise BusinessRuleViolation(f"انتقال از «{event.get_status_display()}» به وضعیت درخواستی مجاز نیست.", code="invalid_transition")
        if target == "ACTIVE" and not event.event_products.filter(is_active=True).exists():
            raise BusinessRuleViolation("برای فعال‌سازی، حداقل یک محصول به رویداد اختصاص دهید.", code="no_products")
        now = timezone.now()
        before = event.status
        with transaction.atomic():
            event.status = target
            if target == "ACTIVE":
                event.activated_at = now
                event.closed_at = None
            elif target == "CLOSED" and before == "ACTIVE":
                event.closed_at = now
            elif target == "ARCHIVED":
                event.archived_at = now
            bump(event)
            event.save()
            audit(request.user, "event.status_changed", "event", event.id, before={"status": before}, after={"status": target}, request=request)
            if target == "ACTIVE":
                emit("event.activated", "event", event.id, {"event_id": str(event.id), "event_code": event.code}, actor=request.user,
                     correlation_id=f"event.activated:{event.id}:{now.isoformat()}")
            if target == "CLOSED":
                emit("event.closed", "event", event.id, {"event_id": str(event.id), "event_code": event.code}, actor=request.user,
                     correlation_id=f"event.closed:{event.id}:{now.isoformat()}")
        return Response(EventSerializer(_annotated_events().get(pk=pk)).data)


class EventCloneView(APIView):
    permission_classes = [HasCapability.of("event.manage")]

    def post(self, request, pk):
        source = Event.objects.filter(pk=pk).first() or _404()
        data = {
            "code": request.data.get("code"),
            "display_name": request.data.get("display_name") or f"{source.display_name} (کپی)",
            "starts_at": request.data.get("starts_at") or source.starts_at,
            "ends_at": request.data.get("ends_at") or source.ends_at,
            "city": request.data.get("city", source.city),
            "venue": request.data.get("venue", source.venue),
            "description": source.description,
            "timezone": source.timezone,
            "sync_grace_hours": source.sync_grace_hours,
            "referral_sla_hours": source.referral_sla_hours,
        }
        ser = EventSerializer(data=data)
        ser.is_valid(raise_exception=True)
        if Event.objects.filter(code=ser.validated_data["code"]).exists():
            raise ValidationError({"code": "این کد رویداد قبلاً استفاده شده است."})
        include_products = request.data.get("include_products", True)
        include_members = request.data.get("include_members", False)
        with transaction.atomic():
            event = ser.save(created_by=request.user, owner=source.owner, cloned_from=source)
            if include_products:
                for ep in source.event_products.filter(product__status="ACTIVE"):
                    EventProduct.objects.create(event=event, product=ep.product, default_owner=ep.default_owner, is_active=ep.is_active, sort_order=ep.sort_order)
            if include_members:
                for m in source.memberships.filter(status="ACTIVE", user__status="ACTIVE").prefetch_related("roles", "allowed_products", "allowed_plans"):
                    nm = EventMembership.objects.create(event=event, user=m.user, added_by=request.user)
                    for r in m.roles.all():
                        MembershipRole.objects.create(membership=nm, role=r)
                    nm.allowed_products.set(m.allowed_products.all())
                    nm.allowed_plans.set(m.allowed_plans.all())
            audit(request.user, "event.cloned", "event", event.id, metadata={"source": source.code, "products": bool(include_products), "members": bool(include_members)}, request=request)
        return Response(EventSerializer(_annotated_events().get(pk=event.pk)).data, status=status.HTTP_201_CREATED)


class EventProductListView(APIView):
    def get(self, request, pk):
        event = visible_events(request.user).filter(pk=pk).first() or _404()
        qs = event.event_products.select_related("product__plan", "default_owner")
        if request.query_params.get("active") == "1":
            qs = qs.filter(is_active=True)
        return Response(EventProductSerializer(qs, many=True).data)

    def post(self, request, pk):
        event = Event.objects.filter(pk=pk).first() or _404()
        if not can_manage_team(request.user, event):
            raise PermissionDenied("مجوز مدیریت محصولات این رویداد را ندارید.")
        product = Product.objects.filter(pk=request.data.get("product"), status="ACTIVE").first()
        if not product:
            raise ValidationError({"product": "محصول فعال انتخاب کنید."})
        owner = User.objects.filter(pk=request.data.get("default_owner")).first() if request.data.get("default_owner") else None
        ep, created = EventProduct.objects.get_or_create(event=event, product=product, defaults={"default_owner": owner})
        if not created:
            ep.is_active = True
            ep.default_owner = owner or ep.default_owner
            ep.save()
        audit(request.user, "event.product_added", "event", event.id, metadata={"product": product.code}, request=request)
        return Response(EventProductSerializer(ep).data, status=status.HTTP_201_CREATED)


class EventProductDetailView(APIView):
    def patch(self, request, pk, ep_id):
        event = Event.objects.filter(pk=pk).first() or _404()
        if not can_manage_team(request.user, event):
            raise PermissionDenied("مجوز مدیریت محصولات این رویداد را ندارید.")
        ep = event.event_products.filter(pk=ep_id).first() or _404()
        if "default_owner" in request.data:
            ep.default_owner = User.objects.filter(pk=request.data["default_owner"]).first() if request.data["default_owner"] else None
        if "is_active" in request.data:
            ep.is_active = bool(request.data["is_active"])
        if "sort_order" in request.data:
            ep.sort_order = int(request.data["sort_order"])
        ep.save()
        audit(request.user, "event.product_updated", "event", event.id, metadata={"product": ep.product.code, "is_active": ep.is_active,
              "default_owner": str(ep.default_owner_id) if ep.default_owner_id else None}, request=request)
        return Response(EventProductSerializer(ep).data)


class EventMemberListView(APIView):
    def get(self, request, pk):
        event = visible_events(request.user).filter(pk=pk).first() or _404()
        qs = event.memberships.select_related("user").prefetch_related("roles", "allowed_products", "allowed_plans")
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        return Response(MembershipSerializer(qs.order_by("user__last_name"), many=True).data)

    def post(self, request, pk):
        event = Event.objects.filter(pk=pk).first() or _404()
        if not can_manage_team(request.user, event):
            raise PermissionDenied("مجوز مدیریت تیم این رویداد را ندارید.")
        user = User.objects.filter(pk=request.data.get("user"), status=User.Status.ACTIVE).first()
        if not user:
            raise ValidationError({"user": "کاربر فعال انتخاب کنید."})
        with transaction.atomic():
            membership, created = EventMembership.objects.get_or_create(event=event, user=user, defaults={"added_by": request.user})
            reactivated = False
            if not created and membership.status != "ACTIVE":
                membership.status = "ACTIVE"
                membership.left_at = None
                membership.save()
                reactivated = True
            _apply_membership(membership, request.data)
            audit(request.user, "event.member_added", "event_membership", membership.id, after={
                "event": event.code, "user": user.username, "roles": [r.code for r in membership.roles.all()],
            }, request=request)
            if created or reactivated:
                emit("event.member_added", "event", event.id, {
                    "event_id": str(event.id), "event_code": event.code, "event_name": event.display_name,
                    "user_id": str(user.id), "from_user_id": str(request.user.id),
                }, actor=request.user, correlation_id=f"event.member_added:{membership.id}:{timezone.now().isoformat()}")
        reset_authz(user)
        return Response(MembershipSerializer(membership).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


def _apply_membership(membership, data):
    if "role_codes" in data:
        roles = list(Role.objects.filter(code__in=data["role_codes"] or [], scope="EVENT", is_archived=False))
        if len(roles) != len(set(data["role_codes"] or [])):
            raise ValidationError({"role_codes": "نقش رویدادی نامعتبر است."})
        MembershipRole.objects.filter(membership=membership).exclude(role__in=roles).delete()
        for r in roles:
            MembershipRole.objects.get_or_create(membership=membership, role=r)
    if "allowed_product_ids" in data:
        products = list(Product.objects.filter(pk__in=data["allowed_product_ids"] or []))
        membership.allowed_products.set(products)
    if "allowed_plan_ids" in data:
        membership.allowed_plans.set(Plan.objects.filter(pk__in=data["allowed_plan_ids"] or []))


class EventMemberDetailView(APIView):
    def patch(self, request, pk, member_id):
        event = Event.objects.filter(pk=pk).first() or _404()
        if not can_manage_team(request.user, event):
            raise PermissionDenied("مجوز مدیریت تیم این رویداد را ندارید.")
        membership = event.memberships.filter(pk=member_id).first() or _404()
        before = {"roles": sorted(r.code for r in membership.roles.all()), "status": membership.status}
        with transaction.atomic():
            _apply_membership(membership, request.data)
            if request.data.get("status") == "REMOVED" and membership.status == "ACTIVE":
                membership.status = "REMOVED"
                membership.left_at = timezone.now()
                membership.save()
            elif request.data.get("status") == "ACTIVE" and membership.status != "ACTIVE":
                membership.status = "ACTIVE"
                membership.left_at = None
                membership.save()
            after = {"roles": sorted(r.code for r in membership.roles.all()), "status": membership.status}
            audit(request.user, "event.member_updated", "event_membership", membership.id, before=before, after=after, request=request)
        reset_authz(membership.user)
        return Response(MembershipSerializer(membership).data)


class MyEventsView(APIView):
    """Capture contexts for the current user (active memberships)."""

    def get(self, request):
        az = authz_for(request.user)
        events = Event.objects.filter(pk__in=list(az.events.keys())).order_by("-starts_at")
        out = []
        for e in events:
            products = e.event_products.filter(is_active=True, product__status="ACTIVE").select_related("product__plan")
            out.append({
                **EventSerializer(e).data,
                "can_capture": e.status == "ACTIVE",
                "products": [{"id": str(ep.product.id), "code": ep.product.code, "name_fa": ep.product.name_fa, "name_en": ep.product.name_en,
                              "plan_name": ep.product.plan.name_fa if ep.product.plan else None} for ep in products],
                "roles": az.events[e.id].role_codes,
            })
        return Response(out)
