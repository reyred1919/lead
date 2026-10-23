"""Audit trail helpers. Secrets, passwords and tokens are scrubbed before storage."""
import datetime
import decimal
import uuid

from .models import AuditLog

SENSITIVE_KEYS = ("password", "secret", "token", "api_key", "apikey", "credential", "authorization")


def _scrub(value):
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if any(s in str(k).lower() for s in SENSITIVE_KEYS):
                out[k] = "***" if v else v
            else:
                out[k] = _scrub(v)
        return out
    if isinstance(value, (list, tuple, set)):
        return [_scrub(v) for v in value]
    if isinstance(value, (uuid.UUID, decimal.Decimal)):
        return str(value)
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    return value


def client_ip(request):
    if request is None:
        return None
    return request.META.get("REMOTE_ADDR")


def audit(actor, action, entity_type, entity_id="", before=None, after=None, metadata=None, request=None):
    if actor is not None and not getattr(actor, "is_authenticated", False):
        actor = None
    return AuditLog.objects.create(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id or ""),
        before=_scrub(before) if before is not None else None,
        after=_scrub(after) if after is not None else None,
        metadata=_scrub(metadata or {}),
        ip_address=client_ip(request),
    )


def diff(before: dict, after: dict):
    """Return (before, after) restricted to keys whose values changed."""
    keys = [k for k in after if before.get(k) != after.get(k)]
    return {k: before.get(k) for k in keys}, {k: after.get(k) for k in keys}


def snapshot(obj, fields):
    return {f: _scrub(getattr(obj, f + "_id", None) if hasattr(obj, f + "_id") else getattr(obj, f, None)) for f in fields}
