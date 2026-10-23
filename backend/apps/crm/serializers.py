"""Read serializers for leads. Field-level PII masking is applied here."""
from apps.common.text import mask_email, mask_phone

from . import scoping
from .models import Opportunity, Referral


def user_ref(u):
    if not u:
        return None
    return {"id": str(u.id), "full_name": u.full_name, "title": u.title}


def tag_ref(t):
    return {"id": str(t.id), "code": t.code, "name_fa": t.name_fa, "name_en": t.name_en, "color": t.color, "status": t.status}


def contact_data(contact, pii):
    return {
        "id": str(contact.id),
        "full_name": contact.full_name,
        "title": contact.title,
        "mobile": contact.mobile if pii else mask_phone(contact.mobile),
        "email": contact.email if pii else mask_email(contact.email),
        "alt_phone": contact.alt_phone if pii else mask_phone(contact.alt_phone),
        "contact_preference": contact.contact_preference,
        "status": contact.status,
        "version": contact.version,
        "provenance": contact.provenance,
        "updated_at": contact.updated_at,
    }


def account_data(account):
    if not account:
        return None
    return {
        "id": str(account.id), "name": account.name, "official_name": account.official_name, "alt_name": account.alt_name,
        "industry": account.industry, "org_type": account.org_type, "city": account.city, "website": account.website,
        "legal_id": account.legal_id, "status": account.status, "version": account.version, "provenance": account.provenance,
        "updated_at": account.updated_at,
    }


def opportunity_data(opp):
    if not opp:
        return None
    return {
        "id": str(opp.id), "stage": opp.stage, "stage_label": opp.get_stage_display(), "owner": user_ref(opp.owner),
        "qualified_by": user_ref(opp.qualified_by), "qualified_at": opp.qualified_at,
        "business_problem": opp.business_problem, "use_case": opp.use_case, "urgency": opp.urgency,
        "decision_role": opp.decision_role, "stakeholders": opp.stakeholders, "size_estimate": opp.size_estimate,
        "readiness": opp.readiness, "blockers": opp.blockers, "next_step": opp.next_step,
        "next_step_due_at": opp.next_step_due_at, "outcome_note": opp.outcome_note, "closed_at": opp.closed_at,
        "version": opp.version, "allowed_stages": sorted(Opportunity.TRANSITIONS.get(opp.stage, [])),
        "tags": [tag_ref(link.tag) for link in opp.tag_links.select_related("tag").order_by("tag__sort_order", "tag__name_fa")],
        "provenance": opp.provenance,
    }


def _opp(interaction):
    try:
        return interaction.opportunity
    except Opportunity.DoesNotExist:
        return None


def interaction_list_item(i, user, pii_all=False, pii_events=frozenset()):
    opp = _opp(i)
    pii = (
        pii_all or i.event_id in pii_events or i.created_by_id == user.id or i.triage_owner_id == user.id
        or bool(opp and opp.owner_id == user.id)
    )
    pending = [r for r in i.referrals.all() if r.status == "PENDING"]
    return {
        "id": str(i.id),
        "event": {"id": str(i.event_id), "code": i.event_code, "display_name": i.event.display_name, "status": i.event.status},
        "captured_at": i.captured_at,
        "created_by": user_ref(i.created_by),
        "contact": {"id": str(i.contact_id), "full_name": i.contact.full_name,
                    "mobile": i.contact.mobile if pii else mask_phone(i.contact.mobile)},
        "account": {"id": str(i.account_id), "name": i.account.name} if i.account_id else None,
        "products": [{"id": str(l.product_id), "code": l.product_code, "name_fa": l.product.name_fa} for l in i.product_links.all()],
        "quality": i.quality,
        "status": i.status,
        "captured_offline": i.captured_offline,
        "triage_owner": user_ref(i.triage_owner),
        "opportunity": {"id": str(opp.id), "stage": opp.stage, "stage_label": opp.get_stage_display(), "owner": user_ref(opp.owner),
                        "tags": [tag_ref(l.tag) for l in opp.tag_links.all()]} if opp else None,
        "pending_referral": {"id": str(pending[0].id), "to_user": user_ref(pending[0].to_user)} if pending else None,
        "responsible": user_ref(opp.owner if opp and opp.owner_id else i.triage_owner),
        "note": i.note[:140],
    }


def interaction_detail(i, user):
    from .services import completeness

    perms = scoping.permissions_for(user, i)
    opp = _opp(i)
    return {
        "id": str(i.id),
        "version": i.version,
        "event": {"id": str(i.event_id), "code": i.event_code, "display_name": i.event.display_name, "status": i.event.status},
        "captured_at": i.captured_at,
        "received_at": i.received_at,
        "client_record_id": str(i.client_record_id),
        "captured_offline": i.captured_offline,
        "created_by": user_ref(i.created_by),
        "updated_by": user_ref(i.updated_by),
        "captured": {
            "contact_name": i.captured_contact_name,
            "mobile": i.captured_mobile if perms["view_pii"] else mask_phone(i.captured_mobile),
            "email": i.captured_email if perms["view_pii"] else mask_email(i.captured_email),
            "org_name": i.captured_org_name,
        },
        "contact": contact_data(i.contact, perms["view_pii"]),
        "account": account_data(i.account),
        "products": [{"id": str(l.product_id), "code": l.product_code, "name_fa": l.product.name_fa, "name_en": l.product.name_en} for l in i.product_links.select_related("product")],
        "quality": i.quality,
        "note": i.note,
        "status": i.status,
        "triage_owner": user_ref(i.triage_owner),
        "opportunity": opportunity_data(opp),
        "referrals": [referral_data(r) for r in i.referrals.select_related("from_user", "to_user").order_by("-created_at")],
        "tasks": [task_data(t) for t in i.tasks.select_related("owner", "created_by").order_by("status", "due_at")],
        "completeness": completeness(i),
        "permissions": perms,
        "other_interactions": [
            {"id": str(o.id), "event_code": o.event_code, "captured_at": o.captured_at}
            for o in scoping.visible_interactions(user, i.contact.interactions.exclude(pk=i.pk))[:10]
        ],
    }


def referral_data(r, with_lead=False):
    data = {
        "id": str(r.id), "interaction_id": str(r.interaction_id), "opportunity_id": str(r.opportunity_id) if r.opportunity_id else None,
        "event_id": str(r.event_id), "purpose": r.purpose, "purpose_label": r.get_purpose_display(),
        "from_user": user_ref(r.from_user), "to_user": user_ref(r.to_user), "reason": r.reason, "status": r.status,
        "status_label": r.get_status_display(), "due_at": r.due_at, "responded_at": r.responded_at,
        "response_note": r.response_note, "created_at": r.created_at, "product_codes": r.product_codes,
    }
    if with_lead:
        i = r.interaction
        data["lead"] = {"contact_name": i.contact.full_name, "account_name": i.account.name if i.account_id else None,
                        "event_code": i.event_code, "quality": i.quality}
    return data


def task_data(t, with_lead=False):
    data = {
        "id": str(t.id), "interaction_id": str(t.interaction_id), "title": t.title, "description": t.description,
        "owner": user_ref(t.owner), "created_by": user_ref(t.created_by), "due_at": t.due_at, "status": t.status,
        "status_label": t.get_status_display(), "outcome": t.outcome, "completed_at": t.completed_at, "version": t.version,
        "created_at": t.created_at,
    }
    if with_lead:
        data["lead"] = {"contact_name": t.interaction.contact.full_name, "event_code": t.interaction.event_code}
    return data


def activity_data(a):
    return {
        "id": str(a.id), "type": a.type, "type_label": a.get_type_display(), "actor": user_ref(a.actor),
        "notes": a.notes, "metadata": a.metadata, "created_at": a.created_at,
    }


REFERRAL_STATUS = dict(Referral.Status.choices)
