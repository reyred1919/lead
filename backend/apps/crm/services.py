"""Domain services for capture, triage, referral, qualification and enrichment.

Views stay thin; every state change, permission decision and side effect
(activity, audit, outbox) lives here so the rules are testable in one place.
"""
import uuid
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.catalog.models import Event, EventMembership, EventProduct
from apps.common.audit import audit
from apps.common.concurrency import bump, check_version
from apps.common.exceptions import BusinessRuleViolation
from apps.common.outbox import emit
from apps.common.text import clean_display, normalize_email, normalize_mobile, normalize_phone, normalize_search, similarity
from apps.iam.authz import authz_for
from apps.iam.models import User

from . import scoping
from .models import (
    Account,
    Activity,
    Contact,
    ContactAccountAffiliation,
    DuplicateCandidate,
    Interaction,
    InteractionProduct,
    MergeRecord,
    Opportunity,
    OpportunityProduct,
    OpportunityTag,
    Quality,
    RecordStatus,
    Referral,
    SyncQuarantine,
    Tag,
    Task,
)

OFFLINE_CLOCK_SKEW = timedelta(minutes=10)


def _actor_ref(user):
    return {"id": str(user.id), "name": user.full_name}


def log_activity(interaction, type_, actor, notes="", metadata=None, opportunity=None):
    if opportunity is None:
        opportunity = Opportunity.objects.filter(source_interaction=interaction).first()
    return Activity.objects.create(
        interaction=interaction, opportunity=opportunity, type=type_, actor=actor, notes=notes, metadata=metadata or {}
    )


# --------------------------------------------------------------------------
# Master data resolution (accounts / contacts)
# --------------------------------------------------------------------------

def _follow_merge(obj):
    seen = 0
    while obj is not None and obj.status == RecordStatus.MERGED and obj.merged_into_id and seen < 10:
        obj = obj.merged_into
        seen += 1
    return obj


def resolve_account(user, account_id=None, org_name=""):
    if account_id:
        account = Account.objects.filter(pk=account_id).first()
        if not account:
            raise ValidationError({"account_id": "سازمان انتخاب‌شده یافت نشد."})
        return _follow_merge(account), False
    name = clean_display(org_name)
    if not name:
        return None, False
    normalized = normalize_search(name)
    existing = Account.objects.filter(name_normalized=normalized, status=RecordStatus.ACTIVE).first()
    if existing:
        # Exact normalized name match is the same organization (exact, not fuzzy).
        return existing, False
    now = timezone.now().isoformat()
    account = Account.objects.create(
        name=name, name_normalized=normalized, created_by=user, updated_by=user,
        provenance={"name": {"by": str(user.id), "at": now, "source": "BOOTH_CAPTURE"}},
    )
    return account, True


def resolve_contact(user, contact_id, full_name, mobile, email, account):
    """Return (contact, created, duplicate_candidates). Never merges silently."""
    if contact_id:
        contact = Contact.objects.filter(pk=contact_id).first()
        if not contact:
            raise ValidationError({"contact_id": "مخاطب انتخاب‌شده یافت نشد."})
        return _follow_merge(contact), False, []

    normalized_name = normalize_search(full_name)
    active = Contact.objects.filter(status=RecordStatus.ACTIVE)
    if mobile:
        exact = active.filter(mobile=mobile, name_normalized=normalized_name).first()
        if exact:
            return exact, False, []
    elif email:
        exact = active.filter(email=email, name_normalized=normalized_name).first()
        if exact:
            return exact, False, []

    now = timezone.now().isoformat()
    contact = Contact.objects.create(
        full_name=full_name, name_normalized=normalized_name, mobile=mobile or "", email=email or "",
        primary_account=account, created_by=user, updated_by=user,
        provenance={"full_name": {"by": str(user.id), "at": now, "source": "BOOTH_CAPTURE"}},
    )
    candidates = []
    if mobile:
        for other in active.filter(mobile=mobile).exclude(pk=contact.pk)[:5]:
            candidates.append((other, DuplicateCandidate.MatchType.EXACT_PHONE, 1.0))
    if email:
        for other in active.filter(email=email).exclude(pk=contact.pk)[:5]:
            if all(c[0].pk != other.pk for c in candidates):
                candidates.append((other, DuplicateCandidate.MatchType.EXACT_EMAIL, 1.0))
    if not candidates and account:
        for other in active.filter(primary_account=account).exclude(pk=contact.pk)[:50]:
            score = similarity(other.full_name, full_name)
            if score >= 0.5:
                candidates.append((other, DuplicateCandidate.MatchType.FUZZY_NAME, score))
    for other, match, score in candidates:
        DuplicateCandidate.objects.get_or_create(
            entity_type="CONTACT", existing_id=other.pk, candidate_id=contact.pk,
            defaults={"match_type": match, "score": score},
        )
    return contact, True, candidates


def suggest_contacts(query, mobile=None, limit=8):
    qs = Contact.objects.filter(status=RecordStatus.ACTIVE).select_related("primary_account")
    results = []
    if mobile:
        results = list(qs.filter(mobile=mobile)[:limit])
    if query and len(results) < limit:
        nq = normalize_search(query)
        results += [c for c in qs.filter(name_normalized__contains=nq)[: limit * 2] if c not in results]
    return results[:limit]


# --------------------------------------------------------------------------
# Capture
# --------------------------------------------------------------------------

def _validate_capture_fields(data):
    errors = {}
    full_name = clean_display(data.get("contact_name", ""))
    if not full_name:
        errors["contact_name"] = "نام مخاطب الزامی است."
    elif len(full_name) > 200:
        errors["contact_name"] = "نام مخاطب بیش از حد طولانی است."
    raw_mobile = (data.get("mobile") or "").strip()
    raw_email = (data.get("email") or "").strip()
    mobile = normalize_mobile(raw_mobile) if raw_mobile else None
    email = normalize_email(raw_email) if raw_email else None
    if raw_mobile and not mobile:
        errors["mobile"] = "شماره موبایل معتبر نیست (نمونه: ۰۹۱۲۳۴۵۶۷۸۹)."
    if raw_email and not email:
        errors["email"] = "ایمیل معتبر نیست."
    if not raw_mobile and not raw_email:
        errors["mobile"] = "شماره موبایل یا ایمیل معتبر الزامی است."
    product_ids = data.get("product_ids") or []
    if not isinstance(product_ids, list) or not product_ids:
        errors["product_ids"] = "حداقل یک محصول مورد علاقه را انتخاب کنید."
    quality = data.get("quality") or Quality.FOLLOW_UP
    if quality not in Quality.values:
        errors["quality"] = "کیفیت گفت‌وگو نامعتبر است."
    note = (data.get("note") or "").strip()
    if len(note) > 2000:
        errors["note"] = "یادداشت حداکثر ۲۰۰۰ نویسه است."
    if errors:
        raise ValidationError(errors)
    return full_name, raw_mobile, mobile, raw_email, email, product_ids, quality, note


def _parse_uuid(value, field):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        raise ValidationError({field: "شناسه نامعتبر است."})


class CaptureResult:
    def __init__(self, status, interaction=None, quarantine=None, duplicates=None):
        self.status = status  # CREATED | DUPLICATE | QUARANTINED
        self.interaction = interaction
        self.quarantine = quarantine
        self.duplicates = duplicates or []


def capture(user, data, request=None):
    """Create an interaction. Idempotent on (user, client_record_id)."""
    client_record_id = _parse_uuid(data.get("client_record_id") or uuid.uuid4(), "client_record_id")
    existing = Interaction.objects.filter(created_by=user, client_record_id=client_record_id).first()
    if existing:
        return CaptureResult("DUPLICATE", interaction=existing)
    quarantined = SyncQuarantine.objects.filter(user=user, client_record_id=client_record_id).first()
    if quarantined:
        return CaptureResult("QUARANTINED", quarantine=quarantined)

    event_id = _parse_uuid(data.get("event_id"), "event_id")
    event = Event.objects.filter(pk=event_id).first()
    if not event:
        raise NotFound("رویداد یافت نشد.")

    offline = bool(data.get("captured_offline"))
    now = timezone.now()
    captured_at = now
    if offline and data.get("captured_at"):
        parsed = parse_datetime(str(data["captured_at"]))
        if not parsed or parsed.tzinfo is None:
            raise ValidationError({"captured_at": "زمان ثبت باید ISO-8601 با منطقه زمانی باشد."})
        if parsed > now + OFFLINE_CLOCK_SKEW:
            raise ValidationError({"captured_at": "زمان ثبت در آینده است."})
        captured_at = parsed

    fields = _validate_capture_fields(data)
    az = authz_for(user)
    grant = az.events.get(event.id)

    # Event-closure and membership policy for offline sync (blueprint §22.4).
    if offline:
        reason = None
        if grant is None:
            had_membership = EventMembership.objects.filter(event=event, user=user).exists()
            if not had_membership:
                raise PermissionDenied("شما عضو این رویداد نیستید.")
            reason = "MEMBERSHIP_INACTIVE"
        elif event.status != Event.Status.ACTIVE:
            within_event = event.closed_at and captured_at <= event.closed_at and captured_at >= event.starts_at - timedelta(days=1)
            within_grace = event.closed_at and now <= event.closed_at + timedelta(hours=event.sync_grace_hours)
            if not (event.status == Event.Status.CLOSED and within_event and within_grace):
                reason = "EVENT_CLOSED_BEYOND_GRACE" if event.status == Event.Status.CLOSED else "EVENT_NOT_ACTIVE"
        if reason:
            payload = {k: v for k, v in data.items() if k in {
                "event_id", "client_record_id", "captured_at", "contact_name", "mobile", "email", "product_ids",
                "org_name", "account_id", "contact_id", "quality", "note", "captured_offline"}}
            payload["event_id"] = str(event.id)
            payload["client_record_id"] = str(client_record_id)
            payload["captured_at"] = captured_at.isoformat()
            try:
                with transaction.atomic():
                    q = SyncQuarantine.objects.create(
                        event=event, user=user, client_record_id=client_record_id, payload=payload, reason=reason
                    )
            except IntegrityError:
                q = SyncQuarantine.objects.get(user=user, client_record_id=client_record_id)
            audit(user, "sync.quarantined", "interaction", str(client_record_id), metadata={"reason": reason, "event": event.code}, request=request)
            return CaptureResult("QUARANTINED", quarantine=q)
    else:
        if grant is None:
            raise PermissionDenied("برای ثبت لید باید عضو فعال این رویداد باشید.")
        if event.status != Event.Status.ACTIVE:
            raise BusinessRuleViolation("ثبت لید تازه فقط در رویداد فعال امکان‌پذیر است.", code="event_not_active")

    return _create_interaction(user, event, client_record_id, captured_at, offline, fields, data, request)


def _create_interaction(user, event, client_record_id, captured_at, offline, fields, data, request=None):
    full_name, raw_mobile, mobile, raw_email, email, product_ids, quality, note = fields
    product_ids = [_parse_uuid(p, "product_ids") for p in product_ids]
    event_products = {ep.product_id: ep for ep in EventProduct.objects.filter(event=event, is_active=True).select_related("product")}
    invalid = [str(p) for p in product_ids if p not in event_products]
    if invalid:
        raise ValidationError({"product_ids": "محصول انتخاب‌شده در این رویداد ارائه نمی‌شود."})

    try:
        with transaction.atomic():
            account, _ = resolve_account(user, data.get("account_id"), data.get("org_name", ""))
            contact, contact_created, duplicates = resolve_contact(user, data.get("contact_id"), full_name, mobile, email, account)
            if account:
                ContactAccountAffiliation.objects.get_or_create(contact=contact, account=account, defaults={"is_primary": contact.primary_account_id == account.id})
                if contact.primary_account_id is None:
                    contact.primary_account = account
                    contact.save(update_fields=["primary_account", "updated_at"])
            interaction = Interaction.objects.create(
                event=event, event_code=event.code, created_by=user, captured_at=captured_at,
                client_record_id=client_record_id, captured_offline=offline, contact=contact, account=account,
                captured_contact_name=full_name, captured_mobile=raw_mobile, captured_email=raw_email,
                captured_org_name=clean_display(data.get("org_name", "")) or (account.name if account else ""),
                quality=quality, note=note,
            )
            seen = set()
            for pid in product_ids:
                if pid in seen:
                    continue
                seen.add(pid)
                InteractionProduct.objects.create(interaction=interaction, product_id=pid, product_code=event_products[pid].product.code)
            log_activity(interaction, Activity.Type.CAPTURED, user, metadata={"event_code": event.code, "offline": offline})
            audit(user, "interaction.created", "interaction", interaction.id, after={
                "event": event.code, "products": [event_products[p].product.code for p in seen], "offline": offline,
            }, request=request)
            emit("interaction.captured", "interaction", interaction.id, {
                "interaction_id": str(interaction.id), "event_id": str(event.id), "event_code": event.code,
                "created_by": str(user.id), "product_codes": [event_products[p].product.code for p in seen],
            }, actor=user, correlation_id=f"interaction.captured:{interaction.id}")

            # Optional default owner from event-product mapping → pending referral.
            default_owner = next((event_products[p].default_owner for p in product_ids if event_products[p].default_owner_id), None)
            if default_owner and default_owner.id != user.id and default_owner.is_active:
                _create_referral(user, interaction, default_owner, "تخصیص خودکار بر اساس نگاشت محصول رویداد", None, Referral.Purpose.QUALIFICATION, auto=True)
    except IntegrityError:
        existing = Interaction.objects.filter(created_by=user, client_record_id=client_record_id).first()
        if existing:
            return CaptureResult("DUPLICATE", interaction=existing)
        raise
    return CaptureResult("CREATED", interaction=interaction, duplicates=duplicates)


def sync_batch(user, records, request=None):
    """Offline queue upload. Each record is processed independently and idempotently."""
    results = []
    for record in records[:100]:
        crid = record.get("client_record_id")
        try:
            record = {**record, "captured_offline": True}
            result = capture(user, record, request=request)
            results.append({
                "client_record_id": crid, "status": result.status,
                "interaction_id": str(result.interaction.id) if result.interaction else None,
                "quarantine_id": str(result.quarantine.id) if result.quarantine else None,
                "reason": result.quarantine.reason if result.quarantine else None,
            })
        except (ValidationError, PermissionDenied, NotFound, BusinessRuleViolation) as exc:
            results.append({"client_record_id": crid, "status": "REJECTED", "error": exc.detail})
    return results


def resolve_quarantine(user, item, approve, note="", request=None):
    authz_for(user).require("sync.review")
    if item.status != SyncQuarantine.Status.PENDING:
        raise BusinessRuleViolation("این مورد قبلاً بررسی شده است.")
    with transaction.atomic():
        item.status = SyncQuarantine.Status.APPROVED if approve else SyncQuarantine.Status.REJECTED
        item.resolved_by = user
        item.resolved_at = timezone.now()
        item.resolution_note = note
        if approve:
            data = item.payload
            fields = _validate_capture_fields(data)
            parsed = parse_datetime(data.get("captured_at") or "") or item.created_at
            item.save()
            result = _create_interaction(item.user, item.event, item.client_record_id, parsed, True, fields, data, request)
            item.interaction = result.interaction
        item.save()
        audit(user, "sync.quarantine_" + ("approved" if approve else "rejected"), "sync_quarantine", item.id, metadata={"note": note}, request=request)
    return item


def correct_capture(user, interaction, data, request=None):
    if interaction.created_by_id != user.id:
        raise PermissionDenied("فقط ثبت‌کننده می‌تواند ثبت اولیه را اصلاح کند.")
    if interaction.event.status != Event.Status.ACTIVE:
        raise BusinessRuleViolation("اصلاح ثبت اولیه پس از پایان رویداد مجاز نیست؛ از «تکمیل اطلاعات لید» استفاده کنید.")
    check_version(interaction, data)
    before = {"quality": interaction.quality, "note": interaction.note, "products": sorted(interaction.product_links.values_list("product_code", flat=True))}
    with transaction.atomic():
        if "quality" in data:
            if data["quality"] not in Quality.values:
                raise ValidationError({"quality": "نامعتبر"})
            interaction.quality = data["quality"]
        if "note" in data:
            interaction.note = (data["note"] or "").strip()[:2000]
        if "product_ids" in data:
            ids = [_parse_uuid(p, "product_ids") for p in data["product_ids"] or []]
            if not ids:
                raise ValidationError({"product_ids": "حداقل یک محصول لازم است."})
            eps = {ep.product_id: ep for ep in EventProduct.objects.filter(event=interaction.event, is_active=True, product_id__in=ids).select_related("product")}
            if len(eps) != len(set(ids)):
                raise ValidationError({"product_ids": "محصول انتخاب‌شده در این رویداد ارائه نمی‌شود."})
            interaction.product_links.exclude(product_id__in=ids).delete()
            for pid, ep in eps.items():
                InteractionProduct.objects.get_or_create(interaction=interaction, product_id=pid, defaults={"product_code": ep.product.code})
        bump(interaction)
        interaction.updated_by = user
        interaction.save()
        after = {"quality": interaction.quality, "note": interaction.note, "products": sorted(interaction.product_links.values_list("product_code", flat=True))}
        log_activity(interaction, Activity.Type.CORRECTED, user, metadata={"before": before, "after": after})
        audit(user, "interaction.corrected", "interaction", interaction.id, before=before, after=after, request=request)
    return interaction


# --------------------------------------------------------------------------
# Referrals
# --------------------------------------------------------------------------

def _recipient_allowed(recipient, event):
    if not recipient.is_active:
        return False
    if EventMembership.objects.filter(event=event, user=recipient, status=EventMembership.Status.ACTIVE).exists():
        return True
    return authz_for(recipient).has_global("lead.view.all")


def _create_referral(actor, interaction, recipient, reason, due_at, purpose, auto=False):
    opportunity = Opportunity.objects.filter(source_interaction=interaction).first()
    pending = list(Referral.objects.filter(interaction=interaction, status=Referral.Status.PENDING))
    if due_at is None and interaction.event.referral_sla_hours:
        due_at = timezone.now() + timedelta(hours=interaction.event.referral_sla_hours)
    referral = Referral.objects.create(
        interaction=interaction, opportunity=opportunity, event=interaction.event, purpose=purpose,
        from_user=actor, to_user=recipient, reason=reason or "", due_at=due_at,
        product_codes=list(interaction.product_links.values_list("product_code", flat=True)),
    )
    for old in pending:
        old.status = Referral.Status.CANCELED
        old.replaced_by = referral
        old.responded_at = timezone.now()
        old.response_note = "جایگزین با ارجاع جدید"
        old.save()
    event_type = "referral.reassigned" if pending else "referral.created"
    log_activity(interaction, Activity.Type.REFERRAL_CREATED, actor, notes=reason or "", metadata={
        "referral_id": str(referral.id), "to": _actor_ref(recipient), "from": _actor_ref(actor), "auto": auto,
        "replaced": [str(o.id) for o in pending],
    }, opportunity=opportunity)
    audit(actor, event_type, "referral", referral.id, after={"interaction": str(interaction.id), "to_user": str(recipient.id), "replaced": [str(o.id) for o in pending]})
    emit(event_type, "referral", referral.id, {
        "referral_id": str(referral.id), "interaction_id": str(interaction.id), "event_id": str(interaction.event_id),
        "event_code": interaction.event_code, "to_user_id": str(recipient.id), "from_user_id": str(actor.id),
        "contact_name": interaction.contact.full_name, "reason": reason or "",
        "due_at": due_at.isoformat() if due_at else None,
        "product_ids": [str(p) for p in interaction.product_links.values_list("product_id", flat=True)],
    }, actor=actor, correlation_id=f"{event_type}:{referral.id}")
    return referral


def refer(actor, interaction, to_user_id, reason="", due_at=None, purpose=Referral.Purpose.FOLLOW_UP, request=None):
    if not scoping.can_assign(actor, interaction):
        raise PermissionDenied("مجوز ارجاع این لید را ندارید.")
    recipient = User.objects.filter(pk=to_user_id).first()
    if not recipient:
        raise ValidationError({"to_user_id": "کاربر گیرنده یافت نشد."})
    if not _recipient_allowed(recipient, interaction.event):
        raise ValidationError({"to_user_id": "گیرنده باید کاربر فعال و عضو این رویداد (یا دارای دسترسی سراسری) باشد."})
    if purpose not in Referral.Purpose.values:
        raise ValidationError({"purpose": "نامعتبر"})
    if isinstance(due_at, str) and due_at:
        due_at = parse_datetime(due_at)
    with transaction.atomic():
        return _create_referral(actor, interaction, recipient, reason, due_at or None, purpose)


def accept_referral(user, referral, request=None):
    if referral.to_user_id != user.id:
        raise PermissionDenied("فقط گیرنده ارجاع می‌تواند آن را بپذیرد.")
    if referral.status != Referral.Status.PENDING:
        raise BusinessRuleViolation("این ارجاع در وضعیت انتظار نیست.")
    with transaction.atomic():
        referral.status = Referral.Status.ACCEPTED
        referral.responded_at = timezone.now()
        referral.save()
        interaction = referral.interaction
        opportunity = Opportunity.objects.filter(source_interaction=interaction).first()
        if opportunity:
            previous = opportunity.owner
            opportunity.owner = user
            if opportunity.stage == Opportunity.Stage.QUALIFIED:
                opportunity.stage = Opportunity.Stage.ASSIGNED
            bump(opportunity)
            opportunity.updated_by = user
            opportunity.save()
            log_activity(interaction, Activity.Type.OWNER_CHANGED, user, metadata={
                "from": _actor_ref(previous) if previous else None, "to": _actor_ref(user), "via_referral": str(referral.id)
            }, opportunity=opportunity)
        else:
            interaction.triage_owner = user
            interaction.save(update_fields=["triage_owner", "updated_at"])
        log_activity(interaction, Activity.Type.REFERRAL_ACCEPTED, user, metadata={"referral_id": str(referral.id)}, opportunity=opportunity)
        audit(user, "referral.accepted", "referral", referral.id, request=request)
        emit("referral.accepted", "referral", referral.id, {
            "referral_id": str(referral.id), "interaction_id": str(interaction.id), "event_id": str(referral.event_id),
            "from_user_id": str(referral.from_user_id), "to_user_id": str(user.id), "contact_name": interaction.contact.full_name,
        }, actor=user, correlation_id=f"referral.accepted:{referral.id}")
    return referral


def return_referral(user, referral, note, request=None):
    if referral.to_user_id != user.id:
        raise PermissionDenied("فقط گیرنده ارجاع می‌تواند آن را بازگرداند.")
    if referral.status != Referral.Status.PENDING:
        raise BusinessRuleViolation("این ارجاع در وضعیت انتظار نیست.")
    if not (note or "").strip():
        raise ValidationError({"note": "دلیل بازگشت الزامی است."})
    with transaction.atomic():
        referral.status = Referral.Status.RETURNED
        referral.responded_at = timezone.now()
        referral.response_note = note.strip()
        referral.save()
        log_activity(referral.interaction, Activity.Type.REFERRAL_RETURNED, user, notes=note, metadata={"referral_id": str(referral.id)})
        audit(user, "referral.returned", "referral", referral.id, metadata={"note": note}, request=request)
        emit("referral.returned", "referral", referral.id, {
            "referral_id": str(referral.id), "interaction_id": str(referral.interaction_id), "event_id": str(referral.event_id),
            "from_user_id": str(referral.from_user_id), "to_user_id": str(user.id), "note": note,
            "contact_name": referral.interaction.contact.full_name,
        }, actor=user, correlation_id=f"referral.returned:{referral.id}")
    return referral


def cancel_referral(user, referral, request=None):
    if referral.from_user_id != user.id and not scoping.can_assign(user, referral.interaction):
        raise PermissionDenied("مجوز لغو این ارجاع را ندارید.")
    if referral.status != Referral.Status.PENDING:
        raise BusinessRuleViolation("فقط ارجاع در انتظار قابل لغو است.")
    with transaction.atomic():
        referral.status = Referral.Status.CANCELED
        referral.responded_at = timezone.now()
        referral.save()
        log_activity(referral.interaction, Activity.Type.REFERRAL_CANCELED, user, metadata={"referral_id": str(referral.id)})
        audit(user, "referral.canceled", "referral", referral.id, request=request)
    return referral


# --------------------------------------------------------------------------
# Qualification, stage, enrichment
# --------------------------------------------------------------------------

QUALIFICATION_FIELDS = [
    "business_problem", "use_case", "urgency", "decision_role", "stakeholders", "size_estimate",
    "readiness", "blockers", "next_step", "next_step_due_at", "outcome_note",
]
ACCOUNT_FIELDS = ["name", "official_name", "alt_name", "industry", "org_type", "city", "website", "legal_id"]
CONTACT_FIELDS = ["full_name", "title", "email", "alt_phone", "mobile", "contact_preference"]


def qualify(user, interaction, data, request=None):
    if not scoping.can_qualify(user, interaction):
        raise PermissionDenied("مجوز ارزیابی این لید را ندارید.")
    if Opportunity.objects.filter(source_interaction=interaction).exists():
        raise BusinessRuleViolation("این لید قبلاً به فرصت تبدیل شده است.")
    owner = None
    if data.get("owner_id"):
        owner = User.objects.filter(pk=data["owner_id"]).first()
        if not owner or not _recipient_allowed(owner, interaction.event):
            raise ValidationError({"owner_id": "مسئول پیگیری باید کاربر فعال و عضو رویداد باشد."})
    product_ids = data.get("product_ids") or list(interaction.product_links.values_list("product_id", flat=True))
    with transaction.atomic():
        opp = Opportunity.objects.create(
            source_interaction=interaction, origin_event=interaction.event, account=interaction.account,
            contact=interaction.contact, owner=owner or interaction.triage_owner,
            stage=Opportunity.Stage.ASSIGNED if (owner or interaction.triage_owner) else Opportunity.Stage.QUALIFIED,
            qualified_by=user, qualified_at=timezone.now(), updated_by=user,
        )
        for field in QUALIFICATION_FIELDS:
            if field in data and data[field] not in (None, ""):
                setattr(opp, field, parse_datetime(data[field]) if field == "next_step_due_at" and isinstance(data[field], str) else data[field])
        opp.save()
        for pid in product_ids:
            OpportunityProduct.objects.get_or_create(opportunity=opp, product_id=pid)
        interaction.status = Interaction.Status.REVIEWED
        interaction.save(update_fields=["status", "updated_at"])
        log_activity(interaction, Activity.Type.QUALIFIED, user, metadata={"opportunity_id": str(opp.id), "owner": _actor_ref(opp.owner) if opp.owner else None}, opportunity=opp)
        audit(user, "opportunity.qualified", "opportunity", opp.id, after={"interaction": str(interaction.id), "owner": str(opp.owner_id) if opp.owner_id else None}, request=request)
        emit("opportunity.qualified", "opportunity", opp.id, {
            "opportunity_id": str(opp.id), "interaction_id": str(interaction.id), "event_id": str(interaction.event_id),
            "owner_id": str(opp.owner_id) if opp.owner_id else None,
        }, actor=user, correlation_id=f"opportunity.qualified:{opp.id}")
        if owner and owner.id != user.id:
            emit("opportunity.owner_changed", "opportunity", opp.id, {
                "opportunity_id": str(opp.id), "interaction_id": str(interaction.id), "to_user_id": str(owner.id),
                "event_id": str(interaction.event_id), "contact_name": interaction.contact.full_name,
            }, actor=user, correlation_id=f"opportunity.owner_changed:{opp.id}:{owner.id}:{opp.version}")
    return opp


def change_stage(user, opp, stage, note="", version=None, request=None):
    interaction = opp.source_interaction
    if not (scoping.can_qualify(user, interaction) or opp.owner_id == user.id):
        raise PermissionDenied("مجوز تغییر مرحله این فرصت را ندارید.")
    check_version(opp, {"version": version})
    if stage not in Opportunity.TRANSITIONS.get(opp.stage, set()):
        raise BusinessRuleViolation(f"انتقال از «{opp.get_stage_display()}» به این مرحله مجاز نیست.", code="invalid_transition")
    with transaction.atomic():
        before = opp.stage
        opp.stage = stage
        opp.closed_at = timezone.now() if stage in ("WON", "LOST") else None
        if note:
            opp.outcome_note = note
        opp.updated_by = user
        bump(opp)
        opp.save()
        log_activity(interaction, Activity.Type.STAGE_CHANGED, user, notes=note, metadata={"from": before, "to": stage}, opportunity=opp)
        audit(user, "opportunity.stage_changed", "opportunity", opp.id, before={"stage": before}, after={"stage": stage}, request=request)
    return opp


def _apply_fields(obj, values, allowed, user, source):
    changes = {}
    now = timezone.now().isoformat()
    for field in allowed:
        if field not in values:
            continue
        new = values[field]
        if isinstance(new, str):
            new = clean_display(new) if field not in ("blockers", "stakeholders", "business_problem", "use_case", "outcome_note") else new.strip()
        if field == "next_step_due_at" and isinstance(new, str):
            new = parse_datetime(new) if new else None
        old = getattr(obj, field)
        if (old or None) == (new or None):
            continue
        setattr(obj, field, new if new is not None else ("" if isinstance(old, str) else None))
        changes[field] = {"from": old.isoformat() if hasattr(old, "isoformat") else old, "to": new.isoformat() if hasattr(new, "isoformat") else new}
        prov = dict(obj.provenance or {})
        prov[field] = {"by": str(user.id), "at": now, "source": source}
        obj.provenance = prov
    return changes


def enrich(user, interaction, data, request=None):
    """Progressive, sectioned post-event enrichment. Allowed after event closure."""
    if not scoping.can_edit_detail(user, interaction):
        raise PermissionDenied("مجوز تکمیل اطلاعات این لید را ندارید.")
    all_changes = {}
    with transaction.atomic():
        account_data = data.get("account")
        if account_data:
            account = interaction.account
            if account is None:
                name = clean_display(account_data.get("name") or account_data.get("official_name") or "")
                if not name:
                    raise ValidationError({"account": {"name": "برای ایجاد سازمان، نام الزامی است."}})
                account, _ = resolve_account(user, None, name)
                interaction.account = account
                interaction.save(update_fields=["account", "updated_at"])
                contact = interaction.contact
                ContactAccountAffiliation.objects.get_or_create(contact=contact, account=account)
                if not contact.primary_account_id:
                    contact.primary_account = account
                    contact.save(update_fields=["primary_account", "updated_at"])
                Opportunity.objects.filter(source_interaction=interaction, account__isnull=True).update(account=account)
            else:
                check_version(account, account_data)
            if "website" in account_data and account_data["website"]:
                site = account_data["website"].strip()
                if not site.lower().startswith(("http://", "https://")):
                    site = "https://" + site
                account_data = {**account_data, "website": site}
            changes = _apply_fields(account, account_data, ACCOUNT_FIELDS, user, "ENRICHMENT")
            if changes:
                if "name" in changes:
                    account.name_normalized = normalize_search(account.name)
                account.updated_by = user
                bump(account)
                account.save()
                all_changes["account"] = changes

        contact_data = data.get("contact")
        if contact_data:
            contact = interaction.contact
            check_version(contact, contact_data)
            contact_data = dict(contact_data)
            if "email" in contact_data and contact_data["email"]:
                email = normalize_email(contact_data["email"])
                if not email:
                    raise ValidationError({"contact": {"email": "ایمیل معتبر نیست."}})
                contact_data["email"] = email
            if "mobile" in contact_data and contact_data["mobile"]:
                mobile = normalize_mobile(contact_data["mobile"])
                if not mobile:
                    raise ValidationError({"contact": {"mobile": "شماره موبایل معتبر نیست."}})
                contact_data["mobile"] = mobile
            if "alt_phone" in contact_data and contact_data["alt_phone"]:
                phone = normalize_phone(contact_data["alt_phone"])
                if not phone:
                    raise ValidationError({"contact": {"alt_phone": "شماره تلفن معتبر نیست."}})
                contact_data["alt_phone"] = phone
            if not scoping.can_view_pii(user, interaction):
                contact_data.pop("mobile", None)
                contact_data.pop("email", None)
            changes = _apply_fields(contact, contact_data, CONTACT_FIELDS, user, "ENRICHMENT")
            if changes:
                if "full_name" in changes:
                    contact.name_normalized = normalize_search(contact.full_name)
                contact.updated_by = user
                bump(contact)
                contact.save()
                all_changes["contact"] = changes

        qual_data = data.get("qualification")
        if qual_data:
            opp = Opportunity.objects.filter(source_interaction=interaction).first()
            if not opp:
                raise BusinessRuleViolation("برای ثبت اطلاعات ارزیابی، ابتدا لید را به فرصت تبدیل کنید.", code="not_qualified")
            check_version(opp, qual_data)
            if qual_data.get("urgency") and qual_data["urgency"] not in Opportunity.Urgency.values:
                raise ValidationError({"qualification": {"urgency": "نامعتبر"}})
            changes = _apply_fields(opp, qual_data, QUALIFICATION_FIELDS, user, "ENRICHMENT")
            if changes:
                opp.updated_by = user
                bump(opp)
                opp.save()
                all_changes["qualification"] = changes

        if all_changes:
            interaction.updated_by = user
            interaction.save(update_fields=["updated_by", "updated_at"])
            log_activity(interaction, Activity.Type.ENRICHED, user, metadata={"changes": all_changes})
            audit(user, "lead.enriched", "interaction", interaction.id,
                  before={s: {f: c["from"] for f, c in ch.items()} for s, ch in all_changes.items()},
                  after={s: {f: c["to"] for f, c in ch.items()} for s, ch in all_changes.items()}, request=request)
    return all_changes


def completeness(interaction):
    """Share of enrichment fields that are filled. Empty means 'unknown', never 'false'."""
    contact = interaction.contact
    account = interaction.account
    opp = Opportunity.objects.filter(source_interaction=interaction).first()
    checks = {
        "contact.full_name": bool(contact.full_name),
        "contact.mobile_or_email": bool(contact.mobile or contact.email),
        "contact.title": bool(contact.title),
        "contact.email": bool(contact.email),
        "account.linked": account is not None,
        "account.industry": bool(account and account.industry),
        "account.city": bool(account and account.city),
        "account.website": bool(account and account.website),
        "opportunity.qualified": opp is not None,
        "opportunity.business_problem": bool(opp and opp.business_problem),
        "opportunity.urgency": bool(opp and opp.urgency),
        "opportunity.next_step": bool(opp and opp.next_step),
        "opportunity.owner": bool(opp and opp.owner_id),
    }
    filled = sum(checks.values())
    return {"percent": round(100 * filled / len(checks)), "missing": [k for k, v in checks.items() if not v]}


# --------------------------------------------------------------------------
# Notes, tasks, tags
# --------------------------------------------------------------------------

def add_note(user, interaction, text, kind="NOTE", request=None):
    if not (scoping.can_edit_detail(user, interaction) or interaction.created_by_id == user.id):
        raise PermissionDenied("مجوز افزودن یادداشت به این لید را ندارید.")
    text = (text or "").strip()
    if not text:
        raise ValidationError({"text": "متن یادداشت الزامی است."})
    if kind not in ("NOTE", "CALL", "MEETING"):
        raise ValidationError({"kind": "نامعتبر"})
    return log_activity(interaction, kind, user, notes=text[:4000])


def create_task(user, interaction, data, request=None):
    if not scoping.can_manage_tasks(user, interaction):
        raise PermissionDenied("مجوز تعریف وظیفه برای این لید را ندارید.")
    title = clean_display(data.get("title", ""))
    if not title:
        raise ValidationError({"title": "عنوان وظیفه الزامی است."})
    owner = User.objects.filter(pk=data.get("owner_id") or user.id).first()
    if not owner or (owner.id != user.id and not _recipient_allowed(owner, interaction.event)):
        raise ValidationError({"owner_id": "مسئول وظیفه باید کاربر فعال و عضو رویداد باشد."})
    due_at = parse_datetime(data["due_at"]) if data.get("due_at") else None
    with transaction.atomic():
        opp = Opportunity.objects.filter(source_interaction=interaction).first()
        task = Task.objects.create(
            interaction=interaction, opportunity=opp, title=title, description=(data.get("description") or "").strip(),
            owner=owner, created_by=user, due_at=due_at,
        )
        log_activity(interaction, Activity.Type.TASK_CREATED, user, notes=title, metadata={
            "task_id": str(task.id), "owner": _actor_ref(owner), "due_at": due_at.isoformat() if due_at else None,
        }, opportunity=opp)
        audit(user, "task.created", "task", task.id, after={"owner": str(owner.id), "interaction": str(interaction.id)}, request=request)
        emit("task.assigned", "task", task.id, {
            "task_id": str(task.id), "interaction_id": str(interaction.id), "event_id": str(interaction.event_id),
            "to_user_id": str(owner.id), "from_user_id": str(user.id), "title": title,
            "due_at": due_at.isoformat() if due_at else None, "contact_name": interaction.contact.full_name,
        }, actor=user, correlation_id=f"task.assigned:{task.id}")
    return task


def complete_task(user, task, outcome="", cancel=False, request=None):
    if task.owner_id != user.id and not scoping.can_manage_tasks(user, task.interaction):
        raise PermissionDenied("مجوز تغییر این وظیفه را ندارید.")
    if task.status != Task.Status.OPEN:
        raise BusinessRuleViolation("این وظیفه باز نیست.")
    with transaction.atomic():
        task.status = Task.Status.CANCELLED if cancel else Task.Status.DONE
        task.outcome = (outcome or "").strip()
        task.completed_at = timezone.now()
        task.completed_by = user
        bump(task)
        task.save()
        log_activity(task.interaction, Activity.Type.TASK_COMPLETED, user, notes=task.outcome, metadata={
            "task_id": str(task.id), "status": task.status, "title": task.title,
        })
        audit(user, "task." + ("cancelled" if cancel else "completed"), "task", task.id, request=request)
    return task


def add_tag(user, opp, tag_id, request=None):
    if not scoping.can_edit_detail(user, opp.source_interaction):
        raise PermissionDenied("مجوز ویرایش برچسب‌های این لید را ندارید.")
    tag = Tag.objects.filter(pk=tag_id).first()
    if not tag:
        raise ValidationError({"tag_id": "برچسب یافت نشد."})
    if tag.status != Tag.Status.ACTIVE:
        raise BusinessRuleViolation("برچسب بایگانی‌شده قابل انتخاب نیست.", code="tag_archived")
    with transaction.atomic():
        link, created = OpportunityTag.objects.get_or_create(opportunity=opp, tag=tag, defaults={"created_by": user})
        if created:
            log_activity(opp.source_interaction, Activity.Type.TAG_APPLIED, user, metadata={"tag_id": str(tag.id), "tag_code": tag.code, "tag_name": tag.name_fa}, opportunity=opp)
            audit(user, "TAG_APPLIED", "opportunity", opp.id, metadata={"tag": tag.code}, request=request)
    return link


def remove_tag(user, opp, tag_id, request=None):
    if not scoping.can_edit_detail(user, opp.source_interaction):
        raise PermissionDenied("مجوز ویرایش برچسب‌های این لید را ندارید.")
    link = OpportunityTag.objects.filter(opportunity=opp, tag_id=tag_id).select_related("tag").first()
    if not link:
        return False
    with transaction.atomic():
        tag = link.tag
        link.delete()
        log_activity(opp.source_interaction, Activity.Type.TAG_REMOVED, user, metadata={"tag_id": str(tag.id), "tag_code": tag.code, "tag_name": tag.name_fa}, opportunity=opp)
        audit(user, "TAG_REMOVED", "opportunity", opp.id, metadata={"tag": tag.code}, request=request)
    return True


# --------------------------------------------------------------------------
# Merge (admin-reviewed, reversible)
# --------------------------------------------------------------------------

def merge_contacts(user, survivor, merged, candidate=None, request=None):
    authz_for(user).require("contact.merge")
    if survivor.pk == merged.pk:
        raise ValidationError("دو رکورد متفاوت انتخاب کنید.")
    if survivor.status != RecordStatus.ACTIVE or merged.status != RecordStatus.ACTIVE:
        raise BusinessRuleViolation("فقط رکوردهای فعال قابل ادغام‌اند.")
    with transaction.atomic():
        moved = {
            "interactions": [str(i) for i in Interaction.objects.filter(contact=merged).values_list("id", flat=True)],
            "opportunities": [str(i) for i in Opportunity.objects.filter(contact=merged).values_list("id", flat=True)],
            "affiliations": [],
        }
        Interaction.objects.filter(contact=merged).update(contact=survivor)
        Opportunity.objects.filter(contact=merged).update(contact=survivor)
        for aff in ContactAccountAffiliation.objects.filter(contact=merged):
            if ContactAccountAffiliation.objects.filter(contact=survivor, account=aff.account).exists():
                continue
            moved["affiliations"].append(str(aff.id))
            aff.contact = survivor
            aff.save()
        merged.status = RecordStatus.MERGED
        merged.merged_into = survivor
        bump(merged)
        merged.save()
        record = MergeRecord.objects.create(entity_type="CONTACT", survivor_id=survivor.pk, merged_id=merged.pk, moved_refs=moved, performed_by=user)
        DuplicateCandidate.objects.filter(entity_type="CONTACT", status="OPEN").filter(
            existing_id__in=[survivor.pk, merged.pk], candidate_id__in=[survivor.pk, merged.pk]
        ).update(status="MERGED", resolved_by=user, resolved_at=timezone.now())
        for interaction in Interaction.objects.filter(pk__in=moved["interactions"]):
            log_activity(interaction, Activity.Type.MERGED, user, metadata={"survivor": str(survivor.pk), "merged": str(merged.pk), "merge_id": str(record.id)})
        audit(user, "contact.merged", "contact", survivor.pk, metadata={"merged": str(merged.pk), "merge_id": str(record.id), "moved": {k: len(v) for k, v in moved.items()}}, request=request)
    return record


def merge_accounts(user, survivor, merged, request=None):
    authz_for(user).require("contact.merge")
    if survivor.pk == merged.pk:
        raise ValidationError("دو رکورد متفاوت انتخاب کنید.")
    if survivor.status != RecordStatus.ACTIVE or merged.status != RecordStatus.ACTIVE:
        raise BusinessRuleViolation("فقط رکوردهای فعال قابل ادغام‌اند.")
    with transaction.atomic():
        moved = {
            "interactions": [str(i) for i in Interaction.objects.filter(account=merged).values_list("id", flat=True)],
            "opportunities": [str(i) for i in Opportunity.objects.filter(account=merged).values_list("id", flat=True)],
            "contacts": [str(i) for i in Contact.objects.filter(primary_account=merged).values_list("id", flat=True)],
            "affiliations": [],
        }
        Interaction.objects.filter(account=merged).update(account=survivor)
        Opportunity.objects.filter(account=merged).update(account=survivor)
        Contact.objects.filter(primary_account=merged).update(primary_account=survivor)
        for aff in ContactAccountAffiliation.objects.filter(account=merged):
            if ContactAccountAffiliation.objects.filter(account=survivor, contact=aff.contact).exists():
                continue
            moved["affiliations"].append(str(aff.id))
            aff.account = survivor
            aff.save()
        merged.status = RecordStatus.MERGED
        merged.merged_into = survivor
        bump(merged)
        merged.save()
        record = MergeRecord.objects.create(entity_type="ACCOUNT", survivor_id=survivor.pk, merged_id=merged.pk, moved_refs=moved, performed_by=user)
        audit(user, "account.merged", "account", survivor.pk, metadata={"merged": str(merged.pk), "merge_id": str(record.id)}, request=request)
    return record


def revert_merge(user, record, request=None):
    authz_for(user).require("contact.merge")
    if record.reverted_at:
        raise BusinessRuleViolation("این ادغام قبلاً بازگردانده شده است.")
    with transaction.atomic():
        refs = record.moved_refs
        if record.entity_type == "CONTACT":
            merged = Contact.objects.get(pk=record.merged_id)
            Interaction.objects.filter(pk__in=refs.get("interactions", [])).update(contact=merged)
            Opportunity.objects.filter(pk__in=refs.get("opportunities", [])).update(contact=merged)
            ContactAccountAffiliation.objects.filter(pk__in=refs.get("affiliations", [])).update(contact=merged)
        else:
            merged = Account.objects.get(pk=record.merged_id)
            Interaction.objects.filter(pk__in=refs.get("interactions", [])).update(account=merged)
            Opportunity.objects.filter(pk__in=refs.get("opportunities", [])).update(account=merged)
            Contact.objects.filter(pk__in=refs.get("contacts", [])).update(primary_account=merged)
            ContactAccountAffiliation.objects.filter(pk__in=refs.get("affiliations", [])).update(account=merged)
        merged.status = RecordStatus.ACTIVE
        merged.merged_into = None
        bump(merged)
        merged.save()
        record.reverted_at = timezone.now()
        record.reverted_by = user
        record.save()
        audit(user, record.entity_type.lower() + ".merge_reverted", record.entity_type.lower(), record.survivor_id, metadata={"merge_id": str(record.id)}, request=request)
    return record
