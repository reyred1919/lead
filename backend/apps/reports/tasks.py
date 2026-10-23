from celery import shared_task


@shared_task
def run_export_task(job_id):
    from .exporter import run_export

    run_export(job_id)


@shared_task
def purge_expired_exports_task():
    from .exporter import purge_expired

    return purge_expired()
