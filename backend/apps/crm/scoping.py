"""Row-level and field-level authorization for leads.

All list/detail/export queries for interactions MUST go through
visible_interactions() so that Event A data never leaks to Event B users.
"""
from django.db.models import Exists, OuterRef, Q

from apps.iam.authz import ALL_PRODUCTS, authz_for

from .models import Interaction, InteractionProduct, Opportunity, OpportunityCollaborator, Referral, Task


def _personal_q(user):
    return (
        Q(created_by=user)
        | Q(triage_owner=user)
        | Q(opportunity__owner=user)
        | Exists(Referral.objects.filter(interaction=OuterRef("pk"), to_user=user))
        | Exists(Referral.objects.filter(interaction=OuterRef("pk"), from_user=user))
        | Exists(Task.objects.filter(interaction=OuterRef("pk"), owner=user))
        | Exists(OpportunityCollaborator.objects.filter(opportunity__source_interaction=OuterRef("pk"), user=user))
    )


def _scope_q(grants):
    q = Q(pk__in=[])
    for g in grants:
        if g.product_scope is ALL_PRODUCTS:
            q |= Q(event_id=g.event_id)
        else:
            q |= Q(event_id=g.event_id) & Exists(
                InteractionProduct.objects.filter(interaction=OuterRef("pk"), product_id__in=g.product_scope)
            )
    return q


def visible_interactions(user, base=None):
    qs = base if base is not None else Interaction.objects.all()
    az = authz_for(user)
    if az.has_global("lead.view.all"):
        return qs
    return qs.filter(_personal_q(user) | _scope_q(az.event_grants("lead.view.scope")))


def _in_scope(user, interaction, cap):
    az = authz_for(user)
    if az.has_global(cap):
        return True
    grant = az.events.get(interaction.event_id)
    if not grant or cap not in grant.capabilities:
        return False
    if grant.product_scope is ALL_PRODUCTS:
        return True
    product_ids = set(interaction.product_links.values_list("product_id", flat=True))
    return bool(product_ids & grant.product_scope)


def _is_assignee(user, interaction):
    if interaction.triage_owner_id == user.id:
        return True
    try:
        opp = interaction.opportunity
    except Opportunity.DoesNotExist:
        opp = None
    if opp and (opp.owner_id == user.id or opp.collaborators.filter(user=user).exists()):
        return True
    return Referral.objects.filter(interaction=interaction, to_user=user, status=Referral.Status.ACCEPTED).exists() or Task.objects.filter(
        interaction=interaction, owner=user, status=Task.Status.OPEN
    ).exists()


def can_edit_detail(user, interaction):
    """Detailed lead edit (enrichment, tags, notes). Object-level scope wins over job title."""
    return _in_scope(user, interaction, "lead.detail.edit") or _is_assignee(user, interaction)


def can_assign(user, interaction):
    return _in_scope(user, interaction, "lead.assign")


def can_qualify(user, interaction):
    return _in_scope(user, interaction, "lead.qualify") or _is_assignee(user, interaction)


def can_manage_tasks(user, interaction):
    return _in_scope(user, interaction, "task.manage") or _is_assignee(user, interaction)


def can_view_pii(user, interaction):
    if interaction.created_by_id == user.id:
        return True
    if _in_scope(user, interaction, "pii.view"):
        return True
    return _is_assignee(user, interaction)


def permissions_for(user, interaction):
    return {
        "edit_detail": can_edit_detail(user, interaction),
        "assign": can_assign(user, interaction),
        "qualify": can_qualify(user, interaction),
        "manage_tasks": can_manage_tasks(user, interaction),
        "view_pii": can_view_pii(user, interaction),
        "correct_capture": interaction.created_by_id == user.id and interaction.event.status == "ACTIVE",
    }
