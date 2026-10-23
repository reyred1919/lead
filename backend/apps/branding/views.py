"""Brand logo upload with content validation and safe re-encoding.

SVG is rejected in the MVP (active content). Raster uploads are decoded with
Pillow, size/dimension checked, then RE-ENCODED to PNG so that any trailing
payload, metadata or polyglot content is discarded. Files are stored under a
random key; the original filename is kept only for audit.
"""
import hashlib
import io
import secrets
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from PIL import Image, UnidentifiedImageError
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.audit import audit
from apps.common.text import clean_display
from apps.iam.authz import HasCapability

from .models import BrandAsset, BrandSettings

ALLOWED_FORMATS = {"PNG", "WEBP", "JPEG"}
MIN_DIM, MAX_DIM = 32, 4096
Image.MAX_IMAGE_PIXELS = MAX_DIM * MAX_DIM


def brand_dir():
    path = Path(settings.MEDIA_ROOT, "brand")
    path.mkdir(parents=True, exist_ok=True)
    return path


def asset_data(a):
    if not a:
        return None
    return {"id": str(a.id), "variant": a.variant, "url": f"/api/v1/branding/assets/{a.id}", "thumb_url": f"/api/v1/branding/assets/{a.id}?thumb=1",
            "width": a.width, "height": a.height, "size": a.size, "mime": a.mime, "created_at": a.created_at,
            "original_filename": a.original_filename, "is_active": a.is_active}


def settings_data(s):
    return {
        "system_title": s.system_title, "footer_label": s.footer_label, "brand_label": s.brand_label, "logo_alt": s.logo_alt,
        "logo_scale": s.logo_scale, "show_on_exports": s.show_on_exports, "revision": s.revision, "updated_at": s.updated_at,
        "light": asset_data(s.light_asset), "dark": asset_data(s.dark_asset),
        "placeholder": not (s.light_asset_id or s.dark_asset_id),
        "demo_mode": settings.DEMO_MODE,
    }


def validate_image(upload):
    if upload is None:
        raise ValidationError({"file": "فایل نشان را انتخاب کنید."})
    if upload.size > settings.BRAND_MAX_UPLOAD_BYTES:
        raise ValidationError({"file": f"حجم فایل بیش از {settings.BRAND_MAX_UPLOAD_BYTES // (1024 * 1024)} مگابایت است."})
    raw = upload.read(settings.BRAND_MAX_UPLOAD_BYTES + 1)
    head = raw[:512].lstrip().lower()
    if head.startswith(b"<") or b"<svg" in raw[:4096].lower():
        raise ValidationError({"file": "فایل SVG در این نسخه پذیرفته نمی‌شود؛ PNG یا WebP بارگذاری کنید."})
    try:
        probe = Image.open(io.BytesIO(raw))
        fmt = probe.format
        probe.verify()
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, ValueError):
        raise ValidationError({"file": "محتوای فایل تصویر معتبر نیست."})
    if fmt not in ALLOWED_FORMATS:
        raise ValidationError({"file": "فقط PNG، WebP یا JPEG مجاز است."})
    w, h = image.size
    if not (MIN_DIM <= w <= MAX_DIM and MIN_DIM <= h <= MAX_DIM):
        raise ValidationError({"file": f"ابعاد تصویر باید بین {MIN_DIM} و {MAX_DIM} پیکسل باشد."})
    return image, raw


def _encode_png(image):
    if image.mode not in ("RGBA", "RGB", "LA", "L"):
        image = image.convert("RGBA")
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


class BrandingView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(settings_data(BrandSettings.load()))

    def patch(self, request):
        if not request.user.is_authenticated or not HasCapability.of("branding.manage")().has_permission(request, self):
            return Response({"detail": "شما مجوز مدیریت هویت بصری را ندارید."}, status=status.HTTP_403_FORBIDDEN)
        s = BrandSettings.load()
        before = settings_data(s)
        for field, limit in (("system_title", 80), ("footer_label", 120), ("brand_label", 80), ("logo_alt", 120)):
            if field in request.data:
                # Plain text only: no HTML/CSS injection surface.
                value = clean_display(str(request.data[field]))[:limit]
                if "<" in value or ">" in value:
                    raise ValidationError({field: "نویسه‌های < و > مجاز نیستند."})
                setattr(s, field, value)
        if "logo_scale" in request.data:
            scale = float(request.data["logo_scale"])
            if not 0.6 <= scale <= 1.6:
                raise ValidationError({"logo_scale": "مقیاس باید بین ۰٫۶ و ۱٫۶ باشد."})
            s.logo_scale = scale
        if "show_on_exports" in request.data:
            s.show_on_exports = bool(request.data["show_on_exports"])
        s.revision += 1
        s.updated_by = request.user
        s.save()
        audit(request.user, "branding.updated", "brand_settings", "1", before={k: before[k] for k in ("system_title", "footer_label", "brand_label", "logo_alt", "logo_scale")},
              after={k: getattr(s, k) for k in ("system_title", "footer_label", "brand_label", "logo_alt", "logo_scale")}, request=request)
        return Response(settings_data(s))


class LogoUploadView(APIView):
    permission_classes = [HasCapability.of("branding.manage")]
    parser_classes = [MultiPartParser]

    def post(self, request):
        variant = (request.data.get("variant") or "LIGHT").upper()
        if variant not in BrandAsset.Variant.values:
            raise ValidationError({"variant": "نوع نشان نامعتبر است."})
        upload = request.FILES.get("file")
        try:
            image, raw = validate_image(upload)
        except ValidationError:
            audit(request.user, "branding.logo_rejected", "brand_asset", "", metadata={"filename": getattr(upload, "name", "")[:200], "size": getattr(upload, "size", None)}, request=request)
            raise
        png = _encode_png(image)
        thumb = image.copy()
        thumb.thumbnail((512, 128))
        thumb_png = _encode_png(thumb)
        key = secrets.token_hex(16)
        directory = brand_dir()
        (directory / f"{key}.png").write_bytes(png)
        (directory / f"{key}-thumb.png").write_bytes(thumb_png)
        with transaction.atomic():
            s = BrandSettings.load()
            previous = s.light_asset if variant == "LIGHT" else s.dark_asset
            asset = BrandAsset.objects.create(
                variant=variant, original_filename=(upload.name or "")[:200], storage_key=f"{key}.png", thumb_key=f"{key}-thumb.png",
                mime="image/png", checksum=hashlib.sha256(png).hexdigest(), width=image.size[0], height=image.size[1], size=len(png),
                created_by=request.user,
            )
            if previous:
                previous.is_active = False
                previous.archived_at = timezone.now()
                previous.save()
            if variant == "LIGHT":
                s.light_asset = asset
            else:
                s.dark_asset = asset
            s.revision += 1
            s.updated_by = request.user
            s.save()
            audit(request.user, "branding.logo_uploaded", "brand_asset", asset.id, metadata={
                "variant": variant, "filename": asset.original_filename, "sha256": asset.checksum, "replaced": str(previous.id) if previous else None,
            }, request=request)
        return Response(settings_data(s), status=status.HTTP_201_CREATED)


class LogoResetView(APIView):
    permission_classes = [HasCapability.of("branding.manage")]

    def delete(self, request, variant):
        variant = variant.upper()
        s = BrandSettings.load()
        asset = s.light_asset if variant == "LIGHT" else s.dark_asset if variant == "DARK" else None
        if variant not in ("LIGHT", "DARK"):
            raise NotFound()
        with transaction.atomic():
            if asset:
                asset.is_active = False
                asset.archived_at = timezone.now()
                asset.save()
            if variant == "LIGHT":
                s.light_asset = None
            else:
                s.dark_asset = None
            s.revision += 1
            s.updated_by = request.user
            s.save()
            audit(request.user, "branding.logo_reset", "brand_asset", asset.id if asset else "", metadata={"variant": variant}, request=request)
        return Response(settings_data(s))


class AssetHistoryView(APIView):
    permission_classes = [HasCapability.of("branding.manage")]

    def get(self, request):
        return Response([asset_data(a) for a in BrandAsset.objects.all()[:30]])


class AssetFileView(APIView):
    """Serves processed (re-encoded) brand images. Public after safe processing."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, pk):
        asset = BrandAsset.objects.filter(pk=pk).first()
        if not asset:
            raise NotFound()
        key = asset.thumb_key if request.query_params.get("thumb") and asset.thumb_key else asset.storage_key
        path = brand_dir() / Path(key).name
        if not path.exists():
            raise NotFound()
        resp = FileResponse(path.open("rb"), content_type="image/png")
        resp["Cache-Control"] = "public, max-age=31536000, immutable"
        resp["X-Content-Type-Options"] = "nosniff"
        resp["Content-Security-Policy"] = "default-src 'none'"
        return resp
