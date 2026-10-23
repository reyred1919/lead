# Permissions matrix

Generated from `backend/apps/iam/capabilities.py`, the single source of truth evaluated by the server (`apps/iam/authz.py`). The UI only hides affordances; **every read, write, export and action is re-checked on the server**, including object-level scope.

## Composition rules

1. **Additive grants.** Effective capabilities = union of the user's global roles + the roles of each ACTIVE event membership (scoped to that event). Roles never subtract, and holding a management role never hides capture, personal leads, notifications or assigned actions. There is no role switching.
2. **Universal capture** (`interaction.create`) is granted by *any* ACTIVE membership of an ACTIVE event, with or without roles (Booth Specialist, Product Owner, Plan Manager, Market Development Manager, Director General, System Admin). A global role alone never authorizes capture: a closed event, a removed membership, or a product not offered in the event is denied for every role.
3. **Event scope.** Event-role capabilities apply only inside that event; a membership can be further limited to plans/products (`allowed_plans`, `allowed_products`).
4. **Global-only capabilities** (cannot be granted through an event role): `audit.view`, `branding.manage`, `catalog.manage`, `contact.merge`, `event.manage`, `lead.view.all`, `notification.configure`, `provider.manage`, `role.manage`, `sync.review`, `tags.manage`, `user.manage`, `user.password_reset`.
5. **Object-level grants.** Independently of roles, a user can see a lead they created, were referred, own (triage or opportunity owner), collaborate on, or have a task on. Assignees (accepted referral recipient, owner, collaborator, open-task owner) may edit details, qualify and manage tasks on *that* lead. PII is visible to the creator, assignees and holders of `pii.view` in scope; others see masked phones/emails.
6. **Director General** is operational (capture with membership, view all, qualify, assign, tasks, exports, messages) but has **no** `provider.manage`, `user.manage`, `user.password_reset`, `role.manage`, `audit.view` or other infrastructure/secret rights. `EXECUTIVE_READONLY` is a separate optional view-only role.

## Matrix

| Capability | مدیر سامانه (اداره توسعه بازار)<br>`SYSTEM_ADMIN` (G) | مدیر توسعه بازار<br>`MARKET_DEV_MANAGER` (G) | مدیرکل<br>`DIRECTOR_GENERAL` (G) | ناظر اجرایی (فقط‌خواندنی)<br>`EXECUTIVE_READONLY` (G) | مدیر رویداد<br>`EVENT_MANAGER` (E) | مدیر طرح/برنامه<br>`PLAN_MANAGER` (E) | مالک محصول/پروژه<br>`PRODUCT_OWNER` (E) | کارشناس غرفه<br>`BOOTH_SPECIALIST` (E) |
|---|---|---|---|---|---|---|---|---|
| ثبت لید `interaction.create` | با عضویت فعال | با عضویت فعال | با عضویت فعال | با عضویت فعال | با عضویت فعال | با عضویت فعال | با عضویت فعال | با عضویت فعال |
| مشاهده گزارش ممیزی `audit.view` | ✓ | ✓ |  |  |  |  |  |  |
| مدیریت نشان و هویت بصری `branding.manage` | ✓ | ✓ |  |  |  |  |  |  |
| مدیریت طرح‌ها و محصولات `catalog.manage` | ✓ | ✓ |  |  |  |  |  |  |
| بازبینی و ادغام رکوردهای تکراری `contact.merge` | ✓ | ✓ |  |  |  |  |  |  |
| مشاهده داشبورد `dashboard.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| مدیریت رویدادها `event.manage` | ✓ | ✓ |  |  |  |  |  |  |
| مدیریت تیم رویداد `event.team.manage` | ✓ | ✓ |  |  | ✓ |  |  |  |
| خروجی داده `export.run` | ✓ | ✓ | ✓ |  | ✓ | ✓ |  |  |
| ارجاع و تخصیص مجدد `lead.assign` | ✓ | ✓ | ✓ |  | ✓ | ✓ |  |  |
| تکمیل و ویرایش جزئیات لید `lead.detail.edit` | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |
| ارزیابی و تبدیل به فرصت `lead.qualify` | ✓ | ✓ | ✓ |  | ✓ | ✓ |  |  |
| مشاهده همه لیدهای مجاز سازمان `lead.view.all` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |
| مشاهده لیدهای محدوده رویداد/طرح/محصول `lead.view.scope` | ✓ |  |  |  | ✓ | ✓ | ✓ |  |
| تنظیم قواعد و قالب‌های اعلان `notification.configure` | ✓ | ✓ |  |  |  |  |  |  |
| ارسال پیام و درخواست اقدام `notification.send` | ✓ | ✓ | ✓ |  | ✓ | ✓ |  |  |
| مشاهده شماره تماس و ایمیل مخاطبان `pii.view` | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |
| مدیریت سرویس‌دهنده پیامک/ایمیل و اسرار `provider.manage` | ✓ |  |  |  |  |  |  |  |
| مدیریت نقش‌ها `role.manage` | ✓ |  |  |  |  |  |  |  |
| بازبینی ثبت‌های آفلاین معلق `sync.review` | ✓ | ✓ |  |  |  |  |  |  |
| مدیریت برچسب‌های سراسری `tags.manage` | ✓ | ✓ |  |  |  |  |  |  |
| تعریف و مدیریت وظایف پیگیری `task.manage` | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |
| مدیریت کاربران `user.manage` | ✓ |  |  |  |  |  |  |  |
| صدور لینک بازنشانی رمز `user.password_reset` | ✓ |  |  |  |  |  |  |  |

G = global role, E = event-scoped role. Custom roles can be created by holders of `role.manage`; system roles are immutable.

## Record-level rules (always applied)

| Action | Who |
|---|---|
| Correct own booth capture (quality, note, products) | Creator only, while the event is ACTIVE, with version check |
| Accept / return a referral | Only the referral recipient (return requires a reason) |
| Cancel a pending referral | Initiator, or `lead.assign` in scope |
| Complete a task | Task owner, or `task.manage` in scope |
| Transition an action request | Assignee (acknowledge / start / done / return); requester (cancel / reopen) |
| Download an export | Only its creator, with the unguessable token, before expiry |
| Recipients of a manual message | Limited to the sender's scope: global `notification.send` → any active user; event-scoped → members of those events |

