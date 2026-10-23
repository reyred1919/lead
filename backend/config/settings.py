"""Django settings for MCI Expo Leads.

Every deployment-specific value comes from the environment; defaults are safe
for local development only.
"""
import os
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name, default=False):
    return os.environ.get(name, str(default)).lower() in ("1", "true", "yes", "on")


DEBUG = env_bool("DJANGO_DEBUG", True)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-insecure-secret-key-change-me")
if not DEBUG and SECRET_KEY.startswith("dev-only"):
    raise RuntimeError("DJANGO_SECRET_KEY must be set in production")

ALLOWED_HOSTS = [h for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1],testserver").split(",") if h]
CSRF_TRUSTED_ORIGINS = [o for o in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o]

# Demo mode exposes synthetic-data banners and one-time activation links to admins.
DEMO_MODE = env_bool("DEMO_MODE", True)
# Public base URL used in deep links inside notifications.
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:5173")
# Customer (lead) messaging is out of scope for this phase and hard-disabled.
FEATURE_CUSTOMER_MESSAGING = False

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "apps.common",
    "apps.iam",
    "apps.catalog",
    "apps.crm",
    "apps.notify",
    "apps.reports",
    "apps.branding",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": ["django.template.context_processors.request"]},
    }
]
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": dj_database_url.parse(
        os.environ.get("DATABASE_URL", "postgres://expo:expo@127.0.0.1:5432/expo_leads"),
        conn_max_age=60,
    )
}

AUTH_USER_MODEL = "iam.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
PASSWORD_RESET_TOKEN_HOURS = int(os.environ.get("PASSWORD_RESET_TOKEN_HOURS", "24"))

LANGUAGE_CODE = "fa"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
DISPLAY_TIME_ZONE = os.environ.get("DISPLAY_TIME_ZONE", "Asia/Tehran")

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", BASE_DIR / "media"))
EXPORT_ROOT = Path(os.environ.get("EXPORT_ROOT", BASE_DIR / "var" / "exports"))
EXPORT_TTL_HOURS = int(os.environ.get("EXPORT_TTL_HOURS", "24"))
EXPORT_SYNC_ROW_LIMIT = int(os.environ.get("EXPORT_SYNC_ROW_LIMIT", "5000"))
BRAND_MAX_UPLOAD_BYTES = int(os.environ.get("BRAND_MAX_UPLOAD_BYTES", str(2 * 1024 * 1024)))
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = int(os.environ.get("SESSION_COOKIE_AGE", str(12 * 3600)))
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = env_bool("SECURE_COOKIES", not DEBUG)
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
    # Enable when Django itself must redirect HTTP→HTTPS (usually done by the reverse proxy).
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", False)

# Key for encrypting provider secrets at rest (Fernet, urlsafe base64 32 bytes).
FIELD_ENCRYPTION_KEY = os.environ.get("FIELD_ENCRYPTION_KEY", "")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "apps.common.pagination.StandardPagination",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_RATES": {"login": os.environ.get("LOGIN_THROTTLE", "10/min"), "password_reset": "5/hour"},
    "EXCEPTION_HANDLER": "apps.common.exceptions.exception_handler",
    "UNAUTHENTICATED_USER": "django.contrib.auth.models.AnonymousUser",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "MCI Expo Leads API",
    "DESCRIPTION": "Versioned REST API (v1) for multi-event booth interactions, opportunities, referrals, notifications and exports.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": "/api/v1",
    "COMPONENT_SPLIT_REQUEST": True,
}

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# Background processing. When CELERY_ENABLED is false the outbox and
# notification jobs are processed in-process right after commit, which keeps
# demos and tests self-contained without Redis.
CELERY_ENABLED = env_bool("CELERY_ENABLED", False)
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://127.0.0.1:6379/0")
CELERY_TASK_ALWAYS_EAGER = not CELERY_ENABLED
CELERY_TIMEZONE = "UTC"
CELERY_BEAT_SCHEDULE = {
    "process-outbox": {"task": "apps.notify.tasks.process_outbox_task", "schedule": 30.0},
    "process-jobs": {"task": "apps.notify.tasks.process_jobs_task", "schedule": 30.0},
    "scan-due-tasks": {"task": "apps.notify.tasks.scan_due_task", "schedule": 300.0},
    "dispatch-campaigns": {"task": "apps.notify.tasks.dispatch_campaigns_task", "schedule": 60.0},
    "purge-exports": {"task": "apps.reports.tasks.purge_expired_exports_task", "schedule": 3600.0},
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
    "loggers": {"django.db.backends": {"level": "WARNING"}},
}

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage" if not DEBUG else "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
