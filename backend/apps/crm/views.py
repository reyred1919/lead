from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Prefetch, Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.utils.text import slugify
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.audit import audit, diff
from apps.common.concurrency import bump, check_version
from apps.common.exceptions import BusinessRuleViolation
from apps.common.pagination import StandardPagination
from apps.common.text import clean_display, mask_phone, normalize_digits, normalize_mobile, normalize_search
from apps.iam.authz import ALL_PRODUCTS, HasCapability, authz_for

from . import scoping, services
from .models import (
    Account,
    Contact,
    DuplicateCandidate,
    Interaction,
    InteractionProduct,
    MergeRecord,
    Opportunity,
    OpportunityTag,
    Referral,
    SyncQuarantine,
    Tag,
    Task,
)
from .serializers import (
    account_data,
    activity_data,
    contact_data,
    interaction_detail,
    interaction_list_item,
    referral_data,
    tag_ref,
    task_data,
    user_ref,
)


def _list_queryset(user):
    return scoping.visible_interactions(user).select_related(
        "event", "contact", "account", "created_by", "triage_owner", "opportunity__owner"
    ).prefetch_related(
        Prefetch("product_links", queryset=InteractionProduct.objects.select_related("product")),
        Prefetch("referrals", queryset=Referral.objects.select_related("to_user")),
        Prefetch("opportunity__tag_links", queryset=OpportunityTag.objects.select_related("tag")),
    )


def apply_lead_filters(qs, params, user):
    # Accept QueryDicts and JSON filter dicts (list values become comma-separated).
    p = {k: (",".join(map(str, v)) if isinstance(v, (list, tuple)) else v) for k, v in params.items()}
    if p.get("event_id"):
        qs = qs.filter(event_id__in=[e for e in p["event_id"].split(",") if e])
    if p.get("product_id"):
        qs = qs.filter(product_links__product_id__in=p["product_id"].split(","))
    if p.get("plan_id"):
        qs = qs.filter(product_links__product__plan_id=p["plan_id"])
    if p.get("quality"):
        qs = qs.filter(quality__in=p["quality"].split(","))
    if p.get("status"):
        qs = qs.filter(status__in=p["status"].split(","))
    if p.get("stage"):
        stages = p["stage"].split(",")
        if "NONE" in stages:
            qs = qs.filter(Q(opportunity__isnull=True) | Q(opportunity__stage__in=stages))
        else:
            qs = qs.filter(opportunity__stage__in=stages)
    if p.get("tag_id"):
        qs = qs.filter(opportunity__tag_links__tag_id__in=p["tag_id"].split(","))
    if p.get("owner_id"):
        oid = str(user.id) if p["owner_id"] == "me" else p["owner_id"]
        qs = qs.filter(Q(opportunity__owner_id=oid) | Q(opportunity__isnull=True, triage_owner_id=oid))
    if p.get("created_by"):
        cid = str(user.id) if p["created_by"] == "me" else p["created_by"]
        qs = qs.filter(created_by_id=cid)
    if p.get("ownerless") == "1":
        qs = qs.filter(triage_owner__isnull=True).filter(Q(opportunity__isnull=True) | Q(opportunity__owner__isnull=True)).exclude(
            Exists(Referral.objects.filter(interaction=OuterRef("pk"), status="PENDING"))
        )
    if p.get("date_from") and parse_date(p["date_from"]):
        qs = qs.filter(captured_at__date__gte=parse_date(p["date_from"]))
    if p.get("date_to") and parse_date(p["date_to"]):
        qs = qs.filter(captured_at__date__lte=parse_date(p["date_to"]))
    if p.get("ids"):
        qs = qs.filter(pk__in=[i for i in p["ids"].split(",") if i])
    if p.get("q"):
        q = p["q"]
        nq = normalize_search(q)
        cond = Q(contact__name_normalized__contains=nq) | Q(account__name_normalized__contains=nq) | Q(captured_org_name__icontains=q)
        mobile = normalize_mobile(q)
        digits = "".join(ch for ch in normalize_digits(q) if ch.isdigit())
        if mobile:
            cond |= Q(contact__mobile=mobile)
        elif len(digits) >= 4:
            cond |= Q(contact__mobile__contains=digits.lstrip("0"))
        qs = qs.filter(cond)
    return qs.distinct()


def pii_context(user):
    az = authz_for(user)
    if az.has_global("pii.view"):
        return True, frozenset()
    return False, frozenset(g.event_id for g in az.event_grants("pii.view") if g.product_scope is ALL_PRODUCTS)


def get_interaction(user, pk):
    interaction = scoping.visible_interactions(user).select_related("event", "contact", "account", "created_by").filter(pk=pk).first()
    if not interaction:
        raise NotFound("لید یافت نشد یا در محدوده دسترسی شما نیست.")
    return interaction


class InteractionListView(APIView):
    def get(self, request):
        qs = apply_lead_filters(_list_queryset(request.user), request.query_params, request.user)
        ordering = request.query_params.get("ordering", "-captured_at")
        if ordering.lstrip("-") in ("captured_at", "quality", "updated_at"):
            qs = qs.order_by(ordering)
        page = StandardPagination()
        items = page.paginate_queryset(qs, request)
        pii_all, pii_events = pii_context(request.user)
        return page.get_paginated_response([interaction_list_item(i, request.user, pii_all, pii_events) for i in items])

    def post(self, request):
        result = services.capture(request.user, request.data, request=request)
        if result.status == "QUARANTINED":
            return Response({"status": "QUARANTINED", "quarantine_id": str(result.quarantine.id), "reason": result.quarantine.reason},
                            status=status.HTTP_202_ACCEPTED)
        interaction = Interaction.objects.select_related("event", "contact", "account", "created_by").get(pk=result.interaction.pk)
        data = interaction_detail(interaction, request.user)
        data["capture_status"] = result.status
        data["duplicate_hints"] = [{"contact_id": str(c.id), "full_name": c.full_name, "match_type": m} for c, m, _ in result.duplicates]
        return Response(data, status=status.HTTP_201_CREATED if result.status == "CREATED" else status.HTTP_200_OK)


class InteractionSyncView(APIView):
    def post(self, request):
        records = request.data.get("records")
        if not isinstance(records, list):
            raise ValidationError({"records": "فهرست رکوردها الزامی است."})
        return Response({"results": services.sync_batch(request.user, records, request=request)})


class InteractionDetailView(APIView):
    def get(self, request, pk):
        return Response(interaction_detail(get_interaction(request.user, pk), request.user))

    def patch(self, request, pk):
        interaction = get_interaction(request.user, pk)
        services.correct_capture(request.user, interaction, request.data, request=request)
        return Response(interaction_detail(get_interaction(request.user, pk), request.user))


class InteractionActivitiesView(APIView):
    def get(self, request, pk):
        interaction = get_interaction(request.user, pk)
        return Response([activity_data(a) for a in interaction.activities.select_related("actor").order_by("-created_at")[:300]])

    def post(self, request, pk):
        interaction = get_interaction(request.user, pk)
        activity = services.add_note(request.user, interaction, request.data.get("text"), request.data.get("kind", "NOTE"), request=request)
        return Response(activity_data(activity), status=status.HTTP_201_CREATED)


class InteractionQualifyView(APIView):
    def post(self, request, pk):
        interaction = get_interaction(request.user, pk)
        services.qualify(request.user, interaction, request.data, request=request)
        return Response(interaction_detail(get_interaction(request.user, pk), request.user), status=status.HTTP_201_CREATED)


class InteractionReferView(APIView):
    def post(self, request, pk):
        interaction = get_interaction(request.user, pk)
        referral = services.refer(request.user, interaction, request.data.get("to_user_id"), request.data.get("reason", ""),
                                  request.data.get("due_at"), request.data.get("purpose") or "FOLLOW_UP", request=request)
        return Response(referral_data(referral), status=status.HTTP_201_CREATED)


class BulkReferView(APIView):
    """Bulk assignment with explicit confirmation; each lead is authorized individually."""

    def post(self, request):
        ids = request.data.get("interaction_ids") or []
        if not ids or len(ids) > 200:
            raise ValidationError({"interaction_ids": "۱ تا ۲۰۰ لید انتخاب کنید."})
        if not request.data.get("confirm"):
            raise BusinessRuleViolation(f"ارجاع گروهی {len(ids)} لید نیاز به تأیید دارد.", code="confirmation_required")
        results = []
        for pk in ids:
            try:
                interaction = get_interaction(request.user, pk)
                r = services.refer(request.user, interaction, request.data.get("to_user_id"), request.data.get("reason", ""),
                                   request.data.get("due_at"), request.data.get("purpose") or "FOLLOW_UP", request=request)
                results.append({"interaction_id": pk, "status": "OK", "referral_id": str(r.id)})
            except (PermissionDenied, NotFound, ValidationError, BusinessRuleViolation) as exc:
                results.append({"interaction_id": pk, "status": "ERROR", "error": exc.detail})
        audit(request.user, "referral.bulk", "referral", "", metadata={"count": len(ids), "ok": sum(r["status"] == "OK" for r in results)}, request=request)
        return Response({"results": results})


class InteractionEnrichView(APIView):
    def patch(self, request, pk):
        interaction = get_interaction(request.user, pk)
        changes = services.enrich(request.user, interaction, request.data, request=request)
        data = interaction_detail(get_interaction(request.user, pk), request.user)
        data["changes"] = changes
        return Response(data)


class InteractionTasksView(APIView):
    def post(self, request, pk):
        interaction = get_interaction(request.user, pk)
        task = services.create_task(request.user, interaction, request.data, request=request)
        return Response(task_data(task), status=status.HTTP_201_CREATED)


def get_opportunity(user, pk):
    opp = Opportunity.objects.select_related("source_interaction__event").filter(pk=pk).first()
    if not opp or not scoping.visible_interactions(user, Interaction.objects.filter(pk=opp.source_interaction_id)).exists():
        raise NotFound("فرصت یافت نشد یا در محدوده دسترسی شما نیست.")
    return opp


class OpportunityStageView(APIView):
    def post(self, request, pk):
        opp = get_opportunity(request.user, pk)
        services.change_stage(request.user, opp, request.data.get("stage"), request.data.get("note", ""), request.data.get("version"), request=request)
        return Response(interaction_detail(get_interaction(request.user, opp.source_interaction_id), request.user))


class OpportunityTagsView(APIView):
    def post(self, request, pk):
        opp = get_opportunity(request.user, pk)
        services.add_tag(request.user, opp, request.data.get("tag_id"), request=request)
        return Response([tag_ref(l.tag) for l in opp.tag_links.select_related("tag")], status=status.HTTP_201_CREATED)


class OpportunityTagDetailView(APIView):
    def delete(self, request, pk, tag_id):
        opp = get_opportunity(request.user, pk)
        services.remove_tag(request.user, opp, tag_id, request=request)
        return Response([tag_ref(l.tag) for l in opp.tag_links.select_related("tag")])


# ------------------------------------------------------------ Referrals ---

class ReferralListView(APIView):
    def get(self, request):
        box = request.query_params.get("box", "incoming")
        qs = Referral.objects.select_related("from_user", "to_user", "interaction__contact", "interaction__account")
        u = request.user
        now = timezone.now()
        if box == "incoming":
            qs = qs.filter(to_user=u, status="PENDING")
        elif box == "accepted":
            qs = qs.filter(to_user=u, status="ACCEPTED")
        elif box == "outgoing":
            qs = qs.filter(from_user=u, status="PENDING")
        elif box == "returned":
            qs = qs.filter(from_user=u, status="RETURNED")
        elif box == "overdue":
            qs = qs.filter(Q(to_user=u) | Q(from_user=u), status="PENDING", due_at__lt=now)
        elif box == "team":
            # Managers: all referrals within their assignable scope.
            visible = scoping.visible_interactions(u).filter(pk=OuterRef("interaction_id"))
            if not authz_for(u).has("lead.assign"):
                raise PermissionDenied("مشاهده کارتابل تیم نیازمند مجوز ارجاع است.")
            qs = qs.filter(Exists(visible))
            if request.query_params.get("status"):
                qs = qs.filter(status__in=request.query_params["status"].split(","))
        else:
            raise ValidationError({"box": "نامعتبر"})
        if request.query_params.get("event_id"):
            qs = qs.filter(event_id=request.query_params["event_id"])
        page = StandardPagination()
        items = page.paginate_queryset(qs.order_by("due_at", "-created_at") if box in ("incoming", "overdue") else qs.order_by("-created_at"), request)
        return page.get_paginated_response([referral_data(r, with_lead=True) for r in items])


class ReferralActionView(APIView):
    def post(self, request, pk, action):
        referral = Referral.objects.select_related("interaction__event", "interaction__contact").filter(pk=pk).first()
        if not referral or not (referral.to_user_id == request.user.id or referral.from_user_id == request.user.id or scoping.can_assign(request.user, referral.interaction)):
            raise NotFound("ارجاع یافت نشد.")
        if action == "accept":
            services.accept_referral(request.user, referral, request=request)
        elif action == "return":
            services.return_referral(request.user, referral, request.data.get("note", ""), request=request)
        elif action == "cancel":
            services.cancel_referral(request.user, referral, request=request)
        else:
            raise NotFound()
        return Response(referral_data(referral, with_lead=True))


class WorkQueueCountsView(APIView):
    """Badge counts for navigation: referrals, tasks, action requests, unread notifications."""

    def get(self, request):
        from apps.notify.models import ActionRequest, Notification

        u = request.user
        now = timezone.now()
        return Response({
            "referrals_incoming": Referral.objects.filter(to_user=u, status="PENDING").count(),
            "referrals_returned": Referral.objects.filter(from_user=u, status="RETURNED", responded_at__gte=now - timedelta(days=30)).count(),
            "referrals_overdue": Referral.objects.filter(to_user=u, status="PENDING", due_at__lt=now).count(),
            "tasks_open": Task.objects.filter(owner=u, status="OPEN").count(),
            "tasks_overdue": Task.objects.filter(owner=u, status="OPEN", due_at__lt=now).count(),
            "actions_open": ActionRequest.objects.filter(assignee=u, status__in=["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"]).count(),
            "notifications_unread": Notification.objects.filter(recipient=u, read_at__isnull=True).filter(Q(snoozed_until__isnull=True) | Q(snoozed_until__lte=now)).count(),
        })


# ---------------------------------------------------------------- Tasks ---

class TaskListView(APIView):
    def get(self, request):
        scope = request.query_params.get("scope", "mine")
        qs = Task.objects.select_related("owner", "created_by", "interaction__contact")
        if scope == "mine":
            qs = qs.filter(owner=request.user)
        elif scope == "created":
            qs = qs.filter(created_by=request.user)
        elif scope == "team":
            if not authz_for(request.user).has("task.manage"):
                raise PermissionDenied()
            qs = qs.filter(Exists(scoping.visible_interactions(request.user).filter(pk=OuterRef("interaction_id"))))
        st = request.query_params.get("status", "OPEN")
        if st != "ALL":
            qs = qs.filter(status__in=st.split(","))
        if request.query_params.get("overdue") == "1":
            qs = qs.filter(due_at__lt=timezone.now(), status="OPEN")
        page = StandardPagination()
        items = page.paginate_queryset(qs.order_by("due_at", "-created_at"), request)
        return page.get_paginated_response([task_data(t, with_lead=True) for t in items])


class TaskActionView(APIView):
    def post(self, request, pk, action):
        task = Task.objects.select_related("interaction__event").filter(pk=pk).first()
        if not task or not scoping.visible_interactions(request.user, Interaction.objects.filter(pk=task.interaction_id)).exists():
            raise NotFound("وظیفه یافت نشد.")
        if action not in ("complete", "cancel"):
            raise NotFound()
        services.complete_task(request.user, task, request.data.get("outcome", ""), cancel=action == "cancel", request=request)
        return Response(task_data(task))


# ------------------------------------------------- Accounts & Contacts ---

class AccountSearchView(APIView):
    def get(self, request):
        q = request.query_params.get("q", "")
        if len(q.strip()) < 2:
            return Response([])
        nq = normalize_search(q)
        qs = Account.objects.filter(status="ACTIVE").filter(Q(name_normalized__contains=nq) | Q(official_name__icontains=q) | Q(alt_name__icontains=q))
        exact = [a for a in qs.filter(name_normalized=nq)[:1]]
        rest = [a for a in qs.exclude(name_normalized=nq).order_by("name")[:8]]
        return Response([{"id": str(a.id), "name": a.name, "city": a.city, "exact": a in exact} for a in exact + rest])


class ContactSearchView(APIView):
    """Search-first suggestions for capture. Phone numbers are always masked here."""

    def get(self, request):
        q = request.query_params.get("q", "")
        mobile = normalize_mobile(request.query_params.get("mobile", "")) if request.query_params.get("mobile") else None
        if len(q.strip()) < 2 and not mobile:
            return Response([])
        return Response([
            {"id": str(c.id), "full_name": c.full_name, "mobile_masked": mask_phone(c.mobile),
             "account": {"id": str(c.primary_account_id), "name": c.primary_account.name} if c.primary_account_id else None,
             "same_mobile": bool(mobile and c.mobile == mobile)}
            for c in services.suggest_contacts(q, mobile)
        ])


class AccountListView(APIView):
    permission_classes = [HasCapability.of("contact.merge", "lead.view.all")]

    def get(self, request):
        qs = Account.objects.annotate(interaction_count=Count("interactions", distinct=True), contact_count=Count("contacts", distinct=True))
        if request.query_params.get("q"):
            qs = qs.filter(name_normalized__contains=normalize_search(request.query_params["q"]))
        qs = qs.filter(status=request.query_params.get("status", "ACTIVE"))
        page = StandardPagination()
        items = page.paginate_queryset(qs.order_by("name"), request)
        return page.get_paginated_response([{**account_data(a), "interaction_count": a.interaction_count, "contact_count": a.contact_count} for a in items])


class AccountDetailView(APIView):
    permission_classes = [HasCapability.of("contact.merge", "lead.view.all")]

    def get(self, request, pk):
        account = Account.objects.filter(pk=pk).first() or _nf()
        interactions = scoping.visible_interactions(request.user, account.interactions.select_related("event", "contact"))
        pii = authz_for(request.user).has_global("pii.view")
        return Response({
            **account_data(account),
            "contacts": [contact_data(c, pii) for c in account.contacts.filter(status="ACTIVE")],
            "interactions": [{"id": str(i.id), "event_code": i.event_code, "contact_name": i.contact.full_name, "captured_at": i.captured_at, "quality": i.quality} for i in interactions.order_by("-captured_at")[:50]],
        })


class ContactListView(APIView):
    permission_classes = [HasCapability.of("contact.merge", "lead.view.all")]

    def get(self, request):
        qs = Contact.objects.select_related("primary_account").annotate(interaction_count=Count("interactions", distinct=True))
        q = request.query_params.get("q")
        if q:
            mobile = normalize_mobile(q)
            qs = qs.filter(Q(name_normalized__contains=normalize_search(q)) | (Q(mobile=mobile) if mobile else Q(pk__in=[])))
        qs = qs.filter(status=request.query_params.get("status", "ACTIVE"))
        pii = authz_for(request.user).has_global("pii.view")
        page = StandardPagination()
        items = page.paginate_queryset(qs.order_by("full_name"), request)
        return page.get_paginated_response([
            {**contact_data(c, pii), "account": account_data(c.primary_account), "interaction_count": c.interaction_count} for c in items
        ])


class ContactDetailView(APIView):
    permission_classes = [HasCapability.of("contact.merge", "lead.view.all")]

    def get(self, request, pk):
        contact = Contact.objects.select_related("primary_account").filter(pk=pk).first() or _nf()
        pii = authz_for(request.user).has_global("pii.view")
        interactions = scoping.visible_interactions(request.user, contact.interactions.select_related("event", "created_by"))
        return Response({
            **contact_data(contact, pii),
            "account": account_data(contact.primary_account),
            "interactions": [{"id": str(i.id), "event_code": i.event_code, "event_name": i.event.display_name, "captured_at": i.captured_at,
                              "created_by": user_ref(i.created_by), "quality": i.quality} for i in interactions.order_by("-captured_at")],
        })


def _nf():
    raise NotFound("یافت نشد.")


class DuplicateListView(APIView):
    permission_classes = [HasCapability.of("contact.merge")]

    def get(self, request):
        qs = DuplicateCandidate.objects.filter(status=request.query_params.get("status", "OPEN"))
        page = StandardPagination()
        items = page.paginate_queryset(qs, request)
        ids = {c.existing_id for c in items} | {c.candidate_id for c in items}
        contacts = {c.id: c for c in Contact.objects.filter(pk__in=ids).select_related("primary_account").annotate(n=Count("interactions"))}
        accounts = {a.id: a for a in Account.objects.filter(pk__in=ids)}
        out = []
        for c in items:
            def side(pk):
                if c.entity_type == "CONTACT" and pk in contacts:
                    obj = contacts[pk]
                    return {**contact_data(obj, True), "account": account_data(obj.primary_account), "interaction_count": obj.n}
                if pk in accounts:
                    return account_data(accounts[pk])
                return None
            out.append({"id": str(c.id), "entity_type": c.entity_type, "match_type": c.match_type, "match_label": c.get_match_type_display(),
                        "score": c.score, "status": c.status, "created_at": c.created_at, "existing": side(c.existing_id), "candidate": side(c.candidate_id)})
        return page.get_paginated_response(out)


class DuplicateActionView(APIView):
    permission_classes = [HasCapability.of("contact.merge")]

    def post(self, request, pk, action):
        cand = DuplicateCandidate.objects.filter(pk=pk, status="OPEN").first() or _nf()
        if action == "dismiss":
            cand.status = "DISMISSED"
            cand.resolved_by = request.user
            cand.resolved_at = timezone.now()
            cand.save()
            audit(request.user, "duplicate.dismissed", "duplicate_candidate", cand.id, request=request)
            return Response({"status": "DISMISSED"})
        if action != "merge":
            raise NotFound()
        survivor_id = request.data.get("survivor_id")
        if str(survivor_id) not in (str(cand.existing_id), str(cand.candidate_id)):
            raise ValidationError({"survivor_id": "رکورد باقی‌مانده باید یکی از دو رکورد باشد."})
        merged_id = cand.candidate_id if str(survivor_id) == str(cand.existing_id) else cand.existing_id
        model = Contact if cand.entity_type == "CONTACT" else Account
        survivor, merged = model.objects.get(pk=survivor_id), model.objects.get(pk=merged_id)
        check_version(survivor, {"version": request.data.get("survivor_version", survivor.version)})
        record = services.merge_contacts(request.user, survivor, merged, request=request) if cand.entity_type == "CONTACT" else services.merge_accounts(request.user, survivor, merged, request=request)
        cand.status = "MERGED"
        cand.resolved_by = request.user
        cand.resolved_at = timezone.now()
        cand.save()
        return Response({"status": "MERGED", "merge_id": str(record.id)})


class AccountMergeView(APIView):
    permission_classes = [HasCapability.of("contact.merge")]

    def post(self, request):
        survivor = Account.objects.filter(pk=request.data.get("survivor_id")).first() or _nf()
        merged = Account.objects.filter(pk=request.data.get("merged_id")).first() or _nf()
        record = services.merge_accounts(request.user, survivor, merged, request=request)
        return Response({"merge_id": str(record.id)})


class MergeListView(APIView):
    permission_classes = [HasCapability.of("contact.merge")]

    def get(self, request):
        page = StandardPagination()
        items = page.paginate_queryset(MergeRecord.objects.select_related("performed_by", "reverted_by"), request)
        return page.get_paginated_response([{
            "id": str(m.id), "entity_type": m.entity_type, "survivor_id": str(m.survivor_id), "merged_id": str(m.merged_id),
            "moved": {k: len(v) for k, v in m.moved_refs.items()}, "performed_by": user_ref(m.performed_by), "created_at": m.created_at,
            "reverted_at": m.reverted_at, "reverted_by": user_ref(m.reverted_by),
        } for m in items])


class MergeRevertView(APIView):
    permission_classes = [HasCapability.of("contact.merge")]

    def post(self, request, pk):
        record = MergeRecord.objects.filter(pk=pk).first() or _nf()
        services.revert_merge(request.user, record, request=request)
        return Response({"status": "REVERTED"})


class QuarantineListView(APIView):
    permission_classes = [HasCapability.of("sync.review")]

    def get(self, request):
        qs = SyncQuarantine.objects.select_related("event", "user").filter(status=request.query_params.get("status", "PENDING"))
        page = StandardPagination()
        items = page.paginate_queryset(qs, request)
        return page.get_paginated_response([{
            "id": str(q.id), "event": {"id": str(q.event_id), "code": q.event.code, "display_name": q.event.display_name, "status": q.event.status},
            "user": user_ref(q.user), "reason": q.reason, "status": q.status, "created_at": q.created_at,
            "captured_at": q.payload.get("captured_at"), "contact_name": q.payload.get("contact_name"),
            "org_name": q.payload.get("org_name"), "resolution_note": q.resolution_note,
            "interaction_id": str(q.interaction_id) if q.interaction_id else None,
        } for q in items])


class QuarantineActionView(APIView):
    permission_classes = [HasCapability.of("sync.review")]

    def post(self, request, pk, action):
        item = SyncQuarantine.objects.select_related("event", "user").filter(pk=pk).first() or _nf()
        if action not in ("approve", "reject"):
            raise NotFound()
        services.resolve_quarantine(request.user, item, action == "approve", request.data.get("note", ""), request=request)
        return Response({"status": item.status, "interaction_id": str(item.interaction_id) if item.interaction_id else None})


# ----------------------------------------------------------------- Tags ---

def tag_admin_data(t, usage=None):
    return {**tag_ref(t), "description": t.description, "sort_order": t.sort_order, "version": t.version,
            "usage_count": usage if usage is not None else t.opportunity_links.count(), "created_at": t.created_at, "updated_at": t.updated_at}


class TagListView(APIView):
    def get(self, request):
        qs = Tag.objects.annotate(usage=Count("opportunity_links"))
        if request.query_params.get("active") in ("1", "true"):
            qs = qs.filter(status="ACTIVE")
        return Response([tag_admin_data(t, t.usage) for t in qs])

    def post(self, request):
        authz_for(request.user).require("tags.manage")
        data = request.data
        name = clean_display(data.get("name_fa", ""))
        if not name or len(name) > 60:
            raise ValidationError({"name_fa": "نام فارسی برچسب (حداکثر ۶۰ نویسه) الزامی است."})
        color = data.get("color", "slate")
        if color not in Tag.COLORS:
            raise ValidationError({"color": "رنگ باید از پالت تأییدشده انتخاب شود."})
        normalized = normalize_search(name)
        if Tag.objects.filter(name_normalized=normalized, status="ACTIVE").exists():
            raise ValidationError({"name_fa": "برچسب فعالی با همین نام وجود دارد."})
        code = slugify(data.get("code") or data.get("name_en") or "", allow_unicode=False)[:50] or "tag"
        base, n = code, 1
        while Tag.objects.filter(code=code).exists():
            n += 1
            code = f"{base}-{n}"
        tag = Tag.objects.create(code=code, name_fa=name, name_en=clean_display(data.get("name_en", "")), name_normalized=normalized,
                                 description=clean_display(data.get("description", ""))[:255], color=color,
                                 sort_order=int(data.get("sort_order") or Tag.objects.count()), created_by=request.user)
        audit(request.user, "tag.created", "tag", tag.id, after={"code": tag.code, "name_fa": tag.name_fa, "color": tag.color}, request=request)
        return Response(tag_admin_data(tag, 0), status=status.HTTP_201_CREATED)


class TagDetailView(APIView):
    permission_classes = [HasCapability.of("tags.manage")]

    def patch(self, request, pk):
        tag = Tag.objects.filter(pk=pk).first() or _nf()
        check_version(tag, request.data)
        before = {"name_fa": tag.name_fa, "name_en": tag.name_en, "description": tag.description, "color": tag.color, "sort_order": tag.sort_order}
        data = request.data
        if "name_fa" in data:
            name = clean_display(data["name_fa"])
            if not name:
                raise ValidationError({"name_fa": "نام الزامی است."})
            normalized = normalize_search(name)
            if Tag.objects.filter(name_normalized=normalized, status="ACTIVE").exclude(pk=tag.pk).exists():
                raise ValidationError({"name_fa": "برچسب فعالی با همین نام وجود دارد."})
            tag.name_fa, tag.name_normalized = name, normalized
        if "name_en" in data:
            tag.name_en = clean_display(data["name_en"])
        if "description" in data:
            tag.description = clean_display(data["description"])[:255]
        if "color" in data:
            if data["color"] not in Tag.COLORS:
                raise ValidationError({"color": "رنگ باید از پالت تأییدشده انتخاب شود."})
            tag.color = data["color"]
        if "sort_order" in data:
            tag.sort_order = int(data["sort_order"])
        bump(tag)
        tag.save()
        after = {"name_fa": tag.name_fa, "name_en": tag.name_en, "description": tag.description, "color": tag.color, "sort_order": tag.sort_order}
        b, a = diff(before, after)
        audit(request.user, "tag.updated", "tag", tag.id, before=b, after=a, request=request)
        return Response(tag_admin_data(tag))


class TagArchiveView(APIView):
    permission_classes = [HasCapability.of("tags.manage")]

    def post(self, request, pk, action):
        tag = Tag.objects.filter(pk=pk).first() or _nf()
        check_version(tag, request.data)
        target = "ARCHIVED" if action == "archive" else "ACTIVE"
        if target == "ACTIVE" and Tag.objects.filter(name_normalized=tag.name_normalized, status="ACTIVE").exclude(pk=tag.pk).exists():
            raise BusinessRuleViolation("برچسب فعالی با همین نام وجود دارد؛ ابتدا نام را تغییر دهید.")
        with transaction.atomic():
            tag.status = target
            bump(tag)
            tag.save()
            audit(request.user, f"tag.{'archived' if target == 'ARCHIVED' else 'restored'}", "tag", tag.id, request=request)
        return Response(tag_admin_data(tag))
