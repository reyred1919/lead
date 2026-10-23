from django.db import migrations


def forwards(apps, schema_editor):
    from apps.iam.roles import sync_system_roles

    sync_system_roles(apps.get_model("iam", "Role"))


class Migration(migrations.Migration):
    dependencies = [("iam", "0001_initial")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
