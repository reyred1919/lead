"""Versioned export schema / data dictionary (schema_version 1.0).

Each dataset lists (column, description, privacy_class). Privacy classes:
  ID      stable identifier          INTERNAL  business data
  PII     personal contact data (masked without pii.view)
  FREE    free text written by staff (may contain personal data)
"""

SCHEMA_VERSION = "1.0"

DATASETS = {
    "accounts": [
        ("account_id", "UUID سازمان", "ID"), ("name", "نام نمایشی", "INTERNAL"), ("official_name", "نام رسمی", "INTERNAL"),
        ("alt_name", "نام جایگزین", "INTERNAL"), ("industry", "صنعت", "INTERNAL"), ("org_type", "نوع سازمان", "INTERNAL"),
        ("city", "شهر", "INTERNAL"), ("website", "وب‌سایت", "INTERNAL"), ("legal_id", "شناسه حقوقی", "INTERNAL"),
        ("status", "وضعیت (ACTIVE/MERGED/ARCHIVED)", "INTERNAL"), ("merged_into_id", "UUID سازمان جایگزین در ادغام", "ID"),
        ("created_at", "زمان ایجاد UTC", "INTERNAL"), ("updated_at", "آخرین تغییر UTC", "INTERNAL"),
    ],
    "contacts": [
        ("contact_id", "UUID مخاطب", "ID"), ("full_name", "نام کامل", "PII"), ("title", "سمت", "INTERNAL"),
        ("mobile", "موبایل نرمال‌شده +98", "PII"), ("email", "ایمیل", "PII"), ("alt_phone", "تلفن جایگزین", "PII"),
        ("primary_account_id", "UUID سازمان اصلی", "ID"), ("status", "وضعیت", "INTERNAL"), ("merged_into_id", "UUID مخاطب جایگزین", "ID"),
        ("created_at", "زمان ایجاد UTC", "INTERNAL"), ("updated_at", "آخرین تغییر UTC", "INTERNAL"),
    ],
    "interactions": [
        ("interaction_id", "UUID تعامل", "ID"), ("event_id", "UUID رویداد", "ID"), ("event_code", "کد تغییرناپذیر رویداد", "INTERNAL"),
        ("created_by_id", "UUID ثبت‌کننده", "ID"), ("created_by_name", "نام ثبت‌کننده", "INTERNAL"),
        ("captured_at", "زمان ثبت UTC", "INTERNAL"), ("captured_offline", "ثبت آفلاین", "INTERNAL"),
        ("client_record_id", "کلید یکتای سمت کاربر (idempotency)", "ID"), ("contact_id", "UUID مخاطب", "ID"),
        ("account_id", "UUID سازمان", "ID"), ("captured_contact_name", "نام واردشده در غرفه", "PII"),
        ("captured_org_name", "نام سازمان واردشده در غرفه", "INTERNAL"), ("quality", "کیفیت گفت‌وگو SERIOUS/FOLLOW_UP/INTRO", "INTERNAL"),
        ("status", "وضعیت CAPTURED/REVIEWED/ARCHIVED", "INTERNAL"), ("triage_owner_id", "UUID مسئول بررسی اولیه", "ID"),
        ("note", "یادداشت غرفه", "FREE"), ("updated_at", "آخرین تغییر UTC", "INTERNAL"),
    ],
    "interaction_products": [
        ("interaction_id", "UUID تعامل", "ID"), ("product_id", "UUID محصول", "ID"), ("product_code", "کد پایدار محصول", "INTERNAL"),
    ],
    "opportunities": [
        ("opportunity_id", "UUID فرصت", "ID"), ("source_interaction_id", "UUID تعامل مبدأ", "ID"), ("origin_event_id", "UUID رویداد مبدأ", "ID"),
        ("account_id", "UUID سازمان", "ID"), ("contact_id", "UUID مخاطب", "ID"), ("stage", "مرحله QUALIFIED/ASSIGNED/FOLLOW_UP/WON/LOST/NURTURE", "INTERNAL"),
        ("owner_id", "UUID مسئول پیگیری", "ID"), ("owner_name", "نام مسئول پیگیری", "INTERNAL"), ("qualified_by_id", "UUID ارزیاب", "ID"),
        ("qualified_at", "زمان ارزیابی UTC", "INTERNAL"), ("urgency", "فوریت LOW/MEDIUM/HIGH", "INTERNAL"),
        ("business_problem", "مسئله کسب‌وکار", "FREE"), ("use_case", "کاربرد", "FREE"), ("next_step", "اقدام بعدی", "FREE"),
        ("next_step_due_at", "موعد اقدام بعدی UTC", "INTERNAL"), ("closed_at", "زمان بستن UTC", "INTERNAL"),
        ("tag_codes", "کدهای برچسب (جداشده با |)", "INTERNAL"), ("updated_at", "آخرین تغییر UTC", "INTERNAL"),
    ],
    "opportunity_tags": [
        ("opportunity_id", "UUID فرصت", "ID"), ("tag_id", "UUID برچسب", "ID"), ("tag_code", "کد برچسب", "INTERNAL"),
        ("tag_name_fa", "نام برچسب", "INTERNAL"), ("tag_color", "توکن رنگ", "INTERNAL"), ("tag_status", "وضعیت برچسب", "INTERNAL"),
        ("applied_by_id", "UUID افزودن‌کننده", "ID"), ("applied_at", "زمان افزودن UTC", "INTERNAL"),
    ],
    "referrals": [
        ("referral_id", "UUID ارجاع", "ID"), ("interaction_id", "UUID تعامل", "ID"), ("opportunity_id", "UUID فرصت", "ID"),
        ("event_id", "UUID رویداد", "ID"), ("purpose", "هدف QUALIFICATION/FOLLOW_UP", "INTERNAL"), ("from_user_id", "UUID ارجاع‌دهنده", "ID"),
        ("to_user_id", "UUID گیرنده", "ID"), ("status", "وضعیت PENDING/ACCEPTED/RETURNED/CANCELED", "INTERNAL"),
        ("reason", "دلیل ارجاع", "FREE"), ("response_note", "پاسخ گیرنده", "FREE"), ("due_at", "مهلت UTC", "INTERNAL"),
        ("responded_at", "زمان پاسخ UTC", "INTERNAL"), ("created_at", "زمان ایجاد UTC", "INTERNAL"),
    ],
    "tasks": [
        ("task_id", "UUID وظیفه", "ID"), ("interaction_id", "UUID تعامل", "ID"), ("opportunity_id", "UUID فرصت", "ID"),
        ("title", "عنوان", "FREE"), ("owner_id", "UUID مسئول", "ID"), ("status", "OPEN/DONE/CANCELLED", "INTERNAL"),
        ("due_at", "موعد UTC", "INTERNAL"), ("completed_at", "زمان انجام UTC", "INTERNAL"), ("outcome", "نتیجه", "FREE"),
        ("created_at", "زمان ایجاد UTC", "INTERNAL"),
    ],
    "activities": [
        ("activity_id", "UUID فعالیت", "ID"), ("interaction_id", "UUID تعامل", "ID"), ("opportunity_id", "UUID فرصت", "ID"),
        ("type", "نوع فعالیت", "INTERNAL"), ("actor_id", "UUID انجام‌دهنده", "ID"), ("notes", "توضیح", "FREE"),
        ("created_at", "زمان UTC", "INTERNAL"),
    ],
    "fact_leads": [
        ("interaction_id", "UUID تعامل (کلید)", "ID"), ("event_id", "UUID رویداد", "ID"), ("event_code", "کد رویداد", "INTERNAL"),
        ("event_name", "نام رویداد", "INTERNAL"), ("captured_at", "زمان ثبت UTC", "INTERNAL"), ("captured_date", "تاریخ ثبت (UTC)", "INTERNAL"),
        ("created_by_id", "UUID ثبت‌کننده", "ID"), ("created_by_name", "ثبت‌کننده", "INTERNAL"),
        ("contact_id", "UUID مخاطب", "ID"), ("contact_name", "نام مخاطب", "PII"), ("contact_mobile", "موبایل مخاطب", "PII"),
        ("account_id", "UUID سازمان", "ID"), ("account_name", "سازمان", "INTERNAL"), ("product_codes", "کد محصولات (|)", "INTERNAL"),
        ("product_names", "نام محصولات (|)", "INTERNAL"), ("product_count", "تعداد محصولات", "INTERNAL"),
        ("quality", "کیفیت", "INTERNAL"), ("interaction_status", "وضعیت تعامل", "INTERNAL"),
        ("opportunity_id", "UUID فرصت", "ID"), ("opportunity_stage", "مرحله فرصت", "INTERNAL"), ("owner_id", "UUID مسئول پیگیری", "ID"),
        ("owner_name", "مسئول پیگیری", "INTERNAL"), ("tag_codes", "کد برچسب‌ها (|)", "INTERNAL"), ("tag_labels", "برچسب‌ها (|)", "INTERNAL"),
        ("open_tasks", "وظایف باز", "INTERNAL"), ("done_tasks", "پیگیری‌های انجام‌شده", "INTERNAL"),
        ("latest_referral_status", "وضعیت آخرین ارجاع", "INTERNAL"), ("contact_event_count", "تعداد رویدادهای مخاطب (در محدوده)", "INTERNAL"),
    ],
}

DEFAULT_DATASETS = ["fact_leads", "accounts", "contacts", "interactions", "interaction_products", "opportunities",
                    "opportunity_tags", "referrals", "tasks", "activities"]


def columns(dataset):
    return [c[0] for c in DATASETS[dataset]]
