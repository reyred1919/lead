"""Business-day helpers. Data is stored in UTC; reporting days follow the display time zone (Asia/Tehran)."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone


def display_tz():
    return ZoneInfo(settings.DISPLAY_TIME_ZONE)


def local_today() -> date:
    return timezone.now().astimezone(display_tz()).date()


def day_start(d: date) -> datetime:
    """Aware UTC-comparable datetime for 00:00 of local day `d`."""
    return datetime.combine(d, time.min, tzinfo=display_tz())


def day_range(d: date):
    return day_start(d), day_start(d + timedelta(days=1))
