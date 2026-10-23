"""Spreadsheet-safety for exported untrusted text (CSV/Excel formula injection)."""

DANGEROUS_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n", "|", "%")


def safe_cell(value):
    """Prefix any text cell that a spreadsheet could interpret as a formula.

    Applied to EVERY string cell (names, notes, phones, codes) as required by the
    export contract. Non-string values (numbers, booleans, None) pass through.
    """
    if isinstance(value, str) and value and (value[0] in DANGEROUS_PREFIXES or value.lstrip()[:1] in DANGEROUS_PREFIXES):
        return "'" + value
    return value
