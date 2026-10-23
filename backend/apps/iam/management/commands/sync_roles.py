from django.core.management.base import BaseCommand

from apps.iam.models import Role
from apps.iam.roles import sync_system_roles


class Command(BaseCommand):
    help = "Upsert system role capability bundles (idempotent)."

    def handle(self, *args, **options):
        sync_system_roles(Role)
        self.stdout.write(self.style.SUCCESS(f"{Role.objects.filter(is_system=True).count()} system roles synced"))
