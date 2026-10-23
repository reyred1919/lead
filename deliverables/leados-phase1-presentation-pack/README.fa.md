# بسته مستندات ارائه — LeadOS فاز ۱

این بسته برای ارائه مدیریتی و فنی فاز ۱ سامانه لیدهای نمایشگاهی آماده شده است. همه محتوا فارسی و راست‌به‌چپ است.

- **مبنا:** شاخه `qa/audit-c6a1c88` در commit `1d4fda6`؛ کد محصول در commit `d478da7`.
- **QA:** Pull Request ممیزی https://github.com/reyred1919/lead/pull/1

> **داده نمونه:** همه تصاویر screenshot واقعی Playwright از محصول اجراشده با **داده ساختگی DEMO** هستند. نام‌ها، شماره‌ها، سازمان‌ها و اعداد داشبورد آمار واقعی نیستند. هیچ موکاپ یا طراحی ساختگی در این بسته نیست.

## ترتیب پیشنهادی مطالعه

| # | سند | مخاطب | زمان تقریبی |
|---|---|---|---|
| ۱ | [گزارش مدیریتی محصول](docs/01-executive-product-report.fa.md) | مدیران، کمیته انتشار | ۱۰ دقیقه |
| ۲ | [QA و آمادگی انتشار](docs/06-qa-results-and-release-readiness.fa.md) | کمیته انتشار، QA | ۱۵ دقیقه |
| ۳ | [نقش‌ها، جریان‌ها و دسترسی‌ها](docs/05-user-roles-flows-and-permissions.fa.md) | مالک محصول، امنیت | ۱۵ دقیقه |
| ۴ | [تحلیل داده و KPI](docs/04-data-analysis-and-kpis.fa.md) | تحلیلگر، کسب‌وکار | ۱۵ دقیقه |
| ۵ | [معماری فنی](docs/02-technical-architecture.fa.md) | تیم فنی | ۲۰ دقیقه |
| ۶ | [مدل داده](docs/03-data-model.fa.md) | تیم داده و توسعه | مرجع |
| ۷ | [کاتالوگ تصاویر](docs/07-screenshot-catalog.fa.md) | ارائه‌دهنده | مرجع |

## ۱۰ تصویر برتر برای ارائه

| # | تصویر | پیام |
|---|---|---|
| ۱ | [desktop-01-login](screenshots/desktop/desktop-01-login.png) | ورود سازمانی |
| ۲ | [mobile-03-capture-form](screenshots/mobile/mobile-03-capture-form.png) | ثبت لید با گوشی در غرفه |
| ۳ | [states-01-offline-queued](screenshots/states/states-01-offline-queued.png) | کار بدون اینترنت |
| ۴ | [desktop-05-leads-list](screenshots/desktop/desktop-05-leads-list.png) | فهرست لیدها با دامنه دسترسی |
| ۵ | [desktop-06-lead-detail](screenshots/desktop/desktop-06-lead-detail.png) | پرونده لید و اقدام‌ها |
| ۶ | [states-04-referral-modal](screenshots/states/states-04-referral-modal.png) | ارجاع با مهلت |
| ۷ | [mobile-07-inbox](screenshots/mobile/mobile-07-inbox.png) | پذیرش ارجاع از موبایل |
| ۸ | [desktop-02-analytics-dashboard](screenshots/desktop/desktop-02-analytics-dashboard.png) | داشبورد مدیریتی (داده نمونه) |
| ۹ | [roles-04-executive-readonly-masked](screenshots/roles/roles-04-executive-readonly-masked.png) | حریم خصوصی و نقش فقط‌خواندنی |
| ۱۰ | [before-after-02 قبل](screenshots/before-after/before-after-02-offline-first-open-before.png) / [بعد](screenshots/before-after/before-after-02-offline-first-open-after.png) | نقص آفلاین یافته و رفع شد |

برگه‌های مرور: [دسکتاپ، نقش‌ها و حالت‌ها](contact-sheets/desktop-overview.png) · [تبلت](contact-sheets/tablet-overview.png) · [موبایل](contact-sheets/mobile-overview.png) · [قبل و بعد](contact-sheets/before-after-overview.png)

## محتوای بسته

| مسیر | محتوا |
|---|---|
| `docs/` | ۷ سند فارسی |
| `screenshots/desktop/` | ۷ تصویر ۱۴۴۰×۹۰۰ |
| `screenshots/tablet/` | ۴ تصویر ۷۶۸×۱۰۲۴ (چگالی ۲) |
| `screenshots/mobile/` | ۷ تصویر ۳۹۰×۸۴۴ (چگالی ۲) |
| `screenshots/roles/` | ۴ تصویر نقش و مدیریت |
| `screenshots/states/` | ۴ تصویر حالت سیستم (آفلاین، خطا، تعارض، ارجاع) |
| `screenshots/before-after/` | ۳ جفت قبل و بعد از رفع نقص |
| `contact-sheets/` | ۴ برگه مرور |
| `manifest.yaml` | فراداده هر تصویر: منبع، route، نقش، viewport، تست، commit، دلیل انتخاب، توضیح فارسی |
| `tools/` | اسکریپت‌های تولید و بررسی (ر.ک. پایین) |

## روش تهیه و اعتبارسنجی

**تصاویر:**

- منبع اصلی، اجراهای commit‌شده QA است: `qa/screenshots/e661188`، `qa/screenshots/c6a1c88` و `qa/traces`.
- تصاویر فهرست‌ها در اجرای نهایی QA شامل رشته‌های آزمون امنیتی بودند. برای همین، spec ‏`07-matrix-visual` بدون تغییر کد محصول روی پایگاه‌داده تازه seedشده دوباره اجرا شد. نتیجه روی desktop-1440، tablet-768 و mobile-390: ۳۷ تست موفق و ۲ تست ردشده عمدی.
- صفحه‌های بدون ورود با `tools/capture-login.mjs` گرفته شدند.
- همه تصاویر به PNG پالتی بدون تغییر ابعاد فشرده شدند. حجم از ۷٫۹ به ۳٫۱ مگابایت رسید.
- در دو تصویر ورود، رمز حساب‌های نمایشی با کادر خاکستری پوشانده شد.

**ادعاها:** هر ادعای فنی برچسب «موجود در کد»، «استنباط از معماری» یا «پیشنهاد توسعه» و ارجاع به فایل منبع دارد.

**بررسی‌های انجام‌شده:**

| بررسی | ابزار | نتیجه |
|---|---|---|
| اعتبار نمودارهای Mermaid | `tools/validate-mermaid.mjs` (mermaid 11.4.1، parse) | همه بلوک‌ها معتبر |
| پیوندهای نسبی و وجود تصاویر | `tools/check-links.py` | بدون پیوند شکسته |
| پرس‌وجوهای SQL سند ۴ | اجرا روی PostgreSQL 16 با پایگاه‌داده QA | ۱۵ از ۱۵ بدون خطا |
| حجم | `du` | زیر ۳۰ مگابایت |
| داده حساس | بازبینی تصویری همه تصاویر و جست‌وجوی متنی | فقط داده DEMO؛ رمز نمایشی پوشانده شد |

**ابزارها:**

- `tools/build_pack.py` و `tools/sheets.py` برای انتخاب، فشرده‌سازی و برگه مرور هستند.
- مسیرهای ورودی این اسکریپت‌ها به محیط تولید بسته اشاره دارند؛ نسخه خام re-capture در مخزن نیست.

## محدودیت‌ها

- همه تصاویر از Chromium شبیه‌سازی‌شده‌اند. Safari/iOS، Firefox و دستگاه فیزیکی آزموده نشده‌اند.
- تصاویر re-capture با کد `d478da7` گرفته شده‌اند. تصاویر حالت‌ها و «بعد» از اجرای نهایی `e661188` هستند. تفاوت این دو commit فقط ویژگی‌های markup دسترس‌پذیری است.
- اعداد داشبورد و فهرست‌ها از داده DEMO هستند و نباید به‌عنوان نتیجه کسب‌وکار ارائه شوند.
- در تصاویر تمام‌صفحه تبلت و موبایل، نوار ناوبری ثابت پایین در میانه تصویر دیده می‌شود. این رفتار طبیعی screenshot تمام‌صفحه است.
- «مدیر فروش» نقش جداگانه در کد ندارد. نگاشت آن در سند ۵ توضیح داده شده است.
