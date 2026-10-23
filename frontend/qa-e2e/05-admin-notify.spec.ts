import { expect, test } from "@playwright/test";
import { api, apiLogin, expectNoOverflow, loginAs, press, shot, tc } from "./support";

test.describe("Admin CRUD", () => {
  test("TC-ADM-01 create event via UI (Jalali dates), add product and member, activate", async ({ page }, info) => {
    tc(info, "TC-ADM-01", { role: "admin", route: "/admin/events", action: "create+activate event", expected: "ACTIVE event with product & member" });
    await loginAs(page, "admin", "/admin/events");
    await press(info, page.getByRole("button", { name: "رویداد جدید" }));
    const dlg = page.getByRole("dialog");
    const code = `UI-${Date.now().toString(36).toUpperCase()}`;
    await dlg.getByPlaceholder("EXPO-1405").fill(code);
    await dlg.locator("input").nth(1).fill(`رویداد رابط کاربری ${code}`);
    for (const [i, label] of ["شروع", "پایان"].entries()) {
      await press(info, dlg.getByRole("button", { name: /انتخاب تاریخ|^شروع$|^پایان$/ }).nth(i));
      const cal = page.getByRole("grid");
      await press(info, cal.getByRole("button").nth(i === 0 ? 2 : 6));
      await press(info, page.getByRole("button", { name: "تأیید" }));
      void label;
    }
    await shot(page, info, "admin", "/admin/events", "create-modal", "TC-ADM-01");
    await press(info, dlg.getByRole("button", { name: "ذخیره" }));
    await expect(page.getByText(/رویداد ایجاد شد/)).toBeVisible();
    await press(info, page.getByRole("link", { name: new RegExp(code) }));
    await press(info, page.getByRole("radio", { name: "محصولات رویداد" }));
    await page.getByLabel("افزودن محصول").selectOption({ index: 1 });
    await press(info, page.getByRole("button", { name: "افزودن", exact: true }));
    await expect(page.locator("main li").first()).toBeVisible();
    await press(info, page.getByRole("radio", { name: "تیم و نقش‌ها" }));
    await press(info, page.getByRole("button", { name: "افزودن عضو" }));
    const m = page.getByRole("dialog");
    const settled = page.waitForResponse((r) => r.url().includes("/api/v1/users") && r.url().includes("q="));
    await m.getByLabel("جست‌وجوی کاربر").fill("الناز");
    await settled;
    await page.waitForTimeout(150);
    await press(info, m.getByRole("option", { name: /الناز/ }));
    await press(info, m.getByRole("checkbox", { name: "کارشناس غرفه" }));
    await press(info, m.getByRole("button", { name: "ذخیره" }));
    await expect(page.getByText("عضویت ذخیره شد")).toBeVisible();
    await press(info, page.getByRole("button", { name: "آماده‌سازی" }));
    await press(info, page.getByRole("dialog").getByRole("button", { name: "تأیید" }));
    await press(info, page.getByRole("button", { name: "فعال‌سازی" }));
    await press(info, page.getByRole("dialog").getByRole("button", { name: "تأیید" }));
    await expect(page.locator("main").getByText("فعال", { exact: true }).first()).toBeVisible();
    await expectNoOverflow(page, "event detail");
    await shot(page, info, "admin", "/admin/events/:id", "active", "TC-ADM-01");
  });

  test("TC-ADM-02 clone event copies configuration, never leads", async ({ page }, info) => {
    tc(info, "TC-ADM-02", { role: "admin", route: "/admin/events/:id", action: "clone", expected: "DRAFT clone, 0 interactions" });
    await apiLogin(page, "admin");
    const events = (await api(page, "GET", "/events?status=ACTIVE")).body.results;
    const tech = events.find((e: any) => e.code === "DEMO-TECH-1405");
    const code = `CLN-${Date.now().toString(36).toUpperCase()}`;
    await page.goto(`/admin/events/${tech.id}`);
    await press(info, page.getByRole("button", { name: "کپی پیکربندی" }));
    const dlg = page.getByRole("dialog");
    await dlg.locator("input").first().fill(code);
    await press(info, dlg.getByRole("checkbox", { name: "کپی اعضا و نقش‌ها" }));
    await press(info, dlg.getByRole("button", { name: "ایجاد کپی" }));
    await expect(page.getByText(new RegExp(`${code}.*پیش‌نویس`))).toBeVisible();
    const clone = (await api(page, "GET", `/events?q=${code}`)).body.results[0];
    expect(clone.interaction_count).toBe(0);
    expect(clone.member_count).toBeGreaterThan(0);
    expect(clone.status).toBe("DRAFT");
  });

  test("TC-ADM-03 user creation requires valid mobile; activation link issued", async ({ page }, info) => {
    tc(info, "TC-ADM-03", { role: "admin", route: "/admin/users", action: "create user", expected: "mobile required; normalized; activation" });
    await loginAs(page, "admin", "/admin/users");
    await press(info, page.getByRole("button", { name: "کاربر جدید" }));
    const dlg = page.getByRole("dialog");
    const inputs = dlg.locator("input");
    const uname = `ui_user_${Date.now().toString(36)}`;
    await inputs.nth(0).fill(uname);
    await inputs.nth(1).fill("آزمون");
    await inputs.nth(2).fill("کاربر");
    await press(info, dlg.getByRole("button", { name: /ایجاد و ارسال/ }));
    await expect(dlg.getByText(/شماره موبایل معتبر ایرانی|نباید خالی باشد/)).toBeVisible();
    await shot(page, info, "admin", "/admin/users", "create-validation", "TC-ADM-03");
    await dlg.getByPlaceholder("0912 345 6789").fill("۰۹۱۲ ۱۲۳ ۴۵۶۷");
    await press(info, dlg.getByRole("button", { name: /ایجاد و ارسال/ }));
    await expect(page.getByRole("heading", { name: "لینک فعال‌سازی/بازنشانی صادر شد" })).toBeVisible();
    await expect(page.getByRole("dialog").getByText(/شبیه‌سازی/).first()).toBeVisible();
    const u = (await api(page, "GET", `/users?q=${uname}`)).body.results[0];
    expect(u.mobile).toBe("+989121234567");
    expect(u.has_password).toBe(false);
  });

  test("TC-ADM-04 tag taxonomy: create, archive; archived not selectable", async ({ page }, info) => {
    tc(info, "TC-ADM-04", { role: "mdm", route: "/admin/tags", action: "tag CRUD", req: "§23.2", expected: "archived hidden from active list" });
    await loginAs(page, "mdm", "/admin/tags");
    await press(info, page.getByRole("button", { name: "برچسب جدید" }));
    const dlg = page.getByRole("dialog");
    const name = `برچسب QA ${Date.now() % 100000}`;
    await dlg.locator("input").first().fill(name);
    await press(info, dlg.getByRole("radio", { name: "فیروزه‌ای" }));
    await shot(page, info, "mdm", "/admin/tags", "create-modal", "TC-ADM-04");
    await press(info, dlg.getByRole("button", { name: "ذخیره" }));
    const row = page.locator("li", { hasText: name });
    await expect(row).toBeVisible();
    await press(info, row.getByRole("button", { name: /بایگانی/ }));
    await expect(row.getByText("(بایگانی)")).toBeVisible();
    const active = (await api(page, "GET", "/tags?active=1")).body;
    expect(active.some((t: any) => t.name_fa === name)).toBe(false);
  });

  test("TC-ADM-05 logo upload: SVG rejected, PNG accepted, reset", async ({ page }, info) => {
    tc(info, "TC-ADM-05", { role: "admin", route: "/admin/branding", action: "logo upload", req: "§23.1", expected: "SVG rejected with message; PNG shown" });
    await loginAs(page, "admin", "/admin/branding");
    const input = page.locator("input[type=file]").first();
    await input.setInputFiles({ name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
    await expect(page.getByText("فایل پذیرفته نشد")).toBeVisible();
    await shot(page, info, "admin", "/admin/branding", "upload-rejected", "TC-ADM-05");
    // 64x64 navy PNG generated in-page via canvas
    const png = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 160; c.height = 48;
      const g = c.getContext("2d")!;
      g.fillStyle = "#10294C"; g.fillRect(0, 0, 160, 48);
      const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    });
    await input.setInputFiles({ name: "qa-logo.png", mimeType: "image/png", buffer: Buffer.from(png) });
    await expect(page.getByText("نشان بارگذاری و پردازش امن شد")).toBeVisible();
    await expect(page.locator("main img[alt]").first()).toBeVisible();
    await press(info, page.getByRole("button", { name: "بازگشت به پیش‌فرض" }).first());
    await expect(page.getByText(/نشان رسمی هنوز بارگذاری نشده/)).toBeVisible();
  });
});

test.describe("Notification & action center", () => {
  test("TC-NTF-01/02 action request: reading ≠ completing; completion tracked for requester", async ({ page, browser }, info) => {
    tc(info, "TC-NTF-02", { role: "mdm→specialist2", route: "/messages + /inbox", action: "action request", req: "§17", expected: "stays OPEN after read; DONE after explicit action" });
    await loginAs(page, "mdm", "/messages");
    const subject = `درخواست QA ${info.project.name} ${Date.now() % 100000}`;
    await press(info, page.getByRole("radio", { name: "درخواست اقدام" }));
    await page.locator("#m-subject").fill(subject);
    await page.locator("#m-body").fill("لطفاً گزارش غرفه را بارگذاری کنید.");
    const settled = page.waitForResponse((r) => r.url().includes("/api/v1/users") && r.url().includes("q="));
    await page.getByLabel("جست‌وجوی کاربر").fill("سمیرا");
    await settled;
    await page.waitForTimeout(150);
    await press(info, page.getByRole("option", { name: /سمیرا/ }));
    await press(info, page.getByRole("button", { name: "پیش‌نمایش و ارسال" }));
    await expect(page.getByRole("dialog")).toContainText("تعداد گیرندگان");
    await shot(page, info, "mdm", "/messages", "send-preview", "TC-NTF-02");
    await press(info, page.getByRole("dialog").getByRole("button", { name: "ارسال" }));
    await expect(page.getByText(/ارسال شد/).first()).toBeVisible();

    const ctx = await browser.newContext({ ...(info.project.use as any) });
    const sp = await ctx.newPage();
    await apiLogin(sp, "specialist2");
    await sp.goto("/notifications");
    const n = sp.locator("li", { hasText: subject });
    await press(info, n.getByRole("button", { name: "خواندم" }));
    const ar = (await api(sp, "GET", "/action-requests")).body.results.find((a: any) => a.subject === subject);
    expect(ar.status).toBe("OPEN");
    await sp.goto("/inbox?tab=actions");
    const card = sp.locator("li", { hasText: subject });
    await press(info, card.getByRole("button", { name: "دیدم" }));
    await expect(card.getByText("دیده‌شده")).toBeVisible();
    await sp.waitForLoadState("networkidle");
    await press(info, card.getByRole("button", { name: "انجام شد" }));
    await sp.getByRole("dialog").getByLabel("توضیح").fill("بارگذاری شد");
    await press(info, sp.getByRole("dialog").getByRole("button", { name: "ثبت" }));
    await expect(sp.getByText("وضعیت به‌روز شد").first()).toBeVisible();
    await ctx.close();
    const req = (await api(page, "GET", "/action-requests?scope=requested&status=ALL")).body.results.find((a: any) => a.subject === subject);
    expect(req.status).toBe("DONE");
  });

  test("TC-NTF-03 mock SMS test send reported as SIMULATED, never delivered", async ({ page }, info) => {
    tc(info, "TC-NTF-03", { role: "admin", route: "/admin/notify", action: "provider test", req: "§22.5", expected: "SIMULATED wording" });
    await loginAs(page, "admin", "/admin/notify");
    const card = page.locator(".card", { hasText: "پیامک شبیه‌سازی" }).first();
    await press(info, card.getByRole("button", { name: "آزمون" }));
    await press(info, page.getByRole("dialog").getByRole("button", { name: "ارسال آزمایشی" }));
    await expect(page.getByRole("dialog").getByRole("status")).toContainText("هیچ پیام واقعی ارسال نشد");
    await shot(page, info, "admin", "/admin/notify", "mock-test-send", "TC-NTF-03");
  });

  test("TC-NTF-04 delivery log never shows mock attempts as delivered", async ({ page }, info) => {
    tc(info, "TC-NTF-04", { role: "admin", route: "/admin/notify", action: "logs", expected: "SMS rows SIMULATED/SKIPPED/FAILED only" });
    await apiLogin(page, "admin");
    const jobs = (await api(page, "GET", "/notify/jobs?channel=SMS&page_size=200")).body.results;
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(["DELIVERED", "SENT"]).not.toContain(j.status);
      for (const d of j.delivery) if (d.is_mock) expect(d.status).toBe("SIMULATED");
    }
    await page.goto("/admin/notify");
    await press(info, page.getByRole("radio", { name: "گزارش ارسال" }));
    await expect(page.getByText(/شبیه‌سازی/).first()).toBeVisible();
    await expectNoOverflow(page, "notify logs");
  });
});
