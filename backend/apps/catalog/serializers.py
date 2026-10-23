from rest_framework import serializers

from apps.common.text import clean_display

from .models import Event, EventMembership, EventProduct, Plan, Product


def _code(value):
    value = (value or "").strip().upper().replace(" ", "-")
    if not value or not all(ch.isascii() and (ch.isalnum() or ch in "-_") for ch in value):
        raise serializers.ValidationError("کد فقط شامل حروف لاتین، عدد و خط تیره باشد.")
    return value


class PlanSerializer(serializers.ModelSerializer):
    product_count = serializers.SerializerMethodField()

    class Meta:
        model = Plan
        fields = ["id", "code", "name_fa", "name_en", "description", "status", "version", "product_count", "created_at", "updated_at"]
        read_only_fields = ["id", "status", "version", "created_at", "updated_at"]

    def get_product_count(self, obj):
        annotated = getattr(obj, "num_products", None)
        return annotated if annotated is not None else obj.products.count()

    def validate_code(self, value):
        value = _code(value)
        if self.instance and self.instance.code != value:
            raise serializers.ValidationError("کد طرح پس از ایجاد قابل تغییر نیست.")
        return value

    def validate_name_fa(self, value):
        return clean_display(value)


class ProductSerializer(serializers.ModelSerializer):
    plan_name = serializers.CharField(source="plan.name_fa", read_only=True, default=None)
    owner_ids = serializers.PrimaryKeyRelatedField(source="owners", many=True, read_only=True)
    owners_detail = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = ["id", "code", "name_fa", "name_en", "description", "plan", "plan_name", "status", "version",
                  "owner_ids", "owners_detail", "created_at", "updated_at"]
        read_only_fields = ["id", "status", "version", "created_at", "updated_at"]

    def get_owners_detail(self, obj):
        return [{"id": str(u.id), "full_name": u.full_name} for u in obj.owners.all()]

    def validate_code(self, value):
        value = _code(value)
        if self.instance and self.instance.code != value:
            raise serializers.ValidationError("کد محصول پس از ایجاد قابل تغییر نیست.")
        return value

    def validate_name_fa(self, value):
        return clean_display(value)


class EventSerializer(serializers.ModelSerializer):
    owner_name = serializers.CharField(source="owner.full_name", read_only=True, default=None)
    product_count = serializers.IntegerField(read_only=True, default=0)
    member_count = serializers.IntegerField(read_only=True, default=0)
    interaction_count = serializers.IntegerField(read_only=True, default=0)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Event
        fields = [
            "id", "code", "display_name", "description", "city", "venue", "starts_at", "ends_at", "timezone", "status",
            "status_label", "owner", "owner_name", "sync_grace_hours", "referral_sla_hours", "activated_at", "closed_at",
            "archived_at", "cloned_from", "version", "product_count", "member_count", "interaction_count", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "status", "activated_at", "closed_at", "archived_at", "cloned_from", "version", "created_at", "updated_at"]

    def validate_code(self, value):
        value = _code(value)
        if self.instance and self.instance.code != value:
            raise serializers.ValidationError("کد رویداد غیرقابل تغییر است.")
        return value

    def validate_display_name(self, value):
        value = clean_display(value)
        if not value:
            raise serializers.ValidationError("نام رویداد الزامی است.")
        return value

    def validate(self, attrs):
        starts = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts and ends and ends < starts:
            raise serializers.ValidationError({"ends_at": "تاریخ پایان باید پس از تاریخ شروع باشد."})
        return attrs


class EventProductSerializer(serializers.ModelSerializer):
    product_code = serializers.CharField(source="product.code", read_only=True)
    product_name = serializers.CharField(source="product.name_fa", read_only=True)
    product_name_en = serializers.CharField(source="product.name_en", read_only=True)
    product_status = serializers.CharField(source="product.status", read_only=True)
    plan_id = serializers.UUIDField(source="product.plan_id", read_only=True)
    plan_name = serializers.CharField(source="product.plan.name_fa", read_only=True, default=None)
    default_owner_name = serializers.CharField(source="default_owner.full_name", read_only=True, default=None)

    class Meta:
        model = EventProduct
        fields = ["id", "product", "product_code", "product_name", "product_name_en", "product_status", "plan_id", "plan_name",
                  "default_owner", "default_owner_name", "is_active", "sort_order"]
        read_only_fields = ["id"]


class MembershipSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.full_name", read_only=True)
    user_title = serializers.CharField(source="user.title", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    roles_detail = serializers.SerializerMethodField()
    allowed_products_detail = serializers.SerializerMethodField()
    allowed_plans_detail = serializers.SerializerMethodField()

    class Meta:
        model = EventMembership
        fields = ["id", "user", "user_name", "user_title", "username", "status", "roles_detail", "allowed_products_detail",
                  "allowed_plans_detail", "joined_at", "left_at"]

    def get_roles_detail(self, obj):
        return [{"id": str(r.id), "code": r.code, "name_fa": r.name_fa} for r in obj.roles.all()]

    def get_allowed_products_detail(self, obj):
        return [{"id": str(p.id), "code": p.code, "name_fa": p.name_fa} for p in obj.allowed_products.all()]

    def get_allowed_plans_detail(self, obj):
        return [{"id": str(p.id), "code": p.code, "name_fa": p.name_fa} for p in obj.allowed_plans.all()]
