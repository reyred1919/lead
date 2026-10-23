"""Copy + optimise selected real screenshots into the presentation pack, write manifest.yaml data (JSON) and contact sheets."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

REPO = "/home/user/lead"
SCR = os.path.dirname(os.path.abspath(__file__))
PACK = f"{REPO}/deliverables/leados-phase1-presentation-pack"
P = "qa/screenshots/pack-d478da7"   # clean targeted re-capture (not committed; product code == d478da7)
E = "qa/screenshots/e661188"        # committed final QA run
C = "qa/screenshots/c6a1c88"        # committed baseline QA run
LOGIN = "scratchpad:pack/login"     # targeted capture via tools/capture-login.mjs (not committed)

ROLE = {"specialist1": "BOOTH_SPECIALIST", "specialist2": "BOOTH_SPECIALIST", "planmgr": "PLAN_MANAGER",
        "evmgr": "EVENT_MANAGER", "mdm": "MARKET_DEV_MANAGER", "exec": "EXECUTIVE_READONLY", "admin": "SYSTEM_ADMIN",
        "anon": "— (بدون ورود)"}
VP = {"desktop-1440": ("1440×900", "desktop"), "tablet-768": ("768×1024 @2x", "tablet"),
      "mobile-390": ("390×844 @2x", "mobile"), "mobile-375": ("375×667 @2x", "mobile")}
COMMIT = {P: "d478da7 (کد محصول؛ HEAD شاخه QA ‎1d4fda6)", E: "e661188", C: "c6a1c88",
          LOGIN: "d478da7 (کد محصول؛ HEAD شاخه QA ‎1d4fda6)", "qa/traces": "c6a1c88"}
PHASE = {P: "final", E: "final", C: "baseline", LOGIN: "final", "qa/traces": "baseline"}

# (folder, out, src_root, rel, route, persona, device, test, reason, desc, redact)
S = []
def add(folder, out, root, rel, route, persona, device, test, reason, desc, redact=None):
    S.append(dict(folder=folder, out=out, root=root, rel=rel, route=route, persona=persona, device=device,
                  test=test, reason=reason, desc=desc, redact=redact))

MTX = "frontend/qa-e2e/07-matrix-visual.spec.ts › TC-MTX-{p}"
LOGIN_TEST = "tools/capture-login.mjs (capture هدفمند؛ صفحه‌های بدون ورود در ماتریس QA نیستند)"
PW_RED_D = [(296, 628, 410, 652)]
PW_RED_M = [(232, 1222, 448, 1264)]

# ---- desktop (7)
add("desktop", "desktop-01-login.png", LOGIN, "desktop-1440__login.png", "/login", "anon", "desktop-1440", LOGIN_TEST,
    "نقطه ورود سامانه و پنل حساب‌های نمایشی حالت DEMO", "صفحه ورود دسکتاپ با پنل معرفی؛ رمز حساب‌های نمایشی در تصویر پوشانده شده است.", PW_RED_D)
add("desktop", "desktop-02-analytics-dashboard.png", P, "mdm/desktop-1440/dashboard__ready.png", "/dashboard", "mdm", "desktop-1440",
    MTX.format(p="mdm"), "تنها داشبورد تحلیلی موجود در فاز ۱", "داشبورد تحلیلی مدیر توسعه بازار: کارت‌های شاخص، روند ثبت روزانه، مراحل فرصت و لیدهای بدون مسئول (داده نمونه).")
add("desktop", "desktop-03-booth-home.png", P, "specialist1/desktop-1440/home__ready.png", "/", "specialist1", "desktop-1440",
    MTX.format(p="specialist1"), "خانه نقش عملیاتی غرفه", "خانه کارشناس غرفه: رویداد فعال، دکمه ثبت لید جدید و آخرین ثبت‌های خود کاربر.")
add("desktop", "desktop-04-capture-form.png", P, "specialist1/desktop-1440/capture__ready.png", "/capture", "specialist1", "desktop-1440",
    MTX.format(p="specialist1"), "فرم اصلی ثبت سریع لید", "فرم ثبت لید در رویداد قفل‌شده: نام، راه تماس، محصول مورد علاقه، سازمان، کیفیت گفت‌وگو و یادداشت.")
add("desktop", "desktop-05-leads-list.png", P, "mdm/desktop-1440/leads__ready.png", "/leads", "mdm", "desktop-1440",
    MTX.format(p="mdm"), "فهرست لیدها با فیلتر و تب‌های دامنه", "فهرست لیدها با تب‌های «همه در محدوده من/ثبت‌های من/مسئولیت من/بدون مسئول»، جست‌وجو و ستون‌های رویداد، محصول، کیفیت و وضعیت.")
add("desktop", "desktop-06-lead-detail.png", P, "planmgr/desktop-1440/leads_id__ready.png", "/leads/:id", "planmgr", "desktop-1440",
    MTX.format(p="planmgr"), "پرونده لید و اقدام‌های اصلی", "جزئیات لید: تکمیل اطلاعات، ارزیابی و ایجاد فرصت، ارجاع، وظیفه، یادداشت، اطلاعات تماس و تاریخچه.")
add("desktop", "desktop-07-inbox.png", P, "planmgr/desktop-1440/inbox__ready.png", "/inbox", "planmgr", "desktop-1440",
    MTX.format(p="planmgr"), "کارتابل ارجاع‌ها و درخواست‌ها", "کارتابل مدیر طرح: ارجاع‌های دریافتی با مهلت و اقدام پذیرش/بازگرداندن.")
# ---- tablet (4)
for out, rel, route, per, reason, desc in [
    ("tablet-01-analytics-dashboard.png", "mdm/tablet-768/dashboard__ready.png", "/dashboard", "mdm", "چیدمان یک‌ستونه داشبورد در تبلت", "داشبورد تحلیلی در تبلت ۷۶۸ با نوار ناوبری پایین (در تصویر تمام‌صفحه، نوار ثابت در میانه دیده می‌شود)."),
    ("tablet-02-leads-list.png", "mdm/tablet-768/leads__ready.png", "/leads", "mdm", "فهرست لیدها در عرض میانی", "فهرست لیدها در تبلت با دکمه ثبت، تب‌های دامنه و مرتب‌سازی."),
    ("tablet-03-lead-detail.png", "planmgr/tablet-768/leads_id__ready.png", "/leads/:id", "planmgr", "پرونده لید در تبلت", "جزئیات لید در تبلت؛ نشان کارتابل روی نوار پایین تعداد موارد در انتظار را نشان می‌دهد."),
    ("tablet-04-capture-form.png", "specialist1/tablet-768/capture__ready.png", "/capture", "specialist1", "ثبت لید در تبلت غرفه", "فرم ثبت لید در تبلت ۷۶۸ برای کارشناس غرفه.")]:
    add("tablet", out, P, rel, route, per, "tablet-768", MTX.format(p=per), reason, desc)
# ---- mobile (7)
add("mobile", "mobile-01-login.png", LOGIN, "mobile-390__login.png", "/login", "anon", "mobile-390", LOGIN_TEST,
    "ورود در موبایل", "صفحه ورود موبایل؛ رمز حساب‌های نمایشی پوشانده شده است.", PW_RED_M)
for out, rel, route, per, reason, desc in [
    ("mobile-02-booth-home.png", "specialist1/mobile-390/home__ready.png", "/", "specialist1", "خانه موبایل کارشناس غرفه", "خانه موبایل با کارت رویداد فعال، دکمه ثبت لید و نوار ناوبری پایین."),
    ("mobile-03-capture-form.png", "specialist1/mobile-390/capture__ready.png", "/capture", "specialist1", "سناریوی اصلی: ثبت لید با گوشی در غرفه", "فرم ثبت لید موبایل با دکمه ثبت ثابت."),
    ("mobile-04-capture-queue.png", "specialist1/mobile-390/capture_queue__ready.png", "/capture/queue", "specialist1", "صف همگام‌سازی آفلاین", "صفحه صف همگام‌سازی ثبت‌های آفلاین (در این تصویر صف خالی است)."),
    ("mobile-05-leads-list.png", "mdm/mobile-390/leads__ready.png", "/leads", "mdm", "فهرست لید به شکل کارت در موبایل", "فهرست لیدها در موبایل به‌صورت کارت."),
    ("mobile-06-lead-detail.png", "planmgr/mobile-390/leads_id__ready.png", "/leads/:id", "planmgr", "پرونده لید در موبایل", "جزئیات لید در موبایل با اقدام‌های اصلی."),
    ("mobile-07-inbox.png", "planmgr/mobile-390/inbox__ready.png", "/inbox", "planmgr", "پاسخ به ارجاع از موبایل", "کارتابل ارجاع‌ها در موبایل.")]:
    add("mobile", out, P, rel, route, per, "mobile-390", MTX.format(p=per), reason, desc)
# ---- roles & admin (4)
add("roles", "roles-01-admin-users.png", P, "admin/desktop-1440/admin_users__ready.png", "/admin/users", "admin", "desktop-1440",
    MTX.format(p="admin"), "مدیریت کاربران (فقط SYSTEM_ADMIN)", "مدیریت کاربران: فهرست کاربران نمونه، وضعیت و نقش‌ها.")
add("roles", "roles-02-admin-roles.png", P, "admin/desktop-1440/admin_roles__ready.png", "/admin/roles", "admin", "desktop-1440",
    MTX.format(p="admin"), "ماتریس نقش × مجوز در خود محصول", "صفحه نقش‌ها و مجوزها: ۸ نقش سیستمی در برابر قابلیت‌ها.")
add("roles", "roles-03-booth-dashboard-denied.png", P, "specialist1/desktop-1440/dashboard__denied.png", "/dashboard", "specialist1", "desktop-1440",
    MTX.format(p="specialist1"), "اثبات بصری کنترل دسترسی", "کارشناس غرفه مجوز analytics.view ندارد و پیام «دسترسی مجاز نیست» می‌بیند؛ منو نیز این گزینه را ندارد.")
add("roles", "roles-04-executive-readonly-masked.png", E, "exec/desktop-1440/leads_id__readonly-masked.png", "/leads/:id", "exec", "desktop-1440",
    "frontend/qa-e2e › TC-ENR-02", "نقش فقط‌خواندنی و ماسک PII", "ناظر فقط‌خواندنی: اقدام‌های ویرایشی پنهان و شماره موبایل ماسک‌شده (بدون مجوز pii.view).")
# ---- states (4)
add("states", "states-01-offline-queued.png", E, "specialist2/desktop-1440/capture__offline-queued.png", "/capture", "specialist2", "desktop-1440",
    "frontend/qa-e2e › TC-OFF-01", "ثبت آفلاین و صف رمزنگاری‌شده", "ثبت در حالت آفلاین: پیام «در صف همگام‌سازی» و فهرست ثبت‌های اخیر با برچسب آفلاین.")
add("states", "states-02-server-error.png", P, "planmgr/desktop-1440/leads__server-error.png", "/leads", "planmgr", "desktop-1440",
    "frontend/qa-e2e/07-matrix-visual.spec.ts › TC-VIS-STATES", "حالت خطای سرور با امکان تلاش مجدد", "خطای ۵۰۰ شبیه‌سازی‌شده در فهرست لیدها: پیام «بارگذاری ناموفق بود» و دکمه تلاش دوباره.")
add("states", "states-03-edit-conflict-409.png", E, "planmgr/desktop-1440/leads_id__conflict.png", "/leads/:id", "planmgr", "desktop-1440",
    "frontend/qa-e2e › TC-ENR-03", "قفل خوش‌بینانه (version/409)", "تعارض ویرایش هم‌زمان: پیام تغییر رکورد توسط کاربر دیگر و دکمه بارگذاری مجدد در فرم تکمیل اطلاعات.")
add("states", "states-04-referral-modal.png", E, "mdm/desktop-1440/leads_id__refer-modal.png", "/leads/:id", "mdm", "desktop-1440",
    "frontend/qa-e2e › TC-REF-01", "جریان ارجاع لید", "پنجره ارجاع: انتخاب گیرنده از اعضای رویداد، مهلت و توضیح.")
# ---- before/after (3 pairs)
BA = [
    ("before-after-01-capture-mobile-overflow", "qa/traces", "baseline-mobile-375/02-capture-TC-CAP-01-exist-28390-osen-from-search-suggestion-mobile-375/test-failed-1.png",
     E, "specialist1/mobile-375/capture__validation-errors.png", "/capture", "specialist1", "mobile-375", "TC-CAP-01 / TC-CAP-06", "QA-D-20 (P1)",
     "قبل: در ۳۷۵ پیکسل صفحه ثبت به‌خاطر یک نام طولانی آزمونی در «آخرین ثبت‌های من» دوبرابر عریض شد و دکمه‌ها از دید خارج شدند (رشته طولانی، ورودی ساختگی آزمون تزریق CSV است).",
     "بعد (e661188): همان صفحه در ۳۷۵ پیکسل بدون اسکرول افقی؛ اعتبارسنجی فیلدها نمایش داده می‌شود."),
    ("before-after-02-offline-first-open", "qa/traces", "baseline-desktop-1440/07-matrix-visual-TC-VIS-ST-056b2--banner-popovers-and-toasts-desktop-1440/test-failed-1.png",
     E, "planmgr/desktop-1440/capture__offline-first-open.png", "/capture", "planmgr", "desktop-1440", "TC-VIS-STATES / TC-OFF-06", "QA-D-19 (P2)",
     "قبل: با قطع شبکه، کاربر عضو پیام «شما عضو فعال هیچ رویدادی نیستید» می‌دید و ثبت مسدود بود.",
     "بعد (e661188): زمینه رویداد از حافظه رمزنگاری‌شده خوانده می‌شود، بنر آفلاین نمایش داده می‌شود و فرم ثبت فعال است."),
    ("before-after-03-reports-mobile-overflow", None, "admin/mobile-390/reports__ready.png",
     E, "admin/mobile-390/reports__ready.png", "/reports", "admin", "mobile-390", "TC-MTX-admin", "QA-D-18 (P2)",
     "قبل (c6a1c88): کارت خروجی ۳۱ پیکسل از عرض صفحه بیشتر بود (عرض تصویر ۸۴۲ به‌جای ۷۸۰) و کل صفحه افقی اسکرول می‌شد.",
     "بعد (e661188): عرض تصویر برابر ۷۸۰ (۳۹۰×۲) و صفحه سرریز افقی ندارد؛ کلید انتخاب قالب در عرض کم درون خودش اسکرول می‌شود (گزینه JSON نیمه‌پنهان است)."),
]
for slug, broot, brel, aroot, arel, route, per, dev, test, defect, bdesc, adesc in BA:
    broot = broot or C
    add("before-after", f"{slug}-before.png", broot, brel, route, per, dev, test, f"شاهد نقص {defect}", bdesc)
    add("before-after", f"{slug}-after.png", aroot, arel, route, per, dev, test, f"تأیید رفع {defect}", adesc)

def src_path(root, rel):
    if root == LOGIN:
        return f"{SCR}/login/{rel}"
    return f"{REPO}/{root}/{rel}"

def optimise(src, dst, redact):
    im = Image.open(src).convert("RGB")
    if redact:
        d = ImageDraw.Draw(im)
        for box in redact:
            d.rounded_rectangle(box, radius=6, fill=(203, 210, 222))
    q = im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    q.save(dst, optimize=True)
    return im.size

def main():
    rows = []
    for s in S:
        src = src_path(s["root"], s["rel"])
        dst_dir = f"{PACK}/screenshots/{s['folder']}"
        os.makedirs(dst_dir, exist_ok=True)
        dst = f"{dst_dir}/{s['out']}"
        w, h = optimise(src, dst, s["redact"])
        vp, dtype = VP[s["device"]]
        source = f"{s['root']}/{s['rel']}" if s["root"] != LOGIN else f"(capture هدفمند، در مخزن نگهداری نشده) {s['rel']}"
        if s["root"] == P:
            source += "  (re-capture هدفمند؛ در مخزن نگهداری نشده)"
        rows.append(dict(output=f"screenshots/{s['folder']}/{s['out']}", source=source, route=s["route"],
                         role=f"{s['persona']} / {ROLE[s['persona']]}" if s['persona'] != 'anon' else ROLE['anon'],
                         viewport=vp, device_type=dtype, project=s["device"], test=s["test"],
                         commit=COMMIT[s["root"]], baseline_or_final=PHASE[s["root"]], selection_reason=s["reason"],
                         description_fa=s["desc"], synthetic_data=True, verified=True,
                         redacted="رمز حساب‌های نمایشی با کادر خاکستری پوشانده شد" if s["redact"] else None,
                         pixels=f"{w}x{h}", bytes=os.path.getsize(dst), original_bytes=os.path.getsize(src)))
    json.dump(rows, open(f"{SCR}/selected.json", "w"), ensure_ascii=False, indent=1)
    tot = sum(r["bytes"] for r in rows)
    print(len(rows), "images", round(tot / 1e6, 2), "MB (orig", round(sum(r["original_bytes"] for r in rows) / 1e6, 2), "MB)")

if __name__ == "__main__":
    main()
