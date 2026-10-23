from rest_framework.exceptions import ValidationError

from .exceptions import Conflict


def check_version(instance, data):
    """Optimistic concurrency: the client must echo the version it edited."""
    supplied = data.get("version")
    if supplied is None:
        raise ValidationError({"version": "نسخه رکورد برای ویرایش الزامی است."})
    try:
        supplied = int(supplied)
    except (TypeError, ValueError):
        raise ValidationError({"version": "نسخه نامعتبر است."})
    if supplied != instance.version:
        raise Conflict()


def bump(instance):
    instance.version = (instance.version or 0) + 1
