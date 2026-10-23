"""Persian/Arabic text and contact normalization.

Search keys and de-duplication always use the normalized forms; original user
input is stored separately for display and provenance.
"""
import re
import unicodedata

_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_CHARS = str.maketrans({
    "ي": "ی", "ى": "ی", "ئ": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه", "أ": "ا", "إ": "ا", "ٱ": "ا", "ؤ": "و",
    "‌": " ", "‍": "", "‎": "", "‏": "", "‪": "", "‫": "", "‬": "",
    "‭": "", "‮": "", "⁦": "", "⁧": "", "⁨": "", "⁩": "", "ـ": "",
})
_DIACRITICS = re.compile("[ً-ٰٟۖ-ۭ]")
_SPACES = re.compile(r"\s+")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
_BIDI_CONTROLS = re.compile("[‪-‮⁦-⁩]")


def normalize_digits(value: str) -> str:
    return (value or "").translate(_DIGITS)


def clean_display(value: str) -> str:
    """Trim and collapse whitespace, normalize Arabic letter forms, keep ZWNJ for display."""
    if value is None:
        return ""
    value = unicodedata.normalize("NFC", str(value))
    value = _BIDI_CONTROLS.sub("", value)
    value = value.replace("ي", "ی").replace("ى", "ی").replace("ك", "ک")
    return _SPACES.sub(" ", value).strip()


def normalize_search(value: str) -> str:
    """Aggressive normalization used for search and duplicate detection keys."""
    if not value:
        return ""
    value = unicodedata.normalize("NFKC", str(value))
    value = normalize_digits(value).translate(_CHARS)
    value = _DIACRITICS.sub("", value)
    return _SPACES.sub(" ", value).strip().lower()


def normalize_mobile(raw: str):
    """Return an Iranian mobile number in +989XXXXXXXXX form, or None if invalid."""
    if not raw:
        return None
    digits = re.sub(r"[^\d+]", "", normalize_digits(str(raw)))
    if digits.startswith("+"):
        digits = digits[1:]
    if digits.startswith("0098"):
        digits = digits[4:]
    elif digits.startswith("98") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0"):
        digits = digits[1:]
    if re.fullmatch(r"9\d{9}", digits):
        return "+98" + digits
    return None


def normalize_phone(raw: str):
    """Loose normalization for alternate (landline/international) numbers."""
    if not raw:
        return None
    mobile = normalize_mobile(raw)
    if mobile:
        return mobile
    digits = re.sub(r"[^\d+]", "", normalize_digits(str(raw)))
    plain = digits.lstrip("+")
    if 7 <= len(plain) <= 15:
        return digits
    return None


def normalize_email(raw: str):
    if not raw:
        return None
    value = normalize_digits(str(raw)).strip().lower()
    return value if _EMAIL.match(value) else None


def mask_phone(value: str) -> str:
    if not value:
        return value
    if len(value) <= 6:
        return "•" * len(value)
    return value[:6] + "•" * (len(value) - 9) + value[-3:]


def mask_email(value: str) -> str:
    if not value or "@" not in value:
        return value
    name, domain = value.split("@", 1)
    return (name[:1] + "•••") + "@" + domain


def similarity(a: str, b: str) -> float:
    """Token-set similarity in [0, 1] on normalized names (cheap fuzzy match)."""
    ta, tb = set(normalize_search(a).split()), set(normalize_search(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)
