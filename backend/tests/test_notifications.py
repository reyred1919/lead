"""Outbox → rules → jobs → adapters; idempotency, failure isolation, provider modes, secrets (§17, §18, §22.5)."""
from datetime import time, timedelta
from unittest import mock

import pytest
from django.utils import timezone

from apps.common.models import AuditLog, OutboxEvent
from apps.crm.models import Interaction, Referral
from apps.notify.engine import process_jobs, process_outbox, scan_due
from apps.notify.models import DeliveryAttempt, Notification, NotificationJob, NotificationProvider, NotificationRule, NotificationTemplate

from .conftest import client_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def sms_rule(world):
    t = NotificationTemplate.objects.create(code="ref", name="ref", channel="SMS", body="{{recipient_name}}: {{contact_name}} {{link}} {{mobile}}")
    return NotificationRule.objects.create(name="sms", trigger="referral.created", recipient_type="DIRECT_ASSIGNEE", channel="SMS", template=t)


def refer(world, capture, to=None):
    lid = capture(world.specialist).data["id"]
    r = client_for(world.mdm).post(f"/api/v1/interactions/{lid}/refer", {"to_user_id": str((to or world.planmgr).id)}, format="json")
    assert r.status_code == 201
    return lid, r.data


def test_referral_produces_in_app_and_mock_sms_never_claimed_delivered(world, capture, sms_rule):
    refer(world, capture)
    process_outbox()
    assert Notification.objects.filter(recipient=world.planmgr, event_type="referral.created").count() == 1
    job = NotificationJob.objects.get(channel="SMS", recipient=world.planmgr)
    assert job.status == "SIMULATED"
    attempt = job.attempts_log.get()
    assert attempt.status == "SIMULATED" and attempt.is_mock is True
    assert not DeliveryAttempt.objects.filter(status="DELIVERED").exists()
    # Template variables never carry contact phone numbers.
    assert "+98" not in job.rendered_body and "0912" not in job.rendered_body


def test_outbox_processing_is_idempotent(world, capture, sms_rule):
    refer(world, capture)
    process_outbox()
    count = NotificationJob.objects.count()
    OutboxEvent.objects.update(status="PENDING")  # simulate redelivery
    process_outbox()
    assert NotificationJob.objects.count() == count
    assert Notification.objects.filter(recipient=world.planmgr).count() == 1


def test_provider_failure_does_not_roll_back_referral_and_is_traced(world, capture, sms_rule):
    NotificationProvider.objects.update(config={"simulate_failure": True})
    lid, ref = refer(world, capture)
    process_outbox()
    assert Referral.objects.filter(pk=ref["id"]).exists()
    job = NotificationJob.objects.get(channel="SMS")
    assert job.status == "FAILED" and job.attempts == 1
    assert job.attempts_log.get().reason_code == "MOCK_FAILURE"
    # Retries with backoff, then dead-letter.
    for _ in range(3):
        NotificationJob.objects.filter(pk=job.pk).update(scheduled_at=timezone.now())
        process_jobs()
    job.refresh_from_db()
    assert job.status == "DEAD" and job.attempts == job.max_attempts


def test_adapter_crash_does_not_break_capture(world, capture, sms_rule):
    with mock.patch("apps.notify.providers.MockSmsAdapter.send_sms", side_effect=RuntimeError("boom")):
        lid, _ = refer(world, capture)
        process_outbox()
    assert Interaction.objects.filter(pk=lid).exists()
    assert NotificationJob.objects.get(channel="SMS").last_error


def test_configured_mode_never_sends(world, capture, sms_rule):
    NotificationProvider.objects.update(mode="CONFIGURED", adapter="HTTP_SMS")
    refer(world, capture)
    process_outbox()
    job = NotificationJob.objects.get(channel="SMS")
    assert job.status == "SKIPPED" and job.skip_reason == "PROVIDER_NOT_LIVE"
    assert not DeliveryAttempt.objects.exists()


def test_no_provider_is_skipped_not_faked(world, capture, sms_rule):
    NotificationProvider.objects.all().delete()
    refer(world, capture)
    process_outbox()
    assert NotificationJob.objects.get(channel="SMS").skip_reason == "NO_PROVIDER"


def test_quiet_hours_defer_sms(world, capture, sms_rule):
    sms_rule.quiet_hours_enabled, sms_rule.quiet_start, sms_rule.quiet_end = True, time(0, 0), time(23, 59)
    sms_rule.save()
    refer(world, capture)
    process_outbox()
    job = NotificationJob.objects.get(channel="SMS")
    assert job.status == "PENDING" and job.scheduled_at > timezone.now()


def test_cooldown_dedups_repeat_notifications(world, capture, sms_rule):
    sms_rule.cooldown_minutes = 60
    sms_rule.save()
    lid = capture(world.specialist).data["id"]
    mdm = client_for(world.mdm)
    mdm.post(f"/api/v1/interactions/{lid}/refer", {"to_user_id": str(world.planmgr.id)}, format="json")
    process_outbox()
    r = Referral.objects.get(interaction_id=lid)
    mdm.post(f"/api/v1/referrals/{r.id}/cancel")
    mdm.post(f"/api/v1/interactions/{lid}/refer", {"to_user_id": str(world.planmgr.id)}, format="json")
    process_outbox()
    statuses = list(NotificationJob.objects.filter(channel="SMS").values_list("status", flat=True))
    assert sorted(statuses) == ["SIMULATED", "SKIPPED"]


def test_due_scan_is_idempotent(world, capture):
    lid = capture(world.specialist).data["id"]
    client_for(world.planmgr).post(f"/api/v1/interactions/{lid}/tasks", {"title": "x", "owner_id": str(world.owner.id),
                                                                          "due_at": (timezone.now() - timedelta(hours=1)).isoformat()}, format="json")
    assert scan_due() == 1
    assert scan_due() == 0
    process_outbox()
    assert Notification.objects.filter(recipient=world.owner, event_type="task.overdue").count() == 1


def test_secrets_are_write_only_and_masked_in_audit(world):
    admin = client_for(world.admin)
    resp = admin.post("/api/v1/notify/providers", {"adapter": "SMTP", "name": "org", "mode": "DISABLED", "secret": "S3cr3t!",
                                                   "config": {"host": "smtp.invalid", "from_address": "noreply@org.invalid", "security": "STARTTLS"}}, format="json")
    assert resp.status_code == 201
    assert resp.data["secret_set"] is True
    assert "S3cr3t" not in str(resp.data)
    listing = admin.get("/api/v1/notify/providers")
    assert "S3cr3t" not in str(listing.data)
    p = NotificationProvider.objects.get(pk=resp.data["id"])
    assert p.secret_encrypted and "S3cr3t" not in p.secret_encrypted
    assert "S3cr3t" not in str(list(AuditLog.objects.values_list("before", "after", "metadata")))
    # LIVE cannot be enabled without verification.
    live = admin.patch(f"/api/v1/notify/providers/{p.id}", {"mode": "LIVE", "version": p.version}, format="json")
    assert live.status_code == 422


def test_smtp_rejects_unencrypted_and_foreign_sender(world):
    admin = client_for(world.admin)
    bad = admin.post("/api/v1/notify/providers", {"adapter": "SMTP", "config": {"security": "NONE"}}, format="json")
    assert bad.status_code == 400
    from apps.notify.providers import SmtpAdapter

    p = NotificationProvider(adapter="SMTP", channel="EMAIL", config={"host": "h", "from_address": "x@evil.invalid", "allowed_sender_domains": ["org.invalid"]})
    assert any("دامنه" in e for e in SmtpAdapter(p).validate_config())


def test_smtp_connection_test_reports_dns_failure(world):
    admin = client_for(world.admin)
    p = admin.post("/api/v1/notify/providers", {"adapter": "SMTP", "mode": "CONFIGURED", "config": {"host": "nonexistent.invalid", "from_address": "a@b.invalid"}}, format="json").data
    resp = admin.post(f"/api/v1/notify/providers/{p['id']}/test/connection")
    assert resp.data["ok"] is False and resp.data["code"] in ("DNS_FAILED", "CONNECT_FAILED")


def test_mock_test_send_is_reported_as_simulated(world):
    admin = client_for(world.admin)
    p = NotificationProvider.objects.get(channel="SMS")
    resp = admin.post(f"/api/v1/notify/providers/{p.id}/test/send", {}, format="json")
    assert resp.data["status"] == "SIMULATED" and resp.data["mock"] is True and resp.data["live_verified"] is False
    other = admin.post(f"/api/v1/notify/providers/{p.id}/test/send", {"to": "09129999999"}, format="json")
    assert other.status_code == 400  # only verified internal numbers


def test_campaign_recipients_limited_to_sender_scope_and_broad_send_needs_confirm(world):
    # Event manager of E (event-scoped notification.send) cannot reach F-only users.
    mdm_evt = world.mdm  # MDM has global send; use planmgr (event-scoped) instead
    pm = client_for(world.planmgr)
    resp = pm.post("/api/v1/campaigns/preview", {"kind": "INFORMATION", "subject": "s", "body": "b",
                                                  "targeting": {"user_ids": [str(world.spec_f.id), str(world.specialist.id)]}}, format="json")
    assert resp.status_code == 200
    assert resp.data["recipient_count"] == 1 and resp.data["out_of_scope_ignored"] == 1
    assert client_for(world.specialist).post("/api/v1/campaigns/preview", {"kind": "INFORMATION", "subject": "s", "body": "b",
                                                                          "targeting": {"event_id": str(world.e.id)}}, format="json").status_code == 403
    from apps.notify import campaigns

    with mock.patch.object(campaigns, "BROAD_SEND_THRESHOLD", 2):
        body = {"kind": "INFORMATION", "subject": "s", "body": "b", "targeting": {"event_id": str(world.e.id)}}
        assert client_for(mdm_evt).post("/api/v1/campaigns", body, format="json").status_code == 422
        ok = client_for(mdm_evt).post("/api/v1/campaigns", {**body, "confirm_broad": True}, format="json")
        assert ok.status_code == 201 and ok.data["recipient_count"] == 6


def test_campaign_idempotency_key(world):
    body = {"kind": "INFORMATION", "subject": "s", "body": "b", "targeting": {"user_ids": [str(world.specialist.id)]}, "idempotency_key": "k1"}
    a = client_for(world.mdm).post("/api/v1/campaigns", body, format="json").data
    b = client_for(world.mdm).post("/api/v1/campaigns", body, format="json").data
    assert a["id"] == b["id"]
    assert Notification.objects.filter(recipient=world.specialist, kind="INFORMATION").count() == 1


def test_action_request_lifecycle_and_permissions(world):
    mdm = client_for(world.mdm)
    mdm.post("/api/v1/campaigns", {"kind": "ACTION_REQUEST", "subject": "گزارش", "body": "لطفاً گزارش", "action_type": "UPLOAD_REPORT",
                                   "targeting": {"user_ids": [str(world.specialist.id)]}}, format="json")
    spec = client_for(world.specialist)
    a = spec.get("/api/v1/action-requests").data["results"][0]
    assert spec.post(f"/api/v1/action-requests/{a['id']}/transition", {"status": "CANCELLED"}, format="json").status_code == 403
    assert spec.post(f"/api/v1/action-requests/{a['id']}/transition", {"status": "RETURNED"}, format="json").status_code == 400
    assert spec.post(f"/api/v1/action-requests/{a['id']}/transition", {"status": "ACKNOWLEDGED"}, format="json").data["status"] == "ACKNOWLEDGED"
    done = spec.post(f"/api/v1/action-requests/{a['id']}/transition", {"status": "DONE", "note": "ارسال شد"}, format="json").data
    assert done["status"] == "DONE" and [h["to"] for h in done["history"]] == ["OPEN", "ACKNOWLEDGED", "DONE"]
    requested = mdm.get("/api/v1/action-requests?scope=requested&status=ALL").data["results"]
    assert requested[0]["status"] == "DONE"


def test_scheduled_campaign_dispatches_later(world):
    from apps.notify.campaigns import dispatch_due_campaigns
    from apps.notify.models import NotificationCampaign

    when = (timezone.now() + timedelta(hours=1)).isoformat()
    c = client_for(world.mdm).post("/api/v1/campaigns", {"kind": "INFORMATION", "subject": "s", "body": "b", "scheduled_at": when,
                                                          "targeting": {"user_ids": [str(world.specialist.id)]}}, format="json").data
    assert c["status"] == "SCHEDULED" and not Notification.objects.filter(recipient=world.specialist).exists()
    NotificationCampaign.objects.filter(pk=c["id"]).update(scheduled_at=timezone.now() - timedelta(minutes=1))
    assert dispatch_due_campaigns() == 1
    assert Notification.objects.filter(recipient=world.specialist).count() == 1


def test_webhook_requires_valid_signature(world):
    import hashlib
    import hmac
    import json

    from apps.common.crypto import encrypt_secret

    p = NotificationProvider.objects.create(name="http", channel="SMS", adapter="HTTP_SMS", mode="CONFIGURED", secret_encrypted=encrypt_secret("k"),
                                            config={"endpoint": "https://sms.invalid/send"})
    from rest_framework.test import APIClient

    body = json.dumps({"message_id": "m1", "status": "DELIVERED"}).encode()
    c = APIClient()
    assert c.post(f"/api/v1/notify/webhooks/sms/{p.id}", body, content_type="application/json", HTTP_X_SIGNATURE="bad").status_code == 401
    sig = hmac.new(b"k", body, hashlib.sha256).hexdigest()
    assert c.post(f"/api/v1/notify/webhooks/sms/{p.id}", body, content_type="application/json", HTTP_X_SIGNATURE=sig).status_code == 200


def test_template_rejects_unknown_variables(world):
    resp = client_for(world.admin).post("/api/v1/notify/templates", {"code": "t", "channel": "SMS", "body": "{{customer_mobile}}"}, format="json")
    assert resp.status_code == 400


def test_html_template_escapes_values():
    from apps.notify.templating import render

    assert render("<b>{{contact_name}}</b>", {"contact_name": "<script>x</script>"}, html=True) == "<b>&lt;script&gt;x&lt;/script&gt;</b>"
