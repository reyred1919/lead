from celery import shared_task


@shared_task
def process_outbox_task():
    from .engine import process_outbox

    return process_outbox()


@shared_task
def process_jobs_task():
    from .engine import process_jobs

    return process_jobs()


@shared_task
def scan_due_task():
    from .engine import process_outbox, scan_due

    count = scan_due()
    process_outbox()
    return count


@shared_task
def dispatch_campaigns_task():
    from .campaigns import dispatch_due_campaigns

    return dispatch_due_campaigns()
