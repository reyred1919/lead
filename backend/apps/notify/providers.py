"""Provider-independent delivery adapters.

Modes (NotificationProvider.mode):
  DISABLED   — never used.
  MOCK       — workflow is exercised, nothing leaves the server; attempts are
               recorded as SIMULATED and are never reported as delivered.
  CONFIGURED — credentials stored but live sending is not enabled; jobs are
               skipped with reason PROVIDER_NOT_LIVE (only admin test sends run).
  LIVE       — real sends; allowed only after a successful connection test.
"""
import hashlib
import hmac
import json
import logging
import smtplib
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass

from django.core.mail import EmailMultiAlternatives, get_connection

from apps.common.crypto import decrypt_secret

log = logging.getLogger(__name__)


@dataclass
class SendResult:
    status: str  # SENT | SIMULATED | FAILED | UNKNOWN
    provider_message_id: str = ""
    reason_code: str = ""
    summary: str = ""
    is_mock: bool = False
    cost: object = None


@dataclass
class TestResult:
    ok: bool
    code: str
    message: str
    latency_ms: int = 0


class BaseAdapter:
    channel = None

    def __init__(self, provider):
        self.provider = provider
        self.config = provider.config or {}

    @property
    def secret(self):
        return decrypt_secret(self.provider.secret_encrypted)

    def test_connection(self) -> TestResult:  # pragma: no cover - interface
        raise NotImplementedError

    def status(self, provider_message_id):
        return "UNKNOWN"


# ---------------------------------------------------------------- SMS -----

class MockSmsAdapter(BaseAdapter):
    channel = "SMS"

    def send_sms(self, to, text, correlation_id):
        if self.config.get("simulate_failure"):
            return SendResult("FAILED", reason_code="MOCK_FAILURE", summary="شبیه‌سازی خطای سرویس‌دهنده", is_mock=True)
        return SendResult("SIMULATED", provider_message_id="mock-" + uuid.uuid4().hex[:12], reason_code="MOCK", summary="ارسال واقعی انجام نشد (حالت شبیه‌سازی)", is_mock=True)

    def test_connection(self):
        if self.config.get("simulate_failure"):
            return TestResult(False, "MOCK_FAILURE", "سرویس شبیه‌سازی در حالت خطا تنظیم شده است.")
        return TestResult(True, "MOCK_OK", "سرویس شبیه‌سازی در دسترس است؛ هیچ پیامکی ارسال نمی‌شود.")


class HttpSmsAdapter(BaseAdapter):
    """Generic JSON-over-HTTPS SMS gateway. No vendor is hardcoded.

    config: endpoint, sender, pattern_id, to_field, text_field, sender_field,
            auth_header, auth_scheme, message_id_field, timeout, cost_field
    secret: API key / token
    """

    channel = "SMS"

    def _endpoint(self):
        endpoint = self.config.get("endpoint", "")
        parsed = urllib.parse.urlparse(endpoint)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("endpoint must be an https URL")
        return endpoint, parsed

    def send_sms(self, to, text, correlation_id):
        try:
            endpoint, _ = self._endpoint()
        except ValueError as exc:
            return SendResult("FAILED", reason_code="CONFIG_INVALID", summary=str(exc))
        body = {
            self.config.get("to_field", "to"): to,
            self.config.get("text_field", "text"): text,
        }
        if self.config.get("sender"):
            body[self.config.get("sender_field", "from")] = self.config["sender"]
        if self.config.get("pattern_id"):
            body["pattern_id"] = self.config["pattern_id"]
        headers = {"Content-Type": "application/json", "Idempotency-Key": correlation_id}
        if self.secret:
            scheme = self.config.get("auth_scheme", "Bearer")
            headers[self.config.get("auth_header", "Authorization")] = f"{scheme} {self.secret}".strip()
        req = urllib.request.Request(endpoint, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=float(self.config.get("timeout", 10))) as resp:
                raw = resp.read(65536)
                payload = json.loads(raw.decode() or "{}") if raw else {}
                message_id = str(payload.get(self.config.get("message_id_field", "id"), ""))
                cost = payload.get(self.config.get("cost_field", "cost"))
                return SendResult("SENT", provider_message_id=message_id, reason_code=str(resp.status), summary="پذیرفته‌شده توسط سرویس‌دهنده", cost=cost)
        except urllib.error.HTTPError as exc:
            return SendResult("FAILED", reason_code=f"HTTP_{exc.code}", summary=str(exc.reason)[:200])
        except (urllib.error.URLError, socket.timeout, TimeoutError, OSError, ValueError) as exc:
            return SendResult("FAILED", reason_code="NETWORK", summary=str(exc)[:200])

    def test_connection(self):
        start = time.monotonic()
        try:
            _, parsed = self._endpoint()
        except ValueError:
            return TestResult(False, "CONFIG_INVALID", "نشانی سرویس باید با https آغاز شود.")
        try:
            ctx = ssl.create_default_context()
            with socket.create_connection((parsed.hostname, parsed.port or 443), timeout=float(self.config.get("timeout", 10))) as sock:
                with ctx.wrap_socket(sock, server_hostname=parsed.hostname):
                    pass
        except socket.gaierror:
            return TestResult(False, "DNS_FAILED", "نام میزبان قابل تفکیک نیست.")
        except ssl.SSLError as exc:
            return TestResult(False, "TLS_FAILED", f"اعتبارسنجی TLS ناموفق: {exc.reason}"[:200])
        except OSError as exc:
            return TestResult(False, "CONNECT_FAILED", f"اتصال برقرار نشد: {exc}"[:200])
        return TestResult(True, "TLS_OK", "اتصال امن به سرویس‌دهنده برقرار شد (پیامکی ارسال نشد).", int((time.monotonic() - start) * 1000))

    def verify_webhook(self, body: bytes, signature: str) -> bool:
        key = self.secret
        if not key or not signature:
            return False
        expected = hmac.new(key.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature.strip())


# -------------------------------------------------------------- EMAIL -----

class MockEmailAdapter(BaseAdapter):
    channel = "EMAIL"

    def send_email(self, to, subject, text, html, correlation_id):
        if self.config.get("simulate_failure"):
            return SendResult("FAILED", reason_code="MOCK_FAILURE", summary="شبیه‌سازی خطای سرور ایمیل", is_mock=True)
        return SendResult("SIMULATED", provider_message_id="mock-" + uuid.uuid4().hex[:12], reason_code="MOCK", summary="ایمیل واقعی ارسال نشد (حالت شبیه‌سازی)", is_mock=True)

    def test_connection(self):
        if self.config.get("simulate_failure"):
            return TestResult(False, "MOCK_FAILURE", "سرویس شبیه‌سازی در حالت خطا تنظیم شده است.")
        return TestResult(True, "MOCK_OK", "سرویس شبیه‌سازی ایمیل در دسترس است؛ هیچ ایمیلی ارسال نمی‌شود.")


class SmtpAdapter(BaseAdapter):
    """Organization SMTP over TLS using Django's SMTP backend.

    config: host, port, security (STARTTLS|SSL_TLS), username, from_address,
            from_name, reply_to, allowed_sender_domains, allowed_recipient_domains, timeout
    secret: SMTP password (never returned by the API)
    """

    channel = "EMAIL"

    def validate_config(self):
        errors = []
        host = self.config.get("host", "")
        if not host:
            errors.append("host")
        security = self.config.get("security", "STARTTLS")
        if security not in ("STARTTLS", "SSL_TLS"):
            errors.append("security (فقط STARTTLS یا SSL_TLS؛ ارسال بدون رمزنگاری مجاز نیست)")
        sender = (self.config.get("from_address") or "").lower()
        if "@" not in sender:
            errors.append("from_address")
        allowed = [d.lower().strip() for d in self.config.get("allowed_sender_domains", []) if d.strip()]
        if allowed and sender.split("@")[-1] not in allowed:
            errors.append("from_address خارج از دامنه‌های مجاز فرستنده است")
        return errors

    def recipient_allowed(self, address):
        allowed = [d.lower().strip() for d in self.config.get("allowed_recipient_domains", []) if d.strip()]
        return not allowed or address.lower().split("@")[-1] in allowed

    def _connection(self):
        security = self.config.get("security", "STARTTLS")
        return get_connection(
            "django.core.mail.backends.smtp.EmailBackend",
            host=self.config.get("host"),
            port=int(self.config.get("port") or (465 if security == "SSL_TLS" else 587)),
            username=self.config.get("username") or None,
            password=self.secret or None,
            use_tls=security == "STARTTLS",
            use_ssl=security == "SSL_TLS",
            timeout=float(self.config.get("timeout", 15)),
            fail_silently=False,
        )

    def send_email(self, to, subject, text, html, correlation_id):
        errors = self.validate_config()
        if errors:
            return SendResult("FAILED", reason_code="CONFIG_INVALID", summary="، ".join(errors)[:200])
        if not self.recipient_allowed(to):
            return SendResult("FAILED", reason_code="RECIPIENT_NOT_ALLOWED", summary="دامنه گیرنده مجاز نیست")
        from_name = self.config.get("from_name") or ""
        sender = f"{from_name} <{self.config['from_address']}>" if from_name else self.config["from_address"]
        message_id = f"<{correlation_id.replace(':', '.')[:60]}.{uuid.uuid4().hex[:8]}@{self.config['from_address'].split('@')[-1]}>"
        msg = EmailMultiAlternatives(
            subject=subject, body=text, from_email=sender, to=[to],
            reply_to=[self.config["reply_to"]] if self.config.get("reply_to") else None,
            headers={"Message-ID": message_id, "X-Correlation-ID": correlation_id[:120]},
            connection=self._connection(),
        )
        if html:
            msg.attach_alternative(html, "text/html")
        try:
            msg.send()
        except smtplib.SMTPRecipientsRefused:
            return SendResult("FAILED", reason_code="RECIPIENT_REFUSED", summary="گیرنده توسط سرور رد شد")
        except smtplib.SMTPAuthenticationError:
            return SendResult("FAILED", reason_code="AUTH_FAILED", summary="احراز هویت SMTP ناموفق بود")
        except (smtplib.SMTPException, OSError, ssl.SSLError) as exc:
            return SendResult("FAILED", reason_code="SMTP_ERROR", summary=str(exc)[:200])
        # SMTP acceptance is not proof of delivery to the mailbox.
        return SendResult("SENT", provider_message_id=message_id, reason_code="250", summary="پذیرفته‌شده توسط سرور SMTP (تحویل نهایی نامعلوم)")

    def test_connection(self):
        errors = self.validate_config()
        if errors:
            return TestResult(False, "CONFIG_INVALID", "تنظیمات ناقص یا نامعتبر: " + "، ".join(errors))
        host = self.config["host"]
        security = self.config.get("security", "STARTTLS")
        port = int(self.config.get("port") or (465 if security == "SSL_TLS" else 587))
        timeout = float(self.config.get("timeout", 15))
        start = time.monotonic()
        try:
            socket.getaddrinfo(host, port)
        except socket.gaierror:
            return TestResult(False, "DNS_FAILED", "نام میزبان SMTP قابل تفکیک نیست.")
        ctx = ssl.create_default_context()
        try:
            if security == "SSL_TLS":
                server = smtplib.SMTP_SSL(host, port, timeout=timeout, context=ctx)
            else:
                server = smtplib.SMTP(host, port, timeout=timeout)
                server.ehlo()
                if not server.has_extn("starttls"):
                    server.quit()
                    return TestResult(False, "STARTTLS_UNSUPPORTED", "سرور از STARTTLS پشتیبانی نمی‌کند؛ اتصال بدون رمزنگاری مجاز نیست.")
                server.starttls(context=ctx)
                server.ehlo()
            if self.config.get("username"):
                server.login(self.config["username"], self.secret)
            server.quit()
        except smtplib.SMTPAuthenticationError:
            return TestResult(False, "AUTH_FAILED", "احراز هویت ناموفق بود.")
        except ssl.SSLError as exc:
            return TestResult(False, "TLS_FAILED", f"اعتبارسنجی TLS ناموفق: {exc.reason}"[:200])
        except (smtplib.SMTPException, OSError) as exc:
            return TestResult(False, "CONNECT_FAILED", f"اتصال برقرار نشد: {exc}"[:200])
        return TestResult(True, "SMTP_OK", "اتصال TLS و احراز هویت موفق بود (ایمیلی ارسال نشد).", int((time.monotonic() - start) * 1000))


ADAPTERS = {
    "MOCK_SMS": MockSmsAdapter,
    "HTTP_SMS": HttpSmsAdapter,
    "MOCK_EMAIL": MockEmailAdapter,
    "SMTP": SmtpAdapter,
}


def adapter_for(provider):
    if provider.mode == "MOCK":
        # Any adapter in MOCK mode behaves as the mock of its channel.
        cls = MockSmsAdapter if provider.channel == "SMS" else MockEmailAdapter
        return cls(provider)
    return ADAPTERS[provider.adapter](provider)


def deliver(adapter, channel, to, subject, text, html, correlation_id):
    if channel == "SMS":
        return adapter.send_sms(to, text, correlation_id)
    return adapter.send_email(to, subject, text, html, correlation_id)
