from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db.models import Count, Exists, OuterRef, Q
from django.db.models.functions import TruncDate
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.audit import audit
from apps.common.dates import day_range, display_tz, local_today
from apps.common.models import AuditLog
from apps.common.pagination import StandardPagination
from apps.crm.models import Interaction, InteractionProduct, Opportunity, Referral, Task
from apps.crm.scoping import visible_interactions
from apps.crm.views import apply_lead_filters
from apps.iam.authz import HasCapability, authz_for

from .exporter import run_export
from .models import DataExport
from .schema import DATASETS, DEFAULT_DATASETS, SCHEMA_VERSION

FILTER_KEYS = ["event_id", "product_id", "plan_id", "quality", "status", "stage", "tag_id", "owner_id", "created_by", "date_from", "date_to", "ids", "q"]


def export_data(job):
    return {
        "id": str(job.id), "format": job.format, "datasets": job.datasets, "filters": job.filters, "status": job.status,
        "status_label": job.get_status_display(), "row_counts": job.row_counts, "schema_version": job.schema_version,
        "file_name": job.file_name, "file_size": job.file_size, "expires_at": job.expires_at, "completed_at": job.completed_at,
        "created_at": job.created_at, "error": job.error, "pii_masked": job.pii_masked, "downloaded_count": job.downloaded_count,
        "download_url": f"/api/v1/exports/{job.id}/download?token={job.download_token}" if job.status == "READY" else None,
    }


class ExportListView(APIView):
    permission_classes = [HasCapability.of("export.run")]

    def get(self, request):
        page = StandardPagination()
        items = page.paginate_queryset(DataExport.objects.filter(created_by=request.user), request)
        return page.get_paginated_response([export_data(j) for j in items])

    def post(self, request):
        fmt = (request.data.get("format") or "XLSX").upper()
        if fmt not in DataExport.Format.values:
            raise ValidationError({"format": "قالب خروجی نامعتبر است."})
        datasets = request.data.get("datasets") or DEFAULT_DATASETS
        bad = [d for d in datasets if d not in DATASETS]
        if bad:
            raise ValidationError({"datasets": f"مجموعه داده ناشناخته: {', '.join(bad)}"})
        filters = {k: v for k, v in (request.data.get("filters") or {}).items() if k in FILTER_KEYS and v not in (None, "", [])}
        # An explicit event filter must be inside the user's scope (no probing other events).
        if filters.get("event_id"):
            ids = filters["event_id"] if isinstance(filters["event_id"], list) else str(filters["event_id"]).split(",")
            az = authz_for(request.user)
            if not az.has_global("lead.view.all"):
                allowed = {str(e) for e in az.events}
                if any(str(e) not in allowed for e in ids):
                    raise PermissionDenied("خروجی رویدادی که در محدوده دسترسی شما نیست مجاز نیست.")
        job = DataExport.objects.create(created_by=request.user, format=fmt, datasets=datasets, filters=filters, schema_version=SCHEMA_VERSION)
        audit(request.user, "export.requested", "data_export", job.id, metadata={"format": fmt, "datasets": datasets, "filters": filters}, request=request)
        estimate = apply_lead_filters(visible_interactions(request.user), _P(filters), request.user).count()
        if settings.CELERY_ENABLED and estimate > settings.EXPORT_SYNC_ROW_LIMIT:
            from .tasks import run_export_task

            run_export_task.delay(str(job.id))
        else:
            run_export(job.id)
            job.refresh_from_db()
        return Response(export_data(job), status=status.HTTP_201_CREATED)


class _P(dict):
    def get(self, key, default=None):
        v = super().get(key, default)
        return ",".join(map(str, v)) if isinstance(v, list) else v


class ExportDetailView(APIView):
    permission_classes = [HasCapability.of("export.run")]

    def get(self, request, pk):
        job = DataExport.objects.filter(pk=pk, created_by=request.user).first()
        if not job:
            raise NotFound()
        return Response(export_data(job))


class ExportDownloadView(APIView):
    """Authenticated + owner-only + unguessable token + expiry. Every download is audited."""

    permission_classes = [HasCapability.of("export.run")]

    def get(self, request, pk):
        job = DataExport.objects.filter(pk=pk, created_by=request.user).first()
        if not job or request.query_params.get("token") != job.download_token:
            audit(request.user, "export.download_denied", "data_export", pk, request=request)
            raise NotFound("فایل خروجی یافت نشد.")
        if job.status != "READY" or (job.expires_at and job.expires_at < timezone.now()):
            raise NotFound("لینک دریافت منقضی شده است.")
        path = Path(settings.EXPORT_ROOT, job.file_key)
        if not path.exists():
            raise NotFound("فایل خروجی در دسترس نیست.")
        job.downloaded_count += 1
        job.save(update_fields=["downloaded_count"])
        audit(request.user, "export.downloaded", "data_export", job.id, metadata={"rows": job.row_counts}, request=request)
        content_type = {"XLSX": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "JSON": "application/json",
                        "CSV": "text/csv; charset=utf-8" if job.file_name.endswith(".csv") else "application/zip"}[job.format]
        resp = FileResponse(path.open("rb"), as_attachment=True, filename=job.file_name, content_type=content_type)
        resp["Cache-Control"] = "no-store"
        return resp


class ExportSchemaView(APIView):
    def get(self, request):
        return Response({"schema_version": SCHEMA_VERSION, "datasets": {k: [{"column": c, "description": d, "privacy_class": p} for c, d, p in v] for k, v in DATASETS.items()}})


class DashboardView(APIView):
    def get(self, request):
        user = request.user
        az = authz_for(user)
        now = timezone.now()
        today_start, today_end = day_range(local_today())
        mine = Interaction.objects.filter(created_by=user)
        personal = {
            "my_captures_total": mine.count(),
            "my_captures_today": mine.filter(captured_at__gte=today_start, captured_at__lt=today_end).count(),
            "my_pending_referrals": Referral.objects.filter(to_user=user, status="PENDING").count(),
            "my_open_tasks": Task.objects.filter(owner=user, status="OPEN").count(),
            "my_overdue_tasks": Task.objects.filter(owner=user, status="OPEN", due_at__lt=now).count(),
            "recent": [
                {"id": str(i.id), "contact_name": i.contact.full_name, "account_name": i.account.name if i.account_id else None,
                 "event_code": i.event_code, "captured_at": i.captured_at, "quality": i.quality}
                for i in mine.select_related("contact", "account").order_by("-captured_at")[:3]
            ],
        }
        if not az.has("dashboard.view"):
            return Response({"personal": personal, "aggregate": None, "demo_data": settings.DEMO_MODE})

        qs = apply_lead_filters(visible_interactions(user), request.query_params, user)
        ids = qs.values("id")
        base = Interaction.objects.filter(pk__in=ids)
        opps = Opportunity.objects.filter(source_interaction__in=ids)
        tasks = Task.objects.filter(interaction__in=ids)
        refs = Referral.objects.filter(interaction__in=ids)
        pending_ref = Referral.objects.filter(interaction=OuterRef("pk"), status="PENDING")
        ownerless = base.filter(triage_owner__isnull=True).filter(Q(opportunity__isnull=True) | Q(opportunity__owner__isnull=True)).exclude(Exists(pending_ref))
        multi = InteractionProduct.objects.filter(interaction__in=ids).values("interaction_id").annotate(n=Count("id")).filter(n__gt=1).count()
        by_product = (
            InteractionProduct.objects.filter(interaction__in=ids).values("product_id", "product_code", "product__name_fa")
            .annotate(n=Count("interaction_id", distinct=True)).order_by("-n")[:12]
        )
        aggregate = {
            "metric_definitions": {
                "interactions": "تعداد تعاملات ثبت‌شده (هر گفت‌وگو یک ثبت)",
                "unique_contacts": "مخاطبان یکتا پس از نرمال‌سازی",
                "unique_accounts": "سازمان‌های یکتا",
                "qualified_opportunities": "فرصت‌های ایجادشده با ارزیابی صریح",
                "completed_followups": "وظایف پیگیری انجام‌شده",
                "open_tasks": "وظایف باز",
            },
            "interactions": base.count(),
            "unique_contacts": base.values("contact_id").distinct().count(),
            "unique_accounts": base.exclude(account__isnull=True).values("account_id").distinct().count(),
            "qualified_opportunities": opps.count(),
            "won": opps.filter(stage="WON").count(),
            "open_tasks": tasks.filter(status="OPEN").count(),
            "overdue_tasks": tasks.filter(status="OPEN", due_at__lt=now).count(),
            "completed_followups": tasks.filter(status="DONE").count(),
            "pending_referrals": refs.filter(status="PENDING").count(),
            "overdue_referrals": refs.filter(status="PENDING", due_at__lt=now).count(),
            "returned_referrals": refs.filter(status="RETURNED").count(),
            "ownerless": ownerless.count(),
            "multi_product_interactions": multi,
            "offline_captures": base.filter(captured_offline=True).count(),
            "by_quality": {r["quality"]: r["n"] for r in base.values("quality").annotate(n=Count("id"))},
            "by_stage": {r["stage"]: r["n"] for r in opps.values("stage").annotate(n=Count("id"))},
            "by_product": [{"product_id": str(r["product_id"]), "code": r["product_code"], "name_fa": r["product__name_fa"], "count": r["n"]} for r in by_product],
            "by_event": [{"event_id": str(r["event_id"]), "code": r["event_code"], "name": r["event__display_name"], "count": r["n"]}
                         for r in base.values("event_id", "event_code", "event__display_name").annotate(n=Count("id")).order_by("-n")[:12]],
            "by_day": [{"date": r["d"].isoformat(), "count": r["n"]} for r in base.annotate(d=TruncDate("captured_at", tzinfo=display_tz())).values("d").annotate(n=Count("id")).order_by("d") if r["d"]][-60:],
            "by_creator": [{"user_id": str(r["created_by_id"]), "name": f"{r['created_by__first_name']} {r['created_by__last_name']}", "count": r["n"]}
                           for r in base.values("created_by_id", "created_by__first_name", "created_by__last_name").annotate(n=Count("id")).order_by("-n")[:10]],
            "ownerless_sample": [{"id": str(i.id), "contact_name": i.contact.full_name, "event_code": i.event_code, "captured_at": i.captured_at}
                                 for i in ownerless.select_related("contact").order_by("-captured_at")[:6]],
            "overdue_sample": [{"id": str(t.id), "interaction_id": str(t.interaction_id), "title": t.title, "owner": t.owner.full_name, "due_at": t.due_at}
                               for t in tasks.filter(status="OPEN", due_at__lt=now).select_related("owner").order_by("due_at")[:6]],
        }
        return Response({"personal": personal, "aggregate": aggregate, "demo_data": settings.DEMO_MODE, "generated_at": now})


class AuditLogView(APIView):
    permission_classes = [HasCapability.of("audit.view")]

    def get(self, request):
        qs = AuditLog.objects.select_related("actor")
        p = request.query_params
        if p.get("entity_type"):
            qs = qs.filter(entity_type=p["entity_type"])
        if p.get("entity_id"):
            qs = qs.filter(entity_id=p["entity_id"])
        if p.get("actor_id"):
            qs = qs.filter(actor_id=p["actor_id"])
        if p.get("action"):
            qs = qs.filter(action__icontains=p["action"])
        if p.get("days"):
            qs = qs.filter(created_at__gte=timezone.now() - timedelta(days=int(p["days"])))
        page = StandardPagination()
        items = page.paginate_queryset(qs, request)
        return page.get_paginated_response([{
            "id": str(a.id), "action": a.action, "entity_type": a.entity_type, "entity_id": a.entity_id,
            "actor": {"id": str(a.actor_id), "full_name": a.actor.full_name} if a.actor_id else None,
            "before": a.before, "after": a.after, "metadata": a.metadata, "ip_address": a.ip_address, "created_at": a.created_at,
        } for a in items])
