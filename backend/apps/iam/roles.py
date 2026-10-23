from .capabilities import SYSTEM_ROLES


def sync_system_roles(Role):
    """Upsert the system role bundles. Custom (non-system) roles are untouched."""
    for spec in SYSTEM_ROLES:
        Role.objects.update_or_create(
            code=spec["code"],
            defaults={
                "name_fa": spec["name_fa"],
                "description": spec.get("description", ""),
                "scope": spec["scope"],
                "capabilities": sorted(spec["capabilities"]),
                "is_system": True,
                "is_archived": False,
            },
        )
