"""Server-side capability evaluation with event/plan/product scopes.

Usage:
    az = authz_for(request.user)
    az.has("export.run")                 # anywhere (global or any event)
    az.has("lead.assign", event_id=e)    # within event e
    az.require(...)                      # raises PermissionDenied
"""
from dataclasses import dataclass, field

from rest_framework.exceptions import PermissionDenied

from .capabilities import GLOBAL_ONLY

ALL_PRODUCTS = None  # sentinel meaning "no product restriction in this event"


@dataclass
class EventGrant:
    event_id: object
    event_status: str
    capabilities: set = field(default_factory=set)
    # None => whole event; otherwise the set of product ids this membership is limited to.
    product_scope: object = ALL_PRODUCTS
    role_codes: list = field(default_factory=list)


class Authz:
    def __init__(self, user):
        self.user = user
        self.global_caps = set()
        self.global_roles = []
        self.events = {}
        if not user or not user.is_authenticated or not user.is_active:
            return
        self._load()

    def _load(self):
        from apps.catalog.models import EventMembership, Product

        for assignment in self.user.global_roles.select_related("role").filter(role__is_archived=False):
            self.global_roles.append(assignment.role.code)
            self.global_caps.update(assignment.role.capabilities)

        memberships = (
            EventMembership.objects.filter(user=self.user, status=EventMembership.Status.ACTIVE)
            .select_related("event")
            .prefetch_related("roles", "allowed_products", "allowed_plans")
        )
        for m in memberships:
            caps = {"interaction.create"}
            codes = []
            for role in m.roles.all():
                if role.is_archived:
                    continue
                codes.append(role.code)
                caps.update(c for c in role.capabilities if c not in GLOBAL_ONLY)
            product_ids = {p.id for p in m.allowed_products.all()}
            plan_ids = [p.id for p in m.allowed_plans.all()]
            if plan_ids:
                product_ids |= set(Product.objects.filter(plan_id__in=plan_ids).values_list("id", flat=True))
            self.events[m.event_id] = EventGrant(
                event_id=m.event_id,
                event_status=m.event.status,
                capabilities=caps,
                product_scope=product_ids or ALL_PRODUCTS,
                role_codes=codes,
            )

    # ---- queries -------------------------------------------------------
    def has_global(self, cap):
        return cap in self.global_caps

    def has(self, cap, event_id=None):
        if cap in self.global_caps and cap != "interaction.create":
            return True
        if event_id is not None:
            grant = self.events.get(_uuid(event_id))
            return bool(grant and cap in grant.capabilities)
        return any(cap in g.capabilities for g in self.events.values())

    def require(self, cap, event_id=None, message=None):
        if not self.has(cap, event_id):
            raise PermissionDenied(message or "شما مجوز انجام این عملیات را ندارید.")

    def event_grants(self, cap):
        """Event grants (with product scope) carrying `cap` through membership."""
        return [g for g in self.events.values() if cap in g.capabilities]

    def can_capture(self, event_id):
        grant = self.events.get(_uuid(event_id))
        return bool(grant and grant.event_status == "ACTIVE")

    def capabilities_summary(self):
        return {
            "global": sorted(self.global_caps),
            "global_roles": self.global_roles,
            "events": {
                str(g.event_id): {
                    "capabilities": sorted(g.capabilities),
                    "roles": g.role_codes,
                    "product_scope": None if g.product_scope is ALL_PRODUCTS else sorted(str(p) for p in g.product_scope),
                    "event_status": g.event_status,
                }
                for g in self.events.values()
            },
        }


def _uuid(value):
    import uuid

    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def authz_for(user):
    cached = getattr(user, "_authz_cache", None)
    if cached is None:
        cached = Authz(user)
        try:
            user._authz_cache = cached
        except AttributeError:
            pass
    return cached


def reset_authz(user):
    if hasattr(user, "_authz_cache"):
        del user._authz_cache


class HasCapability:
    """DRF permission factory: permission_classes = [HasCapability.of("user.manage")]."""

    @staticmethod
    def of(*caps):
        from rest_framework.permissions import BasePermission

        class _Perm(BasePermission):
            message = "شما مجوز دسترسی به این بخش را ندارید."

            def has_permission(self, request, view):
                if not request.user or not request.user.is_authenticated:
                    return False
                az = authz_for(request.user)
                return any(az.has(c) for c in caps)

        _Perm.__name__ = "Has_" + "_".join(c.replace(".", "_") for c in caps)
        return _Perm
