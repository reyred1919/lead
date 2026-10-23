"""Allowlisted {{variable}} rendering. Unknown variables render empty; HTML output escapes values."""
import re

from django.utils.html import escape

ALLOWED_VARS = {
    "recipient_name": "نام گیرنده",
    "sender_name": "نام فرستنده/آغازگر",
    "contact_name": "نام مخاطب لید",
    "event_code": "کد رویداد",
    "event_name": "نام رویداد",
    "title": "عنوان",
    "subject": "موضوع",
    "body": "متن پیام",
    "reason": "دلیل/توضیح",
    "due_at": "موعد",
    "link": "لینک امن درون‌برنامه",
}

_VAR = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")


def render(text, context, html=False):
    def sub(match):
        name = match.group(1)
        if name not in ALLOWED_VARS:
            return ""
        value = str(context.get(name, "") or "")
        return escape(value) if html else value

    return _VAR.sub(sub, text or "")


def unknown_variables(text):
    return sorted({m for m in _VAR.findall(text or "") if m not in ALLOWED_VARS})
