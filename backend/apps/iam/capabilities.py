"""Capability catalog — the single source of truth for authorization.

Roles are only convenience bundles of these capabilities. Grants are additive:
a user's effective capabilities are the union of their global roles and the
roles of their ACTIVE event memberships (scoped to that event).

`interaction.create` is implicit for every ACTIVE membership of an ACTIVE
event, regardless of the role held (blueprint §21).
"""

CAPABILITIES = {
    # Lead / interaction work
    "interaction.create": "ثبت لید در رویداد",
    "lead.view.scope": "مشاهده لیدهای محدوده رویداد/طرح/محصول",
    "lead.view.all": "مشاهده همه لیدهای مجاز سازمان",
    "lead.detail.edit": "تکمیل و ویرایش جزئیات لید",
    "lead.qualify": "ارزیابی و تبدیل به فرصت",
    "lead.assign": "ارجاع و تخصیص مجدد",
    "task.manage": "تعریف و مدیریت وظایف پیگیری",
    "pii.view": "مشاهده شماره تماس و ایمیل مخاطبان",
    "contact.merge": "بازبینی و ادغام رکوردهای تکراری",
    "sync.review": "بازبینی ثبت‌های آفلاین معلق",
    # Insight
    "dashboard.view": "مشاهده داشبورد",
    "export.run": "خروجی داده",
    "audit.view": "مشاهده گزارش ممیزی",
    # Communication
    "notification.send": "ارسال پیام و درخواست اقدام",
    "notification.configure": "تنظیم قواعد و قالب‌های اعلان",
    "provider.manage": "مدیریت سرویس‌دهنده پیامک/ایمیل و اسرار",
    # Configuration
    "event.manage": "مدیریت رویدادها",
    "event.team.manage": "مدیریت تیم رویداد",
    "catalog.manage": "مدیریت طرح‌ها و محصولات",
    "user.manage": "مدیریت کاربران",
    "user.password_reset": "صدور لینک بازنشانی رمز",
    "role.manage": "مدیریت نقش‌ها",
    "tags.manage": "مدیریت برچسب‌های سراسری",
    "branding.manage": "مدیریت نشان و هویت بصری",
}

ALL = sorted(CAPABILITIES)

# Capabilities that only make sense globally (never granted through an event role).
GLOBAL_ONLY = {
    "lead.view.all", "provider.manage", "user.manage", "user.password_reset", "role.manage",
    "catalog.manage", "event.manage", "tags.manage", "branding.manage", "audit.view",
    "contact.merge", "sync.review", "notification.configure",
}

SYSTEM_ROLES = [
    {
        "code": "SYSTEM_ADMIN", "name_fa": "مدیر سامانه (اداره توسعه بازار)", "scope": "GLOBAL",
        "capabilities": [c for c in ALL if c != "interaction.create"],
    },
    {
        "code": "MARKET_DEV_MANAGER", "name_fa": "مدیر توسعه بازار", "scope": "GLOBAL",
        "capabilities": [
            "lead.view.all", "lead.detail.edit", "lead.qualify", "lead.assign", "task.manage", "pii.view",
            "contact.merge", "sync.review", "dashboard.view", "export.run", "audit.view", "notification.send",
            "notification.configure", "event.manage", "event.team.manage", "catalog.manage", "tags.manage",
            "branding.manage",
        ],
    },
    {
        "code": "DIRECTOR_GENERAL", "name_fa": "مدیرکل", "scope": "GLOBAL",
        "description": "نقش عملیاتی مدیریتی؛ بدون دسترسی به اسرار، رمز کاربران یا تنظیمات زیرساخت.",
        "capabilities": [
            "lead.view.all", "lead.detail.edit", "lead.qualify", "lead.assign", "task.manage", "pii.view",
            "dashboard.view", "export.run", "notification.send",
        ],
    },
    {
        "code": "EXECUTIVE_READONLY", "name_fa": "ناظر اجرایی (فقط‌خواندنی)", "scope": "GLOBAL",
        "capabilities": ["lead.view.all", "dashboard.view"],
    },
    {
        "code": "EVENT_MANAGER", "name_fa": "مدیر رویداد", "scope": "EVENT",
        "capabilities": [
            "lead.view.scope", "lead.detail.edit", "lead.qualify", "lead.assign", "task.manage", "pii.view",
            "dashboard.view", "export.run", "notification.send", "event.team.manage",
        ],
    },
    {
        "code": "PLAN_MANAGER", "name_fa": "مدیر طرح/برنامه", "scope": "EVENT",
        "capabilities": [
            "lead.view.scope", "lead.detail.edit", "lead.qualify", "lead.assign", "task.manage", "pii.view",
            "dashboard.view", "export.run", "notification.send",
        ],
    },
    {
        "code": "PRODUCT_OWNER", "name_fa": "مالک محصول/پروژه", "scope": "EVENT",
        "capabilities": ["lead.view.scope", "lead.detail.edit", "task.manage", "pii.view"],
    },
    {
        "code": "BOOTH_SPECIALIST", "name_fa": "کارشناس غرفه", "scope": "EVENT",
        "capabilities": [],
    },
]
