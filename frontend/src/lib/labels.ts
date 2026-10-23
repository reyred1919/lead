/** Machine codes → Persian labels. Codes are never shown alone; status is text + badge, not color only. */
export const QUALITY: Record<string, string> = { SERIOUS: "جدی", FOLLOW_UP: "قابل‌پیگیری", INTRO: "آشنایی" };
export const INTERACTION_STATUS: Record<string, string> = { CAPTURED: "ثبت‌شده", REVIEWED: "بررسی‌شده", ARCHIVED: "بایگانی" };
export const STAGE: Record<string, string> = {
  QUALIFIED: "واجد شرایط", ASSIGNED: "تخصیص‌یافته", FOLLOW_UP: "در حال پیگیری", WON: "موفق", LOST: "ناموفق", NURTURE: "پرورش",
};
export const EVENT_STATUS: Record<string, string> = { DRAFT: "پیش‌نویس", READY: "آماده", ACTIVE: "فعال", CLOSED: "پایان‌یافته", ARCHIVED: "بایگانی" };
export const REFERRAL_STATUS: Record<string, string> = { PENDING: "در انتظار پذیرش", ACCEPTED: "پذیرفته‌شده", RETURNED: "بازگشتی", CANCELED: "لغوشده" };
export const ACTION_STATUS: Record<string, string> = {
  OPEN: "باز", ACKNOWLEDGED: "دیده‌شده", IN_PROGRESS: "در حال انجام", DONE: "انجام‌شده", RETURNED: "بازگشتی", CANCELLED: "لغوشده",
};
export const ACTION_TYPES: Record<string, string> = {
  ACKNOWLEDGE: "تأیید دریافت", ACCEPT_REFERRAL: "پذیرش ارجاع", REVIEW: "بازبینی", UPDATE_LEAD: "به‌روزرسانی لید",
  CALL_CONTACT: "تماس با مخاطب", SCHEDULE_MEETING: "هماهنگی جلسه", UPLOAD_REPORT: "ارائه گزارش", CUSTOM_ALLOWED: "سایر",
};
export const URGENCY: Record<string, string> = { LOW: "کم", MEDIUM: "متوسط", HIGH: "زیاد" };
export const PRIORITY: Record<string, string> = { LOW: "کم", NORMAL: "عادی", HIGH: "زیاد", URGENT: "فوری" };
export const JOB_STATUS: Record<string, string> = {
  PENDING: "در صف", PROCESSING: "در حال پردازش", SENT: "پذیرفته‌شده توسط سرویس‌دهنده", DELIVERED: "تحویل‌شده",
  SIMULATED: "شبیه‌سازی (ارسال واقعی نشد)", FAILED: "ناموفق — تلاش مجدد", DEAD: "ناموفق نهایی", SKIPPED: "ارسال نشد",
};
export const SKIP_REASON: Record<string, string> = {
  NO_PROVIDER: "سرویس‌دهنده فعال وجود ندارد", PROVIDER_NOT_LIVE: "سرویس‌دهنده در حالت ارسال واقعی نیست", NO_ADDRESS: "نشانی/شماره گیرنده ثبت نشده",
  PREFERENCE_DISABLED: "گیرنده این کانال را غیرفعال کرده", COOLDOWN: "تکراری در بازه خنک‌سازی",
};
export const CHANNEL: Record<string, string> = { IN_APP: "درون‌برنامه", SMS: "پیامک", EMAIL: "ایمیل" };
export const PROVIDER_MODE: Record<string, string> = { DISABLED: "غیرفعال", MOCK: "شبیه‌سازی (Mock)", CONFIGURED: "پیکربندی‌شده — بدون ارسال", LIVE: "ارسال واقعی" };
export const ACTIVITY_ICON: Record<string, string> = {};
export const RECIPIENT_TYPE: Record<string, string> = { DIRECT_ASSIGNEE: "گیرنده مستقیم", INITIATOR: "آغازگر", EVENT_OWNER: "مسئول رویداد", EVENT_ROLE: "نقش در رویداد" };
export const QUARANTINE_REASON: Record<string, string> = {
  EVENT_CLOSED_BEYOND_GRACE: "همگام‌سازی پس از مهلت پایان رویداد", EVENT_NOT_ACTIVE: "رویداد فعال نبود", MEMBERSHIP_INACTIVE: "عضویت کاربر غیرفعال شده",
};
export const MATCH_TYPE: Record<string, string> = { EXACT_PHONE: "شماره یکسان", EXACT_EMAIL: "ایمیل یکسان", FUZZY_NAME: "نام مشابه" };

export const COMPLETENESS_LABELS: Record<string, string> = {
  "contact.full_name": "نام مخاطب", "contact.mobile_or_email": "راه تماس", "contact.title": "سمت مخاطب", "contact.email": "ایمیل کاری",
  "account.linked": "سازمان", "account.industry": "صنعت", "account.city": "شهر", "account.website": "وب‌سایت",
  "opportunity.qualified": "ارزیابی", "opportunity.business_problem": "مسئله کسب‌وکار", "opportunity.urgency": "فوریت",
  "opportunity.next_step": "اقدام بعدی", "opportunity.owner": "مسئول پیگیری",
};

export const TAG_COLORS = ["slate", "indigo", "violet", "blue", "teal", "green", "amber", "rose"] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const TAG_COLOR_LABEL: Record<TagColor, string> = {
  slate: "خاکستری", indigo: "نیلی", violet: "بنفش", blue: "آبی", teal: "فیروزه‌ای", green: "سبز", amber: "کهربایی", rose: "گلی",
};
